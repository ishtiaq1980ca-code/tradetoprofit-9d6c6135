// Silent-failure watchdog: warns when no signal has been generated for a long
// stretch while the market is open. Read-only — it never touches the engine.

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { activeSessions } from "@/lib/sessions";
import { useBot } from "@/lib/tradingBot";
import { cn } from "@/lib/utils";

const WARN_AFTER_MS = 60 * 60_000;   // 1 hour
const POLL_MS = 60_000;

export function SignalHealthBanner() {
  const botEnabled = useBot((s) => s.enabled);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data } = await supabase
        .from("signals")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1);
      if (!alive) return;
      const ts = data?.[0]?.created_at;
      setLastAt(ts ? new Date(ts).getTime() : null);
      setCheckedAt(Date.now());
    };
    void load();
    const id = window.setInterval(load, POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  if (!checkedAt) return null;
  const sess = activeSessions();
  const ageMs = lastAt ? Date.now() - lastAt : Infinity;
  const stale = !sess.weekend && ageMs > WARN_AFTER_MS;
  const hours = lastAt ? Math.floor(ageMs / 3_600_000) : null;
  const mins = lastAt ? Math.round((ageMs % 3_600_000) / 60_000) : null;
  const ageLabel = lastAt ? (hours ? `${hours}h ${mins}m` : `${mins}m`) : "never";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        stale ? "border-bear/50 bg-bear/10 text-bear" : "border-border/60 bg-card/70 text-muted-foreground",
      )}
      role={stale ? "alert" : undefined}
    >
      {stale ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-bull" />}
      <div>
        <div className="font-medium">
          {stale
            ? `No signals generated in over ${ageLabel} — check strategy`
            : `Signal generation healthy — last signal ${ageLabel} ago`}
        </div>
        <div className="mt-0.5 text-xs opacity-80">
          {sess.weekend
            ? "Market closed (weekend) — monitoring paused."
            : stale
              ? `Market open (${sess.primary}). Bot is ${botEnabled ? "running" : "STOPPED"}. Check the circuit breaker, news filter and quality-score gate in the decision log.`
              : `Market open (${sess.primary}) · checked ${new Date(checkedAt).toLocaleTimeString()}`}
        </div>
      </div>
    </div>
  );
}
