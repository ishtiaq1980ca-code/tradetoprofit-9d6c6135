// Structure-invalidation early exit.
//
// The bot reasons about market structure BEFORE it enters (marketStructure.ts).
// This module extends the same reasoning to OPEN positions: if the structural
// thesis that justified the trade is broken, the position is closed at market
// instead of waiting for the full stop-loss distance to be consumed.
//
// This is deliberately independent of the trailing-stop system (0.5R/1.3R
// graduated chandelier) — that logic is untouched.
//
// Anti-noise rules (point 4 of the spec):
//   * only CLOSED candles are considered (the forming candle is dropped)
//   * a break must be a CLOSE beyond the level by >= 0.10 x ATR (not a wick)
//   * a pure structure break needs TWO consecutive confirmed closes beyond it
//   * a single confirmed close only counts when the short-term trend has also
//     flipped against the trade on the entry timeframe

import { atr as atrSeries, detectLevels, ema, type Candle } from "./indicators";
import { aggregate } from "./marketStructure";

export type InvalidationCheck = { name: string; pass: boolean; detail: string };

export type InvalidationResult = {
  invalidated: boolean;
  /** Human-readable reason, e.g. "BUY invalidated: broke below swing-low at 1.23450". */
  reason: string;
  /** The structural level that was measured. */
  level: number | null;
  levelKind: "swing-low" | "swing-high" | null;
  trendFlipped: boolean;
  checks: InvalidationCheck[];
};

/** Break must clear the level by this fraction of ATR to count as real. */
export const BREAK_ATR_BUFFER = 0.5;
/** Base (entry-timeframe) candles aggregated into one confirmation candle (M1 -> M5). */
export const CONFIRM_TF_FACTOR = 5;
/** A position must be at least this old before a structure exit may fire. */
export const MIN_HOLD_MS = 5 * 60_000;
/** EMA pair used for the short-term trend read on the entry timeframe. */
export const TREND_FAST = 50;
export const TREND_SLOW = 200;

function fmt(n: number) {
  return n.toFixed(5);
}

/**
 * Evaluate whether the structural thesis behind an open position is broken.
 *
 * @param side       trade direction
 * @param candles    entry-timeframe candles (newest last, forming candle included)
 * @param entryPrice fill price — used to pick the swing level that was intact at entry
 */
export function evaluateInvalidation(
  side: "BUY" | "SELL",
  candles: Candle[],
  entryPrice: number,
): InvalidationResult {
  const checks: InvalidationCheck[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  const none = (reason: string): InvalidationResult => ({
    invalidated: false, reason, level: null, levelKind: null, trendFlipped: false, checks,
  });

  if (candles.length < 300) return none(`Not enough history (${candles.length} bars) for a structure read`);

  // Confirmation runs on a higher timeframe (M1 -> M5) so a couple of noisy
  // 1-minute candles can never invalidate a trade. Closed candles only.
  const htf = aggregate(candles.slice(0, -1), CONFIRM_TF_FACTOR);
  if (htf.length < 60) return none(`Not enough ${CONFIRM_TF_FACTOR}x-timeframe bars (${htf.length}) for a structure read`);
  const c = htf;
  const closes = c.map((x) => x.close);
  const last = closes.length - 1;
  const price = closes[last];
  const buy = side === "BUY";

  const a = atrSeries(c, 14)[last] ?? 0;
  if (!(a > 0)) return none("ATR unavailable — structure check skipped");
  const buffer = a * BREAK_ATR_BUFFER;

  // The structural level that justified the trade: for a BUY the highest swing
  // low that sat below the entry (the higher-low the buy leaned on); mirrored
  // for a SELL.
  const { support, resistance } = detectLevels(c, 80, 3);
  const level = buy
    ? support.filter((l) => l < entryPrice).sort((x, y) => y - x)[0] ?? null
    : resistance.filter((l) => l > entryPrice).sort((x, y) => x - y)[0] ?? null;
  const levelKind: InvalidationResult["levelKind"] = buy ? "swing-low" : "swing-high";

  if (level == null) return none(`No ${levelKind} was intact at entry — nothing to invalidate`);

  const beyond = (i: number) => (buy ? closes[i] < level - buffer : closes[i] > level + buffer);
  const closedBeyond = beyond(last);
  const twoClosesBeyond = closedBeyond && beyond(last - 1);
  add(
    "Confirmed close beyond level",
    closedBeyond,
    `close ${fmt(price)} vs ${levelKind} ${fmt(level)} (buffer ${fmt(buffer)})`,
  );
  add("2 consecutive closes beyond", twoClosesBeyond, twoClosesBeyond ? "structure break confirmed" : "single bar only");

  // Short-term trend read on the entry timeframe.
  const eFast = ema(closes, TREND_FAST)[last];
  const eSlow = ema(closes, Math.min(TREND_SLOW, closes.length - 1))[last];
  const trendFlipped =
    Number.isFinite(eFast) && Number.isFinite(eSlow) && (buy ? eFast < eSlow : eFast > eSlow);
  add("Trend flip against trade", trendFlipped, `EMA${TREND_FAST} ${fmt(eFast ?? 0)} vs EMA${TREND_SLOW} ${fmt(eSlow ?? 0)}`);

  // Wick-only touches must never trigger an exit.
  const wickOnly =
    !closedBeyond && (buy ? Math.min(...c.slice(-2).map((x) => x.low)) < level : Math.max(...c.slice(-2).map((x) => x.high)) > level);
  if (wickOnly) return none(`Only a wick beyond ${levelKind} ${fmt(level)} — held on close, position kept`);

  const structuralBreak = twoClosesBeyond;
  const flipBreak = closedBeyond && trendFlipped;

  if (!structuralBreak && !flipBreak) {
    return {
      invalidated: false,
      reason: `Structure intact: ${levelKind} ${fmt(level)} not broken on close${trendFlipped ? " (trend flipped but level held)" : ""}`,
      level, levelKind, trendFlipped, checks,
    };
  }

  const why = structuralBreak
    ? `broke ${buy ? "below" : "above"} ${levelKind} at ${fmt(level)} (two confirmed closes, last ${fmt(price)})`
    : `broke ${buy ? "below" : "above"} ${levelKind} at ${fmt(level)} on a confirmed close and the EMA${TREND_FAST}/${TREND_SLOW} trend flipped ${buy ? "bearish" : "bullish"}`;

  return {
    invalidated: true,
    reason: `${side} invalidated: ${why}`,
    level, levelKind, trendFlipped, checks,
  };
}
