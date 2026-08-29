<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('stripe_connect_account_id')->nullable()->after('stripe_customer_id')->index();
            $table->string('stripe_connect_account_type', 32)->nullable()->after('stripe_connect_account_id');
            $table->timestamp('stripe_connect_onboarded_at')->nullable()->after('stripe_connect_account_type');
            $table->boolean('stripe_connect_details_submitted')->default(false)->after('stripe_connect_onboarded_at');
            $table->boolean('stripe_connect_charges_enabled')->default(false)->after('stripe_connect_details_submitted');
            $table->boolean('stripe_connect_payouts_enabled')->default(false)->after('stripe_connect_charges_enabled');
            $table->string('stripe_external_account_id')->nullable()->after('stripe_connect_payouts_enabled')->index();
            $table->string('stripe_external_account_type', 32)->nullable()->after('stripe_external_account_id');
            $table->string('stripe_external_account_last4', 8)->nullable()->after('stripe_external_account_type');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'stripe_connect_account_id',
                'stripe_connect_account_type',
                'stripe_connect_onboarded_at',
                'stripe_connect_details_submitted',
                'stripe_connect_charges_enabled',
                'stripe_connect_payouts_enabled',
                'stripe_external_account_id',
                'stripe_external_account_type',
                'stripe_external_account_last4',
            ]);
        });
    }
};
