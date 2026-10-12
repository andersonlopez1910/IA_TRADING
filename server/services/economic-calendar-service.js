/**
 * Servicio de calendario económico con una frontera deliberadamente estricta:
 * únicamente expone eventos que tienen fuente, fecha y URL HTTP(S) válidas.
 *
 * El proveedor se configura desde el servidor. No hay una fuente por defecto ni
 * datos de relleno: sin configuración el resultado es `unavailable`.
 */
const IMPACTS = new Set(['low', 'medium', 'high']);
const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'XAU']);

function asUtcIso(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function asHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || null;
}

function normalizeImpact(value) {
  if (typeof value === 'number') {
    if (value >= 3) return 'high';
    if (value === 2) return 'medium';
    if (value === 1) return 'low';
    return null;
  }
  const normalized = String(value || '').trim().toLowerCase();
  if (IMPACTS.has(normalized)) return normalized;
  if (['3', 'high impact', 'alto'].includes(normalized)) return 'high';
  if (['2', 'medium impact', 'medio'].includes(normalized)) return 'medium';
  if (['1', 'low impact', 'bajo'].includes(normalized)) return 'low';
  return null;
}

function normalizeCurrencies(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[\s,;/|]+/);
  return [...new Set(values
    .map(item => String(item || '').trim().toUpperCase())
    .filter(item => SUPPORTED_CURRENCIES.has(item)))];
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['events', 'calendar', 'data', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function inCurrencyScope(record, currencies) {
  if (!currencies?.length) return true;
  return record.currencies.some(currency => currencies.includes(currency));
}

/**
 * Convierte un registro del proveedor a un evento seguro para el resto del
 * backend. Un `sourceUrl` configurado puede representar la página oficial del
 * calendario si el proveedor no entrega URL por evento.
 */
export function normalizeEconomicEvent(raw, { source, sourceUrl } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const title = firstString(raw.title, raw.name, raw.event, raw.event_name, raw.description);
  const timestamp = asUtcIso(raw.timestamp ?? raw.datetime ?? raw.date ?? raw.time ?? raw.event_time);
  const url = asHttpUrl(raw.url ?? raw.link ?? raw.reference ?? raw.eventUrl) || asHttpUrl(sourceUrl);
  const eventSource = firstString(
    typeof raw.source === 'object' ? raw.source.name : raw.source,
    raw.provider,
    raw.publisher,
    source
  );
  if (!title || !timestamp || !url || !eventSource) return null;

  const type = firstString(raw.type, raw.eventType, raw.category)?.toLowerCase() || null;
  const explicitConference = raw.isCentralBankConference === true
    || raw.centralBankConference === true
    || type === 'central_bank_conference'
    || type === 'central-bank-conference';

  return Object.freeze({
    id: String(raw.id ?? raw.eventId ?? `${eventSource}:${timestamp}:${title}`),
    title,
    currencies: normalizeCurrencies(raw.currencies ?? raw.currency ?? raw.country_currency ?? raw.affectedCurrencies),
    impact: normalizeImpact(raw.impact ?? raw.importance ?? raw.priority) || 'unknown',
    timestamp,
    endTimestamp: asUtcIso(raw.endTimestamp ?? raw.end_time ?? raw.endDate),
    source: eventSource,
    url,
    isCentralBankConference: explicitConference,
    actual: raw.actual ?? null,
    forecast: raw.forecast ?? null,
    previous: raw.previous ?? null
  });
}

function makeEnvelope({ status, source, events = [], reason, fetchedAt, discardedCount = 0 }) {
  return {
    status,
    source: source || null,
    fetchedAt: fetchedAt || new Date().toISOString(),
    events,
    discardedCount,
    ...(reason ? { reason } : {})
  };
}

/**
 * Determina de forma determinista si un evento bloquea la generación de nuevas
 * señales. Sólo eventos explícitamente marcados como `high` o conferencias de
 * banco central explícitamente identificadas por el proveedor pueden bloquear.
 */
export function isWithinHighImpactWindow(events, {
  now = new Date(),
  beforeMinutes = 30,
  afterMinutes = 30,
  currencies = []
} = {}) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError('La fecha de referencia no es válida');
  const beforeMs = Math.max(0, Number(beforeMinutes) || 0) * 60_000;
  const afterMs = Math.max(0, Number(afterMinutes) || 0) * 60_000;
  const normalizedCurrencies = normalizeCurrencies(currencies);

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || !inCurrencyScope(event, normalizedCurrencies)) continue;
    const startMs = Date.parse(event.timestamp);
    if (!Number.isFinite(startMs)) continue;
    const endMs = Date.parse(event.endTimestamp);
    const isHighImpact = event.impact === 'high';
    const isConference = event.isCentralBankConference === true;
    if (!isHighImpact && !isConference) continue;

    const windowStart = startMs - beforeMs;
    // Una conferencia con fin explícito se bloquea durante toda su duración;
    // sin fin, se aplica la misma ventana conservadora del evento publicado.
    const windowEnd = isConference && Number.isFinite(endMs)
      ? endMs
      : startMs + afterMs;
    if (nowMs >= windowStart && nowMs <= windowEnd) {
      return {
        blocked: true,
        event,
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date(windowEnd).toISOString(),
        reason: isConference
          ? 'NO OPERAR: riesgo alto durante conferencia de banco central.'
          : 'NO OPERAR: riesgo alto por evento económico.'
      };
    }
  }

  return { blocked: false, event: null, windowStart: null, windowEnd: null, reason: null };
}

