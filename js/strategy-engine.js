import { atr, ema, marketStructure, riskReward, rsi, supportResistance } from './indicators.js';

const trend = candles => { if (candles.length < 205) return 'neutral'; const closes = candles.map(c => c.close), p = closes.at(-1), e50 = ema(closes, 50).at(-1), e200 = ema(closes, 200).at(-1), structure = marketStructure(candles); return p > e200 && e50 > e200 && structure === 'bullish' ? 'bullish' : p < e200 && e50 < e200 && structure === 'bearish' ? 'bearish' : 'neutral'; };

/** Evalúa señal solo al cierre M5; los ticks no alteran la decisión. */
export function evaluateMultiTimeframe({ pair, price, h1 = [], h4 = [], m15 = [], m5 = [], sessionLiquid = true, hasHighImpactNews = false }) {
  const h1Trend = trend(h1), h4Trend = trend(h4), closes = m15.map(c => c.close), m5Closes = m5.map(c => c.close);
  if (m15.length < 25 || m5.length < 15) return { pair, h1Trend, h4Trend, state: 'Esperar confirmación', direction: 'wait', confidence: 0, reason: 'Historial insuficiente para una evaluación multitemporal.', validations: [] };
  const side = h1Trend === 'bullish' && h4Trend === 'bullish' ? 'buy' : h1Trend === 'bearish' && h4Trend === 'bearish' ? 'sell' : 'wait';
  const e20 = ema(closes, 20).at(-1), e50 = ema(closes, 50).at(-1), rsiValue = rsi(m5Closes), atrValue = atr(m15), levels = supportResistance(m15);
  const zone = Math.abs(price - e20) <= atrValue * 1.2 || Math.abs(price - e50) <= atrValue * 1.2;
  const confirmation = side === 'buy' ? m5Closes.at(-1) > Math.max(...m5Closes.slice(-6, -1)) : side === 'sell' ? m5Closes.at(-1) < Math.min(...m5Closes.slice(-6, -1)) : false;
  const rsiOk = side === 'buy' ? rsiValue > 45 && rsiValue < 70 : side === 'sell' ? rsiValue < 55 && rsiValue > 30 : false;
  const stop = side === 'buy' ? Math.min(levels.support, price - atrValue * 1.5) : Math.max(levels.resistance, price + atrValue * 1.5);
  const target = side === 'buy' ? price + Math.abs(price - stop) * 2 : price - Math.abs(price - stop) * 2;
  const rr = side === 'wait' ? 0 : riskReward(price, stop, target);
  const checks = [['H4 / H1', h4Trend === h1Trend && h1Trend !== 'neutral', 25], ['Zona M15', zone, 20], ['Cierre y microestructura M5', confirmation, 20], ['RSI y ATR', rsiOk && atrValue > 0, 10], ['Sesión líquida', sessionLiquid, 10], ['Sin noticia de alto impacto', !hasHighImpactNews, 10], ['R:B ≥ 1:2', rr >= 2, 5]];
  const confidence = checks.reduce((sum, [, pass, points]) => sum + (pass ? points : 0), 0);
  const valid = confidence >= 80 && side !== 'wait';
  const state = valid ? side === 'buy' ? 'Compra válida' : 'Venta válida' : confidence >= 60 ? 'Esperar confirmación' : 'No operar';
  return { pair, h1Trend, h4Trend, price, direction: valid ? side : 'wait', state, confidence, entry: price, stop, target1: target, target2: side === 'buy' ? target + Math.abs(price - stop) : target - Math.abs(price - stop), rr, rsi: rsiValue, atr: atrValue, checks, reason: valid ? 'Alineación multitemporal y confirmación de vela M5 cerrada.' : 'Condiciones incompletas; no se emite una señal operable.', validations: checks };
}
