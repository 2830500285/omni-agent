# HTX Read-Only Gateway Contract

`htx_account_snapshot` should read private HTX account state through a narrow gateway instead of storing exchange keys inside Omni Agent. The gateway owns HTX request signing and exposes only account snapshot data.

## Endpoint

`GET /htx/account-snapshot`

Required headers:

- `authorization: Bearer <gateway-token>`
- `x-omni-request-id: <uuid>`
- `x-omni-timestamp: <unix-ms>`

Optional query:

- `accountId`
- `assets=USDT,HTX,TRX`

Success response:

```json
{
  "venue": "htx",
  "mode": "gateway",
  "accountId": "spot-main",
  "balances": [
    { "asset": "USDT", "available": 100, "locked": 0 }
  ],
  "permissions": {
    "read": true,
    "spotTrade": false,
    "withdraw": false,
    "margin": false,
    "derivatives": false
  },
  "observedAt": "2026-05-11T00:00:00.000Z",
  "source": "htx-readonly-gateway"
}
```

## Signing Boundary

The gateway may sign upstream HTX requests internally. Omni Agent should only receive the gateway bearer token, never the HTX API secret. The gateway token should authorize read-only snapshot access and should not be accepted by trading endpoints.

Example upstream signing fields kept inside the gateway:

```json
{
  "accessKeyRef": "secret://htx/read-only/access-key",
  "secretKeyRef": "secret://htx/read-only/secret-key",
  "permission": "read-only"
}
```

## Error Model

Gateway errors should be structured:

- `auth_missing`: bearer token is absent.
- `permission_denied`: token cannot read the requested account.
- `rate_limit`: HTX or gateway rate limit.
- `invalid_account`: unknown or disallowed account id.
- `network_timeout`: upstream HTX call timed out.
- `upstream_unavailable`: HTX endpoint unavailable.

Error response:

```json
{
  "ok": false,
  "code": "permission_denied",
  "message": "The gateway token cannot read this account.",
  "retryable": false
}
```

## Fixture Use

Tests and demos may use account fixtures, but fixture mode must be labeled as fixture or mock. A fixture is not evidence that the live HTX account gateway works.
