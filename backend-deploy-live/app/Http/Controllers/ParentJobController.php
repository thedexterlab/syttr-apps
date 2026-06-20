<?php

namespace App\Http\Controllers;

use App\Models\ChatConversation;
use App\Models\PaymentMethod;
use App\Models\ParentJob;
use App\Models\ParentJobApplication;
use App\Models\ParentKid;
use App\Models\ParentProfile;
use App\Models\SyttrProfile;
use App\Models\UserNotification;
use App\Models\User;
use App\Models\WalletTransaction;
use App\Support\StripeCustomerManager;
use App\Support\StripeTransactionRecorder;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class ParentJobController extends Controller
{
    public function jobRequests(Request $request): JsonResponse
    {
        $inputUserId = trim((string) ($request->input('user_id', $request->query('user_id', ''))));
        if ($inputUserId === '') {
            return response()->json([
                'success' => true,
                'data' => [],
            ]);
        }

        $publicUserId = User::resolvePublicUserIdByIdentifier($inputUserId);
        if (! $publicUserId) {
            return response()->json([
                'success' => true,
                'data' => [],
            ]);
        }

        $applications = ParentJobApplication::query()
            ->visibleOnPlatform()
            ->whereHas('job', fn ($query) => $query->where('user_id', $publicUserId))
            ->with('job')
            ->latest()
            ->get()
            ->reject(function (ParentJobApplication $application) {
                return $this->isPendingParentInitiatedHireRequestApplication($application);
            })
            ->values();

        $requestNotifications = UserNotification::query()
            ->where('recipient_user_id', $publicUserId)
            ->where(function ($query) {
                $query
                    ->whereIn('type', ['job_request', 'job_application', 'new_job_request', 'new_application', 'hire_accepted', 'hire_rejected'])
                    ->orWhere('title', 'like', '%job request%')
                    ->orWhere('title', 'like', '%booking request%')
                    ->orWhere('title', 'like', '%new application%')
                    ->orWhere('title', 'like', '%hire request accepted%')
                    ->orWhere('title', 'like', '%hire request declined%')
                    ->orWhere('message', 'like', '%job request%')
                    ->orWhere('message', 'like', '%booking request%')
                    ->orWhere('message', 'like', '%new application%')
                    ->orWhere('message', 'like', '%applied for your job%')
                    ->orWhere('message', 'like', '%request from syttr%')
                    ->orWhere('message', 'like', '%accepted the job request%')
                    ->orWhere('message', 'like', '%declined the job request%');
            })
            ->latest()
            ->get();

        $notificationsByApplicationId = [];
        foreach ($requestNotifications as $notification) {
            foreach ($this->extractNotificationApplicationIds($notification) as $applicationId) {
                $notificationsByApplicationId[$applicationId] ??= [];
                $notificationsByApplicationId[$applicationId][] = $notification;
            }
        }

        $rows = $applications->map(function (ParentJobApplication $application) use ($notificationsByApplicationId) {
            $job = $application->job;
            $nannyUser = User::query()
                ->visibleOnPlatform()
                ->where('user_id', $application->nanny_id)
                ->first();
            if (! $nannyUser) {
                return null;
            }
            $nannyInternalId = User::resolveInternalIdByIdentifier($application->nanny_id);
            $nannyProfile = $nannyInternalId
                ? SyttrProfile::query()->where('user_id', $nannyInternalId)->first()
                : null;
            $matchedNotifications = collect($notificationsByApplicationId[(int) $application->id] ?? []);
            /** @var UserNotification|null $requestNotification */
            $requestNotification = $matchedNotifications->first();
            $notificationIds = $matchedNotifications
                ->map(static fn (UserNotification $notification) => (string) $notification->id)
                ->filter(static fn (string $id) => $id !== '')
                ->values()
                ->all();

            $kids = [];
            $kidNames = '';
            if ($job) {
                $jobKidIds = collect($job->kid_ids ?? [])
                    ->map(static fn ($id) => (int) $id)
                    ->filter(static fn ($id) => $id > 0)
                    ->values();
                if ($jobKidIds->count() > 0) {
                    $kids = ParentKid::query()
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
                $kidNames = (string) ($job->kid_names ?? '');
            }

            $nannyName = trim((string) ($nannyUser?->name ?? ''));
            $fallbackMessage = ($nannyName !== '' ? $nannyName : 'A Syttr').' has sent you a request for your job.';
            $resolvedNotificationId = $requestNotification?->id ? (string) $requestNotification->id : null;
            $resolvedCreatedAt = $requestNotification?->created_at ?: $application->created_at;
            $resolvedUpdatedAt = $requestNotification?->updated_at ?: $application->updated_at;

            return [
                'id' => $resolvedNotificationId ?: $application->id,
                'notification_id' => $resolvedNotificationId,
                'source_ids' => count($notificationIds) > 0 ? $notificationIds : [(string) $application->id],
                'type' => $requestNotification?->type ?: 'job_request',
                'title' => trim((string) ($requestNotification?->title ?? '')) !== ''
                    ? (string) $requestNotification->title
                    : 'New Syttr Request',
                'message' => trim((string) ($requestNotification?->message ?? '')) !== ''
                    ? (string) $requestNotification->message
                    : $fallbackMessage,
                'is_read' => $requestNotification?->is_read ? 1 : 0,
                'isRead' => (bool) ($requestNotification?->is_read ?? false),
                'created_at' => optional($resolvedCreatedAt)->toISOString(),
                'updated_at' => optional($resolvedUpdatedAt)->toISOString(),
                'status' => (string) ($application->status ?: 'pending'),
                'application_status' => (string) ($application->status ?: 'pending'),
                'request_source' => (string) ($application->request_source ?: ''),
                'application_id' => $application->id,
                'job_id' => $job?->id,
                'nanny_id' => $application->nanny_id,
                'nanny_name' => $nannyName !== '' ? $nannyName : null,
                'job' => $job ? [
                    'id' => $job->id,
                    'job_id' => $job->id,
                    'hours' => $job->hours !== null ? (float) $job->hours : null,
                    'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
                    'price' => $job->price !== null ? (float) $job->price : null,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'end_date' => optional($job->end_date)->format('Y-m-d'),
                    'start_time' => (string) ($job->start_time ?? ''),
                    'end_time' => (string) ($job->end_time ?? ''),
                    'location' => $job->location,
                    'latitude' => $job->latitude !== null ? (float) $job->latitude : null,
                    'longitude' => $job->longitude !== null ? (float) $job->longitude : null,
                    'status' => (string) ($job->status ?: 'pending'),
                    'kids' => $kids,
                    'kid_names' => $kidNames,
                ] : null,
                'nanny' => [
                    'id' => $application->nanny_id,
                    'fullname' => $nannyName !== '' ? $nannyName : null,
                    'name' => $nannyName !== '' ? $nannyName : null,
                    'city' => $nannyProfile?->city,
                    'country' => $nannyProfile?->country,
                    'experience' => $nannyProfile?->experience_years,
                    'hourly_rate' => $nannyProfile?->hourly_rate,
                    'bio' => $nannyProfile?->bio,
                    'profile_image' => $nannyProfile?->user_image,
                    'user_image_url' => $nannyProfile?->user_image_url,
                ],
                'application' => [
                    'id' => $application->id,
                    'application_id' => $application->id,
                    'job_id' => $application->job_id,
                    'nanny_id' => $application->nanny_id,
                    'status' => $application->status,
                    'request_source' => $application->request_source,
                    'created_at' => optional($application->created_at)->toIso8601String(),
                    'updated_at' => optional($application->updated_at)->toIso8601String(),
                ],
            ];
        })->filter()->values()->all();

        return response()->json([
            'success' => true,
            'data' => $rows,
        ]);
    }

    private function extractNotificationApplicationIds(UserNotification $notification): array
    {
        $data = is_array($notification->data) ? $notification->data : [];
        $nestedData = is_array($data['data'] ?? null) ? $data['data'] : [];
        $application = is_array($data['application'] ?? null)
            ? $data['application']
            : (is_array($nestedData['application'] ?? null) ? $nestedData['application'] : []);

        return collect([
            $data['application_id'] ?? null,
            $data['job_application_id'] ?? null,
            $nestedData['application_id'] ?? null,
            $nestedData['job_application_id'] ?? null,
            $application['application_id'] ?? null,
            $application['id'] ?? null,
        ])
            ->map(static function ($value) {
                if ($value === null || $value === '') {
                    return null;
                }

                return is_numeric((string) $value) ? (int) $value : null;
            })
            ->filter(static fn ($value) => $value !== null)
            ->unique()
            ->values()
            ->all();
    }

    public function destroyJobRequest(Request $request, int $applicationId): JsonResponse
    {
        $inputUserId = trim((string) ($request->input('user_id', $request->query('user_id', ''))));
        if ($inputUserId === '') {
            return response()->json(['success' => false, 'message' => 'Missing user_id.'], 422);
        }

        $publicUserId = User::resolvePublicUserIdByIdentifier($inputUserId);
        if (! $publicUserId) {
            return response()->json(['success' => false, 'message' => 'Invalid user_id.'], 422);
        }

        $application = ParentJobApplication::query()
            ->whereKey($applicationId)
            ->whereHas('job', fn ($query) => $query->where('user_id', $publicUserId))
            ->first();

        if (! $application) {
            return response()->json(['success' => false, 'message' => 'Job request not found.'], 404);
        }

        $application->delete();

        return response()->json([
            'success' => true,
            'message' => 'Job request deleted.',
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        Log::info('parent_job.store.request', [
            'user_id' => $request->input('user_id'),
            'kid_ids_count' => is_array($request->input('kid_ids')) ? count((array) $request->input('kid_ids')) : 0,
            'start_date' => $request->input('start_date'),
            'start_time' => $request->input('start_time'),
            'end_time' => $request->input('end_time'),
        ]);

        $data = $request->validate([
            'user_id' => ['required'],
            'kid_ids' => ['required', 'array', 'min:1'],
            'kid_ids.*' => ['required'],
            'hours' => ['required', 'numeric', 'min:0.25', 'max:24'],
            'hourly_rate' => ['nullable', 'numeric', 'min:0'],
            'price' => ['nullable', 'numeric', 'min:0'],
            'start_time' => ['required', 'string', 'max:16'],
            'end_time' => ['nullable', 'string', 'max:16'],
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'location' => ['required', 'string', 'max:255'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'status' => ['nullable', 'string', 'max:32'],
        ]);

        $publicUserId = User::resolvePublicUserIdByIdentifier($data['user_id']);
        if (! $publicUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid user_id.',
            ], 422);
        }
        if ($blocked = $this->ensureParentCanPostJob($publicUserId)) {
            return $blocked;
        }
        if ($blocked = $this->ensureParentHasNoJobDateConflict(
            $publicUserId,
            (string) $data['start_date'],
            $data['end_date'] ?? null,
            'job_post'
        )) {
            return $blocked;
        }

        $kidIds = collect($data['kid_ids'])
            ->map(static fn ($id) => (int) $id)
            ->filter(static fn ($id) => $id > 0)
            ->unique()
            ->values()
            ->all();

        if (count($kidIds) === 0) {
            return response()->json([
                'success' => false,
                'message' => 'Please select at least one child.',
            ], 422);
        }

        $kids = ParentKid::query()
            ->where('parent_profile_id', $publicUserId)
            ->whereIn('id', $kidIds)
            ->orderBy('id')
            ->get(['id', 'name', 'age', 'gender']);

        if ($kids->count() !== count($kidIds)) {
            return response()->json([
                'success' => false,
                'message' => 'One or more selected children are invalid for this parent.',
            ], 422);
        }

        $startTime = $this->normalizeTime($data['start_time']);
        if (! $startTime) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid start_time. Use HH:MM (24-hour) or h:mm AM/PM.',
            ], 422);
        }
        $endTime = array_key_exists('end_time', $data) && $data['end_time'] !== null
            ? $this->normalizeTime($data['end_time'])
            : null;
        if (array_key_exists('end_time', $data) && $data['end_time'] !== null && ! $endTime) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid end_time. Use HH:MM (24-hour) or h:mm AM/PM.',
            ], 422);
        }

        $hours = round((float) $data['hours'], 2);
        $hourlyRate = array_key_exists('hourly_rate', $data) && $data['hourly_rate'] !== null
            ? round((float) $data['hourly_rate'], 2)
            : null;
        $price = array_key_exists('price', $data) && $data['price'] !== null
            ? round((float) $data['price'], 2)
            : null;

        if ($price === null && $hourlyRate !== null) {
            $price = round($hours * $hourlyRate, 2);
        }

        $verifiedLocation = $this->resolveVerifiedLocation(
            (string) $data['location'],
            $data['latitude'] ?? null,
            $data['longitude'] ?? null
        );
        if (! $verifiedLocation['ok']) {
            return response()->json([
                'success' => false,
                'message' => $verifiedLocation['message'],
            ], 422);
        }

        $job = ParentJob::query()->create([
            'user_id' => $publicUserId,
            'kid_ids' => $kidIds,
            'kid_names' => $kids
                ->pluck('name')
                ->filter()
                ->implode(', '),
            'hours' => $hours,
            'hourly_rate' => $hourlyRate,
            'price' => $price,
            'start_time' => $startTime,
            'end_time' => $endTime,
            'start_date' => $data['start_date'],
            'end_date' => $data['end_date'] ?? $data['start_date'],
            'location' => $verifiedLocation['location'],
            'latitude' => $verifiedLocation['latitude'],
            'longitude' => $verifiedLocation['longitude'],
            'status' => strtolower(trim((string) ($data['status'] ?? 'pending'))) ?: 'pending',
        ]);

        Log::info('parent_job.store.success', [
            'job_id' => $job->id,
            'user_id' => $publicUserId,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Job posted successfully.',
            'job' => $this->formatJob($job->fresh()),
            'data' => [
                'job' => $this->formatJob($job->fresh()),
            ],
        ], 201);
    }

    public function hireNow(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['required'],
            'nanny_id' => ['required'],
            'kids' => ['required', 'array', 'min:1'],
            'kids.*' => ['required'],
            'hours' => ['required', 'numeric', 'min:0.25', 'max:24'],
            'hourly_rate' => ['nullable', 'numeric', 'min:0'],
            'price' => ['nullable', 'numeric', 'min:0'],
            'start_time' => ['required', 'string', 'max:16'],
            'end_time' => ['nullable', 'string', 'max:16'],
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'location' => ['required', 'string', 'max:255'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
        ]);

        $parentUserId = User::resolvePublicUserIdByIdentifier($data['user_id']);
        if (! $parentUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid user_id.',
            ], 422);
        }
        if ($blocked = $this->ensureParentCanPostJob($parentUserId)) {
            return $blocked;
        }
        $nannyUserId = User::resolvePublicUserIdByIdentifier($data['nanny_id']);
        if (! $nannyUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid nanny_id.',
            ], 422);
        }
        if ($blocked = $this->ensureNannyCanReceiveJobOffer($nannyUserId)) {
            return $blocked;
        }

        $kidIds = collect($data['kids'])
            ->map(static fn ($id) => (int) $id)
            ->filter(static fn ($id) => $id > 0)
            ->unique()
            ->values()
            ->all();
        if (count($kidIds) === 0) {
            return response()->json([
                'success' => false,
                'message' => 'Please select at least one child.',
            ], 422);
        }

        $kids = ParentKid::query()
            ->where('parent_profile_id', $parentUserId)
            ->whereIn('id', $kidIds)
            ->orderBy('id')
            ->get(['id', 'name', 'age', 'gender', 'allergies', 'medical_conditions', 'notes']);
        if ($kids->count() !== count($kidIds)) {
            return response()->json([
                'success' => false,
                'message' => 'One or more selected children are invalid for this parent.',
            ], 422);
        }

        $startTime = $this->normalizeTime($data['start_time']);
        if (! $startTime) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid start_time. Use HH:MM (24-hour) or h:mm AM/PM.',
            ], 422);
        }
        $endTime = array_key_exists('end_time', $data) && $data['end_time'] !== null
            ? $this->normalizeTime($data['end_time'])
            : null;
        if (array_key_exists('end_time', $data) && $data['end_time'] !== null && ! $endTime) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid end_time. Use HH:MM (24-hour) or h:mm AM/PM.',
            ], 422);
        }

        $hours = round((float) $data['hours'], 2);
        $hourlyRate = array_key_exists('hourly_rate', $data) && $data['hourly_rate'] !== null
            ? round((float) $data['hourly_rate'], 2)
            : null;
        $price = array_key_exists('price', $data) && $data['price'] !== null
            ? round((float) $data['price'], 2)
            : null;
        if ($price === null && $hourlyRate !== null) {
            $price = round($hours * $hourlyRate, 2);
        }

        $verifiedLocation = $this->resolveVerifiedLocation(
            (string) $data['location'],
            $data['latitude'] ?? null,
            $data['longitude'] ?? null
        );
        if (! $verifiedLocation['ok']) {
            return response()->json([
                'success' => false,
                'message' => $verifiedLocation['message'],
            ], 422);
        }

        $job = $this->findExistingActiveJobForDateRange(
            $parentUserId,
            (string) $data['start_date'],
            $data['end_date'] ?? null
        );

        if (! $job) {
            $job = ParentJob::query()->create([
                'user_id' => $parentUserId,
                'kid_ids' => $kidIds,
                'kid_names' => $kids
                    ->pluck('name')
                    ->filter()
                    ->implode(', '),
                'hours' => $hours,
                'hourly_rate' => $hourlyRate,
                'price' => $price,
                'start_time' => $startTime,
                'end_time' => $endTime,
                'start_date' => $data['start_date'],
                'end_date' => $data['end_date'] ?? $data['start_date'],
                'location' => $verifiedLocation['location'],
                'latitude' => $verifiedLocation['latitude'],
                'longitude' => $verifiedLocation['longitude'],
                'status' => 'pending',
            ]);
        }

        $existingHireRequest = $this->findExistingHireRequestForDateRange(
            $parentUserId,
            $nannyUserId,
            (string) $data['start_date'],
            $data['end_date'] ?? null
        );
        if ($existingHireRequest) {
            return response()->json([
                'success' => false,
                'message' => 'You already sent a hire request to this Syttr for the selected date.',
                'data' => [
                    'application_id' => $existingHireRequest->id,
                    'job_id' => $existingHireRequest->job_id,
                    'status' => (string) ($existingHireRequest->status ?? 'hire_requested'),
                ],
            ], 409);
        }

        $application = ParentJobApplication::query()->firstOrCreate(
            [
                'job_id' => $job->id,
                'nanny_id' => $nannyUserId,
            ],
            [
                'status' => 'hire_requested',
                'request_source' => 'hire_request',
                'message' => 'source:hire_now',
            ]
        );
        if (($application->request_source ?? '') !== 'hire_request') {
            $application->request_source = 'hire_request';
            $application->save();
        }

        $parentUser = User::query()->where('user_id', $parentUserId)->first();
        $parentProfile = ParentProfile::query()->where('user_id', $parentUserId)->first();
        $parentStats = $this->buildParentRatingStats($parentUserId);
        $parentName = trim((string) ($parentUser?->name ?? 'Parent'));
        $displayParent = $parentName !== '' ? $parentName : 'Parent';

        NotificationController::createForUser(
            $nannyUserId,
            'hire_request',
            'Hire Request',
            $displayParent.' sent you a hire request for job #'.$job->id.'.',
            [
                'job_id' => $job->id,
                'application_id' => $application->id,
                'nanny_id' => $nannyUserId,
                'parent_user_id' => $parentUserId,
                'status' => $application->status,
                'request_status' => $application->status,
                'job' => [
                    'id' => $job->id,
                    'job_id' => $job->id,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'end_date' => optional($job->end_date)->format('Y-m-d'),
                    'start_time' => (string) $job->start_time,
                    'end_time' => (string) ($job->end_time ?? ''),
                    'hours' => $job->hours !== null ? (float) $job->hours : null,
                    'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
                    'price' => $job->price !== null ? (float) $job->price : null,
                    'location' => $job->location,
                    'latitude' => $job->latitude !== null ? (float) $job->latitude : null,
                    'longitude' => $job->longitude !== null ? (float) $job->longitude : null,
                    'status' => (string) ($job->status ?: 'pending'),
                    'kids' => $kids
                        ->map(static fn (ParentKid $kid) => [
                            'id' => $kid->id,
                            'name' => $kid->name,
                            'age' => $kid->age,
                            'gender' => $kid->gender,
                            'allergies' => $kid->allergies,
                            'medical_conditions' => $kid->medical_conditions,
                            'notes' => $kid->notes,
                        ])
                        ->values()
                        ->all(),
                    'kid_names' => (string) ($job->kid_names ?? ''),
                ],
                'parent' => [
                    'id' => $parentUserId,
                    'user_id' => $parentUserId,
                    'name' => $displayParent,
                    'city' => $parentProfile?->city,
                    'country' => $parentProfile?->country,
                    'address' => $parentProfile?->address,
                    'profile_image' => $parentProfile?->user_image_url ?: $parentProfile?->user_image,
                    'user_image' => $parentProfile?->user_image,
                    'user_image_url' => $parentProfile?->user_image_url,
                    'average_rating' => $parentStats['average_rating'],
                    'parent_average_rating' => $parentStats['average_rating'],
                    'jobs_posted_count' => $parentStats['jobs_posted_count'],
                    'parent_jobs_posted_count' => $parentStats['jobs_posted_count'],
                    'ratings_count' => $parentStats['raters_count'],
                    'raters_count' => $parentStats['raters_count'],
                    'parent_raters_count' => $parentStats['raters_count'],
                    'total_ratings_count' => $parentStats['ratings_count'],
                    'parent_total_ratings_count' => $parentStats['ratings_count'],
                ],
                'kids' => $kids
                    ->map(static fn (ParentKid $kid) => [
                        'id' => $kid->id,
                        'name' => $kid->name,
                        'age' => $kid->age,
                        'gender' => $kid->gender,
                        'allergies' => $kid->allergies,
                        'medical_conditions' => $kid->medical_conditions,
                        'notes' => $kid->notes,
                    ])
                    ->values()
                    ->all(),
                'application' => [
                    'id' => $application->id,
                    'application_id' => $application->id,
                    'job_id' => $application->job_id,
                    'nanny_id' => $application->nanny_id,
                    'status' => $application->status,
                    'created_at' => optional($application->created_at)->toIso8601String(),
                    'updated_at' => optional($application->updated_at)->toIso8601String(),
                ],
            ],
            $parentUserId
        );

        return response()->json([
            'success' => true,
            'message' => 'Hiring request submitted.',
            'data' => [
                'job_id' => $job->id,
                'application_id' => $application->id,
                'nanny_id' => $nannyUserId,
                'status' => $application->status,
                'job' => $this->formatJob($job->fresh(), $nannyUserId),
            ],
        ], 201);
    }

    public function parent(Request $request): JsonResponse
    {
        Log::info('parent_job.parent.request', [
            'user_id' => $request->input('user_id', $request->query('user_id')),
            'method' => $request->method(),
        ]);

        $inputUserId = trim((string) ($request->input('user_id', $request->query('user_id', ''))));
        $publicUserId = $inputUserId !== ''
            ? User::resolvePublicUserIdByIdentifier($inputUserId)
            : null;
        if (! $publicUserId) {
            $publicUserId = $this->resolveAuthenticatedUserId($request);
        }
        $viewerNannyId = User::resolvePublicUserIdByIdentifier($request->input('nanny_id', $request->query('nanny_id')));
        if ($viewerNannyId && $this->isBlacklistedUserId($viewerNannyId)) {
            return response()->json([
                'success' => true,
                'status' => 'blacklisted',
                'jobs' => [],
                'data' => ['jobs' => []],
            ]);
        }
        if (! $publicUserId) {
            return response()->json([
                'success' => true,
                'jobs' => [],
                'data' => ['jobs' => []],
            ]);
        }

        $perPage = max(1, min((int) $request->input('per_page', 50), 100));
        $jobs = ParentJob::query()
            ->where('user_id', $publicUserId)
            ->orderByDesc('id')
            ->limit($perPage)
            ->get()
            ->map(fn (ParentJob $job) => $this->formatJob($job, $viewerNannyId))
            ->values()
            ->all();

        Log::info('parent_job.parent.success', [
            'user_id' => $publicUserId,
            'count' => count($jobs),
        ]);

        return response()->json([
            'success' => true,
            'jobs' => $jobs,
            'data' => [
                'jobs' => $jobs,
                'data' => $jobs,
            ],
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $viewerNannyId = User::resolvePublicUserIdByIdentifier($request->input('nanny_id', $request->query('nanny_id')));
        if ($viewerNannyId && $this->isBlacklistedUserId($viewerNannyId)) {
            return response()->json([
                'success' => true,
                'status' => 'blacklisted',
                'data' => [],
            ]);
        }
        $inputUserId = trim((string) ($request->input('user_id', $request->query('user_id', ''))));
        $publicUserId = $inputUserId !== '' ? User::resolvePublicUserIdByIdentifier($inputUserId) : null;
        if (! $publicUserId && ! $viewerNannyId) {
            $publicUserId = $this->resolveAuthenticatedUserId($request);
        }

        $perPage = max(1, min((int) $request->input('per_page', 50), 100));
        $acceptedStatuses = $this->acceptedApplicationStatuses();
        $hiddenJobStatuses = $this->hiddenPublicJobStatuses();
        $hiddenViewerStatuses = $this->hiddenViewerJobFeedApplicationStatuses();
        $query = ParentJob::query()
            ->orderByDesc('id');
        if ($publicUserId) {
            $query->where('user_id', $publicUserId);
        } else {
            // Public job feed should hide jobs once any sitter is accepted.
            $query
                ->visibleOnPlatform()
                ->whereDoesntHave('applications', function ($applicationQuery) {
                    $this->applyHireRequestApplicationConstraint($applicationQuery);
                })
                ->where(function ($statusQuery) use ($acceptedStatuses) {
                    $statusQuery
                        ->whereNull('status')
                        ->orWhereNotIn('status', $this->hiddenPublicJobStatuses());
                })
                ->whereDoesntHave('applications', function ($applicationQuery) use ($acceptedStatuses) {
                    $applicationQuery->whereIn('status', $acceptedStatuses);
                });
        }
        if ($viewerNannyId) {
            $query
                ->whereDoesntHave('applications', function ($applicationQuery) use ($viewerNannyId, $hiddenViewerStatuses) {
                    $applicationQuery
                        ->where('nanny_id', $viewerNannyId)
                        ->whereIn('status', $hiddenViewerStatuses);
                })
                ->whereDoesntHave('applications', function ($applicationQuery) use ($viewerNannyId, $acceptedStatuses) {
                    $applicationQuery
                        ->whereIn('status', $acceptedStatuses)
                        ->where('nanny_id', '!=', $viewerNannyId);
                })
                ->where(function ($visibilityQuery) use ($viewerNannyId, $acceptedStatuses, $hiddenJobStatuses) {
                    $visibilityQuery
                        ->where(function ($openJobsQuery) use ($hiddenJobStatuses) {
                            $openJobsQuery->where(function ($statusQuery) use ($hiddenJobStatuses) {
                                $statusQuery
                                    ->whereNull('status')
                                    ->orWhereNotIn('status', $hiddenJobStatuses);
                            });
                        });
                });
        }
        $jobs = $query
            ->limit($perPage)
            ->get()
            ->map(fn (ParentJob $job) => $this->formatJob($job, $viewerNannyId))
            ->values()
            ->all();

        return response()->json([
            'success' => true,
            'jobs' => $jobs,
            'data' => [
                'jobs' => $jobs,
                'data' => $jobs,
            ],
        ]);
    }

    public function calendarBookings(Request $request): JsonResponse
    {
        $viewer = strtolower(trim((string) ($request->input('viewer', $request->query('viewer', '')))));
        $inputUserId = trim((string) ($request->input('user_id', $request->query('user_id', ''))));
        $inputNannyId = trim((string) ($request->input('nanny_id', $request->query('nanny_id', ''))));

        $publicUserId = $inputUserId !== ''
            ? User::resolvePublicUserIdByIdentifier($inputUserId)
            : null;
        $publicNannyId = $inputNannyId !== ''
            ? User::resolvePublicUserIdByIdentifier($inputNannyId)
            : null;

        $bearerUserId = $this->resolveAuthenticatedUserId($request);

        $wantsNannyCalendar = $viewer === 'nanny' || $viewer === 'syttr';
        if ($wantsNannyCalendar && ! $publicNannyId) {
            $publicNannyId = $publicUserId ?: ($bearerUserId ? (string) $bearerUserId : null);
        }

        if ($wantsNannyCalendar && ! $publicNannyId) {
            return response()->json([
                'success' => true,
                'viewer' => 'nanny',
                'data' => [],
            ]);
        }

        if ($wantsNannyCalendar && $publicNannyId && $this->isBlacklistedUserId($publicNannyId)) {
            return response()->json([
                'success' => true,
                'viewer' => 'nanny',
                'status' => 'blacklisted',
                'data' => [],
            ]);
        }

        if ($wantsNannyCalendar) {
            $acceptedStatuses = ['accepted', 'accept', 'approved', 'confirmed', 'confirm'];
            $applications = ParentJobApplication::query()
                ->visibleOnPlatform()
                ->where('nanny_id', $publicNannyId)
                ->whereIn('status', $acceptedStatuses)
                ->orderByDesc('updated_at')
                ->get(['id', 'job_id', 'nanny_id', 'status', 'created_at', 'updated_at']);

            $jobsById = ParentJob::query()
                ->visibleOnPlatform()
                ->whereIn('id', $applications->pluck('job_id')->filter()->unique()->values()->all())
                ->get()
                ->keyBy('id');

            $rows = $applications
                ->map(function (ParentJobApplication $application) use ($jobsById, $publicNannyId) {
                    $job = $jobsById->get($application->job_id);
                    if (! $job) {
                        return null;
                    }

                    $payload = $this->formatJob($job, $publicNannyId);
                    $payload['application'] = [
                        'id' => $application->id,
                        'application_id' => $application->id,
                        'job_id' => $application->job_id,
                        'nanny_id' => $application->nanny_id,
                        'status' => $application->status,
                        'created_at' => optional($application->created_at)->toIso8601String(),
                        'updated_at' => optional($application->updated_at)->toIso8601String(),
                    ];
                    $payload['application_id'] = $application->id;
                    $payload['nanny_id'] = $application->nanny_id;

                    return $payload;
                })
                ->filter()
                ->values()
                ->all();

            return response()->json([
                'success' => true,
                'viewer' => 'nanny',
                'data' => $rows,
            ]);
        }

        if (! $publicUserId) {
            $publicUserId = $bearerUserId ? (string) $bearerUserId : null;
        }

        if (! $publicUserId) {
            return response()->json([
                'success' => true,
                'viewer' => 'parent',
                'data' => [],
            ]);
        }

        $perPage = max(1, min((int) $request->input('per_page', 100), 200));
        $rows = ParentJob::query()
            ->where('user_id', $publicUserId)
            ->orderByDesc('start_date')
            ->orderByDesc('id')
            ->limit($perPage)
            ->get()
            ->map(fn (ParentJob $job) => $this->formatJob($job))
            ->values()
            ->all();

        return response()->json([
            'success' => true,
            'viewer' => 'parent',
            'data' => $rows,
        ]);
    }

    public function destroy(Request $request, int $jobId): JsonResponse
    {
        Log::info('parent_job.destroy.request', [
            'job_id' => $jobId,
            'user_id' => $request->input('user_id', $request->query('user_id')),
        ]);

        $inputUserId = trim((string) ($request->input('user_id', $request->query('user_id', ''))));
        $publicUserId = $inputUserId !== ''
            ? User::resolvePublicUserIdByIdentifier($inputUserId)
            : null;
        if ($publicUserId && ($blocked = $this->ensureParentCanManageJobs($publicUserId))) {
            return $blocked;
        }

        $query = ParentJob::query()->whereKey($jobId);
        if ($publicUserId) {
            $query->where('user_id', $publicUserId);
        }

        $job = $query->first();
        if (! $job) {
            return response()->json([
                'success' => false,
                'message' => 'Job not found.',
            ], 404);
        }

        $cancellationPolicy = $this->resolveCancellationCutoffPolicy($job);
        if ($cancellationPolicy['is_blocked']) {
            return response()->json([
                'success' => false,
                'message' => 'You can only cancel a job more than 24 hours before its scheduled start time.',
                'policy' => [
                    'start_at' => $cancellationPolicy['start_at']?->toISOString(),
                    'cutoff_at' => $cancellationPolicy['cutoff_at']?->toISOString(),
                ],
            ], 422);
        }

        $job->delete();

        Log::info('parent_job.destroy.success', [
            'job_id' => $jobId,
            'user_id' => $job->user_id,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Job deleted successfully.',
        ]);
    }

    public function delete(Request $request, int $jobId): JsonResponse
    {
        return $this->destroy($request, $jobId);
    }

    public function updateStatus(Request $request): JsonResponse
    {
        $data = $request->validate([
            'job_id' => ['nullable'],
            'id' => ['nullable'],
            'booking_id' => ['nullable'],
            'user_id' => ['nullable'],
            'confirm_late_fee' => ['nullable'],
            'status' => ['nullable', 'string', 'max:32'],
            'action' => ['nullable', 'string', 'max:32'],
            'reason' => ['nullable', 'string', 'max:500'],
            'cancel_reason' => ['nullable', 'string', 'max:500'],
        ]);

        $jobId = (int) (
            $data['job_id'] ??
            $data['id'] ??
            $data['booking_id'] ??
            0
        );
        if ($jobId <= 0) {
            return response()->json([
                'success' => false,
                'message' => 'job_id is required.',
            ], 422);
        }

        $publicUserId = $this->resolveParentUserIdFromRequest($request);
        if ($publicUserId && ($blocked = $this->ensureParentCanManageJobs($publicUserId))) {
            return $blocked;
        }

        $query = ParentJob::query()->whereKey($jobId);
        if ($publicUserId) {
            $query->where('user_id', $publicUserId);
        }

        $job = $query->first();
        if (! $job) {
            return response()->json([
                'success' => false,
                'message' => 'Job not found.',
            ], 404);
        }

        $statusRaw = strtolower(trim((string) ($data['status'] ?? '')));
        $actionRaw = strtolower(trim((string) ($data['action'] ?? '')));
        $hasCancelSignal = filled($data['reason'] ?? null) || filled($data['cancel_reason'] ?? null);

        if ($statusRaw === '') {
            if ($actionRaw !== '') {
                $statusRaw = $actionRaw;
            } elseif ($hasCancelSignal) {
                $statusRaw = 'canceled';
            } else {
                $statusRaw = 'completed';
            }
        }

        $statusMap = [
            'cancel' => 'canceled',
            'cancelled' => 'canceled',
            'canceled' => 'canceled',
            'complete' => 'completed',
            'completed' => 'completed',
            'done' => 'completed',
            'accepted' => 'accepted',
            'accept' => 'accepted',
            'approved' => 'accepted',
            'rejected' => 'rejected',
            'reject' => 'rejected',
            'pending' => 'pending',
        ];
        $normalizedStatus = $statusMap[$statusRaw] ?? $statusRaw;
        $supportsLateCancellationFeeColumns = $this->supportsLateCancellationFeeColumns();

        if ($this->isCanceledStatus($normalizedStatus)) {
            $cancellationPolicy = $this->resolveCancellationCutoffPolicy($job);
            if ($cancellationPolicy['is_blocked']) {
                return response()->json([
                    'success' => false,
                    'message' => 'You can only cancel a job more than 24 hours before its scheduled start time.',
                    'policy' => [
                        'start_at' => $cancellationPolicy['start_at']?->toISOString(),
                        'cutoff_at' => $cancellationPolicy['cutoff_at']?->toISOString(),
                    ],
                ], 422);
            }

            if ($supportsLateCancellationFeeColumns) {
                $job->late_cancellation_fee = null;
                $job->late_cancellation_fee_charged_at = null;
            }
        }

        $previousStatus = strtolower(trim((string) ($job->status ?? '')));
        $completionPayment = null;
        if (
            $this->isCompletedStatus($normalizedStatus) &&
            ! $this->isCompletedStatus($previousStatus)
        ) {
            $paymentResult = $this->chargeAndTransferCompletedJob($job);
            if (! ($paymentResult['success'] ?? false)) {
                return response()->json([
                    'success' => false,
                    'message' => (string) ($paymentResult['message'] ?? 'Unable to process payment for this job.'),
                    'payment' => [
                        'charged' => false,
                    ],
                ], (int) ($paymentResult['status'] ?? 422));
            }
            $applicationId = (int) ($paymentResult['application_id'] ?? 0);
            if ($applicationId > 0) {
                $acceptedApplication = ParentJobApplication::query()->find($applicationId);
                if ($acceptedApplication) {
                    $this->recordCompletionWalletTransactions(
                        $job,
                        $acceptedApplication,
                        (float) ($paymentResult['amount'] ?? 0),
                        (string) ($paymentResult['currency'] ?? 'usd'),
                        (string) ($paymentResult['payment_intent_id'] ?? ''),
                        [
                            'gross_amount' => (float) ($paymentResult['gross_amount'] ?? $paymentResult['amount'] ?? 0),
                            'stripe_fee_amount' => (float) ($paymentResult['stripe_fee_amount'] ?? 0),
                            'stripe_tax_amount' => (float) ($paymentResult['stripe_tax_amount'] ?? 0),
                            'net_amount' => (float) ($paymentResult['net_amount'] ?? $paymentResult['amount'] ?? 0),
                            'stripe_processing_fee_amount' => (float) ($paymentResult['stripe_processing_fee_amount'] ?? 0),
                            'fee_details' => is_array($paymentResult['fee_details'] ?? null)
                                ? $paymentResult['fee_details']
                                : [],
                            'balance_transaction_id' => (string) ($paymentResult['balance_transaction_id'] ?? ''),
                            'charge_id' => (string) ($paymentResult['charge_id'] ?? ''),
                            'payment_status' => (string) ($paymentResult['payment_status'] ?? ''),
                        ]
                    );
                }
            }
            $completionPayment = [
                'charged' => true,
                'amount' => (float) ($paymentResult['amount'] ?? 0),
                'gross_amount' => (float) ($paymentResult['gross_amount'] ?? $paymentResult['amount'] ?? 0),
                'stripe_fee_amount' => (float) ($paymentResult['stripe_fee_amount'] ?? 0),
                'stripe_tax_amount' => (float) ($paymentResult['stripe_tax_amount'] ?? 0),
                'net_amount' => (float) ($paymentResult['net_amount'] ?? $paymentResult['amount'] ?? 0),
                'stripe_processing_fee_amount' => (float) ($paymentResult['stripe_processing_fee_amount'] ?? 0),
                'currency' => (string) ($paymentResult['currency'] ?? 'usd'),
                'payment_intent_id' => (string) ($paymentResult['payment_intent_id'] ?? ''),
                'destination_account' => (string) ($paymentResult['destination_account'] ?? ''),
                'balance_transaction_id' => (string) ($paymentResult['balance_transaction_id'] ?? ''),
                'charge_id' => (string) ($paymentResult['charge_id'] ?? ''),
                'payment_status' => (string) ($paymentResult['payment_status'] ?? ''),
            ];
        }

        $job->status = $normalizedStatus;
        $job->save();

        if (
            $this->isAcceptedStatus($normalizedStatus) &&
            ! $this->isAcceptedStatus($previousStatus)
        ) {
            $targetApplicationId = trim((string) ($request->input('application_id', '')));
            $targetNannyIdInput = trim((string) ($request->input('nanny_id', '')));
            $targetNannyId = $targetNannyIdInput !== ''
                ? User::resolvePublicUserIdByIdentifier($targetNannyIdInput)
                : null;

            $applicationQuery = ParentJobApplication::query()
                ->visibleOnPlatform()
                ->where('job_id', $job->id);
            if ($targetApplicationId !== '' && ctype_digit($targetApplicationId)) {
                $applicationQuery->whereKey((int) $targetApplicationId);
            } elseif ($targetNannyId) {
                $applicationQuery->where('nanny_id', $targetNannyId);
            }

            $acceptedApplication = $applicationQuery
                ->orderByDesc('id')
                ->first();

            if (! $acceptedApplication) {
                $acceptedApplication = ParentJobApplication::query()
                    ->visibleOnPlatform()
                    ->where('job_id', $job->id)
                    ->whereIn('status', ['accepted', 'accept', 'approved', 'confirmed', 'confirm'])
                    ->orderByDesc('id')
                    ->first();
            }

            if (! $acceptedApplication) {
                $acceptedApplication = ParentJobApplication::query()
                    ->visibleOnPlatform()
                    ->where('job_id', $job->id)
                    ->orderByDesc('id')
                    ->first();
            }

            if ($acceptedApplication) {
                if (! $this->isAcceptedStatus($acceptedApplication->status)) {
                    $acceptedApplication->status = 'accepted';
                    $acceptedApplication->save();
                }

            $autoRejectedApplications = ParentJobApplication::query()
                ->where('job_id', $job->id)
                ->where('id', '!=', $acceptedApplication->id)
                ->whereNotIn('status', $this->nonRejectableApplicationStatuses())
                ->get(['id', 'job_id', 'nanny_id', 'status', 'created_at', 'updated_at']);

                $autoRejectedIds = $autoRejectedApplications
                    ->pluck('id')
                    ->map(static fn ($id) => (int) $id)
                    ->values()
                    ->all();
                if (count($autoRejectedIds) > 0) {
                    ParentJobApplication::query()
                        ->whereIn('id', $autoRejectedIds)
                        ->update(['status' => 'rejected']);

                    foreach ($autoRejectedApplications as $autoRejectedApplication) {
                        $autoRejectedApplication->status = 'rejected';
                        $this->notifySyttrRequestRejected($job, $autoRejectedApplication, $job->user_id);
                    }
                }

                $conversationId = $this->ensureChatConversation($job->user_id, $acceptedApplication->nanny_id);
                $this->notifySyttrRequestAccepted($job, $acceptedApplication, $job->user_id, $conversationId);
                $this->notifyParentRequestAccepted($job, $acceptedApplication, $job->user_id, $conversationId);
            }
        }

        if (
            $this->isCanceledStatus($normalizedStatus) &&
            ! $this->isCanceledStatus($previousStatus)
        ) {
            $this->notifyApplicantsJobCanceled(
                $job,
                $job->user_id,
                $data['reason'] ?? $data['cancel_reason'] ?? null
            );
        }

        if (
            $this->isCompletedStatus($normalizedStatus) &&
            ! $this->isCompletedStatus($previousStatus)
        ) {
            $this->notifyAssignedSyttrJobCompleted($job, $job->user_id);
            $this->notifyJobCompletionRatingPrompts($job, $job->user_id);
        }

        Log::info('parent_job.update_status.success', [
            'job_id' => $job->id,
            'user_id' => $job->user_id,
            'status' => $normalizedStatus,
            'reason' => $data['reason'] ?? $data['cancel_reason'] ?? null,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Job status updated successfully.',
            'job' => $this->formatJob($job->fresh()),
            'data' => [
                'job' => $this->formatJob($job->fresh()),
                'status' => $normalizedStatus,
                'late_cancellation_fee_applied' => false,
                'late_cancellation_fee' => 0,
                'payment' => $completionPayment,
            ],
        ]);
    }

    public function cancelBooking(Request $request): JsonResponse
    {
        $request->merge(['status' => 'canceled']);
        return $this->updateStatus($request);
    }

    public function acceptApplication(Request $request, int $applicationId): JsonResponse
    {
        $publicUserId = $this->resolveParentUserIdFromRequest($request);
        if (! $publicUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid user_id.',
            ], 422);
        }
        if ($blocked = $this->ensureParentCanManageJobs($publicUserId)) {
            return $blocked;
        }

        $result = DB::transaction(function () use ($applicationId, $publicUserId) {
            $application = ParentJobApplication::query()
                ->visibleOnPlatform()
                ->whereKey($applicationId)
                ->lockForUpdate()
                ->first();
            if (! $application) {
                return [
                    'error' => [
                        'message' => 'Application not found.',
                        'status' => 404,
                    ],
                ];
            }

            $job = ParentJob::query()
                ->visibleOnPlatform()
                ->whereKey($application->job_id)
                ->lockForUpdate()
                ->first();
            if (! $job || $job->user_id !== $publicUserId) {
                return [
                    'error' => [
                        'message' => 'Application not found.',
                        'status' => 404,
                    ],
                ];
            }

            if ($this->isParentInitiatedHireRequestApplication($application)) {
                return [
                    'error' => [
                        'message' => 'This is a parent-initiated hire request. Please cancel the job instead.',
                        'status' => 422,
                    ],
                ];
            }

            $alreadyAcceptedByAnotherNanny = ParentJobApplication::query()
                ->where('job_id', $job->id)
                ->where('id', '!=', $application->id)
                ->whereIn('status', $this->acceptedApplicationStatuses())
                ->lockForUpdate()
                ->exists();
            if ($alreadyAcceptedByAnotherNanny) {
                return [
                    'error' => [
                        'message' => 'This job has already been accepted by another Syttr.',
                        'status' => 422,
                    ],
                ];
            }

            if (! $this->isAcceptedStatus($application->status)) {
                $application->status = 'accepted';
                $application->save();
            }

            if (! $this->isAcceptedStatus($job->status)) {
                $job->status = 'accepted';
                $job->save();
            }

            $autoRejectedApplications = ParentJobApplication::query()
                ->where('job_id', $job->id)
                ->where('id', '!=', $application->id)
                ->whereNotIn('status', $this->nonRejectableApplicationStatuses())
                ->lockForUpdate()
                ->get(['id', 'job_id', 'nanny_id', 'status', 'created_at', 'updated_at']);

            $autoRejectedIds = $autoRejectedApplications
                ->pluck('id')
                ->map(static fn ($id) => (int) $id)
                ->values()
                ->all();
            if (count($autoRejectedIds) > 0) {
                ParentJobApplication::query()
                    ->whereIn('id', $autoRejectedIds)
                    ->update(['status' => 'rejected']);
            }

            return [
                'job' => $job->fresh(),
                'application' => $application->fresh(),
                'auto_rejected_applications' => $autoRejectedApplications,
            ];
        });

        if (is_array($result) && isset($result['error'])) {
            return response()->json([
                'success' => false,
                'message' => (string) ($result['error']['message'] ?? 'Unable to accept application.'),
            ], (int) ($result['error']['status'] ?? 422));
        }

        $job = $result['job'];
        $application = $result['application'];
        $autoRejectedApplications = collect($result['auto_rejected_applications'] ?? []);
        foreach ($autoRejectedApplications as $autoRejectedApplication) {
            $autoRejectedApplication->status = 'rejected';
            $this->notifySyttrRequestRejected($job, $autoRejectedApplication, $publicUserId);
        }

        $conversationId = $this->ensureChatConversation($job->user_id, $application->nanny_id);
        $this->notifySyttrRequestAccepted($job, $application, $publicUserId, $conversationId);
        $this->notifyParentRequestAccepted($job, $application, $publicUserId, $conversationId);

        return response()->json([
            'success' => true,
            'message' => 'Application accepted successfully.',
            'data' => [
                'application_id' => $application->id,
                'job_id' => $job->id,
                'status' => $application->status,
                'conversation_id' => $conversationId,
                'auto_rejected_application_ids' => $autoRejectedApplications
                    ->pluck('id')
                    ->map(static fn ($id) => (int) $id)
                    ->values()
                    ->all(),
            ],
        ]);
    }

    public function rejectApplication(Request $request, int $applicationId): JsonResponse
    {
        $publicUserId = $this->resolveParentUserIdFromRequest($request);
        if (! $publicUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid user_id.',
            ], 422);
        }
        if ($blocked = $this->ensureParentCanManageJobs($publicUserId)) {
            return $blocked;
        }

        $application = ParentJobApplication::query()
            ->visibleOnPlatform()
            ->whereKey($applicationId)
            ->whereHas('job', fn ($query) => $query->where('user_id', $publicUserId))
            ->first();
        if (! $application) {
            return response()->json([
                'success' => false,
                'message' => 'Application not found.',
            ], 404);
        }

        if ($this->isParentInitiatedHireRequestApplication($application)) {
            return response()->json([
                'success' => false,
                'message' => 'This is a parent-initiated hire request. Please cancel the job instead.',
            ], 422);
        }

        $application->status = 'rejected';
        $application->save();
        $job = ParentJob::query()->find($application->job_id);
        if ($job) {
            $this->notifySyttrRequestRejected($job, $application, $publicUserId);
        }

        return response()->json([
            'success' => true,
            'message' => 'Application rejected successfully.',
            'data' => [
                'application_id' => $application->id,
                'job_id' => $application->job_id,
                'status' => $application->status,
            ],
        ]);
    }

    public function requestExtraHours(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'job_id' => ['required', 'integer', 'min:1'],
            'hours' => ['nullable', 'numeric', 'min:0.5', 'max:12'],
            'requested_end_time' => ['nullable', 'string', 'max:16'],
        ]);

        $parentUserId = $this->resolveParentUserIdFromRequest($request);
        if (! $parentUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid user_id.',
            ], 422);
        }
        if ($blocked = $this->ensureParentCanManageJobs($parentUserId)) {
            return $blocked;
        }

        $job = ParentJob::query()
            ->visibleOnPlatform()
            ->find($data['job_id']);
        if (! $job || (string) $job->user_id !== (string) $parentUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Booking not found.',
            ], 404);
        }

        if ($this->isCanceledStatus($job->status) || $this->isCompletedStatus($job->status)) {
            return response()->json([
                'success' => false,
                'message' => 'This booking can no longer be updated.',
            ], 422);
        }

        $acceptedApplication = ParentJobApplication::query()
            ->visibleOnPlatform()
            ->where('job_id', $job->id)
            ->whereIn('status', $this->acceptedApplicationStatuses())
            ->latest('id')
            ->first();

        if (! $acceptedApplication || ! $acceptedApplication->nanny_id) {
            return response()->json([
                'success' => false,
                'message' => 'No accepted Syttr found for this booking.',
            ], 422);
        }

        $pendingExists = UserNotification::query()
            ->where('recipient_user_id', strtoupper(trim((string) $acceptedApplication->nanny_id)))
            ->where('type', 'extra_hours_request')
            ->where('data->job_id', $job->id)
            ->where('data->status', 'pending')
            ->exists();

        if ($pendingExists) {
            return response()->json([
                'success' => false,
                'message' => 'An extra hours request is already pending for this booking.',
            ], 409);
        }

        $currentHours = round((float) ($job->hours ?? 0), 2);
        $hourlyRate = $this->resolveJobHourlyRate($job);
        $currentEndTime = $this->normalizeTime((string) ($job->end_time ?? ''));
        $requestedEndTime = null;

        if (array_key_exists('requested_end_time', $data) && $data['requested_end_time'] !== null) {
            $requestedEndTime = $this->normalizeTime((string) $data['requested_end_time']);
            if (! $requestedEndTime) {
                return response()->json([
                    'success' => false,
                    'message' => 'Invalid requested_end_time. Use HH:MM in 24-hour format.',
                ], 422);
            }
        }

        $requestedHours = array_key_exists('hours', $data) && $data['hours'] !== null
            ? round((float) $data['hours'], 2)
            : null;

        if ($requestedEndTime !== null) {
            if (! $currentEndTime) {
                return response()->json([
                    'success' => false,
                    'message' => 'This booking is missing an end time.',
                ], 422);
            }

            $requestedHours = $this->calculateExtraHoursFromEndTime($currentEndTime, $requestedEndTime);
            if ($requestedHours === null) {
                return response()->json([
                    'success' => false,
                    'message' => 'Requested end time must be later than the current end time and within 12 hours.',
                ], 422);
            }
        }

        if ($requestedHours === null || $requestedHours <= 0) {
            return response()->json([
                'success' => false,
                'message' => 'Enter a valid extra hours request.',
            ], 422);
        }

        $newHours = round($currentHours + $requestedHours, 2);
        $currentTotal = $job->price !== null
            ? round((float) $job->price, 2)
            : round($currentHours * $hourlyRate, 2);
        $newTotal = round($newHours * $hourlyRate, 2);
        $newEndTime = $requestedEndTime ?: $this->addHoursToTime($currentEndTime, $requestedHours);

        $parentName = trim((string) (User::query()->where('user_id', $parentUserId)->value('name') ?? 'Parent'));
        $nannyName = trim((string) (User::query()->where('user_id', $acceptedApplication->nanny_id)->value('name') ?? 'Syttr'));

        $notification = NotificationController::createForUser(
            strtoupper(trim((string) $acceptedApplication->nanny_id)),
            'extra_hours_request',
            'Extra Hours Request',
            ($parentName !== '' ? $parentName : 'Parent').' requested extra hours for booking #'.$job->id.'. New end time: '.$this->formatNotificationTime($newEndTime).'.',
            [
                'job_id' => $job->id,
                'application_id' => $acceptedApplication->id,
                'parent_user_id' => $parentUserId,
                'nanny_id' => strtoupper(trim((string) $acceptedApplication->nanny_id)),
                'status' => 'pending',
                'requested_hours' => $requestedHours,
                'current_end_time' => $currentEndTime,
                'requested_end_time' => $requestedEndTime,
                'new_end_time' => $newEndTime,
                'current_hours' => $currentHours,
                'new_hours' => $newHours,
                'hourly_rate' => $hourlyRate,
                'current_total' => $currentTotal,
                'new_total' => $newTotal,
                'job' => [
                    'id' => $job->id,
                    'job_id' => $job->id,
                    'hours' => $currentHours,
                    'hourly_rate' => $hourlyRate,
                    'price' => $currentTotal,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'start_time' => (string) ($job->start_time ?? ''),
                    'end_time' => (string) ($job->end_time ?? ''),
                    'location' => $job->location,
                    'status' => (string) ($job->status ?: 'accepted'),
                ],
                'parent' => [
                    'user_id' => $parentUserId,
                    'name' => $parentName !== '' ? $parentName : 'Parent',
                ],
                'nanny' => [
                    'user_id' => strtoupper(trim((string) $acceptedApplication->nanny_id)),
                    'name' => $nannyName !== '' ? $nannyName : 'Syttr',
                ],
            ],
            $parentUserId
        );

        return response()->json([
            'success' => true,
            'message' => 'Extra hours request sent.',
            'data' => [
                'notification_id' => $notification->id,
                'job_id' => $job->id,
                'requested_hours' => $requestedHours,
                'requested_end_time' => $requestedEndTime,
                'new_end_time' => $newEndTime,
                'new_hours' => $newHours,
                'new_total' => $newTotal,
            ],
        ]);
    }

    public function extraHoursStatus(Request $request, int $jobId): JsonResponse
    {
        $parentUserId = $this->resolveParentUserIdFromRequest($request);
        if (! $parentUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid user_id.',
            ], 422);
        }
        if ($blocked = $this->ensureParentCanManageJobs($parentUserId)) {
            return $blocked;
        }

        $job = ParentJob::query()
            ->visibleOnPlatform()
            ->find($jobId);
        if (! $job || (string) $job->user_id !== (string) $parentUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Booking not found.',
            ], 404);
        }

        $acceptedApplication = ParentJobApplication::query()
            ->visibleOnPlatform()
            ->where('job_id', $job->id)
            ->whereIn('status', $this->acceptedApplicationStatuses())
            ->latest('id')
            ->first();

        $pendingExists = false;
        if ($acceptedApplication && $acceptedApplication->nanny_id) {
            $pendingExists = UserNotification::query()
                ->where('recipient_user_id', strtoupper(trim((string) $acceptedApplication->nanny_id)))
                ->where('type', 'extra_hours_request')
                ->where('data->job_id', $job->id)
                ->where('data->status', 'pending')
                ->exists();
        }

        $latestDecisionNotification = UserNotification::query()
            ->where('recipient_user_id', $parentUserId)
            ->whereIn('type', ['extra_hours_accepted', 'extra_hours_rejected'])
            ->where('data->job_id', $job->id)
            ->latest('id')
            ->first();

        $latestDecision = null;
        if ($pendingExists) {
            $latestDecision = 'pending';
        } elseif ($latestDecisionNotification) {
            $latestDecision = $latestDecisionNotification->type === 'extra_hours_accepted'
                ? 'accepted'
                : 'rejected';
        }

        return response()->json([
            'success' => true,
            'data' => [
                'job_id' => $job->id,
                'pending_request' => $pendingExists,
                'latest_decision' => $latestDecision,
                'hours' => $job->hours !== null ? round((float) $job->hours, 2) : null,
                'price' => $job->price !== null ? round((float) $job->price, 2) : null,
                'end_time' => (string) ($job->end_time ?? ''),
                'job' => [
                    'id' => $job->id,
                    'job_id' => $job->id,
                    'hours' => $job->hours !== null ? round((float) $job->hours, 2) : null,
                    'price' => $job->price !== null ? round((float) $job->price, 2) : null,
                    'end_time' => (string) ($job->end_time ?? ''),
                    'status' => (string) ($job->status ?? ''),
                ],
            ],
        ]);
    }

    public function acceptExtraHours(Request $request, int $notificationId): JsonResponse
    {
        return $this->resolveExtraHoursDecision($request, $notificationId, 'accepted');
    }

    public function rejectExtraHours(Request $request, int $notificationId): JsonResponse
    {
        return $this->resolveExtraHoursDecision($request, $notificationId, 'rejected');
    }

    public function submitRating(Request $request, int $applicationId): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'nanny_id' => ['nullable'],
            'rating' => ['required', 'integer', 'min:1', 'max:5'],
            'review' => ['nullable', 'string', 'max:2000'],
        ]);

        $actorUserId = User::resolvePublicUserIdByIdentifier($data['user_id'] ?? $request->input('user_id'));
        $actorNannyId = User::resolvePublicUserIdByIdentifier($data['nanny_id'] ?? $request->input('nanny_id'));
        $bearerActor = User::normalizeApiToken($request->bearerToken());
        if ((! $actorUserId && ! $actorNannyId) && $bearerActor !== '') {
            $resolved = User::resolvePublicUserIdByApiToken($bearerActor);
            if ($resolved) {
                $actorUserId = (string) $resolved;
                $actorNannyId = (string) $resolved;
            }
        }

        $rating = (int) $data['rating'];
        $review = trim((string) ($data['review'] ?? ''));
        $now = Carbon::now(config('app.timezone'));

        $result = DB::transaction(function () use (
            $applicationId,
            $actorUserId,
            $actorNannyId,
            $rating,
            $review,
            $now
        ) {
            $application = ParentJobApplication::query()
                ->whereKey($applicationId)
                ->lockForUpdate()
                ->first();
            if (! $application) {
                return [
                    'error' => [
                        'message' => 'Application not found.',
                        'status' => 404,
                    ],
                ];
            }

            $job = ParentJob::query()
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

            if (! $this->isCompletedStatus($job->status)) {
                return [
                    'error' => [
                        'message' => 'Ratings are available after job completion.',
                        'status' => 422,
                    ],
                ];
            }

            if ($actorUserId && (string) $actorUserId === (string) $job->user_id) {
                if ($application->parent_rating !== null || $application->parent_rated_at !== null) {
                    return [
                        'error' => [
                            'message' => 'You have already rated this sitter for this booking.',
                            'status' => 409,
                        ],
                    ];
                }

                $application->parent_rating = $rating;
                $application->parent_review = $review !== '' ? $review : null;
                $application->parent_rated_at = $now;
                $application->save();

                return [
                    'success' => true,
                    'message' => 'Parent rating submitted.',
                    'data' => [
                        'application_id' => $application->id,
                        'job_id' => $job->id,
                        'role' => 'parent',
                        'rating' => $rating,
                    ],
                ];
            }

            if ($actorNannyId && (string) $actorNannyId === (string) $application->nanny_id) {
                if ($application->nanny_rating !== null || $application->nanny_rated_at !== null) {
                    return [
                        'error' => [
                            'message' => 'You have already rated this parent for this booking.',
                            'status' => 409,
                        ],
                    ];
                }

                $application->nanny_rating = $rating;
                $application->nanny_review = $review !== '' ? $review : null;
                $application->nanny_rated_at = $now;
                $application->save();

                return [
                    'success' => true,
                    'message' => 'Sitter rating submitted.',
                    'data' => [
                        'application_id' => $application->id,
                        'job_id' => $job->id,
                        'role' => 'sitter',
                        'rating' => $rating,
                    ],
                ];
            }

            return [
                'error' => [
                    'message' => 'You are not allowed to rate this booking.',
                    'status' => 403,
                ],
            ];
        });

        if (is_array($result) && isset($result['error'])) {
            return response()->json([
                'success' => false,
                'message' => (string) ($result['error']['message'] ?? 'Unable to submit rating.'),
            ], (int) ($result['error']['status'] ?? 422));
        }

        return response()->json($result);
    }

    private function notifySyttrRequestAccepted(
        ParentJob $job,
        ParentJobApplication $application,
        string $parentUserId,
        ?int $conversationId = null
    ): void {
        $notificationKey = 'application:'.$application->id.':accepted';
        $alreadySent = UserNotification::query()
            ->where('recipient_user_id', $application->nanny_id)
            ->where('type', 'job_request_accepted')
            ->where('data->notification_key', $notificationKey)
            ->exists();

        if ($alreadySent) {
            return;
        }

        $parentName = trim((string) (User::query()->where('user_id', $parentUserId)->value('name') ?? 'Parent'));
        $displayParent = $parentName !== '' ? $parentName : 'Parent';

        NotificationController::createForUser(
            $application->nanny_id,
            'job_request_accepted',
            'Request Accepted',
            'Congratulations! '.$displayParent.' accepted your babysitting request.',
            [
                'notification_key' => $notificationKey,
                'job_id' => $job->id,
                'application_id' => $application->id,
                'nanny_id' => $application->nanny_id,
                'parent_user_id' => $parentUserId,
                'conversation_id' => $conversationId,
                'parent' => [
                    'user_id' => $parentUserId,
                    'name' => $displayParent,
                ],
                'job' => [
                    'id' => $job->id,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'start_time' => (string) $job->start_time,
                    'end_time' => (string) ($job->end_time ?? ''),
                    'location' => $job->location,
                    'status' => (string) ($job->status ?: 'accepted'),
                ],
            ],
            $parentUserId
        );
    }

    private function notifyParentRequestAccepted(
        ParentJob $job,
        ParentJobApplication $application,
        string $parentUserId,
        ?int $conversationId = null
    ): void {
        $isHireRequest = $this->isParentInitiatedHireRequestApplication($application);
        $notificationType = $isHireRequest ? 'hire_accepted' : 'job_request_approved';
        $notificationKey = $isHireRequest
            ? 'hire-request:'.$application->id.':accepted'
            : 'application:'.$application->id.':accepted:parent';
        $alreadySent = UserNotification::query()
            ->where('recipient_user_id', $parentUserId)
            ->where('type', $notificationType)
            ->where('data->notification_key', $notificationKey)
            ->exists();
        if ($alreadySent) {
            return;
        }

        $nannyName = trim((string) (User::query()->where('user_id', $application->nanny_id)->value('name') ?? 'Syttr'));
        $displayNanny = $nannyName !== '' ? $nannyName : 'Syttr';

        NotificationController::createForUser(
            $parentUserId,
            $notificationType,
            $isHireRequest ? 'Hire Request Accepted' : 'Request Accepted',
            $isHireRequest
                ? 'Your sitter has accepted the job request.'
                : 'You accepted '.$displayNanny.' for job #'.$job->id.'.',
            [
                'notification_key' => $notificationKey,
                'job_id' => $job->id,
                'application_id' => $application->id,
                'nanny_id' => $application->nanny_id,
                'parent_user_id' => $parentUserId,
                'conversation_id' => $conversationId,
                'status' => 'accepted',
                'request_source' => $application->request_source,
                'job' => [
                    'id' => $job->id,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'start_time' => (string) $job->start_time,
                    'end_time' => (string) ($job->end_time ?? ''),
                    'location' => $job->location,
                    'status' => (string) ($job->status ?: 'accepted'),
                    'request_source' => $application->request_source,
                ],
                'nanny' => [
                    'id' => $application->nanny_id,
                    'name' => $displayNanny,
                ],
                'application' => [
                    'id' => $application->id,
                    'application_id' => $application->id,
                    'status' => $application->status,
                    'request_source' => $application->request_source,
                ],
            ],
            $parentUserId
        );
    }

    private function notifySyttrRequestRejected(
        ParentJob $job,
        ParentJobApplication $application,
        string $parentUserId
    ): void {
        $notificationKey = 'application:'.$application->id.':rejected';
        $alreadySent = UserNotification::query()
            ->where('recipient_user_id', $application->nanny_id)
            ->where('type', 'job_request_rejected')
            ->where('data->notification_key', $notificationKey)
            ->exists();

        if ($alreadySent) {
            return;
        }

        $parentName = trim((string) (User::query()->where('user_id', $parentUserId)->value('name') ?? 'Parent'));
        $displayParent = $parentName !== '' ? $parentName : 'Parent';

        NotificationController::createForUser(
            $application->nanny_id,
            'job_request_rejected',
            'Request Rejected',
            $displayParent.' did not select your application for this babysitting job.',
            [
                'notification_key' => $notificationKey,
                'job_id' => $job->id,
                'application_id' => $application->id,
                'nanny_id' => $application->nanny_id,
                'parent_user_id' => $parentUserId,
                'parent' => [
                    'user_id' => $parentUserId,
                    'name' => $displayParent,
                ],
                'job' => [
                    'id' => $job->id,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'start_time' => (string) $job->start_time,
                    'end_time' => (string) ($job->end_time ?? ''),
                    'location' => $job->location,
                    'status' => (string) ($job->status ?: 'pending'),
                ],
            ],
            $parentUserId
        );
    }

    private function notifyApplicantsJobCanceled(
        ParentJob $job,
        string $parentUserId,
        ?string $reason = null
    ): void {
        $applications = ParentJobApplication::query()
            ->where('job_id', $job->id)
            ->orderByDesc('id')
            ->get(['id', 'nanny_id']);

        if ($applications->isEmpty()) {
            return;
        }

        $parentName = trim((string) (User::query()->where('user_id', $parentUserId)->value('name') ?? 'Parent'));
        $displayParent = $parentName !== '' ? $parentName : 'Parent';
        $normalizedReason = trim((string) ($reason ?? ''));
        $notifiedNannyIds = [];

        foreach ($applications as $application) {
            $nannyId = strtoupper(trim((string) $application->nanny_id));
            if ($nannyId === '') {
                continue;
            }
            if (isset($notifiedNannyIds[$nannyId])) {
                continue;
            }
            $notifiedNannyIds[$nannyId] = true;

            $notificationKey = 'job:'.$job->id.':canceled:'.$nannyId;
            $alreadySent = UserNotification::query()
                ->where('recipient_user_id', $nannyId)
                ->where('type', 'job_canceled')
                ->where('data->notification_key', $notificationKey)
                ->exists();
            if ($alreadySent) {
                continue;
            }

            NotificationController::createForUser(
                $nannyId,
                'job_canceled',
                'Job Canceled',
                $displayParent.' canceled job #'.$job->id.'.',
                [
                    'notification_key' => $notificationKey,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'nanny_id' => $nannyId,
                    'parent_user_id' => $parentUserId,
                    'reason' => $normalizedReason !== '' ? $normalizedReason : null,
                    'job' => [
                        'id' => $job->id,
                        'start_date' => optional($job->start_date)->format('Y-m-d'),
                        'start_time' => (string) $job->start_time,
                        'end_time' => (string) ($job->end_time ?? ''),
                        'location' => $job->location,
                        'status' => (string) ($job->status ?: 'canceled'),
                    ],
                ],
                $parentUserId
            );
        }
    }

    private function notifyParentExtraHoursDecision(
        ParentJob $job,
        ParentJobApplication $application,
        string $parentUserId,
        string $nannyUserId,
        int $requestNotificationId,
        string $decision,
        float $requestedHours
    ): void {
        $notificationType = $decision === 'accepted'
            ? 'extra_hours_accepted'
            : 'extra_hours_rejected';
        $notificationKey = 'extra-hours:'.$requestNotificationId.':'.$decision;
        $alreadySent = UserNotification::query()
            ->where('recipient_user_id', $parentUserId)
            ->where('type', $notificationType)
            ->where('data->notification_key', $notificationKey)
            ->exists();
        if ($alreadySent) {
            return;
        }

        $nannyName = trim((string) (User::query()->where('user_id', $nannyUserId)->value('name') ?? 'Syttr'));
        $displayNanny = $nannyName !== '' ? $nannyName : 'Syttr';

        NotificationController::createForUser(
            $parentUserId,
            $notificationType,
            $decision === 'accepted' ? 'Extra Hours Accepted' : 'Extra Hours Rejected',
            $decision === 'accepted'
                ? $displayNanny.' accepted your extra hours request. The new end time is '.$this->formatNotificationTime((string) ($job->end_time ?? '')).'.'
                : $displayNanny.' rejected your extra hours request.',
            [
                'notification_key' => $notificationKey,
                'job_id' => $job->id,
                'application_id' => $application->id,
                'request_notification_id' => $requestNotificationId,
                'parent_user_id' => $parentUserId,
                'nanny_id' => $nannyUserId,
                'status' => $decision,
                'requested_hours' => round($requestedHours, 2),
                'hours' => $job->hours !== null ? round((float) $job->hours, 2) : null,
                'end_time' => (string) ($job->end_time ?? ''),
                'hourly_rate' => $this->resolveJobHourlyRate($job, true),
                'price' => $job->price !== null ? round((float) $job->price, 2) : null,
                'job' => [
                    'id' => $job->id,
                    'job_id' => $job->id,
                    'hours' => $job->hours !== null ? round((float) $job->hours, 2) : null,
                    'hourly_rate' => $this->resolveJobHourlyRate($job, true),
                    'price' => $job->price !== null ? round((float) $job->price, 2) : null,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'start_time' => (string) ($job->start_time ?? ''),
                    'end_time' => (string) ($job->end_time ?? ''),
                    'location' => $job->location,
                    'status' => (string) ($job->status ?: 'accepted'),
                ],
                'application' => [
                    'id' => $application->id,
                    'application_id' => $application->id,
                    'status' => $application->status,
                    'nanny_id' => $application->nanny_id,
                ],
                'nanny' => [
                    'id' => $nannyUserId,
                    'name' => $displayNanny,
                ],
            ],
            $nannyUserId
        );
    }

    private function resolveParentUserIdFromRequest(Request $request): ?string
    {
        $inputUserId = trim((string) ($request->input('user_id', $request->query('user_id', ''))));
        if ($inputUserId !== '') {
            return User::resolvePublicUserIdByIdentifier($inputUserId);
        }

        $bearer = trim((string) $request->bearerToken());
        if ($bearer === '') {
            return null;
        }

        return User::query()->where('api_token', $bearer)->value('user_id');
    }

    private function resolveNannyUserIdFromRequest(Request $request): ?string
    {
        $inputUserId = trim((string) (
            $request->input('nanny_id', $request->input('user_id', $request->query('nanny_id', $request->query('user_id', ''))))
        ));
        if ($inputUserId !== '') {
            return User::resolvePublicUserIdByIdentifier($inputUserId);
        }

        $bearer = trim((string) $request->bearerToken());
        if ($bearer === '') {
            return null;
        }

        return User::query()->where('api_token', $bearer)->value('user_id');
    }

    private function isBlacklistedUserId(?string $userId): bool
    {
        $normalizedUserId = strtoupper(trim((string) ($userId ?? '')));
        if ($normalizedUserId === '') {
            return false;
        }

        return (bool) User::query()
            ->where('user_id', $normalizedUserId)
            ->value('is_blacklisted');
    }

    private function resolveExtraHoursDecision(Request $request, int $notificationId, string $decision): JsonResponse
    {
        $nannyUserId = $this->resolveNannyUserIdFromRequest($request);
        if (! $nannyUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid nanny_id.',
            ], 422);
        }
        if ($this->isBlacklistedUserId($nannyUserId)) {
            return response()->json([
                'success' => false,
                'status' => 'blacklisted',
                'is_blacklisted' => true,
                'message' => 'This account is blacklisted and cannot access sitter actions.',
            ], 403);
        }

        $notification = UserNotification::query()
            ->whereKey($notificationId)
            ->where('recipient_user_id', strtoupper(trim((string) $nannyUserId)))
            ->where('type', 'extra_hours_request')
            ->first();

        if (! $notification) {
            return response()->json([
                'success' => false,
                'message' => 'Extra hours request not found.',
            ], 404);
        }

        $data = is_array($notification->data) ? $notification->data : [];
        $currentStatus = strtolower(trim((string) ($data['status'] ?? 'pending')));
        if ($currentStatus !== 'pending') {
            return response()->json([
                'success' => false,
                'message' => 'This extra hours request has already been processed.',
            ], 409);
        }

        $jobId = (int) ($data['job_id'] ?? 0);
        $applicationId = (int) ($data['application_id'] ?? 0);
        $requestedHours = round((float) ($data['requested_hours'] ?? 0), 2);
        $parentUserId = strtoupper(trim((string) ($data['parent_user_id'] ?? '')));

        if ($jobId <= 0 || $applicationId <= 0 || $requestedHours <= 0 || $parentUserId === '') {
            return response()->json([
                'success' => false,
                'message' => 'This extra hours request is missing booking details.',
            ], 422);
        }

        $result = DB::transaction(function () use (
            $notification,
            $data,
            $jobId,
            $applicationId,
            $requestedHours,
            $parentUserId,
            $nannyUserId,
            $decision
        ) {
            $job = ParentJob::query()->whereKey($jobId)->lockForUpdate()->first();
            $application = ParentJobApplication::query()->whereKey($applicationId)->lockForUpdate()->first();

            if (! $job || ! $application) {
                return ['error' => ['message' => 'Booking not found.', 'status' => 404]];
            }

            if ((string) $job->user_id !== (string) $parentUserId || (string) $application->nanny_id !== (string) $nannyUserId) {
                return ['error' => ['message' => 'Unauthorized for this booking.', 'status' => 403]];
            }

            $hoursBefore = round((float) ($job->hours ?? 0), 2);
            $hourlyRate = $this->resolveJobHourlyRate($job);

            if ($decision === 'accepted') {
                $job->hours = round($hoursBefore + $requestedHours, 2);
                $job->price = round(((float) $job->hours) * $hourlyRate, 2);
                $newEndTime = $this->normalizeTime((string) ($data['new_end_time'] ?? $data['requested_end_time'] ?? ''));
                if ($newEndTime) {
                    $job->end_time = $newEndTime;
                }
                $job->save();
            }

            $updatedData = array_merge($data, [
                'status' => $decision,
                'responded_at' => now()->toIso8601String(),
                'updated_hours' => $job->hours !== null ? round((float) $job->hours, 2) : null,
                'updated_total' => $job->price !== null ? round((float) $job->price, 2) : null,
                'updated_end_time' => (string) ($job->end_time ?? ''),
            ]);
            $notification->data = $updatedData;
            $notification->is_read = true;
            $notification->opened_at = now();
            $notification->save();

            return [
                'job' => $job->fresh(),
                'application' => $application,
            ];
        });

        if (is_array($result) && isset($result['error'])) {
            return response()->json([
                'success' => false,
                'message' => (string) ($result['error']['message'] ?? 'Unable to update extra hours request.'),
            ], (int) ($result['error']['status'] ?? 422));
        }

        $job = $result['job'];
        $application = $result['application'];
        $this->notifyParentExtraHoursDecision($job, $application, $parentUserId, $nannyUserId, $notificationId, $decision, $requestedHours);

        return response()->json([
            'success' => true,
            'message' => $decision === 'accepted'
                ? 'Extra hours request accepted.'
                : 'Extra hours request rejected.',
            'data' => [
                'job_id' => $job->id,
                'application_id' => $application->id,
                'status' => $decision,
                'hours' => $job->hours !== null ? round((float) $job->hours, 2) : null,
                'price' => $job->price !== null ? round((float) $job->price, 2) : null,
            ],
        ]);
    }

    private function isAcceptedStatus(?string $status): bool
    {
        $normalized = strtolower(trim((string) ($status ?? '')));
        return in_array($normalized, $this->acceptedApplicationStatuses(), true);
    }

    private function resolveJobHourlyRate(ParentJob $job, bool $nullable = false): ?float
    {
        if ($job->hourly_rate !== null) {
            return round((float) $job->hourly_rate, 2);
        }

        $hours = (float) ($job->hours ?? 0);
        $price = $job->price !== null ? (float) $job->price : null;
        if ($price !== null && $hours > 0) {
            return round($price / $hours, 2);
        }

        return $nullable ? null : 0.0;
    }

    private function isCanceledStatus(?string $status): bool
    {
        $normalized = strtolower(trim((string) ($status ?? '')));
        return in_array($normalized, ['cancel', 'cancelled', 'canceled'], true);
    }

    private function supportsLateCancellationFeeColumns(): bool
    {
        static $supportsColumns = null;

        if ($supportsColumns === null) {
            $supportsColumns = Schema::hasColumn('parent_jobs', 'late_cancellation_fee')
                && Schema::hasColumn('parent_jobs', 'late_cancellation_fee_charged_at');
        }

        return (bool) $supportsColumns;
    }

    private function isCompletedStatus(?string $status): bool
    {
        $normalized = strtolower(trim((string) ($status ?? '')));
        return in_array($normalized, ['completed', 'complete', 'done'], true);
    }

    private function isJobWithinScheduledWindow(ParentJob $job): bool
    {
        $timezone = config('app.timezone');
        $startAt = $this->buildJobStartAt($job, $timezone);
        if (! $startAt) {
            return false;
        }

        $hours = (float) ($job->hours ?? 0);
        if ($hours <= 0) {
            return false;
        }

        $endAt = (clone $startAt)->addMinutes((int) round($hours * 60));
        $now = Carbon::now($timezone);
        return $now->greaterThanOrEqualTo($startAt) && $now->lessThan($endAt);
    }

    private function resolveCancellationCutoffPolicy(ParentJob $job): array
    {
        $timezone = config('app.timezone');
        $startAt = $this->buildJobStartAt($job, $timezone);
        if (! $startAt) {
            return [
                'is_blocked' => false,
                'start_at' => null,
                'cutoff_at' => null,
            ];
        }

        $cutoffAt = (clone $startAt)->subHours(24);
        $now = Carbon::now($timezone);

        return [
            'is_blocked' => $now->greaterThanOrEqualTo($cutoffAt),
            'start_at' => $startAt,
            'cutoff_at' => $cutoffAt,
        ];
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

    private function ensureParentCanPostJob(string $parentUserId): ?JsonResponse
    {
        if ($blocked = $this->ensureParentCanManageJobs($parentUserId)) {
            return $blocked;
        }

        $isVerified = $this->isParentVerified($parentUserId);
        if (! $isVerified) {
            return response()->json([
                'success' => false,
                'message' => 'Please verify your account before posting a babysitting job.',
            ], 422);
        }

        $hasCard = PaymentMethod::query()->where('user_id', $parentUserId)->exists();
        if (! $hasCard) {
            return response()->json([
                'success' => false,
                'message' => 'Please add a valid payment card to your account before posting a babysitting job.',
            ], 422);
        }

        return null;
    }

    private function ensureParentCanManageJobs(?string $parentUserId): ?JsonResponse
    {
        $normalizedParentUserId = strtoupper(trim((string) ($parentUserId ?? '')));
        if ($normalizedParentUserId === '') {
            return null;
        }

        $user = User::query()
            ->where('user_id', $normalizedParentUserId)
            ->first(['user_id', 'is_blacklisted', 'blacklisted_reason']);
        if (! $user || ! (bool) $user->is_blacklisted) {
            return null;
        }

        return response()->json([
            'success' => false,
            'status' => 'blacklisted',
            'is_blacklisted' => true,
            'blacklisted_reason' => $user->blacklisted_reason,
            'message' => 'This account is blacklisted and cannot manage jobs.',
        ], 403);
    }

    private function ensureNannyCanReceiveJobOffer(?string $nannyUserId): ?JsonResponse
    {
        $normalizedNannyUserId = strtoupper(trim((string) ($nannyUserId ?? '')));
        if ($normalizedNannyUserId === '') {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid nanny_id.',
            ], 422);
        }

        $user = User::query()
            ->where('user_id', $normalizedNannyUserId)
            ->first(['user_id', 'is_blacklisted', 'blacklisted_reason']);
        if (! $user || ! (bool) $user->is_blacklisted) {
            return null;
        }

        return response()->json([
            'success' => false,
            'status' => 'blacklisted',
            'is_blacklisted' => true,
            'blacklisted_reason' => $user->blacklisted_reason,
            'message' => 'This sitter is blacklisted and cannot receive hire requests.',
        ], 403);
    }

    private function ensureParentHasNoJobDateConflict(
        string $parentUserId,
        string $startDate,
        ?string $endDate = null,
        string $mode = 'job_post'
    ): ?JsonResponse {
        $normalizedStart = trim($startDate);
        $normalizedEnd = trim((string) ($endDate ?? ''));

        if ($normalizedStart === '') {
            return null;
        }
        if ($normalizedEnd === '') {
            $normalizedEnd = $normalizedStart;
        }

        $existingJob = $this->findExistingActiveJobForDateRange($parentUserId, $normalizedStart, $normalizedEnd, [
            'id',
            'start_date',
            'end_date',
            'status',
        ]);

        if (! $existingJob) {
            return null;
        }

        $message = $mode === 'hire_request'
            ? 'You already have a job on one of the selected dates. You cannot send a hire request to a Syttr for the same day.'
            : 'You already have a job on one of the selected dates. You cannot post another job for the same day.';

        return response()->json([
            'success' => false,
            'message' => $message,
            'data' => [
                'conflicting_job_id' => $existingJob->id,
                'conflicting_start_date' => optional($existingJob->start_date)->format('Y-m-d'),
                'conflicting_end_date' => optional($existingJob->end_date)->format('Y-m-d'),
                'conflicting_status' => strtolower(trim((string) ($existingJob->status ?? 'pending'))) ?: 'pending',
            ],
        ], 422);
    }

    private function findExistingActiveJobForDateRange(
        string $parentUserId,
        string $startDate,
        ?string $endDate = null,
        array $columns = ['*']
    ): ?ParentJob {
        $normalizedStart = trim($startDate);
        $normalizedEnd = trim((string) ($endDate ?? ''));

        if ($normalizedStart === '') {
            return null;
        }
        if ($normalizedEnd === '') {
            $normalizedEnd = $normalizedStart;
        }

        return ParentJob::query()
            ->where('user_id', $parentUserId)
            ->whereDate('start_date', '<=', $normalizedEnd)
            ->whereRaw('COALESCE(end_date, start_date) >= ?', [$normalizedStart])
            ->where(function ($query) {
                $query
                    ->whereNull('status')
                    ->orWhereRaw('LOWER(COALESCE(status, "")) NOT IN (?, ?, ?)', ['cancel', 'cancelled', 'canceled']);
            })
            ->orderBy('start_date')
            ->orderBy('id')
            ->first($columns);
    }

    private function findExistingHireRequestForDateRange(
        string $parentUserId,
        string $nannyUserId,
        string $startDate,
        ?string $endDate = null
    ): ?ParentJobApplication {
        $normalizedStart = trim($startDate);
        $normalizedEnd = trim((string) ($endDate ?? ''));

        if ($normalizedStart === '') {
            return null;
        }
        if ($normalizedEnd === '') {
            $normalizedEnd = $normalizedStart;
        }

        return ParentJobApplication::query()
            ->where('nanny_id', $nannyUserId)
            ->where(function ($query) {
                $this->applyHireRequestApplicationConstraint($query);
            })
            ->whereHas('job', function ($query) use ($parentUserId, $normalizedStart, $normalizedEnd) {
                $query
                    ->where('user_id', $parentUserId)
                    ->whereDate('start_date', '<=', $normalizedEnd)
                    ->whereRaw('COALESCE(end_date, start_date) >= ?', [$normalizedStart])
                    ->where(function ($statusQuery) {
                        $statusQuery
                            ->whereNull('status')
                            ->orWhereRaw('LOWER(COALESCE(status, "")) NOT IN (?, ?, ?)', ['cancel', 'cancelled', 'canceled']);
                    });
            })
            ->orderByDesc('id')
            ->first(['id', 'job_id', 'status', 'request_source']);
    }

    private function applyHireRequestApplicationConstraint($query): void
    {
        $query->where(function ($hireRequestQuery) {
            $hireRequestQuery
                ->whereRaw('LOWER(COALESCE(request_source, "")) IN (?, ?)', ['hire_request', 'hire-request'])
                ->orWhereRaw('LOWER(COALESCE(status, "")) IN (?, ?)', ['hire_requested', 'hire-requested'])
                ->orWhere('message', 'like', '%source:hire_now%');
        });
    }

    private function hiddenPublicJobStatuses(): array
    {
        return [
            ...$this->acceptedApplicationStatuses(),
            'cancel',
            'cancelled',
            'canceled',
            'completed',
            'complete',
            'done',
            'closed',
            'expired',
            'withdrawn',
        ];
    }

    private function hiddenViewerJobFeedApplicationStatuses(): array
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

    private function isParentVerified(string $parentUserId): bool
    {
        $user = User::query()
            ->where('user_id', $parentUserId)
            ->first(['profile_status', 'is_blacklisted']);
        if (! $user || $user->is_blacklisted) {
            return false;
        }

        $status = strtolower(trim((string) ($user->profile_status ?? '')));
        return in_array($status, ['verified', 'approved', 'completed', 'quickapp-completed'], true);
    }

    private function notifyAssignedSyttrJobCompleted(ParentJob $job, string $parentUserId): void
    {
        $acceptedApplications = ParentJobApplication::query()
            ->where('job_id', $job->id)
            ->whereIn('status', $this->acceptedApplicationStatuses())
            ->orderByDesc('id')
            ->get(['id', 'nanny_id']);

        if ($acceptedApplications->isEmpty()) {
            return;
        }

        $parentName = trim((string) (User::query()->where('user_id', $parentUserId)->value('name') ?? 'Parent'));
        $displayParent = $parentName !== '' ? $parentName : 'Parent';
        $notifiedNannyIds = [];

        foreach ($acceptedApplications as $application) {
            $nannyId = strtoupper(trim((string) $application->nanny_id));
            if ($nannyId === '' || isset($notifiedNannyIds[$nannyId])) {
                continue;
            }
            $notifiedNannyIds[$nannyId] = true;

            $notificationKey = 'job:'.$job->id.':completed:'.$nannyId;
            $alreadySent = UserNotification::query()
                ->where('recipient_user_id', $nannyId)
                ->where('type', 'job_completed')
                ->where('data->notification_key', $notificationKey)
                ->exists();
            if ($alreadySent) {
                continue;
            }

            NotificationController::createForUser(
                $nannyId,
                'job_completed',
                'Job Completed',
                $displayParent.' marked job #'.$job->id.' as completed.',
                [
                    'notification_key' => $notificationKey,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'nanny_id' => $nannyId,
                    'parent_user_id' => $parentUserId,
                    'job' => [
                        'id' => $job->id,
                        'start_date' => optional($job->start_date)->format('Y-m-d'),
                        'start_time' => (string) $job->start_time,
                        'end_time' => (string) ($job->end_time ?? ''),
                        'location' => $job->location,
                        'status' => (string) ($job->status ?: 'completed'),
                    ],
                ],
                $parentUserId
            );
        }
    }

    private function notifyJobCompletionRatingPrompts(ParentJob $job, string $parentUserId): void
    {
        $acceptedApplication = ParentJobApplication::query()
            ->where('job_id', $job->id)
            ->whereIn('status', $this->acceptedApplicationStatuses())
            ->orderByDesc('id')
            ->first();
        if (! $acceptedApplication) {
            return;
        }

        $parentName = trim((string) (User::query()->where('user_id', $parentUserId)->value('name') ?? 'Parent'));
        $displayParent = $parentName !== '' ? $parentName : 'Parent';
        $nannyName = trim((string) (User::query()->where('user_id', $acceptedApplication->nanny_id)->value('name') ?? 'Syttr'));
        $displayNanny = $nannyName !== '' ? $nannyName : 'Syttr';

        $notificationKeyForParent = 'job:'.$job->id.':rate-sitter-prompt:'.$acceptedApplication->id;
        $alreadyPromptedParent = UserNotification::query()
            ->where('recipient_user_id', $parentUserId)
            ->where('type', 'rate_sitter_prompt')
            ->where('data->notification_key', $notificationKeyForParent)
            ->exists();
        if (! $alreadyPromptedParent) {
            NotificationController::createForUser(
                $parentUserId,
                'rate_sitter_prompt',
                'Rate your experience with '.$displayNanny,
                'Please rate your experience with '.$displayNanny.' for this job.',
                [
                    'notification_key' => $notificationKeyForParent,
                    'job_id' => $job->id,
                    'application_id' => $acceptedApplication->id,
                    'nanny_id' => $acceptedApplication->nanny_id,
                    'parent_user_id' => $parentUserId,
                    'parent' => [
                        'user_id' => $parentUserId,
                        'name' => $displayParent,
                    ],
                    'nanny' => [
                        'id' => $acceptedApplication->nanny_id,
                        'name' => $displayNanny,
                    ],
                ],
                $acceptedApplication->nanny_id
            );
        }

        $notificationKeyForNanny = 'job:'.$job->id.':rate-parent-prompt:'.$acceptedApplication->id;
        $alreadyPromptedNanny = UserNotification::query()
            ->where('recipient_user_id', $acceptedApplication->nanny_id)
            ->where('type', 'rate_parent_prompt')
            ->where('data->notification_key', $notificationKeyForNanny)
            ->exists();
        if (! $alreadyPromptedNanny) {
            NotificationController::createForUser(
                $acceptedApplication->nanny_id,
                'rate_parent_prompt',
                'Rate your experience with '.$displayParent,
                'Please rate your experience with '.$displayParent.' for this job.',
                [
                    'notification_key' => $notificationKeyForNanny,
                    'job_id' => $job->id,
                    'application_id' => $acceptedApplication->id,
                    'parent_user_id' => $parentUserId,
                    'parent' => [
                        'user_id' => $parentUserId,
                        'name' => $displayParent,
                    ],
                    'nanny' => [
                        'id' => $acceptedApplication->nanny_id,
                        'name' => $displayNanny,
                    ],
                ],
                $parentUserId
            );
        }

        if (! $acceptedApplication->rating_prompted_parent_at || ! $acceptedApplication->rating_prompted_nanny_at) {
            $acceptedApplication->rating_prompted_parent_at = $acceptedApplication->rating_prompted_parent_at ?: Carbon::now(config('app.timezone'));
            $acceptedApplication->rating_prompted_nanny_at = $acceptedApplication->rating_prompted_nanny_at ?: Carbon::now(config('app.timezone'));
            $acceptedApplication->save();
        }
    }

    private function chargeAndTransferCompletedJob(ParentJob $job): array
    {
        $amount = $this->resolveCompletionAmount($job);
        $stripeAuditBase = [
            'user_id' => $job->user_id,
            'source' => 'parent_job.complete',
            'category' => 'job',
            'type' => 'payment_intent',
            'amount' => $amount > 0 ? round($amount, 2) : null,
            'currency' => 'usd',
            'job_id' => $job->id,
            'description' => 'Completed job #'.$job->id.' charge',
            'request_payload' => [
                'job_id' => $job->id,
                'amount' => $amount > 0 ? round($amount, 2) : null,
                'hours' => $job->hours !== null ? (float) $job->hours : null,
                'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
                'price' => $job->price !== null ? (float) $job->price : null,
            ],
            'meta' => [
                'job_status' => (string) ($job->status ?? ''),
            ],
        ];
        if ($amount <= 0) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'invalid_amount',
                'error_message' => 'Invalid job amount. Please set hours and rate before completing the job.',
            ]);
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Invalid job amount. Please set hours and rate before completing the job.',
            ];
        }

        $acceptedApplication = ParentJobApplication::query()
            ->where('job_id', $job->id)
            ->whereIn('status', $this->acceptedApplicationStatuses())
            ->orderByDesc('id')
            ->first();
        if (! $acceptedApplication) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'missing_application',
                'error_message' => 'No accepted sitter was found for this job.',
            ]);
            return [
                'success' => false,
                'status' => 422,
                'message' => 'No accepted sitter was found for this job.',
            ];
        }

        $stripeAuditBase['application_id'] = $acceptedApplication->id;
        $stripeAuditBase['counterparty_user_id'] = $acceptedApplication->nanny_id;
        $stripeAuditBase['meta'] = [
            ...($stripeAuditBase['meta'] ?? []),
            'application_id' => $acceptedApplication->id,
            'nanny_id' => $acceptedApplication->nanny_id,
            'request_source' => (string) ($acceptedApplication->request_source ?? ''),
        ];

        $paymentMethod = PaymentMethod::query()
            ->where('user_id', $job->user_id)
            ->orderByDesc('is_default')
            ->orderByDesc('id')
            ->first();
        if (! $paymentMethod || ! filled($paymentMethod->stripe_payment_method_id)) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'missing_payment_method',
                'payment_method_id' => $paymentMethod?->id,
                'error_message' => 'No saved payment method found for this parent.',
            ]);
            return [
                'success' => false,
                'status' => 422,
                'message' => 'No saved payment method found for this parent.',
            ];
        }

        $stripeAuditBase['payment_method_id'] = $paymentMethod->id;
        $stripeAuditBase['stripe_payment_method_id'] = (string) $paymentMethod->stripe_payment_method_id;
        $stripeAuditBase['request_payload'] = [
            ...($stripeAuditBase['request_payload'] ?? []),
            'payment_method_id' => $paymentMethod->id,
            'stripe_payment_method_id' => (string) $paymentMethod->stripe_payment_method_id,
        ];

        $stripeSecret = trim((string) config('services.stripe.secret', ''));
        $stripeVerifySsl = (bool) config('services.stripe.verify_ssl', true);
        if ($stripeSecret === '') {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'config_error',
                'error_message' => 'Stripe secret key is not configured.',
            ]);
            return [
                'success' => false,
                'status' => 500,
                'message' => 'Stripe secret key is not configured.',
            ];
        }

        $user = User::query()->where('user_id', $job->user_id)->first();
        if (! $user) {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Unable to resolve parent for this job.',
            ];
        }

        $paymentMethodSetup = StripeCustomerManager::ensureReusablePaymentMethodForUser(
            $user,
            (string) $paymentMethod->stripe_payment_method_id,
            (bool) $paymentMethod->is_default
        );
        if (! ($paymentMethodSetup['success'] ?? false)) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'payment_method_error',
                'error_message' => (string) ($paymentMethodSetup['message'] ?? 'Unable to use the selected payment method.'),
                'meta' => [
                    ...($stripeAuditBase['meta'] ?? []),
                    'stripe_customer_id' => (string) ($paymentMethodSetup['customer_id'] ?? ''),
                    'stripe_payload' => $paymentMethodSetup['stripe_payload'] ?? null,
                ],
            ]);

            return [
                'success' => false,
                'status' => (int) ($paymentMethodSetup['status'] ?? 422),
                'message' => (string) ($paymentMethodSetup['message'] ?? 'Unable to use the selected payment method.'),
            ];
        }
        $stripeCustomerId = trim((string) ($paymentMethodSetup['customer_id'] ?? $user->stripe_customer_id ?? ''));

        $destinationAccountId = trim((string) config('services.stripe.connect_account_id', ''));
        $hasDestinationAccount = $destinationAccountId !== '' && str_starts_with($destinationAccountId, 'acct_');
        if (! $hasDestinationAccount) {
            Log::warning('parent_job.complete.missing_connect_account', [
                'job_id' => $job->id,
                'user_id' => $job->user_id,
                'configured_destination_account' => $destinationAccountId !== '' ? $destinationAccountId : null,
            ]);
        }

        $amountInCents = max(1, (int) round($amount * 100));
        $currency = 'usd';
        $stripeAuditBase['currency'] = $currency;
        $stripeAuditBase['request_payload'] = [
            ...($stripeAuditBase['request_payload'] ?? []),
            'amount' => $amountInCents,
            'currency' => $currency,
            'destination_account' => $hasDestinationAccount ? $destinationAccountId : null,
            'connect_transfer_enabled' => $hasDestinationAccount,
            'customer' => $stripeCustomerId !== '' ? $stripeCustomerId : null,
            'confirm' => true,
            'off_session' => true,
            'payment_method_types' => ['card'],
        ];

        try {
            $paymentIntentPayload = [
                'amount' => $amountInCents,
                'currency' => $currency,
                'confirm' => 'true',
                'off_session' => 'true',
                'payment_method' => (string) $paymentMethod->stripe_payment_method_id,
                'customer' => $stripeCustomerId,
                'payment_method_types[0]' => 'card',
                'description' => 'Completed job #'.$job->id.' charge',
                'metadata[job_id]' => (string) $job->id,
                'metadata[parent_user_id]' => (string) $job->user_id,
                'expand[0]' => 'latest_charge.balance_transaction',
            ];
            if ($hasDestinationAccount) {
                $paymentIntentPayload['transfer_data[destination]'] = $destinationAccountId;
            }

            $response = Http::withOptions([
                    'verify' => $stripeVerifySsl,
                ])
                ->withBasicAuth($stripeSecret, '')
                ->connectTimeout(5)
                ->timeout(20)
                ->asForm()
                ->post('https://api.stripe.com/v1/payment_intents', $paymentIntentPayload);

            $payload = $response->json() ?: [];
            if (! $response->successful()) {
                $errorMessage = StripeCustomerManager::humanizeReusablePaymentMethodError(
                    (string) ($payload['error']['message'] ?? $payload['message'] ?? 'Stripe payment failed.')
                );
                StripeTransactionRecorder::record([
                    ...$stripeAuditBase,
                    'status' => 'failed',
                    'stripe_payment_intent_id' => (string) ($payload['id'] ?? ''),
                    'response_payload' => $payload,
                    'error_message' => $errorMessage,
                ]);
                Log::warning('parent_job.complete.payment_failed', [
                    'job_id' => $job->id,
                    'user_id' => $job->user_id,
                    'amount' => $amount,
                    'status' => $response->status(),
                    'error' => $errorMessage,
                    'stripe_payload' => $payload,
                ]);

                return [
                    'success' => false,
                    'status' => 402,
                    'message' => $errorMessage,
                ];
            }

            $intentStatus = strtolower(trim((string) ($payload['status'] ?? '')));
            if (! in_array($intentStatus, ['succeeded', 'requires_capture', 'processing'], true)) {
                StripeTransactionRecorder::record([
                    ...$stripeAuditBase,
                    'status' => $intentStatus !== '' ? $intentStatus : 'incomplete',
                    'stripe_payment_intent_id' => (string) ($payload['id'] ?? ''),
                    'response_payload' => $payload,
                    'error_message' => 'Job payment was not completed.',
                ]);
                return [
                    'success' => false,
                    'status' => 402,
                    'message' => 'Job payment was not completed.',
                ];
            }

            $ledgerBreakdown = $this->resolveStripeCompletionLedgerBreakdown(
                $payload,
                $amountInCents,
                $stripeSecret,
                $stripeVerifySsl
            );

            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => $intentStatus,
                'stripe_payment_intent_id' => (string) ($payload['id'] ?? ''),
                'stripe_charge_id' => (string) ($ledgerBreakdown['charge_id'] ?? ''),
                'response_payload' => $payload,
                'meta' => [
                    ...($stripeAuditBase['meta'] ?? []),
                    'destination_account' => $hasDestinationAccount ? $destinationAccountId : null,
                    'connect_transfer_enabled' => $hasDestinationAccount,
                    'stripe_customer_id' => $stripeCustomerId !== '' ? $stripeCustomerId : null,
                    'gross_amount' => (float) ($ledgerBreakdown['gross_amount'] ?? $amount),
                    'stripe_fee_amount' => (float) ($ledgerBreakdown['stripe_fee_amount'] ?? 0),
                    'stripe_tax_amount' => (float) ($ledgerBreakdown['stripe_tax_amount'] ?? 0),
                    'stripe_processing_fee_amount' => (float) ($ledgerBreakdown['stripe_processing_fee_amount'] ?? 0),
                    'net_amount' => (float) ($ledgerBreakdown['net_amount'] ?? $amount),
                    'balance_transaction_id' => (string) ($ledgerBreakdown['balance_transaction_id'] ?? ''),
                    'fee_details' => is_array($ledgerBreakdown['fee_details'] ?? null)
                        ? $ledgerBreakdown['fee_details']
                        : [],
                ],
            ]);

            return [
                'success' => true,
                'amount' => $amount,
                'gross_amount' => (float) ($ledgerBreakdown['gross_amount'] ?? $amount),
                'stripe_fee_amount' => (float) ($ledgerBreakdown['stripe_fee_amount'] ?? 0),
                'stripe_tax_amount' => (float) ($ledgerBreakdown['stripe_tax_amount'] ?? 0),
                'stripe_processing_fee_amount' => (float) ($ledgerBreakdown['stripe_processing_fee_amount'] ?? 0),
                'net_amount' => (float) ($ledgerBreakdown['net_amount'] ?? $amount),
                'currency' => $currency,
                'payment_intent_id' => (string) ($payload['id'] ?? ''),
                'destination_account' => $hasDestinationAccount ? $destinationAccountId : null,
                'connect_transfer_enabled' => $hasDestinationAccount,
                'stripe_customer_id' => $stripeCustomerId !== '' ? $stripeCustomerId : null,
                'application_id' => $acceptedApplication->id,
                'nanny_id' => $acceptedApplication->nanny_id,
                'payment_status' => $intentStatus,
                'charge_id' => (string) ($ledgerBreakdown['charge_id'] ?? ''),
                'balance_transaction_id' => (string) ($ledgerBreakdown['balance_transaction_id'] ?? ''),
                'fee_details' => is_array($ledgerBreakdown['fee_details'] ?? null)
                    ? $ledgerBreakdown['fee_details']
                    : [],
            ];
        } catch (\Throwable $e) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'exception',
                'error_message' => $e->getMessage(),
                'meta' => [
                    ...($stripeAuditBase['meta'] ?? []),
                    'exception' => get_class($e),
                ],
            ]);
            Log::error('parent_job.complete.payment_exception', [
                'job_id' => $job->id,
                'user_id' => $job->user_id,
                'amount' => $amount,
                'error' => $e->getMessage(),
            ]);

            return [
                'success' => false,
                'status' => 500,
                'message' => 'Unable to process payment right now. Please try again.',
            ];
        }
    }

    private function recordCompletionWalletTransactions(
        ParentJob $job,
        ParentJobApplication $application,
        float $amount,
        string $currency,
        string $paymentIntentId = '',
        array $paymentBreakdown = []
    ): void {
        if (! Schema::hasTable('wallet_transactions')) {
            Log::warning('parent_job.complete.wallet_table_missing', [
                'job_id' => $job->id,
                'application_id' => $application->id,
            ]);
            return;
        }

        $grossAmount = round((float) ($paymentBreakdown['gross_amount'] ?? $amount), 2);
        $stripeFeeAmount = round((float) ($paymentBreakdown['stripe_fee_amount'] ?? 0), 2);
        $stripeTaxAmount = round((float) ($paymentBreakdown['stripe_tax_amount'] ?? 0), 2);
        $stripeProcessingFeeAmount = round((float) ($paymentBreakdown['stripe_processing_fee_amount'] ?? max(0, $stripeFeeAmount - $stripeTaxAmount)), 2);
        $netAmount = round((float) ($paymentBreakdown['net_amount'] ?? max(0, $grossAmount - $stripeFeeAmount)), 2);
        if ($netAmount < 0) {
            $netAmount = 0.0;
        }

        $meta = [
            'job_status' => (string) ($job->status ?: 'completed'),
            'request_source' => (string) ($application->request_source ?: ''),
            'hours' => $job->hours !== null ? (float) $job->hours : null,
            'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
            'price' => $job->price !== null ? (float) $job->price : $grossAmount,
            'gross_amount' => $grossAmount,
            'stripe_fee_amount' => $stripeFeeAmount,
            'stripe_tax_amount' => $stripeTaxAmount,
            'stripe_processing_fee_amount' => $stripeProcessingFeeAmount,
            'net_amount' => $netAmount,
            'fee_details' => is_array($paymentBreakdown['fee_details'] ?? null)
                ? $paymentBreakdown['fee_details']
                : [],
            'balance_transaction_id' => trim((string) ($paymentBreakdown['balance_transaction_id'] ?? '')) ?: null,
            'charge_id' => trim((string) ($paymentBreakdown['charge_id'] ?? '')) ?: null,
            'payment_status' => trim((string) ($paymentBreakdown['payment_status'] ?? '')) ?: null,
        ];

        try {
            WalletTransaction::query()->updateOrCreate(
                [
                    'user_id' => $job->user_id,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'type' => 'job_charge',
                    'direction' => 'debit',
                ],
                [
                    'counterparty_user_id' => $application->nanny_id,
                    'category' => 'job',
                    'amount' => $grossAmount,
                    'currency' => strtolower(trim($currency)) ?: 'usd',
                    'status' => 'completed',
                    'description' => 'Completed job #'.$job->id.' payment',
                    'stripe_payment_intent_id' => $paymentIntentId !== '' ? $paymentIntentId : null,
                    'meta' => $meta,
                ]
            );

            $payoutTransaction = WalletTransaction::query()->updateOrCreate(
                [
                    'user_id' => $application->nanny_id,
                    'job_id' => $job->id,
                    'application_id' => $application->id,
                    'type' => 'job_payout',
                    'direction' => 'credit',
                ],
                [
                    'counterparty_user_id' => $job->user_id,
                    'category' => 'job',
                    'amount' => $netAmount,
                    'currency' => strtolower(trim($currency)) ?: 'usd',
                    'status' => 'completed',
                    'description' => 'Net earnings from completed job #'.$job->id,
                    'stripe_payment_intent_id' => $paymentIntentId !== '' ? $paymentIntentId : null,
                    'meta' => $meta,
                ]
            );

            $this->notifySyttrPaymentReceived(
                $job,
                $application,
                $job->user_id,
                $payoutTransaction,
                $grossAmount,
                $netAmount,
                $stripeFeeAmount,
                $stripeTaxAmount,
                $stripeProcessingFeeAmount,
                strtolower(trim($currency)) ?: 'usd'
            );
        } catch (\Throwable $e) {
            Log::error('parent_job.complete.wallet_record_failed', [
                'job_id' => $job->id,
                'application_id' => $application->id,
                'payment_intent_id' => $paymentIntentId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function notifySyttrPaymentReceived(
        ParentJob $job,
        ParentJobApplication $application,
        string $parentUserId,
        WalletTransaction $payoutTransaction,
        float $grossAmount,
        float $netAmount,
        float $stripeFeeAmount,
        float $stripeTaxAmount,
        float $stripeProcessingFeeAmount,
        string $currency
    ): void {
        $nannyId = strtoupper(trim((string) $application->nanny_id));
        if ($nannyId === '') {
            return;
        }

        $notificationKey = 'job:'.$job->id.':payment-received:'.$application->id;
        $alreadySent = UserNotification::query()
            ->where('recipient_user_id', $nannyId)
            ->where('type', 'payment_received')
            ->where('data->notification_key', $notificationKey)
            ->exists();
        if ($alreadySent) {
            return;
        }

        $parentName = trim((string) (User::query()->where('user_id', $parentUserId)->value('name') ?? 'Parent'));
        $displayParent = $parentName !== '' ? $parentName : 'Parent';

        NotificationController::createForUser(
            $nannyId,
            'payment_received',
            'Payment Received',
            $displayParent.' sent your payout for job #'.$job->id.'. Net earnings: '.$this->formatMoneyLabel($netAmount, $currency).'.',
            [
                'notification_key' => $notificationKey,
                'job_id' => $job->id,
                'application_id' => $application->id,
                'wallet_transaction_id' => $payoutTransaction->id,
                'nanny_id' => $nannyId,
                'parent_user_id' => $parentUserId,
                'amount' => round($netAmount, 2),
                'gross_amount' => round($grossAmount, 2),
                'net_amount' => round($netAmount, 2),
                'stripe_fee_amount' => round($stripeFeeAmount, 2),
                'stripe_tax_amount' => round($stripeTaxAmount, 2),
                'stripe_processing_fee_amount' => round($stripeProcessingFeeAmount, 2),
                'currency' => strtolower(trim($currency)) ?: 'usd',
                'job' => [
                    'id' => $job->id,
                    'start_date' => optional($job->start_date)->format('Y-m-d'),
                    'start_time' => (string) $job->start_time,
                    'end_time' => (string) ($job->end_time ?? ''),
                    'location' => $job->location,
                    'status' => (string) ($job->status ?: 'completed'),
                ],
            ],
            $parentUserId
        );
    }

    private function resolveStripeCompletionLedgerBreakdown(
        array $paymentIntentPayload,
        int $fallbackGrossCents,
        string $stripeSecret,
        bool $stripeVerifySsl
    ): array {
        $grossCents = max(0, $fallbackGrossCents);
        $default = [
            'gross_amount' => $this->centsToAmount($grossCents),
            'stripe_fee_amount' => 0.0,
            'stripe_tax_amount' => 0.0,
            'stripe_processing_fee_amount' => 0.0,
            'net_amount' => $this->centsToAmount($grossCents),
            'fee_details' => [],
            'balance_transaction_id' => '',
            'charge_id' => '',
        ];

        $chargePayload = $this->resolveStripeCompletionChargePayload(
            $paymentIntentPayload,
            $stripeSecret,
            $stripeVerifySsl
        );
        if (! $chargePayload) {
            Log::warning('parent_job.complete.payment_breakdown_missing_charge', [
                'payment_intent_id' => (string) ($paymentIntentPayload['id'] ?? ''),
            ]);
            return $default;
        }

        $chargeId = trim((string) ($chargePayload['id'] ?? ''));
        $balanceTransaction = is_array($chargePayload['balance_transaction'] ?? null)
            ? $chargePayload['balance_transaction']
            : null;

        if (! $balanceTransaction) {
            Log::warning('parent_job.complete.payment_breakdown_missing_balance_transaction', [
                'payment_intent_id' => (string) ($paymentIntentPayload['id'] ?? ''),
                'charge_id' => $chargeId,
            ]);
            return [
                ...$default,
                'charge_id' => $chargeId,
            ];
        }

        $resolvedGrossCents = (int) ($balanceTransaction['amount'] ?? $chargePayload['amount'] ?? $grossCents);
        if ($resolvedGrossCents <= 0) {
            $resolvedGrossCents = $grossCents;
        }

        $feeCents = max(0, (int) ($balanceTransaction['fee'] ?? 0));
        $feeDetails = collect(is_array($balanceTransaction['fee_details'] ?? null) ? $balanceTransaction['fee_details'] : [])
            ->map(static function ($detail) {
                if (! is_array($detail)) {
                    return null;
                }

                $amount = (int) ($detail['amount'] ?? 0);
                return [
                    'amount' => round($amount / 100, 2),
                    'currency' => strtolower(trim((string) ($detail['currency'] ?? 'usd'))) ?: 'usd',
                    'type' => strtolower(trim((string) ($detail['type'] ?? ''))),
                    'description' => trim((string) ($detail['description'] ?? '')),
                ];
            })
            ->filter()
            ->values()
            ->all();

        $taxFeeCents = collect($feeDetails)->reduce(
            static function (int $carry, array $detail): int {
                $type = strtolower(trim((string) ($detail['type'] ?? '')));
                $description = strtolower(trim((string) ($detail['description'] ?? '')));
                if (
                    str_contains($type, 'tax') ||
                    str_contains($description, 'tax') ||
                    str_contains($description, 'vat') ||
                    str_contains($description, 'gst')
                ) {
                    return $carry + (int) round(((float) ($detail['amount'] ?? 0)) * 100);
                }

                return $carry;
            },
            0
        );

        $netCents = (int) ($balanceTransaction['net'] ?? ($resolvedGrossCents - $feeCents));
        if ($netCents < 0) {
            $netCents = 0;
        }
        if ($netCents > $resolvedGrossCents) {
            $netCents = max(0, $resolvedGrossCents - $feeCents);
        }

        return [
            'gross_amount' => $this->centsToAmount($resolvedGrossCents),
            'stripe_fee_amount' => $this->centsToAmount($feeCents),
            'stripe_tax_amount' => $this->centsToAmount($taxFeeCents),
            'stripe_processing_fee_amount' => $this->centsToAmount(max(0, $feeCents - $taxFeeCents)),
            'net_amount' => $this->centsToAmount($netCents),
            'fee_details' => $feeDetails,
            'balance_transaction_id' => trim((string) ($balanceTransaction['id'] ?? '')),
            'charge_id' => $chargeId,
        ];
    }

    private function resolveStripeCompletionChargePayload(
        array $paymentIntentPayload,
        string $stripeSecret,
        bool $stripeVerifySsl
    ): ?array {
        $latestCharge = $paymentIntentPayload['latest_charge'] ?? null;
        if (is_array($latestCharge)) {
            return $latestCharge;
        }

        $latestChargeId = trim((string) $latestCharge);
        if ($latestChargeId !== '') {
            $chargePayload = $this->fetchStripeChargeWithBalanceTransaction(
                $latestChargeId,
                $stripeSecret,
                $stripeVerifySsl
            );
            if (is_array($chargePayload)) {
                return $chargePayload;
            }
        }

        $paymentIntentId = trim((string) ($paymentIntentPayload['id'] ?? ''));
        if ($paymentIntentId === '') {
            return null;
        }

        try {
            $response = Http::withOptions([
                    'verify' => $stripeVerifySsl,
                ])
                ->withBasicAuth($stripeSecret, '')
                ->connectTimeout(5)
                ->timeout(20)
                ->get('https://api.stripe.com/v1/payment_intents/'.$paymentIntentId, [
                    'expand' => ['latest_charge.balance_transaction'],
                ]);

            $payload = $response->json() ?: [];
            if (! $response->successful()) {
                Log::warning('parent_job.complete.payment_intent_refetch_failed', [
                    'payment_intent_id' => $paymentIntentId,
                    'status' => $response->status(),
                    'stripe_payload' => $payload,
                ]);
                return null;
            }

            $refetchedCharge = $payload['latest_charge'] ?? null;
            return is_array($refetchedCharge) ? $refetchedCharge : null;
        } catch (\Throwable $e) {
            Log::warning('parent_job.complete.payment_intent_refetch_exception', [
                'payment_intent_id' => $paymentIntentId,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    private function fetchStripeChargeWithBalanceTransaction(
        string $chargeId,
        string $stripeSecret,
        bool $stripeVerifySsl
    ): ?array {
        try {
            $response = Http::withOptions([
                    'verify' => $stripeVerifySsl,
                ])
                ->withBasicAuth($stripeSecret, '')
                ->connectTimeout(5)
                ->timeout(20)
                ->get('https://api.stripe.com/v1/charges/'.$chargeId, [
                    'expand' => ['balance_transaction'],
                ]);

            $payload = $response->json() ?: [];
            if (! $response->successful()) {
                Log::warning('parent_job.complete.charge_refetch_failed', [
                    'charge_id' => $chargeId,
                    'status' => $response->status(),
                    'stripe_payload' => $payload,
                ]);
                return null;
            }

            return is_array($payload) ? $payload : null;
        } catch (\Throwable $e) {
            Log::warning('parent_job.complete.charge_refetch_exception', [
                'charge_id' => $chargeId,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    private function centsToAmount(int $amountInCents): float
    {
        return round($amountInCents / 100, 2);
    }

    private function resolveCompletionAmount(ParentJob $job): float
    {
        $price = $job->price !== null ? (float) $job->price : 0.0;
        if ($price > 0) {
            return round($price, 2);
        }

        $hours = $job->hours !== null ? (float) $job->hours : 0.0;
        $hourlyRate = $job->hourly_rate !== null ? (float) $job->hourly_rate : 0.0;
        $calculated = $hours * $hourlyRate;
        return $calculated > 0 ? round($calculated, 2) : 0.0;
    }

    private function normalizeTime(string $input): ?string
    {
        $raw = trim($input);
        if ($raw === '') {
            return null;
        }

        $formats = ['H:i:s', 'H:i', 'h:i A', 'h:iA', 'g:i A', 'g:iA'];
        foreach ($formats as $format) {
            try {
                $parsed = Carbon::createFromFormat($format, $raw, config('app.timezone'));
                if ($parsed) {
                    return $parsed->format('H:i:s');
                }
            } catch (\Throwable) {
                // Try next format.
            }
        }

        return null;
    }

    private function calculateExtraHoursFromEndTime(string $currentEndTime, string $requestedEndTime): ?float
    {
        try {
            $start = Carbon::createFromFormat('H:i:s', $currentEndTime, config('app.timezone'));
            $end = Carbon::createFromFormat('H:i:s', $requestedEndTime, config('app.timezone'));
        } catch (\Throwable) {
            return null;
        }

        $minutes = $start->diffInMinutes($end, false);
        if ($minutes <= 0 || $minutes > 720) {
            return null;
        }

        return round($minutes / 60, 2);
    }

    private function addHoursToTime(?string $baseTime, float $hours): ?string
    {
        if (! $baseTime) {
            return null;
        }

        try {
            $time = Carbon::createFromFormat('H:i:s', $baseTime, config('app.timezone'));
        } catch (\Throwable) {
            return null;
        }

        return $time->copy()->addMinutes((int) round($hours * 60))->format('H:i:s');
    }

    private function formatNotificationTime(?string $time): string
    {
        $normalized = $time ? $this->normalizeTime($time) : null;
        if (! $normalized) {
            return 'N/A';
        }

        try {
            return Carbon::createFromFormat('H:i:s', $normalized, config('app.timezone'))->format('g:i A');
        } catch (\Throwable) {
            return 'N/A';
        }
    }

    private function resolveVerifiedLocation(string $location, mixed $latitude, mixed $longitude): array
    {
        $location = trim($location);
        if ($location === '') {
            return ['ok' => false, 'message' => 'Location is required.'];
        }

        $lat = is_numeric($latitude) ? (float) $latitude : null;
        $lng = is_numeric($longitude) ? (float) $longitude : null;
        $hasCoords = $lat !== null && $lng !== null && $lat >= -90 && $lat <= 90 && $lng >= -180 && $lng <= 180;

        $apiKey = trim((string) config('services.google_maps.key'));
        if ($apiKey === '') {
            Log::warning('location.verification.missing_key');
            if ($hasCoords) {
                return [
                    'ok' => true,
                    'location' => $location,
                    'latitude' => round($lat, 7),
                    'longitude' => round($lng, 7),
                ];
            }
            return [
                'ok' => false,
                'message' => 'Location verification is unavailable. Please contact support.',
            ];
        }

        try {
            $query = $hasCoords
                ? ['latlng' => $lat.','.$lng, 'key' => $apiKey]
                : ['address' => $location, 'key' => $apiKey];

            $response = Http::timeout(8)
                ->acceptJson()
                ->get('https://maps.googleapis.com/maps/api/geocode/json', $query);

            if (! $response->ok()) {
                Log::warning('location.verification.http_failed', ['status' => $response->status()]);
                return ['ok' => false, 'message' => 'Unable to verify location. Please try again.'];
            }

            $payload = $response->json();
            $status = strtoupper(trim((string) ($payload['status'] ?? '')));
            $result = is_array($payload['results'] ?? null) ? ($payload['results'][0] ?? null) : null;
            $resolvedLat = isset($result['geometry']['location']['lat']) ? (float) $result['geometry']['location']['lat'] : null;
            $resolvedLng = isset($result['geometry']['location']['lng']) ? (float) $result['geometry']['location']['lng'] : null;
            $formattedAddress = trim((string) ($result['formatted_address'] ?? ''));

            if ($status !== 'OK' || ! is_array($result) || $formattedAddress === '' || $resolvedLat === null || $resolvedLng === null) {
                return [
                    'ok' => false,
                    'message' => 'Please select a valid address from location suggestions.',
                ];
            }

            return [
                'ok' => true,
                'location' => $formattedAddress,
                'latitude' => round($resolvedLat, 7),
                'longitude' => round($resolvedLng, 7),
            ];
        } catch (\Throwable $e) {
            Log::warning('location.verification.exception', ['error' => $e->getMessage()]);
            return ['ok' => false, 'message' => 'Unable to verify location. Please try again.'];
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

    private function nonRejectableApplicationStatuses(): array
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

    private function isParentInitiatedHireRequestApplication(ParentJobApplication $application): bool
    {
        $source = strtolower(trim((string) ($application->request_source ?? '')));
        if ($source === 'hire_request' || $source === 'hire-request') {
            return true;
        }

        $status = strtolower(trim((string) ($application->status ?? '')));
        if ($status === 'hire_requested' || $status === 'hire-requested') {
            return true;
        }

        $message = strtolower(trim((string) ($application->message ?? '')));
        if ($message !== '' && str_contains($message, 'source:hire_now')) {
            return true;
        }

        return UserNotification::query()
            ->where('type', 'hire_request')
            ->where(function ($query) use ($application) {
                $query
                    ->where('data->application_id', $application->id)
                    ->orWhere('data->application->id', $application->id)
                    ->orWhere('data->application->application_id', $application->id);
            })
            ->exists();
    }

    private function isPendingParentInitiatedHireRequestApplication(ParentJobApplication $application): bool
    {
        if (! $this->isParentInitiatedHireRequestApplication($application)) {
            return false;
        }

        $status = strtolower(trim((string) ($application->status ?? '')));

        return $status === 'hire_requested' || $status === 'hire-requested';
    }

    private function deriveParentHireRequestDisplayStatus($applications, ?string $jobStatus = null): ?string
    {
        $normalizedJobStatus = strtolower(trim((string) ($jobStatus ?? '')));

        if (in_array($normalizedJobStatus, ['completed', 'complete', 'done', 'closed'], true)) {
            return $normalizedJobStatus;
        }

        if (in_array($normalizedJobStatus, ['cancelled', 'canceled', 'expired', 'withdrawn'], true)) {
            return $normalizedJobStatus;
        }

        if ($this->isAcceptedStatus($normalizedJobStatus)) {
            return 'accepted';
        }

        $hireRequestApplications = collect($applications)
            ->filter(fn (ParentJobApplication $application) => $this->isParentInitiatedHireRequestApplication($application))
            ->values();

        if ($hireRequestApplications->isEmpty()) {
            return null;
        }

        $statuses = $hireRequestApplications
            ->map(static fn (ParentJobApplication $application) => strtolower(trim((string) ($application->status ?? ''))))
            ->filter()
            ->values();

        if ($statuses->contains(fn (string $status) => in_array($status, ['completed', 'complete', 'done', 'closed'], true))) {
            return 'completed';
        }

        if ($statuses->contains(fn (string $status) => in_array($status, ['cancelled', 'canceled', 'expired', 'withdrawn'], true))) {
            return 'canceled';
        }

        if ($statuses->contains(fn (string $status) => $this->isAcceptedStatus($status))) {
            return 'accepted';
        }

        if ($statuses->contains(fn (string $status) => in_array($status, ['rejected', 'reject', 'declined', 'decline'], true))) {
            return 'rejected';
        }

        return 'decision_pending';
    }

    private function formatJob(ParentJob $job, ?string $viewerNannyId = null): array
    {
        $kidIds = collect($job->kid_ids ?? [])
            ->map(static fn ($id) => (int) $id)
            ->filter(static fn ($id) => $id > 0)
            ->values();

        $kids = [];
        if ($kidIds->count() > 0) {
            $kids = ParentKid::query()
                ->where('parent_profile_id', $job->user_id)
                ->whereIn('id', $kidIds->all())
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

        $parent = User::query()->where('user_id', $job->user_id)->first();
        $profile = ParentProfile::query()->where('user_id', $job->user_id)->first();
        $parentStats = $this->buildParentRatingStats($job->user_id);
        $name = trim((string) ($parent?->name ?? ''));
        $nameParts = $name !== '' ? preg_split('/\s+/', $name) : [];
        $firstName = $nameParts[0] ?? null;
        $lastName = count($nameParts) > 1 ? implode(' ', array_slice($nameParts, 1)) : null;

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
            static fn (ParentJobApplication $application) => strtolower(trim((string) ($application->request_source ?? ''))) === 'hire_request'
        )
            ? 'hire_request'
            : ($applications->contains(
                static fn (ParentJobApplication $application) => strtolower(trim((string) ($application->request_source ?? ''))) === 'job_post'
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
            ->filter(static fn (ParentJobApplication $application) => $nannyUsers->has($application->nanny_id))
            ->values();
        $nannyReliability = $nannyPublicIds->count() > 0
            ? ParentJobApplication::query()
                ->selectRaw('nanny_id, COUNT(*) as total_applications, SUM(CASE WHEN nanny_canceled_at IS NOT NULL THEN 1 ELSE 0 END) as total_cancellations, SUM(CASE WHEN nanny_canceled_within_24h = 1 THEN 1 ELSE 0 END) as late_cancellations, SUM(COALESCE(nanny_reliability_penalty, 0)) as reliability_penalty')
                ->whereIn('nanny_id', $nannyPublicIds->all())
                ->groupBy('nanny_id')
                ->get()
                ->keyBy('nanny_id')
            : collect();
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
        $buildNannyPayload = static function (?string $nannyPublicId) use ($nannyUsers, $nannyProfiles, $nannyReliability): array {
            $publicId = trim((string) ($nannyPublicId ?? ''));
            if ($publicId === '') {
                return [];
            }

            $nannyUser = $nannyUsers->get($publicId);
            $nannyProfile = $nannyUser ? $nannyProfiles->get($nannyUser->id) : null;
            $nannyName = trim((string) ($nannyUser?->name ?? ''));
            $reliability = $nannyReliability->get($publicId);
            $totalApplications = (int) ($reliability?->total_applications ?? 0);
            $totalCancellations = (int) ($reliability?->total_cancellations ?? 0);
            $lateCancellations = (int) ($reliability?->late_cancellations ?? 0);
            $penalty = (int) ($reliability?->reliability_penalty ?? 0);

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
                'profile_image' => $nannyProfile?->user_image_url ?: $nannyProfile?->user_image,
                'user_image' => $nannyProfile?->user_image,
                'user_image_url' => $nannyProfile?->user_image_url,
                'reliability' => [
                    'total_applications' => $totalApplications,
                    'total_cancellations' => $totalCancellations,
                    'late_cancellations_within_24h' => $lateCancellations,
                    'reliability_penalty' => $penalty,
                ],
            ];
        };
        $serializedApplications = $applications->map(
            static fn (ParentJobApplication $application) => [
                'id' => $application->id,
                'application_id' => $application->id,
                'job_id' => $application->job_id,
                'nanny_id' => $application->nanny_id,
                'status' => $application->status,
                'request_source' => $application->request_source,
                'parent_rating' => $application->parent_rating,
                'parent_review' => $application->parent_review,
                'parent_rated_at' => optional($application->parent_rated_at)->toISOString(),
                'nanny_rating' => $application->nanny_rating,
                'nanny_review' => $application->nanny_review,
                'nanny_rated_at' => optional($application->nanny_rated_at)->toISOString(),
                'nanny_canceled_at' => optional($application->nanny_canceled_at)->toISOString(),
                'nanny_canceled_within_24h' => (bool) ($application->nanny_canceled_within_24h ?? false),
                'nanny_reliability_penalty' => (int) ($application->nanny_reliability_penalty ?? 0),
                'created_at' => optional($application->created_at)->toDateTimeString(),
                'updated_at' => optional($application->updated_at)->toDateTimeString(),
                'nanny' => $buildNannyPayload((string) $application->nanny_id),
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
        $parentDisplayStatus = $viewerNannyId
            ? null
            : $this->deriveParentHireRequestDisplayStatus($applications, (string) ($job->status ?: 'pending'));

        return [
            'id' => $job->id,
            'job_id' => $job->id,
            'user_id' => $job->user_id,
            'kid_ids' => $kidIds->all(),
            'kid_names' => (string) ($job->kid_names ?? ''),
            'kids' => $kids,
            'hours' => $job->hours !== null ? (float) $job->hours : null,
            'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
            'price' => $job->price !== null ? (float) $job->price : null,
            'total_price' => $job->price !== null ? (float) $job->price : null,
            'start_date' => $job->start_date ? $job->start_date->format('Y-m-d') : null,
            'end_date' => $job->end_date ? $job->end_date->format('Y-m-d') : null,
            'start_time' => (string) $job->start_time,
            'end_time' => (string) ($job->end_time ?? ''),
            'location' => (string) ($job->location ?? ''),
            'latitude' => $job->latitude !== null ? (float) $job->latitude : null,
            'longitude' => $job->longitude !== null ? (float) $job->longitude : null,
            'status' => (string) ($job->status ?: 'pending'),
            'job_status' => (string) ($job->status ?: 'pending'),
            'late_cancellation_fee' => $job->late_cancellation_fee !== null ? (float) $job->late_cancellation_fee : null,
            'late_cancellation_fee_charged_at' => optional($job->late_cancellation_fee_charged_at)->toISOString(),
            'request_source' => $jobRequestSource,
            'application_status' => $viewerApplicationStatus,
            'my_application_status' => $viewerApplicationStatus,
            'parent_display_status' => $parentDisplayStatus,
            'parent_name' => $name ?: null,
            'parent_firstname' => $firstName,
            'parent_lastname' => $lastName,
            'parent_image' => $profile?->user_image,
            'parent_image_url' => $profile?->user_image_url,
            'parent_profile_image' => $profile?->user_image_url ?: $profile?->user_image,
            'parent_city' => $profile?->city,
            'parent_country' => $profile?->country,
            'parent_average_rating' => $parentStats['average_rating'],
            'parent_jobs_posted_count' => $parentStats['jobs_posted_count'],
            // Keep parent_ratings_count as unique raters count for UI wording.
            'parent_ratings_count' => $parentStats['raters_count'],
            'parent_raters_count' => $parentStats['raters_count'],
            'parent_total_ratings_count' => $parentStats['ratings_count'],
            'applications' => $serializedApplications,
            'nannies' => $nannies,
            'has_applied' => $viewerApplication !== null,
            'has_pending_application' => $hasPendingApplication,
            'application_count' => $applications->count(),
            'created_at' => optional($job->created_at)->toIso8601String(),
            'updated_at' => optional($job->updated_at)->toIso8601String(),
        ];
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

    private function resolveAuthenticatedUserId(Request $request): ?string
    {
        $candidates = [
            $request->bearerToken(),
            $request->header('x-access-token'),
            $request->input('api_token'),
            $request->query('api_token'),
        ];

        foreach ($candidates as $candidate) {
            $resolved = User::resolvePublicUserIdByApiToken((string) $candidate);
            if ($resolved) {
                return $resolved;
            }
        }

        return null;
    }

    private function formatMoneyLabel(float $amount, string $currency = 'usd'): string
    {
        $normalizedCurrency = strtolower(trim($currency)) ?: 'usd';
        $prefix = match ($normalizedCurrency) {
            'eur' => 'EUR ',
            'gbp' => 'GBP ',
            default => '$',
        };

        return $prefix.number_format($amount, 2, '.', '');
    }
}
