<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class UserNotification extends Model
{
    use HasFactory;

    protected $fillable = [
        'recipient_user_id',
        'sender_user_id',
        'type',
        'title',
        'message',
        'data',
        'is_read',
        'opened_at',
    ];

    protected $casts = [
        'data' => 'array',
        'is_read' => 'boolean',
        'opened_at' => 'datetime',
    ];
}

