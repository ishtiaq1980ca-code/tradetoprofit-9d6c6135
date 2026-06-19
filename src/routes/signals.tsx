import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  generateHighConfidenceSignal,
  DEFAULT_GENERATOR_PARAMS,
  MIN_CONFIDENCE,
  type HighConfidenceSignal,
} from "@/lib/signalGenerator";
import { fmt, SYMBOLS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Send, ShieldCheck, TrendingUp, Activity, Waves, LayoutGrid, Target, Wallet } from "lucide-react";
import { toast } from "sonner";
import { usePriceFeed } from "@/hooks/usePriceFeed";
import { useAccount } from "@/lib/paperTrading";

export const Route = createFileRoute("/signals")({
  head: () => ({
    meta: [
      { title: "High-Confidence Signals — AurumAI" },
      { name: "description", content: `Only trades scoring >= ${MIN_CONFIDENCE}% across trend, momentum, volatility, structure and R:R are shown.` },
    ],
  }),
  component: SignalsPage,
});

function SignalsPage() {
  const [filter, setFilter] = useState<"all" | "BUY" | "SELL">("all");
  const feed = usePriceFeed();
  const balance = useAccount((s) => s.balance);
  const open = useAccount((s) => s.open);

  const live = useMemo(() => {
    const out: HighConfidenceSignal[] = [];
    for (const s of SYMBOLS) {
      const candles = feed.candles[s] ?? [];
      const sig = generateHighConfidenceSignal(s, candles, balance, DEFAULT_GENERATOR_PARAMS);
      if (sig && (filter === "all" || sig.side === filter)) out.push(sig);
    }
    return out.sort((a, b) => b.confidence - a.confidence);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.candles.XAUUSD?.length, filter, balance]);

  const execute = (s: HighConfidenceSignal) => {
    if (s.side === "FLAT") return;
    const pos = open({
      symbol: s.symbol,
      side: s.side,
      lot: s.lot,
      entry: s.entry,
      stopLoss: s.stopLoss,
      takeProfit: s.takeProfit,
      confidence: s.confidence,
      reason: s.reason,
    });
    if (pos) toast.success(`Paper trade opened: ${s.side} ${s.lot} ${s.symbol} @ ${s.confidence}% confidence`);
  };

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-7 w-7 text-gold" />
              High-Confidence Signals
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Only setups scoring <span className="text-foreground font-medium">≥ {MIN_CONFIDENCE}%</span> across
              trend, momentum, volatility, structure and R:R are listed. Each card shows the full reasoning.
            </p>
          </div>
          <div className="flex gap-2">
            {(["all", "BUY", "SELL"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                {f === "all" ? "All" : f}
              </Button>
            ))}
          </div>
        </header>

        {live.length === 0 ? (
          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-6 text-sm text-muted-foreground">
              No symbol currently meets the {MIN_CONFIDENCE}% confidence floor. The generator is waiting for
              trend, momentum, volatility, structure and R:R to align — this is by design.
            </CardContent>
          </Card>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {live.map((s) => (
              <SignalCard key={s.symbol} sig={s} onExecute={() => execute(s)} />
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}

function SignalCard({ sig, onExecute }: { sig: HighConfidenceSignal; onExecute: () => void }) {
  const isBuy = sig.side === "BUY";
  return (
    <Card className={cn("border-border/60 bg-card/70", sig.symbol === "XAUUSD" && "border-gold/30")}>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{sig.symbol}</div>
            <div className="mt-0.5 font-mono-tabular text-xl font-semibold">{fmt.price(sig.entry, sig.symbol)}</div>
          </div>
          <div className="text-right">
            <Badge className={cn(
              "border",
              isBuy ? "border-bull/40 bg-bull/10 text-bull" : "border-bear/40 bg-bear/10 text-bear",
            )}>
              {sig.side}
            </Badge>
            <div className="mt-1 text-xs text-muted-foreground">R:R {sig.riskReward.toFixed(2)}</div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">Confidence</span>
            <span className="font-mono-tabular font-semibold text-gold">{sig.confidence}%</span>
          </div>
          <Progress value={sig.confidence} className="h-2" />
        </div>

        <div className="grid grid-cols-3 gap-2 text-[11px] font-mono-tabular">
          <KV k="Entry" v={fmt.price(sig.entry, sig.symbol)} />
          <KV k="SL" v={fmt.price(sig.stopLoss, sig.symbol)} tone="bear" />
          <KV k="TP" v={fmt.price(sig.takeProfit, sig.symbol)} tone="bull" />
          <KV k="Lot" v={sig.lot.toFixed(2)} />
          <KV k="Risk %" v={`${sig.riskPct}%`} />
          <KV k="R:R" v={sig.riskReward.toFixed(2)} />
        </div>

        <div className="space-y-1.5 text-[11px]">
          <ReasonRow icon={<TrendingUp className="h-3 w-3" />} label="Trend" score={sig.breakdown.trend} max={25} text={sig.reasons.trend} />
          <ReasonRow icon={<Activity className="h-3 w-3" />} label="Momentum" score={sig.breakdown.momentum} max={25} text={sig.reasons.momentum} />
          <ReasonRow icon={<Waves className="h-3 w-3" />} label="Volatility" score={sig.breakdown.volatility} max={15} text={sig.reasons.volatility} />
          <ReasonRow icon={<LayoutGrid className="h-3 w-3" />} label="Structure" score={sig.breakdown.structure} max={20} text={sig.reasons.structure} />
          <ReasonRow icon={<Target className="h-3 w-3" />} label="R:R" score={sig.breakdown.riskReward} max={15} text={sig.reasons.riskReward} />
          <ReasonRow icon={<Wallet className="h-3 w-3" />} label="Risk" text={sig.reasons.risk} />
        </div>

        <Button size="sm" className="w-full" onClick={onExecute}>
          <Send className="mr-1.5 h-3.5 w-3.5" /> Execute paper trade
        </Button>
      </CardContent>
    </Card>
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

function ReasonRow({
  icon, label, score, max, text,
}: { icon: React.ReactNode; label: string; score?: number; max?: number; text: string }) {
  return (
    <div className="flex gap-2 items-start rounded bg-background/30 px-2 py-1.5">
      <span className="mt-0.5 text-gold shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">{label}</span>
          {score !== undefined && max !== undefined && (
            <span className="text-[10px] font-mono-tabular text-muted-foreground">{score}/{max}</span>
          )}
        </div>
        <div className="text-muted-foreground text-[10.5px] leading-snug break-words">{text}</div>
      </div>
    </div>
  );
}
