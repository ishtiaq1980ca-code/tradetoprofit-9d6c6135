import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDecisionLog, type DecisionStatus } from "@/lib/decisionLog";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/format";
import { ScrollText, Trash2, CheckCircle2, XCircle, ShieldAlert, Copy } from "lucide-react";

export const Route = createFileRoute("/decisions")({
  head: () => ({
    meta: [
      { title: "Trade Decisions — AurumAI" },
      { name: "description", content: "Full audit log of every signal the bot evaluated — accepted, rejected, blocked, or duplicate." },
    ],
  }),
  component: DecisionsPage,
});

const STATUS_META: Record<DecisionStatus, { label: string; cls: string; icon: any }> = {
  queued: { label: "Queued", cls: "border-gold/40 bg-gold/10 text-gold", icon: CheckCircle2 },
  executed: { label: "Executed", cls: "border-bull/40 bg-bull/10 text-bull", icon: CheckCircle2 },
  rejected: { label: "Rejected", cls: "border-muted bg-muted/30 text-muted-foreground", icon: XCircle },
  blocked: { label: "Blocked", cls: "border-bear/40 bg-bear/10 text-bear", icon: ShieldAlert },
  duplicate: { label: "Duplicate", cls: "border-amber-500/40 bg-amber-500/10 text-amber-400", icon: Copy },
};

function DecisionsPage() {
  const records = useDecisionLog((s) => s.records);
  const clear = useDecisionLog((s) => s.clear);
  const [filter, setFilter] = useState<"all" | DecisionStatus>("all");

  const shown = records.filter((r) => filter === "all" || r.status === filter);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
              <ScrollText className="h-7 w-7 text-gold" />
              Trade Decisions
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Every signal the bot evaluated. Each row shows the pair, direction, strategy, indicators,
              confidence, SL/TP and the full reasoning.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(["all", "queued", "executed", "rejected", "blocked", "duplicate"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : STATUS_META[f].label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={clear}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
            </Button>
          </div>
        </header>

        {shown.length === 0 ? (
          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-6 text-sm text-muted-foreground">
              No decisions yet. Enable the bot — every signal it sees (good or bad) will be logged here.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {shown.map((r) => {
              const meta = STATUS_META[r.status];
              const Icon = meta.icon;
              return (
                <Card key={r.id} className="border-border/60 bg-card/70">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        <Badge className={cn("border", meta.cls)}>
                          <Icon className="h-3 w-3 mr-1" />
                          {meta.label}
                        </Badge>
                        <span className="font-semibold">{r.symbol}</span>
                        <Badge variant="outline" className={cn(
                          r.direction === "BUY" && "text-bull border-bull/40",
                          r.direction === "SELL" && "text-bear border-bear/40",
                        )}>
                          {r.direction}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{r.strategy}</span>
                      </div>
                      <div className="text-right text-xs">
                        <div className="font-mono-tabular text-gold font-semibold">{r.confidence}%</div>
                        <div className="text-muted-foreground">{new Date(r.at).toLocaleString()}</div>
                      </div>
                    </div>

                    {r.entry !== undefined && (
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px] font-mono-tabular">
                        <KV k="Entry" v={fmt.price(r.entry, r.symbol)} />
                        <KV k="SL" v={r.stopLoss !== undefined ? fmt.price(r.stopLoss, r.symbol) : "—"} tone="bear" />
                        <KV k="TP" v={r.takeProfit !== undefined ? fmt.price(r.takeProfit, r.symbol) : "—"} tone="bull" />
                        <KV k="Lot" v={r.lot?.toFixed(2) ?? "—"} />
                        <KV k="R:R" v={r.riskReward?.toFixed(2) ?? "—"} />
                      </div>
                    )}

                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Indicators ({Object.keys(r.indicators).length})
                      </summary>
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-1.5 font-mono-tabular">
                        {Object.entries(r.indicators).map(([k, v]) => (
                          <div key={k} className="flex justify-between rounded bg-background/40 px-2 py-1">
                            <span className="text-muted-foreground">{k}</span>
                            <span>{typeof v === "number" ? v.toFixed(5) : String(v)}</span>
                          </div>
                        ))}
                      </div>
                    </details>

                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        Filters ({r.filters.length})
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {r.filters.map((f, i) => (
                          <li key={i} className={cn("flex gap-2 rounded px-2 py-1", f.pass ? "bg-bull/5" : "bg-bear/5")}>
                            <span className={f.pass ? "text-bull" : "text-bear"}>{f.pass ? "✓" : "✗"}</span>
                            <span className="font-medium">{f.name}:</span>
                            <span className="text-muted-foreground">{f.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </details>

                    <pre className="text-[10.5px] leading-snug text-muted-foreground bg-background/30 rounded p-2 overflow-x-auto whitespace-pre-wrap">
{r.reason}
                    </pre>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function KV({ k, v, tone }: { k: string; v: string; tone?: "bull" | "bear" }) {
  return (
    <div className="flex flex-col rounded border border-border/60 bg-background/40 px-2 py-1">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</span>
      <span className={cn(tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{v}</span>
    </div>
  );
}
