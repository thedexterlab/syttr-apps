<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_push_tokens', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 5)->index();
            $table->string('expo_push_token')->unique();
            $table->string('platform', 16)->default('ios');
            $table->string('device_id', 191)->nullable()->index();
            $table->string('device_name')->nullable();
            $table->string('app_ownership', 32)->nullable();
            $table->string('project_id')->nullable();
            $table->string('bundle_identifier')->nullable();
            $table->string('environment', 32)->nullable();
            $table->boolean('is_active')->default(true)->index();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('last_registered_at')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'device_id'], 'user_push_tokens_user_device_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_push_tokens');
    }
};
