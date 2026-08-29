<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Models\AppData\ParentJob;
use App\Models\AppData\ParentKid;
use App\Support\AdminRemoteApiClient;
use App\Support\AppDataApiClient;
use App\Support\AppDataHelper;
use App\Support\AdminAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;

class AdminParentController extends Controller
{
    public function index(): JsonResponse
    {
        if (! AppDataHelper::canReachAppDataDatabase()) {
            $remote = AdminRemoteApiClient::get('/api/admin/users');
            if (is_array($remote) && isset($remote['data'])) {
                return response()->json([
                    'data' => $remote['data'],
                    'source' => 'remote_admin',
                ]);
            }

            return response()->json([
                'data' => $this->fallbackParents(),
                'source' => 'app_api',
            ]);
        }

        if (! AppDataHelper::hasTable('users')) {
            return response()->json([
                'data' => [],
            ]);
        }

        $jobCounts = $this->jobCounts();
        $parents = AppUser::query()
            ->parents()
            ->with('parentProfile')
            ->latest('id')
            ->get();

        $parentProfileIds = $parents
            ->map(fn (AppUser $user) => $user->parentProfile?->user_id)
            ->filter()
            ->values();

        $kidsByParent = AppDataHelper::hasTable('parent_kids')
            ? ParentKid::query()
                ->whereIn('parent_profile_id', $parentProfileIds->all())
                ->get()
                ->groupBy('parent_profile_id')
            : collect();

        $rows = $parents->flatMap(function (AppUser $user) use ($kidsByParent, $jobCounts) {
            $profile = $user->parentProfile;
            $publicId = strtoupper((string) ($user->user_id ?? ''));
            $kids = $profile ? ($kidsByParent->get($profile->user_id) ?? collect()) : collect();
            $kidsCount = $kids->count();

            if ($kids->isEmpty()) {
                return [$this->serializeParentRow($user, null, $kidsCount, $jobCounts->get($publicId, 0))];
            }

            return $kids->map(fn (ParentKid $kid) => $this->serializeParentRow(
                $user,
                $kid,
                $kidsCount,
                $jobCounts->get($publicId, 0)
            ));
        })->values()->all();

        return response()->json([
            'data' => $rows,
        ]);
    }

    private function fallbackParents(): array
    {
        return collect(AppDataApiClient::parents())
            ->map(function (array $profile, int $index): array {
                $user = is_array($profile['user'] ?? null) ? $profile['user'] : [];
                $publicId = (string) ($user['user_id'] ?? $profile['user_id'] ?? $profile['id'] ?? $index + 1);

                return [
                    'id' => $publicId,
                    'user_id' => $publicId,
                    'name' => $user['name'] ?? $profile['name'] ?? '-',
                    'email' => $user['email'] ?? $profile['email'] ?? '-',
                    'status' => $this->fallbackParentStatus(
                        $user['profile_status'] ?? $profile['profile_status'] ?? null,
                        (bool) ($user['is_blacklisted'] ?? false),
                        $user['deactivated_at'] ?? null,
                    ),
                    'phone' => $profile['phone'] ?? null,
                    'city' => $profile['city'] ?? null,
                    'country' => $profile['country'] ?? null,
                    'gender' => $profile['gender'] ?? null,
                    'about_me' => $profile['bio'] ?? null,
                    'number_of_kids' => $profile['children_count'] ?? 0,
                    'kids_count' => $profile['children_count'] ?? 0,
                    'bookings' => $user['jobs_posted_count'] ?? $profile['jobs_posted_count'] ?? 0,
                    'total_jobs' => $user['jobs_posted_count'] ?? $profile['jobs_posted_count'] ?? 0,
                    'profile_image' => $profile['user_image'] ?? null,
                    'profile_image_url' => $profile['user_image_url'] ?? null,
                    'kid_id' => null,
                    'kid_name' => null,
                    'kid_age' => null,
                    'kid_gender' => null,
                    'allergies' => null,
                    'medical_conditions' => null,
                    'notes' => null,
                    'created_at' => $user['created_at'] ?? $profile['created_at'] ?? null,
                    'updated_at' => $user['updated_at'] ?? $profile['updated_at'] ?? null,
                ];
            })
            ->values()
            ->all();
    }

    private function fallbackParentStatus(mixed $value, bool $isBlacklisted, mixed $deactivatedAt): string
    {
        if ($deactivatedAt) {
            return 'Deactivated';
        }

        if ($isBlacklisted) {
            return 'Blacklisted';
        }

        $raw = strtolower(trim((string) ($value ?? '')));
        if ($raw === '') {
            return 'Unverified';
        }

        if (
            str_contains($raw, 'verified') ||
            str_contains($raw, 'approv') ||
            str_contains($raw, 'active') ||
            str_contains($raw, 'complete') ||
            str_contains($raw, 'clear')
        ) {
            return 'Verified';
        }

        if (str_contains($raw, 'blacklist') || str_contains($raw, 'reject')) {
            return 'Blacklisted';
        }

        return 'Unverified';
    }

