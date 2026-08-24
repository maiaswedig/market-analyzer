// analyze.js — orquestra dados + indicadores + categorias + decisão por expectativa.
// O MESMO motor (`evaluateBar`) é usado pela análise ao vivo, pelo scanner, pelo backtest
// e pelo diagnóstico de calibração — assim os números da UI e do backtest são comparáveis.
import { MTF_MAP, TIMEFRAMES } from './assets.js';
import { getCandles, candleWindow, DEPTH_TARGET } from './data.js';
import { buildSeries, snapshotAt, MIN_WARMUP } from './features.js';
import { computeScore, tfDirection, setupGrade, confluenceOf } from './score.js';
import { marketCondition } from './condition.js';
import { historicalProbability, labelSnapshots } from './probability.js';
import { predict } from './ml.js';
import { fingerprint, setupStatsFor } from './setups.js';
import { decide, whyBullets, INSUFFICIENT } from './decision.js';
import { fmtPrice } from './util.js';

export const DEFAULT_SETTINGS = {
  mode: 'normal',
  defaultAsset: 'BTCUSDT',
  defaultTf: 'M5',
  minScore: 80,               // limiar do score técnico (0–100, neutro = 50)
  minConfluence: 3,           // 0 = desligado
  minSamples: 60,             // amostra mínima de análogos
  minSetupSamples: 40,        // amostra mínima da classe de setup
  maxDistance: 6,
  scoreB0: 0.06,
  scoreB1: 0.45,
  evGate: 'bloquear',            // 'aviso' = só avisa | 'bloquear' = exige EV > minEv
  minEv: 0,
  highProbabilityMode: true,
  minProbability: 0.65,
  minProbabilitySamples: 60,
  requireProbabilityCIAboveBreakEven: true,
  payout: 85,                 // %
  stake: 5,                   // R$ por operação
  banca: 250,                 // R$
  stakePct: 0,                // 0 = valor fixo (sem martingale, sempre)
  minZoneAtr: 0.35,
  deepCandles: 6000,
  thresholds: {},             // { 'ATIVO|TF': score mínimo aplicado do varredor }
  scannerMarket: 'Cripto',
  scannerCount: 20,
  scannerTfs: ['M5'],
  autoRefresh: false,
  refreshSec: 30,
  useMl: true,
  alertSound: true,
  alertNotification: false,
  alertVisual: true,
  alertOnlyAGrades: true,
  theme: 'dark',
  brokerTolPct: 0.15,
  weights: { tendencia: 22, momentum: 18, multitf: 18, priceaction: 14, sr: 12, volatilidade: 8, volume: 8 },
  toggles: { ema: true, rsi: true, macd: true, stoch: true, volume: true, bollinger: true, estrutura: true, sr: true, priceaction: true, atr: true, multitf: true }
};

export const MODE_PRESETS = {
  conservador: { minScore: 68, minConfluence: 3, minSamples: 40, minSetupSamples: 25, evGate: 'bloquear' },
  normal: { minScore: 64, minConfluence: 2, minSamples: 40, minSetupSamples: 25, evGate: 'aviso' },
  agressivo: { minScore: 52, minConfluence: 2, minSamples: 20, minSetupSamples: 10, evGate: 'aviso' }
};

export function effectiveMinScore(cfg, assetId, tf) {
  const key = `${assetId}|${tf}`;
  const v = cfg.thresholds && cfg.thresholds[key];
  return Number.isFinite(Number(v)) ? Number(v) : Number(cfg.minScore);
}

/** Conjunto de snapshots rotulados (analogia histórica, ML, backtest e diagnóstico). */
export function buildSnapshotPool(candles, hasVolume, { from = MIN_WARMUP, stride = 1, zoneLookback = 160, max = 0 } = {}) {
  const series = buildSeries(candles, { hasVolume });
  const snaps = [];
  let start = Math.max(MIN_WARMUP, from);
  if (max && candles.length - start > max) start = candles.length - max;
  for (let i = start; i < candles.length; i += stride) {
    const s = snapshotAt(series, i, { zoneLookback });
    if (s) snaps.push(s);
  }
  labelSnapshots(snaps, candles);
  return { series, snaps };
}

