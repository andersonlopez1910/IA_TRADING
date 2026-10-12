/**
 * Technical analysis built exclusively from candles supplied by the authorised
 * market-data provider.  In particular, an in-progress candle is never used
 * for a confirmation or an indicator value.
 */

const TIMEFRAMES = Object.freeze(['H4', 'H1', 'M15', 'M5']);
const EPSILON = 1e-12;

const isFiniteNumber = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const toNumber = value => (isFiniteNumber(value) ? Number(value) : null);
const round = (value, digits = 6) => (
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null
);

function candleTime(value) {
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseClosedCandle(candle) {
  // The provider (or CandleService) must explicitly mark a candle as final.
  // Inferring closure from its timestamp would let a late/out-of-order tick
  // become an invalid trading confirmation.
  const closed = candle?.closed === true
    || candle?.isClosed === true
    || candle?.complete === true
    || candle?.final === true;
  if (!closed) return null;

  const time = candleTime(candle.time ?? candle.timestamp ?? candle.openTime);
  const open = toNumber(candle.open);
  const high = toNumber(candle.high);
  const low = toNumber(candle.low);
  const close = toNumber(candle.close);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) return null;

  return {
    time,
    open,
    high,
    low,
    close,
    volume: toNumber(candle.volume) ?? 0,
    closed: true
  };
}

/** Exposed for tests and for adapters that need to enforce the same rule. */
export function onlyClosedCandles(candles) {
  const byTime = new Map();
  for (const candle of Array.isArray(candles) ? candles : []) {
    const normalised = normaliseClosedCandle(candle);
    if (normalised) byTime.set(normalised.time, normalised);
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time);
}

export function calculateEma(values, period) {
  if (!Array.isArray(values) || values.length < period || period < 1) return null;
  const sample = values.slice(0, period);
  if (!sample.every(Number.isFinite)) return null;
  let ema = sample.reduce((total, value) => total + value, 0) / period;
  const multiplier = 2 / (period + 1);
  for (const value of values.slice(period)) {
    if (!Number.isFinite(value)) return null;
    ema = (value - ema) * multiplier + ema;
  }
  return ema;
}

export function calculateRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (!Number.isFinite(delta)) return null;
    gains += Math.max(delta, 0);
    losses += Math.max(-delta, 0);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (!Number.isFinite(delta)) return null;
    averageGain = ((averageGain * (period - 1)) + Math.max(delta, 0)) / period;
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-delta, 0)) / period;
  }
  if (averageLoss < EPSILON) return 100;
  if (averageGain < EPSILON) return 0;
  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

export function calculateAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;
    const range = Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
    if (!Number.isFinite(range)) return null;
    trueRanges.push(range);
  }
  if (trueRanges.length < period) return null;
  let atr = trueRanges.slice(0, period).reduce((total, value) => total + value, 0) / period;
  for (const range of trueRanges.slice(period)) {
    atr = ((atr * (period - 1)) + range) / period;
  }
  return atr;
}

export function calculateBollinger(closes, period = 20, deviation = 2) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  const sample = closes.slice(-period);
  if (!sample.every(Number.isFinite)) return null;
  const middle = sample.reduce((total, value) => total + value, 0) / period;
  const variance = sample.reduce((total, value) => total + ((value - middle) ** 2), 0) / period;
  const standardDeviation = Math.sqrt(variance);
  return {
    middle,
    upper: middle + (standardDeviation * deviation),
    lower: middle - (standardDeviation * deviation),
    standardDeviation
  };
}

function findSwingPoints(candles, type, width = 2) {
  const points = [];
  for (let index = width; index < candles.length - width; index += 1) {
    const value = candles[index][type];
    const comparator = type === 'high'
      ? neighbour => value >= neighbour.high
      : neighbour => value <= neighbour.low;
    let isSwing = true;
    for (let offset = 1; offset <= width; offset += 1) {
      if (!comparator(candles[index - offset]) || !comparator(candles[index + offset])) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) points.push({ time: candles[index].time, price: value });
  }
  return points;
}

function rollingStructure(candles) {
  if (candles.length < 12) return 'INSUFFICIENT';
  const recent = candles.slice(-6);
  const previous = candles.slice(-12, -6);
  const recentHigh = Math.max(...recent.map(candle => candle.high));
  const previousHigh = Math.max(...previous.map(candle => candle.high));
  const recentLow = Math.min(...recent.map(candle => candle.low));
  const previousLow = Math.min(...previous.map(candle => candle.low));
  if (recentHigh > previousHigh && recentLow > previousLow) return 'BULLISH';
  if (recentHigh < previousHigh && recentLow < previousLow) return 'BEARISH';
  return 'RANGING';
}

