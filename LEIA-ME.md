# MARKET ANALYZER v3

Ferramenta **100% no navegador** (HTML + CSS + JavaScript puro, sem back-end, sem chaves de API) que analisa
dados **reais** de cripto e forex e emite uma leitura para a **próxima vela** do timeframe escolhido:
**🟢 CALL**, **🔴 PUT** ou **⚪ AGUARDAR**.

> **Aviso:** é uma ferramenta de **análise e estudo**. Ela **não executa ordens**, **não é recomendação de
> investimento** e **não garante lucro**. Resultados passados não se repetem. Confira sempre ativo, preço e
> horário na sua corretora antes de qualquer decisão — especialmente em ativos **OTC**, cujos preços são
> gerados pela própria corretora e podem divergir do mercado real usado aqui.

---

## 1. O que mudou da v1 para a v2

| Tema | v1 | v2 |
|---|---|---|
| Score | soma de fatores dividida pelo peso máximo → **mediana ~14–17/100** | **sub-score por categoria** (0–100, 50 = neutro) + viés ponderado → **mediana ~68/100**, neutro em 50 |
| Veredito | exigia score ≥ 62 **e** probabilidade histórica ≥ 57% **e** amostra mínima → **~100% AGUARDAR** | score + travas de risco + **expectativa matemática**; falta de estatística **avisa**, não veta |
| Histórico carregado | ~700–1.200 candles | **até 20.000** candles (padrão 6.000) via paginação `history-candles` da OKX |
| Probabilidade | um número só ("confiança") | **três métricas separadas**, cada uma com origem e amostra |
| Backtest | taxa de acerto | causal + **varredura de limiares** com expectativa, profit factor, drawdown e simulação de banca |
| Gráfico | apenas widget do TradingView | **gráfico próprio** (TradingView Lightweight Charts) com EMAs, volume, zonas e marcador `← PRÓXIMA VELA` |

### Diagnóstico do excesso de AGUARDAR (medido, não estimado)

Rodando o motor da v1 sobre candles reais (400 velas por ativo/TF, OKX e Kraken):

```
BTC/USDT M5  → CALL 0,0% · PUT 0,0% · AGUARDAR 100,0%
BTC/USDT M15 → CALL 0,0% · PUT 0,0% · AGUARDAR 100,0%
ETH/USDT M5  → CALL 0,0% · PUT 0,0% · AGUARDAR 100,0%
EUR/USD M15  → CALL 0,3% · PUT 0,0% · AGUARDAR 99,7%
motivos: "score < 62" em 99,5–99,7% das velas · "probabilidade < 57%" em 20–51%
         · "amostra insuficiente" em 15–63% · penalidade bloqueante em 21–24%
score da v1: mediana 13,7–17,0 · máximo 65,5   (limiar exigido: 62)
```

Ou seja: **o limiar era inatingível pela própria escala do score**, e o veto de probabilidade mínima
completava o bloqueio. As correções da v2 foram:

1. **Reescala documentada do score** (`js/score.js`): cada categoria devolve viés `b ∈ [−1,+1]`;
   sub-score = `50 + 50·b`; viés final `B` = média ponderada; força = `clamp((|B| − B0)/(B1 − B0), 0, 1)`
   com `B0 = 0,06` (mercado praticamente neutro) e `B1 = 0,45` (confluência máxima);
   **score = 50 + 50·força − penalidades**. Mercado neutro cai em ~50, confluência quase total em 90–100.
2. **Muito mais histórico**: OKX `history-candles` paginada de 300 em 300 (6.000 candles por padrão,
   até 20.000), Kraken 720, Yahoo até o limite intradiário.
3. **Fim do veto de probabilidade mínima**: a decisão passou a ser por **expectativa matemática**
   (`EV = p·payout·valor − (1−p)·valor`). Sem estimativa elegível, o app **avisa**
   ("⚠️ Dados insuficientes para estimativa estatística") e decide por score + travas de risco.
   Só bloqueia por expectativa quando a estatística é **conclusivamente** negativa
   (intervalo de confiança 95% inteiramente abaixo do equilíbrio) ou quando você escolhe
   `Trava de expectativa = bloquear` nas configurações.
4. **Varredura de limiares** no backtest, com botão **APLICAR ESTE THRESHOLD** por ativo+timeframe.

Distribuição medida **depois** da recalibração (mesmos ativos/TFs, motor v2, 400 velas):
ver `MARKET_ANALYZER_RELATORIO*.md` / a aba BACKTEST — tipicamente **CALL 11–33% · PUT 11–29% ·
AGUARDAR 55–61%**, com score mediano ~67 e p90 ~92.

> **Importante e honesto:** ter mais sinais **não** significa ter lucro. Nas janelas testadas a taxa de
> acerto ficou perto de 48–55% e o ponto de equilíbrio para payout 85% é **54,1%** — em vários ativos/TFs
> **nenhum** limiar teve expectativa positiva, e a própria varredura diz isso na tela.

