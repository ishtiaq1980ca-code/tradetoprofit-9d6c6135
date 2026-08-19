// Scheduled, server-side trading engine.
//
// This is the authoritative scan loop. It is a direct port of the browser
// runScan() in tradingBot.ts — same strategy, same filters, same gates, same
// risk/lot sizing, same blocked-hours filter, same structure-invalidation exit
// rules. Nothing about the MT5 path changes: the engine still only writes
// `signals` rows (and `close_requests` rows), exactly as before, and the
// existing bridge (aurumai_bridge.py + /api/public/bridge/*) picks them up.

import type { SupabaseClient } from "@supabase/supabase-js";

import { SYMBOLS } from "../format";
import { activeSessions } from "../sessions";
import { generateTradeDecision, minConfidenceFor } from "../signalGenerator";
import { getPairProfile, isPairDisabled, normalizeSymbol } from "../pairProfiles";
import { DEFAULT_RISK } from "../riskEngine";
import { correlationGuard } from "../correlation";
import { classBlock, computeOpenSlots, normalizeOrderPlan } from "../execution";
import { blockedHourReason, isBlockedHour, parseBlockedHours } from "../tradingHours";
import { detectTier, lotForBalance, tierLotCap } from "../tierSizing";
import {
  DUP_WINDOW_MS, ENGINE_DEFAULTS, MT5_HEARTBEAT_MAX_AGE_MS, STOP_COOLDOWN_MS,
} from "../engineConfig";
import { aggregatePatterns, useLearning } from "../strategyLearning";
import { useEconomicCalendar, type CalendarEvent } from "../economicCalendar";
import { evaluateInvalidation, MIN_HOLD_MS } from "../structureInvalidation";
import { hasLiveAnchor, type ServerFeedState } from "./feed.server";

export type ScanSummary = {
  ran: boolean;
  reason?: string;
  queued: number;
  evaluated: number;
  closesQueued: number;
  notes: string[];
};

type OpenTrade = {
  id: string;
  mt5_ticket: number | null;
  symbol: string;
  side: string;
  entry: number;
  lot: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  opened_at: string | null;
  user_id: string | null;
};

// ---------------------------------------------------------------------------
// Cross-request caches (per worker isolate). Refreshed on a timer so a cold
// isolate never trades with an empty learning / news state.
// ---------------------------------------------------------------------------
let learningLoadedAt = 0;
let calendarLoadedAt = 0;
const HYDRATE_TTL_MS = 15 * 60_000;

async function hydrateLearning(admin: SupabaseClient<any>) {
  if (Date.now() - learningLoadedAt < HYDRATE_TTL_MS) return;
  const { data, error } = await admin
    .from("trade_reviews")
    .select("outcome,r_multiple,profit,pattern_keys")
    .order("closed_at", { ascending: false })
    .limit(1000);
  if (error || !data) return;
  const patterns = aggregatePatterns(data as any);
  useLearning.getState().apply(patterns, data.length, []);
  learningLoadedAt = Date.now();
}

async function hydrateCalendar(admin: SupabaseClient<any>) {
  if (Date.now() - calendarLoadedAt < HYDRATE_TTL_MS) return;
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data, error } = await admin
    .from("economic_events")
    .select("id,title,currency,impact,at")
    .gte("at", since)
    .order("at", { ascending: true })
    .limit(500);
  if (error || !data) return;
  const events: CalendarEvent[] = (data as any[]).map((e) => ({
    id: String(e.id),
    title: String(e.title),
    currency: String(e.currency).toUpperCase(),
    impact: e.impact === "medium" ? "medium" : "high",
    at: Date.parse(e.at),
    source: "feed",
  }));
  useEconomicCalendar.getState().mergeFeed(events);
  calendarLoadedAt = Date.now();
}

// ---------------------------------------------------------------------------
// Structure-invalidation exits for OPEN positions (server port of
// structureMonitor.ts — identical rules, including the 5-minute minimum hold).
// ---------------------------------------------------------------------------
const lastCheckedAt = new Map<number, number>();
const closeQueued = new Set<number>();
const CHECK_INTERVAL_MS = 60_000;

function candlesFor(feed: ServerFeedState, symbol: string) {
  const direct = feed.candles[symbol];
  if (direct?.length) return direct;
  const target = normalizeSymbol(symbol);
  for (const [k, v] of Object.entries(feed.candles)) {
    if (normalizeSymbol(k) === target && v?.length) return v;
  }
  return null;
}

