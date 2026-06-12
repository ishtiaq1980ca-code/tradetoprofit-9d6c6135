import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowDown, ArrowUp, ShieldCheck, TrendingUp, Wallet, Zap } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { generateCandles } from "@/lib/mockFeed";
import { analyze } from "@/lib/strategy";
import { fmt, SYMBOLS } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AurumAI — Gold & FX Trading Bot Dashboard" },
      { name: "description", content: "Professional AI-powered Forex bot for XAUUSD and major pairs, connected to MetaTrader 5." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data: settings } = useQuery({
    queryKey: ["bot_settings"],
    queryFn: async () => {
      const { data } = await supabase.from("bot_settings").select("*").eq("id", 1).maybeSingle();
      return data;
    },
  });

  const { data: snap } = useQuery({
    queryKey: ["account_snapshot"],
    queryFn: async () => {
      const { data } = await supabase
        .from("account_snapshots")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    refetchInterval: 5000,
  });

  const { data: trades } = useQuery({
    queryKey: ["trades_recent"],
    queryFn: async () => {
      const { data } = await supabase.from("trades").select("*").order("opened_at", { ascending: false }).limit(50);
      return data ?? [];
    },
    refetchInterval: 10000,
  });

  const signals = useMemo(() => {
    return SYMBOLS.map((s) => {
      const candles = generateCandles(s, 260);
      return { symbol: s, candles, signal: analyze(s, candles), price: candles[candles.length - 1].close };
    });
  }, []);

  const balance = snap?.balance ?? 10_000;
  const equity = snap?.equity ?? balance;
  const dailyPnl = snap?.daily_pnl ?? 0;
  const closed = (trades ?? []).filter((t) => t.status === "closed");
  const wins = closed.filter((t) => (t.profit ?? 0) > 0).length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  const totalPnl = closed.reduce((s, t) => s + Number(t.profit ?? 0), 0);

  const equityCurve = useMemo(() => {
    let bal = balance - totalPnl;
    return closed
      .slice()
      .reverse()
      .map((t) => {
        bal += Number(t.profit ?? 0);
        return { t: new Date(t.closed_at ?? t.opened_at).getTime(), equity: bal };
      });
  }, [closed, balance, totalPnl]);

  const goldCurve = useMemo(() => signals[0].candles.slice(-80).map((c) => ({ t: c.time, p: c.close })), [signals]);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", settings?.enabled ? "bg-bull animate-pulse" : "bg-muted-foreground")} />
              {settings?.enabled ? "Bot Active" : "Bot Paused"} · {(settings?.account_mode ?? "demo").toUpperCase()}
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Trading Dashboard</h1>
            <p className="text-sm text-muted-foreground">XAUUSD · EURUSD · GBPUSD · USDJPY · AUDUSD · USDCAD · USDCHF</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-gold/40 text-gold">
              Risk {settings?.risk_per_trade ?? 0.75}% / trade
            </Badge>
            <Badge variant="outline">Max DD {settings?.max_daily_loss ?? 3}%/day</Badge>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Wallet} label="Balance" value={fmt.money(balance)} hint={`Equity ${fmt.money(equity)}`} />
          <Stat
            icon={TrendingUp}
            label="Daily P&L"
            value={fmt.money(dailyPnl)}
            hint={fmt.pct((dailyPnl / balance) * 100)}
            tone={dailyPnl >= 0 ? "bull" : "bear"}
          />
          <Stat icon={Activity} label="Total P&L" value={fmt.money(totalPnl)} hint={`${closed.length} closed trades`} tone={totalPnl >= 0 ? "bull" : "bear"} />
          <Stat icon={ShieldCheck} label="Win Rate" value={`${winRate.toFixed(1)}%`} hint={`${wins} W / ${closed.length - wins} L`} />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 border-border/60 bg-card/70 backdrop-blur">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base font-medium">XAUUSD — Gold</CardTitle>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono-tabular text-2xl font-semibold text-gold">{fmt.price(signals[0].price, "XAUUSD")}</span>
                  <span className="text-xs text-muted-foreground">15m chart · last 80 bars</span>
                </div>
              </div>
              <SignalPill signal={signals[0].signal} />
            </CardHeader>
            <CardContent className="h-72 px-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={goldCurve}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="t" hide />
                  <YAxis domain={["dataMin", "dataMax"]} hide />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    labelFormatter={(v) => new Date(v as number).toLocaleString()}
                    formatter={(v: number) => fmt.price(v, "XAUUSD")}
                  />
                  <Area type="monotone" dataKey="p" stroke="var(--gold)" strokeWidth={2} fill="url(#g1)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/70 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base font-medium">Equity Curve</CardTitle>
              <p className="text-xs text-muted-foreground">From closed trades</p>
            </CardHeader>
            <CardContent className="h-72 px-0">
              {equityCurve.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground px-6 text-center">
                  No closed trades yet. The curve builds once the MT5 bridge reports filled trades.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityCurve}>
                    <defs>
                      <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--bull)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--bull)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="t" hide />
                    <YAxis domain={["dataMin", "dataMax"]} hide />
                    <Tooltip
                      contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: number) => fmt.money(v)}
                    />
                    <Area type="monotone" dataKey="equity" stroke="var(--bull)" strokeWidth={2} fill="url(#g2)" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium">Live Strategy Scan</h2>
            <a href="/signals">
              <Button variant="outline" size="sm">
                <Zap className="mr-1.5 h-3.5 w-3.5" /> All signals
              </Button>
            </a>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {signals.map((s) => (
              <SymbolCard key={s.symbol} symbol={s.symbol} price={s.price} signal={s.signal} />
            ))}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  hint?: string;
  tone?: "bull" | "bear";
}) {
  return (
    <Card className="border-border/60 bg-card/70">
      <CardContent className="p-5">
        <div className="flex items-center justify-between text-xs uppercase tracking-wider text-muted-foreground">
          <span>{label}</span>
          <Icon className="h-4 w-4 opacity-60" />
        </div>
        <div className={cn("mt-2 font-mono-tabular text-2xl font-semibold", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>
          {value}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function SignalPill({ signal }: { signal: ReturnType<typeof analyze> }) {
  const tone = signal.side === "BUY" ? "bull" : signal.side === "SELL" ? "bear" : "flat";
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
        tone === "bull" && "border-bull/40 bg-bull/10 text-bull",
        tone === "bear" && "border-bear/40 bg-bear/10 text-bear",
        tone === "flat" && "border-border bg-muted text-muted-foreground",
      )}
    >
      {signal.side === "BUY" && <ArrowUp className="h-3.5 w-3.5" />}
      {signal.side === "SELL" && <ArrowDown className="h-3.5 w-3.5" />}
      {signal.side} · {signal.confidence}%
    </div>
  );
}

function SymbolCard({ symbol, price, signal }: { symbol: string; price: number; signal: ReturnType<typeof analyze> }) {
  return (
    <Card className={cn("border-border/60 bg-card/70 transition-colors", symbol === "XAUUSD" && "border-gold/30")}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{symbol}</div>
            <div className="mt-0.5 font-mono-tabular text-xl font-semibold">{fmt.price(price, symbol)}</div>
          </div>
          <SignalPill signal={signal} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <Filter label="Trend" ok={signal.filters.trend} />
          <Filter label="Momentum" ok={signal.filters.momentum} />
          <Filter label="Structure" ok={signal.filters.structure} />
        </div>
        {signal.side !== "FLAT" && (
          <div className="mt-3 space-y-1 rounded-md border border-border/60 bg-background/40 p-2.5 text-[11px] font-mono-tabular">
            <Row k="Entry" v={fmt.price(signal.entry, symbol)} />
            <Row k="SL" v={fmt.price(signal.stopLoss, symbol)} tone="bear" />
            <Row k="TP" v={fmt.price(signal.takeProfit, symbol)} tone="bull" />
            <Row k="R:R" v={`${signal.riskReward.toFixed(2)}`} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "bull" | "bear" }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn(tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{v}</span>
    </div>
  );
}

function Filter({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={cn("flex items-center justify-center rounded-md border py-1", ok ? "border-bull/30 bg-bull/5 text-bull" : "border-border text-muted-foreground")}>
      {label}
    </div>
  );
}
