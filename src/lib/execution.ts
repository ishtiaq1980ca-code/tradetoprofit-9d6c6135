// Client-side execution helper. Handles:
//   - Pre-send SL/TP validation & normalization (digits, direction, min stop distance).
//   - Dynamic per-instrument-class open-trade caps (FX vs XAUUSD).
//   - Reliability checks before queueing a signal for the MT5 bridge.
//   - Execution latency + failure-reason stats store.
//
// This module DOES NOT touch the MT5 bridge or change the existing risk
// engine. The bridge still applies its own broker-side normalization in
// aurumai_bridge.py; this just prevents obviously-bad orders from leaving the
// browser and tracks how the chain is performing.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { isFxCurrencyPair } from "./pairProfiles";
import { estimatedSpread } from "./tradeFilters";

// --------------------------- Symbol specs ---------------------------------

export type SymbolSpec = {
  digits: number;
  point: number;          // = 10^-digits
  minStopDistance: number; // approximate broker-allowed min stop in price units
  minVolume: number;
  volumeStep: number;
};

const FX5: SymbolSpec = { digits: 5, point: 1e-5, minStopDistance: 0.00030, minVolume: 0.01, volumeStep: 0.01 };
const JPY: SymbolSpec = { digits: 3, point: 1e-3, minStopDistance: 0.030,   minVolume: 0.01, volumeStep: 0.01 };
const XAU: SymbolSpec = { digits: 2, point: 1e-2, minStopDistance: 0.50,    minVolume: 0.01, volumeStep: 0.01 };

const SPECS: Record<string, SymbolSpec> = {
  EURUSD: FX5, GBPUSD: FX5, AUDUSD: FX5, NZDUSD: FX5, USDCHF: FX5, USDCAD: FX5,
  USDJPY: JPY, EURJPY: JPY, GBPJPY: JPY,
  XAUUSD: XAU,
};

export const MIN_EXECUTION_RR = 1.9;

export function getSymbolSpec(symbol: string): SymbolSpec {
  return SPECS[symbol] ?? FX5;
}

function roundTo(price: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(price * f) / f;
}

function roundVolume(lot: number, step: number, min: number): number {
  const v = Math.max(min, Math.round(lot / step) * step);
  return Math.round(v * 100) / 100;
}

// --------------------------- Normalization --------------------------------

export type NormalizeRejectCode =
  | "invalid_sl"
  | "invalid_tp"
  | "stops_too_close"
  | "price_changed"
  | "broker_restriction";

export type NormalizeResult =
  | {
      ok: true;
      entry: number;
      stopLoss: number;
      takeProfit: number;
      lot: number;
      adjusted: boolean;
      notes: string[];
    }
  | { ok: false; code: NormalizeRejectCode; reason: string };

/** Maximum slippage allowed between decision price and live price before
 *  we declare the entry stale. ATR-relative, falls back to 5x min stop. */
function maxSlippage(spec: SymbolSpec, atrVal?: number): number {
  if (atrVal && atrVal > 0) return atrVal * 0.5;
  return spec.minStopDistance * 5;
}

/**
 * Recalculate + normalize an order plan against the latest live price.
 * - Verifies side/SL/TP directionality.
 * - Snaps to symbol digits.
 * - Enforces broker minimum stop distance, widening SL/TP if needed while
 *   preserving the original risk:reward as closely as possible.
 * - Rejects only on hard violations (price moved too far, broker rule,
 *   unrecoverable bad input).
 */
