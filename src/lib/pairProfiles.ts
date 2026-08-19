// Pair-specific strategy profiles — Strategy Update v3.
// Per-pair differentiated ADX, RSI zones and ATR-SL, grouped into volatility
// tiers (1 = calm, 2 = medium, 3 = volatile) that also drive the exit engine.
// USDCHF and GBPJPY are DISABLED — no new entries pending audit.
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

export type PairTier = 1 | 2 | 3 | "gold";

export const FX_CURRENCY_PAIRS = [
  "EURUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","USDCHF","NZDUSD",
  "EURGBP","EURJPY","EURCHF","EURAUD","EURCAD","EURNZD",
  "GBPAUD","GBPCAD","GBPCHF","GBPJPY","GBPNZD",
  "AUDCAD","AUDCHF","AUDJPY","AUDNZD",
  "CADCHF","CADJPY","CHFJPY",
  "NZDCAD","NZDCHF","NZDJPY",
] as const;
export type FxCurrencyPair = (typeof FX_CURRENCY_PAIRS)[number];
export function isFxCurrencyPair(symbol: string): boolean {
  return (FX_CURRENCY_PAIRS as readonly string[]).includes(normalizeSymbol(symbol));
}


type Session = "Sydney" | "Tokyo" | "London" | "New York";

export type PairProfile = {
  symbol: string;
  strategy: StrategyKind;
  label: string;
  description: string;
  tier: PairTier;
  disabled?: boolean;
  disabledReason?: string;
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
  /** Optional per-pair overrides sourced from pair_settings (DB). */
  minConfidence?: number;
  riskPct?: number;
  maxLot?: number;
  /** True when one or more fields came from pair_settings. */
  fromDb?: boolean;
};


const COMMON = {
  emaFast: 50, emaMid: 100, emaSlow: 200,
  rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
  bbPeriod: 20, bbStd: 2,
  stochK: 14, stochD: 3, atrPeriod: 14,
};

// Tier defaults for entry RSI zones (v3 §3)
const TIER_RSI = {
  1: { buy: [53, 67] as [number, number], sell: [33, 47] as [number, number] },
  2: { buy: [52, 68] as [number, number], sell: [32, 48] as [number, number] },
  3: { buy: [47, 71] as [number, number], sell: [27, 53] as [number, number] },
};

/** Exit-engine parameters per volatility tier (v3 §4). */
export type TierExitParams = {
  breakEvenAtR: number;
  partialAtR: number;
  partialPct: number;        // 0..1
  trailStartAtR: number;     // R multiple at which trailing engages
  trailAtrMult: number;      // trail distance in ATRs
  minStopPips: number;       // absolute minimum SL distance
  minStopPipsJpy?: number;   // JPY-quoted override in pips (1 pip = 0.01)
};

export const TIER_EXITS: Record<Exclude<PairTier, "gold">, TierExitParams> = {
  // partialPct = 0 → partial close disabled per user request; ride to TP or trailing SL.
  1: { breakEvenAtR: 0.6,  partialAtR: 1.6, partialPct: 0, trailStartAtR: 1.3, trailAtrMult: 3.0, minStopPips: 12 },
  2: { breakEvenAtR: 0.5,  partialAtR: 1.5, partialPct: 0, trailStartAtR: 1.3, trailAtrMult: 3.0, minStopPips: 15 },
  3: { breakEvenAtR: 0.45, partialAtR: 1.4, partialPct: 0, trailStartAtR: 1.3, trailAtrMult: 3.0, minStopPips: 20, minStopPipsJpy: 20 },
};

export function tierExitParams(tier: PairTier): TierExitParams | null {
  if (tier === "gold") return null; // gold keeps its existing playbook
  return TIER_EXITS[tier];
}

/** Minimum stop-loss distance in price units for a pair, per v3 §4 floor. */
export function minStopDistance(symbol: string, tier: PairTier): number {
  if (tier === "gold") return 0; // gold unchanged
  const t = TIER_EXITS[tier];
  const isJpy = isJpyQuoted(symbol);
  const pipSize = isJpy ? 0.01 : 0.0001;
  const pips = isJpy && t.minStopPipsJpy ? t.minStopPipsJpy : t.minStopPips;
  return pips * pipSize;
}

