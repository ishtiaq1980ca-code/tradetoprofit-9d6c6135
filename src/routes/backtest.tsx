import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateCandles } from "@/lib/mockFeed";
import { runBacktest, type BacktestResult } from "@/lib/backtest";
import { DEFAULT_PARAMS } from "@/lib/strategy";
import { fmt, SYMBOLS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Play } from "lucide-react";

export const Route = createFileRoute("/backtest")({
  head: () => ({ meta: [{ title: "Backtest — AurumAI" }, { name: "description", content: "Backtest the strategy on synthetic OHLC. Wire historical MT5 data once the bridge is live." }] }),
  component: BacktestPage,
});

function BacktestPage() {
  const [symbol, setSymbol] = useState<string>("XAUUSD");
  const [bars, setBars] = useState(800);
  const [balance, setBalance] = useState(10_000);
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const run = () => {
    const candles = generateCandles(symbol, bars);
    setResult(runBacktest(symbol, candles, params, balance));
  };

  const curve = useMemo(() => result?.equityCurve ?? [], [result]);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Backtest</h1>
          <p className="text-sm text-muted-foreground">
            Walk-forward bar-by-bar test using the same multi-filter strategy. Synthetic OHLC for now —
            swap in MT5 historical bars when the bridge is wired.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="border-border/60 bg-card/70 h-fit">
            <CardHeader>
              <CardTitle className="text-base">Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Symbol">
                <Select value={symbol} onValueChange={setSymbol}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SYMBOLS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Bars">
                <Input type="number" value={bars} onChange={(e) => setBars(+e.target.value || 800)} />
              </Field>
              <Field label="Start balance ($)">
                <Input type="number" value={balance} onChange={(e) => setBalance(+e.target.value || 10000)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="EMA fast"><Input type="number" value={params.emaFast} onChange={(e) => setParams({ ...params, emaFast: +e.target.value || 50 })} /></Field>
                <Field label="EMA slow"><Input type="number" value={params.emaSlow} onChange={(e) => setParams({ ...params, emaSlow: +e.target.value || 200 })} /></Field>
                <Field label="ADX min"><Input type="number" value={params.adxMin} onChange={(e) => setParams({ ...params, adxMin: +e.target.value || 20 })} /></Field>
                <Field label="Risk %"><Input type="number" step="0.1" value={params.riskPct} onChange={(e) => setParams({ ...params, riskPct: +e.target.value || 0.75 })} /></Field>
                <Field label="ATR SL ×"><Input type="number" step="0.1" value={params.atrSlMult} onChange={(e) => setParams({ ...params, atrSlMult: +e.target.value || 1.5 })} /></Field>
                <Field label="ATR TP ×"><Input type="number" step="0.1" value={params.atrTpMult} onChange={(e) => setParams({ ...params, atrTpMult: +e.target.value || 3 })} /></Field>
                <Field label="Min confidence"><Input type="number" value={params.minConfidence} onChange={(e) => setParams({ ...params, minConfidence: +e.target.value || 75 })} /></Field>
              </div>
              <Button onClick={run} className="w-full"><Play className="mr-1.5 h-4 w-4" /> Run backtest</Button>
            </CardContent>
          </Card>

          <div className="space-y-6">
            {!result ? (
              <Card className="border-border/60 bg-card/70">
                <CardContent className="grid h-64 place-items-center text-sm text-muted-foreground">
                  Configure parameters and run a backtest.
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                  <Stat label="Net Profit" value={fmt.money(result.netProfit)} tone={result.netProfit >= 0 ? "bull" : "bear"} />
                  <Stat label="Win Rate" value={`${result.winRate.toFixed(1)}%`} />
                  <Stat label="Profit Factor" value={isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : "∞"} />
                  <Stat label="Max Drawdown" value={`${result.maxDrawdown.toFixed(2)}%`} tone="bear" />
                  <Stat label="Total Trades" value={`${result.trades}`} />
                  <Stat label="Wins / Losses" value={`${result.wins} / ${result.losses}`} />
                  <Stat label="End Balance" value={fmt.money(result.endBalance)} />
                  <Stat label="Avg Trade" value={fmt.money(result.trades ? result.netProfit / result.trades : 0)} />
                </div>

                <Card className="border-border/60 bg-card/70">
                  <CardHeader><CardTitle className="text-base">Equity Curve</CardTitle></CardHeader>
                  <CardContent className="h-72 px-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={curve}>
                        <defs>
                          <linearGradient id="bt" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="t" hide />
                        <YAxis domain={["dataMin", "dataMax"]} hide />
                        <Tooltip
                          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number) => fmt.money(v)}
                          labelFormatter={(v) => new Date(v as number).toLocaleString()}
                        />
                        <Area type="monotone" dataKey="equity" stroke="var(--gold)" strokeWidth={2} fill="url(#bt)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card className="border-border/60 bg-card/70">
                  <CardHeader><CardTitle className="text-base">Trade Log (last 20)</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs font-mono-tabular">
                        <thead className="border-y border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left">Time</th>
                            <th className="px-3 py-2 text-left">Side</th>
                            <th className="px-3 py-2 text-right">Entry</th>
                            <th className="px-3 py-2 text-right">Exit</th>
                            <th className="px-3 py-2 text-right">P/L</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.log.slice(-20).reverse().map((t, i) => (
                            <tr key={i} className="border-b border-border/40">
                              <td className="px-3 py-1.5 text-muted-foreground">{new Date(t.time).toLocaleDateString()}</td>
                              <td className={cn("px-3 py-1.5", t.side === "BUY" ? "text-bull" : "text-bear")}>{t.side}</td>
                              <td className="px-3 py-1.5 text-right">{fmt.price(t.entry, symbol)}</td>
                              <td className="px-3 py-1.5 text-right">{fmt.price(t.exit, symbol)}</td>
                              <td className={cn("px-3 py-1.5 text-right", t.profit >= 0 ? "text-bull" : "text-bear")}>{fmt.money(t.profit)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <Card className="border-border/60 bg-card/70">
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn("mt-1 font-mono-tabular text-xl font-semibold", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{value}</div>
      </CardContent>
    </Card>
  );
}
