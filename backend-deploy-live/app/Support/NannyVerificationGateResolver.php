<?php

namespace App\Support;

class NannyVerificationGateResolver
{
    public static function normalizeQuickappStatus(?string $status): string
    {
        $value = strtolower(trim((string) $status));
        if ($value === '') {
            return 'unknown';
        }
        if (str_contains($value, 'reject') || str_contains($value, 'blacklist') || str_contains($value, 'deny') || str_contains($value, 'fail')) {
            return 'failed';
        }
        if (str_contains($value, 'clear') || str_contains($value, 'complete') || str_contains($value, 'approved') || str_contains($value, 'verified')) {
            return 'completed';
        }
        if (str_contains($value, 'pend')) {
            return 'app-pending';
        }

        return $value;
    }

    public static function adminDecision(?string $profileStatus, bool $isBlacklisted): string
    {
        if ($isBlacklisted) {
            return 'blacklisted';
        }

        $status = strtolower(trim((string) $profileStatus));
        if ($status === '') {
            return 'undecided';
        }
        if (str_contains($status, 'reject') || str_contains($status, 'blacklist') || str_contains($status, 'deny') || str_contains($status, 'fail')) {
            return 'rejected';
        }
        if (in_array($status, ['approved', 'completed', 'verified'], true)) {
            return 'approved';
        }

        return 'undecided';
    }

    public static function effectiveStatus(?string $profileStatus, ?string $quickappStatus, bool $isBlacklisted): string
    {
        $adminDecision = self::adminDecision($profileStatus, $isBlacklisted);
        if ($adminDecision === 'blacklisted' || $adminDecision === 'rejected') {
            return 'failed';
        }
        if ($adminDecision === 'approved') {
            return 'completed';
        }

        return self::normalizeQuickappStatus($quickappStatus);
    }

    public static function isVerified(?string $profileStatus, ?string $quickappStatus, bool $isBlacklisted): bool
    {
        return self::effectiveStatus($profileStatus, $quickappStatus, $isBlacklisted) === 'completed';
    }

    public static function requiresVerificationGate(
        string $role,
        ?string $profileStatus,
        ?string $interviewStatus,
        bool $isBlacklisted,
        ?string $quickappStatus = null
    ): bool {
        if (! in_array(strtolower(trim($role)), ['syttr', 'nanny'], true) || $isBlacklisted) {
            return false;
        }

        $adminDecision = self::adminDecision($profileStatus, $isBlacklisted);
        if ($adminDecision === 'approved' || $adminDecision === 'rejected' || $adminDecision === 'blacklisted') {
            return false;
        }

        if (self::normalizeQuickappStatus($quickappStatus) === 'completed') {
            return false;
        }

        $normalizedProfile = strtolower(trim((string) $profileStatus));
        if (in_array($normalizedProfile, ['pending', 'pending_verification', 'pending verification'], true)) {
            return true;
        }

        $normalizedInterview = strtolower(trim((string) $interviewStatus));
        if (in_array($normalizedInterview, ['approved', 'completed'], true)) {
            return true;
        }

        return false;
    }
}
