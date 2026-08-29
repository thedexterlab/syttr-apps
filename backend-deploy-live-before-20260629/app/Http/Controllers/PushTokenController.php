<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Models\UserPushToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PushTokenController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'expo_push_token' => ['required', 'string', 'max:255'],
            'platform' => ['nullable', 'string', 'max:16'],
            'device_id' => ['nullable', 'string', 'max:191'],
            'device_name' => ['nullable', 'string', 'max:255'],
            'app_ownership' => ['nullable', 'string', 'max:32'],
            'project_id' => ['nullable', 'string', 'max:255'],
            'bundle_identifier' => ['nullable', 'string', 'max:255'],
            'environment' => ['nullable', 'string', 'max:32'],
            'meta' => ['nullable', 'array'],
            'user_id' => ['nullable'],
        ]);

        $userId = $this->resolveUserId($request, $data['user_id'] ?? null);
        if (! $userId) {
            return response()->json([
                'success' => false,
                'message' => 'Missing or invalid user_id.',
            ], 422);
        }

        $expoPushToken = trim((string) $data['expo_push_token']);
        $deviceId = trim((string) ($data['device_id'] ?? ''));

        UserPushToken::query()
            ->where('expo_push_token', $expoPushToken)
            ->where('user_id', '!=', $userId)
            ->update([
                'is_active' => false,
            ]);

        $payload = [
            'user_id' => $userId,
            'expo_push_token' => $expoPushToken,
            'platform' => strtolower(trim((string) ($data['platform'] ?? 'ios'))) ?: 'ios',
            'device_id' => $deviceId !== '' ? $deviceId : null,
            'device_name' => trim((string) ($data['device_name'] ?? '')) ?: null,
            'app_ownership' => trim((string) ($data['app_ownership'] ?? '')) ?: null,
            'project_id' => trim((string) ($data['project_id'] ?? '')) ?: null,
            'bundle_identifier' => trim((string) ($data['bundle_identifier'] ?? '')) ?: null,
            'environment' => trim((string) ($data['environment'] ?? '')) ?: null,
            'is_active' => true,
            'last_seen_at' => now(),
            'last_registered_at' => now(),
            'meta' => is_array($data['meta'] ?? null) ? $data['meta'] : null,
        ];

        $token = UserPushToken::query()->updateOrCreate(
            $deviceId !== ''
                ? ['user_id' => $userId, 'device_id' => $deviceId]
                : ['expo_push_token' => $expoPushToken],
            $payload
        );

        if ($token->expo_push_token !== $expoPushToken) {
            $token->forceFill([
                'expo_push_token' => $expoPushToken,
                'is_active' => true,
                'last_seen_at' => now(),
                'last_registered_at' => now(),
            ])->save();
        }

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $token->id,
                'user_id' => $token->user_id,
                'platform' => $token->platform,
                'is_active' => $token->is_active,
            ],
        ]);
    }

    public function destroy(Request $request): JsonResponse
    {
        $data = $request->validate([
            'expo_push_token' => ['nullable', 'string', 'max:255'],
            'device_id' => ['nullable', 'string', 'max:191'],
            'user_id' => ['nullable'],
        ]);

        $userId = $this->resolveUserId($request, $data['user_id'] ?? null);
        $tokenValue = trim((string) ($data['expo_push_token'] ?? ''));
        $deviceId = trim((string) ($data['device_id'] ?? ''));

        $query = UserPushToken::query();
        if ($userId) {
            $query->where('user_id', $userId);
        }
        if ($tokenValue !== '') {
            $query->where('expo_push_token', $tokenValue);
        } elseif ($deviceId !== '') {
            $query->where('device_id', $deviceId);
        } else {
            return response()->json([
                'success' => false,
                'message' => 'expo_push_token or device_id is required.',
            ], 422);
        }

        $updated = $query->update([
            'is_active' => false,
            'last_seen_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'updated' => $updated,
        ]);
    }

    private function resolveUserId(Request $request, mixed $rawUserId = null): ?string
    {
        if ($rawUserId !== null && $rawUserId !== '') {
            return User::resolvePublicUserIdByIdentifier($rawUserId);
        }

        return User::resolvePublicUserIdByApiToken($request->bearerToken());
    }
}
