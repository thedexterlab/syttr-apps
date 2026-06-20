<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('parent_job_applications', function (Blueprint $table) {
            if (! Schema::hasColumn('parent_job_applications', 'request_source')) {
                $table->string('request_source', 32)->default('job_post')->after('status')->index();
            }
        });

        DB::table('parent_job_applications')
            ->where(function ($query) {
                $query
                    ->whereRaw('LOWER(COALESCE(status, "")) IN (?, ?)', ['hire_requested', 'hire-requested'])
                    ->orWhereRaw('LOWER(COALESCE(message, "")) LIKE ?', ['%source:hire_now%']);
            })
            ->update(['request_source' => 'hire_request']);
    }

    public function down(): void
    {
        Schema::table('parent_job_applications', function (Blueprint $table) {
            if (Schema::hasColumn('parent_job_applications', 'request_source')) {
                $table->dropColumn('request_source');
            }
        });
    }
};

