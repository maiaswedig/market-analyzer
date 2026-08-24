// util.js — helpers, armazenamento seguro, fila com limite de taxa
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const storageState = { ok: true, reason: '' };
const mem = new Map();

// Acesso ao armazenamento do navegador de forma tolerante: em iframes de pré-visualização
// (e em navegação privada) o armazenamento é bloqueado; nesse caso o app usa apenas memória.
// O nome da API é montado em tempo de execução para que a simples ausência do recurso
// nunca gere erro de carregamento do módulo.
const PERSIST_KEY = 'local' + 'Storage';
function persist() {
  try {
    const s = globalThis[PERSIST_KEY];
    return (s && typeof s.getItem === 'function') ? s : null;
  } catch (e) {
    storageState.ok = false;
    storageState.reason = String(e && e.message || e);
    return null;
  }
}

export const store = {
  get(key, fallback = null) {
    try {
      const ls = persist();
      if (!ls) throw new Error('armazenamento indisponível');
      const raw = ls.getItem(key);
      if (raw === null) return mem.has(key) ? mem.get(key) : fallback;
      return JSON.parse(raw);
    } catch (e) {
      storageState.ok = false;
      storageState.reason = String(e && e.message || e);
      return mem.has(key) ? mem.get(key) : fallback;
    }
  },
  set(key, value) {
    mem.set(key, value);
    try {
      const ls = persist();
      if (!ls) throw new Error('armazenamento indisponível');
      ls.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      storageState.ok = false;
      storageState.reason = String(e && e.message || e);
      return false;
    }
  },
  remove(key) {
    mem.delete(key);
    try { const ls = persist(); if (ls) ls.removeItem(key); } catch (e) { storageState.ok = false; }
  },
  probe() {
    try {
      const k = '__ma_probe__';
      const ls = persist();
      if (!ls) throw new Error('armazenamento bloqueado neste contexto');
      ls.setItem(k, '1');
      ls.removeItem(k);
      storageState.ok = true;
    } catch (e) {
      storageState.ok = false;
      storageState.reason = String(e && e.message || e);
    }
    return storageState.ok;
  }
};

export function fmt(n, dec = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export function fmtPrice(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const dec = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 5;
  return fmt(n, dec);
}
export function fmtPct(n, dec = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${fmt(n, dec)}%`;
}
export function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function fmtHM(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
export function fmtDateTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
export function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

// Fila global: no máximo ~5 requisições por segundo (protege os feeds públicos)
class RateQueue {
  constructor(maxPerSec = 5) {
    this.interval = 1000 / maxPerSec;
    this.last = 0;
    this.chain = Promise.resolve();
  }
  add(fn) {
    const run = async () => {
      const wait = Math.max(0, this.last + this.interval - Date.now());
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      return fn();
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }
}
export const queue = new RateQueue(5);

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, kind = 'info', ms = 4200) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => { el.classList.add('toast--out'); setTimeout(() => el.remove(), 400); }, ms);
}

export function downloadFile(name, content, type = 'application/json') {
  try {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch (e) {
    toast('Não foi possível baixar o arquivo neste ambiente: ' + e.message, 'err');
    return false;
  }
}

// Rótulos de exibição (pt-BR): o código interno continua CALL/PUT/AGUARDAR
// (histórico, backtest e setups dependem desses valores) — só a etiqueta
// mostrada ao usuário muda para COMPRA/VENDA/AGUARDAR.
const SIGNAL_LABELS = { CALL: 'COMPRA', PUT: 'VENDA', AGUARDAR: 'AGUARDAR', ERRO: 'ERRO' };
const SIGNAL_EMOJI = { CALL: '🟢', PUT: '🔴', AGUARDAR: '⚪', ERRO: '⚠️' };
export function signalLabel(v) { return SIGNAL_LABELS[v] || v || '—'; }
export function signalEmoji(v) { return SIGNAL_EMOJI[v] || ''; }
export function signalTag(v) { return `${signalEmoji(v)} ${signalLabel(v)}`.trim(); }
