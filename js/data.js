// data.js — leitura dos dados coletados pelo backend (GitHub Actions -> backend-data/*.json)
const BASE = 'backend-data';
const cache = new Map();

export async function loadCandles(assetId, tf) {
  const key = `${assetId}_${tf}`;
  if (cache.has(key)) return cache.get(key);
  const url = `${BASE}/candles/${key}.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`sem dados para ${assetId} ${tf}`);
  const json = await res.json();
  cache.set(key, json);
  return json;
}

export async function loadHealth() {
  const res = await fetch(`${BASE}/health.json`, { cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export function clearCache() { cache.clear(); }
