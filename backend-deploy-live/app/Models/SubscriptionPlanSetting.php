<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class SubscriptionPlanSetting extends Model
{
    use HasFactory;

    protected $fillable = [
        'slug',
        'name',
        'description',
        'amount',
        'currency',
        'interval_unit',
        'interval_count',
        'trial_days',
        'renewal_mode',
        'cancellation_notice_days',
        'stripe_price_id',
        'features',
        'is_active',
        'is_default',
        'sort_order',
        'meta',
    ];

    protected $casts = [
        'amount' => 'float',
        'interval_count' => 'integer',
        'trial_days' => 'integer',
        'cancellation_notice_days' => 'integer',
        'sort_order' => 'integer',
        'features' => 'array',
        'meta' => 'array',
        'is_active' => 'boolean',
        'is_default' => 'boolean',
    ];
}
