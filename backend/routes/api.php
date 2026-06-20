<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\Admin\FeatureFlagController;
use App\Http\Controllers\AccountController;
use App\Http\Controllers\AccountDeactivationController;
use App\Http\Controllers\AccountDeletionController;
use App\Http\Controllers\BillingController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\FavoriteSyttrController;
use App\Http\Controllers\FavoriteJobController;
use App\Http\Controllers\GhlContactController;
use App\Http\Controllers\NannyJobController;
use App\Http\Controllers\NannyRatingController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\PaymentMethodController;
use App\Http\Controllers\ParentJobController;
use App\Http\Controllers\ParentProfileController;
use App\Http\Controllers\ParentKidController;
use App\Http\Controllers\ParentSignupController;
use App\Http\Controllers\PushTokenController;
use App\Http\Controllers\ReferralController;
use App\Http\Controllers\SubscriptionController;
use App\Http\Controllers\SyttrAvailabilityController;
use App\Http\Controllers\SyttrProfileController;
use App\Http\Controllers\StripePaymentController;
use App\Http\Controllers\StripeConnectController;
use App\Http\Controllers\SyttrSignupController;
use App\Http\Controllers\StripeWebhookController;
use App\Http\Controllers\SupportMessageController;
use App\Http\Controllers\TazVerificationController;
use App\Http\Controllers\VerificationFlowController;
use App\Http\Controllers\WalletController;
use App\Http\Middleware\EnsureAdminApiToken;
use Illuminate\Support\Facades\Route;

Route::get('/health', function () {
    return response()->json([
        'ok' => true,
        'app' => config('app.name'),
        'env' => config('app.env'),
        'time' => now()->toIso8601String(),
    ]);
});

Route::post('/signup/parent', [ParentSignupController::class, 'store']);
Route::post('/signup/syttr', [SyttrSignupController::class, 'store']);
Route::post('/login', [AuthController::class, 'login']);
Route::post('/syttr/login', [AuthController::class, 'syttrLogin']);
Route::post('/nanny/login', [AuthController::class, 'nannyLogin']);
Route::post('/change-password', [AccountController::class, 'changePassword']);
Route::post('/account/deactivate', [AccountDeactivationController::class, 'deactivate']);
Route::post('/account/delete', [AccountDeletionController::class, 'schedule']);
Route::post('/forgot-password/send-code', [AccountController::class, 'sendPasswordResetCode']);
Route::match(['get', 'post'], '/referrals/reference', [ReferralController::class, 'reference']);

Route::apiResource('/profiles/parents', ParentProfileController::class)
    ->parameters(['parents' => 'parentProfile']);
// Dedicated endpoint used by mobile/web clients for parent profile upsert.
Route::post('/update-client-profile', [ParentProfileController::class, 'store']);
Route::post('/ghl/contact', [GhlContactController::class, 'store']);
Route::put('/ghl/contact', [GhlContactController::class, 'update']);
Route::delete('/ghl/contact', [GhlContactController::class, 'destroy']);
Route::apiResource('/profiles/syttrs', SyttrProfileController::class)
    ->parameters(['syttrs' => 'syttrProfile']);
Route::get('/nannies', [SyttrProfileController::class, 'nannies']);
Route::get('/nannies/{nannyId}', [SyttrProfileController::class, 'details']);
Route::apiResource('/parents/kids', ParentKidController::class)
    ->parameters(['kids' => 'parentKid']);
Route::apiResource('/syttrs/availabilities', SyttrAvailabilityController::class)
    ->parameters(['availabilities' => 'syttrAvailability']);
Route::get('/nanny/getavailability', [SyttrAvailabilityController::class, 'index']);
Route::post('/nanny/availability', [SyttrAvailabilityController::class, 'store']);

