import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveBridgeAuth } from "@/lib/bridge-auth.server";

// Open-position reconciliation.
//
// GET  → the tickets the dashboard still believes are open, so the bridge can
//        compare them against `positions_get()` + MT5 deal history.
// POST → the bridge's verdict per ticket:
//          verified  : still open on the broker (refresh last_seen only)
//          closed    : real close data recovered from history (backfilled)
//          missing   : not on the broker and not in the reachable history
//
// Order entry, trailing and the existing /trades reporting path are untouched.

/** A missing ticket younger than this may just be an MT5 history gap. */
const FLAG_AFTER_DAYS = 10;

const VerdictSchema = z.object({
  verdicts: z
    .array(
      z.object({
        mt5_ticket: z.number().int(),
        state: z.enum(["verified", "closed", "missing"]),
        exit: z.number().nullable().optional(),
        profit: z.number().nullable().optional(),
        lot: z.number().positive().nullable().optional(),
        closed_at: z
          .string()
          .nullable()
          .optional()
          .refine((v) => v == null || !Number.isNaN(Date.parse(v)), "invalid timestamp")
          .transform((v) => (v == null ? v : new Date(v).toISOString())),
      }),
    )
    .max(500),
});

export const Route = createFileRoute("/api/public/bridge/reconcile")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await resolveBridgeAuth(request);
        if ("response" in auth) return auth.response;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let q = supabaseAdmin
          .from("trades")
          .select("id,mt5_ticket,symbol,side,entry,lot,opened_at,needs_review")
          .eq("status", "open")
          .not("mt5_ticket", "is", null)
          .order("opened_at", { ascending: true })
          .limit(500);
        if (auth.userId) q = q.eq("user_id", auth.userId);

        const { data, error } = await q;
        if (error) return Response.json({ error: error.message }, { status: 500 });
        return Response.json({ open: data ?? [], flag_after_days: FLAG_AFTER_DAYS });
      },

      POST: async ({ request }) => {
        const auth = await resolveBridgeAuth(request);
        if ("response" in auth) return auth.response;
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        const parsed = VerdictSchema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const flagCutoff = Date.now() - FLAG_AFTER_DAYS * 24 * 60 * 60 * 1000;
        let closed = 0;
        let flagged = 0;
        let verified = 0;

        for (const v of parsed.data.verdicts) {
          let sel = supabaseAdmin
            .from("trades")
            .select("id,opened_at,status")
            .eq("mt5_ticket", v.mt5_ticket)
            .eq("status", "open");
          if (auth.userId) sel = sel.eq("user_id", auth.userId);
          const { data: row } = await sel.maybeSingle();
          if (!row) continue;

          if (v.state === "verified") {
            verified++;
            continue;
          }

          if (v.state === "closed") {
            const { error } = await supabaseAdmin
              .from("trades")
              .update({
                status: "closed",
                exit: v.exit ?? null,
                profit: v.profit ?? null,
                ...(v.lot != null ? { lot: v.lot } : {}),
                closed_at: v.closed_at ?? new Date().toISOString(),
                needs_review: false,
                reconcile_note: "Backfilled from MT5 deal history by bridge reconciliation",
              })
              .eq("id", row.id);
            if (!error) closed++;
            console.log(
              `[RECONCILE] backfilled ticket=${v.mt5_ticket} exit=${v.exit ?? "?"} profit=${v.profit ?? "?"}`,
            );
            continue;
          }

          // missing: broker knows nothing about it. Only auto-flag once it is
          // genuinely old — a young ticket may simply be outside the history
          // window the bridge could query this cycle.
          if (Date.parse(row.opened_at) < flagCutoff) {
            const { error } = await supabaseAdmin
              .from("trades")
              .update({
                needs_review: true,
                reconcile_note: `Not found on broker after ${FLAG_AFTER_DAYS}+ days — flagged for review`,
              })
              .eq("id", row.id);
            if (!error) flagged++;
          }
        }

        // Safeguard sweep: anything still open past the window gets flagged even
        // if the bridge never mentioned it this cycle.
        await supabaseAdmin.rpc("flag_stale_open_trades", { _max_age_days: FLAG_AFTER_DAYS });

        return Response.json({ ok: true, verified, closed, flagged });
      },
    },
  },
});
