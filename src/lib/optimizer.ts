// Strategy parameter optimizer — grid search on top of the existing
// backtest engine (src/lib/backtest.ts). Nothing here touches the live
// trading path; it is an offline research tool.

import type { Candle } from "./indicators";
import { runBacktest, type BacktestResult } from "./backtest";
import type { StrategyParams } from "./strategy";

/** Numeric parameters that can be swept. */
export type SweepKey =
  | "emaFast" | "emaSlow" | "rsiPeriod" | "rsiBuyMax" | "rsiSellMin"
  | "adxMin" | "atrSlMult" | "atrTpMult" | "minConfidence" | "riskPct";

export type Range = { from: number; to: number; step: number };

export const SWEEP_LABELS: Record<SweepKey, string> = {
  emaFast: "EMA fast",
  emaSlow: "EMA slow",
  rsiPeriod: "RSI period",
  rsiBuyMax: "RSI buy max",
  rsiSellMin: "RSI sell min",
  adxMin: "ADX min",
  atrSlMult: "ATR SL ×",
  atrTpMult: "ATR TP × (RR target)",
  minConfidence: "Min confidence",
  riskPct: "Risk %",
};

export type OptimizerMetric = "netProfit" | "profitFactor" | "sharpe" | "winRate";

export type OptimizerRow = {
  params: StrategyParams;
  combo: Partial<Record<SweepKey, number>>;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  netProfit: number;
  maxDrawdown: number;
  endBalance: number;
  /** Mean trade return / stdev of trade returns × sqrt(n) — a simple Sharpe-like score. */
  sharpe: number;
  score: number;
};

/** Expand a range into concrete values (inclusive of `to` when it lands on a step). */
export function expandRange(r: Range): number[] {
  const step = Math.abs(r.step) || 1;
  const lo = Math.min(r.from, r.to);
  const hi = Math.max(r.from, r.to);
  const out: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(+v.toFixed(4));
  return out.length ? out : [lo];
}

/** Cartesian product of all selected sweep ranges. */
export function buildGrid(ranges: Partial<Record<SweepKey, Range>>): Array<Partial<Record<SweepKey, number>>> {
  const keys = Object.keys(ranges) as SweepKey[];
  let combos: Array<Partial<Record<SweepKey, number>>> = [{}];
  for (const k of keys) {
    const values = expandRange(ranges[k]!);
    const next: Array<Partial<Record<SweepKey, number>>> = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [k]: v });
    combos = next;
  }
  return combos;
}

function sharpeOf(result: BacktestResult): number {
  const rets = result.log.map((t) => t.profit);
  if (rets.length < 2) return 0;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const sd = Math.sqrt(variance);
  if (sd <= 0) return 0;
  return (mean / sd) * Math.sqrt(rets.length);
}

export function scoreOf(row: Omit<OptimizerRow, "score">, metric: OptimizerMetric): number {
  switch (metric) {
    case "profitFactor": return isFinite(row.profitFactor) ? row.profitFactor : 999;
    case "sharpe": return row.sharpe;
    case "winRate": return row.winRate;
    default: return row.netProfit;
  }
}

export type OptimizeOptions = {
  symbol: string;
  candles: Candle[];
  base: StrategyParams;
  ranges: Partial<Record<SweepKey, Range>>;
  startBalance: number;
  metric: OptimizerMetric;
  /** Ignore combinations that produced fewer than this many trades. */
  minTrades?: number;
  /** Hard cap on grid size to keep the UI responsive. */
  maxCombos?: number;
  onProgress?: (done: number, total: number) => void;
};

export type OptimizeOutcome = {
  rows: OptimizerRow[];
  total: number;
  truncated: boolean;
};

/** Run the grid search. Synchronous per combo; the caller yields between
 *  chunks so the UI stays responsive. */
export function optimize(opts: OptimizeOptions): OptimizeOutcome {
  const { symbol, candles, base, ranges, startBalance, metric } = opts;
  const minTrades = opts.minTrades ?? 5;
  const maxCombos = opts.maxCombos ?? 400;

  const all = buildGrid(ranges);
  const truncated = all.length > maxCombos;
  const grid = truncated ? all.slice(0, maxCombos) : all;

  const rows: OptimizerRow[] = [];
  grid.forEach((combo, i) => {
    const params: StrategyParams = { ...base, ...combo };
    // Guard nonsense combos (fast >= slow never produces a clean cross).
    if (params.emaFast >= params.emaSlow) return;
    const r = runBacktest(symbol, candles, params, startBalance);
    if (r.trades < minTrades) return;
    const partial = {
      params, combo,
      trades: r.trades, wins: r.wins, losses: r.losses,
      winRate: r.winRate, profitFactor: r.profitFactor,
      netProfit: r.netProfit, maxDrawdown: r.maxDrawdown,
      endBalance: r.endBalance, sharpe: sharpeOf(r),
    };
    rows.push({ ...partial, score: scoreOf(partial, metric) });
    opts.onProgress?.(i + 1, grid.length);
  });

  rows.sort((a, b) => b.score - a.score);
  return { rows, total: all.length, truncated };
}

/** Walk-forward validation: split the candles into N segments, optimize on the
 *  in-sample part and measure the winner on the following out-of-sample part. */
export type WalkForwardSegment = {
  index: number;
  inSampleBars: number;
  outOfSampleBars: number;
  bestCombo: Partial<Record<SweepKey, number>>;
  inSampleScore: number;
  outOfSampleNetProfit: number;
  outOfSampleTrades: number;
  outOfSampleProfitFactor: number;
};

export function walkForward(opts: OptimizeOptions & { folds?: number; oosRatio?: number }): WalkForwardSegment[] {
  const folds = Math.max(2, Math.min(6, opts.folds ?? 3));
  const oosRatio = Math.min(0.5, Math.max(0.1, opts.oosRatio ?? 0.3));
  const total = opts.candles.length;
  const segLen = Math.floor(total / folds);
  const out: WalkForwardSegment[] = [];

  for (let f = 0; f < folds; f++) {
    const start = f * segLen;
    const end = f === folds - 1 ? total : start + segLen;
    const seg = opts.candles.slice(start, end);
    const split = Math.floor(seg.length * (1 - oosRatio));
    const inSample = seg.slice(0, split);
    const oos = seg.slice(split);
    if (inSample.length < 300 || oos.length < 60) continue;

    const res = optimize({ ...opts, candles: inSample, onProgress: undefined });
    const best = res.rows[0];
    if (!best) continue;
    const oosRun = runBacktest(opts.symbol, oos, best.params, opts.startBalance, Math.min(220, Math.floor(oos.length / 3)));
    out.push({
      index: f + 1,
      inSampleBars: inSample.length,
      outOfSampleBars: oos.length,
      bestCombo: best.combo,
      inSampleScore: best.score,
      outOfSampleNetProfit: oosRun.netProfit,
      outOfSampleTrades: oosRun.trades,
      outOfSampleProfitFactor: oosRun.profitFactor,
    });
  }
  return out;
}
