import dns from 'node:dns';
import { isIP } from 'node:net';
import WebSocket from 'ws';
import { MarketDataProvider } from './market-data-provider.js';

// Legacy market-data WebSocket. Unlike the Options public channel, the tick
// payload can contain the bid and ask fields alongside quote.
const DERIV_MARKET_DATA_URL = 'wss://ws.derivws.com/websockets/v3';
const DERIV_CURRENT_PUBLIC_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const GRANULARITIES = Object.freeze({ M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 });
const DEFAULT_SYMBOL_MAP = Object.freeze({ 'EUR/USD': 'frxEURUSD', 'GBP/USD': 'frxGBPUSD', 'USD/JPY': 'frxUSDJPY', 'XAU/USD': 'frxXAUUSD' });

function asEpochIso(epoch) { const value = Number(epoch); return Number.isFinite(value) ? new Date(value * 1000).toISOString() : new Date().toISOString(); }

function derivWebSocketUrl(websocketUrl, appId) {
  const url = new URL(websocketUrl || DERIV_MARKET_DATA_URL);
  if (appId) url.searchParams.set('app_id', String(appId));
  return url.toString();
}

/** Uses Windows DNS first, then HTTPS DNS only when the local resolver rejects the hostname. */
function resilientLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dns.lookup(hostname, options, (error, address, family) => {
    if (!error && address) { if (options?.all) callback(null, address); else callback(null, address, family); return; }
    void fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, { headers: { accept: 'application/dns-json' } })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`DNS HTTP ${response.status}`)))
      .then(payload => {
        const address = payload.Answer?.find(answer => answer?.type === 1 && isIP(answer.data) === 4)?.data;
        if (!address) throw error || new Error(`No IPv4 record for ${hostname}`);
        if (options?.all) callback(null, [{ address, family: 4 }]); else callback(null, address, 4);
      })
      .catch(dnsError => callback(dnsError));
  });
}

/** Read-only Deriv public market-data adapter: no account, no authorisation and no orders. */
export class DerivPublicMarketDataProvider extends MarketDataProvider {
  constructor({ websocketUrl = DERIV_MARKET_DATA_URL, appId = process.env.DERIV_APP_ID || '', symbolMap = DEFAULT_SYMBOL_MAP, logger = console } = {}) {
    super(); this.appId = String(appId || '').trim(); const legacyId = /^\d+$/.test(this.appId); this.url = legacyId ? derivWebSocketUrl(websocketUrl, this.appId) : DERIV_CURRENT_PUBLIC_URL; this.symbolMap = { ...DEFAULT_SYMBOL_MAP, ...symbolMap }; this.providerName = 'Deriv WebSocket Market Data'; this.logger = logger;
    this.socket = null; this.connected = false; this.subscriptions = new Set(); this.closedSymbols = new Set(); this.pendingHistory = new Map(); this.nextRequestId = 10_000; this.marketRetryTimer = null;
  }

  async connect() {
    if (this.connected) return;
    if (!this.appId) throw new Error('DERIV_APP_ID no está configurado; registra tu App ID de Deriv en .env.');
    await new Promise((resolve, reject) => {
      const socket = this.socket = new WebSocket(this.url, { lookup: resilientLookup });
      const timeout = setTimeout(() => reject(new Error('Deriv connection timed out')), 12_000);
      socket.once('open', () => { clearTimeout(timeout); this.connected = true; this.emit('status', { status: 'live', source: this.providerName }); resolve(); });
      socket.once('error', error => { clearTimeout(timeout); reject(error); });
      socket.on('message', buffer => this.handleMessage(buffer));
      socket.on('close', () => { this.connected = false; this.rejectPendingHistory(new Error('Deriv public connection closed')); this.emit('status', { status: 'disconnected', source: this.providerName }); });
      socket.on('error', error => this.emit('error', error));
    });
  }

  async subscribe(symbols) {
    this.subscriptions = new Set(symbols.filter(symbol => this.symbolMap[symbol]));
    if (!this.connected) await this.connect();
    for (const symbol of this.subscriptions) this.socket.send(JSON.stringify({ ticks: this.symbolMap[symbol], subscribe: 1, req_id: this.nextRequestId++ }));
  }

  async unsubscribe(symbols) { symbols.forEach(symbol => this.subscriptions.delete(symbol)); }

  async disconnect() { clearTimeout(this.marketRetryTimer); this.marketRetryTimer = null; this.rejectPendingHistory(new Error('Deriv provider disconnected')); if (this.socket) this.socket.close(); this.socket = null; this.connected = false; }

