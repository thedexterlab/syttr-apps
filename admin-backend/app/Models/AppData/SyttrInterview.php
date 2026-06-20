<?php

namespace App\Models\AppData;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SyttrInterview extends Model
{
    protected $connection = 'app_data';

    protected $table = 'syttr_interviews';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'interview_date' => 'date',
            'scheduled_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(AppUser::class, 'user_id', 'id');
    }
}
