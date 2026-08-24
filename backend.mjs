import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Browser-only globals used by the shared analyzer modules.
globalThis.document = { querySelector(){ return null; }, querySelectorAll(){ return []; } };
globalThis.localStorage = { getItem(){return null;}, setItem(){}, removeItem(){} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'backend-data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'database.json');
const STATE_FILE = path.join(DATA_DIR, 'collector-state.json');
const FRONTEND_DIR = __dirname;

const { ASSETS, TIMEFRAMES, getAsset } = await import('./js/assets.js');
const { getCandles, clearCache } = await import('./js/data.js');
const { buildSnapshotPool, DEFAULT_SETTINGS, evaluateBar } = await import('./js/analyze.js');
const { trainLogistic, predict } = await import('./js/ml.js');
const { fingerprint, rankSetups } = await import('./js/setups.js');
const { MIN_WARMUP } = await import('./js/features.js');

function loadJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function saveJson(file, value) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file); }
const db = loadJson(DB_FILE, { candles:{}, models:{}, setupRecords:[], signalLog:[], stats:{} });
const state = loadJson(STATE_FILE, { running:false, cycle:0, startedAt:null, lastCycleAt:null, lastTrainAt:null, lastError:null, progress:null });
function persist(){ saveJson(DB_FILE, db); saveJson(STATE_FILE, state); }

const CONFIG = {
  assets: String(process.env.COLLECTOR_ASSETS || 'BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,BNBUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,LTCUSDT,EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,USDCHF,EURJPY,EURGBP,AUDJPY,EURAUD').split(',').map(s=>s.trim()).filter(Boolean),
  tfs: String(process.env.COLLECTOR_TFS || 'M1,M5,M15,H1').split(',').map(s=>s.trim()).filter(s=>TIMEFRAMES[s]),
  deep: Number(process.env.DEEP_CANDLES || 6000),
  liveInterval: Number(process.env.LIVE_INTERVAL_MS || 60000),
  trainInterval: Number(process.env.TRAIN_INTERVAL_MS || 900000),
  minTrain: Number(process.env.MIN_TRAIN_SAMPLES || 400),
  maxStoredCandles: Number(process.env.MAX_STORED_CANDLES || 7000),
  apiKey: process.env.ADMIN_KEY || ''
};

function key(asset, tf){ return `${asset}|${tf}`; }
function selectedAssets(){ return CONFIG.assets.map(getAsset).filter(Boolean); }

async function collectPair(asset, tf, deep=false){
  const d = await getCandles(asset, tf, { depth: deep ? 'deep':'live', target: deep ? CONFIG.deep : 400, force:true });
  const arr = (d.candles||[]).slice(-CONFIG.maxStoredCandles);
  db.candles[key(asset.id,tf)] = { assetId:asset.id, tf, source:d.source, hasVolume:d.hasVolume, updatedAt:Date.now(), candles:arr };
  return arr.length;
}

function trainPair(assetId, tf){
  const rec = db.candles[key(assetId,tf)];
  if (!rec || rec.candles.length < MIN_WARMUP + 100) return { ok:false, reason:'histórico insuficiente' };
  const { snaps } = buildSnapshotPool(rec.candles, rec.hasVolume, { zoneLookback:160, max:Math.min(rec.candles.length-1, 5000) });
  const samples = snaps.filter(s=>s.nextDir !== null).map(s=>({ vector:s.vector, label:s.nextDir > 0 ? 1 : 0 }));
  if (samples.length < CONFIG.minTrain) return { ok:false, reason:`amostras ${samples.length} < ${CONFIG.minTrain}` };
  const model = trainLogistic(samples, { epochs:350, minValid:Math.max(150, Math.floor(samples.length*0.2)) });
  db.models[key(assetId,tf)] = model;
  // Setup statistics, using only historical outcomes and causal snapshots.
  const rows=[];
  for(let i=0;i<snaps.length-1;i++){
    const s=snaps[i];
    const dir=s.vector ? (s.nextDir || 0) : 0;
    if(!dir) continue;
    const fp=fingerprint(s, [{tf,isMain:true,dir:Math.sign(s.vector[0]||0)}], dir);
    rows.push({setupId:fp.id,setupLabel:fp.label,signal:dir>0?'COMPRA':'VENDA',result:s.nextDir===dir?'ACERTO':'ERRO'});
  }
  db.setupRecords = db.setupRecords.concat(rows).slice(-150000);
  const ranking=rankSetups(db.setupRecords,{minSamples:40,payout:0.85});
  db.stats[key(assetId,tf)]={assetId,tf,trainedAt:Date.now(),samples:samples.length,modelUsable:!!model.usable,valid:model.validMetrics||null,train:model.trainMetrics||null,setupClasses:ranking.classes,eligibleSetups:ranking.eligibleCount,source:rec.source};
  return { ok:true, samples:samples.length, modelUsable:!!model.usable, valid:model.validMetrics||null };
}

