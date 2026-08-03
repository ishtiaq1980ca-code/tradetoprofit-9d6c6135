// Server-side proxy for the public Forex Factory calendar mirror.
// The upstream feed (nfs.faireconomy.media) sends NO CORS headers, so the
// browser cannot fetch it directly. This route fetches it server-side and
// returns a normalized, CORS-enabled payload.

import { createFileRoute } from "@tanstack/react-router";

const SOURCES = [
  "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
  // Only "thisweek" exists today; extra slots are tried and skipped if 404.
  "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

type Out = { title: string; currency: string; impact: "high" | "medium"; at: number };

function normalize(raw: unknown): Out[] {
  if (!Array.isArray(raw)) return [];
  const out: Out[] = [];
  for (const r of raw as any[]) {
    const imp = String(r?.impact ?? "").toLowerCase();
    const impact: Out["impact"] | null = imp === "high" ? "high" : imp === "medium" ? "medium" : null;
    if (!impact) continue; // skips Low + Holiday
    const at = Date.parse(String(r?.date ?? ""));
    if (!isFinite(at)) continue;
    const currency = String(r?.country ?? "").toUpperCase().trim();
    if (!currency) continue;
    out.push({ title: String(r?.title ?? "Economic release"), currency, impact, at });
  }
  return out.sort((a, b) => a.at - b.at);
}

export const Route = createFileRoute("/api/public/calendar")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        const events: Out[] = [];
        const errors: string[] = [];
        for (const url of SOURCES) {
          try {
            const res = await fetch(url, { headers: { Accept: "application/json" } });
            if (!res.ok) {
              if (res.status !== 404) errors.push(`${url.split("/").pop()}: HTTP ${res.status}`);
              continue;
            }
            events.push(...normalize(await res.json()));
          } catch (e: any) {
            errors.push(`${url.split("/").pop()}: ${e?.message ?? "fetch failed"}`);
          }
        }
        // De-duplicate across weekly files.
        const seen = new Set<string>();
        const unique = events.filter((e) => {
          const k = `${e.at}|${e.currency}|${e.title}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        if (unique.length === 0 && errors.length > 0) {
          return Response.json(
            { error: errors.join("; "), events: [] },
            { status: 502, headers: { ...CORS } },
          );
        }
        return Response.json(
          { events: unique, fetchedAt: Date.now(), errors },
          { headers: { ...CORS, "Cache-Control": "public, max-age=300" } },
        );
      },
    },
  },
});
