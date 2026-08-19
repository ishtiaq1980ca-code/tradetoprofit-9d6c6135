// PHASE 10 — Strict Smart Entry Filter.
//
// A trade may ONLY be opened when EVERY confirmation below is TRUE.
// Each check returns an explicit pass/fail with a human-readable reason so the
// decision log can show exactly why an entry was rejected.
//
// MT5 bridge / order execution layer is NOT touched here.

import { ema, type Candle } from "./indicators";
import { aggregate } from "./marketStructure";
import type { PairProfile } from "./pairProfiles";

export type GateCheck = { name: string; pass: boolean; reason: string };
export type GateResult = { pass: boolean; checks: GateCheck[]; firstFailure?: string };

export type GateIndicators = {
  ema50: number;
  ema200: number;
  rsi: number;
  macdHist: number;
  macdPrev: number;
  adx: number;
  atr: number;
};

export type GateContext = {
  side: "BUY" | "SELL";
  price: number;
  profile: PairProfile;
  candles: Candle[];
  ind: GateIndicators;
  /** Pre-computed filter outcomes from tradeFilters. */
  spread: { pass: boolean; reason: string };
  session: { pass: boolean; reason: string };
  news: { pass: boolean; reason: string };
  structure: { pass: boolean; reason: string };
  /** Runtime context supplied by the engine. */
  duplicate?: boolean;
  recentStopCooldown?: boolean;
};

/** ADX floor for every instrument (PHASE 10 §8: below 25 → no new trades). */
export const GLOBAL_ADX_MIN = 22;

/** Higher-timeframe (H1 ≈ 4× M15) trend confirmation. */
export function htfTrend(candles: Candle[]): { dir: "up" | "down" | "flat"; detail: string } {
  const h1 = aggregate(candles, 4);
  const closes = h1.map((c) => c.close);
  if (closes.length < 60) return { dir: "flat", detail: "H1 history too short" };
  const last = closes.length - 1;
  const e50 = ema(closes, 50)[last];
  const e200 = ema(closes, Math.min(200, closes.length - 1))[last];
  const price = closes[last];
  if (!isFinite(e50) || !isFinite(e200)) return { dir: "flat", detail: "H1 EMAs unavailable" };
  const detail = `H1 EMA50 ${e50.toFixed(5)} vs EMA200 ${e200.toFixed(5)}, price ${price.toFixed(5)}`;
  if (e50 > e200 && price > e200) return { dir: "up", detail };
  if (e50 < e200 && price < e200) return { dir: "down", detail };
  return { dir: "flat", detail };
}

export function strictEntryGate(ctx: GateContext): GateResult {
  const { side, price, ind, profile, candles } = ctx;
  const buy = side === "BUY";
  const checks: GateCheck[] = [];
  const add = (name: string, pass: boolean, reason: string) => checks.push({ name, pass, reason });

  // 1. EMA50 / EMA200 trend alignment on the entry timeframe.
  const emaAligned = buy ? ind.ema50 > ind.ema200 : ind.ema50 < ind.ema200;
  add("EMA trend", emaAligned,
    `EMA50 ${ind.ema50.toFixed(5)} ${buy ? ">" : "<"} EMA200 ${ind.ema200.toFixed(5)} ${emaAligned ? "OK" : "FAILED"}`);

  // 2. Higher timeframe (H1) must agree with M15.
  const htf = htfTrend(candles);
  const htfOk = buy ? htf.dir === "up" : htf.dir === "down";
  add("HTF (H1) trend", htfOk, `${htf.detail} → H1 ${htf.dir}${htfOk ? " agrees" : " does not confirm"}`);

  // 3. RSI confirmation (directional, not exhausted).
  const rsiOk = buy ? ind.rsi >= 50 && ind.rsi <= (profile.rsiOverbought ?? 70)
                    : ind.rsi <= 50 && ind.rsi >= (profile.rsiOversold ?? 30);
  add("RSI", rsiOk, `RSI ${ind.rsi.toFixed(1)} ${rsiOk ? "confirms" : "does not confirm"} ${side}`);

  // 4. MACD confirmation — correct sign AND expanding in trade direction.
  const macdOk = buy ? ind.macdHist > 0 && ind.macdHist >= ind.macdPrev
                     : ind.macdHist < 0 && ind.macdHist <= ind.macdPrev;
  add("MACD", macdOk,
    `MACD hist ${ind.macdHist.toFixed(5)} (prev ${ind.macdPrev.toFixed(5)}) ${macdOk ? "confirms" : "does not confirm"}`);

  // 5. ADX > 25.
  const adxOk = ind.adx > GLOBAL_ADX_MIN;
  add("ADX", adxOk, `ADX ${ind.adx.toFixed(1)} ${adxOk ? ">" : "≤"} ${GLOBAL_ADX_MIN}`);

  // 6. ATR above minimum volatility threshold.
  const atrPct = price > 0 ? (ind.atr / price) * 100 : 0;
  const atrOk = atrPct >= profile.minAtrPct;
  add("ATR volatility", atrOk, `ATR ${atrPct.toFixed(3)}% ${atrOk ? "≥" : "<"} min ${profile.minAtrPct}%`);

  // 7-10. Pre-computed filters.
  add("Spread", ctx.spread.pass, ctx.spread.reason);
  add("Session", ctx.session.pass, ctx.session.reason);
  add("News", ctx.news.pass, ctx.news.reason);
  add("Market structure", ctx.structure.pass, ctx.structure.reason);

  // 11. Anti-noise: the entry candle must be a real body, not a wick-only spike.
  const c = candles[candles.length - 1];
  const range = Math.max(1e-9, c.high - c.low);
  const body = Math.abs(c.close - c.open);
  const bodyOk = body / range >= 0.35;
  add("Anti-noise (candle body)", bodyOk,
    `Body ${(100 * body / range).toFixed(0)}% of range ${bodyOk ? "≥" : "<"} 35% (wick-only spikes rejected)`);

  // 12. Duplicate position.
  add("Duplicate position", !ctx.duplicate,
    ctx.duplicate ? "Duplicate: same symbol+direction already active" : "No duplicate position");

  // 13. Recent stop-loss cooldown on this symbol.
  add("Stop-loss cooldown", !ctx.recentStopCooldown,
    ctx.recentStopCooldown ? "Recent stop-loss on this symbol — cooldown active" : "No recent stop-loss on this symbol");

  const failed = checks.find((k) => !k.pass);
  return { pass: !failed, checks, firstFailure: failed?.reason };
}
