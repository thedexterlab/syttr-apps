<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class AdminBlacklistEnforcementTest extends TestCase
{
    private string $adminDatabasePath;

    private string $appDataDatabasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->adminDatabasePath = database_path('admin_blacklist_enforcement_test.sqlite');
        $this->appDataDatabasePath = database_path('admin_blacklist_enforcement_app_data_test.sqlite');

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

    public function test_blacklisting_a_nanny_cancels_open_applications_and_reopens_accepted_jobs(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-25 12:00:00'));

        DB::connection('app_data')->table('users')->insert([
            [
                'user_id' => 'PAR01',
                'name' => 'Parent User',
                'email' => 'parent@example.com',
                'role' => 'parent',
                'profile_status' => 'verified',
                'is_blacklisted' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'user_id' => 'NAN01',
                'name' => 'Nanny User',
                'email' => 'nanny@example.com',
                'role' => 'syttr',
                'profile_status' => 'approved',
                'is_blacklisted' => false,
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $acceptedJobId = DB::connection('app_data')->table('parent_jobs')->insertGetId([
            'user_id' => 'PAR01',
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $pendingJobId = DB::connection('app_data')->table('parent_jobs')->insertGetId([
            'user_id' => 'PAR01',
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $completedJobId = DB::connection('app_data')->table('parent_jobs')->insertGetId([
            'user_id' => 'PAR01',
            'status' => 'completed',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::connection('app_data')->table('parent_job_applications')->insert([
            [
                'job_id' => $acceptedJobId,
                'nanny_id' => 'NAN01',
                'status' => 'accepted',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'job_id' => $pendingJobId,
                'nanny_id' => 'NAN01',
                'status' => 'pending',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'job_id' => $completedJobId,
                'nanny_id' => 'NAN01',
                'status' => 'completed',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $this
            ->withoutMiddleware()
            ->postJson('/api/admin/nanny/profile-status', [
                'nanny_id' => 'NAN01',
                'status' => 'blacklisted',
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'Blacklisted');

        $this->assertTrue((bool) DB::connection('app_data')->table('users')->where('user_id', 'NAN01')->value('is_blacklisted'));
        $this->assertSame(
            'cancelled',
            DB::connection('app_data')->table('parent_job_applications')->where('job_id', $acceptedJobId)->value('status')
        );
        $this->assertSame(
            'cancelled',
            DB::connection('app_data')->table('parent_job_applications')->where('job_id', $pendingJobId)->value('status')
        );
        $this->assertSame(
            'completed',
            DB::connection('app_data')->table('parent_job_applications')->where('job_id', $completedJobId)->value('status')
        );
        $this->assertSame(
            'pending',
            DB::connection('app_data')->table('parent_jobs')->where('id', $acceptedJobId)->value('status')
        );
        $this->assertSame(
            'pending',
            DB::connection('app_data')->table('parent_jobs')->where('id', $pendingJobId)->value('status')
        );
        $this->assertSame(
            'completed',
            DB::connection('app_data')->table('parent_jobs')->where('id', $completedJobId)->value('status')
        );
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
        Schema::connection('app_data')->dropIfExists('users');

        Schema::connection('app_data')->create('users', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->unique();
            $table->string('name')->nullable();
            $table->string('email')->nullable();
            $table->string('role')->nullable();
            $table->string('profile_status')->nullable();
            $table->timestamp('profile_status_updated_at')->nullable();
            $table->boolean('is_blacklisted')->default(false);
            $table->text('blacklisted_reason')->nullable();
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
            $table->timestamps();
        });
    }
}
