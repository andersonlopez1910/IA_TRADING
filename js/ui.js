import { ema } from './indicators.js';

const fmt = (n, pair) => n.toLocaleString('en-US', { minimumFractionDigits: pair === 'USD/JPY' ? 3 : pair === 'XAU/USD' ? 2 : 5, maximumFractionDigits: pair === 'USD/JPY' ? 3 : pair === 'XAU/USD' ? 2 : 5 });
const statusClass = direction => ({ buy: 'buy', sell: 'sell', wait: 'wait', none: 'none' }[direction]);

export function renderPairs(markets, selected, onPick) {
  const grid = document.querySelector('#pairGrid');
  grid.innerHTML = Object.entries(markets).map(([pair, m]) => `<button class="pair-card ${pair === selected ? 'selected' : ''}" data-pair="${pair}"><span class="pair-name">${pair}</span><span class="price">${fmt(m.price, pair)}</span><span class="change ${m.change >= 0 ? 'positive' : 'negative'}">${m.change >= 0 ? '+' : ''}${Number(m.change || 0).toFixed(2)}%</span><div class="mini-trends"><span>H1 <b class="${m.h1 === 'Alcista' ? 'up' : m.h1 === 'Bajista' ? 'down' : ''}">${m.h1}</b></span><span>H4 <b class="${m.h4 === 'Alcista' ? 'up' : m.h4 === 'Bajista' ? 'down' : ''}">${m.h4}</b></span></div><span class="card-status ${statusClass(m.direction)}">${m.status}</span><span class="card-confidence">Spread <b>${m.spread == null ? '—' : m.spread}</b> · Tick <b>${m.lastTickAt ? new Date(m.lastTickAt).toLocaleTimeString('es-CO') : '—'}</b></span><span class="card-confidence">Confianza <b>${m.confidence}%</b></span></button>`).join('');
  grid.querySelectorAll('[data-pair]').forEach(button => button.addEventListener('click', () => onPick(button.dataset.pair)));
}

export function renderSignal(s) {
  document.querySelector('#chartPairLabel').textContent = `${s.pair} · M15`;
  document.querySelector('#chartPrice').textContent = fmt(s.price, s.pair);
  document.querySelector('#signalTitle').textContent = s.pair;
  const badge = document.querySelector('#signalBadge'); badge.className = `badge ${statusClass(s.direction)}`; badge.textContent = s.status.toUpperCase();
  document.querySelector('#confidenceText').textContent = `${s.confidence} / 100`;
  document.querySelector('#confidenceBar').style.width = `${s.confidence}%`;
  document.querySelector('#confidenceLabel').textContent = s.confidence >= 80 ? 'Alta · condiciones alineadas' : s.confidence >= 60 ? 'Media · revisar condiciones pendientes' : 'Baja · no se emite señal válida';
  const values = [['Dirección', s.direction === 'buy' ? 'Compra' : s.direction === 'sell' ? 'Venta' : 'Sin entrada', s.direction], ['Entrada', fmt(s.entry, s.pair)], ['Stop loss', fmt(s.stop, s.pair)], ['Objetivo 1', fmt(s.target1, s.pair)], ['Objetivo 2', fmt(s.target2, s.pair)], ['Riesgo / beneficio', `1 : ${s.rr.toFixed(1)}`], ['Validez', 'Hasta cierre de M15']];
  document.querySelector('#signalLevels').innerHTML = values.map(([label, value, className]) => `<div><dt>${label}</dt><dd class="${className || ''}">${value}</dd></div>`).join('');
  document.querySelector('#signalReason').innerHTML = `<b>Lectura del contexto</b><p>${s.reason}</p>${s.correlated ? '<p class="correlation">↗ Exposición correlacionada al USD: evita duplicar el riesgo.</p>' : ''}`;
  document.querySelector('#validationList').innerHTML = s.checks.map(([name, detail, pass]) => `<div class="validation ${pass ? 'pass' : 'pending'}"><span>${pass ? '✓' : '!'}</span><div><b>${name}</b><small>${detail}</small></div><em>${pass ? 'OK' : 'Revisar'}</em></div>`).join('');
  document.querySelector('#rsiValue').textContent = s.rsi;
  document.querySelector('#atrValue').textContent = s.atr.toFixed(s.pair === 'XAU/USD' ? 2 : s.pair === 'USD/JPY' ? 3 : 5);
}

