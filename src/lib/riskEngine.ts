import { isJpyQuoted, isGoldSymbol } from "./pairProfiles";
// Risk engine: position sizing, ATR stops, RR targets, break-even and trailing
// rules, and daily-loss circuit breaker math.
//
// Trail / break-even physical state mutation happens inside paperTrading.tickAll
// for paper trades; the MT5 bridge handles it for live trades. This module is
// the single source of truth for the *parameters* both layers should follow.

export type RiskParams = {
  riskPct: number;            // % of balance risked per trade
  breakEvenAtR: number;       // move SL to entry when price hits +N×R
  trailStartAtR: number;      // start trailing after +N×R
  trailStepR: number;         // trail distance in R once active
  maxDailyLossPct: number;    // halt for the day when reached
  maxWeeklyLossPct: number;   // halt for the week when reached (v3 §8)
  maxMonthlyLossPct: number;  // halt for the month when reached (v3 §8)
};

// v3 §8: per-trade risk 1%, daily 3%, weekly 8%, monthly 12%.
// Tier-specific BE/trailing come from pairProfiles.tierExitParams — these
// are only fallbacks used by paper-trade tick management when a tier is
// unavailable (e.g. gold, which keeps its existing playbook).
export const DEFAULT_RISK: RiskParams = {
  riskPct: 1,
  breakEvenAtR: 0.5,
  trailStartAtR: 1.3,   // chandelier trailing engages at +1.3R
  trailStepR: 3.0,      // trail distance = ATR × 3.0 (chandelier)
  maxDailyLossPct: 3,
  maxWeeklyLossPct: 8,
  maxMonthlyLossPct: 12,
};

// PHASE 10 §3 / §4 — Intelligent break-even + elite step trailing (USD based).
//   Profit < $1.00            → no SL movement at all
//   Profit ≥ $1.00            → SL = entry (break-even), nothing else
//   Profit ≥ $2.00            → SL = +$1, then +$3 → +$2, +$4 → +$3, ...
// SL never moves backwards.
export const BREAK_EVEN_USD = 1.0;
export const TRAIL_START_USD = 2.0;
export const TRAIL_STEP_USD = 1.0;

/** Dynamic trailing speed (PHASE 10 §8): wider trail in strong trends. */
export function trailStepForAdx(adxValue: number): number {
  if (adxValue > 35) return TRAIL_STEP_USD * 2;   // wide trailing — let winners run
  return TRAIL_STEP_USD;                           // normal trailing (ADX 25–35)
}

/** USD profit that must be locked in by the stop, given floating profit.
 *  Returns null while the stop should not move at all. */
export function lockedProfitUsd(profitUsd: number, stepUsd = TRAIL_STEP_USD): number | null {
  if (profitUsd < BREAK_EVEN_USD) return null;              // §3: nothing moves
  if (profitUsd < TRAIL_START_USD) return 0;                // §3: break-even only
  const step = Math.max(0.1, stepUsd);
  const stepsDone = Math.floor(profitUsd / step);
  return Math.max(0, (stepsDone - 1) * step);               // §4: $2→+$1, $3→+$2 ...
}

/** ATR-based stop loss distance in price units. */
export function atrStopDistance(atrVal: number, atrSlMult: number): number {
  return Math.max(0, atrVal * atrSlMult);
}

/** RR-based take profit distance from SL distance. */
export function rrTakeProfit(slDistance: number, rrTarget: number): number {
  return slDistance * Math.max(0.1, rrTarget);
}

/** Compute SL/TP price levels given side, entry, ATR, mult and RR. */
export function computeLevels(
  side: "BUY" | "SELL",
  entry: number,
  atrVal: number,
  atrSlMult: number,
  rrTarget: number,
): { stopLoss: number; takeProfit: number; slDistance: number; tpDistance: number; rr: number } {
  const slDistance = atrStopDistance(atrVal, atrSlMult);
  const tpDistance = rrTakeProfit(slDistance, rrTarget);
  const stopLoss = side === "BUY" ? entry - slDistance : entry + slDistance;
  const takeProfit = side === "BUY" ? entry + tpDistance : entry - tpDistance;
  return { stopLoss, takeProfit, slDistance, tpDistance, rr: tpDistance / Math.max(slDistance, 1e-9) };
}

export const MAX_LOT_SAFETY = 50; // hard upper cap regardless of risk math
export const MIN_LOT = 0.02;      // minimum trade size across all instruments
export const FX_MAX_LOT = 0.08;   // hard ceiling for FX currency pairs

/** Hard ceiling for FX currency pairs: 0.02 lot per $500 of balance, capped at 0.08.
 *  Gold is excluded — it has its own ATR-driven sizing. */
export function fxLotCap(balance: number): number {
  const steps = Math.floor(Math.max(0, balance) / 500);
  return Math.min(FX_MAX_LOT, Math.max(MIN_LOT, steps * MIN_LOT));
}

