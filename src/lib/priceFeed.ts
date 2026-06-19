// Real-time price feed. Anchors to public FX/gold spot APIs every 30s and
// fills the gaps with realistic random-walk ticks so the UI feels live.
// Maintains 1-minute candle history per symbol for the strategy + charts.

import type { Candle } from "./indicators";
import { SYMBOLS } from "./format";
import { generateCandles } from "./mockFeed";

export type FeedState = {
  prices: Record<string, number>;
  candles: Record<string, Candle[]>;
  updatedAt: number;
  source: "live" | "simulated";
};

type Sub = (s: FeedState) => void;

const INTERVAL_MS = 60_000; // 1-minute candles
const TICK_MS = 1500;
const ANCHOR_MS = 30_000;

// Per-tick volatility (price-units) used between anchor fetches.
const VOL: Record<string, number> = {
  XAUUSD: 0.35,
  EURUSD: 0.00012,
  GBPUSD: 0.00016,
  USDJPY: 0.022,
  AUDUSD: 0.00013,
  USDCAD: 0.00014,
  USDCHF: 0.00012,
  NZDUSD: 0.00012,
  EURJPY: 0.025,
  GBPJPY: 0.030,
};

class PriceFeed {
  state: FeedState = { prices: {}, candles: {}, updatedAt: Date.now(), source: "simulated" };
  private subs = new Set<Sub>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private anchorTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    for (const s of SYMBOLS) {
      const c = generateCandles(s, 320, INTERVAL_MS);
      this.state.candles[s] = c;
      this.state.prices[s] = c[c.length - 1].close;
    }
    this.notify();
    this.anchor();
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.anchorTimer = setInterval(() => this.anchor(), ANCHOR_MS);
  }

  subscribe(fn: Sub) {
    this.subs.add(fn);
    fn(this.state);
    return () => {
      this.subs.delete(fn);
    };
  }

  private notify() {
    this.state = { ...this.state, updatedAt: Date.now() };
    this.subs.forEach((s) => s(this.state));
  }

  private tick() {
    const now = Date.now();
    for (const sym of SYMBOLS) {
      const price = this.state.prices[sym];
      if (!price) continue;
      const v = VOL[sym] ?? price * 0.0002;
      const next = Math.max(0.0001, price + (Math.random() - 0.5) * v * 2);
      this.state.prices[sym] = next;
      const candles = this.state.candles[sym];
      const last = candles[candles.length - 1];
      if (now - last.time >= INTERVAL_MS) {
        candles.push({ time: last.time + INTERVAL_MS, open: last.close, high: next, low: next, close: next });
        if (candles.length > 500) candles.shift();
      } else {
        last.close = next;
        if (next > last.high) last.high = next;
        if (next < last.low) last.low = next;
      }
    }
    this.notify();
  }

  private reseeded = new Set<string>();

  private blend(sym: string, target: number) {
    const prev = this.state.prices[sym];
    if (!prev || !isFinite(target) || target <= 0) return;
    // First time we see a real anchor for this symbol, rebuild the whole
    // candle history around the real spot so indicators (RSI/MACD/ATR) aren't
    // poisoned by the gap between synthetic seed price and reality.
    // Also reseed if the live spot is wildly different from our current price
    // (>1.5%), which would otherwise spike RSI to extremes.
    const drift = Math.abs(target - prev) / prev;
    if (!this.reseeded.has(sym) || drift > 0.015) {
      this.reseeded.add(sym);
      const candles = this.state.candles[sym];
      const v = VOL[sym] ?? target * 0.0002;
      let p = target;
      // Walk backward from target, producing a gentle mean-reverting series
      // so the most recent close sits exactly at the live spot.
      const out: Candle[] = [];
      for (let i = candles.length - 1; i >= 0; i--) {
        const close = p;
        const open = close + (Math.random() - 0.5) * v * 2;
        const high = Math.max(open, close) + Math.random() * v;
        const low = Math.min(open, close) - Math.random() * v;
        out.unshift({ time: candles[i].time, open, high, low, close });
        p = open;
      }
      this.state.candles[sym] = out;
      this.state.prices[sym] = target;
      return;
    }
    // 60% pull toward real spot, 40% preserve recent tick path for smoothness
    const next = prev * 0.4 + target * 0.6;
    this.state.prices[sym] = next;
    const candles = this.state.candles[sym];
    const last = candles[candles.length - 1];
    if (last) {
      last.close = next;
      if (next > last.high) last.high = next;
      if (next < last.low) last.low = next;
    }
  }

  private async anchor() {
    let liveCount = 0;
    try {
      const r = await fetch("https://open.er-api.com/v6/latest/USD");
      if (r.ok) {
        const j: any = await r.json();
        const rates = j?.rates;
        if (rates) {
          if (rates.EUR) this.blend("EURUSD", 1 / rates.EUR);
          if (rates.GBP) this.blend("GBPUSD", 1 / rates.GBP);
          if (rates.JPY) this.blend("USDJPY", rates.JPY);
          if (rates.AUD) this.blend("AUDUSD", 1 / rates.AUD);
          if (rates.CAD) this.blend("USDCAD", rates.CAD);
          if (rates.CHF) this.blend("USDCHF", rates.CHF);
          liveCount += 6;
        }
      }
    } catch {
      /* offline / CORS — keep simulating */
    }
    try {
      const r = await fetch("https://api.gold-api.com/price/XAU");
      if (r.ok) {
        const j: any = await r.json();
        if (j?.price) {
          this.blend("XAUUSD", Number(j.price));
          liveCount += 1;
        }
      }
    } catch {
      /* keep simulating gold */
    }
    this.state.source = liveCount > 0 ? "live" : "simulated";
    this.notify();
  }
}

export const priceFeed = new PriceFeed();
