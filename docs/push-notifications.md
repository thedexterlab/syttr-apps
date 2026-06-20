# Native Push Notifications

This app now supports native Expo push notifications alongside the existing Pusher realtime layer.

## What Was Added

- `expo-notifications` on the mobile app
- iOS permission request and Expo push token generation
- device token registration and removal APIs in Laravel
- persistent `user_push_tokens` database storage
- server-side Expo push sending from the backend notification pipeline
- foreground/background notification listeners in the app bootstrap

## Runtime Behavior

- Pusher remains the in-app realtime channel for open screens and active sessions.
- Native push is sent from the backend for the same notification events so iOS can show alerts while the app is backgrounded or closed.
- Foreground native alerts are intentionally suppressed in the notification handler to avoid duplicate banners while Pusher is already updating the UI live.
- Notification responses are captured and stored locally under `expo_last_notification_response` for future deep-link handling.

## Backend Setup

Run the migration:

```bash
php artisan migrate
```

Optional environment variable if you want to authenticate requests to Expo Push:

```env
EXPO_ACCESS_TOKEN=
```

The backend sends notifications through Expo Push API at:

- `https://exp.host/--/api/v2/push/send`

## Apple / Expo Configuration

These steps must be completed outside the source tree.

1. Ensure the app bundle id in Expo matches the App Store app:
   - `com.dexad.Syttr`
2. Make sure push notifications are enabled for the Apple App ID in the Apple Developer portal.
3. Create or reuse an APNs Auth Key in Apple Developer:
   - Apple Developer > Certificates, Identifiers & Profiles > Keys
   - Enable `Apple Push Notifications service (APNs)`
   - Download the `.p8` file once
4. Upload the APNs key to EAS:

```bash
cd frontend
eas credentials
```

Then choose iOS and configure push notifications with the APNs key, key id, and team id.

5. Rebuild the iOS app after credentials are attached:

```bash
cd frontend
eas build --platform ios --profile production
```

6. Submit the rebuilt binary to TestFlight.

## Important Notes For TestFlight

- TestFlight uses production APNs, not the development sandbox.
- Existing installs built before push entitlements were added will not gain push support automatically. Reinstall the new TestFlight build.
- The user must accept the iOS notification permission prompt, or enable notifications later in iPhone Settings.

## EAS / Expo Requirements

- `frontend/app.json` now includes:
  - `expo-notifications` plugin
  - `aps-environment` entitlement
  - `remote-notification` background mode
  - iOS notification permission text
- `frontend/eas.json` can remain as-is unless you want a dedicated push-specific profile.

## Verification Checklist

1. Install the new TestFlight build.
2. Open the app and allow notifications on first prompt.
3. Log in on the device.
4. Confirm a row exists in `user_push_tokens`.
5. Trigger a chat message or any backend notification event from another account.
6. Background or close the app.
7. Confirm the iPhone notification tray shows the alert.

## Troubleshooting

- No row in `user_push_tokens`:
  - the app did not get permission
  - the app did not finish login/session sync
  - the backend `/push-tokens` endpoint is unreachable
- Row exists but no push is delivered:
  - APNs key is missing or invalid in EAS
  - the installed binary predates push entitlements
  - iOS notifications are disabled for the app
- Push works only while open:
  - you are seeing Pusher realtime updates, not native APNs delivery
  - rebuild and reinstall the TestFlight app with the new entitlements and APNs credentials
