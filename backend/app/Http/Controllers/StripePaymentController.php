<?php

namespace App\Http\Controllers;

use App\Models\PaymentMethod;
use App\Models\StripeTransaction;
use App\Models\TazVerificationOrder;
use App\Models\User;
use App\Services\VerificationService;
use App\Support\StripeCustomerManager;
use App\Support\StripeTransactionRecorder;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class StripePaymentController extends Controller
{
    public function __construct(
        private readonly VerificationService $verificationService
    ) {
    }

    public function chargeVerification(Request $request): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.5'],
            'currency' => ['nullable', 'string', 'size:3'],
            'stripe_token' => ['nullable', 'string', 'max:255'],
            'payment_method_id' => ['nullable'],
            'stripe_payment_method_id' => ['nullable', 'string', 'max:255', 'regex:/^pm_/'],
            'description' => ['nullable', 'string', 'max:255'],
            'user_id' => ['nullable', 'string', 'max:64'],
            'verification_type' => ['nullable', 'string', 'max:64'],
        ]);

        $secretKey = trim((string) config('services.stripe.secret', ''));
        if ($secretKey === '') {
            StripeTransactionRecorder::record([
                'user_id' => User::resolvePublicUserIdByIdentifier($request->input('user_id')),
                'source' => 'stripe.verification.charge',
                'category' => 'verification',
                'type' => 'charge',
                'amount' => is_numeric((string) $request->input('amount')) ? round((float) $request->input('amount'), 2) : null,
                'currency' => strtolower(trim((string) ($request->input('currency', 'usd')))),
                'description' => trim((string) ($request->input('description', 'Verification payment'))),
                'status' => 'config_error',
                'error_message' => 'Stripe secret key is not configured.',
                'meta' => [
                    'verification_type' => (string) $request->input('verification_type', ''),
                ],
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Stripe secret key is not configured.',
            ], 503);
        }

        $amount = (float) $data['amount'];
        $amountCents = (int) round($amount * 100);
        $currency = strtolower(trim((string) ($data['currency'] ?? 'usd')));
        $description = trim((string) ($data['description'] ?? 'Verification payment'));
        $userId = User::resolvePublicUserIdByIdentifier($data['user_id'] ?? null);
        $user = $userId ? User::query()->where('user_id', $userId)->first() : null;

        if ($this->verificationService->verificationFreeModeEnabled()) {
            if (! $user) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unable to resolve user for verification.',
                ], 422);
            }

            try {
                $result = $this->verificationService->completeFreeVerification($user, [
                    'verification_type' => (string) ($data['verification_type'] ?? ''),
                ]);
            } catch (\RuntimeException $e) {
                return response()->json([
                    'success' => false,
                    'message' => $e->getMessage(),
                ], 422);
            }

            return response()->json([
                'success' => true,
                'message' => 'Verification completed without payment.',
                'status' => 'completed',
                'free_mode' => true,
                'subscription_expires_at' => optional($result['subscription']->ends_at)->toISOString(),
            ]);
        }

        $paymentMethodId = isset($data['payment_method_id'])
            ? (int) $data['payment_method_id']
            : null;
        $directStripePaymentMethodId = trim((string) ($data['stripe_payment_method_id'] ?? ''));
        $stripeToken = trim((string) ($data['stripe_token'] ?? ''));
        $stripeAuditBase = [
            'user_id' => $userId,
            'source' => 'stripe.verification.charge',
            'category' => 'verification',
            'type' => ($paymentMethodId || $directStripePaymentMethodId !== '') ? 'payment_intent' : 'charge',
            'amount' => round($amount, 2),
            'currency' => $currency,
            'description' => $description,
            'request_payload' => [
                'amount' => $amountCents,
                'currency' => $currency,
                'verification_type' => (string) ($data['verification_type'] ?? ''),
                'user_id' => $userId,
                'payment_method_id' => $paymentMethodId,
                'stripe_payment_method_id' => $directStripePaymentMethodId !== '' ? $directStripePaymentMethodId : null,
            ],
            'meta' => [
                'verification_type' => (string) ($data['verification_type'] ?? ''),
            ],
        ];

        [$verificationBlocked, $verificationBlockMessage, $existingVerificationStatus] =
            $this->duplicateVerificationChargeState($user);
        if ($verificationBlocked) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'blocked_duplicate',
                'error_message' => $verificationBlockMessage,
                'meta' => [
                    ...($stripeAuditBase['meta'] ?? []),
                    'existing_verification_status' => $existingVerificationStatus,
                ],
            ]);

            return response()->json([
                'success' => false,
                'message' => $verificationBlockMessage,
                'status' => $existingVerificationStatus,
            ], 409);
        }

        if (! $paymentMethodId && $directStripePaymentMethodId === '' && $stripeToken === '') {
            return response()->json([
                'success' => false,
                'message' => 'A payment method is required.',
            ], 422);
        }

        if ($paymentMethodId || $directStripePaymentMethodId !== '') {
            $paymentMethod = null;
            $paymentSource = $directStripePaymentMethodId !== '' ? 'one_time' : 'saved';
            $stripeCustomerId = '';
            $stripePaymentMethodId = $directStripePaymentMethodId;

            if ($paymentMethodId) {
                if (! $user) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Unable to resolve user for payment method.',
                    ], 422);
                }

                $paymentMethod = PaymentMethod::query()
                    ->whereKey($paymentMethodId)
                    ->where('user_id', $userId)
                    ->first();
                if (! $paymentMethod || ! filled($paymentMethod->stripe_payment_method_id)) {
                    return response()->json([
                        'success' => false,
                        'message' => 'Saved payment method not found.',
                    ], 422);
                }

                $paymentMethodSetup = StripeCustomerManager::ensureReusablePaymentMethodForUser(
                    $user,
                    (string) $paymentMethod->stripe_payment_method_id,
                    (bool) $paymentMethod->is_default
                );
                if (! ($paymentMethodSetup['success'] ?? false)) {
                    return response()->json([
                        'success' => false,
                        'message' => (string) ($paymentMethodSetup['message'] ?? 'Unable to use the selected payment method.'),
                    ], (int) ($paymentMethodSetup['status'] ?? 422));
                }

                $stripeCustomerId = trim((string) ($paymentMethodSetup['customer_id'] ?? $user->stripe_customer_id ?? ''));
                $stripePaymentMethodId = (string) $paymentMethod->stripe_payment_method_id;
            }

            $stripeVerifySsl = (bool) config('services.stripe.verify_ssl', true);
            $paymentIntentPayload = [
                'amount' => $amountCents,
                'currency' => strtolower($currency),
                'confirm' => 'true',
                'payment_method' => $stripePaymentMethodId,
                'payment_method_types[0]' => 'card',
                'description' => $description,
                'metadata[user_id]' => (string) $userId,
                'metadata[verification_type]' => (string) ($data['verification_type'] ?? ''),
                'metadata[payment_source]' => $paymentSource,
            ];
            if ($paymentMethodId) {
                $paymentIntentPayload['metadata[payment_method_id]'] = (string) $paymentMethodId;
            }
            if ($stripeCustomerId !== '') {
                $paymentIntentPayload['customer'] = $stripeCustomerId;
            }

            try {
                $response = Http::withOptions([
                        'verify' => $stripeVerifySsl,
                    ])
                    ->withBasicAuth($secretKey, '')
                    ->connectTimeout(5)
                    ->timeout(12)
                    ->asForm()
                    ->post('https://api.stripe.com/v1/payment_intents', $paymentIntentPayload);
            } catch (ConnectionException $e) {
                return response()->json([
                    'success' => false,
                    'message' => 'Stripe request timed out. Please try again.',
                ], 504);
            } catch (\Throwable $e) {
                Log::error('[StripePayment] verification_payment_intent_exception', [
                    'error' => $e->getMessage(),
                ]);

                return response()->json([
                    'success' => false,
                    'message' => 'Payment request failed. Please try again.',
                ], 500);
            }

            $payload = $response->json() ?: [];
            if (! $response->successful()) {
                $message = (string) ($payload['error']['message'] ?? $payload['message'] ?? 'Verification payment failed.');
                if ($paymentMethodId) {
                    $message = StripeCustomerManager::humanizeReusablePaymentMethodError($message);
                }

                StripeTransactionRecorder::record([
                    ...$stripeAuditBase,
                    'status' => 'failed',
                    'payment_method_id' => $paymentMethod?->id,
                    'stripe_payment_method_id' => $stripePaymentMethodId,
                    'stripe_payment_intent_id' => (string) ($payload['id'] ?? ''),
                    'response_payload' => $payload,
                    'error_message' => $message,
                    'meta' => [
                        ...($stripeAuditBase['meta'] ?? []),
                        'payment_source' => $paymentSource,
                        'stripe_customer_id' => $stripeCustomerId !== '' ? $stripeCustomerId : null,
                    ],
                ]);

                return response()->json([
                    'success' => false,
                    'message' => $message,
                ], 422);
            }

            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => strtolower(trim((string) ($payload['status'] ?? 'succeeded'))) ?: 'succeeded',
                'payment_method_id' => $paymentMethod?->id,
                'stripe_payment_method_id' => $stripePaymentMethodId,
                'stripe_payment_intent_id' => (string) ($payload['id'] ?? ''),
                'response_payload' => $payload,
                'meta' => [
                    ...($stripeAuditBase['meta'] ?? []),
                    'payment_source' => $paymentSource,
                    'stripe_customer_id' => $stripeCustomerId !== '' ? $stripeCustomerId : null,
                ],
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Payment successful.',
                'payment_intent_id' => (string) ($payload['id'] ?? ''),
                'status' => (string) ($payload['status'] ?? 'succeeded'),
                'amount' => isset($payload['amount']) ? ((float) $payload['amount'] / 100) : $amount,
                'currency' => (string) ($payload['currency'] ?? $currency),
            ]);
        }

        try {
            $response = Http::asForm()
                ->withToken($secretKey)
                ->post('https://api.stripe.com/v1/charges', [
                    'amount' => $amountCents,
                    'currency' => $currency,
                    'source' => $stripeToken,
                    'description' => $description,
                    'metadata[user_id]' => (string) ($data['user_id'] ?? ''),
                    'metadata[verification_type]' => (string) ($data['verification_type'] ?? ''),
                ]);

            $payload = $response->json();
            if (! $response->successful()) {
                $message = (string) ($payload['error']['message'] ?? $payload['message'] ?? 'Stripe charge failed.');
                StripeTransactionRecorder::record([
                    ...$stripeAuditBase,
                    'status' => 'failed',
                    'stripe_charge_id' => (string) ($payload['id'] ?? ''),
                    'response_payload' => is_array($payload) ? $payload : null,
                    'error_message' => $message,
                ]);
                Log::warning('[StripePayment] verification_charge_failed', [
                    'status' => $response->status(),
                    'message' => $message,
                ]);

                return response()->json([
                    'success' => false,
                    'message' => $message,
                ], 422);
            }

            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => strtolower(trim((string) ($payload['status'] ?? 'succeeded'))) ?: 'succeeded',
                'stripe_charge_id' => (string) ($payload['id'] ?? ''),
                'response_payload' => is_array($payload) ? $payload : null,
                'meta' => [
                    ...($stripeAuditBase['meta'] ?? []),
                    'paid' => (bool) ($payload['paid'] ?? false),
                    'receipt_url' => $payload['receipt_url'] ?? null,
                ],
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Payment successful.',
                'charge_id' => (string) ($payload['id'] ?? ''),
                'status' => (string) ($payload['status'] ?? 'succeeded'),
                'amount' => isset($payload['amount']) ? ((float) $payload['amount'] / 100) : $amount,
                'currency' => (string) ($payload['currency'] ?? $currency),
                'receipt_url' => $payload['receipt_url'] ?? null,
                'paid' => (bool) ($payload['paid'] ?? false),
            ]);
        } catch (\Throwable $e) {
            StripeTransactionRecorder::record([
                ...$stripeAuditBase,
                'status' => 'exception',
                'error_message' => $e->getMessage(),
                'meta' => [
                    ...($stripeAuditBase['meta'] ?? []),
                    'exception' => get_class($e),
                ],
            ]);
            Log::error('[StripePayment] verification_charge_exception', [
                'error' => $e->getMessage(),
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Payment request failed. Please try again.',
            ], 500);
        }
    }

    private function duplicateVerificationChargeState(?User $user): array
    {
        if (! $user) {
            return [false, '', 'unknown'];
        }

        $profileStatus = strtolower(trim((string) ($user->profile_status ?? '')));
        if (in_array($profileStatus, ['completed', 'verified'], true)) {
            return [true, 'Verification is already completed for this user.', 'completed'];
        }

        if ($this->hasSuccessfulVerificationCharge($user)) {
            return [true, 'Verification payment is already completed for this user.', 'completed'];
        }

        $order = TazVerificationOrder::query()
            ->where(function ($query) use ($user): void {
                $query
                    ->where('user_id', $user->id)
                    ->orWhere('public_user_id', strtoupper(trim((string) $user->user_id)));
            })
            ->latest('id')
            ->first();

        if (! $order) {
            return [false, '', 'unknown'];
        }

        $status = strtolower(trim((string) ($order->normalized_status ?: $order->provider_status ?: 'unknown')));
        if (str_contains($status, 'pend')) {
            $status = 'app-pending';
        } elseif (
            str_contains($status, 'complete') ||
            str_contains($status, 'clear') ||
            str_contains($status, 'approved') ||
            str_contains($status, 'verified')
        ) {
            $status = 'completed';
        } elseif (str_contains($status, 'fail') || str_contains($status, 'reject') || str_contains($status, 'deny')) {
            $status = 'failed';
        }

        $hasExistingVerification = $status !== 'unknown'
            || filled((string) $order->taz_order_guid)
            || filled((string) $order->quickapp_link);

        if (! $hasExistingVerification) {
            return [false, '', 'unknown'];
        }

        return match ($status) {
            'completed' => [true, 'Verification is already completed for this user.', $status],
            'failed' => [true, 'Verification has already been submitted for this user. Please contact support to continue.', $status],
            default => [false, '', $status !== '' ? $status : 'app-pending'],
        };
    }

    private function hasSuccessfulVerificationCharge(User $user): bool
    {
        return StripeTransaction::query()
            ->where('user_id', (string) $user->user_id)
            ->where('source', 'stripe.verification.charge')
            ->whereIn('status', ['succeeded', 'completed'])
            ->exists();
    }
}
