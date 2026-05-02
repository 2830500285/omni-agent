# Security Model

This document records the current production baseline for Omni Agent.

## Trust Boundaries

- Workspace files are untrusted input. Instruction, memory, and skill files are loaded through workspace scanners and can be blocked before prompt injection.
- Shell commands are governed by approval class, risk tier, command rule id, and workspace path boundaries.
- MCP servers are external tools. Their resources are fenced with source labels, and MCP tool names use `mcp__<server>__<tool>` for policy filtering.
- Channel plugins are external ingress and egress surfaces. Route configs are sanitized before API responses and should use secret references for tokens and webhook URLs.
- ACP bridge endpoints are external client surfaces. Session creation, prompt forwarding, event history, forks, and cancellation must use the same gateway authentication and workspace root policy as other gateway routes.
- Model providers are remote services. API key health is tracked separately from run success and can enter cooldown after failures.
- OpenAI Responses profiles are model-provider surfaces. Request payloads, streaming deltas, function-call arguments, and usage metadata must be normalized before entering runtime state.
- Memory provider hooks can write durable facts. Treat recalled and newly written memory as labeled external context until source, tags, and freshness have been checked.
- Inline context references are untrusted citations into prompt context. They must preserve source labels and must not override workspace, approval, or model-provider policy.
- Skill platform gates decide whether workspace skill files can materialize. Treat skill content and scripts as untrusted until the safety gate allows them.
- Checkpoint and rollback state is a recovery boundary, not a policy bypass. Restored files, session metadata, and replayed tool outputs must be rechecked against the current workspace root, approval policy, and credential scope.
- Transactional patch application is a write boundary. Patch preview, file lease acquisition, apply, verification, and rollback must be treated as one auditable operation; partial writes must not be promoted as a successful tool result.
- MCP OAuth and allowlists are external identity boundaries. Server ids, redirect origins, scopes, and tool names must match explicit allowlist entries before tokens or MCP calls are accepted.
- Credential pools are shared secret boundaries. Pool entries must be selected by provider, workspace, route, and scope, and raw credentials must never be written to run logs, session state, eval output, or release diagnostics.
- Tool lifecycle hooks are execution boundaries. Before, after, error, and cleanup hooks inherit the same approval class, workspace path, network, and secret-redaction policy as the tool they wrap.
- Browser screenshot artifacts are visual evidence boundaries. `browser_screenshot` may persist PNG artifacts outside the workspace root, but the result must expose only artifact metadata, bounded browser diagnostics, and run-owned artifact paths.
- Model routing policy diagnostics are operational evidence boundaries. Route diagnostics may explain eligibility, selected order, context limits, cooldown, provider health, and credential pool state, but must redact raw credentials, headers, and request-body secret values.
- CLI checkpoint slash operations are recovery boundaries. `/checkpoints`, `/checkpoint <label>`, and `/rollback <id>` must route through managed checkpoint tools instead of bypassing workspace root, approval, or rollback policy.

## Approval Model

Tool execution is classified before use. Read-only operations can run without approval; mutating, destructive, privileged, or network-exec commands require stricter policy. Audit logs should retain the tool name, approval class, risk tier, command rule id, reason, and resolved path when available.

## Tool Risk Model

Command policy identifies shell wrappers, pipelines, recursive deletion, cross-shell deletion, download-and-execute patterns, and unknown command shapes. File tools resolve final paths and reject workspace escapes, including symlink and junction escapes.

## Channel Secret Model

Adapters and channel plugins must not expose raw tokens, webhook URLs, or signing secrets in route responses. Use `deploy/env.example` as the public schema and store live values in the deployment secret manager.

## MCP Trust Boundary

Treat MCP tools as external code. Allow only explicit server/tool names, prefer read-only resource access for subagents, and review runtime health and recent errors through CLI `/mcp` or gateway `/mcp/status`.

MCP OAuth flows must pin the configured server id, redirect origin, and requested scopes to the allowlist before exchanging or refreshing tokens. Token refresh failure should degrade that MCP server to unavailable instead of falling back to a broader credential. Allowlist changes require release review because they expand the callable external tool surface.

## Recovery and Patch Boundaries

Checkpoint and rollback capabilities can restore a previous workspace or session state, but they do not restore trust. After rollback, the runtime must re-evaluate tool approval, path containment, MCP allowlists, credential pool scope, and any pending lifecycle hook before execution continues.

