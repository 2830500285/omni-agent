# Omni Agent Mobile Native Shell

This app is a minimal installable PWA/WebView shell for the `mobile-node` protocol. It is designed to be wrapped by Capacitor, Tauri Mobile, Expo WebView, or a vendor native shell without changing the gateway contract.

## Capabilities

- Registers a mobile device against `/mobile-node/register`.
- Sends device events to `/mobile-node/{deviceId}/events`.
- Stores gateway URL, endpoint URL, device id, and shared secret locally.
- Installs as a PWA and caches the shell for offline startup.
- Displays the latest local event response so native wrappers can bridge notifications later.

## Local Use

Open `index.html` from a static server, set the gateway URL, endpoint URL, device id, and secret, then register the device.

The gateway must expose the mobile node endpoints and accept the configured token.
