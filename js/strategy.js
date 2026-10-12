import { atr, ema, marketStructure, riskReward, rsi, supportResistance } from './indicators.js';

export function analyze(pair, market, candles) {
  const closes = candles.map(c => c.close), fast = ema(closes, 20).at(-1), mid = ema(closes, 50).at(-1), slow = ema(closes, 200).at(-1);
  const indicatorValues = { rsi: rsi(closes), atr: atr(candles), structure: marketStructure(candles), ...supportResistance(candles), ema20: fast, ema50: mid, ema200: slow };
  const rr = riskReward(market.entry, market.stop, market.target1);
  const checks = [
    ['H4 / H1', `${market.h4} / ${market.h1}`, ['Alcista', 'Bajista'].includes(market.h4) && market.h4 === market.h1, 25],
    ['Zona M15', market.zone ? 'Retroceso en EMA / nivel técnico' : 'Precio extendido', market.zone, 20],
    ['Confirmación M5', market.confirm ? 'Cierre de vela confirmado' : 'Pendiente de cierre y ruptura', market.confirm, 20],
    ['RSI y ATR', `RSI ${market.rsi} · ATR adecuado`, market.rsi > 35 && market.rsi < 68, 10],
    ['Sesión', market.session === 'Londres' ? 'Londres · liquidez favorable' : 'Liquidez reducida', market.session === 'Londres', 10],
    ['Noticias', market.newsSafe ? 'Sin evento de alto impacto cercano' : 'Ventana de seguridad activa', market.newsSafe, 10],
    ['Riesgo / beneficio', `1 : ${rr.toFixed(1)}`, rr >= 2, 5]
  ];
  const confidence = checks.reduce((score, [, , pass, points]) => score + (pass ? points : 0), 0);
  return { pair, ...market, rr, checks, confidence, indicatorValues };
}
