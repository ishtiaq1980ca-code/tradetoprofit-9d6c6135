import { AlertOctagon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCircuitBreaker } from "@/lib/circuitBreaker";
import { useBot } from "@/lib/tradingBot";

/** Unmissable red banner shown app-wide while the circuit breaker is tripped. */
export function CircuitBreakerBanner() {
  const breach = useCircuitBreaker((s) => s.breach);
  const enabled = useCircuitBreaker((s) => s.enabled);
  const reset = useCircuitBreaker((s) => s.reset);
  const pushLog = useBot((s) => s.pushLog);
  if (!enabled || !breach) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-40 border-b-2 border-bear bg-bear/20 px-4 py-3 backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-3">
        <AlertOctagon className="h-5 w-5 shrink-0 text-bear" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-bear">
            TRADING HALTED — {breach.type.toUpperCase()} LOSS LIMIT BREACHED
          </div>
          <div className="text-xs text-foreground/90">
            Loss {breach.lossPct.toFixed(2)}% (${Math.abs(breach.lossUsd).toFixed(2)}) vs limit {breach.limitPct}% ·
            triggered {new Date(breach.at).toLocaleString()} · new entries blocked, open positions untouched.
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            reset();
            pushLog({ t: Date.now(), level: "warn", msg: "Circuit breaker manually reset — new entries re-enabled" });
          }}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset & resume
        </Button>
      </div>
    </div>
  );
}
