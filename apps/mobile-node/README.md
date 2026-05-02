# Omni Mobile Node

Reference client for native iOS, Android, desktop, or embedded device nodes.

The client binds a device to the gateway `mobile-node` protocol:

- `GET /mobile-node/manifest`
- `POST /mobile-node/register`
- `POST /mobile-node/:deviceId/events`

Outbound delivery webhooks sent to the device use the `omni.mobile.delivery.v1` envelope.
