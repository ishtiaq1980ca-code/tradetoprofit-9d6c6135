import { createFileRoute } from "@tanstack/react-router";
import { checkBridgeAuth } from "@/lib/bridge-auth.server";

export const Route = createFileRoute("/api/public/bridge/poll")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauth = checkBridgeAuth(request);
        if (unauth) return unauth;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: settings } = await supabaseAdmin.from("bot_settings").select("*").eq("id", 1).maybeSingle();
        if (!settings?.enabled) return Response.json({ enabled: false, signals: [] });

        // Daily loss kill switch
        const today = new Date(); today.setUTCHours(0, 0, 0, 0);
        const { data: snaps } = await supabaseAdmin
          .from("account_snapshots")
          .select("balance,daily_pnl,created_at")
          .gte("created_at", today.toISOString())
          .order("created_at", { ascending: false })
          .limit(1);
        const snap = snaps?.[0];
        if (snap && snap.balance > 0) {
          const lossPct = -(Number(snap.daily_pnl) / Number(snap.balance)) * 100;
          if (lossPct >= Number(settings.max_daily_loss)) {
            return Response.json({ enabled: false, reason: "daily_loss_limit", signals: [] });
          }
        }

        const freshCutoff = new Date(Date.now() - 2 * 60_000).toISOString();
        await supabaseAdmin
          .from("signals")
          .update({ status: "expired" })
          .in("status", ["pending", "sent"])
          .is("executed_at", null)
          .lt("created_at", freshCutoff);

        const { data: signals } = await supabaseAdmin
          .from("signals")
          .select("*")
          .eq("status", "pending")
          .gte("created_at", freshCutoff)
          .order("created_at", { ascending: true })
          .limit(10);
        return Response.json({ enabled: true, mode: settings.account_mode, signals: signals ?? [] });
      },
    },
  },
});
