# Syttr Mobile API

Laravel 11 backend for the mobile app. This service handles authentication, profiles, kids, jobs, notifications, chat, support, payments, subscriptions, ratings, verification, and wallet flows.

## Stack

- PHP 8.2+
- Laravel 11
- SQLite / MySQL compatible Laravel database layer
- Pusher server package for real-time features

## Main API Areas

- Parent and nanny signup / login
- Parent profile and child management
- Nanny profile, availability, and verification
- Jobs, job requests, bookings, extra hours, cancellations
- Payment methods, Stripe verification, subscriptions, wallet, withdrawals
- Notifications, chat, favorites, ratings, support messages

Primary routes live in [`routes/api.php`](/c:/Users/tdext/Videos/Syttr2/backend/routes/api.php).

## Prerequisites

- PHP 8.2+
- Composer
- A configured database

## Setup

```bash
composer install
copy .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve --port=8000
```

If you want seed data, run:

```bash
php artisan db:seed
```

## Important Environment Values

- `APP_URL`
- `DB_*`
- `MOBILE_API_KEY`
- `PUSHER_APP_ID`
- `PUSHER_APP_KEY`
- `PUSHER_APP_SECRET`
- `PUSHER_APP_CLUSTER`
- Stripe / wallet related keys used by payment and subscription flows

The mobile client defaults to `http://127.0.0.1:8000/api/` for local development unless overridden by Expo config.

## Quality Commands

```bash
php artisan test
./vendor/bin/pint
```

Note: the repository still needs broader automated coverage beyond the default example tests.

## Related Services

- Mobile app: [`../frontend`](/c:/Users/tdext/Videos/Syttr2/frontend)
- Admin API: [`../admin-backend`](/c:/Users/tdext/Videos/Syttr2/admin-backend)
