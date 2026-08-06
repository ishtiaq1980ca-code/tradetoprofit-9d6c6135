// Structure-invalidation monitor for OPEN positions.
//
// Runs on every bot scan cycle: reads the live open MT5 positions the bridge
// mirrors into `trades`, re-evaluates market structure per symbol and, when the
// original thesis is broken, queues a market-close request the bridge picks up.
//
// The MT5 execution/trailing layer is not modified — this only adds a new
// close-request queue that the bridge consumes.

import { supabase } from "@/integrations/supabase/client";
import { useDecisionLog } from "./decisionLog";
import { normalizeSymbol } from "./pairProfiles";
import { priceFeed } from "./priceFeed";
import { evaluateInvalidation } from "./structureInvalidation";
import { describeStructure } from "./marketStructure";
import { atr as atrSeries } from "./indicators";

export type MonitorOutcome = {
  checked: number;
  queued: number;
  errors: string[];
};

/** Do not re-check the same ticket more often than this. */
const CHECK_INTERVAL_MS = 60_000;
const lastCheckedAt = new Map<number, number>();
/** Tickets we already queued a close for in this session. */
const queued = new Set<number>();

let inFlight = false;

function candlesFor(symbol: string) {
  const feed = priceFeed.state.candles;
  const direct = feed[symbol];
  if (direct?.length) return direct;
  const target = normalizeSymbol(symbol);
  for (const [k, v] of Object.entries(feed)) {
    if (normalizeSymbol(k) === target && v?.length) return v;
  }
  return null;
}

export async function monitorStructureInvalidation(): Promise<MonitorOutcome> {
  const out: MonitorOutcome = { checked: 0, queued: 0, errors: [] };
  if (inFlight) return out;
  inFlight = true;
  try {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return out;

    // Only genuinely-live positions. Rows flagged for review (no broker close
    // report) or older than the broker's history window are ghosts — closing
    // them would fire pointless close requests and skew exposure.
    const freshCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: open, error } = await supabase
      .from("trades")
      .select("id,mt5_ticket,symbol,side,entry,stop_loss,take_profit,opened_at")
      .eq("status", "open")
      .eq("needs_review", false)
      .gte("opened_at", freshCutoff)
      .order("opened_at", { ascending: false })
      .limit(50);
    if (error) { out.errors.push(error.message); return out; }
    if (!open?.length) return out;

    const now = Date.now();
    for (const t of open) {
      const ticket = Number(t.mt5_ticket ?? 0);
      if (!ticket || queued.has(ticket)) continue;
      if (now - (lastCheckedAt.get(ticket) ?? 0) < CHECK_INTERVAL_MS) continue;
      lastCheckedAt.set(ticket, now);

      const side = String(t.side).toUpperCase() === "BUY" ? "BUY" : "SELL";
      const candles = candlesFor(t.symbol);
      if (!candles || candles.length < 90) continue;
      out.checked++;

      const res = evaluateInvalidation(side, candles, Number(t.entry));
      if (!res.invalidated) continue;

      const closed = candles.slice(0, -1);
      const a = atrSeries(closed, 14)[closed.length - 1] ?? 0;
      const structure = describeStructure(closed, a);

      const { error: insErr } = await supabase.from("close_requests").insert({
        user_id: uid,
        mt5_ticket: ticket,
        symbol: normalizeSymbol(t.symbol),
        side,
        reason: res.reason,
        kind: "structure_invalidated",
      });

      if (insErr) {
        // A duplicate pending request for this ticket is fine — it means the
        // exit is already queued.
        if (!/duplicate key/i.test(insErr.message)) { out.errors.push(insErr.message); continue; }
      }

      queued.add(ticket);
      out.queued++;

      useDecisionLog.getState().record({
        symbol: normalizeSymbol(t.symbol),
        direction: side,
        strategy: "structure-invalidation-exit",
        confidence: 0,
        status: "exited",
        reason:
          `${res.reason}. Original stop ${t.stop_loss ?? "—"} / target ${t.take_profit ?? "—"} was not reached — ` +
          `closing at market because the structural reason for the trade is no longer valid.`,
        indicators: { ATR: +a.toFixed(6) },
        filters: res.checks.map((c) => ({ name: c.name, pass: c.pass, reason: c.detail })),
        gateChecks: res.checks.map((c) => ({ name: c.name, pass: c.pass, reason: c.detail })),
        entry: Number(t.entry),
        stopLoss: t.stop_loss == null ? undefined : Number(t.stop_loss),
        takeProfit: t.take_profit == null ? undefined : Number(t.take_profit),
        structure,
        patternKeys: [`exit:structure_invalidated`, `pair:${normalizeSymbol(t.symbol)}`],
      });
    }
    return out;
  } catch (e: any) {
    out.errors.push(e?.message ?? "structure monitor failed");
    return out;
  } finally {
    inFlight = false;
  }
}

/** Tickets closed by structure invalidation during this session (UI/reviewer aid). */
export function structureExitTickets(): number[] {
  return [...queued];
}
