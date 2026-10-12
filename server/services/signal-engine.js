import { deriveDataStatus } from './risk-management-engine.js';

const DEFAULT_MAX_SPREAD_BPS = Object.freeze({
  'EUR/USD': 3.5,
  'GBP/USD': 4.5,
  'USD/JPY': 3.5,
  'XAU/USD': 18,
  default: 5
});

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const number = value => (finite(value) ? Number(value) : null);
const round = (value, digits = 6) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

function emptyEntryZone(trigger = 'No hay una condición de entrada válida.') {
  return { minimum: null, maximum: null, trigger };
}

function formatDirection(direction) {
  return direction === 'BUY' ? 'compra' : direction === 'SELL' ? 'venta' : 'operación';
}

function marketDirection(technical) {
  const h4 = technical?.timeframes?.H4?.trend;
  const h1 = technical?.timeframes?.H1?.trend;
  if (h4 === 'BULLISH' && h1 === 'BULLISH') return 'BUY';
  if (h4 === 'BEARISH' && h1 === 'BEARISH') return 'SELL';
  return null;
}

function getBlockedHighImpactWindow(calendar, explicitWindow) {
  const window = explicitWindow ?? calendar?.highImpactWindow;
  return window?.blocked === true ? window : null;
}

function maxSpreadBps(symbol, options) {
  const configured = options.maxSpreadBpsBySymbol?.[symbol] ?? options.maxSpreadBps;
  return number(configured) ?? DEFAULT_MAX_SPREAD_BPS[symbol] ?? DEFAULT_MAX_SPREAD_BPS.default;
}

function quoteSpreadBps(quote) {
  const bid = number(quote?.bid);
  const ask = number(quote?.ask);
  const mid = number(quote?.mid) ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
  if (bid === null || ask === null || mid === null || mid <= 0) return null;
  return ((ask - bid) / mid) * 10_000;
}

function plannedLevels(direction, quote, technical) {
  const m15 = technical?.timeframes?.M15;
  const m5 = technical?.timeframes?.M5;
  const entry = number(quote?.mid) ?? number(m5?.lastCandle?.close);
  const atr = number(m15?.indicators?.atr14) ?? number(m5?.indicators?.atr14);
  if (entry === null || atr === null || atr <= 0) return null;

  const ema20 = number(m15?.indicators?.ema20);
  const ema50 = number(m15?.indicators?.ema50);
  const spread = number(quote?.ask) !== null && number(quote?.bid) !== null ? number(quote.ask) - number(quote.bid) : 0;
  const zonePadding = Math.max(Math.abs(spread) * 1.5, atr * 0.08);
  if (direction === 'BUY') {
    const support = number(m15?.supportResistance?.support) ?? number(m5?.lastCandle?.low);
    if (support === null || support >= entry) return null;
    const stopLoss = Math.min(support - (atr * 0.15), entry - (atr * 0.5));
    const risk = entry - stopLoss;
    const zoneAnchor = [ema20, ema50, support].filter(value => value !== null && value <= entry).sort((a, b) => b - a)[0] ?? entry;
    return {
      entryPrice: entry,
      entryZone: {
        minimum: Math.min(entry, zoneAnchor) - zonePadding,
        maximum: entry + zonePadding,
        trigger: 'Esperar cierre M5 alcista confirmado en la zona técnica.'
      },
      stopLoss,
      takeProfit1: entry + (risk * 2),
      takeProfit2: entry + (risk * 3),
      riskReward: 2,
      invalidation: [`Cierre M15 bajo ${round(stopLoss)}.`]
    };
  }

  const resistance = number(m15?.supportResistance?.resistance) ?? number(m5?.lastCandle?.high);
  if (resistance === null || resistance <= entry) return null;
  const stopLoss = Math.max(resistance + (atr * 0.15), entry + (atr * 0.5));
  const risk = stopLoss - entry;
  const zoneAnchor = [ema20, ema50, resistance].filter(value => value !== null && value >= entry).sort((a, b) => a - b)[0] ?? entry;
  return {
    entryPrice: entry,
    entryZone: {
      minimum: entry - zonePadding,
      maximum: Math.max(entry, zoneAnchor) + zonePadding,
      trigger: 'Esperar cierre M5 bajista confirmado en la zona técnica.'
    },
    stopLoss,
    takeProfit1: entry - (risk * 2),
    takeProfit2: entry - (risk * 3),
    riskReward: 2,
    invalidation: [`Cierre M15 sobre ${round(stopLoss)}.`]
  };
}

