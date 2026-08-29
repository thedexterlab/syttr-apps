<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReferralController extends Controller
{
    public function reference(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'regenerate' => ['nullable'],
        ]);

        $user = $this->resolveUser($request, $data['user_id'] ?? null);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'User not found for referral generation.',
            ], 404);
        }

        $regenerate = filter_var($request->input('regenerate', false), FILTER_VALIDATE_BOOLEAN);
        $code = trim((string) ($user->referral_code ?? ''));
        if ($regenerate || $code === '') {
            $user->referral_code = User::generateReferralCode();
            $user->save();
            $code = trim((string) $user->referral_code);
        }

        $link = rtrim($this->resolveFrontendBaseUrl($request), '/').'/r/'.rawurlencode($code);

        return response()->json([
            'success' => true,
            'data' => [
                'user_id' => $user->user_id,
                'referral_code' => $code,
                'referral_link' => $link,
                // Backward/alternate keys for frontend compatibility.
                'reference_code' => $code,
                'reference_link' => $link,
                'referralCode' => $code,
                'referralUrl' => $link,
            ],
        ]);
    }

    private function resolveUser(Request $request, string|int|null $identifier): ?User
    {
        $rawIdentifier = trim((string) ($identifier ?? ''));
        if ($rawIdentifier !== '') {
            $publicUserId = User::resolvePublicUserIdByIdentifier($rawIdentifier);
            if ($publicUserId) {
                $resolved = User::query()->where('user_id', $publicUserId)->first();
                if ($resolved) {
                    return $resolved;
                }
            }
        }

        $token = $this->extractApiToken($request);
        if ($token !== '') {
            return User::query()->where('api_token', $token)->first();
        }

        return null;
    }

    private function extractApiToken(Request $request): string
    {
        $bearer = trim((string) $request->bearerToken());
        if ($bearer !== '') {
            return $bearer;
        }

        $header = trim((string) $request->header('Authorization', ''));
        if (str_starts_with(strtolower($header), 'bearer ')) {
            return trim(substr($header, 7));
        }

        $candidate = trim((string) ($request->input('token') ?? $request->input('api_token') ?? ''));
        if (str_starts_with(strtolower($candidate), 'bearer ')) {
            return trim(substr($candidate, 7));
        }

        return $candidate;
    }

    private function resolveFrontendBaseUrl(Request $request): string
    {
        $configured = trim((string) env('FRONTEND_URL', ''));
        if ($configured !== '') {
            return $configured;
        }

        $origin = trim((string) $request->header('origin', ''));
        if ($origin !== '') {
            return $origin;
        }

        return 'https://syttr.com';
    }
}
