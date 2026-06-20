<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AdminApiKey extends Model
{
    protected $fillable = [
        'name',
        'key_hash',
        'is_active',
        'last_used_at',
    ];

    protected $hidden = [
        'key_hash',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'last_used_at' => 'datetime',
        ];
    }
}
