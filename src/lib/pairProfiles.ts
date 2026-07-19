// Pair-specific strategy profiles — Corrected Multi-Pair Forex Strategy v2.
// Per-pair differentiated ADX / RSI / ATR-SL, grouped by correlation cluster.
// Common to all FX pairs: H4/H1/M15 trend align, EMA50/200 + MACD required,
// RR 1:2, sessions: Sydney/Tokyo/London/New York.
//
// MT5 bridge / execution layer is NOT touched by this file.

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

export const FX_CURRENCY_PAIRS = [
  "EURUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","USDCHF","NZDUSD",
  "EURGBP","EURJPY","EURCHF","EURAUD","EURCAD","EURNZD",
  "GBPAUD","GBPCAD","GBPCHF","GBPJPY","GBPNZD",
  "AUDCAD","AUDCHF","AUDJPY","AUDNZD",
  "CADCHF","CADJPY","CHFJPY",
  "NZDCAD","NZDCHF","NZDJPY",
] as const;
export type FxCurrencyPair = (typeof FX_CURRENCY_PAIRS)[number];
export function isFxCurrencyPair(symbol: string): symbol is FxCurrencyPair {
  return (FX_CURRENCY_PAIRS as readonly string[]).includes(symbol);
}

type Session = "Sydney" | "Tokyo" | "London" | "New York";

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
  /** RSI momentum band: BUY only when rsi in [rsiBuyMin, rsiBuyMax];
   *  SELL only when rsi in [rsiSellMin, rsiSellMax].                    */
  rsiBuyMin?: number;
  rsiBuyMax?: number;
  rsiSellMin?: number;
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
  preferredSessions: Session[];
};

const COMMON = {
  emaFast: 50, emaMid: 100, emaSlow: 200,
  rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
  bbPeriod: 20, bbStd: 2,
  stochK: 14, stochD: 3, atrPeriod: 14,
};

// Build a per-pair FX profile from the v2 manual's differentiated parameters.
function fx(
  symbol: string,
  adxMin: number,
  buy: [number, number],   // RSI buy zone
  sell: [number, number],  // RSI sell zone
  atrSlMult: number,
  sessions: Session[],
): PairProfile {
  const isJpy = symbol.endsWith("JPY");
  const isHighAtr = /GBP(JPY|AUD|NZD)|EUR(NZD|AUD)|AUDNZD/.test(symbol);
  return {
    ...COMMON,
    symbol,
    strategy: "fx_multi_confirmation",
    label: `${symbol} — Multi-Pair v2`,
    description:
      `H4/H1/M15 trend align. EMA50/200 + MACD, ADX≥${adxMin}, ` +
      `RSI BUY ${buy[0]}–${buy[1]} / SELL ${sell[0]}–${sell[1]}, ` +
      `ATR SL ${atrSlMult}× / RR 1:2.`,
    rsiOversold: sell[0],
    rsiOverbought: buy[1],
    rsiBuyMin: buy[0],
    rsiBuyMax: buy[1],
    rsiSellMin: sell[0],
    rsiSellMax: sell[1],
    adxMin,
    atrSlMult,
    rrTarget: 2.0,
    maxSpreadPct: isJpy ? 0.03 : 0.025,
    minAtrPct: isJpy ? 0.012 : 0.01,
    maxAtrPct: isHighAtr ? 1.8 : isJpy ? 1.4 : 1.2,
    preferredSessions: sessions,
  };
}

