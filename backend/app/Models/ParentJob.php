<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ParentJob extends Model
{
    protected $fillable = [
        'user_id',
        'kid_ids',
        'kid_names',
        'hours',
        'hourly_rate',
        'price',
        'start_date',
        'end_date',
        'start_time',
        'end_time',
        'location',
        'latitude',
        'longitude',
        'timezone',
        'status',
        'late_cancellation_fee',
        'late_cancellation_fee_charged_at',
    ];

    protected function casts(): array
    {
        return [
            'kid_ids' => 'array',
            'hours' => 'decimal:2',
            'hourly_rate' => 'decimal:2',
            'price' => 'decimal:2',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'start_date' => 'date:Y-m-d',
            'end_date' => 'date:Y-m-d',
            'late_cancellation_fee' => 'decimal:2',
            'late_cancellation_fee_charged_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'user_id');
    }

    public function parentUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id', 'user_id');
    }

    public function applications(): HasMany
    {
        return $this->hasMany(ParentJobApplication::class, 'job_id');
    }

    public function localTimezone(): string
    {
        $timezone = trim((string) ($this->timezone ?? ''));
        if ($timezone !== '' && in_array($timezone, timezone_identifiers_list(), true)) {
            return $timezone;
        }

        $latitude = $this->latitude !== null ? (float) $this->latitude : null;
        $longitude = $this->longitude !== null ? (float) $this->longitude : null;
        if ($latitude !== null && $longitude !== null) {
            $inferred = $this->inferUsTimezoneFromCoordinates($latitude, $longitude);
            if ($inferred) {
                return $inferred;
            }
        }

        return config('app.business_timezone', 'America/Chicago');
    }

    public function scopeVisibleOnPlatform(Builder $query): Builder
    {
        return $query->whereHas('parentUser', fn (Builder $builder) => $builder->visibleOnPlatform());
    }

    private function inferUsTimezoneFromCoordinates(float $latitude, float $longitude): ?string
    {
        if ($latitude < 18 || $latitude > 72 || $longitude < -170 || $longitude > -60) {
            return null;
        }

        if ($latitude < 25 && $longitude >= -161 && $longitude <= -154) {
            return 'Pacific/Honolulu';
        }
        if ($longitude <= -130) {
            return 'America/Adak';
        }
        if ($longitude <= -125) {
            return 'America/Anchorage';
        }
        if ($longitude <= -115) {
            return 'America/Los_Angeles';
        }
        if ($longitude <= -100) {
            return 'America/Denver';
        }
        if ($longitude <= -85) {
            return 'America/Chicago';
        }

        return 'America/New_York';
    }
}
