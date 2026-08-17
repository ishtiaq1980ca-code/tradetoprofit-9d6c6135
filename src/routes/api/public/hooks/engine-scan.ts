// Scheduled trading-engine tick.
//
// Called once a minute by pg_cron. Each invocation:
//   1. takes a DB lock so two runs can never overlap,
//   2. loads the persisted candle history + a fresh price anchor,
//   3. ticks the synthetic price walk every 5s for ~50s (mirrors the browser
//      feed cadence) and runs the full scan twice inside that window,
//   4. persists the candle history and releases the lock.
//
// The MT5 path is untouched: the engine only writes `signals` and
// `close_requests`; aurumai_bridge.py + /api/public/bridge/* still own
// execution exactly as before.

import { createFileRoute } from "@tanstack/react-router";

import { loadFeed, refreshMarketData, saveFeed } from "@/lib/serverEngine/feed.server";
import { runServerScan, type ScanSummary } from "@/lib/serverEngine/scan.server";

const LOCK_TTL_MS = 110_000;
/** Two passes per invocation, ~30s apart, so a fresh 1m bar is picked up. */
const PASSES = 2;
const PASS_GAP_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;

  const holder = crypto.randomUUID();
  const until = new Date(Date.now() + LOCK_TTL_MS).toISOString();

  // Overlap guard: only the run that wins this conditional update proceeds.
  const { data: locked } = await admin
    .from("engine_lock")
    .update({ locked_until: until, holder })
    .eq("id", 1)
    .lt("locked_until", new Date().toISOString())
    .select("id");

  if (!locked?.length) {
    return new Response(JSON.stringify({ ok: true, skipped: "another engine run is in progress" }), {
      headers: { "content-type": "application/json" },
    });
  }

  const summaries: ScanSummary[] = [];
  try {
    const feed = await loadFeed(admin);
    applyAnchors(feed, await fetchAnchors());

    for (let i = 0; i < TICKS; i++) {
      tick(feed);
      if (i % SCAN_EVERY_TICKS === 0) {
        try {
          summaries.push(await runServerScan(admin, feed));
        } catch (e: any) {
          summaries.push({ ran: false, reason: `scan error: ${e?.message ?? e}`, queued: 0, evaluated: 0, closesQueued: 0, notes: [] });
        }
      }
      if (i < TICKS - 1) await sleep(TICK_MS);
    }

    await saveFeed(admin, feed);

    const result = {
      queued: summaries.reduce((a, s) => a + s.queued, 0),
      closesQueued: summaries.reduce((a, s) => a + s.closesQueued, 0),
      evaluated: summaries.reduce((a, s) => a + s.evaluated, 0),
      reasons: summaries.map((s) => s.reason).filter(Boolean),
      // Rejection reasons from the most recent inner scan — this is what makes
      // "queued: 0" explainable instead of silent.
      notes: (summaries[summaries.length - 1]?.notes ?? []).slice(0, 60),
    };
    await admin.from("engine_lock").update({
      last_run_at: new Date().toISOString(),
      last_result: result,
    }).eq("id", 1);

    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { "content-type": "application/json" },
    });
  } finally {
    // Always release, even on failure, so the next cron tick can run.
    await admin
      .from("engine_lock")
      .update({ locked_until: new Date().toISOString() })
      .eq("id", 1)
      .eq("holder", holder);
  }
}

export const Route = createFileRoute("/api/public/hooks/engine-scan")({
  server: {
    handlers: {
      POST: async () => {
        try {
          return await handle();
        } catch (e: any) {
          console.error("[engine-scan]", e);
          return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      },
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data } = await (supabaseAdmin as any)
          .from("engine_lock")
          .select("locked_until,last_run_at,last_result")
          .eq("id", 1)
          .maybeSingle();
        return new Response(JSON.stringify({ ok: true, status: data ?? null }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
