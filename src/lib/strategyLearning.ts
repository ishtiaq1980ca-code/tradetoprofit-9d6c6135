// Strategy learning engine.
//
// This is the feedback loop: closed trades are turned into structured reviews
// (see tradeReviewer.ts), the reviews are aggregated into *patterns*, and each
// pattern earns a score adjustment that is fed straight back into the trade
// quality score at entry time.
//
// A pattern is a single auditable dimension of a setup — the pair, the session,
// the higher-timeframe trend vs the direction taken, the swing structure, the
// volatility regime, the ADX band, the strategy playbook. Patterns that keep
// losing lose points; patterns that keep winning gain points. Everything is
// recomputed automatically on a timer and after every batch of new reviews, so
// nothing has to be re-triggered by hand.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { supabase } from "@/integrations/supabase/client";

// --------------------------- Pattern vocabulary ----------------------------

export type PatternContext = {
  symbol: string;
  side: "BUY" | "SELL";
  strategy: string;
  session: string;
  htfTrend: "up" | "down" | "flat";
  swing: "HH+HL" | "LH+LL" | "mixed";
  zone: "buy" | "sell" | "neutral";
  volatility: "low" | "normal" | "high";
  adx: number;
  atKeyLevel: boolean;
};

export function adxBand(adx: number): "weak" | "firm" | "strong" | "extreme" {
  if (adx < 25) return "weak";
  if (adx < 32) return "firm";
  if (adx < 45) return "strong";
  return "extreme";
}

/** Every learnable dimension of one setup. Must be identical at entry time and
 *  at review time or the loop learns nothing. */
export function patternKeys(ctx: PatternContext): string[] {
  const aligned =
    (ctx.side === "BUY" && ctx.htfTrend === "up") || (ctx.side === "SELL" && ctx.htfTrend === "down")
      ? "with-trend"
      : ctx.htfTrend === "flat"
        ? "no-trend"
        : "counter-trend";
  const zoneMatch =
    (ctx.side === "BUY" && ctx.zone === "buy") || (ctx.side === "SELL" && ctx.zone === "sell")
      ? "in-zone"
      : "out-of-zone";
  return [
    `pair:${ctx.symbol}`,
    `pair-side:${ctx.symbol}:${ctx.side}`,
    `strategy:${ctx.strategy}`,
    `session:${ctx.session}`,
    `session-side:${ctx.session}:${ctx.side}`,
    `htf:${aligned}`,
    `swing:${ctx.swing}:${ctx.side}`,
    `zone:${zoneMatch}`,
    `volatility:${ctx.volatility}`,
    `adx:${adxBand(ctx.adx)}`,
    `level:${ctx.atKeyLevel ? "at-key-level" : "mid-range"}`,
  ];
}

export function dimensionOf(key: string): string {
  return key.split(":")[0] ?? "other";
}

/** Human explanation of what a pattern key means. */
export function describePattern(key: string): string {
  const [dim, ...rest] = key.split(":");
  const v = rest.join(":");
  switch (dim) {
    case "pair": return `Trades on ${v}`;
    case "pair-side": return `${v.split(":")[1]} trades on ${v.split(":")[0]}`;
    case "strategy": return `Setups produced by the "${v}" playbook`;
    case "session": return `Entries taken during the ${v} session`;
    case "session-side": return `${v.split(":")[1]} entries during ${v.split(":")[0]}`;
    case "htf": return v === "with-trend"
      ? "Entries aligned with the higher-timeframe trend"
      : v === "counter-trend"
        ? "Entries taken against the higher-timeframe trend"
        : "Entries taken while the higher timeframe had no trend";
    case "swing": return `${v.split(":")[1]} entries while swing structure read ${v.split(":")[0]}`;
    case "zone": return v === "in-zone"
      ? "Entries where the structural read agreed with the direction"
      : "Entries where the structural read did NOT agree with the direction";
    case "volatility": return `Entries in ${v} volatility (ATR regime)`;
    case "adx": return `Entries with ${v} trend strength (ADX band)`;
    case "level": return v === "at-key-level"
      ? "Entries taken within 1×ATR of a key support/resistance level"
      : "Entries taken in the middle of the range, away from key levels";
    default: return key;
  }
}

