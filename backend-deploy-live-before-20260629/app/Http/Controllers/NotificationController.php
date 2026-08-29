<?php

namespace App\Http\Controllers;

use App\Events\UserNotificationCreated;
use App\Models\ParentJob;
use App\Models\ParentJobApplication;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\ExpoPushService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class NotificationController extends Controller
{
    public function jobRequests(Request $request): JsonResponse
    {
        $userId = $this->resolveUserId($request, $request->query('user_id'));
        if (! $userId) {
            return response()->json(['data' => []]);
        }

        $this->maybeRunActiveReminderScheduler($userId, 'job_requests');

        $items = UserNotification::query()
            ->where('recipient_user_id', $userId)
            ->where(function ($query) {
                $query
                    ->whereIn('type', ['job_request', 'job_application', 'new_job_request', 'new_application'])
                    ->orWhere('title', 'like', '%job request%')
                    ->orWhere('title', 'like', '%booking request%')
                    ->orWhere('title', 'like', '%new application%')
                    ->orWhere('message', 'like', '%job request%')
                    ->orWhere('message', 'like', '%booking request%')
                    ->orWhere('message', 'like', '%new application%')
                    ->orWhere('message', 'like', '%applied for your job%')
                    ->orWhere('message', 'like', '%request from syttr%');
            })
            ->latest()
            ->get()
            ->map(fn (UserNotification $notification) => $this->serialize($notification));

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    public function index(Request $request): JsonResponse
    {
        $userId = $this->resolveUserId($request, $request->query('user_id'));
        if (! $userId) {
            return response()->json(['data' => []]);
        }

        $this->maybeRunActiveReminderScheduler($userId, 'notifications_index');

        $items = UserNotification::query()
            ->where('recipient_user_id', $userId)
            ->whereNotIn('type', ['chat_message', 'chat'])
            ->where(function ($query) {
                $query
                    ->whereNotIn('type', ['job_request', 'job_application', 'new_job_request', 'new_application', 'hire_request'])
                    ->where('title', 'not like', '%job request%')
                    ->where('title', 'not like', '%booking request%')
                    ->where('title', 'not like', '%new application%')
                    ->where('message', 'not like', '%job request%')
                    ->where('message', 'not like', '%booking request%')
                    ->where('message', 'not like', '%new application%')
                    ->where('message', 'not like', '%applied for your job%')
                    ->where('message', 'not like', '%request from syttr%');
            })
            ->latest()
            ->get()
            ->map(fn (UserNotification $notification) => $this->serialize($notification));

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    public function nannyIndex(Request $request): JsonResponse
    {
        $nannyId = $this->resolveUserId(
            $request,
            $request->query('nanny_id', $request->query('user_id'))
        );
        if (! $nannyId) {
            return response()->json(['data' => []]);
        }
        if ($this->isBlacklistedUserId($nannyId)) {
            return response()->json([
                'success' => true,
                'status' => 'blacklisted',
                'data' => [],
            ]);
        }

        $this->maybeRunActiveReminderScheduler($nannyId, 'nanny_notifications_index');

        $items = UserNotification::query()
            ->where('recipient_user_id', $nannyId)
            ->whereNotIn('type', ['chat_message', 'chat'])
            ->latest()
            ->get()
            ->map(fn (UserNotification $notification) => $this->serialize($notification))
            ->filter(function (array $row): bool {
                $type = strtolower(trim((string) ($row['type'] ?? '')));
                if ($type !== 'hire_request') {
                    return true;
                }

                $data = is_array($row['data'] ?? null) ? $row['data'] : [];
                $application = is_array($data['application'] ?? null) ? $data['application'] : [];
                $status = strtolower(trim((string) (
                    $data['application_status'] ??
                    $data['request_status'] ??
                    $data['status'] ??
                    $application['status'] ??
                    ''
                )));

                return ! in_array($status, [
                    'accepted',
                    'accept',
                    'approved',
                    'confirmed',
                    'confirm',
                    'rejected',
                    'reject',
                    'declined',
                    'decline',
                    'canceled',
                    'cancelled',
                    'completed',
                    'closed',
                    'expired',
                    'withdrawn',
                ], true);
            })
            ->values();

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    public function nannyHireRequests(Request $request): JsonResponse
    {
        $nannyId = $this->resolveUserId(
            $request,
            $request->query('nanny_id', $request->query('user_id'))
        );
        if (! $nannyId) {
            return response()->json([
                'success' => true,
                'data' => [],
            ]);
        }
        if ($this->isBlacklistedUserId($nannyId)) {
            return response()->json([
                'success' => true,
                'status' => 'blacklisted',
                'data' => [],
            ]);
        }

        $this->maybeRunActiveReminderScheduler($nannyId, 'nanny_hire_requests');

        $notifications = UserNotification::query()
            ->where('recipient_user_id', $nannyId)
            ->where('type', 'hire_request')
            ->latest()
            ->get();

        $applicationIds = $notifications
            ->map(function (UserNotification $notification) {
                $data = is_array($notification->data) ? $notification->data : [];
                $application = is_array($data['application'] ?? null) ? $data['application'] : [];
                $value = $data['application_id'] ?? $application['application_id'] ?? $application['id'] ?? null;
                if ($value === null || $value === '') {
                    return null;
                }
                if (is_numeric((string) $value)) {
                    return (int) $value;
                }

                return null;
            })
            ->filter()
            ->unique()
            ->values()
            ->all();

        $visibleApplicationIds = count($applicationIds) > 0
            ? ParentJobApplication::query()
                ->visibleOnPlatform()
                ->whereIn('id', $applicationIds)
                ->pluck('id')
                ->mapWithKeys(static fn ($id): array => [(int) $id => true])
            : collect();

        $applicationStatuses = count($applicationIds) > 0
            ? ParentJobApplication::query()
                ->visibleOnPlatform()
                ->whereIn('id', $applicationIds)
                ->pluck('status', 'id')
            : collect();

        $rows = $notifications
            ->map(function (UserNotification $notification) use ($applicationStatuses): array {
                $data = is_array($notification->data) ? $notification->data : [];
                $job = is_array($data['job'] ?? null) ? $data['job'] : [];
                $parent = is_array($data['parent'] ?? null) ? $data['parent'] : [];
                $parentUserId = User::resolvePublicUserIdByIdentifier(
                    $data['parent_user_id'] ?? $parent['user_id'] ?? $job['user_id'] ?? null
                );
                $parentStats = $this->buildParentRatingStats($parentUserId);
                $kids = is_array($data['kids'] ?? null)
                    ? $data['kids']
                    : (is_array($job['kids'] ?? null) ? $job['kids'] : []);
                $application = is_array($data['application'] ?? null) ? $data['application'] : [];
                $applicationId = $data['application_id'] ?? $application['application_id'] ?? $application['id'] ?? null;
                $numericApplicationId = is_numeric((string) $applicationId) ? (int) $applicationId : null;
                $statusFromDb = $numericApplicationId ? $applicationStatuses->get($numericApplicationId) : null;
                $status = strtolower(trim((string) (
                    $statusFromDb ??
                    $application['status'] ??
                    $data['request_status'] ??
                    $data['status'] ??
                    'pending'
                )));

                return [
                    'id' => $notification->id,
                    'notification_id' => $notification->id,
                    'type' => 'hire_request',
                    'title' => $notification->title,
                    'message' => $notification->message,
                    'status' => $status !== '' ? $status : 'pending',
                    'request_status' => $status !== '' ? $status : 'pending',
                    'application_status' => $status !== '' ? $status : 'pending',
                    'application_id' => $applicationId,
                    'job_id' => $data['job_id'] ?? $job['job_id'] ?? $job['id'] ?? null,
                    'job' => array_merge($job, [
                        'parent_average_rating' => $job['parent_average_rating'] ?? $parentStats['average_rating'],
                        'parent_jobs_posted_count' => $job['parent_jobs_posted_count'] ?? $parentStats['jobs_posted_count'],
                        'parent_ratings_count' => $job['parent_ratings_count'] ?? $parentStats['raters_count'],
                        'parent_raters_count' => $job['parent_raters_count'] ?? $parentStats['raters_count'],
                        'parent_total_ratings_count' => $job['parent_total_ratings_count'] ?? $parentStats['ratings_count'],
                    ]),
                    'parent' => array_merge($parent, [
                        'user_id' => $parent['user_id'] ?? $parentUserId,
                        'average_rating' => $parent['average_rating'] ?? $parentStats['average_rating'],
                        'parent_average_rating' => $parent['parent_average_rating'] ?? $parentStats['average_rating'],
                        'jobs_posted_count' => $parent['jobs_posted_count'] ?? $parentStats['jobs_posted_count'],
                        'parent_jobs_posted_count' => $parent['parent_jobs_posted_count'] ?? $parentStats['jobs_posted_count'],
                        'ratings_count' => $parent['ratings_count'] ?? $parentStats['raters_count'],
                        'raters_count' => $parent['raters_count'] ?? $parentStats['raters_count'],
                        'parent_raters_count' => $parent['parent_raters_count'] ?? $parentStats['raters_count'],
                        'total_ratings_count' => $parent['total_ratings_count'] ?? $parentStats['ratings_count'],
                        'parent_total_ratings_count' => $parent['parent_total_ratings_count'] ?? $parentStats['ratings_count'],
                    ]),
                    'kids' => $kids,
                    'application' => $application,
                    'is_read' => $notification->is_read ? 1 : 0,
                    'created_at' => optional($notification->created_at)->toISOString(),
                    'updated_at' => optional($notification->updated_at)->toISOString(),
                ];
            })
            ->filter(function (array $row) use ($visibleApplicationIds): bool {
                $applicationId = $row['application_id'] ?? null;
                if (is_numeric((string) $applicationId) && ! $visibleApplicationIds->has((int) $applicationId)) {
                    return false;
                }

                $status = strtolower(trim((string) ($row['status'] ?? '')));
                if (in_array($status, ['accepted', 'approved', 'confirmed', 'rejected', 'declined', 'canceled', 'cancelled', 'completed', 'closed', 'expired', 'withdrawn'], true)) {
                    return false;
                }

                return ! empty($row['job_id']) || ! empty($row['job']['id'] ?? null) || ! empty($row['job']['job_id'] ?? null);
            })
            ->values()
            ->all();

        return response()->json([
            'success' => true,
            'data' => $rows,
        ]);
    }

    public function destroy(Request $request, string|int $id): JsonResponse
    {
        $userId = $this->resolveUserId($request, $request->input('user_id'));

        $query = UserNotification::query()->whereKey($id);
        if ($userId) {
            $query->where('recipient_user_id', $userId);
        }
        $item = $query->first();
        if (! $item) {
            return response()->json(['message' => 'Notification not found.'], 404);
        }
        $item->delete();

        return response()->json([
            'success' => true,
            'message' => 'Notification deleted.',
        ]);
    }

    public function open(Request $request, string|int $id): JsonResponse
    {
        return $this->markRead($request, $id);
    }

    public function markRead(Request $request, string|int $id): JsonResponse
    {
        $userId = $this->resolveUserId(
            $request,
            $request->input('user_id') ?: $request->input('nanny_id')
        );

        $query = UserNotification::query()->whereKey($id);
        if ($userId) {
            $query->where('recipient_user_id', $userId);
        }
        $item = $query->first();
        if (! $item) {
            return response()->json(['message' => 'Notification not found.'], 404);
        }

        $item->is_read = true;
        $item->opened_at = Carbon::now();
        $item->save();

        return response()->json([
            'success' => true,
            'data' => $this->serialize($item),
        ]);
    }

    public function markUnread(Request $request, string|int $id): JsonResponse
    {
        $userId = $this->resolveUserId(
            $request,
            $request->input('user_id') ?: $request->input('nanny_id')
        );

        $query = UserNotification::query()->whereKey($id);
        if ($userId) {
            $query->where('recipient_user_id', $userId);
        }
        $item = $query->first();
        if (! $item) {
            return response()->json(['message' => 'Notification not found.'], 404);
        }

        $item->is_read = false;
        $item->save();

        return response()->json([
            'success' => true,
            'data' => $this->serialize($item),
        ]);
    }

    public function markAllRead(Request $request): JsonResponse
    {
        $userId = $this->resolveUserId(
            $request,
            $request->input('user_id') ?: $request->input('nanny_id')
        );
        if (! $userId) {
            return response()->json(['success' => true, 'updated' => 0]);
        }

        $updated = UserNotification::query()
            ->where('recipient_user_id', $userId)
            ->where('is_read', false)
            ->update([
                'is_read' => true,
                'opened_at' => Carbon::now(),
            ]);

        return response()->json([
            'success' => true,
            'updated' => $updated,
        ]);
    }

    public function markAllUnread(Request $request): JsonResponse
    {
        $userId = $this->resolveUserId(
            $request,
            $request->input('user_id') ?: $request->input('nanny_id')
        );
        if (! $userId) {
            return response()->json(['success' => true, 'updated' => 0]);
        }

        $updated = UserNotification::query()
            ->where('recipient_user_id', $userId)
            ->where('is_read', true)
            ->update([
                'is_read' => false,
            ]);

        return response()->json([
            'success' => true,
            'updated' => $updated,
        ]);
    }

    public function heartbeat(Request $request): JsonResponse
    {
        $userId = $this->resolveUserId(
            $request,
            $request->input('user_id') ?: $request->input('nanny_id')
        );

        if (! $userId) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized.',
            ], 401);
        }

        $triggered = $this->maybeRunActiveReminderScheduler($userId, 'heartbeat');

        return response()->json([
            'success' => true,
            'triggered' => $triggered,
            'server_time' => now()->toIso8601String(),
        ]);
    }

    public static function createForUser(
        string $recipientUserId,
        string $type,
        string $title,
        string $message,
        ?array $data = null,
        ?string $senderUserId = null
    ): UserNotification {
        $notification = UserNotification::query()->create([
            'recipient_user_id' => strtoupper(trim($recipientUserId)),
            'sender_user_id' => $senderUserId ? strtoupper(trim($senderUserId)) : null,
            'type' => $type,
            'title' => $title,
            'message' => $message,
            'data' => $data,
            'is_read' => false,
        ]);

        try {
            broadcast(new UserNotificationCreated($notification))->toOthers();
        } catch (\Throwable $e) {
            Log::warning('notification.broadcast.failed', [
                'notification_id' => $notification->id,
                'recipient_user_id' => $notification->recipient_user_id,
                'type' => $notification->type,
                'error' => $e->getMessage(),
            ]);
        }

        try {
            ExpoPushService::sendToUser($notification->recipient_user_id, [
                'title' => $notification->title ?: config('app.name', 'Syttr'),
                'body' => $notification->message ?: 'You have a new notification.',
                'data' => [
                    'notification_id' => $notification->id,
                    'type' => $notification->type,
                    'recipient_user_id' => $notification->recipient_user_id,
                    'sender_user_id' => $notification->sender_user_id,
                    'in_app' => [
                        'title' => $notification->title,
                        'message' => $notification->message,
                        'data' => $notification->data,
                    ],
                ],
                'sound' => 'default',
                'priority' => 'high',
            ]);
        } catch (\Throwable $e) {
            Log::warning('notification.push.failed', [
                'notification_id' => $notification->id,
                'recipient_user_id' => $notification->recipient_user_id,
                'error' => $e->getMessage(),
            ]);
        }

        return $notification;
    }

    private function resolveUserId(Request $request, mixed $rawUserId = null): ?string
    {
        if ($rawUserId !== null && $rawUserId !== '') {
            return User::resolvePublicUserIdByIdentifier($rawUserId);
        }

        return User::resolvePublicUserIdByApiToken($request->bearerToken());
    }

    private function maybeRunActiveReminderScheduler(?string $userId, string $source): bool
    {
        $normalizedUserId = strtoupper(trim((string) ($userId ?? '')));
        if ($normalizedUserId === '') {
            return false;
        }

        $minuteKey = 'notifications:heartbeat:active-job-reminders:'.now()->format('Y-m-d-H-i');
        if (! Cache::add($minuteKey, true, now()->addSeconds(75))) {
            return false;
        }

        try {
            Artisan::call('jobs:send-active-completion-reminders');

            Log::info('notification.scheduler_kick.ran', [
                'user_id' => $normalizedUserId,
                'source' => $source,
            ]);

            return true;
        } catch (\Throwable $e) {
            Cache::forget($minuteKey);

            Log::warning('notification.scheduler_kick.failed', [
                'user_id' => $normalizedUserId,
                'source' => $source,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
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

    private function serialize(UserNotification $notification): array
    {
        $data = is_array($notification->data) ? $notification->data : [];
        $data = $this->enrichNotificationDataWithRequestSource($data);

        $row = [
            'id' => $notification->id,
            'title' => $notification->title,
            'message' => $notification->message,
            'type' => $notification->type,
            'is_read' => $notification->is_read ? 1 : 0,
            'isRead' => (bool) $notification->is_read,
            'created_at' => optional($notification->created_at)->toISOString(),
            'updated_at' => optional($notification->updated_at)->toISOString(),
            'data' => $data,
        ];

        return $this->normalizeSerializedNotification($row);
    }

    private function normalizeSerializedNotification(array $row): array
    {
        $type = strtolower(trim((string) ($row['type'] ?? '')));
        $data = is_array($row['data'] ?? null) ? $row['data'] : [];
        $requestSource = strtolower(trim((string) (
            $data['request_source'] ??
            $data['application']['request_source'] ??
            $data['job']['request_source'] ??
            ''
        )));

        if (
            ($requestSource === 'hire_request' || $requestSource === 'hire-request') &&
            $type === 'job_request_approved'
        ) {
            $row['type'] = 'hire_accepted';
            $row['title'] = 'Hire Request Accepted';
            $row['message'] = 'Your sitter has accepted the job request.';
        }

        return $row;
    }

    private function enrichNotificationDataWithRequestSource(array $data): array
    {
        $application = is_array($data['application'] ?? null) ? $data['application'] : [];
        $job = is_array($data['job'] ?? null) ? $data['job'] : [];
        $requestSource = strtolower(trim((string) (
            $data['request_source'] ??
            $application['request_source'] ??
            $job['request_source'] ??
            ''
        )));

        if ($requestSource === '') {
            $applicationId = $data['application_id'] ?? $application['application_id'] ?? $application['id'] ?? null;
            if ($applicationId !== null && $applicationId !== '' && is_numeric((string) $applicationId)) {
                $requestSource = strtolower(trim((string) (
                    ParentJobApplication::query()
                        ->whereKey((int) $applicationId)
                        ->value('request_source') ?? ''
                )));
            }
        }

        if ($requestSource !== '') {
            $data['request_source'] = $requestSource;
            if ($application !== []) {
                $application['request_source'] = $application['request_source'] ?? $requestSource;
                $data['application'] = $application;
            }
            if ($job !== []) {
                $job['request_source'] = $job['request_source'] ?? $requestSource;
                $data['job'] = $job;
            }
        }

        return $data;
    }

    private function buildParentRatingStats(?string $parentUserId): array
    {
        $publicId = strtoupper(trim((string) ($parentUserId ?? '')));
        if ($publicId === '') {
            return [
                'average_rating' => 0.0,
                'ratings_count' => 0,
                'raters_count' => 0,
                'jobs_posted_count' => 0,
            ];
        }

        $ratingsBase = ParentJobApplication::query()
            ->join('parent_jobs', 'parent_jobs.id', '=', 'parent_job_applications.job_id')
            ->where('parent_jobs.user_id', $publicId)
            ->whereNotNull('parent_job_applications.nanny_rating');

        $ratingsCount = (int) (clone $ratingsBase)->count('parent_job_applications.id');
        $ratersCount = (int) (clone $ratingsBase)
            ->selectRaw('COUNT(DISTINCT parent_job_applications.nanny_id) as aggregate')
            ->value('aggregate');
        $average = (clone $ratingsBase)->avg('parent_job_applications.nanny_rating');
        $jobsPostedCount = (int) ParentJob::query()
            ->where('user_id', $publicId)
            ->count('id');

        return [
            'average_rating' => $average !== null ? round((float) $average, 2) : 0.0,
            'ratings_count' => $ratingsCount,
            'raters_count' => $ratersCount,
            'jobs_posted_count' => $jobsPostedCount,
        ];
    }
}
