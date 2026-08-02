// Currency-pair correlation guard. Prevents stacking redundant directional
// exposure across highly correlated FX pairs (e.g. EURUSD BUY + USDCHF SELL,
// AUDUSD BUY + NZDUSD BUY). XAUUSD and JPY-cross pairs are NOT included —
// they're evaluated by their own playbooks and risk caps.
//
// MT5 bridge / execution layer is NOT touched by this file. The guard is
// consulted by the bot before queueing a new signal.

import { FX_CURRENCY_PAIRS, normalizeSymbol } from "./pairProfiles";

export type Side = "BUY" | "SELL";

/** Static rolling-correlation matrix (long-run typical values).
 *  Positive => the two symbols tend to move together (same-direction trades are correlated).
 *  Negative => they tend to move opposite (opposite-direction trades are correlated).
 *  Symmetric; only one direction is stored. */
const RAW: Record<string, Record<string, number>> = {
  EURUSD: { GBPUSD: 0.85, USDCHF: -0.95, USDCAD: -0.70, USDJPY: -0.40, AUDUSD: 0.65, NZDUSD: 0.60 },
  GBPUSD: { USDCHF: -0.80, USDCAD: -0.60, USDJPY: -0.30, AUDUSD: 0.60, NZDUSD: 0.55 },
  USDCHF: { USDCAD: 0.65, USDJPY: 0.50, AUDUSD: -0.60, NZDUSD: -0.55 },
  USDCAD: { USDJPY: 0.45, AUDUSD: -0.70, NZDUSD: -0.65 },
  USDJPY: { AUDUSD: -0.35, NZDUSD: -0.30 },
  AUDUSD: { NZDUSD: 0.90 },
};

function lookupCorr(a: string, b: string): number {
  if (a === b) return 1;
  if (RAW[a]?.[b] !== undefined) return RAW[a][b];
  if (RAW[b]?.[a] !== undefined) return RAW[b][a];
  return 0;
}

const sgn = (side: Side) => (side === "BUY" ? 1 : -1);

/** Effective correlation of taking `sideA` on `a` while holding `sideB` on `b`.
 *  +1 = identical directional bet; -1 = perfectly hedged. */
export function effectiveCorrelation(a: string, sideA: Side, b: string, sideB: Side): number {
  return lookupCorr(a, b) * sgn(sideA) * sgn(sideB);
}

export const CORRELATION_BLOCK_THRESHOLD = 0.75;

export type OpenExposure = { symbol: string; side: Side };

export type CorrelationDecision = {
  block: boolean;
  reason: string;
  conflicts: Array<{ symbol: string; side: Side; effective: number }>;
};

/** Should we BLOCK opening (`candidateSymbol` `candidateSide`) given the
 *  currently open `existing` exposures? Only FX currency pairs are evaluated;
 *  XAUUSD / JPY crosses pass through unchanged. */
export function correlationGuard(
  existing: OpenExposure[],
  candidateSymbol: string,
  candidateSide: Side,
): CorrelationDecision {
  const fxSet = new Set<string>(FX_CURRENCY_PAIRS as readonly string[]);
  candidateSymbol = normalizeSymbol(candidateSymbol);
  if (!fxSet.has(candidateSymbol)) {
    return { block: false, reason: "Not an FX currency pair — correlation guard skipped", conflicts: [] };
  }

  const conflicts: CorrelationDecision["conflicts"] = [];
  for (const ex of existing) {
    const exSymbol = normalizeSymbol(ex.symbol);
    if (!fxSet.has(exSymbol)) continue;
    if (exSymbol === candidateSymbol) continue; // duplicate prevention handles same-symbol
    const eff = effectiveCorrelation(candidateSymbol, candidateSide, exSymbol, ex.side);
    if (Math.abs(eff) >= CORRELATION_BLOCK_THRESHOLD) {
      conflicts.push({ symbol: exSymbol, side: ex.side, effective: +eff.toFixed(2) });
    }
  }

  if (conflicts.length === 0) {
    return { block: false, reason: "No correlated exposure", conflicts };
  }

  const lines = conflicts.map((c) => {
    const kind = c.effective > 0 ? "stacks" : "hedges";
    return `${candidateSymbol} ${candidateSide} ${kind} ${c.symbol} ${c.side} (eff ${c.effective.toFixed(2)})`;
  });
  return {
    block: true,
    reason: `Correlation block: ${lines.join("; ")}`,
    conflicts,
  };
}
