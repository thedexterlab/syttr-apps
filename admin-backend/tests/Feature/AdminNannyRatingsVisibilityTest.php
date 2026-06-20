<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AdminNannyRatingsVisibilityTest extends TestCase
{
    private string $adminDatabasePath;

    private string $appDataDatabasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->adminDatabasePath = database_path('admin_nanny_ratings_visibility_test.sqlite');
        $this->appDataDatabasePath = database_path('admin_nanny_ratings_visibility_app_data_test.sqlite');

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

    public function test_admin_nannies_endpoint_includes_latest_parent_rating_and_review(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-28 17:30:00'));

        DB::connection('app_data')->table('users')->insert([
            [
                'id' => 1,
                'user_id' => 'NAN01',
                'name' => 'Rated Nanny',
                'email' => 'nanny@example.com',
                'role' => 'syttr',
                'profile_status' => 'approved',
                'is_blacklisted' => false,
                'created_at' => now()->subDays(7),
                'updated_at' => now(),
            ],
            [
                'id' => 2,
                'user_id' => 'PAR01',
                'name' => 'First Parent',
                'email' => 'parent1@example.com',
                'role' => 'parent',
                'profile_status' => 'verified',
                'is_blacklisted' => false,
                'created_at' => now()->subDays(10),
                'updated_at' => now(),
            ],
            [
                'id' => 3,
                'user_id' => 'PAR02',
                'name' => 'Second Parent',
                'email' => 'parent2@example.com',
                'role' => 'parent',
                'profile_status' => 'verified',
                'is_blacklisted' => false,
                'created_at' => now()->subDays(5),
                'updated_at' => now(),
            ],
        ]);

        DB::connection('app_data')->table('syttr_profiles')->insert([
            'user_id' => 1,
            'city' => 'San Diego',
            'country' => 'USA',
            'experience_years' => 4,
            'hourly_rate' => 24,
            'bio' => 'Reliable sitter',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $jobOne = DB::connection('app_data')->table('parent_jobs')->insertGetId([
            'user_id' => 'PAR01',
            'status' => 'completed',
            'created_at' => now()->subDays(3),
            'updated_at' => now()->subDays(3),
        ]);

        $jobTwo = DB::connection('app_data')->table('parent_jobs')->insertGetId([
            'user_id' => 'PAR02',
            'status' => 'completed',
            'created_at' => now()->subDay(),
            'updated_at' => now()->subDay(),
        ]);

        DB::connection('app_data')->table('parent_job_applications')->insert([
            [
                'job_id' => $jobOne,
                'nanny_id' => 'NAN01',
                'status' => 'completed',
                'parent_rating' => 5,
                'parent_review' => 'Excellent care.',
                'parent_rated_at' => now()->subDays(2),
                'created_at' => now()->subDays(3),
                'updated_at' => now()->subDays(2),
            ],
            [
                'job_id' => $jobTwo,
                'nanny_id' => 'NAN01',
                'status' => 'completed',
                'parent_rating' => 3,
                'parent_review' => 'Okay overall.',
                'parent_rated_at' => now()->subHours(5),
                'created_at' => now()->subDay(),
                'updated_at' => now()->subHours(5),
            ],
        ]);

        $response = $this
            ->withoutMiddleware()
            ->getJson('/api/admin/nannies');

        $response->assertOk();
        $response->assertJsonPath('data.0.user_id', 'NAN01');
        $response->assertJsonPath('data.0.average_rating', 4);
        $response->assertJsonPath('data.0.ratings_count', 2);
        $response->assertJsonPath('data.0.latest_rating', 3);
        $response->assertJsonPath('data.0.latest_rating_display', '3/5');
        $response->assertJsonPath('data.0.latest_review', 'Okay overall.');
        $response->assertJsonPath('data.0.recent_ratings.0.rating_display', '3/5');
        $response->assertJsonPath('data.0.recent_ratings.0.parent_name', 'Second Parent');
    }

    private function createAdminSchema(): void
    {
        Schema::dropIfExists('admin_audit_logs');

        Schema::create('admin_audit_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('admin_user_id')->nullable();
            $table->string('category')->default('other');
            $table->string('action')->default('updated');
            $table->string('target_type')->nullable();
            $table->string('target_id')->nullable();
            $table->string('target_label')->nullable();
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->json('meta')->nullable();
            $table->string('ip_address')->nullable();
            $table->text('user_agent')->nullable();
            $table->timestamps();
        });
    }

    private function createAppDataSchema(): void
    {
        Schema::connection('app_data')->dropIfExists('parent_job_applications');
        Schema::connection('app_data')->dropIfExists('parent_jobs');
        Schema::connection('app_data')->dropIfExists('syttr_profiles');
        Schema::connection('app_data')->dropIfExists('users');

        Schema::connection('app_data')->create('users', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->unique();
            $table->string('name')->nullable();
            $table->string('email')->nullable();
            $table->string('role')->nullable();
            $table->string('profile_status')->nullable();
            $table->timestamp('profile_status_updated_at')->nullable();
            $table->timestamp('deactivated_at')->nullable();
            $table->boolean('is_blacklisted')->default(false);
            $table->text('blacklisted_reason')->nullable();
            $table->timestamps();
        });

        Schema::connection('app_data')->create('syttr_profiles', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->string('phone')->nullable();
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->string('country')->nullable();
            $table->string('gender')->nullable();
            $table->date('date_of_birth')->nullable();
            $table->integer('experience_years')->nullable();
            $table->decimal('hourly_rate', 10, 2)->nullable();
            $table->text('bio')->nullable();
            $table->string('user_image')->nullable();
            $table->string('certificate')->nullable();
            $table->timestamps();
        });

        Schema::connection('app_data')->create('parent_jobs', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->index();
            $table->string('status')->nullable();
            $table->timestamps();
        });

        Schema::connection('app_data')->create('parent_job_applications', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('job_id');
            $table->string('nanny_id', 20)->index();
            $table->string('status')->nullable();
            $table->unsignedTinyInteger('parent_rating')->nullable();
            $table->text('parent_review')->nullable();
            $table->timestamp('parent_rated_at')->nullable();
            $table->timestamps();
        });
    }
}
