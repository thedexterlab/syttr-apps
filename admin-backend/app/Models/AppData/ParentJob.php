<?php

namespace App\Models\AppData;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ParentJob extends Model
{
    protected $connection = 'app_data';

    protected $table = 'parent_jobs';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'kid_ids' => 'array',
            'hours' => 'decimal:2',
            'hourly_rate' => 'decimal:2',
            'price' => 'decimal:2',
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'start_date' => 'date',
            'end_date' => 'date',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(AppUser::class, 'user_id', 'user_id');
    }

    public function applications(): HasMany
    {
        return $this->hasMany(ParentJobApplication::class, 'job_id', 'id');
    }
}
