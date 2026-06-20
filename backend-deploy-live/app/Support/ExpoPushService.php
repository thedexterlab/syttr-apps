<?php

namespace App\Support;

use App\Models\UserPushToken;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ExpoPushService
{
    private const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

    public static function sendToUser(string $userId, array $message): void
    {
        $normalizedUserId = strtoupper(trim($userId));
        if ($normalizedUserId === '') {
            return;
        }

        $tokens = UserPushToken::query()
            ->where('user_id', $normalizedUserId)
            ->where('is_active', true)
            ->pluck('expo_push_token')
            ->filter(static fn ($token) => self::isExpoPushToken((string) $token))
            ->values();

        if ($tokens->isEmpty()) {
            return;
        }

        self::sendToTokens($tokens, $message);
    }

    public static function sendToTokens(Collection $tokens, array $message): void
    {
        $chunks = $tokens->chunk(100);

        foreach ($chunks as $chunk) {
            $payload = $chunk->map(static function ($token) use ($message): array {
                return array_filter([
                    'to' => (string) $token,
                    'title' => $message['title'] ?? null,
                    'body' => $message['body'] ?? null,
                    'data' => $message['data'] ?? null,
                    'sound' => $message['sound'] ?? 'default',
                    'badge' => $message['badge'] ?? null,
                    'channelId' => $message['channelId'] ?? null,
                    'priority' => $message['priority'] ?? 'high',
                ], static fn ($value) => $value !== null);
            })->values()->all();

            try {
                $request = Http::timeout(15)->acceptJson();
                $accessToken = trim((string) config('services.expo.access_token', ''));
                if ($accessToken !== '') {
                    $request = $request->withToken($accessToken);
                }

                $response = $request->post(self::ENDPOINT, $payload);

                if (! $response->successful()) {
                    Log::warning('expo_push.request_failed', [
                        'status' => $response->status(),
                        'body' => $response->json() ?? $response->body(),
                    ]);
                    continue;
                }

                $data = $response->json('data', []);
                if (! is_array($data)) {
                    continue;
                }

                foreach ($data as $index => $ticket) {
                    $status = strtolower(trim((string) ($ticket['status'] ?? '')));
                    if ($status === 'ok') {
                        continue;
                    }

                    $token = (string) ($payload[$index]['to'] ?? '');
                    $details = is_array($ticket['details'] ?? null) ? $ticket['details'] : [];
                    $error = strtolower(trim((string) ($details['error'] ?? $ticket['message'] ?? '')));

                    Log::warning('expo_push.ticket_failed', [
                        'token' => $token,
                        'ticket' => $ticket,
                    ]);

                    if (in_array($error, ['deviceNotRegistered', 'devicenotregistered'], true)) {
                        UserPushToken::query()
                            ->where('expo_push_token', $token)
                            ->update(['is_active' => false]);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning('expo_push.exception', [
                    'message' => $e->getMessage(),
                ]);
            }
        }
    }

    private static function isExpoPushToken(string $value): bool
    {
        return preg_match('/^ExponentPushToken\[[^\]]+\]$/', $value) === 1
            || preg_match('/^ExpoPushToken\[[^\]]+\]$/', $value) === 1;
    }
}
