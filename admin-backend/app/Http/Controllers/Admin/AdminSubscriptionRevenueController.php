<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Support\AppDataHelper;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class AdminSubscriptionRevenueController extends Controller
{
    public function index(): JsonResponse
    {
        $users = AppDataHelper::hasTable('users')
            ? AppUser::query()->get(['id', 'user_id', 'name', 'email', 'role'])->values()
            : collect();

        $userIndex = $this->buildUserIndex($users);
        $subscriptions = $this->subscriptions();
        $activeSubscriptions = $subscriptions
            ->filter(fn (object $row): bool => $this->isActiveSubscriptionStatus((string) ($row->status ?? '')))
            ->values();

        $subscriptionIndex = $subscriptions->keyBy(fn (object $row) => (int) $row->id);
        $latestSubscriptionByUser = $subscriptions
            ->sortByDesc(fn (object $row) => strtotime((string) ($row->updated_at ?? $row->created_at ?? $row->starts_at ?? '')) ?: 0)
            ->groupBy(fn (object $row) => strtoupper(trim((string) ($row->user_id ?? ''))))
            ->map(fn (Collection $items) => $items->first());

        $transactions = $this->transactions($userIndex, $subscriptionIndex, $latestSubscriptionByUser);
        $successfulTransactions = $transactions
            ->filter(fn (array $row): bool => (bool) ($row['is_successful'] ?? false))
            ->values();

        $summary = $this->buildSummary($transactions, $successfulTransactions, $activeSubscriptions);
        $plans = $this->buildPlanBreakdown($successfulTransactions, $activeSubscriptions);

        return response()->json([
            'data' => [
                'summary' => $summary,
                'plans' => $plans,
                'transactions' => $transactions->all(),
            ],
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
            ->limit(200)
            ->get()
            ->map(function (object $row) use ($userIndex, $subscriptionIndex, $latestSubscriptionByUser): array {
                $user = $this->resolveUser($userIndex, $row->user_id ?? null);
                $subscription = $subscriptionIndex->get((int) ($row->subscription_id ?? 0))
                    ?? $latestSubscriptionByUser->get($this->normalizeLookupKey($row->user_id ?? null));

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
            ]);
    }

    private function buildSummary(
        Collection $transactions,
        Collection $successfulTransactions,
        Collection $activeSubscriptions,
    ): array {
        $currency = $this->resolveCurrency($transactions, $activeSubscriptions);
        $averageCost = $successfulTransactions->count() > 0
            ? round($successfulTransactions->avg('cost'), 2)
            : 0.0;

        $recurringRevenue = $activeSubscriptions
            ->map(fn (object $row): float => is_numeric((string) ($row->amount ?? null)) ? (float) $row->amount : 0.0)
            ->sum();

        return [
            'total_earnings' => round($successfulTransactions->sum('amount'), 2),
            'recurring_revenue' => round((float) $recurringRevenue, 2),
            'average_cost' => $averageCost,
            'active_subscriptions' => $activeSubscriptions->count(),
            'successful_transactions' => $successfulTransactions->count(),
            'total_transactions' => $transactions->count(),
            'currency' => $currency,
        ];
    }

    private function buildPlanBreakdown(Collection $successfulTransactions, Collection $activeSubscriptions): array
    {
        $activeByPlan = $activeSubscriptions
            ->groupBy(fn (object $row) => $this->normalizePlan($row->plan ?? null));

        return $successfulTransactions
            ->groupBy(fn (array $row) => $this->normalizePlan($row['plan'] ?? null))
            ->map(function (Collection $items, string $plan) use ($activeByPlan): array {
                $activeItems = $activeByPlan->get($plan, collect());
                $currency = strtoupper(trim((string) ($items->first()['currency'] ?? $activeItems->first()->currency ?? 'USD'))) ?: 'USD';

                return [
                    'plan' => $plan,
                    'total_earnings' => round($items->sum('amount'), 2),
                    'average_cost' => round((float) $items->avg('cost'), 2),
                    'transaction_count' => $items->count(),
                    'active_subscriptions' => $activeItems->count(),
                    'recurring_revenue' => round((float) $activeItems->sum(function (object $row): float {
                        return is_numeric((string) ($row->amount ?? null)) ? (float) $row->amount : 0.0;
                    }), 2),
                    'currency' => $currency,
                ];
            })
            ->sortByDesc('total_earnings')
            ->values()
            ->all();
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

    private function normalizeLookupKey(mixed $value): string
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return '';
        }

        return ctype_digit($raw) ? $raw : strtoupper($raw);
    }

    private function normalizePlan(mixed $value): string
    {
        $raw = trim((string) ($value ?? ''));
        return $raw !== '' ? $raw : 'Premium subscription';
    }

    private function resolveCurrency(Collection $transactions, Collection $activeSubscriptions): string
    {
        $transactionCurrency = strtoupper(trim((string) ($transactions->first()['currency'] ?? '')));
        if ($transactionCurrency !== '') {
            return $transactionCurrency;
        }

        $subscriptionCurrency = strtoupper(trim((string) ($activeSubscriptions->first()->currency ?? '')));
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

    private function isActiveSubscriptionStatus(string $value): bool
    {
        return in_array(strtolower(trim($value)), ['active', 'trialing', 'renewing'], true);
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
