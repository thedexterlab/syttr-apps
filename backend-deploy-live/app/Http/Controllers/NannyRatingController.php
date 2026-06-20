<?php

namespace App\Http\Controllers;

use App\Models\ParentJobApplication;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class NannyRatingController extends Controller
{
    public function summary(Request $request): JsonResponse
    {
        $inputNannyId = $request->query('nanny_id', $request->input('nanny_id', $request->input('user_id')));
        $nannyId = $this->resolveNannyId($request, $inputNannyId);
        if (! $nannyId) {
            return response()->json([
                'success' => true,
                'average_rating' => 0,
                'ratings_count' => 0,
            ]);
        }

        $hasParentRating = Schema::hasColumn('parent_job_applications', 'parent_rating');
        $hasNannyCanceledAt = Schema::hasColumn('parent_job_applications', 'nanny_canceled_at');
        $hasCanceledWithin24h = Schema::hasColumn('parent_job_applications', 'nanny_canceled_within_24h');
        $hasReliabilityPenalty = Schema::hasColumn('parent_job_applications', 'nanny_reliability_penalty');

        $ratingsCount = 0;
        $average = 0.0;
        $ratersCount = 0;
        $jobsCount = (int) ParentJobApplication::query()
            ->where('nanny_id', $nannyId)
            ->whereIn('status', ['accepted', 'accept', 'approved', 'confirmed', 'completed'])
            ->distinct('job_id')
            ->count('job_id');
        if ($hasParentRating) {
            $ratings = ParentJobApplication::query()
                ->join('parent_jobs', 'parent_jobs.id', '=', 'parent_job_applications.job_id')
                ->where('nanny_id', $nannyId)
                ->whereNotNull('parent_rating');
            $ratingsCount = (int) (clone $ratings)->count('parent_job_applications.id');
            $average = $ratingsCount > 0
                ? round((float) (clone $ratings)->avg('parent_job_applications.parent_rating'), 2)
                : 0.0;
            $ratersCount = (int) ((clone $ratings)
                ->selectRaw('COUNT(DISTINCT parent_jobs.user_id) as aggregate')
                ->value('aggregate') ?? 0);
        }

        $allApps = ParentJobApplication::query()->where('nanny_id', $nannyId);
        $totalApplications = (clone $allApps)->count();
        $totalCancellations = $hasNannyCanceledAt
            ? (clone $allApps)->whereNotNull('nanny_canceled_at')->count()
            : 0;
        $lateCancellations = $hasCanceledWithin24h
            ? (clone $allApps)->where('nanny_canceled_within_24h', true)->count()
            : 0;
        $reliabilityPenalty = $hasReliabilityPenalty
            ? (int) ((clone $allApps)->sum('nanny_reliability_penalty') ?: 0)
            : 0;

        return response()->json([
            'success' => true,
            'average_rating' => $average,
            'ratings_count' => $ratingsCount,
            'total_reviews' => $ratingsCount,
            'raters_count' => $ratersCount,
            'jobs_count' => $jobsCount,
            'reliability' => [
                'total_applications' => $totalApplications,
                'total_cancellations' => $totalCancellations,
                'late_cancellations_within_24h' => $lateCancellations,
                'reliability_penalty' => $reliabilityPenalty,
            ],
            'data' => [
                'average_rating' => $average,
                'ratings_count' => $ratingsCount,
                'total_reviews' => $ratingsCount,
                'raters_count' => $ratersCount,
                'jobs_count' => $jobsCount,
                'reliability' => [
                    'total_applications' => $totalApplications,
                    'total_cancellations' => $totalCancellations,
                    'late_cancellations_within_24h' => $lateCancellations,
                    'reliability_penalty' => $reliabilityPenalty,
                ],
            ],
        ]);
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

        $resolved = User::resolvePublicUserIdByApiToken($request->bearerToken());
        if ($resolved) {
            return $resolved;
        }

        return null;
    }
}
