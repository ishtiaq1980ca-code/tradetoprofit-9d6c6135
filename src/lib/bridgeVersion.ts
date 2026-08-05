// Single source of truth for the bridge script version the backend expects.
// Bump this whenever public/aurumai_bridge.py gets a safety-relevant fix so
// the dashboard can loudly warn when an older bridge process is still running.
export const REQUIRED_BRIDGE_VERSION = 2026080501;

/** Approximate pip size for a broker symbol (handles "EURUSDm"-style suffixes). */
export function pipSizeFor(symbol: string): number {
  const s = (symbol || "").toUpperCase();
  if (s.includes("XAU") || s.includes("GOLD")) return 0.1;
  if (s.includes("JPY")) return 0.01;
  return 0.0001;
}

/**
 * True when a stop-loss sits on (or within a hair of) the entry price.
 * Such a stop turns any small retrace into a 0.00 round-trip close, so it is
 * never a legitimate value to persist for an open trade.
 */
export function isDegenerateStop(entry: number, stopLoss: number | null | undefined, symbol: string): boolean {
  if (stopLoss === null || stopLoss === undefined) return false;
  if (!Number.isFinite(entry) || !Number.isFinite(stopLoss) || entry <= 0 || stopLoss <= 0) return false;
  return Math.abs(stopLoss - entry) < pipSizeFor(symbol) * 0.5;
}