function determineStructure(candles, swingHighs, swingLows) {
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const [previousHigh, lastHigh] = swingHighs.slice(-2);
    const [previousLow, lastLow] = swingLows.slice(-2);
    if (lastHigh.price > previousHigh.price && lastLow.price > previousLow.price) return 'BULLISH';
    if (lastHigh.price < previousHigh.price && lastLow.price < previousLow.price) return 'BEARISH';
  }
  return rollingStructure(candles);
}

function candlePattern(candles) {
  const current = candles.at(-1);
  const previous = candles.at(-2);
  if (!current) return { name: 'INSUFFICIENT', bias: 'NEUTRAL', closed: false };
  const body = Math.abs(current.close - current.open);
  const range = Math.max(current.high - current.low, EPSILON);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const bullish = current.close > current.open;
  const bearish = current.close < current.open;

  if (body / range <= 0.1) return { name: 'DOJI', bias: 'NEUTRAL', closed: true };
  if (bullish && lowerWick >= body * 2 && upperWick <= body * 1.2) {
    return { name: 'HAMMER', bias: 'BULLISH', closed: true };
  }
  if (bearish && upperWick >= body * 2 && lowerWick <= body * 1.2) {
    return { name: 'SHOOTING_STAR', bias: 'BEARISH', closed: true };
  }
  if (previous) {
    const previousBodyLow = Math.min(previous.open, previous.close);
    const previousBodyHigh = Math.max(previous.open, previous.close);
    const currentBodyLow = Math.min(current.open, current.close);
    const currentBodyHigh = Math.max(current.open, current.close);
    if (bullish && previous.close < previous.open
      && currentBodyLow <= previousBodyLow && currentBodyHigh >= previousBodyHigh) {
      return { name: 'BULLISH_ENGULFING', bias: 'BULLISH', closed: true };
    }
    if (bearish && previous.close > previous.open
      && currentBodyLow <= previousBodyLow && currentBodyHigh >= previousBodyHigh) {
      return { name: 'BEARISH_ENGULFING', bias: 'BEARISH', closed: true };
    }
  }
  return { name: bullish ? 'BULLISH_CANDLE' : bearish ? 'BEARISH_CANDLE' : 'DOJI', bias: bullish ? 'BULLISH' : bearish ? 'BEARISH' : 'NEUTRAL', closed: true };
}

function localTimePart(now, timeZone) {
  const pieces = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  return Number(pieces.find(piece => piece.type === 'hour')?.value);
}

export function getTradingSession(now = new Date()) {
  const londonHour = localTimePart(now, 'Europe/London');
  const newYorkHour = localTimePart(now, 'America/New_York');
  const londonOpen = londonHour >= 7 && londonHour < 16;
  const newYorkOpen = newYorkHour >= 8 && newYorkHour < 17;
  let name = 'OFF_SESSION';
  if (londonOpen && newYorkOpen) name = 'LONDON_NEW_YORK_OVERLAP';
  else if (londonOpen) name = 'LONDON';
  else if (newYorkOpen) name = 'NEW_YORK';
  return {
    name,
    londonOpen,
    newYorkOpen,
    isLiquid: londonOpen || newYorkOpen,
    isOverlap: londonOpen && newYorkOpen
  };
}

function resolveTimeframeCandles(candlesByTimeframe, timeframe) {
  const value = candlesByTimeframe?.[timeframe] ?? candlesByTimeframe?.[timeframe.toLowerCase()];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.candles)) return value.candles;
  return [];
}

