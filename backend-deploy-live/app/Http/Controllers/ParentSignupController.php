<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\GhlContactManager;
use App\Support\WelcomeEmailSender;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class ParentSignupController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => $data['password'],
            'role' => 'parent',
            'profile_status' => 'active',
            'profile_status_updated_at' => now(),
            'is_blacklisted' => false,
        ]);
        $user->api_token = hash('sha256', Str::random(60));
        $user->save();
        $this->deferGhlContactSync((int) $user->id);
        $this->deferWelcomeEmail((int) $user->id);
        $referralBase = rtrim((string) env('FRONTEND_URL', 'https://syttr.com'), '/');
        $referralLink = $user->referral_code
            ? $referralBase.'/r/'.rawurlencode((string) $user->referral_code)
            : null;

        return response()->json([
            'message' => 'Parent signup successful',
            'token' => $user->api_token,
            'user_id' => $user->user_id,
            'internal_user_id' => $user->id,
            'user_type' => 'parent',
            'referral_code' => $user->referral_code,
            'referral_link' => $referralLink,
            'user' => $user,
        ], 201);
    }

    private function deferGhlContactSync(int $internalUserId): void
    {
        app()->terminating(function () use ($internalUserId): void {
            try {
                $user = User::query()->find($internalUserId);
                if (! $user) {
                    return;
                }

                $ghlResult = GhlContactManager::syncContactForUser($user);
                if (! ($ghlResult['success'] ?? false)) {
                    Log::warning('parent_signup.ghl_sync_failed', [
                        'user_id' => $user->user_id,
                        'status' => $ghlResult['status'] ?? null,
                        'message' => $ghlResult['message'] ?? null,
                    ]);
                }
            } catch (\Throwable $e) {
                Log::warning('parent_signup.deferred_ghl_sync_failed', [
                    'internal_user_id' => $internalUserId,
                    'message' => $e->getMessage(),
                ]);
            }
        });
    }

    private function deferWelcomeEmail(int $internalUserId): void
    {
        app()->terminating(function () use ($internalUserId): void {
            try {
                $user = User::query()->find($internalUserId);
                if (! $user) {
                    return;
                }

                WelcomeEmailSender::sendForUser($user);
            } catch (\Throwable $e) {
                Log::warning('parent_signup.deferred_welcome_email_failed', [
                    'internal_user_id' => $internalUserId,
                    'message' => $e->getMessage(),
                ]);
            }
        });
    }
}
