const intervalMap = Object.freeze({ 1: 'M1', 5: 'M5', 15: 'M15', 30: 'M30', 60: 'H1', 240: 'H4', D: 'D1' });
const state = { symbol: null, interval: null, candles: [], requestId: 0, refreshTimer: null };
const numeric = value => (Number.isFinite(Number(value)) ? Number(value) : null);

function ensureCanvas() {
  const target = document.querySelector('#tradingviewChart');
  let canvas = target.querySelector('canvas');
  if (!canvas) {
    target.replaceChildren(); canvas = document.createElement('canvas'); canvas.className = 'deriv-price-chart';
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Gráfico OHLC del buffer Deriv'); target.append(canvas);
  }
  return canvas;
}

function draw() {
  const canvas = ensureCanvas(); const bounds = canvas.getBoundingClientRect(); const width = Math.max(1, Math.floor(bounds.width)); const height = Math.max(1, Math.floor(bounds.height)); const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio);
  const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height); context.fillStyle = '#0a1728'; context.fillRect(0, 0, width, height);
  const rows = state.candles.slice(-120).filter(candle => [candle.open, candle.high, candle.low, candle.close].every(value => numeric(value) !== null));
  if (!rows.length) { context.fillStyle = '#93a6c4'; context.font = '13px system-ui'; context.fillText('Esperando velas OHLC de Deriv…', 18, 28); return; }
  const values = rows.flatMap(candle => [numeric(candle.high), numeric(candle.low)]); const minimum = Math.min(...values); const maximum = Math.max(...values); const range = Math.max(maximum - minimum, Math.abs(maximum) * 0.00001);
  const margin = { top: 18, right: 72, bottom: 24, left: 10 }; const plotWidth = width - margin.left - margin.right; const plotHeight = height - margin.top - margin.bottom; const toY = value => margin.top + ((maximum - value) / range) * plotHeight;
  context.strokeStyle = '#203752'; context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) { const y = margin.top + (plotHeight * index / 4); context.beginPath(); context.moveTo(margin.left, y); context.lineTo(width - margin.right, y); context.stroke(); context.fillStyle = '#93a6c4'; context.font = '10px ui-monospace'; context.fillText((maximum - (range * index / 4)).toFixed(5), width - margin.right + 7, y + 3); }
  const step = plotWidth / rows.length; const bodyWidth = Math.max(1, Math.min(8, step * 0.65));
  rows.forEach((candle, index) => { const x = margin.left + (index + 0.5) * step; const open = numeric(candle.open); const close = numeric(candle.close); const high = numeric(candle.high); const low = numeric(candle.low); const rising = close >= open; context.strokeStyle = rising ? '#24d19b' : '#f4687a'; context.fillStyle = context.strokeStyle; context.beginPath(); context.moveTo(x, toY(high)); context.lineTo(x, toY(low)); context.stroke(); const top = Math.min(toY(open), toY(close)); context.fillRect(x - bodyWidth / 2, top, bodyWidth, Math.max(1, Math.abs(toY(open) - toY(close)))); });
  context.fillStyle = '#93a6c4'; context.font = '10px system-ui'; context.fillText(`${state.symbol || '—'} · ${state.interval || '—'} · Deriv WebSocket`, 12, height - 8);
}

async function loadCandles() {
  const requestId = ++state.requestId; const params = new URLSearchParams({ symbol: state.symbol, interval: state.interval, limit: '220' }); const response = await fetch(`/api/market/candles?${params}`);
  if (!response.ok) throw new Error(`Deriv candle buffer HTTP ${response.status}`);
  const payload = await response.json(); if (requestId !== state.requestId) return; state.candles = Array.isArray(payload.candles) ? payload.candles : []; draw();
}

export async function renderDerivChart({ symbol, interval = '15' }) { state.symbol = symbol; state.interval = intervalMap[interval] || 'M15'; draw(); try { await loadCandles(); } catch { draw(); } }

/** Coalesces buffer reads while Deriv ticks arrive; no third-party chart feed is used. */
export function refreshDerivChart({ symbol, interval = '15' }) { if (symbol !== state.symbol || (intervalMap[interval] || 'M15') !== state.interval || state.refreshTimer) return; state.refreshTimer = setTimeout(() => { state.refreshTimer = null; void loadCandles().catch(() => draw()); }, 500); }

window.addEventListener('resize', draw);
