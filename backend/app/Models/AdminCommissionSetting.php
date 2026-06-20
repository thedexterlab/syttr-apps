<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AdminCommissionSetting extends Model
{
    protected $connection = 'admin_panel';

    protected $table = 'commission_settings';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'value' => 'decimal:2',
            'is_active' => 'boolean',
        ];
    }
}
