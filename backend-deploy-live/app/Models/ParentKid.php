<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Model;

class ParentKid extends Model
{
    protected $fillable = [
        'parent_profile_id',
        'name',
        'age',
        'gender',
        'allergies',
        'medical_conditions',
        'notes',
    ];

    public function parentProfile(): BelongsTo
    {
        return $this->belongsTo(ParentProfile::class, 'parent_profile_id', 'user_id');
    }
}
