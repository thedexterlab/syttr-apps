<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\FeatureFlagService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FeatureFlagController extends Controller
{
    public function __construct(
        private readonly FeatureFlagService $featureFlags
    ) {
    }

    public function index(): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => $this->featureFlags->all(),
        ]);
    }

    public function toggle(Request $request): JsonResponse
    {
        $data = $request->validate([
            'flag' => ['required', 'string', 'max:100'],
            'enabled' => ['required', 'boolean'],
        ]);

        try {
            $flag = $this->featureFlags->set((string) $data['flag'], (bool) $data['enabled']);
        } catch (\InvalidArgumentException) {
            return response()->json([
                'success' => false,
                'message' => 'Unknown feature flag.',
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Feature flag updated.',
            'data' => $flag,
        ]);
    }
}
