import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDecisionLog } from "@/lib/decisionLog";
import { useAccount } from "@/lib/paperTrading";
import { FX_CURRENCY_PAIRS, getPairProfile } from "@/lib/pairProfiles";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Coins, TrendingUp, TrendingDown, XCircle } from "lucide-react";

export const Route = createFileRoute("/currency-report")({
  head: () => ({
    meta: [
      { title: "Currency Report — AurumAI" },
      { name: "description", content: "Per-currency win rate, P&L, trade count, and rejected-signal reasons." },
    ],
  }),
  component: CurrencyReportPage,
});

function CurrencyReportPage() {
  const records = useDecisionLog((s) => s.records);
  const history = useAccount((s) => s.history);
  const positions = useAccount((s) => s.positions);

  const rows = useMemo(() => {
    return FX_CURRENCY_PAIRS.map((sym) => {
      const profile = getPairProfile(sym);
      const recs = records.filter((r) => r.symbol === sym);
      const trades = history.filter((h) => h.symbol === sym && h.closeReason !== "partial @1R");
      const open = positions.filter((p) => p.symbol === sym);
      const wins = trades.filter((t) => t.profit > 0).length;
      const losses = trades.filter((t) => t.profit <= 0).length;
      const totalTrades = wins + losses;
      const winRate = totalTrades ? (wins / totalTrades) * 100 : 0;
      const pnl = trades.reduce((s, t) => s + t.profit, 0);
      const rejected = recs.filter((r) => r.status === "rejected" || r.status === "blocked");

      // Session approvals = executed records whose reason mentions London/NY/Asian tag.
      const sessionApproved = recs.filter(
        (r) => r.status === "executed" && /(London|New York|Asian)/i.test(r.reason),
      ).length;
      const sessionRejected = recs.filter(
        (r) => /Asian session/i.test(r.reason) || /Session FAIL/i.test(r.reason) || /Session:FAIL/i.test(r.reason),
      ).length;
      const correlationBlocked = recs.filter(
        (r) => r.status === "blocked" && /CORRELATION/i.test(r.reason),
      ).length;

      const rejReasons = rejected.reduce<Record<string, number>>((acc, r) => {
        const corr = r.reason.match(/CORRELATION[^\n]*/i)?.[0];
        const rej = r.reason.split("\n").find((l) => l.includes("REJECTED"));
        const key = (corr || rej || r.reason).slice(0, 140);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      return {
        symbol: sym,
        profile,
        signals: recs.length,
        executed: recs.filter((r) => r.status === "executed").length,
        rejected: rejected.length,
        duplicates: recs.filter((r) => r.status === "duplicate").length,
        sessionApproved,
        sessionRejected,
        correlationBlocked,
        trades: totalTrades,
        wins,
        losses,
        winRate,
        pnl,
        open: open.length,
        rejReasons,
      };
    });
  }, [records, history, positions]);

  const totals = useMemo(() => {
    return rows.reduce(
      (a, r) => ({
        signals: a.signals + r.signals,
        executed: a.executed + r.executed,
        rejected: a.rejected + r.rejected,
        trades: a.trades + r.trades,
        wins: a.wins + r.wins,
        losses: a.losses + r.losses,
        pnl: a.pnl + r.pnl,
      }),
      { signals: 0, executed: 0, rejected: 0, trades: 0, wins: 0, losses: 0, pnl: 0 },
    );
  }, [rows]);
  const totalWinRate = (totals.wins + totals.losses) ? (totals.wins / (totals.wins + totals.losses)) * 100 : 0;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <header className="flex items-center gap-3">
          <Coins className="h-6 w-6 text-gold" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Currency Performance Report</h1>
            <p className="text-xs text-muted-foreground">
              Forex pairs only — XAUUSD and JPY crosses excluded. Updates from local decision log + paper trade history.
            </p>
          </div>
        </header>

        {/* Totals */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Signals" value={totals.signals.toString()} />
          <Stat label="Executed" value={totals.executed.toString()} tone="bull" />
          <Stat label="Rejected" value={totals.rejected.toString()} tone="bear" />
          <Stat label="Win Rate" value={`${totalWinRate.toFixed(1)}%`} />
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Net P&L (FX pairs): </span>
              <span className={cn("font-semibold", totals.pnl >= 0 ? "text-bull" : "text-bear")}>{fmt.money(totals.pnl)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {totals.wins}W / {totals.losses}L · {totals.trades} closed trades
            </div>
          </CardContent>
        </Card>

        {/* Per-pair table */}
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.symbol}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold tracking-tight">{r.symbol}</span>
                    <Badge variant="outline" className="text-[10px]">{r.profile?.label ?? "—"}</Badge>
                    {r.open > 0 && <Badge className="bg-gold text-primary-foreground text-[10px]">{r.open} open</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {r.pnl >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-bull" /> : <TrendingDown className="h-3.5 w-3.5 text-bear" />}
                    <span className={cn("font-semibold", r.pnl >= 0 ? "text-bull" : "text-bear")}>{fmt.money(r.pnl)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-6">
                  <Mini label="Signals" value={r.signals} />
                  <Mini label="Executed" value={r.executed} />
                  <Mini label="Rejected" value={r.rejected} />
                  <Mini label="Trades" value={r.trades} />
                  <Mini label="W/L" value={`${r.wins}/${r.losses}`} />
                  <Mini label="Win Rate" value={`${r.winRate.toFixed(1)}%`} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <Mini label="Session ✓" value={r.sessionApproved} />
                  <Mini label="Session ✗" value={r.sessionRejected} />
                  <Mini label="Correlation block" value={r.correlationBlocked} />
                </div>

                {Object.keys(r.rejReasons).length > 0 && (
                  <div className="rounded-md border border-border/60 bg-card/40 p-2">
                    <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                      <XCircle className="h-3 w-3" /> Top rejection reasons
                    </div>
                    <ul className="space-y-0.5 text-[11px]">
                      {Object.entries(r.rejReasons)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 4)
                        .map(([reason, count]) => (
                          <li key={reason} className="flex justify-between gap-2">
                            <span className="truncate text-muted-foreground">{reason}</span>
                            <span className="text-foreground">×{count}</span>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-lg font-semibold", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{value}</div>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-xs font-semibold">{value}</div>
    </div>
  );
}
