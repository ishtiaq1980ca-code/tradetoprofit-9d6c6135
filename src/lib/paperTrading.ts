// Virtual trading account. Persists to localStorage. Reacts to every tick
// from priceFeed to check SL/TP, move stop to break-even, partial-close at
// 1R, and trail the stop after break-even has triggered.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Position = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  lot: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  confidence?: number;
  reason?: string;
  session?: string;
  breakEvenTriggered?: boolean;
  partialTaken?: boolean;
};


export type ClosedTrade = Position & {
  closedAt: number;
  exit: number;
  profit: number;
  closeReason: string;
};

type Store = {
  balance: number;
  startingBalance: number;
  positions: Position[];
  history: ClosedTrade[];
  trailTriggerUsd: number;
  trailStepUsd: number;
  useUsdTrail: boolean;
  setTrailTriggerUsd: (n: number) => void;
  setTrailStepUsd: (n: number) => void;
  setUseUsdTrail: (v: boolean) => void;
  open: (p: Omit<Position, "id" | "openedAt">) => Position | null;
  close: (id: string, price: number, reason?: string) => void;
  reset: (balance?: number) => void;
  tickAll: (prices: Record<string, number>) => void;
};

export function valuePerUnit(symbol: string) {
  if (symbol === "XAUUSD") return 100; // $100 per $1 move per 1.0 lot (100 oz)
  if (symbol.endsWith("JPY")) return 1000;
  return 100_000;
}

export function pnlOf(p: Pick<Position, "symbol" | "side" | "lot" | "entry">, price: number) {
  const dir = p.side === "BUY" ? 1 : -1;
  return (price - p.entry) * dir * p.lot * valuePerUnit(p.symbol);
}

export function floatingPnl(positions: Position[], prices: Record<string, number>) {
  let pnl = 0;
  for (const p of positions) {
    const px = prices[p.symbol];
    if (px) pnl += pnlOf(p, px);
  }
  return pnl;
}

const STARTING = 10_000;

export const useAccount = create<Store>()(
  persist(
    (set, get) => ({
      balance: STARTING,
      startingBalance: STARTING,
      positions: [],
      history: [],
      trailTriggerUsd: 3,
      trailStepUsd: 1,
      useUsdTrail: true,
      setTrailTriggerUsd: (n) => set({ trailTriggerUsd: Math.max(0.1, n) }),
      setTrailStepUsd: (n) => set({ trailStepUsd: Math.max(0.1, n) }),
      setUseUsdTrail: (v) => set({ useUsdTrail: v }),


      open: (p) => {
        if (p.lot <= 0) return null;
        const pos: Position = {
          ...p,
          id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
          openedAt: Date.now(),
        };
        set({ positions: [...get().positions, pos] });
        return pos;
      },

      close: (id, price, reason = "manual close") => {
        const s = get();
        const pos = s.positions.find((p) => p.id === id);
        if (!pos) return;
        const profit = pnlOf(pos, price);
        const closed: ClosedTrade = { ...pos, closedAt: Date.now(), exit: price, profit, closeReason: reason };
        set({
          positions: s.positions.filter((p) => p.id !== id),
          history: [closed, ...s.history].slice(0, 500),
          balance: s.balance + profit,
        });
      },

      reset: (balance = STARTING) => set({ balance, startingBalance: balance, positions: [], history: [] }),

      tickAll: (prices) => {
        const s = get();
        if (!s.positions.length) return;
        let balance = s.balance;
        let touched = false;
        const remaining: Position[] = [];
        const newClosed: ClosedTrade[] = [];

        for (const p of s.positions) {
          const price = prices[p.symbol];
          if (!price) {
            remaining.push(p);
            continue;
          }
          const dir = p.side === "BUY" ? 1 : -1;
          const hitSL = dir === 1 ? price <= p.stopLoss : price >= p.stopLoss;
          const hitTP = dir === 1 ? price >= p.takeProfit : price <= p.takeProfit;
          if (hitSL || hitTP) {
            const exit = hitSL ? p.stopLoss : p.takeProfit;
            const profit = pnlOf(p, exit);
            balance += profit;
            newClosed.push({
              ...p,
              closedAt: Date.now(),
              exit,
              profit,
              closeReason: hitSL ? (p.breakEvenTriggered ? "trailing stop" : "stop loss") : "take profit",
            });
            touched = true;
            continue;
          }

          const r = Math.abs(p.entry - p.stopLoss);
          const moveInR = ((price - p.entry) * dir) / (r || 1);
          let updated: Position = { ...p };

          if (s.useUsdTrail) {
            // USD-based trailing: once floating profit ≥ trigger, lock SL so we
            // keep (profit − trailStep) USD of profit. SL ratchets, never widens.
            const profitUsd = pnlOf(p, price);
            if (profitUsd >= s.trailTriggerUsd) {
              const lockUsd = profitUsd - s.trailStepUsd;
              const vpu = valuePerUnit(p.symbol) * p.lot || 1;
              const priceMoveForLock = lockUsd / vpu;
              const candidateSl = dir === 1 ? p.entry + priceMoveForLock : p.entry - priceMoveForLock;
              const better = dir === 1 ? candidateSl > updated.stopLoss : candidateSl < updated.stopLoss;
              if (better) {
                updated.stopLoss = candidateSl;
                updated.breakEvenTriggered = true;
                touched = true;
              }
            }
          } else {
            // Legacy R-based: partial @1R, BE @0.5R, trail 1R behind.
            if (!p.partialTaken && moveInR >= 1) {
              const halfLot = Math.max(0.01, Math.round((p.lot / 2) * 100) / 100);
              if (halfLot < p.lot) {
                const profit = pnlOf({ ...p, lot: halfLot }, price);
                balance += profit;
                newClosed.push({ ...p, lot: halfLot, closedAt: Date.now(), exit: price, profit, closeReason: "partial @1R" });
                updated.lot = Math.round((p.lot - halfLot) * 100) / 100;
                updated.partialTaken = true;
                touched = true;
              }
            }
            if (!updated.breakEvenTriggered && moveInR >= 0.5) {
              updated.stopLoss = p.entry; updated.breakEvenTriggered = true; touched = true;
            }
            if (updated.breakEvenTriggered) {
              const trail = r;
              if (dir === 1) {
                const sl = price - trail;
                if (sl > updated.stopLoss) { updated.stopLoss = sl; touched = true; }
              } else {
                const sl = price + trail;
                if (sl < updated.stopLoss) { updated.stopLoss = sl; touched = true; }
              }
            }
          }

          remaining.push(updated);
        }

        if (touched) {
          set({
            positions: remaining,
            history: newClosed.length ? [...newClosed, ...s.history].slice(0, 500) : s.history,
            balance,
          });
        }
      },
    }),
    {
      name: "aurum-paper-account-v1",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : (undefined as any))),
    },
  ),
);
