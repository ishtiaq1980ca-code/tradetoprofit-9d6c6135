import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkBridgeAuth } from "@/lib/bridge-auth.server";

// Early-exit queue. The browser strategy engine writes `close_requests` rows
// when a position's structural thesis is invalidated; the MT5 bridge polls this
// endpoint and closes those tickets at market. The order-entry and trailing
// paths are untouched.

const AckSchema = z.object({
  id: z.string().uuid(),
  ok: z.boolean(),
  error: z.string().optional().nullable(),
});

/** Requests older than this are dropped — a stale structure read must not fire. */
const MAX_AGE_MS = 10 * 60_000;
/** If the bridge leased a request but never acked, re-queue it after this. */
const LEASE_MS = 30_000;

export const Route = createFileRoute("/api/public/bridge/close_requests")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauth = await checkBridgeAuth(request);
        if (unauth) return unauth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const now = Date.now();
        const staleCutoff = new Date(now - MAX_AGE_MS).toISOString();
        const leaseCutoff = new Date(now - LEASE_MS).toISOString();

        await supabaseAdmin
          .from("close_requests")
          .update({ status: "expired", error: "stale structure read" })
          .in("status", ["pending", "sent"])
          .lt("created_at", staleCutoff);

        await supabaseAdmin
          .from("close_requests")
          .update({ status: "pending" })
          .eq("status", "sent")
          .lt("leased_at", leaseCutoff);

        const { data: rows, error } = await supabaseAdmin
          .from("close_requests")
          .select("id,mt5_ticket,symbol,side,reason,kind,created_at")
          .eq("status", "pending")
          .gte("created_at", staleCutoff)
          .order("created_at", { ascending: true })
          .limit(20);
        if (error) return Response.json({ error: error.message }, { status: 500 });

        if (rows?.length) {
          await supabaseAdmin
            .from("close_requests")
            .update({ status: "sent", leased_at: new Date().toISOString() })
            .in("id", rows.map((r) => r.id));
        }

        return Response.json({ requests: rows ?? [] });
      },

      POST: async ({ request }) => {
        const unauth = await checkBridgeAuth(request);
        if (unauth) return unauth;
        const parsed = AckSchema.safeParse(await request.json());
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { id, ok, error: err } = parsed.data;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin
          .from("close_requests")
          .update({
            status: ok ? "executed" : "failed",
            executed_at: new Date().toISOString(),
            error: ok ? null : (err ?? "close failed"),
          })
          .eq("id", id);
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
