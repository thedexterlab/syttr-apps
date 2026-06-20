<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('syttr_availabilities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('syttr_profile_id')->constrained()->cascadeOnDelete();
            $table->string('mode', 20)->default('weekly');
            $table->string('day')->nullable();
            $table->date('date')->nullable();
            $table->string('period', 20)->nullable();
            $table->string('time', 20);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('syttr_availabilities');
    }
};
