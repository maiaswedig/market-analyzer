// backtest.js — backtest ESTRITAMENTE CAUSAL + diagnóstico de calibração + varredura de limiares
// + simulação de payout/banca. Features vêm de candles ≤ t; o resultado vem SEMPRE da vela t+1.
import { getCandles, resample, DEPTH_TARGET } from './data.js';
import { buildSnapshotPool, evaluateBar, DEFAULT_SETTINGS, effectiveMinScore } from './analyze.js';
import { tfDirection } from './score.js';
import { TIMEFRAMES, MTF_MAP } from './assets.js';
import { buildSeries, snapshotAt } from './features.js';
import { rankSetups } from './setups.js';
import { breakEvenRate, expectancy } from './decision.js';

const yieldNow = () => new Promise(r => setTimeout(r, 0));

/**
 * Roda o motor sobre o histórico real.
 * @returns { bars, signals, distribution, stats, sweep, meta }
 */
export async function runBacktest(asset, tfKey, settings, { hourFilter = null, maxTests = 600, onProgress = () => {}, model = null } = {}) {
  const cfg = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  cfg.minScore = effectiveMinScore(cfg, asset.id, tfKey);
  onProgress(0.02, 'Buscando histórico profundo…');
  const target = Math.max(1500, Number(cfg.deepCandles) || DEPTH_TARGET.deep);
  const d = await getCandles(asset, tfKey, { depth: 'deep', target });
  if (!d || d.candles.length < 400) throw new Error('histórico insuficiente para backtest (' + (d ? d.candles.length : 0) + ' candles)');

  onProgress(0.10, `Calculando indicadores em ${d.candles.length} candles…`);
  const candles = d.candles;
  const { snaps } = buildSnapshotPool(candles, d.hasVolume, { zoneLookback: 160 });
  if (snaps.length < 120) throw new Error('poucos pontos calculáveis para backtest');

  // ---- contexto multi-timeframe CAUSAL: TFs superiores reamostrados do mesmo histórico,
  // usando apenas a última vela do TF superior JÁ FECHADA em cada instante.
  const tfSec = TIMEFRAMES[tfKey].sec;
  const ladder = (MTF_MAP[tfKey] || [tfKey]).filter(tf => tf !== tfKey && TIMEFRAMES[tf].sec > tfSec);
  const higher = [];
  for (const tf of ladder) {
    const hSec = TIMEFRAMES[tf].sec;
    const hc = resample(candles, hSec);
    if (hc.length < 240) continue;
    const series = buildSeries(hc, { hasVolume: d.hasVolume });
    const hsnaps = [];
    for (let i = 210; i < hc.length; i++) { const s = snapshotAt(series, i, { zoneLookback: 120 }); if (s) hsnaps.push(s); }
    if (hsnaps.length < 10) continue;
    higher.push({ tf, sec: hSec, snaps: hsnaps, ptr: 0, dirCache: new Map() });
  }
  const lowerTf = (MTF_MAP[tfKey] || []).find(tf => TIMEFRAMES[tf].sec < tfSec) || null;

  const higherAt = (t) => {
    const out = [];
    for (const h of higher) {
      while (h.ptr + 1 < h.snaps.length && h.snaps[h.ptr + 1].t + h.sec * 1000 <= t) h.ptr++;
      const cand = h.snaps[h.ptr];
      if (cand && cand.t + h.sec * 1000 <= t) {
        if (!h.dirCache.has(cand.t)) h.dirCache.set(cand.t, tfDirection(cand));
        out.push({ tf: h.tf, dir: h.dirCache.get(cand.t), snap: cand });
      } else out.push({ tf: h.tf, dir: 0, unavailable: true });
    }
    return out;
  };

  const startIdx = Math.max(60, snaps.length - maxTests);
  const bars = [];
  const resolved = [];           // sinais já resolvidos (para ranking walk-forward de setups)
  let ranking = null;
  const total = snaps.length - 1 - startIdx;

  for (let n = startIdx; n < snaps.length - 1; n++) {
    const snap = snaps[n];
    if (snap.nextDir === null || snap.nextDir === undefined) continue;
    const hour = new Date(snap.t).getHours();
    if (hourFilter && hourFilter.length && !hourFilter.includes(hour)) continue;

    const mtf = [{ tf: tfKey, dir: tfDirection(snap), isMain: true }].concat(higherAt(snap.t));
    if (lowerTf) mtf.unshift({ tf: lowerTf, dir: 0, unavailable: true }); // TF menor não é reconstruível do TF maior — marcado como n/d
    const past = snaps.slice(0, n);

    // ranking de setups apenas com sinais JÁ resolvidos (walk-forward, sem olhar o futuro)
    if (resolved.length && (resolved.length % 25 === 0 || !ranking)) ranking = rankSetups(resolved, { minSamples: cfg.minSetupSamples, payout: (cfg.payout || 85) / 100 });

    const ev = evaluateBar(snap, mtf, past, { cfg, model, setupRanking: ranking, maxNeighbors: 250 });
    const dir = ev.score.direction;
    const hit = dir !== 0 && ((dir > 0 && snap.nextDir > 0) || (dir < 0 && snap.nextDir < 0));
    const doji = snap.nextDir === 0;
    const bar = {
      t: snap.t, hour, price: snap.price, dir,
      verdict: ev.verdict, score: ev.score.score, bias100: ev.score.bias100,
      grade: ev.grade.grade, condition: ev.cond.label, blocked: ev.score.blocking.length > 0,
      confluence: ev.score.confluence.text, penalties: ev.score.penaltyTotal,
      prob: ev.decision.estimate.p === null ? null : ev.decision.estimate.p * 100,
      probSource: ev.decision.estimate.source, probSamples: ev.decision.estimate.samples,
      histRate: ev.hist.insufficient ? null : (dir > 0 ? ev.hist.pUp : ev.hist.pDown) * 100,
      histSamples: ev.hist.samples,
      setupId: ev.fingerprint ? ev.fingerprint.id : null,
      setupLabel: ev.fingerprint ? ev.fingerprint.label : null,
      nextDir: snap.nextDir, changePct: snap.nextChangePct,
      result: dir === 0 ? null : (doji ? 'NEUTRO' : (hit ? 'ACERTO' : 'ERRO')),
      signal: dir > 0 ? 'CALL' : dir < 0 ? 'PUT' : null
    };
    bars.push(bar);
    if (bar.verdict !== 'AGUARDAR' && bar.result) resolved.push({ setupId: bar.setupId, setupLabel: bar.setupLabel, signal: bar.signal, result: bar.result });

    if ((n - startIdx) % 10 === 0) {
      onProgress(0.12 + 0.8 * (n - startIdx) / Math.max(1, total), `Avaliando vela ${n - startIdx + 1} de ${total}…`);
      await yieldNow();
    }
  }

  onProgress(0.95, 'Consolidando estatísticas…');
  const payout = (Number(cfg.payout) || 85) / 100;
  const distribution = distribute(bars);
  const signals = bars.filter(b => b.verdict !== 'AGUARDAR');
  const stats = summarize(signals, { payout, stake: Number(cfg.stake) || 5, banca: Number(cfg.banca) || 250 });
  const sweep = thresholdSweep(bars, { payout, stake: Number(cfg.stake) || 5, minSignals: Math.max(20, Math.round(bars.length * 0.02)) });
  const setupRanking = rankSetups(signals, { minSamples: cfg.minSetupSamples, payout });

  onProgress(1, 'Concluído');
  return {
    bars, signals, distribution, stats, sweep, setupRanking,
    meta: {
      asset, tfKey, source: d.source, candles: candles.length, evaluated: bars.length,
      from: bars.length ? bars[0].t : null, to: bars.length ? bars[bars.length - 1].t : null,
      cfg: { ...cfg }, hasVolume: d.hasVolume, aggregatedFrom: d.aggregatedFrom,
      contextTfs: higher.map(h => h.tf), lowerTfUnavailable: lowerTf
    }
  };
}

