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
import { generateTradeDecision, MIN_CONFIDENCE, minConfidenceFor } from "./signalGenerator";
import { getPairProfile, allProfiles } from "./pairProfiles";
import { useDecisionLog } from "./decisionLog";
import { DEFAULT_RISK } from "./riskEngine";
import { correlationGuard } from "./correlation";
import {
  classBlock, computeOpenSlots, normalizeOrderPlan, useExecutionStats,
} from "./execution";


type BotLogEntry = { t: number; level: "info" | "trade" | "warn"; msg: string };

let latestMt5HeartbeatAt = 0;
let latestMt5OpenPositions: number | null = null;
let latestMt5Balance: number | null = null;
let latestMt5Equity: number | null = null;
let latestMt5DailyPnl: number | null = null;
const MT5_HEARTBEAT_MAX_AGE_MS = 90_000;
let scanInFlight = false;
let scanInFlightSince = 0;
const SCAN_INFLIGHT_TIMEOUT_MS = 30_000;
const ALL_TRADE_SYMBOLS = [...SYMBOLS];
const DIRECT_REST_TIMEOUT_MS = 8_000;
const AUTH_TIMEOUT_MS = 4_000;
const WORKER_SIGNAL_TIMEOUT_MS = 7_000;

let cachedAccessToken: string | null = null;
let authHydrateInFlight: Promise<string | null> | null = null;

function tokenFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i) ?? "";
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const session = parsed?.currentSession ?? parsed;
      const token = session?.access_token;
      const expiresAt = Number(session?.expires_at ?? parsed?.expiresAt ?? 0);
      if (typeof token === "string" && token.length > 20) {
        if (!expiresAt || expiresAt * 1000 > Date.now() + 30_000) return token;
      }
    }
  } catch {
    /* storage unavailable */
  }
  return null;
}

function supabaseRestConfig() {
  const env = import.meta.env as Record<string, string | undefined>;
  const client = supabase as any;
  return {
    url: env.VITE_SUPABASE_URL || client.supabaseUrl,
    key: env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || client.supabaseKey,
  };
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => { window.clearTimeout(id); resolve(value); },
      (error) => { window.clearTimeout(id); reject(error); },
    );
  });
}

async function hydrateAccessToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const stored = tokenFromStorage();
    if (stored) {
      cachedAccessToken = stored;
      return stored;
    }
  }
  if (!forceRefresh && cachedAccessToken) return cachedAccessToken;
  if (!forceRefresh && authHydrateInFlight) return authHydrateInFlight;
  authHydrateInFlight = (async () => {
    try {
      const authPromise: PromiseLike<{ data: { session: { access_token?: string } | null } }> = forceRefresh
        ? (supabase.auth.refreshSession() as any)
        : (supabase.auth.getSession() as any);
      const { data } = await withTimeout(
        authPromise,
        AUTH_TIMEOUT_MS,
        forceRefresh ? "Auth refresh" : "Auth session",
      );
      cachedAccessToken = data.session?.access_token ?? cachedAccessToken;
      return cachedAccessToken;
    } catch (e: any) {
      useBot.getState().pushLog({
        t: Date.now(),
        level: "warn",
        msg: `${forceRefresh ? "Auth refresh" : "Auth session"} failed: ${e?.message ?? "timeout"}`,
      });
      return cachedAccessToken;
    } finally {
      authHydrateInFlight = null;
    }
  })();
  return authHydrateInFlight;
}

async function directRestFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const { url, key } = supabaseRestConfig();
  const token = await hydrateAccessToken();
  if (!url || !key || !token) throw new Error("auth token unavailable");

  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), DIRECT_REST_TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (res.status === 401 && retry) {
      await hydrateAccessToken(true);
      return directRestFetch(path, init, false);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    return res;
  } finally {
    window.clearTimeout(id);
  }
}