    public function updateProfileStatus(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['required'],
            'status' => ['required', 'string'],
        ]);

        if (! AppDataHelper::canReachAppDataDatabase()) {
            return $this->forwardProfileStatusUpdateToRemoteAdmin($data);
        }

        $user = AppUser::resolveByIdentifier($data['user_id']);
        if (! $user || $user->role !== 'parent') {
            return response()->json([
                'message' => 'Parent not found.',
            ], 404);
        }

        $statusPayload = AppDataHelper::normalizeParentUpdate($data['status']);
        $before = [
            'profile_status' => $user->profile_status,
            'is_blacklisted' => (bool) $user->is_blacklisted,
            'blacklisted_reason' => $user->blacklisted_reason,
            'display_status' => AppDataHelper::parentStatusLabel($user),
        ];
        $user->forceFill([
            ...$statusPayload,
            'profile_status_updated_at' => now(),
        ])->save();

        $freshUser = $user->fresh();
        AdminAuditLogger::log([
            'category' => strtolower((string) $data['status']) === 'blacklisted' ? 'blacklist' : 'verification',
            'action' => 'updated parent status',
            'target_type' => 'parent',
            'target_id' => (string) ($freshUser?->user_id ?: $freshUser?->id ?: ''),
            'target_label' => $freshUser?->name ?: 'Parent',
            'before' => $before,
            'after' => [
                'profile_status' => $freshUser?->profile_status,
                'is_blacklisted' => (bool) $freshUser?->is_blacklisted,
                'blacklisted_reason' => $freshUser?->blacklisted_reason,
                'display_status' => AppDataHelper::parentStatusLabel($freshUser),
            ],
            'meta' => [
                'requested_status' => $data['status'],
                'role' => 'parent',
            ],
        ], $request);

        return response()->json([
            'message' => 'Profile status updated.',
            'data' => [
                'status' => AppDataHelper::parentStatusLabel($freshUser),
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
                ->post($baseUrl.'/api/admin/parents/profile-status', [
                    'user_id' => $data['user_id'],
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

    private function serializeParentRow(AppUser $user, ?ParentKid $kid, int $kidsCount, int $jobCount): array
    {
        $profile = $user->parentProfile;
        $location = $this->splitLocation($profile?->city, $profile?->address);

        return [
            'id' => $user->id,
            'user_id' => $user->user_id,
            'name' => $user->name,
            'email' => $user->email,
            'status' => AppDataHelper::parentStatusLabel($user),
            'phone' => $profile?->phone,
            'city' => $location['city'],
            'country' => $location['country'],
            'gender' => $profile?->gender,
            'about_me' => $profile?->bio,
            'number_of_kids' => $kidsCount,
            'kids_count' => $kidsCount,
            'bookings' => $jobCount,
            'total_jobs' => $jobCount,
            'profile_image' => $profile?->user_image,
            'profile_image_url' => AppDataHelper::assetUrl($profile?->user_image),
            'kid_id' => $kid?->id,
            'kid_name' => $kid?->name,
            'kid_age' => $kid?->age,
            'kid_gender' => $kid?->gender,
            'allergies' => $kid?->allergies,
            'medical_conditions' => $kid?->medical_conditions,
            'notes' => $kid?->notes,
            'created_at' => optional($user->created_at)->toISOString(),
            'updated_at' => optional($user->updated_at)->toISOString(),
        ];
    }

    private function splitLocation(?string ...$values): array
    {
        foreach ($values as $value) {
            $text = trim((string) $value);
            if ($text === '') {
                continue;
            }

            $parts = array_values(array_filter(
                array_map('trim', explode(',', $text)),
                fn (string $part): bool => $part !== ''
            ));

            if (count($parts) >= 2) {
                $country = array_pop($parts);

                return [
                    'city' => implode(', ', $parts),
                    'country' => $country,
                ];
            }

            return [
                'city' => $text,
                'country' => null,
            ];
        }

        return [
            'city' => null,
            'country' => null,
        ];
    }

    private function jobCounts(): Collection
    {
        if (! AppDataHelper::hasTable('parent_jobs')) {
            return collect();
        }

        return ParentJob::query()
            ->selectRaw('user_id, COUNT(*) as total_jobs')
            ->groupBy('user_id')
            ->get()
            ->mapWithKeys(fn (ParentJob $job): array => [
                strtoupper((string) $job->user_id) => (int) ($job->total_jobs ?? 0),
            ]);
    }
}
