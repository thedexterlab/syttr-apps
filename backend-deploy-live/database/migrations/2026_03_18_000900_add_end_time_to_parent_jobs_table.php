<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('parent_jobs', function (Blueprint $table) {
            if (! Schema::hasColumn('parent_jobs', 'end_time')) {
                $table->time('end_time')->nullable()->after('start_time');
            }
        });
    }

    public function down(): void
    {
        Schema::table('parent_jobs', function (Blueprint $table) {
            if (Schema::hasColumn('parent_jobs', 'end_time')) {
                $table->dropColumn('end_time');
            }
        });
    }
};
