<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\NannyVerificationGateResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        return $this->attemptLogin($request, ['parent', 'client']);
    }

    public function syttrLogin(Request $request): JsonResponse
    {
        return $this->attemptLogin($request, ['syttr', 'nanny']);
    }

    // Compatibility route for existing frontend naming.
    public function nannyLogin(Request $request): JsonResponse
    {
        return $this->attemptLogin($request, ['syttr', 'nanny']);
    }

    private function attemptLogin(Request $request, string|array $roles): JsonResponse
    {
        User::purgeExpiredScheduledDeletionAccounts();
        $allowedRoles = array_values(array_filter(array_map(
            static fn ($value) => strtolower(trim((string) $value)),
            (array) $roles
        )));
        $primaryRole = $allowedRoles[0] ?? '';

        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        /** @var User|null $user */
        $user = User::where('email', $data['email'])->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            return response()->json(['message' => 'Invalid credentials'], 401);
        }

        $userRole = strtolower(trim((string) $user->role));
        if (! in_array($userRole, $allowedRoles, true)) {
            return response()->json(['message' => 'Invalid account type for this login route'], 403);
        }

        if ($user->isDeactivated()) {
            return response()->json(['message' => 'This account has been deactivated.'], 403);
        }

        if (! $user->user_id || ctype_digit((string) $user->user_id)) {
            $user->user_id = User::generatePublicUserId();
        }
        if (! $user->referral_code) {
            $user->referral_code = User::generateReferralCode();
        }
        $restoredScheduledDeletion = $user->restoreScheduledDeletion();
        $user->api_token = hash('sha256', Str::random(60));
        $user->save();

        $profileStatus = strtolower(trim((string) ($user->profile_status ?? '')));
        if ($profileStatus === '') {
            $profileStatus = in_array($primaryRole, ['syttr', 'nanny'], true) ? 'pending' : 'active';
        }
        if ((bool) $user->is_blacklisted) {
            $profileStatus = 'blacklisted';
        }
        $interviewStatus = strtolower(trim((string) ($user->interview?->status ?? '')));
        $verificationRequired = NannyVerificationGateResolver::requiresVerificationGate(
            $userRole,
            $profileStatus,
            $interviewStatus,
            (bool) $user->is_blacklisted
        );
        $referralBase = rtrim((string) env('FRONTEND_URL', 'https://syttr.com'), '/');
        $referralLink = $user->referral_code
            ? $referralBase.'/r/'.rawurlencode((string) $user->referral_code)
            : null;

        return response()->json([
            'message' => 'Login successful',
            'deletion_restored' => $restoredScheduledDeletion,
            'token' => $user->api_token,
            'user_id' => $user->user_id,
            'internal_user_id' => $user->id,
            'user_type' => $primaryRole !== '' ? $primaryRole : $userRole,
            'status' => $profileStatus,
            'approval_status' => $profileStatus,
            'verification_required' => $verificationRequired,
            'interview_completed' => $this->isInterviewCompleted($profileStatus, $interviewStatus, (bool) $user->is_blacklisted),
            'interview_status' => $interviewStatus !== '' ? $interviewStatus : null,
            'is_blacklisted' => (bool) $user->is_blacklisted,
            'blacklisted_reason' => $user->blacklisted_reason,
            'referral_code' => $user->referral_code,
            'referral_link' => $referralLink,
            'user' => $user,
        ]);
    }

    private function isInterviewCompleted(string $profileStatus, string $interviewStatus, bool $isBlacklisted): bool
    {
        if (NannyVerificationGateResolver::adminDecision($profileStatus, $isBlacklisted) === 'approved') {
            return true;
        }

        return in_array($interviewStatus, ['approved', 'completed'], true);
    }
}
