// probability.js — probabilidade histórica por analogia (não é o score!)
// Procura situações passadas com "impressão digital" semelhante e mede o que a PRÓXIMA vela fez.
import { bucketDistance } from './features.js';

/**
 * @param snaps array de snapshots (ordem cronológica) — o último é o atual
 * @param current snapshot atual
 * @param opts { maxNeighbors, maxDistance, minSamples }
 */
export function historicalProbability(snaps, current, opts = {}) {
  const maxNeighbors = opts.maxNeighbors || 250;
  const baseDistance = opts.maxDistance ?? 6;
  const minSamples = opts.minSamples ?? 30;
  const relax = opts.relax !== false;               // amplia o raio até 1,5x se faltar amostra

  const all = [];
  for (const s of snaps) {
    if (!s || s.i >= current.i) continue;            // apenas o passado
    if (s.nextDir === undefined || s.nextDir === null) continue;
    if (s.nextDir === 0) continue;   // velas neutras (doji/preço parado) NÃO contam como baixa
    const d = bucketDistance(s.buckets, current.buckets);
    all.push({ d, up: s.nextDir > 0 ? 1 : 0 });
  }
  all.sort((a, b) => a.d - b.d);

  // raio efetivo: começa no limite configurado; se não houver amostra suficiente,
  // amplia em passos até 1,5x o limite (fica registrado em `relaxedTo`).
  const steps = relax ? [1, 1.15, 1.3, 1.5] : [1];
  let maxDistance = baseDistance, used = [];
  for (const f of steps) {
    maxDistance = baseDistance * f;
    used = all.filter(x => x.d <= maxDistance).slice(0, maxNeighbors);
    if (used.length >= minSamples) break;
  }
  const relaxedTo = maxDistance > baseDistance + 1e-9 ? maxDistance : null;
  const samples = used.length;
  const up = used.reduce((s, x) => s + x.up, 0);
  const down = samples - up;

  if (samples < minSamples) {
    return { insufficient: true, samples, up, down, minSamples, maxDistance, baseDistance, relaxedTo,
      pUp: null, pDown: null, ciLow: null, ciHigh: null, direction: 0,
      text: `amostra insuficiente (${samples} de ${minSamples} situações mínimas)` };
  }

  // Laplace + intervalo de Wilson 95%
  const pUp = (up + 1) / (samples + 2);
  const z = 1.96;
  const phat = up / samples;
  const denom = 1 + z * z / samples;
  const center = (phat + z * z / (2 * samples)) / denom;
  const margin = (z * Math.sqrt(phat * (1 - phat) / samples + z * z / (4 * samples * samples))) / denom;
  const ciLow = Math.max(0, center - margin), ciHigh = Math.min(1, center + margin);

  const direction = pUp > 0.5 ? 1 : pUp < 0.5 ? -1 : 0;
  const dominant = Math.max(pUp, 1 - pUp);
  // significância: o intervalo de confiança não deve cruzar 50%
  const significant = (direction > 0 && ciLow > 0.5) || (direction < 0 && ciHigh < 0.5);

  return {
    insufficient: false, samples, up, down, minSamples, maxDistance, baseDistance, relaxedTo,
    pUp, pDown: 1 - pUp, dominant, ciLow, ciHigh, direction, significant,
    avgDistance: used.reduce((s, x) => s + x.d, 0) / samples,
    text: `${samples} situações históricas semelhantes → alta: ${up} / baixa: ${down}`
  };
}

/**
 * Anexa a direção da próxima vela a cada snapshot (rótulo supervisionado).
 */
export function labelSnapshots(snaps, candles) {
  for (const s of snaps) {
    if (!s) continue;
    const next = candles[s.i + 1];
    s.nextDir = next ? Math.sign(next.c - next.o === 0 ? next.c - candles[s.i].c : next.c - next.o) : null;
    if (next) {
      const dir = next.c > s.candle.c ? 1 : next.c < s.candle.c ? -1 : 0;
      s.nextDir = dir; // fechamento da próxima vela vs fechamento atual (padrão de opções binárias)
      s.nextChangePct = ((next.c - s.candle.c) / s.candle.c) * 100;
    }
  }
  return snaps;
}