export function positionSize(symbol: string, balance: number, riskPct: number, slDistance: number): number {
  if (slDistance <= 0 || !isFinite(slDistance)) return MIN_LOT;
  if (balance <= 0 || riskPct <= 0) return MIN_LOT;
  const riskAmount = (balance * riskPct) / 100;
  const isJpy = isJpyQuoted(symbol);
  const isGold = isGoldSymbol(symbol);
  const valuePerUnit = isGold ? 100 : isJpy ? 1000 : 100_000;
  const raw = riskAmount / (slDistance * valuePerUnit);
  if (!isFinite(raw) || raw <= 0) return MIN_LOT;
  let lot = Math.max(MIN_LOT, Math.round(raw * 100) / 100);
  // FX safety cap: never exceed 0.02 lot per $500 balance on currency pairs.
  if (!isGold) lot = Math.min(lot, fxLotCap(balance));
  lot = Math.min(MAX_LOT_SAFETY, lot);
  return lot;
}

/** Has the daily loss circuit breaker tripped? */
export function dailyLossBreached(dailyPnl: number, startingBalance: number, maxDailyLossPct: number): boolean {
  if (startingBalance <= 0) return false;
  return (dailyPnl / startingBalance) * 100 <= -maxDailyLossPct;
}

// ---------------------------------------------------------------------------
// Chandelier Exit trailing (replaces the fixed-dollar ladder).
//   BUY  → stop = highest price since entry − ATR × CHANDELIER_ATR_MULT
//   SELL → stop = lowest  price since entry + ATR × CHANDELIER_ATR_MULT
// Only engages once the trade is at least CHANDELIER_TRIGGER_R in profit;
// before that the break-even lock (USD_BE_LOCK on the bridge / lockedProfitUsd
// here) is the only protection so normal pullback noise cannot stop us out.
// ---------------------------------------------------------------------------
export const CHANDELIER_ATR_MULT = 3.0;
export const CHANDELIER_TRIGGER_R = 1.3;

// Graduated gap-zone trail (0.5R → 1.3R): instead of leaving only the tiny
// break-even lock in place until the chandelier engages, run a loose ATR trail
// that starts wide (4.5×ATR) and tightens linearly to the 3.0×ATR chandelier.
export const GRADUATED_TRIGGER_R = 0.5;
export const GRADUATED_ATR_MULT_START = 4.5;
export const GRADUATED_ATR_MULT_END = 3.0;

/** ATR multiplier to use for the trail at a given profit in R. */
export function trailAtrMultForR(moveInR: number): number {
  if (moveInR >= CHANDELIER_TRIGGER_R) return CHANDELIER_ATR_MULT;
  const span = Math.max(1e-9, CHANDELIER_TRIGGER_R - GRADUATED_TRIGGER_R);
  const t = Math.min(1, Math.max(0, (moveInR - GRADUATED_TRIGGER_R) / span));
  return GRADUATED_ATR_MULT_START + t * (GRADUATED_ATR_MULT_END - GRADUATED_ATR_MULT_START);
}

/** Raw chandelier stop level from the running extreme. */
export function chandelierLevel(
  side: "BUY" | "SELL",
  extreme: number,
  atrVal: number,
  mult = CHANDELIER_ATR_MULT,
): number {
  const dist = Math.max(0, atrVal) * mult;
  return side === "BUY" ? extreme - dist : extreme + dist;
}

/**
 * Staged ATR trailing stop. From +0.5R a loose ATR trail (4.5× tapering to
 * 3.0×) protects the run-up; from +1.3R the full chandelier takes over. The
 * stop only ever ratchets forward and never lands on/behind entry — when the
 * ATR level would, we fall back to the break-even lock.
 */
export function computeTrailStop(
  side: "BUY" | "SELL",
  entry: number,
  currentPrice: number,
  currentStop: number,
  rDistance: number,
  params: RiskParams,
  opts?: { atr?: number; extreme?: number; atrMult?: number; minEntryBuffer?: number },
): { newStop: number; reason: string } | null {
  if (rDistance <= 0) return null;
  const dir = side === "BUY" ? 1 : -1;
  const moveInR = ((currentPrice - entry) * dir) / rDistance;

  const trailFloorR = Math.min(GRADUATED_TRIGGER_R, params.breakEvenAtR);
  if (moveInR < trailFloorR) return null;

  const atrVal = opts?.atr && opts.atr > 0 ? opts.atr : rDistance / 2.2; // fallback: SL was ATR×2.2
  const mult = opts?.atrMult ?? trailAtrMultForR(moveInR);
  const extreme = opts?.extreme ?? currentPrice;
  const candidate = chandelierLevel(side, extreme, atrVal, mult);

  // Safety guard: never park the stop on (or within a hair of) entry.
  const buffer = opts?.minEntryBuffer ?? Math.max(atrVal * 0.05, Math.abs(entry) * 1e-5);
  const candidateSafe = dir === 1 ? candidate > entry + buffer : candidate < entry - buffer;

  if (candidateSafe) {
    const better = dir === 1 ? candidate > currentStop : candidate < currentStop;
    if (!better) return null;
    const label = moveInR >= CHANDELIER_TRIGGER_R ? "Chandelier" : "Graduated";
    return {
      newStop: candidate,
      reason: `${label} trail at +${moveInR.toFixed(2)}R (extreme ∓ ${mult.toFixed(2)}×ATR)`,
    };
  }

  // Fallback: break-even lock once we are past the BE threshold.
  if (moveInR >= params.breakEvenAtR) {
    const better = dir === 1 ? entry > currentStop : entry < currentStop;
    if (better) return { newStop: entry, reason: `Break-even at +${params.breakEvenAtR}R` };
  }
  return null;
}