Route::get('/user/{user}/kids', [ParentKidController::class, 'byUser']);
Route::post('/job/store', [ParentJobController::class, 'store']);
Route::match(['get', 'post'], '/job/parent', [ParentJobController::class, 'parent']);
Route::match(['get', 'post'], '/parent-jobs', [ParentJobController::class, 'parent']);
Route::match(['get', 'post'], '/job/index', [ParentJobController::class, 'index']);
Route::match(['get', 'post'], '/calendar/bookings', [ParentJobController::class, 'calendarBookings']);
Route::post('/job/get-details', [NannyJobController::class, 'detailsByBody']);
Route::get('/job/{jobId}/details', [NannyJobController::class, 'details']);
Route::post('/jobs/send-request', [NannyJobController::class, 'sendRequest']);
Route::post('/nanny/hire-requests/{applicationId}/accept', [NannyJobController::class, 'acceptHireRequest']);
Route::post('/nanny/hire-requests/{applicationId}/reject', [NannyJobController::class, 'rejectHireRequest']);
Route::post('/nanny/hire-requests/{applicationId}/cancel', [NannyJobController::class, 'cancelAcceptedJob']);
Route::post('/jobs/hire-now', [ParentJobController::class, 'hireNow']);
Route::post('/job-requests/{applicationId}/accept', [ParentJobController::class, 'acceptApplication']);
Route::post('/job-requests/{applicationId}/reject', [ParentJobController::class, 'rejectApplication']);
Route::post('/job-requests/{applicationId}/rate', [ParentJobController::class, 'submitRating']);
Route::post('/job/update-status', [ParentJobController::class, 'updateStatus']);
Route::post('/job/status', [ParentJobController::class, 'updateStatus']);
Route::post('/jobs/update-status', [ParentJobController::class, 'updateStatus']);
Route::post('/job/cancel-booking', [ParentJobController::class, 'cancelBooking']);
Route::post('/bookings/extra-hours/request', [ParentJobController::class, 'requestExtraHours']);
Route::match(['get', 'post'], '/bookings/{jobId}/extra-hours/status', [ParentJobController::class, 'extraHoursStatus']);
Route::post('/bookings/extra-hours/{notificationId}/accept', [ParentJobController::class, 'acceptExtraHours']);
Route::post('/bookings/extra-hours/{notificationId}/reject', [ParentJobController::class, 'rejectExtraHours']);
Route::delete('/job/{jobId}', [ParentJobController::class, 'destroy']);
Route::post('/job/delete/{jobId}', [ParentJobController::class, 'delete']);

Route::post('/taz/create-order', [TazVerificationController::class, 'createOrder']);
Route::post('/taz/regenerate-link', [TazVerificationController::class, 'regenerateLink']);
Route::post('/taz/status', [TazVerificationController::class, 'status']);
Route::post('/taz/webhook', [TazVerificationController::class, 'webhook']);
Route::post('/stripe/verification/charge', [StripePaymentController::class, 'chargeVerification']);
Route::post('/stripe/connect', [StripeConnectController::class, 'create']);
Route::get('/stripe/connect/refresh', [StripeConnectController::class, 'refresh']);
Route::get('/stripe/connect/return', [StripeConnectController::class, 'complete']);
Route::post('/stripe/external-account', [StripeConnectController::class, 'addExternalAccount']);
Route::post('/interview-schedule', [VerificationFlowController::class, 'scheduleInterview']);
Route::post('/profile-status', [VerificationFlowController::class, 'profileStatus']);
Route::post('/stripe/webhook', [StripeWebhookController::class, 'handle']);

Route::get('/payment-method', [PaymentMethodController::class, 'index']);
Route::post('/payment-methods/setup-intent', [PaymentMethodController::class, 'setupIntent']);
Route::post('/payment-methods/store', [PaymentMethodController::class, 'store']);
Route::delete('/payment-methods/{id}', [PaymentMethodController::class, 'destroy']);