---

## 2. As três métricas (nunca misturadas)

| Métrica | O que é | Quando aparece |
|---|---|---|
| **Score técnico X/100** | força de **confluência técnica** (50 = neutro). **Não é taxa de acerto.** | sempre |
| **Probabilidade estimada (modelo) X%** | P(alta) da regressão logística calibrada treinada no seu navegador | só se validação ≥ 150 amostras **e** Brier melhor que a taxa base; senão `⚠️ Dados insuficientes para estimativa estatística.` |
| **Taxa histórica X% (amostra: N)** | fração de casos análogos reais em que a próxima vela fechou na direção | só com N ≥ amostra mínima; mostra IC95% de Wilson e avisa quando o IC cruza 50% |

Além delas, a **expectativa matemática** aparece com a origem do `p` usado (classe de setup, análogos
históricos ou modelo calibrado), o tamanho da amostra, o payout e o ponto de equilíbrio.

---

## 3. Telas

| Aba | O que faz |
|---|---|
| **🎯 MODO OPERAÇÃO** | tela limpa: par, TF, "PRÓXIMA VELA", veredito grande, SCORE, QUALIDADE, CONFLUÊNCIA, janela da próxima vela com contagem regressiva e um botão para a análise completa |
| **ANÁLISE** | hierarquia: veredito → score/qualidade/confluência/próxima vela → **Por quê?** (3–5 tópicos) → detalhes recolhíveis (três métricas, categorias, multi-TF, price action, zonas de S/R, penalidades, explicação, indicadores) + gráfico próprio e referência TradingView |
| **SCANNER** | 🔥 varredura por mercado (Cripto/Forex/Ambos), 1+ timeframes e 20/50/100 ativos (limitado ao universo real dos feeds, informado na tela); tabela ordenável `Ativo / TF / Sinal / Score / Probabilidade / Histórico / Qualidade` |
| **BACKTEST** | backtest causal, distribuição real CALL/PUT/AGUARDAR, varredura de limiares (sinais, acerto, profit factor, drawdown, expectativa), simulação de banca (R$ 250 / R$ 5 / 85%, **sem martingale**), tabelas por horário, faixa de score, qualidade e condição, além do teste de causalidade |
| **APRENDIZADO** | treino do modelo calibrado (acurácia, logloss, **Brier**, AUC, curva de confiabilidade, pesos) e **ranking de setups** (melhores/piores por expectativa, com amostra) |
| **HISTÓRICO** | filtros (ativo, TF, sinal, qualidade, faixa de score, data, resultado), verificação automática do resultado com candles reais, evolução da taxa de acerto, distribuição CALL/PUT/AGUARDAR e export/import JSON + CSV |
| **CORRETORA** | 🖼️ comparação **assistida** com print da corretora: você informa ativo, TF, horário da última vela e preço; divergência acima da tolerância gera `⚠️ NÃO OPERAR` e **bloqueia** os sinais da sessão |
| **CONFIGURAÇÕES** | limiares, pesos das categorias, componentes on/off, banca/valor/payout, tolerância da corretora, alertas (só A/A+) e tema |

---

## 4. Como o veredito é decidido

1. Categorias → sub-scores → viés → **score técnico**.
2. Travas (todas explicadas na tela, com ✓/×/⚠️):
   direção definida · score ≥ mínimo · nenhum bloqueio técnico (zona colada abaixo da distância mínima em
   ATR, condição anormal/evento extremo) · confluência mínima (opcional) · feed da corretora conferido ·
   expectativa não conclusivamente negativa.
3. **Nota do setup** `A+ / A / B / C / D` = pontos por score, confluência, condição de mercado, penalidades
   e (quando há amostra) o desempenho histórico daquela classe de setup. Limiares no código
   (`setupGrade` em `js/score.js`) e no tooltip da nota.
4. Alertas (🔔) disparam **somente** para A e A+, no formato `🔔 BTC/USDT M5 — CALL — Score 89`.

---

## 5. Fontes de dados e limites (leia antes de confiar)

Todos os candles são **reais**. **Nada é simulado**: quando nenhuma fonte responde, aparece
**"fonte indisponível"** e a análise não acontece.

| Grupo | Fonte(s) | Observações |
|---|---|---|
| Cripto (50 pares USDT) | **OKX** (principal, paginação até 20.000 candles) → **Coinbase** → **Kraken** | volume real; TFs M1/M5/M15/M30/H1/H4 nativos |
| Forex (12 pares fiat reais) | **Kraken** (`ZEURZUSD`, `ZGBPZUSD`, `ZUSDZJPY`, `AUDUSD`, `ZUSDZCAD`, `USDCHF`, `EURJPY`, `EURGBP`, `AUDJPY`, `EURAUD`, `EURCHF`, `EURCAD`) → Yahoo como reserva | Kraken devolve no máximo **720 candles** por TF → amostras menores e mais "insuficiente" |
| NZD/USD, USD/BRL, GBP/JPY, CHF/JPY | **Yahoo Finance** via proxies CORS públicos | **instável**: os proxies gratuitos caem com frequência; nessas horas aparece "fonte indisponível" (comportamento correto) |

