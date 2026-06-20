<?php

namespace App\Http\Controllers;

use App\Models\PaymentMethod;
use App\Models\User;
use App\Support\StripeCustomerManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class PaymentMethodController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $userId = $this->resolveRequestedUserId($request);
        if (! $userId) {
            return response()->json([
                'success' => true,
                'data' => [],
            ]);
        }

        $methods = PaymentMethod::query()
            ->where('user_id', $userId)
            ->orderByDesc('is_default')
            ->latest()
            ->get()
            ->map(fn (PaymentMethod $method) => $this->transform($method));

        return response()->json([
            'success' => true,
            'data' => $methods,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'nanny_id' => ['nullable'],
            'user_email' => ['nullable', 'string', 'max:255'],
            'email' => ['nullable', 'string', 'max:255'],
            'token' => ['nullable', 'string'],
            'api_token' => ['nullable', 'string'],
            'stripe_payment_method_id' => ['required', 'string', 'max:255', 'regex:/^pm_/'],
            'type' => ['nullable', 'string', 'max:50'],
            'brand' => ['nullable', 'string', 'max:50'],
            'last4' => ['nullable', 'string', 'max:4'],
            'exp_month' => ['nullable', 'integer', 'min:1', 'max:12'],
            'exp_year' => ['nullable', 'integer', 'min:2000', 'max:9999'],
            'is_default' => ['nullable', 'boolean'],
        ]);

        $userId = $this->resolveUserId($request, [
            $data['user_id'] ?? null,
            $data['nanny_id'] ?? null,
            $data['user_email'] ?? null,
            $data['email'] ?? null,
            $data['token'] ?? null,
            $data['api_token'] ?? null,
        ]);
        if (! $userId) {
            Log::warning('payment_method.unable_to_resolve_user', [
                'has_bearer' => filled((string) $request->bearerToken()),
                'user_id' => $request->input('user_id'),
                'nanny_id' => $request->input('nanny_id'),
                'user_email' => $request->input('user_email'),
                'email' => $request->input('email'),
                'token_present' => filled((string) $request->input('token')),
                'api_token_present' => filled((string) $request->input('api_token')),
                'api_key_present' => filled((string) $request->header('x-api-key')),
            ]);
            return response()->json(['message' => 'Unable to resolve user.'], 422);
        }

        $user = User::query()->where('user_id', $userId)->first();
        if (! $user) {
            return response()->json(['message' => 'Unable to resolve user.'], 422);
        }

        $shouldMakeDefault = (bool) ($data['is_default'] ?? false)
            || ! PaymentMethod::query()->where('user_id', $userId)->exists();
        $attachResult = StripeCustomerManager::ensureReusablePaymentMethodForUser(
            $user,
            (string) $data['stripe_payment_method_id'],
            $shouldMakeDefault
        );
        if (! ($attachResult['success'] ?? false)) {
            Log::warning('payment_method.attach_failed', [
                'user_id' => $userId,
                'stripe_payment_method_id' => $data['stripe_payment_method_id'],
                'status' => $attachResult['status'] ?? null,
                'message' => $attachResult['message'] ?? null,
                'stripe_payload' => $attachResult['stripe_payload'] ?? null,
            ]);

            return response()->json([
                'message' => (string) ($attachResult['message'] ?? 'Unable to save payment method.'),
            ], (int) ($attachResult['status'] ?? 422));
        }

        if ($shouldMakeDefault) {
            PaymentMethod::query()->where('user_id', $userId)->update(['is_default' => false]);
        }

        $stripePaymentMethod = is_array($attachResult['payment_method'] ?? null)
            ? $attachResult['payment_method']
            : [];
        $stripeCard = is_array($stripePaymentMethod['card'] ?? null)
            ? $stripePaymentMethod['card']
            : [];
        $stripeWallet = is_array($stripeCard['wallet'] ?? null)
            ? $stripeCard['wallet']
            : [];

        $resolvedType = trim((string) ($data['type'] ?? ''));
        if ($resolvedType === '' && (($stripeWallet['type'] ?? null) === 'apple_pay')) {
            $resolvedType = 'apple_pay';
        }
        if ($resolvedType === '') {
            $resolvedType = 'card';
        }

        $resolvedBrand = $data['brand'] ?? ($stripeCard['brand'] ?? null);
        $resolvedLast4 = $data['last4'] ?? ($stripeCard['last4'] ?? null);
        $resolvedExpMonth = $data['exp_month'] ?? ($stripeCard['exp_month'] ?? null);
        $resolvedExpYear = $data['exp_year'] ?? ($stripeCard['exp_year'] ?? null);

        $method = PaymentMethod::query()->updateOrCreate([
            'user_id' => $userId,
            'stripe_payment_method_id' => $data['stripe_payment_method_id'],
        ], [
            'user_id' => $userId,
            'provider' => 'stripe',
            'type' => $resolvedType,
            'brand' => $resolvedBrand,
            'last4' => $resolvedLast4,
            'exp_month' => $resolvedExpMonth,
            'exp_year' => $resolvedExpYear,
            'stripe_payment_method_id' => $data['stripe_payment_method_id'],
            'is_default' => $shouldMakeDefault,
            'meta' => array_merge($request->all(), [
                'stripe_customer_id' => (string) ($attachResult['customer_id'] ?? ''),
                'stripe_payment_method' => $stripePaymentMethod,
            ]),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Payment method saved.',
            'data' => $this->transform($method),
        ], 201);
    }

    public function setupIntent(Request $request): JsonResponse
    {
        $data = $request->validate([
            'user_id' => ['nullable'],
            'nanny_id' => ['nullable'],
            'user_email' => ['nullable', 'string', 'max:255'],
            'email' => ['nullable', 'string', 'max:255'],
            'token' => ['nullable', 'string'],
            'api_token' => ['nullable', 'string'],
            'type' => ['nullable', 'string', 'max:50'],
        ]);

        $userId = $this->resolveUserId($request, [
            $data['user_id'] ?? null,
            $data['nanny_id'] ?? null,
            $data['user_email'] ?? null,
            $data['email'] ?? null,
            $data['token'] ?? null,
            $data['api_token'] ?? null,
        ]);
        if (! $userId) {
            return response()->json(['message' => 'Unable to resolve user.'], 422);
        }

        $user = User::query()->where('user_id', $userId)->first();
        if (! $user) {
            return response()->json(['message' => 'Unable to resolve user.'], 422);
        }

        $result = StripeCustomerManager::createSetupIntentForUser(
            $user,
            [
                'source' => 'payment_method_setup',
                'requested_type' => trim((string) ($data['type'] ?? 'card')) ?: 'card',
            ],
            'Syttr payment method setup'
        );
        if (! ($result['success'] ?? false)) {
            return response()->json([
                'message' => (string) ($result['message'] ?? 'Unable to prepare payment method setup.'),
            ], (int) ($result['status'] ?? 422));
        }

        return response()->json([
            'success' => true,
            'data' => [
                'client_secret' => (string) ($result['client_secret'] ?? ''),
                'setup_intent_id' => (string) ($result['setup_intent_id'] ?? ''),
                'customer_id' => (string) ($result['customer_id'] ?? ''),
            ],
        ]);
    }

    public function destroy(Request $request, string|int $id): JsonResponse
    {
        $userId = $this->resolveRequestedUserId($request);

        $query = PaymentMethod::query()->whereKey($id);
        if ($userId) {
            $query->where('user_id', $userId);
        }
        $method = $query->first();
        if (! $method) {
            return response()->json(['message' => 'Payment method not found.'], 404);
        }

        $method->delete();

        return response()->json([
            'success' => true,
            'message' => 'Payment method deleted.',
        ]);
    }

    private function resolveRequestedUserId(Request $request): ?string
    {
        return $this->resolveUserId($request, [
            $request->input('user_id'),
            $request->query('user_id'),
            $request->input('nanny_id'),
            $request->query('nanny_id'),
            $request->input('user_email'),
            $request->query('user_email'),
            $request->input('email'),
            $request->query('email'),
            $request->input('token'),
            $request->query('token'),
            $request->input('api_token'),
            $request->query('api_token'),
        ]);
    }

    private function resolveUserId(Request $request, mixed $rawUserId = null): ?string
    {
        $candidates = is_array($rawUserId) ? $rawUserId : [$rawUserId];
        foreach ($candidates as $candidate) {
            if ($candidate === null || $candidate === '') {
                continue;
            }
            $resolved = User::resolvePublicUserIdByIdentifier($candidate);
            if ($resolved) {
                return $resolved;
            }

            $raw = trim((string) $candidate, " \t\n\r\0\x0B\"'");
            if ($raw !== '' && filter_var($raw, FILTER_VALIDATE_EMAIL)) {
                $resolvedByEmail = User::query()
                    ->whereRaw('LOWER(email) = ?', [Str::lower($raw)])
                    ->value('user_id');
                if ($resolvedByEmail) {
                    return (string) $resolvedByEmail;
                }
            }

            if ($raw !== '') {
                $resolvedByToken = User::query()
                    ->where('api_token', $raw)
                    ->value('user_id');
                if ($resolvedByToken) {
                    return (string) $resolvedByToken;
                }
            }
        }

        $bearer = trim((string) $request->bearerToken(), " \t\n\r\0\x0B\"'");
        if ($bearer === '') return null;

        return User::query()->where('api_token', $bearer)->value('user_id');
    }

    private function transform(PaymentMethod $method): array
    {
        return [
            'id' => $method->id,
            'type' => $method->type,
            'brand' => $method->brand,
            'last4' => $method->last4,
            'exp_month' => $method->exp_month,
            'exp_year' => $method->exp_year,
            'stripe_payment_method_id' => $method->stripe_payment_method_id,
            'is_default' => (bool) $method->is_default,
            'created_at' => optional($method->created_at)->toISOString(),
        ];
    }
}
