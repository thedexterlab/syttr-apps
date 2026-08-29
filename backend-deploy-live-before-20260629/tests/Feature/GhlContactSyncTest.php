<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class GhlContactSyncTest extends TestCase
{
    private string $databasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->databasePath = database_path('ghl_contact_sync_test.sqlite');

        @unlink($this->databasePath);
        touch($this->databasePath);

        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', $this->databasePath);
        Config::set('services.ghl.base_url', 'https://services.leadconnectorhq.com');
        Config::set('services.ghl.location_id', 'test_location');
        Config::set('services.ghl.api_token', 'pit_test');
        Config::set('services.ghl.verify_ssl', false);

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

    public function test_parent_profile_upsert_syncs_contact_and_persists_contact_id(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-25 18:00:00'));

        DB::table('users')->insert([
            'user_id' => 'PAR01',
            'name' => 'Jane Doe',
            'email' => 'jane@example.com',
            'password' => bcrypt('password'),
            'role' => 'parent',
            'api_token' => 'parent-token',
            'ghl_contact_id' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://services.leadconnectorhq.com/contacts/search/duplicate*' => Http::response([], 404),
            'https://services.leadconnectorhq.com/contacts/' => Http::response([
                'contact' => [
                    'id' => 'ghl_parent_1',
                    'firstName' => 'Jane',
                    'lastName' => 'Doe',
                    'email' => 'jane@example.com',
                ],
            ], 201),
            'https://services.leadconnectorhq.com/contacts/*/tags' => Http::response([
                'tags' => ['parent'],
            ], 201),
        ]);

        $response = $this->postJson('/api/update-client-profile', [
            'user_id' => 'PAR01',
            'phone' => '+15551234567',
            'city' => 'Austin',
            'address' => '123 Main St',
            'country' => 'United States',
            'bio' => 'Parent profile',
            'user_image' => 'https://cdn.example.com/parent-profile.jpg',
        ]);

        $response->assertCreated();
        $this->assertSame(
            'ghl_parent_1',
            DB::table('users')->where('user_id', 'PAR01')->value('ghl_contact_id')
        );

        Http::assertSent(function ($request) {
            if ($request->method() !== 'POST' || $request->url() !== 'https://services.leadconnectorhq.com/contacts/') {
                return false;
            }

            $data = $request->data();

            return $request->hasHeader('Authorization', 'Bearer pit_test')
                && $request->hasHeader('Version', '2021-07-28')
                && ($data['locationId'] ?? null) === 'test_location'
                && ($data['firstName'] ?? null) === 'Jane'
                && ($data['lastName'] ?? null) === 'Doe'
                && ($data['email'] ?? null) === 'jane@example.com'
                && ($data['phone'] ?? null) === '+15551234567'
                && ($data['address1'] ?? null) === '123 Main St'
                && ($data['city'] ?? null) === 'Austin'
                && ($data['country'] ?? null) === 'United States';
        });
        Http::assertSent(function ($request) {
            if ($request->method() !== 'POST' || $request->url() !== 'https://services.leadconnectorhq.com/contacts/') {
                return false;
            }

            $data = $request->data();

            return ($data['attachments'] ?? []) === ['https://cdn.example.com/parent-profile.jpg'];
        });
        Http::assertSent(function ($request) {
            if ($request->method() !== 'POST' || $request->url() !== 'https://services.leadconnectorhq.com/contacts/ghl_parent_1/tags') {
                return false;
            }

            $data = $request->data();

            return ($data['tags'] ?? []) === ['parent'];
        });
    }

    public function test_authenticated_contact_crud_endpoints_create_update_and_delete_contact(): void
    {
        DB::table('users')->insert([
            'user_id' => 'PAR02',
            'name' => 'John Smith',
            'email' => 'john@example.com',
            'password' => bcrypt('password'),
            'role' => 'parent',
            'api_token' => 'parent-token-2',
            'ghl_contact_id' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://services.leadconnectorhq.com/contacts/search/duplicate*' => Http::response([], 404),
            'https://services.leadconnectorhq.com/contacts/' => Http::response([
                'contact' => [
                    'id' => 'ghl_parent_2',
                    'firstName' => 'John',
                    'lastName' => 'Smith',
                ],
            ], 201),
            'https://services.leadconnectorhq.com/contacts/ghl_parent_2' => Http::sequence()
                ->push([
                    'contact' => [
                        'id' => 'ghl_parent_2',
                        'city' => 'Houston',
                    ],
                ], 200)
                ->push([
                    'message' => 'Deleted',
                ], 200),
            'https://services.leadconnectorhq.com/contacts/*/tags' => Http::response([
                'tags' => ['parent'],
            ], 201),
        ]);

        $headers = [
            'Authorization' => 'Bearer parent-token-2',
        ];

        $this->postJson('/api/ghl/contact', [
            'phone' => '+15550001111',
        ], $headers)
            ->assertCreated()
            ->assertJsonPath('contact_id', 'ghl_parent_2');

        $this->assertSame(
            'ghl_parent_2',
            DB::table('users')->where('user_id', 'PAR02')->value('ghl_contact_id')
        );

        $this->putJson('/api/ghl/contact', [
            'city' => 'Houston',
        ], $headers)
            ->assertOk()
            ->assertJsonPath('contact_id', 'ghl_parent_2');

        $this->deleteJson('/api/ghl/contact', [], $headers)
            ->assertOk()
            ->assertJsonPath('contact_id', 'ghl_parent_2');

        $this->assertNull(
            DB::table('users')->where('user_id', 'PAR02')->value('ghl_contact_id')
        );
        Http::assertSentCount(6);
    }

    public function test_parent_profile_second_sync_reuses_persisted_contact_id_instead_of_creating_duplicate(): void
    {
        DB::table('users')->insert([
            'user_id' => 'PAR03',
            'name' => 'Sara Khan',
            'email' => 'sara@example.com',
            'password' => bcrypt('password'),
            'role' => 'parent',
            'api_token' => 'parent-token-3',
            'ghl_contact_id' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            'https://services.leadconnectorhq.com/contacts/search/duplicate*' => Http::response([], 404),
            'https://services.leadconnectorhq.com/contacts/' => Http::response([
                'contact' => [
                    'id' => 'ghl_parent_3',
                    'firstName' => 'Sara',
                    'lastName' => 'Khan',
                ],
            ], 201),
            'https://services.leadconnectorhq.com/contacts/ghl_parent_3' => Http::response([
                'contact' => [
                    'id' => 'ghl_parent_3',
                    'city' => 'Dallas',
                ],
            ], 200),
            'https://services.leadconnectorhq.com/contacts/*/tags' => Http::response([
                'tags' => ['parent'],
            ], 201),
        ]);

        $this->postJson('/api/update-client-profile', [
            'user_id' => 'PAR03',
            'phone' => '+15554443333',
            'city' => 'Austin',
            'address' => '10 First St',
            'country' => 'United States',
        ])->assertCreated();

        $this->assertSame(
            'ghl_parent_3',
            DB::table('users')->where('user_id', 'PAR03')->value('ghl_contact_id')
        );

        $this->postJson('/api/update-client-profile', [
            'user_id' => 'PAR03',
            'phone' => '+15554443333',
            'city' => 'Dallas',
            'address' => '10 First St',
            'country' => 'United States',
        ])->assertOk();

        $this->assertSame(
            'ghl_parent_3',
            DB::table('users')->where('user_id', 'PAR03')->value('ghl_contact_id')
        );

        Http::assertSentCount(5);
        Http::assertSent(function ($request) {
            return $request->method() === 'POST'
                && $request->url() === 'https://services.leadconnectorhq.com/contacts/';
        });
        Http::assertSent(function ($request) {
            return $request->method() === 'PUT'
                && $request->url() === 'https://services.leadconnectorhq.com/contacts/ghl_parent_3';
        });
    }

    public function test_parent_and_syttr_signup_sync_contacts_and_apply_role_tags(): void
    {
        Http::fake([
            'https://services.leadconnectorhq.com/contacts/search/duplicate*' => Http::response([], 404),
            'https://services.leadconnectorhq.com/contacts/' => Http::sequence()
                ->push([
                    'contact' => [
                        'id' => 'ghl_parent_signup',
                        'firstName' => 'Parent',
                        'lastName' => 'User',
                    ],
                ], 201)
                ->push([
                    'contact' => [
                        'id' => 'ghl_syttr_signup',
                        'firstName' => 'Syttr',
                        'lastName' => 'User',
                    ],
                ], 201),
            'https://services.leadconnectorhq.com/contacts/*/tags' => Http::sequence()
                ->push(['tags' => ['parent']], 201)
                ->push(['tags' => ['syttr']], 201),
        ]);

        $this->postJson('/api/signup/parent', [
            'name' => 'Parent User',
            'email' => 'parent-signup@example.com',
            'password' => 'password123',
        ])->assertCreated();

        $this->postJson('/api/signup/syttr', [
            'name' => 'Syttr User',
            'email' => 'syttr-signup@example.com',
            'password' => 'password123',
        ])->assertCreated();

        $this->assertSame(
            'ghl_parent_signup',
            DB::table('users')->where('email', 'parent-signup@example.com')->value('ghl_contact_id')
        );
        $this->assertSame(
            'ghl_syttr_signup',
            DB::table('users')->where('email', 'syttr-signup@example.com')->value('ghl_contact_id')
        );

        Http::assertSent(function ($request) {
            if ($request->method() !== 'POST' || $request->url() !== 'https://services.leadconnectorhq.com/contacts/ghl_parent_signup/tags') {
                return false;
            }

            $data = $request->data();

            return ($data['tags'] ?? []) === ['parent'];
        });
        Http::assertSent(function ($request) {
            if ($request->method() !== 'POST' || $request->url() !== 'https://services.leadconnectorhq.com/contacts/ghl_syttr_signup/tags') {
                return false;
            }

            $data = $request->data();

            return ($data['tags'] ?? []) === ['syttr'];
        });
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
            $table->string('ghl_contact_id')->nullable();
            $table->boolean('stripe_connect_details_submitted')->default(false);
            $table->boolean('stripe_connect_charges_enabled')->default(false);
            $table->boolean('stripe_connect_payouts_enabled')->default(false);
            $table->timestamps();
        });

        Schema::create('parent_profiles', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->index();
            $table->string('phone')->nullable();
            $table->string('city')->nullable();
            $table->string('address')->nullable();
            $table->string('gender')->nullable();
            $table->integer('children_count')->nullable();
            $table->text('bio')->nullable();
            $table->string('user_image')->nullable();
            $table->timestamps();
        });
    }
}
