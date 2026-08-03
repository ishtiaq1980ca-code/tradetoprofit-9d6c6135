import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  describePattern, refreshLearning, useLearning, MIN_PATTERN_SAMPLES,
} from "@/lib/strategyLearning";
import { reviewClosedTrades, BEHAVIOR_LABEL, type TradeBehavior } from "@/lib/tradeReviewer";
import { activeCooldowns, humanRemaining, useRejectionCooldown } from "@/lib/rejectionCooldown";
import { Brain, RefreshCw, TrendingDown, TrendingUp, History, ClipboardList, Timer } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/learning")({
  head: () => ({
    meta: [
      { title: "Strategy Learning — AurumAI" },
      { name: "description", content: "What the bot has learned from its own closed trades: winning and losing market-structure patterns, and the scoring adjustments it made automatically." },
      { property: "og:title", content: "Strategy Learning — AurumAI" },
      { property: "og:description", content: "Post-trade review patterns and the automatic scoring adjustments the bot applies to future entries." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LearningPage,
});

type ReviewRow = {
  id: string;
  symbol: string; side: string; outcome: string; behavior: TradeBehavior;
  r_multiple: number | null; profit: number | null; closed_at: string | null;
  session: string | null; htf_trend: string | null; swing: string | null;
  quality_score: number | null; structure_note: string | null; lessons: string | null;
};

function LearningPage() {
  const patterns = useLearning((s) => s.patterns);
  const history = useLearning((s) => s.history);
  const lastRunAt = useLearning((s) => s.lastRunAt);
  const reviewCount = useLearning((s) => s.reviewCount);
  const running = useLearning((s) => s.running);
  const enabled = useLearning((s) => s.enabled);
  const setEnabled = useLearning((s) => s.setEnabled);
  const cooldownState = useRejectionCooldown((s) => s.entries);
  const clearAllCooldowns = useRejectionCooldown((s) => s.clearAll);

  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const loadReviews = async () => {
    const { data } = await supabase
      .from("trade_reviews")
      .select("id,symbol,side,outcome,behavior,r_multiple,profit,closed_at,session,htf_trend,swing,quality_score,structure_note,lessons")
      .order("closed_at", { ascending: false })
      .limit(60);
    setReviews((data ?? []) as ReviewRow[]);
  };

  useEffect(() => { void loadReviews(); }, []);

  const runNow = async () => {
    setBusy(true);
    const r = await reviewClosedTrades();
    if (r.error) toast.error(`Review failed: ${r.error}`);
    else if (r.created) toast.success(`${r.created} new trade review${r.created === 1 ? "" : "s"} recorded`);
    const l = await refreshLearning();
    if (l.ok) toast.success(`Re-learned from ${l.reviews} reviews · ${l.changed} scoring adjustment${l.changed === 1 ? "" : "s"} changed`);
    else if (l.error) toast.error(`Learning failed: ${l.error}`);
    await loadReviews();
    setBusy(false);
  };

  const losing = useMemo(() => patterns.filter((p) => p.adjustment < -0.25).slice(0, 12), [patterns]);
  const winning = useMemo(
    () => patterns.filter((p) => p.adjustment > 0.25).sort((a, b) => b.adjustment - a.adjustment).slice(0, 12),
    [patterns],
  );
  const gathering = useMemo(
    () => patterns.filter((p) => p.trades < MIN_PATTERN_SAMPLES).sort((a, b) => b.trades - a.trades).slice(0, 12),
    [patterns],
  );
  const cools = useMemo(() => activeCooldowns(), [cooldownState]);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
              <Brain className="h-7 w-7 text-gold" />
              Strategy Learning
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
              Every closed trade is reviewed against the market structure the bot read at entry. Patterns that keep
              losing lose points in the entry score; patterns that keep winning gain points. This runs automatically —
              the button below only forces an early pass.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Switch checked={enabled} onCheckedChange={setEnabled} id="learn-toggle" />
              <label htmlFor="learn-toggle" className="text-muted-foreground">Apply learning to scoring</label>
            </div>
            <Button size="sm" onClick={runNow} disabled={busy || running}>
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", (busy || running) && "animate-spin")} />
              Review &amp; re-learn now
            </Button>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Reviews analysed" value={String(reviewCount)} />
          <Stat label="Patterns tracked" value={String(patterns.length)} />
          <Stat label="Active adjustments" value={String(patterns.filter((p) => p.adjustment !== 0).length)} />
          <Stat label="Last learning pass" value={lastRunAt ? new Date(lastRunAt).toLocaleTimeString() : "—"} />
        </div>

        <Tabs defaultValue="patterns">
          <TabsList>
            <TabsTrigger value="patterns">Patterns</TabsTrigger>
            <TabsTrigger value="changes">Adjustments made</TabsTrigger>
            <TabsTrigger value="reviews">Trade reviews</TabsTrigger>
            <TabsTrigger value="cooldowns">Cooldowns</TabsTrigger>
          </TabsList>

          <TabsContent value="patterns" className="space-y-4 mt-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <PatternCard
                title="Top losing patterns"
                icon={<TrendingDown className="h-4 w-4 text-bear" />}
                empty="No losing pattern has enough closed trades yet."
                rows={losing}
              />
              <PatternCard
                title="Top winning patterns"
                icon={<TrendingUp className="h-4 w-4 text-bull" />}
                empty="No winning pattern has enough closed trades yet."
                rows={winning}
              />
            </div>
            <PatternCard
              title={`Still gathering evidence (under ${MIN_PATTERN_SAMPLES} trades)`}
              icon={<ClipboardList className="h-4 w-4 text-muted-foreground" />}
              empty="Nothing in the sample queue."
              rows={gathering}
            />
          </TabsContent>

          <TabsContent value="changes" className="mt-4">
            <Card className="border-border/60 bg-card/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="h-4 w-4 text-gold" /> Automatic adjustments over time
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No adjustments yet. The bot needs at least {MIN_PATTERN_SAMPLES} closed trades sharing a pattern
                    before it will change how it scores that pattern.
                  </p>
                ) : history.map((h, i) => (
                  <div key={`${h.key}-${h.at}-${i}`} className="rounded border border-border/60 bg-background/40 px-3 py-2 text-[12px]">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <span className="font-medium">{describePattern(h.key)}</span>
                      <span className="text-muted-foreground">{new Date(h.at).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono-tabular text-[11px]">
                      <Badge variant="outline" className={h.to < h.from ? "text-bear border-bear/40" : "text-bull border-bull/40"}>
                        {h.from.toFixed(2)} → {h.to.toFixed(2)} pts
                      </Badge>
                      <span className="text-muted-foreground">{h.trades} trades · {h.winRate.toFixed(0)}% win · {h.avgR.toFixed(2)}R avg</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{h.note}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reviews" className="mt-4">
            <Card className="border-border/60 bg-card/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Latest post-trade reviews</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {reviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No reviews yet. They are created automatically a couple of minutes after each MT5 trade closes.
                  </p>
                ) : reviews.map((r) => (
                  <div key={r.id} className="rounded border border-border/60 bg-background/40 px-3 py-2 text-[12px] space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{r.symbol}</span>
                      <Badge variant="outline" className={r.side === "BUY" ? "text-bull border-bull/40" : "text-bear border-bear/40"}>{r.side}</Badge>
                      <Badge className={cn("border", r.outcome === "win" ? "border-bull/40 bg-bull/10 text-bull" : r.outcome === "loss" ? "border-bear/40 bg-bear/10 text-bear" : "border-muted bg-muted/30 text-muted-foreground")}>
                        {r.outcome}
                      </Badge>
                      <span className="font-mono-tabular">{r.r_multiple != null ? `${r.r_multiple >= 0 ? "+" : ""}${r.r_multiple.toFixed(2)}R` : "—"}</span>
                      <span className="font-mono-tabular text-muted-foreground">${Number(r.profit ?? 0).toFixed(2)}</span>
                      <span className="text-muted-foreground">{BEHAVIOR_LABEL[r.behavior] ?? r.behavior}</span>
                      <span className="ml-auto text-muted-foreground">{r.closed_at ? new Date(r.closed_at).toLocaleString() : ""}</span>
                    </div>
                    <div className="text-muted-foreground">
                      Session {r.session ?? "—"} · H1 {r.htf_trend ?? "—"} · swing {r.swing ?? "—"} · score {r.quality_score ?? "—"}
                    </div>
                    {r.lessons && <p className="text-muted-foreground leading-snug">{r.lessons}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cooldowns" className="mt-4">
            <Card className="border-border/60 bg-card/70">
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Timer className="h-4 w-4 text-gold" /> Setups parked after rejection
                </CardTitle>
                <Button size="sm" variant="ghost" onClick={clearAllCooldowns}>Clear all</Button>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  When a symbol+direction is rejected, it is parked so the strategy stops re-proposing the identical
                  setup every scan. Repeated rejections extend the park progressively.
                </p>
                {cools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing parked right now.</p>
                ) : cools.map((c) => (
                  <div key={c.key} className="flex items-center gap-2 flex-wrap rounded border border-border/60 bg-background/40 px-3 py-2 text-[12px]">
                    <span className="font-semibold">{c.symbol}</span>
                    <Badge variant="outline" className={c.side === "BUY" ? "text-bull border-bull/40" : "text-bear border-bear/40"}>{c.side}</Badge>
                    <Badge variant="outline">{c.cls}</Badge>
                    <span className="text-muted-foreground">×{c.streak}</span>
                    <span className="font-mono-tabular text-gold">{humanRemaining(c.until)} left</span>
                    <span className="text-muted-foreground truncate flex-1 min-w-0">{c.reason}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/60 bg-card/70">
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-semibold font-mono-tabular">{value}</div>
      </CardContent>
    </Card>
  );
}

function PatternCard({
  title, icon, rows, empty,
}: {
  title: string; icon: React.ReactNode; empty: string;
  rows: Array<{ key: string; trades: number; winRate: number; avgR: number; pnl: number; adjustment: number; note: string }>;
}) {
  return (
    <Card className="border-border/60 bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">{icon} {title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : rows.map((p) => (
          <div key={p.key} className="rounded border border-border/60 bg-background/40 px-3 py-2 text-[12px]">
            <div className="flex items-start justify-between gap-3">
              <span className="font-medium">{describePattern(p.key)}</span>
              <Badge
                variant="outline"
                className={cn("font-mono-tabular shrink-0",
                  p.adjustment < 0 ? "text-bear border-bear/40" : p.adjustment > 0 ? "text-bull border-bull/40" : "text-muted-foreground")}
              >
                {p.adjustment > 0 ? "+" : ""}{p.adjustment.toFixed(2)} pts
              </Badge>
            </div>
            <div className="mt-1 font-mono-tabular text-[11px] text-muted-foreground">
              {p.trades} trades · {p.winRate.toFixed(0)}% win · {p.avgR.toFixed(2)}R avg · ${p.pnl.toFixed(2)}
            </div>
            <p className="mt-1 text-muted-foreground leading-snug">{p.note}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
