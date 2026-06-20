<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AdminCommissionRevenueTest extends TestCase
{
    private string $adminDatabasePath;

    private string $appDataDatabasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->adminDatabasePath = database_path('admin_commission_test.sqlite');
        $this->appDataDatabasePath = database_path('admin_commission_app_data_test.sqlite');

        @unlink($this->adminDatabasePath);
        @unlink($this->appDataDatabasePath);
        touch($this->adminDatabasePath);
        touch($this->appDataDatabasePath);

        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', $this->adminDatabasePath);
        Config::set('database.connections.app_data', [
            'driver' => 'sqlite',
            'database' => $this->appDataDatabasePath,
            'prefix' => '',
            'foreign_key_constraints' => true,
        ]);

        DB::purge('sqlite');
        DB::purge('app_data');

        $this->createAdminSchema();
        $this->createAppDataSchema();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        DB::disconnect('sqlite');
        DB::disconnect('app_data');

        @unlink($this->adminDatabasePath);
        @unlink($this->appDataDatabasePath);

        parent::tearDown();
    }

    public function test_admin_commission_endpoint_returns_real_withdrawal_revenue_summary(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-25 12:00:00'));

        DB::table('commission_settings')->insert([
            'name' => 'default',
            'type' => 'percentage',
            'value' => 10.00,
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::connection('app_data')->table('users')->insert([
            [
                'user_id' => 'NANNY1',
                'name' => 'Alice Syttr',
                'email' => 'alice@example.com',
                'role' => 'syttr',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'NANNY2',
                'name' => 'Beth Syttr',
                'email' => 'beth@example.com',
                'role' => 'syttr',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::connection('app_data')->table('wallet_transactions')->insert([
            [
                'user_id' => 'NANNY1',
                'type' => 'wallet_withdrawal',
                'category' => 'withdrawal',
                'direction' => 'debit',
                'amount' => 90.00,
                'currency' => 'usd',
                'status' => 'processing',
                'description' => 'Wallet withdrawal',
                'meta' => json_encode([
                    'gross_amount' => 100,
                    'commission_amount' => 10,
                    'net_amount' => 90,
                    'commission_type' => 'percentage',
                    'commission_value' => 10,
                ]),
                'created_at' => now()->subDay(),
                'updated_at' => now()->subDay(),
            ],
            [
                'user_id' => 'NANNY2',
                'type' => 'wallet_withdrawal',
                'category' => 'withdrawal',
                'direction' => 'debit',
                'amount' => 45.00,
                'currency' => 'usd',
                'status' => 'completed',
                'description' => 'Wallet withdrawal',
                'meta' => json_encode([
                    'gross_amount' => 50,
                    'commission_amount' => 5,
                    'net_amount' => 45,
                    'commission_type' => 'percentage',
                    'commission_value' => 10,
                ]),
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'NANNY1',
                'type' => 'wallet_withdrawal',
                'category' => 'withdrawal',
                'direction' => 'debit',
                'amount' => 72.00,
                'currency' => 'usd',
                'status' => 'failed',
                'description' => 'Failed wallet withdrawal',
                'meta' => json_encode([
                    'gross_amount' => 80,
                    'commission_amount' => 8,
                    'net_amount' => 72,
                    'commission_type' => 'percentage',
                    'commission_value' => 10,
                ]),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $response = $this
            ->withoutMiddleware()
            ->getJson('/api/admin/commission');

        $response
            ->assertOk()
            ->assertJsonPath('data.summary.total_commission_revenue', 15)
            ->assertJsonPath('data.summary.total_withdrawal_volume', 150)
            ->assertJsonPath('data.summary.total_payout_volume', 135)
            ->assertJsonPath('data.summary.withdrawal_count', 2)
            ->assertJsonPath('data.summary.current_period_commission_revenue', 15)
            ->assertJsonPath('data.current_fee.type', 'percentage')
            ->assertJsonPath('data.current_fee.value', 10);

        $rows = $response->json('data.commissions');

        $this->assertCount(2, $rows);
        $this->assertSame('Beth Syttr', $rows[0]['nanny_name']);
        $this->assertSame('50.00', $rows[0]['requested_amount']);
        $this->assertSame('5.00', $rows[0]['commission_amount']);
        $this->assertSame('45.00', $rows[0]['payout_amount']);
        $this->assertSame('completed', $rows[0]['status']);
        $this->assertSame('10%', $rows[0]['commission_percent']);
    }

    private function createAdminSchema(): void
    {
        Schema::create('commission_settings', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('type', 20)->default('percentage');
            $table->decimal('value', 10, 2)->default(10);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    private function createAppDataSchema(): void
    {
        Schema::connection('app_data')->create('users', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->unique();
            $table->string('name')->nullable();
            $table->string('email')->nullable();
            $table->string('role')->nullable();
            $table->timestamps();
        });

        Schema::connection('app_data')->create('wallet_transactions', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20);
            $table->string('counterparty_user_id', 20)->nullable();
            $table->unsignedBigInteger('job_id')->nullable();
            $table->unsignedBigInteger('application_id')->nullable();
            $table->unsignedBigInteger('subscription_purchase_id')->nullable();
            $table->string('type', 50);
            $table->string('category', 50)->default('other');
            $table->string('direction', 10);
            $table->decimal('amount', 10, 2);
            $table->string('currency', 10)->default('usd');
            $table->string('status', 30)->default('completed');
            $table->string('description')->nullable();
            $table->string('stripe_payment_intent_id')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();
        });
    }
}
