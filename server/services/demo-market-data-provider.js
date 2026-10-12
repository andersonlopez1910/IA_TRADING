import {MarketDataProvider} from './market-data-provider.js';

const initial={'EUR/USD':1.08642,'GBP/USD':1.2748,'USD/JPY':156.384,'XAU/USD':2358.62};

/** Solo se instancia cuando ALLOW_DEMO_PROVIDER=true. */
export class DemoMarketDataProvider extends MarketDataProvider {
  constructor(){super();this.prices={...initial};this.timer=null;this.symbols=[];}
  async connect(){this.emit('status',{status:'demo',source:'DemoMarketDataProvider'});}
  async disconnect(){clearInterval(this.timer);this.timer=null;}
  async subscribe(symbols){this.symbols=[...symbols];clearInterval(this.timer);this.timer=setInterval(()=>this.symbols.forEach(symbol=>{
    const size=symbol==='XAU/USD'?0.22:symbol==='USD/JPY'?0.012:0.00008;
    this.prices[symbol]+=((Math.random()-.5)*size);
    const mid=Number(this.prices[symbol].toFixed(symbol==='USD/JPY'?3:symbol==='XAU/USD'?2:5));
    this.emit('tick',{symbol,bid:mid-size/3,ask:mid+size/3,mid,changePercent:0,timestamp:new Date().toISOString(),source:'DemoMarketDataProvider',status:'demo'});
  }),1000);}
  async unsubscribe(){await this.disconnect();}
  async getQuote(symbol){const mid=this.prices[symbol];return mid?{symbol,mid,bid:mid,ask:mid,status:'demo',source:'DemoMarketDataProvider',timestamp:new Date().toISOString()}:null;}
  async getMarketStatus(){return 'demo';}
}