  async getMarketStatus() { return this.connected ? (this.closedSymbols.size === this.subscriptions.size && this.subscriptions.size ? 'closed' : 'live') : 'disconnected'; }

  async getHistoricalCandles(symbol, interval, limit = 250) {
    const derivSymbol = this.symbolMap[symbol]; const granularity = GRANULARITIES[interval];
    if (!derivSymbol || !granularity) return [];
    if (!this.connected) await this.connect();
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pendingHistory.delete(requestId); reject(new Error(`Deriv history timeout for ${symbol} ${interval}`)); }, 12_000);
      this.pendingHistory.set(requestId, { resolve, reject, timer });
      const count = Math.max(220, Math.min(500, Number(limit) || 250));
      // Ask for enough calendar time to retain `count` trading candles when
      // Forex has weekend closures. Deriv adjusts backwards from `latest`.
      const start = Math.floor(Date.now() / 1000) - Math.ceil(count * granularity * 1.7);
      this.socket.send(JSON.stringify({
        ticks_history: derivSymbol,
        adjust_start_time: 1,
        count,
        end: 'latest',
        start,
        style: 'candles',
        granularity,
        req_id: requestId
      }));
    });
  }

  handleMessage(buffer) {
    let payload; try { payload = JSON.parse(buffer.toString()); } catch (error) { this.emit('error', new Error(`Invalid Deriv message: ${error.message}`)); return; }
    const requestId = Number(payload.req_id);
    if (payload.error) {
      const pending = this.pendingHistory.get(requestId);
      if (pending) { clearTimeout(pending.timer); this.pendingHistory.delete(requestId); pending.reject(new Error(`Deriv: ${payload.error.message || payload.error.code || 'history error'}`)); return; }
      this.handleMarketError(payload); return;
    }
    if (payload.msg_type === 'candles') {
      const pending = this.pendingHistory.get(requestId); if (!pending) return;
      clearTimeout(pending.timer); this.pendingHistory.delete(requestId);
      pending.resolve(Array.isArray(payload.candles) ? payload.candles.map(candle => ({ time: candle.epoch ?? candle.time, open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume || 0), closed: true })) : []);
      return;
    }
    if (payload.msg_type !== 'tick' || !payload.tick) return;
    const raw = payload.tick; const symbol = Object.entries(this.symbolMap).find(([, derivSymbol]) => derivSymbol === raw.symbol)?.[0]; const quote = Number(raw.quote);
    const bid = Number(raw.bid); const ask = Number(raw.ask); const hasVerifiedSpread = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask > 0 && ask >= bid;
    const mid = Number.isFinite(quote) && quote > 0 ? quote : (hasVerifiedSpread ? (bid + ask) / 2 : NaN);
    if (!symbol || !Number.isFinite(mid) || mid <= 0) return;
    this.closedSymbols.delete(symbol); this.emit('status', { status: 'live', source: this.providerName });
    // Some symbols or sessions can still omit bid/ask. Keep those values
    // visible as quote-only and let the independent risk gate reject spread
    // validation instead of fabricating a tradable spread.
    this.emit('tick', {
      symbol,
      bid: hasVerifiedSpread ? bid : mid,
      ask: hasVerifiedSpread ? ask : mid,
      mid,
      timestamp: asEpochIso(raw.epoch),
      source: this.providerName,
      status: 'live',
      spreadVerified: hasVerifiedSpread,
      priceType: hasVerifiedSpread ? 'deriv_bid_ask_tick' : 'deriv_quote_only_tick',
      pipSize: Number.isFinite(Number(raw.pip_size)) ? Number(raw.pip_size) : null
    });
  }

  handleMarketError(payload) {
    const requested = payload.echo_req?.ticks; const symbol = Object.entries(this.symbolMap).find(([, derivSymbol]) => derivSymbol === requested)?.[0];
    if (/closed/i.test(String(payload.error?.code || payload.error?.message || '')) && symbol) {
      this.closedSymbols.add(symbol); if (this.closedSymbols.size === this.subscriptions.size) this.emit('status', { status: 'closed', source: this.providerName }); this.scheduleClosedMarketRetry(); return;
    }
    this.emit('error', new Error(`Deriv: ${payload.error?.message || payload.error?.code || 'market error'}`));
  }

  scheduleClosedMarketRetry() { if (this.marketRetryTimer || !this.connected) return; this.marketRetryTimer = setTimeout(() => { this.marketRetryTimer = null; void this.subscribe([...this.subscriptions]).catch(error => this.emit('error', error)); }, 60_000); }

  rejectPendingHistory(error) { for (const pending of this.pendingHistory.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pendingHistory.clear(); }
}
