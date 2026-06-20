<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('parent_job_applications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('job_id')->constrained('parent_jobs')->cascadeOnDelete();
            $table->string('nanny_id', 32)->index();
            $table->string('status', 32)->default('pending')->index();
            $table->text('message')->nullable();
            $table->timestamps();

            $table->unique(['job_id', 'nanny_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('parent_job_applications');
    }
};