function indicatorsAreHealthy(direction, technical) {
  const h1 = technical?.timeframes?.H1;
  const rsi = number(h1?.indicators?.rsi14);
  const atr = number(h1?.indicators?.atr14);
  const price = number(h1?.lastCandle?.close);
  const ema50 = number(h1?.indicators?.ema50);
  const ema200 = number(h1?.indicators?.ema200);
  if ([rsi, atr, price, ema50, ema200].some(value => value === null) || atr <= 0) return false;
  const rsiInRange = direction === 'BUY' ? rsi >= 35 && rsi < 72 : rsi > 28 && rsi <= 65;
  const emaAligned = direction === 'BUY'
    ? price > ema200 && ema50 > ema200
    : price < ema200 && ema50 < ema200;
  return rsiInRange && emaAligned && technical?.volatility?.classification !== 'ABNORMAL';
}

function buildScore({ symbol, direction, quote, technical, fundamental, levels, options }) {
  const m15 = technical?.timeframes?.M15;
  const m5 = technical?.timeframes?.M5;
  const h4 = technical?.timeframes?.H4;
  const h1 = technical?.timeframes?.H1;
  const bullish = direction === 'BUY';
  const alignment = (bullish ? h4?.trend === 'BULLISH' && h1?.trend === 'BULLISH' : h4?.trend === 'BEARISH' && h1?.trend === 'BEARISH');
  const inTechnicalZone = Boolean(bullish ? m15?.setup?.pullback?.bullish : m15?.setup?.pullback?.bearish);
  const m5Confirmed = Boolean(m5?.lastCandle?.closed && (bullish ? m5?.setup?.confirmation?.bullish : m5?.setup?.confirmation?.bearish));
  const healthyIndicators = indicatorsAreHealthy(direction, technical);
  const spreadBps = quoteSpreadBps(quote);
  const liquidAndTight = technical?.session?.isLiquid === true
    && spreadBps !== null && spreadBps <= maxSpreadBps(symbol, options);
  const fundamentalsFavourable = fundamental?.status === 'available'
    && fundamental?.hasConflictingData !== true
    && fundamental?.bias === (bullish ? 'BULLISH' : 'BEARISH');
  const rewardOkay = number(levels?.riskReward) !== null && number(levels.riskReward) >= 2;
  const parts = {
    higherTimeframeAlignment: alignment ? 25 : 0,
    m15TechnicalZone: inTechnicalZone ? 20 : 0,
    m5ClosedCandleConfirmation: m5Confirmed ? 20 : 0,
    indicatorsAndVolatility: healthyIndicators ? 10 : 0,
    spreadAndLiquiditySession: liquidAndTight ? 10 : 0,
    verifiedNewsAndCalendar: fundamentalsFavourable ? 10 : 0,
    minimumRiskReward: rewardOkay ? 5 : 0
  };
  return {
    points: parts,
    total: Object.values(parts).reduce((total, points) => total + points, 0),
    checks: { alignment, inTechnicalZone, m5Confirmed, healthyIndicators, liquidAndTight, fundamentalsFavourable, rewardOkay, spreadBps: round(spreadBps, 3) }
  };
}

function baseResult({ symbol, dataStatus, reason }) {
  return {
    symbol,
    decision: 'NO_TRADE',
    intendedDecision: 'NO_TRADE',
    confidence: 0,
    score: { total: 0, points: {}, checks: {} },
    entryZone: emptyEntryZone(reason),
    entryPrice: null,
    stopLoss: null,
    takeProfit1: null,
    takeProfit2: null,
    riskReward: null,
    expiryMinutes: 0,
    technicalReasons: [],
    risks: [reason],
    invalidation: [],
    requiredConfirmation: [reason],
    dataStatus
  };
}

/**
 * Produces an informational candidate from structured analysis.  It does not
 * execute orders, call a broker, or override the independent risk engine.
 */
export class SignalEngine {
  constructor(options = {}) {
    this.options = {
      maxSpreadBpsBySymbol: DEFAULT_MAX_SPREAD_BPS,
      maxDataAgeMs: 5_000,
      ...options
    };
  }