/* ------------------------------------------------------- diagnóstico de calibração */
export function distribute(bars) {
  const count = { CALL: 0, PUT: 0, AGUARDAR: 0 };
  const reasons = new Map();
  const byHour = new Map();
  const byGrade = new Map();
  const scores = [];
  for (const b of bars) {
    count[b.verdict] = (count[b.verdict] || 0) + 1;
    scores.push(b.score);
    if (!byHour.has(b.hour)) byHour.set(b.hour, { key: String(b.hour).padStart(2, '0') + 'h', CALL: 0, PUT: 0, AGUARDAR: 0 });
    byHour.get(b.hour)[b.verdict]++;
    byGrade.set(b.grade, (byGrade.get(b.grade) || 0) + 1);
  }
  scores.sort((a, b) => a - b);
  const q = p => scores.length ? scores[Math.floor(p * (scores.length - 1))] : null;
  const n = bars.length || 1;
  return {
    n: bars.length,
    call: count.CALL, put: count.PUT, wait: count.AGUARDAR,
    callPct: count.CALL / n * 100, putPct: count.PUT / n * 100, waitPct: count.AGUARDAR / n * 100,
    scoreMin: q(0), scoreP25: q(0.25), scoreMedian: q(0.5), scoreP75: q(0.75), scoreP90: q(0.9), scoreMax: q(1),
    byHour: [...byHour.values()].sort((a, b) => a.key.localeCompare(b.key)),
    byGrade: [...byGrade.entries()].map(([k, v]) => ({ key: k, total: v, pct: v / n * 100 })).sort((a, b) => a.key.localeCompare(b.key)),
    reasons: [...reasons.entries()]
  };
}

