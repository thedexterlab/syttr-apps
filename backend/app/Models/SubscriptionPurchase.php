<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SubscriptionPurchase extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'subscription_id',
        'payment_method_id',
        'plan',
        'amount',
        'currency',
        'stripe_payment_intent_id',
        'stripe_payment_status',
        'purchased_at',
        'meta',
    ];

    protected $casts = [
        'purchased_at' => 'datetime',
        'meta' => 'array',
    ];
}

