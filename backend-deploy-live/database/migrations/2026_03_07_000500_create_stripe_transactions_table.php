<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('stripe_transactions', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->nullable();
            $table->string('counterparty_user_id', 20)->nullable();
            $table->unsignedBigInteger('payment_method_id')->nullable();
            $table->unsignedBigInteger('job_id')->nullable();
            $table->unsignedBigInteger('application_id')->nullable();
            $table->unsignedBigInteger('subscription_purchase_id')->nullable();
            $table->string('source', 100);
            $table->string('category', 50)->default('other');
            $table->string('type', 50)->default('payment');
            $table->string('status', 50)->default('pending');
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('currency', 10)->nullable();
            $table->string('stripe_payment_intent_id')->nullable();
            $table->string('stripe_charge_id')->nullable();
            $table->string('stripe_event_id')->nullable()->unique();
            $table->string('stripe_object_type', 50)->nullable();
            $table->string('stripe_payment_method_id')->nullable();
            $table->string('description')->nullable();
            $table->text('error_message')->nullable();
            $table->json('request_payload')->nullable();
            $table->json('response_payload')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
            $table->index(['category', 'status']);
            $table->index('stripe_payment_intent_id');
            $table->index('stripe_charge_id');

            $table->foreign('payment_method_id')->references('id')->on('payment_methods')->nullOnDelete();
            $table->foreign('job_id')->references('id')->on('parent_jobs')->nullOnDelete();
            $table->foreign('application_id')->references('id')->on('parent_job_applications')->nullOnDelete();
            $table->foreign('subscription_purchase_id')->references('id')->on('subscription_purchases')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stripe_transactions');
    }
};
