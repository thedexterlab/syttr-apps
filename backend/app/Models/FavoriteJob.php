<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FavoriteJob extends Model
{
    protected $fillable = [
        'nanny_id',
        'job_id',
    ];

    public function job(): BelongsTo
    {
        return $this->belongsTo(ParentJob::class, 'job_id');
    }
}