// --------------------------- Aggregation -----------------------------------

export type PatternStat = {
  key: string;
  dimension: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalR: number;
  pnl: number;
  /** Points added to (or removed from) the trade quality score. */
  adjustment: number;
  note: string;
  /** Most recent trades on this pattern (newest-first slice) — used to unblock. */
  recentTrades: number;
  recentWins: number;
  recentWinRate: number;
  /** Hard block: no new entries on this pattern at all, regardless of score. */
  blocked: boolean;
  blockReason: string;
};

export type AdjustmentEvent = {
  at: number;
  key: string;
  from: number;
  to: number;
  trades: number;
  winRate: number;
  avgR: number;
  note: string;
};

/** Minimum closed trades before a pattern is allowed to influence scoring. */
export const MIN_PATTERN_SAMPLES = 6;
/** Sample size required before a pattern may earn a meaningful bonus. */
export const MIN_BONUS_SAMPLES = 15;
/** Maximum points a single pattern may add. Bonuses stay deliberately small so a
 *  lucky streak cannot inflate a weak setup past the gate. */
export const MAX_PATTERN_BONUS = 4;
/** Maximum points a single pattern may remove. Penalties are allowed to be
 *  score-breaking: a proven losing pattern must be able to fail the gate alone. */
export const MAX_PATTERN_PENALTY = 20;
/** Maximum combined bonus / penalty applied to any one trade score. */
export const MAX_TOTAL_BONUS = 8;
export const MAX_TOTAL_PENALTY = 35;

/** Evidence bar at which a pattern stops being merely penalised and is blocked. */
export const BLOCK_MIN_SAMPLES = 10;
/** Win rate under this (with enough samples) earns the aggressive penalty. */
export const PENALTY_MAX_WIN_RATE = 40;
/** Average R below this is sub-breakeven after costs → aggressive penalty. */
export const PENALTY_MAX_AVG_R = 0.1;
export const BLOCK_MAX_WIN_RATE = 30;
export const BLOCK_MAX_AVG_R = -0.25;
/** Recent-form escape hatch: this many recent trades at this win rate unblocks. */
export const UNBLOCK_MIN_RECENT = 6;
export const UNBLOCK_MIN_WIN_RATE = 45;
const RECENT_WINDOW = 12;

/** Only these dimensions may hard-block. Blocking a whole session or volatility
 *  regime would stop the bot dead; blocking a symbol+direction will not. */
export const BLOCKABLE_DIMENSIONS = ["pair-side", "session-side", "swing", "zone"];

export type ReviewRow = {
  outcome: string;
  r_multiple: number | null;
  profit: number | null;
  pattern_keys: string[] | null;
};

