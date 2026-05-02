# Product Parity Dashboard

This dashboard tracks omni-agent parity against ClaudeCode, Hermes, and OpenClaw without treating facade coverage as product equivalence.

## Current Status

| Area | Status | Evidence |
| --- | --- | --- |
| Reference native coverage | contract-tested with facade boundary | `npm run reference:parity -- --strict` |
| ClaudeCode runtime parity | contract-tested | `tests/runtime.test.ts`, `tests/cli-chat.test.ts`, `tests/cli-ops.test.ts`, `tests/workspace.test.ts` |
| ClaudeCode full TUI/desktop parity | not product-equivalent | Requires manual workbench/desktop acceptance |
| Hermes core loop/tool parity | contract-tested | `tests/tools.test.ts`, `tests/runtime.test.ts`, `tests/context.test.ts`, `tests/session-store.test.ts` |
| Hermes voice/media/deep provider parity | not product-equivalent | Requires live provider adapters and artifact tests |
| OpenClaw route/channel control plane | contract-tested | `tests/gateway.test.ts`, `tests/gateway-messages.test.ts`, `tests/channel-contracts.test.ts` |
| OpenClaw live channel parity | not product-equivalent | Requires `OMNI_LIVE_CHANNEL_TESTS=1` with real provider accounts |
| MCP/extension contract parity | contract-tested | `tests/extensions.test.ts` |
| Live MCP parity | not product-equivalent | Requires `OMNI_LIVE_MCP_TESTS=1` |
| Model routing/profile parity | contract-tested | `tests/model-client.test.ts` |
| Live model matrix | not product-equivalent | Requires `OMNI_LIVE_MODEL_TESTS=1` |
| Complex task benchmark | benchmark-defined | `examples/evals/complex-suite.json` |

## Parity Rules

- `facade`: discoverable and mapped, but not a behavioral equivalence claim.
- `contract-tested`: covered by deterministic local tests.
- `live-tested`: covered by opt-in tests against a real external provider.
- `product-equivalent`: requires contract tests, live tests when applicable, operator runbooks, and manual workflow acceptance.

## Required Live Gates

```bash
OMNI_LIVE_CHANNEL_TESTS=1 node --import tsx --test tests\channel-live.test.ts
OMNI_LIVE_MCP_TESTS=1 node --import tsx --test tests\mcp-live.test.ts
OMNI_LIVE_MODEL_TESTS=1 node --import tsx --test tests\model-live.test.ts
```

## Required Local Gates

```bash
npm run eval:release-local
npm run reference:evidence-smoke
npm run reference:parity -- --strict
npm run reference:native-report -- --strict
npm run eval:benchmark -- --manifest examples\evals\complex-suite.json
npm run build
npm test
```
