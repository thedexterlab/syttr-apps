<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

class WelcomeEmailSender
{
    public static function sendForUser(User $user): bool
    {
        $email = strtolower(trim((string) ($user->email ?? '')));
        if ($email === '') {
            return false;
        }

        $appName = (string) config('app.name', 'Syttr');
        $role = strtolower(trim((string) ($user->role ?? '')));
        $roleLabel = match ($role) {
            'syttr', 'nanny' => 'Syttr',
            'parent', 'client' => 'Parent',
            default => 'User',
        };
        $frontendUrl = rtrim((string) env('FRONTEND_URL', 'https://syttr.com'), '/');
        $subject = 'Welcome to '.$appName.' Beta';
        $body = implode("\n\n", [
            'Hi '.trim((string) ($user->name ?? 'there')).',',
            'Welcome to '.$appName.' Beta. Your '.$roleLabel.' account is now registered.',
            'You can continue here: '.$frontendUrl,
            'If this was not you, please contact support right away.',
            'Thanks,',
            $appName.' Team',
        ]);

        try {
            Mail::raw($body, function ($message) use ($email, $subject): void {
                $message->to($email)->subject($subject);
            });

            return true;
        } catch (\Throwable $e) {
            Log::warning('welcome_email.send_failed', [
                'user_id' => $user->user_id,
                'email' => $email,
                'error' => $e->getMessage(),
            ]);

            return false;
        }
    }
}

