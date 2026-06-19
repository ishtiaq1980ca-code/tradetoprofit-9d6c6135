import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDecisionLog } from "@/lib/decisionLog";
import { useAccount } from "@/lib/paperTrading";
import { useBot } from "@/lib/tradingBot";
import { allProfiles } from "@/lib/pairProfiles";
import { computeOpenSlots, useExecutionStats, avgMs } from "@/lib/execution";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ClipboardCheck, CheckCircle2, XCircle, ShieldAlert, Copy, TrendingUp, TrendingDown, Gauge, Layers } from "lucide-react";

export const Route = createFileRoute("/report")({
  head: () => ({
    meta: [
      { title: "Audit Report — AurumAI" },
      { name: "description", content: "Engine audit: signal counts, approval rate, executed trades, win/loss, per-pair breakdown." },
    ],
  }),
  component: ReportPage,
});

function ReportPage() {
  const records = useDecisionLog((s) => s.records);
  const positions = useAccount((s) => s.positions);
  const history = useAccount((s) => s.history);
  const balance = useAccount((s) => s.balance);
  const starting = useAccount((s) => s.startingBalance);
  const botEnabled = useBot((s) => s.enabled);
  const minConfidence = useBot((s) => s.minConfidence);

  const stats = useMemo(() => {
    const total = records.length;
    const approved = records.filter((r) => r.status === "executed").length;
    const rejected = records.filter((r) => r.status === "rejected").length;
    const blocked = records.filter((r) => r.status === "blocked").length;
    const duplicate = records.filter((r) => r.status === "duplicate").length;
    const approvalRate = total ? (approved / total) * 100 : 0;

    // History excludes "partial @1R" rows which are partial closes — count
    // only full trade closes for win/loss.
    const fullCloses = history.filter((h) => h.closeReason !== "partial @1R");
    const wins = fullCloses.filter((h) => h.profit > 0).length;
    const losses = fullCloses.filter((h) => h.profit <= 0).length;
    const winRate = (wins + losses) ? (wins / (wins + losses)) * 100 : 0;
    const totalPnl = history.reduce((s, h) => s + h.profit, 0);

    return { total, approved, rejected, blocked, duplicate, approvalRate, wins, losses, winRate, totalPnl, openCount: positions.length };
  }, [records, history, positions]);

  // Per-pair breakdown
  const perPair = useMemo(() => {
    const profiles = allProfiles();
    return profiles.map((p) => {
      const recs = records.filter((r) => r.symbol === p.symbol);
      const trades = history.filter((h) => h.symbol === p.symbol && h.closeReason !== "partial @1R");
      const wins = trades.filter((t) => t.profit > 0).length;
      const losses = trades.filter((t) => t.profit <= 0).length;
      return {
        symbol: p.symbol,
        strategy: p.label,
        total: recs.length,
        executed: recs.filter((r) => r.status === "executed").length,
        rejected: recs.filter((r) => r.status === "rejected").length,
        blocked: recs.filter((r) => r.status === "blocked").length,
        duplicate: recs.filter((r) => r.status === "duplicate").length,
        wins,
        losses,
        winRate: (wins + losses) ? (wins / (wins + losses)) * 100 : 0,
        pnl: trades.reduce((s, t) => s + t.profit, 0),
      };
    });
  }, [records, history]);

  // Safety audit checks
  const checks = useMemo(() => {
    const executed = records.filter((r) => r.status === "executed");
    const missingSL = executed.filter((r) => !r.stopLoss || r.stopLoss === r.entry).length;
    const missingTP = executed.filter((r) => !r.takeProfit || r.takeProfit === r.entry).length;
    const oversizedLot = executed.filter((r) => (r.lot ?? 0) > 50).length;
    const noConfidence = executed.filter((r) => (r.confidence ?? 0) < 75).length;
    const openWithoutSL = positions.filter((p) => !p.stopLoss).length;

    return [
      { label: "Every executed trade has SL", pass: missingSL === 0, detail: `${missingSL} violations` },
      { label: "Every executed trade has TP", pass: missingTP === 0, detail: `${missingTP} violations` },
      { label: "Every executed trade has Lot & Risk %", pass: executed.every((r) => r.lot && r.riskPct), detail: `${executed.filter((r) => !r.lot || !r.riskPct).length} violations` },
      { label: "No oversized lots (>50)", pass: oversizedLot === 0, detail: `${oversizedLot} violations` },
      { label: `All executed trades ≥ ${minConfidence}% confidence`, pass: noConfidence === 0, detail: `${noConfidence} violations` },
      { label: "No open paper position missing SL", pass: openWithoutSL === 0, detail: `${openWithoutSL} violations` },
    ];
  }, [records, positions, minConfidence]);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7 text-gold" />
            Audit Report
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            End-to-end engine audit. Counts come from the decision log and paper-trading history; the MT5
            bridge layer is read-only here.
          </p>
        </header>

        {/* Top-level counters */}
        <section className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <Stat label="Bot" value={botEnabled ? "Running" : "Stopped"} tone={botEnabled ? "bull" : "muted"} />
          <Stat label="Total Signals" value={stats.total.toString()} />
          <Stat label="Approved" value={stats.approved.toString()} tone="bull" />
          <Stat label="Rejected" value={stats.rejected.toString()} tone="muted" />
          <Stat label="Blocked" value={stats.blocked.toString()} tone="bear" />
          <Stat label="Duplicates" value={stats.duplicate.toString()} tone="amber" />
        </section>

        <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Approval Rate" value={`${stats.approvalRate.toFixed(1)}%`} />
          <Stat label="Open Positions" value={stats.openCount.toString()} />
          <Stat label="Wins / Losses" value={`${stats.wins} / ${stats.losses}`} />
          <Stat label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} tone={stats.winRate >= 50 ? "bull" : "bear"} />
        </section>

        <section className="grid gap-3 grid-cols-2 md:grid-cols-3">
          <Stat label="Starting Balance" value={fmt.money(starting)} />
          <Stat label="Current Balance" value={fmt.money(balance)} tone={balance >= starting ? "bull" : "bear"} />
          <Stat label="Closed P&L" value={fmt.money(stats.totalPnl)} tone={stats.totalPnl >= 0 ? "bull" : "bear"} />
        </section>

        {/* Open-trade slots (FX vs XAUUSD) */}
        <SlotsCard />

        {/* Execution latency + failures */}
        <ExecutionCard />


        <Card className="border-border/60 bg-card/70">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Safety Checks</h2>
              <Badge variant="outline" className={cn(checks.every((c) => c.pass) ? "border-bull/40 text-bull" : "border-bear/40 text-bear")}>
                {checks.every((c) => c.pass) ? "ALL PASS" : "FAILURES"}
              </Badge>
            </div>
            <ul className="space-y-1.5 text-sm">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center justify-between rounded bg-background/40 px-3 py-2">
                  <span className="flex items-center gap-2">
                    {c.pass ? <CheckCircle2 className="h-4 w-4 text-bull" /> : <XCircle className="h-4 w-4 text-bear" />}
                    {c.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{c.detail}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Per-pair breakdown */}
        <Card className="border-border/60 bg-card/70">
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3">Per-Pair Breakdown</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left border-b border-border/40">
                    <th className="py-2 pr-3">Pair</th>
                    <th className="py-2 pr-3">Strategy</th>
                    <th className="py-2 pr-3 text-right">Signals</th>
                    <th className="py-2 pr-3 text-right text-bull">Exec</th>
                    <th className="py-2 pr-3 text-right">Rej</th>
                    <th className="py-2 pr-3 text-right text-bear">Blk</th>
                    <th className="py-2 pr-3 text-right">Dup</th>
                    <th className="py-2 pr-3 text-right">W/L</th>
                    <th className="py-2 pr-3 text-right">Win %</th>
                    <th className="py-2 pr-3 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody className="font-mono-tabular">
                  {perPair.map((p) => (
                    <tr key={p.symbol} className="border-b border-border/20">
                      <td className="py-1.5 pr-3 font-semibold">{p.symbol}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground truncate max-w-[180px]">{p.strategy}</td>
                      <td className="py-1.5 pr-3 text-right">{p.total}</td>
                      <td className="py-1.5 pr-3 text-right text-bull">{p.executed}</td>
                      <td className="py-1.5 pr-3 text-right">{p.rejected}</td>
                      <td className="py-1.5 pr-3 text-right text-bear">{p.blocked}</td>
                      <td className="py-1.5 pr-3 text-right">{p.duplicate}</td>
                      <td className="py-1.5 pr-3 text-right">
                        <span className="text-bull">{p.wins}</span>/<span className="text-bear">{p.losses}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right">{p.winRate.toFixed(0)}%</td>
                      <td className={cn("py-1.5 pr-3 text-right", p.pnl >= 0 ? "text-bull" : "text-bear")}>
                        {fmt.money(p.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Recent W/L feed */}
        <Card className="border-border/60 bg-card/70">
          <CardContent className="p-4">
            <h2 className="font-semibold mb-3">Recent Closed Trades</h2>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No closed trades yet.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {history.slice(0, 12).map((h) => (
                  <li key={h.id + h.closedAt} className="flex items-center justify-between rounded bg-background/40 px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      {h.profit > 0 ? <TrendingUp className="h-3.5 w-3.5 text-bull" /> : <TrendingDown className="h-3.5 w-3.5 text-bear" />}
                      <span className="font-semibold">{h.symbol}</span>
                      <Badge variant="outline" className={cn("text-[10px]",
                        h.side === "BUY" ? "border-bull/40 text-bull" : "border-bear/40 text-bear")}>{h.side}</Badge>
                      <span className="text-muted-foreground">{h.closeReason}</span>
                    </span>
                    <span className={cn("font-mono-tabular", h.profit >= 0 ? "text-bull" : "text-bear")}>
                      {fmt.money(h.profit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" | "muted" | "amber" }) {
  return (
    <Card className="border-border/60 bg-card/70">
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn(
          "mt-1 text-lg font-semibold font-mono-tabular",
          tone === "bull" && "text-bull",
          tone === "bear" && "text-bear",
          tone === "amber" && "text-amber-400",
          tone === "muted" && "text-muted-foreground",
        )}>{value}</div>
      </CardContent>
    </Card>
  );
}

function SlotsCard() {
  const positions = useAccount((s) => s.positions);
  const slots = useMemo(() => computeOpenSlots(positions), [positions]);
  const fxFull = slots.fxAvailable === 0;
  const xauFull = slots.xauAvailable === 0;
  return (
    <Card className="border-border/60 bg-card/70">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2"><Layers className="h-4 w-4 text-gold" /> Open-Trade Slots</h2>
          <Badge variant="outline" className="text-[10px]">FX max {slots.fxMax} · XAU max {slots.xauMax}</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Slot label="FX Open" value={`${slots.fxOpen} / ${slots.fxMax}`} tone={fxFull ? "bear" : "bull"} />
          <Slot label="FX Available" value={slots.fxAvailable.toString()} tone={fxFull ? "bear" : "bull"} />
          <Slot label="XAUUSD Open" value={`${slots.xauOpen} / ${slots.xauMax}`} tone={xauFull ? "bear" : "bull"} />
          <Slot label="XAUUSD Available" value={slots.xauAvailable.toString()} tone={xauFull ? "bear" : "bull"} />
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Total open {slots.totalOpen} / {slots.totalMax}. Caps apply per instrument class so XAUUSD never starves FX (and vice versa).
        </div>
      </CardContent>
    </Card>
  );
}

function Slot({ label, value, tone }: { label: string; value: string; tone: "bull" | "bear" }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold font-mono-tabular", tone === "bull" ? "text-bull" : "text-bear")}>{value}</div>
    </div>
  );
}

function ExecutionCard() {
  const stats = useExecutionStats();
  const sentAvg = avgMs(stats.sentLatencies);
  const fillAvg = avgMs(stats.fillLatencies);
  const lastFails = stats.failures.slice(0, 6);
  const failByCode = useMemo(() => {
    const m = new Map<string, number>();
    stats.failures.forEach((f) => m.set(f.code, (m.get(f.code) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [stats.failures]);
  return (
    <Card className="border-border/60 bg-card/70">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold flex items-center gap-2"><Gauge className="h-4 w-4 text-gold" /> Execution Performance</h2>
          <Badge variant="outline" className={cn("text-[10px]", stats.failed === 0 ? "border-bull/40 text-bull" : "border-amber-500/40 text-amber-400")}>
            {stats.failed === 0 ? "Healthy" : `${stats.failed} failures`}
          </Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <Slot label="Signal → Sent (avg)" value={`${sentAvg.toFixed(0)} ms`} tone="bull" />
          <Slot label="Signal → MT5 Fill (avg)" value={fillAvg ? `${fillAvg.toFixed(0)} ms` : "—"} tone="bull" />
          <Slot label="Sent" value={stats.sent.toString()} tone="bull" />
          <Slot label="Filled" value={stats.filled.toString()} tone="bull" />
          <Slot label="Failed" value={stats.failed.toString()} tone={stats.failed === 0 ? "bull" : "bear"} />
        </div>
        {failByCode.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] font-medium text-muted-foreground mb-1">Failure reasons</div>
            <div className="flex flex-wrap gap-1.5">
              {failByCode.map(([code, n]) => (
                <Badge key={code} variant="outline" className="text-[10px] border-bear/40 text-bear">{code} × {n}</Badge>
              ))}
            </div>
          </div>
        )}
        {lastFails.length > 0 && (
          <ul className="mt-3 space-y-1 text-[11px] font-mono-tabular">
            {lastFails.map((f, i) => (
              <li key={i} className="flex justify-between rounded bg-background/40 px-2 py-1">
                <span className="truncate">{f.symbol} {f.side} · {f.code}</span>
                <span className="text-muted-foreground truncate max-w-[60%] text-right">{f.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
