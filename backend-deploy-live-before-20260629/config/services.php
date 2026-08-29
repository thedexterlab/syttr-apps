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

    'pusher' => [
        'app_id' => env('PUSHER_APP_ID'),
        'key' => env('PUSHER_APP_KEY'),
        'secret' => env('PUSHER_APP_SECRET'),
        'cluster' => env('PUSHER_APP_CLUSTER'),
        'host' => env('PUSHER_HOST', 'api-'.env('PUSHER_APP_CLUSTER').'.pusher.com'),
        'port' => env('PUSHER_PORT', 443),
        'scheme' => env('PUSHER_SCHEME', 'https'),
        'encrypted' => true,
        'useTLS' => env('PUSHER_SCHEME', 'https') === 'https',
    ],

    'stripe' => [
        'publishable_key' => env('STRIPE_PUBLISHABLE_KEY'),
        'secret' => env('STRIPE_SECRET'),
        'verify_ssl' => env('STRIPE_VERIFY_SSL', true),
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),
        'platform_country' => env('STRIPE_PLATFORM_COUNTRY', 'US'),
        'verification_product_id' => env('STRIPE_VERIFICATION_PRODUCT_ID'),
        'verification_price_id' => env('STRIPE_VERIFICATION_PRICE_ID'),
        'bg_verification_product_id' => env('STRIPE_BG_VERIFICATION_PRODUCT_ID'),
        'bg_verification_price_id' => env('STRIPE_BG_VERIFICATION_PRICE_ID'),
        'bg_verification_with_driving_product_id' => env('STRIPE_BG_VERIFICATION_WITH_DRIVING_PRODUCT_ID'),
        'bg_verification_with_driving_price_id' => env('STRIPE_BG_VERIFICATION_WITH_DRIVING_PRICE_ID'),
        'family_subscription_product_id' => env('STRIPE_FAMILY_SUBSCRIPTION_PRODUCT_ID'),
        'family_subscription_price_id' => env('STRIPE_FAMILY_SUBSCRIPTION_PRICE_ID'),
        'destination_id' => env('STRIPE_DESTINATION_ID'),
        'connect_account_id' => env('STRIPE_CONNECT_ACCOUNT_ID', env('STRIPE_DESTINATION_ID')),
        'connect_country' => env('STRIPE_CONNECT_COUNTRY', 'US'),
        'connect_preview_version' => env('STRIPE_CONNECT_PREVIEW_VERSION', '2025-08-27.preview'),
    ],

    'ghl' => [
        'base_url' => env('GHL_BASE_URL', 'https://services.leadconnectorhq.com'),
        'api_token' => env('GHL_API_TOKEN'),
        'location_id' => env('GHL_LOCATION_ID'),
        'api_version' => env('GHL_API_VERSION', '2021-07-28'),
        'verify_ssl' => env('GHL_VERIFY_SSL', true),
    ],

    'taz' => [
        'environment' => env('TAZ_ENV', 'live'),
        'base_url' => env(
            'TAZ_BASE_URL',
            env('TAZ_ENV', 'live') === 'sandbox'
                ? env('TAZ_SANDBOX_BASE_URL', 'https://api-sandbox.instascreen.net')
                : env('TAZ_LIVE_BASE_URL', 'https://api.instascreen.net')
        ),
        'jwt' => env(
            'TAZ_JWT',
            env(
                'TAZ_ENV', 'live'
            ) === 'sandbox'
                ? env('TAZ_SANDBOX_JWT', env('TAZ_SANDBOX_API_TOKEN'))
                : env('TAZ_LIVE_JWT', env('TAZ_LIVE_API_TOKEN', env('TAZ_API_TOKEN')))
        ),
        'webhook_secret' => env(
            'TAZ_WEBHOOK_SECRET',
            env('TAZ_ENV', 'live') === 'sandbox'
                ? env('TAZ_SANDBOX_WEBHOOK_SECRET', env('TAZ_SANDBOX_JWT', env('TAZ_SANDBOX_API_TOKEN')))
                : env('TAZ_LIVE_WEBHOOK_SECRET', env('TAZ_LIVE_JWT', env('TAZ_LIVE_API_TOKEN', env('TAZ_API_TOKEN'))))
        ),
        'client_guid' => env(
            'TAZ_CLIENT_GUID',
            env('TAZ_ENV', 'live') === 'sandbox'
                ? env('TAZ_SANDBOX_CLIENT_GUID')
                : env('TAZ_LIVE_CLIENT_GUID')
        ),
        'product_guid' => env(
            'TAZ_PRODUCT_GUID',
            env('TAZ_ENV', 'live') === 'sandbox'
                ? env('TAZ_SANDBOX_PRODUCT_GUID')
                : env('TAZ_LIVE_PRODUCT_GUID')
        ),
        'product_guid_employment' => env(
            'TAZ_PRODUCT_GUID_EMPLOYMENT',
            env('TAZ_ENV', 'live') === 'sandbox'
                ? env('TAZ_SANDBOX_PRODUCT_GUID_EMPLOYMENT', env('TAZ_SANDBOX_PRODUCT_GUID'))
                : env('TAZ_LIVE_PRODUCT_GUID_EMPLOYMENT', env('TAZ_LIVE_PRODUCT_GUID'))
        ),
        'product_guid_mvr' => env(
            'TAZ_PRODUCT_GUID_MVR',
            env('TAZ_ENV', 'live') === 'sandbox'
                ? env('TAZ_SANDBOX_PRODUCT_GUID_MVR', env('TAZ_SANDBOX_MVR_PRODUCT_GUID'))
                : env('TAZ_LIVE_PRODUCT_GUID_MVR', env('TAZ_LIVE_MVR_PRODUCT_GUID'))
        ),
        'product_guid_mvr_employment' => env(
            'TAZ_PRODUCT_GUID_MVR_EMPLOYMENT',
            env('TAZ_ENV', 'live') === 'sandbox'
                ? env('TAZ_SANDBOX_PRODUCT_GUID_MVR_EMPLOYMENT', env('TAZ_SANDBOX_PRODUCT_GUID_MVR', env('TAZ_SANDBOX_MVR_PRODUCT_GUID')))
                : env('TAZ_LIVE_PRODUCT_GUID_MVR_EMPLOYMENT', env('TAZ_LIVE_PRODUCT_GUID_MVR', env('TAZ_LIVE_MVR_PRODUCT_GUID')))
        ),
        'products_path' => env('TAZ_PRODUCTS_PATH', '/v1/clients/{client_guid}/products'),
        'create_order_path' => env('TAZ_CREATE_ORDER_PATH', '/v1/clients/{client_guid}/orders'),
        'status_path' => env('TAZ_STATUS_PATH', '/v1/orders/{order_guid}'),
        'regenerate_link_path' => env('TAZ_REGENERATE_LINK_PATH', '/v1/orders/{order_guid}/regenerate-link'),
        'verify_ssl' => env('TAZ_VERIFY_SSL', false),
    ],

    'google_maps' => [
        'key' => env('GOOGLE_MAPS_API_KEY', env('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY')),
    ],

    'wallet' => [
        'currency' => env('WALLET_CURRENCY', 'usd'),
        'withdrawal_commission_type' => env('WALLET_WITHDRAWAL_COMMISSION_TYPE', 'percentage'),
        'withdrawal_commission_value' => env('WALLET_WITHDRAWAL_COMMISSION_VALUE', 5),
    ],

    'expo' => [
        'access_token' => env('EXPO_ACCESS_TOKEN'),
    ],

];
