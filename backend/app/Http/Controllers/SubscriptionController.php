<?php

namespace App\Http\Controllers;

use App\Models\PaymentMethod;
use App\Models\SubscriptionPurchase;
use App\Models\User;
use App\Models\UserSubscription;
use App\Support\StripeCustomerManager;
use App\Support\StripeTransactionRecorder;
use App\Support\SubscriptionPlanCatalog;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SubscriptionController extends Controller
{
    private const CANCELLATION_NOTICE_DAYS = 30;

    public function plans(): JsonResponse
    {
        $plans = SubscriptionPlanCatalog::active()->values();
        $defaultPlan = $plans->first() ?: SubscriptionPlanCatalog::fallback();

        return response()->json([
            'success' => true,
            'data' => [
                'plans' => $plans->all(),
                'default_plan' => $defaultPlan,
            ],
        ]);
    }

    public function status(Request $request): JsonResponse
    {
        Log::info('subscription.status.request', [
            'ip' => $request->ip(),
            'user_id_input' => $request->input('user_id'),
            'has_bearer' => $request->bearerToken() ? true : false,
        ]);

        $userId = $this->resolveUserId($request, $request->input('user_id'));
        if (! $userId) {
            return response()->json([
                'success' => true,
                'subscribed' => false,
                'status' => 'inactive',
            ]);
        }

        $subscription = UserSubscription::query()
            ->where('user_id', $userId)
            ->latest()
            ->first();

        if (! $subscription) {
            return response()->json([
                'success' => true,
                'subscribed' => false,
                'status' => 'inactive',
            ]);
        }

        $subscription = $this->synchronizeLifecycle($subscription);

        $status = strtolower((string) $subscription->status);
        $isActive = $status === 'active';

        return response()->json([
            'success' => true,
            'subscribed' => $isActive,
            'status' => $status !== '' ? $status : 'inactive',
            'plan' => $subscription->plan,
            'active' => $isActive,
            'updated_at' => optional($subscription->updated_at)->toISOString(),
            'data' => $this->serializeSubscription($subscription),
        ]);
    }

    public function subscribe(Request $request): JsonResponse
    {
        Log::info('subscription.subscribe.request', [
            'ip' => $request->ip(),
            'user_id_input' => $request->input('user_id'),
            'payment_method_id_input' => $request->input('payment_method_id'),
            'plan_input' => $request->input('plan'),
            'has_bearer' => $request->bearerToken() ? true : false,
        ]);

        $data = $request->validate([
            'user_id' => ['nullable'],
            'plan' => ['nullable', 'string', 'max:100'],
            'price_id' => ['nullable', 'string', 'max:255'],
            'payment_method_id' => ['required'],
            'amount' => ['nullable', 'numeric', 'min:0.5'],
            'currency' => ['nullable', 'string', 'max:10'],
        ]);

        $userId = $this->resolveUserId($request, $data['user_id'] ?? null);
        if (! $userId) {
            return response()->json(['message' => 'Unable to resolve user.'], 422);
        }

        $user = User::query()->where('user_id', $userId)->first();
        if (! $user) {
            return response()->json(['message' => 'Unable to resolve user.'], 422);
        }

        $paymentMethodIdRaw = trim((string) ($data['payment_method_id'] ?? ''));
        if (! ctype_digit($paymentMethodIdRaw)) {
            return response()->json([
                'message' => 'Invalid payment method.',
            ], 422);
        }
        $paymentMethodId = (int) $paymentMethodIdRaw;
        $paymentMethod = PaymentMethod::query()
            ->whereKey($paymentMethodId)
            ->where('user_id', $userId)
            ->first();
        if (! $paymentMethod) {
            return response()->json([
                'message' => 'Selected payment method does not belong to this user.',
            ], 422);
        }
        $stripePaymentMethodId = trim((string) ($paymentMethod->stripe_payment_method_id ?? ''));
        if ($stripePaymentMethodId === '') {
            return response()->json([
                'message' => 'Selected payment method is missing Stripe details.',
            ], 422);
        }
        if (! str_starts_with($stripePaymentMethodId, 'pm_')) {
            return response()->json([
                'message' => 'Selected payment method is invalid. Please add a Stripe card again.',
            ], 422);
        }

        $planConfig = SubscriptionPlanCatalog::resolve($data['plan'] ?? null);
        $planName = trim((string) ($planConfig['name'] ?? 'Premium Family')) ?: 'Premium Family';
        $planSlug = trim((string) ($planConfig['slug'] ?? 'premium-family')) ?: 'premium-family';
        $amount = (float) ($planConfig['amount'] ?? $data['amount'] ?? 19.99);
        if ($amount < 0.5) {
            return response()->json([
                'message' => 'Invalid subscription amount.',
            ], 422);
        }
        $currency = strtoupper((string) ($planConfig['currency'] ?? $data['currency'] ?? 'USD'));
        $amountInCents = (int) round($amount * 100);
        if ($amountInCents <= 0) {
            return response()->json([
                'message' => 'Invalid subscription amount.',
            ], 422);
        }

        $billingIntervalCount = max(1, (int) ($planConfig['interval_count'] ?? 1));
        $billingIntervalUnit = trim((string) ($planConfig['interval_unit'] ?? 'month')) ?: 'month';
        $renewalMode = trim((string) ($planConfig['renewal_mode'] ?? 'auto')) ?: 'auto';
        $trialDays = max(0, (int) ($planConfig['trial_days'] ?? 0));
        $cancellationNoticeDays = max(
            0,
            (int) ($planConfig['cancellation_notice_days'] ?? self::CANCELLATION_NOTICE_DAYS)
        );
        $priceId = trim((string) ($planConfig['stripe_price_id'] ?? $data['price_id'] ?? '')) ?: null;

        $paymentMethodSetup = StripeCustomerManager::ensureReusablePaymentMethodForUser(
            $user,
            $stripePaymentMethodId,
            (bool) $paymentMethod->is_default
        );
        if (! ($paymentMethodSetup['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'message' => (string) ($paymentMethodSetup['message'] ?? 'Unable to use the selected payment method.'),
            ], (int) ($paymentMethodSetup['status'] ?? 422));
        }
        $stripeCustomerId = trim((string) ($paymentMethodSetup['customer_id'] ?? $user->stripe_customer_id ?? ''));

        $stripeAuditBase = [
            'user_id' => $userId,
            'payment_method_id' => $paymentMethodId,
            'source' => 'subscription.subscribe',
            'category' => 'subscription',
            'type' => 'payment_intent',
            'amount' => round($amount, 2),
            'currency' => strtolower($currency),
            'stripe_payment_method_id' => $stripePaymentMethodId,
            'description' => 'Family subscription charge',
            'request_payload' => [
                'amount' => $amountInCents,
                'currency' => strtolower($currency),
                'confirm' => true,
                'payment_method_id' => $paymentMethodId,
                'stripe_payment_method_id' => $stripePaymentMethodId,
                'payment_method_types' => ['card'],
                'customer' => $stripeCustomerId !== '' ? $stripeCustomerId : null,
                'plan' => $planName,
                'plan_slug' => $planSlug,
                'price_id' => $priceId,
            ],
            'meta' => [
                'stripe_customer_id' => $stripeCustomerId !== '' ? $stripeCustomerId : null,
                'plan' => $planName,
                'plan_slug' => $planSlug,
                'price_id' => $priceId,
            ],
        ];

        $stripeSecret = trim((string) config('services.stripe.secret', ''));
        $stripeVerifySsl = (bool) config('services.stripe.verify_ssl', true);
        if ($stripeSecret === '') {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'config_error',
                'error_message' => 'Stripe secret key is not configured.',
            ]);
            return response()->json([
                'message' => 'Stripe secret key is not configured.',
            ], 500);
        }

        try {
            $stripeStartedAt = microtime(true);
            $stripeResponse = Http::withOptions([
                    'verify' => $stripeVerifySsl,
                ])
                ->withBasicAuth($stripeSecret, '')
                ->connectTimeout(5)
                ->timeout(12)
                ->asForm()
                ->post('https://api.stripe.com/v1/payment_intents', [
                    'amount' => $amountInCents,
                    'currency' => strtolower($currency),
                    'confirm' => 'true',
                    'payment_method' => $stripePaymentMethodId,
                    'customer' => $stripeCustomerId,
                    'payment_method_types[0]' => 'card',
                    'description' => 'Family subscription charge',
                    'metadata[user_id]' => (string) $userId,
                    'metadata[payment_method_id]' => (string) $paymentMethodId,
                    'metadata[plan]' => $planName,
                    'metadata[plan_slug]' => $planSlug,
                ]);
            Log::info('subscription.charge.response', [
                'user_id' => $userId,
                'payment_method_id' => $paymentMethodId,
                'status' => $stripeResponse->status(),
                'elapsed_ms' => (int) round((microtime(true) - $stripeStartedAt) * 1000),
            ]);
        } catch (ConnectionException $e) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'timeout',
                'error_message' => $e->getMessage(),
                'meta' => [
                    ...($stripeAuditBase['meta'] ?? []),
                    'exception' => 'connection_timeout',
                ],
            ]);
            Log::warning('subscription.charge.connection_timeout', [
                'user_id' => $userId,
                'payment_method_id' => $paymentMethodId,
                'error' => $e->getMessage(),
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Stripe request timed out. Please try again in a few seconds.',
            ], 504);
        } catch (\Throwable $e) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'exception',
                'error_message' => $e->getMessage(),
                'meta' => [
                    ...($stripeAuditBase['meta'] ?? []),
                    'exception' => get_class($e),
                ],
            ]);
            Log::error('subscription.charge.exception', [
                'user_id' => $userId,
                'payment_method_id' => $paymentMethodId,
                'error' => $e->getMessage(),
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Unable to process Stripe payment right now.',
            ], 500);
        }

        $stripePayload = $stripeResponse->json() ?: [];
        if (! $stripeResponse->successful()) {
            $message = StripeCustomerManager::humanizeReusablePaymentMethodError(
                (string) ($stripePayload['error']['message'] ?? $stripePayload['message'] ?? 'Subscription payment failed.')
            );
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'failed',
                'stripe_payment_intent_id' => (string) ($stripePayload['id'] ?? ''),
                'response_payload' => $stripePayload,
                'error_message' => $message,
            ]);
            Log::warning('subscription.charge.failed', [
                'user_id' => $userId,
                'payment_method_id' => $paymentMethodId,
                'status' => $stripeResponse->status(),
                'stripe_message' => $message,
                'stripe_payload' => $stripePayload,
            ]);
            return response()->json([
                'success' => false,
                'message' => $message,
            ], 402);
        }

        $intentStatus = strtolower((string) ($stripePayload['status'] ?? ''));
        if (! in_array($intentStatus, ['succeeded', 'requires_capture', 'processing'], true)) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => $intentStatus !== '' ? $intentStatus : 'incomplete',
                'stripe_payment_intent_id' => (string) ($stripePayload['id'] ?? ''),
                'response_payload' => $stripePayload,
                'error_message' => 'Subscription payment was not completed.',
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Subscription payment was not completed.',
            ], 402);
        }

        $now = Carbon::now();
        $periodEnd = SubscriptionPlanCatalog::addInterval($now, $billingIntervalCount, $billingIntervalUnit);

        UserSubscription::query()
            ->where('user_id', $userId)
            ->whereIn('status', ['active', 'paused', 'trialing', 'renewing'])
            ->update([
                'status' => 'inactive',
                'ends_at' => $now,
            ]);

        $subscription = UserSubscription::query()->create([
            'user_id' => $userId,
            'plan' => $planName,
            'status' => 'active',
            'amount' => round($amount, 2),
            'currency' => $currency,
            'payment_method_id' => $paymentMethodId,
            'starts_at' => $now,
            'ends_at' => $periodEnd,
            'meta' => [
                'plan_setting_id' => $planConfig['id'] ?? null,
                'plan_slug' => $planSlug,
                'plan_name' => $planName,
                'description' => $planConfig['description'] ?? null,
                'billing_interval_count' => $billingIntervalCount,
                'billing_interval_unit' => $billingIntervalUnit,
                'renewal_mode' => $renewalMode,
                'trial_days' => $trialDays,
                'cancellation_notice_days' => $cancellationNoticeDays,
                'price_id' => $priceId,
                'features' => $planConfig['features'] ?? [],
                'source' => 'stripe-payment-intent',
                'stripe_payment_intent_id' => (string) ($stripePayload['id'] ?? ''),
                'stripe_payment_status' => $intentStatus,
            ],
        ]);

        $purchase = SubscriptionPurchase::query()->create([
            'user_id' => $userId,
            'subscription_id' => $subscription->id,
            'payment_method_id' => $paymentMethodId,
            'plan' => $planName,
            'amount' => round($amount, 2),
            'currency' => $currency,
            'stripe_payment_intent_id' => (string) ($stripePayload['id'] ?? ''),
            'stripe_payment_status' => $intentStatus,
            'purchased_at' => $now,
            'meta' => [
                'plan_setting_id' => $planConfig['id'] ?? null,
                'plan_slug' => $planSlug,
                'billing_interval_count' => $billingIntervalCount,
                'billing_interval_unit' => $billingIntervalUnit,
                'renewal_mode' => $renewalMode,
                'trial_days' => $trialDays,
                'cancellation_notice_days' => $cancellationNoticeDays,
                'price_id' => $priceId,
                'source' => 'subscription.subscribe',
            ],
        ]);

        StripeTransactionRecorder::record([
            ...$stripeAuditBase,
            'status' => $intentStatus,
            'subscription_purchase_id' => $purchase->id,
            'stripe_payment_intent_id' => (string) ($stripePayload['id'] ?? ''),
            'response_payload' => $stripePayload,
            'meta' => [
                ...($stripeAuditBase['meta'] ?? []),
                'subscription_id' => $subscription->id,
                'subscription_purchase_id' => $purchase->id,
                'stripe_payment_status' => $intentStatus,
            ],
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Subscription started successfully.',
            'data' => $this->serializeSubscription($subscription),
        ], 201);
    }

    public function pause(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $userId = $this->resolveUserId($request, $data['user_id'] ?? null);
        if (! $userId) {
            return response()->json(['message' => 'Unable to resolve user.'], 422);
        }

        $subscription = UserSubscription::query()
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->latest()
            ->first();

        if (! $subscription) {
            return response()->json([
                'message' => 'No active subscription found to pause.',
            ], 422);
        }

        $now = Carbon::now();
        $subscription->status = 'paused';
        $subscription->meta = $this->mergeMeta($subscription, [
            'paused_at' => $now->toISOString(),
            'pause_reason' => $data['reason'] ?? null,
        ]);
        $subscription->save();

        return response()->json([
            'success' => true,
            'message' => 'Subscription paused successfully.',
            'data' => $this->serializeSubscription($subscription->fresh()),
        ]);
    }

    public function resume(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
        ]);

        $userId = $this->resolveUserId($request, $data['user_id'] ?? null);
        if (! $userId) {
            return response()->json(['message' => 'Unable to resolve user.'], 422);
        }

        $subscription = UserSubscription::query()
            ->where('user_id', $userId)
            ->where('status', 'paused')
            ->latest()
            ->first();

        if (! $subscription) {
            return response()->json([
                'message' => 'No paused subscription found to resume.',
            ], 422);
        }

        $interval = $this->resolveSubscriptionInterval($subscription);
        $now = Carbon::now();
        $subscription->status = 'active';
        if (! $subscription->starts_at) {
            $subscription->starts_at = $now;
        }
        if (! $subscription->ends_at || $subscription->ends_at->lte($now)) {
            $subscription->ends_at = SubscriptionPlanCatalog::addInterval(
                $now,
                $interval['count'],
                $interval['unit'],
            );
        }
        $subscription->meta = $this->mergeMeta($subscription, [
            'resumed_at' => $now->toISOString(),
        ]);
        $subscription->save();

        return response()->json([
            'success' => true,
            'message' => 'Subscription resumed successfully.',
            'data' => $this->serializeSubscription($subscription->fresh()),
        ]);
    }

    public function cancel(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $userId = $this->resolveUserId($request, $data['user_id'] ?? null);
        if (! $userId) {
            return response()->json(['message' => 'Unable to resolve user.'], 422);
        }

        $subscription = UserSubscription::query()
            ->where('user_id', $userId)
            ->whereIn('status', ['active', 'paused'])
            ->latest()
            ->first();

        if (! $subscription) {
            return response()->json([
                'message' => 'No active or paused subscription found to cancel.',
            ], 422);
        }

        $existingMeta = is_array($subscription->meta) ? $subscription->meta : [];
        $existingEffectiveAt = $this->parseMetaDate($existingMeta['cancel_effective_at'] ?? null);
        if ($existingEffectiveAt && $existingEffectiveAt->isFuture()) {
            return response()->json([
                'success' => true,
                'message' => 'Subscription cancellation is already scheduled.',
                'data' => $this->serializeSubscription($subscription->fresh()),
            ]);
        }

        $noticeDays = $this->resolveCancellationNoticeDays($subscription);
        $now = Carbon::now();
        $effectiveAt = $now->copy()->addDays($noticeDays);
        $subscription->ends_at = $effectiveAt;
        $subscription->meta = $this->mergeMeta($subscription, [
            'cancel_requested_at' => $now->toISOString(),
            'cancel_effective_at' => $effectiveAt->toISOString(),
            'cancel_reason' => $data['reason'] ?? null,
            'cancellation_notice_days' => $noticeDays,
        ]);
        $subscription->save();

        return response()->json([
            'success' => true,
            'message' => 'Subscription cancellation scheduled successfully.',
            'data' => $this->serializeSubscription($subscription->fresh()),
        ]);
    }

    public function history(Request $request): JsonResponse
    {
        return $this->transactions($request);
    }

    public function transactions(Request $request): JsonResponse
    {
        $userId = $this->resolveUserId($request, $request->input('user_id'));
        if (! $userId) {
            return response()->json(['data' => []]);
        }

        $items = UserSubscription::query()
            ->where('user_id', $userId)
            ->latest()
            ->get()
            ->map(fn (UserSubscription $subscription) => $this->serializeTransaction($subscription));

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    private function resolveUserId(Request $request, mixed $rawUserId = null): ?string
    {
        if ($rawUserId !== null && $rawUserId !== '') {
            return User::resolvePublicUserIdByIdentifier($rawUserId);
        }

        return User::resolvePublicUserIdByApiToken($request->bearerToken());
    }

    private function serializeSubscription(UserSubscription $subscription): array
    {
        $meta = is_array($subscription->meta) ? $subscription->meta : [];
        $planConfig = $this->resolvePlanConfigForSubscription($subscription);
        $interval = $this->resolveSubscriptionInterval($subscription, $planConfig);
        $noticeDays = $this->resolveCancellationNoticeDays($subscription, $planConfig);

        return [
            'id' => $subscription->id,
            'user_id' => $subscription->user_id,
            'plan' => $subscription->plan,
            'plan_slug' => $meta['plan_slug'] ?? ($planConfig['slug'] ?? null),
            'status' => $subscription->status,
            'amount' => $subscription->amount,
            'currency' => $subscription->currency,
            'payment_method_id' => $subscription->payment_method_id,
            'starts_at' => optional($subscription->starts_at)->toISOString(),
            'ends_at' => optional($subscription->ends_at)->toISOString(),
            'updated_at' => optional($subscription->updated_at)->toISOString(),
            'created_at' => optional($subscription->created_at)->toISOString(),
            'billing_interval_count' => $interval['count'],
            'billing_interval_unit' => $interval['unit'],
            'renewal_mode' => trim((string) ($meta['renewal_mode'] ?? ($planConfig['renewal_mode'] ?? 'auto'))) ?: 'auto',
            'trial_days' => max(0, (int) ($meta['trial_days'] ?? ($planConfig['trial_days'] ?? 0))),
            'cancellation_notice_days' => $noticeDays,
            'plan_details' => $planConfig,
            'meta' => $meta,
        ];
    }

    private function serializeTransaction(UserSubscription $subscription): array
    {
        $planConfig = $this->resolvePlanConfigForSubscription($subscription);

        return [
            'id' => $subscription->id,
            'category' => 'subscription',
            'title' => 'Family Subscription',
            'description' => 'Premium plan charge',
            'status' => $subscription->status,
            'amount' => $subscription->amount,
            'currency' => $subscription->currency,
            'created_at' => optional($subscription->created_at)->toISOString(),
            'updated_at' => optional($subscription->updated_at)->toISOString(),
            'plan' => $subscription->plan,
            'plan_slug' => $planConfig['slug'] ?? null,
            'payment_method_id' => $subscription->payment_method_id,
        ];
    }

    private function resolvePlanConfigForSubscription(
        UserSubscription $subscription,
        ?array $fallback = null
    ): array {
        $meta = is_array($subscription->meta) ? $subscription->meta : [];

        foreach ([
            $meta['plan_setting_id'] ?? null,
            $meta['plan_slug'] ?? null,
            $subscription->plan,
        ] as $candidate) {
            $raw = trim((string) ($candidate ?? ''));
            if ($raw === '') {
                continue;
            }

            return SubscriptionPlanCatalog::resolve($raw, false);
        }

        return $fallback ?: SubscriptionPlanCatalog::resolve(null, false);
    }

    private function resolveSubscriptionInterval(
        UserSubscription $subscription,
        ?array $planConfig = null
    ): array {
        $meta = is_array($subscription->meta) ? $subscription->meta : [];
        $resolvedPlan = $planConfig ?: $this->resolvePlanConfigForSubscription($subscription);

        return [
            'count' => max(1, (int) ($meta['billing_interval_count'] ?? ($resolvedPlan['interval_count'] ?? 1))),
            'unit' => trim((string) ($meta['billing_interval_unit'] ?? ($resolvedPlan['interval_unit'] ?? 'month'))) ?: 'month',
        ];
    }

    private function resolveCancellationNoticeDays(
        UserSubscription $subscription,
        ?array $planConfig = null
    ): int {
        $meta = is_array($subscription->meta) ? $subscription->meta : [];
        if (isset($meta['cancellation_notice_days']) && is_numeric((string) $meta['cancellation_notice_days'])) {
            return max(0, (int) $meta['cancellation_notice_days']);
        }

        $resolvedPlan = $planConfig ?: $this->resolvePlanConfigForSubscription($subscription);

        return max(0, (int) ($resolvedPlan['cancellation_notice_days'] ?? self::CANCELLATION_NOTICE_DAYS));
    }

    private function mergeMeta(UserSubscription $subscription, array $updates): array
    {
        $existing = is_array($subscription->meta) ? $subscription->meta : [];

        return array_merge($existing, $updates);
    }

    private function synchronizeLifecycle(UserSubscription $subscription): UserSubscription
    {
        $endsAt = $subscription->ends_at;
        if (! $endsAt || ! in_array($subscription->status, ['active', 'paused', 'trialing', 'renewing'], true) || $endsAt->isFuture()) {
            return $subscription;
        }

        $meta = is_array($subscription->meta) ? $subscription->meta : [];
        $hasScheduledCancellation = $this->parseMetaDate($meta['cancel_effective_at'] ?? null) !== null;

        $subscription->status = $hasScheduledCancellation ? 'canceled' : 'inactive';
        $subscription->save();

        return $subscription->fresh() ?? $subscription;
    }

    private function parseMetaDate(mixed $value): ?Carbon
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        try {
            return Carbon::parse($raw);
        } catch (\Throwable) {
            return null;
        }
    }
}