Outros limites conhecidos e honestos:

- **Volume**: cripto e Kraken têm volume real; séries do Yahoo para forex costumam vir com volume zero —
  o fator volume é neutralizado e isso é dito na tela.
- **Pares fiat pouco líquidos da Kraken** têm muitas velas paradas; velas neutras (doji) **não** contam
  como baixa na taxa histórica, mas reduzem a amostra útil.
- **Backtest**: o TF menor da escada multi-timeframe **não** é reconstruível a partir do TF principal e
  entra como "n/d"; os TFs maiores são reamostrados do mesmo histórico, sempre causalmente.
  O botão **Testar causalidade** recalcula features usando só candles ≤ t e compara com o cálculo da série
  completa — se houvesse vazamento de futuro, ele apontaria.
- **Modelo de ML**: com features puramente técnicas, o Brier fora da amostra frequentemente **não** bate a
  taxa base — nesse caso a probabilidade **não** é exibida nem usada. Isso é o resultado honesto, não um bug.
- **Setups**: o ranking só considera classes com amostra ≥ mínimo (padrão 15). Com poucos sinais resolvidos,
  o painel mostra as classes mais frequentes marcadas como insuficientes.
- **Comparação com a corretora** é **manual/assistida**: o app **não lê a imagem** (não há OCR).
- **Armazenamento**: se o navegador bloquear `localStorage` (ex.: iframe de pré-visualização), o app avisa
  e guarda tudo **só na memória da sessão** — use **Exportar JSON**.
- **Ativos OTC** de corretoras de opções binárias **não existem** aqui: os preços deles são gerados pela
  própria corretora.
- **TradingView**: o widget Advanced Chart é apenas referência visual; todos os cálculos vêm dos feeds
  públicos citados. O gráfico próprio usa a biblioteca gratuita Lightweight Charts.

---

## 6. Rodar localmente (Windows)

O app é estático — não precisa instalar nada.

**Opção 1:** descompacte a pasta e dê duplo clique em `index.html`.
Se o navegador reclamar de módulos JavaScript (`file://` bloqueia `import`), use a opção 2.

**Opção 2 (recomendada):** abra o Prompt de Comando na pasta do projeto e rode:

```bat
python -m http.server 8000
```

Depois acesse `http://localhost:8000`. Com Node.js instalado, a alternativa é `npx serve .`.

Nada é enviado a servidor próprio: as requisições vão do seu navegador direto para OKX, Coinbase, Kraken,
proxies CORS e CDNs. É necessária conexão com a internet.

---

## 7. Estrutura do projeto

```
index.html            estrutura e textos (pt-BR)
styles.css            tema escuro/claro, tokens, componentes v2, responsivo até 375px
js/util.js            helpers, armazenamento tolerante, fila de requisições
js/assets.js          universo (cripto + forex), timeframes e escada multi-TF
js/data.js            provedores, paginação de histórico, cache, saúde das fontes
js/indicators.js      EMA, SMA, RSI, MACD, Estocástico, ATR, Bollinger, ROC, ADX, divergências
js/structure.js       pivôs, estrutura de mercado (HH/HL), regime
js/patterns.js        padrões de candle
js/priceaction.js     módulo avançado de price action (janelas 3/5/10/20)
js/zones.js           zonas de suporte/resistência (faixas) + distância mínima em ATR
js/condition.js       condição de mercado (ADX/ATR/compressão) + eventos extremos
js/features.js        snapshots causais, buckets discretos e vetor do modelo
js/score.js           sub-scores por categoria, penalidades, nota A+/A/B/C/D
js/probability.js     análogos históricos, Laplace, intervalo de Wilson
js/decision.js        decisão por expectativa matemática + tópicos do "Por quê?"
js/setups.js          impressão digital do setup e ranking de aprendizado
js/ml.js              regressão logística calibrada (Brier, curva de confiabilidade, travas)
js/analyze.js         motor único (evaluateBar) + análise ao vivo + explicação
js/backtest.js        backtest causal, distribuição, varredura de limiares, teste de causalidade
js/history.js         registro, verificação automática, filtros, export/import
js/chart.js           gráfico próprio (Lightweight Charts) com zonas e "← PRÓXIMA VELA"
js/broker.js          comparação assistida com a corretora
js/alerts.js          som, toast e notificação (só A/A+)
js/tv.js              widget do TradingView (referência visual)
js/app.js             interface, abas, tabelas e estado
tools/diag_v1.mjs     mede a distribuição do motor da v1 (linha de base)
tools/calibrate.mjs   mede a distribuição da v2 e roda a varredura de limiares em dados reais
```