/** Suffix-safe instrument-class helpers. */
export function isJpyQuoted(symbol: string): boolean {
  return normalizeSymbol(symbol).endsWith("JPY");
}
export function isGoldSymbol(symbol: string): boolean {
  return normalizeSymbol(symbol) === "XAUUSD";
}


// Build a per-pair FX profile using tier defaults + per-pair overrides.
function fx(
  symbol: string,
  tier: 1 | 2 | 3,
  adxMin: number,
  atrSlMult: number,
  sessions: Session[],
  extras: { disabled?: boolean; disabledReason?: string; note?: string } = {},
): PairProfile {
  const isJpy = symbol.endsWith("JPY");
  const isHighAtr = /GBP(JPY|AUD|NZD)|EUR(NZD|AUD)|AUDNZD/.test(symbol);
  const { buy, sell } = TIER_RSI[tier];
  return {
    ...COMMON,
    symbol,
    strategy: "fx_multi_confirmation",
    tier,
    disabled: extras.disabled,
    disabledReason: extras.disabledReason,
    label: `${symbol} — Tier ${tier}${extras.disabled ? " · DISABLED" : ""}`,
    description:
      `Tier ${tier}. H4/H1/M15 align, EMA50/200 + MACD, ADX≥${adxMin}, ` +
      `RSI BUY ${buy[0]}–${buy[1]} / SELL ${sell[0]}–${sell[1]}, ` +
      `ATR SL ${atrSlMult}× / RR 1:2.${extras.note ? " " + extras.note : ""}`,
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
  // ---- Gold: dedicated playbook, unchanged (v3 §2) ----
  XAUUSD: {
    ...COMMON,
    symbol: "XAUUSD",
    strategy: "gold_multi_confirmation",
    tier: "gold",
    label: "XAUUSD — Gold Multi-Confirmation",
    description: "Gold-specific: EMA50/200 trend + wider RSI band + MACD + ATR expansion.",
    adxMin: 7,
    atrSlMult: 3.0,
    rrTarget: 2.2,
    maxSpreadPct: 0.08,
    minAtrPct: 0.008,
    maxAtrPct: 3.0,
    preferredSessions: ["Sydney", "Tokyo", "London", "New York"],
  },

  // ---- Tier 1 (calm) ----
  EURUSD: fx("EURUSD", 1, 19, 1.6, ["London", "New York"]),
  USDCHF: fx("USDCHF", 1, 19, 1.6, ["London", "New York"], {
    disabled: true, disabledReason: "Pause new entries — audit before re-enabling (v3: worst pair, PF 0.12)",
  }),
  EURGBP: fx("EURGBP", 1, 17, 1.7, ["London"]),
  EURCHF: fx("EURCHF", 1, 17, 1.8, ["London"], { note: "CHF cluster — monitor closely" }),
  AUDCHF: fx("AUDCHF", 1, 19, 1.6, ["Sydney", "London"], { note: "Best CHF-cluster pair" }),
  CADCHF: fx("CADCHF", 1, 18, 1.7, ["New York", "London"], { note: "CHF cluster — monitor" }),
  AUDNZD: fx("AUDNZD", 1, 17, 1.8, ["Sydney"]),
  NZDCHF: fx("NZDCHF", 1, 18, 1.7, ["Sydney", "London"], { note: "CHF cluster — monitor" }),

  // ---- Tier 2 (medium) ----
  GBPUSD: fx("GBPUSD", 2, 22, 1.5, ["London", "New York"], { note: "Flipped to losing — watch" }),
  USDCAD: fx("USDCAD", 2, 22, 1.5, ["New York"], { note: "Flipped to flat — watch" }),
  AUDUSD: fx("AUDUSD", 2, 21, 1.5, ["Sydney", "London"]),
  NZDUSD: fx("NZDUSD", 2, 21, 1.5, ["Sydney", "London"]),
  EURAUD: fx("EURAUD", 2, 22, 1.5, ["London"]),
  EURCAD: fx("EURCAD", 2, 22, 1.5, ["London", "New York"]),
  EURNZD: fx("EURNZD", 2, 22, 1.5, ["London"]),
  GBPCHF: fx("GBPCHF", 2, 22, 1.5, ["London"], { note: "CHF cluster — monitor" }),
  AUDCAD: fx("AUDCAD", 2, 21, 1.5, ["Sydney", "New York"]),
  NZDCAD: fx("NZDCAD", 2, 21, 1.5, ["Sydney", "New York"]),

  // ---- Tier 3 (volatile) ----
  USDJPY: fx("USDJPY", 3, 24, 1.3, ["Tokyo", "New York"]),
  EURJPY: fx("EURJPY", 3, 24, 1.3, ["Tokyo", "London"]),
  GBPAUD: fx("GBPAUD", 3, 25, 1.2, ["London"]),
  GBPCAD: fx("GBPCAD", 3, 24, 1.3, ["London", "New York"], { note: "Flipped to badly losing — watch" }),
  GBPJPY: fx("GBPJPY", 3, 27, 1.1, ["Tokyo", "London"], {
    disabled: true, disabledReason: "Pause new entries — v3 stop-widening did not help; needs independent review",
  }),
  GBPNZD: fx("GBPNZD", 3, 25, 1.2, ["London"]),
  AUDJPY: fx("AUDJPY", 3, 24, 1.3, ["Tokyo", "Sydney"]),
  CADJPY: fx("CADJPY", 3, 24, 1.3, ["Tokyo", "New York"], { note: "Flipped to losing — watch" }),
  CHFJPY: fx("CHFJPY", 3, 23, 1.3, ["Tokyo", "London"]),
  NZDJPY: fx("NZDJPY", 3, 23, 1.3, ["Tokyo", "Sydney"]),
};

// ------------------------- Symbol normalization ---------------------------
// Brokers append suffixes to symbol names (e.g. "EURCHFm", "USDJPY.pro",
// "XAUUSD-micro"). Every profile / risk / filter lookup MUST go through
// normalizeSymbol() or the pair silently falls back to broken defaults
// (observed: zero-distance stop losses on "m"-suffixed symbols).

export const KNOWN_BASE_SYMBOLS: ReadonlySet<string> = new Set(Object.keys(PAIR_PROFILES));

const BROKER_SUFFIX_RE = /(PRO|ECN|RAW|MICRO|MINI|CENT|STD|SB|FX|CFD|M|C|I|Z|R|X|E)$/;

/** Strip broker suffixes and return the canonical pair symbol.
 *  Unknown symbols are returned cleaned (upper-case, alphanumeric only). */
export function normalizeSymbol(symbol: string): string {
  if (!symbol) return "";
  let t = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t === "GOLD" || t.startsWith("XAUUSD")) return "XAUUSD";
  if (KNOWN_BASE_SYMBOLS.has(t)) return t;
  for (let i = 0; i < 3; i++) {
    const next = t.replace(BROKER_SUFFIX_RE, "");
    if (next === t) break;
    t = next;
    if (KNOWN_BASE_SYMBOLS.has(t)) return t;
  }
  const head = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (KNOWN_BASE_SYMBOLS.has(head)) return head;
  return t;
}

/** True when the symbol resolves to a configured pair profile. */
export function isKnownSymbol(symbol: string): boolean {
  return KNOWN_BASE_SYMBOLS.has(normalizeSymbol(symbol));
}

/** Symbols from a list that do NOT resolve to any known pair profile. */
export function unresolvedSymbols(symbols: readonly string[]): string[] {
  const bad = new Set<string>();
  for (const s of symbols) if (s && !isKnownSymbol(s)) bad.add(s);
  return [...bad].sort();
}

export function getPairProfile(symbol: string): PairProfile | null {
  return PAIR_PROFILES[normalizeSymbol(symbol)] ?? null;
}

/** True when the (normalized) pair is paused for new entries. */
export function isPairDisabled(symbol: string): boolean {
  return getPairProfile(symbol)?.disabled === true;
}

export function allProfiles(): PairProfile[] {
  return Object.values(PAIR_PROFILES);
}


/** Currency-cluster exposure caps (v3 §6). % of equity per currency leg. */
export const CURRENCY_EXPOSURE_CAPS: Record<string, number> = {
  USD: 3.0, EUR: 3.0,
  GBP: 2.5, JPY: 2.5, AUD: 2.5, NZD: 2.5, CAD: 2.5, CHF: 2.5,
};