export function normalizeOrderPlan(args: {
  symbol: string;
  side: "BUY" | "SELL";
  decisionEntry: number;
  decisionSL: number;
  decisionTP: number;
  livePrice: number;
  lot: number;
  atr?: number;
}): NormalizeResult {
  const { symbol, side, decisionEntry, decisionSL, decisionTP, livePrice, lot, atr } = args;
  const spec = getSymbolSpec(symbol);
  const notes: string[] = [];
  let adjusted = false;

  if (!isFinite(livePrice) || livePrice <= 0) {
    return { ok: false, code: "broker_restriction", reason: "Live price unavailable" };
  }

  // Price-change guard
  const slip = Math.abs(livePrice - decisionEntry);
  if (slip > maxSlippage(spec, atr)) {
    return { ok: false, code: "price_changed", reason: `Live ${livePrice} vs decision ${decisionEntry} slipped ${slip.toFixed(spec.digits)}` };
  }

  // Re-anchor to the live price
  const entry = roundTo(livePrice, spec.digits);

  // Direction & RR
  const origRR = Math.abs(decisionTP - decisionEntry) / Math.max(1e-9, Math.abs(decisionEntry - decisionSL));
  let sl = decisionSL;
  let tp = decisionTP;

  // Validate base directionality of the original plan
  if (side === "BUY" && !(decisionSL < decisionEntry && decisionTP > decisionEntry)) {
    return { ok: false, code: "invalid_sl", reason: "BUY requires SL<entry<TP" };
  }
  if (side === "SELL" && !(decisionSL > decisionEntry && decisionTP < decisionEntry)) {
    return { ok: false, code: "invalid_sl", reason: "SELL requires TP<entry<SL" };
  }

  // Re-derive SL/TP distances from original plan, then re-anchor to live entry
  const slDist = Math.abs(decisionEntry - decisionSL);
  const tpDist = Math.abs(decisionTP - decisionEntry);
  sl = side === "BUY" ? entry - slDist : entry + slDist;
  tp = side === "BUY" ? entry + tpDist : entry - tpDist;

  // Enforce broker/spread minimum distances. MT5 BUY positions close at Bid
  // and SELL positions close at Ask, so TP must cover spread or chart touch
  // may not close the broker position.
  const spread = Math.max(estimatedSpread(symbol, entry), spec.point * 2);
  const minSL = Math.max(spec.minStopDistance, spread * 2, spec.point * 10);
  const minTP = Math.max(spec.minStopDistance, spread * 3, spec.point * 10);
  const rrKeep = Math.max(MIN_EXECUTION_RR, origRR > 0.5 ? origRR : MIN_EXECUTION_RR);
  if (Math.abs(entry - sl) < minSL) {
    const newSL = side === "BUY" ? entry - minSL : entry + minSL;
    sl = newSL;
    adjusted = true;
    notes.push(`SL widened to spread-aware min (${minSL.toFixed(spec.digits)})`);
  }
  // ALWAYS re-derive TP from the (possibly widened) SL distance so RR is
  // preserved. Prevents the "TP=2pts / SL=12pts" inversion when SL gets
  // widened to the broker min but TP stays at its original tiny distance.
  {
    const slDistFinal = Math.abs(entry - sl);
    const tpDistFinal = Math.max(minTP, slDistFinal * rrKeep);
    const newTP = side === "BUY" ? entry + tpDistFinal : entry - tpDistFinal;
    if (Math.abs(newTP - tp) > spec.point / 2) {
      tp = newTP;
      adjusted = true;
      notes.push(`TP rebuilt to cover spread and preserve R:R ${rrKeep.toFixed(2)}`);
    }
  }

  // Snap and final validate
  sl = roundTo(sl, spec.digits);
  tp = roundTo(tp, spec.digits);
  if (side === "BUY" && !(sl < entry && tp > entry)) {
    return { ok: false, code: "invalid_tp", reason: "BUY normalized SL/TP collapsed" };
  }
  if (side === "SELL" && !(sl > entry && tp < entry)) {
    return { ok: false, code: "invalid_tp", reason: "SELL normalized SL/TP collapsed" };
  }
  if (Math.abs(entry - sl) < minSL - 1e-9 || Math.abs(tp - entry) < minTP - 1e-9) {
    return { ok: false, code: "stops_too_close", reason: `Stops below spread-aware min SL ${minSL.toFixed(spec.digits)} / TP ${minTP.toFixed(spec.digits)}` };
  }
  const finalRR = Math.abs(tp - entry) / Math.max(Math.abs(entry - sl), spec.point);
  if (finalRR < MIN_EXECUTION_RR) {
    return { ok: false, code: "stops_too_close", reason: `TP/SL ratio ${finalRR.toFixed(2)} below minimum ${MIN_EXECUTION_RR.toFixed(1)}` };
  }

  // Volume
  const normLot = roundVolume(lot, spec.volumeStep, spec.minVolume);
  if (normLot < spec.minVolume) {
    return { ok: false, code: "broker_restriction", reason: `Lot ${normLot} < min ${spec.minVolume}` };
  }

  return { ok: true, entry, stopLoss: sl, takeProfit: tp, lot: normLot, adjusted, notes };
}

