<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AppData\ParentJob;
use App\Support\AdminJobFormatter;
use App\Support\AppDataHelper;
use Illuminate\Http\JsonResponse;

class AdminJobController extends Controller
{
    public function index(): JsonResponse
    {
        if (! AppDataHelper::hasTable('parent_jobs')) {
            return response()->json([
                'data' => [
                    'new_jobs' => [],
                ],
            ]);
        }

        $jobs = ParentJob::query()
            ->latest('start_date')
            ->latest('id')
            ->get();

        return response()->json([
            'data' => [
                'new_jobs' => AdminJobFormatter::buildRows($jobs),
            ],
        ]);
    }

    public function countByUser(): JsonResponse
    {
        if (! AppDataHelper::hasTable('parent_jobs')) {
            return response()->json([
                'data' => [],
            ]);
        }

        $counts = ParentJob::query()
            ->selectRaw('user_id, COUNT(*) as total_jobs')
            ->groupBy('user_id')
            ->get()
            ->map(fn (ParentJob $job) => [
                'user_id' => $job->user_id,
                'total_jobs' => (int) ($job->total_jobs ?? 0),
            ])
            ->values()
            ->all();

        return response()->json([
            'data' => $counts,
        ]);
    }
}
