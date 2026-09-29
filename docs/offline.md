# Offline browsing

Detour saves the last confirmed trip in this device's IndexedDB storage. The production build also caches the application files through a service worker. Development mode does not cache application files.

The saved trip includes places and their notes, stays, journeys, activities, booking numbers and PINs, tasks, and packing items. Photos, map tiles, and external websites require a connection. Offline editing and queued synchronization are not supported.

## Prepare your phone

1. Open the deployed app while online and sign in.
2. Add it to your home screen if you want it to open as an app.
3. Open that home-screen app while online. Wait for the check icon on the right of the navigation bar. Its tooltip confirms that the app and current trip are ready offline.
4. Detour requests persistent browser storage automatically. The browser decides whether to grant it.
5. Test airplane mode, close and reopen the app, and check Plan, bookings, and Prepare before relying on it while travelling.

Adding a home-screen shortcut alone does not download trip data. Safari and its home-screen app may use separate storage, so prepare the copy you will actually use.

## Storage and reconnecting

Offline mode shows a disconnected icon and disables changes. The download icon changes to a check once the app and current trip are saved. Select the icon to retry or reconnect. Reconnect checks the session before reloading server data. An explicit authentication rejection does not unlock an old offline copy. Successful sign-out, an unauthenticated session response, or a different account removes the saved trip. Sign-out requires a connection; if it fails, the app reports the error and keeps the session and saved trip. The cache contains private trip information, including booking PINs, and remains readable on that device while signed in.

Storage failures appear in the app and do not prevent online editing. Clearing browser data or browser storage eviction removes the offline copy. An unsuccessful edit is never persisted as confirmed trip data.

Application updates activate after tabs using the old worker close. The service worker caches only application files, never authentication or API responses.