export const PAIR_PROFILES: Record<string, PairProfile> = {
  // ---- Gold: dedicated playbook, untouched ----
  XAUUSD: {
    ...COMMON,
    symbol: "XAUUSD",
    strategy: "gold_multi_confirmation",
    label: "XAUUSD — Gold Multi-Confirmation",
    description: "Gold-specific: EMA50/200 trend + wider RSI band + MACD + ATR expansion.",
    adxMin: 10,
    atrSlMult: 3.0,
    rrTarget: 2.2,
    maxSpreadPct: 0.08,
    minAtrPct: 0.008,
    maxAtrPct: 3.0,
    preferredSessions: ["Sydney", "Tokyo", "London", "New York"],
  },

  // ---- 5.1 USD majors ----
  EURUSD: fx("EURUSD", 22, [57, 63], [37, 43], 1.6, ["London", "New York"]),
  GBPUSD: fx("GBPUSD", 25, [55, 65], [35, 45], 1.5, ["London", "New York"]),
  USDJPY: fx("USDJPY", 27, [53, 67], [33, 47], 1.3, ["Tokyo", "New York"]),
  USDCHF: fx("USDCHF", 22, [57, 63], [37, 43], 1.6, ["London", "New York"]),
  USDCAD: fx("USDCAD", 25, [55, 65], [35, 45], 1.5, ["New York"]),
  AUDUSD: fx("AUDUSD", 24, [55, 65], [35, 45], 1.5, ["Sydney", "London"]),
  NZDUSD: fx("NZDUSD", 24, [55, 65], [35, 45], 1.5, ["Sydney", "London"]),

  // ---- 5.2 EUR crosses ----
  EURGBP: fx("EURGBP", 20, [56, 64], [36, 44], 1.7, ["London"]),
  EURJPY: fx("EURJPY", 27, [53, 67], [33, 47], 1.3, ["Tokyo", "London"]),
  EURCHF: fx("EURCHF", 20, [58, 62], [38, 42], 1.8, ["London"]),
  EURAUD: fx("EURAUD", 25, [55, 65], [35, 45], 1.5, ["London"]),
  EURCAD: fx("EURCAD", 25, [55, 65], [35, 45], 1.5, ["London", "New York"]),
  EURNZD: fx("EURNZD", 25, [55, 65], [35, 45], 1.5, ["London"]),

  // ---- 5.3 GBP crosses ----
  GBPAUD: fx("GBPAUD", 28, [52, 68], [32, 48], 1.2, ["London"]),
  GBPCAD: fx("GBPCAD", 27, [53, 67], [33, 47], 1.3, ["London", "New York"]),
  GBPCHF: fx("GBPCHF", 25, [55, 65], [35, 45], 1.5, ["London"]),
  GBPJPY: fx("GBPJPY", 30, [50, 70], [30, 50], 1.1, ["Tokyo", "London"]),
  GBPNZD: fx("GBPNZD", 28, [52, 68], [32, 48], 1.2, ["London"]),

  // ---- 5.4 AUD crosses ----
  AUDCAD: fx("AUDCAD", 24, [55, 65], [35, 45], 1.5, ["Sydney", "New York"]),
  AUDCHF: fx("AUDCHF", 22, [57, 63], [37, 43], 1.6, ["Sydney", "London"]),
  AUDJPY: fx("AUDJPY", 27, [53, 67], [33, 47], 1.3, ["Tokyo", "Sydney"]),
  AUDNZD: fx("AUDNZD", 20, [58, 62], [38, 42], 1.8, ["Sydney"]),

  // ---- 5.5 Other crosses ----
  CADCHF: fx("CADCHF", 21, [57, 63], [37, 43], 1.7, ["New York", "London"]),
  CADJPY: fx("CADJPY", 27, [53, 67], [33, 47], 1.3, ["Tokyo", "New York"]),
  CHFJPY: fx("CHFJPY", 26, [54, 66], [34, 46], 1.3, ["Tokyo", "London"]),
  NZDCAD: fx("NZDCAD", 24, [55, 65], [35, 45], 1.5, ["Sydney", "New York"]),
  NZDCHF: fx("NZDCHF", 21, [57, 63], [37, 43], 1.7, ["Sydney", "London"]),
  NZDJPY: fx("NZDJPY", 26, [54, 66], [34, 46], 1.3, ["Tokyo", "Sydney"]),
};

export function getPairProfile(symbol: string): PairProfile | null {
  return PAIR_PROFILES[symbol] ?? null;
}

export function allProfiles(): PairProfile[] {
  return Object.values(PAIR_PROFILES);
}
