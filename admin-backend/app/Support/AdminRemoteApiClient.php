<?php

namespace App\Support;

use Illuminate\Support\Facades\Http;

class AdminRemoteApiClient
{
    public static function get(string $path): ?array
    {
        $token = self::token();
        if (! $token) {
            return null;
        }

        $response = Http::timeout(20)
            ->withHeaders(self::headers())
            ->withToken($token)
            ->get(self::baseUrl().'/'.ltrim($path, '/'));

        if (! $response->successful()) {
            return null;
        }

        return $response->json();
    }

    private static function token(): ?string
    {
        $baseUrl = self::baseUrl();
        $headers = self::headers();
        $email = trim((string) config('admin.remote_email'));
        $password = (string) config('admin.remote_password');

        if ($baseUrl === '' || $email === '' || $password === '' || empty($headers)) {
            return null;
        }

        $response = Http::timeout(15)
            ->withHeaders($headers)
            ->post($baseUrl.'/api/admin/login', [
                'email' => $email,
                'password' => $password,
                'remember' => true,
            ]);

        if (! $response->successful()) {
            return null;
        }

        $token = trim((string) $response->json('token'));
        return $token !== '' ? $token : null;
    }

    private static function baseUrl(): string
    {
        return rtrim((string) config('admin.remote_base_url'), '/');
    }

    private static function headers(): array
    {
        $apiKey = trim((string) config('admin.remote_api_key'));
        if ($apiKey === '') {
            return [];
        }

        return [
            (string) config('admin.api_key_header', 'X-ADMIN-API-KEY') => $apiKey,
            'Accept' => 'application/json',
        ];
    }
}
