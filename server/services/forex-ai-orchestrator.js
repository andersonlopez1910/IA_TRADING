import {TechnicalAnalysisEngine} from './technical-analysis-engine.js';
import {SignalEngine} from './signal-engine.js';
import {RiskManagementEngine,deriveDataStatus} from './risk-management-engine.js';

const TIMEFRAMES=['H4','H1','M15','M5'];
const emptyArray=value=>Array.isArray(value)?value:[];
const safeText=value=>typeof value==='string'&&value.trim()?value.trim():null;

function marketEvidence(quote){return quote?.timestamp?[{type:'market',source:quote.source||'Proveedor no identificado',timestamp:quote.timestamp,reference:quote.symbol||'tick'}]:[];}
function technicalEvidence(technical){return technical?.timestamp?[{type:'indicator',source:'TechnicalAnalysisEngine',timestamp:technical.timestamp,reference:'Velas OHLC cerradas del proveedor autorizado'}]:[];}
function verifiedNewsEvidence(fundamental){return emptyArray(fundamental?.verifiedNews).map(item=>({type:'news',source:item.source,timestamp:item.timestamp,reference:item.url}));}
function calendarEvidence(fundamental){return emptyArray(fundamental?.events).map(item=>({type:'calendar',source:item.source,timestamp:item.timestamp,reference:item.url}));}
function trends(technical){return Object.fromEntries(TIMEFRAMES.map(frame=>[frame,technical?.timeframes?.[frame]?.trend||'NEUTRAL']));}
function highImpactCalendar(fundamental){return {status:fundamental?.dataAvailability?.calendar||fundamental?.status||'unavailable',highImpactWindow:fundamental?.highImpactWindow||{blocked:false}};}
function summarize({decision,symbol,technical,fundamental,risk}){
  if(risk?.blocks?.length)return `NO OPERAR: ${risk.blocks[0].message}`;
  if(decision==='BUY')return `${symbol}: escenario informativo de compra; verificar la condición de activación y el riesgo antes de operar manualmente.`;
  if(decision==='SELL')return `${symbol}: escenario informativo de venta; verificar la condición de activación y el riesgo antes de operar manualmente.`;
  if(decision==='WAIT')return `${symbol}: esperar confirmación con vela M5 cerrada y condiciones técnicas restantes.`;
  if(technical?.dataQuality?.readyForSignal!==true)return 'NO OPERAR: faltan velas cerradas suficientes del proveedor autorizado.';
  if(fundamental?.status!=='available')return 'NO OPERAR: no hay contexto fundamental y calendario verificables suficientes.';
  return 'NO OPERAR: las condiciones no están alineadas.';
}

/**
 * Orquestador determinista de datos estructurados. No usa TradingView como
 * fuente de datos, no opera cuentas ni convierte un resultado bloqueado en una
 * recomendación de compra o venta.
 */
