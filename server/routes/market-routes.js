import {Router} from 'express';

export function createMarketRouter({market,config,analysisCoordinator,signalAuditService}){
  const router=Router();
  router.get('/candles',(request,response)=>{
    const symbol=String(request.query.symbol||'');
    if(!config.publicSymbols.includes(symbol))return response.status(404).json({error:'Invalid symbol'});
    const interval=request.query.interval||'M15';
    response.json({symbol,interval,candles:market.getCandles(symbol,interval,Number(request.query.limit)||200)});
  });
  router.get('/state',(request,response)=>response.json({...market.getState(),symbols:config.publicSymbols,tradingViewSymbols:config.tradingViewSymbols}));
  router.get('/candles/:symbol',(request,response)=>{
    const symbol=decodeURIComponent(request.params.symbol);if(!config.publicSymbols.includes(symbol))return response.status(404).json({error:'Símbolo no permitido'});
    response.json({symbol,interval:request.query.interval||'M15',candles:market.getCandles(symbol,request.query.interval,Number(request.query.limit)||200)});
  });
  router.get('/config',(request,response)=>response.json({symbols:config.publicSymbols,tradingViewSymbols:config.tradingViewSymbols}));
  router.get('/analysis/:symbol',(request,response)=>{
    const symbol=decodeURIComponent(request.params.symbol);if(!config.publicSymbols.includes(symbol))return response.status(404).json({error:'SÃ­mbolo no permitido'});
    const analysis=analysisCoordinator?.get(symbol);
    if(!analysis)return response.status(202).json({symbol,status:'pending',decision:'NO_TRADE',message:'El motor espera datos reales y velas cerradas verificables.'});
    response.json(analysis);
  });
  router.get('/audit',(request,response)=>{
    const symbol=request.query.symbol?String(request.query.symbol):undefined;if(symbol&&!config.publicSymbols.includes(symbol))return response.status(404).json({error:'SÃ­mbolo no permitido'});
    Promise.resolve(signalAuditService?.list({symbol,limit:Number(request.query.limit)||100})||[])
      .then(entries=>response.json({entries}))
      .catch(error=>response.status(500).json({error:'No se pudo leer la auditorÃ­a.',detail:error instanceof Error?error.message:'error desconocido'}));
  });
  return router;
}
