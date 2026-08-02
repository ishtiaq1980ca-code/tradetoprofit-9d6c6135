import { useMemo, useState } from "react";
import { Loader2, Play, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { generateCandles } from "@/lib/mockFeed";
import { DEFAULT_PARAMS } from "@/lib/strategy";
import {
  buildGrid, optimize, walkForward, SWEEP_LABELS,
  type OptimizerMetric, type OptimizerRow, type Range, type SweepKey, type WalkForwardSegment,
} from "@/lib/optimizer";
import { fmt, SYMBOLS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const DEFAULT_RANGES: Record<SweepKey, Range> = {
  emaFast: { from: 10, to: 30, step: 5 },
  emaSlow: { from: 40, to: 80, step: 10 },
  rsiPeriod: { from: 10, to: 20, step: 2 },
  rsiBuyMax: { from: 60, to: 75, step: 5 },
  rsiSellMin: { from: 25, to: 40, step: 5 },
  adxMin: { from: 15, to: 30, step: 5 },
  atrSlMult: { from: 1.4, to: 2.6, step: 0.4 },
  atrTpMult: { from: 2.0, to: 4.0, step: 0.5 },
  minConfidence: { from: 60, to: 85, step: 5 },
  riskPct: { from: 0.5, to: 2, step: 0.5 },
};

const METRICS: Array<{ v: OptimizerMetric; label: string }> = [
  { v: "netProfit", label: "Net profit" },
  { v: "profitFactor", label: "Profit factor" },
  { v: "sharpe", label: "Sharpe-like ratio" },
  { v: "winRate", label: "Win rate" },
];

const MAX_COMBOS = 400;

export function OptimizerPanel() {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [bars, setBars] = useState(1500);
  const [balance, setBalance] = useState(10_000);
  const [metric, setMetric] = useState<OptimizerMetric>("netProfit");
  const [minTrades, setMinTrades] = useState(5);
  const [selected, setSelected] = useState<SweepKey[]>(["emaFast", "emaSlow", "atrSlMult"]);
  const [ranges, setRanges] = useState<Record<SweepKey, Range>>(DEFAULT_RANGES);
  const [rows, setRows] = useState<OptimizerRow[] | null>(null);
  const [wf, setWf] = useState<WalkForwardSegment[] | null>(null);
  const [busy, setBusy] = useState(false);

  const activeRanges = useMemo(
    () => Object.fromEntries(selected.map((k) => [k, ranges[k]])) as Partial<Record<SweepKey, Range>>,
    [selected, ranges],
  );
  const comboCount = useMemo(() => buildGrid(activeRanges).length, [activeRanges]);

  const toggle = (k: SweepKey) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const setRange = (k: SweepKey, patch: Partial<Range>) =>
    setRanges((r) => ({ ...r, [k]: { ...r[k], ...patch } }));

  const run = async (withWalkForward: boolean) => {
    if (!selected.length) return toast.error("Select at least one parameter to sweep");
    setBusy(true);
    setRows(null);
    setWf(null);
    // Yield so the spinner paints before the synchronous sweep starts.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const candles = generateCandles(symbol, Math.max(600, bars));
      const opts = {
        symbol, candles, base: DEFAULT_PARAMS, ranges: activeRanges,
        startBalance: balance, metric, minTrades, maxCombos: MAX_COMBOS,
      };
      const out = optimize(opts);
      setRows(out.rows);
      if (out.truncated) toast.warning(`Grid truncated to the first ${MAX_COMBOS} of ${out.total} combinations`);
      if (!out.rows.length) toast.error(`No combination produced ≥ ${minTrades} trades`);
      if (withWalkForward) setWf(walkForward({ ...opts, folds: 3 }));
    } catch (e: any) {
      toast.error(e?.message ?? "Optimization failed");
    } finally {
      setBusy(false);
    }
  };

  const best = rows?.[0];
  const scoreRange = useMemo(() => {
    if (!rows?.length) return { min: 0, max: 1 };
    const vals = rows.map((r) => r.score).filter((v) => isFinite(v));
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [rows]);

  const heat = (v: number) => {
    const { min, max } = scoreRange;
    if (!isFinite(v) || max === min) return 0;
    return (v - min) / (max - min);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <Card className="h-fit border-border/60 bg-card/70">
        <CardHeader><CardTitle className="text-base">Sweep configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Symbol</Label>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SYMBOLS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Bars</Label>
              <Input type="number" value={bars} onChange={(e) => setBars(+e.target.value || 1500)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Start balance</Label>
              <Input type="number" value={balance} onChange={(e) => setBalance(+e.target.value || 10000)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Rank by</Label>
              <Select value={metric} onValueChange={(v) => setMetric(v as OptimizerMetric)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{METRICS.map((m) => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Min trades</Label>
              <Input type="number" value={minTrades} onChange={(e) => setMinTrades(Math.max(0, +e.target.value || 0))} />
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Parameters to sweep</div>
            {(Object.keys(SWEEP_LABELS) as SweepKey[]).map((k) => {
              const on = selected.includes(k);
              return (
                <div key={k} className={cn("rounded-md border px-2.5 py-2", on ? "border-gold/40 bg-gold/5" : "border-border/50")}>
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox checked={on} onCheckedChange={() => toggle(k)} />
                    {SWEEP_LABELS[k]}
                  </label>
                  {on && (
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <Input className="h-7 text-xs" type="number" step="0.1" value={ranges[k].from}
                        onChange={(e) => setRange(k, { from: +e.target.value })} placeholder="from" />
                      <Input className="h-7 text-xs" type="number" step="0.1" value={ranges[k].to}
                        onChange={(e) => setRange(k, { to: +e.target.value })} placeholder="to" />
                      <Input className="h-7 text-xs" type="number" step="0.1" value={ranges[k].step}
                        onChange={(e) => setRange(k, { step: +e.target.value })} placeholder="step" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={cn("text-[11px]", comboCount > MAX_COMBOS ? "text-bear" : "text-muted-foreground")}>
            {comboCount} combination{comboCount === 1 ? "" : "s"}
            {comboCount > MAX_COMBOS && ` — only the first ${MAX_COMBOS} will run`}
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={() => run(false)}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
              Run sweep
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => run(true)}>Walk-forward</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {!rows ? (
          <Card className="border-border/60 bg-card/70">
            <CardContent className="grid h-64 place-items-center text-sm text-muted-foreground">
              {busy ? "Running grid search…" : "Pick parameters and run a sweep."}
            </CardContent>
          </Card>
        ) : (
          <>
            {best && (
              <Card className="border-gold/40 bg-gold/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Trophy className="h-4 w-4 text-gold" /> Best combination
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(best.combo).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="font-mono-tabular text-[11px]">
                        {SWEEP_LABELS[k as SweepKey]}: {v}
                      </Badge>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Metric label="Net profit" value={fmt.money(best.netProfit)} tone={best.netProfit >= 0 ? "bull" : "bear"} />
                    <Metric label="Profit factor" value={isFinite(best.profitFactor) ? best.profitFactor.toFixed(2) : "∞"} />
                    <Metric label="Sharpe-like" value={best.sharpe.toFixed(2)} />
                    <Metric label="Max DD" value={`${best.maxDrawdown.toFixed(2)}%`} tone="bear" />
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="border-border/60 bg-card/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Results ({rows.length}) — ranked by {METRICS.find((m) => m.v === metric)?.label}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[520px] overflow-auto">
                  <table className="w-full text-xs font-mono-tabular">
                    <thead className="sticky top-0 border-y border-border/60 bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        {selected.map((k) => <th key={k} className="px-3 py-2 text-right">{SWEEP_LABELS[k]}</th>)}
                        <th className="px-3 py-2 text-right">Trades</th>
                        <th className="px-3 py-2 text-right">Win%</th>
                        <th className="px-3 py-2 text-right">PF</th>
                        <th className="px-3 py-2 text-right">Sharpe</th>
                        <th className="px-3 py-2 text-right">Max DD</th>
                        <th className="px-3 py-2 text-right">Net P/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 200).map((r, i) => (
                        <tr key={i} className="border-b border-border/40"
                          style={{ background: `color-mix(in oklab, var(--gold) ${(heat(r.score) * 22).toFixed(1)}%, transparent)` }}>
                          <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                          {selected.map((k) => <td key={k} className="px-3 py-1.5 text-right">{r.combo[k]}</td>)}
                          <td className="px-3 py-1.5 text-right">{r.trades}</td>
                          <td className="px-3 py-1.5 text-right">{r.winRate.toFixed(1)}</td>
                          <td className="px-3 py-1.5 text-right">{isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : "∞"}</td>
                          <td className="px-3 py-1.5 text-right">{r.sharpe.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right text-bear">{r.maxDrawdown.toFixed(1)}%</td>
                          <td className={cn("px-3 py-1.5 text-right", r.netProfit >= 0 ? "text-bull" : "text-bear")}>
                            {fmt.money(r.netProfit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {wf && wf.length > 0 && (
              <Card className="border-border/60 bg-card/70">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Walk-forward validation</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Best in-sample combination re-tested on the following unseen out-of-sample bars.
                  </p>
                </CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs font-mono-tabular">
                    <thead className="border-y border-border/60 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Fold</th>
                        <th className="px-3 py-2 text-left">Winning params</th>
                        <th className="px-3 py-2 text-right">IS score</th>
                        <th className="px-3 py-2 text-right">OOS trades</th>
                        <th className="px-3 py-2 text-right">OOS PF</th>
                        <th className="px-3 py-2 text-right">OOS net P/L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wf.map((s) => (
                        <tr key={s.index} className="border-b border-border/40">
                          <td className="px-3 py-1.5">{s.index}</td>
                          <td className="px-3 py-1.5 text-[11px]">
                            {Object.entries(s.bestCombo).map(([k, v]) => `${SWEEP_LABELS[k as SweepKey]} ${v}`).join(" · ")}
                          </td>
                          <td className="px-3 py-1.5 text-right">{s.inSampleScore.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right">{s.outOfSampleTrades}</td>
                          <td className="px-3 py-1.5 text-right">{isFinite(s.outOfSampleProfitFactor) ? s.outOfSampleProfitFactor.toFixed(2) : "∞"}</td>
                          <td className={cn("px-3 py-1.5 text-right", s.outOfSampleNetProfit >= 0 ? "text-bull" : "text-bear")}>
                            {fmt.money(s.outOfSampleNetProfit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="rounded-md border border-border/50 bg-card/60 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("font-mono-tabular text-sm font-semibold", tone === "bull" && "text-bull", tone === "bear" && "text-bear")}>{value}</div>
    </div>
  );
}
