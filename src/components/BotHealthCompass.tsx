// Container that feeds real metrics into the compass rose gauge.

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CompassGauge, type CompassMetric } from "@/components/CompassGauge";
import { supabase } from "@/integrations/supabase/client";
import { useBot } from "@/lib/tradingBot";

export function BotHealthCompass({ drawdownPct }: { drawdownPct: number }) {
  const enabledSymbols = useBot((s) => s.enabledSymbols);
  const [agg, setAgg] = useState<{ winRate: number; avgR: number; n: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("trade_reviews")
        .select("profit, r_multiple, closed_at")
        .order("closed_at", { ascending: false })
        .limit(300);
      if (cancelled || !data) return;
      const rows = data as any[];
      if (rows.length === 0) return setAgg({ winRate: 0, avgR: 0, n: 0 });
      const wins = rows.filter((r) => Number(r.profit ?? 0) > 0).length;
      const avgR = rows.reduce((a, r) => a + Number(r.r_multiple ?? 0), 0) / rows.length;
      setAgg({ winRate: (wins / rows.length) * 100, avgR, n: rows.length });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const winRate = agg?.winRate ?? 0;
  const avgR = agg?.avgR ?? 0;
  const pairs = enabledSymbols.length;

  const metrics: CompassMetric[] = [
    { label: "Win rate", display: `${winRate.toFixed(1)}%`, score: Math.min(1, winRate / 60) },
    { label: "Avg R", display: `${avgR > 0 ? "+" : ""}${avgR.toFixed(2)}`, score: Math.min(1, Math.max(0, (avgR + 0.5) / 1.0)) },
    { label: "Drawdown", display: `${drawdownPct.toFixed(1)}%`, score: Math.min(1, Math.max(0, 1 - drawdownPct / 20)) },
    { label: "Pairs", display: String(pairs), score: Math.min(1, pairs / 12) },
  ];

  return (
    <Card className="border-border/60 bg-card/70 backdrop-blur">
      <CardHeader className="pb-0">
        <CardTitle className="text-base font-medium">Compass</CardTitle>
        <p className="text-xs text-muted-foreground">
          Composite bearing across win rate, expectancy, drawdown and coverage.
        </p>
      </CardHeader>
      <CardContent className="pt-4">
        <CompassGauge
          metrics={metrics}
          caption={agg ? `Based on last ${agg.n} reviewed trades` : "Loading review data…"}
        />
      </CardContent>
    </Card>
  );
}
