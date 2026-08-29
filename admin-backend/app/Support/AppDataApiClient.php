<?php

namespace App\Support;

use Illuminate\Support\Facades\Http;

class AppDataApiClient
{
    public static function nannies(int $perPage = 100): array
    {
        $payload = static::get('api/nannies', [
            'page' => 1,
            'per_page' => $perPage,
        ]);

        $data = $payload['data'] ?? [];
        $rows = is_array($data) && array_is_list($data)
            ? $data
            : (is_array($data) ? ($data['data'] ?? []) : []);

        return [
            'rows' => is_array($rows) ? $rows : [],
            'total' => count($rows),
        ];
    }

    public static function parents(): array
    {
        $payload = static::get('api/profiles/parents');

        return is_array($payload) && array_is_list($payload) ? $payload : [];
    }

    public static function jobs(int $perPage = 100): array
    {
        $payload = static::get('api/job/index', [
            'per_page' => $perPage,
        ]);

        $jobs = $payload['jobs'] ?? $payload['data']['jobs'] ?? $payload['data']['data'] ?? [];

        return is_array($jobs) ? $jobs : [];
    }

    private static function get(string $path, array $query = []): array
    {
        $baseUrl = rtrim((string) config('services.app_data.base_url', ''), '/');
        if ($baseUrl === '') {
            return [];
        }

        try {
            $response = Http::acceptJson()
                ->timeout((int) env('APP_DATA_API_TIMEOUT', 10))
                ->get($baseUrl.'/'.ltrim($path, '/'), $query);

            if (! $response->ok()) {
                return [];
            }

            $json = $response->json();

            return is_array($json) ? $json : [];
        } catch (\Throwable) {
            return [];
        }
    }
}
