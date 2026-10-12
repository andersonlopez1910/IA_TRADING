const KEY = 'forex-signal-pro';
const defaults = { history: [], settings: { capital: 10000, risk: 0.5, minRR: 2, session: 'london', visualAlerts: true, soundAlerts: false, demoMode: true, pairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD'] } };
function read() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return structuredClone(defaults); } }
function write(data) { localStorage.setItem(KEY, JSON.stringify(data)); }
export const Storage = { get() { return read(); }, saveSettings(settings) { const state = read(); state.settings = settings; write(state); }, addSignal(signal) { const state = read(); state.history.unshift(signal); write(state); }, clearHistory() { const state = read(); state.history = []; write(state); } };
