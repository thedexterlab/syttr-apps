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
        if (! Schema::hasTable('syttr_profiles')) {
            return;
        }

        Schema::table('syttr_profiles', function (Blueprint $table) {
            if (! Schema::hasColumn('syttr_profiles', 'certificate')) {
                $table->string('certificate')->nullable();
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (! Schema::hasTable('syttr_profiles')) {
            return;
        }

        Schema::table('syttr_profiles', function (Blueprint $table) {
            if (Schema::hasColumn('syttr_profiles', 'certificate')) {
                $table->dropColumn('certificate');
            }
        });
    }
};