export class ForexProfessionalAI {
  constructor({marketDataService,technicalAnalysisEngine=new TechnicalAnalysisEngine(),signalEngine=new SignalEngine(),riskManagementEngine=new RiskManagementEngine(),fundamentalAnalysisService=null,sentimentAnalysisService=null,signalAuditService=null,now=()=>new Date()}={}){
    this.market=marketDataService;this.technical=technicalAnalysisEngine;this.signalEngine=signalEngine;this.riskEngine=riskManagementEngine;this.fundamental=fundamentalAnalysisService;this.sentiment=sentimentAnalysisService;this.audit=signalAuditService;this.now=now;this.lastAuditFingerprint=new Map();
  }
  candlesFor(symbol){return Object.fromEntries(TIMEFRAMES.map(timeframe=>[timeframe,this.market?.getCandles(symbol,timeframe,250)||[]]));}
  async analyze({symbol,quote,candlesByTimeframe,now=this.now(),activePositions=[],account={}}={}){
    const timestamp=new Date(now).toISOString();
    if(!symbol)return this.unavailable({timestamp,reason:'Símbolo no especificado.'});
    const marketState=this.market?.getState?.()||{};
    const currentQuote=quote??marketState.quotes?.[symbol]??{};
    const candles=candlesByTimeframe||this.candlesFor(symbol);
    const technical=this.technical.analyze({symbol,quote:currentQuote,candlesByTimeframe:candles,now});
    let fundamental={status:'unavailable',bias:'NEUTRAL',reasons:[],verifiedNews:[],events:[],highImpactWindow:{blocked:false},risks:['Servicios fundamentales no configurados.'],dataAvailability:{calendar:'unavailable'}};
    let sentiment={status:'unavailable',bias:'NEUTRAL',reasons:[],evidence:[]};
    const preliminaryDataStatus=deriveDataStatus(currentQuote,new Date(now).getTime(),5000);
    if(preliminaryDataStatus==='live'){
    try{if(this.fundamental)fundamental=await this.fundamental.analyze({symbol,now});if(this.sentiment)sentiment=await this.sentiment.analyze({symbol,news:{status:fundamental?.dataAvailability?.news||'unavailable',news:fundamental?.verifiedNews||[]}});}catch(error){fundamental={...fundamental,status:'error',risks:[`No se pudo analizar el contexto fundamental: ${error.message}`]};}
    }
    const calendar=highImpactCalendar(fundamental);
    const signal=this.signalEngine.generate({symbol,quote:currentQuote,technical,fundamental,calendar,highImpactWindow:fundamental.highImpactWindow,now});
    const risk=this.riskEngine.evaluate({symbol,quote:currentQuote,technical,signal,calendar,highImpactWindow:fundamental.highImpactWindow,fundamental,activePositions,account,now});
    const blockedActionable=['BUY','SELL'].includes(signal.decision)&&!risk.allowed;
    const decision=blockedActionable?'NO_TRADE':signal.decision;
    const dataStatus=deriveDataStatus(currentQuote,new Date(now).getTime(),5000);
    const hardBlock=fundamental?.highImpactWindow?.blocked||dataStatus!=='live';
    const finalDecision=hardBlock?'NO_TRADE':decision;
    const risks=[...emptyArray(signal.risks),...emptyArray(fundamental.risks),...emptyArray(risk.blocks).map(block=>block.message)];
    const technicalReasons=emptyArray(signal.technicalReasons).length?signal.technicalReasons:emptyArray(technical.dataQuality?.reasons);
    const fundamentalReasons=emptyArray(fundamental.reasons).map(item=>typeof item==='string'?item:`${item.title||'Contexto verificado'} · ${item.source||'Fuente'}`);
    const analysis={
      symbol,timestamp,dataStatus,decision:finalDecision,confidence:finalDecision==='NO_TRADE'&&blockedActionable?0:signal.confidence||0,
      entryZone:signal.entryZone||{minimum:null,maximum:null,trigger:'Sin entrada válida.'},stopLoss:signal.stopLoss??null,takeProfit1:signal.takeProfit1??null,takeProfit2:signal.takeProfit2??null,riskReward:signal.riskReward??null,expiryMinutes:signal.expiryMinutes||0,
      technicalBias:technical.technicalBias||'NEUTRAL',fundamentalBias:fundamental.bias||'NEUTRAL',marketStructure:technical.marketStructure||'Sin estructura verificable.',
      technicalReasons,fundamentalReasons,risks:[...new Set(risks.filter(Boolean))],invalidation:emptyArray(signal.invalidation),requiredConfirmation:finalDecision==='NO_TRADE'&&risk.blocks?.length?risk.blocks.map(block=>block.message):emptyArray(signal.requiredConfirmation),
      evidence:[...marketEvidence(currentQuote),...technicalEvidence(technical),...verifiedNewsEvidence(fundamental),...calendarEvidence(fundamental),...emptyArray(sentiment.evidence)],
      humanSummary:'',trends:trends(technical),news:emptyArray(fundamental.verifiedNews),events:emptyArray(fundamental.events),source:currentQuote?.source||null,lastTickAt:currentQuote?.timestamp||null,technical,fundamental,sentiment,risk,score:signal.score||{total:0,points:{},checks:{}}
    };
    analysis.highImpactEvent=Boolean(fundamental?.highImpactWindow?.blocked);
    analysis.riskBlocked=risk.status==='BLOCKED';
    analysis.humanSummary=summarize({decision:analysis.decision,symbol,technical,fundamental,risk});
    await this.auditIfNeeded(analysis);
    return analysis;
  }
  unavailable({timestamp=new Date().toISOString(),reason='No hay datos reales disponibles.'}={}){return {symbol:null,timestamp,dataStatus:'unavailable',decision:'NO_TRADE',confidence:0,entryZone:{minimum:null,maximum:null,trigger:reason},stopLoss:null,takeProfit1:null,takeProfit2:null,riskReward:null,expiryMinutes:0,technicalBias:'NEUTRAL',fundamentalBias:'NEUTRAL',marketStructure:'Sin datos.',technicalReasons:[],fundamentalReasons:[],risks:[reason],invalidation:[],requiredConfirmation:[reason],evidence:[],humanSummary:`NO OPERAR: ${reason}`,trends:{H4:'NEUTRAL',H1:'NEUTRAL',M15:'NEUTRAL',M5:'NEUTRAL'},news:[],events:[]};}
  async auditIfNeeded(analysis){
    if(!this.audit)return;
    const fingerprint=JSON.stringify([analysis.decision,analysis.confidence,analysis.timestamp.slice(0,16),analysis.dataStatus]);
    if(this.lastAuditFingerprint.get(analysis.symbol)===fingerprint)return;
    this.lastAuditFingerprint.set(analysis.symbol,fingerprint);
    try{await this.audit.record(analysis,{technical:analysis.technical,fundamental:analysis.fundamental,risk:analysis.risk});}catch(error){console.error('[signal audit]',error.message);}
  }
}

export class ForexAIOrchestrator extends ForexProfessionalAI {}
