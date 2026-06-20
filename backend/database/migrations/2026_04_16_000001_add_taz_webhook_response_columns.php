<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('taz_verification_orders')) {
            Schema::table('taz_verification_orders', function (Blueprint $table): void {
                if (! Schema::hasColumn('taz_verification_orders', 'resource_guid')) {
                    $table->string('resource_guid', 120)->nullable()->after('taz_order_guid');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'resource_path')) {
                    $table->string('resource_path', 255)->nullable()->after('resource_guid');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'event_timestamp')) {
                    $table->unsignedBigInteger('event_timestamp')->nullable()->after('resource_path');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'instance_guid')) {
                    $table->string('instance_guid', 120)->nullable()->after('event_timestamp');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'base_client_guid')) {
                    $table->string('base_client_guid', 120)->nullable()->after('instance_guid');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'external_identifier')) {
                    $table->string('external_identifier', 255)->nullable()->after('base_client_guid');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_file_number')) {
                    $table->unsignedBigInteger('response_file_number')->nullable()->after('external_identifier');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_order_status')) {
                    $table->string('response_order_status', 64)->nullable()->after('response_file_number');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_order_type')) {
                    $table->string('response_order_type', 64)->nullable()->after('response_order_status');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_ordered_date')) {
                    $table->unsignedBigInteger('response_ordered_date')->nullable()->after('response_order_type');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_applicant_name')) {
                    $table->string('response_applicant_name', 255)->nullable()->after('response_ordered_date');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_client_name')) {
                    $table->string('response_client_name', 255)->nullable()->after('response_applicant_name');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_client_code')) {
                    $table->string('response_client_code', 120)->nullable()->after('response_client_name');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_product_name')) {
                    $table->string('response_product_name', 255)->nullable()->after('response_client_code');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_requested_by')) {
                    $table->string('response_requested_by', 255)->nullable()->after('response_product_name');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_search_flagged')) {
                    $table->boolean('response_search_flagged')->nullable()->after('response_requested_by');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_quickapp_applicant_link')) {
                    $table->text('response_quickapp_applicant_link')->nullable()->after('response_search_flagged');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_created_date')) {
                    $table->unsignedBigInteger('response_created_date')->nullable()->after('response_quickapp_applicant_link');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_created_by')) {
                    $table->string('response_created_by', 255)->nullable()->after('response_created_date');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_modified_date')) {
                    $table->unsignedBigInteger('response_modified_date')->nullable()->after('response_created_by');
                }
                if (! Schema::hasColumn('taz_verification_orders', 'response_modified_by')) {
                    $table->string('response_modified_by', 255)->nullable()->after('response_modified_date');
                }
            });
        }

        Schema::table('taz_webhook_events', function (Blueprint $table): void {
            if (! Schema::hasColumn('taz_webhook_events', 'resource_guid')) {
                $table->string('resource_guid', 120)->nullable()->after('taz_order_guid');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'resource_path')) {
                $table->string('resource_path', 255)->nullable()->after('resource_guid');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'event_timestamp')) {
                $table->unsignedBigInteger('event_timestamp')->nullable()->after('resource_path');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'instance_guid')) {
                $table->string('instance_guid', 120)->nullable()->after('event_timestamp');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'base_client_guid')) {
                $table->string('base_client_guid', 120)->nullable()->after('instance_guid');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'external_identifier')) {
                $table->string('external_identifier', 255)->nullable()->after('base_client_guid');
            }

            if (! Schema::hasColumn('taz_webhook_events', 'response_file_number')) {
                $table->unsignedBigInteger('response_file_number')->nullable()->after('external_identifier');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_order_status')) {
                $table->string('response_order_status', 64)->nullable()->after('response_file_number');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_order_type')) {
                $table->string('response_order_type', 64)->nullable()->after('response_order_status');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_ordered_date')) {
                $table->unsignedBigInteger('response_ordered_date')->nullable()->after('response_order_type');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_applicant_name')) {
                $table->string('response_applicant_name', 255)->nullable()->after('response_ordered_date');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_client_name')) {
                $table->string('response_client_name', 255)->nullable()->after('response_applicant_name');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_client_code')) {
                $table->string('response_client_code', 120)->nullable()->after('response_client_name');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_product_name')) {
                $table->string('response_product_name', 255)->nullable()->after('response_client_code');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_requested_by')) {
                $table->string('response_requested_by', 255)->nullable()->after('response_product_name');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_search_flagged')) {
                $table->boolean('response_search_flagged')->nullable()->after('response_requested_by');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_quickapp_applicant_link')) {
                $table->text('response_quickapp_applicant_link')->nullable()->after('response_search_flagged');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_created_date')) {
                $table->unsignedBigInteger('response_created_date')->nullable()->after('response_quickapp_applicant_link');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_created_by')) {
                $table->string('response_created_by', 255)->nullable()->after('response_created_date');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_modified_date')) {
                $table->unsignedBigInteger('response_modified_date')->nullable()->after('response_created_by');
            }
            if (! Schema::hasColumn('taz_webhook_events', 'response_modified_by')) {
                $table->string('response_modified_by', 255)->nullable()->after('response_modified_date');
            }
        });
    }

    public function down(): void
    {
        Schema::table('taz_webhook_events', function (Blueprint $table): void {
            $table->dropColumn([
                'resource_guid',
                'resource_path',
                'event_timestamp',
                'instance_guid',
                'base_client_guid',
                'external_identifier',
                'response_file_number',
                'response_order_status',
                'response_order_type',
                'response_ordered_date',
                'response_applicant_name',
                'response_client_name',
                'response_client_code',
                'response_product_name',
                'response_requested_by',
                'response_search_flagged',
                'response_quickapp_applicant_link',
                'response_created_date',
                'response_created_by',
                'response_modified_date',
                'response_modified_by',
            ]);
        });
    }
};
