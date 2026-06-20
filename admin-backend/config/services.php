<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'token' => env('POSTMARK_TOKEN'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'app_data' => [
        'base_url' => rtrim((string) env('APP_DATA_BASE_URL', 'http://127.0.0.1:8000'), '/'),
        'asset_base_url' => rtrim((string) env('APP_DATA_ASSET_BASE_URL', env('APP_DATA_BASE_URL', 'http://127.0.0.1:8000')), '/'),
    ],

    'taz' => [
        'base_url' => env('ADMIN_TAZ_BASE_URL'),
        'jwt' => env('ADMIN_TAZ_JWT'),
        'status_path' => env('ADMIN_TAZ_STATUS_PATH', '/v1/orders/{order_guid}'),
        'pdf_path' => env('ADMIN_TAZ_PDF_PATH', '/v1/orders/{order_guid}/pdf'),
        'verify_ssl' => env('ADMIN_TAZ_VERIFY_SSL', false),
    ],

];