  generate(context = {}) {
    const { symbol, quote = {}, technical = {}, fundamental = {}, calendar = {}, highImpactWindow } = context;
    const now = context.now instanceof Date ? context.now.getTime() : Number(context.now) || Date.now();
    const dataStatus = deriveDataStatus(quote, now, this.options.maxDataAgeMs);
    if (dataStatus !== 'live') {
      return baseResult({
        symbol,
        dataStatus,
        reason: dataStatus === 'delayed'
          ? 'Datos retrasados: no se generan señales nuevas.'
          : 'No hay datos reales en vivo para generar una señal.'
      });
    }
    if (technical?.dataQuality?.readyForSignal !== true) {
      return baseResult({ symbol, dataStatus, reason: 'Se requieren velas cerradas suficientes para validar la señal.' });
    }
    const blockedEvent = getBlockedHighImpactWindow(calendar, highImpactWindow);
    if (blockedEvent) {
      const title = blockedEvent?.event?.title ?? blockedEvent?.title;
      return baseResult({
        symbol,
        dataStatus,
        reason: title ? `NO OPERAR: riesgo alto por evento económico (${title}).` : 'NO OPERAR: riesgo alto por evento económico.'
      });
    }
    if (String(calendar?.status ?? '').toLowerCase() !== 'available') {
      return baseResult({ symbol, dataStatus, reason: 'No se puede verificar el calendario económico.' });
    }
    if (fundamental?.hasConflictingData === true) {
      return baseResult({ symbol, dataStatus, reason: 'Los datos macroeconómicos son contradictorios.' });
    }

    const direction = marketDirection(technical);
    if (!direction) {
      return baseResult({ symbol, dataStatus, reason: 'H4 y H1 no presentan una tendencia operativa alineada.' });
    }
    const levels = plannedLevels(direction, quote, technical);
    if (!levels) {
      return baseResult({ symbol, dataStatus, reason: 'No se pudo definir una zona, stop y ATR técnicos verificables.' });
    }
    const score = buildScore({ symbol, direction, quote, technical, fundamental, levels, options: this.options });
    const m15 = technical.timeframes.M15;
    const m5 = technical.timeframes.M5;
    const technicalReasons = [
      `H4 y H1 están alineados en sesgo ${direction === 'BUY' ? 'alcista' : 'bajista'}.`,
      `M15 ${direction === 'BUY' ? 'evalúa un retroceso hacia soporte/demanda o media móvil' : 'evalúa un retroceso hacia resistencia/oferta o media móvil'}.`,
      `La confirmación se basa únicamente en la última vela M5 cerrada (${m5.pattern.name}).`
    ];
    const prerequisites = [
      score.checks.inTechnicalZone ? null : `Esperar que M15 alcance una zona técnica de ${formatDirection(direction)}.`,
      score.checks.m5Confirmed ? null : `Esperar una vela M5 cerrada de confirmación de ${formatDirection(direction)}.`,
      score.checks.healthyIndicators ? null : 'Esperar indicadores H1 y volatilidad compatibles.',
      score.checks.liquidAndTight ? null : 'Esperar spread aceptable durante una sesión líquida.',
      !score.checks.fundamentalsFavourable ? 'Contexto fundamental verificado no alineado; no suma confianza.' : null
    ].filter(Boolean);

    let decision = 'NO_TRADE';
    if (score.total >= 80 && prerequisites.length === 0) decision = direction;
    else if (score.total >= 60 && score.checks.alignment) decision = 'WAIT';
    const requirements = decision === direction
      ? []
      : prerequisites.length ? prerequisites : ['La puntuación objetiva no alcanzó el umbral de una señal válida.'];

    return {
      symbol,
      decision,
      intendedDecision: direction,
      confidence: score.total,
      score,
      ...levels,
      expiryMinutes: decision === direction ? 15 : 0,
      dataStatus,
      technicalReasons,
      risks: [
        technical.volatility?.classification === 'ELEVATED' ? 'Volatilidad elevada; vigilar ampliación de spread.' : null,
        fundamental?.status !== 'available' ? 'No hay contexto fundamental verificable suficiente para sumar confianza.' : null
      ].filter(Boolean),
      invalidation: levels.invalidation,
      requiredConfirmation: requirements
    };
  }
}
