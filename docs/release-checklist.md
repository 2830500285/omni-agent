# Release Checklist

Run these gates before publishing a release or deployment image.

Preferred one-command gate:

```bash
npm run release:check
```

The gate verifies required release documents and then runs the commands below.

1. `npm run typecheck`
2. `npm run build`
3. `npm run release:artifact-smoke`
4. `npm run eval:release-local`
5. `npm run release:diagnostics`
6. `npm run reference:evidence-smoke`
7. `npm run reference:parity -- --strict`
8. `npm test`
9. `npm run eval:smoke`
10. `npm run eval:benchmark`
11. `npm run maturity:check`
12. Run the targeted capability and security regression set when ACP, Responses, memory hooks, inline context references, skill platform gates, checkpoint/rollback, transactional patch, MCP OAuth/allowlist, credential pool, tool lifecycle hooks, browser screenshot artifacts, model routing policy diagnostics, runtime mutation checkpoint rollback, release gates, maturity artifacts, or CLI checkpoint slash operations changed: `node ./scripts/run-tests.mjs tests/gateway.test.ts tests/model-client.test.ts tests/runtime.test.ts tests/context.test.ts tests/workspace.test.ts tests/tools.test.ts tests/cli-chat.test.ts tests/evals.test.ts tests/extensions.test.ts tests/release-check.test.ts tests/maturity-artifacts.test.ts`
13. Verify `examples/evals/capability-scorecard.json` reflects the shipped capability status, including `acp-cancel-and-event-projection`, `responses-streaming-adapter`, `memory-lifecycle`, `inline-context-references`, `skill-platform-gates`, `workspace-checkpoints`, `credential-pool-rotation`, `tool-lifecycle-hooks`, `browser-screenshot-artifact`, `model-routing-policy-diagnostics`, `runtime-mutation-checkpoint-rollback`, and `cli-checkpoint-slash-surface`. Treat transactional patch and MCP OAuth/allowlist changes as security/evidence surfaces covered by `docs/security.md`, `tests/extensions.test.ts`, `tests/tools.test.ts`, and `tests/workspace.test.ts`, not standalone scorecard IDs unless new capabilities are added.
14. Review `docs/security.md` and deployment secret configuration for any new trust boundary.
15. Confirm the deployment security gates cover ACP gateway routes, Responses streaming and tool calls, memory provider hook writes, inline reference labeling, skill materialization safety, checkpoint/rollback revalidation, transactional patch rollback, MCP OAuth allowlists, credential pool isolation, tool lifecycle hook policy inheritance, browser_screenshot artifact metadata, model routing policy diagnostics with credential raw redaction, runtime opt-in mutation checkpoint rollback after final verification failure, and CLI `/checkpoints`, `/checkpoint <label>`, `/rollback <id>` operations.
16. Build the container with `docker build -f deploy/Dockerfile -t omni-agent:latest .`.
17. Start a gateway-only deployment and verify `GET /health`.
18. Record benchmark JSON output and any maturity issues in the release notes.
