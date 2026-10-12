import { isWithinHighImpactWindow } from './economic-calendar-service.js';
import { isVerifiedNewsItem } from './financial-news-service.js';

const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'XAU']);
const BIASES = new Set(['BULLISH', 'BEARISH', 'NEUTRAL']);

function currenciesForSymbol(symbol) {
  if (typeof symbol !== 'string') return [];
  return symbol.toUpperCase().split('/').map(value => value.trim()).filter(value => SUPPORTED_CURRENCIES.has(value));
}

function asCurrencyList(value, fallback = []) {
  const candidates = Array.isArray(value) ? value : fallback;
  return [...new Set(candidates.map(item => String(item || '').toUpperCase()).filter(item => SUPPORTED_CURRENCIES.has(item)))];
}

function coerceEnvelope(value, key) {
  if (Array.isArray(value)) return { status: 'available', [key]: value, source: null };
  if (value && typeof value === 'object' && Array.isArray(value[key])) {
    return { status: value.status || 'available', source: value.source || null, ...value };
  }
  return { status: 'unavailable', source: null, [key]: [], reason: `${key} no disponible.` };
}

function unavailableEnvelope(key, reason) {
  return { status: 'unavailable', source: null, [key]: [], reason };
}

function sentimentSign(value) {
  const upper = String(value || '').toUpperCase();
  if (upper === 'BULLISH') return 1;
  if (upper === 'BEARISH') return -1;
  return 0;
}

function boundedRelevance(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 1;
}

function sourceReason(item) {
  return {
    title: item.title,
    source: item.source,
    timestamp: item.timestamp,
    url: item.url
  };
}

function itemEffectsForPair(item, [base, quote]) {
  const effects = [];
  const byCurrency = item.sentimentByCurrency && typeof item.sentimentByCurrency === 'object'
    ? item.sentimentByCurrency
    : {};

  // Cuando el proveedor informa sentimiento por moneda, ésa es la evidencia
  // preferida: no se deduce sentimiento a partir del texto del titular.
  for (const [currency, sentiment] of Object.entries(byCurrency)) {
    const sign = sentimentSign(sentiment);
    if (!sign) continue;
    if (currency === base) effects.push({ currency, direction: sign, weight: boundedRelevance(item.relevance) });
    if (currency === quote) effects.push({ currency, direction: -sign, weight: boundedRelevance(item.relevance) });
  }
  if (effects.length) return effects;

  // Un sentimiento genérico sólo se usa si el artículo afecta inequívocamente
  // a una sola de las monedas del par.
  const sign = sentimentSign(item.sentiment);
  const related = (item.currencies || []).filter(currency => currency === base || currency === quote);
  if (!sign || related.length !== 1) return [];
  return [{
    currency: related[0],
    direction: related[0] === base ? sign : -sign,
    weight: boundedRelevance(item.relevance)
  }];
}

function aggregateStatus(news, calendar) {
  if (news.status === 'available' && calendar.status === 'available') return 'available';
  if (news.status === 'error' || calendar.status === 'error') return 'error';
  if (news.status === 'available' || calendar.status === 'available') return 'partial';
  return 'unavailable';
}

/**
 * Construye contexto macro sólo a partir de registros verificables entregados
 * por los proveedores. No usa el texto de titulares para inventar sesgo.
 */
export class FundamentalAnalysisService {
  constructor({ newsService = null, calendarService = null, now = () => new Date() } = {}) {
    this.newsService = newsService;
    this.calendarService = calendarService;
    this.now = now;
  }

  async resolveNews(news, currencies) {
    if (news !== undefined) return coerceEnvelope(news, 'news');
    if (!this.newsService?.getVerifiedNews && !this.newsService?.getLatest) {
      return unavailableEnvelope('news', 'Servicio de noticias no configurado.');
    }
    try {
      const result = this.newsService.getVerifiedNews
        ? await this.newsService.getVerifiedNews({ currencies })
        : await this.newsService.getLatest({ currencies });
      return coerceEnvelope(result, 'news');
    } catch (error) {
      return { status: 'error', source: null, news: [], reason: `Error al consultar noticias: ${error instanceof Error ? error.message : 'error desconocido'}.` };
    }
  }

  async resolveCalendar(calendar, currencies) {
    if (calendar !== undefined) return coerceEnvelope(calendar, 'events');
    if (!this.calendarService?.getUpcomingEvents && !this.calendarService?.getEvents) {
      return unavailableEnvelope('events', 'Servicio de calendario no configurado.');
    }
    try {
      const result = this.calendarService.getUpcomingEvents
        ? await this.calendarService.getUpcomingEvents({ currencies })
        : await this.calendarService.getEvents({ currencies });
      return coerceEnvelope(result, 'events');
    } catch (error) {
      return { status: 'error', source: null, events: [], reason: `Error al consultar calendario: ${error instanceof Error ? error.message : 'error desconocido'}.` };
    }
  }

