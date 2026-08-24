import { ASSETS, TF_LIST, MTF_CONTEXT, getAsset } from './assets.js';
import { loadCandles, loadHealth, clearCache } from './data.js';
import { buildIndicators, evaluateAt, historicalStats, gradeOf } from './engine.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  rows: [],
  busy: false,
  filters: { grade: 'todas', signal: 'all', scoreMin: 0 }
};

function fmt(v, d = 1) { return (v == null || Number.isNaN(v)) ? '—' : Number(v).toFixed(d); }
function fmtPct(v) { return v == null ? '—' : `${v.toFixed(1)}%`; }
function signalLabel(dir) { return dir > 0 ? 'COMPRA' : dir < 0 ? 'VENDA' : 'AGUARDAR'; }
function signalClass(dir) { return dir > 0 ? 'sig-call' : dir < 0 ? 'sig-put' : 'sig-wait'; }
function gradeClass(g) { return 'grade-' + g.replace('+', 'plus'); }

async function analyzeAssetTf(asset, tf) {
  const data = await loadCandles(asset.id, tf);
  const candles = data.candles.filter(c => c.closed !== false);
  if (candles.length < 220) throw new Error('histórico insuficiente');
  const ind = buildIndicators(candles);
  const i = candles.length - 1;

  // contexto multi-timeframe: usa o candle mais recente de cada TF de contexto
  const mtfDirs = [];
  for (const ctxTf of (MTF_CONTEXT[tf] || [])) {
    try {
      const ctxData = await loadCandles(asset.id, ctxTf);
      const ctxCandles = ctxData.candles.filter(c => c.closed !== false);
      if (ctxCandles.length >= 220) {
        const ctxInd = buildIndicators(ctxCandles);
        const ctxEval = evaluateAt(ctxCandles, ctxInd, ctxCandles.length - 1, []);
        mtfDirs.push(ctxEval.direction);
      }
    } catch (e) { /* contexto opcional */ }
  }

  const ev = evaluateAt(candles, ind, i, mtfDirs);
  const hist = historicalStats(candles, ind, i, ev.direction, 400);
  const agree = mtfDirs.filter(d => d === ev.direction && ev.direction !== 0).length;
  const confluenceRatio = mtfDirs.length ? agree / mtfDirs.length : (ev.direction !== 0 ? 1 : 0);
  const grade = gradeOf(ev.score, confluenceRatio, hist.rate, hist.samples);

  return {
    asset, tf, direction: ev.direction, score: ev.score, categories: ev.categories,
    price: ev.price, time: ev.time, hist, grade: grade.grade, gradePoints: grade.points,
    confluence: `${agree}/${mtfDirs.length}`, source: data.source, updatedAt: data.updatedAt
  };
}

async function runScan() {
  if (state.busy) return;
  state.busy = true;
  $('#scanBtn').disabled = true;
  $('#scanBtn').textContent = 'Analisando...';
  const prog = $('#scanProgress'); prog.hidden = false;
  const bar = prog.querySelector('.bar-fill'), lab = prog.querySelector('.bar-label');
  clearCache();
  state.rows = [];

  const jobs = [];
  for (const tf of TF_LIST) for (const a of ASSETS) jobs.push({ asset: a, tf });

  for (let idx = 0; idx < jobs.length; idx++) {
    const { asset, tf } = jobs[idx];
    lab.textContent = `${idx + 1}/${jobs.length} — ${asset.name} ${tf}`;
    bar.style.width = `${((idx + 1) / jobs.length) * 100}%`;
    try {
      const r = await analyzeAssetTf(asset, tf);
      state.rows.push(r);
    } catch (e) {
      state.rows.push({ asset, tf, error: e.message });
    }
    if (idx % 5 === 0) renderTable();
  }
  renderTable();
  renderSummary();
  prog.hidden = true;
  $('#scanBtn').disabled = false;
  $('#scanBtn').textContent = '🔎 BUSCAR MELHORES SINAIS';
  state.busy = false;
}

