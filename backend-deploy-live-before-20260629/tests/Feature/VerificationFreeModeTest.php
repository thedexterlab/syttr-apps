<?php

namespace Tests\Feature;

use App\Services\FeatureFlagService;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class VerificationFreeModeTest extends TestCase
{
    private string $databasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->databasePath = database_path('verification_free_mode_test.sqlite');

        DB::disconnect('sqlite');
        @unlink($this->databasePath);
        touch($this->databasePath);

        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', $this->databasePath);
        Config::set('cache.default', 'array');
        Config::set('filesystems.disks.local.root', storage_path('app/testing-verification-free-mode'));
        Config::set('featureFlags.store.disk', 'local');
        Config::set('featureFlags.store.path', 'feature_flags.json');

        DB::purge('sqlite');
        Storage::disk('local')->delete('feature_flags.json');

        $this->createSchema();
    }

    protected function tearDown(): void
    {
        DB::disconnect('sqlite');
        @unlink($this->databasePath);
        Storage::disk('local')->delete('feature_flags.json');

        parent::tearDown();
    }

    public function test_verification_charge_uses_free_mode_when_flag_is_enabled(): void
    {
        DB::table('users')->insert([
            'user_id' => 'NAN02',
            'name' => 'Free Mode Nanny',
            'email' => 'freemode@example.com',
            'password' => bcrypt('password'),
            'role' => 'syttr',
            'profile_status' => 'pending',
            'profile_status_updated_at' => now(),
            'is_blacklisted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        app(FeatureFlagService::class)->set('verification_free_mode', true);

        $this->postJson('/api/stripe/verification/charge', [
            'user_id' => 'NAN02',
            'amount' => 19.99,
            'currency' => 'usd',
            'stripe_payment_method_id' => 'pm_one_time_123',
            'verification_type' => 'employment',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('free_mode', true)
            ->assertJsonPath('status', 'completed');

        $this->assertDatabaseHas('users', [
            'user_id' => 'NAN02',
            'profile_status' => 'completed',
        ]);

        $this->assertDatabaseHas('user_subscriptions', [
            'user_id' => 'NAN02',
            'status' => 'active',
            'plan' => 'Verification Free Access',
        ]);

        $this->assertDatabaseHas('subscription_purchases', [
            'user_id' => 'NAN02',
            'stripe_payment_status' => 'free_verification',
        ]);
    }

    public function test_admin_can_toggle_feature_flags_at_runtime(): void
    {
        DB::table('users')->insert([
            'user_id' => 'ADM01',
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => bcrypt('password'),
            'role' => 'admin',
            'api_token' => 'admin-token',
            'profile_status' => 'active',
            'is_blacklisted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->withHeader('Authorization', 'Bearer admin-token')
            ->getJson('/api/admin/feature-flags')
            ->assertOk()
            ->assertJsonPath('data.verification_free_mode.enabled', false);

        $this->withHeader('Authorization', 'Bearer admin-token')
            ->postJson('/api/admin/feature-flags/toggle', [
                'flag' => 'verification_free_mode',
                'enabled' => true,
            ])
            ->assertOk()
            ->assertJsonPath('data.enabled', true);

        $this->withHeader('Authorization', 'Bearer admin-token')
            ->getJson('/api/admin/feature-flags')
            ->assertOk()
            ->assertJsonPath('data.verification_free_mode.enabled', true);
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

        Schema::create('user_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->index();
            $table->string('plan')->default('premium');
            $table->string('status')->default('active');
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('currency', 10)->default('USD');
            $table->unsignedBigInteger('payment_method_id')->nullable();
            $table->string('stripe_subscription_id')->nullable();
            $table->timestamp('starts_at')->nullable();
            $table->timestamp('ends_at')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();
        });

        Schema::create('subscription_purchases', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20);
            $table->unsignedBigInteger('subscription_id')->nullable();
            $table->unsignedBigInteger('payment_method_id')->nullable();
            $table->string('plan')->nullable();
            $table->decimal('amount', 10, 2)->default(0);
            $table->string('currency', 10)->default('USD');
            $table->string('stripe_payment_intent_id')->nullable();
            $table->string('stripe_payment_status')->nullable();
            $table->timestamp('purchased_at')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();
        });
    }
}
