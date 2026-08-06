// Server-side, database-cached economic calendar.
//
// Browsers NEVER hit the upstream feed. They call this route, which serves
// rows from `public.economic_events`. The upstream (rate-limited, no-CORS)
// feed is refreshed at most once every REFRESH_MS by the server, with
// exponential backoff after failures (429s especially) and multiple
// fallback mirrors so the filter degrades gracefully instead of going blind.

import { createFileRoute } from "@tanstack/react-router";

const RAW = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

type Out = { title: string; currency: string; impact: "high" | "medium"; at: number };
type Source = { name: string; url: () => string; parse: (raw: unknown) => Out[] };

/** Forex Factory weekly JSON shape. */
function parseFF(raw: unknown): Out[] {
  if (!Array.isArray(raw)) return [];
  const out: Out[] = [];
  for (const r of raw as any[]) {
    const imp = String(r?.impact ?? "").toLowerCase();
    const impact: Out["impact"] | null = imp === "high" ? "high" : imp === "medium" ? "medium" : null;
    if (!impact) continue; // skips Low + Holiday
    const at = Date.parse(String(r?.date ?? ""));
    if (!isFinite(at)) continue;
    const currency = String(r?.country ?? r?.currency ?? "").toUpperCase().trim();
    if (!currency) continue;
    out.push({ title: String(r?.title ?? "Economic release"), currency, impact, at });
  }
  return out;
}

/** TradingView public economic-calendar JSON (importance: 1 high, 0 medium). */
function parseTV(raw: unknown): Out[] {
  const arr = (raw as any)?.result;
  if (!Array.isArray(arr)) return [];
  const out: Out[] = [];
  for (const r of arr as any[]) {
    if (String(r?.indicator ?? "").toLowerCase() === "holidays") continue;
    const imp = Number(r?.importance);
    const impact: Out["impact"] | null = imp >= 1 ? "high" : imp === 0 ? "medium" : null;
    if (!impact) continue;
    const at = Date.parse(String(r?.date ?? ""));
    if (!isFinite(at)) continue;
    const currency = String(r?.currency ?? r?.country ?? "").toUpperCase().trim();
    if (!currency) continue;
    out.push({ title: String(r?.title ?? "Economic release"), currency, impact, at });
  }
  return out;
}

const tvUrl = () => {
  const from = new Date(Date.now() - 24 * 3600_000).toISOString();
  const to = new Date(Date.now() + 14 * 24 * 3600_000).toISOString();
  return `https://economic-calendar.tradingview.com/events?from=${from}&to=${to}&countries=US,EU,JP,GB,AU,NZ,CA,CH,CN`;
};

// Ordered by preference. Later entries are only tried if earlier ones fail.
const SOURCES: Source[] = [
  { name: "faireconomy", url: () => RAW, parse: parseFF },
  { name: "tradingview", url: tvUrl, parse: parseTV },
  { name: "faireconomy-nextweek", url: () => "https://nfs.faireconomy.media/ff_calendar_nextweek.json", parse: parseFF },
  { name: "allorigins", url: () => `https://api.allorigins.win/raw?url=${encodeURIComponent(RAW)}`, parse: parseFF },
];

/** How long cached data is considered fresh (4 h — plenty for a weekly file). */
const REFRESH_MS = 4 * 60 * 60 * 1000;
/** Backoff after a failed refresh: 30 min, doubling up to 6 h. */
const BACKOFF_BASE_MS = 30 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; AurumAI/1.0)",
      Origin: "https://www.tradingview.com",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(await res.text());
}


export const Route = createFileRoute("/api/public/calendar")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const force = new URL(request.url).searchParams.get("force") === "1";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: stateRow } = await supabaseAdmin
          .from("calendar_feed_state")
          .select("*")
          .eq("id", 1)
          .maybeSingle();

        const now = Date.now();
        const lastOk = stateRow?.last_ok ? Date.parse(stateRow.last_ok) : 0;
        const backoffUntil = stateRow?.backoff_until ? Date.parse(stateRow.backoff_until) : 0;
        const stale = !lastOk || now - lastOk > REFRESH_MS;
        const backedOff = backoffUntil > now;
        const shouldRefresh = (force || stale) && (force || !backedOff);

        let lastError: string | null = stateRow?.last_error ?? null;
        let activeSource: string | null = stateRow?.active_source ?? null;

        if (shouldRefresh) {
          const errors: string[] = [];
          let events: Out[] | null = null;
          for (const src of SOURCES) {
            try {
              const parsed = src.parse(await fetchJson(src.url())).sort((a, b) => a.at - b.at);
              if (parsed.length === 0) throw new Error("no usable events");
              events = parsed;
              activeSource = src.name;
              break;
            } catch (e: any) {
              errors.push(`${src.name}: ${e?.message ?? "fetch failed"}`);
            }
          }

          if (events) {
            const cutoff = new Date(now - 24 * 3600_000).toISOString();
            await supabaseAdmin.from("economic_events").delete().lt("at", cutoff);
            const rows = events
              .filter((e) => e.at >= now - 24 * 3600_000)
              .map((e) => ({
                title: e.title,
                currency: e.currency,
                impact: e.impact,
                at: new Date(e.at).toISOString(),
                source: "feed",
              }));
            if (rows.length) {
              await supabaseAdmin.from("economic_events").upsert(rows, { onConflict: "at,currency,title" });
            }
            lastError = null;
            await supabaseAdmin
              .from("calendar_feed_state")
              .update({
                last_ok: new Date(now).toISOString(),
                last_attempt: new Date(now).toISOString(),
                last_error: null,
                backoff_until: null,
                event_count: rows.length,
                active_source: activeSource,
                updated_at: new Date(now).toISOString(),
              })
              .eq("id", 1);
          } else {
            // Exponential backoff from the previous window.
            const prev = backoffUntil && stateRow?.last_attempt
              ? backoffUntil - Date.parse(stateRow.last_attempt)
              : 0;
            const next = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_BASE_MS, prev * 2));
            lastError = errors.join("; ");
            await supabaseAdmin
              .from("calendar_feed_state")
              .update({
                last_attempt: new Date(now).toISOString(),
                last_error: lastError,
                backoff_until: new Date(now + next).toISOString(),
                updated_at: new Date(now).toISOString(),
              })
              .eq("id", 1);
          }
        }

        const { data: rows } = await supabaseAdmin
          .from("economic_events")
          .select("title, currency, impact, at")
          .gte("at", new Date(now - 12 * 3600_000).toISOString())
          .order("at", { ascending: true })
          .limit(500);

        const { data: fresh } = await supabaseAdmin
          .from("calendar_feed_state")
          .select("*")
          .eq("id", 1)
          .maybeSingle();

        const events = (rows ?? []).map((r) => ({
          title: r.title,
          currency: r.currency,
          impact: r.impact as "high" | "medium",
          at: Date.parse(r.at as unknown as string),
        }));

        return Response.json(
          {
            events,
            cached: true,
            lastOk: fresh?.last_ok ? Date.parse(fresh.last_ok) : null,
            lastAttempt: fresh?.last_attempt ? Date.parse(fresh.last_attempt) : null,
            backoffUntil: fresh?.backoff_until ? Date.parse(fresh.backoff_until) : null,
            source: fresh?.active_source ?? activeSource,
            error: events.length > 0 ? null : (fresh?.last_error ?? lastError),
            warning: events.length > 0 ? (fresh?.last_error ?? null) : null,
            fetchedAt: now,
          },
          { headers: { ...CORS, "Cache-Control": "public, max-age=300" } },
        );
      },
    },
  },
});
