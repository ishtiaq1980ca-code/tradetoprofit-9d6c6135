// Full trade-decision log. Every signal-generator evaluation — accepted or
// rejected — is recorded here so the user can audit exactly what the bot saw
// and why it acted (or did not).

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type DecisionStatus = "executed" | "rejected" | "blocked" | "duplicate";

export type DecisionRecord = {
  id: string;
  at: number;
  symbol: string;
  direction: "BUY" | "SELL" | "FLAT";
  strategy: string;                    // pair profile label
  confidence: number;
  status: DecisionStatus;
  reason: string;                       // multi-line summary
  indicators: Record<string, number>;   // EMA50/100/200, RSI, MACD, ADX, ATR, BB, Stoch...
  filters: Array<{ name: string; pass: boolean; reason: string }>;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  lot?: number;
  riskPct?: number;
  riskReward?: number;
};

type Store = {
  records: DecisionRecord[];
  record: (r: Omit<DecisionRecord, "id" | "at"> & { at?: number }) => DecisionRecord;
  clear: () => void;
};

export const useDecisionLog = create<Store>()(
  persist(
    (set, get) => ({
      records: [],
      record: (r) => {
        const rec: DecisionRecord = {
          id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          at: r.at ?? Date.now(),
          ...r,
        };
        set({ records: [rec, ...get().records].slice(0, 500) });
        return rec;
      },
      clear: () => set({ records: [] }),
    }),
    {
      name: "aurum-decision-log-v1",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : (undefined as any))),
    },
  ),
);
