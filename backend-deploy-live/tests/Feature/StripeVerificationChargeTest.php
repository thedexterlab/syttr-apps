<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class StripeVerificationChargeTest extends TestCase
{
    private string $databasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->databasePath = database_path('stripe_verification_charge_test.sqlite');

        DB::disconnect('sqlite');
        @unlink($this->databasePath);
        touch($this->databasePath);

        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', $this->databasePath);
        Config::set('cache.default', 'array');
        Config::set('services.stripe.secret', 'sk_test_verification');
        Config::set('services.stripe.verify_ssl', false);

        DB::purge('sqlite');

        $this->createSchema();
    }

    protected function tearDown(): void
    {
        DB::disconnect('sqlite');
        @unlink($this->databasePath);

        parent::tearDown();
    }

    public function test_verification_charge_accepts_one_time_stripe_payment_method_without_saved_card(): void
    {
        DB::table('users')->insert([
            'user_id' => 'NAN01',
            'name' => 'Verification Nanny',
            'email' => 'nanny@example.com',
            'password' => bcrypt('password'),
            'role' => 'syttr',
            'profile_status' => 'pending',
            'profile_status_updated_at' => now(),
            'is_blacklisted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://api.stripe.com/v1/payment_intents' => Http::response([
                'id' => 'pi_verify_123',
                'status' => 'succeeded',
                'amount' => 1999,
                'currency' => 'usd',
            ], 200),
        ]);

        $this->postJson('/api/stripe/verification/charge', [
            'user_id' => 'NAN01',
            'amount' => 19.99,
            'currency' => 'usd',
            'stripe_payment_method_id' => 'pm_one_time_123',
            'verification_type' => 'employment',
            'description' => 'Syttr verification (employment)',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('payment_intent_id', 'pi_verify_123')
            ->assertJsonPath('status', 'succeeded')
            ->assertJsonPath('amount', 19.99)
            ->assertJsonPath('currency', 'usd');

        Http::assertSent(function ($request) {
            return $request->url() === 'https://api.stripe.com/v1/payment_intents'
                && $request['payment_method'] === 'pm_one_time_123'
                && $request['metadata[payment_source]'] === 'one_time'
                && ! isset($request['customer']);
        });

        $this->assertDatabaseHas('stripe_transactions', [
            'user_id' => 'NAN01',
            'source' => 'stripe.verification.charge',
            'category' => 'verification',
            'type' => 'payment_intent',
            'status' => 'succeeded',
            'stripe_payment_intent_id' => 'pi_verify_123',
            'stripe_payment_method_id' => 'pm_one_time_123',
        ]);
    }

    private function createSchema(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->unique();
            $table->string('name')->nullable();
            $table->string('email')->nullable()->unique();
            $table->string('password')->nullable();
            $table->string('role')->nullable();
            $table->string('profile_status')->nullable();
            $table->timestamp('profile_status_updated_at')->nullable();
            $table->boolean('is_blacklisted')->default(false);
            $table->string('api_token')->nullable();
            $table->string('stripe_customer_id')->nullable();
            $table->rememberToken();
            $table->timestamps();
        });

        Schema::create('taz_verification_orders', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->nullable();
            $table->string('public_user_id', 32)->nullable()->index();
            $table->string('taz_order_guid', 120)->nullable()->unique();
            $table->string('provider_status', 64)->nullable();
            $table->string('normalized_status', 64)->nullable()->index();
            $table->text('quickapp_link')->nullable();
            $table->timestamps();
        });

        Schema::create('stripe_transactions', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->nullable();
            $table->string('counterparty_user_id', 20)->nullable();
            $table->unsignedBigInteger('payment_method_id')->nullable();
            $table->unsignedBigInteger('job_id')->nullable();
            $table->unsignedBigInteger('application_id')->nullable();
            $table->unsignedBigInteger('subscription_purchase_id')->nullable();
            $table->string('source', 100);
            $table->string('category', 50)->default('other');
            $table->string('type', 50)->default('payment');
            $table->string('status', 50)->default('pending');
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('currency', 10)->nullable();
            $table->string('stripe_payment_intent_id')->nullable();
            $table->string('stripe_charge_id')->nullable();
            $table->string('stripe_event_id')->nullable()->unique();
            $table->string('stripe_object_type', 50)->nullable();
            $table->string('stripe_payment_method_id')->nullable();
            $table->string('description')->nullable();
            $table->text('error_message')->nullable();
            $table->json('request_payload')->nullable();
            $table->json('response_payload')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();
        });
    }
}
