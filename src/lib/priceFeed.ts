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

  private blend(sym: string, target: number) {
    const prev = this.state.prices[sym];
    if (!prev || !isFinite(target) || target <= 0) return;
    // 60% pull toward real spot, 40% preserve recent tick path for smoothness
    this.state.prices[sym] = prev * 0.4 + target * 0.6;
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
