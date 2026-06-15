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
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 14,
  adxMin: 12,
  atrPeriod: 14,
  atrSlMult: 2.5,
  atrTpMult: 0.7,
  minConfidence: 40,
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

  const reasons: string[] = [];
  let confidence = 25; // baseline — we always pick a side from trend

  // 1. Trend (primary direction)
  const trendBull = eFast[last] >= eSlow[last];
  const side: Signal["side"] = trendBull ? "BUY" : "SELL";
  reasons.push(`Trend ${trendBull ? "bullish" : "bearish"}: EMA${params.emaFast} ${trendBull ? "≥" : "<"} EMA${params.emaSlow}`);

  // 2. Momentum agreement
  const rsiVal = r[last] ?? 50;
  const macdHist = m.hist[last] ?? 0;
  const macdPrev = m.hist[last - 1] ?? 0;
  const momentumOk = trendBull ? macdHist >= macdPrev && rsiVal >= 45 : macdHist <= macdPrev && rsiVal <= 55;
  if (momentumOk) { confidence += 20; reasons.push(`RSI ${rsiVal.toFixed(0)}, MACD ${macdHist >= macdPrev ? "rising" : "falling"}`); }

  // 3. ADX trend strength
  const adxVal = a[last] ?? 0;
  const adxOk = adxVal >= params.adxMin;
  if (adxOk) { confidence += 20; reasons.push(`ADX ${adxVal.toFixed(1)} ≥ ${params.adxMin}`); }

  // 4. Volatility sanity
  const atrVal = at[last] ?? price * 0.001;
  const volatilityOk = atrVal > 0 && atrVal < price * 0.05;
  if (volatilityOk) { confidence += 15; reasons.push(`ATR ${atrVal.toFixed(4)} normal`); }

  // R/R favors many small wins: small TP, wide SL → high hit-rate
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
    filters: { trend: true, momentum: momentumOk, structure: adxOk, volatility: volatilityOk },
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
