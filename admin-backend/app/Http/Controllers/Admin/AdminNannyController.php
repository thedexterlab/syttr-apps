<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Models\AppData\ParentJobApplication;
use App\Models\AppData\SyttrInterview;
use App\Support\AdminRemoteApiClient;
use App\Support\AppDataApiClient;
use App\Support\AppDataHelper;
use App\Support\AdminAuditLogger;
use App\Support\AdminBlacklistEnforcer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;

class AdminNannyController extends Controller
{
    public function index(): JsonResponse
    {
        if (! AppDataHelper::canReachAppDataDatabase()) {
            $remote = AdminRemoteApiClient::get('/api/admin/nannies');
            if (is_array($remote) && isset($remote['data'])) {
                return response()->json([
                    'data' => $remote['data'],
                    'source' => 'remote_admin',
                ]);
            }

            return response()->json([
                'data' => $this->fallbackNannies(),
                'source' => 'app_api',
            ]);
        }

        if (! AppDataHelper::hasTable('users')) {
            return response()->json([
                'data' => [],
            ]);
        }

        $jobCountByNanny = $this->jobCountByNanny();
        $ratingStatsByNanny = $this->ratingStatsByNanny();
        $nannies = AppUser::query()
            ->syttrs()
            ->with('syttrProfile')
            ->latest('id')
            ->get()
            ->map(function (AppUser $user) use ($jobCountByNanny, $ratingStatsByNanny): array {
                $profile = $user->syttrProfile;
                $publicId = strtoupper((string) ($user->user_id ?? ''));
                $ratingStats = $ratingStatsByNanny->get($publicId, [
                    'average_rating' => 0.0,
                    'ratings_count' => 0,
                    'latest_rating' => null,
                    'latest_rating_display' => null,
                    'latest_review' => null,
                    'latest_rated_at' => null,
                    'recent_ratings' => [],
                ]);

                return [
                    'id' => $user->id,
                    'user_id' => $user->user_id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'status' => AppDataHelper::nannyStatusLabel($user),
                    'profile_status' => $user->profile_status,
                    'phone' => $profile?->phone,
                    'city' => $profile?->city,
                    'country' => $profile?->country,
                    'gender' => $profile?->gender,
                    'date_of_birth' => optional($profile?->date_of_birth)->format('Y-m-d'),
                    'age' => AppDataHelper::ageFromDate(optional($profile?->date_of_birth)->format('Y-m-d')),
                    'experience' => $profile?->experience_years,
                    'bio' => $profile?->bio,
                    'rating' => $ratingStats['average_rating'],
                    'avg_rating' => $ratingStats['average_rating'],
                    'average_rating' => $ratingStats['average_rating'],
                    'ratings_count' => $ratingStats['ratings_count'],
                    'review_count' => $ratingStats['ratings_count'],
                    'total_reviews' => $ratingStats['ratings_count'],
                    'latest_rating' => $ratingStats['latest_rating'],
                    'latest_rating_display' => $ratingStats['latest_rating_display'],
                    'latest_review' => $ratingStats['latest_review'],
                    'latest_rated_at' => $ratingStats['latest_rated_at'],
                    'recent_ratings' => $ratingStats['recent_ratings'],
                    'total_jobs' => (int) ($jobCountByNanny->get($publicId) ?? 0),
                    'shifts' => (int) ($jobCountByNanny->get($publicId) ?? 0),
                    'profile_image' => $profile?->user_image,
                    'profile_image_url' => AppDataHelper::assetUrl($profile?->user_image),
                    'certificate' => $profile?->certificate,
                    'certificate_url' => AppDataHelper::assetUrl($profile?->certificate),
                    'resume' => null,
                    'resume_url' => null,
                    'created_at' => optional($user->created_at)->toISOString(),
                    'updated_at' => optional($user->updated_at)->toISOString(),
                ];
            })
            ->values()
            ->all();

        return response()->json([
            'data' => $nannies,
        ]);
    }

    private function fallbackNannies(): array
    {
        return collect(AppDataApiClient::nannies()['rows'])
            ->map(function (array $row, int $index): array {
                $publicId = (string) ($row['nanny_id'] ?? $row['user_id'] ?? $row['id'] ?? $index + 1);
                $rating = $row['avg_rating'] ?? $row['rating'] ?? 0;

                return [
                    'id' => $publicId,
                    'user_id' => $publicId,
                    'name' => $row['fullname'] ?? $row['name'] ?? '-',
                    'email' => $row['email'] ?? '-',
                    'status' => $this->fallbackNannyStatus($row['verification_status'] ?? null),
                    'profile_status' => $row['verification_status'] ?? null,
                    'phone' => $row['phone'] ?? null,
                    'city' => $row['city'] ?? null,
                    'country' => $row['country'] ?? null,
                    'gender' => $row['gender'] ?? null,
                    'date_of_birth' => null,
                    'age' => null,
                    'experience' => $row['experience_years'] ?? $row['experience'] ?? null,
                    'bio' => $row['bio'] ?? null,
                    'rating' => $rating,
                    'avg_rating' => $rating,
                    'average_rating' => $rating,
                    'ratings_count' => $row['ratings_count'] ?? 0,
                    'review_count' => $row['ratings_count'] ?? 0,
                    'total_reviews' => $row['ratings_count'] ?? 0,
                    'total_jobs' => $row['total_jobs'] ?? $row['jobs_count'] ?? 0,
                    'shifts' => $row['total_jobs'] ?? $row['jobs_count'] ?? 0,
                    'profile_image' => $row['user_image'] ?? null,
                    'profile_image_url' => $row['user_image_url'] ?? $row['profile_image'] ?? null,
                    'certificate' => $row['certificate'] ?? null,
                    'certificate_url' => $row['certificate_url'] ?? null,
                    'resume' => null,
                    'resume_url' => null,
                    'created_at' => null,
                    'updated_at' => null,
                ];
            })
            ->values()
            ->all();
    }

