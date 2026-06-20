<?php

namespace App\Support;

use App\Models\AppData\AppUser;
use App\Models\AppData\ParentJob;
use App\Models\AppData\ParentJobApplication;

class AdminBlacklistEnforcer
{
    public static function handleNannyBlacklisted(?AppUser $user): void
    {
        $nannyUserId = strtoupper(trim((string) ($user?->user_id ?? '')));
        if (
            ! $user ||
            ! (bool) $user->is_blacklisted ||
            $nannyUserId === '' ||
            ! AppDataHelper::hasTable('parent_job_applications')
        ) {
            return;
        }

        $openApplicationsQuery = ParentJobApplication::query()
            ->where('nanny_id', $nannyUserId)
            ->where(function ($query): void {
                $query
                    ->whereNull('status')
                    ->orWhereNotIn('status', self::finalizedApplicationStatuses());
            });

        $acceptedJobIds = (clone $openApplicationsQuery)
            ->whereIn('status', AppDataHelper::acceptedApplicationStatuses())
            ->pluck('job_id')
            ->filter()
            ->unique()
            ->values()
            ->all();

        $openApplicationIds = (clone $openApplicationsQuery)
            ->pluck('id')
            ->filter()
            ->unique()
            ->values()
            ->all();

        if (count($openApplicationIds) > 0) {
            ParentJobApplication::query()
                ->whereIn('id', $openApplicationIds)
                ->update([
                    'status' => 'cancelled',
                    'updated_at' => now(),
                ]);
        }

        if (count($acceptedJobIds) === 0 || ! AppDataHelper::hasTable('parent_jobs')) {
            return;
        }

        ParentJob::query()
            ->whereIn('id', $acceptedJobIds)
            ->where(function ($query): void {
                $query
                    ->whereNull('status')
                    ->orWhereIn('status', AppDataHelper::acceptedApplicationStatuses());
            })
            ->update([
                'status' => 'pending',
                'updated_at' => now(),
            ]);
    }

    private static function finalizedApplicationStatuses(): array
    {
        return [
            'rejected',
            'reject',
            'declined',
            'decline',
            'cancelled',
            'canceled',
            'completed',
            'closed',
            'expired',
            'withdrawn',
        ];
    }
}
