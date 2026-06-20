<?php

namespace App\Models\AppData;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WalletTransaction extends Model
{
    protected $connection = 'app_data';

    protected $table = 'wallet_transactions';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'meta' => 'array',
        ];
    }

    public function job(): BelongsTo
    {
        return $this->belongsTo(ParentJob::class, 'job_id', 'id');
    }
}
