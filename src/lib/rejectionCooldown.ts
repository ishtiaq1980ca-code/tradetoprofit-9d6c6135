// Rejection cooldown — stops the strategy from re-proposing the exact same
// symbol+direction setup every scan cycle.
//
// Problem this solves: the signals table showed e.g. AUDCAD SELL proposed and
// rejected 4× inside one minute. Nothing about the market changed between those
// evaluations, so the work (and the log noise) was pure waste.
//
// Behaviour: when a setup is rejected for a reason that will not change within
// seconds (duplicate position, correlation cap, tier cap, execution reject,
// entry-gate failure...), that symbol+direction is parked for a cooldown window.
// While parked the generator is not run for that direction at all.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Side = "BUY" | "SELL";

/** How long each class of rejection parks a symbol+direction. */
export const COOLDOWN_MS: Record<RejectionClass, number> = {
  duplicate: 5 * 60_000,        // a position is already on — nothing changes fast
  correlation: 5 * 60_000,      // correlated exposure stays until one closes
  tier_cap: 4 * 60_000,         // lot/tier budget exhausted
  exec_reject: 3 * 60_000,      // broker-side normalization refused the plan
  queue_failed: 60_000,         // transient — retry sooner
  gate: 3 * 60_000,             // entry-gate / quality-score failure
  confidence: 2 * 60_000,       // score just below the floor
  news: 10 * 60_000,            // news blackout windows are minutes long
  structure: 4 * 60_000,        // structure read will not flip in seconds
};

export type RejectionClass =
  | "duplicate"
  | "correlation"
  | "tier_cap"
  | "exec_reject"
  | "queue_failed"
  | "gate"
  | "confidence"
  | "news"
  | "structure";

export type CooldownEntry = {
  key: string;                 // `${symbol}:${side}`
  symbol: string;
  side: Side;
  cls: RejectionClass;
  reason: string;
  since: number;
  until: number;
  /** How many times this setup was rejected in a row. */
  streak: number;
};

type Store = {
  entries: Record<string, CooldownEntry>;
  note: (symbol: string, side: Side, cls: RejectionClass, reason: string) => CooldownEntry;
  clearFor: (symbol: string, side: Side) => void;
  clearAll: () => void;
};

const keyOf = (symbol: string, side: Side) => `${symbol}:${side}`;

export const useRejectionCooldown = create<Store>()(
  persist(
    (set, get) => ({
      entries: {},
      note: (symbol, side, cls, reason) => {
        const key = keyOf(symbol, side);
        const prev = get().entries[key];
        const now = Date.now();
        const streak = prev && now - prev.since < 60 * 60_000 ? prev.streak + 1 : 1;
        // Repeated identical rejections back off progressively (up to 4×) so a
        // permanently-blocked setup stops burning cycles entirely.
        const base = COOLDOWN_MS[cls];
        const backoff = Math.min(4, 1 + (streak - 1) * 0.5);
        const entry: CooldownEntry = {
          key, symbol, side, cls, reason,
          since: prev?.since ?? now,
          until: now + base * backoff,
          streak,
        };
        set({ entries: { ...get().entries, [key]: entry } });
        return entry;
      },
      clearFor: (symbol, side) => {
        const next = { ...get().entries };
        delete next[keyOf(symbol, side)];
        set({ entries: next });
      },
      clearAll: () => set({ entries: {} }),
    }),
    {
      name: "aurum-rejection-cooldown-v1",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : (undefined as any))),
    },
  ),
);

/** Active cooldown for this symbol+direction, or null. */
export function cooldownFor(symbol: string, side: Side): CooldownEntry | null {
  const e = useRejectionCooldown.getState().entries[keyOf(symbol, side)];
  if (!e) return null;
  return e.until > Date.now() ? e : null;
}

/** True when BOTH directions are parked — the symbol can be skipped entirely. */
export function symbolFullyCooling(symbol: string): boolean {
  return !!cooldownFor(symbol, "BUY") && !!cooldownFor(symbol, "SELL");
}

/** A successful entry clears the park for that direction. */
export function clearCooldown(symbol: string, side: Side) {
  useRejectionCooldown.getState().clearFor(symbol, side);
}

/** Map a free-text rejection reason onto a cooldown class. */
export function classifyRejection(reason: string | undefined): RejectionClass {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("duplicate")) return "duplicate";
  if (r.includes("correlat")) return "correlation";
  if (r.includes("tier")) return "tier_cap";
  if (r.includes("news") || r.includes("blackout")) return "news";
  if (r.includes("structure")) return "structure";
  if (r.startsWith("confidence") || r.includes("trade score")) return "confidence";
  if (r.includes("queue")) return "queue_failed";
  if (r.includes("exec") || r.includes("stop") || r.includes("spread")) return "exec_reject";
  return "gate";
}

/** Live list for the UI, newest expiry first, expired rows pruned. */
export function activeCooldowns(): CooldownEntry[] {
  const now = Date.now();
  return Object.values(useRejectionCooldown.getState().entries)
    .filter((e) => e.until > now)
    .sort((a, b) => b.until - a.until);
}

export function humanRemaining(until: number): string {
  const s = Math.max(0, Math.round((until - Date.now()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}
