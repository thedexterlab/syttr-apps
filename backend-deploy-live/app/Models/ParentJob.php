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

    public function scopeVisibleOnPlatform(Builder $query): Builder
    {
        return $query->whereHas('parentUser', fn (Builder $builder) => $builder->visibleOnPlatform());
    }
}
