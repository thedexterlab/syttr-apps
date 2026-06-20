<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('favorite_jobs', function (Blueprint $table) {
            $table->id();
            $table->string('nanny_id', 32)->index();
            $table->foreignId('job_id')->constrained('parent_jobs')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['nanny_id', 'job_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('favorite_jobs');
    }
};