/** Reviews MUST be passed newest-first so the recent-form window is correct. */
export function aggregatePatterns(reviews: ReviewRow[]): PatternStat[] {
  const map = new Map<string, PatternStat>();
  for (const r of reviews) {
    // Guard against corrupt R values in history (a few rows carry absurd
    // magnitudes from an earlier exit-price bug) — clamp to a sane range.
    const rmRaw = Number(r.r_multiple ?? 0);
    const rm = Number.isFinite(rmRaw) ? Math.max(-5, Math.min(10, rmRaw)) : 0;
    const pnl = Number(r.profit ?? 0);
    const win = r.outcome === "win";
    for (const key of r.pattern_keys ?? []) {
      const s = map.get(key) ?? {
        key, dimension: dimensionOf(key), trades: 0, wins: 0, losses: 0,
        winRate: 0, avgR: 0, totalR: 0, pnl: 0, adjustment: 0, note: "",
        recentTrades: 0, recentWins: 0, recentWinRate: 0, blocked: false, blockReason: "",
      };
      s.trades += 1;
      if (win) s.wins += 1;
      else if (r.outcome === "loss") s.losses += 1;
      if (s.recentTrades < RECENT_WINDOW) {
        s.recentTrades += 1;
        if (win) s.recentWins += 1;
      }
      s.totalR += rm;
      s.pnl += pnl;
      map.set(key, s);
    }
  }

  const out: PatternStat[] = [];
  for (const s of map.values()) {
    s.winRate = s.trades ? (s.wins / s.trades) * 100 : 0;
    s.avgR = s.trades ? s.totalR / s.trades : 0;
    s.recentWinRate = s.recentTrades ? (s.recentWins / s.recentTrades) * 100 : 0;

    const recovering =
      s.recentTrades >= UNBLOCK_MIN_RECENT && s.recentWinRate >= UNBLOCK_MIN_WIN_RATE;

    if (s.trades < MIN_PATTERN_SAMPLES) {
      s.adjustment = 0;
      s.note = `Only ${s.trades}/${MIN_PATTERN_SAMPLES} closed trades — still gathering evidence, no scoring change yet.`;
      out.push(s);
      continue;
    }

    // Two separate bars. The penalty bar is wider: any well-sampled pattern
    // with a negative expectancy or a sub-40% win rate earns a score-breaking
    // penalty. The block bar is stricter and refuses the setup outright.
    const penaltyBar =
      s.trades >= BLOCK_MIN_SAMPLES &&
      (s.winRate < PENALTY_MAX_WIN_RATE || s.avgR < 0);
    const blockBar =
      s.trades >= BLOCK_MIN_SAMPLES &&
      (s.winRate < BLOCK_MAX_WIN_RATE || s.avgR <= BLOCK_MAX_AVG_R);

    if (penaltyBar) {
      // Aggressive penalty — scaled by how bad the pattern actually is, big
      // enough on its own to push a typical 85–90 score below the gate.
      const winShort = Math.max(0, (45 - s.winRate) / 45);       // 0 .. 1
      const rShort = Math.max(0, Math.min(1, -s.avgR / 1.0));     // 0 .. 1
      const severity = Math.max(winShort, rShort);
      const size = Math.min(1, s.trades / 20);
      const raw = -(6 + 14 * severity) * (0.6 + 0.4 * size);
      s.adjustment = +Math.max(-MAX_PATTERN_PENALTY, raw).toFixed(2);

      if (blockBar && recovering) {
        s.note = `Losing pattern under watch: ${s.trades} trades, ${s.winRate.toFixed(0)}% win rate, avg ${s.avgR.toFixed(2)}R → penalty ${s.adjustment.toFixed(2)}. Block lifted — last ${s.recentTrades} trades improved to ${s.recentWinRate.toFixed(0)}% win.`;
      } else if (blockBar && BLOCKABLE_DIMENSIONS.includes(s.dimension)) {
        s.blocked = true;
        s.blockReason = `${s.trades} closed trades, ${s.winRate.toFixed(0)}% win rate, avg ${s.avgR.toFixed(2)}R — pattern blocked from new entries until recent form recovers (${UNBLOCK_MIN_RECENT}+ trades at ${UNBLOCK_MIN_WIN_RATE}%+ win).`;
        s.note = `BLOCKED. ${s.blockReason} Score penalty ${s.adjustment.toFixed(2)} also applies.`;
      } else {
        s.note = `Losing pattern: ${s.trades} trades, ${s.winRate.toFixed(0)}% win rate, avg ${s.avgR.toFixed(2)}R → heavy score penalty ${s.adjustment.toFixed(2)}.`;
      }
      out.push(s);
      continue;
    }

    // Ordinary expectancy-driven adjustment. avgR of +0.2 is roughly
    // break-even after costs, so that is the pivot.
    const confidence = Math.min(1, s.trades / 15);
    const raw = (s.avgR - 0.2) * 5 * confidence;
    if (raw > 0) {
      // Bonus side is deliberately conservative and gated on sample size, so a
      // short lucky streak cannot inflate a weak setup through the gate.
      const bonusScale = s.trades >= MIN_BONUS_SAMPLES ? 1 : 0.35;
      s.adjustment = +Math.min(MAX_PATTERN_BONUS, raw * bonusScale).toFixed(2);
    } else {
      s.adjustment = +Math.max(-MAX_PATTERN_PENALTY, raw * 2).toFixed(2);
    }

    s.note = s.adjustment < -0.25
      ? `Losing pattern: ${s.trades} trades, ${s.winRate.toFixed(0)}% win rate, avg ${s.avgR.toFixed(2)}R → score penalty ${s.adjustment.toFixed(2)}.`
      : s.adjustment > 0.25
        ? `Winning pattern: ${s.trades} trades, ${s.winRate.toFixed(0)}% win rate, avg ${s.avgR.toFixed(2)}R → score bonus +${s.adjustment.toFixed(2)}${s.trades < MIN_BONUS_SAMPLES ? " (damped — under " + MIN_BONUS_SAMPLES + " trades)" : ""}.`
        : `Neutral: ${s.trades} trades, ${s.winRate.toFixed(0)}% win rate, avg ${s.avgR.toFixed(2)}R — no meaningful edge either way.`;
    out.push(s);
  }
  return out.sort((a, b) => a.adjustment - b.adjustment);
}

