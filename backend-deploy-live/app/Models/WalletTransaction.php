<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WalletTransaction extends Model
{
    use HasFactory;

    protected $fillable = [
        'user_id',
        'counterparty_user_id',
        'job_id',
        'application_id',
        'subscription_purchase_id',
        'type',
        'category',
        'direction',
        'amount',
        'currency',
        'status',
        'description',
        'stripe_payment_intent_id',
        'meta',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'meta' => 'array',
    ];

    public function job(): BelongsTo
    {
        return $this->belongsTo(ParentJob::class, 'job_id');
    }
}
