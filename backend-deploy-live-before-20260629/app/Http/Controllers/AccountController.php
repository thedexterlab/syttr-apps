<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class AccountController extends Controller
{
    private const RESET_CODE_EXPIRY_MINUTES = 10;

    public function sendPasswordResetCode(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
        ]);

        $email = strtolower(trim((string) $data['email']));
        $user = User::query()->where('email', $email)->first();

        if (! $user) {
            return response()->json([
                'message' => 'No account found with this email address.',
            ], 404);
        }

        $code = (string) random_int(100000, 999999);
        DB::table('password_reset_tokens')->updateOrInsert(
            ['email' => $email],
            [
                'token' => Hash::make($code),
                'created_at' => Carbon::now(),
            ]
        );

        $appName = (string) config('app.name', 'Syttr');
        $expiresIn = self::RESET_CODE_EXPIRY_MINUTES;
        $subject = $appName.' password reset code';
        $body = implode("\n", [
            'Your '.$appName.' password reset code is: '.$code,
            'This code expires in '.$expiresIn.' minutes.',
            'If you did not request this, you can ignore this email.',
        ]);

        try {
            Mail::raw($body, function ($message) use ($email, $subject): void {
                $message->to($email)->subject($subject);
            });
        } catch (\Throwable $exception) {
            Log::error('[Account] send_password_reset_code_failed', [
                'email' => $email,
                'error' => $exception->getMessage(),
            ]);

            return response()->json([
                'message' => 'Unable to send verification code right now.',
            ], 500);
        }

        $mailer = strtolower((string) config('mail.default', ''));
        $debugMode = app()->environment(['local', 'development', 'testing']) || in_array($mailer, ['log', 'array'], true);

        $payload = [
            'success' => true,
            'message' => 'Verification code sent successfully.',
            'expires_in_minutes' => $expiresIn,
        ];
        if ($debugMode) {
            $payload['debug_code'] = $code;
        }

        return response()->json($payload);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['nullable', 'email'],
            'user_id' => ['nullable'],
            'current_password' => ['nullable', 'string'],
            'new_password' => ['required', 'string', 'min:6'],
            'password' => ['nullable', 'string', 'min:6'],
            'code' => ['nullable', 'string'],
        ]);

        $isAuthenticatedChange = ! empty($data['current_password']);
        $emailForReset = strtolower(trim((string) ($data['email'] ?? '')));

        if (! $isAuthenticatedChange && $emailForReset === '') {
            return response()->json(['message' => 'Email is required.'], 422);
        }

        $user = $isAuthenticatedChange
            ? $this->resolveUser($request, $data)
            : User::query()->where('email', $emailForReset)->first();
        if (! $user) {
            return response()->json(['message' => 'User not found.'], 404);
        }

        // If current_password is provided, enforce verification.
        if (! empty($data['current_password']) && ! Hash::check($data['current_password'], $user->password)) {
            return response()->json(['message' => 'Current password is invalid.'], 422);
        }

        $nextPassword = $data['new_password'] ?? $data['password'] ?? null;
        if (! $nextPassword) {
            return response()->json(['message' => 'New password is required.'], 422);
        }

        $code = trim((string) ($data['code'] ?? ''));
        if (! $isAuthenticatedChange) {
            if ($code === '') {
                return response()->json(['message' => 'Verification code is required.'], 422);
            }

            $this->validateResetCodeForUser($user, $code);
        }

        $user->password = Hash::make($nextPassword);
        $user->save();

        if ($code !== '') {
            DB::table('password_reset_tokens')
                ->where('email', strtolower(trim((string) $user->email)))
                ->delete();
        }

        return response()->json([
            'success' => true,
            'message' => 'Password updated successfully.',
        ]);
    }

    private function resolveUser(Request $request, array $data): ?User
    {
        if (! empty($data['email'])) {
            $byEmail = User::query()->where('email', strtolower(trim((string) $data['email'])))->first();
            if ($byEmail) return $byEmail;
        }

        if (! empty($data['user_id'])) {
            $publicId = User::resolvePublicUserIdByIdentifier($data['user_id']);
            if ($publicId) {
                return User::query()->where('user_id', $publicId)->first();
            }
        }

        $bearer = trim((string) $request->bearerToken());
        if ($bearer !== '') {
            return User::query()->where('api_token', $bearer)->first();
        }

        return null;
    }

    private function validateResetCodeForUser(User $user, string $code): void
    {
        $email = strtolower(trim((string) $user->email));
        $record = DB::table('password_reset_tokens')
            ->where('email', $email)
            ->first();

        if (! $record) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json([
                'message' => 'Verification code is invalid or expired.',
            ], 422));
        }

        $createdAt = isset($record->created_at) ? Carbon::parse((string) $record->created_at) : null;
        if (! $createdAt || $createdAt->lt(Carbon::now()->subMinutes(self::RESET_CODE_EXPIRY_MINUTES))) {
            DB::table('password_reset_tokens')->where('email', $email)->delete();
            throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json([
                'message' => 'Verification code has expired. Please request a new one.',
            ], 422));
        }

        if (! Hash::check($code, (string) $record->token)) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json([
                'message' => 'Verification code is invalid or expired.',
            ], 422));
        }
    }
}
