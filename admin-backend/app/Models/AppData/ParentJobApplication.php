<?php

namespace App\Models\AppData;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ParentJobApplication extends Model
{
    protected $connection = 'app_data';

    protected $table = 'parent_job_applications';

    protected $guarded = [];

    public function job(): BelongsTo
    {
        return $this->belongsTo(ParentJob::class, 'job_id', 'id');
    }

    public function nanny(): BelongsTo
    {
        return $this->belongsTo(AppUser::class, 'nanny_id', 'user_id');
    }
}
