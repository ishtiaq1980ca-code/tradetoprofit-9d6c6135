// High-confidence signal generator (v2).
//
// Pipeline per symbol:
//   1. Resolve pair profile (strategy + thresholds for this instrument).
//   2. Compute full indicator stack: EMA50/100/200, RSI, MACD, ADX, ATR,
//      Bollinger Bands, Stochastic.
//   3. Run the strategy playbook for this profile to pick direction.
//   4. Apply pre-trade filters: spread, volatility, session, news.
//   5. Score across trend / momentum / volatility / structure / R:R.
//   6. Build ATR-based SL, RR-based TP, risk-sized lot.
//   7. Only return a signal if confidence >= MIN_CONFIDENCE and no filter
//      blocked. Always return an explanation (reason/blockers/indicators).
//
// MT5 bridge / order execution layer is NOT touched here.

import {
  adx, atr, bollinger, detectLevels, ema, macd, rsi, stochastic, type Candle,
} from "./indicators";
import { getPairProfile, type PairProfile, type StrategyKind } from "./pairProfiles";
import {
  estimatedSpread, newsFilter, sessionFilter, spreadFilter, volatilityFilter,
  type FilterResult,
} from "./tradeFilters";
import { computeLevels, positionSize, DEFAULT_RISK, type RiskParams } from "./riskEngine";
import { activeSessions } from "./sessions";

// Confidence gates: gold requires 85%, FX currencies 80%.
export const MIN_CONFIDENCE_GOLD = 85;
export const MIN_CONFIDENCE_FX = 80;
export const MIN_CONFIDENCE = MIN_CONFIDENCE_FX; // back-compat: lowest floor
export function minConfidenceFor(symbol: string): number {
  return symbol === "XAUUSD" || symbol === "GOLD" ? MIN_CONFIDENCE_GOLD : MIN_CONFIDENCE_FX;
}

export type ConfidenceBreakdown = {
  trend: number;       // 0..25
  momentum: number;    // 0..25
  volatility: number;  // 0..15
  structure: number;   // 0..20
  riskReward: number;  // 0..15
  total: number;       // 0..100
};

export type IndicatorSnapshot = {
  ema50: number;
  ema100: number;
  ema200: number;
  rsi: number;
  macdHist: number;
  macdPrev: number;
  adx: number;
  atr: number;
  bbUpper: number;
  bbLower: number;
  bbWidth: number;
  stochK: number;
  stochD: number;
};

export type FilterSummary = { name: string; pass: boolean; reason: string };

export type TradeDecision = {
  // Identity
  symbol: string;
  strategy: string;
  strategyKind: StrategyKind;
  // Outcome
  side: "BUY" | "SELL" | "FLAT";
  accepted: boolean;
  rejectionReason?: string;
  confidence: number;
  breakdown: ConfidenceBreakdown;
  // Trade plan
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lot: number;
  riskPct: number;
  riskReward: number;
  // Diagnostics
  indicators: IndicatorSnapshot;
  filters: FilterSummary[];
  reasons: {
    trend: string;
    momentum: string;
    volatility: string;
    structure: string;
    riskReward: string;
    risk: string;
    strategy: string;
  };
  reason: string;            // multi-line summary
  generatedAt: number;
};

// Back-compat alias for the older Signals UI.
export type HighConfidenceSignal = TradeDecision;

export type GeneratorParams = {
  minConfidence: number;
  risk: RiskParams;
};

export const DEFAULT_GENERATOR_PARAMS: GeneratorParams = {
  minConfidence: MIN_CONFIDENCE_FX,
  risk: DEFAULT_RISK,
};

// --------------------------- Strategy playbooks ---------------------------

type PlaybookCtx = {
  profile: PairProfile;
  candles: Candle[];
  price: number;
  ind: IndicatorSnapshot;
};

type PlaybookOutput = { side: "BUY" | "SELL" | "FLAT"; rationale: string };

