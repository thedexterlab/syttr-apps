<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('parent_jobs', function (Blueprint $table) {
            if (! Schema::hasColumn('parent_jobs', 'timezone')) {
                $table->string('timezone', 64)->nullable()->after('longitude')->index();
            }
        });
    }

    public function down(): void
    {
        Schema::table('parent_jobs', function (Blueprint $table) {
            if (Schema::hasColumn('parent_jobs', 'timezone')) {
                $table->dropColumn('timezone');
            }
        });
    }
};
