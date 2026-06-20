<?php

namespace App\Support;

use App\Models\AdminAuditLog;
use App\Models\User;
use Illuminate\Http\Request;

class AdminAuditLogger
{
    public static function log(array $payload, ?Request $request = null, ?User $admin = null): AdminAuditLog
    {
        $request ??= request();
        $admin ??= $request?->attributes->get('admin_user');

        return AdminAuditLog::query()->create([
            'admin_user_id' => $admin?->id,
            'category' => trim((string) ($payload['category'] ?? 'other')) ?: 'other',
            'action' => trim((string) ($payload['action'] ?? 'updated')) ?: 'updated',
            'target_type' => self::nullableString($payload['target_type'] ?? null),
            'target_id' => self::nullableString($payload['target_id'] ?? null),
            'target_label' => self::nullableString($payload['target_label'] ?? null),
            'before' => self::normalizeArray($payload['before'] ?? null),
            'after' => self::normalizeArray($payload['after'] ?? null),
            'meta' => self::normalizeArray($payload['meta'] ?? null),
            'ip_address' => $request?->ip(),
            'user_agent' => self::nullableString($request?->userAgent()),
        ]);
    }

    private static function normalizeArray(mixed $value): ?array
    {
        return is_array($value) && $value !== [] ? $value : null;
    }

    private static function nullableString(mixed $value): ?string
    {
        $normalized = trim((string) ($value ?? ''));

        return $normalized !== '' ? $normalized : null;
    }
}
