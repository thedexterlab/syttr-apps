<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class TazWebhookTest extends TestCase
{
    private string $databasePath;

    protected function setUp(): void
    {
        parent::setUp();

        $this->databasePath = database_path('taz_webhook_test.sqlite');

        DB::disconnect('sqlite');
        @unlink($this->databasePath);
        touch($this->databasePath);

        Config::set('database.default', 'sqlite');
        Config::set('database.connections.sqlite.database', $this->databasePath);
        Config::set('cache.default', 'array');
        Config::set('services.taz.base_url', 'https://api-sandbox.instascreen.net');
        Config::set('services.taz.jwt', 'taz-provider-token');
        Config::set('services.taz.webhook_secret', 'taz-webhook-secret');
        Config::set('services.taz.verify_ssl', false);

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

    public function test_taz_webhook_persists_order_history_updates_user_status_and_is_idempotent(): void
    {
        DB::table('users')->insert([
            'user_id' => 'NAN01',
            'name' => 'Webhook Nanny',
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
            '*' => Http::response([
                'message' => 'provider unavailable',
            ], 500),
        ]);

        $pendingPayload = [
            'event_id' => 'evt_taz_1',
            'event_type' => 'order.updated',
            'order' => [
                'order_guid' => 'ord_123',
                'status' => 'pending',
                'quickapp_link' => 'https://quick.app/123',
                'external_id' => 'NAN01',
            ],
        ];

        $this->postJson('/api/taz/webhook', $pendingPayload, [
            'x-api-key' => 'taz-webhook-secret',
        ])
            ->assertOk()
            ->assertJsonPath('received', true)
            ->assertJsonPath('updated', true)
            ->assertJsonPath('user_id', 'NAN01')
            ->assertJsonPath('order_guid', 'ord_123')
            ->assertJsonPath('status', 'app-pending');

        $completedPayload = [
            'event_id' => 'evt_taz_2',
            'event_type' => 'order.completed',
            'order' => [
                'order_guid' => 'ord_123',
                'status' => 'completed',
                'quickapp_link' => 'https://quick.app/123',
                'external_id' => 'NAN01',
            ],
        ];

        $this->postJson('/api/taz/webhook', $completedPayload, [
            'x-api-key' => 'taz-webhook-secret',
        ])
            ->assertOk()
            ->assertJsonPath('received', true)
            ->assertJsonPath('updated', true)
            ->assertJsonPath('user_id', 'NAN01')
            ->assertJsonPath('order_guid', 'ord_123')
            ->assertJsonPath('status', 'completed');

        $this->assertDatabaseCount('taz_verification_orders', 1);
        $this->assertDatabaseCount('taz_webhook_events', 2);
        $this->assertDatabaseHas('taz_verification_orders', [
            'public_user_id' => 'NAN01',
            'taz_order_guid' => 'ord_123',
            'normalized_status' => 'completed',
            'latest_event_id' => 'evt_taz_2',
        ]);
        $this->assertDatabaseHas('taz_webhook_events', [
            'event_id' => 'evt_taz_1',
            'taz_order_guid' => 'ord_123',
            'normalized_status' => 'app-pending',
        ]);
        $this->assertDatabaseHas('taz_webhook_events', [
            'event_id' => 'evt_taz_2',
            'taz_order_guid' => 'ord_123',
            'normalized_status' => 'completed',
        ]);
        $this->assertDatabaseHas('users', [
            'user_id' => 'NAN01',
            'profile_status' => 'completed',
        ]);

        Cache::flush();

        $this->postJson('/api/taz/webhook', $completedPayload, [
            'x-api-key' => 'taz-webhook-secret',
        ])
            ->assertOk()
            ->assertJsonPath('received', true)
            ->assertJsonPath('duplicate', true);

        $this->assertDatabaseCount('taz_verification_orders', 1);
        $this->assertDatabaseCount('taz_webhook_events', 2);

        $this->postJson('/api/taz/status', [
            'user_id' => 'NAN01',
        ])
            ->assertOk()
            ->assertJsonPath('status', 'completed')
            ->assertJsonPath('quickapp_link', 'https://quick.app/123')
            ->assertJsonPath('orders.0.order_guid', 'ord_123');
    }

    public function test_taz_webhook_rejects_invalid_secret(): void
    {
        $this->postJson('/api/taz/webhook', [
            'event_id' => 'evt_taz_unauthorized',
        ], [
            'x-api-key' => 'wrong-secret',
        ])
            ->assertStatus(401)
            ->assertJsonPath('received', false);
    }

    public function test_taz_webhook_stores_unmapped_payload_for_audit(): void
    {
        $payload = [
            'event_id' => 'evt_taz_unmapped',
            'type' => 'order.failed',
            'order' => [
                'order_guid' => 'ord_unknown',
                'status' => 'failed',
                'quickapp_link' => 'https://quick.app/unknown',
                'external_id' => 'MISSING01',
            ],
        ];

        $this->postJson('/api/taz/webhook', $payload, [
            'x-api-key' => 'taz-webhook-secret',
        ])
            ->assertOk()
            ->assertJsonPath('received', true)
            ->assertJsonPath('updated', false)
            ->assertJsonPath('order_guid', 'ord_unknown')
            ->assertJsonPath('status', 'failed');

        $this->assertDatabaseCount('taz_verification_orders', 0);
        $this->assertDatabaseHas('taz_webhook_events', [
            'event_id' => 'evt_taz_unmapped',
            'taz_order_guid' => 'ord_unknown',
            'normalized_status' => 'failed',
        ]);
    }

    public function test_create_order_reuses_existing_verification_instead_of_creating_duplicate_order(): void
    {
        DB::table('users')->insert([
            'id' => 11,
            'user_id' => 'NAN77',
            'name' => 'Existing Verification Nanny',
            'email' => 'existing@example.com',
            'password' => bcrypt('password'),
            'role' => 'syttr',
            'profile_status' => 'pending',
            'profile_status_updated_at' => now(),
            'is_blacklisted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('taz_verification_orders')->insert([
            'user_id' => 11,
            'public_user_id' => 'NAN77',
            'taz_order_guid' => 'ord_existing_77',
            'verification_type' => 'employment',
            'provider_status' => 'pending',
            'normalized_status' => 'app-pending',
            'quickapp_link' => 'https://quick.app/existing-77',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Http::fake([
            '*' => Http::response([
                'quickapp_link' => 'https://quick.app/existing-77',
                'status' => 'pending',
            ], 200),
        ]);

        $this->postJson('/api/taz/create-order', [
            'user_id' => 'NAN77',
            'first_name' => 'Existing',
            'last_name' => 'User',
            'email' => 'existing@example.com',
            'verification_type' => 'employment',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('existing_order', true)
            ->assertJsonPath('taz_order_guid', 'ord_existing_77')
            ->assertJsonPath('quickapp_link', 'https://quick.app/existing-77')
            ->assertJsonPath('status', 'app-pending');

        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => str_contains($request->url(), '/regenerate-link'));
        $this->assertDatabaseCount('taz_verification_orders', 1);
    }

    public function test_create_order_retries_alternate_auth_header_variants_after_provider_unauthorized(): void
    {
        DB::table('users')->insert([
            'id' => 12,
            'user_id' => 'NAN88',
            'name' => 'Retry Header Nanny',
            'email' => 'retry-header@example.com',
            'password' => bcrypt('password'),
            'role' => 'syttr',
            'profile_status' => 'pending',
            'profile_status_updated_at' => now(),
            'is_blacklisted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Config::set('services.taz.client_guid', 'client-guid-88');
        Config::set('services.taz.product_guid', 'product-guid-88');
        Config::set('services.taz.product_guid_employment', 'product-guid-88');

        Http::fake(function ($request) {
            $headers = array_change_key_case($request->headers(), CASE_LOWER);
            $authorization = $headers['authorization'][0] ?? null;
            $xApiKey = $headers['x-api-key'][0] ?? null;
            $xJwtToken = $headers['x-jwt-token'][0] ?? null;
            $xAccessToken = $headers['x-access-token'][0] ?? null;

            if (
                $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/client-guid-88/orders')
                && $xApiKey === 'taz-provider-token'
                && $authorization === null
                && $xJwtToken === null
                && $xAccessToken === null
            ) {
                return Http::response([
                    'id' => 'ord_header_retry_88',
                    'quickapp_link' => 'https://quick.app/header-retry-88',
                    'status' => 'pending',
                ], 200);
            }

            return Http::response([
                'message' => 'Unauthorized',
            ], 401);
        });

        $this->postJson('/api/taz/create-order', [
            'user_id' => 'NAN88',
            'first_name' => 'Retry',
            'last_name' => 'Header',
            'email' => 'retry-header@example.com',
            'verification_type' => 'employment',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('taz_order_guid', 'ord_header_retry_88')
            ->assertJsonPath('quickapp_link', 'https://quick.app/header-retry-88');

        Http::assertSent(function ($request) {
            $headers = array_change_key_case($request->headers(), CASE_LOWER);

            return $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/client-guid-88/orders')
                && ($headers['authorization'][0] ?? null) === 'Bearer taz-provider-token';
        });
        Http::assertSent(function ($request) {
            $headers = array_change_key_case($request->headers(), CASE_LOWER);

            return $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/client-guid-88/orders')
                && ($headers['x-api-key'][0] ?? null) === 'taz-provider-token'
                && ! isset($headers['authorization'])
                && ! isset($headers['x-jwt-token'])
                && ! isset($headers['x-access-token']);
        });
    }

    public function test_create_order_prefers_configured_client_guid_over_jwt_claims(): void
    {
        DB::table('users')->insert([
            'id' => 13,
            'user_id' => 'NAN89',
            'name' => 'Configured Client Guid Nanny',
            'email' => 'configured-client@example.com',
            'password' => bcrypt('password'),
            'role' => 'syttr',
            'profile_status' => 'pending',
            'profile_status_updated_at' => now(),
            'is_blacklisted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Config::set('services.taz.client_guid', 'good-client-guid');
        Config::set('services.taz.product_guid', 'product-guid-89');
        Config::set('services.taz.product_guid_employment', 'product-guid-89');
        Config::set('services.taz.jwt', $this->makeJwt([
            'iss' => 'jwt-derived-guid',
            'sub' => 'cra-sub-89-different',
        ]));

        Http::fake(function ($request) {
            if (
                $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/good-client-guid/orders')
            ) {
                return Http::response([
                    'id' => 'ord_client_retry_89',
                    'quickapp_link' => 'https://quick.app/client-retry-89',
                    'status' => 'pending',
                ], 200);
            }

            return Http::response([
                'message' => 'Unauthorized',
            ], 401);
        });

        $this->postJson('/api/taz/create-order', [
            'user_id' => 'NAN89',
            'first_name' => 'Configured',
            'last_name' => 'Client',
            'email' => 'configured-client@example.com',
            'verification_type' => 'employment',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('taz_order_guid', 'ord_client_retry_89')
            ->assertJsonPath('quickapp_link', 'https://quick.app/client-retry-89');

        Http::assertSent(function ($request) {
            return $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/good-client-guid/orders');
        });
        Http::assertNotSent(function ($request) {
            return $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/jwt-derived-guid/orders');
        });
    }

    public function test_create_order_returns_provider_validation_instead_of_later_unauthorized(): void
    {
        DB::table('users')->insert([
            'id' => 14,
            'user_id' => 'NAN90',
            'name' => 'Validation Response Nanny',
            'email' => 'validation-response@example.com',
            'password' => bcrypt('password'),
            'role' => 'syttr',
            'profile_status' => 'pending',
            'profile_status_updated_at' => now(),
            'is_blacklisted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Config::set('services.taz.client_guid', 'client-guid-90');
        Config::set('services.taz.product_guid', 'product-guid-90');
        Config::set('services.taz.product_guid_employment', 'product-guid-90');

        Http::fake(function ($request) {
            $headers = array_change_key_case($request->headers(), CASE_LOWER);
            $xApiKey = $headers['x-api-key'][0] ?? null;

            if (
                $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/client-guid-90/orders')
                && $xApiKey === 'taz-provider-token'
            ) {
                return Http::response([
                    'code' => 'VALIDATION_EXCEPTION',
                    'fields' => [
                        'applicantGuid' => ['Applicant identifier is required.'],
                        'clientProductGuid' => ['Client product identifier is required.'],
                    ],
                ], 400);
            }

            return Http::response([
                'message' => 'Unauthorized',
            ], 401);
        });

        $response = $this->postJson('/api/taz/create-order', [
            'user_id' => 'NAN90',
            'first_name' => 'Validation',
            'last_name' => 'Response',
            'email' => 'validation-response@example.com',
            'verification_type' => 'employment',
        ]);

        $response
            ->assertStatus(502)
            ->assertJsonPath('success', false)
            ->assertJsonPath('code', 'taz_create_order_failed');

        $this->assertStringContainsString('applicantGuid', (string) $response->json('message'));
        $this->assertStringContainsString('clientProductGuid', (string) $response->json('message'));
    }

    public function test_create_order_prefers_client_product_guid_from_products_response(): void
    {
        DB::table('users')->insert([
            'id' => 15,
            'user_id' => 'NAN91',
            'name' => 'Client Product Guid Nanny',
            'email' => 'client-product@example.com',
            'password' => bcrypt('password'),
            'role' => 'syttr',
            'profile_status' => 'pending',
            'profile_status_updated_at' => now(),
            'is_blacklisted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Config::set('services.taz.client_guid', 'client-guid-91');
        Config::set('services.taz.product_guid', '');
        Config::set('services.taz.product_guid_employment', '');
        Config::set('services.taz.product_guid_mvr', '');
        Config::set('services.taz.product_guid_mvr_employment', '');

        Http::fake(function ($request) {
            $headers = array_change_key_case($request->headers(), CASE_LOWER);
            $xApiKey = $headers['x-api-key'][0] ?? null;

            if (
                $request->method() === 'GET'
                && str_contains($request->url(), '/v1/clients/client-guid-91/products')
                && $xApiKey === 'taz-provider-token'
            ) {
                return Http::response([
                    'products' => [[
                        'productGuid' => 'base-product-guid-91',
                        'clientProductGuid' => 'client-product-guid-91',
                        'productName' => 'Employment Product',
                    ]],
                ], 200);
            }

            if (
                $request->method() === 'GET'
                && str_contains($request->url(), '/v1/clients/client-guid-91/applicants')
                && $xApiKey === 'taz-provider-token'
            ) {
                return Http::response([
                    'applicants' => [[
                        'applicantGuid' => 'existing-applicant-guid-91',
                        'externalId' => 'NAN91',
                        'email' => 'client-product@example.com',
                    ]],
                ], 200);
            }

            if (
                $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/client-guid-91/orders')
                && $xApiKey === 'taz-provider-token'
            ) {
                $payload = json_decode($request->body(), true) ?: [];
                if (
                    ($payload['applicantGuid'] ?? null) === 'existing-applicant-guid-91'
                    && ($payload['clientProductGuid'] ?? null) === 'client-product-guid-91'
                    && ($payload['useQuickApp'] ?? null) === true
                    && ($payload['certifyPermissiblePurpose'] ?? null) === true
                ) {
                    return Http::response([
                        'orderGuid' => 'ord_client_product_91',
                        'quickappApplicantLink' => 'https://quick.app/client-product-91',
                        'orderStatus' => 'app-pending',
                    ], 201);
                }

                return Http::response([
                    'code' => 'VALIDATION_EXCEPTION',
                    'fields' => [
                        'clientProductGuid' => ['Client product identifier is required.'],
                        'useQuickApp' => ['QuickApp flag is required.'],
                    ],
                ], 400);
            }

            return Http::response([
                'message' => 'Unauthorized',
            ], 401);
        });

        $this->postJson('/api/taz/create-order', [
            'user_id' => 'NAN91',
            'first_name' => 'Client',
            'last_name' => 'Product',
            'email' => 'client-product@example.com',
            'verification_type' => 'employment',
        ])
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('product_guid', 'client-product-guid-91')
            ->assertJsonPath('quickapp_link', 'https://quick.app/client-product-91');
    }

    public function test_create_order_creates_applicant_and_maps_configured_product_guid_to_client_product_guid(): void
    {
        DB::table('users')->insert([
            'id' => 16,
            'user_id' => 'NAN92',
            'name' => 'Applicant Flow Nanny',
            'email' => 'applicant-flow@example.com',
            'password' => bcrypt('password'),
            'role' => 'syttr',
            'profile_status' => 'pending',
            'profile_status_updated_at' => now(),
            'is_blacklisted' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Config::set('services.taz.client_guid', 'client-guid-92');
        Config::set('services.taz.product_guid', 'base-product-guid-92');
        Config::set('services.taz.product_guid_employment', 'base-product-guid-92');
        Config::set('services.taz.product_guid_mvr', '');
        Config::set('services.taz.product_guid_mvr_employment', '');

        Http::fake(function ($request) {
            $headers = array_change_key_case($request->headers(), CASE_LOWER);
            $xApiKey = $headers['x-api-key'][0] ?? null;

            if (
                $request->method() === 'GET'
                && str_contains($request->url(), '/v1/clients/client-guid-92/products')
                && $xApiKey === 'taz-provider-token'
            ) {
                return Http::response([
                    'products' => [[
                        'productGuid' => 'base-product-guid-92',
                        'clientProductGuid' => 'client-product-guid-92',
                        'productName' => 'Employment Product',
                    ]],
                ], 200);
            }

            if (
                $request->method() === 'GET'
                && str_contains($request->url(), '/v1/clients/client-guid-92/applicants')
                && $xApiKey === 'taz-provider-token'
            ) {
                return Http::response([], 200);
            }

            if (
                $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/client-guid-92/applicants')
                && $xApiKey === 'taz-provider-token'
            ) {
                return Http::response([
                    'applicantGuid' => 'applicant-guid-92',
                ], 201);
            }

            if (
                $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/client-guid-92/orders')
                && $xApiKey === 'taz-provider-token'
            ) {
                $payload = json_decode($request->body(), true) ?: [];
                if (
                    ($payload['applicantGuid'] ?? null) === 'applicant-guid-92'
                    && ($payload['clientProductGuid'] ?? null) === 'client-product-guid-92'
                    && ($payload['useQuickApp'] ?? null) === true
                    && ($payload['certifyPermissiblePurpose'] ?? null) === true
                ) {
                    return Http::response([
                        'orderGuid' => 'ord_applicant_quickapp_92',
                        'quickappApplicantLink' => 'https://quick.app/applicant-92',
                        'orderStatus' => 'app-pending',
                    ], 201);
                }

                return Http::response([
                    'code' => 'VALIDATION_EXCEPTION',
                    'fields' => [
                        'applicantGuid' => ['Applicant identifier is required.'],
                        'clientProductGuid' => ['Client product identifier is required.'],
                        'useQuickApp' => ['QuickApp flag is required.'],
                    ],
                ], 400);
            }

            return Http::response([
                'message' => 'Unauthorized',
            ], 401);
        });

        $response = $this->postJson('/api/taz/create-order', [
            'user_id' => 'NAN92',
            'first_name' => 'Applicant',
            'last_name' => 'Flow',
            'email' => 'applicant-flow@example.com',
            'verification_type' => 'employment',
        ]);

        $response
            ->assertOk()
            ->assertJsonPath('success', true)
            ->assertJsonPath('taz_order_guid', 'ord_applicant_quickapp_92')
            ->assertJsonPath('quickapp_link', 'https://quick.app/applicant-92')
            ->assertJsonPath('status', 'app-pending');

        Http::assertSent(function ($request) {
            return $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/client-guid-92/applicants');
        });
        Http::assertSent(function ($request) {
            $payload = json_decode($request->body(), true) ?: [];
            return $request->method() === 'POST'
                && str_contains($request->url(), '/v1/clients/client-guid-92/orders')
                && ($payload['applicantGuid'] ?? null) === 'applicant-guid-92'
                && ($payload['clientProductGuid'] ?? null) === 'client-product-guid-92'
                && ($payload['useQuickApp'] ?? null) === true
                && ($payload['certifyPermissiblePurpose'] ?? null) === true;
        });
    }

    private function makeJwt(array $claims): string
    {
        $header = $this->base64UrlEncode(json_encode([
            'typ' => 'JWT',
            'alg' => 'HS256',
        ]));
        $payload = $this->base64UrlEncode(json_encode($claims));

        return $header.'.'.$payload.'.signature';
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function createSchema(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 20)->unique();
            $table->string('name')->nullable();
            $table->string('email')->nullable();
            $table->string('password')->nullable();
            $table->string('role')->nullable();
            $table->string('profile_status')->nullable();
            $table->timestamp('profile_status_updated_at')->nullable();
            $table->timestamp('deactivated_at')->nullable();
            $table->boolean('is_blacklisted')->default(false);
            $table->text('blacklisted_reason')->nullable();
            $table->string('api_token')->nullable();
            $table->timestamps();
        });

        Schema::create('taz_verification_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->string('public_user_id', 32)->nullable()->index();
            $table->string('taz_order_guid', 120)->nullable()->unique();
            $table->string('client_guid', 120)->nullable()->index();
            $table->string('product_guid', 120)->nullable()->index();
            $table->string('verification_type', 64)->nullable();
            $table->string('provider_status', 64)->nullable();
            $table->string('normalized_status', 64)->nullable()->index();
            $table->text('quickapp_link')->nullable();
            $table->json('create_order_request_payload')->nullable();
            $table->json('create_order_response_payload')->nullable();
            $table->json('latest_webhook_payload')->nullable();
            $table->string('latest_event_id', 191)->nullable()->index();
            $table->string('latest_event_hash', 64)->nullable()->index();
            $table->timestamp('provider_created_at')->nullable();
            $table->timestamp('provider_updated_at')->nullable();
            $table->timestamp('webhook_received_at')->nullable();
            $table->timestamps();
        });

        Schema::create('taz_webhook_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('taz_verification_order_id')->nullable()->constrained('taz_verification_orders')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->string('public_user_id', 32)->nullable()->index();
            $table->string('taz_order_guid', 120)->nullable()->index();
            $table->string('event_id', 191)->nullable()->unique();
            $table->string('event_hash', 64)->unique();
            $table->string('event_type', 120)->nullable();
            $table->string('provider_status', 64)->nullable();
            $table->string('normalized_status', 64)->nullable()->index();
            $table->text('quickapp_link')->nullable();
            $table->json('payload');
            $table->timestamp('received_at')->nullable();
            $table->timestamps();
        });
    }
}
