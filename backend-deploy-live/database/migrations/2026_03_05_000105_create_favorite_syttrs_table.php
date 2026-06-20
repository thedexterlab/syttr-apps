<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('favorite_syttrs', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 5)->index();
            $table->string('syttr_user_id', 5)->index();
            $table->timestamps();

            $table->unique(['user_id', 'syttr_user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('favorite_syttrs');
    }
};

