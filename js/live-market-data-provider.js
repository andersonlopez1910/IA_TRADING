import { MarketDataProvider } from './market-data-provider.js';

/** Adaptador para un WebSocket propio del backend: no incluye API keys. */
export class LiveMarketDataProvider extends MarketDataProvider {
  constructor({ wsUrl = '/api/forex-stream', quoteUrl = '/api/market.php' } = {}) {
    super();
    // WebSocket exige una URL ws:// o wss://; se deriva del origen local cuando procede.
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.wsUrl = wsUrl.startsWith('ws') ? wsUrl : `${protocol}//${window.location.host}${wsUrl}`;
    this.quoteUrl = quoteUrl; this.socket = null;
  }
  async connect(symbols, onTick, onStatus) {
    this.disconnect(); onStatus({ state: 'reconnecting', detail: 'Conectando al proveedor autorizado…' });
    this.socket = new WebSocket(this.wsUrl);
    this.socket.onopen = () => { this.socket.send(JSON.stringify({ type: 'subscribe', symbols })); onStatus({ state: 'live', detail: 'En vivo · WebSocket autorizado' }); };
    this.socket.onmessage = event => { try { const tick = JSON.parse(event.data); if (tick.type === 'tick' && tick.symbol && Number.isFinite(+tick.price)) onTick({ ...tick, price: +tick.price, timestamp: tick.timestamp || new Date().toISOString(), demo: false }); } catch { /* paquete inválido: se ignora */ } };
    this.socket.onerror = () => onStatus({ state: 'disconnected', detail: 'WebSocket no disponible' });
    this.socket.onclose = () => onStatus({ state: 'disconnected', detail: 'WebSocket cerrado' });
  }
  disconnect() { if (this.socket) { this.socket.close(); this.socket = null; } }
  async fetchQuotes(symbols) {
    const response = await fetch(`${this.quoteUrl}?mode=quotes&symbols=${encodeURIComponent(symbols.join(','))}`, { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'Respaldo HTTP no disponible');
    return Object.entries(payload.quotes).map(([symbol, quote]) => ({ symbol, price: +quote.price, spread: quote.spread ?? null, timestamp: quote.updatedAt || new Date().toISOString(), demo: false }));
  }
}
