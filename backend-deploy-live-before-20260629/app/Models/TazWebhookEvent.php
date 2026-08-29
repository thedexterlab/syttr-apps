<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TazWebhookEvent extends Model
{
    protected $fillable = [
        'taz_verification_order_id',
        'user_id',
        'public_user_id',
        'taz_order_guid',
        'resource_guid',
        'resource_path',
        'event_timestamp',
        'instance_guid',
        'base_client_guid',
        'external_identifier',
        'event_id',
        'event_hash',
        'event_type',
        'provider_status',
        'normalized_status',
        'quickapp_link',
        'response_file_number',
        'response_order_status',
        'response_order_type',
        'response_ordered_date',
        'response_applicant_name',
        'response_client_name',
        'response_client_code',
        'response_product_name',
        'response_requested_by',
        'response_search_flagged',
        'response_quickapp_applicant_link',
        'response_created_date',
        'response_created_by',
        'response_modified_date',
        'response_modified_by',
        'payload',
        'received_at',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'received_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(TazVerificationOrder::class, 'taz_verification_order_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
