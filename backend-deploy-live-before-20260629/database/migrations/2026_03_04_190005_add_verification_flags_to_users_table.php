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
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'profile_status')) {
                $table->string('profile_status', 32)->nullable()->after('role');
            }

            if (! Schema::hasColumn('users', 'profile_status_updated_at')) {
                $table->timestamp('profile_status_updated_at')->nullable()->after('profile_status');
            }

            if (! Schema::hasColumn('users', 'is_blacklisted')) {
                $table->boolean('is_blacklisted')->default(false)->after('profile_status_updated_at');
            }

            if (! Schema::hasColumn('users', 'blacklisted_reason')) {
                $table->text('blacklisted_reason')->nullable()->after('is_blacklisted');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'blacklisted_reason')) {
                $table->dropColumn('blacklisted_reason');
            }
            if (Schema::hasColumn('users', 'is_blacklisted')) {
                $table->dropColumn('is_blacklisted');
            }
            if (Schema::hasColumn('users', 'profile_status_updated_at')) {
                $table->dropColumn('profile_status_updated_at');
            }
            if (Schema::hasColumn('users', 'profile_status')) {
                $table->dropColumn('profile_status');
            }
        });
    }
};

