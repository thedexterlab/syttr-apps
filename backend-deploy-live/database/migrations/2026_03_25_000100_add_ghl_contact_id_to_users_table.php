<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'ghl_contact_id')) {
                $table->string('ghl_contact_id')->nullable()->after('stripe_connect_payouts_enabled');
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'ghl_contact_id')) {
                $table->dropColumn('ghl_contact_id');
            }
        });
    }
};
