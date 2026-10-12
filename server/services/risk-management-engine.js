/**
 * A deterministic safety gate.  This module has authority over a generated
 * idea: an orchestrator must turn a blocked BUY/SELL into NO_TRADE and may not
 * ask an AI model to override it.
 */

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

function timestampMilliseconds(timestamp) {
  if (typeof timestamp === 'number') return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getQuoteAgeMs(quote, now = Date.now()) {
  const timestamp = timestampMilliseconds(quote?.timestamp);
  return timestamp === null ? null : Math.max(0, now - timestamp);
}

/**
 * A quote is live only when the provider labelled it live and it is no older
 * than five seconds.  No caller is allowed to turn an unknown quote into live.
 */
export function deriveDataStatus(quote = {}, now = Date.now(), maxAgeMs = 5_000) {
  const providerStatus = String(quote.status ?? '').toLowerCase();
  const ageMs = getQuoteAgeMs(quote, now);
  if (providerStatus === 'closed') return 'closed';
  if (providerStatus === 'unavailable') return 'unavailable';
  if (providerStatus === 'delayed') return 'delayed';
  if (providerStatus !== 'live') return 'unavailable';
  if (ageMs === null || ageMs > maxAgeMs) return 'delayed';
  return 'live';
}

function entryPrice(signal) {
  const explicit = number(signal?.entryPrice);
  if (explicit !== null) return explicit;
  const minimum = number(signal?.entryZone?.minimum);
  const maximum = number(signal?.entryZone?.maximum);
  if (minimum !== null && maximum !== null) return (minimum + maximum) / 2;
  return minimum ?? maximum;
}

function signalDirection(signal) {
  const decision = String(signal?.decision ?? signal?.direction ?? '').toUpperCase();
  return decision === 'BUY' || decision === 'SELL' ? decision : null;
}

function highImpactBlock(calendar, highImpactWindow) {
  const window = highImpactWindow ?? calendar?.highImpactWindow;
  if (window?.blocked === true) return window;
  if (calendar?.blocked === true) return calendar;
  return null;
}

function eventMessage(event) {
  const title = event?.event?.title ?? event?.title;
  return title ? `NO OPERAR: riesgo alto por evento económico (${title}).`
    : 'NO OPERAR: riesgo alto por evento económico.';
}

function hasUsdExposure(activePositions, symbol) {
  if (!Array.isArray(activePositions) || !symbol?.includes('USD')) return false;
  return activePositions.some(position => {
    if (position?.active === false || position?.status === 'closed') return false;
    const positionSymbol = String(position?.symbol ?? position?.instrument ?? '');
    return positionSymbol.includes('USD');
  });
}

function technicalAnchor(technical, direction) {
  const m15 = technical?.timeframes?.M15;
  if (direction === 'BUY') {
    return number(m15?.supportResistance?.support)
      ?? number(m15?.zones?.demand?.minimum)
      ?? number(m15?.lastCandle?.low);
  }
  return number(m15?.supportResistance?.resistance)
    ?? number(m15?.zones?.supply?.maximum)
    ?? number(m15?.lastCandle?.high);
}

function logicalStop({direction, entry, stopLoss, technical}) {
  if (![entry, stopLoss].every(Number.isFinite)) return { valid: false, reason: 'No existe un stop loss numérico.' };
  if (direction === 'BUY' && stopLoss >= entry) return { valid: false, reason: 'El stop loss de una compra debe estar bajo la entrada.' };
  if (direction === 'SELL' && stopLoss <= entry) return { valid: false, reason: 'El stop loss de una venta debe estar sobre la entrada.' };

  const anchor = technicalAnchor(technical, direction);
  const atr = number(technical?.timeframes?.M15?.indicators?.atr14)
    ?? number(technical?.timeframes?.H1?.indicators?.atr14);
  if (!Number.isFinite(anchor) || !Number.isFinite(atr) || atr <= 0) {
    return { valid: false, reason: 'No hay soporte/resistencia y ATR verificables para justificar el stop loss.' };
  }
  const distanceFromAnchor = Math.abs(stopLoss - anchor);
  // A stop should be beyond its technical level, not inside it or many ATRs
  // away.  This is an objective sanity check, not a recommended trade size.
  const isBeyondAnchor = direction === 'BUY' ? stopLoss <= anchor + (atr * 0.2) : stopLoss >= anchor - (atr * 0.2);
  if (!isBeyondAnchor || distanceFromAnchor > atr * 3.5) {
    return { valid: false, reason: 'El stop loss no está situado de forma lógica respecto al nivel técnico y ATR.' };
  }
  return { valid: true, anchor, atr };
}

function riskReward({direction, entry, stopLoss, takeProfit}) {
  if (![entry, stopLoss, takeProfit].every(Number.isFinite)) return null;
  const risk = direction === 'BUY' ? entry - stopLoss : stopLoss - entry;
  const reward = direction === 'BUY' ? takeProfit - entry : entry - takeProfit;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

function maxSpreadBpsFor(symbol, config) {
  const configured = config.maxSpreadBpsBySymbol?.[symbol] ?? config.maxSpreadBps;
  return number(configured) ?? DEFAULT_MAX_SPREAD_BPS[symbol] ?? DEFAULT_MAX_SPREAD_BPS.default;
}

export class RiskManagementEngine {
  constructor(options = {}) {
    this.options = {
      maxDataAgeMs: 5_000,
      minimumRiskReward: 2,
      maxDailyDrawdownPercent: null,
      requireCalendarVerification: true,
      maxSpreadBpsBySymbol: DEFAULT_MAX_SPREAD_BPS,
      ...options
    };
  }

  evaluate(context = {}) {
    const { symbol, quote = {}, technical = {}, signal = {}, calendar = {}, highImpactWindow, account = {} } = context;
    const now = context.now instanceof Date ? context.now.getTime() : Number(context.now) || Date.now();
    const direction = signalDirection(signal);
    const blocks = [];
    const warnings = [];
    const addBlock = (code, message, details = {}) => blocks.push({ code, message, severity: 'BLOCK', ...details });

    const dataStatus = deriveDataStatus(quote, now, this.options.maxDataAgeMs);
    const dataAgeMs = getQuoteAgeMs(quote, now);
    if (dataStatus !== 'live') {
      addBlock(
        dataStatus === 'delayed' ? 'DELAYED_DATA' : 'NON_LIVE_DATA',
        dataStatus === 'delayed'
          ? 'Datos retrasados: no se generan señales nuevas.'
          : 'No hay datos reales en vivo: no se generan señales nuevas.',
        { dataStatus, dataAgeMs }
      );
    }

    if (!direction) {
      addBlock('NO_ACTIONABLE_DIRECTION', 'La propuesta no contiene una dirección de compra o venta verificable.');
    }

    const impact = highImpactBlock(calendar, highImpactWindow);
    if (impact) addBlock('HIGH_IMPACT_EVENT', eventMessage(impact), { event: impact.event ?? impact });

    const calendarStatus = String(calendar?.status ?? '').toLowerCase();
    if (this.options.requireCalendarVerification && calendarStatus !== 'available') {
      addBlock('CALENDAR_UNAVAILABLE', 'No se puede verificar el calendario económico; no se genera una señal válida.');
    }

    if (technical?.dataQuality?.readyForSignal !== true) {
      addBlock('INSUFFICIENT_CLOSED_CANDLES', 'No hay suficientes velas cerradas para validar la señal.');
    }

    const h4Trend = technical?.timeframes?.H4?.trend;
    const h1Trend = technical?.timeframes?.H1?.trend;
    if (['BULLISH', 'BEARISH'].includes(h4Trend)
      && ['BULLISH', 'BEARISH'].includes(h1Trend) && h4Trend !== h1Trend) {
      addBlock('CONTRADICTORY_HIGHER_TIMEFRAMES', 'H4 y H1 son contradictorios.');
    }

    if (technical?.volatility?.classification === 'ABNORMAL'
      || technical?.timeframes?.H1?.volatility?.classification === 'ABNORMAL') {
      addBlock('ABNORMAL_VOLATILITY', 'La volatilidad es anormalmente alta para una señal nueva.');
    }

    if (context.fundamental?.hasConflictingData === true) {
      addBlock('CONFLICTING_MACRO_DATA', 'Existen datos macroeconómicos contradictorios.');
    }

    const bid = number(quote.bid);
    const ask = number(quote.ask);
    const mid = number(quote.mid) ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
    const spread = bid !== null && ask !== null ? ask - bid : null;
    const spreadBps = Number.isFinite(spread) && Number.isFinite(mid) && mid > 0 ? (spread / mid) * 10_000 : null;
    const maxSpreadBps = maxSpreadBpsFor(symbol, this.options);
    if (quote.spreadVerified === false) addBlock('UNVERIFIED_SPREAD', 'La fuente pública entrega un precio único, no bid y ask verificables; no se genera una señal accionable.');
    else if (spreadBps === null) addBlock('MISSING_SPREAD', 'No hay bid y ask verificables para validar el spread.');
    else if (spreadBps > maxSpreadBps) {
      addBlock('EXCESSIVE_SPREAD', 'El spread supera el límite configurado.', { spreadBps: round(spreadBps, 3), maxSpreadBps });
    }

    const entry = entryPrice(signal);
    const stopLoss = number(signal.stopLoss);
    const takeProfit1 = number(signal.takeProfit1);
    const calculatedRiskReward = direction && entry !== null && stopLoss !== null && takeProfit1 !== null
      ? riskReward({ direction, entry, stopLoss, takeProfit: takeProfit1 }) : null;
    const stopCheck = direction ? logicalStop({ direction, entry, stopLoss, technical }) : { valid: false };
    if (direction && !stopCheck.valid) addBlock('ILLOGICAL_STOP_LOSS', stopCheck.reason);
    if (direction && (calculatedRiskReward === null || calculatedRiskReward < this.options.minimumRiskReward)) {
      addBlock('RISK_REWARD_TOO_LOW', `La relación riesgo/beneficio debe ser al menos 1:${this.options.minimumRiskReward}.`, {
        riskReward: round(calculatedRiskReward, 2)
      });
    }

    if (context.activeCorrelatedUsdTrade === true || hasUsdExposure(context.activePositions, symbol)) {
      addBlock('CORRELATED_USD_EXPOSURE', 'Existe una operación activa correlacionada con USD.');
    }

    const dailyLimitReached = account?.dailyLossLimitReached === true || context.dailyLossLimitReached === true;
    const configuredDrawdown = number(account?.maxDailyDrawdownPercent) ?? number(this.options.maxDailyDrawdownPercent);
    const currentDrawdown = number(account?.dailyDrawdownPercent);
    if (dailyLimitReached || (configuredDrawdown !== null && currentDrawdown !== null && currentDrawdown >= configuredDrawdown)) {
      addBlock('DAILY_LOSS_LIMIT_REACHED', 'Se alcanzó el límite diario de pérdidas configurado.');
    }

    if (technical?.session?.isLiquid === false) {
      warnings.push({ code: 'LOW_LIQUIDITY_SESSION', message: 'La sesión actual no es Londres, Nueva York ni su solapamiento.' });
    }

    return {
      allowed: blocks.length === 0,
      status: blocks.length === 0 ? 'APPROVED' : 'BLOCKED',
      dataStatus,
      dataAgeMs,
      direction,
      entryPrice: round(entry),
      stopLoss: round(stopLoss),
      takeProfit1: round(takeProfit1),
      riskReward: round(calculatedRiskReward, 2),
      spread: round(spread),
      spreadBps: round(spreadBps, 3),
      maxSpreadBps,
      blocks,
      warnings
    };
  }
}