/* ------------------------------------------------------- estatísticas dos sinais */
export function summarize(signals, { payout = 0.85, stake = 5, banca = 250 } = {}) {
  const valid = signals.filter(t => t.result && t.result !== 'NEUTRO');
  const hits = valid.filter(t => t.result === 'ACERTO').length;
  const errs = valid.length - hits;
  const rate = valid.length ? hits / valid.length * 100 : null;
  const grossWin = hits * stake * payout, grossLoss = errs * stake;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);
  const p = valid.length ? (hits + 1) / (valid.length + 2) : null;   // Laplace
  const ev = p === null ? null : expectancy(p, payout, stake);

  // curva de banca (sem martingale: aposta fixa)
  let bal = banca, peak = banca, maxDD = 0, maxDDpct = 0;
  const equity = [{ t: valid.length ? valid[0].t : Date.now(), bal }];
  let bestWin = 0, bestLoss = 0, cw = 0, cl = 0;
  for (const t of valid) {
    bal += t.result === 'ACERTO' ? stake * payout : -stake;
    if (t.result === 'ACERTO') { cw++; cl = 0; } else { cl++; cw = 0; }
    bestWin = Math.max(bestWin, cw); bestLoss = Math.max(bestLoss, cl);
    peak = Math.max(peak, bal);
    maxDD = Math.max(maxDD, peak - bal);
    maxDDpct = Math.max(maxDDpct, peak > 0 ? (peak - bal) / peak * 100 : 0);
    equity.push({ t: t.t, bal });
  }

  const byKey = (keyFn) => {
    const m = new Map();
    for (const t of valid) {
      const k = keyFn(t);
      if (!m.has(k)) m.set(k, { key: k, total: 0, hits: 0 });
      const o = m.get(k); o.total++; if (t.result === 'ACERTO') o.hits++;
    }
    return [...m.values()].map(o => {
      const r = o.total ? o.hits / o.total * 100 : null;
      const pp = (o.hits + 1) / (o.total + 2);
      return { ...o, rate: r, ev: expectancy(pp, payout, stake) };
    }).sort((a, b) => String(a.key).localeCompare(String(b.key), 'pt-BR', { numeric: true }));
  };
  const band = t => t.score >= 85 ? '85-100' : t.score >= 75 ? '75-84' : t.score >= 65 ? '65-74' : t.score >= 58 ? '58-64' : '<58';

  return {
    total: signals.length, valid: valid.length, neutros: signals.length - valid.length,
    hits, errs, rate, profitFactor, ev, evPerReal: ev === null ? null : ev / stake,
    breakEven: breakEvenRate(payout) * 100, payout, stake, banca,
    finalBalance: bal, net: bal - banca, maxDD, maxDDpct, equity,
    bestWin, bestLoss,
    call: { total: valid.filter(t => t.signal === 'CALL').length, hits: valid.filter(t => t.signal === 'CALL' && t.result === 'ACERTO').length },
    put: { total: valid.filter(t => t.signal === 'PUT').length, hits: valid.filter(t => t.signal === 'PUT' && t.result === 'ACERTO').length },
    byHour: byKey(t => String(t.hour).padStart(2, '0') + 'h'),
    byScore: byKey(band),
    byGrade: byKey(t => t.grade),
    byCondition: byKey(t => t.condition)
  };
}

