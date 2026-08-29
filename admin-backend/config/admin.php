<?php

return [
    'api_key_header' => env('ADMIN_API_KEY_HEADER', 'X-ADMIN-API-KEY'),
    'token_ttl_days' => (int) env('ADMIN_TOKEN_TTL_DAYS', 30),
    'remote_base_url' => rtrim((string) env('ADMIN_REMOTE_BASE_URL', 'http://52.1.80.31'), '/'),
    'remote_api_key' => env('ADMIN_REMOTE_API_KEY', env('ADMIN_FRONTEND_API_KEY')),
    'remote_email' => env('ADMIN_REMOTE_EMAIL', env('ADMIN_DEFAULT_EMAIL', 'carla@syttr.com')),
    'remote_password' => env('ADMIN_REMOTE_PASSWORD', env('ADMIN_DEFAULT_PASSWORD', 'Dex123')),
];
