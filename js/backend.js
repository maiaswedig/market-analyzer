// Bridge opcional entre o frontend e o backend autônomo.
// MA_BACKEND_STATIC=true: sem servidor — os dados vêm de arquivos JSON estáticos em
// backend-data/, atualizados por um workflow do GitHub Actions (grátis, sem servidor pago).
const configured = (typeof window !== 'undefined' && window.MA_BACKEND_URL) || '';
export const BACKEND_URL = configured.replace(/\/$/,'');
const STATIC_MODE = typeof window !== 'undefined' && !!window.MA_BACKEND_STATIC;
const STATIC_BASE = ((typeof window !== 'undefined' && window.MA_BACKEND_STATIC_BASE) || 'backend-data').replace(/\/$/,'');
export const backendEnabled = STATIC_MODE || !!BACKEND_URL || (typeof location !== 'undefined' && location.protocol.startsWith('http'));

function staticPath(pathname){
  const u = new URL(pathname, 'http://x');
  const asset = u.searchParams.get('asset'), tf = u.searchParams.get('tf');
  if (u.pathname === '/api/candles' && asset && tf) return `${STATIC_BASE}/candles/${asset}_${tf}.json`;
  if (u.pathname === '/api/model' && asset && tf) return `${STATIC_BASE}/models/${asset}_${tf}.json`;
  if (u.pathname === '/api/stats') return `${STATIC_BASE}/stats.json`;
  if (u.pathname === '/api/health') return `${STATIC_BASE}/health.json`;
  return null;
}

export function apiUrl(pathname){
  if (STATIC_MODE) { const p = staticPath(pathname); if (p) return `${p}?t=${Date.now()}`; } // t= evita cache do navegador
  const base = BACKEND_URL || '';
  return `${base}${pathname.startsWith('/')?pathname:'/'+pathname}`;
}
export async function backendGet(pathname, timeout=2500){
  const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),timeout);
  try{ const r=await fetch(apiUrl(pathname),{signal:ctl.signal,cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status); return await r.json(); }
  finally{clearTimeout(timer);}
}
export async function backendHealth(){ try{return await backendGet('/api/health',1800);}catch{return null;} }
