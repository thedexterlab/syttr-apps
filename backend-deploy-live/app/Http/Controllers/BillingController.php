<?php

namespace App\Http\Controllers;

use App\Models\StripeTransaction;
use App\Models\SubscriptionPurchase;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class BillingController extends Controller
{
    public function history(Request $request): JsonResponse
    {
        return $this->transactions($request);
    }

    public function transactions(Request $request): JsonResponse
    {
        $userId = $this->resolveUserId($request);
        if (! $userId) {
            return response()->json([
                'success' => true,
                'data' => [],
                'transactions' => [],
                'history' => [],
            ]);
        }

        $walletTransactions = Schema::hasTable('wallet_transactions')
            ? WalletTransaction::query()
                ->where('user_id', $userId)
                ->latest()
                ->get()
                ->map(function (WalletTransaction $transaction) {
                    $meta = is_array($transaction->meta) ? $transaction->meta : [];

                    return [
                        'id' => 'wallet-'.$transaction->id,
                        'source' => 'wallet_transaction',
                        'category' => $transaction->category,
                        'type' => $transaction->type,
                        'title' => $transaction->direction === 'debit' ? 'Charge' : 'Credit',
                        'description' => $transaction->description ?: 'Wallet transaction',
                        'amount' => (float) $transaction->amount,
                        'gross_amount' => isset($meta['gross_amount']) ? (float) $meta['gross_amount'] : null,
                        'net_amount' => isset($meta['net_amount']) ? (float) $meta['net_amount'] : null,
                        'stripe_fee_amount' => isset($meta['stripe_fee_amount']) ? (float) $meta['stripe_fee_amount'] : null,
                        'stripe_tax_amount' => isset($meta['stripe_tax_amount']) ? (float) $meta['stripe_tax_amount'] : null,
                        'stripe_processing_fee_amount' => isset($meta['stripe_processing_fee_amount']) ? (float) $meta['stripe_processing_fee_amount'] : null,
                        'currency' => $transaction->currency,
                        'status' => $transaction->status,
                        'direction' => $transaction->direction,
                        'job_id' => $transaction->job_id,
                        'application_id' => $transaction->application_id,
                        'stripe_payment_intent_id' => $transaction->stripe_payment_intent_id,
                        'created_at' => optional($transaction->created_at)->toISOString(),
                        'updated_at' => optional($transaction->updated_at)->toISOString(),
                        'meta' => $meta,
                    ];
                })
            : collect();

        $subscriptionPurchases = SubscriptionPurchase::query()
            ->where('user_id', $userId)
            ->latest('purchased_at')
            ->get()
            ->map(fn (SubscriptionPurchase $purchase) => [
                'id' => 'subscription-'.$purchase->id,
                'source' => 'subscription_purchase',
                'category' => 'subscription',
                'type' => 'subscription_charge',
                'title' => 'Subscription',
                'description' => trim((string) ($purchase->plan ?: 'Premium plan charge')),
                'amount' => (float) $purchase->amount,
                'currency' => $purchase->currency ?: 'usd',
                'status' => $purchase->stripe_payment_status ?: 'completed',
                'direction' => 'debit',
                'subscription_purchase_id' => $purchase->id,
                'stripe_payment_intent_id' => $purchase->stripe_payment_intent_id,
                'created_at' => optional($purchase->purchased_at ?: $purchase->created_at)->toISOString(),
                'updated_at' => optional($purchase->updated_at)->toISOString(),
                'meta' => $purchase->meta,
            ]);

        $otherStripeTransactions = Schema::hasTable('stripe_transactions')
            ? StripeTransaction::query()
                ->where('user_id', $userId)
                ->whereNotIn('category', ['job', 'subscription', 'webhook'])
                ->whereIn('status', ['succeeded', 'paid', 'completed', 'processing', 'requires_capture'])
                ->latest()
                ->get()
                ->map(fn (StripeTransaction $transaction) => [
                    'id' => 'stripe-'.$transaction->id,
                    'source' => 'stripe_transaction',
                    'category' => $transaction->category,
                    'type' => $transaction->type,
                    'title' => 'Charge',
                    'description' => $transaction->description ?: 'Stripe charge',
                    'amount' => (float) $transaction->amount,
                    'currency' => $transaction->currency,
                    'status' => $transaction->status,
                    'direction' => 'debit',
                    'job_id' => $transaction->job_id,
                    'application_id' => $transaction->application_id,
                    'stripe_payment_intent_id' => $transaction->stripe_payment_intent_id,
                    'stripe_charge_id' => $transaction->stripe_charge_id,
                    'created_at' => optional($transaction->created_at)->toISOString(),
                    'updated_at' => optional($transaction->updated_at)->toISOString(),
                    'meta' => $transaction->meta,
                ])
            : collect();

        $items = $walletTransactions
            ->concat($otherStripeTransactions)
            ->concat($subscriptionPurchases)
            ->sortByDesc(function (array $row) {
                return strtotime((string) ($row['created_at'] ?? '')) ?: 0;
            })
            ->values()
            ->all();

        return response()->json([
            'success' => true,
            'data' => $items,
            'transactions' => $items,
            'history' => $items,
        ]);
    }

    private function resolveUserId(Request $request): ?string
    {
        $candidates = [
            $request->input('user_id'),
            $request->query('user_id'),
            $request->input('nanny_id'),
            $request->query('nanny_id'),
        ];

        foreach ($candidates as $candidate) {
            $resolved = User::resolvePublicUserIdByIdentifier($candidate);
            if ($resolved) {
                return $resolved;
            }
        }

        $bearer = trim((string) $request->bearerToken());
        if ($bearer === '') {
            return null;
        }

        return User::query()->where('api_token', $bearer)->value('user_id');
    }
}
