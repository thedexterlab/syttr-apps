<?php

namespace App\Support;

use App\Models\AdminCommissionSetting;
use Illuminate\Support\Facades\Schema;

class CommissionSettingResolver
{
    public static function current(): array
    {
        $fallback = [
            'type' => static::normalizeType((string) config('services.wallet.withdrawal_commission_type', 'percentage')),
            'value' => round((float) config('services.wallet.withdrawal_commission_value', 5), 2),
            'source' => 'config',
        ];

        try {
            if (! Schema::connection('admin_panel')->hasTable('commission_settings')) {
                return $fallback;
            }

            $setting = AdminCommissionSetting::query()
                ->where('is_active', true)
                ->orderByDesc('updated_at')
                ->orderByDesc('id')
                ->first();

            if (! $setting) {
                return $fallback;
            }

            return [
                'type' => static::normalizeType((string) $setting->type),
                'value' => round((float) $setting->value, 2),
                'source' => 'admin_panel',
            ];
        } catch (\Throwable) {
            return $fallback;
        }
    }

    private static function normalizeType(string $value): string
    {
        return strtolower(trim($value)) === 'flat' ? 'flat' : 'percentage';
    }
}
