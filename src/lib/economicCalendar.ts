// Economic news filter.
//
// AUTOMATIC BY DEFAULT: the app ships with a server-side proxy
// (/api/public/calendar) that mirrors the free, no-API-key Forex Factory
// weekly calendar feed (nfs.faireconomy.media). The upstream feed sends no
// CORS headers, so it is fetched server-side and normalized there. The store
// refreshes it on load and hourly afterwards — no manual entry required.
// The manual event list remains as a supplementary/admin fallback.
//
// Trading impact: when a high-impact event for either currency of a pair falls
// inside [event - bufferBeforeMin, event + bufferAfterMin], NEW entries for
// that pair are blocked. Existing positions are never touched.


import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { normalizeSymbol } from "./pairProfiles";

export type NewsImpact = "high" | "medium";

export type CalendarEvent = {
  id: string;
  title: string;        // "FOMC Rate Decision", "NFP", "CPI y/y"
  currency: string;     // "USD", "EUR", "XAU" ...
  impact: NewsImpact;
  at: number;           // unix ms of the release
  source: "manual" | "feed";
};

export type NewsBlock = {
  blocked: boolean;
  event?: CalendarEvent;
  /** Minutes until the release (negative once it has happened). */
  minutesUntil?: number;
  reason: string;
};

/** Currencies involved in a symbol, suffix-safe (EURUSDm → EUR + USD). */
export function currenciesOf(symbol: string): string[] {
  const s = normalizeSymbol(symbol);
  if (s.length < 6) return [s];
  return [s.slice(0, 3), s.slice(3, 6)];
}

export const DEFAULT_FEED_URL = "/api/public/calendar";

type Store = {
  enabled: boolean;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  /** Block on medium-impact events too (default: high only). */
  includeMedium: boolean;
  feedUrl: string;
  events: CalendarEvent[];
  lastFeedFetch: number;
  /** Last fetch that actually succeeded (0 = never). */
  lastFeedOk: number;
  /** Last time the SERVER successfully pulled the upstream feed (0 = never). */
  serverLastOk: number;
  /** Which upstream mirror the server last used. */
  serverSource: string | null;
  lastFeedError: string | null;
  feedLoading: boolean;


  setEnabled: (v: boolean) => void;
  setBufferBefore: (n: number) => void;
  setBufferAfter: (n: number) => void;
  setIncludeMedium: (v: boolean) => void;
  setFeedUrl: (u: string) => void;
  addEvent: (e: Omit<CalendarEvent, "id" | "source"> & { source?: CalendarEvent["source"] }) => void;
  removeEvent: (id: string) => void;
  clearPast: () => void;
  mergeFeed: (events: CalendarEvent[]) => void;
};

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

const feedKey = (e: CalendarEvent) => `${e.at}|${e.currency}|${e.title}`;

export const useEconomicCalendar = create<Store>()(
  persist(
    (set, get) => ({
      enabled: true,
      bufferBeforeMin: 30,
      bufferAfterMin: 15,
      includeMedium: false,
      feedUrl: DEFAULT_FEED_URL,
      events: [],
      lastFeedFetch: 0,
      lastFeedOk: 0,
      serverLastOk: 0,
      serverSource: null,
      lastFeedError: null,
      feedLoading: false,


      setEnabled: (v) => set({ enabled: v }),
      setBufferBefore: (n) => set({ bufferBeforeMin: Math.max(0, Math.min(240, n)) }),
      setBufferAfter: (n) => set({ bufferAfterMin: Math.max(0, Math.min(240, n)) }),
      setIncludeMedium: (v) => set({ includeMedium: v }),
      setFeedUrl: (u) => set({ feedUrl: u.trim() || DEFAULT_FEED_URL }),
      addEvent: (e) =>
        set({
          events: [
            ...get().events,
            { id: uid(), source: e.source ?? "manual", title: e.title, currency: e.currency.toUpperCase(), impact: e.impact, at: e.at },
          ].sort((a, b) => a.at - b.at),
        }),
      removeEvent: (id) => set({ events: get().events.filter((e) => e.id !== id) }),
      clearPast: () => {
        const cutoff = Date.now() - 6 * 3600_000;
        set({ events: get().events.filter((e) => e.at >= cutoff) });
      },
      mergeFeed: (incoming) => {
        const cutoff = Date.now() - 6 * 3600_000;
        const manual = get().events.filter((e) => e.source === "manual");
        // Keep previously-known future feed events so the filter doesn't go
        // blind when the weekly file rolls over.
        const known = new Map<string, CalendarEvent>();
        for (const e of get().events) if (e.source === "feed" && e.at >= cutoff) known.set(feedKey(e), e);
        for (const e of incoming) if (e.at >= cutoff) known.set(feedKey(e), e);
        set({
          events: [...manual, ...known.values()].sort((a, b) => a.at - b.at),
          lastFeedFetch: Date.now(),
          lastFeedOk: Date.now(),
          lastFeedError: null,
        });
      },
    }),
    {
      name: "aurum-econ-calendar-v2",
      version: 2,
      migrate: (state: any) => ({ ...state, feedUrl: state?.feedUrl?.trim() || DEFAULT_FEED_URL }),
      partialize: (s) => ({
        enabled: s.enabled,
        bufferBeforeMin: s.bufferBeforeMin,
        bufferAfterMin: s.bufferAfterMin,
        includeMedium: s.includeMedium,
        feedUrl: s.feedUrl,
        events: s.events.filter((e) => e.source === "manual"),
      }),
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : (undefined as any))),
    },
  ),
);


/** Upcoming (not yet expired) events, soonest first. */
export function upcomingEvents(now = Date.now()): CalendarEvent[] {
  const st = useEconomicCalendar.getState();
  return st.events
    .filter((e) => e.at + st.bufferAfterMin * 60_000 >= now)
    .sort((a, b) => a.at - b.at);
}