function playbook(ctx: PlaybookCtx): PlaybookOutput {
  const { profile, ind, price, candles } = ctx;
  const trendUp = ind.ema50 > ind.ema100 && ind.ema100 > ind.ema200;
  const trendDown = ind.ema50 < ind.ema100 && ind.ema100 < ind.ema200;

  switch (profile.strategy) {
    case "trend_pullback": {
      if (trendUp && price <= ind.ema50 * 1.001 && ind.rsi < 55 && ind.rsi > 35) {
        return { side: "BUY", rationale: "Bullish stack EMA50>100>200, price pulled back to EMA50, RSI recovering" };
      }
      if (trendDown && price >= ind.ema50 * 0.999 && ind.rsi > 45 && ind.rsi < 65) {
        return { side: "SELL", rationale: "Bearish stack EMA50<100<200, price pulled back to EMA50, RSI fading" };
      }
      return { side: "FLAT", rationale: "No clean pullback in established trend" };
    }
    case "breakout": {
      if (price > ind.bbUpper && ind.adx >= profile.adxMin) {
        return { side: "BUY", rationale: `Close above upper BB ${ind.bbUpper.toFixed(5)} with ADX ${ind.adx.toFixed(1)}` };
      }
      if (price < ind.bbLower && ind.adx >= profile.adxMin) {
        return { side: "SELL", rationale: `Close below lower BB ${ind.bbLower.toFixed(5)} with ADX ${ind.adx.toFixed(1)}` };
      }
      return { side: "FLAT", rationale: "No BB breakout with ADX confirmation" };
    }
    case "trend_following": {
      if (trendUp && ind.macdHist > 0 && ind.macdHist >= ind.macdPrev) {
        return { side: "BUY", rationale: "Bullish EMA stack with MACD histogram rising" };
      }
      if (trendDown && ind.macdHist < 0 && ind.macdHist <= ind.macdPrev) {
        return { side: "SELL", rationale: "Bearish EMA stack with MACD histogram falling" };
      }
      return { side: "FLAT", rationale: "Trend & MACD not aligned" };
    }
    case "range_breakout": {
      // BB squeeze: width below recent average -> breakout candidate
      const recentWidths = candles.slice(-30).map((_, i, arr) => arr[i]?.close).filter(Boolean);
      void recentWidths; // width series already captured in ind.bbWidth (latest)
      const squeeze = ind.bbWidth > 0 && ind.bbWidth < 0.6; // % width threshold
      if (squeeze && price > ind.bbUpper) return { side: "BUY", rationale: `BB squeeze (width ${ind.bbWidth.toFixed(2)}%) breaking up` };
      if (squeeze && price < ind.bbLower) return { side: "SELL", rationale: `BB squeeze (width ${ind.bbWidth.toFixed(2)}%) breaking down` };
      return { side: "FLAT", rationale: "No squeeze breakout" };
    }
    case "momentum": {
      const macdAccelUp = ind.macdHist > 0 && ind.macdHist > ind.macdPrev;
      const macdAccelDn = ind.macdHist < 0 && ind.macdHist < ind.macdPrev;
      const stochUp = ind.stochK > ind.stochD && ind.stochK < 80;
      const stochDn = ind.stochK < ind.stochD && ind.stochK > 20;
      if (macdAccelUp && stochUp && ind.adx >= profile.adxMin) {
        return { side: "BUY", rationale: "MACD accelerating up, Stoch %K>%D, ADX confirms" };
      }
      if (macdAccelDn && stochDn && ind.adx >= profile.adxMin) {
        return { side: "SELL", rationale: "MACD accelerating down, Stoch %K<%D, ADX confirms" };
      }
      return { side: "FLAT", rationale: "Momentum stack not aligned" };
    }
    case "support_resistance": {
      const { support, resistance } = detectLevels(candles, 80, 4);
      const nearestSup = support.filter((l) => l < price).sort((a, b) => b - a)[0];
      const nearestRes = resistance.filter((l) => l > price).sort((a, b) => a - b)[0];
      const nearSup = nearestSup && (price - nearestSup) / ind.atr < 1.0;
      const nearRes = nearestRes && (nearestRes - price) / ind.atr < 1.0;
      if (nearSup && ind.stochK < 25 && ind.rsi < 40) {
        return { side: "BUY", rationale: `At support ${nearestSup!.toFixed(5)} with Stoch & RSI oversold` };
      }
      if (nearRes && ind.stochK > 75 && ind.rsi > 60) {
        return { side: "SELL", rationale: `At resistance ${nearestRes!.toFixed(5)} with Stoch & RSI overbought` };
      }
      return { side: "FLAT", rationale: "Not at S/R with exhaustion" };
    }
    case "session_breakout": {
      // Use the last 60 candles as the "prior session range"
      const lookback = candles.slice(-60, -5);
      if (lookback.length < 20) return { side: "FLAT", rationale: "Not enough history for session range" };
      const hi = Math.max(...lookback.map((c) => c.high));
      const lo = Math.min(...lookback.map((c) => c.low));
      if (price > hi && ind.adx >= profile.adxMin) return { side: "BUY", rationale: `Above prior session high ${hi.toFixed(5)}` };
      if (price < lo && ind.adx >= profile.adxMin) return { side: "SELL", rationale: `Below prior session low ${lo.toFixed(5)}` };
      return { side: "FLAT", rationale: "Inside prior session range" };
    }
    case "fx_multi_confirmation": {
      // Multi-confirmation FX playbook with anti-chase guard:
      //   Trend:      EMA50 vs EMA200
      //   Location:   price on correct side of EMA50, but NOT over-extended
      //   Momentum:   RSI band + MACD/Stoch agreement. At the new 40% floor we
      //               allow partial confirmation, then the confidence score
      //               decides whether the setup is strong enough.
      //   Exhaustion: Stoch not at extreme in trade direction
      //   No-chase:   price within 2.5×ATR of EMA50 (else we'd buy tops / sell bottoms)
      //   Volatility: ATR active + ADX above sideways floor
      //   Session:    London / NY / overlap = normal; Asian-only = stricter
      const macdBull = ind.macdHist > 0 && ind.macdHist >= ind.macdPrev;
      const macdBear = ind.macdHist < 0 && ind.macdHist <= ind.macdPrev;
      const atrPct = (ind.atr / price) * 100;
      const atrActive = ind.atr > 0 && atrPct >= profile.minAtrPct;
      const notSideways = ind.adx >= profile.adxMin;
      if (!atrActive) return { side: "FLAT", rationale: "ATR inactive (volatility too low)" };
      if (!notSideways) return { side: "FLAT", rationale: `Sideways market (ADX ${ind.adx.toFixed(1)} < ${profile.adxMin})` };

      // Session strength: London/NY = normal, Asian-only = require stronger confirmation
      const sess = activeSessions();
      const inLondonOrNY = sess.active.includes("London") || sess.active.includes("New York");
      const asianOnly = !inLondonOrNY && (sess.active.includes("Tokyo") || sess.active.includes("Sydney"));
      if (asianOnly) {
        const strongAdx = ind.adx >= profile.adxMin * 1.15;
        const strongAtr = atrPct >= profile.minAtrPct * 1.15;
        if (!strongAdx || !strongAtr) {
          return { side: "FLAT", rationale: `Asian session — requires stronger confirmation (ADX ${ind.adx.toFixed(1)} need ≥${(profile.adxMin * 1.15).toFixed(1)}, ATR% ${atrPct.toFixed(3)} need ≥${(profile.minAtrPct * 1.15).toFixed(3)})` };
        }
      }

      // Anti-chase: how far is price from EMA50 in ATR units?
      const distFromEma50Atr = Math.abs(price - ind.ema50) / Math.max(ind.atr, 1e-9);
      const overExtended = distFromEma50Atr > 2.5;
      const stochOverbought = ind.stochK > 88;
      const stochOversold = ind.stochK < 12;

      const trendUpFx = ind.ema50 > ind.ema200;
      const trendDnFx = ind.ema50 < ind.ema200;
      const sessionTag = inLondonOrNY
        ? (sess.active.includes("London") && sess.active.includes("New York") ? "London+NY overlap" : sess.active.includes("London") ? "London" : "New York")
        : "Asian (strict)";
      const stochBull = ind.stochK >= ind.stochD;
      const stochBear = ind.stochK <= ind.stochD;
      const buyRsiOk = ind.rsi >= 48 && ind.rsi <= 72;
      const sellRsiOk = ind.rsi >= 28 && ind.rsi <= 52;
      if (trendUpFx && price > ind.ema50 && buyRsiOk && (macdBull || stochBull)) {
        if (overExtended) return { side: "FLAT", rationale: `BUY skipped — price ${distFromEma50Atr.toFixed(2)}×ATR above EMA50 (chasing top, wait for pullback)` };
        if (stochOverbought) return { side: "FLAT", rationale: `BUY skipped — Stoch %K ${ind.stochK.toFixed(1)} overbought (exhaustion risk)` };
        return { side: "BUY", rationale: `EMA50>EMA200, price>EMA50 (${distFromEma50Atr.toFixed(2)}×ATR), RSI ${ind.rsi.toFixed(1)} OK, ${macdBull ? "MACD bullish" : "Stoch bullish"} · ${sessionTag}` };
      }
      if (trendDnFx && price < ind.ema50 && sellRsiOk && (macdBear || stochBear)) {
        if (overExtended) return { side: "FLAT", rationale: `SELL skipped — price ${distFromEma50Atr.toFixed(2)}×ATR below EMA50 (chasing bottom, wait for pullback)` };
        if (stochOversold) return { side: "FLAT", rationale: `SELL skipped — Stoch %K ${ind.stochK.toFixed(1)} oversold (exhaustion risk)` };
        return { side: "SELL", rationale: `EMA50<EMA200, price<EMA50 (${distFromEma50Atr.toFixed(2)}×ATR), RSI ${ind.rsi.toFixed(1)} OK, ${macdBear ? "MACD bearish" : "Stoch bearish"} · ${sessionTag}` };
      }
      return { side: "FLAT", rationale: "Multi-confirmation not aligned" };
    }
  }
}

