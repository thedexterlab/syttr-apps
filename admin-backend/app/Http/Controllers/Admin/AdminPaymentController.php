<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Support\AppDataHelper;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class AdminPaymentController extends Controller
{
    public function index(): JsonResponse
    {
        if (! AppDataHelper::hasTable('users')) {
            return response()->json([
                'data' => [],
            ]);
        }

        $users = AppUser::query()
            ->get(['id', 'user_id', 'name', 'email', 'role'])
            ->values();
        $userIndex = $this->buildUserIndex($users);

        $items = collect()
            ->concat($this->walletTransactions($userIndex))
            ->concat($this->subscriptionPurchases($userIndex))
            ->concat($this->otherStripeTransactions($userIndex))
            ->sortByDesc(fn (array $row) => strtotime((string) ($row['created_at'] ?? '')) ?: 0)
            ->values()
            ->all();

        return response()->json([
            'data' => $items,
        ]);
    }

    private function walletTransactions(Collection $userIndex): Collection
    {
        if (! AppDataHelper::hasTable('wallet_transactions')) {
            return collect();
        }

        return DB::connection('app_data')
            ->table('wallet_transactions')
            ->orderByDesc('created_at')
            ->limit(200)
            ->get()
            ->map(function (object $row) use ($userIndex): array {
                $user = $this->resolveUser($userIndex, $row->user_id ?? null);
                $counterparty = $this->resolveUser($userIndex, $row->counterparty_user_id ?? null);

                return [
                    'id' => 'wallet-'.$row->id,
                    'reference' => 'WT-'.$row->id,
                    'source' => 'wallet_transaction',
                    'category' => $row->category ?: 'other',
                    'type' => $row->type ?: 'wallet',
                    'direction' => $row->direction ?: null,
                    'status' => $row->status ?: 'pending',
                    'amount' => round((float) ($row->amount ?? 0), 2),
                    'currency' => strtoupper(trim((string) ($row->currency ?? 'USD'))) ?: 'USD',
                    'description' => $row->description ?: 'Wallet transaction',
                    'user_id' => $user?->user_id ?: $this->normalizeLookupKey($row->user_id ?? null),
                    'user_name' => $user?->name ?: '-',
                    'user_email' => $user?->email ?: '',
                    'user_role' => $user?->role ?: null,
                    'counterparty_user_id' => $counterparty?->user_id ?: $this->normalizeLookupKey($row->counterparty_user_id ?? null),
                    'counterparty_name' => $counterparty?->name ?: '',
                    'job_id' => $row->job_id ?? null,
                    'created_at' => $this->toIsoString($row->created_at ?? null),
                    'updated_at' => $this->toIsoString($row->updated_at ?? null),
                ];
            });
    }

    private function subscriptionPurchases(Collection $userIndex): Collection
    {
        if (! AppDataHelper::hasTable('subscription_purchases')) {
            return collect();
        }

        return DB::connection('app_data')
            ->table('subscription_purchases')
            ->orderByDesc('purchased_at')
            ->limit(120)
            ->get()
            ->map(function (object $row) use ($userIndex): array {
                $user = $this->resolveUser($userIndex, $row->user_id ?? null);

                return [
                    'id' => 'subscription-'.$row->id,
                    'reference' => 'SUB-'.$row->id,
                    'source' => 'subscription_purchase',
                    'category' => 'subscription',
                    'type' => 'subscription_charge',
                    'direction' => 'debit',
                    'status' => $row->stripe_payment_status ?: 'completed',
                    'amount' => round((float) ($row->amount ?? 0), 2),
                    'currency' => strtoupper(trim((string) ($row->currency ?? 'USD'))) ?: 'USD',
                    'description' => trim((string) ($row->plan ?: 'Premium subscription')),
                    'user_id' => $user?->user_id ?: $this->normalizeLookupKey($row->user_id ?? null),
                    'user_name' => $user?->name ?: '-',
                    'user_email' => $user?->email ?: '',
                    'user_role' => $user?->role ?: null,
                    'counterparty_user_id' => null,
                    'counterparty_name' => '',
                    'job_id' => null,
                    'created_at' => $this->toIsoString($row->purchased_at ?? $row->created_at ?? null),
                    'updated_at' => $this->toIsoString($row->updated_at ?? null),
                ];
            });
    }

    private function otherStripeTransactions(Collection $userIndex): Collection
    {
        if (! AppDataHelper::hasTable('stripe_transactions')) {
            return collect();
        }

        return DB::connection('app_data')
            ->table('stripe_transactions')
            ->whereNotIn('category', ['job', 'subscription', 'webhook'])
            ->whereIn('status', ['succeeded', 'paid', 'completed', 'processing', 'requires_capture'])
            ->orderByDesc('created_at')
            ->limit(120)
            ->get()
            ->map(function (object $row) use ($userIndex): array {
                $user = $this->resolveUser($userIndex, $row->user_id ?? null);

                return [
                    'id' => 'stripe-'.$row->id,
                    'reference' => 'ST-'.$row->id,
                    'source' => 'stripe_transaction',
                    'category' => $row->category ?: 'other',
                    'type' => $row->type ?: 'stripe_charge',
                    'direction' => 'debit',
                    'status' => $row->status ?: 'processing',
                    'amount' => round((float) ($row->amount ?? 0), 2),
                    'currency' => strtoupper(trim((string) ($row->currency ?? 'USD'))) ?: 'USD',
                    'description' => $row->description ?: 'Stripe charge',
                    'user_id' => $user?->user_id ?: $this->normalizeLookupKey($row->user_id ?? null),
                    'user_name' => $user?->name ?: '-',
                    'user_email' => $user?->email ?: '',
                    'user_role' => $user?->role ?: null,
                    'counterparty_user_id' => null,
                    'counterparty_name' => '',
                    'job_id' => $row->job_id ?? null,
                    'created_at' => $this->toIsoString($row->created_at ?? null),
                    'updated_at' => $this->toIsoString($row->updated_at ?? null),
                ];
            });
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
