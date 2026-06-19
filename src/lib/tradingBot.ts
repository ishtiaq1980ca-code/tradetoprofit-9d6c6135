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
import { activeSessions } from "./sessions";
import { useStrategies, strategiesForSymbol } from "./strategies";
import { supabase } from "@/integrations/supabase/client";
import { generateTradeDecision, MIN_CONFIDENCE } from "./signalGenerator";
import { getPairProfile, allProfiles } from "./pairProfiles";
import { useDecisionLog } from "./decisionLog";
import { DEFAULT_RISK } from "./riskEngine";
import { correlationGuard } from "./correlation";
import {
  classBlock, computeOpenSlots, normalizeOrderPlan, useExecutionStats,
} from "./execution";


type BotLogEntry = { t: number; level: "info" | "trade" | "warn"; msg: string };

type BotStore = {
  enabled: boolean;
  scanIntervalMs: number;
  minConfidence: number;
  riskPct: number;
  maxDailyLossPct: number;
  atrSlMult: number;
  atrTpMult: number;
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiBuyMax: number;
  rsiSellMin: number;
  useMacd: boolean;
  adxMin: number;
  maxOpenTrades: number;
  maxTradesPerSymbol: number;
  maxDailyTrades: number;
  pauseOnWeekend: boolean;
  enabledSymbols: string[];
  useBuiltInStrategy: boolean;
  builtInFallback: boolean;

  lotMode: "auto" | "fixed";
  fixedLot: number;
  // Account-tier risk limits
  tierMode: "auto" | "manual";
  manualTier: 500 | 1000 | 2000;
  useTierLimits: boolean;
  // License gate (set from React via setLicenseValid)
  licenseValid: boolean;
  haltedToday: boolean;
  haltedDate: string | null;
  lastScanAt: number;
  log: BotLogEntry[];
  setEnabled: (v: boolean) => void;
  setMinConfidence: (n: number) => void;
  setRiskPct: (n: number) => void;
  setScanInterval: (ms: number) => void;
  setMaxDailyLossPct: (n: number) => void;
  setAtrSlMult: (n: number) => void;
  setAtrTpMult: (n: number) => void;
  setEmaFast: (n: number) => void;
  setEmaSlow: (n: number) => void;
  setRsiPeriod: (n: number) => void;
  setRsiBuyMax: (n: number) => void;
  setRsiSellMin: (n: number) => void;
  setUseMacd: (v: boolean) => void;
  setAdxMin: (n: number) => void;
  setMaxOpenTrades: (n: number) => void;
  setMaxTradesPerSymbol: (n: number) => void;
  setMaxDailyTrades: (n: number) => void;
  setPauseOnWeekend: (v: boolean) => void;
  toggleSymbol: (s: string) => void;

  setEnabledSymbols: (s: string[]) => void;
  setUseBuiltInStrategy: (v: boolean) => void;
  setBuiltInFallback: (v: boolean) => void;
  setLotMode: (m: "auto" | "fixed") => void;
  setFixedLot: (n: number) => void;
  setTierMode: (m: "auto" | "manual") => void;
  setManualTier: (t: 500 | 1000 | 2000) => void;
  setUseTierLimits: (v: boolean) => void;
  setLicenseValid: (v: boolean) => void;
  pushLog: (entry: BotLogEntry) => void;
  setHalted: (v: boolean) => void;
  setLastScan: (t: number) => void;
  clearLog: () => void;
};

