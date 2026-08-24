# MARKET ANALYZER v3.2 — próxima vela

## Principais correções
- Sinais ao vivo usam somente a última vela **fechada**; velas em formação são descartadas do feed antes do cálculo.
- Timeframes de contexto também usam somente velas fechadas.
- Mantido o alvo correto: sinal calculado em `t` e resultado esperado na vela `t+1`.
- Modo normal ficou mais seletivo: score mínimo 64 e confluência mínima 2.
- Histórico comparável mínimo subiu para 40 situações; setups exigem 25 observações antes de influenciar a decisão.
- Scanner continua limitado a 10 ativos e agora ranqueia oportunidade por uma combinação de score, qualidade, confluência, evidência estatística disponível e condição de mercado — não apenas pelo maior score.
- Backtest padrão passou para 1.000 velas avaliadas, mantendo limite máximo de 2.000.

## Backtest em linguagem simples
Para cada vela histórica fechada, o motor pergunta: "se eu tivesse visto exatamente este cenário naquele momento, qual seria o sinal para a próxima vela?". Em seguida compara o sinal com a vela seguinte. O processo é repetido cronologicamente.

A banca usa valor fixo por operação e payout configurado, sem martingale. O backtest não prova que o sistema funcionará no futuro; ele serve para rejeitar regras que não demonstram vantagem nem no histórico.

## Recomendação de uso
Para M1/M5, prefira sinais com score alto, confluência forte e feed sem divergência. Se a fonte estiver atrasada ou divergente da corretora, não trate o sinal como válido.
