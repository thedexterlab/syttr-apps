<?php

namespace App\Models\AppData;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class AppUser extends Model
{
    protected $connection = 'app_data';

    protected $table = 'users';

    protected $guarded = [];

    protected $hidden = [
        'password',
        'remember_token',
        'api_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'profile_status_updated_at' => 'datetime',
            'account_deletion_requested_at' => 'datetime',
            'account_deletion_scheduled_for' => 'datetime',
            'deactivated_at' => 'datetime',
            'is_blacklisted' => 'boolean',
        ];
    }

    public function scopeParents(Builder $query): Builder
    {
        return $query->where('role', 'parent');
    }

    public function scopeSyttrs(Builder $query): Builder
    {
        return $query->where('role', 'syttr');
    }

    public function parentProfile(): HasOne
    {
        return $this->hasOne(ParentProfile::class, 'user_id', 'user_id');
    }

    public function syttrProfile(): HasOne
    {
        return $this->hasOne(SyttrProfile::class, 'user_id', 'id');
    }

    public function interview(): HasOne
    {
        return $this->hasOne(SyttrInterview::class, 'user_id', 'id');
    }

    public function nannyApplications(): HasMany
    {
        return $this->hasMany(ParentJobApplication::class, 'nanny_id', 'user_id');
    }

    public function parentJobs(): HasMany
    {
        return $this->hasMany(ParentJob::class, 'user_id', 'user_id');
    }

    public static function resolveByIdentifier(string|int|null $identifier): ?self
    {
        $raw = trim((string) ($identifier ?? ''));
        if ($raw === '') {
            return null;
        }

        $byPublicId = static::query()->where('user_id', strtoupper($raw))->first();
        if ($byPublicId) {
            return $byPublicId;
        }

        if (ctype_digit($raw)) {
            return static::query()->find((int) $raw);
        }

        return null;
    }
}
