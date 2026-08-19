// Single source of truth for the trading-engine runtime configuration.
//
// Both the browser store (useBot, for the dashboard UI) and the scheduled
// server-side engine read these defaults, so the two can never drift apart.
// Changing a value here changes it for the engine that actually trades.

import { SYMBOLS } from "./format";

export const ENGINE_DEFAULTS = {
  /** User-tunable floor. Per-symbol floors (gold 85 / FX 80) still apply on top. */
  minConfidence: 80,
  riskPct: 1,
  maxDailyLossPct: 3,
  maxOpenTrades: 15,
  maxTradesPerSymbol: 2,
  maxSameDirectionTrades: 2,
  useTierLimits: true,
  pauseOnWeekend: true,
  enabledSymbols: [...SYMBOLS] as string[],
} as const;

/** Code default for the global ADX floor. bot_settings.adx_min overrides it
 *  at runtime via liveConfig.globalAdxMin(). */
export const GLOBAL_ADX_MIN_DEFAULT = 22;


/** Duplicate-suppression window for the same symbol + direction. */
export const DUP_WINDOW_MS = 2 * 60_000;
/** Cooldown after a stop-loss on the same symbol. */
export const STOP_COOLDOWN_MS = 15 * 60_000;
/** MT5 bridge heartbeat freshness required before new entries are queued. */
export const MT5_HEARTBEAT_MAX_AGE_MS = 90_000;
