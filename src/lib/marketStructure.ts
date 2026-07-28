// Market-structure helpers used by the signal generator.
//
// Goals:
//   1. Higher-timeframe (HTF) trend confirmation — never allow a BUY when
//      HTF EMA200 slopes down or price is below HTF EMA200 by a wide margin,
//      and mirror for SELL.
//   2. Swing structure — for BUY we require a higher-low (HL) or higher-high
//      (HH) in recent price action; for SELL a lower-high (LH) or lower-low
//      (LL). This prevents "sell into an uptrend" / "buy into a downtrend".

import { ema, detectLevels, type Candle } from "./indicators";

export type StructureResult = {
  pass: boolean;
  reason: string;
  htfTrend: "up" | "down" | "flat";
  swing: "HH+HL" | "LH+LL" | "mixed";
};

/** Aggregate candles into a higher-timeframe series (default 4x). */
export function aggregate(candles: Candle[], factor = 4): Candle[] {
  if (factor <= 1) return candles;
  const out: Candle[] = [];
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const slice = candles.slice(i, i + factor);
    out.push({
      time: slice[slice.length - 1].time,
      open: slice[0].open,
      high: Math.max(...slice.map((c) => c.high)),
      low: Math.min(...slice.map((c) => c.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((s, c) => s + (c.volume ?? 0), 0),
    });
  }
  return out;
}

/**
 * Evaluate whether the intended side is aligned with market structure.
 * Blocks counter-trend trades (sell in uptrend, buy in downtrend).
 */
export function evaluateStructure(
  side: "BUY" | "SELL",
  candles: Candle[],
): StructureResult {
  const htf = aggregate(candles, 4);
  const closes = htf.map((c) => c.close);
  const price = closes[closes.length - 1] ?? 0;
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const last = closes.length - 1;
  const htfE50 = e50[last] ?? price;
  const htfE200 = e200[last] ?? price;
  const htfE200Prev = e200[Math.max(0, last - 5)] ?? htfE200;
  const slope = htfE200 - htfE200Prev;

  let htfTrend: "up" | "down" | "flat" = "flat";
  if (htfE50 > htfE200 && slope >= 0 && price > htfE200) htfTrend = "up";
  else if (htfE50 < htfE200 && slope <= 0 && price < htfE200) htfTrend = "down";

  // Swing structure on the base timeframe.
  const { support, resistance } = detectLevels(candles, 80, 3);
  const highs = resistance.slice(-2);
  const lows = support.slice(-2);
  const HH = highs.length === 2 && highs[1] > highs[0];
  const LH = highs.length === 2 && highs[1] < highs[0];
  const HL = lows.length === 2 && lows[1] > lows[0];
  const LL = lows.length === 2 && lows[1] < lows[0];
  const swing: StructureResult["swing"] =
    HH || HL ? "HH+HL" : LH || LL ? "LH+LL" : "mixed";

  if (side === "BUY") {
    if (htfTrend === "down") {
      return { pass: false, reason: `HTF trend DOWN (EMA50<EMA200 & price<EMA200) — BUY blocked`, htfTrend, swing };
    }
    if (swing === "LH+LL") {
      return { pass: false, reason: `Structure LH+LL — BUY would be counter-trend`, htfTrend, swing };
    }
    return { pass: true, reason: `HTF ${htfTrend}, structure ${swing} — BUY aligned`, htfTrend, swing };
  }
  // SELL
  if (htfTrend === "up") {
    return { pass: false, reason: `HTF trend UP (EMA50>EMA200 & price>EMA200) — SELL blocked`, htfTrend, swing };
  }
  if (swing === "HH+HL") {
    return { pass: false, reason: `Structure HH+HL — SELL would be counter-trend`, htfTrend, swing };
  }
  return { pass: true, reason: `HTF ${htfTrend}, structure ${swing} — SELL aligned`, htfTrend, swing };
}
