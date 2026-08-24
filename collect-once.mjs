// collect-once.mjs — coleta + treino de UMA passada, para rodar via GitHub Actions (cron).
// Substitui a necessidade de um servidor pago 24/7: o workflow roda este script a cada
// N minutos, e os arquivos estáticos em backend-data/ são commitados de volta no repositório.
// O frontend lê esses arquivos como JSON estático (js/backend.js em modo MA_BACKEND_STATIC).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.document = { querySelector(){ return null; }, querySelectorAll(){ return []; } };
globalThis.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { getAsset } = await import('./js/assets.js');
const { TIMEFRAMES } = await import('./js/assets.js');
const { getCandles } = await import('./js/data.js');
const { buildSnapshotPool } = await import('./js/analyze.js');
const { trainLogistic } = await import('./js/ml.js');
const { fingerprint, rankSetups } = await import('./js/setups.js');
const { MIN_WARMUP } = await import('./js/features.js');

const DATA_DIR = path.join(__dirname, 'backend-data');
const CANDLES_DIR = path.join(DATA_DIR, 'candles');
const MODELS_DIR = path.join(DATA_DIR, 'models');
fs.mkdirSync(CANDLES_DIR, { recursive: true });
fs.mkdirSync(MODELS_DIR, { recursive: true });

const CONFIG = {
  assets: String(process.env.COLLECTOR_ASSETS || 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,LTCUSDT,EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,USDCHF,EURJPY,EURGBP,AUDJPY,EURAUD').split(',').map(s => s.trim()).filter(Boolean),
  tfs: String(process.env.COLLECTOR_TFS || 'M5,M15,H1').split(',').map(s => s.trim()).filter(s => TIMEFRAMES[s]),
  deep: Number(process.env.DEEP_CANDLES || 4000),
  maxStoredCandles: Number(process.env.MAX_STORED_CANDLES || 6000),
  minTrain: Number(process.env.MIN_TRAIN_SAMPLES || 400),
  trainIntervalMs: Number(process.env.TRAIN_INTERVAL_MS || 3 * 60 * 60 * 1000) // retreina no máx a cada 3h
};

function slug(assetId, tf) { return `${assetId}_${tf}`; }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }

function dedupeSort(candles) {
  const byT = new Map();
  for (const c of candles) byT.set(c.t, c);
  return Array.from(byT.values()).sort((a, b) => a.t - b.t);
}

async function collectAndMaybeTrain(asset, tf) {
  const candleFile = path.join(CANDLES_DIR, `${slug(asset.id, tf)}.json`);
  const modelFile = path.join(MODELS_DIR, `${slug(asset.id, tf)}.json`);
  const prev = readJson(candleFile, null);
  const needsBootstrap = !prev || !Array.isArray(prev.candles) || prev.candles.length < 800;

  const d = await getCandles(asset, tf, {
    depth: needsBootstrap ? 'deep' : 'live',
    target: needsBootstrap ? CONFIG.deep : 400,
    force: true,
    skipBackend: true // o próprio coletor é a fonte; não faz sentido chamar a si mesmo
  });
  if (!d || !d.candles || d.candles.length < 30) return { ok: false, reason: 'sem candles novos' };

  const merged = dedupeSort((prev?.candles || []).concat(d.candles)).slice(-CONFIG.maxStoredCandles);
  const rec = { assetId: asset.id, tf, source: d.source, hasVolume: d.hasVolume, updatedAt: Date.now(), candles: merged };
  writeJson(candleFile, rec);

  // Retreina só de tempos em tempos (evita reprocessar tudo a cada 15 min).
  const prevModel = readJson(modelFile, null);
  const stale = !prevModel || (Date.now() - (prevModel.trainedAt || 0)) >= CONFIG.trainIntervalMs;
  if (!stale) return { ok: true, candles: merged.length, trained: false };
  if (merged.length < MIN_WARMUP + 100) return { ok: true, candles: merged.length, trained: false, reason: 'histórico insuficiente pro treino' };

  const { snaps } = buildSnapshotPool(merged, d.hasVolume, { zoneLookback: 160, max: Math.min(merged.length - 1, 5000) });
  const samples = snaps.filter(s => s.nextDir !== null).map(s => ({ vector: s.vector, label: s.nextDir > 0 ? 1 : 0 }));
  if (samples.length < CONFIG.minTrain) return { ok: true, candles: merged.length, trained: false, reason: `amostras ${samples.length} < ${CONFIG.minTrain}` };

  const model = trainLogistic(samples, { epochs: 350, minValid: Math.max(150, Math.floor(samples.length * 0.2)) });
  const rows = [];
  for (let i = 0; i < snaps.length - 1; i++) {
    const s = snaps[i];
    const dir = s.vector ? (s.nextDir || 0) : 0;
    if (!dir) continue;
    const fp = fingerprint(s, [{ tf, isMain: true, dir: Math.sign(s.vector[0] || 0) }], dir);
    rows.push({ setupId: fp.id, setupLabel: fp.label, signal: dir > 0 ? 'COMPRA' : 'VENDA', result: s.nextDir === dir ? 'ACERTO' : 'ERRO' });
  }
  const ranking = rankSetups(rows, { minSamples: 40, payout: 0.85 });
  writeJson(modelFile, { ...model, trainedAt: Date.now(), samples: samples.length, setupClasses: ranking.classes, eligibleSetups: ranking.eligibleCount });
  return { ok: true, candles: merged.length, trained: true, samples: samples.length, modelUsable: !!model.usable };
}

async function main() {
  const assets = CONFIG.assets.map(getAsset).filter(Boolean);
  const results = [];
  for (const asset of assets) {
    for (const tf of CONFIG.tfs) {
      try {
        const r = await collectAndMaybeTrain(asset, tf);
        results.push({ asset: asset.id, tf, ...r });
        console.log(`${asset.id} ${tf}:`, JSON.stringify(r));
      } catch (e) {
        results.push({ asset: asset.id, tf, ok: false, reason: e.message });
        console.error(`${asset.id} ${tf}: ERRO ${e.message}`);
      }
    }
  }
  writeJson(path.join(DATA_DIR, 'stats.json'), { updatedAt: Date.now(), results });
  writeJson(path.join(DATA_DIR, 'health.json'), { ok: true, service: 'market-analyzer-collect-once', time: Date.now(), assets: assets.length, tfs: CONFIG.tfs });
}

main().catch(e => { console.error('Falha geral:', e); process.exit(1); });
