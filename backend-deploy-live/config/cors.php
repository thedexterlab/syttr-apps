<?php

$allowedOrigins = array_values(array_filter(array_map(
    static fn (string $origin) => trim($origin),
    explode(',', (string) env('CORS_ALLOWED_ORIGINS', '*'))
)));

$allowedOriginPatterns = array_values(array_filter(array_map(
    static fn (string $pattern) => trim($pattern),
    explode(',', (string) env('CORS_ALLOWED_ORIGIN_PATTERNS', ''))
)));

return [
    'paths' => [
        'api/*',
        'broadcasting/auth',
        'sanctum/csrf-cookie',
    ],

    'allowed_methods' => ['*'],

    'allowed_origins' => $allowedOrigins !== [] ? $allowedOrigins : ['*'],

    'allowed_origins_patterns' => $allowedOriginPatterns,

    'allowed_headers' => ['*'],

    'exposed_headers' => [],

    'max_age' => (int) env('CORS_MAX_AGE', 0),

    'supports_credentials' => (bool) env('CORS_SUPPORTS_CREDENTIALS', false),
];
