<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SyttrInterview extends Model
{
    protected $fillable = [
        'user_id',
        'interview_date',
        'interview_time',
        'scheduled_at',
        'status',
    ];

    protected function casts(): array
    {
        return [
            'interview_date' => 'date:Y-m-d',
            'interview_time' => 'datetime:H:i:s',
            'scheduled_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