    private function fallbackNannyStatus(mixed $value): string
    {
        $raw = strtolower(trim((string) ($value ?? '')));
        if ($raw === '') {
            return 'Pending';
        }

        if (str_contains($raw, 'blacklist') || str_contains($raw, 'reject')) {
            return 'Blacklisted';
        }

        if (
            str_contains($raw, 'verified') ||
            str_contains($raw, 'approv') ||
            str_contains($raw, 'active') ||
            str_contains($raw, 'complete') ||
            str_contains($raw, 'clear')
        ) {
            return 'Approved';
        }

        return 'Pending';
    }

    public function updateProfileStatus(Request $request): JsonResponse
    {
        $data = $request->validate([
            'nanny_id' => ['required'],
            'status' => ['required', 'string'],
        ]);

        if (! AppDataHelper::canReachAppDataDatabase()) {
            return $this->forwardProfileStatusUpdateToRemoteAdmin($data);
        }

        $user = AppUser::resolveByIdentifier($data['nanny_id']);
        if (! $user || $user->role !== 'syttr') {
            return response()->json([
                'message' => 'Nanny not found.',
            ], 404);
        }

        $statusPayload = AppDataHelper::normalizeNannyUpdate($data['status']);
        $before = [
            'profile_status' => $user->profile_status,
            'is_blacklisted' => (bool) $user->is_blacklisted,
            'blacklisted_reason' => $user->blacklisted_reason,
            'display_status' => AppDataHelper::nannyStatusLabel($user),
        ];
        $user->forceFill([
            ...$statusPayload,
            'profile_status_updated_at' => now(),
        ])->save();

        if (AppDataHelper::hasTable('syttr_interviews')) {
            $interviewStatus = strtolower((string) $data['status']);
            if (in_array($interviewStatus, ['approved', 'rejected'], true)) {
                SyttrInterview::query()
                    ->where('user_id', $user->id)
                    ->update(['status' => $interviewStatus]);
            }
        }

        $freshUser = $user->fresh();
        AdminBlacklistEnforcer::handleNannyBlacklisted($freshUser);
        AdminAuditLogger::log([
            'category' => in_array(strtolower((string) $data['status']), ['rejected', 'blacklisted'], true)
                ? 'blacklist'
                : 'verification',
            'action' => 'updated nanny status',
            'target_type' => 'nanny',
            'target_id' => (string) ($freshUser?->user_id ?: $freshUser?->id ?: ''),
            'target_label' => $freshUser?->name ?: 'Nanny',
            'before' => $before,
            'after' => [
                'profile_status' => $freshUser?->profile_status,
                'is_blacklisted' => (bool) $freshUser?->is_blacklisted,
                'blacklisted_reason' => $freshUser?->blacklisted_reason,
                'display_status' => AppDataHelper::nannyStatusLabel($freshUser),
            ],
            'meta' => [
                'requested_status' => $data['status'],
                'role' => 'syttr',
            ],
        ], $request);

        return response()->json([
            'message' => 'Profile status updated.',
            'data' => [
                'status' => AppDataHelper::nannyStatusLabel($freshUser),
            ],
        ]);
    }

