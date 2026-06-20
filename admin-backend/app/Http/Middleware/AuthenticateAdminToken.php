<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateAdminToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $plainTextToken = trim((string) $request->bearerToken());
        if ($plainTextToken === '') {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $admin = User::query()
            ->where('api_token', hash('sha256', $plainTextToken))
            ->where('is_active', true)
            ->first();

        if (! $admin || ! $admin->tokenIsValid($plainTextToken)) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $request->attributes->set('admin_user', $admin);

        return $next($request);
    }
}
