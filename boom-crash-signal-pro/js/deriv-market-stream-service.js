import { DerivHistoryService } from './deriv-history-service.js';
const URL = 'wss://api.derivws.com/trading/v1/options/ws/public';

/** Un único socket: descubre, carga historia y suscribe Boom/Crash por separado. */
export class DerivMarketStreamService {
  constructor(onEvent) { this.onEvent=onEvent; this.socket=null; this.connecting=false; this.retry=0; this.timer=null; this.monitor=null; this.lastTickAt=0; this.symbols={}; this.subscriptions=new Map(); }
  start() { if(this.socket||this.connecting)return; this.monitor ||= setInterval(()=>{if(this.lastTickAt&&Date.now()-this.lastTickAt>10000)this.onEvent({type:'status',state:'warn',text:'Datos retrasados'});},1000); this.connecting=true; this.onEvent({type:'status',state:'reconnecting',text:'Conectando a Deriv…'}); this.socket=new WebSocket(URL); this.socket.onopen=()=>{this.connecting=false;this.retry=0;this.history=new DerivHistoryService(x=>this.send(x));this.send({active_symbols:'brief',req_id:1});}; this.socket.onmessage=e=>this.handle(JSON.parse(e.data)); this.socket.onerror=()=>this.onEvent({type:'status',state:'bad',text:'Conexión no disponible'}); this.socket.onclose=()=>{this.socket=null;this.connecting=false;this.reconnect();}; }
  send(payload){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(payload));}
  async discover(list) {
    const find = word => list.find(item => `${item.underlying_symbol_name||item.display_name||''} ${item.underlying_symbol||item.symbol||''}`.toLowerCase().includes(word));
    const targets=[['BOOM',find('boom 1000')],['CRASH',find('crash 1000')]];
    const available=targets.filter(([,item])=>item);
    if(!available.length){this.onEvent({type:'status',state:'bad',text:'Boom 1000 y Crash 1000 no aparecen en active_symbols'});return;}
    await Promise.all(available.map(async([name,item])=>{const symbol=item.underlying_symbol||item.symbol;this.symbols[name]=symbol;try{const history=await this.history.request(symbol);this.onEvent({type:'history',name,symbol,history});this.send({ticks:symbol,subscribe:1,req_id:name==='BOOM'?2:3});}catch(error){this.onEvent({type:'instrumentError',name,text:`${name}: ${error.message}`});}}));
    const missing=targets.filter(([,item])=>!item).map(([name])=>name); this.onEvent({type:'status',state:'live',text:missing.length?`En vivo · falta ${missing.join(' y ')}`:'En vivo · Boom y Crash de Deriv'});
  }
  async handle(message){if(this.history?.receive(message))return;if(message.error){this.onEvent({type:'status',state:'bad',text:message.error.message});return;}if(message.msg_type==='active_symbols'){await this.discover(message.active_symbols||[]);return;}if(message.tick){const name=Object.entries(this.symbols).find(([,symbol])=>symbol===message.tick.symbol)?.[0];if(!name)return;this.lastTickAt=Date.now();if(message.subscription?.id)this.subscriptions.set(name,message.subscription.id);this.onEvent({type:'tick',name,tick:{price:+message.tick.quote,epoch:+message.tick.epoch}});}}
  reconnect(){const delay=Math.min(1000*2**this.retry++,30000);this.onEvent({type:'status',state:'warn',text:`Reconectando en ${delay/1000}s`});clearTimeout(this.timer);this.timer=setTimeout(()=>this.start(),delay);}
  stop(){clearTimeout(this.timer);clearInterval(this.monitor);[...this.subscriptions.values()].forEach(id=>this.send({forget:id}));this.socket?.close();this.socket=null;}
}
