<?php

namespace App\Support;

use App\Models\AppData\AppUser;
use App\Models\AppData\ParentJob;
use Illuminate\Support\Collection;

class AdminJobFormatter
{
    public static function buildRows(Collection $jobs): array
    {
        if ($jobs->isEmpty()) {
            return [];
        }

        $jobIds = $jobs->pluck('id')->filter()->values();
        $acceptedApplications = AppDataHelper::latestAcceptedApplicationsByJob($jobIds);

        $parentPublicIds = $jobs
            ->pluck('user_id')
            ->filter(fn ($value) => trim((string) $value) !== '')
            ->map(fn ($value) => strtoupper(trim((string) $value)))
            ->unique()
            ->values();

        $nannyPublicIds = $acceptedApplications
            ->map(fn ($application) => strtoupper(trim((string) ($application->nanny_id ?? ''))))
            ->filter()
            ->unique()
            ->values();

        $parentUsers = AppUser::query()
            ->with('parentProfile')
            ->whereIn('user_id', $parentPublicIds->all())
            ->get()
            ->keyBy(fn (AppUser $user) => strtoupper((string) $user->user_id));

        $nannyUsers = AppUser::query()
            ->with('syttrProfile')
            ->whereIn('user_id', $nannyPublicIds->all())
            ->get()
            ->keyBy(fn (AppUser $user) => strtoupper((string) $user->user_id));

        return $jobs->map(function (ParentJob $job) use ($acceptedApplications, $parentUsers, $nannyUsers): array {
            $parentUser = $parentUsers->get(strtoupper((string) $job->user_id));
            $application = $acceptedApplications->get($job->id);
            $nannyUser = $application
                ? $nannyUsers->get(strtoupper((string) $application->nanny_id))
                : null;

            $childNames = collect(explode(',', (string) ($job->kid_names ?? '')))
                ->map(fn (string $value) => trim($value))
                ->filter()
                ->values();

            $location = trim((string) ($job->location ?? ''));
            if ($location === '') {
                $location = trim((string) ($parentUser?->parentProfile?->city ?? ''));
            }

            return [
                'id' => $job->id,
                'job_id' => $job->id,
                'notification_id' => $job->id,
                'notification_job_id' => $job->id,
                'user_id' => $job->user_id,
                'parent_name' => $parentUser?->name ?: ('User #'.(string) $job->user_id),
                'nanny_name' => $nannyUser?->name ?: '-',
                'child_name' => $childNames->first() ?: '-',
                'child_names' => $childNames->all(),
                'kid_name' => $childNames->first() ?: '-',
                'status' => (string) ($job->status ?: 'pending'),
                'job_status' => (string) ($job->status ?: 'pending'),
                'notification_status' => (string) ($job->status ?: 'pending'),
                'start_date' => optional($job->start_date)->format('Y-m-d'),
                'end_date' => optional($job->end_date)->format('Y-m-d'),
                'start_time' => (string) ($job->start_time ?? ''),
                'end_time' => (string) ($job->end_time ?? ''),
                'job_hours' => $job->hours !== null ? (float) $job->hours : null,
                'hours' => $job->hours !== null ? (float) $job->hours : null,
                'price' => AppDataHelper::jobAmount($job->price, $job->hours, $job->hourly_rate),
                'location' => $location !== '' ? $location : null,
                'job_location' => $location !== '' ? $location : null,
                'city' => $parentUser?->parentProfile?->city,
                'latitude' => $job->latitude !== null ? (float) $job->latitude : null,
                'longitude' => $job->longitude !== null ? (float) $job->longitude : null,
                'notification_created_at' => optional($job->created_at)->toISOString(),
                'notification_updated_at' => optional($job->updated_at)->toISOString(),
                'created_at' => optional($job->created_at)->toISOString(),
                'updated_at' => optional($job->updated_at)->toISOString(),
            ];
        })->values()->all();
    }
}
