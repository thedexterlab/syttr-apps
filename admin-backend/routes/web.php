<?php

use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    $frontendUrl = rtrim((string) env('ADMIN_FRONTEND_URL', ''), '/');

    if ($frontendUrl !== '' && ! request()->expectsJson()) {
        return redirect()->away($frontendUrl);
    }

    return response()->json([
        'ok' => true,
        'app' => config('app.name'),
        'env' => config('app.env'),
        'frontend_url' => $frontendUrl !== '' ? $frontendUrl : null,
        'health_url' => url('/api/health'),
        'time' => now()->toIso8601String(),
    ]);
});
