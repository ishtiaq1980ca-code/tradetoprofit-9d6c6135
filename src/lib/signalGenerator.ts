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
import { getPairProfile, isGoldSymbol, normalizeSymbol, type PairProfile, type StrategyKind } from "./pairProfiles";
import {
  estimatedSpread, newsFilter, sessionFilter, spreadFilter, volatilityFilter,
  atrSpikeFilter, adxCeilingFilter, extensionFilter,
  type FilterResult,
} from "./tradeFilters";
import { computeLevels, positionSize, DEFAULT_RISK, type RiskParams } from "./riskEngine";
import { minStopDistance } from "./pairProfiles";
import { activeSessions } from "./sessions";
import { describeStructure, evaluateStructure, type StructureRead } from "./marketStructure";
import { patternKeys, type PatternContext } from "./strategyLearning";
import { strictEntryGate, type GateCheck } from "./entryGate";
import { computeTradeScore, MIN_TRADE_SCORE, type ScoreComponents } from "./qualityScore";
export { MIN_TRADE_SCORE } from "./qualityScore";

// Confidence gates: gold requires 85%, FX currencies 80%.
export const MIN_CONFIDENCE_GOLD = 85;
export const MIN_CONFIDENCE_FX = 80;
export const MIN_CONFIDENCE = MIN_CONFIDENCE_FX; // back-compat: lowest floor
export function minConfidenceFor(symbol: string): number {
  return isGoldSymbol(symbol) ? MIN_CONFIDENCE_GOLD : MIN_CONFIDENCE_FX;
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
  /** PHASE 10 §9 — 0..100 institutional trade quality score. */
  qualityScore: number;
  qualityBreakdown?: ScoreComponents;
  gateChecks?: GateCheck[];
  /** Full market-structure reasoning behind this decision (auditable). */
  structure?: StructureRead;
  /** Learning fingerprint of this setup. */
  patternContext?: PatternContext;
  patternKeys?: string[];
};

// Back-compat alias for the older Signals UI.
export type HighConfidenceSignal = TradeDecision;

