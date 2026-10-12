/** Indicadores puros; las series deben ir de más antigua a más reciente. */
export function ema(values, period) {
  if (!values.length) return [];
  const multiplier = 2 / (period + 1);
  return values.reduce((result, value, index) => {
    result.push(index === 0 ? value : value * multiplier + result[index - 1] * (1 - multiplier));
    return result;
  }, []);
}

export function rsi(closes, period = 14) {
  if (closes.length <= period) return 50;
  const changes = closes.slice(1).map((value, i) => value - closes[i]);
  let gain = changes.slice(0, period).reduce((sum, n) => sum + Math.max(n, 0), 0) / period;
  let loss = changes.slice(0, period).reduce((sum, n) => sum + Math.max(-n, 0), 0) / period;
  for (const change of changes.slice(period)) { gain = (gain * (period - 1) + Math.max(change, 0)) / period; loss = (loss * (period - 1) + Math.max(-change, 0)) / period; }
  return +(100 - 100 / (1 + gain / (loss || 0.000001))).toFixed(1);
}

export function atr(candles, period = 14) {
  if (candles.length < 2) return 0;
  const ranges = candles.slice(1).map((c, i) => Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close)));
  return ranges.slice(-period).reduce((sum, n) => sum + n, 0) / Math.min(period, ranges.length);
}

export function marketStructure(candles) {
  const recent = candles.slice(-12);
  const highs = recent.map(c => c.high), lows = recent.map(c => c.low);
  const ascending = highs.slice(-4).every((v, i, a) => !i || v >= a[i - 1]) && lows.slice(-4).every((v, i, a) => !i || v >= a[i - 1]);
  const descending = highs.slice(-4).every((v, i, a) => !i || v <= a[i - 1]) && lows.slice(-4).every((v, i, a) => !i || v <= a[i - 1]);
  return ascending ? 'bullish' : descending ? 'bearish' : 'neutral';
}

export function supportResistance(candles) {
  const window = candles.slice(-24);
  return { support: Math.min(...window.map(c => c.low)), resistance: Math.max(...window.map(c => c.high)) };
}

export function riskReward(entry, stop, target) { return Math.abs(target - entry) / Math.abs(entry - stop); }
