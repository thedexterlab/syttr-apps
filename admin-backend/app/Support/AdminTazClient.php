<?php

namespace App\Support;

use Illuminate\Support\Facades\Http;

class AdminTazClient
{
    public function isConfigured(): bool
    {
        return trim((string) config('services.taz.base_url', '')) !== ''
            && trim((string) config('services.taz.jwt', '')) !== '';
    }

    public function fetchOrderStatus(string $orderGuid): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }

        $result = $this->request(
            $this->statusPaths($orderGuid),
            'application/json'
        );

        if (! $result['ok']) {
            return null;
        }

        $payload = $result['data'];

        return [
            'status' => AppDataHelper::displayTazStatus((string) ($payload['status'] ?? $payload['order_status'] ?? $payload['state'] ?? '')),
            'payload' => $payload,
        ];
    }

    public function downloadOrderPdf(string $orderGuid): ?array
    {
        if (! $this->isConfigured()) {
            return null;
        }

        $result = $this->request($this->pdfPaths($orderGuid), 'application/pdf');
        if (! $result['ok']) {
            return null;
        }

        return [
            'content' => $result['body'],
            'content_type' => $result['content_type'] ?: 'application/pdf',
            'filename' => 'taz-report-'.$orderGuid.'.pdf',
        ];
    }

    private function request(array $paths, string $accept): array
    {
        $baseUrl = rtrim((string) config('services.taz.base_url', ''), '/');
        $jwt = trim((string) config('services.taz.jwt', ''));
        $verifySsl = (bool) config('services.taz.verify_ssl', false);
        $lastData = [];

        foreach ($paths as $path) {
            $url = $baseUrl.'/'.ltrim($path, '/');
            foreach ($this->authHeaderVariants($jwt) as $authHeaders) {
                try {
                    $request = Http::timeout(20)->withHeaders([
                        'Accept' => $accept,
                        'User-Agent' => 'SyttrAdmin/1.0',
                        ...$authHeaders,
                    ]);

                    if (! $verifySsl) {
                        $request = $request->withoutVerifying();
                    }

                    $response = $request->get($url);
                    if (! $response->successful()) {
                        continue;
                    }

                    $contentType = strtolower(trim((string) $response->header('Content-Type', '')));
                    $body = (string) $response->body();

                    if ($accept === 'application/pdf') {
                        if (
                            str_contains($contentType, 'application/pdf')
                            || str_starts_with($body, '%PDF')
                        ) {
                            return [
                                'ok' => true,
                                'body' => $body,
                                'content_type' => $contentType,
                                'data' => [],
                            ];
                        }

                        continue;
                    }

                    $data = $response->json();
                    $lastData = is_array($data) ? $data : [];

                    return [
                        'ok' => true,
                        'body' => $body,
                        'content_type' => $contentType,
                        'data' => $lastData,
                    ];
                } catch (\Throwable) {
                    continue;
                }
            }
        }

        return [
            'ok' => false,
            'body' => '',
            'content_type' => '',
            'data' => $lastData,
        ];
    }

    private function statusPaths(string $orderGuid): array
    {
        return $this->uniquePaths([
            $this->replaceOrderPath((string) config('services.taz.status_path', ''), $orderGuid),
            '/v1/orders/{order_guid}',
            '/api/v1/orders/{order_guid}',
            '/orders/{order_guid}',
        ], $orderGuid);
    }

    private function pdfPaths(string $orderGuid): array
    {
        return $this->uniquePaths([
            $this->replaceOrderPath((string) config('services.taz.pdf_path', ''), $orderGuid),
            '/v1/orders/{order_guid}/pdf',
            '/api/v1/orders/{order_guid}/pdf',
            '/v1/orders/{order_guid}/report/pdf',
            '/api/v1/orders/{order_guid}/report/pdf',
            '/v1/orders/{order_guid}/report',
        ], $orderGuid);
    }

    private function uniquePaths(array $paths, string $orderGuid): array
    {
        $resolved = [];
        foreach ($paths as $path) {
            $clean = $this->replaceOrderPath((string) $path, $orderGuid);
            $clean = '/'.ltrim(trim($clean), '/');
            if ($clean !== '/' && ! in_array($clean, $resolved, true)) {
                $resolved[] = $clean;
            }
        }

        return $resolved;
    }

    private function replaceOrderPath(string $path, string $orderGuid): string
    {
        return str_replace(
            ['{order_guid}', '{orderGuid}', ':order_guid', ':orderGuid'],
            rawurlencode($orderGuid),
            $path
        );
    }

    private function authHeaderVariants(string $jwt): array
    {
        if ($jwt === '') {
            return [[]];
        }

        return [
            [
                'Authorization' => 'Bearer '.$jwt,
                'X-JWT-Token' => $jwt,
            ],
            [
                'Authorization' => 'JWT '.$jwt,
            ],
            [
                'Authorization' => 'Token '.$jwt,
            ],
            [
                'x-api-key' => $jwt,
            ],
        ];
    }
}
