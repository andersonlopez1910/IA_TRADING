const digits = symbol => symbol === 'USD/JPY' ? 3 : symbol === 'XAU/USD' ? 2 : 5;

const STATUS_LABELS = {
  live: 'En vivo',
  delayed: 'Datos retrasados',
  closed: 'Mercado cerrado',
  unavailable: 'Sin datos',
  connecting: 'Conectando',
  reconnecting: 'Reconectando',
  disconnected: 'Sin conexión',
  demo: 'Modo demo',
  'high-impact': 'Riesgo por evento económico'
};

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const toKey = value => String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
const asArray = value => Array.isArray(value) ? value : value == null ? [] : [value];
const nonEmpty = (...values) => values.find(value => value !== undefined && value !== null && String(value).trim() !== '');

const number = (value, symbol) => Number.isFinite(Number(value))
  ? Number(value).toLocaleString('en-US', { minimumFractionDigits: digits(symbol), maximumFractionDigits: digits(symbol) })
  : '—';

const time = value => {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return new Date(value).toLocaleTimeString('es-CO');
};

const utcDateTime = value => {
  if (!value || Number.isNaN(new Date(value).getTime())) return '—';
  return `${new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))} UTC`;
};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const byId = id => document.getElementById(id);

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = value == null || value === '' ? '—' : String(value);
}

function label(status) {
  return STATUS_LABELS[toKey(status)] || 'Sin datos';
}

function normaliseDecision(value, status, blocked) {
  if (blocked || ['delayed', 'unavailable', 'disconnected', 'connecting', 'reconnecting'].includes(toKey(status))) return 'NO_TRADE';
  const token = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['BUY', 'COMPRA', 'LONG'].includes(token)) return 'BUY';
  if (['SELL', 'VENTA', 'SHORT'].includes(token)) return 'SELL';
  if (['NO_TRADE', 'NOOPERAR', 'NO_OPERAR', 'BLOCKED'].includes(token)) return 'NO_TRADE';
  return 'WAIT';
}

function decisionLabel(decision) {
  return ({ BUY: 'COMPRA', SELL: 'VENTA', WAIT: 'ESPERAR', NO_TRADE: 'NO OPERAR' })[decision] || 'ESPERAR';
}

function decisionClass(decision) {
  return ({ BUY: 'decision-buy', SELL: 'decision-sell', WAIT: 'decision-wait', NO_TRADE: 'decision-no-trade' })[decision] || 'decision-wait';
}

function formatBias(value) {
  const token = String(value ?? '').trim().toUpperCase();
  if (['BULLISH', 'ALCISTA', 'UP', 'BUY'].includes(token)) return 'Alcista';
  if (['BEARISH', 'BAJISTA', 'DOWN', 'SELL'].includes(token)) return 'Bajista';
  if (['NEUTRAL', 'LATERAL', 'RANGE', 'WAIT'].includes(token)) return 'Neutral';
  return value == null || value === '' ? '—' : String(value);
}

function biasClass(value) {
  const token = String(value ?? '').trim().toUpperCase();
  if (['BULLISH', 'ALCISTA', 'UP', 'BUY'].includes(token)) return 'bias-bullish';
  if (['BEARISH', 'BAJISTA', 'DOWN', 'SELL'].includes(token)) return 'bias-bearish';
  return 'bias-neutral';
}

function formatRiskReward(value) {
  if (value == null || value === '') return '—';
  if (typeof value === 'string' && value.includes(':')) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `1:${numeric.toFixed(numeric % 1 === 0 ? 0 : 2)}` : String(value);
}

function formatEntryZone(zone, symbol) {
  if (zone == null || zone === '') return '—';
  if (!isRecord(zone)) return number(zone, symbol);
  const minimum = nonEmpty(zone.minimum, zone.min, zone.from, zone.low);
  const maximum = nonEmpty(zone.maximum, zone.max, zone.to, zone.high);
  if (minimum == null && maximum == null) return '—';
  if (minimum == null || Number(minimum) === Number(maximum)) return number(maximum ?? minimum, symbol);
  if (maximum == null) return number(minimum, symbol);
  return `${number(minimum, symbol)} — ${number(maximum, symbol)}`;
}