async function insertSignalDirect(row: {
  symbol: string;
  side: "BUY" | "SELL";
  entry: number;
  stop_loss: number;
  take_profit: number;
  lot: number;
  confidence: number;
  risk_pct: number;
  reason: string;
  status: "pending";
}) {
  // Prefer the worker path so the actual network send does not depend on
  // the main thread being awake (background tab / OS sleep).
  const token = await hydrateAccessToken();
  if (token && tickWorker) {
    try {
      const res = await sendSignalViaWorker(row, token);
      if (!res.error) return { error: null as null | { message: string } };
      // Retry once on auth failure via worker with fresh token
      if (res.status === 401) {
        const fresh = await hydrateAccessToken(true);
        if (fresh) {
          const res2 = await sendSignalViaWorker(row, fresh);
          if (!res2.error) return { error: null as null | { message: string } };
          return { error: { message: res2.error } };
        }
      }
      return { error: { message: res.error } };
    } catch (e: any) {
      // Worker unavailable → fall through to main-thread fetch
      useBot.getState().pushLog({ t: Date.now(), level: "warn", msg: `Worker signal send failed: ${e?.message ?? "unknown"} — falling back to main-thread` });
    }
  }
  try {
    await directRestFetch("signals", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    return { error: null as null | { message: string } };
  } catch (e: any) {
    return { error: { message: e?.message ?? "signal queue failed" } };
  }
}

// ---------------------- Tick Worker (background-safe) ---------------------
// The worker owns:
//   - the scan heartbeat tick (setInterval survives tab throttling)
//   - the price-anchor HTTP fetch (kept alive when the tab is hidden)
//   - the MT5 signal-insert HTTP POST (so the network call is not blocked
//     by a stalled main thread)
// A main-thread watchdog auto-restarts the worker if it goes silent.
let tickWorker: Worker | null = null;
let lastWorkerTickAt = 0;
let lastWorkerReadyAt = 0;
let workerRestartCount = 0;
let workerStalledLoggedAt = 0;
let workerSignalFallbackLoggedAt = 0;
const WORKER_STALL_MS = 5_000;
let nextSignalReqId = 1;
const pendingSignalCalls = new Map<number, (r: { error: string | null; status?: number }) => void>();

function sendSignalViaWorker(
  row: Record<string, unknown>,
  token: string,
): Promise<{ error: string | null; status?: number }> {
  return new Promise((resolve) => {
    if (!tickWorker) return resolve({ error: "worker unavailable" });
    const reqId = nextSignalReqId++;
    const timer = window.setTimeout(() => {
      if (pendingSignalCalls.has(reqId)) {
        pendingSignalCalls.delete(reqId);
        resolve({ error: "worker signal timeout" });
      }
    }, 12_000);
    pendingSignalCalls.set(reqId, (r) => {
      window.clearTimeout(timer);
      resolve(r);
    });
    try {
      tickWorker.postMessage({ type: "insertSignal", reqId, row, token });
    } catch (e: any) {
      window.clearTimeout(timer);
      pendingSignalCalls.delete(reqId);
      resolve({ error: e?.message ?? "worker post failed" });
    }
  });
}


let heartbeatFailureCount = 0;
async function refreshMt5Heartbeat() {
  try {
    const res = await directRestFetch("account_snapshots?select=created_at,open_positions,balance,equity,daily_pnl&order=created_at.desc&limit=1", {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    const snap = data?.[0];
    const ts = snap?.created_at;
    latestMt5HeartbeatAt = ts ? new Date(ts).getTime() : latestMt5HeartbeatAt;
    latestMt5OpenPositions = typeof snap?.open_positions === "number" ? snap.open_positions : latestMt5OpenPositions;
    latestMt5Balance = snap && snap.balance != null ? Number(snap.balance) : latestMt5Balance;
    latestMt5Equity = snap && snap.equity != null ? Number(snap.equity) : latestMt5Equity;
    latestMt5DailyPnl = snap && snap.daily_pnl != null ? Number(snap.daily_pnl) : latestMt5DailyPnl;
    heartbeatFailureCount = 0;
  } catch (e: any) {
    heartbeatFailureCount++;
    if (heartbeatFailureCount <= 3 || heartbeatFailureCount % 4 === 0) await hydrateAccessToken(true);
    if ((e?.message ?? "").includes("auth token unavailable")) return;
    useBot.getState().pushLog({
      t: Date.now(),
      level: "warn",
      msg: `Heartbeat fetch failed (${heartbeatFailureCount}): ${e?.message ?? "network"} — auto-recovering`,
    });
  }
}

function mt5HeartbeatFresh() {
  return latestMt5HeartbeatAt > 0 && Date.now() - latestMt5HeartbeatAt < MT5_HEARTBEAT_MAX_AGE_MS;
}

export function mt5LiveAccount() {
  return {
    fresh: mt5HeartbeatFresh(),
    balance: latestMt5Balance,
    equity: latestMt5Equity,
    dailyPnl: latestMt5DailyPnl,
    openPositions: latestMt5OpenPositions,
  };
}

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
  maxSameDirectionTrades: number;
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
  setMaxSameDirectionTrades: (n: number) => void;
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
      scanIntervalMs: 1_000,
      minConfidence: 80,
      riskPct: 3,
      maxDailyLossPct: 10,
      atrSlMult: 2.2,
      atrTpMult: 2.8,
      emaFast: 20,
      emaSlow: 50,
      rsiPeriod: 14,
      rsiBuyMax: 65,
      rsiSellMin: 35,
      useMacd: true,
      adxMin: 25,
      maxOpenTrades: 15,
      maxTradesPerSymbol: 2,
      maxSameDirectionTrades: 2,
      maxDailyTrades: 20,

      pauseOnWeekend: true,
      enabledSymbols: ALL_TRADE_SYMBOLS,
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
      setMaxSameDirectionTrades: (n) => set({ maxSameDirectionTrades: Math.max(1, n) }),
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
      setFixedLot: (n) => set({ fixedLot: Math.max(0.02, Math.round(n * 100) / 100) }),
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
      version: 15,
      migrate: (persisted: any, version: number) => {
        if (persisted && typeof persisted === "object") {
          persisted.riskPct = 3;
          // v15: align saved browser settings with the built-in strategy.
          if (version < 15) {
            persisted.minConfidence = 80;
            persisted.emaFast = 20;
            persisted.emaSlow = 50;
            persisted.rsiPeriod = 14;
            persisted.rsiBuyMax = 65;
            persisted.rsiSellMin = 35;
            persisted.useMacd = true;
            persisted.adxMin = 25;
            persisted.atrSlMult = 2.2;
            persisted.atrTpMult = 2.8;
          }
          // v12: raise minConfidence floor to the built-in FX gate.
          if (version < 12 || typeof persisted.minConfidence !== "number" || persisted.minConfidence < MIN_CONFIDENCE) {
            persisted.minConfidence = MIN_CONFIDENCE;
          }
          if (version < 8 || !Array.isArray(persisted.enabledSymbols) || persisted.enabledSymbols.length <= 1) {
            persisted.enabledSymbols = ALL_TRADE_SYMBOLS;
          }
          if (version < 7 || typeof persisted.scanIntervalMs !== "number" || persisted.scanIntervalMs > 1_000) {
            persisted.scanIntervalMs = 1_000;
          }
          // v11: cap concurrent trades at 15 (was 70+ in older builds)
          if (version < 11 || typeof persisted.maxOpenTrades !== "number" || persisted.maxOpenTrades > 15) {
            persisted.maxOpenTrades = 15;
          }
          // v13: daily loss default $100 on $1000 account → 10%
          if (version < 13) persisted.maxDailyLossPct = 10;
          // v14: allow up to 2 same-direction duplicate trades per symbol
          if (version < 14 || typeof persisted.maxSameDirectionTrades !== "number") {
            persisted.maxSameDirectionTrades = 2;
          }
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
        maxSameDirectionTrades: s.maxSameDirectionTrades,
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
  // Always prefer live MT5 daily P/L when a fresh bridge snapshot is available.
  // The local paper-trading history does not reflect actual MT5 trade results,
  // so falling back to it would either miss real profits or fabricate losses.
  if (latestMt5DailyPnl != null && mt5HeartbeatFresh()) {
    return latestMt5DailyPnl;
  }
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

/** Max simultaneous open lot exposure permitted by tier. Sized so multiple
 *  full per-trade lots (0.08) can coexist up to maxOpenTrades. */
export function tierLotCap(tier: 500 | 1000 | 2000 | null): number {
  if (tier === 2000) return 1.20;
  if (tier === 1000) return 0.80;
  if (tier === 500) return 0.48;
  return 0;
}

/** Per-trade lot based on live account balance.
 *  ≤$100 → 0.02, ≤$250 → 0.04, ≤$500 → 0.06, ≥$1000 → 0.08. */
export function lotForBalance(balance: number): number {
  if (balance >= 1000) return 0.08;
  if (balance > 500) return 0.06;
  if (balance > 250) return 0.06;
  if (balance > 100) return 0.04;
  return 0.02;
}

/** Prefer fresh MT5 broker balance, fall back to local paper balance. */
function liveBalanceForSizing(): number {
  if (latestMt5Balance != null && mt5HeartbeatFresh() && latestMt5Balance > 0) {
    return latestMt5Balance;
  }
  return useAccount.getState().balance;
}

export function currentTier(): 500 | 1000 | 2000 | null {
  const bot = useBot.getState();
  if (bot.tierMode === "manual") return bot.manualTier;
  return detectTier(liveBalanceForSizing());
}

async function runScan() {
  // Watchdog: never let a stuck scan freeze the engine permanently.
  if (scanInFlight && Date.now() - scanInFlightSince > SCAN_INFLIGHT_TIMEOUT_MS) {
    scanInFlight = false;
    useBot.getState().pushLog({ t: Date.now(), level: "warn", msg: "Scan watchdog: previous scan took too long, resetting" });
  }
  if (scanInFlight) return;
  scanInFlight = true;
  scanInFlightSince = Date.now();
  try {
  const bot = useBot.getState();
  let acc = useAccount.getState();

  if (!mt5HeartbeatFresh() || Date.now() - latestMt5HeartbeatAt > 20_000) {
    await refreshMt5Heartbeat();
  }

  // License gate — bot will not place trades without a valid token
  if (!bot.licenseValid) {
    bot.pushLog({ t: Date.now(), level: "warn", msg: "Blocked: no active license token" });
    return;
  }

  // Never mark trades as queued while the MT5 bridge is offline/stale. This
  // prevents the app from showing trades that cannot be executed on MT5.
  if (!mt5HeartbeatFresh()) {
    bot.pushLog({ t: Date.now(), level: "warn", msg: "Blocked: MT5 bridge heartbeat stale/offline — keep your existing bridge running" });
    return;
  }

  // When MT5 is connected, the browser must not keep old virtual/paper
  // positions from previous rejected/expired queue attempts. Those stale local
  // positions were making the bot think trade slots were full, so no new
  // signals were created even while the bridge account was actually flat.
  if (latestMt5OpenPositions === 0 && acc.positions.length > 0) {
    useAccount.setState({ positions: [] });
    acc = useAccount.getState();
    bot.pushLog({ t: Date.now(), level: "info", msg: "Synced with MT5: cleared stale local paper positions (MT5 has 0 open trades)" });
  }

  // Daily reset
  const today = new Date().toDateString();
  if (bot.haltedDate && bot.haltedDate !== today) {
    useBot.setState({ haltedToday: false, haltedDate: null });
  }

  // Self-heal a stale halt flag: if MT5 shows the account is not actually in
  // loss (e.g. daily P/L is flat or positive), clear the halt so trading can
  // resume from live broker data instead of a stale local flag.
  if (bot.haltedToday && mt5HeartbeatFresh() && latestMt5DailyPnl != null && latestMt5DailyPnl >= 0) {
    useBot.setState({ haltedToday: false, haltedDate: null });
    bot.pushLog({ t: Date.now(), level: "info", msg: `Halt cleared — MT5 daily P/L is $${latestMt5DailyPnl.toFixed(2)}` });
  }

  if (useBot.getState().haltedToday) return;

  // Weekend pause
  const sess = activeSessions();
  if (bot.pauseOnWeekend && sess.weekend) {
    bot.pushLog({ t: Date.now(), level: "info", msg: "Market closed (weekend) — waiting" });
    return;
  }

  // No daily trade cap — concurrent open trades are limited by `maxOpenTrades`
  // and the tier lot cap. Once trades close, new ones can be opened immediately.




  // Max daily loss circuit breaker — always measured against the LIVE MT5
  // balance when the bridge is fresh, so a real +$7 day is never mis-flagged
  // as a loss. Only fall back to the local starting balance when MT5 data
  // is unavailable.
  const dpnl = dailyPnlFor();
  const liveBalance = latestMt5Balance != null && mt5HeartbeatFresh() ? latestMt5Balance : 0;
  const baseBalance = liveBalance > 0 ? liveBalance : acc.startingBalance;
  const lossPct = baseBalance > 0 ? (dpnl / baseBalance) * 100 : 0;
  if (dpnl < 0 && lossPct <= -bot.maxDailyLossPct) {
    useBot.setState({ haltedToday: true, haltedDate: today });
    bot.pushLog({ t: Date.now(), level: "warn", msg: `Daily loss ${lossPct.toFixed(2)}% (MT5) — trading halted` });
    toast.error(`Daily loss limit hit (${lossPct.toFixed(2)}%). Bot halted for today.`);
    return;
  }

  useBot.setState({ lastScanAt: Date.now() });

  // Tier-based lot exposure cap
  const tier = currentTier();
  const lotCap = bot.useTierLimits ? tierLotCap(tier) : Infinity;
  const perTradeLot = lotForBalance(liveBalanceForSizing());
  const openLot = acc.positions.reduce((s, p) => s + p.lot, 0);
    if (bot.useTierLimits) {
      if (!tier) {
        bot.pushLog({ t: Date.now(), level: "warn", msg: `Balance below $500 — bot disabled by tier rules` });
        return;
      }
      if (openLot + perTradeLot > lotCap + 1e-9) {
        bot.pushLog({ t: Date.now(), level: "info", msg: `Tier ${tier} lot cap reached (${openLot.toFixed(2)}/${lotCap.toFixed(2)}) — waiting for closes` });
        return;
      }
    }

  // Hard cap: never allow more than maxOpenTrades concurrent MT5 positions.
  // Uses the live MT5 heartbeat count (source of truth) so the cap isn't
  // bypassed when the local paper store is cleared after an MT5 sync.
  const mt5Open = latestMt5OpenPositions ?? 0;
  if (mt5Open >= bot.maxOpenTrades) {
    bot.pushLog({ t: Date.now(), level: "info", msg: `Max open trades cap reached (${mt5Open}/${bot.maxOpenTrades}) — waiting for closes` });
    return;
  }

  // Dynamic open-trade caps: FX max 10, XAUUSD max 5 (independent classes, total 15).
  let slotInfo = computeOpenSlots(acc.positions);
  if (slotInfo.fxAvailable === 0 && slotInfo.xauAvailable === 0) {
    bot.pushLog({ t: Date.now(), level: "info", msg: `Open-trade caps reached (FX ${slotInfo.fxOpen}/${slotInfo.fxMax}, XAU ${slotInfo.xauOpen}/${slotInfo.xauMax}) — waiting for closes` });
    return;
  }

  // Remaining budget for THIS scan across all symbols, based on live MT5 count.
  let remainingBudget = Math.max(0, bot.maxOpenTrades - mt5Open);

  const openSymbols = new Set(acc.positions.map((p) => p.symbol));
  const perSymCount: Record<string, number> = {};
  const perSideCount: Record<string, number> = {};
  for (const p of acc.positions) {
    perSymCount[p.symbol] = (perSymCount[p.symbol] ?? 0) + 1;
    const key = `${p.symbol}:${p.side}`;
    perSideCount[key] = (perSideCount[key] ?? 0) + 1;
  }

  // Duplicate prevention — short cooldown per symbol+side. Keep it tight so a
  // bridge rejection/expiry does not freeze signal generation for 10 minutes.
  const recent = useDecisionLog.getState().records;
  const dupWindowMs = 2 * 60_000;
  const now = Date.now();
  const recentSameDirection = (sym: string, side: "BUY" | "SELL") =>
    recent.filter((r) => r.symbol === sym && r.direction === side && (r.status === "queued" || r.status === "executed") && now - r.at < dupWindowMs).length;
  const sameDirectionTotal = (sym: string, side: "BUY" | "SELL") =>
    (perSideCount[`${sym}:${side}`] ?? 0) + recentSameDirection(sym, side);


  let opened = 0;
  let usedLot = openLot;
  const allowed = new Set(bot.enabledSymbols.length ? bot.enabledSymbols : ALL_TRADE_SYMBOLS);
  const waitingMsgs: string[] = [];

  // Gold-first scan order: prioritize XAUUSD signals, then the rest of the pairs.
  const scanOrder = ["XAUUSD", ...SYMBOLS.filter((s) => s !== "XAUUSD")];
  for (const sym of scanOrder) {
    if (remainingBudget <= 0) { waitingMsgs.push(`Max ${bot.maxOpenTrades} concurrent trades reached`); break; }
    if (slotInfo.fxAvailable === 0 && slotInfo.xauAvailable === 0) break;
    if (!allowed.has(sym)) continue;
    if (!getPairProfile(sym)) continue;
    if (!priceFeed.hasLiveAnchor(sym)) {
      waitingMsgs.push(`${sym}: waiting for live broker-aligned price`);
      continue;
    }

    // Per-class cap check
    const classBlk = classBlock(sym, slotInfo);
    if (classBlk) {
      waitingMsgs.push(`${sym}: ${classBlk}`);
      continue;
    }

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
    // Per-symbol floor: gold 85%, FX currencies 80%. bot.minConfidence acts
    // as an additional user-tunable floor (never below the per-symbol gate).
    const symbolFloor = minConfidenceFor(sym);
    const decision = generateTradeDecision(sym, candles, acc.balance, {
      minConfidence: Math.max(bot.minConfidence, symbolFloor),
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

    // Duplicate prevention — allow up to maxSameDirectionTrades of the same
    // symbol+direction. Count both open local positions and recent queued/executed
    // decisions that may not yet be reflected in positions.
    const dupCount = sameDirectionTotal(sym, decision.side);
    if (dupCount >= bot.maxSameDirectionTrades) {
      useDecisionLog.getState().record({ ...baseLog, status: "duplicate" });
      waitingMsgs.push(`${sym}: ${decision.side} duplicate cap (${dupCount}/${bot.maxSameDirectionTrades}) reached`);
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
      ? perTradeLot
      : bot.lotMode === "fixed"
        ? Math.max(0.02, bot.fixedLot)
        : decision.lot;
    if (bot.useTierLimits && usedLot + lot > lotCap + 1e-9) {
      useDecisionLog.getState().record({ ...baseLog, status: "blocked", reason: `${baseLog.reason}\n  TIER CAP would be exceeded` });
      waitingMsgs.push(`${sym}: would exceed tier cap`);
      continue;
    }

    // ---- Reliability + price re-validation ----
    const livePrice = priceFeed.state.prices[sym];
    if (!livePrice || livePrice <= 0) {
      useExecutionStats.getState().recordFailure({ at: Date.now(), symbol: sym, side: decision.side as "BUY" | "SELL", code: "no_price", reason: "No live price available" });
      useDecisionLog.getState().record({ ...baseLog, status: "blocked", reason: `${baseLog.reason}\n  RELIABILITY no live price` });
      waitingMsgs.push(`${sym}: no live price`);
      continue;
    }

    // ---- SL/TP normalization against latest price ----
    const norm = normalizeOrderPlan({
      symbol: sym,
      side: decision.side,
      decisionEntry: decision.entry,
      decisionSL: decision.stopLoss,
      decisionTP: decision.takeProfit,
      livePrice,
      lot,
      atr: decision.indicators.atr,
    });
    if (!norm.ok) {
      useExecutionStats.getState().recordFailure({ at: Date.now(), symbol: sym, side: decision.side as "BUY" | "SELL", code: norm.code, reason: norm.reason });
      useDecisionLog.getState().record({ ...baseLog, status: "blocked", reason: `${baseLog.reason}\n  EXEC-REJECT [${norm.code}] ${norm.reason}` });
      waitingMsgs.push(`${sym}: ${norm.code} (${norm.reason})`);
      continue;
    }

    const finalEntry = norm.entry;
    const finalSL = norm.stopLoss;
    const finalTP = norm.takeProfit;
    const finalLot = norm.lot;

    // ---- 1) Queue the order for MT5 bridge and wait for DB ack ----
    const tGenerated = decision.generatedAt;
    const tInsertStart = Date.now();
    const { error } = await insertSignalDirect({
      symbol: sym,
      side: decision.side,
      entry: finalEntry,
      stop_loss: finalSL,
      take_profit: finalTP,
      lot: finalLot,
      confidence: decision.confidence,
      risk_pct: bot.riskPct,
      reason: decision.reason + (norm.adjusted ? `\n  EXEC-ADJUSTED ${norm.notes.join("; ")}` : ""),
      status: "pending",
    });

    const tAck = Date.now();
    if (error) {
      useExecutionStats.getState().recordFailure({
        at: tAck, symbol: sym, side: decision.side as "BUY" | "SELL", code: "queue_failed", reason: error.message,
      });
      useDecisionLog.getState().record({ ...baseLog, status: "blocked", reason: `${baseLog.reason}\n  MT5-QUEUE-FAILED ${error.message}` });
      bot.pushLog({ t: tAck, level: "warn", msg: `MT5 queue failed: ${error.message}` });
      waitingMsgs.push(`${sym}: queue failed`);
      continue;
    }
    useExecutionStats.getState().recordSent(tAck - tGenerated);

    // ---- 2) Reserve this symbol locally only after queue success ----
    // Do NOT open a browser/paper position here. MT5 must confirm the fill
    // first; otherwise rejected signals create fake local positions and block
    // future scans. The decision log remains the duplicate/cooldown guard.
    perSymCount[sym] = (perSymCount[sym] ?? 0) + 1;
    openSymbols.add(sym);
    const isXauQueued = sym === "XAUUSD";
    slotInfo = {
      ...slotInfo,
      xauOpen: slotInfo.xauOpen + (isXauQueued ? 1 : 0),
      xauAvailable: Math.max(0, slotInfo.xauAvailable - (isXauQueued ? 1 : 0)),
      fxOpen: slotInfo.fxOpen + (isXauQueued ? 0 : 1),
      fxAvailable: Math.max(0, slotInfo.fxAvailable - (isXauQueued ? 0 : 1)),
      totalOpen: slotInfo.totalOpen + 1,
    };
    opened++;
    remainingBudget--;
    usedLot += finalLot;

    // ---- 3) Logging after order has been queued ----
    useDecisionLog.getState().record({
      ...baseLog,
      entry: finalEntry,
      stopLoss: finalSL,
      takeProfit: finalTP,
      lot: finalLot,
      status: "queued",
      reason: baseLog.reason + (norm.adjusted ? `\n  EXEC-ADJUSTED ${norm.notes.join("; ")}` : "") + `\n  MT5-QUEUED ${tAck - tGenerated}ms (db queue ${tAck - tInsertStart}ms, waiting for bridge fill confirmation)`,
    });
    bot.pushLog({
      t: Date.now(),
      level: "info",
      msg: `Queued for MT5 bridge: [${decision.strategy}] ${decision.side} ${finalLot} ${sym} @ ${finalEntry.toFixed(sym === "XAUUSD" ? 2 : 5)} · TP ${finalTP.toFixed(sym === "XAUUSD" ? 2 : 5)} · SL ${finalSL.toFixed(sym === "XAUUSD" ? 2 : 5)} (conf ${decision.confidence}%, ${tAck - tGenerated}ms)`,
    });
    toast.success(`Queued to MT5: ${decision.side} ${finalLot} ${sym} @ ${decision.confidence}%`);
  }


  // Suppress unused warnings for legacy helpers retained for compatibility.
  void analyze; void calculateLot; void DEFAULT_PARAMS; void useStrategies; void strategiesForSymbol; void allProfiles;

  // Emit a single consolidated "waiting" log per scan so the user always sees
  // why the bot didn't fire (throttled — only when nothing opened).
  if (opened === 0 && waitingMsgs.length) {
    bot.pushLog({ t: Date.now(), level: "info", msg: `Waiting — ${waitingMsgs.slice(0, 3).join(" | ")}` });
  }
  } finally {
    scanInFlight = false;
  }
}


/** Sync the local bot.enabled toggle to bot_settings.enabled so the MT5
 * bridge knows whether to act on queued signals. Uses a SECURITY DEFINER
 * RPC since direct UPDATE on bot_settings is admin-only. */
async function syncEnabledToCloud(enabled: boolean) {
  try {
    await directRestFetch("rpc/set_bot_enabled", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: JSON.stringify({ _enabled: enabled }),
    });
  } catch (e: any) {
    useBot.getState().pushLog({
      t: Date.now(),
      level: "warn",
      msg: `Bridge sync failed: ${e?.message ?? "offline"}`,
    });
  }
}

/** Mount once near the root. Runs scans on a wall-clock interval whenever enabled. */
export function BotEngine() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Sync current enabled state after auth storage is loaded, then on changes.
    // Without waiting for the session, the cloud switch can stay off even while
    // the browser bot is active, so the MT5 bridge receives no signals.
    hydrateAccessToken().finally(() => {
      syncEnabledToCloud(useBot.getState().enabled);
      refreshMt5Heartbeat();
    });
    const heartbeatId = setInterval(refreshMt5Heartbeat, 15_000);
    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") cachedAccessToken = null;
      if (session?.access_token) cachedAccessToken = session.access_token;
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        window.setTimeout(() => {
          syncEnabledToCloud(useBot.getState().enabled);
          refreshMt5Heartbeat();
        }, 0);
      }
    });
    const unsub = useBot.subscribe((s, prev) => {
      if (s.enabled !== prev.enabled) syncEnabledToCloud(s.enabled);
    });
    // Watch for bridge fill confirmations to record true fill latency
    // (signal created_at → executed_at). Read-only subscription, no MT5
    // changes are made here.
    const fillCh = supabase
      .channel("aurum-signal-fills")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "signals", filter: "status=eq.executed" },
        (payload) => {
          const row: any = payload.new;
          if (!row?.created_at || !row?.executed_at) return;
          const ms = new Date(row.executed_at).getTime() - new Date(row.created_at).getTime();
          if (ms > 0 && ms < 5 * 60_000) useExecutionStats.getState().recordFill(ms);
        },
      )
      .subscribe();

    // ---------- Background-safe tick worker + auto-restart watchdog ----------
    // The worker owns: tick heartbeat, price-anchor fetch, signal-insert POST.
    // If it goes silent for >WORKER_STALL_MS, the watchdog restarts it and
    // surfaces the stall to the user via a toast + log entry.
    const { url: sbUrl, key: sbKey } = supabaseRestConfig();

    const wireWorker = async () => {
      const token = await hydrateAccessToken();
      try {
        const workerUrl = new URL("./tickWorker.ts", import.meta.url);
        const w = new Worker(workerUrl, { type: "module" });
        w.onmessage = (e: MessageEvent) => {
          const msg = e.data;
          if (!msg || typeof msg !== "object") return;
          lastWorkerTickAt = Date.now();
          switch (msg.type) {
            case "ready":
              lastWorkerReadyAt = Date.now();
              break;
            case "tick": {
              const { enabled, lastScanAt, scanIntervalMs } = useBot.getState();
              if (!enabled) return;
              if (Date.now() - lastScanAt < scanIntervalMs) return;
              void runScan();
              break;
            }
            case "anchor":
              priceFeed.applyAnchorData({ rates: msg.rates ?? null, xau: msg.xau ?? null });
              break;
            case "signalResult": {
              const resolver = pendingSignalCalls.get(msg.reqId);
              if (resolver) {
                pendingSignalCalls.delete(msg.reqId);
                resolver({ error: msg.error ?? null, status: msg.status });
              }
              break;
            }
          }
        };
        w.onerror = (ev) => {
          useBot.getState().pushLog({ t: Date.now(), level: "warn", msg: `Worker error: ${ev.message ?? "unknown"} — will auto-restart` });
        };
        tickWorker = w;
        lastWorkerTickAt = Date.now();
        w.postMessage({
          type: "start",
          intervalMs: 1000,
          anchorMs: 30_000,
          supabaseUrl: sbUrl,
          supabaseKey: sbKey,
          token,
        });
      } catch (e: any) {
        useBot.getState().pushLog({ t: Date.now(), level: "warn", msg: `Background worker unavailable: ${e?.message ?? "unknown"} — falling back to main-thread timers` });
        tickWorker = null;
      }
    };

    const teardownWorker = () => {
      if (!tickWorker) return;
      try { tickWorker.postMessage({ type: "stop" }); } catch { /* noop */ }
      try { tickWorker.terminate(); } catch { /* noop */ }
      tickWorker = null;
    };

    void wireWorker();

    // Push a fresh access token into the worker whenever it changes so the
    // signal-insert POST always uses a valid bearer.
    const pushTokenToWorker = () => {
      if (!tickWorker) return;
      try { tickWorker.postMessage({ type: "setToken", token: cachedAccessToken }); } catch { /* noop */ }
    };

    // Watchdog: detect worker stalls (missing ticks for >WORKER_STALL_MS)
    // and rebuild the worker automatically. Runs on the main thread; if the
    // main thread itself is throttled the fallback timer below still fires.
    const watchdogId = setInterval(() => {
      const now = Date.now();
      const age = now - lastWorkerTickAt;
      if (age > WORKER_STALL_MS && lastWorkerReadyAt > 0) {
        if (now - workerStalledLoggedAt > 15_000) {
          workerStalledLoggedAt = now;
          workerRestartCount++;
          useBot.getState().pushLog({
            t: now,
            level: "warn",
            msg: `Bot heartbeat stalled (no tick for ${(age / 1000).toFixed(1)}s) — restarting worker (#${workerRestartCount})`,
          });
          if (workerRestartCount <= 3 || workerRestartCount % 5 === 0) {
            toast.warning(`Bot heartbeat stalled — auto-restarting (#${workerRestartCount})`);
          }
        }
        teardownWorker();
        void wireWorker();
      }
    }, 2_500);

    // Fallback timer: also serves as safety net if the worker fails silently.
    const id = setInterval(() => {
      const { enabled, lastScanAt, scanIntervalMs } = useBot.getState();
      if (!enabled) return;
      if (Date.now() - lastScanAt < scanIntervalMs) return;
      void runScan();
    }, 500);

    // When the tab returns to foreground, force an immediate refresh + scan.
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      scanInFlight = false;
      useBot.setState({ lastScanAt: 0 });
      // If the worker went silent while hidden, restart it now.
      if (!tickWorker || Date.now() - lastWorkerTickAt > WORKER_STALL_MS) {
        teardownWorker();
        void wireWorker();
      }
      priceFeed.refreshAnchor();
      hydrateAccessToken(true).finally(() => {
        pushTokenToWorker();
        refreshMt5Heartbeat();
        if (useBot.getState().enabled) void runScan();
      });
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("online", onVisibility);

    const tokenPushId = setInterval(pushTokenToWorker, 60_000);

    // Keep the scanner self-healing without blocking on auth locks.
    const sessionId = setInterval(() => {
      if (scanInFlight && Date.now() - scanInFlightSince > SCAN_INFLIGHT_TIMEOUT_MS) {
        scanInFlight = false;
      }
      if (useBot.getState().enabled && Date.now() - latestMt5HeartbeatAt > 20_000) {
        refreshMt5Heartbeat();
      }
    }, 60_000);

    return () => {
      clearInterval(id);
      clearInterval(heartbeatId);
      clearInterval(sessionId);
      clearInterval(watchdogId);
      clearInterval(tokenPushId);
      teardownWorker();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("online", onVisibility);
      unsub();
      authSub.subscription.unsubscribe();
      supabase.removeChannel(fillCh);
    };

  }, []);
  return null;
}

export function triggerManualScan() {
  void runScan();
}
