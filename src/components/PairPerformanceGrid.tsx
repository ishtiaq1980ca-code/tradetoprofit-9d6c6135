// Per-pair performance cards for the currently enabled symbols.
// Reads existing pattern stats from strategy_adjustments (dimension = 'pair').

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useBot } from "@/lib/tradingBot";
import { cn } from "@/lib/utils";

type PairStat = { pair: string; winRate: number; avgR: number; samples: number };

export function PairPerformanceGrid() {
  const enabledSymbols = useBot((s) => s.enabledSymbols);
  const [stats, setStats] = useState<Record<string, PairStat>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("strategy_adjustments")
        .select("pattern_key, dimension, win_rate, avg_r, sample_size, created_at")
        .eq("dimension", "pair")
        .order("created_at", { ascending: false })
        .limit(400);
      if (cancelled || !data) return;
      const map: Record<string, PairStat> = {};
      for (const row of data as any[]) {
        const pair = String(row.pattern_key ?? "").split(":")[1];
        if (!pair || map[pair]) continue;
        map[pair] = {
          pair,
          winRate: Number(row.win_rate ?? 0),
          avgR: Number(row.avg_r ?? 0),
          samples: Number(row.sample_size ?? 0),
        };
      }
      setStats(map);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pairs = enabledSymbols.slice().sort();

  return (
    <Card className="border-border/60 bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Enabled Pairs</CardTitle>
        <p className="text-xs text-muted-foreground">
          Accent reflects each pair's learned expectancy — jade for positive, brick for negative.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {pairs.length === 0 && (
          <div className="text-sm text-muted-foreground">No pairs enabled.</div>
        )}
        {pairs.map((sym) => {
          const s = stats[sym];
          const tone = !s ? "neutral" : s.avgR > 0.02 ? "good" : s.avgR < -0.02 ? "bad" : "neutral";
          return (
            <div
              key={sym}
              className={cn(
                "rounded-md border border-border/60 bg-background/40 px-3 py-3 border-l-2 transition-colors",
                tone === "good" && "border-l-bull",
                tone === "bad" && "border-l-bear",
                tone === "neutral" && "border-l-gold/50",
              )}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-mono-tabular text-sm font-medium">{sym}</span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {s ? `${s.samples} trades` : "no data"}
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-3 font-mono-tabular text-xs">
                <span className="text-muted-foreground">
                  WR{" "}
                  <span className="text-foreground">{s ? `${s.winRate.toFixed(1)}%` : "—"}</span>
                </span>
                <span className="text-muted-foreground">
                  avgR{" "}
                  <span className={cn(tone === "good" ? "text-bull" : tone === "bad" ? "text-bear" : "text-foreground")}>
                    {s ? `${s.avgR > 0 ? "+" : ""}${s.avgR.toFixed(3)}` : "—"}
                  </span>
                </span>
              </div>
              <div className="mt-2 h-1 w-full rounded-full bg-muted">
                <div
                  className={cn(
                    "h-1 rounded-full",
                    tone === "good" ? "bg-bull" : tone === "bad" ? "bg-bear" : "bg-gold/60",
                  )}
                  style={{ width: `${Math.min(100, Math.max(4, s?.winRate ?? 4))}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
