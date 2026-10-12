/**
 * Bridges market events and the analytical engine. Analysis is recalculated
 * only when a final M5 candle is emitted, plus safety-state changes. It never
 * turns a failed provider connection into demo data.
 */
export class AnalysisCoordinator {
  constructor({ market, analysisEngine, symbols = [], accountProvider = () => ({}), activePositionsProvider = () => [], onAnalysis = () => {}, logger = console } = {}) {
    this.market = market;
    this.analysisEngine = analysisEngine;
    this.symbols = [...symbols];
    this.accountProvider = accountProvider;
    this.activePositionsProvider = activePositionsProvider;
    this.onAnalysis = onAnalysis;
    this.logger = logger;
    this.analyses = new Map();
    this.inFlight = new Map();
    this.unsubscribe = null;
  }

  start() {
    if (this.unsubscribe || !this.market?.subscribe) return;
    this.unsubscribe = this.market.subscribe(message => {
      if (message?.type === 'tick' && this.hasClosedM5(message)) void this.evaluate(message.quote.symbol);
      if (message?.type === 'status' && ['delayed', 'disconnected', 'reconnecting'].includes(String(message.status).toLowerCase())) {
        this.symbols.forEach(symbol => void this.evaluate(symbol));
      }
    });
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  hasClosedM5(message) {
    return Array.isArray(message.closedCandles)
      && message.closedCandles.some(item => item?.interval === 'M5' && item?.candle?.closed === true);
  }

  async prime() {
    await Promise.all(this.symbols.map(symbol => this.evaluate(symbol)));
    return this.getAll();
  }

  async evaluate(symbol) {
    if (!this.symbols.includes(symbol) || !this.analysisEngine?.analyze) return null;
    if (this.inFlight.has(symbol)) return this.inFlight.get(symbol);
    const task = (async () => {
      try {
        const state = this.market?.getState?.() || {};
        const analysis = await this.analysisEngine.analyze({
          symbol,
          quote: state.quotes?.[symbol],
          account: this.accountProvider(symbol) || {},
          activePositions: this.activePositionsProvider(symbol) || []
        });
        this.analyses.set(symbol, analysis);
        this.onAnalysis(analysis);
        return analysis;
      } catch (error) {
        this.logger.error?.(`[analysis] ${symbol}: ${error instanceof Error ? error.message : error}`);
        const analysis = this.analysisEngine.unavailable
          ? this.analysisEngine.unavailable({ symbol, reason: 'El motor de analisis no pudo validar los datos.' })
          : { symbol, dataStatus: 'unavailable', decision: 'NO_TRADE', confidence: 0 };
        this.analyses.set(symbol, analysis);
        this.onAnalysis(analysis);
        return analysis;
      } finally {
        this.inFlight.delete(symbol);
      }
    })();
    this.inFlight.set(symbol, task);
    return task;
  }

  get(symbol) {
    return this.analyses.get(symbol) || null;
  }

  getAll() {
    return Object.fromEntries(this.analyses);
  }
}