export class EconomicCalendarService {
  constructor({
    apiKey = process.env.ECONOMIC_CALENDAR_API_KEY || '',
    apiUrl = process.env.ECONOMIC_CALENDAR_API_URL || '',
    source = process.env.ECONOMIC_CALENDAR_SOURCE || '',
    sourceUrl = process.env.ECONOMIC_CALENDAR_SOURCE_URL || '',
    headers = {},
    apiKeyHeader = 'Authorization',
    apiKeyPrefix = 'Bearer ',
    allowUnauthenticated = false,
    fetchImpl = globalThis.fetch,
    buildRequest = null,
    now = () => new Date()
  } = {}) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.source = source;
    this.sourceUrl = sourceUrl;
    this.headers = headers;
    this.apiKeyHeader = apiKeyHeader;
    this.apiKeyPrefix = apiKeyPrefix;
    this.allowUnauthenticated = allowUnauthenticated;
    this.fetchImpl = fetchImpl;
    this.buildRequest = buildRequest;
    this.now = now;
  }

  isConfigured() {
    return Boolean(asHttpUrl(this.apiUrl) && this.fetchImpl && (this.apiKey || this.allowUnauthenticated));
  }

  createRequest({ currencies = [], from, to, impact } = {}) {
    if (typeof this.buildRequest === 'function') {
      return this.buildRequest({ currencies, from, to, impact, apiKey: this.apiKey });
    }
    const url = new URL(this.apiUrl);
    if (currencies.length) url.searchParams.set('currencies', currencies.join(','));
    if (from) url.searchParams.set('from', new Date(from).toISOString());
    if (to) url.searchParams.set('to', new Date(to).toISOString());
    if (impact) url.searchParams.set('impact', impact);
    const headers = { Accept: 'application/json', ...this.headers };
    if (this.apiKey) headers[this.apiKeyHeader] = `${this.apiKeyPrefix}${this.apiKey}`;
    return { url: url.toString(), init: { headers } };
  }

  async getEvents({ currencies = [], from, to, impact } = {}) {
    const fetchedAt = this.now().toISOString();
    if (!this.isConfigured()) {
      return makeEnvelope({
        status: 'unavailable',
        source: this.source || null,
        reason: 'Calendario económico no configurado.',
        fetchedAt
      });
    }

    const normalizedCurrencies = normalizeCurrencies(currencies);
    try {
      const request = this.createRequest({ currencies: normalizedCurrencies, from, to, impact });
      if (!request?.url || !asHttpUrl(request.url)) {
        return makeEnvelope({ status: 'error', source: this.source, reason: 'URL de calendario no válida.', fetchedAt });
      }
      const response = await this.fetchImpl(request.url, request.init || {});
      if (!response?.ok) {
        return makeEnvelope({
          status: 'error',
          source: this.source,
          reason: `El proveedor de calendario respondió ${response?.status ?? 'sin estado'}.`,
          fetchedAt
        });
      }
      const payload = await response.json();
      const rows = extractRows(payload);
      const normalized = rows.map(row => normalizeEconomicEvent(row, {
        source: this.source,
        sourceUrl: this.sourceUrl || this.apiUrl
      })).filter(Boolean);
      const filtered = normalized.filter(event => inCurrencyScope(event, normalizedCurrencies))
        .filter(event => !impact || event.impact === normalizeImpact(impact));
      return makeEnvelope({
        status: 'available',
        source: this.source || null,
        events: filtered,
        fetchedAt,
        discardedCount: rows.length - normalized.length
      });
    } catch (error) {
      return makeEnvelope({
        status: 'error',
        source: this.source || null,
        reason: `No se pudo consultar el calendario: ${error instanceof Error ? error.message : 'error desconocido'}.`,
        fetchedAt
      });
    }
  }

  async getUpcomingEvents(options = {}) {
    return this.getEvents(options);
  }

  async getHighImpactWindow({ events, currencies = [], now = this.now(), beforeMinutes = 30, afterMinutes = 30 } = {}) {
    const calendar = events
      ? { status: 'available', events }
      : await this.getEvents({ currencies });
    if (calendar.status !== 'available') {
      return {
        blocked: false,
        event: null,
        windowStart: null,
        windowEnd: null,
        reason: calendar.reason || 'Calendario económico no disponible.',
        status: calendar.status
      };
    }
    return { ...isWithinHighImpactWindow(calendar.events, { now, beforeMinutes, afterMinutes, currencies }), status: calendar.status };
  }
}
