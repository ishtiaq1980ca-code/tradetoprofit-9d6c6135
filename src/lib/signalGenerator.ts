// High-confidence signal generator.
// Wraps the existing strategy/indicator stack and only emits a trade when the
// composite confidence score is >= MIN_CONFIDENCE (default 75%). Each emitted
// signal carries a full, human-readable breakdown of the reasoning across
// trend, momentum, volatility, structure, risk/reward and risk sizing.
//
// IMPORTANT: this module does NOT touch the MT5 bridge, order execution,
// or any API route. It only produces signals; the existing execution layer
// remains the single source of truth for sending orders.

import { adx, atr, detectLevels, ema, macd, rsi, type Candle } from "./indicators";

export const MIN_CONFIDENCE = 75;

export type ConfidenceBreakdown = {
  trend: number;       // 0..25
  momentum: number;    // 0..25
  volatility: number;  // 0..15
  structure: number;   // 0..20
  riskReward: number;  // 0..15
  total: number;       // 0..100
};

export type HighConfidenceSignal = {
  symbol: string;
  side: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lot: number;
  riskPct: number;
  riskReward: number;
  confidence: number;            // 0..100
  breakdown: ConfidenceBreakdown;
  reason: string;                // multi-line full reasoning
  reasons: {
    trend: string;
    momentum: string;
    volatility: string;
    structure: string;
    riskReward: string;
    risk: string;
  };
  generatedAt: number;
};

export type GeneratorParams = {
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  atrPeriod: number;
  atrSlMult: number;
  atrTpMult: number;
  adxMin: number;
  minConfidence: number;
  riskPct: number;
  minRiskReward: number;
};

export const DEFAULT_GENERATOR_PARAMS: GeneratorParams = {
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 14,
  atrPeriod: 14,
  atrSlMult: 2.0,
  atrTpMult: 3.0,   // skewed for >=1.5 RR by default
  adxMin: 20,
  minConfidence: MIN_CONFIDENCE,
  riskPct: 1,
  minRiskReward: 1.5,
};

function lotSize(symbol: string, balance: number, riskPct: number, slDistance: number): number {
  if (slDistance <= 0 || !isFinite(slDistance)) return 0.01;
  const riskAmount = (balance * riskPct) / 100;
  const isJpy = symbol.endsWith("JPY");
  const isGold = symbol === "XAUUSD" || symbol === "GOLD";
  const valuePerUnit = isGold ? 100 : isJpy ? 1000 : 100000;
  const lot = riskAmount / (slDistance * valuePerUnit);
  return Math.max(0.01, Math.round(lot * 100) / 100);
}

/**
 * Generate a high-confidence signal for a symbol, or null if confidence
 * is below the threshold (default 75%).
 */
