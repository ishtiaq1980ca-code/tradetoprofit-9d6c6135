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
    const id = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const fresh = snap ? Date.now() - new Date(snap.created_at).getTime() < 90_000 : false;

  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-base font-medium">Connected MT5 Account</CardTitle>
        <Badge variant="outline" className={cn(fresh ? "border-bull/40 text-bull" : "border-border text-muted-foreground")}>
          {snap ? (snap.mode === "real" ? "LIVE" : "DEMO") : "—"} · {fresh ? "Live" : snap ? "Stale" : "Offline"}
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
            {!fresh && (
              <p className="rounded-md border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear">
                MT5 bridge heartbeat is stale. Restart the updated <code>aurumai_bridge.py</code>; new signals are paused until MT5 reconnects.
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
