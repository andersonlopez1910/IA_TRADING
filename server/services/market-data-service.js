import {CandleService} from './candle-service.js';

const delays=[1000,2000,4000,8000,15000,30000];
export class MarketDataService {
  constructor({provider,symbols,logger=console}){this.provider=provider;this.symbols=symbols;this.logger=logger;this.candles=new CandleService();this.quotes=new Map();this.listeners=new Set();this.reconnectAttempt=0;this.reconnectTimer=null;this.lastTickAt=null;this.status='connecting';this.historyLoaded=false;}
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  broadcast(message){this.listeners.forEach(listener=>listener(message));}
  async start(){
    this.provider.onTick(tick=>this.handleTick(tick));
    this.provider.onError(error=>{this.logger.error('[market provider]',error.message);this.setStatus('reconnecting');this.scheduleReconnect();});
    this.provider.onStatusChange(({status,source})=>{this.setStatus(status,source);if(status==='disconnected')this.scheduleReconnect();});
    this.healthTimer=setInterval(()=>this.checkFreshness(),1000);
    await this.connect();
  }
  async connect(){try{await this.provider.connect();await this.provider.subscribe(this.symbols);await this.hydrateHistoricalCandles();this.reconnectAttempt=0;const providerStatus=this.provider.constructor.name==='DemoMarketDataProvider'?'demo':await this.provider.getMarketStatus();this.setStatus(providerStatus);}catch(error){this.logger.error('[market connection]',error.message);this.setStatus('disconnected');this.scheduleReconnect();}}
  async hydrateHistoricalCandles(){
    if(this.historyLoaded||typeof this.provider.getHistoricalCandles!=='function')return;
    const timeframes=['H4','H1','M15','M5','M1'];let loaded=0;
    for(const symbol of this.symbols){
      let latestOfficialClose=[];let latestOfficialSeconds=0;
      for(const interval of timeframes){
        try{const candles=await this.provider.getHistoricalCandles(symbol,interval,250);loaded+=this.candles.seedCandles(symbol,interval,candles);if(candles.length&&(!latestOfficialClose.length||interval==='M1')){latestOfficialClose=candles;latestOfficialSeconds=interval==='M1'?60:interval==='M5'?300:interval==='M15'?900:interval==='H1'?3600:interval==='H4'?14400:0;}}catch(error){this.logger.warn(`[market history] ${symbol} ${interval}: ${error.message}`);}
      }
      this.seedLastOfficialClose(symbol,latestOfficialClose,latestOfficialSeconds);
    }
    // An empty response is not substituted with generated prices.  We keep it
    // retryable after a reconnect so an authorised provider can recover.
    this.historyLoaded=loaded>0;
    if(loaded)this.logger.info(`[market history] ${loaded} velas cerradas cargadas`);
  }
  seedLastOfficialClose(symbol,candles,candleSeconds=60){
    if(this.quotes.has(symbol)||!Array.isArray(candles))return;
    const rows=candles.filter(candle=>candle?.closed===true&&Number.isFinite(Number(candle.close))).sort((left,right)=>Number(left.time)-Number(right.time));
    const latest=rows.at(-1);const previous=rows.at(-2);if(!latest)return;
    const mid=Number(latest.close);const time=Number(latest.time);const timestamp=Number.isFinite(time)?new Date((time+(Number(candleSeconds)||60))*1000).toISOString():new Date().toISOString();
    this.quotes.set(symbol,{symbol,bid:mid,ask:mid,mid,open:Number(previous?.close)||mid,spread:0,spreadVerified:false,priceType:'historical_close',changePercent:previous?.close?((mid-Number(previous.close))/Number(previous.close))*100:0,timestamp,source:`${this.provider.providerName||'Proveedor autorizado'} · último cierre oficial`,status:'closed'});
  }
  scheduleReconnect(){if(this.reconnectTimer)return;const wait=delays[Math.min(this.reconnectAttempt++,delays.length-1)];this.setStatus('reconnecting',undefined,wait);this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;this.connect();},wait);}
  checkFreshness(){if(this.status==='live'&&this.lastTickAt&&Date.now()-this.lastTickAt>5000)this.setStatus('delayed');}
  setStatus(status,source,wait){this.status=status;this.broadcast({type:'status',status,source:source||this.provider.providerName||this.provider.constructor.name,retryInMs:wait,lastTickAt:this.lastTickAt});}
  handleTick(tick){
    if(!this.validateTick(tick))return;
    const previous=this.quotes.get(tick.symbol);const open=previous?.open??tick.mid;const quote={...tick,open,spread:tick.ask-tick.bid,changePercent:Number.isFinite(tick.changePercent)?tick.changePercent:((tick.mid-open)/open)*100};
    this.quotes.set(tick.symbol,quote);this.lastTickAt=Date.now();const closedCandles=this.candles.onTick(quote);this.reconnectAttempt=0;if(quote.status==='live')this.status='live';this.broadcast({type:'tick',quote,closedCandles,latencyMs:Math.max(0,Date.now()-new Date(tick.timestamp).getTime())});
  }
  validateTick(tick){const valid=this.symbols.includes(tick?.symbol)&&['bid','ask','mid'].every(key=>Number.isFinite(tick[key])&&tick[key]>0)&&Number.isFinite(Date.parse(tick.timestamp));if(!valid)this.logger.warn('[market provider] tick descartado');return valid;}
  getState(){return {status:this.status,quotes:Object.fromEntries(this.quotes),lastTickAt:this.lastTickAt};}
  getCandles(symbol,interval,limit){return this.candles.getCandles(symbol,interval,limit);}
}
