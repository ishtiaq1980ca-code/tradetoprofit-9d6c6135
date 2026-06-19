import { createFileRoute } from "@tanstack/react-router";
import { checkBridgeAuth } from "@/lib/bridge-auth.server";

export const Route = createFileRoute("/api/public/bridge/poll")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauth = await checkBridgeAuth(request);
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

        const freshCutoff = new Date(Date.now() - 5 * 60_000).toISOString();
        const retryCutoff = new Date(Date.now() - 20_000).toISOString();
        await supabaseAdmin
          .from("signals")
          .update({ status: "expired" })
          .in("status", ["pending", "sent"])
          .is("executed_at", null)
          .lt("created_at", freshCutoff);

        // If the bridge picked up a signal but crashed, lost network, or failed
        // before reporting the MT5 result, do not let that signal disappear.
        // Re-queue fresh "sent" signals after a short lease timeout so the
        // next poll can execute/report them instead of letting them expire.
        await supabaseAdmin
          .from("signals")
          .update({ status: "pending" })
          .eq("status", "sent")
          .is("executed_at", null)
          .gte("created_at", freshCutoff)
          .lt("created_at", retryCutoff);

        const { data: signals } = await supabaseAdmin
          .from("signals")
          .select("*")
          .eq("status", "pending")
          .gte("created_at", freshCutoff)
          .order("created_at", { ascending: true })
          .limit(6);

        if (signals?.length) {
          await supabaseAdmin
            .from("signals")
            .update({ status: "sent" })
            .in("id", signals.map((s) => s.id));
        }

        return Response.json({ enabled: true, mode: settings.account_mode, signals: signals ?? [] });
      },
    },
  },
});
