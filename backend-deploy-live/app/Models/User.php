<?php

namespace App\Models;

use App\Support\GhlContactManager;
// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class User extends Authenticatable
{
    use HasFactory, Notifiable;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'user_id',
        'referral_code',
        'name',
        'email',
        'password',
        'role',
        'profile_status',
        'profile_status_updated_at',
        'account_deletion_requested_at',
        'account_deletion_scheduled_for',
        'deactivated_at',
        'is_blacklisted',
        'blacklisted_reason',
        'api_token',
        'stripe_customer_id',
        'stripe_connect_account_id',
        'stripe_connect_account_type',
        'stripe_connect_onboarded_at',
        'stripe_connect_details_submitted',
        'stripe_connect_charges_enabled',
        'stripe_connect_payouts_enabled',
        'ghl_contact_id',
        'stripe_external_account_id',
        'stripe_external_account_type',
        'stripe_external_account_last4',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $user): void {
            if (! $user->user_id) {
                $user->user_id = static::generatePublicUserId();
            }
            if (! $user->referral_code) {
                $user->referral_code = static::generateReferralCode();
            }
        });
    }

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
        'api_token',
        'stripe_customer_id',
        'stripe_connect_account_id',
        'ghl_contact_id',
        'stripe_external_account_id',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_blacklisted' => 'boolean',
            'profile_status_updated_at' => 'datetime',
            'account_deletion_requested_at' => 'datetime',
            'account_deletion_scheduled_for' => 'datetime',
            'deactivated_at' => 'datetime',
            'stripe_connect_onboarded_at' => 'datetime',
            'stripe_connect_details_submitted' => 'boolean',
            'stripe_connect_charges_enabled' => 'boolean',
            'stripe_connect_payouts_enabled' => 'boolean',
        ];
    }

    public static function generatePublicUserId(): string
    {
        do {
            $candidate = strtoupper(Str::random(5));
        } while (
            preg_match('/[A-Z]/', $candidate) !== 1 ||
            preg_match('/\d/', $candidate) !== 1 ||
            static::query()->where('user_id', $candidate)->exists()
        );

        return $candidate;
    }

    public static function generateReferralCode(): string
    {
        do {
            $candidate = strtoupper(Str::random(8));
        } while (
            preg_match('/[A-Z]/', $candidate) !== 1 ||
            preg_match('/\d/', $candidate) !== 1 ||
            static::query()->where('referral_code', $candidate)->exists()
        );

        return $candidate;
    }

    /**
     * Accepts either internal users.id or the public alphanumeric users.user_id.
     * Returns the normalized public user_id value.
     */
    public static function resolvePublicUserIdByIdentifier(string|int|null $identifier): ?string
    {
        $raw = trim((string) ($identifier ?? ''));
        if ($raw === '') {
            return null;
        }
        $normalized = strtoupper($raw);

        $byPublic = static::query()->where('user_id', $normalized)->value('user_id');
        if ($byPublic) {
            return (string) $byPublic;
        }

        // Backward compatibility for old numeric primary-id based calls.
        if (ctype_digit($normalized)) {
            $byPrimary = static::query()->whereKey((int) $normalized)->value('user_id');
            if ($byPrimary) {
                return (string) $byPrimary;
            }
        }

        return null;
    }

    /**
     * Accepts either internal users.id or the public alphanumeric users.user_id.
     */
    public static function resolveInternalIdByIdentifier(string|int|null $identifier): ?int
    {
        $publicUserId = static::resolvePublicUserIdByIdentifier($identifier);
        if (! $publicUserId) {
            return null;
        }

        $resolved = static::query()->where('user_id', $publicUserId)->value('id');
        return $resolved ? (int) $resolved : null;
    }

    public static function normalizeApiToken(string|int|null $token): string
    {
        $raw = trim((string) ($token ?? ''));
        if ($raw === '') {
            return '';
        }

        $withoutPrefix = preg_replace('/^Bearer\s+/i', '', $raw);

        return trim((string) $withoutPrefix, " \t\n\r\0\x0B\"'");
    }

    public static function resolvePublicUserIdByApiToken(string|int|null $token): ?string
    {
        $normalized = static::normalizeApiToken($token);
        if ($normalized === '') {
            return null;
        }

        $resolved = static::query()->where('api_token', $normalized)->value('user_id');

        return $resolved ? (string) $resolved : null;
    }

    public function parentProfile(): HasOne
    {
        return $this->hasOne(ParentProfile::class);
    }

    public function syttrProfile(): HasOne
    {
        return $this->hasOne(SyttrProfile::class);
    }

    public function interview(): HasOne
    {
        return $this->hasOne(SyttrInterview::class);
    }

    public function pushTokens(): HasMany
    {
        return $this->hasMany(UserPushToken::class, 'user_id', 'user_id');
    }

    public function isDeletionScheduled(): bool
    {
        return $this->account_deletion_scheduled_for instanceof Carbon
            && $this->account_deletion_scheduled_for->isFuture();
    }

    public function isDeactivated(): bool
    {
        return $this->deactivated_at instanceof Carbon;
    }

    public function deactivateAccount(): void
    {
        $this->forceFill([
            'deactivated_at' => now(),
            'api_token' => null,
            'account_deletion_requested_at' => null,
            'account_deletion_scheduled_for' => null,
        ])->save();
    }

    public function scopeVisibleOnPlatform(Builder $query): Builder
    {
        return $query
            ->whereNull('deactivated_at')
            ->where(function (Builder $builder): void {
                $builder
                    ->whereNull('is_blacklisted')
                    ->orWhere('is_blacklisted', false);
            });
    }

    public function scopeNotBlacklisted(Builder $query): Builder
    {
        return $query->where(function (Builder $builder): void {
            $builder
                ->whereNull('is_blacklisted')
                ->orWhere('is_blacklisted', false);
        });
    }

    public function scheduleDeletion(int $graceDays = 7): void
    {
        $scheduledFor = now()->addDays($graceDays);
        $this->forceFill([
            'account_deletion_requested_at' => now(),
            'account_deletion_scheduled_for' => $scheduledFor,
        ])->save();
    }

    public function restoreScheduledDeletion(): bool
    {
        if (! $this->account_deletion_requested_at && ! $this->account_deletion_scheduled_for) {
            return false;
        }

        $this->forceFill([
            'account_deletion_requested_at' => null,
            'account_deletion_scheduled_for' => null,
        ])->save();

        return true;
    }

    public static function purgeExpiredScheduledDeletionAccounts(): int
    {
        $users = static::query()
            ->whereNotNull('account_deletion_scheduled_for')
            ->where('account_deletion_scheduled_for', '<=', now())
            ->get();

        $deleted = 0;
        foreach ($users as $user) {
            static::purgeAccount($user);
            $deleted++;
        }

        return $deleted;
    }

    public static function purgeAccount(self $user): void
    {
        if (filled((string) $user->ghl_contact_id)) {
            $ghlResult = GhlContactManager::deleteContactForUser($user);
            if (! ($ghlResult['success'] ?? false) && (int) ($ghlResult['status'] ?? 500) !== 404) {
                Log::warning('user.purge_account.ghl_delete_failed', [
                    'user_id' => $user->user_id,
                    'status' => $ghlResult['status'] ?? null,
                    'message' => $ghlResult['message'] ?? null,
                ]);
            }
        }

        $parentProfile = $user->parentProfile()->first();
        if ($parentProfile) {
            ParentKid::query()->where('parent_profile_id', $parentProfile->id)->delete();
            $parentProfile->delete();
        }

        $syttrProfile = $user->syttrProfile()->first();
        if ($syttrProfile) {
            SyttrAvailability::query()->where('syttr_profile_id', $syttrProfile->id)->delete();
            $syttrProfile->delete();
        }

        $publicUserId = (string) $user->user_id;
        $internalUserId = (int) $user->id;

        FavoriteJob::query()->where('nanny_id', $publicUserId)->delete();
        FavoriteSyttr::query()->where('user_id', $publicUserId)->orWhere('parent_user_id', $publicUserId)->delete();
        PaymentMethod::query()->where('user_id', $publicUserId)->orWhere('user_id', $internalUserId)->delete();
        UserNotification::query()->where('user_id', $publicUserId)->orWhere('user_id', $internalUserId)->delete();
        UserPushToken::query()->where('user_id', $publicUserId)->delete();
        UserSubscription::query()->where('user_id', $publicUserId)->orWhere('user_id', $internalUserId)->delete();
        SubscriptionPurchase::query()->where('user_id', $publicUserId)->orWhere('user_id', $internalUserId)->delete();
        WalletTransaction::query()->where('user_id', $publicUserId)->orWhere('user_id', $internalUserId)->delete();
        StripeTransaction::query()->where('user_id', $publicUserId)->orWhere('user_id', $internalUserId)->delete();
        SyttrInterview::query()->where('user_id', $internalUserId)->orWhere('user_id', $publicUserId)->delete();

        $user->delete();
    }
}
