<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('taz_verification_orders')) {
            Schema::create('taz_verification_orders', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $table->string('public_user_id', 32)->nullable()->index();
                $table->string('taz_order_guid', 120)->nullable()->unique();
                $table->string('client_guid', 120)->nullable()->index();
                $table->string('product_guid', 120)->nullable()->index();
                $table->string('verification_type', 64)->nullable();
                $table->string('provider_status', 64)->nullable();
                $table->string('normalized_status', 64)->nullable()->index();
                $table->text('quickapp_link')->nullable();
                $table->json('create_order_request_payload')->nullable();
                $table->json('create_order_response_payload')->nullable();
                $table->json('latest_webhook_payload')->nullable();
                $table->string('latest_event_id', 191)->nullable()->index();
                $table->string('latest_event_hash', 64)->nullable()->index();
                $table->timestamp('provider_created_at')->nullable();
                $table->timestamp('provider_updated_at')->nullable();
                $table->timestamp('webhook_received_at')->nullable();
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('taz_webhook_events')) {
            Schema::create('taz_webhook_events', function (Blueprint $table) {
                $table->id();
                $table->foreignId('taz_verification_order_id')->nullable()->constrained('taz_verification_orders')->cascadeOnDelete();
                $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
                $table->string('public_user_id', 32)->nullable()->index();
                $table->string('taz_order_guid', 120)->nullable()->index();
                $table->string('event_id', 191)->nullable()->unique();
                $table->string('event_hash', 64)->unique();
                $table->string('event_type', 120)->nullable();
                $table->string('provider_status', 64)->nullable();
                $table->string('normalized_status', 64)->nullable()->index();
                $table->text('quickapp_link')->nullable();
                $table->json('payload');
                $table->timestamp('received_at')->nullable();
                $table->timestamps();

                $table->index(['public_user_id', 'received_at']);
                $table->index(['taz_order_guid', 'received_at']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('taz_webhook_events');
        Schema::dropIfExists('taz_verification_orders');
    }
};
