<?php

use App\Http\Controllers\TazVerificationController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return response()->json([
        'ok' => true,
        'app' => config('app.name'),
        'env' => config('app.env'),
        'health_url' => url('/api/health'),
        'time' => now()->toIso8601String(),
    ]);
});

Route::post('/taz/webhook', [TazVerificationController::class, 'webhook'])
    ->withoutMiddleware([\Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class]);
