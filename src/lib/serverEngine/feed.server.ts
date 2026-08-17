// Server-side price feed.
//
// This is the server twin of src/lib/priceFeed.ts. It uses the SAME anchoring
// sources (open.er-api.com for FX, api.gold-api.com for gold), the same
// synthetic-tick random walk between anchors and the same 1-minute candle
// aggregation — the only difference is that the candle history is persisted in
// `engine_candles` so it survives between scheduled invocations instead of
// living in a browser tab.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle } from "../indicators";
import { SYMBOLS } from "../format";
import { generateCandles } from "../mockFeed";

export const INTERVAL_MS = 60_000; // 1-minute candles
export const HISTORY = 500;
const SEED_BARS = 320;

/** Per-tick volatility (price units) — mirrors priceFeed.ts VOL. */
const VOL: Record<string, number> = {
  XAUUSD: 0.35,
  EURUSD: 0.00012, GBPUSD: 0.00016, USDJPY: 0.022, AUDUSD: 0.00013,
  USDCAD: 0.00014, USDCHF: 0.00012, NZDUSD: 0.00012,
  EURJPY: 0.025, GBPJPY: 0.030, AUDJPY: 0.026, NZDJPY: 0.024, CADJPY: 0.025, CHFJPY: 0.028,
  EURGBP: 0.00010, EURAUD: 0.00018, EURCAD: 0.00018, EURCHF: 0.00012, EURNZD: 0.00020,
  GBPAUD: 0.00022, GBPCAD: 0.00022, GBPCHF: 0.00016, GBPNZD: 0.00024,
  AUDCAD: 0.00014, AUDCHF: 0.00012, AUDNZD: 0.00016,
  NZDCAD: 0.00014, NZDCHF: 0.00012, CADCHF: 0.00012,
};

export type ServerFeedState = {
  prices: Record<string, number>;
  candles: Record<string, Candle[]>;
  /** Last time a real (broker-aligned) anchor was applied, per symbol. */
  anchoredAt: Record<string, number>;
  /** Symbols whose synthetic history has already been rebuilt around a live spot. */
  reseeded: Set<string>;
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

/** Load the persisted candle history; seed anything missing/stale. */
export async function loadFeed(admin: SupabaseClient<any>): Promise<ServerFeedState> {
  const state: ServerFeedState = { prices: {}, candles: {}, anchoredAt: {}, reseeded: new Set() };
  const { data } = await admin
    .from("engine_candles")
    .select("symbol,candles,updated_at");

  const stored = new Map<string, { candles: Candle[]; updatedAt: number }>();
  for (const row of (data ?? []) as Array<{ symbol: string; candles: unknown; updated_at: string }>) {
    stored.set(row.symbol, { candles: unpack(row.candles), updatedAt: Date.parse(row.updated_at) || 0 });
  }

  for (const sym of SYMBOLS) {
    const hit = stored.get(sym);
    let candles = hit?.candles ?? [];
    if (candles.length < 60) {
      candles = generateCandles(sym, SEED_BARS, INTERVAL_MS);
    } else {
      // Bridge any gap since the last run (engine paused / cold start) by
      // extending flat candles forward so indicator windows stay aligned.
      const last = candles[candles.length - 1];
      let t = last.time;
      const now = Date.now();
      let guard = 0;
      while (now - t >= INTERVAL_MS && guard++ < HISTORY) {
        t += INTERVAL_MS;
        candles.push({ time: t, open: last.close, high: last.close, low: last.close, close: last.close });
      }
      if (candles.length > HISTORY) candles = candles.slice(-HISTORY);
      state.reseeded.add(sym);
    }
    state.candles[sym] = candles;
    state.prices[sym] = candles[candles.length - 1]!.close;
  }
  return state;
}

export async function saveFeed(admin: SupabaseClient<any>, state: ServerFeedState): Promise<void> {
  const rows = SYMBOLS.map((sym) => ({
    symbol: sym,
    candles: pack((state.candles[sym] ?? []).slice(-HISTORY)) as unknown as object,
    updated_at: new Date().toISOString(),
  }));
  // Chunked so a single payload never gets oversized.
  for (let i = 0; i < rows.length; i += 10) {
    await admin.from("engine_candles").upsert(rows.slice(i, i + 10), { onConflict: "symbol" });
  }
}

/** Fetch the public FX + gold anchors (same endpoints as the browser feed). */
export async function fetchAnchors(): Promise<{ rates: Record<string, number> | null; xau: number | null }> {
  let rates: Record<string, number> | null = null;
  let xau: number | null = null;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" as RequestCache });
    if (r.ok) {
      const j: any = await r.json();
      if (j?.rates) rates = j.rates;
    }
  } catch { /* offline */ }
  try {
    const r = await fetch("https://api.gold-api.com/price/XAU", { cache: "no-store" as RequestCache });
    if (r.ok) {
      const j: any = await r.json();
      if (j?.price) xau = Number(j.price);
    }
  } catch { /* offline */ }
  return { rates, xau };
}

