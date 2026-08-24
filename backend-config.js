// Configure o backend aqui.
//
// MODO GRÁTIS (recomendado, sem servidor pago): um workflow do GitHub Actions coleta
// candles e treina o modelo a cada ~15 min e commita os arquivos em backend-data/.
// O frontend lê esses arquivos como JSON estático — não precisa de nenhum servidor rodando.
window.MA_BACKEND_STATIC = true;
window.MA_BACKEND_STATIC_BASE = 'backend-data';

// MODO SERVIDOR PRÓPRIO (opcional, pago): se você preferir rodar backend.mjs em algum
// host (Render, Railway, VPS, etc.), desligue o modo estático e aponte a URL aqui.
window.MA_BACKEND_URL = '';
// window.MA_BACKEND_STATIC = false;
