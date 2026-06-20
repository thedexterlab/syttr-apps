<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class AdminSettingsController extends Controller
{
    public function subscriptionStatus(): JsonResponse
    {
        $status = strtolower(trim((string) env('ADMIN_WORKSPACE_SUBSCRIPTION_STATUS', 'active')));

        return response()->json([
            'data' => [
                'status' => $status !== '' ? $status : 'active',
            ],
        ]);
    }
}