async function runStructureExits(
  admin: SupabaseClient<any>,
  feed: ServerFeedState,
  open: OpenTrade[],
  notes: string[],
): Promise<number> {
  let queued = 0;
  const now = Date.now();
  for (const t of open) {
    const ticket = Number(t.mt5_ticket ?? 0);
    if (!ticket || closeQueued.has(ticket)) continue;
    if (now - (lastCheckedAt.get(ticket) ?? 0) < CHECK_INTERVAL_MS) continue;
    lastCheckedAt.set(ticket, now);

    const openedAt = t.opened_at ? Date.parse(t.opened_at) : NaN;
    if (Number.isFinite(openedAt) && now - openedAt < MIN_HOLD_MS) continue;

    const side = String(t.side).toUpperCase() === "BUY" ? "BUY" : "SELL";
    const candles = candlesFor(feed, t.symbol);
    if (!candles || candles.length < 300) continue;

    let res;
    try {
      res = evaluateInvalidation(side, candles, Number(t.entry));
    } catch (e: any) {
      notes.push(`structure-exit ${t.symbol}: ${e?.message ?? "check failed"}`);
      continue;
    }
    if (!res.invalidated) continue;

    const { error } = await admin.from("close_requests").insert({
      user_id: t.user_id,
      mt5_ticket: ticket,
      symbol: normalizeSymbol(t.symbol),
      side,
      reason: res.reason,
      kind: "structure_invalidated",
    });
    if (error && !/duplicate key/i.test(error.message)) {
      notes.push(`close_request ${t.symbol}: ${error.message}`);
      continue;
    }
    closeQueued.add(ticket);
    queued++;
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------
export async function runServerScan(
  admin: SupabaseClient<any>,
  feed: ServerFeedState,
): Promise<ScanSummary> {
  const out: ScanSummary = { ran: true, queued: 0, evaluated: 0, closesQueued: 0, notes: [] };

  // ---- live DB-driven configuration (bot_settings + pair_settings) ----
  // Loaded FIRST so every gate below (confidence floors, ADX floors, per-pair
  // indicator params, symbol list, risk) sees the current database values.
  const cfg = await loadLiveConfig(admin);
  out.notes.push(...cfg.notes);
  const settings = cfg.settings;
  if (!settings?.enabled) return { ...out, ran: false, reason: "bot disabled (bot_settings.enabled = false)" };

  const eng = getEngineOverrides();
  const riskPct = eng.riskPct ?? ENGINE_DEFAULTS.riskPct;
  // Daily-loss circuit breaker: use the MORE RESTRICTIVE of the code default
  // (3%) and bot_settings.max_daily_loss, so a loose DB value can't widen risk.
  const maxDailyLossPct = Math.min(
    ENGINE_DEFAULTS.maxDailyLossPct,
    eng.maxDailyLossPct ?? ENGINE_DEFAULTS.maxDailyLossPct,
  );


  // ---- live MT5 account snapshot (heartbeat, balance, open count, daily P/L) ----
  const { data: snapRows } = await admin
    .from("account_snapshots")
    .select("balance,equity,open_positions,daily_pnl,created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  const snap = snapRows?.[0] as
    | { balance: number; equity: number; open_positions: number; daily_pnl: number; created_at: string }
    | undefined;
  const heartbeatAge = snap ? Date.now() - Date.parse(snap.created_at) : Infinity;
  if (!snap || heartbeatAge > MT5_HEARTBEAT_MAX_AGE_MS) {
    return { ...out, ran: false, reason: `MT5 bridge heartbeat stale (${Math.round(heartbeatAge / 1000)}s) — skipping this cycle` };
  }

  const balance = Number(snap.balance) || 0;
  const dailyPnl = Number(snap.daily_pnl) || 0;
  const mt5Open = Number(snap.open_positions) || 0;

  // ---- open positions (bridge-synced source of truth) ----
  const freshCutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const { data: openRows } = await admin
    .from("trades")
    .select("id,mt5_ticket,symbol,side,entry,lot,stop_loss,take_profit,opened_at,user_id")
    .eq("status", "open")
    .eq("needs_review", false)
    .gte("opened_at", freshCutoff)
    .order("opened_at", { ascending: false })
    .limit(100);
  const open = (openRows ?? []) as OpenTrade[];

  // ---- structure-invalidation exits FIRST: open positions are always managed,
  //      even when no new entry can be opened (identical ordering to runScan). ----
  out.closesQueued = await runStructureExits(admin, feed, open, out.notes);

  // ---- circuit breaker: daily loss limit on live MT5 P/L ----
  if (balance > 0 && dailyPnl < 0 && Math.abs(dailyPnl) >= (balance * ENGINE_DEFAULTS.maxDailyLossPct) / 100) {
    return { ...out, ran: false, reason: `circuit breaker: daily loss ${dailyPnl.toFixed(2)} >= ${ENGINE_DEFAULTS.maxDailyLossPct}% of ${balance.toFixed(2)}` };
  }

  // ---- weekend pause ----
  if (ENGINE_DEFAULTS.pauseOnWeekend && activeSessions().weekend) {
    return { ...out, ran: false, reason: "market closed (weekend)" };
  }

  // ---- time-of-day filter (bot_settings.blocked_hours_utc) ----
  const blockedHours = parseBlockedHours((settings as any).blocked_hours_utc);
  if (isBlockedHour(blockedHours)) {
    await admin.from("execution_log").insert({
      symbol: "ENGINE", side: "NONE", action: "skipped_blocked_hour",
      error: blockedHourReason(blockedHours),
    });
    return { ...out, ran: false, reason: blockedHourReason(blockedHours) };
  }

  await hydrateLearning(admin);
  await hydrateCalendar(admin);

  // ---- tier / lot caps ----
  const tier = detectTier(balance);
  const lotCap = ENGINE_DEFAULTS.useTierLimits ? tierLotCap(tier) : Infinity;
  const perTradeLot = lotForBalance(balance);
  let usedLot = open.reduce((s, p) => s + (Number(p.lot) || 0), 0);
  if (ENGINE_DEFAULTS.useTierLimits) {
    if (!tier) return { ...out, ran: false, reason: "balance below $500 — bot disabled by tier rules" };
    if (usedLot + perTradeLot > lotCap + 1e-9) {
      return { ...out, ran: false, reason: `tier ${tier} lot cap reached (${usedLot.toFixed(2)}/${lotCap.toFixed(2)})` };
    }
  }

  if (mt5Open >= ENGINE_DEFAULTS.maxOpenTrades) {
    return { ...out, ran: false, reason: `max open trades cap reached (${mt5Open}/${ENGINE_DEFAULTS.maxOpenTrades})` };
  }

  let slotInfo = computeOpenSlots(open.map((p) => ({ symbol: normalizeSymbol(p.symbol) })));
  if (slotInfo.fxAvailable === 0 && slotInfo.xauAvailable === 0) {
    return { ...out, ran: false, reason: `open-trade caps reached (FX ${slotInfo.fxOpen}/${slotInfo.fxMax}, XAU ${slotInfo.xauOpen}/${slotInfo.xauMax})` };
  }

  let remainingBudget = Math.max(0, ENGINE_DEFAULTS.maxOpenTrades - mt5Open);

  const perSymCount: Record<string, number> = {};
  const perSideCount: Record<string, number> = {};
  for (const p of open) {
    const sym = normalizeSymbol(p.symbol);
    perSymCount[sym] = (perSymCount[sym] ?? 0) + 1;
    const key = `${sym}:${String(p.side).toUpperCase()}`;
    perSideCount[key] = (perSideCount[key] ?? 0) + 1;
  }

  // ---- duplicate prevention: recent signals already queued/executed ----
  const dupSince = new Date(Date.now() - DUP_WINDOW_MS).toISOString();
  const { data: recentSignals } = await admin
    .from("signals")
    .select("symbol,side,status,created_at")
    .gte("created_at", dupSince)
    .in("status", ["pending", "executed"])
    .limit(200);
  const recentSameDirection = (sym: string, side: "BUY" | "SELL") =>
    (recentSignals ?? []).filter(
      (r: any) => normalizeSymbol(r.symbol) === sym && String(r.side).toUpperCase() === side,
    ).length;

  // ---- stop-loss cooldown: no re-entry into a symbol that just stopped out ----
  const stopSince = new Date(Date.now() - STOP_COOLDOWN_MS).toISOString();
  const { data: recentClosed } = await admin
    .from("trades")
    .select("symbol,profit,closed_at")
    .eq("status", "closed")
    .gte("closed_at", stopSince)
    .limit(200);
  const stoppedRecently = (sym: string) =>
    (recentClosed ?? []).some((h: any) => normalizeSymbol(h.symbol) === sym && Number(h.profit) < 0);

  const allowed = new Set(ENGINE_DEFAULTS.enabledSymbols);
  const scanOrder = ["XAUUSD", ...SYMBOLS.filter((s) => s !== "XAUUSD")];

  for (const sym of scanOrder) {
    if (remainingBudget <= 0) break;
    if (slotInfo.fxAvailable === 0 && slotInfo.xauAvailable === 0) break;
    if (!allowed.has(sym)) continue;
    if (!getPairProfile(sym)) continue;
    if (isPairDisabled(sym)) continue;
    if (!hasLiveAnchor(feed, sym)) { out.notes.push(`${sym}: no live anchor`); continue; }
    if (classBlock(sym, slotInfo)) continue;
    if ((perSymCount[sym] ?? 0) >= ENGINE_DEFAULTS.maxTradesPerSymbol) continue;

    const candles = feed.candles[sym];
    if (!candles || candles.length < 220) { out.notes.push(`${sym}: warming up (${candles?.length ?? 0}/220)`); continue; }

    out.evaluated++;
    const symbolFloor = minConfidenceFor(sym);
    const decision = generateTradeDecision(sym, candles, balance, {
      minConfidence: Math.max(ENGINE_DEFAULTS.minConfidence, symbolFloor),
      risk: { ...DEFAULT_RISK, riskPct: ENGINE_DEFAULTS.riskPct, maxDailyLossPct: ENGINE_DEFAULTS.maxDailyLossPct },
      context: {
        duplicate: (perSymCount[sym] ?? 0) >= ENGINE_DEFAULTS.maxTradesPerSymbol,
        recentStopCooldown: stoppedRecently(sym),
      },
    });
    if (!decision || !decision.accepted || decision.side === "FLAT") {
      if (decision?.rejectionReason) out.notes.push(`${sym}: ${decision.rejectionReason}`);
      continue;
    }

    const side = decision.side as "BUY" | "SELL";

    // Duplicate cap (open positions + very recent signals in the same direction).
    const dupCount = (perSideCount[`${sym}:${side}`] ?? 0) + recentSameDirection(sym, side);
    if (dupCount >= ENGINE_DEFAULTS.maxSameDirectionTrades) {
      out.notes.push(`${sym}: ${side} duplicate cap (${dupCount}/${ENGINE_DEFAULTS.maxSameDirectionTrades})`);
      continue;
    }

    // Correlation guard.
    const corr = correlationGuard(
      open.map((p) => ({ symbol: normalizeSymbol(p.symbol), side: String(p.side).toUpperCase() as "BUY" | "SELL" })),
      sym,
      side,
    );
    if (corr.block) { out.notes.push(`${sym}: ${corr.reason}`); continue; }

    if (Math.abs(decision.entry - decision.stopLoss) <= 0) continue;

    const lot = ENGINE_DEFAULTS.useTierLimits ? perTradeLot : decision.lot;
    if (ENGINE_DEFAULTS.useTierLimits && usedLot + lot > lotCap + 1e-9) {
      out.notes.push(`${sym}: would exceed tier cap`);
      continue;
    }

    const livePrice = feed.prices[sym];
    if (!livePrice || livePrice <= 0) { out.notes.push(`${sym}: no live price`); continue; }

    const norm = normalizeOrderPlan({
      symbol: sym,
      side,
      decisionEntry: decision.entry,
      decisionSL: decision.stopLoss,
      decisionTP: decision.takeProfit,
      livePrice,
      lot,
      atr: decision.indicators.atr,
    });
    if (!norm.ok) { out.notes.push(`${sym}: EXEC-REJECT [${norm.code}] ${norm.reason}`); continue; }

    const { error } = await admin.from("signals").insert({
      symbol: sym,
      side,
      entry: norm.entry,
      stop_loss: norm.stopLoss,
      take_profit: norm.takeProfit,
      lot: norm.lot,
      confidence: decision.confidence,
      risk_pct: ENGINE_DEFAULTS.riskPct,
      reason:
        decision.reason +
        (norm.adjusted ? `\n  EXEC-ADJUSTED ${norm.notes.join("; ")}` : "") +
        "\n  SOURCE server-scheduled-engine",
      status: "pending",
    });
    if (error) { out.notes.push(`${sym}: queue failed — ${error.message}`); continue; }

    out.queued++;
    remainingBudget--;
    usedLot += norm.lot;
    perSymCount[sym] = (perSymCount[sym] ?? 0) + 1;
    perSideCount[`${sym}:${side}`] = (perSideCount[`${sym}:${side}`] ?? 0) + 1;
    const isXau = sym === "XAUUSD";
    slotInfo = {
      ...slotInfo,
      xauOpen: slotInfo.xauOpen + (isXau ? 1 : 0),
      xauAvailable: Math.max(0, slotInfo.xauAvailable - (isXau ? 1 : 0)),
      fxOpen: slotInfo.fxOpen + (isXau ? 0 : 1),
      fxAvailable: Math.max(0, slotInfo.fxAvailable - (isXau ? 0 : 1)),
      totalOpen: slotInfo.totalOpen + 1,
    };
  }

  return out;
}
