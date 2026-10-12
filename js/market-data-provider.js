/** Contrato común: las credenciales pertenecen al backend, nunca a esta capa. */
export class MarketDataProvider {
  async connect(_symbols, _onTick, _onStatus) { throw new Error('Provider no implementado'); }
  disconnect() {}
  async fetchQuotes(_symbols) { return []; }
}
