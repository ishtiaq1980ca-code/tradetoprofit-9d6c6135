// Multi-filter strategy engine. Returns a trade signal only when trend,
// momentum, structure, and risk/reward all agree above the confidence floor.

import { adx, atr, type Candle, detectLevels, ema, macd, rsi } from "./indicators";

export type StrategyParams = {
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  adxMin: number;
  atrPeriod: number;
  atrSlMult: number;
  atrTpMult: number;
  minConfidence: number;
  riskPct: number;
};

export type Signal = {
  symbol: string;
  side: "BUY" | "SELL" | "FLAT";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  riskReward: number;
  reasons: string[];
  filters: { trend: boolean; momentum: boolean; structure: boolean; volatility: boolean };
};

export const DEFAULT_PARAMS: StrategyParams = {
  emaFast: 20,
  emaSlow: 50,
  rsiPeriod: 14,
  adxMin: 18,
  atrPeriod: 14,
  atrSlMult: 1.5,
  atrTpMult: 2.5,
  minConfidence: 50,
  riskPct: 1,
};

export function analyze(symbol: string, candles: Candle[], params: StrategyParams = DEFAULT_PARAMS): Signal {
  const closes = candles.map((c) => c.close);
  const last = candles.length - 1;
  const price = closes[last];

  const eFast = ema(closes, params.emaFast);
  const eSlow = ema(closes, params.emaSlow);
  const r = rsi(closes, params.rsiPeriod);
  const m = macd(closes);
  const a = adx(candles, 14);
  const at = atr(candles, params.atrPeriod);
  const levels = detectLevels(candles);

  const reasons: string[] = [];
  let confidence = 0;

  // 1. Trend
  const trendBull = eFast[last] > eSlow[last];
  const trendBear = eFast[last] < eSlow[last];
  const structureBull = candles[last].low > candles[last - 2]?.low && candles[last].high > candles[last - 2]?.high;
  const structureBear = candles[last].high < candles[last - 2]?.high && candles[last].low < candles[last - 2]?.low;
  const trendOk = (trendBull && structureBull) || (trendBear && structureBear);
  if (trendOk) { confidence += 25; reasons.push(`Trend ${trendBull ? "bullish" : "bearish"}: EMA${params.emaFast} ${trendBull ? "above" : "below"} EMA${params.emaSlow}`); }

  // 2. Momentum
  const rsiVal = r[last];
  const macdBull = m.hist[last] > 0 && m.hist[last] > m.hist[last - 1];
  const macdBear = m.hist[last] < 0 && m.hist[last] < m.hist[last - 1];
  const adxVal = a[last] ?? 0;
  const rsiBuyOk = rsiVal >= 40 && rsiVal <= 65;
  const rsiSellOk = rsiVal >= 35 && rsiVal <= 60;
  const momentumBull = adxVal > params.adxMin && macdBull && rsiBuyOk;
  const momentumBear = adxVal > params.adxMin && macdBear && rsiSellOk;
  const momentumOk = (trendBull && momentumBull) || (trendBear && momentumBear);
  if (momentumOk) { confidence += 25; reasons.push(`ADX ${adxVal.toFixed(1)} > ${params.adxMin}, RSI ${rsiVal.toFixed(1)}, MACD ${macdBull ? "rising" : "falling"}`); }

  // 3. Structure (S/R distance)
  const atrVal = at[last] ?? price * 0.001;
  const nearestRes = Math.min(...levels.resistance.map((l) => Math.abs(l - price)));
  const nearestSup = Math.min(...levels.support.map((l) => Math.abs(l - price)));
  const structureOk = trendBull ? nearestRes > atrVal * 1.5 : nearestSup > atrVal * 1.5;
  if (structureOk) { confidence += 25; reasons.push("Clear of nearest S/R by >1.5 ATR"); }

  // 4. Volatility sanity
  const volatilityOk = atrVal > 0 && atrVal < price * 0.05;
  if (volatilityOk) { confidence += 25; reasons.push(`ATR ${atrVal.toFixed(4)} within normal range`); }

  const side: Signal["side"] = trendBull && momentumBull ? "BUY" : trendBear && momentumBear ? "SELL" : "FLAT";

  const sl = side === "BUY" ? price - atrVal * params.atrSlMult : price + atrVal * params.atrSlMult;
  const tp = side === "BUY" ? price + atrVal * params.atrTpMult : price - atrVal * params.atrTpMult;
  const rr = Math.abs(tp - price) / Math.abs(price - sl || 1);

  return {
    symbol,
    side: confidence >= params.minConfidence ? side : "FLAT",
    entry: price,
    stopLoss: sl,
    takeProfit: tp,
    confidence,
    riskReward: rr,
    reasons,
    filters: { trend: trendOk, momentum: momentumOk, structure: structureOk, volatility: volatilityOk },
  };
}

/** Risk-based position sizing in lots. Approximates value-per-pip for FX & XAUUSD. */
export function calculateLot(symbol: string, balance: number, riskPct: number, slDistance: number): number {
  const riskAmount = (balance * riskPct) / 100;
  // Value per 1.0 lot per 1.0 price unit:
  // - FX majors (USD quote): ~$100,000 notional → $10 per pip (0.0001)
  // - JPY pairs: pip = 0.01 → ~$10 per pip
  // - XAUUSD: 1 lot = 100 oz → $100 per $1 move
  const isJpy = symbol.endsWith("JPY");
  const isGold = symbol === "XAUUSD";
  const valuePerUnit = isGold ? 100 : isJpy ? 1000 : 100000; // $ per 1.0 price-unit per 1.0 lot
  const lot = riskAmount / (slDistance * valuePerUnit);
  return Math.max(0.01, Math.round(lot * 100) / 100);
}
