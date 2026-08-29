<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ActiveJobCompletionRemindersTest extends TestCase
{
    private string $databasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->databasePath = database_path('active_job_completion_reminders_test.sqlite');
        @unlink($this->databasePath);
        touch($this->databasePath);

        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', $this->databasePath);
        Config::set('app.timezone', 'UTC');
        Config::set('services.stripe.secret', 'sk_test_job_reminders');
        Config::set('services.stripe.verify_ssl', false);

        DB::purge('sqlite');
        $this->createSchema();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        DB::disconnect('sqlite');
        @unlink($this->databasePath);

        parent::tearDown();
    }

    public function test_it_sends_parent_and_nanny_reminders_thirty_minutes_before_end_time(): void
    {
        $this->seedBookingFixture();
        Carbon::setTestNow('2026-05-14 14:00:00');

        $this->artisan('jobs:send-active-completion-reminders')->assertSuccessful();

        $notifications = DB::table('user_notifications')
            ->orderBy('id')
            ->get();

        $this->assertCount(2, $notifications);
        $this->assertSame('P1001', $notifications[0]->recipient_user_id);
        $this->assertSame('job_complete_reminder_parent', $notifications[0]->type);
        $this->assertStringContainsString('30 minutes', $notifications[0]->message);
        $this->assertSame('N2001', $notifications[1]->recipient_user_id);
        $this->assertSame('job_complete_reminder_nanny', $notifications[1]->type);
        $this->assertStringContainsString('30 minutes', $notifications[1]->message);
    }

    public function test_it_auto_charges_late_completion_penalty_to_platform_only(): void
    {
        $this->seedBookingFixture();
        Carbon::setTestNow('2026-05-14 16:30:00');

        Http::fake([
            'https://api.stripe.com/v1/payment_methods/pm_parent_123' => Http::response([
                'id' => 'pm_parent_123',
                'customer' => 'cus_parent_123',
            ], 200),
            'https://api.stripe.com/v1/customers/cus_parent_123' => Http::response([
                'id' => 'cus_parent_123',
            ], 200),
            'https://api.stripe.com/v1/payment_intents' => Http::response([
                'id' => 'pi_late_123',
                'status' => 'succeeded',
            ], 200),
        ]);

        $this->artisan('jobs:send-active-completion-reminders')->assertSuccessful();

        $penaltyTransaction = DB::table('wallet_transactions')
            ->where('type', 'late_completion_penalty')
            ->first();

        $this->assertNotNull($penaltyTransaction);
        $this->assertSame('P1001', $penaltyTransaction->user_id);
        $this->assertNull($penaltyTransaction->counterparty_user_id);
        $this->assertEquals(50.00, (float) $penaltyTransaction->amount);

        $nannyPayout = DB::table('wallet_transactions')
            ->where('type', 'job_payout')
            ->first();

        $this->assertNull($nannyPayout);

        $stripeRecord = DB::table('stripe_transactions')
            ->where('source', 'parent_job.late_completion_penalty')
            ->first();

        $this->assertNotNull($stripeRecord);
        $this->assertEquals(50.00, (float) $stripeRecord->amount);

        $parentNotification = DB::table('user_notifications')
            ->where('type', 'late_completion_penalty_charged')
            ->first();
        $nannyNotification = DB::table('user_notifications')
            ->where('type', 'late_completion_penalty_charged_notice')
            ->first();

        $this->assertNotNull($parentNotification);
        $this->assertNotNull($nannyNotification);
    }

    public function test_it_skips_reminders_and_penalty_when_extra_hours_request_was_approved(): void
    {
        $this->seedBookingFixture();

        DB::table('user_notifications')->insert([
            'recipient_user_id' => 'N2001',
            'sender_user_id' => 'P1001',
            'type' => 'extra_hours_request',
            'title' => 'Extra Hours Request',
            'message' => 'Approved.',
            'data' => json_encode([
                'job_id' => 1,
                'application_id' => 1,
                'status' => 'accepted',
            ]),
            'is_read' => 1,
            'created_at' => '2026-05-14 15:00:00',
            'updated_at' => '2026-05-14 15:00:00',
        ]);

        Carbon::setTestNow('2026-05-14 16:30:00');
        Http::fake();

        $this->artisan('jobs:send-active-completion-reminders')->assertSuccessful();

        $this->assertSame(1, DB::table('user_notifications')->count());
        $this->assertSame(0, DB::table('wallet_transactions')->count());
        $this->assertSame(0, DB::table('stripe_transactions')->count());
        Http::assertNothingSent();
    }

    private function seedBookingFixture(): void
    {
        DB::table('users')->insert([
            [
                'user_id' => 'P1001',
                'name' => 'Parent One',
                'api_token' => 'parent-token',
                'stripe_customer_id' => 'cus_parent_123',
                'created_at' => '2026-05-14 00:00:00',
                'updated_at' => '2026-05-14 00:00:00',
            ],
            [
                'user_id' => 'N2001',
                'name' => 'Nanny One',
                'api_token' => 'nanny-token',
                'stripe_customer_id' => null,
                'created_at' => '2026-05-14 00:00:00',
                'updated_at' => '2026-05-14 00:00:00',
            ],
        ]);

        DB::table('parent_jobs')->insert([
            'id' => 1,
            'user_id' => 'P1001',
            'hours' => 5.00,
            'hourly_rate' => 25.00,
            'price' => 125.00,
            'start_date' => '2026-05-14',
            'end_date' => '2026-05-14',
            'start_time' => '09:30',
            'end_time' => '14:30',
            'location' => 'Test Address',
            'status' => 'accepted',
            'created_at' => '2026-05-14 00:00:00',
            'updated_at' => '2026-05-14 00:00:00',
        ]);

        DB::table('parent_job_applications')->insert([
            'id' => 1,
            'job_id' => 1,
            'nanny_id' => 'N2001',
            'status' => 'accepted',
            'request_source' => 'job_post',
            'created_at' => '2026-05-14 00:00:00',
            'updated_at' => '2026-05-14 00:00:00',
        ]);

        DB::table('payment_methods')->insert([
            'id' => 1,
            'user_id' => 'P1001',
            'brand' => 'visa',
            'last4' => '4242',
            'stripe_payment_method_id' => 'pm_parent_123',
            'is_default' => 1,
            'created_at' => '2026-05-14 00:00:00',
            'updated_at' => '2026-05-14 00:00:00',
        ]);
    }

    private function createSchema(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->unique();
            $table->string('name')->nullable();
            $table->string('api_token')->nullable();
            $table->string('stripe_customer_id')->nullable();
            $table->timestamps();
        });

        Schema::create('parent_jobs', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20);
            $table->decimal('hours', 10, 2)->nullable();
            $table->decimal('hourly_rate', 10, 2)->nullable();
            $table->decimal('price', 10, 2)->nullable();
            $table->date('start_date')->nullable();
            $table->date('end_date')->nullable();
            $table->string('start_time')->nullable();
            $table->string('end_time')->nullable();
            $table->string('location')->nullable();
            $table->string('status', 30)->default('pending');
            $table->timestamps();
        });

        Schema::create('parent_job_applications', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('job_id');
            $table->string('nanny_id', 20);
            $table->string('status', 30)->default('pending');
            $table->string('request_source')->nullable();
            $table->timestamps();
        });

        Schema::create('user_notifications', function (Blueprint $table) {
            $table->id();
            $table->string('recipient_user_id', 20)->index();
            $table->string('sender_user_id', 20)->nullable()->index();
            $table->string('type')->default('general');
            $table->string('title')->nullable();
            $table->text('message')->nullable();
            $table->json('data')->nullable();
            $table->boolean('is_read')->default(false);
            $table->timestamp('opened_at')->nullable();
            $table->timestamps();
        });

        Schema::create('payment_methods', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20);
            $table->string('brand')->nullable();
            $table->string('last4', 4)->nullable();
            $table->string('stripe_payment_method_id')->nullable();
            $table->boolean('is_default')->default(false);
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

        Schema::create('stripe_transactions', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->nullable();
            $table->string('counterparty_user_id', 20)->nullable();
            $table->unsignedBigInteger('payment_method_id')->nullable();
            $table->unsignedBigInteger('job_id')->nullable();
            $table->unsignedBigInteger('application_id')->nullable();
            $table->unsignedBigInteger('subscription_purchase_id')->nullable();
            $table->string('source', 50)->nullable();
            $table->string('category', 50)->nullable();
            $table->string('type', 50)->nullable();
            $table->string('status', 30)->default('completed');
            $table->decimal('amount', 10, 2)->nullable();
            $table->string('currency', 10)->default('usd');
            $table->string('stripe_payment_intent_id')->nullable();
            $table->string('stripe_charge_id')->nullable();
            $table->string('stripe_event_id')->nullable();
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
