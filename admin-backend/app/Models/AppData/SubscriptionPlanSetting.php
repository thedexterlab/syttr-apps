<?php

namespace App\Models\AppData;

use Illuminate\Database\Eloquent\Model;

class SubscriptionPlanSetting extends Model
{
    protected $connection = 'app_data';

    protected $table = 'subscription_plan_settings';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
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
}
