import {EventEmitter} from 'node:events';

export class MarketDataProvider extends EventEmitter {
  async connect(){throw new Error('connect() no implementado');}
  async disconnect(){throw new Error('disconnect() no implementado');}
  async subscribe(){throw new Error('subscribe() no implementado');}
  async unsubscribe(){throw new Error('unsubscribe() no implementado');}
  async getQuote(){return null;}
  async getCandles(){return [];}
  /**
   * Historical OHLC is optional at the adapter boundary.  Implementations
   * must return only final/closed candles from the authorised provider.
   */
  async getHistoricalCandles(){return [];}
  async getMarketStatus(){return 'disconnected';}
  onTick(callback){this.on('tick',callback);return()=>this.off('tick',callback);}
  onError(callback){this.on('error',callback);return()=>this.off('error',callback);}
  onStatusChange(callback){this.on('status',callback);return()=>this.off('status',callback);}
}
