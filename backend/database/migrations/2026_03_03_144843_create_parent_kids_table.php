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
        Schema::create('parent_kids', function (Blueprint $table) {
            $table->id();
            $table->foreignId('parent_profile_id')->constrained()->cascadeOnDelete();
            $table->string('name')->nullable();
            $table->unsignedTinyInteger('age')->nullable();
            $table->string('gender', 20)->nullable();
            $table->string('allergies')->nullable();
            $table->string('medical_conditions')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('parent_kids');
    }
};
