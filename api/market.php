<?php
/** Proxy local: la clave se lee solo desde TWELVE_DATA_API_KEY en el servidor. */
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');

$apiKey = getenv('TWELVE_DATA_API_KEY');
if (!$apiKey) { http_response_code(503); echo json_encode(['error' => 'Falta configurar TWELVE_DATA_API_KEY en el servidor local.']); exit; }
$allowedSymbols = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU/USD'];
$allowedIntervals = ['5min', '15min', '1h', '4h'];
$mode = $_GET['mode'] ?? 'quotes';
$symbols = array_values(array_filter(explode(',', $_GET['symbols'] ?? 'EUR/USD'), fn($symbol) => in_array($symbol, $allowedSymbols, true)));
$interval = $_GET['interval'] ?? '15min';
if (!$symbols || !in_array($interval, $allowedIntervals, true) || !in_array($mode, ['quotes', 'series'], true)) { http_response_code(400); echo json_encode(['error' => 'Parámetros no permitidos.']); exit; }

function getProviderData(string $path, array $params, string $apiKey): array {
    $url = 'https://api.twelvedata.com/' . $path . '?' . http_build_query([...$params, 'apikey' => $apiKey]);
    $context = stream_context_create(['http' => ['timeout' => 12, 'ignore_errors' => true]]);
    $result = @file_get_contents($url, false, $context);
    if ($result === false) throw new RuntimeException('No se pudo contactar al proveedor de mercado.');
    $data = json_decode($result, true);
    if (!is_array($data)) throw new RuntimeException('Respuesta inválida del proveedor de mercado.');
    if (isset($data['code']) || (($data['status'] ?? '') === 'error')) throw new RuntimeException($data['message'] ?? 'El proveedor rechazó la solicitud.');
    return $data;
}

try {
    if ($mode === 'quotes') {
        $quotes = [];
        foreach ($symbols as $symbol) {
            $quote = getProviderData('quote', ['symbol' => $symbol, 'interval' => '1min'], $apiKey);
            $quotes[$symbol] = ['price' => (float)($quote['close'] ?? $quote['price'] ?? 0), 'change' => (float)($quote['percent_change'] ?? 0), 'isMarketOpen' => (bool)($quote['is_market_open'] ?? true), 'updatedAt' => $quote['datetime'] ?? gmdate('c')];
        }
        echo json_encode(['source' => 'Twelve Data', 'quotes' => $quotes, 'fetchedAt' => gmdate('c')]);
        exit;
    }
    $series = getProviderData('time_series', ['symbol' => $symbols[0], 'interval' => $interval, 'outputsize' => 100, 'timezone' => 'UTC'], $apiKey);
    $values = array_reverse($series['values'] ?? []);
    $candles = array_map(fn($item) => ['open' => (float)$item['open'], 'high' => (float)$item['high'], 'low' => (float)$item['low'], 'close' => (float)$item['close'], 'datetime' => $item['datetime']], $values);
    echo json_encode(['source' => 'Twelve Data', 'symbol' => $symbols[0], 'interval' => $interval, 'candles' => $candles, 'fetchedAt' => gmdate('c')]);
} catch (RuntimeException $error) { http_response_code(502); echo json_encode(['error' => $error->getMessage()]); }
