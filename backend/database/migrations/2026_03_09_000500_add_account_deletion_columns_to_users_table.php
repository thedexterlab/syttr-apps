<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->timestamp('account_deletion_requested_at')->nullable()->after('profile_status_updated_at');
            $table->timestamp('account_deletion_scheduled_for')->nullable()->after('account_deletion_requested_at');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table): void {
            $table->dropColumn([
                'account_deletion_requested_at',
                'account_deletion_scheduled_for',
            ]);
        });
    }
};
