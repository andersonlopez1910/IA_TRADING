import { MarketDataProvider } from './market-data-provider.js';

const seeds = {
  'EUR/USD': { price: 1.08642, spread: 0.00008, drift: 0.000008 },
  'GBP/USD': { price: 1.27480, spread: 0.00011, drift: -0.000004 },
  'USD/JPY': { price: 156.384, spread: 0.012, drift: 0.002 },
  'XAU/USD': { price: 2358.62, spread: 0.24, drift: 0.018 }
};

/** Stream determinista para desarrollo; cada tick lleva demo:true. */
export class DemoMarketDataProvider extends MarketDataProvider {
  constructor() { super(); this.timer = null; this.data = structuredClone(seeds); }
  async connect(symbols, onTick, onStatus) {
    this.disconnect(); onStatus({ state: 'live', detail: 'Modo demo · streaming simulado' });
    this.timer = setInterval(() => symbols.forEach((symbol, index) => {
      const item = this.data[symbol];
      const scale = symbol === 'XAU/USD' ? 0.19 : symbol === 'USD/JPY' ? 0.009 : 0.000055;
      const cycle = Math.sin(Date.now() / 6_000 + index) * scale;
      const noise = (Math.random() - .5) * scale;
      item.price = +(item.price + item.drift + cycle + noise).toFixed(symbol === 'USD/JPY' ? 3 : symbol === 'XAU/USD' ? 2 : 5);
      onTick({ symbol, price: item.price, bid: item.price - item.spread / 2, ask: item.price + item.spread / 2, spread: item.spread, timestamp: new Date().toISOString(), demo: true });
    }), 1_000);
  }
  disconnect() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async fetchQuotes(symbols) { return symbols.map(symbol => ({ symbol, price: this.data[symbol].price, spread: this.data[symbol].spread, timestamp: new Date().toISOString(), demo: true })); }
}
