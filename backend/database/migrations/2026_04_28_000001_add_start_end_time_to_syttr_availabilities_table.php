<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('syttr_availabilities', function (Blueprint $table) {
            if (! Schema::hasColumn('syttr_availabilities', 'start_time')) {
                $table->string('start_time', 20)->nullable()->after('time');
            }
            if (! Schema::hasColumn('syttr_availabilities', 'end_time')) {
                $table->string('end_time', 20)->nullable()->after('start_time');
            }
        });
    }

    public function down(): void
    {
        Schema::table('syttr_availabilities', function (Blueprint $table) {
            if (Schema::hasColumn('syttr_availabilities', 'end_time')) {
                $table->dropColumn('end_time');
            }
            if (Schema::hasColumn('syttr_availabilities', 'start_time')) {
                $table->dropColumn('start_time');
            }
        });
    }
};
