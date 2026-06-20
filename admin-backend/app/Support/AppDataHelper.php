<?php

namespace App\Support;

use App\Models\AppData\AppUser;
use App\Models\AppData\CacheEntry;
use App\Models\AppData\ParentJobApplication;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Schema;

class AppDataHelper
{
    public static function hasTable(string $table): bool
    {
        try {
            return Schema::connection('app_data')->hasTable($table);
        } catch (\Throwable) {
            return false;
        }
    }

    public static function assetBaseUrl(): string
    {
        return rtrim((string) config('services.app_data.asset_base_url', ''), '/');
    }

    public static function assetUrl(?string $path): ?string
    {
        $raw = trim((string) ($path ?? ''));
        if ($raw === '') {
            return null;
        }

        if (str_starts_with($raw, 'http://') || str_starts_with($raw, 'https://')) {
            return $raw;
        }

        $baseUrl = static::assetBaseUrl();
        if ($baseUrl === '') {
            return null;
        }

        $normalized = ltrim($raw, '/');
        if (
            str_starts_with($normalized, 'storage/')
            || str_starts_with($normalized, 'public/')
        ) {
            return $baseUrl.'/'.$normalized;
        }

        return $baseUrl.'/storage/'.$normalized;
    }

    public static function parentStatusLabel(?AppUser $user): string
    {
        if (! $user) {
            return 'Unverified';
        }

        if ($user->deactivated_at) {
            return 'Deactivated';
        }

        if ((bool) $user->is_blacklisted) {
            return 'Blacklisted';
        }

        $raw = strtolower(trim((string) ($user->profile_status ?? '')));
        if ($raw === '') {
            return 'Unverified';
        }

        if (
            str_contains($raw, 'verified') ||
            str_contains($raw, 'approv') ||
            str_contains($raw, 'active') ||
            str_contains($raw, 'complete') ||
            str_contains($raw, 'clear')
        ) {
            return 'Verified';
        }

        if (str_contains($raw, 'blacklist') || str_contains($raw, 'reject')) {
            return 'Blacklisted';
        }

        if (str_contains($raw, 'expire')) {
            return 'Expire';
        }

        return 'Unverified';
    }

    public static function nannyStatusLabel(?AppUser $user): string
    {
        if (! $user) {
            return 'Pending';
        }

        if ($user->deactivated_at) {
            return 'Deactivated';
        }

        if ((bool) $user->is_blacklisted) {
            return 'Blacklisted';
        }

        $raw = strtolower(trim((string) ($user->profile_status ?? '')));
        if ($raw === '') {
            return 'Pending';
        }

        if (str_contains($raw, 'pending_verification') || str_contains($raw, 'pending verification')) {
            return 'Pending Verification';
        }

        if (
            str_contains($raw, 'verified') ||
            str_contains($raw, 'approv') ||
            str_contains($raw, 'active') ||
            str_contains($raw, 'complete') ||
            str_contains($raw, 'clear')
        ) {
            return 'Approved';
        }

        if (str_contains($raw, 'blacklist') || str_contains($raw, 'reject')) {
            return 'Blacklisted';
        }

        return 'Pending';
    }

    public static function displayTazStatus(?string $value): ?string
    {
        $raw = strtolower(trim((string) ($value ?? '')));
        if ($raw === '') {
            return null;
        }

        if (
            str_contains($raw, 'verified') ||
            str_contains($raw, 'approv') ||
            str_contains($raw, 'complete') ||
            str_contains($raw, 'clear')
        ) {
            return 'Verified';
        }

        if (
            str_contains($raw, 'fail') ||
            str_contains($raw, 'reject') ||
            str_contains($raw, 'deny') ||
            str_contains($raw, 'blacklist')
        ) {
            return 'Blacklisted';
        }

        if (str_contains($raw, 'expire')) {
            return 'Expired';
        }

        if (str_contains($raw, 'pend')) {
            return 'Pending';
        }

        return ucfirst($raw);
    }

