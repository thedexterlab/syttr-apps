<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 5)->index();
            $table->string('plan')->default('premium');
            $table->string('status')->default('active');
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('currency', 10)->default('USD');
            $table->unsignedBigInteger('payment_method_id')->nullable();
            $table->string('stripe_subscription_id')->nullable();
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_subscriptions');
    }
};

