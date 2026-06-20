<?php

use App\Http\Controllers\Admin\AdminAuthController;
use App\Http\Controllers\Admin\AdminAuditLogController;
use App\Http\Controllers\Admin\AdminCommissionController;
use App\Http\Controllers\Admin\AdminDashboardController;
use App\Http\Controllers\Admin\AdminInterviewController;
use App\Http\Controllers\Admin\AdminJobController;
use App\Http\Controllers\Admin\AdminNannyController;
use App\Http\Controllers\Admin\AdminPaymentController;
use App\Http\Controllers\Admin\AdminParentController;
use App\Http\Controllers\Admin\AdminSettingsController;
use App\Http\Controllers\Admin\AdminSupportMessageController;
use App\Http\Controllers\Admin\AdminSubscriptionController;
use App\Http\Controllers\Admin\AdminTazController;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json([
        'ok' => true,
        'app' => config('app.name'),
        'env' => config('app.env'),
        'time' => now()->toIso8601String(),
    ]);
});

Route::prefix('admin')->middleware('admin.api-key')->group(function () {
    Route::post('/login', [AdminAuthController::class, 'login']);

    Route::middleware('admin.auth')->group(function () {
        Route::post('/logout', [AdminAuthController::class, 'logout']);
        Route::get('/dashboard-stats', [AdminDashboardController::class, 'index']);

        Route::get('/nannies', [AdminNannyController::class, 'index']);
        Route::post('/nanny/profile-status', [AdminNannyController::class, 'updateProfileStatus']);

        Route::get('/users', [AdminParentController::class, 'index']);
        Route::post('/parents/profile-status', [AdminParentController::class, 'updateProfileStatus']);

        Route::get('/jobs', [AdminJobController::class, 'index']);
        Route::get('/jobscount', [AdminJobController::class, 'countByUser']);

        Route::get('/interviews', [AdminInterviewController::class, 'index']);
        Route::get('/interviews/nanny/{nanny}', [AdminInterviewController::class, 'byNanny']);

        Route::get('/commission', [AdminCommissionController::class, 'index']);
        Route::get('/payments', [AdminPaymentController::class, 'index']);
        Route::get('/support/messages', [AdminSupportMessageController::class, 'index']);
        Route::get('/audit-logs', [AdminAuditLogController::class, 'index']);
        Route::get('/subscriptions/earnings', [AdminSubscriptionController::class, 'index']);
        Route::get('/subscriptions/management', [AdminSubscriptionController::class, 'index']);
        Route::post('/subscriptions/plans', [AdminSubscriptionController::class, 'storePlan']);
        Route::put('/subscriptions/plans/{plan}', [AdminSubscriptionController::class, 'updatePlan']);
        Route::get('/platform-fee/current', [AdminCommissionController::class, 'current']);
        Route::post('/platform-fee/calculate', [AdminCommissionController::class, 'update']);
        Route::get('/subscription/status', [AdminSettingsController::class, 'subscriptionStatus']);

        Route::get('/taz/order-statuses', [AdminTazController::class, 'index']);
        Route::get('/taz/status/{user}', [AdminTazController::class, 'show']);
        Route::get('/taz/users/{user}/orders/{orderGuid}/pdf', [AdminTazController::class, 'pdf']);
    });
});
