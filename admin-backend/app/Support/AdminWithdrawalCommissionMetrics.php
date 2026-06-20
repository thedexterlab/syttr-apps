<?php

namespace App\Support;

use App\Models\AppData\WalletTransaction;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class AdminWithdrawalCommissionMetrics
{
    public static function loadTransactions(): Collection
    {
        if (! AppDataHelper::hasTable('wallet_transactions')) {
            return collect();
        }

        return WalletTransaction::query()
            ->where('type', 'wallet_withdrawal')
            ->where('direction', 'debit')
            ->whereIn('status', ['pending', 'processing', 'completed', 'succeeded', 'paid'])
            ->latest('created_at')
            ->latest('id')
            ->get();
    }

    public static function summarize(Collection $transactions): array
    {
        $rows = $transactions->map(function (WalletTransaction $transaction): array {
            return [
                'gross_amount' => self::grossAmount($transaction),
                'commission_amount' => self::commissionAmount($transaction),
                'net_amount' => self::netAmount($transaction),
                'created_at' => self::parseDate($transaction->created_at),
            ];
        });

        $currency = self::currency($transactions);
        $now = now();
        $currentMonthRows = $rows->filter(function (array $row) use ($now): bool {
            $createdAt = $row['created_at'] ?? null;
            return $createdAt instanceof Carbon
                && $createdAt->year === $now->year
                && $createdAt->month === $now->month;
        });

        return [
            'currency' => $currency,
            'withdrawal_count' => $rows->count(),
            'total_commission_revenue' => round((float) $rows->sum('commission_amount'), 2),
            'total_withdrawal_volume' => round((float) $rows->sum('gross_amount'), 2),
            'total_payout_volume' => round((float) $rows->sum('net_amount'), 2),
            'current_period_label' => $now->format('M Y'),
            'current_period_withdrawal_count' => $currentMonthRows->count(),
            'current_period_commission_revenue' => round((float) $currentMonthRows->sum('commission_amount'), 2),
        ];
    }

    public static function currency(Collection $transactions): string
    {
        $currency = $transactions
            ->map(fn (WalletTransaction $transaction) => strtoupper(trim((string) ($transaction->currency ?? ''))))
            ->first(fn (?string $value) => $value !== null && $value !== '');

        return $currency ?: 'USD';
    }

    public static function grossAmount(WalletTransaction $transaction): float
    {
        return self::moneyValue(
            self::metaValue($transaction, 'gross_amount'),
            (float) $transaction->amount
        );
    }

    public static function commissionAmount(WalletTransaction $transaction): float
    {
        return self::moneyValue(
            self::metaValue($transaction, 'commission_amount'),
            0
        );
    }

    public static function netAmount(WalletTransaction $transaction): float
    {
        return self::moneyValue(
            self::metaValue($transaction, 'net_amount'),
            (float) $transaction->amount
        );
    }

    public static function commissionType(WalletTransaction $transaction): ?string
    {
        $value = trim((string) self::metaValue($transaction, 'commission_type'));
        return $value !== '' ? $value : null;
    }

    public static function commissionValue(WalletTransaction $transaction): ?float
    {
        $value = self::metaValue($transaction, 'commission_value');
        return is_numeric((string) $value) ? round((float) $value, 2) : null;
    }

    private static function metaValue(WalletTransaction $transaction, string $key): mixed
    {
        $meta = is_array($transaction->meta) ? $transaction->meta : [];
        return $meta[$key] ?? null;
    }

    private static function moneyValue(mixed $value, float $fallback = 0): float
    {
        if (is_numeric((string) $value)) {
            return round((float) $value, 2);
        }

        return round($fallback, 2);
    }

    private static function parseDate(mixed $value): ?Carbon
    {
        if ($value instanceof Carbon) {
            return $value;
        }

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
