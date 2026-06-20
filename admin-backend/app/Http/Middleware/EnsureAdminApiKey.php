<?php

namespace App\Http\Middleware;

use App\Models\AdminApiKey;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdminApiKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $activeKeys = AdminApiKey::query()->where('is_active', true);
        if (! $activeKeys->exists()) {
            return response()->json([
                'message' => 'Admin API key is not configured. Seed admin-backend after setting ADMIN_FRONTEND_API_KEY.',
            ], 503);
        }

        $headerName = (string) config('admin.api_key_header', 'X-ADMIN-API-KEY');
        $plainTextKey = trim((string) $request->header($headerName, ''));
        if ($plainTextKey === '') {
            return response()->json([
                'message' => 'Missing admin API key.',
            ], 401);
        }

        $apiKey = $activeKeys
            ->where('key_hash', hash('sha256', $plainTextKey))
            ->first();

        if (! $apiKey) {
            return response()->json([
                'message' => 'Invalid admin API key.',
            ], 403);
        }

        $apiKey->forceFill([
            'last_used_at' => now(),
        ])->save();

        return $next($request);
    }
}
