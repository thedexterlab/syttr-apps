<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\StripeConnectManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class StripeConnectController extends Controller
{
    public function create(Request $request): JsonResponse
    {
        $user = $this->resolveAuthenticatedUser($request);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Authentication required.',
            ], 401);
        }

        $ensureResult = StripeConnectManager::ensureConnectAccountForUser($user);
        if (! ($ensureResult['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'message' => (string) ($ensureResult['message'] ?? 'Unable to start Stripe onboarding.'),
            ], (int) ($ensureResult['status'] ?? 500));
        }

        $accountId = (string) ($ensureResult['account_id'] ?? $user->stripe_connect_account_id ?? '');
        $accountLink = StripeConnectManager::createAccountLink(
            $user,
            $this->buildRefreshUrl($request, $user, $accountId),
            $this->buildReturnUrl($request, $user, $accountId)
        );
        if (! ($accountLink['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'message' => (string) ($accountLink['message'] ?? 'Unable to start Stripe onboarding.'),
            ], (int) ($accountLink['status'] ?? 500));
        }

        $accountResult = StripeConnectManager::retrieveAccount((string) ($accountLink['account_id'] ?? ''));
        $account = is_array($accountResult['account'] ?? null) ? $accountResult['account'] : [];
        if ($account !== []) {
            StripeConnectManager::syncUserFromAccountPayload($user, $account);
        }

        return response()->json([
            'success' => true,
            'account_id' => (string) ($accountLink['account_id'] ?? ''),
            'onboarding_url' => (string) ($accountLink['onboarding_url'] ?? ''),
            'details_submitted' => (bool) ($account['details_submitted'] ?? false),
            'charges_enabled' => (bool) ($account['charges_enabled'] ?? false),
            'payouts_enabled' => (bool) ($account['payouts_enabled'] ?? false),
            'external_account' => StripeConnectManager::transformExternalAccount(
                $this->firstExternalAccount($account)
            ),
        ]);
    }

    public function addExternalAccount(Request $request): JsonResponse
    {
        $data = $request->validate([
            'type' => ['required', 'string', 'in:bank,card'],
            'token_id' => ['required', 'string', 'max:255'],
        ]);

        $user = $this->resolveAuthenticatedUser($request);
        if (! $user) {
            return response()->json([
                'success' => false,
                'message' => 'Authentication required.',
            ], 401);
        }

        $result = StripeConnectManager::addExternalAccount(
            $user,
            (string) $data['token_id'],
            (string) $data['type']
        );
        if (! ($result['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'message' => (string) ($result['message'] ?? 'Unable to save payout method.'),
            ], (int) ($result['status'] ?? 500));
        }

        $account = is_array($result['account'] ?? null) ? $result['account'] : [];

        return response()->json([
            'success' => true,
            'message' => 'Payout method saved.',
            'account_id' => (string) ($result['account_id'] ?? ''),
            'details_submitted' => (bool) ($account['details_submitted'] ?? false),
            'charges_enabled' => (bool) ($account['charges_enabled'] ?? false),
            'payouts_enabled' => (bool) ($account['payouts_enabled'] ?? false),
            'external_account' => $result['external_account'] ?? null,
        ], 201);
    }

    public function refresh(Request $request): Response
    {
        $user = $this->resolveRefreshUser($request);
        if (! $user) {
            return $this->htmlResponse('Stripe Connect', 'Unable to refresh Stripe onboarding.', 404);
        }

        $accountId = (string) ($user->stripe_connect_account_id ?? '');
        $accountLink = StripeConnectManager::createAccountLink(
            $user,
            $this->buildRefreshUrl($request, $user, $accountId),
            $this->buildReturnUrl($request, $user, $accountId)
        );
        if (! ($accountLink['success'] ?? false)) {
            return $this->htmlResponse(
                'Stripe Connect',
                (string) ($accountLink['message'] ?? 'Unable to refresh Stripe onboarding.'),
                (int) ($accountLink['status'] ?? 500)
            );
        }

        return redirect()->away((string) ($accountLink['onboarding_url'] ?? ''));
    }

    public function complete(Request $request): Response
    {
        $user = $this->resolveRefreshUser($request);
        if ($user && filled((string) $user->stripe_connect_account_id)) {
            $accountResult = StripeConnectManager::retrieveAccount((string) $user->stripe_connect_account_id);
            if ($accountResult['success'] ?? false) {
                StripeConnectManager::syncUserFromAccountPayload($user, (array) ($accountResult['account'] ?? []));
            }
        }

        return $this->htmlResponse(
            'Stripe Connected',
            'Stripe onboarding is complete. You can return to the app and continue testing your withdraw flow.'
        );
    }

    private function resolveAuthenticatedUser(Request $request): ?User
    {
        $bearer = trim((string) $request->bearerToken());
        if ($bearer === '') {
            return null;
        }

        return User::query()->where('api_token', $bearer)->first();
    }

    private function resolveRefreshUser(Request $request): ?User
    {
        $userId = User::resolvePublicUserIdByIdentifier($request->query('user'));
        $accountId = trim((string) $request->query('account', ''));
        if (! $userId || $accountId === '') {
            return null;
        }

        return User::query()
            ->where('user_id', $userId)
            ->where('stripe_connect_account_id', $accountId)
            ->first();
    }

    private function buildRefreshUrl(Request $request, User $user, ?string $accountId = null): string
    {
        $resolvedAccountId = trim((string) ($accountId ?: $user->stripe_connect_account_id ?: ''));

        return $this->apiBaseUrl($request).'/stripe/connect/refresh?user='.urlencode((string) $user->user_id)
            .'&account='.urlencode($resolvedAccountId);
    }

    private function buildReturnUrl(Request $request, User $user, ?string $accountId = null): string
    {
        $resolvedAccountId = trim((string) ($accountId ?: $user->stripe_connect_account_id ?: ''));

        return $this->apiBaseUrl($request).'/stripe/connect/return?user='.urlencode((string) $user->user_id)
            .'&account='.urlencode($resolvedAccountId);
    }

    private function apiBaseUrl(Request $request): string
    {
        $currentUrl = rtrim((string) $request->url(), '/');
        foreach ([
            '/stripe/connect/refresh',
            '/stripe/connect/return',
            '/stripe/connect',
        ] as $suffix) {
            if (str_ends_with($currentUrl, $suffix)) {
                return substr($currentUrl, 0, -strlen($suffix));
            }
        }

        return rtrim($request->getSchemeAndHttpHost(), '/').'/api';
    }

    private function htmlResponse(string $title, string $message, int $status = 200): Response
    {
        $safeTitle = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
        $safeMessage = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');

        return response(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'.
            '<title>'.$safeTitle.'</title><style>body{font-family:Arial,sans-serif;background:#fff7fb;color:#321121;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}.card{max-width:520px;background:#fff;border:1px solid #f2c8da;border-radius:20px;padding:28px;box-shadow:0 18px 48px rgba(194,24,91,.08)}h1{margin:0 0 12px;font-size:28px}p{margin:0;font-size:16px;line-height:1.5}</style></head><body><div class="card"><h1>'.$safeTitle.'</h1><p>'.$safeMessage.'</p></div></body></html>',
            $status,
            ['Content-Type' => 'text/html; charset=UTF-8']
        );
    }

    private function firstExternalAccount(array $account): ?array
    {
        $items = is_array($account['external_accounts']['data'] ?? null)
            ? $account['external_accounts']['data']
            : [];

        foreach ($items as $item) {
            if (is_array($item)) {
                return $item;
            }
        }

        return null;
    }
}
