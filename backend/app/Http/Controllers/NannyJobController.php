<?php

namespace App\Http\Controllers;

use App\Models\ChatConversation;
use App\Models\ParentJob;
use App\Models\ParentJobApplication;
use App\Models\ParentKid;
use App\Models\ParentProfile;
use App\Models\SyttrProfile;
use App\Models\User;
use App\Models\UserNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class NannyJobController extends Controller
{
    public function sendRequest(Request $request): JsonResponse
    {
        $data = $request->validate([
            'job_id' => ['required'],
            'nanny_id' => ['nullable'],
            'user_id' => ['nullable'],
        ]);

        $jobId = (int) $data['job_id'];
        $job = ParentJob::query()
            ->visibleOnPlatform()
            ->find($jobId);
        if (! $job) {
            return response()->json([
                'success' => false,
                'message' => 'Job not found.',
            ], 404);
        }
        if ($this->isParentInitiatedHireRequestJob($job->id)) {
            return response()->json([
                'success' => false,
                'message' => 'This job is a direct hire request and is not open for public Syttr requests.',
            ], 422);
        }

        $nannyId = $this->resolveNannyId($request, $data['nanny_id'] ?? null, $data['user_id'] ?? null);
        if (! $nannyId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing nanny_id or user_id.',
            ], 422);
        }
        if ($blocked = $this->ensureNannyCanAccessApp($nannyId)) {
            return $blocked;
        }

        $acceptedApplication = ParentJobApplication::query()
            ->visibleOnPlatform()
            ->where('job_id', $job->id)
            ->whereIn('status', $this->acceptedApplicationStatuses())
            ->orderByDesc('id')
            ->first();
        if ($acceptedApplication && $acceptedApplication->nanny_id !== $nannyId) {
            return response()->json([
                'success' => false,
                'message' => 'This job has already been accepted by another Syttr.',
            ], 422);
        }
        if (! $acceptedApplication && $this->isAcceptedStatus($job->status)) {
            return response()->json([
                'success' => false,
                'message' => 'This job is no longer available.',
            ], 422);
        }
        if ($acceptedApplication && $acceptedApplication->nanny_id === $nannyId) {
            return response()->json([
                'success' => true,
                'message' => 'This job is already accepted by you.',
                'data' => [
                    'application_id' => $acceptedApplication->id,
                    'job_id' => $job->id,
                    'nanny_id' => $nannyId,
                    'status' => $acceptedApplication->status,
                ],
            ]);
        }

        $application = ParentJobApplication::query()->firstOrCreate(
            [
                'job_id' => $job->id,
                'nanny_id' => $nannyId,
            ],
            [
                'status' => 'pending',
                'request_source' => 'job_post',
            ]
        );

        if (! $application->request_source) {
            $application->request_source = 'job_post';
            $application->save();
        }

        if ($application->wasRecentlyCreated) {
            $nannyUser = User::query()->where('user_id', $nannyId)->first();
            $nannyName = trim((string) ($nannyUser?->name ?? ''));
            $displayName = $nannyName !== '' ? $nannyName : 'Syttr';
            $nameParts = $nannyName !== '' ? preg_split('/\s+/', $nannyName) : [];
            $firstName = $nameParts[0] ?? null;
            $lastName = count($nameParts) > 1 ? implode(' ', array_slice($nameParts, 1)) : null;

            $jobKidIds = collect($job->kid_ids ?? [])
                ->map(static fn ($id) => (int) $id)
                ->filter(static fn ($id) => $id > 0)
                ->values();
            $jobKids = [];
            if ($jobKidIds->count() > 0) {
                $jobKids = ParentKid::query()
                    ->where('parent_profile_id', $job->user_id)
                    ->whereIn('id', $jobKidIds->all())
                    ->orderBy('id')
                    ->get(['id', 'name', 'age', 'gender'])
                    ->map(static fn (ParentKid $kid) => [
                        'id' => $kid->id,
                        'name' => $kid->name,
                        'age' => $kid->age,
                        'gender' => $kid->gender,
                    ])
                    ->values()
                    ->all();
            }

            NotificationController::createForUser(
                $job->user_id,
                'job_request',
                'New Syttr Request',
                $displayName.' has sent you a message for your job.',
                [
                    'job_id' => $job->id,
                    'nanny_id' => $nannyId,
                    'application_id' => $application->id,
                    'nanny_name' => $displayName,
                    'job' => [
                        'id' => $job->id,
                        'job_id' => $job->id,
                        'hours' => $job->hours !== null ? (float) $job->hours : null,
                        'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
                        'price' => $job->price !== null ? (float) $job->price : null,
                        'start_date' => optional($job->start_date)->format('Y-m-d'),
                        'end_date' => optional($job->end_date)->format('Y-m-d'),
                        'start_time' => (string) $job->start_time,
                        'end_time' => (string) ($job->end_time ?? ''),
                        'location' => $job->location,
                        'latitude' => $job->latitude !== null ? (float) $job->latitude : null,
                        'longitude' => $job->longitude !== null ? (float) $job->longitude : null,
                        'status' => (string) ($job->status ?: 'pending'),
                        'kids' => $jobKids,
                        'kid_names' => (string) ($job->kid_names ?? ''),
                    ],
                    'nanny' => [
                        'id' => $nannyId,
                        'fullname' => $displayName,
                        'first_name' => $firstName,
                        'last_name' => $lastName,
                        'name' => $displayName,
                    ],
                    'application' => [
                        'id' => $application->id,
                        'application_id' => $application->id,
                        'job_id' => $application->job_id,
                        'nanny_id' => $application->nanny_id,
                        'status' => $application->status,
                        'created_at' => optional($application->created_at)->toIso8601String(),
                    ],
                ],
                $nannyId
            );
        }

        return response()->json([
            'success' => true,
            'message' => $application->wasRecentlyCreated ? 'Request sent successfully.' : 'Request already sent.',
            'data' => [
                'application_id' => $application->id,
                'job_id' => $job->id,
                'nanny_id' => $nannyId,
                'status' => $application->status,
            ],
        ]);
    }

    public function acceptHireRequest(Request $request, int $applicationId): JsonResponse
    {
        return $this->resolveHireRequestDecision($request, $applicationId, 'accepted');
    }

    public function rejectHireRequest(Request $request, int $applicationId): JsonResponse
    {
        return $this->resolveHireRequestDecision($request, $applicationId, 'rejected');
    }

    public function cancelAcceptedJob(Request $request, int $applicationId): JsonResponse
    {
        $nannyId = $this->resolveNannyId(
            $request,
            $request->input('nanny_id'),
            $request->query('nanny_id'),
            $request->input('user_id'),
            $request->query('user_id')
        );
        if (! $nannyId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid nanny_id/user_id.',
            ], 422);
        }
        if ($blocked = $this->ensureNannyCanAccessApp($nannyId)) {
            return $blocked;
        }

        $result = DB::transaction(function () use ($applicationId, $nannyId) {
            $application = ParentJobApplication::query()
                ->whereKey($applicationId)
                ->where('nanny_id', $nannyId)
                ->lockForUpdate()
                ->first();
            if (! $application) {
                return ['error' => ['message' => 'Application not found.', 'status' => 404]];
            }

            $job = ParentJob::query()
                ->visibleOnPlatform()
                ->whereKey($application->job_id)
                ->lockForUpdate()
                ->first();
            if (! $job) {
                return ['error' => ['message' => 'Job not found.', 'status' => 404]];
            }

            $currentStatus = strtolower(trim((string) ($application->status ?? '')));
            if (! in_array($currentStatus, $this->acceptedApplicationStatuses(), true)) {
                return ['error' => ['message' => 'Only accepted jobs can be canceled by sitter.', 'status' => 422]];
            }

            $startAt = $this->buildJobStartAt($job, config('app.timezone'));
            $within24h = false;
            if ($startAt) {
                $within24h = Carbon::now(config('app.timezone'))->greaterThanOrEqualTo($startAt->copy()->subHours(24));
            }

            $application->status = 'cancelled';
            $application->nanny_canceled_at = Carbon::now(config('app.timezone'));
            $application->nanny_canceled_within_24h = $within24h;
            $application->nanny_reliability_penalty = $within24h ? 1 : 0;
            $application->save();

            if (in_array(strtolower(trim((string) ($job->status ?? ''))), $this->acceptedApplicationStatuses(), true)) {
                $job->status = 'pending';
                $job->save();
            }

            return ['job' => $job->fresh(), 'application' => $application->fresh(), 'within_24h' => $within24h];
        });

        if (is_array($result) && isset($result['error'])) {
            return response()->json([
                'success' => false,
                'message' => (string) ($result['error']['message'] ?? 'Unable to cancel job.'),
            ], (int) ($result['error']['status'] ?? 422));
        }

        $job = $result['job'];
        $application = $result['application'];
        $within24h = (bool) ($result['within_24h'] ?? false);

        NotificationController::createForUser(
            $job->user_id,
            'sitter_job_canceled',
            'Sitter Canceled Job',
            $within24h
                ? 'Your sitter canceled within 24 hours of the job start time.'
                : 'Your sitter canceled the job.',
            [
                'job_id' => $job->id,
                'application_id' => $application->id,
                'nanny_id' => $application->nanny_id,
                'within_24h' => $within24h,
                'reliability_penalty' => (int) ($application->nanny_reliability_penalty ?? 0),
            ],
            $application->nanny_id
        );

        return response()->json([
            'success' => true,
            'message' => 'Job canceled successfully.',
            'data' => [
                'application_id' => $application->id,
                'job_id' => $job->id,
                'status' => $application->status,
                'within_24h' => $within24h,
                'reliability_penalty' => (int) ($application->nanny_reliability_penalty ?? 0),
            ],
        ]);
    }

    public function details(Request $request, int $jobId): JsonResponse
    {
        $viewerNannyId = $this->resolveNannyId(
            $request,
            $request->input('nanny_id'),
            $request->query('nanny_id'),
            $request->input('user_id'),
            $request->query('user_id')
        );
        if ($viewerNannyId && ($blocked = $this->ensureNannyCanAccessApp($viewerNannyId))) {
            return $blocked;
        }

        $job = ParentJob::query()
            ->visibleOnPlatform()
            ->find($jobId);
        if (! $job) {
            return response()->json([
                'success' => false,
                'message' => 'Job not found.',
            ], 404);
        }

        $kids = ParentKid::query()
            ->where('parent_profile_id', $job->user_id)
            ->whereIn('id', collect($job->kid_ids ?? [])->map(static fn ($id) => (int) $id)->all())
            ->orderBy('id')
            ->get(['id', 'name', 'age', 'gender', 'allergies', 'medical_conditions', 'notes']);

        $parentUser = User::query()->where('user_id', $job->user_id)->first();
        $parentProfile = ParentProfile::query()->where('user_id', $job->user_id)->first();
        $parentStats = $this->buildParentRatingStats($job->user_id);

        $applications = ParentJobApplication::query()
            ->visibleOnPlatform()
            ->where('job_id', $job->id)
            ->orderBy('id')
            ->get([
                'id',
                'job_id',
                'nanny_id',
                'status',
                'request_source',
                'parent_rating',
                'parent_review',
                'parent_rated_at',
                'nanny_rating',
                'nanny_review',
                'nanny_rated_at',
                'nanny_canceled_at',
                'nanny_canceled_within_24h',
                'nanny_reliability_penalty',
                'created_at',
                'updated_at',
            ]);
        $jobRequestSource = $applications->contains(
            static fn (ParentJobApplication $app) => strtolower(trim((string) ($app->request_source ?? ''))) === 'hire_request'
        )
            ? 'hire_request'
            : ($applications->contains(
                static fn (ParentJobApplication $app) => strtolower(trim((string) ($app->request_source ?? ''))) === 'job_post'
            )
                ? 'job_post'
                : null);
        $nannyPublicIds = $applications
            ->pluck('nanny_id')
            ->filter(static fn ($id) => trim((string) $id) !== '')
            ->unique()
            ->values();
        $nannyUsers = $nannyPublicIds->count() > 0
            ? User::query()
                ->visibleOnPlatform()
                ->whereIn('user_id', $nannyPublicIds->all())
                ->get(['id', 'user_id', 'name', 'email'])
                ->keyBy('user_id')
            : collect();
        $applications = $applications
            ->filter(static fn (ParentJobApplication $app) => $nannyUsers->has($app->nanny_id))
            ->values();
        $nannyProfiles = $nannyUsers->count() > 0
            ? SyttrProfile::query()
                ->whereIn('user_id', $nannyUsers->pluck('id')->all())
                ->get([
                    'user_id',
                    'phone',
                    'city',
                    'address',
                    'country',
                    'experience_years',
                    'hourly_rate',
                    'bio',
                    'user_image',
                ])
                ->keyBy('user_id')
            : collect();
        $buildNannyPayload = static function (?string $nannyPublicId) use ($nannyUsers, $nannyProfiles): array {
            $publicId = trim((string) ($nannyPublicId ?? ''));
            if ($publicId === '') {
                return [];
            }

            $nannyUser = $nannyUsers->get($publicId);
            $nannyProfile = $nannyUser ? $nannyProfiles->get($nannyUser->id) : null;
            $nannyName = trim((string) ($nannyUser?->name ?? ''));

            return [
                'id' => $publicId,
                'nanny_id' => $publicId,
                'fullname' => $nannyName !== '' ? $nannyName : null,
                'name' => $nannyName !== '' ? $nannyName : null,
                'city' => $nannyProfile?->city,
                'address' => $nannyProfile?->address,
                'country' => $nannyProfile?->country,
                'experience' => $nannyProfile?->experience_years,
                'hourly_rate' => $nannyProfile?->hourly_rate !== null ? (float) $nannyProfile->hourly_rate : null,
                'bio' => $nannyProfile?->bio,
                'profile_image' => $nannyProfile?->user_image_url,
                'user_image' => $nannyProfile?->user_image,
                'user_image_url' => $nannyProfile?->user_image_url,
            ];
        };
        $serializedApplications = $applications->map(
            static fn (ParentJobApplication $app) => [
                'id' => $app->id,
                'application_id' => $app->id,
                'job_id' => $app->job_id,
                'nanny_id' => $app->nanny_id,
                'status' => $app->status,
                'request_source' => $app->request_source,
                'parent_rating' => $app->parent_rating,
                'parent_review' => $app->parent_review,
                'parent_rated_at' => optional($app->parent_rated_at)->toISOString(),
                'nanny_rating' => $app->nanny_rating,
                'nanny_review' => $app->nanny_review,
                'nanny_rated_at' => optional($app->nanny_rated_at)->toISOString(),
                'nanny_canceled_at' => optional($app->nanny_canceled_at)->toISOString(),
                'nanny_canceled_within_24h' => (bool) ($app->nanny_canceled_within_24h ?? false),
                'nanny_reliability_penalty' => (int) ($app->nanny_reliability_penalty ?? 0),
                'created_at' => optional($app->created_at)->toDateTimeString(),
                'updated_at' => optional($app->updated_at)->toDateTimeString(),
                'nanny' => $buildNannyPayload((string) $app->nanny_id),
            ]
        )->values()->all();
        $nannies = $nannyPublicIds
            ->map(static fn ($nannyId) => $buildNannyPayload((string) $nannyId))
            ->filter(static fn ($nanny) => !empty($nanny))
            ->values()
            ->all();
        $viewerApplication = $viewerNannyId
            ? $applications->first(static fn (ParentJobApplication $app) => $app->nanny_id === $viewerNannyId)
            : null;
        $viewerApplicationStatus = $viewerApplication?->status ? (string) $viewerApplication->status : null;
        $viewerStatusNormalized = strtolower(trim((string) ($viewerApplicationStatus ?? '')));
        $hasPendingApplication = in_array($viewerStatusNormalized, ['pending', 'requested', 'request_sent', 'applied', 'waiting'], true);

        return response()->json([
            'success' => true,
            'data' => [
                'job' => [
                    'id' => $job->id,
                    'job_id' => $job->id,
                    'user_id' => $job->user_id,
                    'kid_ids' => $job->kid_ids ?? [],
                    'kid_names' => $job->kid_names,
                    'hours' => $job->hours !== null ? (float) $job->hours : null,
                    'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
                    'price' => $job->price !== null ? (float) $job->price : null,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'end_date' => optional($job->end_date)->format('Y-m-d'),
                    'start_time' => (string) $job->start_time,
                    'end_time' => (string) ($job->end_time ?? ''),
                    'location' => $job->location,
                    'latitude' => $job->latitude !== null ? (float) $job->latitude : null,
                    'longitude' => $job->longitude !== null ? (float) $job->longitude : null,
                    'parent_image' => $parentProfile?->user_image_url,
                    'parent_image_url' => $parentProfile?->user_image_url,
                    'parent_average_rating' => $parentStats['average_rating'],
                    'parent_jobs_posted_count' => $parentStats['jobs_posted_count'],
                    // Keep parent_ratings_count as unique raters count for UI wording.
                    'parent_ratings_count' => $parentStats['raters_count'],
                    'parent_raters_count' => $parentStats['raters_count'],
                    'parent_total_ratings_count' => $parentStats['ratings_count'],
                    'status' => $job->status,
                    'job_status' => $job->status,
                    'request_source' => $jobRequestSource,
                    'application_status' => $viewerApplicationStatus,
                    'my_application_status' => $viewerApplicationStatus,
                    'has_applied' => $viewerApplication !== null,
                    'has_pending_application' => $hasPendingApplication,
                    'applications' => $serializedApplications,
                    'created_at' => optional($job->created_at)->toIso8601String(),
                    'updated_at' => optional($job->updated_at)->toIso8601String(),
                ],
                'parent' => [
                    'parent_name' => $parentUser?->name,
                    'city' => $parentProfile?->city,
                    'city_area' => $parentProfile?->city,
                    'country' => $parentProfile?->country,
                    'address' => $parentProfile?->address,
                    'user_image' => $parentProfile?->user_image,
                    'user_image_url' => $parentProfile?->user_image_url,
                    'profile_image' => $parentProfile?->user_image_url,
                    'average_rating' => $parentStats['average_rating'],
                    'jobs_posted_count' => $parentStats['jobs_posted_count'],
                    // Keep ratings_count as unique raters for direct parent block usage.
                    'ratings_count' => $parentStats['raters_count'],
                    'raters_count' => $parentStats['raters_count'],
                    'total_ratings_count' => $parentStats['ratings_count'],
                ],
                'kids' => $kids,
                'nannies' => $nannies,
                'applications' => $serializedApplications,
            ],
        ]);
    }

    public function detailsByBody(Request $request): JsonResponse
    {
        $jobId = (int) (
            $request->input('job_id') ??
            $request->input('id') ??
            $request->input('booking_id') ??
            0
        );
        if ($jobId <= 0) {
            return response()->json([
                'success' => false,
                'message' => 'job_id is required.',
            ], 422);
        }

        return $this->details($request, $jobId);
    }

    private function resolveNannyId(Request $request, mixed ...$candidates): ?string
    {
        foreach ($candidates as $candidate) {
            if ($candidate === null || $candidate === '') {
                continue;
            }
            $resolved = User::resolvePublicUserIdByIdentifier($candidate);
            if ($resolved) {
                return $resolved;
            }
        }

        $bearer = trim((string) $request->bearerToken());
        if ($bearer !== '') {
            $resolved = User::query()->where('api_token', $bearer)->value('user_id');
            if ($resolved) {
                return (string) $resolved;
            }
        }

        return null;
    }

    private function ensureNannyCanAccessApp(?string $nannyId): ?JsonResponse
    {
        $normalizedNannyId = strtoupper(trim((string) ($nannyId ?? '')));
        if ($normalizedNannyId === '') {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid nanny_id/user_id.',
            ], 422);
        }

        $user = User::query()
            ->where('user_id', $normalizedNannyId)
            ->first(['user_id', 'is_blacklisted', 'blacklisted_reason']);

        if (! $user || ! (bool) $user->is_blacklisted) {
            return null;
        }

        return response()->json([
            'success' => false,
            'status' => 'blacklisted',
            'is_blacklisted' => true,
            'blacklisted_reason' => $user->blacklisted_reason,
            'message' => 'This account is blacklisted and cannot access sitter actions.',
        ], 403);
    }

    private function resolveHireRequestDecision(
        Request $request,
        int $applicationId,
        string $decision
    ): JsonResponse {
        $normalizedDecision = strtolower(trim($decision)) === 'accepted' ? 'accepted' : 'rejected';
        $nannyId = $this->resolveNannyId(
            $request,
            $request->input('nanny_id'),
            $request->query('nanny_id'),
            $request->input('user_id'),
            $request->query('user_id')
        );

        if (! $nannyId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid nanny_id/user_id.',
            ], 422);
        }
        if ($blocked = $this->ensureNannyCanAccessApp($nannyId)) {
            return $blocked;
        }

        $result = DB::transaction(function () use ($applicationId, $nannyId, $normalizedDecision) {
            $application = ParentJobApplication::query()
                ->visibleOnPlatform()
                ->whereKey($applicationId)
                ->where('nanny_id', $nannyId)
                ->lockForUpdate()
                ->first();
            if (! $application) {
                return [
                    'error' => [
                        'message' => 'Hire request not found.',
                        'status' => 404,
                    ],
                ];
            }

            $job = ParentJob::query()
                ->visibleOnPlatform()
                ->whereKey($application->job_id)
                ->lockForUpdate()
                ->first();
            if (! $job) {
                return [
                    'error' => [
                        'message' => 'Job not found.',
                        'status' => 404,
                    ],
                ];
            }

            $currentStatus = strtolower(trim((string) ($application->status ?? '')));
            $currentIsAccepted = in_array($currentStatus, $this->acceptedApplicationStatuses(), true);
            $currentIsRejected = in_array($currentStatus, ['rejected', 'reject', 'declined', 'decline'], true);
            if (
                ($currentIsAccepted && $normalizedDecision !== 'accepted') ||
                ($currentIsRejected && $normalizedDecision !== 'rejected')
            ) {
                return [
                    'error' => [
                        'message' => 'Hire request has already been finalized.',
                        'status' => 422,
                    ],
                ];
            }

            if ($normalizedDecision === 'accepted') {
                $alreadyAcceptedByAnotherNanny = ParentJobApplication::query()
                    ->where('job_id', $job->id)
                    ->where('id', '!=', $application->id)
                    ->whereIn('status', $this->acceptedApplicationStatuses())
                    ->lockForUpdate()
                    ->exists();
                if ($alreadyAcceptedByAnotherNanny) {
                    return [
                        'error' => [
                            'message' => 'This hire request has already been accepted by another Syttr.',
                            'status' => 422,
                        ],
                    ];
                }
            }

            if ($currentStatus !== $normalizedDecision) {
                $application->status = $normalizedDecision;
                $application->save();
            }

            $jobStatus = strtolower(trim((string) ($job->status ?? '')));
            if ($normalizedDecision === 'accepted' && $jobStatus !== 'accepted') {
                $job->status = 'accepted';
                $job->save();
            }

            $autoRejectedApplicationIds = [];
            if ($normalizedDecision === 'accepted') {
                $autoRejectedApplications = ParentJobApplication::query()
                    ->where('job_id', $job->id)
                    ->where('id', '!=', $application->id)
                    ->whereNotIn('status', $this->finalizedApplicationStatuses())
                    ->lockForUpdate()
                    ->get(['id']);
                $autoRejectedApplicationIds = $autoRejectedApplications
                    ->pluck('id')
                    ->map(static fn ($id) => (int) $id)
                    ->values()
                    ->all();

                if (count($autoRejectedApplicationIds) > 0) {
                    ParentJobApplication::query()
                        ->whereIn('id', $autoRejectedApplicationIds)
                        ->update(['status' => 'rejected']);
                }
            }

            return [
                'job' => $job->fresh(),
                'application' => $application->fresh(),
                'auto_rejected_application_ids' => $autoRejectedApplicationIds,
            ];
        });

        if (is_array($result) && isset($result['error'])) {
            return response()->json([
                'success' => false,
                'message' => (string) ($result['error']['message'] ?? 'Unable to process hire request.'),
            ], (int) ($result['error']['status'] ?? 422));
        }

        $job = $result['job'];
        $application = $result['application'];

        $conversationId = $normalizedDecision === 'accepted'
            ? $this->ensureChatConversation($job->user_id, $application->nanny_id)
            : null;

        $this->notifyParentHireRequestDecision(
            $job,
            $application,
            $nannyId,
            $normalizedDecision,
            $conversationId
        );
        if ($normalizedDecision === 'accepted') {
            $this->notifyAutoRejectedHireRequests(
                $job,
                $application,
                $result['auto_rejected_application_ids'] ?? []
            );
        }

        UserNotification::query()
            ->where('recipient_user_id', $nannyId)
            ->where('type', 'hire_request')
            ->where(function ($query) use ($application) {
                $query
                    ->where('data->application_id', $application->id)
                    ->orWhere('data->application->id', $application->id)
                    ->orWhere('data->application->application_id', $application->id);
            })
            ->get()
            ->each(function (UserNotification $notification) use ($application, $normalizedDecision): void {
                $data = is_array($notification->data) ? $notification->data : [];
                $data['status'] = $normalizedDecision;
                $data['request_status'] = $normalizedDecision;
                $data['application_status'] = $normalizedDecision;

                $applicationData = is_array($data['application'] ?? null) ? $data['application'] : [];
                $applicationData['id'] = $applicationData['id'] ?? $application->id;
                $applicationData['application_id'] = $applicationData['application_id'] ?? $application->id;
                $applicationData['job_id'] = $applicationData['job_id'] ?? $application->job_id;
                $applicationData['nanny_id'] = $applicationData['nanny_id'] ?? $application->nanny_id;
                $applicationData['status'] = $normalizedDecision;
                $applicationData['updated_at'] = optional($application->updated_at)->toIso8601String();
                $data['application'] = $applicationData;

                $notification->data = $data;
                $notification->type = $normalizedDecision === 'accepted' ? 'hire_accepted' : 'hire_rejected';
                $notification->title = $normalizedDecision === 'accepted' ? 'Hire Request Accepted' : 'Hire Request Declined';
                $notification->message = $normalizedDecision === 'accepted'
                    ? 'You accepted the hire request.'
                    : 'You declined the hire request.';
                $notification->is_read = true;
                $notification->opened_at = Carbon::now();
                $notification->save();
            });

        return response()->json([
            'success' => true,
            'message' => $normalizedDecision === 'accepted'
                ? 'Hire request accepted successfully.'
                : 'Hire request rejected successfully.',
            'data' => [
                'application_id' => $application->id,
                'job_id' => $job->id,
                'status' => $application->status,
                'conversation_id' => $conversationId,
                'auto_rejected_application_ids' => $result['auto_rejected_application_ids'] ?? [],
            ],
        ]);
    }

    private function notifyParentHireRequestDecision(
        ParentJob $job,
        ParentJobApplication $application,
        string $nannyUserId,
        string $decision,
        ?int $conversationId = null
    ): void {
        $normalizedDecision = strtolower(trim($decision)) === 'accepted' ? 'accepted' : 'rejected';
        $notificationType = $normalizedDecision === 'accepted' ? 'hire_accepted' : 'hire_rejected';
        $notificationKey = 'hire-request:'.$application->id.':'.$normalizedDecision;

        $alreadySent = UserNotification::query()
            ->where('recipient_user_id', $job->user_id)
            ->where('type', $notificationType)
            ->where('data->notification_key', $notificationKey)
            ->exists();
        if ($alreadySent) {
            return;
        }

        $nannyName = trim((string) (User::query()->where('user_id', $nannyUserId)->value('name') ?? 'Syttr'));
        $displayNanny = $nannyName !== '' ? $nannyName : 'Syttr';
        $nannyInternalId = User::resolveInternalIdByIdentifier($nannyUserId);
        $nannyProfile = $nannyInternalId
            ? SyttrProfile::query()->where('user_id', $nannyInternalId)->first()
            : null;

        NotificationController::createForUser(
            $job->user_id,
            $notificationType,
            $normalizedDecision === 'accepted' ? 'Hire Request Accepted' : 'Hire Request Declined',
            $normalizedDecision === 'accepted'
                ? 'Your sitter has accepted the job request.'
                : 'The sitter has declined the job request.',
            [
                'notification_key' => $notificationKey,
                'job_id' => $job->id,
                'application_id' => $application->id,
                'nanny_id' => $application->nanny_id,
                'parent_user_id' => $job->user_id,
                'status' => $normalizedDecision,
                'request_status' => $normalizedDecision,
                'application_status' => $normalizedDecision,
                'request_source' => 'hire_request',
                'conversation_id' => $conversationId,
                'job' => [
                    'id' => $job->id,
                    'job_id' => $job->id,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'end_date' => optional($job->end_date)->format('Y-m-d'),
                    'start_time' => (string) $job->start_time,
                    'end_time' => (string) ($job->end_time ?? ''),
                    'location' => $job->location,
                    'latitude' => $job->latitude !== null ? (float) $job->latitude : null,
                    'longitude' => $job->longitude !== null ? (float) $job->longitude : null,
                    'hours' => $job->hours !== null ? (float) $job->hours : null,
                    'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
                    'price' => $job->price !== null ? (float) $job->price : null,
                    'status' => (string) ($job->status ?: $normalizedDecision),
                    'request_source' => 'hire_request',
                ],
                'nanny' => [
                    'id' => $nannyUserId,
                    'nanny_id' => $nannyUserId,
                    'name' => $displayNanny,
                    'fullname' => $displayNanny,
                    'city' => $nannyProfile?->city,
                    'country' => $nannyProfile?->country,
                    'profile_image' => $nannyProfile?->user_image_url,
                    'user_image' => $nannyProfile?->user_image,
                    'user_image_url' => $nannyProfile?->user_image_url,
                ],
                'application' => [
                    'id' => $application->id,
                    'application_id' => $application->id,
                    'job_id' => $application->job_id,
                    'nanny_id' => $application->nanny_id,
                    'status' => $application->status,
                    'request_source' => 'hire_request',
                    'created_at' => optional($application->created_at)->toIso8601String(),
                    'updated_at' => optional($application->updated_at)->toIso8601String(),
                ],
            ],
            $nannyUserId
        );
    }

    private function notifyAutoRejectedHireRequests(
        ParentJob $job,
        ParentJobApplication $acceptedApplication,
        array $autoRejectedApplicationIds
    ): void {
        $applicationIds = collect($autoRejectedApplicationIds)
            ->map(static fn ($id) => (int) $id)
            ->filter(static fn ($id) => $id > 0)
            ->values()
            ->all();

        if (count($applicationIds) === 0) {
            return;
        }

        $applications = ParentJobApplication::query()
            ->whereIn('id', $applicationIds)
            ->get();

        foreach ($applications as $application) {
            $notificationKey = 'hire-request:'.$application->id.':closed';
            $message = 'This job request is no longer available because the parent hired another Syttr.';

            UserNotification::query()
                ->where('recipient_user_id', $application->nanny_id)
                ->where('type', 'hire_request')
                ->where(function ($query) use ($application) {
                    $query
                        ->where('data->application_id', $application->id)
                        ->orWhere('data->application->id', $application->id)
                        ->orWhere('data->application->application_id', $application->id);
                })
                ->get()
                ->each(function (UserNotification $notification) use ($application, $job, $acceptedApplication, $notificationKey, $message): void {
                    $data = is_array($notification->data) ? $notification->data : [];
                    $data['notification_key'] = $notificationKey;
                    $data['status'] = 'rejected';
                    $data['request_status'] = 'rejected';
                    $data['application_status'] = 'rejected';
                    $data['closed_reason'] = 'accepted_by_another_syttr';
                    $data['accepted_application_id'] = $acceptedApplication->id;
                    $data['job_id'] = $data['job_id'] ?? $job->id;

                    $applicationData = is_array($data['application'] ?? null) ? $data['application'] : [];
                    $applicationData['id'] = $applicationData['id'] ?? $application->id;
                    $applicationData['application_id'] = $applicationData['application_id'] ?? $application->id;
                    $applicationData['job_id'] = $applicationData['job_id'] ?? $application->job_id;
                    $applicationData['nanny_id'] = $applicationData['nanny_id'] ?? $application->nanny_id;
                    $applicationData['status'] = 'rejected';
                    $applicationData['updated_at'] = optional($application->updated_at)->toIso8601String();
                    $data['application'] = $applicationData;

                    $notification->data = $data;
                    $notification->type = 'hire_request_closed';
                    $notification->title = 'Hire Request Closed';
                    $notification->message = $message;
                    $notification->is_read = false;
                    $notification->opened_at = null;
                    $notification->save();
                });

            $alreadySent = UserNotification::query()
                ->where('recipient_user_id', $application->nanny_id)
                ->where('type', 'hire_request_closed')
                ->where('data->notification_key', $notificationKey)
                ->exists();

            if ($alreadySent) {
                continue;
            }

            NotificationController::createForUser(
                $application->nanny_id,
                'hire_request_closed',
                'Hire Request Closed',
                $message,
                [
                    'notification_key' => $notificationKey,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'accepted_application_id' => $acceptedApplication->id,
                    'nanny_id' => $application->nanny_id,
                    'parent_user_id' => $job->user_id,
                    'status' => 'rejected',
                    'request_status' => 'rejected',
                    'application_status' => 'rejected',
                    'closed_reason' => 'accepted_by_another_syttr',
                    'job' => [
                        'id' => $job->id,
                        'job_id' => $job->id,
                        'start_date' => optional($job->start_date)->format('Y-m-d'),
                        'end_date' => optional($job->end_date)->format('Y-m-d'),
                        'start_time' => (string) $job->start_time,
                        'end_time' => (string) ($job->end_time ?? ''),
                        'location' => $job->location,
                        'status' => (string) ($job->status ?: 'accepted'),
                    ],
                    'application' => [
                        'id' => $application->id,
                        'application_id' => $application->id,
                        'job_id' => $application->job_id,
                        'nanny_id' => $application->nanny_id,
                        'status' => 'rejected',
                        'created_at' => optional($application->created_at)->toIso8601String(),
                        'updated_at' => optional($application->updated_at)->toIso8601String(),
                    ],
                ],
                $acceptedApplication->nanny_id
            );
        }
    }

    private function ensureChatConversation(string $parentUserId, string $nannyUserId): ?int
    {
        $parentPublicId = strtoupper(trim((string) $parentUserId));
        $nannyPublicId = strtoupper(trim((string) $nannyUserId));
        if (
            $parentPublicId === '' ||
            $nannyPublicId === '' ||
            $parentPublicId === $nannyPublicId
        ) {
            return null;
        }

        $conversation = ChatConversation::query()->firstOrCreate([
            'user_id' => $parentPublicId,
            'nanny_id' => $nannyPublicId,
        ]);

        return $conversation?->id ? (int) $conversation->id : null;
    }

    private function acceptedApplicationStatuses(): array
    {
        return ['accepted', 'accept', 'approved', 'confirmed', 'confirm'];
    }

    private function finalizedApplicationStatuses(): array
    {
        return [
            ...$this->acceptedApplicationStatuses(),
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

    private function isParentInitiatedHireRequestJob(int $jobId): bool
    {
        return ParentJobApplication::query()
            ->where('job_id', $jobId)
            ->where(function ($query) {
                $query
                    ->whereRaw('LOWER(COALESCE(request_source, "")) IN (?, ?)', ['hire_request', 'hire-request'])
                    ->orWhereRaw('LOWER(COALESCE(status, "")) IN (?, ?)', ['hire_requested', 'hire-requested'])
                    ->orWhere('message', 'like', '%source:hire_now%');
            })
            ->exists();
    }

    private function isAcceptedStatus(?string $status): bool
    {
        return in_array(
            strtolower(trim((string) ($status ?? ''))),
            $this->acceptedApplicationStatuses(),
            true
        );
    }

    private function buildJobStartAt(ParentJob $job, string $timezone): ?Carbon
    {
        $date = optional($job->start_date)->format('Y-m-d');
        $time = trim((string) ($job->start_time ?? ''));
        if (! $date || $time === '') {
            return null;
        }

        $raw = $date.' '.$time;
        $formats = ['Y-m-d H:i:s', 'Y-m-d H:i', 'Y-m-d h:i A', 'Y-m-d g:i A', 'Y-m-d h:iA', 'Y-m-d g:iA'];
        foreach ($formats as $format) {
            try {
                $parsed = Carbon::createFromFormat($format, $raw, $timezone);
                if ($parsed) {
                    return $parsed;
                }
            } catch (\Throwable) {
                // Try next format.
            }
        }

        try {
            return Carbon::parse($raw, $timezone);
        } catch (\Throwable) {
            return null;
        }
    }

    private function buildParentRatingStats(?string $parentUserId): array
    {
        $publicId = strtoupper(trim((string) ($parentUserId ?? '')));
        if ($publicId === '') {
            return [
                'average_rating' => null,
                'jobs_posted_count' => 0,
                'ratings_count' => 0,
                'raters_count' => 0,
            ];
        }

        $jobsPostedCount = (int) ParentJob::query()
            ->where('user_id', $publicId)
            ->count();

        $ratingsBase = ParentJobApplication::query()
            ->join('parent_jobs', 'parent_jobs.id', '=', 'parent_job_applications.job_id')
            ->where('parent_jobs.user_id', $publicId)
            ->whereNotNull('parent_job_applications.nanny_rating');

        $ratingsCount = (int) (clone $ratingsBase)->count();
        $ratersCount = (int) ((clone $ratingsBase)
            ->selectRaw('COUNT(DISTINCT parent_job_applications.nanny_id) as aggregate')
            ->value('aggregate') ?? 0);
        $average = (clone $ratingsBase)->avg('parent_job_applications.nanny_rating');
        $averageRating = $average !== null ? round((float) $average, 2) : null;

        return [
            'average_rating' => $averageRating,
            'jobs_posted_count' => $jobsPostedCount,
            'ratings_count' => $ratingsCount,
            'raters_count' => $ratersCount,
        ];
    }
}
