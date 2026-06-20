<?php

namespace App\Support;

use App\Http\Controllers\NotificationController;
use App\Models\UserNotification;
use App\Models\WalletTransaction;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class WalletWithdrawalNotifier
{
    public static function processing(
        string $userId,
        WalletTransaction $transaction,
        float $amount,
        string $currency,
        array $data = []
    ): void {
        self::send(
            $userId,
            $transaction,
            'processing',
            'withdrawal_processing',
            'Withdrawal Processing',
            'Your withdrawal of '.self::formatMoneyLabel($amount, $currency).' is processing with Stripe.',
            $data
        );
    }

    public static function completed(
        string $userId,
        WalletTransaction $transaction,
        float $amount,
        string $currency,
        array $data = []
    ): void {
        self::send(
            $userId,
            $transaction,
            'completed',
            'withdrawal_completed',
            'Withdrawal Completed',
            'Your withdrawal of '.self::formatMoneyLabel($amount, $currency).' was sent successfully.',
            $data
        );
    }

    public static function failed(
        string $userId,
        WalletTransaction $transaction,
        float $amount,
        string $currency,
        string $reason = '',
        array $data = []
    ): void {
        $suffix = $reason !== '' ? ' '.$reason : '';
        self::send(
            $userId,
            $transaction,
            'failed',
            'withdrawal_failed',
            'Withdrawal Failed',
            'Your withdrawal of '.self::formatMoneyLabel($amount, $currency).' could not be completed.'.$suffix,
            [
                ...$data,
                'error_message' => $reason !== '' ? $reason : null,
            ]
        );
    }

    private static function send(
        string $userId,
        WalletTransaction $transaction,
        string $stage,
        string $type,
        string $title,
        string $message,
        array $data = []
    ): void {
        try {
            if (! Schema::hasTable('user_notifications')) {
                return;
            }

            $notificationKey = 'wallet-withdrawal:'.$transaction->id.':'.$stage;
            $alreadySent = UserNotification::query()
                ->where('recipient_user_id', strtoupper(trim($userId)))
                ->where('type', $type)
                ->where('data->notification_key', $notificationKey)
                ->exists();
            if ($alreadySent) {
                return;
            }

            NotificationController::createForUser(
                $userId,
                $type,
                $title,
                $message,
                array_filter([
                    'notification_key' => $notificationKey,
                    'wallet_transaction_id' => $transaction->id,
                    'status' => (string) $transaction->status,
                    'amount' => round((float) $transaction->amount, 2),
                    'currency' => strtolower(trim((string) $transaction->currency)) ?: 'usd',
                    ...$data,
                ], static fn ($value) => $value !== null && $value !== '')
            );
        } catch (\Throwable $e) {
            Log::warning('wallet.withdraw.notification_failed', [
                'user_id' => $userId,
                'wallet_transaction_id' => $transaction->id,
                'stage' => $stage,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function formatMoneyLabel(float $amount, string $currency): string
    {
        $normalizedCurrency = strtolower(trim($currency)) ?: 'usd';
        $formattedAmount = number_format(round($amount, 2), 2, '.', '');

        return match ($normalizedCurrency) {
            'usd' => '$'.$formattedAmount,
            'eur' => 'EUR '.$formattedAmount,
            'gbp' => 'GBP '.$formattedAmount,
            'cad' => 'CAD '.$formattedAmount,
            'aud' => 'AUD '.$formattedAmount,
            default => strtoupper($normalizedCurrency).' '.$formattedAmount,
        };
    }
}
