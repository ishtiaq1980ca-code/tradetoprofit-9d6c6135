// Circuit breaker / emergency stop.
//
// Trips when the daily, weekly or monthly loss limit is breached. Tripping:
//   (a) blocks NEW entries in the scan loop,
//   (b) surfaces a red banner in the UI,
//   (c) writes a critical entry to the bot log,
//   (d) fires an optional webhook (Telegram/Slack/Discord/custom) notification.
//
// It NEVER force-closes open positions. Existing trades keep running under the
// bridge's own SL/TP/trailing rules unless the user opts in explicitly.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type BreachType = "daily" | "weekly" | "monthly";

export type Breach = {
  type: BreachType;
  limitPct: number;
  lossPct: number;
  lossUsd: number;
  baseline: number;
  at: number;
  message: string;
};

type Store = {
  /** Master switch for the circuit breaker. */
  enabled: boolean;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxMonthlyLossPct: number;
  /** Opt-in: also close open positions when tripped (default OFF). */
  closePositionsOnTrip: boolean;
  webhookEnabled: boolean;
  webhookUrl: string;
  lastWebhookError: string | null;
  breach: Breach | null;

  setEnabled: (v: boolean) => void;
  setLimit: (k: BreachType, n: number) => void;
  setClosePositionsOnTrip: (v: boolean) => void;
  setWebhookEnabled: (v: boolean) => void;
  setWebhookUrl: (u: string) => void;
  trip: (b: Breach) => void;
  reset: () => void;
};

export const useCircuitBreaker = create<Store>()(
  persist(
    (set, get) => ({
      enabled: true,
      maxDailyLossPct: 3,
      maxWeeklyLossPct: 8,
      maxMonthlyLossPct: 12,
      closePositionsOnTrip: false,
      webhookEnabled: false,
      webhookUrl: "",
      lastWebhookError: null,
      breach: null,

      setEnabled: (v) => set({ enabled: v }),
      setLimit: (k, n) => {
        const v = Math.max(0.1, Math.min(100, n));
        if (k === "daily") set({ maxDailyLossPct: v });
        else if (k === "weekly") set({ maxWeeklyLossPct: v });
        else set({ maxMonthlyLossPct: v });
      },
      setClosePositionsOnTrip: (v) => set({ closePositionsOnTrip: v }),
      setWebhookEnabled: (v) => set({ webhookEnabled: v }),
      setWebhookUrl: (u) => set({ webhookUrl: u.trim() }),
      trip: (b) => { if (!get().breach) set({ breach: b }); },
      reset: () => set({ breach: null }),
    }),
    {
      name: "aurum-circuit-breaker-v1",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : (undefined as any))),
      partialize: (s) => ({
        enabled: s.enabled,
        maxDailyLossPct: s.maxDailyLossPct,
        maxWeeklyLossPct: s.maxWeeklyLossPct,
        maxMonthlyLossPct: s.maxMonthlyLossPct,
        closePositionsOnTrip: s.closePositionsOnTrip,
        webhookEnabled: s.webhookEnabled,
        webhookUrl: s.webhookUrl,
        breach: s.breach,
      }),
    },
  ),
);

export type PnlWindows = {
  daily: number;
  weekly: number;
  monthly: number;
  /** Account size the percentages are measured against. */
  baseline: number;
};

const LABEL: Record<BreachType, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

/** Pure check: returns the first breached window, or null. */
export function detectBreach(p: PnlWindows): Breach | null {
  const st = useCircuitBreaker.getState();
  if (!st.enabled) return null;
  if (!isFinite(p.baseline) || p.baseline <= 0) return null;

  const checks: Array<{ type: BreachType; pnl: number; limit: number }> = [
    { type: "daily", pnl: p.daily, limit: st.maxDailyLossPct },
    { type: "weekly", pnl: p.weekly, limit: st.maxWeeklyLossPct },
    { type: "monthly", pnl: p.monthly, limit: st.maxMonthlyLossPct },
  ];

  for (const c of checks) {
    if (!isFinite(c.pnl) || c.pnl >= 0) continue;
    const lossPct = (Math.abs(c.pnl) / p.baseline) * 100;
    if (lossPct >= c.limit) {
      return {
        type: c.type,
        limitPct: c.limit,
        lossPct,
        lossUsd: c.pnl,
        baseline: p.baseline,
        at: Date.now(),
        message: `${LABEL[c.type]} loss limit breached: -${lossPct.toFixed(2)}% (limit ${c.limit}%) — $${Math.abs(c.pnl).toFixed(2)} on a $${p.baseline.toFixed(2)} account. New entries blocked.`,
      };
    }
  }
  return null;
}

/** Send the outbound alert. Supports Slack/Discord/Telegram-style webhooks and
 *  falls back to a generic JSON payload. Failures are non-fatal. */
export async function sendBreachWebhook(b: Breach): Promise<void> {
  const st = useCircuitBreaker.getState();
  if (!st.webhookEnabled || !st.webhookUrl) return;
  const text = `🚨 AurumAI CIRCUIT BREAKER — ${b.message}`;
  try {
    const url = st.webhookUrl;
    let body: Record<string, unknown> = { text, content: text, event: "circuit_breaker", breach: b };
    if (/api\.telegram\.org/.test(url)) {
      // Telegram sendMessage URLs must already carry chat_id in the query string.
      body = { text };
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
    useCircuitBreaker.setState({ lastWebhookError: null });
  } catch (e: any) {
    useCircuitBreaker.setState({ lastWebhookError: e?.message ?? "webhook failed" });
  }
}

/** True when new entries must be blocked. */
export function circuitOpen(): boolean {
  const st = useCircuitBreaker.getState();
  return st.enabled && st.breach != null;
}
