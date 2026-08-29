<?php

namespace Tests\Feature;

use App\Models\WalletTransaction;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class WalletWithdrawalCommissionTest extends TestCase
{
    private string $appDatabasePath;

    private string $adminDatabasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->appDatabasePath = database_path('wallet_controller_test.sqlite');
        $this->adminDatabasePath = database_path('wallet_controller_admin_test.sqlite');

        @unlink($this->appDatabasePath);
        @unlink($this->adminDatabasePath);
        touch($this->appDatabasePath);
        touch($this->adminDatabasePath);

        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', $this->appDatabasePath);
        Config::set('database.connections.admin_panel', [
            'driver' => 'sqlite',
            'database' => $this->adminDatabasePath,
            'prefix' => '',
            'foreign_key_constraints' => true,
        ]);
        Config::set('services.wallet.currency', 'usd');
        Config::set('services.stripe.secret', 'sk_test_wallet_commission');

        DB::purge('sqlite');
        DB::purge('admin_panel');

        $this->createAppSchema();
        $this->createAdminSchema();
    }

    protected function tearDown(): void
    {
        DB::disconnect('sqlite');
        DB::disconnect('admin_panel');

        @unlink($this->appDatabasePath);
        @unlink($this->adminDatabasePath);

        parent::tearDown();
    }

    public function test_withdrawal_applies_admin_commission_server_side_and_reserves_gross_amount(): void
    {
        $now = Carbon::parse('2026-03-25 12:00:00');

        DB::table('users')->insert([
            'user_id' => 'N9A1B',
            'referral_code' => 'REF12345',
            'name' => 'Test Nanny',
            'email' => 'nanny@example.com',
            'password' => bcrypt('password'),
            'role' => 'nanny',
            'api_token' => 'withdraw-token',
            'stripe_connect_account_id' => 'acct_test_123',
            'stripe_connect_details_submitted' => true,
            'stripe_connect_charges_enabled' => true,
            'stripe_connect_payouts_enabled' => true,
            'stripe_external_account_id' => 'ba_test_123',
            'stripe_external_account_type' => 'bank',
            'stripe_external_account_last4' => '6789',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::table('wallet_transactions')->insert([
            'user_id' => 'N9A1B',
            'type' => 'job_payment',
            'category' => 'wallet',
            'direction' => 'credit',
            'amount' => 150.00,
            'currency' => 'usd',
            'status' => 'completed',
            'description' => 'Completed booking payout',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        DB::connection('admin_panel')->table('commission_settings')->insert([
            'name' => 'platform_fee',
            'type' => 'percentage',
            'value' => 10.00,
            'is_active' => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        Http::fake([
            'https://api.stripe.com/v1/accounts/acct_test_123' => Http::response($this->stripeAccountPayload(), 200),
            'https://api.stripe.com/v1/balance_settings' => Http::response(['object' => 'balance_settings'], 200),
            'https://api.stripe.com/v1/balance' => Http::response([
                'object' => 'balance',
                'available' => [
                    ['amount' => 0, 'currency' => 'usd'],
                ],
            ], 200),
            'https://api.stripe.com/v1/transfers' => Http::response([
                'id' => 'tr_test_123',
                'object' => 'transfer',
                'amount' => 9000,
                'currency' => 'usd',
            ], 200),
            'https://api.stripe.com/v1/payouts' => Http::response([
                'id' => 'po_test_123',
                'object' => 'payout',
                'status' => 'pending',
                'amount' => 9000,
                'currency' => 'usd',
                'arrival_date' => $now->copy()->addDay()->timestamp,
            ], 200),
        ]);

        $response = $this
            ->withToken('withdraw-token')
            ->postJson('/api/wallet/withdraw', [
                'amount' => 100,
                'note' => 'Weekly payout',
                'payout_method' => 'bank',
            ]);

        $response
            ->assertCreated()
            ->assertJsonPath('gross_amount', 100)
            ->assertJsonPath('commission_amount', 10)
            ->assertJsonPath('net_amount', 90)
            ->assertJsonPath('transaction.amount', 90)
            ->assertJsonPath('transaction.gross_amount', 100)
            ->assertJsonPath('transaction.commission_amount', 10)
            ->assertJsonPath('transaction.net_amount', 90)
            ->assertJsonPath('balance', 50);

        $withdrawal = WalletTransaction::query()
            ->where('type', 'wallet_withdrawal')
            ->firstOrFail();

        $this->assertSame('processing', $withdrawal->status);
        $this->assertEquals(90.0, (float) $withdrawal->amount);
        $this->assertSame('percentage', $withdrawal->meta['commission_type']);
        $this->assertEquals(10.0, (float) $withdrawal->meta['commission_value']);
        $this->assertEquals(100.0, (float) $withdrawal->meta['gross_amount']);
        $this->assertEquals(10.0, (float) $withdrawal->meta['commission_amount']);
        $this->assertEquals(90.0, (float) $withdrawal->meta['net_amount']);

        $this
            ->withToken('withdraw-token')
            ->getJson('/api/wallet')
            ->assertOk()
            ->assertJsonPath('balance', 50)
            ->assertJsonPath('debits_total', 100);

        $transactionsResponse = $this
            ->withToken('withdraw-token')
            ->getJson('/api/wallet/transactions')
            ->assertOk()
            ->json('data');

        $serializedWithdrawal = collect($transactionsResponse)
            ->firstWhere('type', 'wallet_withdrawal');

        $this->assertNotNull($serializedWithdrawal);
        $this->assertEquals(100.0, $serializedWithdrawal['gross_amount']);
        $this->assertEquals(10.0, $serializedWithdrawal['commission_amount']);
        $this->assertEquals(90.0, $serializedWithdrawal['net_amount']);

        Http::assertSent(function ($request) {
            if ($request->url() !== 'https://api.stripe.com/v1/payouts') {
                return false;
            }

            return (int) $request['amount'] === 9000
                && (string) $request['destination'] === 'ba_test_123'
                && (string) $request['currency'] === 'usd';
        });
    }

    private function createAppSchema(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->unique();
            $table->string('referral_code')->nullable();
            $table->string('name')->nullable();
            $table->string('email')->nullable();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password')->nullable();
            $table->string('remember_token', 100)->nullable();
            $table->string('role')->nullable();
            $table->string('api_token')->nullable();
            $table->string('stripe_connect_account_id')->nullable();
            $table->string('stripe_connect_account_type')->nullable();
            $table->timestamp('stripe_connect_onboarded_at')->nullable();
            $table->boolean('stripe_connect_details_submitted')->default(false);
            $table->boolean('stripe_connect_charges_enabled')->default(false);
            $table->boolean('stripe_connect_payouts_enabled')->default(false);
            $table->string('stripe_external_account_id')->nullable();
            $table->string('stripe_external_account_type')->nullable();
            $table->string('stripe_external_account_last4')->nullable();
            $table->timestamps();
        });

        Schema::create('wallet_transactions', function (Blueprint $table) {
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

    private function createAdminSchema(): void
    {
        Schema::connection('admin_panel')->create('commission_settings', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('type', 20)->default('percentage');
            $table->decimal('value', 10, 2)->default(10);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    private function stripeAccountPayload(): array
    {
        return [
            'id' => 'acct_test_123',
            'object' => 'account',
            'type' => 'custom',
            'details_submitted' => true,
            'charges_enabled' => true,
            'payouts_enabled' => true,
            'external_accounts' => [
                'object' => 'list',
                'data' => [
                    [
                        'id' => 'ba_test_123',
                        'object' => 'bank_account',
                        'bank_name' => 'Test Bank',
                        'last4' => '6789',
                        'currency' => 'usd',
                        'default_for_currency' => true,
                    ],
                ],
            ],
        ];
    }
}