// --------------------------- Store -----------------------------------------

export type BlockedPattern = {
  key: string;
  dimension: string;
  trades: number;
  winRate: number;
  avgR: number;
  pnl: number;
  adjustment: number;
  reason: string;
  since: number;
};

type LearningStore = {
  patterns: PatternStat[];
  adjustments: Record<string, number>;
  blocked: Record<string, BlockedPattern>;
  history: AdjustmentEvent[];
  reviewCount: number;
  lastRunAt: number | null;
  running: boolean;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  apply: (patterns: PatternStat[], reviewCount: number, events: AdjustmentEvent[]) => void;
  setRunning: (v: boolean) => void;
};

export const useLearning = create<LearningStore>()(
  persist(
    (set, get) => ({
      patterns: [],
      adjustments: {},
      blocked: {},
      history: [],
      reviewCount: 0,
      lastRunAt: null,
      running: false,
      enabled: true,
      setEnabled: (v) => set({ enabled: v }),
      setRunning: (v) => set({ running: v }),
      apply: (patterns, reviewCount, events) => {
        const adjustments: Record<string, number> = {};
        const prevBlocked = get().blocked;
        const blocked: Record<string, BlockedPattern> = {};
        for (const p of patterns) {
          if (p.adjustment !== 0) adjustments[p.key] = p.adjustment;
          if (p.blocked) {
            blocked[p.key] = {
              key: p.key,
              dimension: p.dimension,
              trades: p.trades,
              winRate: +p.winRate.toFixed(1),
              avgR: +p.avgR.toFixed(3),
              pnl: +p.pnl.toFixed(2),
              adjustment: p.adjustment,
              reason: p.blockReason,
              since: prevBlocked[p.key]?.since ?? Date.now(),
            };
          }
        }
        set({
          patterns,
          adjustments,
          blocked,
          reviewCount,
          lastRunAt: Date.now(),
          history: [...events, ...get().history].slice(0, 300),
        });
      },
    }),
    {
      name: "aurum-strategy-learning-v1",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : (undefined as any))),
      partialize: (s) => ({
        patterns: s.patterns, adjustments: s.adjustments, blocked: s.blocked, history: s.history,
        reviewCount: s.reviewCount, lastRunAt: s.lastRunAt, enabled: s.enabled,
      }) as any,
    },
  ),
);

/**
 * Total score adjustment for a candidate setup. Called synchronously from the
 * quality scorer — never does IO.
 */
