<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TazVerificationOrder extends Model
{
    protected $fillable = [
        'user_id',
        'public_user_id',
        'taz_order_guid',
        'client_guid',
        'product_guid',
        'verification_type',
        'provider_status',
        'normalized_status',
        'quickapp_link',
        'create_order_request_payload',
        'create_order_response_payload',
        'latest_webhook_payload',
        'latest_event_id',
        'latest_event_hash',
        'provider_created_at',
        'provider_updated_at',
        'webhook_received_at',
    ];

    protected function casts(): array
    {
        return [
            'create_order_request_payload' => 'array',
            'create_order_response_payload' => 'array',
            'latest_webhook_payload' => 'array',
            'provider_created_at' => 'datetime',
            'provider_updated_at' => 'datetime',
            'webhook_received_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function webhookEvents(): HasMany
    {
        return $this->hasMany(TazWebhookEvent::class, 'taz_verification_order_id');
    }
}
