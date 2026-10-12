import { atr, ema, marketStructure, rsi, supportResistance } from './indicators.js';

const number = value => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);

export function analyzeSynthetic(candles) {
  if (candles.length < 20) return { trend: 'Esperando historial', rsi: 0, atr: 0, move: 0, text: 'Conectando el historial de velas para calcular el contexto.' };
  const closes = candles.map(c => c.close), last = closes.at(-1), fast = ema(closes, 20).at(-1), middle = ema(closes, 50).at(-1), rsiValue = rsi(closes), atrValue = atr(candles), structure = marketStructure(candles), levels = supportResistance(candles);
  const trend = last > fast && fast > middle && structure === 'bullish' ? 'Sesgo alcista' : last < fast && fast < middle && structure === 'bearish' ? 'Sesgo bajista' : 'Movimiento mixto';
  const move = ((last - closes[0]) / closes[0]) * 100;
  const text = `${trend}: precio ${last > fast ? 'sobre' : 'bajo'} EMA 20; RSI ${rsiValue}. Soporte ${number(levels.support)} · resistencia ${number(levels.resistance)}.`;
  return { trend, rsi: rsiValue, atr: atrValue, move, text, levels, fast, middle };
}

export function renderSyntheticCards(data, active, onSelect) {
  const target = document.querySelector('#syntheticCards');
  target.innerHTML = Object.entries(data).map(([symbol, item]) => { const analysis = analyzeSynthetic(item.candles); return `<button class="synthetic-card ${symbol === active ? 'selected' : ''}" data-synthetic="${symbol}"><span class="synthetic-label">ÍNDICE SINTÉTICO</span><b>${symbol === 'BOOM1000' ? 'Boom 1000' : 'Crash 1000'}</b><strong>${item.price ? number(item.price) : '—'}</strong><span class="${analysis.move >= 0 ? 'positive' : 'negative'}">${item.price ? `${analysis.move >= 0 ? '+' : ''}${analysis.move.toFixed(2)}% · 120 velas` : 'Cargando cotización…'}</span><em class="synthetic-trend">${analysis.trend}</em></button>`; }).join('');
  target.querySelectorAll('[data-synthetic]').forEach(button => button.addEventListener('click', () => onSelect(button.dataset.synthetic)));
}

export function renderSyntheticAnalysis(symbol, item) {
  const analysis = analyzeSynthetic(item.candles);
  document.querySelector('#syntheticTitle').textContent = symbol === 'BOOM1000' ? 'Boom 1000' : 'Crash 1000';
  document.querySelector('#syntheticPrice').textContent = item.price ? number(item.price) : '—';
  document.querySelector('#syntheticMove').textContent = item.price ? `${analysis.move >= 0 ? '+' : ''}${analysis.move.toFixed(2)}%` : '—';
  document.querySelector('#syntheticAnalysis').innerHTML = `<span class="synthetic-trend ${analysis.trend.includes('alcista') ? 'up' : analysis.trend.includes('bajista') ? 'down' : ''}">${analysis.trend}</span><p>${analysis.text}</p><div class="synthetic-metrics"><span>RSI <b>${analysis.rsi || '—'}</b></span><span>ATR <b>${analysis.atr ? number(analysis.atr) : '—'}</b></span><span>Temporalidad <b>M1</b></span></div>`;
}

export function drawSyntheticChart(canvas, candles) {
  const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1; canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); const width = rect.width, height = rect.height, pad = { top: 14, bottom: 18, left: 7, right: 58 }, values = candles.flatMap(c => [c.high, c.low]);
  if (!values.length) { ctx.fillStyle = '#91a3c2'; ctx.font = '13px Manrope'; ctx.fillText('Cargando velas de Deriv…', 20, 45); return; }
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1, w = width - pad.left - pad.right, h = height - pad.top - pad.bottom;
  const y = value => pad.top + (max - value) / range * h, x = i => pad.left + (i + .5) * w / candles.length;
  ctx.clearRect(0, 0, width, height); ctx.font = '10px DM Mono';
  for (let i = 0; i < 4; i++) { const ly = pad.top + i * h / 3; ctx.strokeStyle = 'rgba(143,163,196,.14)'; ctx.beginPath(); ctx.moveTo(pad.left, ly); ctx.lineTo(width - pad.right, ly); ctx.stroke(); ctx.fillStyle = '#8798b9'; ctx.fillText(number(max - range * i / 3), width - pad.right + 5, ly + 3); }
  const widthCandle = Math.max(2, w / candles.length * .62); candles.forEach((candle, i) => { const positive = candle.close >= candle.open; ctx.strokeStyle = ctx.fillStyle = positive ? '#26c994' : '#f26878'; ctx.beginPath(); ctx.moveTo(x(i), y(candle.high)); ctx.lineTo(x(i), y(candle.low)); ctx.stroke(); ctx.fillRect(x(i) - widthCandle / 2, Math.min(y(candle.open), y(candle.close)), widthCandle, Math.max(1, Math.abs(y(candle.open) - y(candle.close)))); });
  [{ values: ema(candles.map(c => c.close), 20), color: '#55b8ff' }, { values: ema(candles.map(c => c.close), 50), color: '#f2bd5b' }].forEach(line => { ctx.strokeStyle = line.color; ctx.lineWidth = 1.2; ctx.beginPath(); line.values.forEach((value, index) => index ? ctx.lineTo(x(index), y(value)) : ctx.moveTo(x(index), y(value))); ctx.stroke(); });
}
