/** Capa de datos demo. Sustituir MarketData.getSnapshot por un adaptador a backend seguro. */
const config = {
  'EUR/USD': { price: 1.08642, change: 0.18, direction: 'buy', h1: 'Alcista', h4: 'Alcista', status: 'Compra válida', confidence: 86, entry: 1.0862, stop: 1.0847, target1: 1.0892, target2: 1.0907, rsi: 58.4, atr: 0.00082, session: 'Londres', reason: 'Tendencia H4/H1 alcista y retroceso controlado a EMA 20 de M15. El cierre M5 confirma la ruptura de microestructura.', zone: true, confirm: true, newsSafe: true },
  'GBP/USD': { price: 1.2748, change: -0.06, direction: 'wait', h1: 'Alcista', h4: 'Alcista', status: 'Esperar confirmación', confidence: 68, entry: 1.2751, stop: 1.2729, target1: 1.2795, target2: 1.2817, rsi: 52.1, atr: 0.00112, session: 'Londres', reason: 'El precio está en zona de retroceso, pero falta un cierre M5 con rechazo alcista. Esperar confirmación; no anticipar la entrada.', zone: true, confirm: false, newsSafe: true },
  'USD/JPY': { price: 156.384, change: 0.22, direction: 'sell', h1: 'Bajista', h4: 'Bajista', status: 'Venta válida', confidence: 81, entry: 156.35, stop: 156.74, target1: 155.57, target2: 155.18, rsi: 43.2, atr: 0.31, session: 'Londres', reason: 'Alineación bajista H4/H1 con rechazo en resistencia M15. La operación está correlacionada con la compra de EUR/USD: elegir una sola exposición al USD.', zone: true, confirm: true, newsSafe: true, correlated: true },
  'XAU/USD': { price: 2358.62, change: 0.03, direction: 'none', h1: 'Mixta', h4: 'Alcista', status: 'No operar', confidence: 43, entry: 2359.1, stop: 2353.8, target1: 2369.7, target2: 2375.0, rsi: 69.8, atr: 8.42, session: 'Baja liquidez', reason: 'Precio extendido lejos de una zona técnica lógica y volatilidad irregular. Esperar un retroceso antes de evaluar una señal.', zone: false, confirm: false, newsSafe: true }
};

function seededRandom(seed) { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); }
function makeCandles(pair, timeframe = 'M15') {
  const data = config[pair], scale = pair === 'XAU/USD' ? 2.2 : pair === 'USD/JPY' ? 0.065 : 0.00022;
  const trend = data.direction === 'sell' ? -1 : data.direction === 'none' ? 0.12 : 1;
  const factor = { M5: .6, M15: 1, H1: 1.8, H4: 3 }[timeframe]; let close = data.price - scale * 32 * trend;
  return Array.from({ length: 72 }, (_, i) => { const noise = (seededRandom(i + pair.length * 19 + timeframe.length) - .5) * scale * 4; const drift = trend * scale * factor * (.44 + seededRandom(i * 2) * .36); const open = close; close = open + drift + noise; const high = Math.max(open, close) + scale * (.4 + seededRandom(i * 3)); const low = Math.min(open, close) - scale * (.4 + seededRandom(i * 5)); return { open, high, low, close }; });
}
const endpoint = 'api/market.php';
const intervalByTimeframe = { M5: '5min', M15: '15min', H1: '1h', H4: '4h' };

async function getLiveSnapshot() {
  const symbols = Object.keys(config).join(',');
  const response = await fetch(`${endpoint}?mode=quotes&symbols=${encodeURIComponent(symbols)}`, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || 'No fue posible obtener cotizaciones en vivo.');
  const live = structuredClone(config);
  Object.entries(payload.quotes).forEach(([pair, quote]) => {
    if (!live[pair] || !quote.price) return;
    live[pair].price = quote.price;
    live[pair].change = quote.change;
    live[pair].updatedAt = quote.updatedAt;
  });
  return { markets: live, source: payload.source, fetchedAt: payload.fetchedAt };
}

async function getLiveCandles(pair, timeframe) {
  const params = new URLSearchParams({ mode: 'series', symbols: pair, interval: intervalByTimeframe[timeframe] });
  const response = await fetch(`${endpoint}?${params}`, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok || payload.error || !payload.candles?.length) throw new Error(payload.error || 'No hay velas disponibles.');
  return payload.candles;
}

export const MarketData = {
  getSnapshot: () => structuredClone(config), getCandles: makeCandles, getLiveSnapshot, getLiveCandles,
  async connectProvider() { return getLiveSnapshot(); }
};
