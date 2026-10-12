export class MarketWebSocketClient {
  constructor({onMessage,onState}){this.onMessage=onMessage;this.onState=onState;this.socket=null;this.attempt=0;this.timer=null;this.closed=false;}
  connect(){if(this.socket||this.closed)return;const protocol=location.protocol==='https:'?'wss:':'ws:';this.onState({status:this.attempt?'reconnecting':'connecting'});this.socket=new WebSocket(`${protocol}//${location.host}/ws/market`);this.socket.onopen=()=>{this.attempt=0;};this.socket.onmessage=event=>this.onMessage(JSON.parse(event.data));this.socket.onerror=()=>this.onState({status:'reconnecting'});this.socket.onclose=()=>{this.socket=null;if(!this.closed)this.reconnect();};}
  reconnect(){const wait=Math.min(1000*2**this.attempt++,30000);this.onState({status:'reconnecting',retryInMs:wait});this.timer=setTimeout(()=>this.connect(),wait);}
  close(){this.closed=true;clearTimeout(this.timer);this.socket?.close();}
}
