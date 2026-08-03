// PHASE 10 §9 — Trade Quality Score (0–100).
//
// Eight independent components, 12.5 points each. A trade may only be sent to
// MT5 when the final score is >= MIN_TRADE_SCORE (90).

import { type Candle } from "./indicators";
import { activeSessions } from "./sessions";
import { htfTrend } from "./entryGate";
import type { PairProfile } from "./pairProfiles";

// Gate for sending a trade to MT5. Phase 10 shipped this at 90, which — on top
// of the 13 mandatory strict-gate confirmations — proved mathematically
// unreachable in live conditions (zero signals for 3 days). 82 keeps the filter
// institutional-grade while remaining attainable for a genuinely aligned setup.
export const MIN_TRADE_SCORE = 82;

export type ScoreComponents = {
  trend: number;
  momentum: number;
  volume: number;
  structure: number;
  volatility: number;
  session: number;
  news: number;
  liquidity: number;
  total: number;
};

export type ScoreInput = {
  side: "BUY" | "SELL";
  price: number;
  profile: PairProfile;
  candles: Candle[];
  ema50: number;
  ema200: number;
  rsi: number;
  macdHist: number;
  macdPrev: number;
  adx: number;
  atr: number;
  spreadPct: number;
  structurePass: boolean;
  newsClear: boolean;
};

const MAX = 12.5;

export function computeTradeScore(inp: ScoreInput): { score: ScoreComponents; notes: string[] } {
  const buy = inp.side === "BUY";
  const notes: string[] = [];

  // 1. Trend — EMA separation, scaled by ATR.
  const sep = Math.abs(inp.ema50 - inp.ema200) / Math.max(inp.atr, 1e-9);
  const aligned = buy ? inp.ema50 > inp.ema200 : inp.ema50 < inp.ema200;
  const trend = aligned ? Math.min(MAX, 8 + sep * 6) : 0;
  notes.push(`Trend ${trend.toFixed(1)}/12.5 — EMA gap ${sep.toFixed(2)}×ATR`);

  // 2. Momentum — MACD expansion + RSI positioning.
  const macdOk = buy ? inp.macdHist > 0 : inp.macdHist < 0;
  const macdExpanding = buy ? inp.macdHist >= inp.macdPrev : inp.macdHist <= inp.macdPrev;
  const rsiOk = buy ? inp.rsi >= 50 : inp.rsi <= 50;
  const momentum = (macdOk ? 6 : 0) + (macdExpanding ? 3.5 : 0) + (rsiOk ? 3 : 0);
  notes.push(`Momentum ${momentum.toFixed(1)}/12.5 — MACD ${inp.macdHist.toFixed(5)}, RSI ${inp.rsi.toFixed(1)}`);

  // 3. Volume — last 5 bars vs 20-bar average (falls back to full credit when
  //    the feed supplies no volume).
  const vols = inp.candles.slice(-25).map((c) => c.volume ?? 0);
  const hasVol = vols.some((v) => v > 0);
  let volume = MAX;
  if (hasVol) {
    const recent = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const base = vols.reduce((a, b) => a + b, 0) / vols.length || 1;
    const ratio = recent / base;
    volume = Math.max(0, Math.min(MAX, 6 + ratio * 7));
    notes.push(`Volume ${volume.toFixed(1)}/12.5 — recent ${ratio.toFixed(2)}× average`);
  } else {
    notes.push(`Volume ${volume.toFixed(1)}/12.5 — no volume feed (neutral credit)`);
  }

  // 4. Structure — market structure guard + H1 agreement.
  const htf = htfTrend(inp.candles);
  const htfOk = buy ? htf.dir === "up" : htf.dir === "down";
  const structure = (inp.structurePass ? 6.5 : 0) + (htfOk ? 6 : 0);
  notes.push(`Structure ${structure.toFixed(1)}/12.5 — guard ${inp.structurePass ? "pass" : "fail"}, H1 ${htf.dir}`);

  // 5. Volatility — ATR inside the pair's healthy band.
  const atrPct = inp.price > 0 ? (inp.atr / inp.price) * 100 : 0;
  let volatility = 0;
  if (atrPct >= inp.profile.minAtrPct && atrPct <= inp.profile.maxAtrPct) volatility = MAX;
  else if (atrPct > 0 && atrPct <= inp.profile.maxAtrPct * 1.3) volatility = 6;
  notes.push(`Volatility ${volatility.toFixed(1)}/12.5 — ATR ${atrPct.toFixed(3)}%`);

  // 6. Session — London / New York get full credit.
  const sess = activeSessions();
  const prime = sess.active.includes("London") || sess.active.includes("New York");
  const overlap = sess.active.includes("London") && sess.active.includes("New York");
  const session = sess.weekend ? 0 : overlap ? MAX : prime ? 11 : 6;
  notes.push(`Session ${session.toFixed(1)}/12.5 — ${sess.primary}`);

  // 7. News — clear window required.
  const news = inp.newsClear ? MAX : 0;
  notes.push(`News ${news.toFixed(1)}/12.5 — ${inp.newsClear ? "clear" : "blackout"}`);

  // 8. Liquidity — spread cost relative to the pair's allowed maximum.
  const cap = Math.max(1e-9, inp.profile.maxSpreadPct);
  const liquidity = Math.max(0, Math.min(MAX, MAX * (1 - inp.spreadPct / cap)));
  notes.push(`Liquidity ${liquidity.toFixed(1)}/12.5 — spread ${inp.spreadPct.toFixed(3)}% of ${cap}% cap`);

  const total = trend + momentum + volume + structure + volatility + session + news + liquidity;
  return {
    score: {
      trend: +trend.toFixed(1),
      momentum: +momentum.toFixed(1),
      volume: +volume.toFixed(1),
      structure: +structure.toFixed(1),
      volatility: +volatility.toFixed(1),
      session: +session.toFixed(1),
      news: +news.toFixed(1),
      liquidity: +liquidity.toFixed(1),
      total: Math.round(total),
    },
    notes,
  };
}
