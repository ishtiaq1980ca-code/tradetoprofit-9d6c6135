// Loads the live, DB-driven engine configuration (bot_settings + pair_settings)
// and installs it into the runtime override layer (src/lib/liveConfig.ts).
//
// Called once at the top of every server scan, so a change made in the UI or
// directly in the database takes effect on the very next cron cycle.

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeSymbol } from "../pairProfiles";
import {
  parseBotSettings, parsePairSettingsRow, setEngineOverrides, setPairOverrides,
  type PairOverride,
} from "../liveConfig";

export type LoadedConfig = {
  settings: any | null;
  notes: string[];
  pairCount: number;
};

export async function loadLiveConfig(admin: SupabaseClient<any>): Promise<LoadedConfig> {
  const notes: string[] = [];

  const { data: settings, error: sErr } = await admin
    .from("bot_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (sErr) notes.push(`bot_settings load failed (${sErr.message}) — using code defaults`);

  const parsed = parseBotSettings(settings ?? {});
  setEngineOverrides(parsed.overrides, parsed.notes);
  notes.push(...parsed.notes);

  const { data: pairRows, error: pErr } = await admin
    .from("pair_settings")
    .select("*")
    .limit(500);
  if (pErr) {
    notes.push(`pair_settings load failed (${pErr.message}) — using hardcoded profiles`);
    setPairOverrides(new Map());
    return { settings: settings ?? null, notes, pairCount: 0 };
  }

  // Brokers' suffixed rows (e.g. "AUDCADm") normalize onto the same pair as the
  // canonical row. A canonical row always wins; suffixed rows only fill gaps.
  const map = new Map<string, PairOverride>();
  const canonical = new Set<string>();
  for (const row of (pairRows ?? []) as any[]) {
    const raw = String(row?.symbol ?? "").toUpperCase();
    const key = normalizeSymbol(raw);
    if (!key) continue;
    const isCanonical = raw === key;
    if (!isCanonical && canonical.has(key)) continue;
    if (isCanonical) canonical.add(key);
    else if (map.has(key)) continue;
    map.set(key, parsePairSettingsRow(row));
  }
  setPairOverrides(map);

  return { settings: settings ?? null, notes, pairCount: map.size };
}
