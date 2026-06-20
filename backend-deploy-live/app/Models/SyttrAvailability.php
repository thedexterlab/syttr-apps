<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Model;

class SyttrAvailability extends Model
{
    protected $fillable = [
        'syttr_profile_id',
        'mode',
        'day',
        'date',
        'period',
        'time',
        'start_time',
        'end_time',
    ];

    protected function casts(): array
    {
        return [
            'date' => 'date:Y-m-d',
        ];
    }

    public function syttrProfile(): BelongsTo
    {
        return $this->belongsTo(SyttrProfile::class);
    }
}
