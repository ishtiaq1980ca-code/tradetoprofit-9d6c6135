// Time-of-day trading filter.
//
// Historical performance showed persistent losses in specific UTC hours, so
// new ENTRIES are blocked during those hours. Management of already-open
// positions (trailing stop, break-even, structure exits) is never affected —
// this module is only consulted on the entry path.
//
// The hour list lives in bot_settings.blocked_hours_utc so it can be tuned
// from the Settings page without a redeploy.


export const DEFAULT_BLOCKED_HOURS_UTC = [2, 14, 18, 19, 20, 21];

export function parseBlockedHours(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_BLOCKED_HOURS_UTC;
  const hours = value
    .map((h) => Math.trunc(Number(h)))
    .filter((h) => Number.isFinite(h) && h >= 0 && h <= 23);
  return Array.from(new Set(hours)).sort((a, b) => a - b);
}

/** Pure check used by both the browser engine and the server poll route. */
export function isBlockedHour(blocked: number[], now: Date = new Date()): boolean {
  return blocked.includes(now.getUTCHours());
}

export function blockedHourReason(blocked: number[], now: Date = new Date()): string {
  return `skipped: blocked hour — ${String(now.getUTCHours()).padStart(2, "0")}:00 UTC is in the blocked window [${blocked.join(", ")}]`;
}

// --- client-side cache (refreshed every 60s) ---
let cache: number[] = DEFAULT_BLOCKED_HOURS_UTC;
let fetchedAt = 0;
let inflight: Promise<number[]> | null = null;

export function cachedBlockedHours(): number[] {
  return cache;
}

export async function loadBlockedHours(force = false): Promise<number[]> {
  if (!force && Date.now() - fetchedAt < 60_000) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("bot_settings")
        .select("blocked_hours_utc")
        .eq("id", 1)
        .maybeSingle();
      cache = parseBlockedHours((data as any)?.blocked_hours_utc);
      fetchedAt = Date.now();
    } catch {
      /* keep last known value */
    } finally {
      inflight = null;
    }
    return cache;
  })();
  return inflight;
}
