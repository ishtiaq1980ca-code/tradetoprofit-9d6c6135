// Deterministic synthetic candle feed for UI, charts and backtesting until the
// MT5 bridge streams real data. Each symbol gets a stable seed so reloads stay
// consistent. Replace with real OHLC once the bridge is wired.

import type { Candle } from "./indicators";

const BASE: Record<string, { price: number; vol: number }> = {
  XAUUSD: { price: 2380, vol: 12 },
  EURUSD: { price: 1.085, vol: 0.0035 },
  GBPUSD: { price: 1.265, vol: 0.0045 },
  USDJPY: { price: 156.4, vol: 0.55 },
  AUDUSD: { price: 0.665, vol: 0.003 },
  USDCAD: { price: 1.368, vol: 0.003 },
  USDCHF: { price: 0.905, vol: 0.0028 },
  NZDUSD: { price: 0.612, vol: 0.0028 },
  EURJPY: { price: 169.8, vol: 0.6 },
  GBPJPY: { price: 197.6, vol: 0.75 },
};

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCandles(symbol: string, count = 300, intervalMs = 60_000 * 15): Candle[] {
  const cfg = BASE[symbol] ?? { price: 1, vol: 0.01 };
  const rand = mulberry32(symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
  const out: Candle[] = [];
  let price = cfg.price;
  const now = Date.now();
  let trend = 0;
  for (let i = 0; i < count; i++) {
    if (i % 25 === 0) trend = (rand() - 0.5) * cfg.vol * 0.4;
    const drift = trend + (rand() - 0.5) * cfg.vol * 0.6;
    const open = price;
    const close = Math.max(0.0001, open + drift);
    const high = Math.max(open, close) + rand() * cfg.vol * 0.4;
    const low = Math.min(open, close) - rand() * cfg.vol * 0.4;
    out.push({ time: now - (count - i) * intervalMs, open, high, low, close, volume: Math.floor(rand() * 1000) });
    price = close;
  }
  return out;
}

export function livePrice(symbol: string): number {
  const candles = generateCandles(symbol, 50);
  return candles[candles.length - 1].close;
}
