# Operations Runbook

This runbook is the local maturity baseline for capabilities that are not yet marked `mature` in the scorecard.

## Release Gate

Run `npm run release:check` before publishing a build or claiming maturity parity. The gate verifies required operational documents, then runs typecheck, build, release artifact smoke, release-local runtime eval, diagnostics, reference evidence smoke, strict reference parity, the full test suite, smoke/benchmark evals, and maturity checks.

## Shell And File Safety

Symptoms: a command is blocked, a path escape is rejected, or a user asks why a tool did not run.

1. Inspect the tool result for approval class, risk tier, command rule id, and resolved path.
2. Confirm the target path resolves inside the active workspace.
3. If a command is destructive or cross-shell, keep it blocked unless the user explicitly approved that exact operation.
4. Re-run the targeted regression with `node ./scripts/run-tests.mjs tests/approvals.test.ts tests/tools.test.ts tests/workspace.test.ts`.

Recovery evidence: blocked commands must fail closed and leave the workspace unchanged.

## Checkpoint And Rollback Recovery

Symptoms: a mutating tool or command leaves the workspace broken after final verification failure, or a manual rollback cannot find a safe checkpoint.

1. Inspect the run timeline for `runtime-mutation-checkpoint`, `pre-rollback-failure-evidence`, and `runtime-final-failure-rollback` artifacts.
2. Confirm the failed verification command and checkpoint id in the pre-rollback evidence artifact before retrying the task.
3. Use `/checkpoints` and `/rollback <id>` only for managed checkpoint ids listed by the CLI.
4. Re-run `node ./scripts/run-tests.mjs tests/runtime.test.ts tests/workspace.test.ts tests/cli-chat.test.ts`.

Recovery evidence: rollback must restore modified text and binary files, remove files created after the checkpoint, preserve managed artifacts, and leave an auditable failed run.

## Gateway And Channels

Symptoms: inbound messages are rejected, outbound delivery fails, or channel health is missing.

1. Check `/health`, `/routes`, and the route plugin status.
2. Confirm route `adapterType` matches the channel plugin and required secrets are configured through secret references.
3. For signed inbound providers, verify the request signature or `x-omni-route-secret`.
4. Inspect delivery status transitions: queued, sending, sent, acknowledged, retrying, failed, dead_letter.
5. For filesystem routes, confirm `target.retention.maxFiles` matches `adapterConfig.transcriptRetentionMaxFiles` and old outbound transcript JSON files are pruned after delivery.
6. Re-run local contracts with `node ./scripts/run-tests.mjs tests/channel-contracts.test.ts tests/gateway.test.ts tests/gateway-messages.test.ts`.

Recovery evidence: retry and dead-letter paths must be visible in delivery records or gateway responses, and retained transcript files must match the route retention policy.

## MCP Runtime

Symptoms: MCP resources are unavailable, a tool call fails, or a server disappears.

1. Check CLI `/mcp` or gateway `/mcp/status`.
2. Verify server command, transport, account credentials, and health timestamp.
3. Prefer read-only resource access for subagents until the tool is explicitly allowed.
4. Re-run `node ./scripts/run-tests.mjs tests/extensions.test.ts tests/tools.test.ts tests/runtime.test.ts`.

Recovery evidence: failed MCP calls must surface provider, server, tool/resource id, and error summary.

## Tool Lifecycle Hooks

Symptoms: a pre hook blocks a tool, a hook throws, or stop-hook audit output is missing after a denied tool call.

1. Inspect run timeline events for `toolName:hook:pre`, `toolName:hook:post`, and `toolName:hook:stop`.
2. Treat throwing pre hooks as fail-closed tool blocks; post and stop hook failures must be audit warnings, not result rewrites.
3. For cancelled runs, confirm hook diagnostics show the abort reason and that the underlying tool did not run while the pre hook was waiting.
4. Re-run `node ./scripts/run-tests.mjs tests/extensions.test.ts tests/runtime.test.ts`.

Recovery evidence: pre hook failures and pre-hook aborts must prevent the tool from running, while post and stop hook failures must preserve the original tool result or block reason.

## Model Runtime

Symptoms: primary provider fails, usage is missing, or auth health enters cooldown.

1. Check model profile id, provider id, auth profile health, cooldown state, and fallback attempts.
2. Confirm API keys are loaded from deployment secrets, not route or repo files.
3. If fallback is configured, verify the failed attempt is recorded before fallback success and that provider `Retry-After` cooldowns override the default rate-limit cooldown.
4. Run `npm run release:diagnostics` and retain the `modelDiagnostics` block with release notes; it must include profile counts, protocols, and aggregate pool health without raw URLs or key values.
5. Re-run `node ./scripts/run-tests.mjs tests/model-client.test.ts tests/runtime.test.ts tests/gateway.test.ts`.

Recovery evidence: fallback recovery must preserve the original error class, provider-specified retry window, and final provider used.

## Memory And Skills

Symptoms: stale memory is used, unsafe skill materializes, or review history is missing.

1. Check memory provider health and source labels before trusting a recalled fact.
2. Treat workspace skill files as untrusted until reviewed.
3. Reject unsafe scripts or prompt-injection content before writing support files.
4. Re-run `node ./scripts/run-tests.mjs tests/runtime.test.ts tests/session-store.test.ts tests/tools.test.ts tests/context.test.ts`.

Recovery evidence: stale or unsafe entries must be ignored with a visible reason.

## Subagents And Automation

Symptoms: a subagent exceeds budget, an automation gets stuck, or artifacts are incomplete.

1. Inspect parent run, subagent ids, budget, role, write targets, and collected artifacts.
2. Confirm no subagent writes outside its assigned workspace or target set.
3. For automations, inspect trigger type, retry count, cooldown, heartbeat, and dead-letter status.
4. Re-run `node ./scripts/run-tests.mjs tests/runtime.test.ts tests/tools.test.ts tests/automation.test.ts tests/session-store.test.ts`.

Recovery evidence: budget exhaustion and dead-letter states must preserve enough context for operator action.