function rankScore(r) {
  if (!r || r.error || r.direction === 0) return -Infinity;
  const gPts = { 'A+': 5, A: 4, B: 3, C: 2, D: 1 }[r.grade] || 0;
  const histBonus = r.hist.rate != null ? (r.hist.rate - 50) * 0.4 : 0;
  return r.score * 0.6 + gPts * 8 + histBonus;
}

function applyFilters(rows) {
  let out = rows.filter(r => !r.error);
  const { grade, signal, scoreMin } = state.filters;
  if (signal === 'signals') out = out.filter(r => r.direction !== 0);
  else if (signal === 'CALL') out = out.filter(r => r.direction > 0);
  else if (signal === 'PUT') out = out.filter(r => r.direction < 0);
  if (grade !== 'todas') out = out.filter(r => r.grade === grade);
  out = out.filter(r => r.direction === 0 || r.score >= scoreMin);
  return out;
}

function renderTable() {
  const errors = state.rows.filter(r => r.error);
  const rows = applyFilters(state.rows).slice().sort((a, b) => rankScore(b) - rankScore(a));

  $('#resultsMeta').textContent = `${rows.length} de ${state.rows.length} análises · ${errors.length} sem dados`;

  if (!rows.length) {
    $('#resultsBody').innerHTML = `<tr><td colspan="8" class="muted center">Nenhuma linha para os filtros atuais. Ajuste os filtros acima ou rode a análise.</td></tr>`;
    return;
  }

  $('#resultsBody').innerHTML = rows.map((r, i) => `
    <tr class="clickable" data-asset="${r.asset.id}" data-tf="${r.tf}">
      <td>${['🥇','🥈','🥉'][i] || (i + 1)}</td>
      <td><strong>${r.asset.name}</strong><br><span class="muted small">${r.asset.group}</span></td>
      <td class="mono">${r.tf}</td>
      <td><span class="badge ${signalClass(r.direction)}">${signalLabel(r.direction)}</span></td>
      <td class="num">${fmt(r.score)}</td>
      <td><span class="gradepill ${gradeClass(r.grade)}">${r.grade}</span></td>
      <td class="num">${r.hist.samples >= 10 ? fmtPct(r.hist.rate) + `<br><span class="muted small">N=${r.hist.samples}</span>` : '<span class="muted">insuf.</span>'}</td>
      <td class="mono small">${r.confluence}</td>
    </tr>`).join('');

  $$('#resultsBody tr.clickable').forEach(tr => tr.addEventListener('click', () => showDetail(tr.dataset.asset, tr.dataset.tf)));
}

function renderSummary() {
  const done = state.rows.filter(r => !r.error);
  const call = done.filter(r => r.direction > 0).length;
  const put = done.filter(r => r.direction < 0).length;
  const wait = done.filter(r => r.direction === 0).length;
  const gradeCount = { 'A+': 0, A: 0, B: 0, C: 0, D: 0 };
  done.forEach(r => { if (r.direction !== 0) gradeCount[r.grade] = (gradeCount[r.grade] || 0) + 1; });
  const best = done.filter(r => r.direction !== 0).sort((a, b) => rankScore(b) - rankScore(a))[0];

  $('#summaryCard').innerHTML = `
    <div class="stat-grid">
      <div class="stat"><span>Total analisado</span><b>${done.length}</b></div>
      <div class="stat"><span>Compra</span><b class="sig-call">${call}</b></div>
      <div class="stat"><span>Venda</span><b class="sig-put">${put}</b></div>
      <div class="stat"><span>Aguardar</span><b class="sig-wait">${wait}</b></div>
    </div>
    <div class="grade-bar">
      ${Object.entries(gradeCount).map(([g, n]) => `<div class="grade-chip ${gradeClass(g)}">${g}: ${n}</div>`).join('')}
    </div>
    ${best ? `
    <div class="best-box">
      <div class="best-head">🏆 Melhor sinal desta varredura</div>
      <div class="best-body">
        <strong>${best.asset.name} · ${best.tf}</strong>
        <span class="badge ${signalClass(best.direction)}">${signalLabel(best.direction)}</span>
        <span class="gradepill ${gradeClass(best.grade)}">${best.grade}</span>
        <span class="muted small">score ${fmt(best.score)} · histórico ${best.hist.samples >= 10 ? fmtPct(best.hist.rate) : 'insuf.'} (N=${best.hist.samples})</span>
      </div>
    </div>` : '<p class="muted">Nenhum sinal de compra/venda nesta varredura — apenas AGUARDAR.</p>'}
  `;
}