    public static function normalizeParentUpdate(string $status): array
    {
        $raw = strtolower(trim($status));

        return match ($raw) {
            'verified' => ['profile_status' => 'verified', 'is_blacklisted' => false, 'blacklisted_reason' => null],
            'blacklisted' => ['profile_status' => 'blacklisted', 'is_blacklisted' => true, 'blacklisted_reason' => 'Updated by admin'],
            default => ['profile_status' => 'pending', 'is_blacklisted' => false, 'blacklisted_reason' => null],
        };
    }

    public static function normalizeNannyUpdate(string $status): array
    {
        $raw = strtolower(trim($status));

        return match ($raw) {
            'pending_verification', 'pending verification' => ['profile_status' => 'pending_verification', 'is_blacklisted' => false, 'blacklisted_reason' => null],
            'approved', 'verified' => ['profile_status' => 'approved', 'is_blacklisted' => false, 'blacklisted_reason' => null],
            'rejected', 'blacklisted' => ['profile_status' => 'blacklisted', 'is_blacklisted' => true, 'blacklisted_reason' => 'Updated by admin'],
            default => ['profile_status' => 'pending', 'is_blacklisted' => false, 'blacklisted_reason' => null],
        };
    }

    public static function acceptedApplicationStatuses(): array
    {
        return ['accepted', 'accept', 'approved', 'confirmed', 'complete', 'completed'];
    }

    public static function latestAcceptedApplicationsByJob(Collection $jobIds): Collection
    {
        if ($jobIds->isEmpty() || ! static::hasTable('parent_job_applications')) {
            return collect();
        }

        return ParentJobApplication::query()
            ->whereIn('job_id', $jobIds->all())
            ->whereIn('status', static::acceptedApplicationStatuses())
            ->orderByDesc('id')
            ->get()
            ->groupBy('job_id')
            ->map(fn (Collection $items) => $items->first());
    }

    public static function jobAmount(float|int|string|null $price, float|int|string|null $hours = null, float|int|string|null $hourlyRate = null): float
    {
        $numericPrice = is_numeric((string) $price) ? (float) $price : 0.0;
        if ($numericPrice > 0) {
            return round($numericPrice, 2);
        }

        $numericHours = is_numeric((string) $hours) ? (float) $hours : 0.0;
        $numericRate = is_numeric((string) $hourlyRate) ? (float) $hourlyRate : 0.0;

        return round($numericHours * $numericRate, 2);
    }

    public static function ageFromDate(?string $value): ?int
    {
        $raw = trim((string) ($value ?? ''));
        if ($raw === '') {
            return null;
        }

        try {
            return now()->diffInYears($raw);
        } catch (\Throwable) {
            return null;
        }
    }

    public static function tazCacheMap(): Collection
    {
        if (! static::hasTable('cache')) {
            return collect();
        }

        return CacheEntry::query()
            ->where('key', 'like', 'taz:last-order:%')
            ->get()
            ->mapWithKeys(function (CacheEntry $entry): array {
                $publicUserId = strtoupper(trim((string) str($entry->key)->afterLast(':')));
                $payload = static::decodeCacheValue($entry->value);

                return $publicUserId !== '' ? [$publicUserId => array_merge($payload, [
                    'user_id' => $publicUserId,
                ])] : [];
            });
    }

    public static function tazCacheFor(string|int|null $identifier): ?array
    {
        $user = AppUser::resolveByIdentifier($identifier);
        if (! $user || ! $user->user_id) {
            return null;
        }

        return static::tazCacheMap()->get(strtoupper((string) $user->user_id));
    }

    private static function decodeCacheValue(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }

        $raw = trim((string) $value);
        if ($raw === '') {
            return [];
        }

        $decodedJson = json_decode($raw, true);
        if (is_array($decodedJson)) {
            return $decodedJson;
        }

        try {
            $decoded = unserialize($raw, ['allowed_classes' => false]);
            return is_array($decoded) ? $decoded : [];
        } catch (\Throwable) {
            return [];
        }
    }
}
