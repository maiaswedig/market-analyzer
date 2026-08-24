// engine.js — motor único de análise: indicadores -> score por categorias -> nota -> estatística histórica.
// Filosofia: TRANSPARENTE, sem travas escondidas. Tudo que o motor calcula, a interface mostra.
// O usuário decide os filtros (score mínimo, nota mínima) — o motor nunca esconde nada por padrão.
import { sma, ema, rsi, macd, atr, stochastic, adx, bollinger, percentileRank } from './indicators.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// Constrói todos os indicadores para uma série de candles fechados (mais recentes por último).
export function buildIndicators(candles) {
  const closes = candles.map(c => c.c);
  const ema9 = ema(closes, 9), ema21 = ema(closes, 21), ema50 = ema(closes, 50), ema200 = ema(closes, 200);
  const rsiArr = rsi(closes, 14);
  const macdRes = macd(closes);
  const atrArr = atr(candles, 14);
  const stoch = stochastic(candles, 14, 3);
  const adxRes = adx(candles, 14);
  const bb = bollinger(closes, 20, 2);
  return { closes, ema9, ema21, ema50, ema200, rsi: rsiArr, macd: macdRes, atr: atrArr, stoch, adx: adxRes, bb };
}

// Avalia UM índice da série (estritamente causal — só usa dados até esse índice).
export function evaluateAt(candles, ind, i, mtfDirs = []) {
  const c = candles[i];
  const categories = [];
  const add = (key, label, weight, bias, detail) => {
    const b = clamp(bias, -1, 1);
    categories.push({ key, label, weight, bias: b, sub: Math.round((50 + 50 * b) * 10) / 10, detail });
  };

  // Tendência: alinhamento das EMAs + preço vs EMA longa
  {
    const e9 = ind.ema9[i], e21 = ind.ema21[i], e50 = ind.ema50[i], e200 = ind.ema200[i];
    let align = 0, n = 0;
    if (e9 != null && e21 != null) { align += e9 > e21 ? 1 : -1; n++; }
    if (e21 != null && e50 != null) { align += e21 > e50 ? 1 : -1; n++; }
    if (e50 != null && e200 != null) { align += e50 > e200 ? 1 : -1; n++; }
    const aboveLong = (e200 != null) ? (c.c > e200 ? 1 : -1) : 0;
    const b = n ? (align / n) * 0.75 + aboveLong * 0.25 : 0;
    add('tendencia', 'Tendência', 24, b, `EMAs alinhadas ${align >= 0 ? 'em alta' : 'em baixa'} (${n}/3) · preço ${aboveLong > 0 ? 'acima' : 'abaixo'} da EMA200`);
  }

  // Momentum: RSI + MACD + estocástico
  {
    let b = 0, n = 0, parts = [];
    const r = ind.rsi[i];
    if (r != null) {
      let rb = clamp((r - 50) / 20, -1, 1);
      if (r > 75) rb -= 0.3; if (r < 25) rb += 0.3;
      b += rb; n++; parts.push(`RSI ${r.toFixed(1)}`);
    }
    const mh = ind.macd.hist[i];
    if (mh != null && ind.atr[i]) {
      b += clamp(mh / (ind.atr[i] * 0.3), -1, 1); n++;
      parts.push(`MACD hist ${mh > 0 ? 'positivo' : 'negativo'}`);
    }
    const k = ind.stoch.k[i];
    if (k != null) { b += clamp((k - 50) / 35, -1, 1); n++; parts.push(`Estocástico ${k.toFixed(0)}`); }
    add('momentum', 'Momentum', 20, n ? b / n : 0, parts.join(' · ') || 'sem dados');
  }

  // Multi-timeframe: direção de contextos superiores
  if (mtfDirs.length) {
    const sum = mtfDirs.reduce((s, d) => s + d, 0);
    add('multitf', 'Multi-TF', 18, sum / mtfDirs.length, `contextos: ${mtfDirs.map(d => d > 0 ? 'alta' : d < 0 ? 'baixa' : 'neutro').join(', ')}`);
  }

  // ADX / força de tendência
  {
    const adxV = ind.adx.adx[i], pdi = ind.adx.plusDI[i], mdi = ind.adx.minusDI[i];
    if (adxV != null && pdi != null && mdi != null) {
      const dir = pdi > mdi ? 1 : -1;
      const strength = clamp((adxV - 15) / 25, 0, 1);
      add('adx', 'Força direcional (ADX)', 16, dir * strength, `ADX ${adxV.toFixed(1)} · +DI ${pdi.toFixed(0)} / -DI ${mdi.toFixed(0)}`);
    }
  }

  // Volatilidade / Bandas de Bollinger
  {
    const bw = ind.bb.bw[i];
    const bwPct = percentileRank(ind.bb.bw, i, 200);
    let q = 0;
    if (bwPct != null) q = (bwPct > 30 && bwPct < 85) ? 0.6 : (bwPct < 10 ? -0.4 : 0.1);
    const dirHint = Math.sign(ind.ema9[i] - (ind.ema21[i] || ind.ema9[i]));
    add('volatilidade', 'Volatilidade', 10, q * dirHint, `largura BB percentil ${bwPct == null ? '—' : bwPct.toFixed(0)}`);
  }

  // Volume relativo (se disponível)
  {
    const vols = candles.slice(Math.max(0, i - 20), i + 1).map(x => x.v || 0);
    const avg = vols.reduce((s, v) => s + v, 0) / (vols.length || 1);
    const rel = avg ? (c.v || 0) / avg : 1;
    const dirLast = Math.sign(c.c - c.o);
    let b = 0;
    if (rel > 0) { b = dirLast * clamp((rel - 0.9), -0.3, 1); }
    add('volume', 'Volume', 12, b, `volume relativo ${rel.toFixed(2)}x a média de 20 velas`);
  }

  const wSum = categories.reduce((s, c) => s + c.weight, 0) || 1;
  const B = categories.reduce((s, c) => s + c.weight * c.bias, 0) / wSum;
  const direction = Math.abs(B) < 0.03 ? 0 : (B > 0 ? 1 : -1);
  const strength = clamp((Math.abs(B) - 0.05) / 0.40, 0, 1);
  const score = Math.round((50 + 50 * strength) * 10) / 10;

  return { categories, bias: B, direction, score, price: c.c, time: c.t };
}

