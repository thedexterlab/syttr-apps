<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ParentJobApplication extends Model
{
    protected $fillable = [
        'job_id',
        'nanny_id',
        'status',
        'request_source',
        'message',
        'parent_rating',
        'parent_review',
        'parent_rated_at',
        'nanny_rating',
        'nanny_review',
        'nanny_rated_at',
        'rating_prompted_parent_at',
        'rating_prompted_nanny_at',
        'nanny_canceled_at',
        'nanny_canceled_within_24h',
        'nanny_reliability_penalty',
    ];

    protected function casts(): array
    {
        return [
            'parent_rated_at' => 'datetime',
            'nanny_rated_at' => 'datetime',
            'rating_prompted_parent_at' => 'datetime',
            'rating_prompted_nanny_at' => 'datetime',
            'nanny_canceled_at' => 'datetime',
            'nanny_canceled_within_24h' => 'boolean',
        ];
    }

    public function job(): BelongsTo
    {
        return $this->belongsTo(ParentJob::class, 'job_id');
    }

    public function nanny(): BelongsTo
    {
        return $this->belongsTo(User::class, 'nanny_id', 'user_id');
    }

    public function scopeVisibleOnPlatform(Builder $query): Builder
    {
        return $query
            ->whereHas('job', fn (Builder $builder) => $builder->visibleOnPlatform())
            ->whereHas('nanny', fn (Builder $builder) => $builder->visibleOnPlatform());
    }
}