function showDetail(assetId, tf) {
  const r = state.rows.find(x => x.asset.id === assetId && x.tf === tf);
  if (!r || r.error) return;
  const modal = $('#detailModal');
  modal.hidden = false;
  $('#detailBody').innerHTML = `
    <div class="detail-head">
      <h3>${r.asset.name} · ${r.tf}</h3>
      <span class="badge ${signalClass(r.direction)}">${signalLabel(r.direction)}</span>
      <span class="gradepill ${gradeClass(r.grade)}">${r.grade}</span>
    </div>
    <p class="mono small">Preço no fechamento analisado: ${r.price} · Fonte: ${r.source} · Atualizado: ${new Date(r.updatedAt).toLocaleString('pt-BR')}</p>
    <h4>Categorias do score (peso · viés · sub-score)</h4>
    <div class="cat-list">
      ${r.categories.map(c => `
        <div class="cat-row">
          <div class="cat-label">${c.label} <span class="muted small">peso ${c.weight}</span></div>
          <div class="cat-bar"><i style="width:${clampPct(c.sub)}%; background:${c.bias >= 0 ? 'var(--call)' : 'var(--put)'}"></i></div>
          <div class="cat-sub mono">${fmt(c.sub, 0)}</div>
        </div>
        <p class="muted small cat-detail">${c.detail}</p>
      `).join('')}
    </div>
    <h4>Estatística histórica (causal, sem look-ahead)</h4>
    <p class="small">Nas últimas ${r.hist.samples} vezes em que o motor identificou exatamente esta direção neste ativo/timeframe,
      a vela seguinte confirmou em <strong>${fmtPct(r.hist.rate)}</strong> dos casos (${r.hist.hits} acertos).
      ${r.hist.samples < 30 ? '<br><span class="muted">Amostra pequena — trate com cautela.</span>' : ''}</p>
    <h4>Confluência multi-timeframe</h4>
    <p class="small">${r.confluence} timeframes de contexto concordam com esta direção.</p>
  `;
}
function clampPct(v) { return Math.max(2, Math.min(100, v)); }

function bindEvents() {
  $('#scanBtn').addEventListener('click', runScan);
  $('#filterGrade').addEventListener('change', (e) => { state.filters.grade = e.target.value; renderTable(); });
  $('#filterSignal').addEventListener('change', (e) => { state.filters.signal = e.target.value; renderTable(); });
  $('#filterScore').addEventListener('input', (e) => { state.filters.scoreMin = Number(e.target.value); $('#filterScoreVal').textContent = e.target.value; renderTable(); });
  $('#detailClose').addEventListener('click', () => { $('#detailModal').hidden = true; });
  $('#detailModal').addEventListener('click', (e) => { if (e.target.id === 'detailModal') $('#detailModal').hidden = true; });
}

async function init() {
  bindEvents();
  try {
    const health = await loadHealth();
    if (health) {
      $('#healthBadge').textContent = `Backend OK · ${health.assets} ativos · atualizado ${new Date(health.time).toLocaleTimeString('pt-BR')}`;
      $('#healthBadge').classList.add('badge--ok');
    } else {
      $('#healthBadge').textContent = 'Backend indisponível — verifique backend-data/health.json';
      $('#healthBadge').classList.add('badge--err');
    }
  } catch (e) {
    $('#healthBadge').textContent = 'Erro ao checar backend';
    $('#healthBadge').classList.add('badge--err');
  }
}
init();