export function drawChart(canvas, candles, pair, levels) {
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); const width = rect.width, height = rect.height, pad = { top: 16, right: 61, bottom: 18, left: 8 };
  const highs = candles.map(c => c.high), lows = candles.map(c => c.low), allValues = [...highs, ...lows, levels.stop, levels.target2];
  const min = Math.min(...allValues), max = Math.max(...allValues), range = max - min || 1, pH = height - pad.top - pad.bottom, pW = width - pad.left - pad.right;
  const y = value => pad.top + (max - value) / range * pH, x = i => pad.left + (i + .5) * pW / candles.length;
  ctx.clearRect(0, 0, width, height); ctx.font = '10px DM Mono'; ctx.textAlign = 'left';
  for (let i = 0; i < 5; i++) { const lineY = pad.top + (pH / 4) * i; ctx.strokeStyle = 'rgba(143,163,196,.12)'; ctx.beginPath(); ctx.moveTo(pad.left, lineY); ctx.lineTo(width - pad.right, lineY); ctx.stroke(); ctx.fillStyle = '#8798b9'; ctx.fillText(fmt(max - range * i / 4, pair), width - pad.right + 6, lineY + 3); }
  const lines = [{ period: 20, color: '#59b7ff' }, { period: 50, color: '#f2bb5b' }, { period: 200, color: '#a98cff' }];
  lines.forEach(({ period, color }) => { const points = ema(candles.map(c => c.close), period); ctx.strokeStyle = color; ctx.lineWidth = 1.25; ctx.beginPath(); points.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))); ctx.stroke(); });
  const candleWidth = Math.max(2, pW / candles.length * .56); candles.forEach((c, i) => { const rising = c.close >= c.open; ctx.strokeStyle = ctx.fillStyle = rising ? '#24c995' : '#f06475'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x(i), y(c.high)); ctx.lineTo(x(i), y(c.low)); ctx.stroke(); ctx.fillRect(x(i) - candleWidth / 2, Math.min(y(c.open), y(c.close)), candleWidth, Math.max(1, Math.abs(y(c.open) - y(c.close)))); });
  [{ v: levels.entry, c: '#59b7ff', label: 'ENTRADA' }, { v: levels.stop, c: '#f06475', label: 'STOP' }, { v: levels.target1, c: '#24c995', label: 'TP1' }].forEach(line => { const ly = y(line.v); ctx.setLineDash([4, 4]); ctx.strokeStyle = line.c; ctx.beginPath(); ctx.moveTo(pad.left, ly); ctx.lineTo(width - pad.right, ly); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = line.c; ctx.fillText(line.label, pad.left + 4, ly - 4); });
}

export function renderCalendar(events, currency, impact) {
  const rows = events.filter(e => (currency === 'all' || e.currency === currency) && (impact === 'all' || e.impact === impact));
  document.querySelector('#calendarRows').innerHTML = rows.map(e => `<tr><td>${e.time}</td><td><span class="currency-tag">${e.currency}</span></td><td>${e.event}</td><td><span class="impact ${e.impact.toLowerCase()}">${e.impact}</span></td><td class="countdown">${e.countdown}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No hay eventos con estos filtros.</td></tr>';
}

export function renderHistory(history) {
  const body = document.querySelector('#historyRows'); body.innerHTML = history.length ? history.map(h => `<tr><td>${h.date}</td><td>${h.pair}</td><td class="${h.direction}">${h.direction === 'buy' ? 'Compra' : 'Venta'}</td><td>${h.entry}</td><td>${h.stop}</td><td>${h.target}</td><td><span class="history-status ${h.status}">${h.status}</span></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Aún no hay señales marcadas como ejecutadas en este navegador.</td></tr>';
  const resolved = history.filter(h => ['ganada', 'perdida'].includes(h.status)), wins = resolved.filter(h => h.status === 'ganada').length;
  const stats = [['Tasa de acierto', resolved.length ? `${Math.round(wins / resolved.length * 100)}%` : '—'], ['Ganancia media', '—'], ['Pérdida media', '—'], ['R:B promedio', history.length ? '1 : 2.0' : '—'], ['Drawdown', '0.00%'], ['Resultado acumulado', '$0.00']];
  document.querySelector('#statGrid').innerHTML = stats.map(([label, value]) => `<div class="stat"><span>${label}</span><b>${value}</b></div>`).join('');
}

export function toast(message) { const node = document.querySelector('#toast'); node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 3300); }
