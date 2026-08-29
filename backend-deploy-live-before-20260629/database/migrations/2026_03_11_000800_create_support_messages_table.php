<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('support_messages', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 32)->nullable()->index();
            $table->string('account_type', 32)->nullable()->index();
            $table->string('source', 64)->default('app_contact_form');
            $table->string('category', 64)->default('contact')->index();
            $table->string('status', 32)->default('new')->index();
            $table->string('sender_name')->nullable();
            $table->string('sender_email')->nullable()->index();
            $table->string('subject')->nullable();
            $table->text('message');
            $table->json('meta')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('support_messages');
    }
};
