<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class StripeCustomerManager
{
    public static function ensureCustomerForUser(User $user): array
    {
        $stripeSecret = trim((string) config('services.stripe.secret', ''));
        if ($stripeSecret === '') {
            return [
                'success' => false,
                'status' => 500,
                'message' => 'Stripe secret key is not configured.',
            ];
        }

        $existingCustomerId = trim((string) ($user->stripe_customer_id ?? ''));
        if ($existingCustomerId !== '' && str_starts_with($existingCustomerId, 'cus_')) {
            return [
                'success' => true,
                'status' => 200,
                'customer_id' => $existingCustomerId,
                'created' => false,
            ];
        }

        $response = self::request('post', 'https://api.stripe.com/v1/customers', [
            'email' => (string) $user->email,
            'name' => (string) ($user->name ?? ''),
            'metadata[user_id]' => (string) $user->user_id,
        ]);
        $payload = $response['payload'];
        if (! $response['ok']) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractStripeMessage($payload, 'Unable to create Stripe customer.'),
                'stripe_payload' => $payload,
            ];
        }

        $customerId = trim((string) ($payload['id'] ?? ''));
        if ($customerId === '' || ! str_starts_with($customerId, 'cus_')) {
            return [
                'success' => false,
                'status' => 500,
                'message' => 'Unable to create Stripe customer.',
                'stripe_payload' => $payload,
            ];
        }

        $user->stripe_customer_id = $customerId;
        $user->save();

        return [
            'success' => true,
            'status' => 201,
            'customer_id' => $customerId,
            'created' => true,
        ];
    }

    public static function ensureReusablePaymentMethodForUser(
        User $user,
        string $stripePaymentMethodId,
        bool $makeDefault = true
    ): array {
        $paymentMethodId = trim($stripePaymentMethodId);
        if ($paymentMethodId === '' || ! str_starts_with($paymentMethodId, 'pm_')) {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Selected payment method is invalid. Please add the card again.',
            ];
        }

        $customerResult = self::ensureCustomerForUser($user);
        if (! ($customerResult['success'] ?? false)) {
            return $customerResult;
        }

        $customerId = (string) ($customerResult['customer_id'] ?? '');
        $fetchResult = self::request('get', 'https://api.stripe.com/v1/payment_methods/'.$paymentMethodId);
        $paymentMethodPayload = $fetchResult['payload'];
        if (! $fetchResult['ok']) {
            return [
                'success' => false,
                'status' => (int) ($fetchResult['status'] ?? 422),
                'message' => self::humanizeReusablePaymentMethodError(
                    self::extractStripeMessage($paymentMethodPayload, 'Selected payment method is invalid. Please add the card again.')
                ),
                'stripe_payload' => $paymentMethodPayload,
                'customer_id' => $customerId,
            ];
        }

        $attachedCustomerId = trim((string) ($paymentMethodPayload['customer'] ?? ''));
        if ($attachedCustomerId !== '' && $attachedCustomerId !== $customerId) {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'This saved card belongs to another Stripe customer. Please remove it and add the card again.',
                'stripe_payload' => $paymentMethodPayload,
                'customer_id' => $customerId,
            ];
        }

        if ($attachedCustomerId === '') {
            $attachResult = self::request(
                'post',
                'https://api.stripe.com/v1/payment_methods/'.$paymentMethodId.'/attach',
                ['customer' => $customerId]
            );
            $attachedPayload = $attachResult['payload'];
            if (! $attachResult['ok']) {
                return [
                    'success' => false,
                    'status' => (int) ($attachResult['status'] ?? 422),
                    'message' => self::humanizeReusablePaymentMethodError(
                        self::extractStripeMessage($attachedPayload, 'Unable to attach payment method to Stripe customer.')
                    ),
                    'stripe_payload' => $attachedPayload,
                    'customer_id' => $customerId,
                ];
            }
            $paymentMethodPayload = $attachedPayload;
        }

        if ($makeDefault) {
            $defaultResult = self::request(
                'post',
                'https://api.stripe.com/v1/customers/'.$customerId,
                ['invoice_settings[default_payment_method]' => $paymentMethodId]
            );
            if (! $defaultResult['ok']) {
                Log::warning('stripe.customer.default_payment_method_failed', [
                    'user_id' => $user->user_id,
                    'stripe_customer_id' => $customerId,
                    'stripe_payment_method_id' => $paymentMethodId,
                    'status' => $defaultResult['status'] ?? null,
                    'stripe_payload' => $defaultResult['payload'] ?? null,
                ]);
            }
        }

        return [
            'success' => true,
            'status' => 200,
            'customer_id' => $customerId,
            'payment_method' => $paymentMethodPayload,
        ];
    }

    public static function createSetupIntentForUser(
        User $user,
        array $metadata = [],
        ?string $description = null
    ): array {
        $customerResult = self::ensureCustomerForUser($user);
        if (! ($customerResult['success'] ?? false)) {
            return $customerResult;
        }

        $customerId = (string) ($customerResult['customer_id'] ?? '');
        $payload = [
            'customer' => $customerId,
            'usage' => 'off_session',
            'payment_method_types[0]' => 'card',
            'metadata[user_id]' => (string) $user->user_id,
        ];

        foreach ($metadata as $key => $value) {
            $normalizedKey = trim((string) $key);
            if ($normalizedKey === '' || $value === null || is_array($value) || is_object($value)) {
                continue;
            }

            $payload["metadata[{$normalizedKey}]"] = (string) $value;
        }

        $normalizedDescription = trim((string) $description);
        if ($normalizedDescription !== '') {
            $payload['description'] = $normalizedDescription;
        }

        $response = self::request('post', 'https://api.stripe.com/v1/setup_intents', $payload);
        $setupIntentPayload = $response['payload'];
        if (! $response['ok']) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractStripeMessage($setupIntentPayload, 'Unable to prepare payment method setup.'),
                'stripe_payload' => $setupIntentPayload,
                'customer_id' => $customerId,
            ];
        }

        $setupIntentId = trim((string) ($setupIntentPayload['id'] ?? ''));
        $clientSecret = trim((string) ($setupIntentPayload['client_secret'] ?? ''));
        if ($setupIntentId === '' || ! str_starts_with($setupIntentId, 'seti_') || $clientSecret === '') {
            return [
                'success' => false,
                'status' => 500,
                'message' => 'Unable to prepare payment method setup.',
                'stripe_payload' => $setupIntentPayload,
                'customer_id' => $customerId,
            ];
        }

        return [
            'success' => true,
            'status' => 200,
            'customer_id' => $customerId,
            'setup_intent_id' => $setupIntentId,
            'client_secret' => $clientSecret,
            'setup_intent' => $setupIntentPayload,
        ];
    }

    public static function humanizeReusablePaymentMethodError(string $message): string
    {
        $normalized = strtolower(trim($message));
        if ($normalized === '') {
            return 'Unable to use this saved card. Please remove it and add the card again.';
        }

        if (
            str_contains($normalized, 'previously used with a paymentintent without customer attachment') ||
            str_contains($normalized, 'shared with a connected account without customer attachment') ||
            str_contains($normalized, 'detached from a customer')
        ) {
            return 'This saved card cannot be reused. Please remove it and add the card again.';
        }

        return $message;
    }

    private static function request(string $method, string $url, array $payload = []): array
    {
        $stripeSecret = trim((string) config('services.stripe.secret', ''));
        $stripeVerifySsl = (bool) config('services.stripe.verify_ssl', true);

        try {
            $response = Http::withOptions([
                    'verify' => $stripeVerifySsl,
                ])
                ->withBasicAuth($stripeSecret, '')
                ->connectTimeout(5)
                ->timeout(20)
                ->asForm()
                ->send(strtoupper($method), $url, empty($payload) ? [] : ['form_params' => $payload]);

            return [
                'ok' => $response->successful(),
                'status' => $response->status(),
                'payload' => $response->json() ?: [],
            ];
        } catch (\Throwable $e) {
            Log::error('stripe.customer_manager.request_exception', [
                'method' => strtoupper($method),
                'url' => $url,
                'error' => $e->getMessage(),
            ]);

            return [
                'ok' => false,
                'status' => 500,
                'payload' => [
                    'error' => [
                        'message' => $e->getMessage(),
                    ],
                ],
            ];
        }
    }

    private static function extractStripeMessage(array $payload, string $fallback): string
    {
        return (string) ($payload['error']['message'] ?? $payload['message'] ?? $fallback);
    }
}
