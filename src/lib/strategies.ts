// Admin-managed custom strategies. Loaded from `public.strategies`, cached
// in a Zustand store, and consumed by the bot scanner. Each strategy is a
// full override of StrategyParams scoped to a symbol (null = all pairs).

import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_PARAMS, type StrategyParams } from "./strategy";

export type CustomStrategy = {
  id: string;
  name: string;
  symbol: string | null;
  enabled: boolean;
  min_confidence: number;
  params: Partial<StrategyParams>;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type Store = {
  list: CustomStrategy[];
  lastFetch: number;
  loading: boolean;
  fetch: (force?: boolean) => Promise<void>;
  upsert: (s: Partial<CustomStrategy> & { name: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
};

export const useStrategies = create<Store>((set, get) => ({
  list: [],
  lastFetch: 0,
  loading: false,
  fetch: async (force = false) => {
    if (!force && Date.now() - get().lastFetch < 20_000) return;
    set({ loading: true });
    const { data, error } = await supabase
      .from("strategies")
      .select("*")
      .order("created_at", { ascending: false });
    set({ loading: false, lastFetch: Date.now() });
    if (!error && data) set({ list: data as any });
  },
  upsert: async (s) => {
    if (s.id) {
      const { error } = await supabase.from("strategies").update({
        name: s.name,
        symbol: s.symbol ?? null,
        enabled: s.enabled ?? true,
        min_confidence: s.min_confidence ?? 40,
        params: s.params ?? {},
        notes: s.notes ?? null,
      }).eq("id", s.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("strategies").insert({
        name: s.name,
        symbol: s.symbol ?? null,
        enabled: s.enabled ?? true,
        min_confidence: s.min_confidence ?? 40,
        params: s.params ?? {},
        notes: s.notes ?? null,
      });
      if (error) throw error;
    }
    await get().fetch(true);
  },
  remove: async (id) => {
    const { error } = await supabase.from("strategies").delete().eq("id", id);
    if (error) throw error;
    await get().fetch(true);
  },
  toggle: async (id, enabled) => {
    const { error } = await supabase.from("strategies").update({ enabled }).eq("id", id);
    if (error) throw error;
    await get().fetch(true);
  },
}));

/** Resolve the active strategies for a symbol. Returns full StrategyParams
 *  by merging the stored partial params on top of DEFAULT_PARAMS. */
export function strategiesForSymbol(
  symbol: string,
  list: CustomStrategy[],
): Array<{ id: string; name: string; params: StrategyParams }> {
  return list
    .filter((s) => s.enabled && (s.symbol === null || s.symbol === symbol))
    .map((s) => ({
      id: s.id,
      name: s.name,
      params: {
        ...DEFAULT_PARAMS,
        ...s.params,
        minConfidence: s.min_confidence ?? s.params.minConfidence ?? DEFAULT_PARAMS.minConfidence,
      },
    }));
}