function blend(state: ServerFeedState, sym: string, target: number): boolean {
  const prev = state.prices[sym];
  if (!prev || !Number.isFinite(target) || target <= 0) return false;
  const drift = Math.abs(target - prev) / prev;
  if (!state.reseeded.has(sym) || drift > 0.015) {
    state.reseeded.add(sym);
    const candles = state.candles[sym] ?? [];
    const v = VOL[sym] ?? target * 0.0002;
    let p = target;
    const out: Candle[] = [];
    for (let i = candles.length - 1; i >= 0; i--) {
      const close = p;
      const open = close + (Math.random() - 0.5) * v * 2;
      const high = Math.max(open, close) + Math.random() * v;
      const low = Math.min(open, close) - Math.random() * v;
      out.unshift({ time: candles[i]!.time, open, high, low, close });
      p = open;
    }
    state.candles[sym] = out;
    state.prices[sym] = target;
    return true;
  }
  const next = prev * 0.4 + target * 0.6;
  state.prices[sym] = next;
  const last = state.candles[sym]?.[state.candles[sym]!.length - 1];
  if (last) {
    last.close = next;
    if (next > last.high) last.high = next;
    if (next < last.low) last.low = next;
  }
  return true;
}

export function applyAnchors(
  state: ServerFeedState,
  data: { rates?: Record<string, number> | null; xau?: number | null },
): number {
  let liveCount = 0;
  const at = Date.now();
  const mark = (sym: string, target: number | null | undefined) => {
    if (target == null) return;
    if (blend(state, sym, target)) {
      state.anchoredAt[sym] = at;
      liveCount += 1;
    }
  };
  const rates = data?.rates;
  if (rates) {
    const usdPer = (ccy: string) => {
      if (ccy === "USD") return 1;
      const rate = Number(rates[ccy]);
      return Number.isFinite(rate) && rate > 0 ? 1 / rate : null;
    };
    for (const sym of SYMBOLS) {
      if (sym === "XAUUSD" || sym.length !== 6) continue;
      const base = usdPer(sym.slice(0, 3));
      const quote = usdPer(sym.slice(3, 6));
      if (base && quote) mark(sym, base / quote);
    }
  }
  if (data?.xau != null && Number.isFinite(data.xau) && data.xau > 0) mark("XAUUSD", Number(data.xau));
  return liveCount;
}

/** One synthetic tick between anchors — identical walk to the browser feed. */
export function tick(state: ServerFeedState): void {
  const now = Date.now();
  for (const sym of SYMBOLS) {
    const price = state.prices[sym];
    if (!price) continue;
    const v = VOL[sym] ?? price * 0.0002;
    const next = Math.max(0.0001, price + (Math.random() - 0.5) * v * 2);
    state.prices[sym] = next;
    const candles = state.candles[sym];
    if (!candles?.length) continue;
    const last = candles[candles.length - 1]!;
    if (now - last.time >= INTERVAL_MS) {
      candles.push({ time: last.time + INTERVAL_MS, open: last.close, high: next, low: next, close: next });
      if (candles.length > HISTORY) candles.shift();
    } else {
      last.close = next;
      if (next > last.high) last.high = next;
      if (next < last.low) last.low = next;
    }
  }
}

export function hasLiveAnchor(state: ServerFeedState, symbol: string, maxAgeMs = 120_000): boolean {
  const at = state.anchoredAt[symbol] ?? 0;
  return at > 0 && Date.now() - at < maxAgeMs;
}
