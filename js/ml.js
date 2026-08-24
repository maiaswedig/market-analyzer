// ml.js — regressão logística CALIBRADA treinada no navegador (sem bibliotecas).
// Padronização + regularização L2 + divisão CRONOLÓGICA (70% antigo / 30% recente, fora da amostra).
// Métricas: acurácia, logloss, Brier score, AUC e curva de calibração (decis).
// TRAVA: a probabilidade só é exibida/usada se validação ≥ minValid amostras E Brier melhor que a taxa base.
import { VECTOR_NAMES } from './features.js';
import { store } from './util.js';

const MODEL_KEY = 'ma_model_v2';

function standardize(X) {
  const n = X.length, d = X[0].length;
  const mean = new Array(d).fill(0), std = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / n;
  for (const row of X) for (let j = 0; j < d; j++) std[j] += Math.pow(row[j] - mean[j], 2) / n;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}
function applyStd(row, mean, std) { return row.map((v, j) => (v - mean[j]) / std[j]); }
const sigmoid = z => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

function metrics(X, y, w, b) {
  const n = X.length;
  if (!n) return { n: 0, acc: null, logloss: null, auc: null, brier: null, reliability: [] };
  let correct = 0, ll = 0, brier = 0;
  const preds = [];
  for (let i = 0; i < n; i++) {
    let z = b;
    for (let j = 0; j < w.length; j++) z += w[j] * X[i][j];
    const p = sigmoid(z);
    preds.push({ p, y: y[i] });
    if ((p >= 0.5 ? 1 : 0) === y[i]) correct++;
    ll += -(y[i] * Math.log(Math.max(1e-9, p)) + (1 - y[i]) * Math.log(Math.max(1e-9, 1 - p)));
    brier += Math.pow(p - y[i], 2);
  }
  // curva de confiabilidade em decis de probabilidade prevista
  const bins = Array.from({ length: 10 }, (_, k) => ({ from: k / 10, to: (k + 1) / 10, n: 0, sumP: 0, hits: 0 }));
  for (const pr of preds) {
    const k = Math.min(9, Math.floor(pr.p * 10));
    bins[k].n++; bins[k].sumP += pr.p; bins[k].hits += pr.y;
  }
  const reliability = bins.map(b2 => ({
    faixa: `${(b2.from * 100).toFixed(0)}–${(b2.to * 100).toFixed(0)}%`,
    n: b2.n, previsto: b2.n ? b2.sumP / b2.n : null, realizado: b2.n ? b2.hits / b2.n : null
  }));
  const sorted = preds.slice().sort((a, b2) => a.p - b2.p);
  const pos = sorted.filter(p => p.y === 1).length, neg = n - pos;
  let rankSum = 0;
  sorted.forEach((p, idx) => { if (p.y === 1) rankSum += idx + 1; });
  const auc = (pos && neg) ? (rankSum - pos * (pos + 1) / 2) / (pos * neg) : null;
  return { n, acc: correct / n, logloss: ll / n, auc, brier: brier / n, reliability, baseRate: pos / n };
}

/**
 * @param samples [{vector, label}] em ordem cronológica
 * @param opts { epochs, lr, l2, minValid, onProgress }
 */
export async function trainLogistic(samples, { epochs = 400, lr = 0.15, l2 = 0.006, minValid = 150, onProgress } = {}) {
  const clean = samples.filter(s => s.vector.every(v => Number.isFinite(v)) && (s.label === 0 || s.label === 1));
  if (clean.length < 400) return { ok: false, reason: `amostras insuficientes para treinar (${clean.length}, mínimo 400)` };
  const split = Math.floor(clean.length * 0.7);
  const train = clean.slice(0, split), valid = clean.slice(split);
  const { mean, std } = standardize(train.map(s => s.vector));
  const Xtr = train.map(s => applyStd(s.vector, mean, std)), ytr = train.map(s => s.label);
  const Xva = valid.map(s => applyStd(s.vector, mean, std)), yva = valid.map(s => s.label);
  const d = Xtr[0].length;
  let w = new Array(d).fill(0), b = 0;

  for (let ep = 0; ep < epochs; ep++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let i = 0; i < Xtr.length; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Xtr[i][j];
      const err = sigmoid(z) - ytr[i];
      for (let j = 0; j < d; j++) gw[j] += err * Xtr[i][j];
      gb += err;
    }
    const m = Xtr.length;
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / m + l2 * w[j]);
    b -= lr * (gb / m);
    // não travar a interface: cede o controle a cada 10 épocas
    if (ep % 10 === 0) {
      if (onProgress) onProgress((ep + 1) / epochs);
      await new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r()) : setTimeout(r, 0)));
    }
  }

  const trainMetrics = metrics(Xtr, ytr, w, b);
  const validMetrics = metrics(Xva, yva, w, b);
  const baseRate = validMetrics.baseRate;
  const baseBrier = baseRate === null ? null : baseRate * Math.pow(1 - baseRate, 2) + (1 - baseRate) * Math.pow(baseRate, 2);
  const weights = w.map((v, j) => ({ name: VECTOR_NAMES[j] || `f${j}`, weight: v })).sort((a, b2) => Math.abs(b2.weight) - Math.abs(a.weight));
  const overfit = trainMetrics.acc !== null && validMetrics.acc !== null && (trainMetrics.acc - validMetrics.acc) > 0.08;

  const gates = [];
  const gEnough = validMetrics.n >= minValid;
  gates.push({ ok: gEnough, text: `amostras de validação ${validMetrics.n} ${gEnough ? '≥' : '<'} mínimo ${minValid}` });
  const gBrier = baseBrier !== null && validMetrics.brier !== null && validMetrics.brier < baseBrier - 0.0005;
  gates.push({ ok: gBrier, text: `Brier ${validMetrics.brier === null ? '—' : validMetrics.brier.toFixed(4)} vs. taxa base ${baseBrier === null ? '—' : baseBrier.toFixed(4)} (precisa ser menor)` });
  const usable = gEnough && gBrier;
  const gateReason = usable ? null : gates.filter(g => !g.ok).map(g => g.text).join(' · ');

  const model = {
    ok: true, w, b, mean, std, trainMetrics, validMetrics, weights, overfit,
    baseRate, baseBrier, gates, gateReason, usable,
    trainedAt: Date.now(), samples: clean.length, minValid
  };
  if (onProgress) onProgress(1);
  return model;
}

export function predict(model, vector) {
  if (!model || !model.ok) return null;
  let z = model.b;
  const x = vector.map((v, j) => (v - model.mean[j]) / model.std[j]);
  for (let j = 0; j < model.w.length; j++) z += model.w[j] * x[j];
  return sigmoid(z);
}

export function saveModel(key, model) {
  if (!model || !model.ok) return;
  store.set(MODEL_KEY + '_' + key, {
    ok: true, w: model.w, b: model.b, mean: model.mean, std: model.std,
    trainMetrics: model.trainMetrics, validMetrics: model.validMetrics,
    weights: model.weights.slice(0, 10), overfit: model.overfit, usable: model.usable,
    baseRate: model.baseRate, baseBrier: model.baseBrier, gates: model.gates, gateReason: model.gateReason,
    trainedAt: model.trainedAt, samples: model.samples, minValid: model.minValid
  });
}
export function loadModel(key) { return store.get(MODEL_KEY + '_' + key, null); }
