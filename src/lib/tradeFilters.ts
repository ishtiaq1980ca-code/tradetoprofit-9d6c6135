// Pre-trade filters. Each returns { pass, reason } so the decision log can
// record exactly why a candidate was rejected.
//
// MT5 bridge / execution untouched.

import { activeSessions, type MarketSession } from "./sessions";
import { isGoldSymbol, isJpyQuoted } from "./pairProfiles";
import { newsBlockFor } from "./economicCalendar";


export type FilterResult = { pass: boolean; reason: string };

/** Spread filter: reject if (spread / price) exceeds the pair's threshold. */
export function spreadFilter(symbol: string, price: number, spread: number, maxSpreadPct: number): FilterResult {
  if (price <= 0) return { pass: false, reason: "Spread: invalid price" };
  const pct = (spread / price) * 100;
  if (pct > maxSpreadPct) {
    return { pass: false, reason: `Spread ${pct.toFixed(3)}% > max ${maxSpreadPct}%` };
  }
  return { pass: true, reason: `Spread ${pct.toFixed(3)}% OK` };
}

/** Volatility filter: ATR must sit inside a healthy band for this pair. */
export function volatilityFilter(price: number, atrVal: number, minAtrPct: number, maxAtrPct: number): FilterResult {
  if (price <= 0 || atrVal <= 0) return { pass: false, reason: "Volatility: invalid ATR" };
  const pct = (atrVal / price) * 100;
  if (pct < minAtrPct) return { pass: false, reason: `Volatility ${pct.toFixed(3)}% < min ${minAtrPct}% (flat market)` };
  if (pct > maxAtrPct) return { pass: false, reason: `Volatility ${pct.toFixed(3)}% > max ${maxAtrPct}% (too wild)` };
  return { pass: true, reason: `Volatility ${pct.toFixed(3)}% in band` };
}

/** Session filter: require an overlap with this pair's preferred sessions. */
export function sessionFilter(
  preferred: Array<Exclude<MarketSession, "Closed">>,
  now: Date = new Date(),
): FilterResult {
  const s = activeSessions(now);
  if (s.weekend) return { pass: false, reason: "Market closed (weekend)" };
  if (!preferred.length) return { pass: true, reason: `Session ${s.primary} (no preference)` };
  const overlap = preferred.some((p) => s.active.includes(p));
  if (!overlap) {
    return {
      pass: false,
      reason: `Session ${s.primary} not in preferred (${preferred.join(", ")})`,
    };
  }
  return { pass: true, reason: `Session ${s.primary} (preferred)` };
}

// ----------------------------- News filter ---------------------------------
// High-impact news protection. Without a live calendar feed we use a manual
// blackout window store the user can populate. Anything inside any blackout
// window is blocked. The store is module-level so it works in SSR and tests.

export type NewsWindow = {
  symbol?: string;        // empty/undefined = all symbols
  startsAt: number;       // unix ms
  endsAt: number;         // unix ms
  label: string;          // e.g. "NFP", "FOMC", "CPI"
};

const newsWindows: NewsWindow[] = [];

export function addNewsWindow(w: NewsWindow) {
  newsWindows.push(w);
}

export function clearNewsWindows() {
  newsWindows.length = 0;
}

export function listNewsWindows(): NewsWindow[] {
  // Drop expired windows on read so the list stays clean.
  const now = Date.now();
  while (newsWindows.length && newsWindows[0].endsAt < now) newsWindows.shift();
  return [...newsWindows];
}

export function newsFilter(symbol: string, now: Date = new Date()): FilterResult {
  const t = now.getTime();
  // 1. Legacy manual blackout windows (kept for backwards compatibility).
  for (const w of listNewsWindows()) {
    if (w.symbol && w.symbol !== symbol) continue;
    if (t >= w.startsAt && t <= w.endsAt) {
      return { pass: false, reason: `High-impact news: ${w.label} blackout active` };
    }
  }
  // 2. Economic calendar (currency-aware, buffered window).
  const block = newsBlockFor(symbol, t);
  if (block.blocked) return { pass: false, reason: block.reason };
  return { pass: true, reason: "No high-impact news window" };
}


/** Estimated spread (price units) for a symbol — used when broker spread
 *  is unavailable (paper/demo signal generation). Bridge supplies the real
 *  spread before execution; this is for the dashboard's pre-trade filter. */
export function estimatedSpread(symbol: string, price: number): number {
  if (isGoldSymbol(symbol)) return 0.3;
  if (isJpyQuoted(symbol)) return 0.015;
  return Math.max(0.00008, price * 0.00008);
}

// ---------------------- Regime filters (v3 §5) ----------------------------
// Global entry-side gates run BEFORE the confluence check. If any fails,
// no trade regardless of what the indicators say.

/** ATR-spike filter: skip entries if current ATR > 1.5x its 20-period avg. */
export function atrSpikeFilter(atrCurrent: number, atrSeries: number[]): FilterResult {
  const lookback = atrSeries.slice(-21, -1).filter((v) => isFinite(v) && v > 0);
  if (lookback.length < 5) return { pass: true, reason: "ATR spike: insufficient history" };
  const avg = lookback.reduce((a, b) => a + b, 0) / lookback.length;
  if (avg <= 0) return { pass: true, reason: "ATR spike: no baseline" };
  const ratio = atrCurrent / avg;
  if (ratio > 1.5) return { pass: false, reason: `ATR spike ${ratio.toFixed(2)}× 20-avg (> 1.5×) — regime unstable` };
  return { pass: true, reason: `ATR ${ratio.toFixed(2)}× 20-avg (≤ 1.5×)` };
}

/** ADX ceiling: skip entries if ADX > 40 (over-extended trend). */
export function adxCeilingFilter(adxValue: number): FilterResult {
  if (adxValue > 40) return { pass: false, reason: `ADX ${adxValue.toFixed(1)} > 40 ceiling — likely late-trend` };
  return { pass: true, reason: `ADX ${adxValue.toFixed(1)} ≤ 40` };
}

/** Extension filter: skip entries where price is > 3× ATR from EMA200. */
export function extensionFilter(price: number, ema200Value: number, atrValue: number): FilterResult {
  if (atrValue <= 0) return { pass: true, reason: "Extension: no ATR" };
  const dist = Math.abs(price - ema200Value) / atrValue;
  if (dist > 3) return { pass: false, reason: `Price ${dist.toFixed(2)}× ATR from EMA200 (> 3×) — extended` };
  return { pass: true, reason: `Price ${dist.toFixed(2)}× ATR from EMA200 (≤ 3×)` };
}