Transactional patches must record the target files, expected preimage or lease, approval reason, verification command, and rollback path. If apply or verification fails, the operation must leave an explicit failed result and roll back owned writes where possible; it must not silently keep a partially applied patch.

## Credential Pool Boundary

Credential pools must isolate secrets by workspace, provider, route, and capability scope. A model-provider key cannot be reused as a channel webhook token, MCP OAuth token, or deploy secret unless the pool entry explicitly grants that use. Diagnostics may report credential ids, source labels, health, and cooldown state, but not raw values.

## Tool Lifecycle Hooks

Tool lifecycle hooks can prepare inputs, emit audit records, clean temporary state, and map errors. Hooks must not widen the wrapped tool's authority, introduce unapproved network calls, or persist unredacted arguments. Hook failures should be visible in the tool result and release diagnostics so cleanup and rollback behavior can be tested.

## Browser Artifact Boundary

Browser screenshots are stored as run-owned artifacts, not as trusted workspace files. Release review must verify that `browser_screenshot` records PNG mime type, byte size, artifact path, capture timestamp, and bounded browser observations without leaking unrelated artifact content.

## Model Routing Diagnostics

Model routing diagnostics must be specific enough to explain policy decisions and safe enough to include in release logs. They may include profile ids, provider ids, selected order, eligibility, context limits, cooldown state, credential ids, and health summaries. They must not include raw API keys, authorization headers, inline credentials, or request-body tokens.

## CLI Checkpoint Operations

CLI checkpoint slash commands are convenience wrappers around the governed checkpoint tools. `/checkpoints`, `/checkpoint <label>`, and `/rollback <id>` must keep the same workspace-root containment, managed-checkpoint validation, symlink escape rejection, and post-rollback policy revalidation as the runtime checkpoint path.

## Deployment Security Review

Every release or deployment image must keep these capability and security review items visible in docs and tests:

1. ACP gateway routes: verify `/acp/manifest`, `/acp/sessions`, `/acp/events/history`, prompt forwarding, fork, and cancel behavior under the gateway auth and workspace-root boundary.
2. Responses model adapter: verify streaming output text, function arguments, normalized usage, auth health, and fallback diagnostics without logging raw API keys.
3. Memory provider hooks: verify durable writes carry source labels or tags, stale memory is ignored, and provider failures do not corrupt session state.
4. Inline context references: verify context citations remain labeled evidence and cannot bypass prompt-injection, tool-approval, or workspace policies.
5. Skill platform gates: verify unsafe skill content is not materialized and reviewed skills remain tied to the workspace boundary.
6. Checkpoint/rollback: verify the checkpoint/rollback path restores only owned workspace/session state and reruns approval, path, MCP allowlist, credential pool, and lifecycle-hook checks before resumed execution.
7. Transactional patch: verify the transactional patch flow records preview, lease or preimage, apply status, verification result, and rollback status, and rejects partially applied success.
8. MCP OAuth/allowlist: verify the MCP OAuth and allowlist evidence surface pins server id, redirect origin, scopes, and tool names before token exchange, refresh, or tool invocation.
9. Credential pool: verify `credential-pool-rotation` covers isolation by workspace, provider, route, and scope, with diagnostics that expose credential health but never raw secret values.
10. Tool lifecycle hooks: verify `tool-lifecycle-hooks` preserve the wrapped tool's approval, workspace, network, and redaction policy across before, after, error, and cleanup hooks.
11. Browser screenshot artifact: verify `browser-screenshot-artifact` writes a run-owned PNG artifact with metadata and bounded diagnostics, and that `read_artifact` only reads artifacts owned by the current run.
12. Model routing policy diagnostics: verify `model-routing-policy-diagnostics` explains route eligibility, selected order, cooldown skips, context limits, and credential health while preserving credential raw redaction.
13. Runtime mutation checkpoint rollback: verify `runtime-mutation-checkpoint-rollback` creates opt-in mutation checkpoints before writes, captures pre-rollback failure evidence, and restores owned files after final verification failure.
14. CLI checkpoint slash surface: verify `cli-checkpoint-slash-surface` exposes `/checkpoints`, `/checkpoint <label>`, and `/rollback <id>` without bypassing managed checkpoint policy.
