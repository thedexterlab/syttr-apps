<?php

namespace Database\Seeders;

use App\Models\AdminApiKey;
use App\Models\CommissionSetting;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class AdminBootstrapSeeder extends Seeder
{
    public function run(): void
    {
        $adminEmail = trim((string) env('ADMIN_DEFAULT_EMAIL', 'support@syttr.com'));
        $adminPassword = trim((string) env('ADMIN_DEFAULT_PASSWORD', 'Dex123'));
        $adminName = trim((string) env('ADMIN_DEFAULT_NAME', 'Syttr Admin'));

        User::query()->updateOrCreate(
            ['email' => $adminEmail],
            [
                'name' => $adminName !== '' ? $adminName : 'Syttr Admin',
                'password' => Hash::make($adminPassword !== '' ? $adminPassword : 'Dex123'),
                'is_active' => true,
            ]
        );

        $frontendApiKey = trim((string) env('ADMIN_FRONTEND_API_KEY', ''));
        if ($frontendApiKey !== '') {
            AdminApiKey::query()->updateOrCreate(
                ['name' => 'frontend'],
                [
                    'key_hash' => hash('sha256', $frontendApiKey),
                    'is_active' => true,
                ]
            );
        }

        $defaultCommissionType = strtolower(trim((string) env('ADMIN_DEFAULT_COMMISSION_TYPE', 'percentage')));
        $defaultCommissionValue = (float) env('ADMIN_DEFAULT_COMMISSION_VALUE', 10);

        CommissionSetting::query()->updateOrCreate(
            ['name' => 'default'],
            [
                'type' => $defaultCommissionType === 'flat' ? 'flat' : 'percentage',
                'value' => round(max(0, $defaultCommissionValue), 2),
                'is_active' => true,
            ]
        );
    }
}