/**
 * MOTOR ÚNICO — avalia UMA barra de forma estritamente causal.
 * @param snap      snapshot da barra t (features só de candles ≤ t)
 * @param mtf       [{tf, dir, isMain, unavailable}] já resolvido causalmente
 * @param pastSnaps snapshots anteriores a t (para analogia histórica) — pode ser []
 * @param opts      { cfg, model, setupRanking, brokerDivergence }
 */
export function evaluateBar(snap, mtf, pastSnaps, opts = {}) {
  const cfg = opts.cfg || DEFAULT_SETTINGS;
  const cond = marketCondition(snap);
  const score = computeScore(snap, mtf, cond, cfg);
  const dir = score.direction;

  const hist = pastSnaps && pastSnaps.length
    ? historicalProbability(pastSnaps, snap, { minSamples: cfg.minSamples, maxDistance: cfg.maxDistance, maxNeighbors: opts.maxNeighbors || 300 })
    : { insufficient: true, samples: 0, minSamples: cfg.minSamples, text: 'sem histórico comparável carregado', maxDistance: cfg.maxDistance, baseDistance: cfg.maxDistance };

  let ml = null;
  if (cfg.useMl && opts.model && opts.model.ok) {
    const p = predict(opts.model, snap.vector);
    ml = {
      p, usable: !!opts.model.usable, brier: opts.model.validMetrics ? opts.model.validMetrics.brier : null,
      validN: opts.model.validMetrics ? opts.model.validMetrics.n : null,
      baseBrier: opts.model.baseBrier ?? null, gateReason: opts.model.gateReason || null
    };
  }

  const fp = dir !== 0 ? fingerprint(snap, mtf, dir) : null;
  const setupStats = fp && opts.setupRanking ? setupStatsFor(opts.setupRanking, fp.id, cfg.minSetupSamples) : null;

  const decision = decide({ score, mtf, cond, hist, ml, setupStats: setupStats && setupStats.enough ? setupStats : null, cfg, brokerDivergence: opts.brokerDivergence });
  const grade = setupGrade({
    score: score.score, confluence: score.confluence, cond, penaltyTotal: score.penaltyTotal,
    setupStats: setupStats && setupStats.enough ? { ...setupStats, ev: setupStats.ev, rate: setupStats.rate } : null,
    blocked: decision.blocked
  });

  return { snap, cond, score, hist, ml, fingerprint: fp, setupStats, decision, grade, verdict: decision.verdict };
}

