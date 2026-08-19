// Live, database-driven configuration overrides.
//
// The engine's *defaults* still live in engineConfig.ts (ENGINE_DEFAULTS) and
// pairProfiles.ts (PAIR_PROFILES). This module is the thin runtime layer that
// lets `bot_settings` (global) and `pair_settings` (per-symbol) override those
// defaults for the live entry-signal engine.
//
// Rules:
//   * Every DB value is validated against sane bounds. Out-of-range / null /
//     NaN values are DISCARDED and the hardcoded default is used instead.
//   * A missing pair_settings row NEVER disables a pair — only an explicit
//     row with enabled = false does.
//   * Nothing here touches the MT5 bridge, execution, trailing/break-even,
//     news, correlation or structure-invalidation logic.

import { GLOBAL_ADX_MIN_DEFAULT } from "./engineConfig";

// --------------------------- validation helpers ----------------------------

/** Coerce to a finite number inside [min,max]; otherwise undefined. */
export function bounded(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === "string" ? Number(v) : (v as number);
  if (v == null || typeof n !== "number" || !Number.isFinite(n)) return undefined;
  if (n < min || n > max) return undefined;
  return n;
}

function boundedInt(v: unknown, min: number, max: number): number | undefined {
  const n = bounded(v, min, max);
  return n == null ? undefined : Math.round(n);
}

// ------------------------------ engine level -------------------------------

export type EngineOverrides = {
  /** bot_settings.min_confidence — FX confidence floor (%). */
  minConfidence?: number;
  /** bot_settings.risk_per_trade — % of balance risked per trade. */
  riskPct?: number;
  /** bot_settings.max_daily_loss — daily loss circuit breaker (% of balance). */
  maxDailyLossPct?: number;
  /** bot_settings.adx_min — GLOBAL ADX floor applied on top of per-pair adxMin. */
  globalAdxMin?: number;
  /** bot_settings.symbols — authoritative enabled-symbol list (normalized). */
  enabledSymbols?: string[];
};

let engine: EngineOverrides = {};
/** Human-readable log of what was accepted / rejected on the last load. */
let engineNotes: string[] = [];

export function setEngineOverrides(o: EngineOverrides, notes: string[] = []) {
  engine = o;
  engineNotes = notes;
}
export function getEngineOverrides(): EngineOverrides {
  return engine;
}
export function engineOverrideNotes(): string[] {
  return engineNotes;
}
export function clearLiveConfig() {
  engine = {};
  engineNotes = [];
  pairs.clear();
}

/** Global ADX floor: bot_settings.adx_min when valid, else the code default. */
export function globalAdxMin(): number {
  return engine.globalAdxMin ?? GLOBAL_ADX_MIN_DEFAULT;
}

/**
 * Parse a raw bot_settings row into validated engine overrides.
 * Returns the overrides plus a note for every field accepted or rejected.
 */
export function parseBotSettings(row: any): { overrides: EngineOverrides; notes: string[] } {
  const notes: string[] = [];
  const o: EngineOverrides = {};
  const take = <T>(field: string, val: T | undefined, raw: unknown) => {
    if (val === undefined) {
      if (raw != null) notes.push(`bot_settings.${field}=${String(raw)} rejected (out of bounds) — using default`);
      return undefined;
    }
    notes.push(`bot_settings.${field}=${String(val)}`);
    return val;
  };

  o.minConfidence = take("min_confidence", bounded(row?.min_confidence, 0, 100), row?.min_confidence);
  o.riskPct = take("risk_per_trade", bounded(row?.risk_per_trade, 0.01, 10), row?.risk_per_trade);
  o.maxDailyLossPct = take("max_daily_loss", bounded(row?.max_daily_loss, 0.1, 100), row?.max_daily_loss);
  o.globalAdxMin = take("adx_min", bounded(row?.adx_min, 0, 100), row?.adx_min);

  const syms = Array.isArray(row?.symbols)
    ? (row.symbols as unknown[]).map((s) => String(s ?? "").trim().toUpperCase()).filter(Boolean)
    : [];
  if (syms.length > 0) {
    o.enabledSymbols = syms;
    notes.push(`bot_settings.symbols=${syms.length} symbols`);
  } else if (row?.symbols != null) {
    notes.push("bot_settings.symbols empty — using default symbol list");
  }

  for (const k of Object.keys(o) as (keyof EngineOverrides)[]) if (o[k] === undefined) delete o[k];
  return { overrides: o, notes };
}

// ------------------------------ per-pair level -----------------------------

export type PairOverride = {
  enabled?: boolean;
  emaFast?: number;
  emaSlow?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  adxMin?: number;
  atrPeriod?: number;
  atrSlMult?: number;
  rrTarget?: number;
  maxSpreadPct?: number;
  minConfidence?: number;
  riskPct?: number;
  maxLot?: number;
};

const pairs = new Map<string, PairOverride>();

export function setPairOverrides(map: Map<string, PairOverride> | Record<string, PairOverride>) {
  pairs.clear();
  const entries = map instanceof Map ? map.entries() : Object.entries(map);
  for (const [k, v] of entries) pairs.set(k, v);
}
export function getPairOverride(normalizedSymbol: string): PairOverride | undefined {
  return pairs.get(normalizedSymbol);
}
export function pairOverrideCount(): number {
  return pairs.size;
}

/** Validate one raw pair_settings row. Invalid individual fields are dropped. */
export function parsePairSettingsRow(row: any): PairOverride {
  const o: PairOverride = {};
  if (typeof row?.enabled === "boolean") o.enabled = row.enabled;

  const emaFast = boundedInt(row?.ema_fast, 2, 500);
  const emaSlow = boundedInt(row?.ema_slow, 3, 1000);
  if (emaFast != null && emaSlow != null && emaSlow > emaFast) {
    o.emaFast = emaFast;
    o.emaSlow = emaSlow;
  }

  const rsiPeriod = boundedInt(row?.rsi_period, 2, 100);
  if (rsiPeriod != null) o.rsiPeriod = rsiPeriod;

  const lo = bounded(row?.rsi_lower, 0, 100);
  const hi = bounded(row?.rsi_upper, 0, 100);
  if (lo != null && hi != null && hi > lo) {
    o.rsiOversold = lo;
    o.rsiOverbought = hi;
  }

  const adxMin = bounded(row?.adx_min, 0, 100);
  if (adxMin != null) o.adxMin = adxMin;

  const atrPeriod = boundedInt(row?.atr_period, 2, 100);
  if (atrPeriod != null) o.atrPeriod = atrPeriod;

  const atrSlMult = bounded(row?.atr_sl_mult, 0.1, 10);
  if (atrSlMult != null) o.atrSlMult = atrSlMult;

  const rrTarget = bounded(row?.rr_target, 0.1, 10);
  if (rrTarget != null) o.rrTarget = rrTarget;

  const maxSpreadPct = bounded(row?.max_spread_pct, 0.001, 5);
  if (maxSpreadPct != null) o.maxSpreadPct = maxSpreadPct;

  const minConfidence = bounded(row?.min_confidence, 0, 100);
  if (minConfidence != null) o.minConfidence = minConfidence;

  const riskPct = bounded(row?.risk_per_trade_pct, 0.01, 10);
  if (riskPct != null) o.riskPct = riskPct;

  const maxLot = bounded(row?.max_lot, 0.01, 50);
  if (maxLot != null) o.maxLot = maxLot;

  return o;
}
