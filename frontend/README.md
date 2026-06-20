# Syttr Mobile App

Expo / React Native client for the Syttr parent and nanny experience.

## Stack

- Expo Router
- React Native 0.81
- React 19
- Stripe web + native SDKs
- Pusher client for chat / notifications

## Main Areas

- Parent onboarding, profile, kids, and job posting
- Nanny onboarding, availability, verification, and wallet
- Booking requests, chat, notifications, and ratings
- Subscription, billing history, and support/contact flows

## Prerequisites

- Node.js 20 LTS or 22 LTS
- npm
- Expo CLI tooling through `npx expo`
- Native Android / iOS tooling if you want device builds

## Configuration

The app reads runtime values from `app.json` / Expo extra config and environment-aware helpers in [`app/_Api.ts`](/c:/Users/tdext/Videos/Syttr2/frontend/app/_Api.ts).

Important keys:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_API_KEY`
- `EXPO_PUBLIC_PUSHER_APP_KEY`
- `EXPO_PUBLIC_PUSHER_APP_CLUSTER`
- `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID`
- `EXPO_PUBLIC_STRIPE_*` product / price ids used by verification and subscriptions

Do not keep production secrets in source control for real deployments. Move them to environment-specific Expo config before release.

## Local Run

```bash
npm install
npm run start
```

If `npx expo start` fails inside Expo CLI with errors like `Body is unusable: Body has already been read`, check `node -v` first. This project should be run on Node 20 or 22, not newer current releases such as Node 25.

If you need to bypass Expo's dependency validation while getting the app running locally, use:

```bash
npm run start:no-validate
```

Useful commands:

```bash
npm run android
npm run ios
npm run web
npm run lint
```

## Notes

- Card setup works on web.
- Native card setup works through the Stripe React Native SDK.
- Apple Pay is only available on supported iOS builds with the correct merchant identifier.
- App feedback and contact requests post to the backend `support/messages` endpoints.

## Related Services

- Mobile API: [`../backend`](/c:/Users/tdext/Videos/Syttr2/backend)
- Admin console: [`../SyttrAdmin`](/c:/Users/tdext/Videos/Syttr2/SyttrAdmin)
- Admin API: [`../admin-backend`](/c:/Users/tdext/Videos/Syttr2/admin-backend)
