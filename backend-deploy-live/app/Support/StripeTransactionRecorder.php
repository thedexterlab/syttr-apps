<?php

namespace App\Support;

use App\Models\StripeTransaction;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class StripeTransactionRecorder
{
    public static function record(array $attributes): void
    {
        if (! Schema::hasTable('stripe_transactions')) {
            return;
        }

        try {
            StripeTransaction::query()->create(self::normalize($attributes));
        } catch (\Throwable $e) {
            Log::warning('stripe_transaction.record_failed', [
                'source' => $attributes['source'] ?? null,
                'stripe_event_id' => $attributes['stripe_event_id'] ?? null,
                'stripe_payment_intent_id' => $attributes['stripe_payment_intent_id'] ?? null,
                'stripe_charge_id' => $attributes['stripe_charge_id'] ?? null,
                'error' => $e->getMessage(),
            ]);
        }
    }

    public static function recordWebhook(array $attributes): void
    {
        if (! Schema::hasTable('stripe_transactions')) {
            return;
        }

        $payload = self::normalize($attributes);
        $stripeEventId = trim((string) ($payload['stripe_event_id'] ?? ''));

        try {
            if ($stripeEventId !== '') {
                StripeTransaction::query()->updateOrCreate(
                    ['stripe_event_id' => $stripeEventId],
                    $payload
                );

                return;
            }

            StripeTransaction::query()->create($payload);
        } catch (\Throwable $e) {
            Log::warning('stripe_transaction.record_webhook_failed', [
                'source' => $attributes['source'] ?? null,
                'stripe_event_id' => $stripeEventId !== '' ? $stripeEventId : null,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function normalize(array $attributes): array
    {
        $payload = [
            'user_id' => self::nullableString($attributes['user_id'] ?? null, 20),
            'counterparty_user_id' => self::nullableString($attributes['counterparty_user_id'] ?? null, 20),
            'payment_method_id' => self::nullableInt($attributes['payment_method_id'] ?? null),
            'job_id' => self::nullableInt($attributes['job_id'] ?? null),
            'application_id' => self::nullableInt($attributes['application_id'] ?? null),
            'subscription_purchase_id' => self::nullableInt($attributes['subscription_purchase_id'] ?? null),
            'source' => self::requiredString($attributes['source'] ?? 'unknown', 100),
            'category' => self::requiredString($attributes['category'] ?? 'other', 50),
            'type' => self::requiredString($attributes['type'] ?? 'payment', 50),
            'status' => self::requiredString($attributes['status'] ?? 'pending', 50),
            'amount' => self::nullableAmount($attributes['amount'] ?? null),
            'currency' => self::nullableString($attributes['currency'] ?? null, 10),
            'stripe_payment_intent_id' => self::nullableString($attributes['stripe_payment_intent_id'] ?? null),
            'stripe_charge_id' => self::nullableString($attributes['stripe_charge_id'] ?? null),
            'stripe_event_id' => self::nullableString($attributes['stripe_event_id'] ?? null),
            'stripe_object_type' => self::nullableString($attributes['stripe_object_type'] ?? null, 50),
            'stripe_payment_method_id' => self::nullableString($attributes['stripe_payment_method_id'] ?? null),
            'description' => self::nullableString($attributes['description'] ?? null),
            'error_message' => self::nullableLongString($attributes['error_message'] ?? null),
            'request_payload' => self::nullableArray($attributes['request_payload'] ?? null),
            'response_payload' => self::nullableArray($attributes['response_payload'] ?? null),
            'meta' => self::nullableArray($attributes['meta'] ?? null),
        ];

        return $payload;
    }

    private static function nullableString(mixed $value, int $limit = 255): ?string
    {
        $normalized = trim((string) ($value ?? ''));
        if ($normalized === '') {
            return null;
        }

        return mb_substr($normalized, 0, $limit);
    }

    private static function requiredString(mixed $value, int $limit = 255): string
    {
        return self::nullableString($value, $limit) ?? 'unknown';
    }

    private static function nullableLongString(mixed $value): ?string
    {
        $normalized = trim((string) ($value ?? ''));
        return $normalized !== '' ? $normalized : null;
    }

    private static function nullableInt(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric((string) $value) ? (int) $value : null;
    }

    private static function nullableAmount(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        return is_numeric((string) $value) ? round((float) $value, 2) : null;
    }

    private static function nullableArray(mixed $value): ?array
    {
        return is_array($value) ? $value : null;
    }
}
