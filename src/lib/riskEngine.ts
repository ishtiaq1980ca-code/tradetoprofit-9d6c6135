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
};

export const DEFAULT_RISK: RiskParams = {
  riskPct: 3,
  breakEvenAtR: 1.0,        // BE at +1R
  trailStartAtR: 1.5,       // trail after +1.5R
  trailStepR: 1.0,          // trail 1R behind price
  maxDailyLossPct: 5,
};

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
  const isJpy = symbol.endsWith("JPY");
  const isGold = symbol === "XAUUSD" || symbol === "GOLD";
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

/** Compute trail stop given current price & params. Returns the new SL only
 *  if it improves on the existing SL; otherwise returns null. */
export function computeTrailStop(
  side: "BUY" | "SELL",
  entry: number,
  currentPrice: number,
  currentStop: number,
  rDistance: number,
  params: RiskParams,
): { newStop: number; reason: string } | null {
  if (rDistance <= 0) return null;
  const dir = side === "BUY" ? 1 : -1;
  const moveInR = ((currentPrice - entry) * dir) / rDistance;

  // 1. Break-even at +1R
  if (moveInR >= params.breakEvenAtR && moveInR < params.trailStartAtR) {
    const better = dir === 1 ? entry > currentStop : entry < currentStop;
    if (better) return { newStop: entry, reason: `Break-even at +${params.breakEvenAtR}R` };
  }

  // 2. Trail after +1.5R: keep SL trailStepR behind price
  if (moveInR >= params.trailStartAtR) {
    const candidate = dir === 1
      ? currentPrice - rDistance * params.trailStepR
      : currentPrice + rDistance * params.trailStepR;
    const better = dir === 1 ? candidate > currentStop : candidate < currentStop;
    if (better) return { newStop: candidate, reason: `Trailing stop at +${moveInR.toFixed(2)}R` };
  }

  return null;
}
