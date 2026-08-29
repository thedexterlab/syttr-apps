<?php

namespace App\Http\Controllers;

use App\Models\FavoriteJob;
use App\Models\ParentJob;
use App\Models\ParentJobApplication;
use App\Models\ParentProfile;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FavoriteJobController extends Controller
{
    public function index(Request $request, string $nannyId): JsonResponse
    {
        $apiKeyError = $this->validateApiKey($request);
        if ($apiKeyError) {
            return $apiKeyError;
        }

        $resolvedNannyId = $this->resolveNannyId($request, $nannyId, $request->query('nanny_id'));
        if (! $resolvedNannyId) {
            return response()->json([
                'success' => true,
                'data' => [],
            ]);
        }
        if ($this->isBlacklistedUserId($resolvedNannyId)) {
            return response()->json([
                'success' => true,
                'status' => 'blacklisted',
                'data' => [],
            ]);
        }

        $favorites = FavoriteJob::query()
            ->where('nanny_id', $resolvedNannyId)
            ->latest()
            ->get()
            ->map(function (FavoriteJob $favorite) use ($resolvedNannyId) {
                $job = ParentJob::query()
                    ->visibleOnPlatform()
                    ->find($favorite->job_id);
                if (! $job) {
                    return null;
                }

                return [
                    'id' => $favorite->id,
                    'nanny_id' => $favorite->nanny_id,
                    'job_id' => $job->id,
                    'job' => $this->serializeJob($job, $resolvedNannyId),
                ];
            })
            ->filter()
            ->values();

        return response()->json([
            'success' => true,
            'data' => $favorites,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $apiKeyError = $this->validateApiKey($request);
        if ($apiKeyError) {
            return $apiKeyError;
        }

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

        $nannyId = $this->resolveNannyId($request, $data['nanny_id'] ?? null, $data['user_id'] ?? null);
        if (! $nannyId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing nanny_id or user_id.',
            ], 422);
        }
        if ($this->isBlacklistedUserId($nannyId)) {
            return response()->json([
                'success' => false,
                'status' => 'blacklisted',
                'message' => 'This account is blacklisted and cannot save jobs.',
            ], 403);
        }

        $favorite = FavoriteJob::query()->firstOrCreate([
            'nanny_id' => $nannyId,
            'job_id' => $job->id,
        ]);

        return response()->json([
            'success' => true,
            'message' => $favorite->wasRecentlyCreated ? 'Job added to favorites.' : 'Job already in favorites.',
            'data' => [
                'id' => $favorite->id,
                'nanny_id' => $favorite->nanny_id,
                'job_id' => $favorite->job_id,
                'job' => $this->serializeJob($job, $nannyId),
            ],
        ], $favorite->wasRecentlyCreated ? 201 : 200);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $apiKeyError = $this->validateApiKey($request);
        if ($apiKeyError) {
            return $apiKeyError;
        }

        $favorite = FavoriteJob::query()->find($id);
        if (! $favorite) {
            return response()->json([
                'success' => false,
                'message' => 'Favorite not found.',
            ], 404);
        }

        $resolvedNannyId = $this->resolveNannyId(
            $request,
            $request->input('nanny_id'),
            $request->input('user_id')
        );
        if ($resolvedNannyId && $favorite->nanny_id !== $resolvedNannyId) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized favorite removal.',
            ], 403);
        }

        $favorite->delete();

        return response()->json([
            'success' => true,
            'message' => 'Favorite removed successfully.',
        ]);
    }

    private function serializeJob(ParentJob $job, ?string $viewerNannyId = null): array
    {
        $parent = User::query()->where('user_id', $job->user_id)->first();
        $profile = ParentProfile::query()->where('user_id', $job->user_id)->first();
        $apps = ParentJobApplication::query()
            ->visibleOnPlatform()
            ->where('job_id', $job->id)
            ->orderBy('id')
            ->get();
        $viewerApplication = $viewerNannyId
            ? $apps->first(static fn (ParentJobApplication $app) => $app->nanny_id === $viewerNannyId)
            : null;
        $viewerApplicationStatus = $viewerApplication?->status ? (string) $viewerApplication->status : null;
        $viewerStatusNormalized = strtolower(trim((string) ($viewerApplicationStatus ?? '')));
        $hasPendingApplication = in_array($viewerStatusNormalized, ['pending', 'requested', 'request_sent', 'applied', 'waiting'], true);

        return [
            'id' => $job->id,
            'job_id' => $job->id,
            'user_id' => $job->user_id,
            'kid_ids' => $job->kid_ids ?? [],
            'kid_names' => $job->kid_names,
            'hours' => $job->hours !== null ? (float) $job->hours : null,
            'hourly_rate' => $job->hourly_rate !== null ? (float) $job->hourly_rate : null,
            'price' => $job->price !== null ? (float) $job->price : null,
            'total_price' => $job->price !== null ? (float) $job->price : null,
            'start_date' => optional($job->start_date)->format('Y-m-d'),
            'end_date' => optional($job->end_date)->format('Y-m-d'),
            'start_time' => (string) $job->start_time,
            'end_time' => (string) ($job->end_time ?? ''),
            'timezone' => $job->localTimezone(),
            'location' => (string) ($job->location ?? ''),
            'latitude' => $job->latitude !== null ? (float) $job->latitude : null,
            'longitude' => $job->longitude !== null ? (float) $job->longitude : null,
            'status' => (string) ($job->status ?: 'pending'),
            'job_status' => (string) ($job->status ?: 'pending'),
            'application_status' => $viewerApplicationStatus,
            'my_application_status' => $viewerApplicationStatus,
            'parent_name' => $parent?->name,
            'parent_firstname' => $this->splitName($parent?->name)['first'],
            'parent_lastname' => $this->splitName($parent?->name)['last'],
            'parent_phone' => $profile?->phone,
            'parent_city' => $profile?->city,
            'parent_country' => $profile?->country,
            'applications' => $apps->map(static fn (ParentJobApplication $app) => [
                'application_id' => $app->id,
                'nanny_id' => $app->nanny_id,
                'status' => $app->status,
                'created_at' => optional($app->created_at)->toDateTimeString(),
            ])->values()->all(),
            'has_applied' => $viewerApplication !== null,
            'has_pending_application' => $hasPendingApplication,
            'application_count' => $apps->count(),
            'created_at' => optional($job->created_at)->toIso8601String(),
            'updated_at' => optional($job->updated_at)->toIso8601String(),
        ];
    }

    private function splitName(?string $name): array
    {
        $raw = trim((string) $name);
        if ($raw === '') {
            return ['first' => null, 'last' => null];
        }
        $parts = preg_split('/\s+/', $raw) ?: [];
        $first = $parts[0] ?? null;
        $last = count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : null;
        return ['first' => $first, 'last' => $last];
    }

    private function validateApiKey(Request $request): ?JsonResponse
    {
        $expected = trim((string) env('MOBILE_API_KEY', ''));
        if ($expected === '') {
            // Keep backward compatibility when key is not configured.
            return null;
        }

        $provided = trim((string) (
            $request->header('x-api-key') ?:
            $request->header('X-API-KEY') ?:
            $request->input('api_key', $request->query('api_key', ''))
        ));

        if ($provided === '' || !hash_equals($expected, $provided)) {
            return response()->json([
                'success' => false,
                'message' => 'Invalid API key.',
            ], 401);
        }

        return null;
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
}
