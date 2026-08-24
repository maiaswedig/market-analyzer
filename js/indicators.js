// indicators.js — funções técnicas puras, sem estado
export function sma(arr, p) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= p) sum -= arr[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}
export function ema(arr, p) {
  const out = new Array(arr.length).fill(null);
  const k = 2 / (p + 1);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) { out[i] = prev; continue; }
    prev = prev == null ? arr[i] : arr[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}
export function rsi(closes, p = 14) {
  const out = new Array(closes.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = Math.max(0, diff), l = Math.max(0, -diff);
    if (i <= p) { gain += g; loss += l; if (i === p) { const rs = loss === 0 ? 100 : gain / loss; out[i] = 100 - 100 / (1 + rs); } }
    else {
      gain = (gain * (p - 1) + g) / p;
      loss = (loss * (p - 1) + l) / p;
      const rs = loss === 0 ? 100 : gain / loss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}
export function macd(closes, fast = 12, slow = 26, signalP = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null) ? ef[i] - es[i] : null);
  const signal = ema(line.map(v => v == null ? 0 : v), signalP);
  const hist = line.map((v, i) => (v != null && signal[i] != null) ? v - signal[i] : null);
  return { line, signal, hist };
}
export function atr(candles, p = 14) {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prevClose = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
  });
  return ema(trs, p);
}
export function stochastic(candles, p = 14, d = 3) {
  const k = new Array(candles.length).fill(null);
  for (let i = p - 1; i < candles.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - p + 1; j <= i; j++) { hh = Math.max(hh, candles[j].h); ll = Math.min(ll, candles[j].l); }
    k[i] = hh === ll ? 50 : ((candles[i].c - ll) / (hh - ll)) * 100;
  }
  const dLine = sma(k.map(v => v == null ? 0 : v), d);
  return { k, d: dLine };
}
export function adx(candles, p = 14) {
  const plusDM = [0], minusDM = [0], tr = [0];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    const prevClose = candles[i - 1].c;
    tr.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - prevClose), Math.abs(candles[i].l - prevClose)));
  }
  const atrS = ema(tr, p);
  const plusDI = plusDM.map((v, i) => atrS[i] ? (ema(plusDM, p)[i] / atrS[i]) * 100 : null);
  const minusDI = minusDM.map((v, i) => atrS[i] ? (ema(minusDM, p)[i] / atrS[i]) * 100 : null);
  const dx = plusDI.map((p1, i) => {
    const m1 = minusDI[i];
    if (p1 == null || m1 == null || (p1 + m1) === 0) return null;
    return Math.abs(p1 - m1) / (p1 + m1) * 100;
  });
  const adxLine = ema(dx.map(v => v == null ? 0 : v), p);
  return { plusDI, minusDI, adx: adxLine };
}
export function bollinger(closes, p = 20, mult = 2) {
  const mid = sma(closes, p);
  const upper = new Array(closes.length).fill(null), lower = new Array(closes.length).fill(null), bw = new Array(closes.length).fill(null);
  for (let i = p - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - p + 1; j <= i; j++) sum += Math.pow(closes[j] - mid[i], 2);
    const sd = Math.sqrt(sum / p);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
    bw[i] = mid[i] ? (upper[i] - lower[i]) / mid[i] : null;
  }
  return { mid, upper, lower, bw };
}
export function percentileRank(arr, idx, lookback = 200) {
  const start = Math.max(0, idx - lookback);
  const window = arr.slice(start, idx + 1).filter(v => v != null);
  if (!window.length || arr[idx] == null) return null;
  const below = window.filter(v => v <= arr[idx]).length;
  return (below / window.length) * 100;
}
