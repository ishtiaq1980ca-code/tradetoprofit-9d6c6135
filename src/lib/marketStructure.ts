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

// ---------------------------------------------------------------------------
// PHASE 10 §2 / §6 — Confirmed reversal detection for EARLY EXITS only.
//
// A single candle never triggers an exit. ALL of the following must be true:
//   1. Trend flip (EMA50 vs EMA200 on the entry timeframe)
//   2. Break of Structure (BOS) against the position
//   3. Close beyond the broken structure level
//   4. At least 2 consecutive confirmed candles in the reversal direction
//   5. RSI confirms the reversal
//   6. MACD confirms the reversal
//   7. ATR confirms real momentum (reversal leg >= 0.8 × ATR)
// ---------------------------------------------------------------------------

import { atr as atrSeries, macd as macdSeries, rsi as rsiSeries } from "./indicators";

export type ReversalResult = {
  confirmed: boolean;
  reason: string;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
};

export function evaluateReversal(
  side: "BUY" | "SELL",
  candles: Candle[],
): ReversalResult {
  const checks: ReversalResult["checks"] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  if (candles.length < 80) {
    return { confirmed: false, reason: "Not enough history for reversal confirmation", checks };
  }
  // Ignore the still-forming candle.
  const c = candles.slice(0, -1);
  const closes = c.map((x) => x.close);
  const last = closes.length - 1;
  const price = closes[last];
  const buy = side === "BUY";

  const e50 = ema(closes, 50)[last];
  const e200 = ema(closes, Math.min(200, closes.length - 1))[last];
  const flipped = buy ? e50 < e200 : e50 > e200;
  add("Trend flip", flipped, `EMA50 ${e50?.toFixed(5)} vs EMA200 ${e200?.toFixed(5)}`);

  // BOS: most recent swing broken against the position.
  const { support, resistance } = detectLevels(c, 80, 3);
  const level = buy ? support[support.length - 1] : resistance[resistance.length - 1];
  const bos = level !== undefined && (buy ? price < level : price > level);
  add("Break of structure", !!bos, level === undefined ? "no swing level" : `price ${price.toFixed(5)} vs level ${level.toFixed(5)}`);

  // Close beyond structure (not just a wick).
  const closeBeyond = level !== undefined && (buy ? c[last].close < level : c[last].close > level);
  add("Close beyond structure", !!closeBeyond, closeBeyond ? "candle closed past the level" : "only wick beyond level");

  // Two consecutive confirmed candles in the reversal direction.
  const twoCandles = buy
    ? c[last].close < c[last].open && c[last - 1].close < c[last - 1].open
    : c[last].close > c[last].open && c[last - 1].close > c[last - 1].open;
  add("2-candle confirmation", twoCandles, twoCandles ? "two consecutive reversal candles" : "single-candle move ignored");

  const r = rsiSeries(closes, 14)[last] ?? 50;
  const rsiOk = buy ? r < 45 : r > 55;
  add("RSI reversal", rsiOk, `RSI ${r.toFixed(1)}`);

  const m = macdSeries(closes);
  const h = m.hist[last] ?? 0;
  const hp = m.hist[last - 1] ?? 0;
  const macdOk = buy ? h < 0 && h <= hp : h > 0 && h >= hp;
  add("MACD reversal", macdOk, `hist ${h.toFixed(5)} (prev ${hp.toFixed(5)})`);

  const a = atrSeries(c, 14)[last] ?? 0;
  const leg = Math.abs(c[last].close - c[last - 2].close);
  const atrOk = a > 0 && leg >= a * 0.8;
  add("ATR momentum", atrOk, `3-bar move ${leg.toFixed(5)} vs ATR ${a.toFixed(5)}`);

  const confirmed = checks.every((k) => k.pass);
  return {
    confirmed,
    reason: confirmed
      ? `Confirmed reversal against ${side}: ${checks.map((k) => k.name).join(" + ")}`
      : `Not a confirmed reversal (${checks.filter((k) => !k.pass).map((k) => k.name).join(", ")} failed) — pullback ignored`,
    checks,
  };
}
