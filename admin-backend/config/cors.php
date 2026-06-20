<?php

$configuredOrigins = array_values(array_filter(array_map(
    'trim',
    explode(',', (string) env('ADMIN_FRONTEND_ORIGINS', env('ADMIN_FRONTEND_URL', '')))
)));

$localOrigins = [
    'https://admin-syttr.zyronexlab.com',
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://[::1]:5173',
];

$allowedOrigins = array_values(array_unique(array_merge(
    $localOrigins,
    $configuredOrigins
)));

$allowedOriginPatterns = [
    '#^https?://(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$#',
    '#^https?://(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?::\d+)?$#',
];

return [
    'paths' => ['api/*', 'sanctum/csrf-cookie'],
    'allowed_methods' => ['*'],
    'allowed_origins' => $allowedOrigins,
    'allowed_origins_patterns' => $allowedOriginPatterns,
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