function calculateTimeframe(timeframe, rawCandles, symbol) {
  const candles = onlyClosedCandles(rawCandles);
  const closes = candles.map(candle => candle.close);
  const ema20 = calculateEma(closes, 20);
  const ema50 = calculateEma(closes, 50);
  const ema200 = calculateEma(closes, 200);
  const rsi14 = calculateRsi(closes, 14);
  const atr14 = calculateAtr(candles, 14);
  const bollinger = calculateBollinger(closes, 20);
  const swingHighs = findSwingPoints(candles, 'high');
  const swingLows = findSwingPoints(candles, 'low');
  const structure = determineStructure(candles, swingHighs, swingLows);
  const last = candles.at(-1) ?? null;
  const previous = candles.at(-2) ?? null;

  const supportCandidates = swingLows.slice(-4).map(point => point.price);
  const resistanceCandidates = swingHighs.slice(-4).map(point => point.price);
  if (candles.length >= 20) {
    supportCandidates.push(Math.min(...candles.slice(-20).map(candle => candle.low)));
    resistanceCandidates.push(Math.max(...candles.slice(-20).map(candle => candle.high)));
  }
  const support = last
    ? supportCandidates.filter(value => value <= last.close).sort((a, b) => b - a)[0] ?? null
    : null;
  const resistance = last
    ? resistanceCandidates.filter(value => value >= last.close).sort((a, b) => a - b)[0] ?? null
    : null;

  const hasCoreTrendData = [ema50, ema200, last?.close].every(Number.isFinite);
  let trend = 'NEUTRAL';
  if (hasCoreTrendData && last.close > ema200 && ema50 > ema200 && structure === 'BULLISH') trend = 'BULLISH';
  if (hasCoreTrendData && last.close < ema200 && ema50 < ema200 && structure === 'BEARISH') trend = 'BEARISH';

  const pattern = candlePattern(candles);
  const tolerance = Math.max((atr14 ?? 0) * 0.75, Math.abs(last?.close ?? 0) * 0.00025);
  const near = level => Number.isFinite(level) && last && Math.abs(last.close - level) <= tolerance;
  const demand = support === null || atr14 === null ? null : {
    minimum: support - (atr14 * 0.35),
    maximum: support + (atr14 * 0.35)
  };
  const supply = resistance === null || atr14 === null ? null : {
    minimum: resistance - (atr14 * 0.35),
    maximum: resistance + (atr14 * 0.35)
  };
  const inDemand = demand && last ? last.close >= demand.minimum && last.close <= demand.maximum : false;
  const inSupply = supply && last ? last.close >= supply.minimum && last.close <= supply.maximum : false;
  const nearMovingAverage = near(ema20) || near(ema50);
  const supportRejection = Boolean(last && previous && last.close > last.open
    && (Math.min(last.open, last.close) - last.low) > Math.abs(last.close - last.open)
    && last.low <= previous.low);
  const resistanceRejection = Boolean(last && previous && last.close < last.open
    && (last.high - Math.max(last.open, last.close)) > Math.abs(last.close - last.open)
    && last.high >= previous.high);
  const microBreakBullish = Boolean(last && previous && last.close > previous.high);
  const microBreakBearish = Boolean(last && previous && last.close < previous.low);
  const bullishConfirmation = Boolean(last && previous && last.close > last.open
    && (pattern.bias === 'BULLISH' || supportRejection || microBreakBullish || last.close > previous.close));
  const bearishConfirmation = Boolean(last && previous && last.close < last.open
    && (pattern.bias === 'BEARISH' || resistanceRejection || microBreakBearish || last.close < previous.close));

  const atrPercent = atr14 && last?.close ? (atr14 / Math.abs(last.close)) * 100 : null;
  // Metals routinely have a larger ATR than major FX pairs.  This is only an
  // abnormal-volatility guard, not a price prediction.
  const abnormalThreshold = symbol === 'XAU/USD' ? 2.5 : 0.9;
  const volatility = atrPercent === null ? 'UNKNOWN'
    : atrPercent > abnormalThreshold ? 'ABNORMAL'
      : atrPercent > abnormalThreshold * 0.65 ? 'ELEVATED' : 'NORMAL';

  return {
    timeframe,
    candleCount: candles.length,
    // EMA 200 is part of every multi-timeframe decision; a shorter series
    // would silently make an H4/M15/M5 trend unverifiable.
    requiredCandles: 200,
    hasRequiredHistory: candles.length >= 200,
    lastCandle: last,
    indicators: {
      ema20: round(ema20),
      ema50: round(ema50),
      ema200: round(ema200),
      rsi14: round(rsi14, 2),
      atr14: round(atr14),
      bollinger: bollinger && {
        lower: round(bollinger.lower),
        middle: round(bollinger.middle),
        upper: round(bollinger.upper),
        standardDeviation: round(bollinger.standardDeviation)
      }
    },
    structure,
    trend,
    pattern,
    supportResistance: {
      support: round(support),
      resistance: round(resistance),
      supports: [...new Set(supportCandidates)].sort((a, b) => b - a).slice(0, 4).map(value => round(value)),
      resistances: [...new Set(resistanceCandidates)].sort((a, b) => a - b).slice(0, 4).map(value => round(value))
    },
    zones: {
      demand: demand && { minimum: round(demand.minimum), maximum: round(demand.maximum) },
      supply: supply && { minimum: round(supply.minimum), maximum: round(supply.maximum) }
    },
    setup: {
      pullback: {
        bullish: Boolean(last && (inDemand || (nearMovingAverage && trend !== 'BEARISH') || near(support))),
        bearish: Boolean(last && (inSupply || (nearMovingAverage && trend !== 'BULLISH') || near(resistance))),
        nearMovingAverage,
        inDemand,
        inSupply
      },
      confirmation: {
        bullish: bullishConfirmation,
        bearish: bearishConfirmation,
        supportRejection,
        resistanceRejection,
        microBreakBullish,
        microBreakBearish,
        basedOnClosedCandle: Boolean(last)
      }
    },
    volatility: {
      atr: round(atr14),
      percent: round(atrPercent, 4),
      classification: volatility
    },
    swingHighs: swingHighs.slice(-5),
    swingLows: swingLows.slice(-5)
  };
}

