// Multi-filter strategy engine. Returns a trade signal only when trend,
// momentum, structure, and risk/reward all agree above the confidence floor.

import { adx, atr, type Candle, ema, macd, rsi } from "./indicators";

export type StrategyParams = {
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiBuyMax: number;   // do not BUY if RSI above this (overbought guard)
  rsiSellMin: number;  // do not SELL if RSI below this (oversold guard)
  useMacd: boolean;
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
  blockers: string[];
  filters: { trend: boolean; momentum: boolean; structure: boolean; volatility: boolean };
};

export const DEFAULT_PARAMS: StrategyParams = {
  emaFast: 9,
  emaSlow: 21,
  rsiPeriod: 14,
  rsiBuyMax: 75,
  rsiSellMin: 25,
  useMacd: true,
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
  const blockers: string[] = [];
  let confidence = 25;

  const trendBull = eFast[last] >= eSlow[last];
  const side: Signal["side"] = trendBull ? "BUY" : "SELL";
  reasons.push(`Trend ${trendBull ? "bullish" : "bearish"}: EMA${params.emaFast} ${trendBull ? "≥" : "<"} EMA${params.emaSlow}`);

  const rsiVal = r[last] ?? 50;
  const macdHist = m.hist[last] ?? 0;
  const macdPrev = m.hist[last - 1] ?? 0;
  const macdAgrees = trendBull ? macdHist >= macdPrev : macdHist <= macdPrev;
  const rsiAgrees = trendBull ? rsiVal >= 45 : rsiVal <= 55;
  if (rsiAgrees) { confidence += 10; reasons.push(`RSI ${rsiVal.toFixed(0)} agrees`); }
  else blockers.push(`RSI ${rsiVal.toFixed(0)} not aligned with ${side}`);
  if (params.useMacd) {
    if (macdAgrees) { confidence += 10; reasons.push(`MACD ${macdHist >= macdPrev ? "rising" : "falling"}`); }
    else blockers.push("MACD not confirming");
  } else { confidence += 10; }

  let extremeBlocked = false;
  if (trendBull && rsiVal > params.rsiBuyMax) { blockers.push(`RSI ${rsiVal.toFixed(0)} overbought (>${params.rsiBuyMax})`); extremeBlocked = true; }
  if (!trendBull && rsiVal < params.rsiSellMin) { blockers.push(`RSI ${rsiVal.toFixed(0)} oversold (<${params.rsiSellMin})`); extremeBlocked = true; }

  const adxVal = a[last] ?? 0;
  const adxOk = adxVal >= params.adxMin;
  if (adxOk) { confidence += 20; reasons.push(`ADX ${adxVal.toFixed(1)} ≥ ${params.adxMin}`); }
  else blockers.push(`ADX ${adxVal.toFixed(1)} weak (<${params.adxMin})`);

  const atrVal = at[last] ?? price * 0.001;
  const volatilityOk = atrVal > 0 && atrVal < price * 0.05;
  if (volatilityOk) { confidence += 15; reasons.push(`ATR ${atrVal.toFixed(4)} normal`); }
  else blockers.push("Volatility out of range");

  const sl = side === "BUY" ? price - atrVal * params.atrSlMult : price + atrVal * params.atrSlMult;
  const tp = side === "BUY" ? price + atrVal * params.atrTpMult : price - atrVal * params.atrTpMult;
  const rr = Math.abs(tp - price) / Math.abs(price - sl || 1);

  return {
    symbol,
    side: !extremeBlocked && confidence >= params.minConfidence ? side : "FLAT",
    entry: price,
    stopLoss: sl,
    takeProfit: tp,
    confidence,
    riskReward: rr,
    reasons,
    blockers,
    filters: { trend: true, momentum: rsiAgrees && (!params.useMacd || macdAgrees), structure: adxOk, volatility: volatilityOk },
  };
}

/** Risk-based position sizing in lots. */
export function calculateLot(symbol: string, balance: number, riskPct: number, slDistance: number): number {
  const riskAmount = (balance * riskPct) / 100;
  const isJpy = symbol.endsWith("JPY");
  const isGold = symbol === "XAUUSD";
  const valuePerUnit = isGold ? 100 : isJpy ? 1000 : 100000;
  const lot = riskAmount / (slDistance * valuePerUnit);
  return Math.max(0.02, Math.round(lot * 100) / 100);
}
