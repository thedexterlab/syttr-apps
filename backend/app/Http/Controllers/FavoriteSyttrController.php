<?php

namespace App\Http\Controllers;

use App\Models\FavoriteSyttr;
use App\Models\SyttrProfile;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FavoriteSyttrController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $userId = $this->resolveUserId($request, $request->input('user_id'));
        if (! $userId) {
            return response()->json(['data' => []]);
        }

        $items = FavoriteSyttr::query()
            ->where('user_id', $userId)
            ->latest()
            ->get()
            ->map(function (FavoriteSyttr $favorite) {
                $publicSyttrId = (string) $favorite->syttr_user_id;
                $internalSyttrId = User::resolveInternalIdByIdentifier($publicSyttrId);
                $profile = $internalSyttrId
                    ? SyttrProfile::query()->where('user_id', $internalSyttrId)->first()
                    : null;
                $user = User::query()->where('user_id', $publicSyttrId)->first();
                $age = null;
                if ($profile?->date_of_birth) {
                    try {
                        $age = Carbon::parse($profile->date_of_birth)->age;
                    } catch (\Throwable $e) {
                        $age = null;
                    }
                }
                return [
                    'id' => $favorite->id,
                    'syttr_user_id' => $publicSyttrId,
                    'name' => $user?->name,
                    'fullname' => $user?->name,
                    'city' => $profile?->city ?: $profile?->address,
                    'age' => $age,
                    'experience' => $profile?->experience_years,
                    'profile_image' => $profile?->user_image_url,
                ];
            });

        return response()->json([
            'success' => true,
            'data' => $items,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'syttr_user_id' => ['nullable'],
            'nanny_id' => ['nullable'],
            'syttr_id' => ['nullable'],
        ]);

        $userId = $this->resolveUserId($request, $data['user_id'] ?? null);
        $syttrUserId = User::resolvePublicUserIdByIdentifier(
            $data['syttr_user_id'] ?? $data['nanny_id'] ?? $data['syttr_id'] ?? null
        );

        if (! $userId || ! $syttrUserId) {
            return response()->json(['message' => 'user_id and syttr_user_id are required.'], 422);
        }

        $favorite = FavoriteSyttr::query()->firstOrCreate([
            'user_id' => $userId,
            'syttr_user_id' => $syttrUserId,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Favorite saved.',
            'data' => $favorite,
        ], $favorite->wasRecentlyCreated ? 201 : 200);
    }

    public function destroy(Request $request, string|int $id): JsonResponse
    {
        $userId = $this->resolveUserId($request, $request->input('user_id'));

        $query = FavoriteSyttr::query();
        if (is_numeric((string) $id)) {
            $query->whereKey($id);
        } else {
            $query->where('syttr_user_id', strtoupper((string) $id));
        }
        if ($userId) {
            $query->where('user_id', $userId);
        }

        $favorite = $query->first();
        if (! $favorite) {
            return response()->json(['message' => 'Favorite not found.'], 404);
        }
        $favorite->delete();

        return response()->json([
            'success' => true,
            'message' => 'Favorite removed.',
        ]);
    }

    private function resolveUserId(Request $request, mixed $rawUserId = null): ?string
    {
        if ($rawUserId !== null && $rawUserId !== '') {
            return User::resolvePublicUserIdByIdentifier($rawUserId);
        }

        $bearer = trim((string) $request->bearerToken());
        if ($bearer === '') return null;
        return User::query()->where('api_token', $bearer)->value('user_id');
    }
}