function normaliseQuote(quote = {}) {
  const bid = toNumber(quote.bid);
  const ask = toNumber(quote.ask);
  const mid = toNumber(quote.mid) ?? (bid !== null && ask !== null ? (bid + ask) / 2 : null);
  const spread = bid !== null && ask !== null ? ask - bid : null;
  const timestamp = quote.timestamp ? new Date(quote.timestamp).toISOString() : null;
  return { ...quote, bid, ask, mid, spread, timestamp };
}

/**
 * Deterministic technical-analysis engine.  It deliberately makes no API
 * calls and never reads a TradingView widget; its only price input is OHLC.
 */
export class TechnicalAnalysisEngine {
  analyze({ symbol, quote = {}, candlesByTimeframe = {}, now = new Date() } = {}) {
    const timeframes = Object.fromEntries(TIMEFRAMES.map(timeframe => [
      timeframe,
      calculateTimeframe(timeframe, resolveTimeframeCandles(candlesByTimeframe, timeframe), symbol)
    ]));
    const normalisedQuote = normaliseQuote(quote);
    const h4 = timeframes.H4;
    const h1 = timeframes.H1;
    const m15 = timeframes.M15;
    const m5 = timeframes.M5;
    const trends = Object.fromEntries(TIMEFRAMES.map(timeframe => [timeframe, timeframes[timeframe].trend]));
    const alignment = h4.trend === h1.trend && ['BULLISH', 'BEARISH'].includes(h4.trend)
      ? h4.trend : 'NEUTRAL';
    const reasons = [];
    if (!h4.hasRequiredHistory || !h1.hasRequiredHistory || !m15.hasRequiredHistory || !m5.hasRequiredHistory) {
      reasons.push('No hay suficientes velas cerradas para calcular todos los indicadores requeridos.');
    }
    if (alignment === 'NEUTRAL') reasons.push('H4 y H1 no muestran una estructura direccional alineada.');
    if (m5.lastCandle === null) reasons.push('No existe una vela M5 cerrada para confirmar la entrada.');

    return {
      symbol,
      timestamp: new Date(now).toISOString(),
      quote: normalisedQuote,
      timeframes,
      trends,
      technicalBias: alignment,
      marketStructure: `H4 ${h4.structure}; H1 ${h1.structure}; M15 ${m15.structure}; M5 ${m5.structure}`,
      supportResistance: m15.supportResistance,
      zones: m15.zones,
      volatility: h1.volatility,
      session: getTradingSession(new Date(now)),
      dataQuality: {
        usesClosedCandlesOnly: true,
        readyForSignal: h4.hasRequiredHistory && h1.hasRequiredHistory && m15.hasRequiredHistory && m5.hasRequiredHistory,
        closedCandleCounts: Object.fromEntries(TIMEFRAMES.map(timeframe => [timeframe, timeframes[timeframe].candleCount])),
        reasons
      }
    };
  }
}

export const TECHNICAL_TIMEFRAMES = TIMEFRAMES;
