<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\WalletTransaction;
use App\Support\CommissionSettingResolver;
use App\Support\StripeConnectManager;
use App\Support\StripeTransactionRecorder;
use App\Support\WalletWithdrawalNotifier;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class WalletController extends Controller
{
    public function balance(Request $request): JsonResponse
    {
        $userId = $this->resolveAuthenticatedUserId($request);
        if (! $userId) {
            return $this->unauthorizedResponse();
        }

        if (! Schema::hasTable('wallet_transactions')) {
            return response()->json([
                'success' => true,
                'balance' => 0,
                'credits_total' => 0,
                'debits_total' => 0,
                'currency' => $this->walletCurrency(),
            ]);
        }

        $this->syncPendingStripeWithdrawals($userId);
        ['credits' => $credits, 'debits' => $debits] = $this->totals($userId, true);

        return response()->json([
            'success' => true,
            'balance' => round($credits - $debits, 2),
            'credits_total' => round($credits, 2),
            'debits_total' => round($debits, 2),
            'currency' => $this->walletCurrency(),
        ]);
    }

    public function transactions(Request $request): JsonResponse
    {
        $userId = $this->resolveAuthenticatedUserId($request);
        if (! $userId) {
            return $this->unauthorizedResponse();
        }

        if (! Schema::hasTable('wallet_transactions')) {
            return response()->json([
                'success' => true,
                'data' => [],
                'transactions' => [],
            ]);
        }

        $this->syncPendingStripeWithdrawals($userId);
        $items = WalletTransaction::query()
            ->with('job')
            ->where('user_id', $userId)
            ->latest()
            ->get()
            ->map(fn (WalletTransaction $transaction) => $this->serialize($transaction))
            ->values()
            ->all();

        return response()->json([
            'success' => true,
            'data' => $items,
            'transactions' => $items,
        ]);
    }

    public function history(Request $request): JsonResponse
    {
        return $this->transactions($request);
    }

    public function commission(Request $request): JsonResponse
    {
        $setting = CommissionSettingResolver::current();

        return response()->json([
            'success' => true,
            'type' => $setting['type'],
            'value' => $setting['value'],
            'currency' => $this->walletCurrency(),
        ]);
    }

    public function withdraw(Request $request): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'note' => ['nullable', 'string', 'max:255'],
            'payout_method' => ['nullable', 'string', 'max:50'],
        ]);

        $userId = $this->resolveAuthenticatedUserId($request);
        if (! $userId) {
            return $this->unauthorizedResponse();
        }

        if (! Schema::hasTable('wallet_transactions')) {
            return response()->json([
                'success' => false,
                'message' => 'Wallet is not available.',
            ], 503);
        }

        $amount = round((float) $data['amount'], 2);
        $note = trim((string) ($data['note'] ?? ''));
        $payoutMethod = trim((string) ($data['payout_method'] ?? ''));
        $currency = $this->walletCurrency();

        $result = DB::transaction(function () use ($userId, $amount, $note, $payoutMethod, $currency) {
            $user = User::query()
                ->where('user_id', $userId)
                ->lockForUpdate()
                ->first();
            if (! $user) {
                return [
                    'error' => response()->json([
                        'success' => false,
                        'message' => 'Unable to resolve user.',
                    ], 422),
                ];
            }

            $breakdown = $this->resolveWithdrawalBreakdown($amount);
            ['credits' => $credits, 'debits' => $debits] = $this->totals($userId, true);
            $availableBalance = round($credits - $debits, 2);
            if ($amount > $availableBalance) {
                return [
                    'error' => response()->json([
                        'success' => false,
                        'message' => 'Amount exceeds available balance.',
                        'balance' => $availableBalance,
                        ...$this->serializeWithdrawalBreakdownPayload($breakdown, $currency),
                    ], 422),
                ];
            }

            if (($breakdown['net_amount'] ?? 0) <= 0) {
                return [
                    'error' => response()->json([
                        'success' => false,
                        'message' => 'Commission leaves no payout amount. Enter a larger withdrawal amount.',
                        'balance' => $availableBalance,
                        ...$this->serializeWithdrawalBreakdownPayload($breakdown, $currency),
                    ], 422),
                ];
            }

            $transaction = WalletTransaction::query()->create([
                'user_id' => $userId,
                'type' => 'wallet_withdrawal',
                'category' => 'withdrawal',
                'direction' => 'debit',
                'amount' => $breakdown['net_amount'],
                'currency' => $currency,
                'status' => 'pending',
                'description' => $note !== '' ? 'Wallet withdrawal: '.$note : 'Wallet withdrawal',
                'meta' => array_filter([
                    'note' => $note !== '' ? $note : null,
                    'payout_method' => $payoutMethod !== '' ? $payoutMethod : null,
                    'gross_amount' => $breakdown['gross_amount'],
                    'commission_amount' => $breakdown['commission_amount'],
                    'net_amount' => $breakdown['net_amount'],
                    'commission_type' => $breakdown['commission_type'],
                    'commission_value' => $breakdown['commission_value'],
                    'source' => 'nanny_withdraw_screen',
                    'requested_at' => now()->toISOString(),
                ], fn ($value) => $value !== null && $value !== ''),
            ]);

            return [
                'transaction_id' => $transaction->id,
                'balance' => round($availableBalance - $breakdown['gross_amount'], 2),
                'breakdown' => $breakdown,
            ];
        }, 3);

        if (isset($result['error']) && $result['error'] instanceof JsonResponse) {
            return $result['error'];
        }

        $user = User::query()->where('user_id', $userId)->first();
        $transaction = isset($result['transaction_id'])
            ? WalletTransaction::query()->find($result['transaction_id'])
            : null;
        if (! $user || ! $transaction) {
            return response()->json([
                'success' => false,
                'message' => 'Unable to resolve withdrawal record.',
            ], 500);
        }

        $breakdown = is_array($result['breakdown'] ?? null)
            ? $result['breakdown']
            : $this->resolveWithdrawalBreakdown($amount);
        $netAmount = (float) ($breakdown['net_amount'] ?? $transaction->amount ?? 0);

        $stripeResult = $this->attemptStripeWithdrawal($user, $transaction, $netAmount, $currency, $payoutMethod);
        if (! ($stripeResult['success'] ?? false)) {
            $failedTransaction = $this->updateWithdrawalTransaction(
                $transaction,
                'failed',
                array_filter([
                    'failed_at' => now()->toISOString(),
                    'stripe_error_message' => (string) ($stripeResult['message'] ?? 'Unable to process Stripe payout.'),
                    'stripe_connect_account_id' => $stripeResult['account_id'] ?? null,
                    'stripe_external_account_id' => $stripeResult['external_account']['id'] ?? null,
                    'stripe_external_account_type' => $stripeResult['external_account']['type'] ?? null,
                    'stripe_external_account_last4' => $stripeResult['external_account']['last4'] ?? null,
                    'stripe_transfer_id' => $stripeResult['transfer']['id'] ?? null,
                    'stripe_payout_id' => $stripeResult['stripe_payload']['id'] ?? null,
                    'stripe_payout_status' => $stripeResult['stripe_payload']['status'] ?? null,
                    'transfer_shortfall_amount' => isset($stripeResult['transfer_shortfall_cents'])
                        ? round(((int) $stripeResult['transfer_shortfall_cents']) / 100, 2)
                        : null,
                ], static fn ($value) => $value !== null && $value !== '')
            );
            WalletWithdrawalNotifier::failed(
                $userId,
                $failedTransaction,
                $netAmount,
                $currency,
                (string) ($stripeResult['message'] ?? '')
            );

            return response()->json([
                'success' => false,
                'message' => (string) ($stripeResult['message'] ?? 'Unable to process Stripe payout.'),
                'balance' => $this->availableBalance($userId),
                ...$this->serializeWithdrawalBreakdownPayload(
                    $this->extractWithdrawalBreakdown($failedTransaction, $breakdown),
                    $currency
                ),
                'transaction' => $this->serialize($failedTransaction),
            ], (int) ($stripeResult['status'] ?? 422));
        }

        $finalStatus = (string) ($stripeResult['wallet_status'] ?? 'processing');
        $finalTransaction = $this->updateWithdrawalTransaction(
            $transaction,
            $finalStatus,
            array_filter([
                'processed_at' => now()->toISOString(),
                'stripe_connect_account_id' => $stripeResult['account_id'] ?? null,
                'stripe_external_account_id' => $stripeResult['external_account']['id'] ?? null,
                'stripe_external_account_type' => $stripeResult['external_account']['type'] ?? null,
                'stripe_external_account_last4' => $stripeResult['external_account']['last4'] ?? null,
                'stripe_transfer_id' => $stripeResult['transfer']['id'] ?? null,
                'stripe_payout_id' => $stripeResult['payout']['id'] ?? null,
                'stripe_payout_status' => $stripeResult['stripe_status'] ?? null,
                'connected_available_balance_before' => isset($stripeResult['available_balance_before_cents'])
                    ? round(((int) $stripeResult['available_balance_before_cents']) / 100, 2)
                    : null,
                'transfer_shortfall_amount' => isset($stripeResult['transfer_shortfall_cents'])
                    ? round(((int) $stripeResult['transfer_shortfall_cents']) / 100, 2)
                    : null,
                'payout_arrival_date' => isset($stripeResult['payout']['arrival_date']) && is_numeric((string) $stripeResult['payout']['arrival_date'])
                    ? now()->setTimestamp((int) $stripeResult['payout']['arrival_date'])->toDateString()
                    : null,
            ], static fn ($value) => $value !== null && $value !== '')
        );

        if ($finalStatus === 'completed') {
            WalletWithdrawalNotifier::completed($userId, $finalTransaction, $netAmount, $currency);
        } else {
            WalletWithdrawalNotifier::processing(
                $userId,
                $finalTransaction,
                $netAmount,
                $currency,
                [
                    'stripe_payout_id' => $stripeResult['payout']['id'] ?? null,
                    'stripe_transfer_id' => $stripeResult['transfer']['id'] ?? null,
                ]
            );
        }

        return response()->json([
            'success' => true,
            'message' => (string) ($stripeResult['message'] ?? 'Withdrawal created successfully.'),
            'balance' => $this->availableBalance($userId),
            ...$this->serializeWithdrawalBreakdownPayload(
                $this->extractWithdrawalBreakdown($finalTransaction, $breakdown),
                $currency
            ),
            'transaction' => $this->serialize($finalTransaction),
        ], 201);
    }

    private function resolveAuthenticatedUserId(Request $request): ?string
    {
        $bearer = trim((string) $request->bearerToken());
        if ($bearer === '') {
            return null;
        }

        return User::query()->where('api_token', $bearer)->value('user_id');
    }

    private function totals(string $userId, bool $reservePendingDebits = false): array
    {
        $creditBase = WalletTransaction::query()
            ->where('user_id', $userId)
            ->where('direction', 'credit')
            ->whereIn('status', ['completed', 'succeeded', 'paid']);

        $debitStatuses = $reservePendingDebits
            ? ['pending', 'processing', 'completed', 'succeeded', 'paid']
            : ['completed', 'succeeded', 'paid'];
        $debitBase = WalletTransaction::query()
            ->where('user_id', $userId)
            ->where('direction', 'debit')
            ->whereIn('status', $debitStatuses);

        $credits = (float) $creditBase->sum('amount');
        $debits = (float) $debitBase
            ->get()
            ->reduce(
                fn (float $sum, WalletTransaction $transaction) => $sum + $this->resolveReservedDebitAmount($transaction),
                0.0
            );

        return [
            'credits' => $credits,
            'debits' => round($debits, 2),
        ];
    }

    private function attemptStripeWithdrawal(
        User $user,
        WalletTransaction $transaction,
        float $amount,
        string $currency,
        string $payoutMethod = ''
    ): array {
        $result = StripeConnectManager::createTransferAndPayout(
            $user,
            $amount,
            $currency,
            $payoutMethod !== '' ? $payoutMethod : null,
            [
                'user_id' => (string) $user->user_id,
                'wallet_transaction_id' => (string) $transaction->id,
            ]
        );

        StripeTransactionRecorder::record([
            'user_id' => (string) $user->user_id,
            'source' => 'wallet.withdraw',
            'category' => 'wallet',
            'type' => 'withdrawal',
            'status' => (string) (
                $result['wallet_status']
                ?? $result['stripe_status']
                ?? ($result['success'] ?? false ? 'processing' : 'failed')
            ),
            'amount' => $amount,
            'currency' => $currency,
            'description' => 'Wallet withdrawal #'.$transaction->id,
            'error_message' => ! ($result['success'] ?? false)
                ? (string) ($result['message'] ?? 'Unable to process Stripe payout.')
                : null,
            'request_payload' => [
                'wallet_transaction_id' => $transaction->id,
                'payout_method' => $payoutMethod !== '' ? $payoutMethod : null,
            ],
            'response_payload' => array_filter([
                'payout' => $result['payout'] ?? ($result['stripe_payload'] ?? null),
                'transfer' => $result['transfer'] ?? null,
                'external_account' => $result['external_account'] ?? null,
            ], static fn ($value) => $value !== null),
            'meta' => array_filter([
                'wallet_transaction_id' => $transaction->id,
                'stripe_connect_account_id' => $result['account_id'] ?? null,
                'stripe_external_account_id' => $result['external_account']['id'] ?? null,
                'stripe_transfer_id' => $result['transfer']['id'] ?? null,
                'stripe_payout_id' => $result['payout']['id'] ?? ($result['stripe_payload']['id'] ?? null),
                'transfer_shortfall_amount' => isset($result['transfer_shortfall_cents'])
                    ? round(((int) $result['transfer_shortfall_cents']) / 100, 2)
                    : null,
            ], static fn ($value) => $value !== null && $value !== ''),
        ]);

        return $result;
    }

    private function updateWithdrawalTransaction(
        WalletTransaction $transaction,
        string $status,
        array $meta = []
    ): WalletTransaction {
        $currentMeta = is_array($transaction->meta) ? $transaction->meta : [];
        $transaction->status = $status;
        $transaction->meta = [
            ...$currentMeta,
            ...$meta,
        ];
        $transaction->save();

        return $transaction->fresh() ?? $transaction;
    }

    private function availableBalance(string $userId): float
    {
        ['credits' => $credits, 'debits' => $debits] = $this->totals($userId, true);

        return round($credits - $debits, 2);
    }

    private function syncPendingStripeWithdrawals(string $userId): void
    {
        $pendingWithdrawals = WalletTransaction::query()
            ->where('user_id', $userId)
            ->where('type', 'wallet_withdrawal')
            ->whereIn('status', ['pending', 'processing'])
            ->latest()
            ->limit(10)
            ->get();

        foreach ($pendingWithdrawals as $transaction) {
            $meta = is_array($transaction->meta) ? $transaction->meta : [];
            $payoutId = trim((string) ($meta['stripe_payout_id'] ?? ''));
            $connectAccountId = trim((string) ($meta['stripe_connect_account_id'] ?? ''));
            if ($payoutId === '' || $connectAccountId === '') {
                continue;
            }

            $payoutResult = StripeConnectManager::retrievePayout($connectAccountId, $payoutId);
            if (! ($payoutResult['success'] ?? false)) {
                continue;
            }

            $payout = is_array($payoutResult['payout'] ?? null) ? $payoutResult['payout'] : [];
            $stripeStatus = strtolower(trim((string) ($payout['status'] ?? 'pending')));
            $walletStatus = StripeConnectManager::mapPayoutStatusToWalletStatus($stripeStatus);

            $updatedTransaction = $this->updateWithdrawalTransaction(
                $transaction,
                $walletStatus,
                array_filter([
                    'stripe_payout_status' => $stripeStatus !== '' ? $stripeStatus : null,
                    'payout_arrival_date' => isset($payout['arrival_date']) && is_numeric((string) $payout['arrival_date'])
                        ? now()->setTimestamp((int) $payout['arrival_date'])->toDateString()
                        : null,
                    'payout_failure_code' => trim((string) ($payout['failure_code'] ?? '')) ?: null,
                    'payout_failure_message' => trim((string) ($payout['failure_message'] ?? '')) ?: null,
                    'payout_synced_at' => now()->toISOString(),
                ], static fn ($value) => $value !== null && $value !== '')
            );

            $amount = isset($payout['amount']) && is_numeric((string) $payout['amount'])
                ? round(((float) $payout['amount']) / 100, 2)
                : (float) $updatedTransaction->amount;
            $currency = strtolower(trim((string) ($payout['currency'] ?? $updatedTransaction->currency ?? 'usd'))) ?: 'usd';
            if ($walletStatus === 'completed') {
                WalletWithdrawalNotifier::completed(
                    $userId,
                    $updatedTransaction,
                    $amount,
                    $currency,
                    ['stripe_payout_id' => $payoutId]
                );
            } elseif ($walletStatus === 'failed') {
                WalletWithdrawalNotifier::failed(
                    $userId,
                    $updatedTransaction,
                    $amount,
                    $currency,
                    trim((string) ($payout['failure_message'] ?? '')),
                    ['stripe_payout_id' => $payoutId]
                );
            }
        }
    }

    private function unauthorizedResponse(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'Authentication required.',
        ], 401);
    }

    private function walletCurrency(): string
    {
        return strtolower(trim((string) config('services.wallet.currency', 'usd'))) ?: 'usd';
    }

    private function resolveWithdrawalBreakdown(float $grossAmount): array
    {
        $normalizedGross = round(max(0, $grossAmount), 2);
        $setting = CommissionSettingResolver::current();
        $commissionType = strtolower(trim((string) ($setting['type'] ?? 'percentage'))) === 'flat'
            ? 'flat'
            : 'percentage';
        $commissionValue = round(max(0, (float) ($setting['value'] ?? 0)), 2);
        $commissionAmount = $commissionType === 'flat'
            ? min($commissionValue, $normalizedGross)
            : round(($normalizedGross * $commissionValue) / 100, 2);
        $commissionAmount = round(max(0, $commissionAmount), 2);
        $netAmount = round(max(0, $normalizedGross - $commissionAmount), 2);

        return [
            'gross_amount' => $normalizedGross,
            'commission_amount' => $commissionAmount,
            'net_amount' => $netAmount,
            'commission_type' => $commissionType,
            'commission_value' => $commissionValue,
        ];
    }

    private function resolveReservedDebitAmount(WalletTransaction $transaction): float
    {
        $meta = is_array($transaction->meta) ? $transaction->meta : [];
        $grossAmount = $meta['gross_amount'] ?? null;
        if (
            $transaction->type === 'wallet_withdrawal'
            && is_numeric((string) $grossAmount)
        ) {
            return round((float) $grossAmount, 2);
        }

        return round((float) $transaction->amount, 2);
    }

    private function extractWithdrawalBreakdown(
        WalletTransaction $transaction,
        array $fallback = []
    ): array {
        $meta = is_array($transaction->meta) ? $transaction->meta : [];

        return [
            'gross_amount' => $this->resolveBreakdownAmountValue($meta['gross_amount'] ?? null, $fallback['gross_amount'] ?? null),
            'commission_amount' => $this->resolveBreakdownAmountValue($meta['commission_amount'] ?? null, $fallback['commission_amount'] ?? null),
            'net_amount' => $this->resolveBreakdownAmountValue($meta['net_amount'] ?? null, $fallback['net_amount'] ?? (float) $transaction->amount),
            'commission_type' => $this->resolveBreakdownStringValue($meta['commission_type'] ?? null, $fallback['commission_type'] ?? null),
            'commission_value' => $this->resolveBreakdownAmountValue($meta['commission_value'] ?? null, $fallback['commission_value'] ?? null),
        ];
    }

    private function serializeWithdrawalBreakdownPayload(array $breakdown, string $currency): array
    {
        return [
            'gross_amount' => $breakdown['gross_amount'] ?? null,
            'commission_amount' => $breakdown['commission_amount'] ?? null,
            'net_amount' => $breakdown['net_amount'] ?? null,
            'commission_type' => $breakdown['commission_type'] ?? null,
            'commission_value' => $breakdown['commission_value'] ?? null,
            'currency' => $currency,
            'withdrawal' => [
                'gross_amount' => $breakdown['gross_amount'] ?? null,
                'commission_amount' => $breakdown['commission_amount'] ?? null,
                'net_amount' => $breakdown['net_amount'] ?? null,
                'commission_type' => $breakdown['commission_type'] ?? null,
                'commission_value' => $breakdown['commission_value'] ?? null,
                'currency' => $currency,
            ],
        ];
    }

    private function resolveBreakdownAmountValue(mixed $primary, mixed $fallback = null): ?float
    {
        if (is_numeric((string) $primary)) {
            return round((float) $primary, 2);
        }

        if (is_numeric((string) $fallback)) {
            return round((float) $fallback, 2);
        }

        return null;
    }

    private function resolveBreakdownStringValue(mixed $primary, mixed $fallback = null): ?string
    {
        $normalizedPrimary = trim((string) ($primary ?? ''));
        if ($normalizedPrimary !== '') {
            return $normalizedPrimary;
        }

        $normalizedFallback = trim((string) ($fallback ?? ''));

        return $normalizedFallback !== '' ? $normalizedFallback : null;
    }

    private function serialize(WalletTransaction $transaction): array
    {
        $meta = is_array($transaction->meta) ? $transaction->meta : [];
        $job = $transaction->job;
        $earningTimezone = $job?->localTimezone()
            ?: (isset($meta['timezone']) ? (string) $meta['timezone'] : null);
        $earningDate = $job?->start_date?->format('Y-m-d')
            ?: (isset($meta['start_date']) ? (string) $meta['start_date'] : null);
        $earningAmount = null;
        if ($transaction->type === 'job_payout' && $transaction->direction === 'credit') {
            $earningAmount = isset($meta['net_amount'])
                ? (float) $meta['net_amount']
                : (float) $transaction->amount;
        }

        return [
            'id' => $transaction->id,
            'user_id' => $transaction->user_id,
            'counterparty_user_id' => $transaction->counterparty_user_id,
            'job_id' => $transaction->job_id,
            'application_id' => $transaction->application_id,
            'subscription_purchase_id' => $transaction->subscription_purchase_id,
            'type' => $transaction->type,
            'category' => $transaction->category,
            'direction' => $transaction->direction,
            'amount' => (float) $transaction->amount,
            'currency' => $transaction->currency,
            'status' => $transaction->status,
            'description' => $transaction->description,
            'stripe_payment_intent_id' => $transaction->stripe_payment_intent_id,
            'gross_amount' => isset($meta['gross_amount']) ? (float) $meta['gross_amount'] : null,
            'commission_amount' => isset($meta['commission_amount']) ? (float) $meta['commission_amount'] : null,
            'net_amount' => isset($meta['net_amount']) ? (float) $meta['net_amount'] : null,
            'commission_type' => isset($meta['commission_type']) ? (string) $meta['commission_type'] : null,
            'commission_value' => isset($meta['commission_value']) ? (float) $meta['commission_value'] : null,
            'stripe_fee_amount' => isset($meta['stripe_fee_amount']) ? (float) $meta['stripe_fee_amount'] : null,
            'stripe_tax_amount' => isset($meta['stripe_tax_amount']) ? (float) $meta['stripe_tax_amount'] : null,
            'stripe_processing_fee_amount' => isset($meta['stripe_processing_fee_amount']) ? (float) $meta['stripe_processing_fee_amount'] : null,
            'stripe_transfer_id' => isset($meta['stripe_transfer_id']) ? (string) $meta['stripe_transfer_id'] : null,
            'stripe_payout_id' => isset($meta['stripe_payout_id']) ? (string) $meta['stripe_payout_id'] : null,
            'stripe_connect_account_id' => isset($meta['stripe_connect_account_id']) ? (string) $meta['stripe_connect_account_id'] : null,
            'stripe_external_account_id' => isset($meta['stripe_external_account_id']) ? (string) $meta['stripe_external_account_id'] : null,
            'earning_amount' => $earningAmount,
            'earning_date' => $earningDate,
            'earning_timezone' => $earningTimezone,
            'meta' => $meta,
            'created_at' => optional($transaction->created_at)->toISOString(),
            'updated_at' => optional($transaction->updated_at)->toISOString(),
        ];
    }
}
