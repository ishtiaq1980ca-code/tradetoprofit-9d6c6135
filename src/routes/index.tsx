import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, ArrowDown, ArrowUp, ShieldCheck, TrendingUp, Wallet, X, Zap } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { analyze, calculateLot, DEFAULT_PARAMS } from "@/lib/strategy";
import { fmt, SYMBOLS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePriceFeed } from "@/hooks/usePriceFeed";
import { floatingPnl, pnlOf, useAccount } from "@/lib/paperTrading";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AurumAI — Paper Trading Dashboard" },
      { name: "description", content: "Professional AI-powered Forex paper trading for XAUUSD and majors with live ticks, risk-managed orders, and strategy signals." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const feed = usePriceFeed();
  const balance = useAccount((s) => s.balance);
  const startingBalance = useAccount((s) => s.startingBalance);
  const positions = useAccount((s) => s.positions);
  const history = useAccount((s) => s.history);
  const open = useAccount((s) => s.open);
  const close = useAccount((s) => s.close);
  const reset = useAccount((s) => s.reset);

  const signals = useMemo(() => {
    return SYMBOLS.map((s) => {
      const candles = feed.candles[s] ?? [];
      if (candles.length < 220) return { symbol: s, candles, signal: null as any, price: feed.prices[s] ?? 0 };
      return { symbol: s, candles, signal: analyze(s, candles, DEFAULT_PARAMS), price: feed.prices[s] ?? candles[candles.length - 1].close };
    });
    // re-evaluate strategy on candle additions, not on every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.candles.XAUUSD?.length]);

  const floating = floatingPnl(positions, feed.prices);
  const equity = balance + floating;
  const closed = history;
  const wins = closed.filter((t) => t.profit > 0).length;
  const losses = closed.length - wins;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  const totalPnl = balance - startingBalance + floating;

  // Today's P/L (closed today + floating)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const dailyClosed = closed.filter((t) => t.closedAt >= todayStart.getTime()).reduce((s, t) => s + t.profit, 0);
  const dailyPnl = dailyClosed + floating;

  // Drawdown from peak equity
  const equityCurve = useMemo(() => {
    let bal = startingBalance;
    const pts = closed
      .slice()
      .reverse()
      .map((t) => {
        bal += t.profit;
        return { t: t.closedAt, equity: bal };
      });
    return pts;
  }, [closed, startingBalance]);
  const peak = equityCurve.reduce((m, p) => Math.max(m, p.equity), startingBalance);
  const drawdown = peak > 0 ? Math.max(0, ((peak - equity) / peak) * 100) : 0;

  const xau = feed.candles.XAUUSD ?? [];
  const goldCurve = xau.slice(-80).map((c) => ({ t: c.time, p: c.close }));
  const xauPrice = feed.prices.XAUUSD ?? 0;

  const quickTrade = (side: "BUY" | "SELL") => {
    const candles = feed.candles.XAUUSD;
    if (!candles || candles.length < 220) { toast.error("Warming up market data…"); return; }
    const sig = analyze("XAUUSD", candles, DEFAULT_PARAMS);
    const entry = xauPrice;
    const atrDist = Math.abs(sig.entry - sig.stopLoss) || entry * 0.002;
    const sl = side === "BUY" ? entry - atrDist : entry + atrDist;
    const tp = side === "BUY" ? entry + atrDist * 2 : entry - atrDist * 2;
    const lot = calculateLot("XAUUSD", balance, 1, Math.abs(entry - sl));
    const pos = open({ symbol: "XAUUSD", side, lot, entry, stopLoss: sl, takeProfit: tp, confidence: sig.confidence, reason: "manual quick trade" });
    if (pos) toast.success(`${side} ${lot} XAUUSD @ ${fmt.price(entry, "XAUUSD")}`);
  };

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", feed.source === "live" ? "bg-bull animate-pulse" : "bg-gold animate-pulse")} />
              {feed.source === "live" ? "Live spot feed" : "Simulated feed"} · Paper · ${startingBalance.toLocaleString()} starting
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Trading Dashboard</h1>
            <p className="text-sm text-muted-foreground">XAUUSD · EURUSD · GBPUSD · USDJPY · AUDUSD · USDCAD · USDCHF</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-gold/40 text-gold">Risk 1% / trade</Badge>
            <Badge variant="outline">RR 1:2</Badge>
            <Button variant="outline" size="sm" onClick={() => { if (confirm("Reset paper account to $10,000?")) { reset(); toast.success("Account reset"); } }}>
              Reset
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Wallet} label="Balance" value={fmt.money(balance)} hint={`Equity ${fmt.money(equity)}`} />
          <Stat icon={Activity} label="Floating P&L" value={fmt.money(floating)} hint={`${positions.length} open`} tone={floating >= 0 ? "bull" : "bear"} />
          <Stat icon={TrendingUp} label="Today P&L" value={fmt.money(dailyPnl)} hint={fmt.pct((dailyPnl / startingBalance) * 100)} tone={dailyPnl >= 0 ? "bull" : "bear"} />
          <Stat icon={ShieldCheck} label="Win Rate" value={`${winRate.toFixed(1)}%`} hint={`${wins} W / ${losses} L · DD ${drawdown.toFixed(1)}%`} />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 border-border/60 bg-card/70 backdrop-blur">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base font-medium">XAUUSD — Gold</CardTitle>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono-tabular text-2xl font-semibold text-gold">{fmt.price(xauPrice, "XAUUSD")}</span>
                  <span className="text-xs text-muted-foreground">1m · last 80 bars</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="border-bull/40 text-bull hover:bg-bull/10" onClick={() => quickTrade("BUY")}>
                  <ArrowUp className="mr-1 h-3.5 w-3.5" /> Buy
                </Button>
                <Button size="sm" variant="outline" className="border-bear/40 text-bear hover:bg-bear/10" onClick={() => quickTrade("SELL")}>
                  <ArrowDown className="mr-1 h-3.5 w-3.5" /> Sell
                </Button>
              </div>
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
                    labelFormatter={(v) => new Date(v as number).toLocaleTimeString()}
                    formatter={(v: number) => fmt.price(v, "XAUUSD")}
                  />
                  <Area type="monotone" dataKey="p" stroke="var(--gold)" strokeWidth={2} fill="url(#g1)" isAnimationActive={false} />
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
                  No closed trades yet. Take a quick trade or queue a signal to start the curve.
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
                    <Area type="monotone" dataKey="equity" stroke="var(--bull)" strokeWidth={2} fill="url(#g2)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="border-border/60 bg-card/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-medium">Open Positions ({positions.length})</CardTitle>
              <span className="text-xs text-muted-foreground">SL auto-trails after +0.5R · 50% off at +1R</span>
            </CardHeader>
            <CardContent className="p-0">
              {positions.length === 0 ? (
                <div className="px-6 pb-6 pt-2 text-sm text-muted-foreground">No open positions.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono-tabular">
                    <thead className="border-y border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
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
                            <td className="px-3 py-2">{p.symbol}</td>
                            <td className={cn("px-3 py-2 font-medium", p.side === "BUY" ? "text-bull" : "text-bear")}>{p.side}</td>
                            <td className="px-3 py-2 text-right">{p.lot.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right">{fmt.price(p.entry, p.symbol)}</td>
                            <td className="px-3 py-2 text-right">{fmt.price(price, p.symbol)}</td>
                            <td className="px-3 py-2 text-right text-bear">{fmt.price(p.stopLoss, p.symbol)}{p.breakEvenTriggered && " *"}</td>
                            <td className="px-3 py-2 text-right text-bull">{fmt.price(p.takeProfit, p.symbol)}</td>
                            <td className={cn("px-3 py-2 text-right", pnl >= 0 ? "text-bull" : "text-bear")}>{fmt.money(pnl)}</td>
                            <td className="px-3 py-2 text-right">
                              <Button size="sm" variant="ghost" onClick={() => { close(p.id, price); toast.success(`Closed ${p.symbol} ${pnl >= 0 ? "+" : ""}${fmt.money(pnl)}`); }}>
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

function Stat({ icon: Icon, label, value, hint, tone }: { icon: typeof Wallet; label: string; value: string; hint?: string; tone?: "bull" | "bear" }) {
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

function SignalPill({ signal }: { signal: ReturnType<typeof analyze> | null }) {
  if (!signal) return <span className="text-[10px] text-muted-foreground">warming up…</span>;
  const tone = signal.side === "BUY" ? "bull" : signal.side === "SELL" ? "bear" : "flat";
  return (
    <div className={cn(
      "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium",
      tone === "bull" && "border-bull/40 bg-bull/10 text-bull",
      tone === "bear" && "border-bear/40 bg-bear/10 text-bear",
      tone === "flat" && "border-border bg-muted text-muted-foreground",
    )}>
      {signal.side === "BUY" && <ArrowUp className="h-3.5 w-3.5" />}
      {signal.side === "SELL" && <ArrowDown className="h-3.5 w-3.5" />}
      {signal.side} · {signal.confidence}%
    </div>
  );
}

function SymbolCard({ symbol, price, signal }: { symbol: string; price: number; signal: ReturnType<typeof analyze> | null }) {
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
        {signal && (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              <FilterChip label="Trend" ok={signal.filters.trend} />
              <FilterChip label="Momentum" ok={signal.filters.momentum} />
              <FilterChip label="Structure" ok={signal.filters.structure} />
            </div>
            {signal.side !== "FLAT" && (
              <div className="mt-3 space-y-1 rounded-md border border-border/60 bg-background/40 p-2.5 text-[11px] font-mono-tabular">
                <Row k="Entry" v={fmt.price(signal.entry, symbol)} />
                <Row k="SL" v={fmt.price(signal.stopLoss, symbol)} tone="bear" />
                <Row k="TP" v={fmt.price(signal.takeProfit, symbol)} tone="bull" />
                <Row k="R:R" v={`${signal.riskReward.toFixed(2)}`} />
              </div>
            )}
          </>
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

function FilterChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={cn("flex items-center justify-center rounded-md border py-1", ok ? "border-bull/30 bg-bull/5 text-bull" : "border-border text-muted-foreground")}>
      {label}
    </div>
  );
}
