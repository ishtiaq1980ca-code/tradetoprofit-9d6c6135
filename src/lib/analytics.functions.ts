import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PairStat = { symbol: string; trades: number; wins: number; losses: number; winRate: number; pnl: number };
export type PnlPoint = { date: string; pnl: number; cumulative: number };
export type RejectionReason = { reason: string; count: number };
export type ConfidencePoint = { confidence: number; pnl: number; symbol: string; ts: string };

export const getAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: trades } = await supabase
      .from("trades")
      .select("symbol,profit,status,opened_at,closed_at,signal_id")
      .eq("status", "closed")
      .order("closed_at", { ascending: true })
      .limit(1000);

    const pairMap = new Map<string, PairStat>();
    const pnlByDay = new Map<string, number>();
    let cum = 0;
    let peak = 0;
    let maxDrawdown = 0;

    for (const t of trades ?? []) {
      const sym = String(t.symbol);
      const profit = Number(t.profit ?? 0);
      const s = pairMap.get(sym) ?? { symbol: sym, trades: 0, wins: 0, losses: 0, winRate: 0, pnl: 0 };
      s.trades += 1;
      if (profit >= 0) s.wins += 1; else s.losses += 1;
      s.pnl += profit;
      s.winRate = s.trades ? (s.wins / s.trades) * 100 : 0;
      pairMap.set(sym, s);

      const day = (t.closed_at ?? t.opened_at ?? "").slice(0, 10);
      if (day) pnlByDay.set(day, (pnlByDay.get(day) ?? 0) + profit);
    }

    const pnlSeries: PnlPoint[] = [];
    for (const [date, pnl] of Array.from(pnlByDay.entries()).sort()) {
      cum += pnl;
      if (cum > peak) peak = cum;
      const dd = peak - cum;
      if (dd > maxDrawdown) maxDrawdown = dd;
      pnlSeries.push({ date, pnl, cumulative: cum });
    }

    // Rejection reasons
    const { data: rejected } = await supabase
      .from("signals")
      .select("reason")
      .eq("status", "rejected")
      .order("created_at", { ascending: false })
      .limit(500);
    const rejMap = new Map<string, number>();
    for (const r of rejected ?? []) {
      const key = (r.reason ?? "unknown").split(":")[0].slice(0, 60);
      rejMap.set(key, (rejMap.get(key) ?? 0) + 1);
    }
    const rejections: RejectionReason[] = Array.from(rejMap.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    // Confidence vs P&L
    const signalIds = (trades ?? []).map((t) => t.signal_id).filter(Boolean) as string[];
    const confidenceMap = new Map<string, number>();
    if (signalIds.length) {
      const { data: sigs } = await supabase
        .from("signals")
        .select("id,confidence")
        .in("id", signalIds);
      for (const s of sigs ?? []) confidenceMap.set(String(s.id), Number(s.confidence ?? 0));
    }
    const confidencePoints: ConfidencePoint[] = (trades ?? [])
      .filter((t) => t.signal_id && confidenceMap.has(String(t.signal_id)))
      .map((t) => ({
        confidence: confidenceMap.get(String(t.signal_id))!,
        pnl: Number(t.profit ?? 0),
        symbol: String(t.symbol),
        ts: String(t.closed_at ?? t.opened_at ?? ""),
      }));

    return {
      pairs: Array.from(pairMap.values()).sort((a, b) => b.pnl - a.pnl),
      pnlSeries,
      maxDrawdown,
      rejections,
      confidencePoints,
    };
  });