Route::get('/subscription/status', [SubscriptionController::class, 'status']);
Route::get('/subscription/plans', [SubscriptionController::class, 'plans']);
Route::get('/subscription/history', [SubscriptionController::class, 'history']);
Route::get('/subscription/transactions', [SubscriptionController::class, 'transactions']);
Route::get('/billing/history', [BillingController::class, 'history']);
Route::get('/billing/transactions', [BillingController::class, 'transactions']);
Route::post('/subscribe', [SubscriptionController::class, 'subscribe']);
Route::post('/subscription/pause', [SubscriptionController::class, 'pause']);
Route::post('/subscription/resume', [SubscriptionController::class, 'resume']);
Route::post('/subscription/cancel', [SubscriptionController::class, 'cancel']);
Route::match(['get', 'post'], '/platform-fee/commission', [WalletController::class, 'commission']);
Route::match(['get', 'post'], '/nanny/platform-fee/commission', [WalletController::class, 'commission']);
Route::match(['get', 'post'], '/nanny/commission', [WalletController::class, 'commission']);
Route::match(['get', 'post'], '/commission', [WalletController::class, 'commission']);
Route::get('/wallet', [WalletController::class, 'balance']);
Route::get('/wallet/history', [WalletController::class, 'history']);
Route::get('/wallet/transactions', [WalletController::class, 'transactions']);
Route::post('/wallet/withdraw', [WalletController::class, 'withdraw']);
Route::get('/nanny/transactions', [WalletController::class, 'transactions']);
Route::get('/nanny/wallet/transactions', [WalletController::class, 'transactions']);

Route::get('/favorite-syttrs', [FavoriteSyttrController::class, 'index']);
Route::post('/favorite-syttrs/store', [FavoriteSyttrController::class, 'store']);
Route::delete('/favorite-syttrs/{id}', [FavoriteSyttrController::class, 'destroy']);
Route::get('/favorite-jobs/{nannyId}', [FavoriteJobController::class, 'index']);
Route::post('/favorite-jobs', [FavoriteJobController::class, 'store']);
Route::delete('/favorite-jobs/{id}', [FavoriteJobController::class, 'destroy']);

Route::get('/nanny/rating-summary', [NannyRatingController::class, 'summary']);
Route::post('/nanny/rating-summary', [NannyRatingController::class, 'summary']);
Route::get('/nanny/ratings/summary', [NannyRatingController::class, 'summary']);
Route::post('/nanny/ratings/summary', [NannyRatingController::class, 'summary']);
Route::get('/ratings/summary', [NannyRatingController::class, 'summary']);
Route::post('/ratings/summary', [NannyRatingController::class, 'summary']);
Route::get('/ratings/nanny-summary', [NannyRatingController::class, 'summary']);
Route::post('/ratings/nanny-summary', [NannyRatingController::class, 'summary']);

Route::post('/chat/conversations/list', [ChatController::class, 'conversations']);
Route::post('/chat/messages', [ChatController::class, 'index']);
Route::post('/chat/messages/send', [ChatController::class, 'send']);

Route::get('/job-requests', [ParentJobController::class, 'jobRequests']);
Route::delete('/job-requests/{applicationId}', [ParentJobController::class, 'destroyJobRequest']);
Route::get('/notifications', [NotificationController::class, 'index']);
Route::post('/notifications/heartbeat', [NotificationController::class, 'heartbeat']);
Route::get('/nanny/notifications', [NotificationController::class, 'nannyIndex']);
Route::get('/nanny/hire-requests', [NotificationController::class, 'nannyHireRequests']);
Route::delete('/notifications/{id}', [NotificationController::class, 'destroy']);
Route::get('/notification/open/{id}', [NotificationController::class, 'open']);
Route::post('/notification/mark-read/{id}', [NotificationController::class, 'markRead']);
Route::post('/notification/mark-unread/{id}', [NotificationController::class, 'markUnread']);
Route::post('/notification/mark-all-read', [NotificationController::class, 'markAllRead']);
Route::post('/notification/mark-all-unread', [NotificationController::class, 'markAllUnread']);
Route::post('/push-tokens', [PushTokenController::class, 'store']);
Route::delete('/push-tokens', [PushTokenController::class, 'destroy']);
Route::get('/support/messages', [SupportMessageController::class, 'index']);
Route::post('/support/messages', [SupportMessageController::class, 'store']);

Route::prefix('/admin')
    ->middleware(EnsureAdminApiToken::class)
    ->group(function (): void {
        Route::get('/feature-flags', [FeatureFlagController::class, 'index']);
        Route::post('/feature-flags/toggle', [FeatureFlagController::class, 'toggle']);
    });
