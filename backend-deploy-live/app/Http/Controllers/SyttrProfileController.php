<?php

namespace App\Http\Controllers;

use App\Models\ParentJobApplication;
use App\Models\SyttrAvailability;
use App\Models\SyttrProfile;
use App\Models\User;
use App\Support\GhlContactManager;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class SyttrProfileController extends Controller
{
    public function details(Request $request, string $nannyId)
    {
        $publicUserId = User::resolvePublicUserIdByIdentifier($nannyId);
        if (! $publicUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Syttr not found.',
            ], 404);
        }

        $internalUserId = User::resolveInternalIdByIdentifier($publicUserId);
        if (! $internalUserId) {
            return response()->json([
                'success' => false,
                'message' => 'Syttr not found.',
            ], 404);
        }

        $user = User::query()
            ->visibleOnPlatform()
            ->where('user_id', $publicUserId)
            ->first();
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Syttr not found.',
            ], 404);
        }
        $profile = SyttrProfile::query()
            ->where('user_id', $internalUserId)
            ->first();

        $availabilityRows = $profile
            ? SyttrAvailability::query()
                ->where('syttr_profile_id', $profile->id)
                ->orderBy('date')
                ->orderBy('day')
                ->orderBy('time')
                ->get()
            : collect();

        $availabilityMap = [];
        foreach ($availabilityRows as $row) {
            $dateKey = $row->date ? $row->date->format('Y-m-d') : null;
            $dayKey = trim((string) ($row->day ?? ''));
            $key = $dateKey ?: $dayKey;
            if ($key === '') {
                continue;
            }
            if (! isset($availabilityMap[$key])) {
                $availabilityMap[$key] = [
                    'day' => $key,
                    'slots' => [],
                ];
            }
            $availabilityMap[$key]['slots'][] = [
                'period' => $row->period,
                'time' => $row->time,
                'start_time' => $row->start_time ?: $row->time,
                'end_time' => $row->end_time,
            ];
        }
        $availability = array_values($availabilityMap);

        $ratingStats = $this->buildNannyRatingStats($publicUserId);

        $name = trim((string) ($user?->name ?? ''));
        $hourlyRate = $profile?->hourly_rate !== null ? (float) $profile->hourly_rate : null;
        $imageUrl = $profile?->user_image_url;
        $imagePath = $profile?->user_image;
        $certificateUrl = $profile?->certificate_url;
        $certificatePath = $profile?->certificate;

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $publicUserId,
                'nanny_id' => $publicUserId,
                'fullname' => $name !== '' ? $name : null,
                'name' => $name !== '' ? $name : null,
                'city' => $profile?->city,
                'address' => $profile?->address,
                'country' => $profile?->country,
                'gender' => $profile?->gender,
                'experience' => $profile?->experience_years,
                'hourly_rate' => $hourlyRate,
                'bio' => $profile?->bio,
                'profile_image' => $imageUrl ?: $imagePath,
                'user_image' => $imagePath,
                'user_image_url' => $imageUrl,
                'certificate' => $certificatePath,
                'certificate_url' => $certificateUrl,
                'availability' => $availability,
                'rate_cards' => $hourlyRate !== null ? [['rate' => $hourlyRate]] : [],
                'rating' => $ratingStats['average_rating'],
                'avg_rating' => $ratingStats['average_rating'],
                'ratings_count' => $ratingStats['ratings_count'],
                'review_count' => $ratingStats['ratings_count'],
                'total_reviews' => $ratingStats['ratings_count'],
                'raters_count' => $ratingStats['raters_count'],
                'jobs_count' => $ratingStats['jobs_count'],
                'total_jobs' => $ratingStats['jobs_count'],
            ],
        ]);
    }

    public function nannies(Request $request)
    {
        $perPage = max(1, min((int) $request->query('per_page', 20), 100));
        $page = max(1, (int) $request->query('page', 1));
        $latitude = $this->parseNullableFloat($request->query('latitude', $request->query('lat')));
        $longitude = $this->parseNullableFloat($request->query('longitude', $request->query('lon')));
        $radiusMiles = $this->parseNullableFloat($request->query('radius_miles', $request->query('distance_miles')));
        $minRating = $this->parseNullableFloat($request->query('min_rating', $request->query('rating')));
        $availableOnly = filter_var($request->query('available_only', false), FILTER_VALIDATE_BOOL);
        $skills = trim((string) $request->query('skills', ''));

        $paginator = SyttrProfile::query()
            ->whereHas('user', fn ($builder) => $builder->visibleOnPlatform())
            ->orderByDesc('id')
            ->paginate(
                $perPage,
                [
                    'id',
                    'user_id',
                    'phone',
                    'city',
                    'address',
                    'country',
                    'experience_years',
                    'hourly_rate',
                    'bio',
                    'user_image',
                    'certificate',
                ],
                'page',
                $page
            );

        $profiles = collect($paginator->items());
        $userIds = $profiles->pluck('user_id')->filter()->unique()->values();
        $users = $profiles->isEmpty()
            ? collect()
            : User::query()
                ->visibleOnPlatform()
                ->whereIn('id', $userIds->all())
                ->get(['id', 'user_id', 'name', 'email', 'profile_status'])
                ->keyBy('id');
        $publicNannyIds = $users->pluck('user_id')->filter()->unique()->values();
        $canReadRatings = Schema::hasColumn('parent_job_applications', 'parent_rating');
        $ratings = (! $canReadRatings || $publicNannyIds->isEmpty())
            ? collect()
            : ParentJobApplication::query()
                ->join('parent_jobs', 'parent_jobs.id', '=', 'parent_job_applications.job_id')
                ->whereIn('nanny_id', $publicNannyIds->all())
                ->whereNotNull('parent_rating')
                ->selectRaw('nanny_id, ROUND(AVG(parent_rating), 2) as avg_rating, COUNT(*) as ratings_count, COUNT(DISTINCT parent_jobs.user_id) as raters_count')
                ->groupBy('nanny_id')
                ->get()
                ->keyBy('nanny_id');
        $jobsByNanny = $publicNannyIds->isEmpty()
            ? collect()
            : ParentJobApplication::query()
                ->whereIn('nanny_id', $publicNannyIds->all())
                ->whereIn('status', $this->acceptedJobStatuses())
                ->selectRaw('nanny_id, COUNT(DISTINCT job_id) as jobs_count')
                ->groupBy('nanny_id')
                ->get()
                ->keyBy('nanny_id');
        $availabilitiesByProfile = $this->availabilityByProfile($profiles);

        $rows = $profiles
            ->map(function (SyttrProfile $profile) use ($users, $ratings, $jobsByNanny, $availabilitiesByProfile, $latitude, $longitude): array {
                $user = $users->get($profile->user_id);
                $publicId = (string) ($user?->user_id ?: $profile->id);
                $name = trim((string) ($user?->name ?? ''));
                $rating = $ratings->get($publicId);
                $jobs = $jobsByNanny->get($publicId);
                $coordinates = $this->extractCoordinatesFromProfile($profile);
                $distanceMiles = null;
                if ($coordinates && $latitude !== null && $longitude !== null) {
                    $distanceMiles = round(
                        $this->distanceMiles($latitude, $longitude, $coordinates['latitude'], $coordinates['longitude']),
                        2
                    );
                }
                $availabilityRows = $availabilitiesByProfile->get((int) $profile->id, collect());
                $isAvailable = $this->hasOpenAvailability($availabilityRows);

                return [
                    'id' => $publicId,
                    'nanny_id' => $publicId,
                    'user_id' => $publicId,
                    'fullname' => $name !== '' ? $name : null,
                    'name' => $name !== '' ? $name : null,
                    'city' => $profile->city,
                    'address' => $profile->address,
                    'country' => $profile->country,
                    'experience' => $profile->experience_years,
                    'experience_years' => $profile->experience_years,
                    'hourly_rate' => $profile->hourly_rate !== null ? (float) $profile->hourly_rate : null,
                    'bio' => $profile->bio,
                    'profile_image' => $profile->user_image_url ?: $profile->user_image,
                    'user_image' => $profile->user_image,
                    'user_image_url' => $profile->user_image_url,
                    'certificate' => $profile->certificate,
                    'certificate_url' => $profile->certificate_url,
                    'latitude' => $coordinates['latitude'] ?? null,
                    'longitude' => $coordinates['longitude'] ?? null,
                    'distance_miles' => $distanceMiles,
                    'availability' => $isAvailable ? 'available' : 'unavailable',
                    'availability_slots' => $this->formatAvailabilityRows($availabilityRows),
                    'is_available' => $isAvailable,
                    'avg_rating' => $rating ? (float) $rating->avg_rating : 0.0,
                    'rating' => $rating ? (float) $rating->avg_rating : 0.0,
                    'ratings_count' => $rating ? (int) $rating->ratings_count : 0,
                    'raters_count' => $rating ? (int) $rating->raters_count : 0,
                    'jobs_count' => $jobs ? (int) $jobs->jobs_count : 0,
                    'total_jobs' => $jobs ? (int) $jobs->jobs_count : 0,
                    'skills' => $this->extractSkills($profile),
                    'verification_status' => strtolower(trim((string) ($user?->profile_status ?? ''))),
                ];
            })
            ->filter(function (array $row) use ($radiusMiles, $minRating, $availableOnly, $skills) {
                $verificationStatus = strtolower(trim((string) ($row['verification_status'] ?? '')));
                if (! in_array($verificationStatus, ['verified', 'approved', 'completed', 'quickapp-completed'], true)) {
                    return false;
                }

                if ($radiusMiles !== null && $radiusMiles > 0) {
                    // Do not exclude profiles that have no coordinates yet.
                    // Many legacy profiles only have city/address text, so distance is unknown.
                    if (isset($row['distance_miles']) && $row['distance_miles'] !== null && (float) $row['distance_miles'] > $radiusMiles) {
                        return false;
                    }
                }

                if ($minRating !== null && (float) ($row['avg_rating'] ?? 0) < $minRating) {
                    return false;
                }

                if ($availableOnly && ! (bool) ($row['is_available'] ?? false)) {
                    return false;
                }

                if ($skills !== '') {
                    $skillText = strtolower($skills);
                    $candidate = strtolower(
                        implode(' ', array_filter([
                            (string) ($row['skills'] ?? ''),
                            (string) ($row['bio'] ?? ''),
                        ]))
                    );
                    if (! Str::contains($candidate, $skillText)) {
                        return false;
                    }
                }

                return true;
            })
            ->values()
            ->all();

        return response()->json([
            'success' => true,
            'data' => [
                'data' => $rows,
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ]);
    }

    public function index()
    {
        $userId = request()->query('user_id');
        $query = SyttrProfile::query()
            ->whereHas('user', fn ($builder) => $builder->visibleOnPlatform());
        if ($userId) {
            $resolvedUserId = User::resolveInternalIdByIdentifier($userId);
            if (! $resolvedUserId) {
                return collect();
            }
            $query->where('user_id', $resolvedUserId);
        }
        return $query->latest()->get();
    }

    public function store(Request $request)
    {
        $rawInput = $request->all();
        $this->logApiDebug('request.store', [
            'path' => $request->path(),
            'method' => $request->method(),
            'payload' => $this->sanitizeForLogs($rawInput),
        ]);

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
            'date_of_birth' => ['nullable', 'date'],
            'experience_years' => ['nullable', 'integer', 'min:0', 'max:60'],
            'experience' => ['nullable', 'integer', 'min:0', 'max:60'],
            'hourly_rate' => ['nullable', 'numeric', 'min:0'],
            'bio' => ['nullable', 'string'],
            'about' => ['nullable', 'string'],
            'about_me' => ['nullable', 'string'],
            'user_image' => ['nullable', 'string', 'max:255'],
            'user_image_base64' => ['nullable', 'string'],
            'certificate' => ['nullable', 'string', 'max:255'],
            'certificate_base64' => ['nullable', 'string'],
        ]);

        $resolvedUserId = User::resolveInternalIdByIdentifier($data['user_id'] ?? null);
        if (! $resolvedUserId) {
            $errorPayload = [
                'message' => 'The selected user_id is invalid.',
                'errors' => [
                    'user_id' => ['The selected user_id is invalid.'],
                ],
            ];
            $this->logApiDebug('response.store.invalid_user_id', [
                'status' => 422,
                'submitted_user_id' => $data['user_id'] ?? null,
                'response' => $errorPayload,
            ]);
            return response()->json([
                'message' => $errorPayload['message'],
                'errors' => $errorPayload['errors'],
            ], 422);
        }
        $data['user_id'] = $resolvedUserId;
        $profile = SyttrProfile::firstOrNew(['user_id' => $resolvedUserId]);

        if (array_key_exists('phone', $data) || array_key_exists('number', $data)) {
            $profile->phone = $data['phone'] ?? $data['number'] ?? $profile->phone;
        }
        if (array_key_exists('city', $data) || array_key_exists('city_area', $data)) {
            $profile->city = $data['city'] ?? $data['city_area'] ?? $profile->city;
        }
        if (array_key_exists('address', $data) || array_key_exists('location', $data)) {
            $profile->address = $data['address'] ?? $data['location'] ?? $profile->address;
        }
        if (array_key_exists('country', $data)) {
            $profile->country = $data['country'] ?? $profile->country;
        }
        if (array_key_exists('gender', $data)) {
            $profile->gender = $data['gender'] ?? $profile->gender;
        }
        if (array_key_exists('date_of_birth', $data)) {
            $profile->date_of_birth = $data['date_of_birth'] ?? $profile->date_of_birth;
        }
        if (array_key_exists('experience_years', $data) || array_key_exists('experience', $data)) {
            $profile->experience_years = $data['experience_years'] ?? $data['experience'] ?? $profile->experience_years;
        }
        if (array_key_exists('hourly_rate', $data)) {
            $profile->hourly_rate = $data['hourly_rate'] ?? $profile->hourly_rate;
        }
        if (array_key_exists('bio', $data) || array_key_exists('about', $data) || array_key_exists('about_me', $data)) {
            $profile->bio = $data['bio'] ?? $data['about'] ?? $data['about_me'] ?? $profile->bio;
        }
        if (array_key_exists('user_image_base64', $data) && filled($data['user_image_base64'])) {
            $profile->user_image = $this->storeImageFromBase64(
                (string) $data['user_image_base64'],
                $profile->user_image
            );
        } elseif (array_key_exists('user_image', $data)) {
            $profile->user_image = $data['user_image'] ?? $profile->user_image;
        }
        if (array_key_exists('certificate_base64', $data) && filled($data['certificate_base64'])) {
            $profile->certificate = $this->storeCertificateFromBase64(
                (string) $data['certificate_base64'],
                $profile->certificate
            );
        } elseif (array_key_exists('certificate', $data)) {
            $profile->certificate = $data['certificate'] ?? $profile->certificate;
        }

        $profile->save();
        $this->deferGhlContactSync($resolvedUserId, (int) $profile->id, $data);
        $status = $profile->wasRecentlyCreated ? 201 : 200;
        $response = $profile->toArray();
        $this->logApiDebug('response.store', [
            'status' => $status,
            'profile_id' => $profile->id,
            'response' => $this->sanitizeForLogs($response),
        ]);

        return response()->json($profile, $status);
    }

    private function acceptedJobStatuses(): array
    {
        return ['accepted', 'accept', 'approved', 'confirmed', 'completed'];
    }

    private function buildNannyRatingStats(string $publicNannyId): array
    {
        $stats = [
            'average_rating' => 0.0,
            'ratings_count' => 0,
            'raters_count' => 0,
            'jobs_count' => 0,
        ];

        $normalizedNannyId = trim($publicNannyId);
        if ($normalizedNannyId === '') {
            return $stats;
        }

        $stats['jobs_count'] = (int) ParentJobApplication::query()
            ->where('nanny_id', $normalizedNannyId)
            ->whereIn('status', $this->acceptedJobStatuses())
            ->distinct('job_id')
            ->count('job_id');

        if (! Schema::hasColumn('parent_job_applications', 'parent_rating')) {
            return $stats;
        }

        $ratingsBase = ParentJobApplication::query()
            ->join('parent_jobs', 'parent_jobs.id', '=', 'parent_job_applications.job_id')
            ->where('parent_job_applications.nanny_id', $normalizedNannyId)
            ->whereNotNull('parent_job_applications.parent_rating');

        $ratingsCount = (int) (clone $ratingsBase)->count('parent_job_applications.id');
        $average = $ratingsCount > 0
            ? round((float) ((clone $ratingsBase)->avg('parent_job_applications.parent_rating') ?: 0), 2)
            : 0.0;
        $ratersCount = (int) ((clone $ratingsBase)
            ->selectRaw('COUNT(DISTINCT parent_jobs.user_id) as aggregate')
            ->value('aggregate') ?? 0);

        return [
            'average_rating' => $average,
            'ratings_count' => $ratingsCount,
            'raters_count' => $ratersCount,
            'jobs_count' => $stats['jobs_count'],
        ];
    }

    private function parseNullableFloat(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_numeric($value)) {
            return null;
        }
        return (float) $value;
    }

    private function availabilityByProfile(Collection $profiles): Collection
    {
        if ($profiles->isEmpty()) {
            return collect();
        }

        $rows = SyttrAvailability::query()
            ->whereIn('syttr_profile_id', $profiles->pluck('id')->all())
            ->get(['id', 'syttr_profile_id', 'mode', 'date', 'day', 'period', 'time', 'start_time', 'end_time']);

        return $rows->groupBy('syttr_profile_id');
    }

    private function formatAvailabilityRows(Collection|EloquentCollection $rows): array
    {
        $availabilityMap = [];
        foreach ($rows as $row) {
            $dateKey = $row->date ? $row->date->format('Y-m-d') : null;
            $dayKey = trim((string) ($row->day ?? ''));
            $key = $dateKey ?: $dayKey;
            if ($key === '') {
                continue;
            }
            if (! isset($availabilityMap[$key])) {
                $availabilityMap[$key] = [
                    'day' => $key,
                    'slots' => [],
                ];
            }
            $availabilityMap[$key]['slots'][] = [
                'period' => $row->period,
                'time' => $row->time,
                'start_time' => $row->start_time ?: $row->time,
                'end_time' => $row->end_time,
            ];
        }

        return array_values($availabilityMap);
    }

    private function hasOpenAvailability(Collection|EloquentCollection $rows): bool
    {
        if ($rows->isEmpty()) {
            return false;
        }

        foreach ($rows as $row) {
            $mode = strtolower(trim((string) ($row->mode ?? '')));
            $period = strtolower(trim((string) ($row->period ?? '')));
            if (in_array($mode, ['off', 'blocked', 'unavailable'], true)) {
                continue;
            }
            if (in_array($period, ['off', 'blocked', 'unavailable'], true)) {
                continue;
            }
            return true;
        }

        return false;
    }

    private function extractCoordinatesFromProfile(SyttrProfile $profile): ?array
    {
        $city = trim((string) ($profile->city ?? ''));
        if ($city === '') {
            return null;
        }

        if (! preg_match('/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/', $city, $matches)) {
            return null;
        }

        $latitude = (float) $matches[1];
        $longitude = (float) $matches[2];
        if ($latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180) {
            return null;
        }

        return [
            'latitude' => $latitude,
            'longitude' => $longitude,
        ];
    }

    private function distanceMiles(float $fromLatitude, float $fromLongitude, float $toLatitude, float $toLongitude): float
    {
        $earthRadiusMiles = 3958.8;
        $deltaLatitude = deg2rad($toLatitude - $fromLatitude);
        $deltaLongitude = deg2rad($toLongitude - $fromLongitude);
        $a = sin($deltaLatitude / 2) ** 2
            + cos(deg2rad($fromLatitude)) * cos(deg2rad($toLatitude)) * sin($deltaLongitude / 2) ** 2;
        $c = 2 * asin(min(1, sqrt($a)));
        return $earthRadiusMiles * $c;
    }

    private function extractSkills(SyttrProfile $profile): string
    {
        $bio = trim((string) ($profile->bio ?? ''));
        if ($bio === '') {
            return '';
        }
        return $bio;
    }

    public function show(SyttrProfile $syttrProfile)
    {
        return $syttrProfile;
    }

    public function update(Request $request, SyttrProfile $syttrProfile)
    {
        $rawInput = $request->all();
        $this->logApiDebug('request.update', [
            'path' => $request->path(),
            'method' => $request->method(),
            'profile_id' => $syttrProfile->id,
            'payload' => $this->sanitizeForLogs($rawInput),
        ]);

        $data = $request->validate([
            'phone' => ['sometimes', 'nullable', 'string', 'max:30'],
            'number' => ['sometimes', 'nullable', 'string', 'max:30'],
            'city' => ['sometimes', 'nullable', 'string', 'max:255'],
            'city_area' => ['sometimes', 'nullable', 'string', 'max:255'],
            'address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'location' => ['sometimes', 'nullable', 'string', 'max:255'],
            'country' => ['sometimes', 'nullable', 'string', 'max:255'],
            'gender' => ['sometimes', 'nullable', 'string', 'max:30'],
            'date_of_birth' => ['sometimes', 'nullable', 'date'],
            'experience_years' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:60'],
            'experience' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:60'],
            'hourly_rate' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'bio' => ['sometimes', 'nullable', 'string'],
            'about' => ['sometimes', 'nullable', 'string'],
            'about_me' => ['sometimes', 'nullable', 'string'],
            'user_image' => ['sometimes', 'nullable', 'string', 'max:255'],
            'user_image_base64' => ['sometimes', 'nullable', 'string'],
            'certificate' => ['sometimes', 'nullable', 'string', 'max:255'],
            'certificate_base64' => ['sometimes', 'nullable', 'string'],
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
        if (array_key_exists('country', $data)) {
            $updates['country'] = $data['country'] ?? null;
        }
        if (array_key_exists('gender', $data)) {
            $updates['gender'] = $data['gender'] ?? null;
        }
        if (array_key_exists('date_of_birth', $data)) {
            $updates['date_of_birth'] = $data['date_of_birth'] ?? null;
        }
        if (array_key_exists('experience_years', $data) || array_key_exists('experience', $data)) {
            $updates['experience_years'] = $data['experience_years'] ?? $data['experience'] ?? null;
        }
        if (array_key_exists('hourly_rate', $data)) {
            $updates['hourly_rate'] = $data['hourly_rate'] ?? null;
        }
        if (array_key_exists('bio', $data) || array_key_exists('about', $data) || array_key_exists('about_me', $data)) {
            $updates['bio'] = $data['bio'] ?? $data['about'] ?? $data['about_me'] ?? null;
        }
        if (array_key_exists('user_image_base64', $data) && filled($data['user_image_base64'])) {
            $updates['user_image'] = $this->storeImageFromBase64(
                (string) $data['user_image_base64'],
                $syttrProfile->user_image
            );
        } elseif (array_key_exists('user_image', $data)) {
            $updates['user_image'] = $data['user_image'] ?? null;
        }
        if (array_key_exists('certificate_base64', $data) && filled($data['certificate_base64'])) {
            $updates['certificate'] = $this->storeCertificateFromBase64(
                (string) $data['certificate_base64'],
                $syttrProfile->certificate
            );
        } elseif (array_key_exists('certificate', $data)) {
            $updates['certificate'] = $data['certificate'] ?? null;
        }

        if (! empty($updates)) {
            $syttrProfile->update($updates);
        }
        $refreshed = $syttrProfile->refresh();
        $this->deferGhlContactSync((int) $refreshed->user_id, (int) $refreshed->id, $data);
        $response = $refreshed->toArray();
        $this->logApiDebug('response.update', [
            'status' => 200,
            'profile_id' => $syttrProfile->id,
            'updated_fields' => array_keys($updates),
            'response' => $this->sanitizeForLogs($response),
        ]);

        return $refreshed;
    }

    public function destroy(SyttrProfile $syttrProfile)
    {
        $syttrProfile->delete();
        return response()->json(['message' => 'Syttr profile deleted']);
    }

    private function deferGhlContactSync(int $internalUserId, int $profileId, array $data = []): void
    {
        $payload = $data;

        app()->terminating(function () use ($internalUserId, $profileId, $payload): void {
            try {
                $profile = SyttrProfile::query()->find($profileId);
                if (! $profile) {
                    return;
                }

                $this->syncGhlContact($internalUserId, $profile, $payload);
            } catch (\Throwable $e) {
                Log::warning('syttr_profile.deferred_ghl_sync_failed', [
                    'internal_user_id' => $internalUserId,
                    'profile_id' => $profileId,
                    'message' => $e->getMessage(),
                ]);
            }
        });
    }

    private function syncGhlContact(int $internalUserId, SyttrProfile $profile, array $data = []): void
    {
        $user = User::query()->find($internalUserId);
        if (! $user) {
            return;
        }

        $result = GhlContactManager::syncContactForUser($user, [
            'phone' => $profile->phone,
            'city' => $profile->city,
            'address' => $profile->address,
            'country' => $profile->country ?? ($data['country'] ?? null),
            'user_image_url' => $profile->user_image_url,
        ]);

        if (! ($result['success'] ?? false)) {
            Log::warning('syttr_profile.ghl_sync_failed', [
                'user_id' => $user->user_id,
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

        $path = 'syttr-profiles/'.Str::lower(Str::random(24)).'.'.$extension;
        Storage::disk('public')->put($path, $binary);

        if ($oldPath && $oldPath !== $path && Storage::disk('public')->exists($oldPath)) {
            Storage::disk('public')->delete($oldPath);
        }

        return $path;
    }

    private function storeCertificateFromBase64(string $base64Input, ?string $oldPath = null): ?string
    {
        $raw = trim($base64Input);
        if ($raw === '') {
            return $oldPath;
        }

        $mime = 'application/pdf';
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
            if ($candidateMime === 'application/pdf' || str_starts_with($candidateMime, 'image/')) {
                $mime = $candidateMime;
            } else {
                return $oldPath;
            }
        }

        $payload = preg_replace('/\s+/', '', $payload) ?? '';
        $payload = str_replace(' ', '+', $payload);
        $binary = base64_decode($payload, true);
        if ($binary === false || $binary === '') {
            return $oldPath;
        }

        $extension = match ($mime) {
            'application/pdf' => 'pdf',
            'image/png' => 'png',
            'image/webp' => 'webp',
            'image/gif' => 'gif',
            'image/heic', 'image/heif' => 'heic',
            'image/jpg', 'image/jpeg', 'image' => 'jpg',
            default => 'pdf',
        };

        $path = 'syttr-certificates/'.Str::lower(Str::random(24)).'.'.$extension;
        Storage::disk('public')->put($path, $binary);

        if ($oldPath && $oldPath !== $path && Storage::disk('public')->exists($oldPath)) {
            Storage::disk('public')->delete($oldPath);
        }

        return $path;
    }

    private function sanitizeForLogs(array $payload): array
    {
        $sanitized = [];
        foreach ($payload as $key => $value) {
            if ($key === 'user_image_base64' && is_string($value)) {
                $sanitized[$key] = '[base64 omitted, length=' . strlen($value) . ']';
                continue;
            }
            if ($key === 'certificate_base64' && is_string($value)) {
                $sanitized[$key] = '[base64 omitted, length=' . strlen($value) . ']';
                continue;
            }

            if (is_string($value)) {
                $sanitized[$key] = strlen($value) > 500
                    ? substr($value, 0, 500) . '...[truncated]'
                    : $value;
                continue;
            }

            if (is_array($value)) {
                $sanitized[$key] = $this->sanitizeForLogs($value);
                continue;
            }

            $sanitized[$key] = $value;
        }
        return $sanitized;
    }

    private function logApiDebug(string $event, array $context = []): void
    {
        $message = '[SyttrProfileAPI] ' . $event;
        Log::info($message, $context);
        Log::channel('stderr')->info($message, $context);
    }
}
