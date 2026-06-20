<?php

return [
    'api_key_header' => env('ADMIN_API_KEY_HEADER', 'X-ADMIN-API-KEY'),
    'token_ttl_days' => (int) env('ADMIN_TOKEN_TTL_DAYS', 30),
];
