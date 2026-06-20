<?php

namespace App\Models\AppData;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ParentProfile extends Model
{
    protected $connection = 'app_data';

    protected $table = 'parent_profiles';

    protected $guarded = [];

    public function user(): BelongsTo
    {
        return $this->belongsTo(AppUser::class, 'user_id', 'user_id');
    }

    public function kids(): HasMany
    {
        return $this->hasMany(ParentKid::class, 'parent_profile_id', 'user_id');
    }
}
