const MINUTES = { M1: 1, M2: 2, M3: 3, M5: 5, M10: 10, M15: 15, M30: 30, M45: 45, H1: 60, H2: 120, H3: 180, H4: 240, H6: 360, H8: 480, H12: 720, D1: 1440, W1: 10080, MO1: 43200 };
export const TIMEFRAMES = Object.keys(MINUTES);
export function intervalMs(timeframe) { return MINUTES[timeframe] * 60_000; }

/** Solo muta la vela abierta; las cerradas se congelan. */
export class CandleAggregator {
  constructor(limit = 350) { this.limit = limit; this.series = new Map(); }
  update(symbol, tick) {
    const result = [];
    TIMEFRAMES.forEach(tf => {
      const key = `${symbol}:${tf}`, step = intervalMs(tf), openTime = Math.floor(new Date(tick.timestamp).getTime() / step) * step;
      const list = this.series.get(key) || [];
      let candle = list.at(-1), closed = false;
      if (!candle || candle.time !== openTime) {
        closed = Boolean(candle);
        candle = { time: openTime, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: 0 };
        list.push(candle); if (list.length > this.limit) list.shift(); this.series.set(key, list);
      } else { candle.high = Math.max(candle.high, tick.price); candle.low = Math.min(candle.low, tick.price); candle.close = tick.price; }
      candle.volume += Number(tick.volume || 0);
      result.push({ timeframe: tf, candle, closed, candles: list });
    });
    return result;
  }
  /** Historial sintético solamente para que el modo demo sea utilizable desde el inicio. */
  seedDemo(symbol, tick) {
    if (this.series.has(`${symbol}:H1`)) return;
    TIMEFRAMES.forEach(tf => {
      const step = intervalMs(tf), current = Math.floor(new Date(tick.timestamp).getTime() / step) * step, list = [];
      let value = tick.price * (1 - (symbol === 'XAU/USD' ? .018 : .006));
      for (let index = 230; index >= 0; index--) {
        const open = value, move = (Math.sin(index * 1.71) + Math.cos(index * .37)) * (symbol === 'XAU/USD' ? .42 : symbol === 'USD/JPY' ? .011 : .00009) + (tick.price - value) / 900;
        value += move; list.push({ time: current - index * step, open, high: Math.max(open, value) + Math.abs(move) * .35, low: Math.min(open, value) - Math.abs(move) * .35, close: value, volume: 0 });
      }
      list[list.length - 1] = { ...list.at(-1), close: tick.price, high: Math.max(list.at(-1).high, tick.price), low: Math.min(list.at(-1).low, tick.price) };
      this.series.set(`${symbol}:${tf}`, list);
    });
  }
  get(symbol, timeframe) { return this.series.get(`${symbol}:${timeframe}`) || []; }
}
