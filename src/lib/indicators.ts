// Technical indicators implemented from scratch (no external TA library).
// All functions take an array of closes (or OHLC) and return arrays aligned
// to the input length, with NaN for warm-up periods.

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume?: number };

export function sma(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      let s = 0;
      for (let j = 0; j < period; j++) s += values[j];
      prev = s / period;
      out[i] = prev;
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out = new Array(closes.length).fill(NaN);
  if (closes.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = 100 - 100 / (1 + (loss === 0 ? Infinity : gain / loss));
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    gain = (gain * (period - 1) + g) / period;
    loss = (loss * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + (loss === 0 ? Infinity : gain / loss));
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signalP = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const macdLine = closes.map((_, i) => (isNaN(ef[i]) || isNaN(es[i]) ? NaN : ef[i] - es[i]));
  const valid = macdLine.filter((x) => !isNaN(x));
  const signalValid = ema(valid, signalP);
  const offset = macdLine.length - valid.length;
  const signal = new Array(closes.length).fill(NaN);
  for (let i = 0; i < signalValid.length; i++) signal[i + offset] = signalValid[i];
  const hist = macdLine.map((v, i) => (isNaN(v) || isNaN(signal[i]) ? NaN : v - signal[i]));
  return { macd: macdLine, signal, hist };
}

export function atr(candles: Candle[], period = 14): number[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { tr.push(candles[i].high - candles[i].low); continue; }
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  // Wilder smoothing
  const out = new Array(candles.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < period && i < tr.length; i++) sum += tr[i];
  if (tr.length >= period) {
    out[period - 1] = sum / period;
    for (let i = period; i < tr.length; i++) {
      out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
    }
  }
  return out;
}

export function adx(candles: Candle[], period = 14): number[] {
  const len = candles.length;
  const plusDM: number[] = [0], minusDM: number[] = [0], tr: number[] = [0];
  for (let i = 1; i < len; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const smooth = (arr: number[]) => {
    const r = new Array(len).fill(NaN);
    let s = 0;
    for (let i = 1; i <= period && i < len; i++) s += arr[i];
    r[period] = s;
    for (let i = period + 1; i < len; i++) r[i] = r[i - 1] - r[i - 1] / period + arr[i];
    return r;
  };
  const trS = smooth(tr), pS = smooth(plusDM), mS = smooth(minusDM);
  const dx = new Array(len).fill(NaN);
  for (let i = period; i < len; i++) {
    const pdi = (pS[i] / trS[i]) * 100;
    const mdi = (mS[i] / trS[i]) * 100;
    dx[i] = (Math.abs(pdi - mdi) / (pdi + mdi || 1)) * 100;
  }
  // ADX is Wilder average of DX
  const out = new Array(len).fill(NaN);
  let firstIdx = -1;
  for (let i = 0; i < len; i++) if (!isNaN(dx[i])) { firstIdx = i; break; }
  if (firstIdx < 0) return out;
  let acc = 0, count = 0;
  for (let i = firstIdx; i < firstIdx + period && i < len; i++) { acc += dx[i]; count++; }
  if (count === period) {
    out[firstIdx + period - 1] = acc / period;
    for (let i = firstIdx + period; i < len; i++) out[i] = (out[i - 1] * (period - 1) + dx[i]) / period;
  }
  return out;
}

/** Detect simple swing-based support and resistance levels from recent candles. */
export function detectLevels(candles: Candle[], lookback = 50, swing = 5): { support: number[]; resistance: number[] } {
  const support: number[] = [], resistance: number[] = [];
  const start = Math.max(swing, candles.length - lookback);
  for (let i = start; i < candles.length - swing; i++) {
    let isLow = true, isHigh = true;
    for (let j = 1; j <= swing; j++) {
      if (candles[i - j].low < candles[i].low) isLow = false;
      if (candles[i + j].low < candles[i].low) isLow = false;
      if (candles[i - j].high > candles[i].high) isHigh = false;
      if (candles[i + j].high > candles[i].high) isHigh = false;
    }
    if (isLow) support.push(candles[i].low);
    if (isHigh) resistance.push(candles[i].high);
  }
  return { support: support.slice(-5), resistance: resistance.slice(-5) };
}

/** Bollinger Bands. Returns middle (SMA), upper, lower, and band width (%). */
export function bollinger(
  closes: number[],
  period = 20,
  stdMult = 2,
): { middle: number[]; upper: number[]; lower: number[]; width: number[] } {
  const middle = sma(closes, period);
  const upper = new Array(closes.length).fill(NaN);
  const lower = new Array(closes.length).fill(NaN);
  const width = new Array(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - middle[i];
      sum += d * d;
    }
    const sd = Math.sqrt(sum / period);
    upper[i] = middle[i] + stdMult * sd;
    lower[i] = middle[i] - stdMult * sd;
    width[i] = ((upper[i] - lower[i]) / middle[i]) * 100;
  }
  return { middle, upper, lower, width };
}

/** Stochastic oscillator (%K and %D). */
export function stochastic(
  candles: Candle[],
  kPeriod = 14,
  dPeriod = 3,
): { k: number[]; d: number[] } {
  const k = new Array(candles.length).fill(NaN);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    const range = hh - ll || 1e-9;
    k[i] = ((candles[i].close - ll) / range) * 100;
  }
  // %D = SMA of %K
  const validK: number[] = [];
  for (const v of k) if (!isNaN(v)) validK.push(v);
  const dValid = sma(validK, dPeriod);
  const offset = k.length - validK.length;
  const d = new Array(candles.length).fill(NaN);
  for (let i = 0; i < dValid.length; i++) d[i + offset] = dValid[i];
  return { k, d };
}
