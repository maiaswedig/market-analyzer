# Market Analyzer v3.2 — Alta Probabilidade + Aprendizado Automático

- Modo Alta Probabilidade obrigatório por padrão.
- Score mínimo 80, confluência mínima 3, amostra mínima 60.
- Probabilidade mínima 65%; quando houver IC95%, o limite inferior precisa superar o break-even do payout.
- Expectativa negativa bloqueia o sinal.
- Sinais ao vivo usam a vela atual e projetam a próxima vela.
- Histórico registra a abertura da próxima vela corretamente.
- Aprendizado automático percorre TOP 10/15/20 ativos e timeframes em segundo plano, buscando candles históricos, executando backtest causal e treinando modelo quando há amostra suficiente.
- Os modelos são persistidos no navegador.
- Enquanto a página estiver fechada, JavaScript de navegador não executa coleta. Para coleta 24/7 é necessário backend/cron.
- O widget TradingView é referência visual. A página não recebe automaticamente os candles do widget TradingView. Os cálculos usam os provedores configurados em `data.js`. Para usar dados oficiais TradingView no motor é necessária uma API/fonte autorizada.
