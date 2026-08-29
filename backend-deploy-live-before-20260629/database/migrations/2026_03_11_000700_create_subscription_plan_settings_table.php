<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscription_plan_settings', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();
            $table->string('name');
            $table->text('description')->nullable();
            $table->decimal('amount', 10, 2)->default(19.99);
            $table->string('currency', 10)->default('USD');
            $table->string('interval_unit', 20)->default('month');
            $table->unsignedInteger('interval_count')->default(1);
            $table->unsignedInteger('trial_days')->default(0);
            $table->string('renewal_mode', 30)->default('auto');
            $table->unsignedInteger('cancellation_notice_days')->default(30);
            $table->string('stripe_price_id')->nullable();
            $table->json('features')->nullable();
            $table->boolean('is_active')->default(true);
            $table->boolean('is_default')->default(false);
            $table->unsignedInteger('sort_order')->default(0);
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['is_active', 'is_default']);
        });

        $now = Carbon::now();
        DB::table('subscription_plan_settings')->insert([
            'slug' => 'premium-family',
            'name' => 'Premium Family',
            'description' => 'Unlimited posts, priority matches, and concierge support.',
            'amount' => 19.99,
            'currency' => 'USD',
            'interval_unit' => 'month',
            'interval_count' => 1,
            'trial_days' => 0,
            'renewal_mode' => 'auto',
            'cancellation_notice_days' => 30,
            'stripe_price_id' => null,
            'features' => json_encode([
                'Unlimited job posts & edits',
                'Priority Syttr matching',
                'Concierge chat support',
            ], JSON_UNESCAPED_UNICODE),
            'is_active' => true,
            'is_default' => true,
            'sort_order' => 0,
            'meta' => json_encode([], JSON_UNESCAPED_UNICODE),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_plan_settings');
    }
};
