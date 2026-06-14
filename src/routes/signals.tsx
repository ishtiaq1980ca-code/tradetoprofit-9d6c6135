import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { analyze, calculateLot, DEFAULT_PARAMS } from "@/lib/strategy";
import { fmt, SYMBOLS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CheckCircle2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { usePriceFeed } from "@/hooks/usePriceFeed";
import { useAccount } from "@/lib/paperTrading";

export const Route = createFileRoute("/signals")({
  head: () => ({ meta: [{ title: "Signals — AurumAI" }, { name: "description", content: "Live strategy signals; click to open a paper trade." }] }),
  component: SignalsPage,
});

function SignalsPage() {
  const [filter, setFilter] = useState<"all" | "BUY" | "SELL">("all");
  const feed = usePriceFeed();
  const balance = useAccount((s) => s.balance);
  const open = useAccount((s) => s.open);

  const live = useMemo(() => {
    return SYMBOLS.map((s) => {
      const candles = feed.candles[s] ?? [];
      if (candles.length < 60) return null;
      const sig = analyze(s, candles, DEFAULT_PARAMS);
      const lot = sig.side !== "FLAT" ? calculateLot(s, balance, 1, Math.abs(sig.entry - sig.stopLoss)) : 0;
      return { ...sig, lot };
    }).filter(Boolean).filter((s) => (filter === "all" ? true : s!.side === filter)) as Array<ReturnType<typeof analyze> & { lot: number }>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.candles.XAUUSD?.length, filter, balance]);

  const execute = (s: typeof live[number]) => {
    if (s.side === "FLAT") return;
    const pos = open({
      symbol: s.symbol,
      side: s.side as "BUY" | "SELL",
      lot: s.lot,
      entry: s.entry,
      stopLoss: s.stopLoss,
      takeProfit: s.takeProfit,
      confidence: s.confidence,
      reason: s.reasons.join(" · "),
    });
    if (pos) toast.success(`Paper trade opened: ${s.side} ${s.lot} ${s.symbol}`);
  };

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Signals</h1>
          <p className="text-sm text-muted-foreground">Live multi-filter strategy scan. Click <em>Execute</em> to open a paper trade with auto SL/TP.</p>
        </header>

        <div className="flex gap-2">
          {(["all", "BUY", "SELL"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f}
            </Button>
          ))}
        </div>

        {live.length === 0 ? (
          <Card className="border-border/60 bg-card/70">
            <CardContent className="p-6 text-sm text-muted-foreground">Warming up market data (need ~220 bars)…</CardContent>
          </Card>
        ) : (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {live.map((s) => (
              <Card key={s.symbol} className={cn("border-border/60 bg-card/70", s.symbol === "XAUUSD" && "border-gold/30")}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.symbol}</div>
                      <div className="mt-0.5 font-mono-tabular text-xl font-semibold">{fmt.price(s.entry, s.symbol)}</div>
                    </div>
                    <Badge className={cn(
                      "border",
                      s.side === "BUY" && "border-bull/40 bg-bull/10 text-bull",
                      s.side === "SELL" && "border-bear/40 bg-bear/10 text-bear",
                      s.side === "FLAT" && "border-border bg-muted text-muted-foreground",
                    )}>
                      {s.side} · {s.confidence}%
                    </Badge>
                  </div>
                  {s.side !== "FLAT" ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono-tabular">
                        <Kv k="SL" v={fmt.price(s.stopLoss, s.symbol)} tone="bear" />
                        <Kv k="TP" v={fmt.price(s.takeProfit, s.symbol)} tone="bull" />
                        <Kv k="Lot" v={s.lot.toFixed(2)} />
                        <Kv k="R:R" v={s.riskReward.toFixed(2)} />
                      </div>
                      <ul className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                        {s.reasons.map((r, i) => (
                          <li key={i} className="flex gap-1.5"><CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 text-bull" />{r}</li>
                        ))}
                      </ul>
                      <Button size="sm" className="mt-3 w-full" onClick={() => execute(s)}>
                        <Send className="mr-1.5 h-3.5 w-3.5" /> Execute paper trade
                      </Button>
                    </>
                  ) : (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <XCircle className="h-3.5 w-3.5" /> Filters not aligned — no trade.
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </section>
        )}
      </div>
    </AppShell>
  );
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: "bull" | "bear" }) {
  return (
    <div className="flex justify-between rounded border border-border/60 bg-background/40 px-2 py-1">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn(tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{v}</span>
    </div>
  );
}
