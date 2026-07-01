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
  // ---- FX currency pairs: unified multi-confirmation playbook ----
  EURUSD: {
    ...COMMON,
    symbol: "EURUSD",
    strategy: "fx_multi_confirmation",
    label: "EURUSD — Multi-Confirmation",
    description: "EMA50/200 trend + RSI band + MACD crossover + ATR active. No counter-trend / no sideways.",
    adxMin: 12,
    atrSlMult: 2.8,
    rrTarget: 2.15,
    maxSpreadPct: 0.02,
    minAtrPct: 0.01,
    maxAtrPct: 1.2,
    preferredSessions: ["London", "New York"],
  },
  GBPUSD: {
    ...COMMON,
    symbol: "GBPUSD",
    strategy: "fx_multi_confirmation",
    label: "GBPUSD — Multi-Confirmation",
    description: "EMA50/200 trend + RSI band + MACD crossover + ATR active.",
    adxMin: 14,
    atrSlMult: 3.0,
    rrTarget: 2.15,
    maxSpreadPct: 0.025,
    minAtrPct: 0.012,
    maxAtrPct: 1.4,
    preferredSessions: ["London", "New York"],
  },
  USDJPY: {
    ...COMMON,
    symbol: "USDJPY",
    strategy: "fx_multi_confirmation",
    label: "USDJPY — Multi-Confirmation",
    description: "EMA50/200 trend + RSI band + MACD crossover + ATR active.",
    adxMin: 14,
    atrSlMult: 1.6,
    rrTarget: 2.0,
    maxSpreadPct: 0.02,
    minAtrPct: 0.012,
    maxAtrPct: 1.3,
    preferredSessions: ["Tokyo", "London", "New York"],
  },
  AUDUSD: {
    ...COMMON,
    symbol: "AUDUSD",
    strategy: "fx_multi_confirmation",
    label: "AUDUSD — Multi-Confirmation",
    description: "EMA50/200 trend + RSI band + MACD crossover + ATR active.",
    adxMin: 12,
    atrSlMult: 1.5,
    rrTarget: 2.0,
    maxSpreadPct: 0.025,
    minAtrPct: 0.01,
    maxAtrPct: 1.2,
    preferredSessions: ["Sydney", "Tokyo", "London", "New York"],
  },
  USDCAD: {
    ...COMMON,
    symbol: "USDCAD",
    strategy: "fx_multi_confirmation",
    label: "USDCAD — Multi-Confirmation",
    description: "EMA50/200 trend + RSI band + MACD crossover + ATR active.",
    adxMin: 12,
    atrSlMult: 1.5,
    rrTarget: 2.0,
    maxSpreadPct: 0.025,
    minAtrPct: 0.01,
    maxAtrPct: 1.3,
    preferredSessions: ["London", "New York"],
  },
  USDCHF: {
    ...COMMON,
    symbol: "USDCHF",
    strategy: "fx_multi_confirmation",
    label: "USDCHF — Multi-Confirmation",
    description: "EMA50/200 trend + RSI band + MACD crossover + ATR active.",
    adxMin: 12,
    atrSlMult: 1.5,
    rrTarget: 2.0,
    maxSpreadPct: 0.025,
    minAtrPct: 0.01,
    maxAtrPct: 1.3,
    preferredSessions: ["London", "New York"],
  },
  NZDUSD: {
    ...COMMON,
    symbol: "NZDUSD",
    strategy: "fx_multi_confirmation",
    label: "NZDUSD — Multi-Confirmation",
    description: "EMA50/200 trend + RSI band + MACD crossover + ATR active.",
    adxMin: 12,
    atrSlMult: 1.5,
    rrTarget: 2.0,
    maxSpreadPct: 0.03,
    minAtrPct: 0.01,
    maxAtrPct: 1.2,
    preferredSessions: ["Sydney", "Tokyo", "New York"],
  },
  // Cross-JPY pairs keep prior playbooks
  EURJPY: {
    ...COMMON,
    symbol: "EURJPY",
    strategy: "session_breakout",
    label: "EURJPY — Session Breakout",
    description: "Trade breakout of the prior session's range during London open.",
    adxMin: 14,
    atrSlMult: 1.7,
    rrTarget: 2.0,
    maxSpreadPct: 0.03,
    minAtrPct: 0.015,
    maxAtrPct: 1.4,
    preferredSessions: ["London", "New York"],
  },
  GBPJPY: {
    ...COMMON,
    symbol: "GBPJPY",
    strategy: "momentum",
    label: "GBPJPY — Momentum",
    description: "High-volatility momentum: MACD histogram acceleration + ADX + ATR expansion.",
    adxMin: 18,
    atrSlMult: 2.0,
    rrTarget: 2.2,
    maxSpreadPct: 0.035,
    minAtrPct: 0.02,
    maxAtrPct: 2.0,
    preferredSessions: ["London", "New York"],
  },
  // XAUUSD — use the multi-confirmation playbook so gold trades alongside FX
  // instead of waiting for rare momentum bursts.
  XAUUSD: {
    ...COMMON,
    symbol: "XAUUSD",
    strategy: "fx_multi_confirmation",
    label: "XAUUSD — Multi-Confirmation",
    description: "EMA50/200 trend + RSI band + MACD crossover + ATR active. Same logic as FX majors, wider ATR stop.",
    adxMin: 10,
    atrSlMult: 2.0,
    rrTarget: 2.0,
    maxSpreadPct: 0.08,
    minAtrPct: 0.008,
    maxAtrPct: 3.0,
    preferredSessions: ["Sydney", "Tokyo", "London", "New York"],
  },
};

export function getPairProfile(symbol: string): PairProfile | null {
  return PAIR_PROFILES[symbol] ?? null;
}

export function allProfiles(): PairProfile[] {
  return Object.values(PAIR_PROFILES);
}