    private function forwardProfileStatusUpdateToRemoteAdmin(array $data): JsonResponse
    {
        $baseUrl = rtrim((string) config('admin.remote_base_url'), '/');
        $apiKey = trim((string) config('admin.remote_api_key'));
        $email = trim((string) config('admin.remote_email'));
        $password = (string) config('admin.remote_password');

        if ($baseUrl === '' || $apiKey === '' || $email === '' || $password === '') {
            return response()->json([
                'message' => 'Remote admin status update is not configured.',
            ], 503);
        }

        try {
            $headers = [
                (string) config('admin.api_key_header', 'X-ADMIN-API-KEY') => $apiKey,
                'Accept' => 'application/json',
            ];

            $login = Http::timeout(15)
                ->withHeaders($headers)
                ->post($baseUrl.'/api/admin/login', [
                    'email' => $email,
                    'password' => $password,
                    'remember' => true,
                ]);

            if (! $login->successful()) {
                return response()->json([
                    'message' => 'Remote admin login failed.',
                    'details' => $login->json('message') ?: $login->body(),
                ], 502);
            }

            $token = trim((string) $login->json('token'));
            if ($token === '') {
                return response()->json([
                    'message' => 'Remote admin login did not return a token.',
                ], 502);
            }

            $response = Http::timeout(20)
                ->withHeaders($headers)
                ->withToken($token)
                ->post($baseUrl.'/api/admin/nanny/profile-status', [
                    'nanny_id' => $data['nanny_id'],
                    'status' => $data['status'],
                ]);

            return response()->json(
                $response->json() ?: ['message' => $response->body()],
                $response->status()
            );
        } catch (\Throwable $exception) {
            return response()->json([
                'message' => 'Remote admin status update failed.',
                'details' => $exception->getMessage(),
            ], 502);
        }
    }

    private function jobCountByNanny(): Collection
    {
        if (! AppDataHelper::hasTable('parent_job_applications')) {
            return collect();
        }

        return ParentJobApplication::query()
            ->whereIn('status', AppDataHelper::acceptedApplicationStatuses())
            ->selectRaw('nanny_id, COUNT(*) as total_jobs')
            ->groupBy('nanny_id')
            ->get()
            ->mapWithKeys(fn (ParentJobApplication $application): array => [
                strtoupper((string) $application->nanny_id) => (int) ($application->total_jobs ?? 0),
            ]);
    }

    private function ratingStatsByNanny(): Collection
    {
        if (
            ! AppDataHelper::hasTable('parent_job_applications')
            || ! AppDataHelper::hasTable('parent_jobs')
            || ! AppDataHelper::hasTable('users')
            || ! Schema::connection('app_data')->hasColumn('parent_job_applications', 'parent_rating')
        ) {
            return collect();
        }

        return ParentJobApplication::query()
            ->join('parent_jobs', 'parent_jobs.id', '=', 'parent_job_applications.job_id')
            ->leftJoin('users as parent_users', 'parent_users.user_id', '=', 'parent_jobs.user_id')
            ->whereNotNull('parent_job_applications.parent_rating')
            ->orderByDesc('parent_job_applications.parent_rated_at')
            ->orderByDesc('parent_job_applications.id')
            ->get([
                'parent_job_applications.id',
                'parent_job_applications.job_id',
                'parent_job_applications.nanny_id',
                'parent_job_applications.parent_rating',
                'parent_job_applications.parent_review',
                'parent_job_applications.parent_rated_at',
                'parent_jobs.user_id as parent_user_id',
                'parent_users.name as parent_name',
            ])
            ->groupBy(fn (ParentJobApplication $application): string => strtoupper((string) $application->nanny_id))
            ->map(function (Collection $items): array {
                $average = round((float) $items->avg(fn (ParentJobApplication $application): float => (float) ($application->parent_rating ?? 0)), 2);
                /** @var ParentJobApplication|null $latest */
                $latest = $items->first();

                $recentRatings = $items
                    ->take(5)
                    ->map(function (ParentJobApplication $application): array {
                        $rating = $application->parent_rating !== null ? (int) $application->parent_rating : null;

                        return [
                            'application_id' => (int) ($application->id ?? 0),
                            'job_id' => (int) ($application->job_id ?? 0),
                            'parent_user_id' => $application->parent_user_id ?: null,
                            'parent_name' => $application->parent_name ?: null,
                            'rating' => $rating,
                            'rating_display' => $rating !== null ? $rating.'/5' : null,
                            'review' => $this->normalizeReview($application->parent_review),
                            'rated_at' => $this->formatIsoTimestamp($application->parent_rated_at),
                        ];
                    })
                    ->values()
                    ->all();

                $latestRating = $latest && $latest->parent_rating !== null ? (int) $latest->parent_rating : null;

                return [
                    'average_rating' => $average,
                    'ratings_count' => $items->count(),
                    'latest_rating' => $latestRating,
                    'latest_rating_display' => $latestRating !== null ? $latestRating.'/5' : null,
                    'latest_review' => $this->normalizeReview($latest?->parent_review),
                    'latest_rated_at' => $this->formatIsoTimestamp($latest?->parent_rated_at),
                    'recent_ratings' => $recentRatings,
                ];
            });
    }

    private function normalizeReview(mixed $value): ?string
    {
        $review = trim((string) ($value ?? ''));

        return $review !== '' ? $review : null;
    }

    private function formatIsoTimestamp(mixed $value): ?string
    {
        $timestamp = $this->parseTimestamp($value);

        return $timestamp ? Carbon::createFromTimestamp($timestamp)->toISOString() : null;
    }

    private function parseTimestamp(mixed $value): ?int
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        try {
            return Carbon::parse($raw)->getTimestamp();
        } catch (\Throwable) {
            return null;
        }
    }
}
