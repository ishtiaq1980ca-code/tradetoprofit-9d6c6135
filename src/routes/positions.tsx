import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/positions")({
  head: () => ({ meta: [{ title: "Positions — AurumAI" }, { name: "description", content: "Live MT5 open positions and trade history." }] }),
  component: PositionsPage,
});

type TradeRow = {
  id: string;
  symbol: string;
  side: string;
  lot: number;
  entry: number;
  exit: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  profit: number | null;
  pips: number | null;
  status: string;
  mt5_ticket: number | null;
  opened_at: string;
  closed_at: string | null;
};

function PositionsPage() {
  const [open, setOpen] = useState<TradeRow[]>([]);
  const [history, setHistory] = useState<TradeRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      const [o, h] = await Promise.all([
        supabase.from("trades").select("*").eq("status", "open").order("opened_at", { ascending: false }),
        supabase.from("trades").select("*").in("status", ["closed", "cancelled"]).order("closed_at", { ascending: false }).limit(200),
      ]);
      if (!alive) return;
      setOpen((o.data as TradeRow[]) ?? []);
      setHistory((h.data as TradeRow[]) ?? []);
      setLoaded(true);
    }
    load();
    const id = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Positions</h1>
          <p className="text-sm text-muted-foreground">Live MT5 open positions and full trade history from your connected MT5 account.</p>
        </header>

        <Card className="border-border/60 bg-card/70">
          <CardHeader><CardTitle className="text-base font-medium">Open ({open.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!loaded ? (
              <div className="px-6 pb-6 pt-2 text-sm text-muted-foreground">Loading…</div>
            ) : open.length === 0 ? (
              <div className="px-6 pb-6 pt-2 text-sm text-muted-foreground">No open MT5 positions. Ensure <code>aurumai_bridge.py</code> is running.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono-tabular">
                  <thead className="border-y border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Opened</th>
                      <th className="px-3 py-2 text-left">Ticket</th>
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Side</th>
                      <th className="px-3 py-2 text-right">Lot</th>
                      <th className="px-3 py-2 text-right">Entry</th>
                      <th className="px-3 py-2 text-right">SL</th>
                      <th className="px-3 py-2 text-right">TP</th>
                      <th className="px-3 py-2 text-right">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((p) => (
                      <tr key={p.id} className="border-b border-border/40">
                        <td className="px-3 py-2 text-muted-foreground">{new Date(p.opened_at).toLocaleTimeString()}</td>
                        <td className="px-3 py-2 text-muted-foreground">{p.mt5_ticket ?? "—"}</td>
                        <td className="px-3 py-2">{p.symbol}</td>
                        <td className={cn("px-3 py-2 font-medium", p.side === "BUY" ? "text-bull" : "text-bear")}>{p.side}</td>
                        <td className="px-3 py-2 text-right">{p.lot.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{fmt.price(p.entry, p.symbol)}</td>
                        <td className="px-3 py-2 text-right text-bear">{p.stop_loss != null ? fmt.price(p.stop_loss, p.symbol) : "—"}</td>
                        <td className="px-3 py-2 text-right text-bull">{p.take_profit != null ? fmt.price(p.take_profit, p.symbol) : "—"}</td>
                        <td className={cn("px-3 py-2 text-right", (p.profit ?? 0) >= 0 ? "text-bull" : "text-bear")}>{p.profit != null ? fmt.money(p.profit) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/70">
          <CardHeader><CardTitle className="text-base font-medium">History ({history.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {history.length === 0 ? (
              <div className="px-6 pb-6 pt-2 text-sm text-muted-foreground">No closed MT5 trades yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono-tabular">
                  <thead className="border-y border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Closed</th>
                      <th className="px-3 py-2 text-left">Ticket</th>
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Side</th>
                      <th className="px-3 py-2 text-right">Lot</th>
                      <th className="px-3 py-2 text-right">Entry</th>
                      <th className="px-3 py-2 text-right">Exit</th>
                      <th className="px-3 py-2 text-right">Pips</th>
                      <th className="px-3 py-2 text-right">P/L</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((t) => (
                      <tr key={t.id} className="border-b border-border/40">
                        <td className="px-3 py-2 text-muted-foreground">{t.closed_at ? new Date(t.closed_at).toLocaleString() : "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{t.mt5_ticket ?? "—"}</td>
                        <td className="px-3 py-2">{t.symbol}</td>
                        <td className={cn("px-3 py-2 font-medium", t.side === "BUY" ? "text-bull" : "text-bear")}>{t.side}</td>
                        <td className="px-3 py-2 text-right">{t.lot.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{fmt.price(t.entry, t.symbol)}</td>
                        <td className="px-3 py-2 text-right">{t.exit != null ? fmt.price(t.exit, t.symbol) : "—"}</td>
                        <td className="px-3 py-2 text-right">{t.pips != null ? t.pips.toFixed(1) : "—"}</td>
                        <td className={cn("px-3 py-2 text-right", (t.profit ?? 0) >= 0 ? "text-bull" : "text-bear")}>{t.profit != null ? fmt.money(t.profit) : "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{t.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
