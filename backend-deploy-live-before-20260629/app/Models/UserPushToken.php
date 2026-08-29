<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class UserPushToken extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'expo_push_token',
        'platform',
        'device_id',
        'device_name',
        'app_ownership',
        'project_id',
        'bundle_identifier',
        'environment',
        'is_active',
        'last_seen_at',
        'last_registered_at',
        'meta',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'last_seen_at' => 'datetime',
        'last_registered_at' => 'datetime',
        'meta' => 'array',
    ];
}