function relevant(e: CalendarEvent, includeMedium: boolean) {
  return e.impact === "high" || (includeMedium && e.impact === "medium");
}

/** Feed uses "ALL" for global events (OPEC, G20) — those affect every symbol. */
function affects(e: CalendarEvent, ccys: string[]) {
  const c = e.currency.toUpperCase();
  return c === "ALL" || ccys.includes(c);
}

/** Is this symbol inside a news blackout window right now? */
export function newsBlockFor(symbol: string, now = Date.now()): NewsBlock {
  const st = useEconomicCalendar.getState();
  if (!st.enabled) return { blocked: false, reason: "News filter disabled" };
  const ccys = currenciesOf(symbol);
  const before = st.bufferBeforeMin * 60_000;
  const after = st.bufferAfterMin * 60_000;

  for (const e of st.events) {
    if (!relevant(e, st.includeMedium)) continue;
    if (!affects(e, ccys)) continue;
    if (now >= e.at - before && now <= e.at + after) {
      const minutesUntil = Math.round((e.at - now) / 60_000);
      const phrase = minutesUntil >= 0 ? `in ${minutesUntil} min` : `${Math.abs(minutesUntil)} min ago`;
      return {
        blocked: true,
        event: e,
        minutesUntil,
        reason: `${e.currency} high-impact news: ${e.title} ${phrase} — entries paused`,
      };
    }
  }
  return { blocked: false, reason: "No high-impact news window" };
}

/** Next relevant event for a symbol (may be outside the blackout window). */
export function nextEventFor(symbol: string, now = Date.now()): CalendarEvent | null {
  const st = useEconomicCalendar.getState();
  const ccys = currenciesOf(symbol);
  return (
    st.events
      .filter((e) => relevant(e, st.includeMedium) && affects(e, ccys) && e.at + st.bufferAfterMin * 60_000 >= now)
      .sort((a, b) => a.at - b.at)[0] ?? null
  );
}

/** Count of upcoming high-impact events currently known (feed + manual). */
export function upcomingHighImpactCount(now = Date.now()): number {
  return useEconomicCalendar.getState().events.filter((e) => e.impact === "high" && e.at >= now).length;
}

// ------------------------------ automatic feed ------------------------------
// Default source: /api/public/calendar — a server-side proxy of the free
// Forex Factory weekly JSON (nfs.faireconomy.media), which has no CORS headers
// and therefore cannot be fetched from the browser directly.
//
// Accepted shapes:
//   { events: [{ title, currency|country, impact, at|date }] }  (our proxy)
//   [{ title, currency|country, impact, at|date }]              (raw feed)

function parseFeed(raw: unknown): CalendarEvent[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.events) ? (raw as any).events : [];
  const out: CalendarEvent[] = [];
  for (const r of arr as any[]) {
    const impactRaw = String(r?.impact ?? r?.importance ?? "").toLowerCase();
    const impact: NewsImpact | null = impactRaw.includes("high") || impactRaw === "3"
      ? "high"
      : impactRaw.includes("medium") || impactRaw.includes("moderate") || impactRaw === "2"
        ? "medium"
        : null;
    if (!impact) continue; // ignores Low / Holiday rows
    const when = r?.at ?? r?.date ?? r?.time ?? r?.timestamp;
    const at = typeof when === "number" ? (when < 1e12 ? when * 1000 : when) : Date.parse(String(when));
    const currency = String(r?.currency ?? r?.country ?? "").toUpperCase().trim().slice(0, 3);
    const title = String(r?.title ?? r?.event ?? "Economic release");
    if (!isFinite(at) || !currency) continue;
    out.push({ id: uid(), title, currency, impact, at, source: "feed" });
  }
  return out;
}

let feedInFlight = false;

/**
 * Refresh from the app's own server cache (`/api/public/calendar`).
 * The server owns the upstream fetch, so this call never touches the
 * rate-limited external feed — any number of tabs can poll it safely.
 */
export async function refreshCalendarFeed(force = false): Promise<void> {
  const st = useEconomicCalendar.getState();
  const base = st.feedUrl || DEFAULT_FEED_URL;
  const url = force && base === DEFAULT_FEED_URL ? `${base}?force=1` : base;
  if (feedInFlight) return;
  if (!force && Date.now() - st.lastFeedFetch < 10 * 60_000) return;
  feedInFlight = true;
  useEconomicCalendar.setState({ feedLoading: true });
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const json: any = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error ?? `feed HTTP ${res.status}`);
    const parsed = parseFeed(json);
    if (parsed.length === 0) throw new Error(json?.error ?? "feed returned no usable events");
    useEconomicCalendar.getState().mergeFeed(parsed);
    useEconomicCalendar.setState({
      serverLastOk: typeof json?.lastOk === "number" ? json.lastOk : 0,
      serverSource: json?.source ?? null,
      lastFeedError: json?.warning ?? null,
    });
  } catch (e: any) {
    useEconomicCalendar.setState({ lastFeedError: e?.message ?? "feed fetch failed", lastFeedFetch: Date.now() });
  } finally {
    feedInFlight = false;
    useEconomicCalendar.setState({ feedLoading: false });
  }
}


let autoTimer: number | null = null;

/** Start the automatic hourly refresh (browser only, idempotent). */
export function startCalendarAutoRefresh(): void {
  if (typeof window === "undefined" || autoTimer !== null) return;
  void refreshCalendarFeed(true);
  autoTimer = window.setInterval(() => void refreshCalendarFeed(), 15 * 60_000);
  window.addEventListener("online", () => void refreshCalendarFeed(true));
}

