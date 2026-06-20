<?php

namespace App\Models\AppData;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ParentKid extends Model
{
    protected $connection = 'app_data';

    protected $table = 'parent_kids';

    protected $guarded = [];

    public function parentProfile(): BelongsTo
    {
        return $this->belongsTo(ParentProfile::class, 'parent_profile_id', 'user_id');
    }
}
