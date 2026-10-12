import 'dotenv/config';

const symbolMap={
  'EUR/USD':process.env.FOREX_EURUSD_SYMBOL||'frxEURUSD',
  'GBP/USD':process.env.FOREX_GBPUSD_SYMBOL||'frxGBPUSD',
  'USD/JPY':process.env.FOREX_USDJPY_SYMBOL||'frxUSDJPY',
  'XAU/USD':process.env.FOREX_XAUUSD_SYMBOL||'frxXAUUSD'
};

const tradingViewSymbols={
  'EUR/USD':process.env.TV_EURUSD_SYMBOL||'FX:EURUSD',
  'GBP/USD':process.env.TV_GBPUSD_SYMBOL||'FX:GBPUSD',
  'USD/JPY':process.env.TV_USDJPY_SYMBOL||'FX:USDJPY',
  'XAU/USD':process.env.TV_XAUUSD_SYMBOL||'TVC:GOLD'
};

export const config=Object.freeze({
  port:Number(process.env.PORT||8080),
  provider:String(process.env.MARKET_DATA_PROVIDER||'deriv-public').toLowerCase(),
  derivAppId:process.env.DERIV_APP_ID||'',
  derivWebsocketUrl:process.env.DERIV_WEBSOCKET_URL||'wss://ws.derivws.com/websockets/v3',
  allowDemo:process.env.ALLOW_DEMO_PROVIDER==='true',
  apiKey:process.env.MARKET_DATA_API_KEY||'',
  apiSecret:process.env.MARKET_DATA_API_SECRET||'',
  websocketUrl:process.env.MARKET_DATA_WEBSOCKET_URL||'',
  historicalUrl:process.env.MARKET_DATA_HISTORICAL_URL||'',
  newsApiKey:process.env.NEWS_API_KEY||'',
  newsApiUrl:process.env.NEWS_API_URL||'',
  newsSource:process.env.NEWS_SOURCE||'',
  calendarApiKey:process.env.ECONOMIC_CALENDAR_API_KEY||'',
  calendarApiUrl:process.env.ECONOMIC_CALENDAR_API_URL||'',
  calendarSource:process.env.ECONOMIC_CALENDAR_SOURCE||'',
  calendarSourceUrl:process.env.ECONOMIC_CALENDAR_SOURCE_URL||'',
  aiProviderApiKey:process.env.AI_PROVIDER_API_KEY||'',
  aiModelName:process.env.AI_MODEL_NAME||'',
  maxSpreadBySymbol:{'EUR/USD':Number(process.env.MAX_SPREAD_EURUSD||0.0003),'GBP/USD':Number(process.env.MAX_SPREAD_GBPUSD||0.0004),'USD/JPY':Number(process.env.MAX_SPREAD_USDJPY||0.04),'XAU/USD':Number(process.env.MAX_SPREAD_XAUUSD||1.5)},
  maxSpreadBpsBySymbol:{'EUR/USD':Number(process.env.MAX_SPREAD_BPS_EURUSD||3.5),'GBP/USD':Number(process.env.MAX_SPREAD_BPS_GBPUSD||4.5),'USD/JPY':Number(process.env.MAX_SPREAD_BPS_USDJPY||3.5),'XAU/USD':Number(process.env.MAX_SPREAD_BPS_XAUUSD||18)},
  maxDailyLoss:Number(process.env.MAX_DAILY_LOSS||0),
  maxDailyDrawdownPercent:Number(process.env.MAX_DAILY_DRAWDOWN_PERCENT||process.env.MAX_DAILY_LOSS||0)||null,
  symbolMap,
  tradingViewSymbols,
  publicSymbols:Object.keys(symbolMap)
});