// --------------------------- Main generator -------------------------------

export function generateTradeDecision(
  symbol: string,
  candles: Candle[],
  balance: number,
  params: GeneratorParams = DEFAULT_GENERATOR_PARAMS,
): TradeDecision | null {
  const profile = getPairProfile(symbol);
  if (!profile) return null;
  if (candles.length < Math.max(profile.emaSlow, 60) + 5) return null;

  const closes = candles.map((c) => c.close);
  const last = candles.length - 1;
  const price = closes[last];

  const e50 = ema(closes, profile.emaFast);
  const e100 = ema(closes, profile.emaMid);
  const e200 = ema(closes, profile.emaSlow);
  const rsiArr = rsi(closes, profile.rsiPeriod);
  const macdObj = macd(closes);
  const adxArr = adx(candles, 14);
  const atrArr = atr(candles, profile.atrPeriod);
  const bb = bollinger(closes, profile.bbPeriod, profile.bbStd);
  const stoch = stochastic(candles, profile.stochK, profile.stochD);

  const ind: IndicatorSnapshot = {
    ema50: e50[last] ?? price,
    ema100: e100[last] ?? price,
    ema200: e200[last] ?? price,
    rsi: rsiArr[last] ?? 50,
    macdHist: macdObj.hist[last] ?? 0,
    macdPrev: macdObj.hist[last - 1] ?? 0,
    adx: adxArr[last] ?? 0,
    atr: atrArr[last] ?? price * 0.001,
    bbUpper: bb.upper[last] ?? price,
    bbLower: bb.lower[last] ?? price,
    bbWidth: bb.width[last] ?? 0,
    stochK: stoch.k[last] ?? 50,
    stochD: stoch.d[last] ?? 50,
  };

  if (!isFinite(ind.atr) || ind.atr <= 0) return null;

  // --- Strategy playbook ---
  const pb = playbook({ profile, candles, price, ind });
  if (pb.side === "FLAT") {
    return buildDecision({
      profile, ind, price, balance, params,
      side: "FLAT",
      strategyRationale: pb.rationale,
      filters: [],
      blocked: pb.rationale,
    });
  }

  // --- Pre-trade filters ---
  const filters: FilterResult[] = [];
  const spread = estimatedSpread(symbol, price);
  const fSpread = spreadFilter(symbol, price, spread, profile.maxSpreadPct);
  const fVol = volatilityFilter(price, ind.atr, profile.minAtrPct, profile.maxAtrPct);
  // London/NY are preferred, but Asian session should be *stricter*, not a
  // hard block. The fx_multi_confirmation playbook above already raises ADX
  // and ATR requirements during Asian-only hours, so keep the filter passing
  // and record the session note instead of preventing all major-pair signals.
  const fSess = profile.strategy === "fx_multi_confirmation"
    ? { pass: true, reason: `Session ${activeSessions().primary} accepted (London/NY priority; Asian uses stricter confirmation)` }
    : sessionFilter(profile.preferredSessions);
  const fNews = newsFilter(symbol);
  filters.push(fSpread, fVol, fSess, fNews);

  const firstBlock = filters.find((f) => !f.pass);
  if (firstBlock) {
    return buildDecision({
      profile, ind, price, balance, params,
      side: pb.side,
      strategyRationale: pb.rationale,
      filters: filters.map((f, i) => ({ name: ["Spread", "Volatility", "Session", "News"][i], ...f })),
      blocked: firstBlock.reason,
    });
  }

  return buildDecision({
    profile, ind, price, balance, params,
    side: pb.side,
    strategyRationale: pb.rationale,
    filters: filters.map((f, i) => ({ name: ["Spread", "Volatility", "Session", "News"][i], ...f })),
    blocked: null,
  });
}

