// Market session detection (UTC-based). Returns the most active overlapping
// session for the given UTC time. Hours are approximate broker conventions.
export type MarketSession = "Sydney" | "Tokyo" | "London" | "New York" | "Closed";

const SESSIONS: { name: Exclude<MarketSession, "Closed">; startUtc: number; endUtc: number }[] = [
  { name: "Sydney", startUtc: 22, endUtc: 7 },     // 22:00 → 07:00 UTC
  { name: "Tokyo", startUtc: 0, endUtc: 9 },       // 00:00 → 09:00 UTC
  { name: "London", startUtc: 7, endUtc: 16 },     // 07:00 → 16:00 UTC
  { name: "New York", startUtc: 12, endUtc: 21 },  // 12:00 → 21:00 UTC
];

function inRange(h: number, start: number, end: number) {
  return start <= end ? h >= start && h < end : h >= start || h < end;
}

/** Returns active sessions array and the "primary" (highest-liquidity) session. */
export function activeSessions(now: Date = new Date()): {
  active: Exclude<MarketSession, "Closed">[];
  primary: MarketSession;
  weekend: boolean;
} {
  const day = now.getUTCDay(); // 0 Sun, 6 Sat
  const h = now.getUTCHours();
  // Forex week: closes Fri 21:00 UTC, opens Sun 22:00 UTC.
  const weekend = (day === 6) || (day === 0 && h < 22) || (day === 5 && h >= 21);
  if (weekend) return { active: [], primary: "Closed", weekend: true };
  const active = SESSIONS.filter((s) => inRange(h, s.startUtc, s.endUtc)).map((s) => s.name);
  // Primary preference: London/NY overlap > London > NY > Tokyo > Sydney
  const pref: MarketSession[] = ["London", "New York", "Tokyo", "Sydney"];
  const primary = (pref.find((p) => active.includes(p as any)) as MarketSession) ?? "Closed";
  return { active, primary, weekend: false };
}

export function isMarketOpen(now: Date = new Date()): boolean {
  return !activeSessions(now).weekend;
}
