// Pair-specific strategy profiles. Each profile tells the signal generator
// which playbook to apply and the indicator thresholds most appropriate for
// that instrument's character.
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
  | "fx_multi_confirmation"
  | "gold_multi_confirmation";

/** Pairs treated as FX currency pairs (not metals). They share the
 *  multi-confirmation playbook + currency-specific risk caps. */
export const FX_CURRENCY_PAIRS = [
  // Majors
  "EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF", "NZDUSD",
  // JPY crosses
  "EURJPY", "GBPJPY", "AUDJPY", "NZDJPY", "CADJPY", "CHFJPY",
  // EUR crosses
  "EURGBP", "EURAUD", "EURCAD", "EURCHF", "EURNZD",
  // GBP crosses
  "GBPAUD", "GBPCAD", "GBPCHF", "GBPNZD",
  // Others
  "AUDCAD", "AUDCHF", "AUDNZD", "NZDCAD", "NZDCHF", "CADCHF",
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
  emaFast: number;
  emaMid: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  /** Optional momentum band bounds (PDF manual):
   *  BUY only when rsi >= rsiBuyMin (default 55)
   *  SELL only when rsi <= rsiSellMax (default 45)                       */
  rsiBuyMin?: number;
  rsiSellMax?: number;
  adxMin: number;
  bbPeriod: number;
  bbStd: number;
  stochK: number;
  stochD: number;
  atrPeriod: number;
  atrSlMult: number;
  rrTarget: number;
  maxSpreadPct: number;
  minAtrPct: number;
  maxAtrPct: number;
  preferredSessions: Array<"Sydney" | "Tokyo" | "London" | "New York">;
};


const COMMON = {
  emaFast: 50, emaMid: 100, emaSlow: 200,
  rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
  bbPeriod: 20, bbStd: 2,
  stochK: 14, stochD: 3, atrPeriod: 14,
};

// Baseline FX profile — built-in currency strategy.
// EMA Fast 20 / EMA Slow 50, RSI(14) buy<=65 sell>=35, ADX >= 25,
// MACD required, ATR SL 2.2 / ATR TP 2.8 (rr = 2.8/2.2).
function fxProfile(
  symbol: string,
  overrides: Partial<PairProfile> = {},
): PairProfile {
  return {
    ...COMMON,
    symbol,
    strategy: "fx_multi_confirmation",
    label: `${symbol} — Multi-Confirmation`,
    description: "EMA20/50 trend + RSI(14) 35–65 band + MACD required + ADX≥25 + ATR SL 2.2 / TP 2.8.",
    emaFast: 20,
    emaMid: 50,
    emaSlow: 50,
    rsiPeriod: 14,
    rsiOversold: 35,
    rsiOverbought: 65,
    adxMin: 25,
    atrSlMult: 2.2,
    rrTarget: 2.8 / 2.2,
    maxSpreadPct: symbol.endsWith("JPY") ? 0.03 : 0.025,
    minAtrPct: symbol.endsWith("JPY") ? 0.012 : 0.01,
    maxAtrPct: /GBP(AUD|NZD|CAD|CHF)|EUR(NZD|AUD)|AUDNZD/.test(symbol) ? 1.6 : symbol.endsWith("JPY") ? 1.4 : 1.2,
    preferredSessions: ["London", "New York"],
    ...overrides,
  };
}


export const PAIR_PROFILES: Record<string, PairProfile> = {
  // ---- Gold: dedicated playbook, separate from FX ----
  XAUUSD: {
    ...COMMON,
    symbol: "XAUUSD",
    strategy: "gold_multi_confirmation",
    label: "XAUUSD — Gold Multi-Confirmation",
    description: "Gold-specific: EMA50/200 trend + wider RSI band + MACD + ATR expansion. Trades around the clock with looser session constraints.",
    adxMin: 10,
    atrSlMult: 3.0,
    rrTarget: 2.2,
    maxSpreadPct: 0.08,
    minAtrPct: 0.008,
    maxAtrPct: 3.0,
    preferredSessions: ["Sydney", "Tokyo", "London", "New York"],
  },

  // ---- FX majors ----
  EURUSD: fxProfile("EURUSD", { maxSpreadPct: 0.02 }),
  GBPUSD: fxProfile("GBPUSD"),
  USDJPY: fxProfile("USDJPY", { preferredSessions: ["Tokyo", "London", "New York"], maxSpreadPct: 0.02 }),
  AUDUSD: fxProfile("AUDUSD", { preferredSessions: ["Sydney", "Tokyo", "London", "New York"] }),
  USDCAD: fxProfile("USDCAD"),
  USDCHF: fxProfile("USDCHF"),
  NZDUSD: fxProfile("NZDUSD", { preferredSessions: ["Sydney", "Tokyo", "New York"], maxSpreadPct: 0.03 }),

  // ---- JPY crosses ----
  EURJPY: fxProfile("EURJPY"),
  GBPJPY: fxProfile("GBPJPY"),
  AUDJPY: fxProfile("AUDJPY", { preferredSessions: ["Tokyo", "London", "New York"] }),
  NZDJPY: fxProfile("NZDJPY", { preferredSessions: ["Tokyo", "London", "New York"] }),
  CADJPY: fxProfile("CADJPY"),
  CHFJPY: fxProfile("CHFJPY"),

  // ---- EUR crosses ----
  EURGBP: fxProfile("EURGBP", { maxSpreadPct: 0.025 }),

  EURAUD: fxProfile("EURAUD"),
  EURCAD: fxProfile("EURCAD"),
  EURCHF: fxProfile("EURCHF"),
  EURNZD: fxProfile("EURNZD"),

  // ---- GBP crosses ----
  GBPAUD: fxProfile("GBPAUD"),
  GBPCAD: fxProfile("GBPCAD"),
  GBPCHF: fxProfile("GBPCHF"),
  GBPNZD: fxProfile("GBPNZD"),

  // ---- Other crosses ----
  AUDCAD: fxProfile("AUDCAD"),
  AUDCHF: fxProfile("AUDCHF"),
  AUDNZD: fxProfile("AUDNZD"),
  NZDCAD: fxProfile("NZDCAD"),
  NZDCHF: fxProfile("NZDCHF"),
  CADCHF: fxProfile("CADCHF"),
};

export function getPairProfile(symbol: string): PairProfile | null {
  return PAIR_PROFILES[symbol] ?? null;
}

export function allProfiles(): PairProfile[] {
  return Object.values(PAIR_PROFILES);
}
