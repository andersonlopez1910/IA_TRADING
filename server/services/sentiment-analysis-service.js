import { isVerifiedNewsItem } from './financial-news-service.js';

const SUPPORTED_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'XAU']);

function currenciesForSymbol(symbol) {
  return typeof symbol === 'string'
    ? symbol.toUpperCase().split('/').map(value => value.trim()).filter(value => SUPPORTED_CURRENCIES.has(value))
    : [];
}

function normalizeCurrencies(value, fallback = []) {
  const values = Array.isArray(value) ? value : fallback;
  return [...new Set(values.map(item => String(item || '').toUpperCase()).filter(item => SUPPORTED_CURRENCIES.has(item)))];
}

function signFromSentiment(value) {
  const sentiment = String(value || '').toUpperCase();
  if (sentiment === 'BULLISH') return 1;
  if (sentiment === 'BEARISH') return -1;
  return 0;
}

function scoreFromItem(item) {
  const score = Number(item.sentimentScore);
  if (Number.isFinite(score) && score !== 0) return Math.max(-1, Math.min(1, score));
  return signFromSentiment(item.sentiment);
}

function relevanceFromItem(item) {
  const relevance = Number(item.relevance);
  return Number.isFinite(relevance) ? Math.max(0, Math.min(1, relevance)) : 1;
}

function coerceNews(value) {
  if (Array.isArray(value)) return { status: 'available', news: value, source: null };
  if (value && typeof value === 'object' && Array.isArray(value.news)) return { status: value.status || 'available', ...value };
  return { status: 'unavailable', news: [], source: null, reason: 'Noticias no disponibles.' };
}

function directionForPair(item, [base, quote]) {
  const byCurrency = item.sentimentByCurrency && typeof item.sentimentByCurrency === 'object'
    ? item.sentimentByCurrency
    : {};
  const results = [];
  for (const [currency, sentiment] of Object.entries(byCurrency)) {
    const sign = signFromSentiment(sentiment);
    if (!sign) continue;
    if (currency === base) results.push({ currency, score: sign });
    if (currency === quote) results.push({ currency, score: -sign });
  }
  if (results.length) return results;

  const related = (item.currencies || []).filter(currency => currency === base || currency === quote);
  if (related.length !== 1) return [];
  const score = scoreFromItem(item);
  if (!score) return [];
  return [{ currency: related[0], score: related[0] === base ? score : -score }];
}

/**
 * Agrega el sentimiento estructurado de un proveedor de noticias. No realiza
 * análisis de tono local, LLM o heurísticas sobre el texto de los titulares.
 */
export class SentimentAnalysisService {
  constructor({ newsService = null } = {}) {
    this.newsService = newsService;
  }

  async resolveNews(news, currencies) {
    if (news !== undefined) return coerceNews(news);
    if (!this.newsService?.getVerifiedNews && !this.newsService?.getLatest) {
      return coerceNews(undefined);
    }
    try {
      const response = this.newsService.getVerifiedNews
        ? await this.newsService.getVerifiedNews({ currencies })
        : await this.newsService.getLatest({ currencies });
      return coerceNews(response);
    } catch (error) {
      return {
        status: 'error',
        source: null,
        news: [],
        reason: `Error al consultar sentimiento: ${error instanceof Error ? error.message : 'error desconocido'}.`
      };
    }
  }

  async analyze({ symbol, currencies, news } = {}) {
    const scopedCurrencies = normalizeCurrencies(currencies, currenciesForSymbol(symbol));
    if (scopedCurrencies.length !== 2) {
      return {
        status: 'unavailable',
        symbol: symbol || null,
        bias: 'NEUTRAL',
        score: 0,
        confidence: 0,
        coverage: 0,
        reasons: [],
        evidence: [],
        reason: 'Símbolo no admitido para sentimiento.'
      };
    }

    const newsEnvelope = await this.resolveNews(news, scopedCurrencies);
    if (newsEnvelope.status !== 'available') {
      return {
        status: newsEnvelope.status,
        symbol: symbol || scopedCurrencies.join('/'),
        bias: 'NEUTRAL',
        score: 0,
        confidence: 0,
        coverage: 0,
        reasons: [],
        evidence: [],
        reason: newsEnvelope.reason || 'Noticias verificadas no disponibles.'
      };
    }

    const verifiedNews = newsEnvelope.news
      .filter(isVerifiedNewsItem)
      .filter(item => (item.currencies || []).some(currency => scopedCurrencies.includes(currency)));
    const contributions = verifiedNews.flatMap(item => directionForPair(item, scopedCurrencies)
      .map(effect => ({ ...effect, item, weight: relevanceFromItem(item) })));
    if (!contributions.length) {
      return {
        status: 'insufficient',
        symbol: symbol || scopedCurrencies.join('/'),
        bias: 'NEUTRAL',
        score: 0,
        confidence: 0,
        coverage: 0,
        reasons: [],
        evidence: verifiedNews.map(item => ({
          type: 'news', source: item.source, timestamp: item.timestamp, reference: item.url
        })),
        reason: 'No hay sentimiento estructurado y verificable para el par seleccionado.'
      };
    }

    const weight = contributions.reduce((sum, contribution) => sum + contribution.weight, 0);
    const weightedScore = contributions.reduce((sum, contribution) => sum + contribution.score * contribution.weight, 0);
    const score = weight ? Math.max(-1, Math.min(1, weightedScore / weight)) : 0;
    const bias = score > 0.1 ? 'BULLISH' : score < -0.1 ? 'BEARISH' : 'NEUTRAL';
    const directionalCoverage = contributions.length / Math.max(1, verifiedNews.length);
    const averageRelevance = weight / contributions.length;

    return {
      status: 'available',
      symbol: symbol || scopedCurrencies.join('/'),
      bias,
      score,
      // Es cobertura de los datos, no una predicción de rendimiento.
      confidence: Math.round(Math.min(100, (directionalCoverage * 50) + (averageRelevance * 50))),
      coverage: Number(directionalCoverage.toFixed(4)),
      reasons: contributions.map(({ item, currency, score: direction }) => ({
        title: item.title,
        source: item.source,
        timestamp: item.timestamp,
        url: item.url,
        currency,
        pairEffect: direction > 0 ? 'BULLISH' : 'BEARISH'
      })),
      evidence: contributions.map(({ item }) => ({
        type: 'news', source: item.source, timestamp: item.timestamp, reference: item.url
      }))
    };
  }

  async getAnalysis(options = {}) {
    return this.analyze(options);
  }
}
