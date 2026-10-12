import { CandleAggregator } from './candle-aggregator.js';

/** Único orquestador de mercado: un stream, listeners y respaldo HTTP. */
export class MarketDataService {
  constructor({ provider, symbols, fallbackInterval = 5_000 }) {
    this.provider = provider; this.symbols = symbols; this.fallbackInterval = fallbackInterval;
    this.aggregator = new CandleAggregator(); this.listeners = new Set(); this.quotes = new Map();
    this.status = { state: 'disconnected', detail: 'Sin conexión', lastTickAt: null, fallback: false };
    this.reconnectAttempt = 0; this.reconnectTimer = null; this.fallbackTimer = null; this.healthTimer = null; this.running = false; this.connecting = false;
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(type, payload = {}) { this.listeners.forEach(listener => listener({ type, ...payload })); }
  async start() { this.running = true; this.healthTimer = setInterval(() => this.checkFreshness(), 1_000); await this.open(); }
  stop() { this.running = false; clearTimeout(this.reconnectTimer); clearInterval(this.fallbackTimer); clearInterval(this.healthTimer); this.provider.disconnect(); }
  checkFreshness() {
    if (!this.status.lastTickAt || this.status.state !== 'live') return;
    if (Date.now() - new Date(this.status.lastTickAt).getTime() > 10_000) { this.status = { ...this.status, state: 'delayed', detail: 'Datos retrasados' }; this.emit('status', { status: this.status }); }
  }
  async open() {
    if (!this.running || this.connecting) return;
    this.connecting = true;
    try { await this.provider.connect(this.symbols, tick => this.onTick(tick), status => this.onProviderStatus(status)); }
    catch (error) { this.onProviderStatus({ state: 'disconnected', detail: error.message }); }
    finally { this.connecting = false; }
  }
  onProviderStatus(next) {
    this.status = { ...this.status, ...next };
    if (next.state === 'live') { this.reconnectAttempt = 0; this.stopFallback(); }
    if (next.state === 'disconnected' && this.running) { this.beginFallback(); this.scheduleReconnect(); }
    this.emit('status', { status: this.status });
  }
  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const wait = Math.min(1_000 * (2 ** this.reconnectAttempt++), 30_000);
    this.status = { ...this.status, state: 'reconnecting', detail: `Reconectando en ${wait / 1000}s` }; this.emit('status', { status: this.status });
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.open(); }, wait);
  }
  beginFallback() {
    if (this.fallbackTimer) return;
    this.status = { ...this.status, fallback: true, detail: 'Modo de respaldo: datos no streaming' }; this.emit('status', { status: this.status });
    const poll = async () => { try { (await this.provider.fetchQuotes(this.symbols)).forEach(tick => this.onTick({ ...tick, fallback: true })); } catch { /* el siguiente ciclo reintenta */ } };
    poll(); this.fallbackTimer = setInterval(poll, this.fallbackInterval);
  }
  stopFallback() { if (this.fallbackTimer) clearInterval(this.fallbackTimer); this.fallbackTimer = null; this.status.fallback = false; }
  onTick(tick) {
    if (!this.symbols.includes(tick.symbol)) return;
    if (tick.demo) this.aggregator.seedDemo(tick.symbol, tick);
    if (this.status.state === 'delayed') { this.status = { ...this.status, state: 'live', detail: 'En vivo' }; this.emit('status', { status: this.status }); }
    const previous = this.quotes.get(tick.symbol);
    const change = previous?.open ? ((tick.price - previous.open) / previous.open) * 100 : 0;
    const quote = { ...previous, ...tick, open: previous?.open ?? tick.price, change, lastTickAt: tick.timestamp };
    this.quotes.set(tick.symbol, quote); this.status.lastTickAt = tick.timestamp;
    const updates = this.aggregator.update(tick.symbol, tick);
    this.emit('tick', { tick, quote, candles: updates });
    updates.filter(update => update.closed).forEach(update => this.emit('candleClosed', { symbol: tick.symbol, ...update }));
  }
  getQuote(symbol) { return this.quotes.get(symbol); }
  getCandles(symbol, timeframe) { return this.aggregator.get(symbol, timeframe); }
}
