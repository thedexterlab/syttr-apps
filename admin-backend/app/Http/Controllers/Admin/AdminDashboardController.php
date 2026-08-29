<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Models\AppData\ParentJob;
use App\Support\AdminWithdrawalCommissionMetrics;
use App\Support\AdminJobFormatter;
use App\Support\AdminRemoteApiClient;
use App\Support\AppDataApiClient;
use App\Support\AppDataHelper;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;

class AdminDashboardController extends Controller
{
    public function index(): JsonResponse
    {
        if (! AppDataHelper::canReachAppDataDatabase()) {
            $remote = AdminRemoteApiClient::get('/api/admin/dashboard-stats');
            if (is_array($remote) && isset($remote['data'])) {
                return response()->json([
                    'data' => $remote['data'],
                    'source' => 'remote_admin',
                ]);
            }

            return response()->json([
                'data' => $this->fallbackDashboardData(),
                'source' => 'app_api',
            ]);
        }

        if (! AppDataHelper::hasTable('users') || ! AppDataHelper::hasTable('parent_jobs')) {
            return response()->json([
                'data' => [
                    'active_nannies' => 0,
                    'live_bookings' => 0,
                    'active_users' => 0,
                    'recent_bookings' => [],
                    'city_utilization' => [],
                    'commission_revenue' => 0,
                    'commission_revenue_period_label' => now()->format('M Y'),
                    'commission_revenue_current_period' => 0,
                    'withdrawal_count' => 0,
                ],
            ]);
        }

        $activeNannies = AppUser::query()
            ->syttrs()
            ->where(function ($query) {
                $query
                    ->whereNull('is_blacklisted')
                    ->orWhere('is_blacklisted', false);
            })
            ->count();

        $activeUsers = AppUser::query()
            ->parents()
            ->where(function ($query) {
                $query
                    ->whereNull('is_blacklisted')
                    ->orWhere('is_blacklisted', false);
            })
            ->count();

        $liveBookings = ParentJob::query()
            ->whereIn('status', ['accepted', 'active', 'confirmed', 'booked', 'in_progress'])
            ->count();

        $recentJobs = ParentJob::query()
            ->latest('start_date')
            ->latest('id')
            ->limit(12)
            ->get();

        $recentBookings = AdminJobFormatter::buildRows($recentJobs);
        $cityUtilization = $this->buildCityUtilization(collect($recentBookings));
        $withdrawalCommissionSummary = AdminWithdrawalCommissionMetrics::summarize(
            AdminWithdrawalCommissionMetrics::loadTransactions()
        );

        return response()->json([
            'data' => [
                'active_nannies' => $activeNannies,
                'live_bookings' => $liveBookings,
                'active_users' => $activeUsers,
                'recent_bookings' => $recentBookings,
                'city_utilization' => $cityUtilization,
                'commission_revenue' => $withdrawalCommissionSummary['total_commission_revenue'] ?? 0,
                'commission_revenue_period_label' => $withdrawalCommissionSummary['current_period_label'] ?? now()->format('M Y'),
                'commission_revenue_current_period' => $withdrawalCommissionSummary['current_period_commission_revenue'] ?? 0,
                'withdrawal_count' => $withdrawalCommissionSummary['withdrawal_count'] ?? 0,
            ],
        ]);
    }

    private function fallbackDashboardData(): array
    {
        $nannies = AppDataApiClient::nannies();
        $parents = AppDataApiClient::parents();
        $jobs = collect(AppDataApiClient::jobs());
        $liveStatuses = ['accepted', 'active', 'confirmed', 'booked', 'in_progress'];

        return [
            'active_nannies' => $nannies['total'],
            'live_bookings' => $jobs
                ->filter(fn (array $job): bool => in_array(strtolower((string) ($job['status'] ?? '')), $liveStatuses, true))
                ->count(),
            'active_users' => count($parents),
            'recent_bookings' => $jobs->take(12)->values()->all(),
            'city_utilization' => $this->buildCityUtilization($jobs->take(12)->values()),
            'commission_revenue' => 0,
            'commission_revenue_period_label' => now()->format('M Y'),
            'commission_revenue_current_period' => 0,
            'withdrawal_count' => 0,
        ];
    }

    private function buildCityUtilization(Collection $recentBookings): array
    {
        if ($recentBookings->isEmpty()) {
            return [];
        }

        $counts = $recentBookings
            ->map(function (array $job): ?string {
                $city = trim((string) ($job['city'] ?? ''));
                if ($city !== '') {
                    return $city;
                }

                $location = trim((string) ($job['location'] ?? $job['job_location'] ?? ''));
                if ($location === '') {
                    return null;
                }

                $parts = array_values(array_filter(array_map('trim', explode(',', $location))));
                return $parts[0] ?? $location;
            })
            ->filter()
            ->countBy();

        $total = $counts->sum();
        if ($total === 0) {
            return [];
        }

        return $counts
            ->map(fn (int $count, string $label): array => [
                'label' => $label,
                'value' => (int) round(($count / $total) * 100),
            ])
            ->sortByDesc('value')
            ->values()
            ->take(4)
            ->all();
    }
}
