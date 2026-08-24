// decision.js — decisão por EXPECTATIVA MATEMÁTICA (substitui o veto rígido de "probabilidade mínima").
//
// Três métricas SEPARADAS, cada uma com origem e amostra:
//   score  → força de confluência técnica (score.js), nunca taxa de acerto
//   pModel → probabilidade do modelo calibrado (ml.js), só quando passa nas travas de validação
//   pHist  → taxa histórica de situações análogas / classe de setup, com N amostras
// Se nenhuma estimativa estatística é elegível, a UI mostra
// "⚠️ Dados insuficientes para estimativa estatística." e a decisão fica com score + travas.

export const INSUFFICIENT = '⚠️ Dados insuficientes para estimativa estatística.';

/** Taxa de acerto de equilíbrio para um payout (fração, ex.: 0,85). */
export function breakEvenRate(payout) { return 1 / (1 + payout); }

/** EV por operação em R$: p·payout·stake − (1−p)·stake. */
export function expectancy(p, payout, stake = 1) { return p * payout * stake - (1 - p) * stake; }

function wilson(hits, n) {
  if (!n) return { low: null, high: null, p: null };
  const z = 1.96, phat = hits / n;
  const denom = 1 + z * z / n;
  const center = (phat + z * z / (2 * n)) / denom;
  const margin = (z * Math.sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))) / denom;
  return { p: phat, low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/**
 * Escolhe a melhor estimativa DISPONÍVEL de p (probabilidade de a direção escolhida vencer).
 * Ordem: classe de setup (amostra dedicada) → análogos históricos → modelo calibrado.
 */
export function pickEstimate({ direction, setupStats, hist, ml, cfg }) {
  const minSetup = cfg.minSetupSamples ?? 15;
  const minHist = cfg.minSamples ?? 30;

  if (setupStats && setupStats.samples >= minSetup && setupStats.rate !== null) {
    const ci = wilson(setupStats.hits, setupStats.total);
    return {
      p: (setupStats.hits + 1) / (setupStats.total + 2), source: 'classe de setup (backtest + histórico real)',
      samples: setupStats.total, ciLow: ci.low, ciHigh: ci.high, kind: 'setup'
    };
  }
  if (hist && !hist.insufficient) {
    const pDir = direction > 0 ? hist.pUp : hist.pDown;
    const hits = direction > 0 ? hist.up : hist.down;
    const ci = wilson(hits, hist.samples);
    if (hist.samples >= minHist) {
      return {
        p: pDir, source: `análogos históricos (distância ≤ ${hist.maxDistance.toFixed(1)})`,
        samples: hist.samples, ciLow: ci.low, ciHigh: ci.high, kind: 'analogo'
      };
    }
  }
  if (ml && ml.usable && ml.p !== null && ml.p !== undefined) {
    const pDir = direction > 0 ? ml.p : 1 - ml.p;
    return {
      p: pDir, source: `modelo calibrado (Brier ${ml.brier !== null && ml.brier !== undefined ? ml.brier.toFixed(4) : '—'})`,
      samples: ml.validN || null, ciLow: null, ciHigh: null, kind: 'ml'
    };
  }
  return { p: null, source: null, samples: 0, ciLow: null, ciHigh: null, kind: 'nenhuma', insufficient: true };
}

/**
 * Decisão final.
 * @returns { verdict, gates, ev, evPct, estimate, breakEven, reasons, blocked }
 */
export function decide({ score, mtf, cond, hist, ml, setupStats, cfg, brokerDivergence = null }) {
  const payout = (Number(cfg.payout) || 85) / 100;
  const stake = Number(cfg.stake) || 5;
  const direction = score.direction;
  const gates = [];
  const reasons = [];
  const gate = (ok, okText, failText, blocking = true) => {
    gates.push({ ok: !!ok, text: ok ? okText : failText, blocking });
    if (!ok && blocking) reasons.push(failText);
    return !!ok;
  };

  const gDir = gate(direction !== 0, 'direção técnica definida', 'categorias se anulam — sem direção definida');
  const gScore = gate(score.score >= cfg.minScore, `score ${score.score} ≥ mínimo ${cfg.minScore}`, `score ${score.score} abaixo do mínimo ${cfg.minScore}`);
  const gBlock = gate(score.blocking.length === 0, 'nenhum bloqueio técnico', `bloqueio: ${score.blocking.map(b => b.name).join(', ')}`);
  const gConf = gate(!cfg.minConfluence || !score.confluence.total || score.confluence.agree >= cfg.minConfluence,
    `confluência ${score.confluence.text}`, `confluência ${score.confluence.text} abaixo do mínimo (${cfg.minConfluence})`);
  const gBroker = gate(!brokerDivergence || !brokerDivergence.divergent, 'feed conferido com a corretora',
    `feed divergente (${brokerDivergence ? brokerDivergence.reason : ''})`);

  const estimate = pickEstimate({ direction, setupStats, hist, ml, cfg });
  const breakEven = breakEvenRate(payout);

  // Modo Alta Probabilidade: sem evidência estatística suficiente, NÃO existe sinal.
  // A ferramenta deixa de transformar score técnico em uma falsa probabilidade.
  let gProbability = true;
  if (cfg.highProbabilityMode) {
    const minP = Number(cfg.minProbability) || 0.65;
    const minN = Number(cfg.minProbabilitySamples) || 60;
    const enough = estimate.p !== null && Number(estimate.samples || 0) >= minN;
    const pOk = enough && estimate.p >= minP;
    let ciOk = true;
    if (cfg.requireProbabilityCIAboveBreakEven && estimate.ciLow !== null && estimate.ciLow !== undefined) {
      ciOk = estimate.ciLow >= breakEvenRate(payout);
    } else if (cfg.requireProbabilityCIAboveBreakEven && estimate.ciLow === null) {
      ciOk = false;
    }
    gProbability = pOk && ciOk;
    const details = !enough
      ? `estatística insuficiente: ${estimate.samples || 0}/${minN} situações resolvidas`
      : !pOk
        ? `probabilidade ${((estimate.p || 0) * 100).toFixed(1)}% abaixo do mínimo ${(minP * 100).toFixed(0)}%`
        : !ciOk
          ? `IC95% inferior ${(estimate.ciLow * 100).toFixed(1)}% não supera o equilíbrio ${(breakEvenRate(payout) * 100).toFixed(1)}%`
          : `alta probabilidade confirmada: ${(estimate.p * 100).toFixed(1)}% · N=${estimate.samples}`;
    gates.push({ ok: gProbability, text: details, blocking: true, kind: 'probability' });
    if (!gProbability) reasons.push(details);
  }
  let ev = null, evOk = true, evText = INSUFFICIENT;
  if (estimate.p !== null) {
    ev = expectancy(estimate.p, payout, stake);
    const evLow = estimate.ciLow !== null ? expectancy(estimate.ciLow, payout, stake) : null;
    const confidentlyNegative = estimate.ciHigh !== null ? estimate.ciHigh < breakEven : ev < 0 && (estimate.samples || 0) >= 60;
    evOk = cfg.evGate === 'bloquear' ? ev > (Number(cfg.minEv) || 0) : !confidentlyNegative;
    const negative = ev <= 0;
    evText = !evOk
      ? `expectativa matemática negativa: p=${(estimate.p * 100).toFixed(1)}% abaixo do equilíbrio de ${(breakEven * 100).toFixed(1)}% para payout ${(payout * 100).toFixed(0)}% (${estimate.source}, N=${estimate.samples || '—'})`
      : negative
        ? `⚠️ expectativa NEGATIVA de R$ ${ev.toFixed(3)} por operação de R$ ${stake} (p=${(estimate.p * 100).toFixed(1)}% vs. equilíbrio ${(breakEven * 100).toFixed(1)}% · ${estimate.source} · N=${estimate.samples || '—'}) — amostra não conclusiva (IC95% cruza o equilíbrio), sinal mantido só com aviso`
        : `expectativa +R$ ${ev.toFixed(3)} por operação de R$ ${stake} (p=${(estimate.p * 100).toFixed(1)}% · ${estimate.source} · N=${estimate.samples || '—'})`;
    gates.push({ ok: evOk, warn: evOk && negative, text: evText, blocking: true, kind: 'ev', evLow });
    if (!evOk) reasons.push(evText);
  } else {
    // NÃO é veto: sem estimativa confiável o sistema decide por score + travas, e avisa.
    gates.push({ ok: true, text: INSUFFICIENT + ' A decisão usa apenas score técnico e travas de risco.', blocking: false, kind: 'ev' });
  }

  const pass = gDir && gScore && gBlock && gConf && gBroker && evOk && gProbability;
  const verdict = pass ? (direction > 0 ? 'CALL' : 'PUT') : 'AGUARDAR';

  return {
    verdict, direction, gates, reasons,
    ev, evPerReal: ev === null ? null : ev / stake,
    estimate, breakEven, payout, stake,
    blocked: !gBlock || !gBroker
  };
}

/** Bullets curtos do "Por quê?" (3 a 5 itens). */
export function whyBullets({ score, decision, cond, snap, mtf }) {
  const bullets = [];
  const dirWord = score.direction > 0 ? 'comprador' : score.direction < 0 ? 'vendedor' : 'indefinido';
  const cats = score.categories.slice().sort((a, b) => Math.abs(b.bias * b.weight) - Math.abs(a.bias * a.weight));
  if (decision.verdict === 'AGUARDAR') {
    for (const m of mtf.filter(x => !x.unavailable)) bullets.push(`${m.tf} ${m.dir > 0 ? 'comprador' : m.dir < 0 ? 'vendedor' : 'lateral'}`);
    const failed = decision.gates.filter(g => !g.ok && g.blocking);
    for (const f of failed.slice(0, 3)) bullets.push(f.text);
    if (cond) bullets.push(`condição: ${cond.label.toLowerCase()}`);
    if (snap.volume.available && snap.volume.rel !== null && snap.volume.rel < 0.9) bullets.push('volume abaixo da média');
    return bullets.slice(0, 6);
  }
  bullets.push(`viés ${dirWord} em ${cats.filter(c => Math.sign(c.bias) === score.direction).length} de ${score.categories.length} categorias`);
  for (const c of cats.slice(0, 2)) bullets.push(`${c.label}: ${c.sub}/100 — ${c.detail}`);
  bullets.push(`confluência multi-TF ${score.confluence.text}${cond ? ` · ${cond.label.toLowerCase()}` : ''}`);
  if (decision.ev !== null && decision.ev <= 0) bullets.push(`⚠️ expectativa matemática negativa (R$ ${decision.ev.toFixed(3)} por operação) com o payout configurado — o sinal técnico existe, o retorno esperado não`);
  if (snap.priceAction && snap.priceAction.events.length) bullets.push(snap.priceAction.summary);
  if (decision.estimate.p !== null) bullets.push(`estimativa ${(decision.estimate.p * 100).toFixed(1)}% (${decision.estimate.source}, N=${decision.estimate.samples || '—'})`);
  else bullets.push(INSUFFICIENT);
  return bullets.slice(0, 5);
}
