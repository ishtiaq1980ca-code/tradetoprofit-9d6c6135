import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { resolveBridgeAuth } from "@/lib/bridge-auth.server";
import { isDegenerateStop } from "@/lib/bridgeVersion";


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
  failure_reason: z.string().max(500).nullable().optional(),
});

export const Route = createFileRoute("/api/public/bridge/trades")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await resolveBridgeAuth(request);
        if ("response" in auth) return auth.response;
        const body = await request.json();
        const parsed = Schema.safeParse(body);
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const d = parsed.data;
        const { failure_reason: failureReason, ...tradeBase } = d;
        // Attach the owning user_id derived from the license token used by the
        // bridge so SELECT RLS can scope trades to their owner.
        const tradeRow: Record<string, unknown> = { ...tradeBase, user_id: auth.userId };

        // HARD SERVER-SIDE GUARD — a stop-loss parked on the entry price turns
        // every retrace into a 0.00 round-trip close. An older bridge process
        // (pre-2026080301 break-even rule) reports exactly that. Never persist
        // it: for updates we keep whatever stop-loss is already on record, for
        // fresh rows we store nothing rather than a fake "SL = entry".
        const degenerateStop = d.status === "open" && isDegenerateStop(d.entry, d.stop_loss ?? null, d.symbol);
        if (degenerateStop) {
          delete tradeRow["stop_loss"];
          console.error(
            `[BRIDGE-GUARD] Refused stop_loss=entry report symbol=${d.symbol} ticket=${d.mt5_ticket ?? "?"} ` +
              `entry=${d.entry} stop_loss=${d.stop_loss} — outdated bridge break-even rule suspected.`,
          );
        }

        const rejectedSignalUpdate = async () => {
          if (!failureReason || !d.signal_id) return { status: "rejected", mt5_ticket: d.mt5_ticket ?? null };
          const { data: sig } = await supabaseAdmin.from("signals").select("reason").eq("id", d.signal_id).maybeSingle();
          return { status: "rejected", mt5_ticket: d.mt5_ticket ?? null, reason: `${sig?.reason ?? ""}\n  MT5-REJECT ${failureReason}`.trim() };
        };
        const signalUpdateForStatus = async () => {
          if (d.status === "open") return { status: "executed", mt5_ticket: d.mt5_ticket ?? null, executed_at: new Date().toISOString() };
          if (d.status === "closed") return { status: "executed", mt5_ticket: d.mt5_ticket ?? null };
          return rejectedSignalUpdate();
        };
        if (d.mt5_ticket) {
          const { data: existing } = await supabaseAdmin.from("trades").select("id").eq("mt5_ticket", d.mt5_ticket).maybeSingle();
          if (existing) {
            const { error } = await supabaseAdmin.from("trades").update(tradeRow).eq("id", existing.id);
            if (error) return Response.json({ error: error.message }, { status: 500 });
            if (d.signal_id) {
              await supabaseAdmin
                .from("signals")
                .update(await signalUpdateForStatus())
                .eq("id", d.signal_id);
            }
            return Response.json({ ok: true, updated: true });
          }
        }
        const { data: ins, error } = await supabaseAdmin.from("trades").insert(tradeRow).select("id").single();
        if (error) return Response.json({ error: error.message }, { status: 500 });
        if (d.signal_id) {
          await supabaseAdmin
            .from("signals")
            .update(await signalUpdateForStatus())
            .eq("id", d.signal_id);
        }
        return Response.json({ ok: true, id: ins.id });
      },
    },
  },
});