// Estatística histórica causal: para os últimos N sinais IGUAIS a este (mesma direção),
// qual foi a taxa de acerto real na vela seguinte?
export function historicalStats(candles, ind, currentIndex, direction, lookback = 400) {
  if (direction === 0) return { samples: 0, hits: 0, rate: null };
  const start = Math.max(50, currentIndex - lookback);
  let samples = 0, hits = 0;
  for (let i = start; i < currentIndex; i++) {
    const ev = evaluateAt(candles, ind, i, []);
    if (ev.direction === direction && i + 1 < candles.length) {
      samples++;
      const nextRet = candles[i + 1].c - candles[i].c;
      if ((direction > 0 && nextRet > 0) || (direction < 0 && nextRet < 0)) hits++;
    }
  }
  return { samples, hits, rate: samples ? (hits / samples) * 100 : null };
}

// Nota de qualidade A+ / A / B / C / D — cada faixa tem significado claro, nada escondido.
export function gradeOf(score, confluenceRatio, histRate, histSamples) {
  let pts = 0;
  if (score >= 82) pts += 2.5; else if (score >= 72) pts += 2; else if (score >= 64) pts += 1.25; else if (score >= 56) pts += 0.5;
  if (confluenceRatio >= 1) pts += 1.5; else if (confluenceRatio >= 0.75) pts += 1; else if (confluenceRatio >= 0.5) pts += 0.4;
  if (histSamples >= 30) { if (histRate >= 58) pts += 1.2; else if (histRate < 45) pts -= 1; }
  const grade = pts >= 4.5 ? 'A+' : pts >= 3.3 ? 'A' : pts >= 2.1 ? 'B' : pts >= 1 ? 'C' : 'D';
  return { grade, points: Math.round(pts * 100) / 100 };
}
