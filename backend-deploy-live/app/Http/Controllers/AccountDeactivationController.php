<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AccountDeactivationController extends Controller
{
    public function deactivate(Request $request): JsonResponse
    {
        $user = $this->resolveUserFromRequest($request);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized.',
            ], 401);
        }

        if ($user->isDeactivated()) {
            return response()->json([
                'success' => true,
                'message' => 'Account is already deactivated.',
                'deactivated_at' => optional($user->deactivated_at)->toISOString(),
            ]);
        }

        $user->deactivateAccount();

        return response()->json([
            'success' => true,
            'message' => 'Account deactivated successfully.',
            'deactivated_at' => optional($user->deactivated_at)->toISOString(),
        ]);
    }

    private function resolveUserFromRequest(Request $request): ?User
    {
        $bearer = trim((string) $request->bearerToken());
        if ($bearer !== '') {
            return User::query()->where('api_token', $bearer)->first();
        }

        $userId = User::resolvePublicUserIdByIdentifier($request->input('user_id'));
        if ($userId) {
            return User::query()->where('user_id', $userId)->first();
        }

        return null;
    }
}
