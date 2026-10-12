/**
 * Fuente pública y de solo lectura para índices sintéticos de Deriv.
 * No usa sesiones, tokens, compras, órdenes ni datos de cuenta.
 */
const WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const SYMBOLS = ['BOOM1000', 'CRASH1000'];

function normaliseCandle(candle) {
  return { open: +candle.open, high: +candle.high, low: +candle.low, close: +candle.close, epoch: +(candle.epoch || candle.open_time || Date.now() / 1000) };
}

export class SyntheticStream {
  constructor(onChange, onStatus) { this.onChange = onChange; this.onStatus = onStatus; this.data = Object.fromEntries(SYMBOLS.map(symbol => [symbol, { candles: [], price: null, epoch: null }])); this.socket = null; this.retry = null; }
  connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.onStatus('Conectando a datos públicos de Deriv…');
    this.socket = new WebSocket(WS_URL);
    this.socket.onopen = () => {
      this.onStatus('En vivo · datos públicos de Deriv');
      SYMBOLS.forEach((symbol, index) => {
        this.socket.send(JSON.stringify({ ticks_history: symbol, end: 'latest', count: 120, style: 'candles', granularity: 60, req_id: index + 1 }));
        this.socket.send(JSON.stringify({ ticks: symbol, subscribe: 1, req_id: index + 11 }));
      });
    };
    this.socket.onmessage = event => this.handleMessage(JSON.parse(event.data));
    this.socket.onerror = () => this.onStatus('No se pudo conectar a Deriv; mostrando último dato disponible.');
    this.socket.onclose = () => { this.onStatus('Conexión cerrada; reintentando…'); clearTimeout(this.retry); this.retry = setTimeout(() => this.connect(), 5000); };
  }
  handleMessage(message) {
    if (message.error) { this.onStatus(`Deriv: ${message.error.message || 'respuesta no disponible'}`); return; }
    const historicalSymbol = message.echo_req?.ticks_history;
    if (historicalSymbol && message.candles) {
      this.data[historicalSymbol].candles = message.candles.map(normaliseCandle);
      const last = this.data[historicalSymbol].candles.at(-1);
      if (last) { this.data[historicalSymbol].price = last.close; this.data[historicalSymbol].epoch = last.epoch; }
      this.onChange(this.data);
    }
    if (message.tick?.symbol && this.data[message.tick.symbol]) {
      const item = this.data[message.tick.symbol], price = +message.tick.quote, epoch = +message.tick.epoch;
      item.price = price; item.epoch = epoch;
      const latest = item.candles.at(-1);
      if (latest) { latest.close = price; latest.high = Math.max(latest.high, price); latest.low = Math.min(latest.low, price); }
      this.onChange(this.data);
    }
  }
  disconnect() { clearTimeout(this.retry); this.socket?.close(); this.socket = null; }
}
