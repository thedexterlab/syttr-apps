<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ParentHireRequestVisibilityTest extends TestCase
{
    private string $databasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->databasePath = database_path('parent_hire_request_visibility_test.sqlite');

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

    public function test_parent_hire_requests_only_show_in_job_status_until_nanny_decides(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-28 13:00:00'));

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
                'deactivated_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'NAN01',
                'referral_code' => 'REFNAN01',
                'name' => 'Pending Hire Nanny',
                'email' => 'nanny1@example.com',
                'password' => bcrypt('password'),
                'role' => 'syttr',
                'profile_status' => 'approved',
                'is_blacklisted' => false,
                'deactivated_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'NAN02',
                'referral_code' => 'REFNAN02',
                'name' => 'Job Post Nanny',
                'email' => 'nanny2@example.com',
                'password' => bcrypt('password'),
                'role' => 'syttr',
                'profile_status' => 'approved',
                'is_blacklisted' => false,
                'deactivated_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::table('parent_profiles')->insert([
            'user_id' => 'PAR01',
            'city' => 'San Diego',
            'country' => 'USA',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $pendingHireNannyInternalId = (int) DB::table('users')->where('user_id', 'NAN01')->value('id');
        $jobPostNannyInternalId = (int) DB::table('users')->where('user_id', 'NAN02')->value('id');

        DB::table('syttr_profiles')->insert([
            [
                'user_id' => $pendingHireNannyInternalId,
                'city' => 'San Diego',
                'country' => 'USA',
                'experience_years' => 4,
                'hourly_rate' => 24,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => $jobPostNannyInternalId,
                'city' => 'San Diego',
                'country' => 'USA',
                'experience_years' => 3,
                'hourly_rate' => 22,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $kidId = DB::table('parent_kids')->insertGetId([
            'parent_profile_id' => 'PAR01',
            'name' => 'Ava',
            'age' => 5,
            'gender' => 'female',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $hireRequestJobId = DB::table('parent_jobs')->insertGetId([
            'user_id' => 'PAR01',
            'kid_ids' => json_encode([$kidId]),
            'kid_names' => 'Ava',
            'hours' => 4,
            'hourly_rate' => 24,
            'price' => 96,
            'start_date' => '2026-03-30',
            'end_date' => '2026-03-30',
            'start_time' => '18:00:00',
            'end_time' => '22:00:00',
            'location' => 'San Diego',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $jobPostJobId = DB::table('parent_jobs')->insertGetId([
            'user_id' => 'PAR01',
            'kid_ids' => json_encode([$kidId]),
            'kid_names' => 'Ava',
            'hours' => 3,
            'hourly_rate' => 22,
            'price' => 66,
            'start_date' => '2026-03-31',
            'end_date' => '2026-03-31',
            'start_time' => '17:00:00',
            'end_time' => '20:00:00',
            'location' => 'San Diego',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $hireRequestApplicationId = DB::table('parent_job_applications')->insertGetId([
            'job_id' => $hireRequestJobId,
            'nanny_id' => 'NAN01',
            'status' => 'hire_requested',
            'request_source' => 'hire_request',
            'message' => 'source:hire_now',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $jobPostApplicationId = DB::table('parent_job_applications')->insertGetId([
            'job_id' => $jobPostJobId,
            'nanny_id' => 'NAN02',
            'status' => 'pending',
            'request_source' => 'job_post',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_notifications')->insert([
            'recipient_user_id' => 'NAN01',
            'sender_user_id' => 'PAR01',
            'type' => 'hire_request',
            'title' => 'Hire Request',
            'message' => 'Visible Parent sent you a hire request.',
            'data' => json_encode([
                'job_id' => $hireRequestJobId,
                'application_id' => $hireRequestApplicationId,
                'request_source' => 'hire_request',
                'application' => [
                    'id' => $hireRequestApplicationId,
                    'application_id' => $hireRequestApplicationId,
                    'request_source' => 'hire_request',
                    'status' => 'hire_requested',
                ],
            ]),
            'is_read' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $jobRequestsResponse = $this->getJson('/api/job-requests?user_id=PAR01');
        $jobRequestsResponse->assertOk();
        $jobRequestsResponse->assertJsonCount(1, 'data');
        $jobRequestsResponse->assertJsonPath('data.0.application_id', $jobPostApplicationId);
        $jobRequestsResponse->assertJsonMissing([
            'application_id' => $hireRequestApplicationId,
        ]);

        $jobStatusResponse = $this->postJson('/api/job/parent', [
            'user_id' => 'PAR01',
            'per_page' => 10,
        ]);
        $jobStatusResponse->assertOk();

        $jobs = collect($jobStatusResponse->json('data.jobs'));
        $hireRequestJob = $jobs->firstWhere('job_id', $hireRequestJobId);

        $this->assertNotNull($hireRequestJob);
        $this->assertSame('hire_request', $hireRequestJob['request_source']);
        $this->assertSame('decision_pending', $hireRequestJob['parent_display_status']);
        $this->assertCount(1, $hireRequestJob['applications']);
        $this->assertSame('hire_requested', $hireRequestJob['applications'][0]['status']);
    }

    public function test_job_feed_hides_job_after_same_sitter_accepts_it(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-28 13:00:00'));

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
                'deactivated_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'NAN01',
                'referral_code' => 'REFNAN01',
                'name' => 'Accepted Nanny',
                'email' => 'nanny1@example.com',
                'password' => bcrypt('password'),
                'role' => 'syttr',
                'profile_status' => 'approved',
                'is_blacklisted' => false,
                'deactivated_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::table('parent_profiles')->insert([
            'user_id' => 'PAR01',
            'city' => 'San Diego',
            'country' => 'USA',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $acceptedNannyInternalId = (int) DB::table('users')->where('user_id', 'NAN01')->value('id');

        DB::table('syttr_profiles')->insert([
            'user_id' => $acceptedNannyInternalId,
            'city' => 'San Diego',
            'country' => 'USA',
            'experience_years' => 4,
            'hourly_rate' => 24,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $kidId = DB::table('parent_kids')->insertGetId([
            'parent_profile_id' => 'PAR01',
            'name' => 'Ava',
            'age' => 5,
            'gender' => 'female',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $jobId = DB::table('parent_jobs')->insertGetId([
            'user_id' => 'PAR01',
            'kid_ids' => json_encode([$kidId]),
            'kid_names' => 'Ava',
            'hours' => 4,
            'hourly_rate' => 24,
            'price' => 96,
            'start_date' => '2026-03-30',
            'end_date' => '2026-03-30',
            'start_time' => '18:00:00',
            'end_time' => '22:00:00',
            'location' => 'San Diego',
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('parent_job_applications')->insert([
            'job_id' => $jobId,
            'nanny_id' => 'NAN01',
            'status' => 'accepted',
            'request_source' => 'job_post',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $feedResponse = $this->getJson('/api/job/index?nanny_id=NAN01');
        $feedResponse->assertOk();

        $jobIds = collect($feedResponse->json('jobs'))->pluck('job_id')->all();
        $this->assertNotContains($jobId, $jobIds);
    }

    public function test_parent_job_requests_show_hire_request_after_sitter_accepts(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-28 13:00:00'));

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
                'deactivated_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'NAN01',
                'referral_code' => 'REFNAN01',
                'name' => 'Accepted Nanny',
                'email' => 'nanny1@example.com',
                'password' => bcrypt('password'),
                'role' => 'syttr',
                'profile_status' => 'approved',
                'is_blacklisted' => false,
                'deactivated_at' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::table('parent_profiles')->insert([
            'user_id' => 'PAR01',
            'city' => 'San Diego',
            'country' => 'USA',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $acceptedNannyInternalId = (int) DB::table('users')->where('user_id', 'NAN01')->value('id');

        DB::table('syttr_profiles')->insert([
            'user_id' => $acceptedNannyInternalId,
            'city' => 'San Diego',
            'country' => 'USA',
            'experience_years' => 4,
            'hourly_rate' => 24,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $kidId = DB::table('parent_kids')->insertGetId([
            'parent_profile_id' => 'PAR01',
            'name' => 'Ava',
            'age' => 5,
            'gender' => 'female',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $jobId = DB::table('parent_jobs')->insertGetId([
            'user_id' => 'PAR01',
            'kid_ids' => json_encode([$kidId]),
            'kid_names' => 'Ava',
            'hours' => 4,
            'hourly_rate' => 24,
            'price' => 96,
            'start_date' => '2026-03-30',
            'end_date' => '2026-03-30',
            'start_time' => '18:00:00',
            'end_time' => '22:00:00',
            'location' => 'San Diego',
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $applicationId = DB::table('parent_job_applications')->insertGetId([
            'job_id' => $jobId,
            'nanny_id' => 'NAN01',
            'status' => 'accepted',
            'request_source' => 'hire_request',
            'message' => 'source:hire_now',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('user_notifications')->insert([
            'recipient_user_id' => 'PAR01',
            'sender_user_id' => 'NAN01',
            'type' => 'hire_accepted',
            'title' => 'Hire Request Accepted',
            'message' => 'Your sitter has accepted the job request.',
            'data' => json_encode([
                'job_id' => $jobId,
                'application_id' => $applicationId,
                'request_source' => 'hire_request',
                'status' => 'accepted',
                'application_status' => 'accepted',
                'application' => [
                    'id' => $applicationId,
                    'application_id' => $applicationId,
                    'request_source' => 'hire_request',
                    'status' => 'accepted',
                ],
            ]),
            'is_read' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $jobRequestsResponse = $this->getJson('/api/job-requests?user_id=PAR01');
        $jobRequestsResponse->assertOk();
        $jobRequestsResponse->assertJsonCount(1, 'data');
        $jobRequestsResponse->assertJsonPath('data.0.application_id', $applicationId);
        $jobRequestsResponse->assertJsonPath('data.0.status', 'accepted');
        $jobRequestsResponse->assertJsonPath('data.0.application_status', 'accepted');
        $jobRequestsResponse->assertJsonPath('data.0.request_source', 'hire_request');
        $jobRequestsResponse->assertJsonPath('data.0.title', 'Hire Request Accepted');
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

        Schema::create('user_notifications', function (Blueprint $table) {
            $table->id();
            $table->string('recipient_user_id', 20)->index();
            $table->string('sender_user_id', 20)->nullable();
            $table->string('type', 50)->nullable();
            $table->string('title')->nullable();
            $table->text('message')->nullable();
            $table->text('data')->nullable();
            $table->boolean('is_read')->default(false);
            $table->timestamp('opened_at')->nullable();
            $table->timestamps();
        });
    }
}
