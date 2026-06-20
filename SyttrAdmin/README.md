# Syttr Admin Console

React + Vite admin frontend for operations, support, payments, subscriptions, users, jobs, interviews, and audit visibility.

## Stack

- React 19
- Vite 7
- ESLint

## Prerequisites

- Node.js 20+
- npm
- Running admin API from [`../admin-backend`](/c:/Users/tdext/Videos/Syttr2/admin-backend)

## Configuration

The console reads its API settings from [`src/api.js`](/c:/Users/tdext/Videos/Syttr2/SyttrAdmin/src/api.js).

Common environment values:

- `VITE_ADMIN_API_BASE_URL`
- `VITE_ADMIN_API_PORT`
- `VITE_ADMIN_ASSET_BASE_URL`
- `VITE_ADMIN_API_KEY`
- `VITE_ADMIN_API_KEY_HEADER`

If `VITE_ADMIN_API_BASE_URL` is not supplied, the app falls back to the current host and port `8001`.

## Local Run

```bash
npm install
npm run dev
```

Other commands:

```bash
npm run lint
npm run build
npm run preview
```

## Login Flow

- The console authenticates against `/api/admin/login`.
- Session data is stored in local storage.
- The admin API must be seeded with an operator account before first login.

## Current Scope

- Dashboard with live bookings and operational alerts
- Users, nannies, jobs, interviews, payments, commissions
- Support inbox, disputes, ratings, subscriptions, audit logs
- Read-only operational settings and admin profile views backed by live API data

## Related Services

- Admin API: [`../admin-backend`](/c:/Users/tdext/Videos/Syttr2/admin-backend)
- Mobile app: [`../frontend`](/c:/Users/tdext/Videos/Syttr2/frontend)
