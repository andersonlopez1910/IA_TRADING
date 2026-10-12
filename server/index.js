import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import cors from 'cors';
import {config} from './config.js';
import {DemoMarketDataProvider} from './services/demo-market-data-provider.js';
import {LiveMarketDataProvider} from './services/live-market-data-provider.js';
import {DerivPublicMarketDataProvider} from './services/deriv-public-market-data-provider.js';
import {MarketDataService} from './services/market-data-service.js';
import {EconomicCalendarService} from './services/economic-calendar-service.js';
import {FinancialNewsService} from './services/financial-news-service.js';
import {FundamentalAnalysisService} from './services/fundamental-analysis-service.js';
import {SentimentAnalysisService} from './services/sentiment-analysis-service.js';
import {SignalAuditService} from './services/signal-audit-service.js';
import {SignalEngine} from './services/signal-engine.js';
import {RiskManagementEngine} from './services/risk-management-engine.js';
import {ForexProfessionalAI} from './services/forex-professional-ai.js';
import {AnalysisCoordinator} from './services/analysis-coordinator.js';
import {createMarketRouter} from './routes/market-routes.js';
import {attachWebSocketServer} from './websocket-server.js';

const provider=config.provider==='demo'&&config.allowDemo
  ?new DemoMarketDataProvider()
  :config.provider==='deriv-public'
    ?new DerivPublicMarketDataProvider({websocketUrl:config.derivWebsocketUrl,appId:config.derivAppId,symbolMap:config.symbolMap})
    :new LiveMarketDataProvider({websocketUrl:config.websocketUrl,historicalUrl:config.historicalUrl,apiKey:config.apiKey,apiSecret:config.apiSecret,symbolMap:config.symbolMap,providerName:config.provider.toUpperCase()});
const market=new MarketDataService({provider,symbols:config.publicSymbols});
const calendarService=new EconomicCalendarService({apiKey:config.calendarApiKey,apiUrl:config.calendarApiUrl,source:config.calendarSource,sourceUrl:config.calendarSourceUrl});
const newsService=new FinancialNewsService({apiKey:config.newsApiKey,apiUrl:config.newsApiUrl,source:config.newsSource});
const fundamentalAnalysisService=new FundamentalAnalysisService({newsService,calendarService});
const sentimentAnalysisService=new SentimentAnalysisService({newsService});
const signalAuditService=new SignalAuditService();
const forexProfessionalAI=new ForexProfessionalAI({
  marketDataService:market,
  signalEngine:new SignalEngine({maxSpreadBpsBySymbol:config.maxSpreadBpsBySymbol}),
  riskManagementEngine:new RiskManagementEngine({maxSpreadBpsBySymbol:config.maxSpreadBpsBySymbol,maxDailyDrawdownPercent:config.maxDailyDrawdownPercent}),
  fundamentalAnalysisService,
  sentimentAnalysisService,
  signalAuditService
});
const analysisCoordinator=new AnalysisCoordinator({
  market,
  analysisEngine:forexProfessionalAI,
  symbols:config.publicSymbols,
  accountProvider:()=>({maxDailyDrawdownPercent:config.maxDailyDrawdownPercent}),
  // No broker account is connected here. This remains an analysis-only app.
  activePositionsProvider:()=>[],
  onAnalysis:analysis=>market.broadcast({type:'analysis',analysis})
});
const app=express();
app.disable('x-powered-by');app.use(cors());app.use('/api/market',createMarketRouter({market,config,analysisCoordinator,signalAuditService}));
const directory=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../client');app.use(express.static(directory));app.get('*',(request,response)=>response.sendFile(path.join(directory,'index.html')));
const server=http.createServer(app);attachWebSocketServer(server,market,{getAnalyses:()=>analysisCoordinator.getAll()});
server.listen(config.port,async()=>{console.log(`Forex Signal Pro: http://localhost:${config.port}`);await signalAuditService.initialize();analysisCoordinator.start();await market.start();await analysisCoordinator.prime();});
process.on('SIGINT',async()=>{analysisCoordinator.stop();await provider.disconnect();server.close(()=>process.exit(0));});
