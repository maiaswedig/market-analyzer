export const ASSETS = [
  { id: 'BTCUSDT', name: 'BTC/USDT', group: 'Cripto' },
  { id: 'ETHUSDT', name: 'ETH/USDT', group: 'Cripto' },
  { id: 'SOLUSDT', name: 'SOL/USDT', group: 'Cripto' },
  { id: 'XRPUSDT', name: 'XRP/USDT', group: 'Cripto' },
  { id: 'BNBUSDT', name: 'BNB/USDT', group: 'Cripto' },
  { id: 'DOGEUSDT', name: 'DOGE/USDT', group: 'Cripto' },
  { id: 'ADAUSDT', name: 'ADA/USDT', group: 'Cripto' },
  { id: 'AVAXUSDT', name: 'AVAX/USDT', group: 'Cripto' },
  { id: 'LINKUSDT', name: 'LINK/USDT', group: 'Cripto' },
  { id: 'LTCUSDT', name: 'LTC/USDT', group: 'Cripto' },
  { id: 'EURUSD', name: 'EUR/USD', group: 'Forex' },
  { id: 'GBPUSD', name: 'GBP/USD', group: 'Forex' },
  { id: 'USDJPY', name: 'USD/JPY', group: 'Forex' },
  { id: 'AUDUSD', name: 'AUD/USD', group: 'Forex' },
  { id: 'USDCAD', name: 'USD/CAD', group: 'Forex' },
  { id: 'USDCHF', name: 'USD/CHF', group: 'Forex' },
  { id: 'EURJPY', name: 'EUR/JPY', group: 'Forex' },
  { id: 'EURGBP', name: 'EUR/GBP', group: 'Forex' },
  { id: 'AUDJPY', name: 'AUD/JPY', group: 'Forex' },
  { id: 'EURAUD', name: 'EUR/AUD', group: 'Forex' }
];
export const TF_LIST = ['M5', 'M15', 'H1'];
export const MTF_CONTEXT = { M5: ['M15', 'H1'], M15: ['H1'], H1: [] };
export function getAsset(id) { return ASSETS.find(a => a.id === id); }
