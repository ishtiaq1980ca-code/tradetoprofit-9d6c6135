// Simple bar-by-bar backtester that walks the candle history, runs the
// strategy on each closed bar, and simulates SL/TP fills on the next bar.

import type { Candle } from "./indicators";
import { analyze, calculateLot, type StrategyParams } from "./strategy";

export type BacktestResult = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  netProfit: number;
  maxDrawdown: number;
  endBalance: number;
  equityCurve: { t: number; equity: number }[];
  log: Array<{ time: number; side: "BUY" | "SELL"; entry: number; exit: number; profit: number; result: "win" | "loss" }>;
};

export function runBacktest(
  symbol: string,
  candles: Candle[],
  params: StrategyParams,
  startBalance = 10_000,
  warmup = 220,
): BacktestResult {
  let balance = startBalance;
  let equityPeak = startBalance;
  let maxDD = 0;
  const equityCurve: { t: number; equity: number }[] = [];
  const log: BacktestResult["log"] = [];
  let grossProfit = 0, grossLoss = 0, wins = 0, losses = 0;

  for (let i = warmup; i < candles.length - 1; i++) {
    const slice = candles.slice(0, i + 1);
    const sig = analyze(symbol, slice, params);
    if (sig.side === "FLAT") {
      equityCurve.push({ t: candles[i].time, equity: balance });
      continue;
    }
    const next = candles[i + 1];
    const slDist = Math.abs(sig.entry - sig.stopLoss);
    const lot = calculateLot(symbol, balance, params.riskPct, slDist);
    const isGold = symbol === "XAUUSD";
    const isJpy = symbol.endsWith("JPY");
    const valuePerUnit = isGold ? 100 : isJpy ? 1000 : 100000;

    let exit = 0;
    if (sig.side === "BUY") {
      if (next.low <= sig.stopLoss) exit = sig.stopLoss;
      else if (next.high >= sig.takeProfit) exit = sig.takeProfit;
      else exit = next.close;
    } else {
      if (next.high >= sig.stopLoss) exit = sig.stopLoss;
      else if (next.low <= sig.takeProfit) exit = sig.takeProfit;
      else exit = next.close;
    }
    const dir = sig.side === "BUY" ? 1 : -1;
    const profit = (exit - sig.entry) * dir * lot * valuePerUnit;
    balance += profit;
    if (profit >= 0) { wins++; grossProfit += profit; } else { losses++; grossLoss -= profit; }
    log.push({ time: next.time, side: sig.side, entry: sig.entry, exit, profit, result: profit >= 0 ? "win" : "loss" });
    equityPeak = Math.max(equityPeak, balance);
    maxDD = Math.max(maxDD, (equityPeak - balance) / equityPeak * 100);
    equityCurve.push({ t: next.time, equity: balance });
  }

  const trades = wins + losses;
  return {
    trades,
    wins,
    losses,
    winRate: trades ? (wins / trades) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    netProfit: balance - startBalance,
    maxDrawdown: maxDD,
    endBalance: balance,
    equityCurve,
    log,
  };
}
