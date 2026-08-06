// Post-trade review pipeline.
//
// Every closed MT5 trade is turned into a structured review: what the market
// structure looked like at entry (from the decision log snapshot the bot wrote
// before it fired), what the outcome was in R-multiples, and how price actually
// behaved after entry. Those reviews are the training data for
// strategyLearning.ts.
//
// The MT5 bridge and execution layer are NOT touched — this only reads the
// `trades` rows the bridge already writes and stores its own review rows.

import { supabase } from "@/integrations/supabase/client";
import { useDecisionLog, type DecisionRecord } from "./decisionLog";
import { normalizeSymbol } from "./pairProfiles";
import { patternKeys, refreshLearning, type PatternContext } from "./strategyLearning";

export type ClosedTradeRow = {
  id: string;
  mt5_ticket: number | null;
  symbol: string;
  side: string;
  entry: number;
  exit: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  lot: number;
  profit: number | null;
  pips: number | null;
  opened_at: string;
  closed_at: string | null;
};

export type TradeBehavior =
  | "immediate_reversal"
  | "chop"
  | "clean_run"
  | "slow_winner"
  | "gradual_bleed"
  | "mixed"
  | "structure_invalidated"
  | "unknown";

export const BEHAVIOR_LABEL: Record<TradeBehavior, string> = {
  immediate_reversal: "Reversed immediately after entry",
  chop: "Chopped sideways, no follow-through",
  clean_run: "Ran cleanly to target",
  slow_winner: "Won, but took its time",
  gradual_bleed: "Bled out slowly against the position",
  mixed: "Mixed / inconclusive behaviour",
  structure_invalidated: "Closed early — market structure invalidated the setup",
  unknown: "Not enough data to classify",
};

/** Find the decision-log entry the bot wrote just before this trade opened. */
export function findEntrySnapshot(trade: ClosedTradeRow, records: DecisionRecord[]): DecisionRecord | null {
  const sym = normalizeSymbol(trade.symbol);
  const openedAt = new Date(trade.opened_at).getTime();
  const side = trade.side.toUpperCase();
  let best: DecisionRecord | null = null;
  let bestScore = Infinity;
  for (const r of records) {
    if (normalizeSymbol(r.symbol) !== sym) continue;
    if (r.direction !== side) continue;
    const dt = openedAt - r.at;
    if (dt < -60_000 || dt > 20 * 60_000) continue;   // within 20 min before the fill
    const priceGap = r.entry ? Math.abs(r.entry - trade.entry) / Math.max(trade.entry, 1e-9) : 0.01;
    const score = dt / 60_000 + priceGap * 500;
    if (score < bestScore) { bestScore = score; best = r; }
  }
  return best;
}

export function computeRMultiple(t: ClosedTradeRow): number | null {
  if (t.exit == null || t.stop_loss == null) return null;
  const risk = Math.abs(t.entry - t.stop_loss);
  if (!(risk > 0)) return null;
  const move = t.side.toUpperCase() === "BUY" ? t.exit - t.entry : t.entry - t.exit;
  return +(move / risk).toFixed(3);
}

export function classifyBehavior(
  t: ClosedTradeRow,
  r: number | null,
  structureExit = false,
): TradeBehavior {
  // A structure-invalidation exit is its own category — it is NOT a stop-loss
  // hit and must be learned from separately.
  if (structureExit) return "structure_invalidated";
  const closed = t.closed_at ? new Date(t.closed_at).getTime() : null;
  if (!closed) return "unknown";
  const mins = (closed - new Date(t.opened_at).getTime()) / 60_000;
  const profit = Number(t.profit ?? 0);
  const rr = r ?? (profit > 0 ? 0.5 : profit < 0 ? -0.5 : 0);
  if (rr <= -0.6 && mins <= 12) return "immediate_reversal";
  if (Math.abs(rr) < 0.4 && mins >= 45) return "chop";
  if (rr >= 1 && mins <= 120) return "clean_run";
  if (rr >= 1) return "slow_winner";
  if (rr <= -0.6) return "gradual_bleed";
  return "mixed";
}

function outcomeOf(profit: number): "win" | "loss" | "breakeven" {
  if (profit > 0.01) return "win";
  if (profit < -0.01) return "loss";
  return "breakeven";
}

function contextFrom(trade: ClosedTradeRow, snap: DecisionRecord | null): PatternContext | null {
  if (!snap?.structure) return null;
  return {
    symbol: normalizeSymbol(trade.symbol),
    side: trade.side.toUpperCase() as "BUY" | "SELL",
    strategy: snap.strategy,
    session: snap.structure.session,
    htfTrend: snap.structure.htfTrend,
    swing: snap.structure.swing,
    zone: snap.structure.zone,
    volatility: snap.structure.volatility,
    adx: snap.indicators?.ADX ?? 0,
    atKeyLevel: snap.structure.keyLevel != null,
  };
}

