// Recent closed trades with behavior pills sourced from trade_reviews.

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/format";

type Review = {
  id: string;
  symbol: string;
  side: string;
  profit: number | null;
  r_multiple: number | null;
  behavior: string | null;
  closed_at: string | null;
  duration_sec: number | null;
};

const GOOD_BEHAVIORS = new Set(["clean_run", "slow_winner", "runner", "quick_win", "target_hit"]);
const BAD_BEHAVIORS = new Set(["gradual_bleed", "instant_reverse", "stopped_out", "chop_loss", "full_stop"]);

function BehaviorPill({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = GOOD_BEHAVIORS.has(value) ? "good" : BAD_BEHAVIORS.has(value) ? "bad" : "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] tracking-wide",
        tone === "good" && "border-bull/40 bg-bull/10 text-bull",
        tone === "bad" && "border-bear/40 bg-bear/10 text-bear",
        tone === "neutral" && "border-gold/35 bg-gold/10 text-gold",
      )}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function RecentTradesPanel() {
  const [rows, setRows] = useState<Review[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("trade_reviews")
        .select("id, symbol, side, profit, r_multiple, behavior, closed_at, duration_sec")
        .order("closed_at", { ascending: false })
        .limit(15);
      if (!cancelled && data) setRows(data as unknown as Review[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="border-border/60 bg-card/70">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-medium">Recent Trades</CardTitle>
        <span className="text-xs text-muted-foreground">Last 15 reviewed closes</span>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-6 pb-6 pt-2 text-sm text-muted-foreground">No reviewed trades yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono-tabular">
              <thead className="border-y border-border/60 bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Closed</th>
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-left">Side</th>
                  <th className="px-3 py-2 text-right">P/L</th>
                  <th className="px-3 py-2 text-right">R</th>
                  <th className="px-3 py-2 text-right">Held</th>
                  <th className="px-3 py-2 text-left">Behavior</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pnl = Number(r.profit ?? 0);
                  return (
                    <tr key={r.id} className="border-b border-border/40">
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {r.closed_at ? new Date(r.closed_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-3 py-2">{r.symbol}</td>
                      <td className={cn("px-3 py-2 font-medium", r.side === "BUY" ? "text-bull" : "text-bear")}>{r.side}</td>
                      <td className={cn("px-3 py-2 text-right", pnl >= 0 ? "text-bull" : "text-bear")}>{fmt.money(pnl)}</td>
                      <td className="px-3 py-2 text-right">{r.r_multiple != null ? Number(r.r_multiple).toFixed(2) : "—"}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {r.duration_sec != null ? `${Math.round(Number(r.duration_sec) / 60)}m` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <BehaviorPill value={r.behavior} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
