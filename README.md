# Forex Signal Pro

Dashboard informativo para EUR/USD, GBP/USD, USD/JPY y XAU/USD. El navegador recibe únicamente datos normalizados por este backend; ninguna clave llega al cliente y la aplicación no ejecuta operaciones.

## Configuración

1. Instala Node.js LTS o usa la instalación portable incluida en `.runtime`.
2. Copia `.env.example` a `.env`.
3. Configura un proveedor de datos autorizado en el servidor:

```env
MARKET_DATA_PROVIDER=mi_proveedor
MARKET_DATA_API_KEY=...
MARKET_DATA_API_SECRET=...
MARKET_DATA_WEBSOCKET_URL=wss://...
MARKET_DATA_HISTORICAL_URL=https://...
FOREX_EURUSD_SYMBOL=...
FOREX_GBPUSD_SYMBOL=...
FOREX_USDJPY_SYMBOL=...
FOREX_XAUUSD_SYMBOL=...
```

`server/services/live-market-data-provider.js` contiene los puntos de adaptación `createSubscribeMessage`, `extractTick` y `extractHistoricalCandles`. Ajústalos a la documentación pública del proveedor elegido. El histórico debe llegar marcado como velas cerradas; el motor no usa velas en formación para indicadores ni confirmaciones. No se utiliza scraping ni una fuente de datos simulada tras un fallo.

Para desarrollo explícito, y sólo entonces:

```env
MARKET_DATA_PROVIDER=demo
ALLOW_DEMO_PROVIDER=true
```

El modo demo no se activa automáticamente si el proveedor real falla. En ese caso, la interfaz conserva el último precio verificado y muestra Reconectando, Datos retrasados o Sin conexión.

## Ejecutar

```powershell
npm install
npm start
```

Abre `http://localhost:8080`. El backend sirve `/client`, expone el estado por `/api/market` y entrega los datos al navegador por `ws://localhost:8080/ws/market`.

## Análisis informativo y seguridad

`ForexProfessionalAI` es un motor explicable y modular. Procesa exclusivamente velas OHLC cerradas de H4, H1, M15 y M5, con EMA 20/50/200, RSI, ATR, Bandas de Bollinger, estructura, soportes/resistencias y zonas de oferta/demanda. Las señales se recalculan al cierre de M5; nunca a partir de una vela en formación.

Antes de cualquier escenario de compra o venta, el motor exige datos reales recientes (menos de cinco segundos), histórico suficiente, alineación H4/H1, spread aceptable, relación riesgo/beneficio mínima 1:2 y calendario económico verificable. También bloquea el análisis ante datos retrasados, alto impacto entre 30 minutos antes/después de un evento, volatilidad anormal, macro contradictoria, exposición USD correlacionada o límite de pérdida diaria.

Configura fuentes autorizadas de noticias y calendario antes de permitir señales accionables:

```env
NEWS_API_URL=https://...
NEWS_API_KEY=...
NEWS_SOURCE=nombre-verificable
ECONOMIC_CALENDAR_API_URL=https://...
ECONOMIC_CALENDAR_API_KEY=...
ECONOMIC_CALENDAR_SOURCE=nombre-verificable
ECONOMIC_CALENDAR_SOURCE_URL=https://...
MAX_DAILY_DRAWDOWN_PERCENT=2
```

Las claves permanecen en el servidor. La interfaz recibe un resultado estructurado por WebSocket y muestra sus razones, riesgos, evidencia y fuentes verificables. Las consultas de respaldo son `GET /api/market/analysis/:symbol` y `GET /api/market/audit`.

El gráfico canvas, las velas OHLC y el análisis interno consumen el mismo buffer del WebSocket de Deriv. Configura `DERIV_APP_ID` en `.env` antes de iniciar el servidor. Forex es un mercado OTC: precios de fuentes o brókeres distintos pueden diferir. Las señales son informativas, no constituyen asesoría financiera y deben verificarse manualmente antes de operar.
