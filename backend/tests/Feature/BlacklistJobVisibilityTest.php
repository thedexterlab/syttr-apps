<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class BlacklistJobVisibilityTest extends TestCase
{
    private string $databasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->databasePath = database_path('blacklist_job_visibility_test.sqlite');

        @unlink($this->databasePath);
        touch($this->databasePath);

        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', $this->databasePath);

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

    public function test_blacklisted_parents_and_nannies_do_not_leak_through_job_endpoints(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-25 12:00:00'));

        DB::table('users')->insert([
            [
                'user_id' => 'PAR01',
                'referral_code' => 'REFPAR01',
                'name' => 'Visible Parent',
                'email' => 'parent@example.com',
                'password' => bcrypt('password'),
                'role' => 'parent',
                'profile_status' => 'verified',
                'is_blacklisted' => false,
                'blacklisted_reason' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'PARBL',
                'referral_code' => 'REFPARBL',
                'name' => 'Blacklisted Parent',
                'email' => 'blocked-parent@example.com',
                'password' => bcrypt('password'),
                'role' => 'parent',
                'profile_status' => 'blacklisted',
                'is_blacklisted' => true,
                'blacklisted_reason' => 'Admin blacklist',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'NAN01',
                'referral_code' => 'REFNAN01',
                'name' => 'Visible Nanny',
                'email' => 'nanny@example.com',
                'password' => bcrypt('password'),
                'role' => 'syttr',
                'profile_status' => 'approved',
                'is_blacklisted' => false,
                'blacklisted_reason' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'NANBL',
                'referral_code' => 'REFNANBL',
                'name' => 'Blacklisted Nanny',
                'email' => 'blocked-nanny@example.com',
                'password' => bcrypt('password'),
                'role' => 'syttr',
                'profile_status' => 'blacklisted',
                'is_blacklisted' => true,
                'blacklisted_reason' => 'Admin blacklist',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::table('parent_profiles')->insert([
            [
                'user_id' => 'PAR01',
                'city' => 'Austin',
                'country' => 'USA',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'PARBL',
                'city' => 'Dallas',
                'country' => 'USA',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $visibleNannyInternalId = (int) DB::table('users')->where('user_id', 'NAN01')->value('id');
        $blockedNannyInternalId = (int) DB::table('users')->where('user_id', 'NANBL')->value('id');

        DB::table('syttr_profiles')->insert([
            [
                'user_id' => $visibleNannyInternalId,
                'city' => 'Austin',
                'country' => 'USA',
                'experience_years' => 4,
                'hourly_rate' => 20,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => $blockedNannyInternalId,
                'city' => 'Dallas',
                'country' => 'USA',
                'experience_years' => 2,
                'hourly_rate' => 18,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::table('parent_kids')->insert([
            [
                'parent_profile_id' => 'PAR01',
                'name' => 'Ava',
                'age' => 5,
                'gender' => 'female',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'parent_profile_id' => 'PARBL',
                'name' => 'Luca',
                'age' => 6,
                'gender' => 'male',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $visibleJobId = DB::table('parent_jobs')->insertGetId([
            'user_id' => 'PAR01',
            'kid_ids' => json_encode([1]),
            'kid_names' => 'Ava',
            'hours' => 4,
            'hourly_rate' => 20,
            'price' => 80,
            'start_date' => '2026-03-30',
            'end_date' => '2026-03-30',
            'start_time' => '18:00:00',
            'end_time' => '22:00:00',
            'location' => 'Austin',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $blacklistedParentJobId = DB::table('parent_jobs')->insertGetId([
            'user_id' => 'PARBL',
            'kid_ids' => json_encode([2]),
            'kid_names' => 'Luca',
            'hours' => 3,
            'hourly_rate' => 22,
            'price' => 66,
            'start_date' => '2026-03-31',
            'end_date' => '2026-03-31',
            'start_time' => '19:00:00',
            'end_time' => '22:00:00',
            'location' => 'Dallas',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('parent_job_applications')->insert([
            [
                'job_id' => $visibleJobId,
                'nanny_id' => 'NAN01',
                'status' => 'pending',
                'request_source' => 'job_post',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'job_id' => $visibleJobId,
                'nanny_id' => 'NANBL',
                'status' => 'pending',
                'request_source' => 'job_post',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $feedResponse = $this->getJson('/api/job/index');
        $feedResponse->assertOk();

        $jobIds = collect($feedResponse->json('jobs'))->pluck('job_id')->all();
        $this->assertContains($visibleJobId, $jobIds);
        $this->assertNotContains($blacklistedParentJobId, $jobIds);

        $detailsResponse = $this->getJson("/api/job/{$visibleJobId}/details");
        $detailsResponse->assertOk();
        $detailsResponse->assertJsonCount(1, 'data.applications');
        $detailsResponse->assertJsonPath('data.applications.0.nanny_id', 'NAN01');
        $detailsResponse->assertJsonCount(1, 'data.nannies');

        $this->postJson('/api/jobs/send-request', [
            'job_id' => $visibleJobId,
            'nanny_id' => 'NANBL',
        ])
            ->assertStatus(403)
            ->assertJsonPath('status', 'blacklisted');
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
    }
}
