<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AdminJobsVisibilityTest extends TestCase
{
    private string $adminDatabasePath;

    private string $appDataDatabasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->adminDatabasePath = database_path('admin_jobs_visibility_test.sqlite');
        $this->appDataDatabasePath = database_path('admin_jobs_visibility_app_data_test.sqlite');

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
        Config::set('admin.api_key_header', 'X-ADMIN-API-KEY');

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

    public function test_admin_jobs_endpoint_includes_every_parent_created_job(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-06-20 10:00:00'));
        $apiKey = 'admin-test-key';
        $token = 'admin-test-token';

        DB::table('admin_api_keys')->insert([
            'name' => 'test',
            'key_hash' => hash('sha256', $apiKey),
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('admin_users')->insert([
            'name' => 'Admin',
            'email' => 'admin@example.com',
            'password' => 'irrelevant',
            'api_token' => hash('sha256', $token),
            'token_expires_at' => now()->addDay(),
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::connection('app_data')->table('users')->insert([
            [
                'id' => 1,
                'user_id' => 'PARENT1',
                'name' => 'Parent One',
                'role' => 'parent',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'id' => 2,
                'user_id' => 'NANNY1',
                'name' => 'Syttr One',
                'role' => 'syttr',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        DB::connection('app_data')->table('parent_profiles')->insert([
            'user_id' => 'PARENT1',
            'city' => 'Austin',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $statuses = ['pending', 'accepted', 'completed', 'canceled'];
        foreach ($statuses as $index => $status) {
            DB::connection('app_data')->table('parent_jobs')->insert([
                'id' => $index + 1,
                'user_id' => 'PARENT1',
                'kid_names' => 'Kid '.($index + 1),
                'hours' => 3,
                'hourly_rate' => 20,
                'price' => 60,
                'start_date' => now()->addDays($index)->format('Y-m-d'),
                'end_date' => now()->addDays($index)->format('Y-m-d'),
                'start_time' => '10:00',
                'end_time' => '13:00',
                'location' => 'Austin, TX',
                'status' => $status,
                'created_at' => now()->addMinutes($index),
                'updated_at' => now()->addMinutes($index),
            ]);
        }

        DB::connection('app_data')->table('parent_job_applications')->insert([
            'job_id' => 2,
            'nanny_id' => 'NANNY1',
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this
            ->withHeaders([
                'X-ADMIN-API-KEY' => $apiKey,
                'Authorization' => 'Bearer '.$token,
            ])
            ->getJson('/api/admin/jobs');

        $response->assertOk();

        $jobs = collect($response->json('data.new_jobs'));

        $this->assertCount(4, $jobs);
        $this->assertEqualsCanonicalizing([1, 2, 3, 4], $jobs->pluck('job_id')->all());
        $this->assertEqualsCanonicalizing($statuses, $jobs->pluck('status')->all());
        $this->assertSame('Syttr One', $jobs->firstWhere('job_id', 2)['nanny_name']);
    }

    private function createAdminSchema(): void
    {
        Schema::dropIfExists('admin_api_keys');
        Schema::dropIfExists('admin_users');

        Schema::create('admin_api_keys', function (Blueprint $table) {
            $table->id();
            $table->string('name')->unique();
            $table->string('key_hash', 64)->unique();
            $table->boolean('is_active')->default(true);
            $table->timestamp('last_used_at')->nullable();
            $table->timestamps();
        });

        Schema::create('admin_users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('email')->unique();
            $table->string('password');
            $table->string('api_token', 64)->nullable()->unique();
            $table->timestamp('token_expires_at')->nullable();
            $table->timestamp('last_login_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    private function createAppDataSchema(): void
    {
        Schema::connection('app_data')->dropIfExists('syttr_profiles');
        Schema::connection('app_data')->dropIfExists('parent_profiles');
        Schema::connection('app_data')->dropIfExists('parent_job_applications');
        Schema::connection('app_data')->dropIfExists('parent_jobs');
        Schema::connection('app_data')->dropIfExists('users');

        Schema::connection('app_data')->create('users', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->unique();
            $table->string('name')->nullable();
            $table->string('role')->nullable();
            $table->timestamps();
        });

        Schema::connection('app_data')->create('parent_profiles', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->index();
            $table->string('city')->nullable();
            $table->timestamps();
        });

        Schema::connection('app_data')->create('syttr_profiles', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->index();
            $table->timestamps();
        });

        Schema::connection('app_data')->create('parent_jobs', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20);
            $table->json('kid_ids')->nullable();
            $table->string('kid_names')->nullable();
            $table->decimal('hours', 10, 2)->nullable();
            $table->decimal('hourly_rate', 10, 2)->nullable();
            $table->decimal('price', 10, 2)->nullable();
            $table->date('start_date')->nullable();
            $table->date('end_date')->nullable();
            $table->string('start_time')->nullable();
            $table->string('end_time')->nullable();
            $table->string('location')->nullable();
            $table->decimal('latitude', 10, 7)->nullable();
            $table->decimal('longitude', 10, 7)->nullable();
            $table->string('status', 30)->default('pending');
            $table->timestamps();
        });

        Schema::connection('app_data')->create('parent_job_applications', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('job_id');
            $table->string('nanny_id', 20);
            $table->string('status', 30)->default('pending');
            $table->timestamps();
        });
    }
}
