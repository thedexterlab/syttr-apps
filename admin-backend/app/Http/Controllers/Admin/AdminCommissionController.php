<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Models\AppData\WalletTransaction;
use App\Models\CommissionSetting;
use App\Support\AdminWithdrawalCommissionMetrics;
use App\Support\AppDataHelper;
use App\Support\AdminAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

class AdminCommissionController extends Controller
{
    public function index(): JsonResponse
    {
        $setting = CommissionSetting::current();
        if (! AppDataHelper::hasTable('wallet_transactions') || ! AppDataHelper::hasTable('users')) {
            return response()->json([
                'data' => [
                    'commissions' => [],
                    'summary' => $this->emptySummary(),
                    'current_fee' => [
                        'type' => $setting->type,
                        'value' => (float) $setting->value,
                    ],
                ],
            ]);
        }

        $transactions = AdminWithdrawalCommissionMetrics::loadTransactions();
        $currency = AdminWithdrawalCommissionMetrics::currency($transactions);
        $summary = AdminWithdrawalCommissionMetrics::summarize($transactions);
        $latestTransactions = $transactions->take(100)->values();

        $nannies = $this->loadNannies($latestTransactions);
        $commissions = $latestTransactions->map(function (WalletTransaction $transaction) use ($setting, $nannies, $currency): array {
            $nanny = $nannies->get(strtoupper((string) $transaction->user_id));
            $grossAmount = AdminWithdrawalCommissionMetrics::grossAmount($transaction);
            $commissionAmount = AdminWithdrawalCommissionMetrics::commissionAmount($transaction);
            $netAmount = AdminWithdrawalCommissionMetrics::netAmount($transaction);
            $commissionType = AdminWithdrawalCommissionMetrics::commissionType($transaction) ?: $setting->type;
            $commissionValue = AdminWithdrawalCommissionMetrics::commissionValue($transaction);

            return [
                'id' => $transaction->id,
                'nanny_name' => $nanny?->name ?: '-',
                'nanny_fullname' => $nanny?->name ?: '-',
                'requested_amount' => number_format($grossAmount, 2, '.', ''),
                'job_amount' => number_format($grossAmount, 2, '.', ''),
                'commission_percent' => $this->formatCommissionRateLabel(
                    $commissionType,
                    $commissionValue ?? (float) $setting->value,
                    $currency
                ),
                'commission_amount' => number_format($commissionAmount, 2, '.', ''),
                'payout_amount' => number_format($netAmount, 2, '.', ''),
                'status' => $transaction->status,
                'currency' => $currency,
                'updated_at' => optional($transaction->updated_at)->toISOString(),
            ];
        })->values()->all();

        return response()->json([
            'data' => [
                'commissions' => $commissions,
                'summary' => $summary,
                'current_fee' => [
                    'type' => $setting->type,
                    'value' => (float) $setting->value,
                ],
            ],
        ]);
    }

    public function current(): JsonResponse
    {
        $setting = CommissionSetting::current();

        return response()->json([
            'data' => [
                'type' => $setting->type,
                'value' => (float) $setting->value,
            ],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', 'in:percentage,flat'],
            'value' => ['required', 'numeric', 'min:0'],
        ]);

        $setting = CommissionSetting::current();
        $before = [
            'type' => $setting->type,
            'value' => (float) $setting->value,
            'is_active' => (bool) $setting->is_active,
        ];
        $setting->forceFill([
            'type' => $data['type'],
            'value' => round((float) $data['value'], 2),
            'is_active' => true,
        ])->save();

        AdminAuditLogger::log([
            'category' => 'commission',
            'action' => 'updated commission',
            'target_type' => 'commission_setting',
            'target_id' => (string) $setting->id,
            'target_label' => $setting->name ?: 'Default commission',
            'before' => $before,
            'after' => [
                'type' => $setting->type,
                'value' => (float) $setting->value,
                'is_active' => (bool) $setting->is_active,
            ],
        ], $request);

        return response()->json([
            'message' => 'Commission updated.',
            'data' => [
                'type' => $setting->type,
                'value' => (float) $setting->value,
            ],
        ]);
    }

    private function loadNannies($transactions): Collection
    {
        $nannyIds = $transactions
            ->pluck('user_id')
            ->filter()
            ->map(fn ($value) => strtoupper((string) $value))
            ->unique()
            ->values();

        if ($nannyIds->isEmpty()) {
            return collect();
        }

        return AppUser::query()
            ->whereIn('user_id', $nannyIds->all())
            ->get()
            ->keyBy(fn (AppUser $user) => strtoupper((string) $user->user_id));
    }

    private function emptySummary(): array
    {
        return [
            'currency' => 'USD',
            'withdrawal_count' => 0,
            'total_commission_revenue' => 0,
            'total_withdrawal_volume' => 0,
            'total_payout_volume' => 0,
            'current_period_label' => now()->format('M Y'),
            'current_period_withdrawal_count' => 0,
            'current_period_commission_revenue' => 0,
        ];
    }

    private function formatCommissionRateLabel(string $type, float $value, string $currency = 'USD'): string
    {
        $normalizedType = strtolower(trim($type)) === 'flat' ? 'flat' : 'percentage';
        $normalizedCurrency = strtoupper(trim($currency)) ?: 'USD';

        if ($normalizedType === 'flat') {
            $prefix = $normalizedCurrency === 'USD' ? '$' : $normalizedCurrency.' ';

            return $prefix.number_format($value, 2, '.', '');
        }

        return rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.').'%';
    }
}
