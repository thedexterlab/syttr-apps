<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('parent_profiles', function (Blueprint $table) {
            if (! Schema::hasColumn('parent_profiles', 'gender')) {
                $table->string('gender', 30)->nullable()->after('address');
            }
        });
    }

    public function down(): void
    {
        Schema::table('parent_profiles', function (Blueprint $table) {
            if (Schema::hasColumn('parent_profiles', 'gender')) {
                $table->dropColumn('gender');
            }
        });
    }
};
