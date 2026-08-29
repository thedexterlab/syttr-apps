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
        if (! Schema::hasTable('parent_profiles') || Schema::hasColumn('parent_profiles', 'user_image')) {
            return;
        }

        Schema::table('parent_profiles', function (Blueprint $table) {
            $table->string('user_image')->nullable();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (! Schema::hasTable('parent_profiles') || ! Schema::hasColumn('parent_profiles', 'user_image')) {
            return;
        }

        Schema::table('parent_profiles', function (Blueprint $table) {
            $table->dropColumn('user_image');
        });
    }
};
