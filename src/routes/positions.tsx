import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePriceFeed } from "@/hooks/usePriceFeed";
import { pnlOf, useAccount } from "@/lib/paperTrading";
import { X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/positions")({
  head: () => ({ meta: [{ title: "Positions — AurumAI" }, { name: "description", content: "Open paper positions and trade history." }] }),
  component: PositionsPage,
});

function PositionsPage() {
  const feed = usePriceFeed();
  const positions = useAccount((s) => s.positions);
  const history = useAccount((s) => s.history);
  const close = useAccount((s) => s.close);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Positions</h1>
          <p className="text-sm text-muted-foreground">Live open trades and full history. Trailing stop and partial close act on every tick.</p>
        </header>

        <Card className="border-border/60 bg-card/70">
          <CardHeader><CardTitle className="text-base font-medium">Open ({positions.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {positions.length === 0 ? (
              <div className="px-6 pb-6 pt-2 text-sm text-muted-foreground">No open positions.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono-tabular">
                  <thead className="border-y border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Opened</th>
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Side</th>
                      <th className="px-3 py-2 text-right">Lot</th>
                      <th className="px-3 py-2 text-right">Entry</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-right">SL</th>
                      <th className="px-3 py-2 text-right">TP</th>
                      <th className="px-3 py-2 text-right">P/L</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => {
                      const price = feed.prices[p.symbol] ?? p.entry;
                      const pnl = pnlOf(p, price);
                      return (
                        <tr key={p.id} className="border-b border-border/40">
                          <td className="px-3 py-2 text-muted-foreground">{new Date(p.openedAt).toLocaleTimeString()}</td>
                          <td className="px-3 py-2">{p.symbol}</td>
                          <td className={cn("px-3 py-2 font-medium", p.side === "BUY" ? "text-bull" : "text-bear")}>{p.side}</td>
                          <td className="px-3 py-2 text-right">{p.lot.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">{fmt.price(p.entry, p.symbol)}</td>
                          <td className="px-3 py-2 text-right">{fmt.price(price, p.symbol)}</td>
                          <td className="px-3 py-2 text-right text-bear">{fmt.price(p.stopLoss, p.symbol)}{p.breakEvenTriggered && " *"}</td>
                          <td className="px-3 py-2 text-right text-bull">{fmt.price(p.takeProfit, p.symbol)}</td>
                          <td className={cn("px-3 py-2 text-right", pnl >= 0 ? "text-bull" : "text-bear")}>{fmt.money(pnl)}</td>
                          <td className="px-3 py-2 text-right">
                            <Button size="sm" variant="ghost" onClick={() => { close(p.id, price); toast.success(`Closed ${p.symbol}`); }}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
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
              <div className="px-6 pb-6 pt-2 text-sm text-muted-foreground">No closed trades yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono-tabular">
                  <thead className="border-y border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Closed</th>
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Side</th>
                      <th className="px-3 py-2 text-right">Lot</th>
                      <th className="px-3 py-2 text-right">Entry</th>
                      <th className="px-3 py-2 text-right">Exit</th>
                      <th className="px-3 py-2 text-right">P/L</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((t) => (
                      <tr key={t.id + t.closedAt} className="border-b border-border/40">
                        <td className="px-3 py-2 text-muted-foreground">{new Date(t.closedAt).toLocaleString()}</td>
                        <td className="px-3 py-2">{t.symbol}</td>
                        <td className={cn("px-3 py-2 font-medium", t.side === "BUY" ? "text-bull" : "text-bear")}>{t.side}</td>
                        <td className="px-3 py-2 text-right">{t.lot.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">{fmt.price(t.entry, t.symbol)}</td>
                        <td className="px-3 py-2 text-right">{fmt.price(t.exit, t.symbol)}</td>
                        <td className={cn("px-3 py-2 text-right", t.profit >= 0 ? "text-bull" : "text-bear")}>{fmt.money(t.profit)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{t.closeReason}</td>
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
