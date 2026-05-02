# Live And Contract Testing

Local tests are the default release gate. Live tests are opt-in because they require real credentials and can send external messages or spend provider quota.

## Environment Switches

- `OMNI_LIVE_CHANNEL_TESTS=1` enables live channel credential checks.
- `OMNI_LIVE_MCP_TESTS=1` enables live MCP server/account checks.
- `OMNI_LIVE_MODEL_TESTS=1` enables live model provider/account checks.

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

Run:

```bash
OMNI_LIVE_MODEL_TESTS=1 node ./scripts/run-tests.mjs tests/model-live.test.ts
```

## Promotion Rule

A capability can be marked `mature` only when the scorecard entry cites one of these live tests or an equivalent local contract test, an operational runbook section, mature evidence files, recovery tests, and passing benchmark scenario ids.