export function buildReview(
  trade: ClosedTradeRow,
  snap: DecisionRecord | null,
  userId: string,
  structureExit: { reason: string } | null = null,
) {
  const profit = Number(trade.profit ?? 0);
  const r = computeRMultiple(trade);
  const behavior = classifyBehavior(trade, r, !!structureExit);
  const outcome = outcomeOf(profit);
  const ctx = contextFrom(trade, snap);
  const keys = ctx
    ? patternKeys(ctx)
    : [`pair:${normalizeSymbol(trade.symbol)}`, `pair-side:${normalizeSymbol(trade.symbol)}:${trade.side.toUpperCase()}`];

  const durationSec = trade.closed_at
    ? Math.max(0, Math.round((new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime()) / 1000))
    : null;

  const st = snap?.structure ?? null;
  const lessons = [
    st ? st.narrative : "No entry snapshot was available for this fill — structure read unknown.",
    `Outcome: ${outcome.toUpperCase()} ${r != null ? `${r >= 0 ? "+" : ""}${r.toFixed(2)}R` : `$${profit.toFixed(2)}`}, ${BEHAVIOR_LABEL[behavior].toLowerCase()}` +
      (durationSec != null ? ` after ${Math.round(durationSec / 60)} min.` : "."),
    st && outcome === "loss" && behavior === "immediate_reversal"
      ? `Lesson: the ${st.zone} read on a ${st.htfTrend} H1 trend with ${st.swing} structure failed instantly — this exact combination is being penalised in the score.`
      : st && outcome === "win" && behavior === "clean_run"
        ? `Lesson: the ${st.zone} read on a ${st.htfTrend} H1 trend with ${st.swing} structure delivered cleanly — this combination is being rewarded.`
        : "",
  ].filter(Boolean).join(" ");

  return {
    user_id: userId,
    trade_id: trade.id,
    mt5_ticket: trade.mt5_ticket,
    symbol: normalizeSymbol(trade.symbol),
    side: trade.side.toUpperCase(),
    opened_at: trade.opened_at,
    closed_at: trade.closed_at,
    duration_sec: durationSec,
    entry: trade.entry,
    exit: trade.exit,
    stop_loss: trade.stop_loss,
    take_profit: trade.take_profit,
    lot: trade.lot,
    profit,
    pips: trade.pips,
    r_multiple: r,
    outcome,
    behavior,
    session: st?.session ?? null,
    htf_trend: st?.htfTrend ?? null,
    swing: st?.swing ?? null,
    structure_note: st?.narrative ?? null,
    key_level: st?.keyLevel ?? null,
    atr: snap?.indicators?.ATR ?? null,
    atr_pct: st?.atrPct ?? null,
    adx: snap?.indicators?.ADX ?? null,
    rsi: snap?.indicators?.RSI ?? null,
    quality_score: snap?.qualityScore ?? null,
    confidence: snap?.confidence ?? null,
    strategy: snap?.strategy ?? null,
    pattern_keys: keys,
    lessons,
  };
}

/** How many new reviews trigger an immediate re-learn. */
const RELEARN_AFTER = 3;

export async function reviewClosedTrades(): Promise<{ created: number; error?: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return { created: 0, error: "not signed in" };

  const since = new Date(Date.now() - 21 * 86400_000).toISOString();
  const { data: trades, error } = await supabase
    .from("trades")
    .select("id,mt5_ticket,symbol,side,entry,exit,stop_loss,take_profit,lot,profit,pips,opened_at,closed_at")
    .eq("status", "closed")
    .gte("opened_at", since)
    .order("closed_at", { ascending: false })
    .limit(400);
  if (error) return { created: 0, error: error.message };
  if (!trades?.length) return { created: 0 };

  const { data: existing } = await supabase
    .from("trade_reviews")
    .select("trade_id")
    .gte("opened_at", since)
    .limit(1000);
  const done = new Set((existing ?? []).map((e: any) => e.trade_id).filter(Boolean));

  const pending = (trades as ClosedTradeRow[]).filter((t) => !done.has(t.id));
  if (!pending.length) return { created: 0 };

  const records = useDecisionLog.getState().records;
  const rows = pending.map((t) => buildReview(t, findEntrySnapshot(t, records), uid));

  const { error: insErr, data: inserted } = await supabase
    .from("trade_reviews")
    .insert(rows)
    .select("id");
  if (insErr) return { created: 0, error: insErr.message };

  const created = inserted?.length ?? 0;
  if (created >= RELEARN_AFTER) await refreshLearning();
  return { created };
}

let reviewTimer: ReturnType<typeof setInterval> | null = null;
/** Ongoing, automatic reviewing. Safe to call repeatedly. */
export function startReviewLoop(intervalMs = 90_000) {
  if (typeof window === "undefined" || reviewTimer) return;
  void reviewClosedTrades();
  reviewTimer = setInterval(() => { void reviewClosedTrades(); }, intervalMs);
}
