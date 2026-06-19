// Pair-specific strategy profiles. Each profile tells the signal generator
// which playbook to apply (trend-pullback, breakout, momentum, range, S/R,
// session-breakout, trend-following) along with the indicator thresholds
// most appropriate for that instrument's character.
//
// MT5 bridge / execution layer is NOT touched by this file. Profiles only
// configure how signals are generated; the existing executor places trades.

export type StrategyKind =
  | "trend_pullback"
  | "breakout"
  | "trend_following"
  | "range_breakout"
  | "momentum"
  | "support_resistance"
  | "session_breakout"
  | "fx_multi_confirmation";

/** Pairs treated as FX currency pairs (not metals). They share the
 *  multi-confirmation playbook + currency-specific risk caps. */
export const FX_CURRENCY_PAIRS = [
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD",
  "USDCAD", "USDCHF", "NZDUSD",
] as const;
export type FxCurrencyPair = (typeof FX_CURRENCY_PAIRS)[number];
export function isFxCurrencyPair(symbol: string): symbol is FxCurrencyPair {
  return (FX_CURRENCY_PAIRS as readonly string[]).includes(symbol);
}

export type PairProfile = {
  symbol: string;
  strategy: StrategyKind;
  label: string;
  description: string;
  // Indicator params
  emaFast: number;
  emaMid: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  adxMin: number;
  bbPeriod: number;
  bbStd: number;
  stochK: number;
  stochD: number;
  atrPeriod: number;
  // Risk model
  atrSlMult: number;
  rrTarget: number;          // TP = SL * rrTarget
  // Filter constraints
  maxSpreadPct: number;      // reject if spread/price > this (%)
  minAtrPct: number;         // reject if ATR/price < this (%)
  maxAtrPct: number;         // reject if ATR/price > this (%)
  preferredSessions: Array<"Sydney" | "Tokyo" | "London" | "New York">;
};

const COMMON = {
  emaFast: 50,
  emaMid: 100,
  emaSlow: 200,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
  bbPeriod: 20,
  bbStd: 2,
  stochK: 14,
  stochD: 3,
  atrPeriod: 14,
};

export const PAIR_PROFILES: Record<string, PairProfile> = {
  EURUSD: {
    ...COMMON,
    symbol: "EURUSD",
    strategy: "trend_pullback",
    label: "EURUSD — Trend Pullback",
    description: "Trade pullbacks to EMA50 in direction of EMA50>EMA200 trend, confirmed by RSI bounce.",
    adxMin: 18,
    atrSlMult: 1.5,
    rrTarget: 2.0,
    maxSpreadPct: 0.02,
    minAtrPct: 0.03,
    maxAtrPct: 1.2,
    preferredSessions: ["London", "New York"],
  },
  GBPUSD: {
    ...COMMON,
    symbol: "GBPUSD",
    strategy: "breakout",
    label: "GBPUSD — Breakout",
    description: "Trade breakouts of the upper/lower Bollinger Band when ADX confirms expansion.",
    adxMin: 22,
    atrSlMult: 1.8,
    rrTarget: 2.2,
    maxSpreadPct: 0.025,
    minAtrPct: 0.05,
    maxAtrPct: 1.5,
    preferredSessions: ["London", "New York"],
  },
  USDJPY: {
    ...COMMON,
    symbol: "USDJPY",
    strategy: "trend_following",
    label: "USDJPY — Trend Following",
    description: "Trade in the direction of EMA50>EMA200 with MACD confirmation, no counter-trend entries.",
    adxMin: 20,
    atrSlMult: 1.7,
    rrTarget: 2.0,
    maxSpreadPct: 0.02,
    minAtrPct: 0.03,
    maxAtrPct: 1.3,
    preferredSessions: ["Tokyo", "London"],
  },
  AUDUSD: {
    ...COMMON,
    symbol: "AUDUSD",
    strategy: "range_breakout",
    label: "AUDUSD — Range Breakout",
    description: "Detect Bollinger squeeze (low BB width) then trade the breakout direction.",
    adxMin: 15,
    atrSlMult: 1.6,
    rrTarget: 1.8,
    maxSpreadPct: 0.025,
    minAtrPct: 0.025,
    maxAtrPct: 1.2,
    preferredSessions: ["Sydney", "Tokyo", "London"],
  },
  USDCAD: {
    ...COMMON,
    symbol: "USDCAD",
    strategy: "momentum",
    label: "USDCAD — Momentum",
    description: "Trade in direction of strong MACD histogram + Stochastic momentum confirmation.",
    adxMin: 20,
    atrSlMult: 1.7,
    rrTarget: 2.0,
    maxSpreadPct: 0.025,
    minAtrPct: 0.03,
    maxAtrPct: 1.3,
    preferredSessions: ["London", "New York"],
  },
  NZDUSD: {
    ...COMMON,
    symbol: "NZDUSD",
    strategy: "support_resistance",
    label: "NZDUSD — Support / Resistance",
    description: "Reversal trades at detected swing-high/low levels confirmed by Stochastic exhaustion.",
    adxMin: 12,
    atrSlMult: 1.4,
    rrTarget: 1.8,
    maxSpreadPct: 0.03,
    minAtrPct: 0.025,
    maxAtrPct: 1.1,
    preferredSessions: ["Sydney", "Tokyo", "New York"],
  },
  EURJPY: {
    ...COMMON,
    symbol: "EURJPY",
    strategy: "session_breakout",
    label: "EURJPY — Session Breakout",
    description: "Trade breakout of the prior session's range during London open.",
    adxMin: 18,
    atrSlMult: 1.7,
    rrTarget: 2.0,
    maxSpreadPct: 0.03,
    minAtrPct: 0.04,
    maxAtrPct: 1.4,
    preferredSessions: ["London", "New York"],
  },
  GBPJPY: {
    ...COMMON,
    symbol: "GBPJPY",
    strategy: "momentum",
    label: "GBPJPY — Momentum",
    description: "High-volatility momentum: MACD histogram acceleration + ADX > 25 + ATR expansion.",
    adxMin: 25,
    atrSlMult: 2.0,
    rrTarget: 2.2,
    maxSpreadPct: 0.035,
    minAtrPct: 0.06,
    maxAtrPct: 2.0,
    preferredSessions: ["London", "New York"],
  },
  // XAUUSD falls back to a generic momentum profile if requested.
  XAUUSD: {
    ...COMMON,
    symbol: "XAUUSD",
    strategy: "momentum",
    label: "XAUUSD — Momentum",
    description: "Trade gold momentum bursts with wide ATR-based stops; confirm with MACD + ADX.",
    adxMin: 20,
    atrSlMult: 2.0,
    rrTarget: 1.8,
    maxSpreadPct: 0.05,
    minAtrPct: 0.05,
    maxAtrPct: 2.5,
    preferredSessions: ["London", "New York"],
  },
};

export function getPairProfile(symbol: string): PairProfile | null {
  return PAIR_PROFILES[symbol] ?? null;
}

export function allProfiles(): PairProfile[] {
  return Object.values(PAIR_PROFILES);
}