/* ------------------------------------------------------------------ análise ao vivo */
export async function analyzeAsset(asset, tfKey, settings, opts = {}) {
  const cfg = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  cfg.minScore = effectiveMinScore(cfg, asset.id, tfKey);
  const { light = false, model = null, setupRanking = null, brokerDivergence = null, onStage = () => {} } = opts;
  const tfs = MTF_MAP[tfKey] || [tfKey];
  const result = { asset, tfKey, at: Date.now(), errors: [], sources: {}, mtf: [], warnings: [], verdict: 'AGUARDAR' };

  onStage('Buscando candles reais…');
  const dataByTf = {};
  const mainDepth = light ? 'mid' : 'deep';
  const mainTarget = light ? DEPTH_TARGET.mid : Math.max(1500, Number(cfg.deepCandles) || DEPTH_TARGET.deep);
  const fetchOne = async (tf, depth, target) => {
    try {
      const d = await getCandles(asset, tf, { depth, target, onProgress: opts.onFetchProgress });
      dataByTf[tf] = d;
      result.sources[tf] = { source: d.source, aggregatedFrom: d.aggregatedFrom, count: d.count, latencyMs: d.latencyMs, updatedAt: d.updatedAt, stale: !!d.stale, hasVolume: d.hasVolume };
      if (d.error) result.warnings.push(`${tf}: ${d.error}`);
    } catch (e) { result.errors.push(`${tf}: ${e.message}`); }
  };
  await fetchOne(tfKey, mainDepth, mainTarget);
  const main = dataByTf[tfKey];
  if (main) await Promise.all(tfs.filter(tf => tf !== tfKey).map(tf => fetchOne(tf, 'context', DEPTH_TARGET.context)));

  if (!main) {
    result.dataError = true;
    result.reasons = ['Fonte de dados indisponível para o ativo/timeframe selecionado — nenhuma análise foi feita (nenhum candle é simulado).'];
    return result;
  }
  if (main.candles.length < MIN_WARMUP + 30) {
    result.dataError = true;
    result.reasons = [`Histórico insuficiente (${main.candles.length} candles; mínimo ${MIN_WARMUP + 30} para todos os indicadores).`];
    return result;
  }

  onStage('Calculando indicadores e zonas…');
  const poolMax = light ? 500 : Math.min(main.candles.length, Math.max(1200, Number(cfg.poolMax) || 3000));
  const tfMs = TIMEFRAMES[tfKey].sec * 1000;
  // Ao vivo, a última vela disponível é a vela atual. O usuário pode analisar
  // no final dela para projetar a próxima; não devemos descartá-la.
  const candles = main.candles.slice(-poolMax);
  const { snaps } = buildSnapshotPool(candles, main.hasVolume, { zoneLookback: light ? 120 : 160 });
  if (!snaps.length) {
    result.dataError = true;
    result.reasons = ['Não foi possível calcular indicadores com o histórico disponível.'];
    return result;
  }
  const current = snaps[snaps.length - 1];
  result.candleCount = candles.length;
  result.totalCandles = main.candles.length;
  result.hasVolume = main.hasVolume;
  result.candles = candles;

  onStage('Analisando timeframes de contexto…');
  for (const tf of tfs) {
    const d = dataByTf[tf];
    if (!d) { result.mtf.push({ tf, dir: 0, isMain: tf === tfKey, unavailable: true }); continue; }
    const currentCtx = d.candles;
    if (currentCtx.length < MIN_WARMUP + 10) { result.mtf.push({ tf, dir: 0, isMain: tf === tfKey, unavailable: true }); continue; }
    let snap;
    if (tf === tfKey) snap = current;
    else {
      const s2 = buildSeries(currentCtx.slice(-400), { hasVolume: d.hasVolume });
      snap = snapshotAt(s2, s2.candles.length - 1, { zoneLookback: 120 });
    }
    if (!snap) { result.mtf.push({ tf, dir: 0, isMain: tf === tfKey, unavailable: true }); continue; }
    result.mtf.push({ tf, dir: tfDirection(snap), isMain: tf === tfKey, snap, regime: snap.structure.label });
  }

  onStage('Comparando com situações históricas…');
  const evaluated = evaluateBar(current, result.mtf, snaps.slice(0, -1), {
    cfg, model, setupRanking, brokerDivergence, maxNeighbors: light ? 150 : 400
  });
  Object.assign(result, evaluated);
  result.snapshot = current;
  result.probability = evaluated.hist;
  result.verdict = evaluated.verdict;
  result.confluence = evaluated.score.confluence;
  result.why = whyBullets({ score: evaluated.score, decision: evaluated.decision, cond: evaluated.cond, snap: current, mtf: result.mtf });
  result.candleWindow = candleWindow(TIMEFRAMES[tfKey].sec);
  result.explanation = explain(result, cfg);
  result.minScoreUsed = cfg.minScore;
  return result;
}

