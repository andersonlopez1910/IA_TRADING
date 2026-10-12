import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const VALID_DECISIONS = new Set(['BUY', 'SELL', 'WAIT', 'NO_TRADE']);
const SENSITIVE_KEY = /(?:api[_-]?key|secret|password|token|authorization|cookie)/i;

function toIso(value, fieldName) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new TypeError(`${fieldName} debe ser una fecha UTC válida.`);
  return new Date(timestamp).toISOString();
}

function redact(value, { depth = 0, seen = new WeakSet() } = {}) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 10_000 ? `${value.slice(0, 10_000)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= 8) return '[truncado]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[referencia circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => redact(item, { depth: depth + 1, seen }));
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [key, redact(item, { depth: depth + 1, seen })]));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureSignal(signal) {
  if (!signal || typeof signal !== 'object') throw new TypeError('La señal a auditar debe ser un objeto.');
  if (typeof signal.symbol !== 'string' || !signal.symbol.trim()) throw new TypeError('La señal debe incluir un símbolo.');
  if (!VALID_DECISIONS.has(signal.decision)) throw new TypeError('La señal debe incluir una decisión válida.');
  return {
    ...redact(signal),
    symbol: signal.symbol.trim(),
    decision: signal.decision,
    timestamp: toIso(signal.timestamp, 'signal.timestamp')
  };
}

/**
 * Persistencia append-only de decisiones informativas. El resultado de una
 * operación sólo puede llegar por `recordUserOutcome`; nunca se calcula o se
 * inventa en el backend.
 */
export class SignalAuditService {
  constructor({
    filePath = path.resolve(process.cwd(), 'server', 'data', 'signal-audit.jsonl'),
    maxEntries = 5_000,
    persist = true,
    logger = console,
    now = () => new Date()
  } = {}) {
    this.filePath = filePath;
    this.maxEntries = Math.max(1, Number(maxEntries) || 5_000);
    this.persist = persist;
    this.logger = logger;
    this.now = now;
    this.entries = [];
    this.loaded = false;
    this.loading = null;
    this.storageError = null;
  }

  async initialize() {
    if (this.loaded) return this.getStorageStatus();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (!this.persist) {
        this.loaded = true;
        return this.getStorageStatus();
      }
      try {
        const content = await readFile(this.filePath, 'utf8');
        for (const line of content.split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            this.applyPersistedRecord(JSON.parse(line));
          } catch (error) {
            this.logger.warn?.('[signal audit] línea descartada:', error instanceof Error ? error.message : error);
          }
        }
        this.trimEntries();
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          this.storageError = error instanceof Error ? error.message : 'No se pudo leer la auditoría.';
          this.logger.error?.('[signal audit] no se pudo cargar:', this.storageError);
        }
      }
      this.loaded = true;
      return this.getStorageStatus();
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  applyPersistedRecord(record) {
    if (!record || typeof record !== 'object') return;
    if (record.type === 'signal' && record.entry?.id) {
      this.entries.push(record.entry);
      return;
    }
    if (record.type === 'outcome' && record.signalId) {
      const entry = this.entries.find(item => item.id === record.signalId);
      if (entry) entry.userOutcome = record.outcome;
    }
  }

  trimEntries() {
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);
  }

  async appendRecord(record) {
    if (!this.persist) return { status: 'memory_only', filePath: null };
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
      this.storageError = null;
      return { status: 'stored', filePath: this.filePath };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Error de escritura desconocido.';
      this.storageError = reason;
      this.logger.error?.('[signal audit] no se pudo guardar:', reason);
      return { status: 'failed', filePath: this.filePath, reason };
    }
  }

  async record(signal, context = {}) {
    await this.initialize();
    const auditedSignal = ensureSignal(signal);
    const entry = {
      id: randomUUID(),
      type: 'signal',
      recordedAt: toIso(this.now(), 'audit timestamp'),
      signal: auditedSignal,
      context: redact(context),
      userOutcome: null,
      persistence: { status: 'pending', filePath: this.persist ? this.filePath : null }
    };
    const persistence = await this.appendRecord({ type: 'signal', entry: { ...entry, persistence: { status: 'stored', filePath: this.persist ? this.filePath : null } } });
    entry.persistence = persistence;
    this.entries.push(entry);
    this.trimEntries();
    return clone(entry);
  }

  async append(signal, context = {}) {
    return this.record(signal, context);
  }

  async recordUserOutcome(signalId, outcome) {
    await this.initialize();
    if (typeof signalId !== 'string' || !signalId) throw new TypeError('signalId es obligatorio.');
    const index = this.entries.findIndex(entry => entry.id === signalId);
    if (index < 0) throw new Error('No se encontró la señal auditada.');
    const userOutcome = {
      recordedAt: toIso(this.now(), 'outcome timestamp'),
      value: redact(outcome)
    };
    const persistence = await this.appendRecord({ type: 'outcome', signalId, outcome: userOutcome });
    this.entries[index].userOutcome = userOutcome;
    this.entries[index].outcomePersistence = persistence;
    return clone(this.entries[index]);
  }

  async list({ symbol, limit = 100 } = {}) {
    await this.initialize();
    const safeLimit = Math.max(1, Math.min(this.maxEntries, Number(limit) || 100));
    return this.entries
      .filter(entry => !symbol || entry.signal.symbol === symbol)
      .slice(-safeLimit)
      .reverse()
      .map(clone);
  }

  async getAuditTrail(options = {}) {
    return this.list(options);
  }

  getStorageStatus() {
    return {
      status: this.storageError ? 'error' : (this.persist ? 'ready' : 'memory_only'),
      filePath: this.persist ? this.filePath : null,
      entries: this.entries.length,
      ...(this.storageError ? { reason: this.storageError } : {})
    };
  }
}
