<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Models\AppData\SubscriptionPlanSetting;
use App\Support\AppDataHelper;
use App\Support\AdminAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class AdminSubscriptionController extends Controller
{
    public function index(): JsonResponse
    {
        $users = AppDataHelper::hasTable('users')
            ? AppUser::query()->get(['id', 'user_id', 'name', 'email', 'role'])->values()
            : collect();

        $userIndex = $this->buildUserIndex($users);
        $configuredPlans = $this->configuredPlans();
        $subscriptions = $this->subscriptions();
        $currentSubscribers = $this->currentSubscribers($subscriptions, $userIndex, $configuredPlans);

        $subscriptionIndex = $subscriptions->keyBy(fn (object $row) => (int) ($row->id ?? 0));
        $latestSubscriptionByUser = $subscriptions
            ->sortByDesc(fn (object $row) => $this->resolveSortTimestamp(
                $row->updated_at ?? $row->created_at ?? $row->starts_at ?? null
            ))
            ->groupBy(fn (object $row) => $this->normalizeLookupKey($row->user_id ?? null))
            ->map(fn (Collection $items) => $items->first());

        $transactions = $this->transactions($userIndex, $subscriptionIndex, $latestSubscriptionByUser);
        $successfulTransactions = $transactions
            ->filter(fn (array $row): bool => (bool) ($row['is_successful'] ?? false))
            ->values();

        return response()->json([
            'data' => [
                'summary' => $this->buildSummary($transactions, $successfulTransactions, $currentSubscribers),
                'plans' => $this->buildPlanRows($configuredPlans, $successfulTransactions, $currentSubscribers),
                'active_subscribers' => $currentSubscribers->all(),
                'transactions' => $transactions->all(),
            ],
        ]);
    }

    public function storePlan(Request $request): JsonResponse
    {
        if (! AppDataHelper::hasTable('subscription_plan_settings')) {
            return response()->json(['message' => 'Subscription plan storage is unavailable.'], 503);
        }

        $payload = $this->validatePlanPayload($request);
        $slug = $this->prepareSlug($payload['slug'] ?? null, $payload['name']);

        if (SubscriptionPlanSetting::query()->whereRaw('LOWER(slug) = ?', [strtolower($slug)])->exists()) {
            return response()->json(['message' => 'A plan with this slug already exists.'], 422);
        }

        if (($payload['is_default'] ?? false) && ! ($payload['is_active'] ?? true)) {
            return response()->json(['message' => 'An inactive plan cannot be the default plan.'], 422);
        }

        $plan = new SubscriptionPlanSetting();
        $this->fillPlan($plan, $payload, $slug);
        $plan->save();
        $this->synchronizeDefaultPlan($plan->fresh());
        $freshPlan = $plan->fresh();

        AdminAuditLogger::log([
            'category' => 'verification',
            'action' => 'created subscription plan',
            'target_type' => 'subscription_plan',
            'target_id' => (string) $freshPlan->id,
            'target_label' => $freshPlan->name,
            'before' => null,
            'after' => $this->serializeConfiguredPlan($freshPlan),
            'meta' => [
                'event' => 'subscription_plan_created',
            ],
        ], $request);

        return response()->json([
            'message' => 'Subscription plan created successfully.',
            'data' => $this->serializeConfiguredPlan($freshPlan),
        ], 201);
    }

    public function updatePlan(Request $request, int $plan): JsonResponse
    {
        if (! AppDataHelper::hasTable('subscription_plan_settings')) {
            return response()->json(['message' => 'Subscription plan storage is unavailable.'], 503);
        }

        $planSetting = SubscriptionPlanSetting::query()->find($plan);
        if (! $planSetting) {
            return response()->json(['message' => 'Subscription plan not found.'], 404);
        }

        $payload = $this->validatePlanPayload($request);
        $slug = $this->prepareSlug($payload['slug'] ?? $planSetting->slug, $payload['name']);

        if (
            SubscriptionPlanSetting::query()
                ->whereKeyNot($planSetting->id)
                ->whereRaw('LOWER(slug) = ?', [strtolower($slug)])
                ->exists()
        ) {
            return response()->json(['message' => 'A plan with this slug already exists.'], 422);
        }

        if (($payload['is_default'] ?? $planSetting->is_default) && ! ($payload['is_active'] ?? $planSetting->is_active)) {
            return response()->json(['message' => 'An inactive plan cannot be the default plan.'], 422);
        }

        $before = $this->serializeConfiguredPlan($planSetting);
        $this->fillPlan($planSetting, $payload, $slug);
        $planSetting->save();
        $this->synchronizeDefaultPlan($planSetting->fresh());
        $freshPlan = $planSetting->fresh();

        AdminAuditLogger::log([
            'category' => 'verification',
            'action' => 'updated subscription plan',
            'target_type' => 'subscription_plan',
            'target_id' => (string) $freshPlan->id,
            'target_label' => $freshPlan->name,
            'before' => $before,
            'after' => $this->serializeConfiguredPlan($freshPlan),
            'meta' => [
                'event' => 'subscription_plan_updated',
            ],
        ], $request);

        return response()->json([
            'message' => 'Subscription plan updated successfully.',
            'data' => $this->serializeConfiguredPlan($freshPlan),
        ]);
    }

    private function transactions(
        Collection $userIndex,
        Collection $subscriptionIndex,
        Collection $latestSubscriptionByUser,
    ): Collection {
        if (! AppDataHelper::hasTable('subscription_purchases')) {
            return collect();
        }

        return DB::connection('app_data')
            ->table('subscription_purchases')
            ->orderByDesc('purchased_at')
            ->orderByDesc('id')
            ->limit(300)
            ->get()
            ->map(function (object $row) use ($userIndex, $subscriptionIndex, $latestSubscriptionByUser): array {
                $user = $this->resolveUser($userIndex, $row->user_id ?? null);
                $subscription = $subscriptionIndex->get((int) ($row->subscription_id ?? 0))
                    ?? $latestSubscriptionByUser->get($this->normalizeLookupKey($row->user_id ?? null));

                $purchaseMeta = $this->jsonArray($row->meta ?? null);
                $subscriptionMeta = $this->jsonArray($subscription->meta ?? null);
                $plan = trim((string) ($row->plan ?: ($subscription->plan ?? 'Premium subscription')));
                $rawStatus = trim((string) ($row->stripe_payment_status ?: 'completed'));
                $amount = round((float) ($row->amount ?? 0), 2);
                $currency = strtoupper(trim((string) ($row->currency ?: ($subscription->currency ?? 'USD')))) ?: 'USD';
                $subscriptionAmount = $subscription && is_numeric((string) ($subscription->amount ?? null))
                    ? round((float) $subscription->amount, 2)
                    : null;
                $effectiveCost = $amount > 0 ? $amount : ($subscriptionAmount ?? 0.0);

                return [
                    'id' => 'subscription-'.$row->id,
                    'reference' => 'SUB-'.$row->id,
                    'subscription_purchase_id' => (int) $row->id,
                    'subscription_id' => $row->subscription_id ? (int) $row->subscription_id : null,
                    'plan' => $plan !== '' ? $plan : 'Premium subscription',
                    'plan_slug' => trim((string) ($purchaseMeta['plan_slug'] ?? $subscriptionMeta['plan_slug'] ?? '')) ?: null,
                    'amount' => $amount,
                    'cost' => round($effectiveCost, 2),
                    'currency' => $currency,
                    'payment_status' => $rawStatus,
                    'status' => $subscription?->status ?: $rawStatus,
                    'is_successful' => $this->isSuccessfulPaymentStatus($rawStatus),
                    'user_id' => $user?->user_id ?: $this->normalizeLookupKey($row->user_id ?? null),
                    'user_name' => $user?->name ?: '-',
                    'user_email' => $user?->email ?: '',
                    'user_role' => $user?->role ?: null,
                    'stripe_payment_intent_id' => $row->stripe_payment_intent_id ?: null,
                    'payment_method_id' => $row->payment_method_id ? (int) $row->payment_method_id : null,
                    'starts_at' => $this->toIsoString($subscription->starts_at ?? null),
                    'ends_at' => $this->toIsoString($subscription->ends_at ?? null),
                    'purchased_at' => $this->toIsoString($row->purchased_at ?? $row->created_at ?? null),
                    'created_at' => $this->toIsoString($row->created_at ?? null),
                    'updated_at' => $this->toIsoString($row->updated_at ?? null),
                ];
            })
            ->values();
    }

    private function subscriptions(): Collection
    {
        if (! AppDataHelper::hasTable('user_subscriptions')) {
            return collect();
        }

        return DB::connection('app_data')
            ->table('user_subscriptions')
            ->get([
                'id',
                'user_id',
                'plan',
                'status',
                'amount',
                'currency',
                'starts_at',
                'ends_at',
                'created_at',
                'updated_at',
                'meta',
            ]);
    }

    private function configuredPlans(): Collection
    {
        if (! AppDataHelper::hasTable('subscription_plan_settings')) {
            return collect([$this->fallbackPlan()]);
        }

        $plans = SubscriptionPlanSetting::query()
            ->orderByDesc('is_default')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(fn (SubscriptionPlanSetting $plan): array => $this->serializeConfiguredPlan($plan));

        return $plans->isNotEmpty() ? $plans : collect([$this->fallbackPlan()]);
    }

    private function currentSubscribers(
        Collection $subscriptions,
        Collection $userIndex,
        Collection $configuredPlans,
    ): Collection {
        $planIndex = $configuredPlans->keyBy(
            fn (array $plan): string => $this->normalizePlanKey($plan['slug'] ?? null, $plan['name'] ?? null)
        );

        return $subscriptions
            ->sortByDesc(fn (object $row) => $this->resolveSortTimestamp(
                $row->updated_at ?? $row->created_at ?? $row->starts_at ?? null
            ))
            ->groupBy(fn (object $row) => $this->normalizeLookupKey($row->user_id ?? null))
            ->map(fn (Collection $items) => $items->first())
            ->filter(fn (object $row): bool => $this->isCurrentSubscriptionStatus((string) ($row->status ?? '')))
            ->map(function (object $row) use ($userIndex, $planIndex): array {
                $user = $this->resolveUser($userIndex, $row->user_id ?? null);
                $meta = $this->jsonArray($row->meta ?? null);
                $planName = trim((string) ($row->plan ?? 'Premium Family')) ?: 'Premium Family';
                $planSlug = trim((string) ($meta['plan_slug'] ?? '')) ?: null;
                $configuredPlan = $this->resolveConfiguredPlan($planIndex, $planSlug, $planName);
                $cancelEffectiveAt = $this->toIsoString($meta['cancel_effective_at'] ?? null);

                return [
                    'id' => 'subscriber-'.$row->id,
                    'subscription_id' => (int) $row->id,
                    'user_id' => $user?->user_id ?: $this->normalizeLookupKey($row->user_id ?? null),
                    'user_name' => $user?->name ?: '-',
                    'user_email' => $user?->email ?: '',
                    'plan' => $planName,
                    'plan_slug' => $planSlug ?: ($configuredPlan['slug'] ?? null),
                    'status' => strtolower(trim((string) ($row->status ?? 'active'))) ?: 'active',
                    'display_status' => $this->displayCurrentSubscriberStatus((string) ($row->status ?? ''), $cancelEffectiveAt),
                    'status_tone' => $this->statusTone((string) ($row->status ?? ''), $cancelEffectiveAt),
                    'amount' => round((float) ($row->amount ?? 0), 2),
                    'currency' => strtoupper(trim((string) ($row->currency ?? ($configuredPlan['currency'] ?? 'USD')))) ?: 'USD',
                    'starts_at' => $this->toIsoString($row->starts_at ?? null),
                    'ends_at' => $this->toIsoString($row->ends_at ?? null),
                    'cancel_effective_at' => $cancelEffectiveAt,
                    'billing_label' => $configuredPlan['billing_label'] ?? 'Every month',
                    'renewal_mode' => $meta['renewal_mode'] ?? ($configuredPlan['renewal_mode'] ?? 'auto'),
                    'renewal_label' => $configuredPlan['renewal_label'] ?? 'Auto renew',
                    'trial_days' => max(0, (int) ($meta['trial_days'] ?? ($configuredPlan['trial_days'] ?? 0))),
                    'cancellation_notice_days' => max(
                        0,
                        (int) ($meta['cancellation_notice_days'] ?? ($configuredPlan['cancellation_notice_days'] ?? 30))
                    ),
                ];
            })
            ->values();
    }

    private function buildSummary(
        Collection $transactions,
        Collection $successfulTransactions,
        Collection $currentSubscribers,
    ): array {
        $currency = $this->resolveCurrency($transactions, $currentSubscribers);
        $averageCost = $successfulTransactions->count() > 0
            ? round($successfulTransactions->avg('cost'), 2)
            : 0.0;

        return [
            'total_earnings' => round($successfulTransactions->sum('amount'), 2),
            'recurring_revenue' => round((float) $currentSubscribers->sum('amount'), 2),
            'average_cost' => $averageCost,
            'active_subscriptions' => $currentSubscribers->count(),
            'successful_transactions' => $successfulTransactions->count(),
            'total_transactions' => $transactions->count(),
            'currency' => $currency,
        ];
    }

    private function buildPlanRows(
        Collection $configuredPlans,
        Collection $successfulTransactions,
        Collection $currentSubscribers,
    ): array {
        $transactionGroups = $successfulTransactions->groupBy(
            fn (array $row): string => $this->normalizePlanKey($row['plan_slug'] ?? null, $row['plan'] ?? null)
        );
        $subscriberGroups = $currentSubscribers->groupBy(
            fn (array $row): string => $this->normalizePlanKey($row['plan_slug'] ?? null, $row['plan'] ?? null)
        );

        $knownKeys = collect();
        $configuredRows = $configuredPlans->map(function (array $plan) use (
            $transactionGroups,
            $subscriberGroups,
            $knownKeys
        ): array {
            $key = $this->normalizePlanKey($plan['slug'] ?? null, $plan['name'] ?? null);
            $knownKeys->push($key);

            return $this->mergePlanStats(
                $plan,
                $transactionGroups->get($key, collect()),
                $subscriberGroups->get($key, collect()),
                'configured',
            );
        });

        $legacyRows = $transactionGroups
            ->filter(fn (Collection $items, string $key): bool => ! $knownKeys->contains($key))
            ->map(function (Collection $items, string $key) use ($subscriberGroups): array {
                $planName = trim((string) ($items->first()['plan'] ?? 'Legacy subscription')) ?: 'Legacy subscription';
                $planSlug = trim((string) ($items->first()['plan_slug'] ?? '')) ?: null;

                return $this->mergePlanStats(
                    [
                        'id' => null,
                        'slug' => $planSlug,
                        'name' => $planName,
                        'description' => 'Historical subscription plan',
                        'amount' => round((float) ($items->avg('cost') ?? 0), 2),
                        'currency' => strtoupper(trim((string) ($items->first()['currency'] ?? 'USD'))) ?: 'USD',
                        'interval_unit' => 'month',
                        'interval_count' => 1,
                        'billing_label' => 'Every month',
                        'trial_days' => 0,
                        'renewal_mode' => 'auto',
                        'renewal_label' => 'Auto renew',
                        'cancellation_notice_days' => 30,
                        'stripe_price_id' => null,
                        'features' => [],
                        'is_active' => false,
                        'is_default' => false,
                        'sort_order' => 999,
                        'meta' => [],
                    ],
                    $items,
                    $subscriberGroups->get($key, collect()),
                    'legacy',
                );
            })
            ->values();

        return $configuredRows
            ->concat($legacyRows)
            ->sortBy([
                ['is_default', 'desc'],
                ['sort_order', 'asc'],
                ['total_earnings', 'desc'],
                ['name', 'asc'],
            ])
            ->values()
            ->all();
    }

    private function mergePlanStats(
        array $plan,
        Collection $transactions,
        Collection $subscribers,
        string $source,
    ): array {
        $averageCost = $transactions->count() > 0 ? round((float) $transactions->avg('cost'), 2) : 0.0;

        return [
            ...$plan,
            'source' => $source,
            'transaction_count' => $transactions->count(),
            'active_subscriptions' => $subscribers->count(),
            'total_earnings' => round((float) $transactions->sum('amount'), 2),
            'recurring_revenue' => round((float) $subscribers->sum('amount'), 2),
            'average_cost' => $averageCost,
        ];
    }

    private function serializeConfiguredPlan(SubscriptionPlanSetting $plan): array
    {
        $intervalCount = max(1, (int) ($plan->interval_count ?? 1));
        $intervalUnit = $this->normalizeIntervalUnit($plan->interval_unit ?? null);
        $renewalMode = $this->normalizeRenewalMode($plan->renewal_mode ?? null);

        return [
            'id' => (int) $plan->id,
            'slug' => trim((string) $plan->slug),
            'name' => trim((string) $plan->name) !== '' ? trim((string) $plan->name) : 'Premium Family',
            'description' => trim((string) ($plan->description ?? '')) ?: null,
            'amount' => round((float) ($plan->amount ?? 0), 2),
            'currency' => strtoupper(trim((string) ($plan->currency ?? 'USD'))) ?: 'USD',
            'interval_unit' => $intervalUnit,
            'interval_count' => $intervalCount,
            'billing_label' => $this->billingLabel($intervalCount, $intervalUnit),
            'trial_days' => max(0, (int) ($plan->trial_days ?? 0)),
            'renewal_mode' => $renewalMode,
            'renewal_label' => $this->renewalLabel($renewalMode),
            'cancellation_notice_days' => max(0, (int) ($plan->cancellation_notice_days ?? 30)),
            'stripe_price_id' => trim((string) ($plan->stripe_price_id ?? '')) ?: null,
            'features' => $this->normalizeFeatures($plan->features),
            'is_active' => (bool) $plan->is_active,
            'is_default' => (bool) $plan->is_default,
            'sort_order' => (int) ($plan->sort_order ?? 0),
            'meta' => is_array($plan->meta) ? $plan->meta : [],
        ];
    }

    private function fallbackPlan(): array
    {
        return [
            'id' => null,
            'slug' => 'premium-family',
            'name' => 'Premium Family',
            'description' => 'Unlimited posts, priority matches, and concierge support.',
            'amount' => 19.99,
            'currency' => 'USD',
            'interval_unit' => 'month',
            'interval_count' => 1,
            'billing_label' => 'Every month',
            'trial_days' => 0,
            'renewal_mode' => 'auto',
            'renewal_label' => 'Auto renew',
            'cancellation_notice_days' => 30,
            'stripe_price_id' => null,
            'features' => [
                'Unlimited job posts & edits',
                'Priority Syttr matching',
                'Concierge chat support',
            ],
            'is_active' => true,
            'is_default' => true,
            'sort_order' => 0,
            'meta' => [],
        ];
    }

    private function validatePlanPayload(Request $request): array
    {
        return $request->validate([
            'slug' => ['nullable', 'string', 'max:100'],
            'name' => ['required', 'string', 'max:150'],
            'description' => ['nullable', 'string', 'max:1500'],
            'amount' => ['required', 'numeric', 'min:0'],
            'currency' => ['required', 'string', 'max:10'],
            'interval_unit' => ['required', 'string', 'in:day,week,month,year'],
            'interval_count' => ['required', 'integer', 'min:1', 'max:365'],
            'trial_days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'renewal_mode' => ['required', 'string', 'in:auto,manual,fixed_term'],
            'cancellation_notice_days' => ['nullable', 'integer', 'min:0', 'max:365'],
            'stripe_price_id' => ['nullable', 'string', 'max:255'],
            'features' => ['nullable', 'array'],
            'features.*' => ['nullable', 'string', 'max:160'],
            'is_active' => ['nullable', 'boolean'],
            'is_default' => ['nullable', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:9999'],
        ]);
    }

    private function fillPlan(SubscriptionPlanSetting $plan, array $payload, string $slug): void
    {
        $plan->slug = $slug;
        $plan->name = trim((string) $payload['name']);
        $plan->description = trim((string) ($payload['description'] ?? '')) ?: null;
        $plan->amount = round((float) $payload['amount'], 2);
        $plan->currency = strtoupper(trim((string) ($payload['currency'] ?? 'USD'))) ?: 'USD';
        $plan->interval_unit = $this->normalizeIntervalUnit($payload['interval_unit'] ?? 'month');
        $plan->interval_count = max(1, (int) ($payload['interval_count'] ?? 1));
        $plan->trial_days = max(0, (int) ($payload['trial_days'] ?? 0));
        $plan->renewal_mode = $this->normalizeRenewalMode($payload['renewal_mode'] ?? 'auto');
        $plan->cancellation_notice_days = max(
            0,
            (int) ($payload['cancellation_notice_days'] ?? 30)
        );
        $plan->stripe_price_id = trim((string) ($payload['stripe_price_id'] ?? '')) ?: null;
        $plan->features = $this->normalizeFeatures($payload['features'] ?? []);
        $plan->is_active = (bool) ($payload['is_active'] ?? true);
        $plan->is_default = $plan->is_active ? (bool) ($payload['is_default'] ?? false) : false;
        $plan->sort_order = max(0, (int) ($payload['sort_order'] ?? 0));
        $plan->meta = array_merge(
            is_array($plan->meta) ? $plan->meta : [],
            ['managed_by' => 'admin-backend']
        );
    }

    private function synchronizeDefaultPlan(?SubscriptionPlanSetting $preferred = null): void
    {
        if (! AppDataHelper::hasTable('subscription_plan_settings')) {
            return;
        }

        $activePlans = SubscriptionPlanSetting::query()
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        if ($activePlans->isEmpty()) {
            SubscriptionPlanSetting::query()->update(['is_default' => false]);
            return;
        }

        $target = null;
        if ($preferred && $preferred->is_active && $preferred->is_default) {
            $target = $preferred->fresh();
        }

        if (! $target) {
            $target = $activePlans->firstWhere('is_default', true);
        }

        if (! $target && $preferred && $preferred->is_active) {
            $target = $preferred->fresh();
        }

        if (! $target) {
            $target = $activePlans->first();
        }

        if (! $target) {
            return;
        }

        SubscriptionPlanSetting::query()
            ->whereKeyNot($target->id)
            ->update(['is_default' => false]);

        if (! $target->is_default) {
            $target->is_default = true;
            $target->save();
        }
    }

    private function prepareSlug(?string $slug, string $name): string
    {
        $candidate = trim((string) ($slug ?? ''));
        $normalized = Str::slug($candidate !== '' ? $candidate : $name);

        return $normalized !== '' ? $normalized : 'subscription-plan';
    }

    private function buildUserIndex(Collection $users): Collection
    {
        $index = collect();

        foreach ($users as $user) {
            $publicKey = $this->normalizeLookupKey($user->user_id ?? null);
            $internalKey = $this->normalizeLookupKey($user->id ?? null);

            if ($publicKey !== '') {
                $index->put($publicKey, $user);
            }
            if ($internalKey !== '') {
                $index->put($internalKey, $user);
            }
        }

        return $index;
    }

    private function resolveUser(Collection $userIndex, mixed $identifier): ?AppUser
    {
        $key = $this->normalizeLookupKey($identifier);
        if ($key === '') {
            return null;
        }

        $user = $userIndex->get($key);

        return $user instanceof AppUser ? $user : null;
    }

    private function resolveConfiguredPlan(Collection $planIndex, ?string $planSlug, string $planName): array
    {
        $candidates = [
            $this->normalizePlanKey($planSlug, null),
            $this->normalizePlanKey(null, $planName),
        ];

        foreach ($candidates as $candidate) {
            if ($candidate === '') {
                continue;
            }

            $resolved = $planIndex->get($candidate);
            if (is_array($resolved)) {
                return $resolved;
            }
        }

        return [
            ...$this->fallbackPlan(),
            'slug' => $planSlug ?: null,
            'name' => $planName,
        ];
    }

    private function normalizeLookupKey(mixed $value): string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return '';
        }

        return ctype_digit($raw) ? $raw : strtoupper($raw);
    }

    private function normalizePlanKey(mixed $slug, mixed $name): string
    {
        $rawSlug = strtolower(trim((string) ($slug ?? '')));
        if ($rawSlug !== '') {
            return $rawSlug;
        }

        return strtolower(trim((string) ($name ?? '')));
    }

    private function normalizeIntervalUnit(mixed $value): string
    {
        return match (strtolower(trim((string) ($value ?? 'month')))) {
            'day' => 'day',
            'week' => 'week',
            'year' => 'year',
            default => 'month',
        };
    }

    private function normalizeRenewalMode(mixed $value): string
    {
        return match (strtolower(trim((string) ($value ?? 'auto')))) {
            'manual' => 'manual',
            'fixed_term' => 'fixed_term',
            default => 'auto',
        };
    }

    private function normalizeFeatures(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map(
                static fn (mixed $item): string => trim((string) $item),
                $value
            )));
        }

        if (is_string($value)) {
            return array_values(array_filter(array_map(
                static fn (string $line): string => trim($line),
                preg_split('/\r\n|\r|\n/', $value) ?: []
            )));
        }

        return [];
    }

    private function billingLabel(int $count, string $unit): string
    {
        $intervalCount = max(1, $count);
        $intervalUnit = $this->normalizeIntervalUnit($unit);

        if ($intervalCount === 1) {
            return match ($intervalUnit) {
                'day' => 'Daily',
                'week' => 'Weekly',
                'year' => 'Yearly',
                default => 'Every month',
            };
        }

        return 'Every '.$intervalCount.' '.$intervalUnit.'s';
    }

    private function renewalLabel(string $mode): string
    {
        return match ($this->normalizeRenewalMode($mode)) {
            'manual' => 'Manual renew',
            'fixed_term' => 'Fixed term',
            default => 'Auto renew',
        };
    }

    private function resolveCurrency(Collection $transactions, Collection $currentSubscribers): string
    {
        $transactionCurrency = strtoupper(trim((string) ($transactions->first()['currency'] ?? '')));
        if ($transactionCurrency !== '') {
            return $transactionCurrency;
        }

        $subscriptionCurrency = strtoupper(trim((string) ($currentSubscribers->first()['currency'] ?? '')));

        return $subscriptionCurrency !== '' ? $subscriptionCurrency : 'USD';
    }

    private function isSuccessfulPaymentStatus(string $value): bool
    {
        $normalized = strtolower(trim($value));
        if ($normalized === '') {
            return true;
        }

        return in_array($normalized, ['succeeded', 'success', 'paid', 'completed', 'complete', 'active'], true);
    }

    private function isCurrentSubscriptionStatus(string $value): bool
    {
        return in_array(strtolower(trim($value)), ['active', 'paused', 'trialing', 'renewing'], true);
    }

    private function displayCurrentSubscriberStatus(string $status, ?string $cancelEffectiveAt): string
    {
        if ($cancelEffectiveAt) {
            return 'Cancellation scheduled';
        }

        return match (strtolower(trim($status))) {
            'paused' => 'Paused',
            'trialing' => 'Trialing',
            'renewing' => 'Renewing',
            default => 'Active',
        };
    }

    private function statusTone(string $status, ?string $cancelEffectiveAt): string
    {
        if ($cancelEffectiveAt) {
            return 'warning';
        }

        return strtolower(trim($status)) === 'paused' ? 'neutral' : 'positive';
    }

    private function jsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if (is_string($value)) {
            $decoded = json_decode($value, true);
            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }

    private function resolveSortTimestamp(mixed $value): int
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return 0;
        }

        try {
            return Carbon::parse($raw)->timestamp;
        } catch (\Throwable) {
            return 0;
        }
    }

    private function toIsoString(mixed $value): ?string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        try {
            return Carbon::parse($raw)->toISOString();
        } catch (\Throwable) {
            return $raw;
        }
    }
}
