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
            if (! Schema::hasColumn('syttr_profiles', 'address')) {
                $table->string('address')->nullable();
            }
            if (! Schema::hasColumn('syttr_profiles', 'country')) {
                $table->string('country')->nullable();
            }
            if (! Schema::hasColumn('syttr_profiles', 'gender')) {
                $table->string('gender', 30)->nullable();
            }
            if (! Schema::hasColumn('syttr_profiles', 'date_of_birth')) {
                $table->date('date_of_birth')->nullable();
            }
            if (! Schema::hasColumn('syttr_profiles', 'user_image')) {
                $table->string('user_image')->nullable();
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
            if (Schema::hasColumn('syttr_profiles', 'user_image')) {
                $table->dropColumn('user_image');
            }
            if (Schema::hasColumn('syttr_profiles', 'date_of_birth')) {
                $table->dropColumn('date_of_birth');
            }
            if (Schema::hasColumn('syttr_profiles', 'gender')) {
                $table->dropColumn('gender');
            }
            if (Schema::hasColumn('syttr_profiles', 'country')) {
                $table->dropColumn('country');
            }
            if (Schema::hasColumn('syttr_profiles', 'address')) {
                $table->dropColumn('address');
            }
        });
    }
};
