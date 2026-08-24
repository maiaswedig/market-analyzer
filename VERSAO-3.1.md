# Market Analyzer v3.1

## Mudanças
- Análise ao vivo usa a vela atualmente em formação, ideal para consultar no final da vela e projetar a próxima.
- Backtest continua estritamente causal: cada ponto histórico usa apenas dados disponíveis até aquela vela fechada e avalia a vela seguinte.
- O gráfico mantém candles reais do feed e mostra uma projeção de um passo dos EMAs no slot da próxima vela.
- Buscador agora permite TOP 10, TOP 15 e TOP 20.
- Histórico continua verificando automaticamente sinais pendentes e alimentando o aprendizado.
- Backtest/aprendizado automático continua rodando em segundo plano para o ativo/timeframe atual.