// --------------------------- Dynamic open-trade caps ----------------------

export const MAX_OPEN_FX = 8;
export const MAX_OPEN_XAU = 2;

export type OpenTradeSlots = {
  fxOpen: number;
  fxMax: number;
  fxAvailable: number;
  xauOpen: number;
  xauMax: number;
  xauAvailable: number;
  totalOpen: number;
  totalMax: number;
};

function isXau(sym: string) { return sym === "XAUUSD" || sym === "GOLD"; }

export function computeOpenSlots(positions: Array<{ symbol: string }>): OpenTradeSlots {
  const fxOpen = positions.filter((p) => isFxCurrencyPair(p.symbol) || /JPY$/.test(p.symbol)).length;
  const xauOpen = positions.filter((p) => isXau(p.symbol)).length;
  return {
    fxOpen,
    fxMax: MAX_OPEN_FX,
    fxAvailable: Math.max(0, MAX_OPEN_FX - fxOpen),
    xauOpen,
    xauMax: MAX_OPEN_XAU,
    xauAvailable: Math.max(0, MAX_OPEN_XAU - xauOpen),
    totalOpen: fxOpen + xauOpen,
    totalMax: MAX_OPEN_FX + MAX_OPEN_XAU,
  };
}

/** Returns null if the candidate symbol may open; otherwise a reason string. */
export function classBlock(symbol: string, slots: OpenTradeSlots): string | null {
  if (isXau(symbol)) {
    return slots.xauAvailable > 0 ? null : `XAUUSD cap reached (${slots.xauOpen}/${slots.xauMax})`;
  }
  return slots.fxAvailable > 0 ? null : `FX cap reached (${slots.fxOpen}/${slots.fxMax})`;
}

// --------------------------- Execution stats store ------------------------

export type ExecutionFailure = {
  at: number;
  symbol: string;
  side: "BUY" | "SELL";
  code: NormalizeRejectCode | "queue_failed" | "no_price";
  reason: string;
};

type ExecStore = {
  // Latency: signal-generated -> queued to MT5 bridge (Supabase insert ack)
  sentLatencies: number[];   // ms
  // Latency: signal-generated -> bridge confirmed fill (executed_at)
  fillLatencies: number[];   // ms
  sent: number;
  filled: number;
  failed: number;
  failures: ExecutionFailure[];
  recordSent: (ms: number) => void;
  recordFill: (ms: number) => void;
  recordFailure: (f: ExecutionFailure) => void;
  clear: () => void;
};

export const useExecutionStats = create<ExecStore>()(
  persist(
    (set, get) => ({
      sentLatencies: [],
      fillLatencies: [],
      sent: 0,
      filled: 0,
      failed: 0,
      failures: [],
      recordSent: (ms) =>
        set({
          sentLatencies: [...get().sentLatencies, ms].slice(-200),
          sent: get().sent + 1,
        }),
      recordFill: (ms) =>
        set({
          fillLatencies: [...get().fillLatencies, ms].slice(-200),
          filled: get().filled + 1,
        }),
      recordFailure: (f) =>
        set({
          failed: get().failed + 1,
          failures: [f, ...get().failures].slice(0, 100),
        }),
      clear: () => set({ sentLatencies: [], fillLatencies: [], sent: 0, filled: 0, failed: 0, failures: [] }),
    }),
    {
      name: "aurum-execution-stats-v1",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : (undefined as any))),
    },
  ),
);

export function avgMs(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
