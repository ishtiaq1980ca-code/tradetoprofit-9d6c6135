import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

type Snapshot = {
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  open_positions: number;
  daily_pnl: number;
  mode: string;
  created_at: string;
};

export function Mt5AccountPanel() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      const { data } = await supabase
        .from("account_snapshots")
        .select("balance,equity,margin,free_margin,open_positions,daily_pnl,mode,created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!alive) return;
      setSnap((data?.[0] as Snapshot) ?? null);
      setLoaded(true);
    }
    load();
    const id = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const ageMs = snap ? Date.now() - new Date(snap.created_at).getTime() : Infinity;
  const fresh = ageMs < 90_000;
  const status = !snap
    ? { label: "🔴 Offline", tone: "bear" as const }
    : ageMs < 20_000
      ? { label: "🟢 Connected", tone: "bull" as const }
      : ageMs < 45_000
        ? { label: "🟠 Recovering", tone: "muted" as const }
        : ageMs < 90_000
          ? { label: "🟡 Reconnecting", tone: "muted" as const }
          : { label: "🔴 Offline", tone: "bear" as const };
  const ageLabel = !snap ? "—" : ageMs < 60_000 ? `${Math.max(0, Math.round(ageMs / 1000))} sec ago` : `${Math.round(ageMs / 60_000)} min ago`;

  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-medium">Connected MT5 Account</CardTitle>
        <Badge variant="outline" className={cn(status.tone === "bull" ? "border-bull/40 text-bull" : status.tone === "bear" ? "border-bear/40 text-bear" : "border-border text-muted-foreground")}>
          {snap ? (snap.mode === "real" ? "LIVE" : "DEMO") : "—"} · {status.label}
        </Badge>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !snap ? (
          <p className="text-sm text-muted-foreground">
            No MT5 data yet. Start <code>aurumai_bridge.py</code> on your trading PC — balance, equity and trades will appear here.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground">
              <span>Heartbeat: <span className="text-foreground">{ageLabel}</span></span>
              <span>MT5: <span className={fresh ? "text-bull" : "text-bear"}>{fresh ? "Connected" : "Waiting"}</span></span>
              <span>Server: <span className="text-bull">Connected</span></span>
              <span>Bridge: <span className={outdatedBridge ? "text-bear" : "text-foreground"}>{snap.bridge_version ? `v${snap.bridge_version}` : "unknown"}</span></span>
            </div>
            {outdatedBridge && (
              <p className="rounded-md border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear">
                Outdated bridge running (v{snap.bridge_version ?? "?"} — required v{REQUIRED_BRIDGE_VERSION}). The old break-even rule parks the stop-loss exactly on the entry price, so winners close at 0.00.
                Close every <code>aurumai_bridge.py</code> window on your PC, re-download the bridge and start it again.
              </p>
            )}
            {!fresh && (
              <p className="rounded-md border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear">
                No MT5 heartbeat for over 90 seconds. The bridge self-heals automatically — keep <code>aurumai_bridge.py</code> running; it reconnects MT5, resends the heartbeat and resumes polling on its own.
              </p>
            )}


            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Balance" value={fmt.money(snap.balance)} />
              <Field label="Equity" value={fmt.money(snap.equity)} />
              <Field label="Free Margin" value={fmt.money(snap.free_margin)} />
              <Field label="Open Positions" value={String(snap.open_positions)} />
              <Field label="Used Margin" value={fmt.money(snap.margin)} />
              <Field
                label="Daily P/L"
                value={fmt.money(snap.daily_pnl)}
                tone={snap.daily_pnl >= 0 ? "bull" : "bear"}
              />
              <Field label="Mode" value={snap.mode.toUpperCase()} />
              <Field label="Updated" value={new Date(snap.created_at).toLocaleTimeString()} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("font-mono-tabular text-lg font-semibold",
        tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{value}</p>
    </div>
  );
}