function resolveAnalysis(input = {}, suppliedContext = {}) {
  const envelope = isRecord(input) ? input : {};
  const context = isRecord(suppliedContext) ? suppliedContext : {};
  const selected = nonEmpty(context.symbol, envelope.selected);
  const quote = context.quote || envelope.quote || (isRecord(envelope.quotes) && selected ? envelope.quotes[selected] : null) || {};
  const looksLikeAnalysis = ['decision', 'dataStatus', 'entryZone', 'technicalReasons', 'humanSummary', 'riskReward'].some(key => key in envelope);
  const analysis = context.analysis || envelope.analysis || envelope.forexAnalysis || envelope.aiAnalysis || quote.analysis || (looksLikeAnalysis ? envelope : {});
  return { analysis: isRecord(analysis) ? analysis : {}, context: { ...envelope, ...context, quote } };
}

function compactEntries(values) {
  const seen = new Set();
  return asArray(values).filter(value => {
    const key = typeof value === 'string' ? value : JSON.stringify(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function itemParts(item) {
  if (!isRecord(item)) return { text: String(item ?? '') };
  const type = item.type ? String(item.type) : '';
  const fallback = type === 'market' ? 'Datos de mercado' : type === 'indicator' ? 'Indicador técnico' : type === 'calendar' ? 'Evento económico' : type === 'news' ? 'Noticia financiera' : 'Evidencia verificable';
  const text = nonEmpty(item.title, item.headline, item.name, item.description, item.reason, item.message, item.event, item.summary, item.reference, fallback);
  const meta = [
    item.currency,
    item.impact ? `Impacto ${item.impact}` : null,
    item.sentiment ? `Sesgo ${item.sentiment}` : null,
    item.source,
    item.timestamp ? utcDateTime(item.timestamp) : item.date ? utcDateTime(item.date) : null
  ].filter(Boolean).join(' · ');
  return { text: String(text), meta, reference: item.url || item.referenceUrl || item.reference };
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function renderList(id, values, emptyMessage) {
  const list = byId(id);
  if (!list) return;
  const entries = compactEntries(values);
  list.replaceChildren();
  const renderEntries = entries.length ? entries : [emptyMessage];
  renderEntries.forEach(entry => {
    const { text, meta, reference } = itemParts(entry);
    const item = document.createElement('li');
    const main = document.createElement('span');
    main.className = 'analysis-list-main';
    main.textContent = text;
    item.append(main);
    if (meta) {
      const details = document.createElement('span');
      details.className = 'analysis-list-meta';
      details.textContent = meta;
      item.append(details);
    }
    const href = safeHttpUrl(reference);
    if (href) {
      const link = document.createElement('a');
      link.className = 'analysis-list-link';
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = 'Ver fuente';
      item.append(link);
    }
    list.append(item);
  });
}

function eventBlockActive(analysis) {
  const risk = analysis.riskManagement || analysis.risk || {};
  return analysis.highImpactEvent === true || analysis.blockedByNews === true || analysis.blockedByEconomicEvent === true || analysis.newsLock === true || analysis.riskBlocked === true || risk.blocked === true || analysis.fundamental?.highImpactWindow?.blocked === true || asArray(risk.blocks).some(block => block?.code === 'HIGH_IMPACT_EVENT');
}

function trendValue(analysis, frame) {
  const trends = analysis.trends || analysis.timeframes || analysis.multiTimeframe || {};
  const direct = nonEmpty(trends[frame], trends[frame.toLowerCase()], analysis[`trend${frame}`], analysis[frame]);
  return isRecord(direct) ? nonEmpty(direct.trend, direct.bias, direct.direction, direct.label) : direct;
}

/**
 * Renders a structured ForexProfessionalAI response without deriving a signal in the browser.
 * @param {object} analysis Structured analysis JSON, or an envelope containing `analysis`.
 * @param {object} context Optional { symbol, quote, status, source, lastTickAt } market context.
 */
export function renderAnalysis(analysis = {}, context = {}) {
  const resolved = resolveAnalysis(analysis, context);
  const data = resolved.analysis;
  const market = resolved.context;
  const quote = market.quote || {};
  const symbol = nonEmpty(data.symbol, market.symbol, quote.symbol, market.selected, '—');
  const dataStatus = toKey(nonEmpty(data.dataStatus, data.status, quote.status, market.status, 'connecting'));
  const blockedByEvent = eventBlockActive(data);
  const badgeStatus = blockedByEvent ? 'high-impact' : dataStatus;
  const decision = normaliseDecision(nonEmpty(data.decision, quote.signal), dataStatus, blockedByEvent);
  const source = nonEmpty(data.source, quote.source, market.source, asArray(data.evidence).find(item => isRecord(item) && item.source)?.source, '—');
  const updatedAt = nonEmpty(data.timestamp, data.updatedAt, quote.timestamp, market.lastTickAt);
  const confidence = Number(data.confidence ?? quote.confidence);
  const entry = data.entryZone || data.entry || {};
  const stopLoss = nonEmpty(data.stopLoss, data.sl);
  const takeProfit1 = nonEmpty(data.takeProfit1, data.tp1, asArray(data.takeProfits)[0]);
  const takeProfit2 = nonEmpty(data.takeProfit2, data.tp2, asArray(data.takeProfits)[1]);
  const technicalBias = nonEmpty(data.technicalBias, data.bias);
  const fundamentalBias = nonEmpty(data.fundamentalBias, data.fundamental?.bias);
  const evidence = compactEntries(data.evidence);
  const news = compactEntries(nonEmpty(data.news, data.newsUsed, data.verifiedNews) ?? evidence.filter(item => toKey(item?.type) === 'news'));
  const events = compactEntries(nonEmpty(data.economicEvents, data.upcomingEvents, data.calendarEvents) ?? evidence.filter(item => toKey(item?.type) === 'calendar'));

  const stateNode = byId('signalState');
  if (stateNode) {
    stateNode.textContent = decisionLabel(decision);
    stateNode.className = decisionClass(decision);
  }

  const statusNode = byId('analysisMarketStatus');
  if (statusNode) {
    statusNode.textContent = label(badgeStatus);
    statusNode.className = `status-badge market-${badgeStatus}`;
  }

  const summary = blockedByEvent
    ? 'NO OPERAR: riesgo alto por evento económico.'
    : dataStatus === 'delayed'
      ? 'Datos retrasados: no se generan señales nuevas.'
      : nonEmpty(data.humanSummary, data.summary, data.explanation, 'Aguardando un análisis verificable del backend.');

  setText('analysisText', summary);
  setText('analysisSymbol', symbol);
  setText('analysisConfidence', Number.isFinite(confidence) ? `${Math.max(0, Math.min(100, confidence)).toFixed(0)} / 100` : '—');
  setText('analysisTechnicalBias', formatBias(technicalBias));
  setText('analysisFundamentalBias', formatBias(fundamentalBias));
  setText('analysisUpdatedAt', utcDateTime(updatedAt));
  setText('analysisSource', source);
  setText('analysisEntryZone', formatEntryZone(entry, symbol));
  setText('analysisEntryTrigger', nonEmpty(entry?.trigger, data.requiredTrigger, 'Sin condición de activación'));
  setText('analysisStopLoss', number(stopLoss, symbol));
  setText('analysisTakeProfit1', number(takeProfit1, symbol));
  setText('analysisTakeProfit2', number(takeProfit2, symbol));
  setText('analysisRiskReward', formatRiskReward(nonEmpty(data.riskReward, data.rr)));
  setText('analysisExpiry', Number.isFinite(Number(data.expiryMinutes)) ? `Vigencia estimada: ${Number(data.expiryMinutes)} min` : 'Vigencia no disponible');
  setText('analysisStructure', nonEmpty(data.marketStructure, data.structure, 'Estructura pendiente'));

  const levels = [
    formatEntryZone(entry, symbol) !== '—' ? `Entrada: ${formatEntryZone(entry, symbol)}` : null,
    Number.isFinite(Number(stopLoss)) ? `SL: ${number(stopLoss, symbol)}` : null,
    Number.isFinite(Number(takeProfit1)) ? `TP1: ${number(takeProfit1, symbol)}` : null,
    formatRiskReward(nonEmpty(data.riskReward, data.rr)) !== '—' ? `R/B: ${formatRiskReward(nonEmpty(data.riskReward, data.rr))}` : null
  ].filter(Boolean).join(' · ');
  setText('levels', levels || 'Entrada, riesgo y objetivos pendientes de datos verificables.');
  setText('dataDisclosure', dataStatus === 'live' ? `Datos reales recientes · Fuente: ${source}` : `${label(badgeStatus)} · No se valida una señal nueva sin datos reales recientes.`);

  ['H4', 'H1', 'M15', 'M5'].forEach(frame => {
    const node = byId(`trend${frame}`);
    const value = trendValue(data, frame);
    if (node) {
      node.textContent = formatBias(value);
      node.className = biasClass(value);
    }
  });

  renderList('technicalReasons', data.technicalReasons, 'Aguardando análisis técnico verificable.');
  renderList('fundamentalReasons', data.fundamentalReasons, 'Sin contexto fundamental verificable disponible.');
  renderList('analysisNews', news, 'Sin noticias verificadas utilizadas.');
  renderList('economicEvents', events, 'Sin eventos verificados disponibles.');
  renderList('analysisRisks', data.risks, 'El riesgo se evaluará cuando existan datos recientes.');
  renderList('analysisInvalidation', data.invalidation, 'Sin condiciones de invalidación publicadas.');
  renderList('analysisConfirmation', data.requiredConfirmation, 'Esperar una actualización del motor de análisis.');
  renderList('analysisSources', evidence.length ? evidence : data.sources, 'La evidencia se mostrará cuando la fuente la entregue.');
}

export function renderCards({ symbols = [], quotes = {}, analyses = {}, selected, onSelect = () => {} } = {}) {
  const grid = document.querySelector('#pairGrid');
  if (!grid) return;
  grid.innerHTML = symbols.map(symbol => {
    const quote = { ...(quotes[symbol] || {}) };
    const analysis = analyses[symbol] || {};
    const trendH1 = analysis.trends?.H1 ?? quote.h1 ?? null;
    const trendH4 = analysis.trends?.H4 ?? quote.h4 ?? null;
    const signal = analysis.decision ? decisionLabel(normaliseDecision(analysis.decision, analysis.dataStatus, eventBlockActive(analysis))) : (quote.signal || 'Esperar');
    const confidence = Number.isFinite(Number(analysis.confidence)) ? `${Number(analysis.confidence).toFixed(0)} / 100` : (quote.confidence ?? '—');
    quote.h1 = trendH1 ? formatBias(trendH1) : quote.h1;
    quote.h4 = trendH4 ? formatBias(trendH4) : quote.h4;
    quote.signal = signal;
    quote.confidence = confidence;
    quote.status = quote.status || analysis.dataStatus;
    quote.source = quote.source || analysis.source;
    quote.timestamp = quote.timestamp || analysis.timestamp;
    const variation = Number(quote.changePercent);
    const direction = variation > 0 ? 'up' : variation < 0 ? 'down' : '';
    return `<button class="pair ${symbol === selected ? 'active' : ''}" data-symbol="${escapeHtml(symbol)}"><small>${escapeHtml(symbol)}</small><b>${number(quote.mid, symbol)}</b><span class="${direction}">${Number.isFinite(variation) ? `${variation > 0 ? '+' : ''}${variation.toFixed(2)}%` : '—'}</span><div class="meta"><span>Bid<strong>${number(quote.bid, symbol)}</strong></span><span>Ask<strong>${number(quote.ask, symbol)}</strong></span><span>H1<strong>${escapeHtml(quote.h1 || '—')}</strong></span><span>H4<strong>${escapeHtml(quote.h4 || '—')}</strong></span><span>Señal<strong>${escapeHtml(quote.signal || 'Esperar')}</strong></span><span>Confianza<strong>${escapeHtml(quote.confidence ?? '—')}</strong></span></div><em>${escapeHtml(label(quote.status))}</em><small>Fuente: ${escapeHtml(quote.source || '—')} · ${time(quote.timestamp)}</small></button>`;
  }).join('');
  grid.querySelectorAll('[data-symbol]').forEach(button => { button.onclick = () => onSelect(button.dataset.symbol); });
}

export function renderHeader({ status, source, lastTickAt, latencyMs } = {}) {
  const node = document.querySelector('#globalStatus');
  if (node) {
    node.textContent = `● ${label(status)}`;
    node.className = toKey(status);
  }
  setText('sourceStatus', `Fuente: ${source || '—'}`);
  setText('lastTick', `Último tick: ${time(lastTickAt)}`);
  setText('latencyStatus', `Latencia: ${Number.isFinite(latencyMs) ? `${latencyMs} ms` : '—'}`);
}

export function renderSelected(symbol, quote = {}) {
  setText('selectedPair', symbol);
  setText('selectedPrice', `Bid ${number(quote?.bid, symbol)} · Ask ${number(quote?.ask, symbol)} · Medio ${number(quote?.mid, symbol)}`);
  setText('dataDisclosure', quote?.status === 'live' ? `Datos reales recientes · Fuente: ${quote.source || '—'}` : 'No hay datos reales activos.');
}
