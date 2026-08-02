// Startup / periodic validation: detect symbols appearing in recent trades or
// signals that do NOT resolve to a known pair profile after broker-suffix
// normalization. Unmapped symbols previously fell back to default SL math and
// produced zero-distance stop losses, so we surface them loudly.

import { supabase } from "@/integrations/supabase/client";
import { normalizeSymbol, isKnownSymbol } from "./pairProfiles";

export type SymbolAuditResult = {
  checked: number;
  unresolved: Array<{ raw: string; normalized: string; source: string }>;
};

let lastRun = 0;

export async function auditRecentSymbols(limit = 500): Promise<SymbolAuditResult> {
  const seen = new Map<string, string>(); // raw -> source
  const [trades, signals] = await Promise.all([
    supabase.from("trades").select("symbol").order("opened_at", { ascending: false }).limit(limit),
    supabase.from("signals").select("symbol").order("created_at", { ascending: false }).limit(limit),
  ]);
  for (const r of trades.data ?? []) if (r.symbol) seen.set(r.symbol, "trades");
  for (const r of signals.data ?? []) if (r.symbol && !seen.has(r.symbol)) seen.set(r.symbol, "signals");

  const unresolved = [...seen.entries()]
    .filter(([raw]) => !isKnownSymbol(raw))
    .map(([raw, source]) => ({ raw, normalized: normalizeSymbol(raw), source }));

  if (unresolved.length) {
    console.error(
      `[symbol-guard] ${unresolved.length} symbol(s) in recent data do not map to a pair profile:`,
      unresolved.map((u) => `${u.raw} → ${u.normalized} (${u.source})`).join(", "),
    );
  }
  return { checked: seen.size, unresolved };
}

/** Fire-and-forget audit, throttled to once every 10 minutes. */
export function auditRecentSymbolsOnce(onResult?: (r: SymbolAuditResult) => void) {
  const now = Date.now();
  if (now - lastRun < 10 * 60_000) return;
  lastRun = now;
  auditRecentSymbols()
    .then((r) => onResult?.(r))
    .catch(() => { /* audit is diagnostic only */ });
}
