<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class GhlContactManager
{
    public static function syncContactForUser(User $user, array $attributes = []): array
    {
        $configuration = self::ensureConfigured();
        if (! ($configuration['success'] ?? false)) {
            return $configuration;
        }

        $payload = self::buildPayload($user, $attributes);
        if (! self::hasIdentity($payload)) {
            return [
                'success' => false,
                'status' => 422,
                'message' => 'Email or phone is required to sync the GHL contact.',
            ];
        }

        $existingContact = self::resolveExistingContact($user, $payload);
        if (! ($existingContact['success'] ?? false)) {
            return $existingContact;
        }

        $contactId = trim((string) ($existingContact['contact_id'] ?? ''));
        if ($contactId !== '') {
            $update = self::updateContact($contactId, $payload);
            if ($update['success'] ?? false) {
                $resolvedContactId = self::extractContactId($update['payload'] ?? [], $contactId);
                self::persistContactId($user, $resolvedContactId);
                self::syncRoleTag($user, $resolvedContactId, $attributes);

                return [
                    ...$update,
                    'contact_id' => $resolvedContactId,
                    'created' => false,
                    'contact' => self::extractContactPayload($update['payload'] ?? []),
                ];
            }

            if (! self::isMissingContact($update)) {
                return $update;
            }

            self::persistContactId($user, null);
        }

        $create = self::createContact($payload);
        if ($create['success'] ?? false) {
            $resolvedContactId = self::extractContactId($create['payload'] ?? []);
            self::persistContactId($user, $resolvedContactId);
            self::syncRoleTag($user, $resolvedContactId, $attributes);

            return [
                ...$create,
                'contact_id' => $resolvedContactId,
                'created' => true,
                'contact' => self::extractContactPayload($create['payload'] ?? []),
            ];
        }

        if (self::looksLikeDuplicate($create)) {
            $duplicate = self::findDuplicateContact(
                (string) ($payload['email'] ?? ''),
                (string) ($payload['phone'] ?? '')
            );
            if ($duplicate['success'] ?? false) {
                $duplicateId = trim((string) ($duplicate['contact_id'] ?? ''));
                if ($duplicateId !== '') {
                    self::persistContactId($user, $duplicateId);
                    $update = self::updateContact($duplicateId, $payload);
                    if ($update['success'] ?? false) {
                        self::syncRoleTag($user, $duplicateId, $attributes);

                        return [
                            ...$update,
                            'contact_id' => $duplicateId,
                            'created' => false,
                            'contact' => self::extractContactPayload($update['payload'] ?? []),
                        ];
                    }
                }
            } elseif ((int) ($duplicate['status'] ?? 500) !== 404) {
                return $duplicate;
            }
        }

        return $create;
    }

    public static function updateContactForUser(User $user, array $attributes = []): array
    {
        $configuration = self::ensureConfigured();
        if (! ($configuration['success'] ?? false)) {
            return $configuration;
        }

        $payload = self::buildPayload($user, $attributes);
        $existingContact = self::resolveExistingContact($user, $payload);
        if (! ($existingContact['success'] ?? false)) {
            return $existingContact;
        }

        $contactId = trim((string) ($existingContact['contact_id'] ?? ''));
        if ($contactId === '') {
            return [
                'success' => false,
                'status' => 404,
                'message' => 'GHL contact not found.',
            ];
        }

        $update = self::updateContact($contactId, $payload);
        if ($update['success'] ?? false) {
            $resolvedContactId = self::extractContactId($update['payload'] ?? [], $contactId);
            self::persistContactId($user, $resolvedContactId);
            self::syncRoleTag($user, $resolvedContactId, $attributes);

            return [
                ...$update,
                'contact_id' => $resolvedContactId,
                'contact' => self::extractContactPayload($update['payload'] ?? []),
            ];
        }

        if (self::isMissingContact($update)) {
            self::persistContactId($user, null);

            $duplicate = self::findDuplicateContact(
                (string) ($payload['email'] ?? ''),
                (string) ($payload['phone'] ?? '')
            );
            if ($duplicate['success'] ?? false) {
                $duplicateId = trim((string) ($duplicate['contact_id'] ?? ''));
                if ($duplicateId !== '') {
                    $retry = self::updateContact($duplicateId, $payload);
                    if ($retry['success'] ?? false) {
                        self::persistContactId($user, $duplicateId);
                        self::syncRoleTag($user, $duplicateId, $attributes);

                        return [
                            ...$retry,
                            'contact_id' => $duplicateId,
                            'contact' => self::extractContactPayload($retry['payload'] ?? []),
                        ];
                    }
                }
            } elseif ((int) ($duplicate['status'] ?? 500) !== 404) {
                return $duplicate;
            }

            return [
                'success' => false,
                'status' => 404,
                'message' => 'GHL contact not found.',
            ];
        }

        return $update;
    }

    public static function deleteContactForUser(User $user, array $attributes = []): array
    {
        $configuration = self::ensureConfigured();
        if (! ($configuration['success'] ?? false)) {
            return $configuration;
        }

        $payload = self::buildPayload($user, $attributes);
        $existingContact = self::resolveExistingContact($user, $payload);
        if (! ($existingContact['success'] ?? false)) {
            return $existingContact;
        }

        $contactId = trim((string) ($existingContact['contact_id'] ?? ''));
        if ($contactId === '') {
            return [
                'success' => false,
                'status' => 404,
                'message' => 'GHL contact not found.',
            ];
        }

        $delete = self::deleteContact($contactId);
        if ($delete['success'] ?? false) {
            self::persistContactId($user, null);

            return [
                ...$delete,
                'contact_id' => $contactId,
            ];
        }

        if (self::isMissingContact($delete)) {
            self::persistContactId($user, null);

            $duplicate = self::findDuplicateContact(
                (string) ($payload['email'] ?? ''),
                (string) ($payload['phone'] ?? '')
            );
            if ($duplicate['success'] ?? false) {
                $duplicateId = trim((string) ($duplicate['contact_id'] ?? ''));
                if ($duplicateId !== '') {
                    $retry = self::deleteContact($duplicateId);
                    if ($retry['success'] ?? false) {
                        return [
                            ...$retry,
                            'contact_id' => $duplicateId,
                        ];
                    }
                }
            } elseif ((int) ($duplicate['status'] ?? 500) !== 404) {
                return $duplicate;
            }

            return [
                'success' => false,
                'status' => 404,
                'message' => 'GHL contact not found.',
            ];
        }

        return $delete;
    }

    private static function resolveExistingContact(User $user, array $payload): array
    {
        $storedContactId = trim((string) ($user->ghl_contact_id ?? ''));
        if ($storedContactId !== '') {
            return [
                'success' => true,
                'status' => 200,
                'contact_id' => $storedContactId,
            ];
        }

        return self::findDuplicateContact(
            (string) ($payload['email'] ?? ''),
            (string) ($payload['phone'] ?? '')
        );
    }

    private static function findDuplicateContact(string $email = '', string $phone = ''): array
    {
        $normalizedEmail = trim($email);
        $normalizedPhone = trim($phone);

        if ($normalizedEmail === '' && $normalizedPhone === '') {
            return [
                'success' => true,
                'status' => 200,
                'contact_id' => null,
                'contact' => null,
            ];
        }

        $response = self::request('get', '/contacts/search/duplicate', [], array_filter([
            'locationId' => self::locationId(),
            'email' => $normalizedEmail !== '' ? $normalizedEmail : null,
            'phone' => $normalizedPhone !== '' ? $normalizedPhone : null,
        ], static fn ($value) => filled($value)));

        if (($response['status'] ?? 500) === 404) {
            return [
                'success' => true,
                'status' => 404,
                'contact_id' => null,
                'contact' => null,
            ];
        }

        if (! ($response['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractMessage($response['payload'] ?? [], 'Unable to look up the GHL contact.'),
                'payload' => $response['payload'] ?? [],
            ];
        }

        $contactPayload = self::extractContactPayload($response['payload'] ?? []);
        $contactId = self::extractContactId($response['payload'] ?? []);

        return [
            'success' => true,
            'status' => 200,
            'contact_id' => $contactId !== '' ? $contactId : null,
            'contact' => $contactPayload !== [] ? $contactPayload : null,
            'payload' => $response['payload'] ?? [],
        ];
    }

    private static function createContact(array $payload): array
    {
        $response = self::request('post', '/contacts/', [
            'locationId' => self::locationId(),
            ...$payload,
        ]);
        if (! ($response['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractMessage($response['payload'] ?? [], 'Unable to create the GHL contact.'),
                'payload' => $response['payload'] ?? [],
            ];
        }

        return [
            'success' => true,
            'status' => (int) ($response['status'] ?? 201),
            'payload' => $response['payload'] ?? [],
        ];
    }

    private static function updateContact(string $contactId, array $payload): array
    {
        $response = self::request('put', '/contacts/'.$contactId, $payload);
        if (! ($response['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractMessage($response['payload'] ?? [], 'Unable to update the GHL contact.'),
                'payload' => $response['payload'] ?? [],
            ];
        }

        return [
            'success' => true,
            'status' => (int) ($response['status'] ?? 200),
            'payload' => $response['payload'] ?? [],
        ];
    }

    private static function deleteContact(string $contactId): array
    {
        $response = self::request('delete', '/contacts/'.$contactId);
        if (! ($response['ok'] ?? false)) {
            return [
                'success' => false,
                'status' => (int) ($response['status'] ?? 500),
                'message' => self::extractMessage($response['payload'] ?? [], 'Unable to delete the GHL contact.'),
                'payload' => $response['payload'] ?? [],
            ];
        }

        return [
            'success' => true,
            'status' => (int) ($response['status'] ?? 200),
            'payload' => $response['payload'] ?? [],
        ];
    }

    private static function buildPayload(User $user, array $attributes = []): array
    {
        [$firstName, $lastName] = self::splitName(
            trim((string) ($attributes['name'] ?? $user->name ?? ''))
        );
        $attachments = self::buildAttachments($attributes);

        return array_filter([
            'firstName' => trim((string) ($attributes['first_name'] ?? $firstName)),
            'lastName' => trim((string) ($attributes['last_name'] ?? $lastName)),
            'email' => trim((string) ($attributes['email'] ?? $user->email ?? '')),
            'phone' => trim((string) ($attributes['phone'] ?? '')),
            'address1' => trim((string) ($attributes['address'] ?? '')),
            'city' => trim((string) ($attributes['city'] ?? '')),
            'country' => trim((string) ($attributes['country'] ?? '')),
            'attachments' => $attachments !== [] ? $attachments : null,
        ], static fn ($value) => filled($value));
    }

    private static function hasIdentity(array $payload): bool
    {
        return filled((string) ($payload['email'] ?? '')) || filled((string) ($payload['phone'] ?? ''));
    }

    private static function splitName(string $fullName): array
    {
        $parts = array_values(array_filter(preg_split('/\s+/', trim($fullName)) ?: []));
        if ($parts === []) {
            return ['', ''];
        }

        $firstName = (string) ($parts[0] ?? '');
        $lastName = count($parts) > 1 ? implode(' ', array_slice($parts, 1)) : '';

        return [$firstName, $lastName];
    }

    private static function buildAttachments(array $attributes = []): array
    {
        $candidates = [];
        $rawAttachments = $attributes['attachments'] ?? $attributes['image_urls'] ?? null;

        if (is_array($rawAttachments)) {
            $candidates = $rawAttachments;
        } elseif ($rawAttachments !== null) {
            $candidates[] = $rawAttachments;
        }

        foreach ([
            'image_url',
            'user_image_url',
            'profile_image_url',
        ] as $key) {
            if (array_key_exists($key, $attributes)) {
                $candidates[] = $attributes[$key];
            }
        }

        $attachments = [];
        foreach ($candidates as $candidate) {
            $url = trim((string) $candidate);
            if ($url === '') {
                continue;
            }
            if (! str_starts_with($url, 'http://') && ! str_starts_with($url, 'https://')) {
                continue;
            }
            $attachments[] = $url;
        }

        return array_values(array_unique($attachments));
    }

    private static function syncRoleTag(User $user, ?string $contactId, array $attributes = []): void
    {
        $normalizedContactId = trim((string) ($contactId ?? ''));
        $tag = self::roleTagForUser($user, $attributes);
        if ($normalizedContactId === '' || $tag === '') {
            return;
        }

        $payloadVariants = [
            ['tags' => [$tag]],
            ['tags' => [$tag], 'locationId' => self::locationId()],
        ];

        $lastResult = null;
        foreach ($payloadVariants as $payload) {
            $response = self::request('post', '/contacts/'.$normalizedContactId.'/tags', $payload);
            if ($response['ok'] ?? false) {
                return;
            }

            if (self::isRoleTagAlreadyPresent($response)) {
                return;
            }

            $lastResult = $response;
        }

        Log::warning('ghl.contact_manager.tag_sync_failed', [
            'user_id' => $user->user_id,
            'contact_id' => $normalizedContactId,
            'tag' => $tag,
            'status' => $lastResult['status'] ?? null,
            'payload' => $lastResult['payload'] ?? [],
        ]);
    }

    private static function roleTagForUser(User $user, array $attributes = []): string
    {
        $role = strtolower(trim((string) ($attributes['role'] ?? $user->role ?? '')));

        return match ($role) {
            'parent', 'client' => 'parent',
            'syttr', 'nanny' => 'syttr',
            default => '',
        };
    }

    private static function isRoleTagAlreadyPresent(array $response): bool
    {
        $message = strtolower(trim(self::extractMessage($response['payload'] ?? [], '')));
        if ($message === '') {
            return false;
        }

        return str_contains($message, 'already') || str_contains($message, 'exist') || str_contains($message, 'duplicate');
    }

    private static function persistContactId(User $user, ?string $contactId): void
    {
        $normalizedContactId = trim((string) ($contactId ?? ''));
        $user->forceFill([
            'ghl_contact_id' => $normalizedContactId !== '' ? $normalizedContactId : null,
        ])->save();
    }

    private static function ensureConfigured(): array
    {
        if (! filled(self::locationId()) || ! filled(self::apiToken())) {
            return [
                'success' => false,
                'status' => 500,
                'message' => 'GHL is not configured.',
            ];
        }

        return [
            'success' => true,
            'status' => 200,
        ];
    }

    private static function request(string $method, string $path, array $payload = [], array $query = []): array
    {
        $url = rtrim((string) config('services.ghl.base_url', 'https://services.leadconnectorhq.com'), '/')
            .'/'.ltrim($path, '/');
        if ($query !== []) {
            $url .= '?'.http_build_query($query);
        }

        try {
            $response = Http::withOptions([
                    'verify' => (bool) config('services.ghl.verify_ssl', true),
                ])
                ->acceptJson()
                ->withHeaders([
                    'Authorization' => 'Bearer '.self::apiToken(),
                    'Version' => self::apiVersion(),
                ])
                ->connectTimeout(5)
                ->timeout(20)
                ->send(strtoupper($method), $url, match (strtoupper($method)) {
                    'GET', 'DELETE' => [],
                    default => ['json' => $payload],
                });

            $decoded = $response->json();
            $responsePayload = is_array($decoded)
                ? $decoded
                : ['message' => trim((string) $response->body())];

            return [
                'ok' => $response->successful(),
                'status' => $response->status(),
                'payload' => $responsePayload,
            ];
        } catch (\Throwable $e) {
            Log::error('ghl.contact_manager.request_exception', [
                'method' => strtoupper($method),
                'path' => $path,
                'query' => $query,
                'error' => $e->getMessage(),
            ]);

            return [
                'ok' => false,
                'status' => 500,
                'payload' => [
                    'message' => $e->getMessage(),
                ],
            ];
        }
    }

    private static function extractContactPayload(array $payload): array
    {
        foreach ([
            'contact',
            'data.contact',
            'data',
            'result.contact',
            'result',
        ] as $key) {
            $candidate = data_get($payload, $key);
            if (is_array($candidate)) {
                return $candidate;
            }
        }

        return $payload;
    }

    private static function extractContactId(array $payload, ?string $fallback = null): string
    {
        foreach ([
            'contact.id',
            'data.contact.id',
            'data.id',
            'result.contact.id',
            'result.id',
            'id',
            'contactId',
            'contact_id',
        ] as $key) {
            $candidate = trim((string) data_get($payload, $key, ''));
            if ($candidate !== '') {
                return $candidate;
            }
        }

        return trim((string) ($fallback ?? ''));
    }

    private static function extractMessage(array $payload, string $fallback): string
    {
        foreach ([
            'message',
            'error.message',
            'error',
            'meta.message',
        ] as $key) {
            $rawCandidate = data_get($payload, $key, '');
            if (is_array($rawCandidate)) {
                $candidate = trim((string) (
                    data_get($rawCandidate, 'message')
                    ?? data_get($rawCandidate, 'error')
                    ?? data_get($rawCandidate, 'detail')
                    ?? data_get($rawCandidate, 'description')
                    ?? ''
                ));
            } else {
                $candidate = trim((string) $rawCandidate);
            }
            if ($candidate !== '') {
                return $candidate;
            }
        }

        return $fallback;
    }

    private static function isMissingContact(array $result): bool
    {
        if ((int) ($result['status'] ?? 500) === 404) {
            return true;
        }

        $message = strtolower(trim((string) ($result['message'] ?? '')));

        return $message !== '' && str_contains($message, 'not found');
    }

    private static function looksLikeDuplicate(array $result): bool
    {
        $status = (int) ($result['status'] ?? 500);
        if (! in_array($status, [400, 409, 422], true)) {
            return false;
        }

        $message = strtolower(trim((string) ($result['message'] ?? '')));

        return str_contains($message, 'duplicate');
    }

    private static function apiToken(): string
    {
        return trim((string) config('services.ghl.api_token', ''));
    }

    private static function locationId(): string
    {
        return trim((string) config('services.ghl.location_id', ''));
    }

    private static function apiVersion(): string
    {
        return trim((string) config('services.ghl.api_version', '2021-07-28')) ?: '2021-07-28';
    }
}