export const useBot = create<BotStore>()(
  persist(
    (set, get) => ({
      enabled: false,
      scanIntervalMs: 8_000,
      minConfidence: 75,
      riskPct: 3,
      maxDailyLossPct: 5,
      atrSlMult: 2.5,
      atrTpMult: 0.7,
      emaFast: 9,
      emaSlow: 21,
      rsiPeriod: 14,
      rsiBuyMax: 85,
      rsiSellMin: 15,
      useMacd: false,
      adxMin: 12,
      maxOpenTrades: 4,
      maxTradesPerSymbol: 2,
      maxDailyTrades: 20,
      pauseOnWeekend: true,
      enabledSymbols: ["XAUUSD"],
      useBuiltInStrategy: true,
      builtInFallback: true,

      lotMode: "auto",
      fixedLot: 0.1,
      tierMode: "auto",
      manualTier: 500,
      useTierLimits: true,
      licenseValid: false,
      haltedToday: false,
      haltedDate: null,
      lastScanAt: 0,
      log: [],
      setEnabled: (v) => set({ enabled: v }),
      setMinConfidence: (n) => set({ minConfidence: n }),
      setRiskPct: (n) => set({ riskPct: n }),
      setScanInterval: (ms) => set({ scanIntervalMs: ms }),
      setMaxDailyLossPct: (n) => set({ maxDailyLossPct: n }),
      setAtrSlMult: (n) => set({ atrSlMult: n }),
      setAtrTpMult: (n) => set({ atrTpMult: n }),
      setEmaFast: (n) => set({ emaFast: n }),
      setEmaSlow: (n) => set({ emaSlow: n }),
      setRsiPeriod: (n) => set({ rsiPeriod: Math.max(2, n) }),
      setRsiBuyMax: (n) => set({ rsiBuyMax: n }),
      setRsiSellMin: (n) => set({ rsiSellMin: n }),
      setUseMacd: (v) => set({ useMacd: v }),
      setAdxMin: (n) => set({ adxMin: n }),
      setMaxOpenTrades: (n) => set({ maxOpenTrades: n }),
      setMaxTradesPerSymbol: (n) => set({ maxTradesPerSymbol: Math.max(1, n) }),
      setMaxDailyTrades: (n) => set({ maxDailyTrades: Math.max(1, n) }),
      setPauseOnWeekend: (v) => set({ pauseOnWeekend: v }),

      toggleSymbol: (s) => {
        const cur = get().enabledSymbols;
        set({ enabledSymbols: cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s] });
      },
      setEnabledSymbols: (s) => set({ enabledSymbols: s }),
      setUseBuiltInStrategy: (v) => set({ useBuiltInStrategy: v }),
      setBuiltInFallback: (v) => set({ builtInFallback: v }),
      setLotMode: (m) => set({ lotMode: m }),
      setFixedLot: (n) => set({ fixedLot: Math.max(0.01, Math.round(n * 100) / 100) }),
      setTierMode: (m) => set({ tierMode: m }),
      setManualTier: (t) => set({ manualTier: t }),
      setUseTierLimits: (v) => set({ useTierLimits: v }),
      setLicenseValid: (v) => set({ licenseValid: v }),
      pushLog: (entry) => set({ log: [entry, ...get().log].slice(0, 120) }),
      setHalted: (v) =>
        set({ haltedToday: v, haltedDate: v ? new Date().toDateString() : null }),
      setLastScan: (t) => set({ lastScanAt: t }),
      clearLog: () => set({ log: [] }),
    }),
    {
      name: "aurum-bot-v7",
      version: 3,
      migrate: (persisted: any) => {
        if (persisted && typeof persisted === "object") {
          // Force 3% risk and 75% confidence floor going forward.
          persisted.riskPct = 3;
          persisted.minConfidence = 75;
        }
        return persisted;
      },
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : (undefined as any),
      ),
      partialize: (s) => ({
        enabled: s.enabled,
        scanIntervalMs: s.scanIntervalMs,
        minConfidence: s.minConfidence,
        riskPct: s.riskPct,
        maxDailyLossPct: s.maxDailyLossPct,
        atrSlMult: s.atrSlMult,
        atrTpMult: s.atrTpMult,
        emaFast: s.emaFast,
        emaSlow: s.emaSlow,
        rsiPeriod: s.rsiPeriod,
        rsiBuyMax: s.rsiBuyMax,
        rsiSellMin: s.rsiSellMin,
        useMacd: s.useMacd,
        adxMin: s.adxMin,
        maxOpenTrades: s.maxOpenTrades,
        maxTradesPerSymbol: s.maxTradesPerSymbol,
        maxDailyTrades: s.maxDailyTrades,
        pauseOnWeekend: s.pauseOnWeekend,
        enabledSymbols: s.enabledSymbols,
        useBuiltInStrategy: s.useBuiltInStrategy,
        builtInFallback: s.builtInFallback,

        lotMode: s.lotMode,
        fixedLot: s.fixedLot,
        tierMode: s.tierMode,
        manualTier: s.manualTier,
        useTierLimits: s.useTierLimits,
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

/** Auto-detect the account tier from balance. <500 disables the bot. */
export function detectTier(balance: number): 500 | 1000 | 2000 | null {
  if (balance >= 2000) return 2000;
  if (balance >= 1000) return 1000;
  if (balance >= 500) return 500;
  return null;
}

/** Max simultaneous open 0.01 lots permitted by tier. */
export function tierLotCap(tier: 500 | 1000 | 2000 | null): number {
  if (tier === 2000) return 0.10; // 10 × 0.01
  if (tier === 1000) return 0.06; // 6  × 0.01
  if (tier === 500) return 0.03;  // 3  × 0.01
  return 0;
}

export function currentTier(): 500 | 1000 | 2000 | null {
  const bot = useBot.getState();
  const acc = useAccount.getState();
  if (bot.tierMode === "manual") return bot.manualTier;
  return detectTier(acc.balance);
}

function runScan() {
  const bot = useBot.getState();
  const acc = useAccount.getState();

  // License gate — bot will not place trades without a valid token
  if (!bot.licenseValid) {
    bot.pushLog({ t: Date.now(), level: "warn", msg: "Blocked: no active license token" });
    return;
  }

  // Daily reset
  const today = new Date().toDateString();
  if (bot.haltedDate && bot.haltedDate !== today) {
    useBot.setState({ haltedToday: false, haltedDate: null });
  }

  if (bot.haltedToday) return;

  // Weekend pause
  const sess = activeSessions();
  if (bot.pauseOnWeekend && sess.weekend) {
    bot.pushLog({ t: Date.now(), level: "info", msg: "Market closed (weekend) — waiting" });
    return;
  }

  // No daily trade cap — concurrent open trades are limited by `maxOpenTrades`
  // and the tier lot cap. Once trades close, new ones can be opened immediately.




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

  // Tier-based lot exposure cap
  const tier = currentTier();
  const lotCap = bot.useTierLimits ? tierLotCap(tier) : Infinity;
  const openLot = acc.positions.reduce((s, p) => s + p.lot, 0);
  if (bot.useTierLimits) {
    if (!tier) {
      bot.pushLog({ t: Date.now(), level: "warn", msg: `Balance below $500 — bot disabled by tier rules` });
      return;
    }
    if (openLot + 0.01 > lotCap + 1e-9) {
      bot.pushLog({ t: Date.now(), level: "info", msg: `Tier ${tier} lot cap reached (${openLot.toFixed(2)}/${lotCap.toFixed(2)}) — waiting for closes` });
      return;
    }
  }

  if (acc.positions.length >= bot.maxOpenTrades) {
    bot.pushLog({ t: Date.now(), level: "info", msg: `Max open trades (${bot.maxOpenTrades}) reached — waiting` });
    return;
  }

  const openSymbols = new Set(acc.positions.map((p) => p.symbol));
  const perSymCount: Record<string, number> = {};
  for (const p of acc.positions) perSymCount[p.symbol] = (perSymCount[p.symbol] ?? 0) + 1;

  // Duplicate prevention — track recent decisions per symbol+side for 10 min.
  const recent = useDecisionLog.getState().records;
  const dupWindowMs = 10 * 60_000;
  const now = Date.now();
  const hasRecentDup = (sym: string, side: "BUY" | "SELL") =>
    recent.some((r) => r.symbol === sym && r.direction === side && r.status === "executed" && now - r.at < dupWindowMs);

  let opened = 0;
  let usedLot = openLot;
  const slots = Math.max(0, bot.maxOpenTrades - acc.positions.length);
  const allowed = new Set(bot.enabledSymbols.length ? bot.enabledSymbols : SYMBOLS);
  const waitingMsgs: string[] = [];

  for (const sym of SYMBOLS) {
    if (opened >= slots) break;
    if (!allowed.has(sym)) continue;
    if (!getPairProfile(sym)) continue;
    if ((perSymCount[sym] ?? 0) >= bot.maxTradesPerSymbol) {
      waitingMsgs.push(`${sym}: per-symbol cap (${bot.maxTradesPerSymbol}) reached`);
      continue;
    }
    const candles = priceFeed.state.candles[sym];
    if (!candles || candles.length < 220) {
      waitingMsgs.push(`${sym}: warming up (${candles?.length ?? 0}/220 bars)`);
      continue;
    }

    // Run the high-confidence generator with this pair's profile.
    const decision = generateTradeDecision(sym, candles, acc.balance, {
      minConfidence: Math.max(bot.minConfidence, MIN_CONFIDENCE),
      risk: { ...DEFAULT_RISK, riskPct: bot.riskPct, maxDailyLossPct: bot.maxDailyLossPct },
    });
    if (!decision) continue;

    // Always log the decision (accepted or rejected) so the user can audit.
    const baseLog = {
      symbol: sym,
      direction: decision.side,
      strategy: decision.strategy,
      confidence: decision.confidence,
      reason: decision.reason,
      indicators: {
        EMA50: +decision.indicators.ema50.toFixed(5),
        EMA100: +decision.indicators.ema100.toFixed(5),
        EMA200: +decision.indicators.ema200.toFixed(5),
        RSI: +decision.indicators.rsi.toFixed(2),
        MACD_hist: +decision.indicators.macdHist.toFixed(5),
        ADX: +decision.indicators.adx.toFixed(2),
        ATR: +decision.indicators.atr.toFixed(5),
        BB_upper: +decision.indicators.bbUpper.toFixed(5),
        BB_lower: +decision.indicators.bbLower.toFixed(5),
        Stoch_K: +decision.indicators.stochK.toFixed(2),
        Stoch_D: +decision.indicators.stochD.toFixed(2),
      },
      filters: decision.filters,
      entry: decision.entry,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      lot: decision.lot,
      riskPct: decision.riskPct,
      riskReward: decision.riskReward,
    } as const;

    if (!decision.accepted || decision.side === "FLAT") {
      useDecisionLog.getState().record({
        ...baseLog,
        status: decision.rejectionReason?.startsWith("Confidence") ? "rejected" : "blocked",
      });
      waitingMsgs.push(`${sym}: ${decision.rejectionReason ?? "not aligned"}`);
      continue;
    }

    // Duplicate prevention — block re-entering the same symbol/side too soon
    // (separate from the per-symbol cap, which still applies).
    if (openSymbols.has(sym) && (perSymCount[sym] ?? 0) > 0) {
      useDecisionLog.getState().record({ ...baseLog, status: "duplicate" });
      waitingMsgs.push(`${sym}: position already open (duplicate prevention)`);
      continue;
    }
    if (hasRecentDup(sym, decision.side)) {
      useDecisionLog.getState().record({ ...baseLog, status: "duplicate" });
      waitingMsgs.push(`${sym}: same-direction trade in last 10 min`);
      continue;
    }

    // Correlation guard — block stacking redundant FX exposure
    const corr = correlationGuard(
      acc.positions.map((p) => ({ symbol: p.symbol, side: p.side as "BUY" | "SELL" })),
      sym,
      decision.side,
    );
    if (corr.block) {
      useDecisionLog.getState().record({
        ...baseLog,
        status: "blocked",
        reason: `${baseLog.reason}\n  CORRELATION ${corr.reason}`,
      });
      waitingMsgs.push(`${sym}: ${corr.reason}`);
      continue;
    }


    const slDist = Math.abs(decision.entry - decision.stopLoss);
    if (slDist <= 0) { waitingMsgs.push(`${sym}: SL distance zero`); continue; }

    let lot = bot.useTierLimits
      ? 0.01
      : bot.lotMode === "fixed"
        ? Math.max(0.01, bot.fixedLot)
        : decision.lot;
    if (bot.useTierLimits && usedLot + lot > lotCap + 1e-9) {
      useDecisionLog.getState().record({ ...baseLog, status: "blocked", reason: `${baseLog.reason}\n  TIER CAP would be exceeded` });
      waitingMsgs.push(`${sym}: would exceed tier cap`);
      continue;
    }

    const pos = acc.open({
      symbol: sym,
      side: decision.side,
      lot,
      entry: decision.entry,
      stopLoss: decision.stopLoss,
      takeProfit: decision.takeProfit,
      confidence: decision.confidence,
      reason: decision.reason,
      session: sess.primary,
    });

    if (pos) {
      perSymCount[sym] = (perSymCount[sym] ?? 0) + 1;
      openSymbols.add(sym);
      useDecisionLog.getState().record({ ...baseLog, lot, status: "executed" });

      bot.pushLog({
        t: Date.now(),
        level: "trade",
        msg: `[${decision.strategy}] ${decision.side} ${lot} ${sym} @ ${decision.entry.toFixed(sym === "XAUUSD" ? 2 : 5)} · TP ${decision.takeProfit.toFixed(sym === "XAUUSD" ? 2 : 5)} · SL ${decision.stopLoss.toFixed(sym === "XAUUSD" ? 2 : 5)} (conf ${decision.confidence}%)`,
      });
      toast.success(`Bot ${decision.side} ${lot} ${sym} @ ${decision.confidence}% (${decision.strategy})`);
      opened++;
      usedLot += lot;

      // Enqueue signal for the MT5 bridge — unchanged contract.
      supabase
        .from("signals")
        .insert({
          symbol: sym,
          side: decision.side,
          entry: decision.entry,
          stop_loss: decision.stopLoss,
          take_profit: decision.takeProfit,
          lot,
          confidence: decision.confidence,
          risk_pct: bot.riskPct,
          reason: decision.reason,
          status: "pending",
        })
        .then(({ error }) => {
          if (error) {
            useBot.getState().pushLog({ t: Date.now(), level: "warn", msg: `MT5 queue failed: ${error.message}` });
          } else {
            useBot.getState().pushLog({ t: Date.now(), level: "info", msg: `Signal queued for MT5 bridge → ${decision.side} ${sym}` });
          }
        });
    }
  }

  // Suppress unused warnings for legacy helpers retained for compatibility.
  void analyze; void calculateLot; void DEFAULT_PARAMS; void useStrategies; void strategiesForSymbol; void allProfiles;

  // Emit a single consolidated "waiting" log per scan so the user always sees
  // why the bot didn't fire (throttled — only when nothing opened).
  if (opened === 0 && waitingMsgs.length) {
    bot.pushLog({ t: Date.now(), level: "info", msg: `Waiting — ${waitingMsgs.slice(0, 3).join(" | ")}` });
  }
}


/** Sync the local bot.enabled toggle to bot_settings.enabled so the MT5
 * bridge knows whether to act on queued signals. Uses a SECURITY DEFINER
 * RPC since direct UPDATE on bot_settings is admin-only. */
async function syncEnabledToCloud(enabled: boolean) {
  try {
    const { error } = await supabase.rpc("set_bot_enabled", { _enabled: enabled });
    if (error) {
      useBot.getState().pushLog({
        t: Date.now(),
        level: "warn",
        msg: `Bridge sync failed: ${error.message}`,
      });
    }
  } catch {
    /* offline ok */
  }
}

/** Mount once near the root. Runs scans on a wall-clock interval whenever enabled. */
export function BotEngine() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Sync current enabled state after auth storage is loaded, then on changes.
    // Without waiting for the session, the cloud switch can stay off even while
    // the browser bot is active, so the MT5 bridge receives no signals.
    supabase.auth.getSession().then(() => syncEnabledToCloud(useBot.getState().enabled));
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        syncEnabledToCloud(useBot.getState().enabled);
      }
    });
    const unsub = useBot.subscribe((s, prev) => {
      if (s.enabled !== prev.enabled) syncEnabledToCloud(s.enabled);
    });
    const id = setInterval(() => {
      const { enabled, lastScanAt, scanIntervalMs } = useBot.getState();
      if (!enabled) return;
      if (Date.now() - lastScanAt < scanIntervalMs) return;
      runScan();
    }, 2_000);
    return () => {
      clearInterval(id);
      unsub();
      authSub.subscription.unsubscribe();
    };
  }, []);
  return null;
}

export function triggerManualScan() {
  runScan();
}
