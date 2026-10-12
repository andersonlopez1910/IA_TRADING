import {MarketData} from './market-data.js';
import {atr,ema,rsi,supportResistance} from './indicators.js';

const PAIRS=['EUR/USD','GBP/USD','USD/JPY','XAU/USD'];
const unavailableMarkets=()=>Object.fromEntries(PAIRS.map(pair=>[pair,{price:null,change:null,h1:'—',h4:'—',status:'Datos no disponibles',confidence:'—',direction:'wait'}]));
let markets=unavailableMarkets();
let selected='EUR/USD';
let candles=[];
let mode='connecting';
let lastUpdate=new Date();
const digits=pair=>pair==='USD/JPY'?3:pair==='XAU/USD'?2:5;
const format=(value,pair)=>Number.isFinite(Number(value))?Number(value).toLocaleString('en-US',{minimumFractionDigits:digits(pair),maximumFractionDigits:digits(pair)}):'—';

function renderPairs(){
  const target=document.querySelector('#forexPairs');
  target.innerHTML=Object.entries(markets).map(([pair,quote])=>{
    const positive=Number(quote.change||0)>=0;
    const direction=quote.direction==='buy'?'Alcista':quote.direction==='sell'?'Bajista':'Esperar';
    const dataState=mode==='live'?'En vivo':mode==='demo'?'Modo demo':mode==='unavailable'?'Sin datos':'Conectando';
    const variation=Number.isFinite(Number(quote.change))?`${positive?'+':''}${Number(quote.change).toFixed(2)}%`:'—';
    return `<button class="forex-pair ${pair===selected?'selected':''}" data-pair="${pair}" type="button"><small>${pair}</small><b>${format(quote.price,pair)}</b><span class="${positive?'up':'down'}">${variation}</span><div class="forex-card-meta"><span>H1 <strong>${quote.h1||'—'}</strong></span><span>H4 <strong>${quote.h4||'—'}</strong></span><span>Señal <strong>${quote.status||'Conectando'}</strong></span><span>Confianza <strong>${quote.confidence??'—'}%</strong></span></div><em>${direction} · ${dataState}</em><small class="forex-updated">Actualizado ${lastUpdate.toLocaleTimeString('es-CO')}</small></button>`;
  }).join('');
  target.querySelectorAll('[data-pair]').forEach(button=>button.onclick=()=>{selected=button.dataset.pair;loadPair();});
}

function drawChart(){
  const canvas=document.querySelector('#forexChart');
  const rect=canvas.getBoundingClientRect();
  if(!candles.length||!rect.width)return;
  const dpr=devicePixelRatio||1; canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const width=rect.width,height=rect.height,pad={top:15,right:58,bottom:20,left:6};
  const close=candles.map(item=>item.close),ema20=ema(close,20),ema50=ema(close,50);
  const min=Math.min(...candles.map(item=>item.low)),max=Math.max(...candles.map(item=>item.high)),range=max-min||1;
  const graphH=height-pad.top-pad.bottom,graphW=width-pad.left-pad.right;
  const x=index=>pad.left+(index+.5)*graphW/candles.length;
  const y=value=>pad.top+(max-value)/range*graphH;
  ctx.clearRect(0,0,width,height);ctx.font='10px ui-monospace,monospace';
  for(let i=0;i<5;i++){const py=pad.top+(graphH/4)*i;ctx.strokeStyle='rgba(143,163,196,.16)';ctx.beginPath();ctx.moveTo(pad.left,py);ctx.lineTo(width-pad.right,py);ctx.stroke();ctx.fillStyle='#8798b9';ctx.fillText(format(max-range*i/4,selected),width-pad.right+4,py+3);}
  [{values:ema20,color:'#52b8ff'},{values:ema50,color:'#f2bf5d'}].forEach(line=>{ctx.strokeStyle=line.color;ctx.lineWidth=1.2;ctx.beginPath();line.values.forEach((value,index)=>index?ctx.lineTo(x(index),y(value)):ctx.moveTo(x(index),y(value)));ctx.stroke();});
  const candleW=Math.max(2,graphW/candles.length*.56);candles.forEach((item,index)=>{const green=item.close>=item.open;ctx.strokeStyle=ctx.fillStyle=green?'#24d19b':'#f4687a';ctx.beginPath();ctx.moveTo(x(index),y(item.high));ctx.lineTo(x(index),y(item.low));ctx.stroke();ctx.fillRect(x(index)-candleW/2,Math.min(y(item.open),y(item.close)),candleW,Math.max(1,Math.abs(y(item.open)-y(item.close))));});
}

