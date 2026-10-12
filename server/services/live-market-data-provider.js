import WebSocket from 'ws';
import {MarketDataProvider} from './market-data-provider.js';

/**
 * Adaptador para un WebSocket AUTORIZADO. Ajusta createSubscribeMessage y
 * extractTick a la documentación pública del proveedor que contrates.
 */
export class LiveMarketDataProvider extends MarketDataProvider {
  constructor({websocketUrl,historicalUrl,apiKey,apiSecret,symbolMap,providerName='AUTHORIZED_PROVIDER'}){
    super();this.url=websocketUrl;this.historicalUrl=historicalUrl;this.apiKey=apiKey;this.apiSecret=apiSecret;this.symbolMap=symbolMap;this.providerName=providerName;this.socket=null;this.subscriptions=new Set();this.connected=false;
  }
  async connect(){
    if(this.connected)return;
    if(!this.url||!this.apiKey)throw new Error('Proveedor real no configurado');
    await new Promise((resolve,reject)=>{
      const socket=this.socket=new WebSocket(this.url,{headers:{Authorization:`Bearer ${this.apiKey}`}});
      const timeout=setTimeout(()=>reject(new Error('Tiempo de conexión agotado')),10_000);
      socket.once('open',()=>{clearTimeout(timeout);this.connected=true;this.emit('status',{status:'live',source:this.providerName});resolve();});
      socket.once('error',error=>{clearTimeout(timeout);reject(error);});
      socket.on('message',buffer=>this.handleMessage(buffer));
      socket.on('close',()=>{this.connected=false;this.emit('status',{status:'disconnected',source:this.providerName});});
      socket.on('error',error=>this.emit('error',error));
    });
  }
  createSubscribeMessage(symbols){
    return JSON.stringify({action:'subscribe',symbols:symbols.map(symbol=>this.symbolMap[symbol]),apiSecret:this.apiSecret||undefined});
  }
  extractTick(payload){
    const item=payload?.tick||payload?.data||payload;
    const providerSymbol=item?.symbol||item?.instrument;
    const symbol=Object.entries(this.symbolMap).find(([,value])=>value===providerSymbol)?.[0];
    if(!symbol)return null;
    return {symbol,bid:Number(item.bid),ask:Number(item.ask),mid:Number(item.mid??item.price),changePercent:Number(item.changePercent??item.change_percent??0),timestamp:item.timestamp||item.time||new Date().toISOString(),source:this.providerName,status:'live'};
  }
  handleMessage(buffer){
    try{const tick=this.extractTick(JSON.parse(buffer.toString()));if(tick)this.emit('tick',tick);}catch(error){this.emit('error',new Error(`Mensaje del proveedor inválido: ${error.message}`));}
  }
  async subscribe(symbols){this.subscriptions=new Set(symbols);if(!this.connected)await this.connect();this.socket.send(this.createSubscribeMessage([...this.subscriptions]));}
  async unsubscribe(symbols){symbols.forEach(symbol=>this.subscriptions.delete(symbol));if(this.connected)this.socket.send(JSON.stringify({action:'unsubscribe',symbols:symbols.map(symbol=>this.symbolMap[symbol])}));}
  /**
   * Generic REST history adapter.  Providers use different field names, so
   * customise `extractHistoricalCandles` if their documented contract differs.
   * No candle is manufactured when this endpoint is absent or fails.
   */
  async getHistoricalCandles(symbol,interval,limit=250){
    if(!this.historicalUrl||!this.apiKey||!this.symbolMap[symbol])return [];
    const url=new URL(this.historicalUrl);url.searchParams.set('symbol',this.symbolMap[symbol]);url.searchParams.set('interval',interval);url.searchParams.set('limit',String(Math.max(1,Math.min(500,Number(limit)||250))));
    const response=await fetch(url,{headers:{Accept:'application/json',Authorization:`Bearer ${this.apiKey}`}});
    if(!response.ok)throw new Error(`HistÃ³rico respondiÃ³ ${response.status}`);
    return this.extractHistoricalCandles(await response.json(),symbol,interval);
  }
  extractHistoricalCandles(payload,symbol,interval){
    const rows=Array.isArray(payload)?payload:(payload?.candles||payload?.data||payload?.results||[]);
    if(!Array.isArray(rows))return [];
    return rows.map(item=>({
      time:item?.time??item?.timestamp??item?.openTime??item?.t,
      open:Number(item?.open??item?.o),high:Number(item?.high??item?.h),low:Number(item?.low??item?.l),close:Number(item?.close??item?.c),volume:Number(item?.volume??item?.v??0),
      // A current/unfinished candle must never enter a technical calculation.
      closed:item?.closed===true||item?.isClosed===true||item?.complete===true||item?.final===true
    })).filter(candle=>Number.isFinite(Date.parse(candle.time))||Number.isFinite(candle.time));
  }
  async disconnect(){if(this.socket){this.socket.close();this.socket=null;}this.connected=false;}
  async getMarketStatus(){return this.connected?'live':'disconnected';}
}
