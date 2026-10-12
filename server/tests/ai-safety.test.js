import test from 'node:test';
import assert from 'node:assert/strict';
import { onlyClosedCandles } from '../services/technical-analysis-engine.js';
import { RiskManagementEngine } from '../services/risk-management-engine.js';
import { isWithinHighImpactWindow } from '../services/economic-calendar-service.js';
import { ForexProfessionalAI } from '../services/forex-professional-ai.js';
import { AnalysisCoordinator } from '../services/analysis-coordinator.js';
import { SignalEngine } from '../services/signal-engine.js';
import { FinancialNewsService } from '../services/financial-news-service.js';
import { attachWebSocketServer } from '../websocket-server.js';
import { DerivPublicMarketDataProvider } from '../services/deriv-public-market-data-provider.js';
import { createServer } from 'node:http';
import WebSocket from 'ws';

function validTechnical() {
  return {
    dataQuality: { readyForSignal: true },
    timeframes: {
      H4: { trend: 'BULLISH' },
      H1: { trend: 'BULLISH', indicators: { atr14: 0.0005 } },
      M15: {
        supportResistance: { support: 1.099 },
        indicators: { atr14: 0.0005 },
        lastCandle: { low: 1.099, close: 1.1 }
      },
      M5: { lastCandle: { closed: true }, pattern: { name: 'Prueba' } }
    },
    volatility: { classification: 'NORMAL' }
  };
}

function liveQuote() {
  return {
    symbol: 'EUR/USD', status: 'live', timestamp: new Date().toISOString(),
    bid: 1.1, ask: 1.1001, mid: 1.10005, spreadVerified: true
  };
}

test('technical input excludes unfinished candles', () => {
  const candles = onlyClosedCandles([
    { time: 1_700_000_000, open: 1, high: 1.2, low: 0.9, close: 1.1, closed: true },
    { time: 1_700_000_300, open: 1.1, high: 1.3, low: 1, close: 1.2, closed: false }
  ]);
  assert.equal(candles.length, 1);
  assert.equal(candles[0].closed, true);
});

test('Deriv v3 tick preserves verified bid and ask for the market buffer', () => {
  const provider = new DerivPublicMarketDataProvider({ appId: 'test-app' });
  let tick;
  provider.onTick(value => { tick = value; });
  provider.handleMessage(Buffer.from(JSON.stringify({
    msg_type: 'tick',
    tick: { symbol: 'frxEURUSD', bid: 1.08499, ask: 1.08501, quote: 1.085, epoch: 1_700_000_000, pip_size: 5 }
  })));
  assert.equal(tick.spreadVerified, true);
  assert.equal(tick.bid, 1.08499);
  assert.equal(tick.ask, 1.08501);
  assert.equal(tick.priceType, 'deriv_bid_ask_tick');
});

test('Deriv quote-only tick remains explicitly non-executable', () => {
  const provider = new DerivPublicMarketDataProvider({ appId: 'test-app' });
  let tick;
  provider.onTick(value => { tick = value; });
  provider.handleMessage(Buffer.from(JSON.stringify({
    msg_type: 'tick', tick: { symbol: 'frxEURUSD', quote: 1.085, epoch: 1_700_000_000 }
  })));
  assert.equal(tick.spreadVerified, false);
  assert.equal(tick.priceType, 'deriv_quote_only_tick');
});

