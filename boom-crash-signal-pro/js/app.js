import {DerivMarketStreamService} from './deriv-market-stream-service.js';
import {CandleBuilder,FRAMES} from './candle-builder.js';
import {SpikeAnalysisEngine} from './spike-analysis-engine.js';
import {signal as makeSignal} from './signal-engine.js';
import {MarketProjectionEngine} from './market-projection-engine.js';
import {MarketAnalysisAI} from './market-analysis-ai.js';
import {draw} from './chart-controller.js';
import * as UI from './ui-controller.js';

const builder=new CandleBuilder();
const engine=new SpikeAnalysisEngine();
const projectionEngine=new MarketProjectionEngine();
const analysisAI=new MarketAnalysisAI();
const data={BOOM:{},CRASH:{}};
const spikeRows=[];
let active='BOOM';
let frame='1M';
let demoTimer;

function acceptTick(name,tick){
  data[name].price=tick.price;
  data[name].totalTicks=(data[name].totalTicks||0)+1;
  const closed=builder.add(name,tick);
  data[name].analysis=engine.analyse(name,builder.get(name,'1M'));
  for(const item of closed){
    if(item.frame!=='1M')continue;
    const analysis=engine.analyse(name,builder.get(name,'1M'));
    data[name].analysis=analysis;
    data[name].signal=makeSignal(name,analysis);
    if(analysis.spike)spikeRows.unshift({...analysis.last,name,ticks:item.candle.ticks});
  }
  render();
}

function startDemo(){
  if(demoTimer)return;
  document.querySelector('#mode').textContent='MODO DEMO · DATOS SIMULADOS';
  const prices={BOOM:15670,CRASH:9820};
  demoTimer=setInterval(()=>Object.keys(prices).forEach(name=>{
    prices[name]+=(Math.random()-.52)*(name==='BOOM'?2.2:1.7);
    acceptTick(name,{price:prices[name],epoch:Date.now()/1000});
  }),700);
}

function render(){
  UI.cards(data,active,key=>{active=key;render();});
  const current=data[active];
  const candles=builder.get(active,frame);
  const projection=projectionEngine.project(current.analysis,candles);
  const currentSignal=current.signal||{state:'ESPERAR'};
  const instrument=active==='BOOM'?'Boom 1000':'Crash 1000';

  document.querySelector('#title').textContent=`${instrument} Index`;
  document.querySelector('#price').textContent=current.price||'—';
  document.querySelector('#tickCount').textContent=`${current.totalTicks||0} ticks recibidos · ${frame}`;
  document.querySelector('#aiTitle').textContent=`ANÁLISIS IA · ${instrument.toUpperCase()}`;
  draw(document.querySelector('#chart'),candles,projection);

  const explanation=analysisAI.explain(current.analysis,projection,currentSignal);
  if(current.signal)UI.signal(current.signal,explanation);
  document.querySelector('#aiPanel').textContent=explanation;
  document.querySelector('#metrics').textContent=current.analysis?.atr
    ?`RSI ${current.analysis.rsi} · ATR ${current.analysis.atr.toFixed(2)} · EMA20 ${current.analysis.e20.toFixed(2)} · ${current.analysis.volatility}`
    :'Cargando indicadores M1…';

  const target=document.querySelector('#projection');
  target.innerHTML=projection.reliable
    ?`<div class="projection-grid"><div>5 min<b>${projection.label}</b>Rango ${projection.lower.toFixed(2)}–${projection.upper.toFixed(2)}</div><div>10 min<b>Alcista ${projection.probabilities.alcista}%</b>Bajista ${projection.probabilities.bajista}%</div><div>15 min<b>Confianza ${projection.confidence}</b>Invalidación ${projection.invalidation.toFixed(2)}</div></div><small>${projection.spikeRisk} · Proyección, no precio futuro real.</small>`
    :`<p>${projection.reason}</p>`;
  UI.spikes(spikeRows);
}

document.querySelector('#timeframes').innerHTML=FRAMES.map(value=>`<button class="${value===frame?'selected':''}" data-f="${value}">${value}</button>`).join('');
document.querySelector('#timeframes').onclick=event=>{
  const button=event.target.closest('button');
  if(!button)return;
  frame=button.dataset.f;
  document.querySelectorAll('#timeframes button').forEach(item=>item.classList.toggle('selected',item===button));
  render();
};
document.querySelector('#theme').onclick=()=>document.body.classList.toggle('light');
document.querySelector('#record').onclick=()=>{
  const current=data[active];
  if(!current.signal)return;
  const logs=JSON.parse(localStorage.getItem('boom-crash-manual')||'[]');
  logs.push({at:Date.now(),name:active,signal:current.signal});
  localStorage.setItem('boom-crash-manual',JSON.stringify(logs));
};

const stream=new DerivMarketStreamService(async event=>{
  if(event.type==='status'){
    const connection=document.querySelector('#connection');
    connection.textContent=event.text;
    connection.className=event.state;
    if(event.state==='bad'||event.state==='warn')startDemo();
    if(event.state==='live'){
      clearInterval(demoTimer);
      demoTimer=null;
      document.querySelector('#mode').textContent='DATOS EN VIVO DE DERIV';
    }
  }
  if(event.type==='history'){
    builder.load(event.name,event.history);
    data[event.name].price=event.history.prices.at(-1);
    render();
  }
  if(event.type==='tick'){
    document.querySelector('#lastTick').textContent=`Último tick ${new Date(event.tick.epoch*1000).toLocaleTimeString()}`;
    acceptTick(event.name,event.tick);
  }
});

stream.start();
render();