  async analyze({
    symbol,
    currencies,
    news,
    calendar,
    now = this.now(),
    beforeMinutes = 30,
    afterMinutes = 30
  } = {}) {
    const scopedCurrencies = asCurrencyList(currencies, currenciesForSymbol(symbol));
    if (scopedCurrencies.length !== 2) {
      return {
        status: 'unavailable',
        symbol: symbol || null,
        currencies: scopedCurrencies,
        bias: 'NEUTRAL',
        score: 0,
        reasons: [],
        verifiedNews: [],
        events: [],
        highImpactWindow: { blocked: false, event: null, reason: 'Símbolo no admitido para análisis fundamental.' },
        hasConflictingData: false
      };
    }

    const [newsEnvelope, calendarEnvelope] = await Promise.all([
      this.resolveNews(news, scopedCurrencies),
      this.resolveCalendar(calendar, scopedCurrencies)
    ]);
    const verifiedNews = (newsEnvelope.news || [])
      .filter(isVerifiedNewsItem)
      .filter(item => (item.currencies || []).some(currency => scopedCurrencies.includes(currency)));
    const events = (calendarEnvelope.events || []).filter(event => event
      && typeof event.title === 'string'
      && typeof event.source === 'string'
      && Number.isFinite(Date.parse(event.timestamp))
      && typeof event.url === 'string'
      && /^https?:\/\//i.test(event.url)
      && (event.currencies || []).some(currency => scopedCurrencies.includes(currency)));
    const highImpactWindow = calendarEnvelope.status === 'available'
      ? isWithinHighImpactWindow(events, { now, beforeMinutes, afterMinutes, currencies: scopedCurrencies })
      : { blocked: false, event: null, windowStart: null, windowEnd: null, reason: calendarEnvelope.reason || 'Calendario no disponible.' };
    const status = aggregateStatus(newsEnvelope, calendarEnvelope);

    if (status !== 'available') {
      return {
        status,
        symbol: symbol || `${scopedCurrencies.join('/')}`,
        currencies: scopedCurrencies,
        bias: 'NEUTRAL',
        score: 0,
        reasons: [],
        verifiedNews,
        events,
        highImpactWindow,
        hasConflictingData: false,
        dataAvailability: { news: newsEnvelope.status, calendar: calendarEnvelope.status },
        risks: [newsEnvelope.reason, calendarEnvelope.reason].filter(Boolean)
      };
    }

    if (highImpactWindow.blocked) {
      return {
        status: 'blocked',
        symbol: symbol || `${scopedCurrencies.join('/')}`,
        currencies: scopedCurrencies,
        bias: 'NEUTRAL',
        score: 0,
        reasons: [],
        verifiedNews,
        events,
        highImpactWindow,
        hasConflictingData: false,
        dataAvailability: { news: newsEnvelope.status, calendar: calendarEnvelope.status },
        risks: [highImpactWindow.reason]
      };
    }

    const directionalEvidence = verifiedNews.flatMap(item => itemEffectsForPair(item, scopedCurrencies)
      .map(effect => ({ ...effect, item })));
    const positive = directionalEvidence.filter(item => item.direction > 0);
    const negative = directionalEvidence.filter(item => item.direction < 0);
    const totalWeight = directionalEvidence.reduce((sum, item) => sum + item.weight, 0);
    const signedWeight = directionalEvidence.reduce((sum, item) => sum + item.weight * item.direction, 0);
    const score = totalWeight ? Math.max(-1, Math.min(1, signedWeight / totalWeight)) : 0;
    const bias = score > 0.1 ? 'BULLISH' : score < -0.1 ? 'BEARISH' : 'NEUTRAL';
    const hasConflictingData = positive.length > 0 && negative.length > 0;

    return {
      status: 'available',
      symbol: symbol || `${scopedCurrencies.join('/')}`,
      currencies: scopedCurrencies,
      bias: BIASES.has(bias) ? bias : 'NEUTRAL',
      score,
      reasons: directionalEvidence.map(({ item, currency, direction }) => ({
        ...sourceReason(item),
        currency,
        pairEffect: direction > 0 ? 'BULLISH' : 'BEARISH'
      })),
      verifiedNews,
      events,
      highImpactWindow,
      hasConflictingData,
      dataAvailability: { news: newsEnvelope.status, calendar: calendarEnvelope.status },
      // El contexto sólo enumera cobertura; no inventa causas macroeconómicas.
      macroContext: Object.fromEntries(scopedCurrencies.map(currency => [currency, {
        verifiedNews: verifiedNews.filter(item => item.currencies.includes(currency)).length,
        calendarEvents: events.filter(event => event.currencies.includes(currency)).length
      }])),
      risks: hasConflictingData ? ['Datos fundamentales contradictorios entre fuentes verificadas.'] : []
    };
  }

  async getAnalysis(options = {}) {
    return this.analyze(options);
  }
}
