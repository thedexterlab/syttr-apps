<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdminApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $this->resolveUser($request);
        if (! $user) {
            return new JsonResponse([
                'success' => false,
                'message' => 'Authentication required.',
            ], 401);
        }

        if (strtolower(trim((string) $user->role)) !== 'admin') {
            return new JsonResponse([
                'success' => false,
                'message' => 'Admin access required.',
            ], 403);
        }

        $request->attributes->set('adminUser', $user);

        return $next($request);
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
}
