<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AccountDeletionController extends Controller
{
    private const DELETION_GRACE_DAYS = 7;

    public function schedule(Request $request): JsonResponse
    {
        $user = $this->resolveUserFromRequest($request);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized.',
            ], 401);
        }

        if ($user->isDeletionScheduled()) {
            return response()->json([
                'success' => true,
                'message' => 'Account deletion is already scheduled.',
                'scheduled_for_deletion_at' => optional($user->account_deletion_scheduled_for)->toISOString(),
                'restore_window_days' => self::DELETION_GRACE_DAYS,
            ]);
        }

        $user->scheduleDeletion(self::DELETION_GRACE_DAYS);

        return response()->json([
            'success' => true,
            'message' => 'Your account has been scheduled for deletion.',
            'scheduled_for_deletion_at' => optional($user->account_deletion_scheduled_for)->toISOString(),
            'restore_window_days' => self::DELETION_GRACE_DAYS,
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