function renderAnalysis(){
  const quote=markets[selected]; if(!quote||!candles.length)return;
  const close=candles.map(item=>item.close),e20=ema(close,20).at(-1),e50=ema(close,50).at(-1),rsiValue=rsi(close),atrValue=atr(candles),levels=supportResistance(candles);
  const bullish=quote.price>e20&&e20>e50&&rsiValue>=52&&rsiValue<70;
  const bearish=quote.price<e20&&e20<e50&&rsiValue<=48&&rsiValue>30;
  const state=bullish?'COMPRA':bearish?'VENTA':'ESPERAR';
  const stop=bullish?Math.min(levels.support,quote.price-atrValue*1.2):Math.max(levels.resistance,quote.price+atrValue*1.2);
  const target=bullish?quote.price+(quote.price-stop)*2:quote.price-(stop-quote.price)*2;
  document.querySelector('#forexPairTitle').textContent=`${selected} · M15`;
  document.querySelector('#forexPrice').textContent=format(quote.price,selected);
  const signal=document.querySelector('#forexSignal');signal.textContent=state;signal.className=state==='COMPRA'?'buy':state==='VENTA'?'sell':'wait';
  document.querySelector('#forexLevels').innerHTML=`<span>Entrada<b>${format(quote.price,selected)}</b></span><span>Stop técnico<b>${format(stop,selected)}</b></span><span>Objetivo 1<b>${format(target,selected)}</b></span><span>Soporte / Resistencia<b>${format(levels.support,selected)} / ${format(levels.resistance,selected)}</b></span>`;
  document.querySelector('#forexMetrics').textContent=`RSI ${rsiValue} · ATR ${format(atrValue,selected)} · EMA20 ${format(e20,selected)} · EMA50 ${format(e50,selected)}`;
  const technical=state==='COMPRA'?'precio y EMA20 por encima de EMA50':state==='VENTA'?'precio y EMA20 por debajo de EMA50':'indicadores sin alineación suficiente';
  document.querySelector('#forexAiText').textContent=`Lectura técnica: ${technical}. RSI ${rsiValue}. ${state==='ESPERAR'?'No hay una entrada validada; esperar el cierre de una vela M15.':`Escenario ${state.toLowerCase()} informativo, invalidado si el precio supera el stop técnico.`}`;
}

async function loadPair(){
  renderPairs();
  try{candles=await MarketData.getLiveCandles(selected,'M15');}catch{candles=MarketData.getCandles(selected,'M15');}
  renderAnalysis();drawChart();
}

async function update(){
  const status=document.querySelector('#forexStatus');
  const headerStatus=document.querySelector('#forexHeaderStatus');
  try{const snapshot=await MarketData.getLiveSnapshot();markets=snapshot.markets;mode='live';lastUpdate=new Date(snapshot.fetchedAt||Date.now());status.textContent='● Datos en vivo';status.className='forex-live';if(headerStatus)headerStatus.textContent='● Mercado Forex en vivo';}
  catch(error){
    try{markets=MarketData.getSnapshot();mode='demo';lastUpdate=new Date();status.textContent='○ Modo demo · datos en vivo no disponibles';status.title=error.message;status.className='forex-reference';if(headerStatus)headerStatus.textContent='○ Mercado Forex · modo demo';}
    catch(fallbackError){markets=unavailableMarkets();mode='unavailable';lastUpdate=new Date();status.textContent='○ Datos no disponibles';status.title=fallbackError.message;status.className='forex-reference';if(headerStatus)headerStatus.textContent='○ Mercado Forex sin datos';}
  }
  renderPairs();await loadPair();
}

window.addEventListener('resize',drawChart);
renderPairs();
update();
setInterval(update,30_000);
