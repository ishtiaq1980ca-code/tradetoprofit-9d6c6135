// Read-only engine health pill. Polls the server engine status endpoint and
// the latest MT5 bridge heartbeat snapshot. Never touches trading logic.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cachedBlockedHours, loadBlockedHours, isBlockedHour } from "@/lib/tradingHours";
import { cn } from "@/lib/utils";

const POLL_MS = 12_000;
const ENGINE_FRESH_MS = 3 * 60_000;
const BRIDGE_FRESH_MS = 2 * 60_000;

function ago(ts: number | null, now: number) {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export function EngineStatusBadge({ className }: { className?: string }) {
  const [engineAt, setEngineAt] = useState<number | null>(null);
  const [bridgeAt, setBridgeAt] = useState<number | null>(null);
  const [blocked, setBlocked] = useState<number[]>(cachedBlockedHours());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/public/hooks/engine-scan", { method: "GET" });
        if (res.ok) {
          const body = (await res.json()) as { status?: { last_run_at?: string | null } };
          const at = body?.status?.last_run_at ? Date.parse(body.status.last_run_at) : NaN;
          if (alive && Number.isFinite(at)) setEngineAt(at);
        }
      } catch { /* best effort */ }
      try {
        const { data } = await supabase
          .from("account_snapshots")
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1);
        const ts = data?.[0]?.created_at;
        if (alive) setBridgeAt(ts ? new Date(ts).getTime() : null);
      } catch { /* best effort */ }
      if (alive) setNow(Date.now());
    };
    void load();
    void loadBlockedHours().then((h) => alive && setBlocked(h));
    const id = window.setInterval(load, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; window.clearInterval(id); window.clearInterval(tick); };
  }, []);

  const engineFresh = engineAt !== null && now - engineAt < ENGINE_FRESH_MS;
  const bridgeFresh = bridgeAt !== null && now - bridgeAt < BRIDGE_FRESH_MS;

  const state = !engineFresh ? "down" : bridgeFresh ? "ok" : "warn";
  const label =
    state === "ok" ? "Bot Active" : state === "warn" ? "Engine OK · Bridge Offline" : "Inactive";

  const inBlockedHour = isBlockedHour(blocked, new Date(now));
  const resumesAt = String((new Date(now).getUTCHours() + 1) % 24).padStart(2, "0");

  return (
    <div className={cn("flex flex-col items-start gap-0.5", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em]",
          state === "ok" && "border-bull/40 bg-bull/10 text-bull",
          state === "warn" && "border-gold/40 bg-gold/10 text-gold",
          state === "down" && "border-bear/40 bg-bear/10 text-bear",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            state === "ok" && "bg-bull animate-pulse",
            state === "warn" && "bg-gold animate-pulse",
            state === "down" && "bg-bear",
          )}
        />
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground font-mono-tabular">
        Last scan: {ago(engineAt, now)} · Bridge: {ago(bridgeAt, now)}
      </span>
      {inBlockedHour && (
        <span className="text-[10px] text-muted-foreground">
          Scanning paused — blocked hour (resumes at {resumesAt}:00 UTC)
        </span>
      )}
    </div>
  );
}