async function bootstrap(){
  if(state.running) return;
  state.running=true; state.startedAt=Date.now(); state.lastError=null; state.progress={phase:'bootstrap',done:0,total:selectedAssets().length*CONFIG.tfs.length}; persist();
  let done=0;
  try {
    for(const asset of selectedAssets()) for(const tf of CONFIG.tfs){
      try { await collectPair(asset,tf,true); trainPair(asset.id,tf); }
      catch(e){ state.lastError=`${asset.id} ${tf}: ${e.message}`; }
      done++; state.progress={phase:'bootstrap',done,total:selectedAssets().length*CONFIG.tfs.length}; persist();
    }
    state.lastTrainAt=Date.now();
  } finally { state.running=false; state.lastCycleAt=Date.now(); state.progress=null; persist(); }
}

async function liveCycle(){
  if(state.running) return;
  state.running=true; state.cycle++; state.progress={phase:'live',done:0,total:selectedAssets().length*CONFIG.tfs.length}; state.lastError=null; persist();
  let done=0;
  try {
    for(const asset of selectedAssets()) for(const tf of CONFIG.tfs){
      try { await collectPair(asset,tf,false); }
      catch(e){ state.lastError=`${asset.id} ${tf}: ${e.message}`; }
      done++; state.progress={phase:'live',done,total:selectedAssets().length*CONFIG.tfs.length};
    }
    const now=Date.now();
    if(!state.lastTrainAt || now-state.lastTrainAt>=CONFIG.trainInterval){
      for(const asset of selectedAssets()) for(const tf of CONFIG.tfs){ try { trainPair(asset.id,tf); } catch(e){ state.lastError=`treino ${asset.id} ${tf}: ${e.message}`; } }
      state.lastTrainAt=now;
    }
  } finally { state.running=false; state.lastCycleAt=Date.now(); state.progress=null; persist(); clearCache(); }
}

function json(res,status,obj){ const body=JSON.stringify(obj); res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,x-admin-key'}); res.end(body); }
function authorized(req){ return !CONFIG.apiKey || req.headers['x-admin-key']===CONFIG.apiKey || new URL(req.url,'http://x').searchParams.get('key')===CONFIG.apiKey; }
function serveStatic(req,res){
  let p=new URL(req.url,'http://x').pathname; if(p==='/'||p==='') p='/index.html';
  const file=path.normalize(path.join(FRONTEND_DIR,p)); if(!file.startsWith(FRONTEND_DIR)) return json(res,403,{error:'forbidden'});
  fs.readFile(file,(e,data)=>{ if(e) return json(res,404,{error:'not found'}); const ext=path.extname(file); const ct={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.txt':'text/plain'}[ext]||'application/octet-stream'; res.writeHead(200,{'content-type':ct}); res.end(data); });
}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,x-admin-key'});return res.end();}
  const u=new URL(req.url,'http://localhost');
  try{
    if(u.pathname==='/api/health') return json(res,200,{ok:true,service:'market-analyzer-backend',time:Date.now(),collector:state,config:{assets:CONFIG.assets.length,tfs:CONFIG.tfs}});
    if(u.pathname==='/api/status') return json(res,200,{state,config:CONFIG,stats:Object.keys(db.stats).length,models:Object.keys(db.models).length});
    if(u.pathname==='/api/candles'){
      const asset=u.searchParams.get('asset'), tf=u.searchParams.get('tf'); const rec=db.candles[key(asset,tf)];
      if(!rec) return json(res,404,{error:'candles not collected yet'});
      return json(res,200,rec);
    }
    if(u.pathname==='/api/model'){
      const rec=db.models[key(u.searchParams.get('asset'),u.searchParams.get('tf'))]; if(!rec) return json(res,404,{error:'model not trained yet'}); return json(res,200,rec);
    }
    if(u.pathname==='/api/stats') return json(res,200,{stats:db.stats,setupRecords:db.setupRecords.length,updatedAt:Date.now()});
    if(u.pathname==='/api/ranking'){
      const rows=Object.values(db.stats).map(x=>({key:`${x.assetId||''}|${x.tf||''}`,samples:x.samples||0,validAcc:x.valid?.acc??null,brier:x.valid?.brier??null,auc:x.valid?.auc??null,usable:!!x.modelUsable,trainedAt:x.trainedAt||0,source:x.source||null}));
      rows.sort((a,b)=>((b.usable?1:0)-(a.usable?1:0)) || ((b.validAcc??0)-(a.validAcc??0)) || (b.samples-a.samples));
      return json(res,200,{ranking:rows.slice(0,20),updatedAt:Date.now()});
    }
    if(u.pathname==='/api/collect' && req.method==='POST') { if(!authorized(req)) return json(res,401,{error:'unauthorized'}); liveCycle(); return json(res,202,{accepted:true}); }
    if(u.pathname==='/api/bootstrap' && req.method==='POST') { if(!authorized(req)) return json(res,401,{error:'unauthorized'}); bootstrap(); return json(res,202,{accepted:true}); }
    return serveStatic(req,res);
  }catch(e){ return json(res,500,{error:e.message}); }
});
server.listen(PORT,HOST,()=>console.log(`Market Analyzer backend em http://${HOST}:${PORT}`));

// Start autonomous collection. Bootstrap is intentionally asynchronous so the API becomes available immediately.
bootstrap().catch(e=>{state.lastError=e.message;state.running=false;persist();});
setInterval(()=>liveCycle().catch(e=>{state.lastError=e.message;state.running=false;persist();}),CONFIG.liveInterval);