/* ------------------------------------------------------- varredura de limiares */
/**
 * Para cada limiar de score (e opcionalmente de probabilidade), mede nº de sinais, taxa de acerto,
 * profit factor, drawdown máximo e EXPECTATIVA MATEMÁTICA com o payout configurado.
 *
 * FUNÇÃO OBJETIVO do "MELHOR EQUILÍBRIO": retorno total esperado = EV por sinal × nº de sinais,
 * restrito a nº de sinais ≥ minSignals (amostra mínima para a estatística ter sentido).
 */
export function thresholdSweep(bars, { payout = 0.85, stake = 5, thresholds = [50, 55, 58, 60, 62, 65, 70, 75, 80, 85, 90], probThresholds = [0], minSignals = 20 } = {}) {
  const rows = [];
  for (const thr of thresholds) {
    for (const pthr of probThresholds) {
      const picked = bars.filter(b => b.dir !== 0 && !b.blocked && b.score >= thr && (pthr <= 0 || (b.prob !== null && b.prob >= pthr)) && b.result);
      const valid = picked.filter(b => b.result !== 'NEUTRO');
      const hits = valid.filter(b => b.result === 'ACERTO').length;
      const errs = valid.length - hits;
      const rate = valid.length ? hits / valid.length * 100 : null;
      const p = valid.length ? (hits + 1) / (valid.length + 2) : null;
      const ev = p === null ? null : expectancy(p, payout, stake);
      const grossWin = hits * stake * payout, grossLoss = errs * stake;
      const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);
      let bal = 0, peak = 0, dd = 0;
      for (const b of valid) {
        bal += b.result === 'ACERTO' ? stake * payout : -stake;
        peak = Math.max(peak, bal); dd = Math.max(dd, peak - bal);
      }
      rows.push({
        threshold: thr, probThreshold: pthr, signals: valid.length, neutros: picked.length - valid.length,
        hits, errs, rate, profitFactor: pf, ev, evPerReal: ev === null ? null : ev / stake,
        totalExpected: ev === null ? null : ev * valid.length, net: bal, maxDD: dd,
        enough: valid.length >= minSignals
      });
    }
  }
  const eligible = rows.filter(r => r.enough && r.totalExpected !== null);
  const best = eligible.slice().sort((a, b) => b.totalExpected - a.totalExpected)[0] || null;
  return {
    rows, best, minSignals, payout, stake,
    breakEven: breakEvenRate(payout) * 100,
    objective: 'retorno total esperado = expectativa por sinal × número de sinais, com amostra mínima de ' + minSignals + ' sinais'
  };
}

/* ------------------------------------------------------- teste de causalidade (sem lookahead) */
/**
 * Recalcula o snapshot do índice i usando SOMENTE candles[0..i] e compara com o snapshot
 * calculado sobre a série completa. Se algum número diferir, existe vazamento de futuro.
 */
export function assertNoLookahead(candles, hasVolume, indices = null) {
  const full = buildSeries(candles, { hasVolume });
  const idxs = indices || [Math.floor(candles.length * 0.5), Math.floor(candles.length * 0.7), candles.length - 5];
  const checks = [];
  for (const i of idxs) {
    if (i < 220 || i >= candles.length) continue;
    const a = snapshotAt(full, i, { zoneLookback: 160 });
    const truncated = buildSeries(candles.slice(0, i + 1), { hasVolume });
    const b = snapshotAt(truncated, i, { zoneLookback: 160 });
    if (!a || !b) { checks.push({ i, ok: false, diff: 'snapshot nulo' }); continue; }
    const fields = ['price', 'atr', 'rsi', 'alignment', 'adx', 'atrPercentile', 'distR', 'distS', 'emaCompression'];
    const diffs = [];
    for (const f of fields) {
      const va = a[f], vb = b[f];
      if (va === null && vb === null) continue;
      if (typeof va === 'number' && typeof vb === 'number') { if (Math.abs(va - vb) > Math.max(1e-9, Math.abs(va) * 1e-9)) diffs.push(`${f}: ${va} ≠ ${vb}`); }
      else if (va !== vb) diffs.push(`${f}: ${va} ≠ ${vb}`);
    }
    const vd = a.vector.map((v, j) => Math.abs(v - b.vector[j]) > 1e-9 ? j : -1).filter(j => j >= 0);
    if (vd.length) diffs.push('vetor difere nos índices ' + vd.join(','));
    checks.push({ i, ok: diffs.length === 0, diff: diffs.join(' | ') });
  }
  return { ok: checks.every(c => c.ok), checks };
}
