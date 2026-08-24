# Market Analyzer 4.0 — coleta contínua

Duas formas de manter os dados/modelo atualizados sem depender do navegador aberto:

## Opção A — GRÁTIS: GitHub Actions (recomendada se você não quer pagar)
- `.github/workflows/collect.yml` roda `collect-once.mjs` a cada ~15 min (grátis em repositórios públicos, sem cartão).
- Cada execução busca candles novos, atualiza `backend-data/candles/*.json`, retreina o modelo
  quando necessário (`backend-data/models/*.json`) e commita tudo de volta no repositório.
- O frontend lê esses arquivos como JSON estático — não precisa de nenhum servidor rodando
  (veja `backend-config.js`, `MA_BACKEND_STATIC = true`).
- **Limitações**: o GitHub não garante o cron no minuto exato (pode atrasar alguns minutos em
  horários de pico) e o job tem um teto de tempo — por isso o padrão aqui é M5/M15/H1, não M1
  (M1 exigiria atualização quase em tempo real, incompatível com um cron de ~15 min).
- **Passo a passo**: suba esta pasta pra um repositório no GitHub → aba **Actions** → habilite
  os workflows → rode `Coleta e treino (grátis, sem servidor)` manualmente uma vez
  (`workflow_dispatch`) pra fazer o bootstrap inicial → depois ele roda sozinho no cron.
- Publique o site (Vercel/Netlify/GitHub Pages) apontando pra esse mesmo repositório — os
  arquivos de `backend-data/` sobem junto como parte do site estático.

## Opção B — servidor próprio (pago, mais robusto e permite M1)
- Roda `backend.mjs` continuamente (`npm start` local, ou `render.yaml`/Docker num host pago).
- Coleta e retreina em intervalos curtos (padrão 60s), suportando M1 de verdade.
- API REST (`/api/candles`, `/api/model`, `/api/stats`, `/api/health`) em vez de arquivos estáticos.
- Para usar: em `backend-config.js`, defina `MA_BACKEND_STATIC = false` e
  `MA_BACKEND_URL = 'https://SEU-BACKEND...'`.

## Importante sobre TradingView
O gráfico/widget do TradingView não entrega automaticamente candles ao JavaScript do seu site. A própria documentação diz que os widgets/Advanced Charts precisam de uma fonte de dados própria ou de terceiro; a TradingView também informa que não fornece uma API pública para baixar/exportar os dados dos widgets. Portanto, este backend **não finge** que OKX/Kraken/Yahoo são dados TradingView.

Para usar exatamente o mesmo feed da sua corretora/TradingView, a arquitetura correta é conectar uma fonte autorizada (ou um datafeed próprio) ao backend. O endpoint `/api/candles` (ou o arquivo estático equivalente) foi criado para isso.

## Rodar o servidor próprio no Windows (Opção B)
1. Instale Node.js 20+.
2. Abra PowerShell nesta pasta.
3. Rode `npm start`.
4. Abra `http://localhost:8787`.
5. O bootstrap começa sozinho. Não precisa apertar ANALISAR.

## Variáveis úteis (ambas opções)
- `COLLECTOR_ASSETS` — IDs separados por vírgula.
- `COLLECTOR_TFS` — ex.: `M5,M15,H1` (Opção A) ou `M1,M5,M15,H1` (Opção B).
- `DEEP_CANDLES` — histórico inicial por par/TF.
- `MIN_TRAIN_SAMPLES` — mínimo para treinar.
- `TRAIN_INTERVAL_MS` — intervalo mínimo entre retreinos.
- Opção B apenas: `LIVE_INTERVAL_MS`, `ADMIN_KEY` (protege endpoints POST de coleta/bootstrap).
