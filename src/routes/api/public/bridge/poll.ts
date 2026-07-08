import { createFileRoute } from "@tanstack/react-router";
import { checkBridgeAuth } from "@/lib/bridge-auth.server";

const MIN_BRIDGE_RR = 1.8;
const MIN_BRIDGE_VERSION = 2026070802;

function signalRiskError(signal: any): string | null {
  const side = signal.side;
  const entry = Number(signal.entry);
  const sl = Number(signal.stop_loss);
  const tp = Number(signal.take_profit);
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp) || entry <= 0) return "invalid signal prices";
  if (side === "BUY" && !(sl < entry && entry < tp)) return `invalid BUY stops: sl=${sl} entry=${entry} tp=${tp}`;
  if (side === "SELL" && !(tp < entry && entry < sl)) return `invalid SELL stops: tp=${tp} entry=${entry} sl=${sl}`;
  const rr = Math.abs(tp - entry) / Math.max(Math.abs(entry - sl), 1e-9);
  if (rr < MIN_BRIDGE_RR) return `TP/SL ratio ${rr.toFixed(2)} below minimum ${MIN_BRIDGE_RR.toFixed(1)}`;
  return null;
}

export const Route = createFileRoute("/api/public/bridge/poll")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const unauth = await checkBridgeAuth(request);
        if (unauth) return unauth;
        const bridgeVersion = Number(request.headers.get("x-aurum-bridge-version") ?? 0);
        if (!Number.isFinite(bridgeVersion) || bridgeVersion < MIN_BRIDGE_VERSION) {
          return Response.json(
            {
              enabled: false,
              reason: "bridge_update_required",
              requiredVersion: MIN_BRIDGE_VERSION,
              message: "Download the latest aurumai_bridge.py from the MT5 Bridge page.",
              signals: [],
            },
            { status: 426 },
          );
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: settings } = await supabaseAdmin.from("bot_settings").select("*").eq("id", 1).maybeSingle();
        if (!settings?.enabled) return Response.json({ enabled: false, signals: [] });

        // Do not lease signals to a dead/stale bridge. The Python bridge posts
        // an account heartbeat before polling; if that heartbeat is old, MT5 is
        // offline or the old script is still running and trades would be missed.
        const { data: latestSnap } = await supabaseAdmin
          .from("account_snapshots")
          .select("balance,daily_pnl,created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const heartbeatAgeMs = latestSnap?.created_at ? Date.now() - new Date(latestSnap.created_at).getTime() : Infinity;
        if (heartbeatAgeMs > 90_000) {
          return Response.json({ enabled: false, reason: "mt5_stale", signals: [] });
        }

        // Daily loss kill switch + daily profit target halt
        const today = new Date(); today.setUTCHours(0, 0, 0, 0);
        if (latestSnap?.created_at && new Date(latestSnap.created_at) >= today && Number(latestSnap.balance) > 0) {
          const dailyPnl = Number(latestSnap.daily_pnl);
          const balance = Number(latestSnap.balance);
          const lossPct = -(dailyPnl / balance) * 100;
          if (lossPct >= Number(settings.max_daily_loss)) {
            return Response.json({ enabled: false, reason: "daily_loss_limit", signals: [] });
          }
          const profitTarget = Number((settings as any).daily_profit_target ?? 0);
          if (profitTarget > 0) {
            const profitPct = (dailyPnl / balance) * 100;
            if (profitPct >= profitTarget) {
              return Response.json({ enabled: false, reason: "daily_profit_target", signals: [] });
            }
          }
        }

        const freshCutoff = new Date(Date.now() - 20_000).toISOString();
        const retryCutoff = new Date(Date.now() - 3_000).toISOString();
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
          .limit(20);

        const executableSignals = [];
        const rejectedSignals: Array<{ id: string; reason: string }> = [];
        for (const signal of signals ?? []) {
          const reason = signalRiskError(signal);
          if (reason) rejectedSignals.push({ id: signal.id, reason });
          else executableSignals.push(signal);
        }

        if (rejectedSignals.length) {
          await Promise.all(rejectedSignals.map((signal) =>
            supabaseAdmin
              .from("signals")
              .update({ status: "rejected", reason: `SERVER-REJECT ${signal.reason}` })
              .eq("id", signal.id),
          ));
        }

        if (executableSignals.length) {
          await supabaseAdmin
            .from("signals")
            .update({ status: "sent" })
            .in("id", executableSignals.map((s) => s.id));
        }

        return Response.json({ enabled: true, mode: settings.account_mode, signals: executableSignals });
      },
    },
  },
});
