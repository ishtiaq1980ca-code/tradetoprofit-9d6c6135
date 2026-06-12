import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { generateCandles } from "@/lib/mockFeed";
import { analyze, calculateLot, DEFAULT_PARAMS } from "@/lib/strategy";
import { fmt, SYMBOLS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CheckCircle2, Send, XCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/signals")({
  head: () => ({ meta: [{ title: "Signals — AurumAI" }, { name: "description", content: "Live strategy signals queued for MT5 execution." }] }),
  component: SignalsPage,
});

function SignalsPage() {
  const [filter, setFilter] = useState<"all" | "BUY" | "SELL">("all");

  const { data: settings } = useQuery({
    queryKey: ["bot_settings"],
    queryFn: async () => (await supabase.from("bot_settings").select("*").eq("id", 1).maybeSingle()).data,
  });

  const { data: pending, refetch } = useQuery({
    queryKey: ["signals_pending"],
    queryFn: async () =>
      (await supabase.from("signals").select("*").in("status", ["pending", "sent"]).order("created_at", { ascending: false })).data ?? [],
    refetchInterval: 5000,
  });

  const { data: history } = useQuery({
    queryKey: ["signals_history"],
    queryFn: async () =>
      (await supabase.from("signals").select("*").not("status", "in", "(pending,sent)").order("created_at", { ascending: false }).limit(50)).data ?? [],
    refetchInterval: 15000,
  });

  const live = useMemo(() => {
    const minConf = settings?.min_confidence ?? 75;
    const balance = 10_000;
    return SYMBOLS.map((s) => {
      const candles = generateCandles(s, 260);
      const sig = analyze(s, candles, {
        ...DEFAULT_PARAMS,
        emaFast: settings?.ema_fast ?? 50,
        emaSlow: settings?.ema_slow ?? 200,
        adxMin: settings?.adx_min ?? 20,
        atrSlMult: settings?.atr_sl_mult ?? 1.5,
        atrTpMult: settings?.atr_tp_mult ?? 3.0,
        minConfidence: minConf,
        riskPct: settings?.risk_per_trade ?? 0.75,
      });
      const lot = sig.side !== "FLAT" ? calculateLot(s, balance, settings?.risk_per_trade ?? 0.75, Math.abs(sig.entry - sig.stopLoss)) : 0;
      return { ...sig, lot };
    }).filter((s) => (filter === "all" ? true : s.side === filter));
  }, [settings, filter]);

  const queue = async (s: (typeof live)[number]) => {
    if (s.side === "FLAT") return;
    const { error } = await supabase.from("signals").insert({
      symbol: s.symbol,
      side: s.side,
      entry: s.entry,
      stop_loss: s.stopLoss,
      take_profit: s.takeProfit,
      lot: s.lot,
      risk_pct: settings?.risk_per_trade ?? 0.75,
      confidence: s.confidence,
      reason: s.reasons.join(" · "),
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`Signal queued: ${s.side} ${s.symbol}`);
      refetch();
    }
  };

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Signals</h1>
          <p className="text-sm text-muted-foreground">
            Live strategy scan. Queued signals are picked up by the MT5 bridge on its next poll.
          </p>
        </header>

        <div className="flex gap-2">
          {(["all", "BUY", "SELL"] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f}
            </Button>
          ))}
        </div>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {live.map((s) => (
            <Card key={s.symbol} className={cn("border-border/60 bg-card/70", s.symbol === "XAUUSD" && "border-gold/30")}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.symbol}</div>
                    <div className="mt-0.5 font-mono-tabular text-xl font-semibold">{fmt.price(s.entry, s.symbol)}</div>
                  </div>
                  <Badge
                    className={cn(
                      "border",
                      s.side === "BUY" && "border-bull/40 bg-bull/10 text-bull",
                      s.side === "SELL" && "border-bear/40 bg-bear/10 text-bear",
                      s.side === "FLAT" && "border-border bg-muted text-muted-foreground",
                    )}
                  >
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
                        <li key={i} className="flex gap-1.5">
                          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0 text-bull" /> {r}
                        </li>
                      ))}
                    </ul>
                    <Button size="sm" className="mt-3 w-full" onClick={() => queue(s)}>
                      <Send className="mr-1.5 h-3.5 w-3.5" /> Queue for MT5
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

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/60 bg-card/70">
            <CardHeader>
              <CardTitle className="text-base font-medium">Queue ({(pending ?? []).length})</CardTitle>
              <p className="text-xs text-muted-foreground">Waiting for the MT5 bridge to poll</p>
            </CardHeader>
            <CardContent className="p-0">
              <SignalTable rows={pending ?? []} />
            </CardContent>
          </Card>
          <Card className="border-border/60 bg-card/70">
            <CardHeader>
              <CardTitle className="text-base font-medium">History</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <SignalTable rows={history ?? []} />
            </CardContent>
          </Card>
        </section>
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

function SignalTable({ rows }: { rows: any[] }) {
  if (!rows.length)
    return <div className="px-6 pb-6 pt-2 text-xs text-muted-foreground">No signals yet.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-y border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Time</th>
            <th className="px-3 py-2 text-left">Symbol</th>
            <th className="px-3 py-2 text-left">Side</th>
            <th className="px-3 py-2 text-right">Entry</th>
            <th className="px-3 py-2 text-right">Lot</th>
            <th className="px-3 py-2 text-right">Conf.</th>
            <th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="font-mono-tabular">
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-border/40">
              <td className="px-3 py-2 text-muted-foreground">{new Date(r.created_at).toLocaleTimeString()}</td>
              <td className="px-3 py-2">{r.symbol}</td>
              <td className={cn("px-3 py-2 font-medium", r.side === "BUY" ? "text-bull" : "text-bear")}>{r.side}</td>
              <td className="px-3 py-2 text-right">{fmt.price(Number(r.entry), r.symbol)}</td>
              <td className="px-3 py-2 text-right">{Number(r.lot).toFixed(2)}</td>
              <td className="px-3 py-2 text-right">{Number(r.confidence).toFixed(0)}%</td>
              <td className="px-3 py-2 text-muted-foreground">{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
