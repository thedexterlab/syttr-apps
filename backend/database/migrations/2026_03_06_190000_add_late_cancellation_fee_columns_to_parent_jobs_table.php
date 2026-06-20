<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('parent_jobs', function (Blueprint $table) {
            if (! Schema::hasColumn('parent_jobs', 'late_cancellation_fee')) {
                $table->decimal('late_cancellation_fee', 8, 2)->nullable()->after('status');
            }
            if (! Schema::hasColumn('parent_jobs', 'late_cancellation_fee_charged_at')) {
                $table->timestamp('late_cancellation_fee_charged_at')->nullable()->after('late_cancellation_fee');
            }
        });
    }

    public function down(): void
    {
        Schema::table('parent_jobs', function (Blueprint $table) {
            if (Schema::hasColumn('parent_jobs', 'late_cancellation_fee_charged_at')) {
                $table->dropColumn('late_cancellation_fee_charged_at');
            }
            if (Schema::hasColumn('parent_jobs', 'late_cancellation_fee')) {
                $table->dropColumn('late_cancellation_fee');
            }
        });
    }
};

