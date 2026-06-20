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
        $hasParentReview = Schema::hasColumn('parent_job_applications', 'parent_review');
        $hasParentRatedAt = Schema::hasColumn('parent_job_applications', 'parent_rated_at');
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
        $reviews = [];

        if ($hasParentRating) {
            $reviewRows = ParentJobApplication::query()
                ->join('parent_jobs', 'parent_jobs.id', '=', 'parent_job_applications.job_id')
                ->leftJoin('users', 'users.user_id', '=', 'parent_jobs.user_id')
                ->where('parent_job_applications.nanny_id', $nannyId)
                ->whereNotNull('parent_job_applications.parent_rating')
                ->when($hasParentReview, static function ($query) {
                    $query->where(function ($inner) {
                        $inner
                            ->whereNotNull('parent_job_applications.parent_review')
                            ->whereRaw('TRIM(parent_job_applications.parent_review) <> ""')
                            ->orWhereNotNull('parent_job_applications.parent_rating');
                    });
                })
                ->orderByDesc($hasParentRatedAt ? 'parent_job_applications.parent_rated_at' : 'parent_job_applications.updated_at')
                ->limit(10)
                ->get([
                    'parent_job_applications.id',
                    'parent_job_applications.parent_rating',
                    'parent_job_applications.parent_review',
                    'parent_job_applications.parent_rated_at',
                    'parent_job_applications.updated_at',
                    'users.name as parent_name',
                ]);

            $reviews = $reviewRows
                ->map(static function ($row) use ($hasParentRatedAt) {
                    $reviewText = trim((string) ($row->parent_review ?? ''));
                    return [
                        'id' => $row->id,
                        'rating' => $row->parent_rating !== null ? (float) $row->parent_rating : null,
                        'review' => $reviewText !== '' ? $reviewText : null,
                        'parent_name' => trim((string) ($row->parent_name ?? '')) ?: 'Parent',
                        'reviewed_at' => optional($hasParentRatedAt ? $row->parent_rated_at : $row->updated_at)->toISOString(),
                    ];
                })
                ->values()
                ->all();
        }

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
            'reviews' => $reviews,
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
                'reviews' => $reviews,
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