// Back-compat name for the previous Signals UI.
export function generateHighConfidenceSignal(
  symbol: string,
  candles: Candle[],
  balance: number,
  params: GeneratorParams = DEFAULT_GENERATOR_PARAMS,
): TradeDecision | null {
  const d = generateTradeDecision(symbol, candles, balance, params);
  if (!d || !d.accepted) return null;
  return d;
}

// --------------------------- Scoring & build ------------------------------

function buildDecision(args: {
  profile: PairProfile;
  ind: IndicatorSnapshot;
  price: number;
  balance: number;
  params: GeneratorParams;
  side: "BUY" | "SELL" | "FLAT";
  strategyRationale: string;
  filters: FilterSummary[];
  blocked: string | null;
}): TradeDecision {
  const { profile, ind, price, balance, params, side, strategyRationale, filters, blocked } = args;

  // Scoring
  const trendGapPct = Math.abs(ind.ema50 - ind.ema200) / price * 100;
  const trendScore = Math.min(25, 10 + trendGapPct * 40);
  const trendReason = `EMA50 ${ind.ema50.toFixed(5)} | EMA100 ${ind.ema100.toFixed(5)} | EMA200 ${ind.ema200.toFixed(5)} (gap ${trendGapPct.toFixed(2)}%)`;

  let momentumScore = 0;
  const macdAgrees = side === "BUY" ? ind.macdHist > 0 && ind.macdHist >= ind.macdPrev
                    : side === "SELL" ? ind.macdHist < 0 && ind.macdHist <= ind.macdPrev
                    : false;
  if (macdAgrees) momentumScore += 13;
  const rsiAligned = side === "BUY" ? ind.rsi >= 45 && ind.rsi <= 70
                    : side === "SELL" ? ind.rsi <= 55 && ind.rsi >= 30
                    : false;
  if (rsiAligned) momentumScore += 12;
  const momentumReason = `RSI ${ind.rsi.toFixed(1)} | MACD hist ${ind.macdHist.toFixed(5)} (prev ${ind.macdPrev.toFixed(5)}) | Stoch %K ${ind.stochK.toFixed(1)}/%D ${ind.stochD.toFixed(1)}`;

  const atrPct = (ind.atr / price) * 100;
  let volScore = 0;
  if (atrPct >= profile.minAtrPct && atrPct <= profile.maxAtrPct) volScore = 15;
  else if (atrPct > 0 && atrPct <= profile.maxAtrPct * 1.5) volScore = 8;
  const volReason = `ATR ${ind.atr.toFixed(5)} (${atrPct.toFixed(3)}% of price) | BB width ${ind.bbWidth.toFixed(2)}%`;

  let structureScore = 0;
  if (ind.adx >= profile.adxMin) structureScore += 12;
  else if (ind.adx >= profile.adxMin - 5) structureScore += 6;
  if (rsiAligned && macdAgrees) structureScore += 8;
  const structureReason = `ADX ${ind.adx.toFixed(1)} (min ${profile.adxMin}) | trend stack ${ind.ema50 > ind.ema200 ? "bull" : "bear"}`;

  // Trade plan
  const { stopLoss, takeProfit, slDistance, rr } = side === "FLAT"
    ? { stopLoss: 0, takeProfit: 0, slDistance: 0, rr: 0 }
    : computeLevels(side, price, ind.atr, profile.atrSlMult, profile.rrTarget);

  let rrScore = 0;
  if (rr >= 2.5) rrScore = 15;
  else if (rr >= 1.8) rrScore = 11;
  else if (rr >= 1.4) rrScore = 7;
  const rrReason = `R:R ${rr.toFixed(2)} (target ${profile.rrTarget}, SL dist ${slDistance.toFixed(5)})`;

  const breakdown: ConfidenceBreakdown = {
    trend: Math.round(trendScore),
    momentum: momentumScore,
    volatility: volScore,
    structure: structureScore,
    riskReward: rrScore,
    total: 0,
  };
  breakdown.total = breakdown.trend + breakdown.momentum + breakdown.volatility + breakdown.structure + breakdown.riskReward;

  const lot = side === "FLAT" ? 0 : positionSize(profile.symbol, balance, params.risk.riskPct, slDistance);
  const riskReason = `Risk ${params.risk.riskPct}% of $${balance.toFixed(2)} → lot ${lot} | BE +${params.risk.breakEvenAtR}R | trail +${params.risk.trailStartAtR}R`;

  const accepted = side !== "FLAT" && !blocked && breakdown.total >= params.minConfidence;
  const rejectionReason = blocked
    ? blocked
    : side === "FLAT"
      ? "Strategy did not trigger"
      : breakdown.total < params.minConfidence
        ? `Confidence ${breakdown.total}% < ${params.minConfidence}%`
        : undefined;

  const reasonLines = [
    `${profile.symbol} ${side} | ${profile.label} | Confidence ${breakdown.total}%`,
    `  Strategy   ${strategyRationale}`,
    `  Trend      [${breakdown.trend}/25]  ${trendReason}`,
    `  Momentum   [${breakdown.momentum}/25]  ${momentumReason}`,
    `  Volatility [${breakdown.volatility}/15]  ${volReason}`,
    `  Structure  [${breakdown.structure}/20]  ${structureReason}`,
    `  R:R        [${breakdown.riskReward}/15]  ${rrReason}`,
    `  Risk              ${riskReason}`,
    `  Filters    ${filters.map((f) => `${f.name}:${f.pass ? "OK" : "FAIL"}`).join("  ")}`,
    side !== "FLAT" ? `  Plan       Entry ${price.toFixed(5)} | SL ${stopLoss.toFixed(5)} | TP ${takeProfit.toFixed(5)}` : "",
    rejectionReason ? `  REJECTED   ${rejectionReason}` : `  ACCEPTED`,
  ].filter(Boolean).join("\n");

  return {
    symbol: profile.symbol,
    strategy: profile.label,
    strategyKind: profile.strategy,
    side,
    accepted,
    rejectionReason,
    confidence: breakdown.total,
    breakdown,
    entry: price,
    stopLoss,
    takeProfit,
    lot,
    riskPct: params.risk.riskPct,
    riskReward: rr,
    indicators: ind,
    filters,
    reasons: {
      trend: trendReason,
      momentum: momentumReason,
      volatility: volReason,
      structure: structureReason,
      riskReward: rrReason,
      risk: riskReason,
      strategy: strategyRationale,
    },
    reason: reasonLines,
    generatedAt: Date.now(),
  };
}
