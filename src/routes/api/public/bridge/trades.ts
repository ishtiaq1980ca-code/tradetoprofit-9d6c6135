import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkBridgeAuth } from "@/lib/bridge-auth.server";

const Schema = z.object({
  signal_id: z.string().uuid().nullable().optional(),
  mt5_ticket: z.number().int().nullable().optional(),
  symbol: z.string().min(1).max(20),
  side: z.enum(["BUY", "SELL"]),
  entry: z.number(),
  exit: z.number().nullable().optional(),
  stop_loss: z.number().nullable().optional(),
  take_profit: z.number().nullable().optional(),
  lot: z.number().positive(),
  profit: z.number().nullable().optional(),
  pips: z.number().nullable().optional(),
  status: z.enum(["open", "closed", "cancelled"]).default("open"),
  closed_at: z.string().datetime().nullable().optional(),
});

export const Route = createFileRoute("/api/public/bridge/trades")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = await checkBridgeAuth(request);
        if (unauth) return unauth;
        const body = await request.json();
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const d = parsed.data;
        if (d.mt5_ticket) {
          const { data: existing } = await supabaseAdmin.from("trades").select("id").eq("mt5_ticket", d.mt5_ticket).maybeSingle();
          if (existing) {
            const { error } = await supabaseAdmin.from("trades").update(d).eq("id", existing.id);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            if (d.signal_id) {
              await supabaseAdmin
                .from("signals")
                .update(d.status === "open"
                  ? { status: "executed", mt5_ticket: d.mt5_ticket, executed_at: new Date().toISOString() }
                  : { status: "rejected", mt5_ticket: d.mt5_ticket ?? null })
                .eq("id", d.signal_id);
            }
            return Response.json({ ok: true, updated: true });
          }
        }
        const { data: ins, error } = await supabaseAdmin.from("trades").insert(d).select("id").single();
        if (error) return Response.json({ error: error.message }, { status: 500 });
        if (d.signal_id) {
          await supabaseAdmin
            .from("signals")
            .update(d.status === "open"
              ? { status: "executed", mt5_ticket: d.mt5_ticket ?? null, executed_at: new Date().toISOString() }
              : { status: "rejected", mt5_ticket: d.mt5_ticket ?? null })
            .eq("id", d.signal_id);
        }
        return Response.json({ ok: true, id: ins.id });
      },
    },
  },
});
