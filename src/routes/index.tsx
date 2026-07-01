import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Bot, Pause, Play, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LicenseAndTierPanel } from "@/components/LicenseAndTierPanel";
import { SessionBadge } from "@/components/SessionBadge";
import { Mt5AccountPanel } from "@/components/Mt5AccountPanel";
import { LiveAccountsPerformance } from "@/components/AccountPerformance";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { analyze, calculateLot, DEFAULT_PARAMS } from "@/lib/strategy";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePriceFeed } from "@/hooks/usePriceFeed";
import { floatingPnl, pnlOf, useAccount } from "@/lib/paperTrading";
import { useBot, triggerManualScan } from "@/lib/tradingBot";
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

  // Strategy scan removed from dashboard.
  const signals: never[] = useMemo(() => [], []);
  void signals;

  const floating = floatingPnl(positions, feed.prices);
  const equity = balance + floating;
  const closed = history;
  

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
    if (!candles || candles.length < 60) { toast.error("Warming up market data…"); return; }
    const sig = analyze("XAUUSD", candles, DEFAULT_PARAMS);
    const entry = xauPrice;
    const atrDist = Math.abs(sig.entry - sig.stopLoss) || entry * 0.002;
    const sl = side === "BUY" ? entry - atrDist : entry + atrDist;
    const tp = side === "BUY" ? entry + atrDist * 2 : entry - atrDist * 2;
    const lot = calculateLot("XAUUSD", balance, 1, Math.abs(entry - sl));
    const pos = open({ symbol: "XAUUSD", side, lot, entry, stopLoss: sl, takeProfit: tp, confidence: sig.confidence, reason: "manual quick trade" });
    if (pos) toast.success(`${side} ${lot} XAUUSD @ ${fmt.price(entry, "XAUUSD")}`);
  };

  const botEnabled = useBot((s) => s.enabled);
  const botSetEnabled = useBot((s) => s.setEnabled);
  const botHalted = useBot((s) => s.haltedToday);
  const lastScanAt = useBot((s) => s.lastScanAt);
  const botLog = useBot((s) => s.log);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const feedFresh = now - feed.updatedAt < 8_000;
  const connected = feedFresh && Object.keys(feed.prices).length > 0;

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5", connected ? "border-bull/40 text-bull" : "border-bear/40 text-bear")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-bull animate-pulse" : "bg-bear")} />
                {connected ? "CONNECTED" : "DISCONNECTED"}
              </span>
              <span>{feed.source === "live" ? "Live spot feed" : "Simulated feed"} · Paper · ${startingBalance.toLocaleString()} starting</span>
            </div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Trading Dashboard</h1>
            <p className="text-sm text-muted-foreground">XAUUSD · EURUSD · GBPUSD · USDJPY · AUDUSD · USDCAD · USDCHF</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={botEnabled ? "outline" : "default"}
              className={cn(botEnabled ? "border-bear/40 text-bear hover:bg-bear/10" : "bg-gold text-primary-foreground hover:bg-gold/90")}
              onClick={() => {
                if (!useBot.getState().licenseValid) {
                  toast.error("Activate a license token to start the bot");
                  return;
                }
                botSetEnabled(!botEnabled);
                toast.success(botEnabled ? "Bot stopped" : "Bot started — scanning continuously");
                if (!botEnabled) triggerManualScan();
              }}
            >
              {botEnabled ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
              {botEnabled ? "Stop Bot" : "Start Bot"}
            </Button>
            <Badge variant="outline" className={cn(botEnabled ? "border-bull/40 text-bull" : "border-border text-muted-foreground")}>
              <Bot className="mr-1 h-3 w-3" />
              {botHalted ? "Halted (daily loss)" : botEnabled ? `Active · ${lastScanAt ? `${Math.max(0, Math.round((now - lastScanAt) / 1000))}s ago` : "scanning…"}` : "Idle"}
            </Badge>
            <Badge variant="outline" className="border-gold/40 text-gold">Risk 1% / trade</Badge>
            <Button variant="outline" size="sm" onClick={() => { if (confirm("Reset paper account to $10,000?")) { reset(); toast.success("Account reset"); } }}>
              Reset
            </Button>
          </div>
        </header>

        <LiveAccountsPerformance />


        <SessionBadge />

        <Mt5AccountPanel />

        <LicenseAndTierPanel />





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
          <Card className="border-border/60 bg-card/70">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base font-medium">Bot Activity</CardTitle>
              <span className="text-xs text-muted-foreground">
                {botEnabled ? `Scanning every ${Math.round(useBot.getState().scanIntervalMs / 1000)}s` : "Bot idle"}
              </span>
            </CardHeader>
            <CardContent className="p-0">
              {botLog.length === 0 ? (
                <div className="px-6 pb-6 pt-2 text-sm text-muted-foreground">
                  No activity yet. Start the bot — entries and reasons will appear here.
                </div>
              ) : (
                <ul className="max-h-64 overflow-y-auto divide-y divide-border/40 text-xs font-mono-tabular">
                  {botLog.map((e, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-2">
                      <span className="text-muted-foreground whitespace-nowrap">{new Date(e.t).toLocaleTimeString()}</span>
                      <span className={cn(
                        "uppercase text-[10px] tracking-wider px-1.5 py-0.5 rounded border whitespace-nowrap",
                        e.level === "trade" && "border-bull/40 text-bull",
                        e.level === "warn" && "border-bear/40 text-bear",
                        e.level === "info" && "border-border text-muted-foreground",
                      )}>{e.level}</span>
                      <span className="flex-1 break-words">{e.msg}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>

      </div>
    </AppShell>
  );
}


