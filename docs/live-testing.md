# Live And Contract Testing

Local tests are the default release gate. Live tests are opt-in because they require real credentials and can send external messages or spend provider quota.

## Environment Switches

- `OMNI_LIVE_CHANNEL_TESTS=1` enables live channel credential checks.
- `OMNI_LIVE_MCP_TESTS=1` enables live MCP server/account checks.
- `OMNI_LIVE_MODEL_TESTS=1` enables live model provider/account checks.
- `OMNI_LIVE_BAI_TESTS=1` enables tiny B.AI chat-completions requests through both the model and Genesis tool paths.
- `OMNI_LIVE_TRON_TESTS=1` enables read-only Genesis TRON account and TRC20 allowance checks.

The channel and MCP live suites also include local roundtrip fixtures, so the files prove a send/status or stdio request path even when external credentials are not configured. Genesis live tests remain fully opt-in and do not sign, broadcast, or place orders.

## Channel Matrix

Required variables when `OMNI_LIVE_CHANNEL_TESTS=1`:

- Slack: `OMNI_LIVE_SLACK_BOT_TOKEN`, `OMNI_LIVE_SLACK_CHANNEL_ID`
- Telegram: `OMNI_LIVE_TELEGRAM_BOT_TOKEN`, `OMNI_LIVE_TELEGRAM_CHAT_ID`
- Feishu: `OMNI_LIVE_FEISHU_TENANT_ACCESS_TOKEN`, `OMNI_LIVE_FEISHU_RECEIVE_ID`

Run:

```bash
OMNI_LIVE_CHANNEL_TESTS=1 node ./scripts/run-tests.mjs tests/channel-live.test.ts
```

## MCP Matrix

Required variables when `OMNI_LIVE_MCP_TESTS=1`:

- `OMNI_LIVE_MCP_SERVER_ID`
- `OMNI_LIVE_MCP_COMMAND`

Run:

```bash
OMNI_LIVE_MCP_TESTS=1 node ./scripts/run-tests.mjs tests/mcp-live.test.ts
```

## Model Matrix

Required variables when `OMNI_LIVE_MODEL_TESTS=1`:

- `OMNI_LIVE_MODEL_PROVIDER`
- `OMNI_LIVE_MODEL`
- `OMNI_LIVE_MODEL_API_KEY`

Required variables when `OMNI_LIVE_BAI_TESTS=1`:

- `OMNI_LIVE_BAI_MODEL`
- `OMNI_LIVE_BAI_API_KEY`
- optional: `OMNI_LIVE_BAI_BASE_URL` (defaults to `https://api.b.ai/v1`)

Run:

```bash
OMNI_LIVE_MODEL_TESTS=1 node ./scripts/run-tests.mjs tests/model-live.test.ts
OMNI_LIVE_BAI_TESTS=1 node ./scripts/run-tests.mjs tests/model-live.test.ts
```

## Genesis TRON And B.AI Tool Matrix

Required variables when `OMNI_LIVE_TRON_TESTS=1`:

- optional: `OMNI_LIVE_TRON_ADDRESS` (defaults to the public demo TRON address used by the Genesis fixtures)
- optional: `OMNI_LIVE_TRON_SPENDER` (defaults to the public demo spender)
- optional: `OMNI_LIVE_TRONSCAN_BASE_URL` (defaults to the tool's configured TronScan-compatible endpoint)
- optional: `OMNI_LIVE_TRON_FULL_NODE_URL` (defaults to the tool's configured TRON full-node endpoint)
- optional: `OMNI_LIVE_TRON_API_KEY` or `TRONGRID_API_KEY`

Required variables when `OMNI_LIVE_BAI_TESTS=1` for the Genesis tool path:

- `OMNI_LIVE_BAI_API_KEY`
- optional: `OMNI_LIVE_BAI_MODEL` (defaults to `gpt-5.2`)
- optional: `OMNI_LIVE_BAI_BASE_URL` (defaults to `https://api.b.ai`)

Run:

```bash
OMNI_LIVE_TRON_TESTS=1 node ./scripts/run-tests.mjs tests/tools-live.test.ts
OMNI_LIVE_BAI_TESTS=1 node ./scripts/run-tests.mjs tests/tools-live.test.ts
```

## Promotion Rule

A capability can be marked `mature` only when the scorecard entry cites one of these live tests or an equivalent local contract test, an operational runbook section, mature evidence files, recovery tests, and passing benchmark scenario ids.
