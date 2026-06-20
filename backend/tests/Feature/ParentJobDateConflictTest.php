<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ParentJobDateConflictTest extends TestCase
{
    private string $databasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->databasePath = database_path('parent_job_date_conflict_test.sqlite');

        @unlink($this->databasePath);
        touch($this->databasePath);

        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', $this->databasePath);
        Config::set('services.google_maps.key', '');

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

    public function test_parent_can_rebook_same_day_only_when_previous_job_is_canceled(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-28 10:00:00'));

        $this->seedParent('PARCAN', 'Canceled Parent', 'parcan@example.com');
        $this->seedParent('PARPEN', 'Pending Parent', 'parpen@example.com');
        $this->seedParent('PARCOM', 'Completed Parent', 'parcom@example.com');
        $this->seedNanny('NAN01', 'Visible Nanny', 'nanny@example.com');

        $kidCanceled = $this->seedKid('PARCAN', 'Ava');
        $kidPending = $this->seedKid('PARPEN', 'Mia');
        $kidCompleted = $this->seedKid('PARCOM', 'Luca');

        DB::table('parent_jobs')->insert([
            [
                'user_id' => 'PARCAN',
                'kid_ids' => json_encode([$kidCanceled]),
                'kid_names' => 'Ava',
                'hours' => 4,
                'hourly_rate' => 20,
                'price' => 80,
                'start_date' => '2026-03-29',
                'end_date' => '2026-03-29',
                'start_time' => '18:00:00',
                'end_time' => '22:00:00',
                'location' => 'San Diego',
                'status' => 'canceled',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'PARPEN',
                'kid_ids' => json_encode([$kidPending]),
                'kid_names' => 'Mia',
                'hours' => 4,
                'hourly_rate' => 21,
                'price' => 84,
                'start_date' => '2026-03-29',
                'end_date' => '2026-03-29',
                'start_time' => '18:00:00',
                'end_time' => '22:00:00',
                'location' => 'San Diego',
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'PARCOM',
                'kid_ids' => json_encode([$kidCompleted]),
                'kid_names' => 'Luca',
                'hours' => 4,
                'hourly_rate' => 22,
                'price' => 88,
                'start_date' => '2026-03-29',
                'end_date' => '2026-03-29',
                'start_time' => '18:00:00',
                'end_time' => '22:00:00',
                'location' => 'San Diego',
                'status' => 'completed',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $this->postJson('/api/job/store', [
            'user_id' => 'PARCAN',
            'kid_ids' => [$kidCanceled],
            'hours' => 3,
            'hourly_rate' => 25,
            'start_time' => '09:00',
            'end_time' => '12:00',
            'start_date' => '2026-03-29',
            'end_date' => '2026-03-29',
            'location' => 'San Diego',
            'latitude' => 32.7157,
            'longitude' => -117.1611,
        ])
            ->assertStatus(201)
            ->assertJsonPath('success', true);

        $this->postJson('/api/jobs/hire-now', [
            'user_id' => 'PARPEN',
            'nanny_id' => 'NAN01',
            'kids' => [$kidPending],
            'hours' => 3,
            'hourly_rate' => 25,
            'start_time' => '09:00',
            'end_time' => '12:00',
            'start_date' => '2026-03-29',
            'end_date' => '2026-03-29',
            'location' => 'San Diego',
            'latitude' => 32.7157,
            'longitude' => -117.1611,
        ])
            ->assertStatus(422)
            ->assertJsonPath('data.conflicting_status', 'pending');

        $this->postJson('/api/jobs/hire-now', [
            'user_id' => 'PARCOM',
            'nanny_id' => 'NAN01',
            'kids' => [$kidCompleted],
            'hours' => 3,
            'hourly_rate' => 25,
            'start_time' => '09:00',
            'end_time' => '12:00',
            'start_date' => '2026-03-29',
            'end_date' => '2026-03-29',
            'location' => 'San Diego',
            'latitude' => 32.7157,
            'longitude' => -117.1611,
        ])
            ->assertStatus(422)
            ->assertJsonPath('data.conflicting_status', 'completed');
    }

    private function seedParent(string $userId, string $name, string $email): void
    {
        DB::table('users')->insert([
            'user_id' => $userId,
            'referral_code' => 'REF'.$userId,
            'name' => $name,
            'email' => $email,
            'password' => bcrypt('password'),
            'role' => 'parent',
            'profile_status' => 'verified',
            'is_blacklisted' => false,
            'deactivated_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('parent_profiles')->insert([
            'user_id' => $userId,
            'city' => 'San Diego',
            'country' => 'USA',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('payment_methods')->insert([
            'user_id' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedNanny(string $userId, string $name, string $email): void
    {
        DB::table('users')->insert([
            'user_id' => $userId,
            'referral_code' => 'REF'.$userId,
            'name' => $name,
            'email' => $email,
            'password' => bcrypt('password'),
            'role' => 'syttr',
            'profile_status' => 'approved',
            'is_blacklisted' => false,
            'deactivated_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $internalId = (int) DB::table('users')->where('user_id', $userId)->value('id');

        DB::table('syttr_profiles')->insert([
            'user_id' => $internalId,
            'city' => 'San Diego',
            'country' => 'USA',
            'experience_years' => 4,
            'hourly_rate' => 24,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedKid(string $parentUserId, string $name): int
    {
        return (int) DB::table('parent_kids')->insertGetId([
            'parent_profile_id' => $parentUserId,
            'name' => $name,
            'age' => 5,
            'gender' => 'female',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createSchema(): void
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
            $table->string('profile_status')->nullable();
            $table->timestamp('profile_status_updated_at')->nullable();
            $table->timestamp('account_deletion_requested_at')->nullable();
            $table->timestamp('account_deletion_scheduled_for')->nullable();
            $table->timestamp('deactivated_at')->nullable();
            $table->boolean('is_blacklisted')->default(false);
            $table->text('blacklisted_reason')->nullable();
            $table->string('api_token')->nullable();
            $table->timestamps();
        });

        Schema::create('parent_profiles', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->index();
            $table->string('phone')->nullable();
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->string('country')->nullable();
            $table->string('gender')->nullable();
            $table->integer('children_count')->nullable();
            $table->text('bio')->nullable();
            $table->string('user_image')->nullable();
            $table->timestamps();
        });

        Schema::create('parent_kids', function (Blueprint $table) {
            $table->id();
            $table->string('parent_profile_id', 20)->index();
            $table->string('name')->nullable();
            $table->integer('age')->nullable();
            $table->string('gender')->nullable();
            $table->text('allergies')->nullable();
            $table->text('medical_conditions')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();
        });

        Schema::create('syttr_profiles', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('phone')->nullable();
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->string('country')->nullable();
            $table->integer('experience_years')->nullable();
            $table->decimal('hourly_rate', 10, 2)->nullable();
            $table->text('bio')->nullable();
            $table->string('user_image')->nullable();
            $table->string('certificate')->nullable();
            $table->timestamps();
        });

        Schema::create('parent_jobs', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->index();
            $table->json('kid_ids')->nullable();
            $table->string('kid_names')->nullable();
            $table->decimal('hours', 10, 2)->nullable();
            $table->decimal('hourly_rate', 10, 2)->nullable();
            $table->decimal('price', 10, 2)->nullable();
            $table->date('start_date')->nullable();
            $table->date('end_date')->nullable();
            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();
            $table->string('location')->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->string('status')->nullable();
            $table->decimal('late_cancellation_fee', 10, 2)->nullable();
            $table->timestamp('late_cancellation_fee_charged_at')->nullable();
            $table->timestamps();
        });

        Schema::create('parent_job_applications', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('job_id');
            $table->string('nanny_id', 20)->index();
            $table->string('status')->nullable();
            $table->string('request_source')->nullable();
            $table->text('message')->nullable();
            $table->unsignedTinyInteger('parent_rating')->nullable();
            $table->text('parent_review')->nullable();
            $table->timestamp('parent_rated_at')->nullable();
            $table->unsignedTinyInteger('nanny_rating')->nullable();
            $table->text('nanny_review')->nullable();
            $table->timestamp('nanny_rated_at')->nullable();
            $table->timestamp('rating_prompted_parent_at')->nullable();
            $table->timestamp('rating_prompted_nanny_at')->nullable();
            $table->timestamp('nanny_canceled_at')->nullable();
            $table->boolean('nanny_canceled_within_24h')->nullable();
            $table->integer('nanny_reliability_penalty')->nullable();
            $table->timestamps();
        });

        Schema::create('payment_methods', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->index();
            $table->timestamps();
        });
    }
}