test('risk engine blocks an old quote', () => {
  const result = new RiskManagementEngine().evaluate({
    symbol: 'EUR/USD',
    quote: { status: 'live', timestamp: new Date(Date.now() - 5_001).toISOString(), bid: 1.1, ask: 1.1001, mid: 1.10005 },
    signal: { decision: 'BUY', entryPrice: 1.10005, stopLoss: 1.099, takeProfit1: 1.1022 },
    technical: { dataQuality: { readyForSignal: true }, timeframes: { H4: { trend: 'BULLISH' }, H1: { trend: 'BULLISH' }, M15: { supportResistance: { support: 1.099 }, indicators: { atr14: 0.0005 } } } },
    calendar: { status: 'available' }
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blocks.some(block => block.code === 'DELAYED_DATA'));
});

test('high impact event blocks its configured time window', () => {
  const now = new Date('2026-10-11T12:00:00.000Z');
  const state = isWithinHighImpactWindow([{
    title: 'Policy decision', source: 'verified-calendar', url: 'https://example.test/event',
    timestamp: '2026-10-11T12:20:00.000Z', currencies: ['USD'], impact: 'high'
  }], { now, currencies: ['USD'], beforeMinutes: 30, afterMinutes: 30 });
  assert.equal(state.blocked, true);
});

test('signal engine never creates BUY or SELL during a high-impact window', () => {
  const signal = new SignalEngine().generate({
    symbol: 'EUR/USD', quote: liveQuote(), technical: validTechnical(),
    fundamental: { status: 'available', bias: 'BULLISH' },
    calendar: { status: 'available', highImpactWindow: { blocked: true, event: { title: 'CPI' } } }
  });
  assert.equal(signal.decision, 'NO_TRADE');
  assert.match(signal.risks[0], /evento econ/i);
});

test('risk engine blocks a candidate whose risk/reward is below 1:2', () => {
  const result = new RiskManagementEngine().evaluate({
    symbol: 'EUR/USD', quote: liveQuote(), technical: validTechnical(),
    signal: { decision: 'BUY', entryPrice: 1.1, stopLoss: 1.099, takeProfit1: 1.1005 },
    calendar: { status: 'available' }
  });
  assert.equal(result.allowed, false);
  assert.ok(result.blocks.some(block => block.code === 'RISK_REWARD_TOO_LOW'));
});

test('unconfigured news source returns no invented articles', async () => {
  const response = await new FinancialNewsService({ apiUrl: '', apiKey: '' }).getLatest({ currencies: ['USD'] });
  assert.equal(response.status, 'unavailable');
  assert.deepEqual(response.news, []);
});

test('AI does not query fundamentals or issue a trade without live data', async () => {
  let fundamentalCalls = 0;
  const ai = new ForexProfessionalAI({
    marketDataService: { getState: () => ({ quotes: {} }), getCandles: () => [] },
    fundamentalAnalysisService: { analyze: async () => { fundamentalCalls += 1; return {}; } }
  });
  const analysis = await ai.analyze({ symbol: 'EUR/USD' });
  assert.equal(fundamentalCalls, 0);
  assert.equal(analysis.decision, 'NO_TRADE');
  assert.equal(analysis.dataStatus, 'unavailable');
});

test('a risk block has final authority over a generated BUY candidate', async () => {
  const quote = liveQuote();
  const ai = new ForexProfessionalAI({
    marketDataService: { getState: () => ({ quotes: { 'EUR/USD': quote } }), getCandles: () => [] },
    technicalAnalysisEngine: { analyze: () => validTechnical() },
    signalEngine: {
      generate: () => ({
        decision: 'BUY', confidence: 95, entryZone: {}, entryPrice: 1.1,
        stopLoss: 1.099, takeProfit1: 1.102, takeProfit2: 1.103,
        riskReward: 2, technicalReasons: [], risks: [], invalidation: [],
        requiredConfirmation: [], score: { total: 95, points: {}, checks: {} }
      })
    },
    riskManagementEngine: {
      evaluate: () => ({ status: 'BLOCKED', allowed: false, blocks: [{ code: 'TEST_BLOCK', message: 'Bloqueo de prueba.' }] })
    },
    fundamentalAnalysisService: {
      analyze: async () => ({
        status: 'available', bias: 'BULLISH', reasons: [], risks: [], verifiedNews: [], events: [],
        highImpactWindow: { blocked: false }, dataAvailability: { calendar: 'available', news: 'available' }
      })
    }
  });
  const analysis = await ai.analyze({ symbol: 'EUR/USD' });
  assert.equal(analysis.decision, 'NO_TRADE');
  assert.equal(analysis.riskBlocked, true);
});

test('coordinator runs only after a final M5 candle', async () => {
  let listener;
  let calls = 0;
  const quote = { symbol: 'EUR/USD', status: 'live', timestamp: new Date().toISOString(), bid: 1.1, ask: 1.1001, mid: 1.10005 };
  const market = {
    subscribe(callback) { listener = callback; return () => { listener = null; }; },
    getState() { return { quotes: { 'EUR/USD': quote } }; }
  };
  const coordinator = new AnalysisCoordinator({
    market,
    symbols: ['EUR/USD'],
    analysisEngine: { analyze: async () => { calls += 1; return { symbol: 'EUR/USD', decision: 'NO_TRADE' }; } }
  });
  coordinator.start();
  listener({ type: 'tick', quote, closedCandles: [{ interval: 'M1', candle: { closed: true } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
  listener({ type: 'tick', quote, closedCandles: [{ interval: 'M5', candle: { closed: true } }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('market websocket pushes analysis updates without an HTTP page reload', async () => {
  let subscriber;
  const market = {
    subscribe(callback) { subscriber = callback; return () => { subscriber = null; }; },
    getState() { return { status: 'live', quotes: {}, symbols: ['EUR/USD'] }; }
  };
  const httpServer = createServer();
  const wss = attachWebSocketServer(httpServer, market, { getAnalyses: () => ({}) });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws/market`);
  const received = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No llegó el snapshot WebSocket.')), 1_000);
    client.on('message', payload => {
      received.push(JSON.parse(payload));
      if (received[0]?.type === 'snapshot') {
        subscriber({ type: 'analysis', analysis: { symbol: 'EUR/USD', decision: 'NO_TRADE' } });
      }
      if (received.some(message => message.type === 'analysis')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    client.on('error', reject);
  });
  assert.equal(received[0].type, 'snapshot');
  assert.equal(received[1].type, 'analysis');
  client.close();
  await new Promise(resolve => wss.close(resolve));
  await new Promise(resolve => httpServer.close(resolve));
});
