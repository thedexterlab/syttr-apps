<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class StripeConnectManager
{
    public static function ensureConnectAccountForUser(User $user): array
    {
        $existingAccountId = trim((string) ($user->stripe_connect_account_id ?? ''));
        if ($existingAccountId !== '' && str_starts_with($existingAccountId, 'acct_')) {
            $accountResult = self::retrieveAccount($existingAccountId);
            if ($accountResult['success'] ?? false) {
                self::syncUserFromAccountPayload($user, (array) ($accountResult['account'] ?? []));
                self::ensureManualPayoutSchedule($existingAccountId);

                return [
                    ...$accountResult,
                    'account_id' => $existingAccountId,
                    'created' => false,
                ];
            }
        }

        $country = strtoupper(trim((string) config('services.stripe.connect_country', 'US'))) ?: 'US';
        $platformCountry = strtoupper(trim((string) config('services.stripe.platform_country', 'US'))) ?: 'US';
        $payload = [
            'type' => 'custom',
            'country' => $country,
            'business_type' => 'individual',
            'email' => (string) $user->email,
            'capabilities[transfers][requested]' => 'true',
            'metadata[user_id]' => (string) $user->user_id,
            'metadata[role]' => (string) ($user->role ?? ''),
        ];

        // Recipient service agreement is only valid for supported cross-border
        // transfer-only accounts. Domestic US-to-US accounts must use the default
        // agreement, otherwise Stripe rejects account creation.
        if ($platformCountry !== $country) {
            $payload['tos_acceptance[service_agreement]'] = 'recipient';
        } else {
            $payload['capabilities[card_payments][requested]'] = 'true';
        }

        $response = self::request('post', 'https://api.stripe.com/v1/accounts', $payload);
        $accountPayload = $response['payload'] ?? [];
        if (! ($response['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractStripeMessage($accountPayload, 'Unable to create Stripe Connect account.'),
                'stripe_payload' => $accountPayload,
            ];
        }

        $accountId = trim((string) ($accountPayload['id'] ?? ''));
        if ($accountId === '' || ! str_starts_with($accountId, 'acct_')) {
            return [
                'success' => false,
                'status' => 500,
                'message' => 'Unable to create Stripe Connect account.',
                'stripe_payload' => $accountPayload,
            ];
        }

        self::syncUserFromAccountPayload($user, $accountPayload);
        self::ensureManualPayoutSchedule($accountId);

        return [
            'success' => true,
            'status' => 201,
            'account_id' => $accountId,
            'account' => $accountPayload,
            'created' => true,
        ];
    }

    public static function createAccountLink(User $user, string $refreshUrl, string $returnUrl): array
    {
        $accountResult = self::ensureConnectAccountForUser($user);
        if (! ($accountResult['success'] ?? false)) {
            return $accountResult;
        }

        $accountId = (string) ($accountResult['account_id'] ?? '');
        $response = self::request('post', 'https://api.stripe.com/v1/account_links', [
            'account' => $accountId,
            'type' => 'account_onboarding',
            'refresh_url' => $refreshUrl,
            'return_url' => $returnUrl,
            'collection_options[fields]' => 'eventually_due',
        ]);
        $payload = $response['payload'] ?? [];
        if (! ($response['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractStripeMessage($payload, 'Unable to create Stripe onboarding link.'),
                'stripe_payload' => $payload,
            ];
        }

        $url = trim((string) ($payload['url'] ?? ''));
        if ($url === '') {
            return [
                'success' => false,
                'status' => 500,
                'message' => 'Unable to create Stripe onboarding link.',
                'stripe_payload' => $payload,
            ];
        }

        return [
            'success' => true,
            'status' => 200,
            'account_id' => $accountId,
            'account' => $accountResult['account'] ?? null,
            'onboarding_url' => $url,
            'expires_at' => $payload['expires_at'] ?? null,
        ];
    }

    public static function addExternalAccount(User $user, string $tokenId, ?string $expectedType = null): array
    {
        $token = trim($tokenId);
        if ($token === '') {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Missing Stripe payout token.',
            ];
        }

        $accountResult = self::ensureConnectAccountForUser($user);
        if (! ($accountResult['success'] ?? false)) {
            return $accountResult;
        }

        $accountId = (string) ($accountResult['account_id'] ?? '');
        $response = self::request(
            'post',
            'https://api.stripe.com/v1/accounts/'.$accountId.'/external_accounts',
            [
                'external_account' => $token,
                'default_for_currency' => 'true',
            ]
        );
        $payload = $response['payload'] ?? [];
        if (! ($response['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractStripeMessage($payload, 'Unable to save payout method.'),
                'stripe_payload' => $payload,
            ];
        }

        $resolvedType = self::normalizeExternalAccountType($payload['object'] ?? null);
        $expected = self::normalizeRequestedPayoutMethod($expectedType);
        if ($expected !== null && $resolvedType !== null && $resolvedType !== $expected) {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Saved payout method type does not match the selected method.',
                'stripe_payload' => $payload,
            ];
        }

        $refreshed = self::retrieveAccount($accountId);
        if ($refreshed['success'] ?? false) {
            self::syncUserFromAccountPayload($user, (array) ($refreshed['account'] ?? []));
        }

        return [
            'success' => true,
            'status' => 201,
            'account_id' => $accountId,
            'external_account' => self::transformExternalAccount($payload),
            'account' => $refreshed['account'] ?? ($accountResult['account'] ?? null),
        ];
    }

    public static function createTransferAndPayout(
        User $user,
        float $amount,
        string $currency,
        ?string $preferredMethod = null,
        array $metadata = []
    ): array {
        $amountCents = max(1, (int) round($amount * 100));
        $normalizedCurrency = strtolower(trim($currency)) ?: 'usd';

        $destinationResult = self::resolvePayoutDestination($user, $preferredMethod);
        if (! ($destinationResult['success'] ?? false)) {
            return $destinationResult;
        }

        $accountId = (string) ($destinationResult['account_id'] ?? '');
        $accountPayload = (array) ($destinationResult['account'] ?? []);
        $externalAccount = (array) ($destinationResult['external_account'] ?? []);

        $availableBalanceCents = self::retrieveConnectedAvailableBalanceCents($accountId, $normalizedCurrency);
        $shortfallCents = max(0, $amountCents - $availableBalanceCents);

        $transferPayload = null;
        if ($shortfallCents > 0) {
            $transferResponse = self::request('post', 'https://api.stripe.com/v1/transfers', self::buildMetadataPayload([
                'amount' => $shortfallCents,
                'currency' => $normalizedCurrency,
                'destination' => $accountId,
            ], $metadata));
            $transferPayload = $transferResponse['payload'] ?? [];
            if (! ($transferResponse['ok'] ?? false)) {
                return [
                    'success' => false,
                    'status' => (int) ($transferResponse['status'] ?? 500),
                    'message' => self::extractStripeMessage($transferPayload, 'Unable to move wallet funds to Stripe for payout.'),
                    'stripe_payload' => $transferPayload,
                    'account_id' => $accountId,
                    'external_account' => self::transformExternalAccount($externalAccount),
                ];
            }
        }

        $payoutPayload = self::buildMetadataPayload([
            'amount' => $amountCents,
            'currency' => $normalizedCurrency,
            'destination' => (string) ($externalAccount['id'] ?? ''),
        ], $metadata);
        if (($externalAccount['object'] ?? null) === 'card') {
            $availableMethods = collect(is_array($externalAccount['available_payout_methods'] ?? null)
                ? $externalAccount['available_payout_methods']
                : [])
                ->map(static fn ($value) => strtolower(trim((string) $value)))
                ->filter()
                ->values()
                ->all();
            if (count($availableMethods) > 0 && ! in_array('instant', $availableMethods, true)) {
                return [
                    'success' => false,
                    'status' => 422,
                    'message' => 'The saved debit card is not eligible for Stripe instant payouts.',
                    'account_id' => $accountId,
                    'external_account' => self::transformExternalAccount($externalAccount),
                    'transfer' => $transferPayload,
                ];
            }
            $payoutPayload['method'] = 'instant';
        }

        $payoutResponse = self::request(
            'post',
            'https://api.stripe.com/v1/payouts',
            $payoutPayload,
            $accountId
        );
        $payout = $payoutResponse['payload'] ?? [];
        if (! ($payoutResponse['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($payoutResponse['status'] ?? 500),
                'message' => self::extractStripeMessage($payout, 'Unable to create Stripe payout.'),
                'stripe_payload' => $payout,
                'account_id' => $accountId,
                'external_account' => self::transformExternalAccount($externalAccount),
                'transfer' => $transferPayload,
            ];
        }

        $stripeStatus = strtolower(trim((string) ($payout['status'] ?? 'pending')));
        $walletStatus = self::mapPayoutStatusToWalletStatus($stripeStatus);

        $refreshedAccount = self::retrieveAccount($accountId);
        if ($refreshedAccount['success'] ?? false) {
            self::syncUserFromAccountPayload($user, (array) ($refreshedAccount['account'] ?? []));
            $accountPayload = (array) ($refreshedAccount['account'] ?? $accountPayload);
        }

        return [
            'success' => true,
            'status' => 200,
            'message' => match ($walletStatus) {
                'completed' => 'Withdrawal sent successfully.',
                'processing' => 'Withdrawal is processing with Stripe.',
                default => 'Withdrawal was created successfully.',
            },
            'wallet_status' => $walletStatus,
            'stripe_status' => $stripeStatus !== '' ? $stripeStatus : 'pending',
            'account_id' => $accountId,
            'account' => $accountPayload,
            'external_account' => self::transformExternalAccount($externalAccount),
            'available_balance_before_cents' => $availableBalanceCents,
            'transfer_shortfall_cents' => $shortfallCents,
            'transfer' => $transferPayload,
            'payout' => $payout,
        ];
    }

    public static function retrieveAccount(string $accountId): array
    {
        $account = trim($accountId);
        if ($account === '' || ! str_starts_with($account, 'acct_')) {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Stripe Connect account is invalid.',
            ];
        }

        $response = self::request('get', 'https://api.stripe.com/v1/accounts/'.$account);
        $payload = $response['payload'] ?? [];
        if (! ($response['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractStripeMessage($payload, 'Unable to load Stripe Connect account.'),
                'stripe_payload' => $payload,
            ];
        }

        return [
            'success' => true,
            'status' => 200,
            'account_id' => $account,
            'account' => $payload,
        ];
    }

    public static function retrievePayout(string $accountId, string $payoutId): array
    {
        $account = trim($accountId);
        $payout = trim($payoutId);
        if ($account === '' || ! str_starts_with($account, 'acct_') || $payout === '') {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Stripe payout reference is invalid.',
            ];
        }

        $response = self::request(
            'get',
            'https://api.stripe.com/v1/payouts/'.$payout,
            [],
            $account
        );
        $payload = $response['payload'] ?? [];
        if (! ($response['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractStripeMessage($payload, 'Unable to load Stripe payout.'),
                'stripe_payload' => $payload,
            ];
        }

        return [
            'success' => true,
            'status' => 200,
            'payout' => $payload,
        ];
    }

    public static function syncUserFromAccountPayload(User $user, array $accountPayload): void
    {
        $accountId = trim((string) ($accountPayload['id'] ?? ''));
        if ($accountId === '' || ! str_starts_with($accountId, 'acct_')) {
            return;
        }

        $hasExternalAccountsPayload = array_key_exists('external_accounts', $accountPayload);
        $defaultExternal = self::selectExternalAccount($accountPayload);
        $onboarded = (bool) ($accountPayload['details_submitted'] ?? false);

        $user->stripe_connect_account_id = $accountId;
        $user->stripe_connect_account_type = trim((string) ($accountPayload['type'] ?? '')) ?: null;
        $user->stripe_connect_details_submitted = $onboarded;
        $user->stripe_connect_charges_enabled = (bool) ($accountPayload['charges_enabled'] ?? false);
        $user->stripe_connect_payouts_enabled = (bool) ($accountPayload['payouts_enabled'] ?? false);
        if ($onboarded && ! $user->stripe_connect_onboarded_at) {
            $user->stripe_connect_onboarded_at = now();
        }
        if ($hasExternalAccountsPayload) {
            $user->stripe_external_account_id = $defaultExternal['id'] ?? null;
            $user->stripe_external_account_type = self::normalizeExternalAccountType($defaultExternal['object'] ?? null);
            $user->stripe_external_account_last4 = isset($defaultExternal['last4'])
                ? trim((string) $defaultExternal['last4'])
                : null;
        }
        $user->save();
    }

    public static function mapPayoutStatusToWalletStatus(string $stripeStatus): string
    {
        return match (strtolower(trim($stripeStatus))) {
            'paid', 'succeeded' => 'completed',
            'pending', 'in_transit' => 'processing',
            'canceled', 'cancelled', 'failed' => 'failed',
            default => 'processing',
        };
    }

    public static function transformExternalAccount(?array $externalAccount): ?array
    {
        if (! is_array($externalAccount) || $externalAccount === []) {
            return null;
        }

        return [
            'id' => trim((string) ($externalAccount['id'] ?? '')) ?: null,
            'object' => trim((string) ($externalAccount['object'] ?? '')) ?: null,
            'type' => self::normalizeExternalAccountType($externalAccount['object'] ?? null),
            'brand' => trim((string) ($externalAccount['brand'] ?? '')) ?: null,
            'bank_name' => trim((string) ($externalAccount['bank_name'] ?? '')) ?: null,
            'last4' => trim((string) ($externalAccount['last4'] ?? '')) ?: null,
            'currency' => strtolower(trim((string) ($externalAccount['currency'] ?? ''))) ?: null,
            'default_for_currency' => (bool) ($externalAccount['default_for_currency'] ?? false),
            'status' => trim((string) ($externalAccount['status'] ?? '')) ?: null,
            'available_payout_methods' => is_array($externalAccount['available_payout_methods'] ?? null)
                ? array_values($externalAccount['available_payout_methods'])
                : [],
        ];
    }

    private static function resolvePayoutDestination(User $user, ?string $preferredMethod = null): array
    {
        $accountResult = self::ensureConnectAccountForUser($user);
        if (! ($accountResult['success'] ?? false)) {
            return $accountResult;
        }

        $accountId = (string) ($accountResult['account_id'] ?? '');
        $refreshed = self::retrieveAccount($accountId);
        if (! ($refreshed['success'] ?? false)) {
            return $refreshed;
        }

        $accountPayload = (array) ($refreshed['account'] ?? []);
        self::syncUserFromAccountPayload($user, $accountPayload);

        if (! (bool) ($accountPayload['details_submitted'] ?? false)) {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Complete Stripe onboarding before withdrawing.',
                'account_id' => $accountId,
                'account' => $accountPayload,
            ];
        }

        if (! (bool) ($accountPayload['payouts_enabled'] ?? false)) {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Stripe has not enabled payouts for this account yet. Complete onboarding and add a payout method first.',
                'account_id' => $accountId,
                'account' => $accountPayload,
            ];
        }

        $externalAccount = self::selectExternalAccount($accountPayload, $preferredMethod);
        if (! $externalAccount) {
            $message = match (self::normalizeRequestedPayoutMethod($preferredMethod)) {
                'card' => 'Save a debit card payout method before withdrawing.',
                'bank' => 'Save a bank account payout method before withdrawing.',
                default => 'Add a Stripe payout method before withdrawing.',
            };

            return [
                'success' => false,
                'status' => 422,
                'message' => $message,
                'account_id' => $accountId,
                'account' => $accountPayload,
            ];
        }

        return [
            'success' => true,
            'status' => 200,
            'account_id' => $accountId,
            'account' => $accountPayload,
            'external_account' => $externalAccount,
        ];
    }

    private static function retrieveConnectedAvailableBalanceCents(string $accountId, string $currency): int
    {
        $response = self::request('get', 'https://api.stripe.com/v1/balance', [], $accountId);
        $payload = $response['payload'] ?? [];
        if (! ($response['ok'] ?? false)) {
            return 0;
        }

        $normalizedCurrency = strtolower(trim($currency)) ?: 'usd';
        $available = is_array($payload['available'] ?? null) ? $payload['available'] : [];
        foreach ($available as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            if (strtolower(trim((string) ($entry['currency'] ?? ''))) !== $normalizedCurrency) {
                continue;
            }

            return max(0, (int) ($entry['amount'] ?? 0));
        }

        return 0;
    }

    private static function ensureManualPayoutSchedule(string $accountId): void
    {
        $response = self::request(
            'post',
            'https://api.stripe.com/v1/balance_settings',
            [
                'payments[payouts][schedule][interval]' => 'manual',
            ],
            $accountId,
            [
                'Stripe-Version' => trim((string) config('services.stripe.connect_preview_version', '2025-08-27.preview')),
            ]
        );
        if (! ($response['ok'] ?? false)) {
            Log::warning('stripe.connect.balance_settings_failed', [
                'stripe_connect_account_id' => $accountId,
                'status' => $response['status'] ?? null,
                'stripe_payload' => $response['payload'] ?? null,
            ]);
        }
    }

    private static function selectExternalAccount(array $accountPayload, ?string $preferredMethod = null): ?array
    {
        $externalAccounts = collect(is_array($accountPayload['external_accounts']['data'] ?? null)
            ? $accountPayload['external_accounts']['data']
            : [])
            ->filter(static fn ($entry) => is_array($entry))
            ->values();
        if ($externalAccounts->isEmpty()) {
            return null;
        }

        $normalizedPreferred = self::normalizeRequestedPayoutMethod($preferredMethod);
        if ($normalizedPreferred !== null) {
            $filtered = $externalAccounts
                ->filter(fn (array $entry) => self::normalizeExternalAccountType($entry['object'] ?? null) === $normalizedPreferred)
                ->values();
            if ($filtered->isNotEmpty()) {
                $externalAccounts = $filtered;
            } else {
                return null;
            }
        }

        return $externalAccounts
            ->sortByDesc(static fn (array $entry) => (bool) ($entry['default_for_currency'] ?? false))
            ->first();
    }

    private static function buildMetadataPayload(array $basePayload, array $metadata = []): array
    {
        $payload = $basePayload;
        foreach ($metadata as $key => $value) {
            $normalizedKey = preg_replace('/[^a-zA-Z0-9_]/', '_', (string) $key);
            $normalizedValue = trim((string) ($value ?? ''));
            if ($normalizedKey === '' || $normalizedValue === '') {
                continue;
            }
            $payload['metadata['.$normalizedKey.']'] = $normalizedValue;
        }

        return $payload;
    }

    private static function normalizeRequestedPayoutMethod(?string $value): ?string
    {
        return match (strtolower(trim((string) ($value ?? '')))) {
            'bank', 'bank_account' => 'bank',
            'card', 'debit_card' => 'card',
            'stripe', '' => null,
            default => null,
        };
    }

    private static function normalizeExternalAccountType(mixed $value): ?string
    {
        return match (strtolower(trim((string) ($value ?? '')))) {
            'bank_account' => 'bank',
            'card' => 'card',
            default => null,
        };
    }

    private static function request(
        string $method,
        string $url,
        array $payload = [],
        ?string $stripeAccount = null,
        array $headers = []
    ): array
    {
        $stripeSecret = trim((string) config('services.stripe.secret', ''));
        $stripeVerifySsl = (bool) config('services.stripe.verify_ssl', true);
        if ($stripeSecret === '') {
            return [
                'ok' => false,
                'status' => 500,
                'payload' => [
                    'error' => [
                        'message' => 'Stripe secret key is not configured.',
                    ],
                ],
            ];
        }

        try {
            $request = Http::withOptions([
                    'verify' => $stripeVerifySsl,
                ])
                ->withBasicAuth($stripeSecret, '')
                ->connectTimeout(5)
                ->timeout(20)
                ->asForm();

            if ($stripeAccount) {
                $request = $request->withHeaders([
                    'Stripe-Account' => $stripeAccount,
                ]);
            }

            if ($headers !== []) {
                $request = $request->withHeaders($headers);
            }

            $response = $request->send(strtoupper($method), $url, empty($payload) ? [] : ['form_params' => $payload]);

            return [
                'ok' => $response->successful(),
                'status' => $response->status(),
                'payload' => $response->json() ?: [],
            ];
        } catch (\Throwable $e) {
            Log::error('stripe.connect_manager.request_exception', [
                'method' => strtoupper($method),
                'url' => $url,
                'stripe_account' => $stripeAccount,
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
