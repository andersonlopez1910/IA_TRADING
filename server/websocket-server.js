import {WebSocketServer} from 'ws';

export function attachWebSocketServer(httpServer,market,{getAnalyses=()=>({})}={}){
  const wss=new WebSocketServer({server:httpServer,path:'/ws/market'});
  const unsubscribe=market.subscribe(message=>{
    const encoded=JSON.stringify(message);wss.clients.forEach(client=>{if(client.readyState===client.OPEN)client.send(encoded);});
  });
  wss.on('connection',socket=>{
    socket.send(JSON.stringify({type:'snapshot',...market.getState(),analyses:getAnalyses()}));
    socket.on('error',error=>console.error('[browser websocket]',error.message));
  });
  wss.on('close',unsubscribe);
  return wss;
}