export type GeneratorParams = {
  minConfidence: number;
  risk: RiskParams;
  /** Runtime context from the engine (duplicate / stop-loss cooldown). */
  context?: { duplicate?: boolean; recentStopCooldown?: boolean };
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
      // Built-in FX strategy — Detailed Forex Strategy Manual (PDF):
      //   H4 trend / H1 confirmation / M15 entry.
      //   EMA50 & EMA200 trend + ADX > 25, MACD cross required,
      //   BUY when RSI 55–65 in an up-trend pullback to EMA50,
      //   SELL when RSI 35–45 in a down-trend pullback to EMA50,
      //   ATR SL 1.5×, RR 1:2.
      const macdBull = ind.macdHist > 0 && ind.macdHist >= ind.macdPrev;
      const macdBear = ind.macdHist < 0 && ind.macdHist <= ind.macdPrev;
      const atrPct = (ind.atr / price) * 100;
      const atrActive = ind.atr > 0 && atrPct >= profile.minAtrPct;
      const notSideways = ind.adx >= profile.adxMin;
      if (!atrActive) return { side: "FLAT", rationale: "ATR inactive (volatility too low)" };
      if (!notSideways) return { side: "FLAT", rationale: `Sideways market (ADX ${ind.adx.toFixed(1)} < ${profile.adxMin})` };

      const sess = activeSessions();
      const inLondonOrNY = sess.active.includes("London") || sess.active.includes("New York");
      const distFromEmaFastAtr = Math.abs(price - ind.ema50) / Math.max(ind.atr, 1e-9);

      const trendUpFx = ind.ema50 > ind.ema200;
      const trendDnFx = ind.ema50 < ind.ema200;
      const sessionTag = inLondonOrNY
        ? (sess.active.includes("London") && sess.active.includes("New York") ? "London+NY overlap" : sess.active.includes("London") ? "London" : "New York")
        : (sess.active.length ? sess.active.join("+") : "off-session");
      const rsiBuyMin = profile.rsiBuyMin ?? 0;
      const rsiSellMax = profile.rsiSellMax ?? 100;
      const buyRsiOk = ind.rsi <= profile.rsiOverbought && ind.rsi >= rsiBuyMin;
      const sellRsiOk = ind.rsi >= profile.rsiOversold && ind.rsi <= rsiSellMax;
      if (trendUpFx && price > ind.ema50 && buyRsiOk && macdBull) {
        return { side: "BUY", rationale: `EMA50>EMA200, price>EMA50 (${distFromEmaFastAtr.toFixed(2)}×ATR), RSI ${ind.rsi.toFixed(1)} in [${rsiBuyMin},${profile.rsiOverbought}], MACD bullish, ADX ${ind.adx.toFixed(1)} ≥ ${profile.adxMin} · ${sessionTag}` };
      }
      if (trendDnFx && price < ind.ema50 && sellRsiOk && macdBear) {
        return { side: "SELL", rationale: `EMA50<EMA200, price<EMA50 (${distFromEmaFastAtr.toFixed(2)}×ATR), RSI ${ind.rsi.toFixed(1)} in [${profile.rsiOversold},${rsiSellMax}], MACD bearish, ADX ${ind.adx.toFixed(1)} ≥ ${profile.adxMin} · ${sessionTag}` };
      }
      return { side: "FLAT", rationale: "Manual not aligned (need trend + RSI momentum band + MACD)" };
    }


    case "gold_multi_confirmation": {
      // Dedicated gold playbook — trades around the clock, weights ATR
      // expansion and MACD/EMA alignment. Less strict on sessions than FX.
      const atrPct = (ind.atr / price) * 100;
      const atrActive = ind.atr > 0 && atrPct >= profile.minAtrPct;
      if (!atrActive) return { side: "FLAT", rationale: `Gold ATR inactive (${atrPct.toFixed(3)}% < ${profile.minAtrPct}%)` };
      if (ind.adx < profile.adxMin) return { side: "FLAT", rationale: `Gold sideways (ADX ${ind.adx.toFixed(1)} < ${profile.adxMin})` };

      const macdBull = ind.macdHist > 0 && ind.macdHist >= ind.macdPrev;
      const macdBear = ind.macdHist < 0 && ind.macdHist <= ind.macdPrev;
      const trendUpG = ind.ema50 > ind.ema200;
      const trendDnG = ind.ema50 < ind.ema200;
      // Anti-chase: gold moves fast — cap distance from EMA50 at 3×ATR.
      const distFromEma50Atr = Math.abs(price - ind.ema50) / Math.max(ind.atr, 1e-9);
      if (distFromEma50Atr > 3.0) {
        return { side: "FLAT", rationale: `Gold price ${distFromEma50Atr.toFixed(2)}×ATR from EMA50 — waiting for pullback` };
      }

      // Wider RSI band for gold (it stays "overbought" during trends).
      const buyRsiOk = ind.rsi >= 45 && ind.rsi <= 78;
      const sellRsiOk = ind.rsi >= 22 && ind.rsi <= 55;

      if (trendUpG && price > ind.ema50 && buyRsiOk && macdBull) {
        return { side: "BUY", rationale: `Gold: EMA50>EMA200, price>EMA50 (${distFromEma50Atr.toFixed(2)}×ATR), RSI ${ind.rsi.toFixed(1)}, MACD bullish, ATR ${atrPct.toFixed(2)}% active` };
      }
      if (trendDnG && price < ind.ema50 && sellRsiOk && macdBear) {
        return { side: "SELL", rationale: `Gold: EMA50<EMA200, price<EMA50 (${distFromEma50Atr.toFixed(2)}×ATR), RSI ${ind.rsi.toFixed(1)}, MACD bearish, ATR ${atrPct.toFixed(2)}% active` };
      }
      return { side: "FLAT", rationale: "Gold multi-confirmation not aligned" };
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
  if (!profile) {
    // SAFETY: never trade a symbol we cannot map to a profile — the SL/TP math
    // would fall back to defaults and can produce zero-distance stops.
    reportUnknownSymbol(symbol);
    return null;
  }
  if (profile.disabled) return null; // v3 §2: USDCHF & GBPJPY paused
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
  // Market-structure READ — computed for every evaluation, not only accepted
  // ones, so the decision log always shows what the bot believed the market
  // was doing and whether that read was correct in hindsight.
  const structure = describeStructure(candles, ind.atr);

  const pb = playbook({ profile, candles, price, ind });
  if (pb.side === "FLAT") {
    return buildDecision({
      profile, ind, price, balance, params,
      side: "FLAT",
      strategyRationale: pb.rationale,
      filters: [],
      blocked: pb.rationale,
      structure,
    });
  }

  const patternContext: PatternContext = {
    symbol: profile.symbol,
    side: pb.side,
    strategy: profile.strategy,
    session: structure.session,
    htfTrend: structure.htfTrend,
    swing: structure.swing,
    zone: structure.zone,
    volatility: structure.volatility,
    adx: ind.adx,
    atKeyLevel: structure.keyLevel != null,
  };

  // --- Pre-trade filters ---
  const filters: FilterResult[] = [];
  const spread = estimatedSpread(symbol, price);
  const fSpread = spreadFilter(symbol, price, spread, profile.maxSpreadPct);
  const fVol = volatilityFilter(price, ind.atr, profile.minAtrPct, profile.maxAtrPct);
  // v3 §5: regime filters (skip gold — has its own playbook).
  const isGold = profile.strategy === "gold_multi_confirmation";
  const fAtrSpike = isGold ? { pass: true, reason: "ATR spike: n/a (gold)" } : atrSpikeFilter(ind.atr, atrArr);
  const fAdxCeil = isGold ? { pass: true, reason: "ADX ceiling: n/a (gold)" } : adxCeilingFilter(ind.adx);
  const fExt = isGold ? { pass: true, reason: "Extension: n/a (gold)" } : extensionFilter(price, ind.ema200, ind.atr);
  const fSess = profile.strategy === "fx_multi_confirmation" || profile.strategy === "gold_multi_confirmation"
    ? { pass: true, reason: `Session ${activeSessions().primary} accepted (${profile.strategy === "gold_multi_confirmation" ? "gold 24h" : "London/NY priority"})` }
    : sessionFilter(profile.preferredSessions);
  const fNews = newsFilter(symbol);
  // Market structure guard — no counter-trend trades. Applied to BUY/SELL only.
  const struct = evaluateStructure(pb.side as "BUY" | "SELL", candles);
  const fStruct: FilterResult = { pass: struct.pass, reason: `Structure — ${struct.reason}` };
  // Learning hard-block — a pattern proven to lose is refused outright, no
  // matter how strong the rest of the setup scores.
  const lb = learningBlock(patternContext);
  const fLearn: FilterResult = {
    pass: !lb.blocked,
    reason: lb.blocked ? `Learning block — ${lb.reason}` : "Learning: no blocked pattern matched",
  };
  filters.push(fSpread, fVol, fAtrSpike, fAdxCeil, fExt, fSess, fNews, fStruct, fLearn);
  const filterNames = ["Spread", "Volatility", "ATR-Spike", "ADX-Ceiling", "Extension", "Session", "News", "Structure", "Learning"];

  // PHASE 10 §1 — Ultra-strict entry gate. EVERY confirmation must be TRUE.
  const gate = strictEntryGate({
    side: pb.side,
    price,
    profile,
    candles,
    ind: {
      ema50: ind.ema50, ema200: ind.ema200, rsi: ind.rsi,
      macdHist: ind.macdHist, macdPrev: ind.macdPrev, adx: ind.adx, atr: ind.atr,
    },
    spread: fSpread,
    session: fSess,
    news: fNews,
    structure: fStruct,
    duplicate: params.context?.duplicate,
    recentStopCooldown: params.context?.recentStopCooldown,
  });

  // PHASE 10 §9 — Trade quality score (0–100), gate at >= 90.
  const scored = computeTradeScore({
    side: pb.side,
    price,
    profile,
    candles,
    ema50: ind.ema50, ema200: ind.ema200, rsi: ind.rsi,
    macdHist: ind.macdHist, macdPrev: ind.macdPrev, adx: ind.adx, atr: ind.atr,
    spreadPct: (spread / price) * 100,
    structurePass: fStruct.pass,
    newsClear: fNews.pass,
    patternContext,
  });

  const allFilters = [
    ...filters.map((f, i) => ({ name: filterNames[i], ...f })),
    ...gate.checks.map((c) => ({ name: `Gate: ${c.name}`, pass: c.pass, reason: c.reason })),
    {
      name: "Trade quality score",
      pass: scored.score.total >= MIN_TRADE_SCORE,
      reason: `Score ${scored.score.total}/100 (min ${MIN_TRADE_SCORE}) — ${scored.notes.join(" | ")}`,
    },
  ];

  const firstBlock = filters.find((f) => !f.pass);
  const blocked = firstBlock
    ? firstBlock.reason
    : !gate.pass
      ? `Entry gate failed — ${gate.firstFailure}`
      : scored.score.total < MIN_TRADE_SCORE
        ? `Trade score ${scored.score.total}/100 < required ${MIN_TRADE_SCORE}`
        : null;

  return buildDecision({
    profile, ind, price, balance, params,
    side: pb.side,
    strategyRationale: pb.rationale,
    filters: allFilters,
    blocked,
    quality: scored.score,
    qualityNotes: scored.notes,
    gateChecks: gate.checks,
    structure,
    patternContext,
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

/** Symbols rejected because they resolve to no pair profile (for diagnostics). */
const unknownSeen = new Map<string, number>();
export function reportUnknownSymbol(symbol: string) {
  const key = `${symbol} → ${normalizeSymbol(symbol)}`;
  const n = (unknownSeen.get(key) ?? 0) + 1;
  unknownSeen.set(key, n);
  if (n === 1) {
    console.error(`[symbol-guard] Unknown symbol "${symbol}" (normalized "${normalizeSymbol(symbol)}") — no pair profile. Trade REFUSED.`);
  }
}
export function unknownSymbolReport(): Array<{ symbol: string; count: number }> {
  return [...unknownSeen.entries()].map(([symbol, count]) => ({ symbol, count }));
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
  quality?: ScoreComponents;
  qualityNotes?: string[];
  gateChecks?: GateCheck[];
  structure?: StructureRead;
  patternContext?: PatternContext;
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
  const rsiAligned = side === "BUY" ? ind.rsi <= profile.rsiOverbought
                    : side === "SELL" ? ind.rsi >= profile.rsiOversold
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

  // Trade plan — enforce v3 §4 minimum stop-loss floor per tier.
  let stopLoss = 0, takeProfit = 0, slDistance = 0, rr = 0;
  if (side !== "FLAT") {
    const minStop = minStopDistance(profile.symbol, profile.tier);
    const effectiveAtrSlMult = minStop > 0 && ind.atr > 0
      ? Math.max(profile.atrSlMult, minStop / ind.atr)
      : profile.atrSlMult;
    const lv = computeLevels(side, price, ind.atr, effectiveAtrSlMult, profile.rrTarget);
    stopLoss = lv.stopLoss; takeProfit = lv.takeProfit; slDistance = lv.slDistance; rr = lv.rr;
  }

  let rrScore = 0;
  const targetRr = Math.max(0.1, profile.rrTarget);
  if (rr >= targetRr * 0.98) rrScore = 15;
  else if (rr >= targetRr * 0.85) rrScore = 11;
  else if (rr >= targetRr * 0.7) rrScore = 7;
  const rrReason = `R:R ${rr.toFixed(2)} (target ${profile.rrTarget}, SL dist ${slDistance.toFixed(5)}, tier ${profile.tier})`;

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

  const qualityTotal = args.quality?.total ?? 0;
  const scoreOk = side === "FLAT" ? false : qualityTotal >= MIN_TRADE_SCORE;
  const accepted = side !== "FLAT" && !blocked && scoreOk && breakdown.total >= params.minConfidence;
  const rejectionReason = blocked
    ? blocked
    : side === "FLAT"
      ? "Strategy did not trigger"
      : !scoreOk
        ? `Trade score ${qualityTotal}/100 < required ${MIN_TRADE_SCORE}`
        : breakdown.total < params.minConfidence
          ? `Confidence ${breakdown.total}% < ${params.minConfidence}%`
          : undefined;

  const reasonLines = [
    `${profile.symbol} ${side} | ${profile.label} | Confidence ${breakdown.total}% | Trade Score ${qualityTotal}/100`,
    `  Strategy   ${strategyRationale}`,
    args.structure ? `  STRUCTURE  ${args.structure.narrative}` : "",
    args.structure
      ? `  Zone       Read=${args.structure.zone.toUpperCase()} | H1 ${args.structure.htfTrend} | swing ${args.structure.swing} | ${args.structure.keyLevel != null ? `key ${args.structure.keyLevelKind} ${args.structure.keyLevel.toFixed(5)} (${args.structure.keyLevelDistanceAtr?.toFixed(2)}×ATR)` : "no key level in range"} | range pos ${(args.structure.rangePosition * 100).toFixed(0)}%`
      : "",
    args.quality?.learning !== undefined && args.quality.learning !== 0
      ? `  Learning   ${args.quality.learning > 0 ? "+" : ""}${args.quality.learning.toFixed(2)} pts from past trade reviews for this pattern`
      : "",
    `  Trend      [${breakdown.trend}/25]  ${trendReason}`,
    `  Momentum   [${breakdown.momentum}/25]  ${momentumReason}`,
    `  Volatility [${breakdown.volatility}/15]  ${volReason}`,
    `  Structure  [${breakdown.structure}/20]  ${structureReason}`,
    `  R:R        [${breakdown.riskReward}/15]  ${rrReason}`,
    `  Risk              ${riskReason}`,
    args.qualityNotes?.length ? `  Score      ${args.qualityNotes.join(" | ")}` : "",
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
    qualityScore: qualityTotal,
    qualityBreakdown: args.quality,
    gateChecks: args.gateChecks,
    structure: args.structure,
    patternContext: args.patternContext,
    patternKeys: args.patternContext ? patternKeys(args.patternContext) : undefined,
  };
}
