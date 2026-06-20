<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\WalletTransaction;
use App\Support\StripeConnectManager;
use App\Support\StripeTransactionRecorder;
use App\Support\WalletWithdrawalNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class StripeWebhookController extends Controller
{
    private const CACHE_PREFIX = 'stripe:webhook:event:';
    private const CACHE_TTL_HOURS = 48;
    private const SIGNATURE_TOLERANCE_SECONDS = 300;

    public function handle(Request $request): JsonResponse
    {
        $payload = (string) $request->getContent();
        $signatureHeader = (string) $request->header('Stripe-Signature', '');
        $webhookSecret = trim((string) config('services.stripe.webhook_secret', ''));

        if ($webhookSecret === '') {
            $this->logWebhook('missing_webhook_secret', [
                'message' => 'Set STRIPE_WEBHOOK_SECRET in backend/.env',
            ]);
            return response()->json([
                'received' => false,
                'message' => 'Stripe webhook secret is not configured.',
            ], 503);
        }

        if (! $this->isValidSignature($payload, $signatureHeader, $webhookSecret)) {
            $this->logWebhook('invalid_signature', [
                'signature_header' => $this->truncate($signatureHeader, 220),
            ]);
            return response()->json([
                'received' => false,
                'message' => 'Invalid Stripe signature.',
            ], 400);
        }

        $event = json_decode($payload, true);
        if (! is_array($event)) {
            $this->logWebhook('invalid_payload_json', [
                'payload' => $this->truncate($payload),
            ]);
            return response()->json([
                'received' => false,
                'message' => 'Invalid JSON payload.',
            ], 400);
        }

        $eventId = trim((string) ($event['id'] ?? ''));
        $eventType = trim((string) ($event['type'] ?? 'unknown'));
        $object = is_array($event['data']['object'] ?? null) ? $event['data']['object'] : [];
        $metadata = is_array($object['metadata'] ?? null) ? $object['metadata'] : [];
        $summary = [
            'event_id' => $eventId,
            'event_type' => $eventType,
            'customer' => (string) ($object['customer'] ?? ''),
            'subscription' => (string) ($object['subscription'] ?? $object['id'] ?? ''),
            'payment_intent' => (string) ($object['payment_intent'] ?? ''),
            'checkout_session' => (string) (($object['object'] ?? '') === 'checkout.session' ? ($object['id'] ?? '') : ''),
            'amount_total' => $object['amount_total'] ?? $object['amount'] ?? null,
            'currency' => (string) ($object['currency'] ?? ''),
            'status' => (string) ($object['status'] ?? ''),
        ];

        if ($eventId !== '') {
            $cacheKey = self::CACHE_PREFIX.$eventId;
            if (Cache::has($cacheKey)) {
                StripeTransactionRecorder::recordWebhook([
                    'user_id' => $this->resolveStripeEventUserId($object, $metadata),
                    'source' => 'stripe.webhook',
                    'category' => 'webhook',
                    'type' => 'event',
                    'status' => 'received',
                    'amount' => $this->resolveStripeEventAmount($object),
                    'currency' => $this->resolveStripeEventCurrency($object),
                    'stripe_event_id' => $eventId,
                    'stripe_payment_intent_id' => $this->resolveStripeEventPaymentIntentId($object),
                    'stripe_charge_id' => $this->resolveStripeEventChargeId($object),
                    'stripe_object_type' => trim((string) ($object['object'] ?? 'event')),
                    'description' => 'Stripe webhook event '.$eventType,
                    'request_payload' => $event,
                    'meta' => [
                        'event_type' => $eventType,
                        'duplicate_delivery' => true,
                        'summary' => $summary,
                    ],
                ]);
                $this->logWebhook('duplicate_event_ignored', [
                    'event_id' => $eventId,
                    'event_type' => $eventType,
                ]);
                return response()->json([
                    'received' => true,
                    'duplicate' => true,
                ]);
            }
            Cache::put($cacheKey, now()->toIso8601String(), now()->addHours(self::CACHE_TTL_HOURS));
        }

        StripeTransactionRecorder::recordWebhook([
            'user_id' => $this->resolveStripeEventUserId($object, $metadata),
            'source' => 'stripe.webhook',
            'category' => 'webhook',
            'type' => 'event',
            'status' => 'received',
            'amount' => $this->resolveStripeEventAmount($object),
            'currency' => $this->resolveStripeEventCurrency($object),
            'stripe_event_id' => $eventId,
            'stripe_payment_intent_id' => $this->resolveStripeEventPaymentIntentId($object),
            'stripe_charge_id' => $this->resolveStripeEventChargeId($object),
            'stripe_object_type' => trim((string) ($object['object'] ?? 'event')),
            'description' => 'Stripe webhook event '.$eventType,
            'request_payload' => $event,
            'meta' => [
                'event_type' => $eventType,
                'summary' => $summary,
            ],
        ]);

        switch ($eventType) {
            case 'checkout.session.completed':
            case 'invoice.payment_succeeded':
            case 'payment_intent.succeeded':
                $this->logWebhook('payment_success', $summary);
                break;

            case 'invoice.payment_failed':
            case 'payment_intent.payment_failed':
                $this->logWebhook('payment_failed', $summary);
                break;

            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                $this->logWebhook('subscription_event', $summary);
                break;

            case 'charge.refunded':
                $this->logWebhook('charge_refunded', $summary);
                break;

            case 'account.updated':
                $this->syncConnectedAccountFromWebhook($object);
                $this->logWebhook('account_updated', $summary);
                break;

            case 'payout.created':
            case 'payout.updated':
            case 'payout.paid':
            case 'payout.failed':
            case 'payout.canceled':
                $this->syncWithdrawalFromPayoutWebhook($eventType, $object);
                $this->logWebhook('payout_event', $summary);
                break;

            default:
                $this->logWebhook('unhandled_event', $summary);
                break;
        }

        return response()->json(['received' => true]);
    }

    private function resolveStripeEventUserId(array $object, array $metadata): ?string
    {
        $candidates = [
            $metadata['user_id'] ?? null,
            $metadata['parent_user_id'] ?? null,
            $metadata['nanny_id'] ?? null,
            $object['client_reference_id'] ?? null,
        ];

        foreach ($candidates as $candidate) {
            $normalized = trim((string) ($candidate ?? ''));
            if ($normalized !== '') {
                return $normalized;
            }
        }

        return null;
    }

    private function resolveStripeEventAmount(array $object): ?float
    {
        $raw = $object['amount_total'] ?? $object['amount'] ?? null;
        if (! is_numeric((string) $raw)) {
            return null;
        }

        return round(((float) $raw) / 100, 2);
    }

    private function resolveStripeEventCurrency(array $object): ?string
    {
        $currency = strtolower(trim((string) ($object['currency'] ?? '')));
        return $currency !== '' ? $currency : null;
    }

    private function resolveStripeEventPaymentIntentId(array $object): ?string
    {
        $objectType = trim((string) ($object['object'] ?? ''));
        if ($objectType === 'payment_intent') {
            $id = trim((string) ($object['id'] ?? ''));
            return $id !== '' ? $id : null;
        }

        $paymentIntentId = trim((string) ($object['payment_intent'] ?? ''));
        return $paymentIntentId !== '' ? $paymentIntentId : null;
    }

    private function resolveStripeEventChargeId(array $object): ?string
    {
        $objectType = trim((string) ($object['object'] ?? ''));
        if ($objectType === 'charge') {
            $id = trim((string) ($object['id'] ?? ''));
            return $id !== '' ? $id : null;
        }

        $chargeId = trim((string) ($object['charge'] ?? ''));
        return $chargeId !== '' ? $chargeId : null;
    }

    private function isValidSignature(string $payload, string $header, string $secret): bool
    {
        [$timestamp, $signatures] = $this->parseSignatureHeader($header);
        if (! $timestamp || empty($signatures)) {
            return false;
        }

        if (abs(time() - $timestamp) > self::SIGNATURE_TOLERANCE_SECONDS) {
            return false;
        }

        $signedPayload = $timestamp.'.'.$payload;
        $expected = hash_hmac('sha256', $signedPayload, $secret);

        foreach ($signatures as $signature) {
            if (hash_equals($expected, $signature)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{0:int|null,1:string[]}
     */
    private function parseSignatureHeader(string $header): array
    {
        $timestamp = null;
        $signatures = [];

        $parts = array_filter(array_map('trim', explode(',', $header)));
        foreach ($parts as $part) {
            [$key, $value] = array_pad(explode('=', $part, 2), 2, null);
            $key = trim((string) $key);
            $value = trim((string) $value);

            if ($key === 't' && ctype_digit($value)) {
                $timestamp = (int) $value;
            } elseif ($key === 'v1' && $value !== '') {
                $signatures[] = $value;
            }
        }

        return [$timestamp, $signatures];
    }

    private function truncate(string $value, int $limit = 1200): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }

        return strlen($trimmed) > $limit
            ? substr($trimmed, 0, $limit).'...[truncated]'
            : $trimmed;
    }

    private function syncConnectedAccountFromWebhook(array $account): void
    {
        $accountId = trim((string) ($account['id'] ?? ''));
        if ($accountId === '' || ! str_starts_with($accountId, 'acct_')) {
            return;
        }

        $metadata = is_array($account['metadata'] ?? null) ? $account['metadata'] : [];
        $user = User::query()->where('stripe_connect_account_id', $accountId)->first();
        if (! $user && filled($metadata['user_id'] ?? null)) {
            $user = User::query()
                ->where('user_id', User::resolvePublicUserIdByIdentifier($metadata['user_id']))
                ->first();
        }
        if (! $user) {
            return;
        }

        StripeConnectManager::syncUserFromAccountPayload($user, $account);
    }

    private function syncWithdrawalFromPayoutWebhook(string $eventType, array $payout): void
    {
        $metadata = is_array($payout['metadata'] ?? null) ? $payout['metadata'] : [];
        $transaction = $this->resolveWalletWithdrawalTransaction($metadata, $payout);
        if (! $transaction) {
            return;
        }

        $stripeStatus = strtolower(trim((string) (
            $payout['status']
            ?? ($eventType === 'payout.failed' ? 'failed' : ($eventType === 'payout.paid' ? 'paid' : 'pending'))
        )));
        $walletStatus = StripeConnectManager::mapPayoutStatusToWalletStatus($stripeStatus);
        $meta = is_array($transaction->meta) ? $transaction->meta : [];
        $meta = [
            ...$meta,
            'stripe_payout_id' => trim((string) ($payout['id'] ?? '')) ?: ($meta['stripe_payout_id'] ?? null),
            'stripe_payout_status' => $stripeStatus !== '' ? $stripeStatus : ($meta['stripe_payout_status'] ?? null),
            'payout_arrival_date' => isset($payout['arrival_date']) && is_numeric((string) $payout['arrival_date'])
                ? now()->setTimestamp((int) $payout['arrival_date'])->toDateString()
                : ($meta['payout_arrival_date'] ?? null),
            'payout_failure_code' => trim((string) ($payout['failure_code'] ?? '')) ?: null,
            'payout_failure_message' => trim((string) ($payout['failure_message'] ?? '')) ?: null,
            'payout_updated_at' => now()->toISOString(),
        ];

        $transaction->status = $walletStatus;
        $transaction->meta = $meta;
        $transaction->save();
        $transaction = $transaction->fresh() ?? $transaction;

        $amount = isset($payout['amount']) && is_numeric((string) $payout['amount'])
            ? round(((float) $payout['amount']) / 100, 2)
            : (float) $transaction->amount;
        $currency = strtolower(trim((string) ($payout['currency'] ?? $transaction->currency ?? 'usd'))) ?: 'usd';
        if ($walletStatus === 'completed') {
            WalletWithdrawalNotifier::completed(
                $transaction->user_id,
                $transaction,
                $amount,
                $currency,
                ['stripe_payout_id' => $payout['id'] ?? null]
            );

            return;
        }

        if ($walletStatus === 'failed') {
            WalletWithdrawalNotifier::failed(
                $transaction->user_id,
                $transaction,
                $amount,
                $currency,
                trim((string) ($payout['failure_message'] ?? '')),
                ['stripe_payout_id' => $payout['id'] ?? null]
            );
        }
    }

    private function resolveWalletWithdrawalTransaction(array $metadata, array $payout): ?WalletTransaction
    {
        $walletTransactionId = $metadata['wallet_transaction_id'] ?? null;
        if (is_numeric((string) $walletTransactionId)) {
            $transaction = WalletTransaction::query()
                ->whereKey((int) $walletTransactionId)
                ->where('type', 'wallet_withdrawal')
                ->first();
            if ($transaction) {
                return $transaction;
            }
        }

        $payoutId = trim((string) ($payout['id'] ?? ''));
        if ($payoutId === '') {
            return null;
        }

        return WalletTransaction::query()
            ->where('type', 'wallet_withdrawal')
            ->where('meta->stripe_payout_id', $payoutId)
            ->first();
    }

    private function logWebhook(string $event, array $context = []): void
    {
        $message = '[StripeWebhook] '.$event;
        Log::info($message, $context);
        Log::channel('stderr')->info($message, $context);
    }
}
