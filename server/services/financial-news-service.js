/**
 * Adaptador estricto para noticias financieras. La aplicación no sintetiza
 * titulares: sólo entrega artículos que tienen título, fuente, fecha UTC y URL
 * HTTP(S) comprobables en la respuesta del proveedor autorizado.
 */
const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'XAU']);
const IMPACTS = new Set(['low', 'medium', 'high']);
const SENTIMENTS = new Set(['BULLISH', 'BEARISH', 'NEUTRAL']);

function asHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function asUtcIso(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim() || null;
}

function normalizeCurrencies(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[\s,;/|]+/);
  return [...new Set(values
    .map(item => String(item || '').trim().toUpperCase())
    .filter(item => SUPPORTED_CURRENCIES.has(item)))];
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

function normalizeSentiment(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (SENTIMENTS.has(normalized)) return normalized;
  if (['POSITIVE', 'POSITIVE_FOR_CURRENCY', 'ALCISTA'].includes(normalized)) return 'BULLISH';
  if (['NEGATIVE', 'NEGATIVE_FOR_CURRENCY', 'BAJISTA'].includes(normalized)) return 'BEARISH';
  if (['MIXED', 'NONE', 'NEUTRO'].includes(normalized)) return 'NEUTRAL';
  return null;
}

function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  // Acepta escalas -1..1 y -100..100 del proveedor, pero nunca fabrica score.
  const score = Math.abs(number) > 1 ? number / 100 : number;
  return Math.max(-1, Math.min(1, score));
}

function normalizeRelevance(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  const normalized = number > 1 ? number / 100 : number;
  return Math.max(0, Math.min(1, normalized));
}

function normalizeSentimentByCurrency(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([currency, sentiment]) => [currency.toUpperCase(), normalizeSentiment(sentiment)])
    .filter(([currency, sentiment]) => SUPPORTED_CURRENCIES.has(currency) && sentiment));
}

function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['articles', 'news', 'data', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function inCurrencyScope(record, currencies) {
  if (!currencies?.length) return true;
  return record.currencies.some(currency => currencies.includes(currency));
}

/** Devuelve `null` si el artículo no pasa la validación de fuente/fecha/URL. */
export function normalizeVerifiedNewsItem(raw, { source } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const title = firstString(raw.title, raw.headline, raw.name, raw.summary_title);
  const timestamp = asUtcIso(raw.publishedAt ?? raw.published_at ?? raw.timestamp ?? raw.datetime ?? raw.date ?? raw.time);
  const url = asHttpUrl(raw.url ?? raw.link ?? raw.web_url ?? raw.articleUrl ?? raw.article_url);
  const newsSource = firstString(
    typeof raw.source === 'object' ? raw.source.name : raw.source,
    typeof raw.publisher === 'object' ? raw.publisher.name : raw.publisher,
    raw.provider,
    source
  );
  if (!title || !timestamp || !url || !newsSource) return null;

  const currencies = normalizeCurrencies(raw.currencies ?? raw.currency ?? raw.affectedCurrencies ?? raw.affected_currencies);
  const sentimentByCurrency = normalizeSentimentByCurrency(raw.sentimentByCurrency ?? raw.sentiment_by_currency);
  return Object.freeze({
    id: String(raw.id ?? raw.articleId ?? raw.uuid ?? `${newsSource}:${timestamp}:${url}`),
    title,
    source: newsSource,
    url,
    timestamp,
    currencies,
    impact: normalizeImpact(raw.impact ?? raw.importance ?? raw.priority) || 'unknown',
    // Sólo preservamos sentimiento estructurado que el proveedor entregó.
    sentiment: normalizeSentiment(raw.sentiment ?? raw.sentimentLabel ?? raw.sentiment_label),
    sentimentScore: normalizeScore(raw.sentimentScore ?? raw.sentiment_score),
    sentimentByCurrency,
    relevance: normalizeRelevance(raw.relevance ?? raw.relevanceScore ?? raw.relevance_score),
    summary: firstString(raw.summary, raw.description, raw.excerpt) || null
  });
}

export function isVerifiedNewsItem(item) {
  return Boolean(item
    && typeof item.title === 'string' && item.title.trim()
    && typeof item.source === 'string' && item.source.trim()
    && Number.isFinite(Date.parse(item.timestamp))
    && asHttpUrl(item.url));
}

function makeEnvelope({ status, source, news = [], reason, fetchedAt, discardedCount = 0 }) {
  return {
    status,
    source: source || null,
    fetchedAt: fetchedAt || new Date().toISOString(),
    news,
    discardedCount,
    ...(reason ? { reason } : {})
  };
}

export class FinancialNewsService {
  constructor({
    apiKey = process.env.NEWS_API_KEY || '',
    apiUrl = process.env.NEWS_API_URL || '',
    source = process.env.NEWS_SOURCE || '',
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

  createRequest({ currencies = [], from, to, limit = 25 } = {}) {
    if (typeof this.buildRequest === 'function') {
      return this.buildRequest({ currencies, from, to, limit, apiKey: this.apiKey });
    }
    const url = new URL(this.apiUrl);
    if (currencies.length) url.searchParams.set('currencies', currencies.join(','));
    if (from) url.searchParams.set('from', new Date(from).toISOString());
    if (to) url.searchParams.set('to', new Date(to).toISOString());
    url.searchParams.set('limit', String(Math.max(1, Math.min(100, Number(limit) || 25))));
    const headers = { Accept: 'application/json', ...this.headers };
    if (this.apiKey) headers[this.apiKeyHeader] = `${this.apiKeyPrefix}${this.apiKey}`;
    return { url: url.toString(), init: { headers } };
  }

  async getLatest({ currencies = [], from, to, limit = 25 } = {}) {
    const fetchedAt = this.now().toISOString();
    if (!this.isConfigured()) {
      return makeEnvelope({
        status: 'unavailable',
        source: this.source || null,
        reason: 'Proveedor de noticias no configurado.',
        fetchedAt
      });
    }

    const normalizedCurrencies = normalizeCurrencies(currencies);
    try {
      const request = this.createRequest({ currencies: normalizedCurrencies, from, to, limit });
      if (!request?.url || !asHttpUrl(request.url)) {
        return makeEnvelope({ status: 'error', source: this.source, reason: 'URL de noticias no válida.', fetchedAt });
      }
      const response = await this.fetchImpl(request.url, request.init || {});
      if (!response?.ok) {
        return makeEnvelope({
          status: 'error',
          source: this.source,
          reason: `El proveedor de noticias respondió ${response?.status ?? 'sin estado'}.`,
          fetchedAt
        });
      }
      const payload = await response.json();
      const rows = extractRows(payload);
      const normalized = rows.map(row => normalizeVerifiedNewsItem(row, { source: this.source })).filter(Boolean);
      return makeEnvelope({
        status: 'available',
        source: this.source || null,
        news: normalized.filter(item => inCurrencyScope(item, normalizedCurrencies)),
        fetchedAt,
        discardedCount: rows.length - normalized.length
      });
    } catch (error) {
      return makeEnvelope({
        status: 'error',
        source: this.source || null,
        reason: `No se pudieron consultar las noticias: ${error instanceof Error ? error.message : 'error desconocido'}.`,
        fetchedAt
      });
    }
  }

  async getVerifiedNews(options = {}) {
    return this.getLatest(options);
  }
}
