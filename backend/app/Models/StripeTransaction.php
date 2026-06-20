<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class StripeTransaction extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'counterparty_user_id',
        'payment_method_id',
        'job_id',
        'application_id',
        'subscription_purchase_id',
        'source',
        'category',
        'type',
        'status',
        'amount',
        'currency',
        'stripe_payment_intent_id',
        'stripe_charge_id',
        'stripe_event_id',
        'stripe_object_type',
        'stripe_payment_method_id',
        'description',
        'error_message',
        'request_payload',
        'response_payload',
        'meta',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'request_payload' => 'array',
        'response_payload' => 'array',
        'meta' => 'array',
    ];
}
