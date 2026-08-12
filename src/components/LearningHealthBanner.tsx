// Watchdog for the strategy-learning pipeline. If trades keep closing but no
// new trade_reviews are written for 24h, the feedback loop is dead — say so
// loudly instead of letting the bot trade blind for days.

import { useEffect, useState } from "react";
import { AlertTriangle, Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const STALE_MS = 24 * 3_600_000;
const POLL_MS = 5 * 60_000;

export function LearningHealthBanner() {
  const [state, setState] = useState<{
    lastReview: number | null;
    closedSince: number;
    checkedAt: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const cutoff = new Date(Date.now() - STALE_MS).toISOString();
      const [{ data: rev }, { count }] = await Promise.all([
        supabase.from("trade_reviews").select("created_at").order("created_at", { ascending: false }).limit(1),
        supabase
          .from("trades")
          .select("id", { count: "exact", head: true })
          .eq("status", "closed")
          .eq("reconciled", false)
          .gte("closed_at", cutoff),
      ]);
      if (!alive) return;
      const ts = rev?.[0]?.created_at;
      setState({
        lastReview: ts ? new Date(ts).getTime() : null,
        closedSince: count ?? 0,
        checkedAt: Date.now(),
      });
    };
    void load();
    const id = window.setInterval(load, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  if (!state) return null;
  const ageMs = state.lastReview ? Date.now() - state.lastReview : Infinity;
  const stale = ageMs > STALE_MS && state.closedSince > 0;
  const hours = Number.isFinite(ageMs) ? Math.floor(ageMs / 3_600_000) : null;
  const ageLabel = state.lastReview
    ? hours && hours >= 1
      ? `${hours}h ago`
      : `${Math.round(ageMs / 60_000)}m ago`
    : "never";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        stale ? "border-bear/50 bg-bear/10 text-bear" : "border-border/60 bg-card/70 text-muted-foreground",
      )}
      role={stale ? "alert" : undefined}
    >
      {stale ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <Brain className="mt-0.5 h-4 w-4 shrink-0 text-bull" />
      )}
      <div>
        <div className="font-medium">
          {stale
            ? `Strategy learning stalled — no trade reviews written in ${ageLabel} while ${state.closedSince} trades closed`
            : `Strategy learning healthy — last trade review ${ageLabel}`}
        </div>
        <div className="mt-0.5 text-xs opacity-80">
          {stale
            ? "The bot is adapting on stale data. Open the Learning page to re-run the review pass and check for insert errors."
            : `${state.closedSince} trades closed in the last 24h · checked ${new Date(state.checkedAt).toLocaleTimeString()}`}
        </div>
      </div>
    </div>
  );
}