/** Explicação em português, montada só a partir do que realmente decidiu. */
export function explain(r, cfg) {
  const s = r.snapshot, sc = r.score, d = r.decision, cond = r.cond;
  if (!s || !sc) return 'Sem dados suficientes para explicar a análise.';
  const p = [];
  p.push(`No ${r.tfKey} de ${r.asset.name}, o preço no momento da análise foi ${fmtPrice(s.price)}; a condição de mercado é ${cond.label.toLowerCase()} (${cond.notes.join(' · ')}).`);
  const cats = sc.categories.slice().sort((a, b) => Math.abs(b.bias * b.weight) - Math.abs(a.bias * a.weight));
  p.push(`Categorias (0–100, 50 = neutro): ${cats.map(c => `${c.label} ${c.sub}`).join(' · ')} → viés final ${sc.bias100}/100 e score técnico ${sc.score}/100 (escala B0=${sc.scale.B0} B1=${sc.scale.B1}, penalidades −${sc.penaltyTotal}).`);
  p.push(`Confluência multi-timeframe: ${sc.confluence.text} (${r.mtf.map(m => `${m.tf} ${m.unavailable ? 'n/d' : m.dir > 0 ? 'alta' : m.dir < 0 ? 'baixa' : 'neutro'}`).join(', ')}).`);
  if (s.priceAction) p.push(s.priceAction.summary);
  if (r.hist.insufficient) p.push(`Análogos históricos: ${r.hist.text} — ${INSUFFICIENT}`);
  else p.push(`Análogos históricos: em ${r.hist.samples} situações semelhantes, a vela seguinte fechou em alta ${r.hist.up} vezes e em baixa ${r.hist.down} (taxa histórica de alta ${(r.hist.pUp * 100).toFixed(1)}%, IC95% ${(r.hist.ciLow * 100).toFixed(1)}–${(r.hist.ciHigh * 100).toFixed(1)}%).`);
  if (r.ml && r.ml.p !== null) p.push(`Modelo calibrado: ${(r.ml.p * 100).toFixed(1)}% de chance de alta${r.ml.usable ? ' (validado: participa da decisão)' : ` (não validado: ${r.ml.gateReason || 'travas de validação não atendidas'} — não participa)`}.`);
  if (d.estimate.p !== null) p.push(`Expectativa matemática com payout ${(d.payout * 100).toFixed(0)}% e aposta de R$ ${d.stake}: ${d.ev >= 0 ? '+' : ''}R$ ${d.ev.toFixed(3)} por operação (p = ${(d.estimate.p * 100).toFixed(1)}% de ${d.estimate.source}, N = ${d.estimate.samples || '—'}; equilíbrio em ${(d.breakEven * 100).toFixed(1)}%).`);
  else p.push(`${INSUFFICIENT} A decisão usou score técnico e travas de risco, sem estimativa de probabilidade.`);
  if (!s.volume.available) p.push('A fonte deste ativo não fornece volume real: o fator volume foi neutralizado.');
  if (r.verdict === 'AGUARDAR') p.push(`Conclusão: AGUARDAR — ${(d.reasons.length ? d.reasons : ['confluência insuficiente']).join('; ')}.`);
  else p.push(`Conclusão: ${r.verdict} para a PRÓXIMA vela de ${r.tfKey}, nota de setup ${r.grade.grade}. É leitura técnica e estatística, não garantia — confirme ativo, preço e horário na corretora.`);
  return p.join(' ');
}

export function shortReason(r) {
  if (r.dataError) return 'fonte indisponível';
  if (r.verdict !== 'AGUARDAR') {
    const c = r.score.categories.slice().sort((a, b) => Math.abs(b.bias * b.weight) - Math.abs(a.bias * a.weight))[0];
    return `${r.cond.label.toLowerCase()}; ${c ? c.label.toLowerCase() + ' ' + c.sub : ''}`;
  }
  return (r.decision && r.decision.reasons[0] ? r.decision.reasons[0] : 'sem confluência').slice(0, 80);
}
