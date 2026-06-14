// Auto-trading engine. When enabled, scans the live candle feed on each
// configured interval and opens demo positions for any symbol whose multi-
// filter strategy passes the confidence threshold. Respects max-daily-loss
// circuit breaker and never doubles up on a symbol that already has an open
// position. Mount <BotEngine /> once near the root to drive it.

import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { toast } from "sonner";
import { priceFeed } from "./priceFeed";
import { useAccount, floatingPnl } from "./paperTrading";
import { analyze, calculateLot, DEFAULT_PARAMS } from "./strategy";
import { SYMBOLS } from "./format";

type BotLogEntry = { t: number; level: "info" | "trade" | "warn"; msg: string };

type BotStore = {
  enabled: boolean;
  scanIntervalMs: number;
  minConfidence: number;
  riskPct: number;
  maxDailyLossPct: number;
  haltedToday: boolean;
  haltedDate: string | null;
  lastScanAt: number;
  log: BotLogEntry[];
  setEnabled: (v: boolean) => void;
  setMinConfidence: (n: number) => void;
  setRiskPct: (n: number) => void;
  pushLog: (entry: BotLogEntry) => void;
  setHalted: (v: boolean) => void;
  setLastScan: (t: number) => void;
};

export const useBot = create<BotStore>()(
  persist(
    (set, get) => ({
      enabled: false,
      scanIntervalMs: 60_000,
      minConfidence: DEFAULT_PARAMS.minConfidence,
      riskPct: 1,
      maxDailyLossPct: 3,
      haltedToday: false,
      haltedDate: null,
      lastScanAt: 0,
      log: [],
      setEnabled: (v) => set({ enabled: v }),
      setMinConfidence: (n) => set({ minConfidence: n }),
      setRiskPct: (n) => set({ riskPct: n }),
      pushLog: (entry) => set({ log: [entry, ...get().log].slice(0, 50) }),
      setHalted: (v) =>
        set({ haltedToday: v, haltedDate: v ? new Date().toDateString() : null }),
      setLastScan: (t) => set({ lastScanAt: t }),
    }),
    {
      name: "aurum-bot-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : (undefined as any),
      ),
      partialize: (s) => ({
        enabled: s.enabled,
        scanIntervalMs: s.scanIntervalMs,
        minConfidence: s.minConfidence,
        riskPct: s.riskPct,
        maxDailyLossPct: s.maxDailyLossPct,
        haltedToday: s.haltedToday,
        haltedDate: s.haltedDate,
      }),
    },
  ),
);

function dailyPnlFor(): number {
  const s = useAccount.getState();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const closed = s.history
    .filter((t) => t.closedAt >= startOfDay.getTime())
    .reduce((a, t) => a + t.profit, 0);
  const floating = floatingPnl(s.positions, priceFeed.state.prices);
  return closed + floating;
}

function runScan() {
  const bot = useBot.getState();
  const acc = useAccount.getState();

  // Daily reset
  const today = new Date().toDateString();
  if (bot.haltedDate && bot.haltedDate !== today) {
    useBot.setState({ haltedToday: false, haltedDate: null });
  }

  if (bot.haltedToday) return;

  // Max daily loss circuit breaker
  const dpnl = dailyPnlFor();
  const lossPct = (dpnl / acc.startingBalance) * 100;
  if (lossPct <= -bot.maxDailyLossPct) {
    useBot.setState({ haltedToday: true, haltedDate: today });
    bot.pushLog({ t: Date.now(), level: "warn", msg: `Daily loss ${lossPct.toFixed(2)}% — trading halted` });
    toast.error(`Daily loss limit hit (${lossPct.toFixed(2)}%). Bot halted for today.`);
    return;
  }

  useBot.setState({ lastScanAt: Date.now() });

  const openSymbols = new Set(acc.positions.map((p) => p.symbol));
  const params = { ...DEFAULT_PARAMS, minConfidence: bot.minConfidence };

  for (const sym of SYMBOLS) {
    if (openSymbols.has(sym)) continue;
    const candles = priceFeed.state.candles[sym];
    if (!candles || candles.length < 60) continue;
    const sig = analyze(sym, candles, params);
    if (sig.side === "FLAT") continue;
    if (sig.confidence < bot.minConfidence) continue;

    const slDist = Math.abs(sig.entry - sig.stopLoss);
    if (slDist <= 0) continue;
    const lot = calculateLot(sym, acc.balance, bot.riskPct, slDist);
    const pos = acc.open({
      symbol: sym,
      side: sig.side,
      lot,
      entry: sig.entry,
      stopLoss: sig.stopLoss,
      takeProfit: sig.takeProfit,
      confidence: sig.confidence,
      reason: sig.reasons.slice(0, 2).join(" · "),
    });
    if (pos) {
      bot.pushLog({
        t: Date.now(),
        level: "trade",
        msg: `${sig.side} ${lot} ${sym} @ ${sig.entry.toFixed(sym === "XAUUSD" ? 2 : 5)} (conf ${sig.confidence}%)`,
      });
      toast.success(`Bot: ${sig.side} ${lot} ${sym}`);
      // Only open one new trade per scan to stay conservative
      break;
    }
  }
}

/** Mount once near the root. Runs scans on a wall-clock interval whenever enabled. */
export function BotEngine() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = setInterval(() => {
      const { enabled, lastScanAt, scanIntervalMs } = useBot.getState();
      if (!enabled) return;
      if (Date.now() - lastScanAt < scanIntervalMs) return;
      runScan();
    }, 2_000);
    return () => clearInterval(id);
  }, []);
  return null;
}

export function triggerManualScan() {
  runScan();
}
