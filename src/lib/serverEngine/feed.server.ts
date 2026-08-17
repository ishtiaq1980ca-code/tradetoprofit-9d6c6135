// Server-side price feed for the scheduled engine.
//
// Source of truth is REAL 1-minute OHLC market data (see marketData.server.ts).
// `engine_candles` is used purely as a cache so a provider hiccup doesn't wipe
// the history, and so charts/diagnostics can read the last known series.
//
// Historical note: this used to be a synthetic random walk anchored to a
// once-daily FX rate feed. That history had no directional persistence, so ADX
// was permanently 7-16 and every candidate was rejected as "sideways market" —
// which is why zero signals were queued after the server-side port.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle } from "../indicators";
import { SYMBOLS } from "../format";
import { fetchMarketCandles, MAX_BARS } from "./marketData.server";

export const INTERVAL_MS = 15 * 60_000; // M15 candles
export const HISTORY = MAX_BARS;

export type ServerFeedState = {
  prices: Record<string, number>;
  candles: Record<string, Candle[]>;
  /** Last time real market data was applied, per symbol. */
  anchoredAt: Record<string, number>;
  /** Symbols whose data came from the live provider on this run. */
  live: Set<string>;
};

type CompactCandle = [number, number, number, number, number];

function pack(c: Candle[]): CompactCandle[] {
  return c.map((x) => [x.time, +x.open, +x.high, +x.low, +x.close] as CompactCandle);
}
function unpack(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  const out: Candle[] = [];
  for (const r of rows as CompactCandle[]) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const [time, open, high, low, close] = r;
    if (![time, open, high, low, close].every((n) => Number.isFinite(n))) continue;
    out.push({ time, open, high, low, close });
  }
  return out;
}

/** Load the cached candle history (no synthesis — real data is fetched next). */
export async function loadFeed(admin: SupabaseClient<any>): Promise<ServerFeedState> {
  const state: ServerFeedState = { prices: {}, candles: {}, anchoredAt: {}, live: new Set() };
  const { data } = await admin.from("engine_candles").select("symbol,candles");
  for (const row of (data ?? []) as Array<{ symbol: string; candles: unknown }>) {
    const candles = unpack(row.candles);
    if (!candles.length) continue;
    state.candles[row.symbol] = candles;
    state.prices[row.symbol] = candles[candles.length - 1]!.close;
  }
  return state;
}

export async function saveFeed(admin: SupabaseClient<any>, state: ServerFeedState): Promise<void> {
  const rows = SYMBOLS.filter((s) => state.candles[s]?.length).map((sym) => ({
    symbol: sym,
    candles: pack(state.candles[sym]!.slice(-HISTORY)) as unknown as object,
    updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 10) {
    await admin.from("engine_candles").upsert(rows.slice(i, i + 10), { onConflict: "symbol" });
  }
}

export type RefreshSummary = { live: number; failed: Array<{ symbol: string; error: string }> };

/** Pull real M15 candles for every symbol and apply them to the feed. */
export async function refreshMarketData(state: ServerFeedState): Promise<RefreshSummary> {
  const results = await fetchMarketCandles([...SYMBOLS]);
  const at = Date.now();
  const failed: Array<{ symbol: string; error: string }> = [];
  let live = 0;
  for (const r of results) {
    if (!r.candles?.length) {
      failed.push({ symbol: r.symbol, error: r.error ?? "unknown" });
      continue;
    }
    state.candles[r.symbol] = r.candles;
    state.prices[r.symbol] = r.candles[r.candles.length - 1]!.close;
    state.anchoredAt[r.symbol] = at;
    state.live.add(r.symbol);
    live++;
  }
  return { live, failed };
}

/**
 * A symbol is tradeable only when we applied fresh real data for it this run
 * AND the newest bar is recent enough that the market is genuinely moving.
 */
export function hasLiveAnchor(state: ServerFeedState, symbol: string, maxAgeMs = 60 * 60_000): boolean {
  const at = state.anchoredAt[symbol] ?? 0;
  if (!(at > 0 && Date.now() - at < 120_000)) return false;
  const candles = state.candles[symbol];
  const last = candles?.[candles.length - 1];
  if (!last) return false;
  return Date.now() - last.time < maxAgeMs;
}
