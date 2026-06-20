<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\AppUser;
use App\Models\AppData\ParentJob;
use App\Models\AppData\ParentKid;
use App\Support\AppDataHelper;
use App\Support\AdminAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

class AdminParentController extends Controller
{
    public function index(): JsonResponse
    {
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

    public function updateProfileStatus(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['required'],
            'status' => ['required', 'string'],
        ]);

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
