// Real market data for the scheduled server engine.
//
// The scheduled engine previously ran on a synthetic random walk anchored to a
// once-per-day FX rate feed. That produced trendless price history: ADX sat at
// 7-16 for every symbol, so every candidate was rejected as "sideways" and no
// signal could ever be generated. This module replaces that with genuine
// M15 OHLC candles per symbol.
//
// Nothing about the MT5 path changes — this only supplies price history to the
// strategy.

import type { Candle } from "../indicators";

/** Chart-provider ticker for each engine symbol. */
export function providerSymbol(sym: string): string {
  if (sym === "XAUUSD") return "GC=F"; // gold futures — real intraday 1m data
  return `${sym}=X`;
}

const ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";
// The strategy's entry timeframe is M15 (its "H1" confirmation aggregates 4
// bars), so M15 is the correct base series.
const RANGE = "1mo";
const INTERVAL = "15m";
export const MAX_BARS = 500;

export type FetchResult = { symbol: string; candles: Candle[] | null; error?: string };

async function fetchOne(sym: string): Promise<FetchResult> {
  const url = `${ENDPOINT}/${encodeURIComponent(providerSymbol(sym))}?interval=${INTERVAL}&range=${RANGE}`;
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
    });
    if (!res.ok) return { symbol: sym, candles: null, error: `http ${res.status}` };
    const json: any = await res.json();
    const result = json?.chart?.result?.[0];
    const stamps: number[] | undefined = result?.timestamp;
    const q = result?.indicators?.quote?.[0];
    if (!Array.isArray(stamps) || !q) return { symbol: sym, candles: null, error: "no data" };

    const out: Candle[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const open = Number(q.open?.[i]);
      const high = Number(q.high?.[i]);
      const low = Number(q.low?.[i]);
      const close = Number(q.close?.[i]);
      if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue;
      out.push({
        time: stamps[i]! * 1000,
        open, high, low, close,
        volume: Number.isFinite(Number(q.volume?.[i])) ? Number(q.volume[i]) : undefined,
      });
    }
    if (out.length < 60) return { symbol: sym, candles: null, error: `only ${out.length} bars` };
    return { symbol: sym, candles: out.slice(-MAX_BARS) };
  } catch (e: any) {
    return { symbol: sym, candles: null, error: e?.message ?? "fetch failed" };
  }
}

/** Fetch real M15 candles for many symbols with bounded concurrency. */
export async function fetchMarketCandles(symbols: string[], concurrency = 8): Promise<FetchResult[]> {
  const results: FetchResult[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, symbols.length) }, async () => {
    while (cursor < symbols.length) {
      const sym = symbols[cursor++]!;
      results.push(await fetchOne(sym));
    }
  });
  await Promise.all(workers);
  return results;
}