export function generateHighConfidenceSignal(
  symbol: string,
  candles: Candle[],
  balance: number,
  params: GeneratorParams = DEFAULT_GENERATOR_PARAMS,
): HighConfidenceSignal | null {
  if (candles.length < Math.max(params.emaSlow, params.atrPeriod, params.rsiPeriod) + 5) {
    return null;
  }

  const closes = candles.map((c) => c.close);
  const last = candles.length - 1;
  const price = closes[last];

  const eFast = ema(closes, params.emaFast);
  const eSlow = ema(closes, params.emaSlow);
  const rsiArr = rsi(closes, params.rsiPeriod);
  const macdObj = macd(closes);
  const adxArr = adx(candles, 14);
  const atrArr = atr(candles, params.atrPeriod);
  const levels = detectLevels(candles, 60, 4);

  const fast = eFast[last];
  const slow = eSlow[last];
  const rsiVal = rsiArr[last] ?? 50;
  const macdHist = macdObj.hist[last] ?? 0;
  const macdPrev = macdObj.hist[last - 1] ?? 0;
  const adxVal = adxArr[last] ?? 0;
  const atrVal = atrArr[last] ?? price * 0.001;

  if (!isFinite(fast) || !isFinite(slow) || !isFinite(atrVal) || atrVal <= 0) return null;

  // --- Direction from trend ---
  const trendBull = fast >= slow;
  const side: "BUY" | "SELL" = trendBull ? "BUY" : "SELL";

  // --- 1. Trend score (0..25) ---
  const trendGapPct = Math.abs(fast - slow) / price * 100;
  const trendScore = Math.min(25, 10 + trendGapPct * 50); // small gap still scores; big gap saturates
  const trendReason =
    `${trendBull ? "Bullish" : "Bearish"} trend - EMA${params.emaFast} (${fast.toFixed(5)}) ` +
    `${trendBull ? ">=" : "<"} EMA${params.emaSlow} (${slow.toFixed(5)}), gap ${trendGapPct.toFixed(2)}%`;

  // --- 2. Momentum score (0..25): RSI alignment + MACD histogram direction ---
  let momentumScore = 0;
  const rsiAligned = trendBull ? rsiVal >= 50 && rsiVal <= 70 : rsiVal <= 50 && rsiVal >= 30;
  const rsiExtreme = (trendBull && rsiVal > 75) || (!trendBull && rsiVal < 25);
  if (rsiAligned) momentumScore += 12;
  else if (!rsiExtreme) momentumScore += 5;
  const macdAgrees = trendBull ? macdHist > 0 && macdHist >= macdPrev : macdHist < 0 && macdHist <= macdPrev;
  if (macdAgrees) momentumScore += 13;
  else if ((trendBull && macdHist >= macdPrev) || (!trendBull && macdHist <= macdPrev)) momentumScore += 6;
  const momentumReason =
    `RSI ${rsiVal.toFixed(1)} ${rsiAligned ? "aligned" : rsiExtreme ? "EXTREME" : "neutral"}, ` +
    `MACD hist ${macdHist.toFixed(5)} ${macdAgrees ? "confirms" : "weak"} (prev ${macdPrev.toFixed(5)})`;

  // --- 3. Volatility score (0..15): ATR in healthy band ---
  const atrPct = (atrVal / price) * 100;
  let volScore = 0;
  if (atrPct >= 0.05 && atrPct <= 2.5) volScore = 15;
  else if (atrPct > 0 && atrPct <= 4) volScore = 8;
  const volReason = `ATR ${atrVal.toFixed(5)} (${atrPct.toFixed(2)}% of price) - ${volScore === 15 ? "healthy" : volScore === 8 ? "elevated" : "out of band"}`;

  // --- 4. Structure score (0..20): ADX trend strength + S/R clearance ---
  let structureScore = 0;
  if (adxVal >= params.adxMin) structureScore += 12;
  else if (adxVal >= params.adxMin - 5) structureScore += 6;
  const nearestRes = levels.resistance.filter((l) => l > price).sort((a, b) => a - b)[0];
  const nearestSup = levels.support.filter((l) => l < price).sort((a, b) => b - a)[0];
  const clearance =
    side === "BUY"
      ? nearestRes ? (nearestRes - price) / atrVal : 3
      : nearestSup ? (price - nearestSup) / atrVal : 3;
  if (clearance >= 2) structureScore += 8;
  else if (clearance >= 1) structureScore += 4;
  const structureReason =
    `ADX ${adxVal.toFixed(1)} (min ${params.adxMin}); ` +
    `${side === "BUY" ? "resistance" : "support"} ${(side === "BUY" ? nearestRes : nearestSup)?.toFixed(5) ?? "n/a"} ` +
    `= ${clearance.toFixed(1)}x ATR away`;

  // --- Build entry / SL / TP from ATR ---
  const slDist = atrVal * params.atrSlMult;
  const tpDist = atrVal * params.atrTpMult;
  const stopLoss = side === "BUY" ? price - slDist : price + slDist;
  const takeProfit = side === "BUY" ? price + tpDist : price - tpDist;
  const riskReward = tpDist / slDist;

  // --- 5. Risk/Reward score (0..15) ---
  let rrScore = 0;
  if (riskReward >= 2.5) rrScore = 15;
  else if (riskReward >= params.minRiskReward) rrScore = 10;
  else if (riskReward >= 1) rrScore = 4;
  const rrReason = `R:R ${riskReward.toFixed(2)} (SL ${slDist.toFixed(5)} / TP ${tpDist.toFixed(5)}, min ${params.minRiskReward})`;

  const breakdown: ConfidenceBreakdown = {
    trend: Math.round(trendScore),
    momentum: momentumScore,
    volatility: volScore,
    structure: structureScore,
    riskReward: rrScore,
    total: 0,
  };
  breakdown.total = breakdown.trend + breakdown.momentum + breakdown.volatility + breakdown.structure + breakdown.riskReward;

  // Hard rejects regardless of total
  if (rsiExtreme) return null;
  if (riskReward < params.minRiskReward) return null;
  if (breakdown.total < params.minConfidence) return null;

  const lot = lotSize(symbol, balance, params.riskPct, slDist);
  const riskReason = `Risk ${params.riskPct}% of $${balance.toFixed(2)} -> lot ${lot}, SL distance ${slDist.toFixed(5)}`;

  const reason = [
    `${symbol} ${side} @ ${price.toFixed(5)} | Confidence ${breakdown.total}% (>= ${params.minConfidence}%)`,
    `  Trend     [${breakdown.trend}/25]  ${trendReason}`,
    `  Momentum  [${breakdown.momentum}/25]  ${momentumReason}`,
    `  Volatility[${breakdown.volatility}/15]  ${volReason}`,
    `  Structure [${breakdown.structure}/20]  ${structureReason}`,
    `  R:R       [${breakdown.riskReward}/15]  ${rrReason}`,
    `  Risk             ${riskReason}`,
    `  Entry ${price.toFixed(5)} | SL ${stopLoss.toFixed(5)} | TP ${takeProfit.toFixed(5)}`,
  ].join("\n");

  return {
    symbol,
    side,
    entry: price,
    stopLoss,
    takeProfit,
    lot,
    riskPct: params.riskPct,
    riskReward,
    confidence: breakdown.total,
    breakdown,
    reason,
    reasons: {
      trend: trendReason,
      momentum: momentumReason,
      volatility: volReason,
      structure: structureReason,
      riskReward: rrReason,
      risk: riskReason,
    },
    generatedAt: Date.now(),
  };
}
