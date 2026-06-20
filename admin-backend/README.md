# Syttr Admin API

Laravel 11 backend for the admin console. This service exposes admin authentication plus operational endpoints for dashboard stats, users, nannies, jobs, interviews, commissions, payments, subscriptions, support inbox, audit logs, and Taz verification lookup.

## Stack

- PHP 8.2+
- Laravel 11
- Separate admin database connection
- Read access into the main app data database

## Main Responsibilities

- Admin login / session protection
- Dashboard and reporting endpoints
- Parent and nanny moderation views
- Payments, commissions, subscription management
- Support inbox and audit log access
- Platform fee and Taz lookup endpoints

Primary admin routes live in [`routes/api.php`](/c:/Users/tdext/Videos/Syttr2/admin-backend/routes/api.php).

## Prerequisites

- PHP 8.2+
- Composer
- Admin database
- Access to the main application data source

## Setup

```bash
composer install
copy .env.example .env
php artisan key:generate
php artisan migrate
php artisan db:seed --class=AdminBootstrapSeeder
php artisan serve --port=8001
```

The default bootstrap seeder creates:

- a default admin user from `ADMIN_DEFAULT_EMAIL`, `ADMIN_DEFAULT_PASSWORD`, and `ADMIN_DEFAULT_NAME`
- the frontend API key record from `ADMIN_FRONTEND_API_KEY`
- the default commission setting from `ADMIN_DEFAULT_COMMISSION_TYPE` and `ADMIN_DEFAULT_COMMISSION_VALUE`

## Important Environment Values

- `APP_URL`
- `DB_*` for the admin service database
- `APP_DATA_DB_*` to read the main application database
- `APP_DATA_BASE_URL`
- `APP_DATA_ASSET_BASE_URL`
- `ADMIN_FRONTEND_API_KEY`
- `ADMIN_API_KEY_HEADER`
- `ADMIN_DEFAULT_EMAIL`
- `ADMIN_DEFAULT_PASSWORD`

The admin frontend in [`../SyttrAdmin`](/c:/Users/tdext/Videos/Syttr2/SyttrAdmin) expects this service on port `8001` by default.

## Quality Commands

```bash
php artisan test
./vendor/bin/pint
```

Note: broader integration and feature coverage still needs to be added beyond the default example tests.

## Related Services

- Admin frontend: [`../SyttrAdmin`](/c:/Users/tdext/Videos/Syttr2/SyttrAdmin)
- Mobile API: [`../backend`](/c:/Users/tdext/Videos/Syttr2/backend)
