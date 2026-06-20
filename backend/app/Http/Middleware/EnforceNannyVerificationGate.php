<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Support\NannyVerificationGateResolver;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnforceNannyVerificationGate
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $this->resolveUser($request);
        if (! $user || ! $this->isNanny($user) || ! $this->requiresVerificationGate($user)) {
            return $next($request);
        }

        if ($this->isAllowedPath($request)) {
            return $next($request);
        }

        return new JsonResponse([
            'success' => false,
            'message' => 'Verification is required before accessing nanny features.',
            'code' => 'nanny_verification_required',
            'status' => strtolower(trim((string) ($user->profile_status ?? ''))) ?: 'pending',
            'verification_required' => true,
        ], 403);
    }

    private function resolveUser(Request $request): ?User
    {
        $candidates = array_filter([
            User::normalizeApiToken($request->bearerToken()),
            User::normalizeApiToken((string) $request->input('api_token', '')),
            User::normalizeApiToken((string) $request->query('api_token', '')),
            User::normalizeApiToken((string) $request->header('X-Api-Token', '')),
        ]);

        foreach ($candidates as $token) {
            $user = User::query()->where('api_token', $token)->first();
            if ($user) {
                return $user;
            }
        }

        return null;
    }

    private function isNanny(User $user): bool
    {
        return in_array(strtolower(trim((string) $user->role)), ['syttr', 'nanny'], true);
    }

    private function requiresVerificationGate(User $user): bool
    {
        return NannyVerificationGateResolver::requiresVerificationGate(
            (string) $user->role,
            (string) ($user->profile_status ?? ''),
            (string) ($user->interview?->status ?? ''),
            (bool) $user->is_blacklisted
        );
    }

    private function isAllowedPath(Request $request): bool
    {
        $path = ltrim($request->path(), '/');

        $allowedPatterns = [
            'api/login',
            'api/syttr/login',
            'api/nanny/login',
            'api/signup/syttr',
            'api/forgot-password/*',
            'api/profiles/syttrs',
            'api/profiles/syttrs/*',
            'api/nanny/availability',
            'api/nanny/getavailability',
            'api/syttrs/availabilities',
            'api/syttrs/availabilities/*',
            'api/interview-schedule',
            'api/profile-status',
            'api/taz/*',
            'api/stripe/verification/charge',
            'api/payment-method',
            'api/payment-methods/*',
            'api/support/messages',
            'api/account/deactivate',
            'api/account/delete',
            'api/change-password',
        ];

        foreach ($allowedPatterns as $pattern) {
            if ($request->is($pattern)) {
                return true;
            }
        }

        return false;
    }
}
