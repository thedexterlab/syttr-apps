<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wallet_transactions', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20);
            $table->string('counterparty_user_id', 20)->nullable();
            $table->unsignedBigInteger('job_id')->nullable();
            $table->unsignedBigInteger('application_id')->nullable();
            $table->unsignedBigInteger('subscription_purchase_id')->nullable();
            $table->string('type', 50);
            $table->string('category', 50)->default('other');
            $table->string('direction', 10);
            $table->decimal('amount', 10, 2);
            $table->string('currency', 10)->default('usd');
            $table->string('status', 30)->default('completed');
            $table->string('description')->nullable();
            $table->string('stripe_payment_intent_id')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'created_at']);
            $table->index(['user_id', 'status']);
            $table->index(['job_id', 'application_id']);
            $table->index('stripe_payment_intent_id');

            $table->foreign('job_id')->references('id')->on('parent_jobs')->nullOnDelete();
            $table->foreign('application_id')->references('id')->on('parent_job_applications')->nullOnDelete();
            $table->foreign('subscription_purchase_id')->references('id')->on('subscription_purchases')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wallet_transactions');
    }
};
