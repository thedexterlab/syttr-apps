<?php

namespace App\Http\Controllers;

use App\Models\ParentProfile;
use App\Models\ParentJob;
use App\Models\ParentJobApplication;
use App\Models\User;
use App\Support\GhlContactManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class ParentProfileController extends Controller
{
    public function index()
    {
        $userId = request()->query('user_id');
        $query = ParentProfile::query()
            ->with('user')
            ->whereHas('user', fn ($builder) => $builder->visibleOnPlatform());
        if ($userId) {
            $resolvedUserId = User::resolvePublicUserIdByIdentifier($userId);
            if (! $resolvedUserId) {
                return collect();
            }
            $query->where('user_id', $resolvedUserId);
        }
        return $query->latest()->get()->map(fn (ParentProfile $profile) => $this->transformProfile($profile));
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'user_id' => ['required'],
            'phone' => ['nullable', 'string', 'max:30'],
            'number' => ['nullable', 'string', 'max:30'],
            'city' => ['nullable', 'string', 'max:255'],
            'city_area' => ['nullable', 'string', 'max:255'],
            'address' => ['nullable', 'string', 'max:255'],
            'location' => ['nullable', 'string', 'max:255'],
            'country' => ['nullable', 'string', 'max:255'],
            'gender' => ['nullable', 'string', 'max:30'],
            'children_count' => ['nullable', 'integer', 'min:1', 'max:20'],
            'kids' => ['nullable', 'integer', 'min:1', 'max:20'],
            'bio' => ['nullable', 'string'],
            'about_me' => ['nullable', 'string'],
            'user_image' => ['nullable', 'string', 'max:255'],
            'user_image_base64' => ['nullable', 'string'],
        ]);

        $resolvedUserId = User::resolvePublicUserIdByIdentifier($data['user_id'] ?? null);
        if (! $resolvedUserId) {
            return response()->json([
                'message' => 'The selected user_id is invalid.',
                'errors' => [
                    'user_id' => ['The selected user_id is invalid.'],
                ],
            ], 422);
        }
        $data['user_id'] = $resolvedUserId;

        $profile = ParentProfile::firstOrNew(['user_id' => $data['user_id']]);

        if (array_key_exists('phone', $data) || array_key_exists('number', $data)) {
            $profile->phone = $data['phone'] ?? $data['number'] ?? $profile->phone;
        }
        if (array_key_exists('city', $data) || array_key_exists('city_area', $data)) {
            $profile->city = $data['city'] ?? $data['city_area'] ?? $profile->city;
        }
        if (array_key_exists('address', $data) || array_key_exists('location', $data)) {
            $profile->address = $data['address'] ?? $data['location'] ?? $profile->address;
        }
        if (array_key_exists('gender', $data)) {
            $profile->gender = $data['gender'] ?? $profile->gender;
        }
        if (array_key_exists('children_count', $data) || array_key_exists('kids', $data)) {
            $profile->children_count = $data['children_count'] ?? $data['kids'] ?? $profile->children_count;
        }
        if (array_key_exists('bio', $data) || array_key_exists('about_me', $data)) {
            $profile->bio = $data['bio'] ?? $data['about_me'] ?? $profile->bio;
        }
        if (array_key_exists('user_image_base64', $data) && filled($data['user_image_base64'])) {
            $profile->user_image = $this->storeImageFromBase64(
                (string) $data['user_image_base64'],
                $profile->user_image
            );
        } elseif (array_key_exists('user_image', $data)) {
            $profile->user_image = $data['user_image'] ?? $profile->user_image;
        }
        if (! $profile->exists && ! $profile->children_count) {
            $profile->children_count = 1;
        }

        $profile->save();
        $this->syncGhlContact($data['user_id'], $profile, $data);

        return response()->json($profile, $profile->wasRecentlyCreated ? 201 : 200);
    }

    public function show(ParentProfile $parentProfile)
    {
        $parentProfile->loadMissing('user');

        return $this->transformProfile($parentProfile);
    }

    public function update(Request $request, ParentProfile $parentProfile)
    {
        $data = $request->validate([
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'number' => ['sometimes', 'nullable', 'string', 'max:30'],
            'city' => ['sometimes', 'nullable', 'string', 'max:255'],
            'city_area' => ['sometimes', 'nullable', 'string', 'max:255'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'location' => ['sometimes', 'nullable', 'string', 'max:255'],
            'country' => ['sometimes', 'nullable', 'string', 'max:255'],
            'gender' => ['sometimes', 'nullable', 'string', 'max:30'],
            'children_count' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:20'],
            'kids' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:20'],
            'bio' => ['sometimes', 'nullable', 'string'],
            'about_me' => ['sometimes', 'nullable', 'string'],
            'user_image' => ['sometimes', 'nullable', 'string', 'max:255'],
            'user_image_base64' => ['sometimes', 'nullable', 'string'],
        ]);

        $updates = [];
        if (array_key_exists('phone', $data) || array_key_exists('number', $data)) {
            $updates['phone'] = $data['phone'] ?? $data['number'] ?? null;
        }
        if (array_key_exists('city', $data) || array_key_exists('city_area', $data)) {
            $updates['city'] = $data['city'] ?? $data['city_area'] ?? null;
        }
        if (array_key_exists('address', $data) || array_key_exists('location', $data)) {
            $updates['address'] = $data['address'] ?? $data['location'] ?? null;
        }
        if (array_key_exists('gender', $data)) {
            $updates['gender'] = $data['gender'] ?? null;
        }
        if (array_key_exists('children_count', $data) || array_key_exists('kids', $data)) {
            $updates['children_count'] = $data['children_count'] ?? $data['kids'] ?? null;
        }
        if (array_key_exists('bio', $data) || array_key_exists('about_me', $data)) {
            $updates['bio'] = $data['bio'] ?? $data['about_me'] ?? null;
        }
        if (array_key_exists('user_image_base64', $data) && filled($data['user_image_base64'])) {
            $updates['user_image'] = $this->storeImageFromBase64(
                (string) $data['user_image_base64'],
                $parentProfile->user_image
            );
        } elseif (array_key_exists('user_image', $data)) {
            $updates['user_image'] = $data['user_image'] ?? null;
        }

        if (! empty($updates)) {
            $parentProfile->update($updates);
        }
        $refreshed = $parentProfile->refresh();
        $this->syncGhlContact((string) $parentProfile->user_id, $refreshed, $data);

        return $refreshed;
    }

    public function destroy(ParentProfile $parentProfile)
    {
        $parentProfile->delete();
        return response()->json(['message' => 'Parent profile deleted']);
    }

    private function syncGhlContact(string $publicUserId, ParentProfile $profile, array $data = []): void
    {
        $user = User::query()->where('user_id', $publicUserId)->first();
        if (! $user) {
            return;
        }

        $result = GhlContactManager::syncContactForUser($user, [
            'phone' => $profile->phone,
            'city' => $profile->city,
            'address' => $profile->address,
            'country' => $data['country'] ?? null,
            'user_image_url' => $profile->user_image_url,
        ]);

        if (! ($result['success'] ?? false)) {
            Log::warning('parent_profile.ghl_sync_failed', [
                'user_id' => $publicUserId,
                'status' => $result['status'] ?? null,
                'message' => $result['message'] ?? null,
            ]);
        }
    }

    private function storeImageFromBase64(string $base64Input, ?string $oldPath = null): ?string
    {
        $raw = trim($base64Input);
        if ($raw === '') {
            return $oldPath;
        }

        $mime = 'image/jpeg';
        $payload = $raw;
        if (str_starts_with($raw, 'data:')) {
            $commaPos = strpos($raw, ',');
            if ($commaPos === false) {
                return $oldPath;
            }

            $metadata = strtolower(trim(substr($raw, 5, $commaPos - 5)));
            $payload = substr($raw, $commaPos + 1);

            if (! str_contains($metadata, ';base64')) {
                return $oldPath;
            }

            $candidateMime = trim((string) Str::before($metadata, ';'));
            if (str_starts_with($candidateMime, 'image/')) {
                $mime = $candidateMime;
            }
        }

        $payload = preg_replace('/\s+/', '', $payload) ?? '';
        $payload = str_replace(' ', '+', $payload);
        $binary = base64_decode($payload, true);
        if ($binary === false || $binary === '') {
            return $oldPath;
        }

        $extension = match ($mime) {
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            'image/heic', 'image/heif' => 'heic',
            'image/jpg', 'image/jpeg', 'image' => 'jpg',
            default => 'jpg',
        };

        $path = 'parent-profiles/'.Str::lower(Str::random(24)).'.'.$extension;
        Storage::disk('public')->put($path, $binary);

        if ($oldPath && $oldPath !== $path && Storage::disk('public')->exists($oldPath)) {
            Storage::disk('public')->delete($oldPath);
        }

        return $path;
    }

    private function transformProfile(ParentProfile $profile): array
    {
        $stats = $this->buildParentRatingStats($profile->user_id);
        $reviews = $this->buildParentReviews($profile->user_id);
        $user = $profile->user;

        return [
            ...$profile->toArray(),
            'name' => $user?->name,
            'email' => $user?->email,
            'average_rating' => $stats['average_rating'],
            'jobs_posted_count' => $stats['jobs_posted_count'],
            'ratings_count' => $stats['raters_count'],
            'total_ratings_count' => $stats['ratings_count'],
            'reviews' => $reviews,
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
            ->visibleOnPlatform()
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

    private function buildParentReviews(?string $parentUserId): array
    {
        $publicId = strtoupper(trim((string) ($parentUserId ?? '')));
        if ($publicId === '') {
            return [];
        }

        $hasReviewColumn = Schema::hasColumn('parent_job_applications', 'nanny_review');
        $hasRatedAtColumn = Schema::hasColumn('parent_job_applications', 'nanny_rated_at');
        if (! $hasReviewColumn) {
            return [];
        }

        $rows = ParentJobApplication::query()
            ->visibleOnPlatform()
            ->join('parent_jobs', 'parent_jobs.id', '=', 'parent_job_applications.job_id')
            ->leftJoin('users as nannies', 'nannies.user_id', '=', 'parent_job_applications.nanny_id')
            ->where('parent_jobs.user_id', $publicId)
            ->whereNotNull('parent_job_applications.nanny_review')
            ->whereRaw('TRIM(parent_job_applications.nanny_review) <> ""')
            ->orderByDesc($hasRatedAtColumn ? 'parent_job_applications.nanny_rated_at' : 'parent_job_applications.updated_at')
            ->limit(10)
            ->get([
                'parent_job_applications.id',
                'parent_job_applications.nanny_rating',
                'parent_job_applications.nanny_review',
                'parent_job_applications.updated_at',
                $hasRatedAtColumn ? 'parent_job_applications.nanny_rated_at' : 'parent_job_applications.updated_at as nanny_rated_at',
                'nannies.name as nanny_name',
            ]);

        return $rows
            ->map(function ($row) {
                $reviewText = trim((string) ($row->nanny_review ?? ''));
                if ($reviewText === '') {
                    return null;
                }

                return [
                    'id' => $row->id,
                    'rating' => $row->nanny_rating !== null ? (float) $row->nanny_rating : null,
                    'review' => $reviewText,
                    'reviewer_name' => trim((string) ($row->nanny_name ?? '')) ?: 'Syttr',
                    'reviewed_at' => optional($row->nanny_rated_at ?? $row->updated_at)?->toISOString(),
                ];
            })
            ->filter()
            ->values()
            ->all();
    }
}