export function learningAdjustment(ctx: PatternContext): { delta: number; notes: string[] } {
  const st = useLearning.getState();
  if (!st.enabled) return { delta: 0, notes: [] };
  const keys = patternKeys(ctx);
  let delta = 0;
  const notes: string[] = [];
  for (const k of keys) {
    const a = st.adjustments[k];
    if (!a) continue;
    delta += a;
    notes.push(`${k} ${a > 0 ? "+" : ""}${a.toFixed(2)}`);
  }
  const clamped = Math.max(-MAX_TOTAL_PENALTY, Math.min(MAX_TOTAL_BONUS, delta));
  return { delta: +clamped.toFixed(2), notes };
}

/**
 * Hard block check. A pattern that has proved itself a losing setup is refused
 * outright, regardless of how good the rest of the score looks.
 */
export function learningBlock(ctx: PatternContext): { blocked: boolean; reason: string; keys: string[] } {
  const st = useLearning.getState();
  if (!st.enabled) return { blocked: false, reason: "Learning blocks disabled", keys: [] };
  const hits = patternKeys(ctx)
    .map((k) => st.blocked[k])
    .filter(Boolean) as BlockedPattern[];
  if (!hits.length) return { blocked: false, reason: "No blocked pattern matched", keys: [] };
  return {
    blocked: true,
    reason: hits.map((h) => `${describePattern(h.key)} — ${h.reason}`).join(" | "),
    keys: hits.map((h) => h.key),
  };
}

/** All currently blocked patterns, worst first. */
export function blockedPatterns(): BlockedPattern[] {
  return Object.values(useLearning.getState().blocked).sort((a, b) => a.winRate - b.winRate);
}

// --------------------------- Refresh cycle ---------------------------------

const CHANGE_EPSILON = 0.25;

/** Recompute every pattern from the stored trade reviews and persist the diff. */
export async function refreshLearning(): Promise<{ ok: boolean; reviews: number; changed: number; error?: string }> {
  if (useLearning.getState().running) return { ok: false, reviews: 0, changed: 0, error: "already running" };
  useLearning.getState().setRunning(true);
  try {
    const { data, error } = await supabase
      .from("trade_reviews")
      .select("outcome,r_multiple,profit,pattern_keys")
      .order("closed_at", { ascending: false })
      .limit(1000);
    if (error) return { ok: false, reviews: 0, changed: 0, error: error.message };

    const reviews = (data ?? []) as ReviewRow[];
    const patterns = aggregatePatterns(reviews);
    const prev = useLearning.getState().adjustments;

    const events: AdjustmentEvent[] = [];
    for (const p of patterns) {
      const before = prev[p.key] ?? 0;
      if (Math.abs(p.adjustment - before) < CHANGE_EPSILON) continue;
      events.push({
        at: Date.now(), key: p.key, from: before, to: p.adjustment,
        trades: p.trades, winRate: +p.winRate.toFixed(1), avgR: +p.avgR.toFixed(3), note: p.note,
      });
    }

    useLearning.getState().apply(patterns, reviews.length, events);

    if (events.length) {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (uid) {
        await supabase.from("strategy_adjustments").insert(
          events.map((e) => ({
            user_id: uid,
            pattern_key: e.key,
            dimension: dimensionOf(e.key),
            adjustment: e.to,
            previous_adjustment: e.from,
            sample_size: e.trades,
            win_rate: e.winRate,
            avg_r: e.avgR,
            note: e.note,
          })),
        );
      }
    }
    return { ok: true, reviews: reviews.length, changed: events.length };
  } catch (e: any) {
    return { ok: false, reviews: 0, changed: 0, error: e?.message ?? String(e) };
  } finally {
    useLearning.getState().setRunning(false);
  }
}

let learningTimer: ReturnType<typeof setInterval> | null = null;
/** Ongoing, automatic re-learning. Safe to call repeatedly. */
export function startLearningLoop(intervalMs = 15 * 60_000) {
  if (typeof window === "undefined" || learningTimer) return;
  void refreshLearning();
  learningTimer = setInterval(() => { void refreshLearning(); }, intervalMs);
}
