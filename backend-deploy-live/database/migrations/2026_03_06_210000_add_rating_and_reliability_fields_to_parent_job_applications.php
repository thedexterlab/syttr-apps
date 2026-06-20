<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('parent_job_applications', function (Blueprint $table) {
            if (! Schema::hasColumn('parent_job_applications', 'parent_rating')) {
                $table->unsignedTinyInteger('parent_rating')->nullable()->after('message');
            }
            if (! Schema::hasColumn('parent_job_applications', 'parent_review')) {
                $table->text('parent_review')->nullable()->after('parent_rating');
            }
            if (! Schema::hasColumn('parent_job_applications', 'parent_rated_at')) {
                $table->timestamp('parent_rated_at')->nullable()->after('parent_review');
            }
            if (! Schema::hasColumn('parent_job_applications', 'nanny_rating')) {
                $table->unsignedTinyInteger('nanny_rating')->nullable()->after('parent_rated_at');
            }
            if (! Schema::hasColumn('parent_job_applications', 'nanny_review')) {
                $table->text('nanny_review')->nullable()->after('nanny_rating');
            }
            if (! Schema::hasColumn('parent_job_applications', 'nanny_rated_at')) {
                $table->timestamp('nanny_rated_at')->nullable()->after('nanny_review');
            }
            if (! Schema::hasColumn('parent_job_applications', 'rating_prompted_parent_at')) {
                $table->timestamp('rating_prompted_parent_at')->nullable()->after('nanny_rated_at');
            }
            if (! Schema::hasColumn('parent_job_applications', 'rating_prompted_nanny_at')) {
                $table->timestamp('rating_prompted_nanny_at')->nullable()->after('rating_prompted_parent_at');
            }
            if (! Schema::hasColumn('parent_job_applications', 'nanny_canceled_at')) {
                $table->timestamp('nanny_canceled_at')->nullable()->after('rating_prompted_nanny_at');
            }
            if (! Schema::hasColumn('parent_job_applications', 'nanny_canceled_within_24h')) {
                $table->boolean('nanny_canceled_within_24h')->default(false)->after('nanny_canceled_at');
            }
            if (! Schema::hasColumn('parent_job_applications', 'nanny_reliability_penalty')) {
                $table->unsignedSmallInteger('nanny_reliability_penalty')->default(0)->after('nanny_canceled_within_24h');
            }
        });
    }

    public function down(): void
    {
        Schema::table('parent_job_applications', function (Blueprint $table) {
            foreach ([
                'nanny_reliability_penalty',
                'nanny_canceled_within_24h',
                'nanny_canceled_at',
                'rating_prompted_nanny_at',
                'rating_prompted_parent_at',
                'nanny_rated_at',
                'nanny_review',
                'nanny_rating',
                'parent_rated_at',
                'parent_review',
                'parent_rating',
            ] as $column) {
                if (Schema::hasColumn('parent_job_applications', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};

