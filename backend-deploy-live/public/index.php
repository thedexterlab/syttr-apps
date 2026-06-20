<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$requestUri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
$requestPath = (string) (parse_url($requestUri, PHP_URL_PATH) ?? '/');
$origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
$isApiRequest = str_starts_with($requestPath, '/api/');

if ($isApiRequest && $origin !== '') {
    header('Vary: Origin', false);
    header('Access-Control-Allow-Origin: '.$origin);
    header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Origin, Content-Type, Accept, Authorization, X-Requested-With, X-API-KEY, x-api-key, nanny-id, nanny_id');
    header('Access-Control-Max-Age: 86400');

    if (strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')) === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Bootstrap Laravel and handle the request...
(require_once __DIR__.'/../bootstrap/app.php')
    ->handleRequest(Request::capture());
