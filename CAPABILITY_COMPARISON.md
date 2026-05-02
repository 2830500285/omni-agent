# Omni Agent Capability Comparison

Date: 2026-04-28

This document records the current source-level capability comparison between `omni-agent` and the local reference projects:

- `claudecode-source`
- `hermes-agent-main`
- `openclaw-main`

Status vocabulary:

- `missing`: no concrete implementation exists yet.
- `scaffolded`: module, type, command, or API shape exists, but the capability is not robust enough for real use.
- `usable`: a real workflow can run end to end, with tests and a defined failure path.
- `mature`: comparable to the reference projects in depth, safety, observability, and operational behavior.

An item should not be marked `usable` unless it has all of the following:

- An entry command, runtime API, or tool invocation path.
- At least one targeted or integration test.
- A documented failure path or explicit degradation behavior.
- A clear safety, permission, or trust boundary.
- Observable output through events, metrics, logs, store records, or CLI/API responses.

## Current Position

`omni-agent` has a coherent local-first agent platform skeleton: runtime loop, tools, approvals, verification, session storage, context, memory, skills, subagents, gateway routes, workbench, and eval harness. It is stronger than a demo because many paths are implemented and tested.

It has not yet reached the combined engineering depth of the three reference projects. The largest gap is not feature naming, but production-grade behavior: command safety, MCP runtime depth, skill and memory self-improvement, channel plugin lifecycle, model fallback, subagent isolation, workbench operations, and fixed quality gates.

## Capability Matrix

| Area | Reference strength | Omni status | Evidence required before upgrading | Mature gap | Judgment |
| --- | --- | --- | --- | --- | --- |
| Coding runtime | Claude Code has a deeper CLI, tool loop, recovery behavior, and local coding UX. | `usable` | More terminal UX, failure repair, run recovery, and richer tool-result presentation. | Needs run recovery, richer terminal UX, and mature recovery tests. | Core runtime exists, but it is not Claude Code mature. |
| Tool governance | Claude Code has deeper shell permission logic; OpenClaw has wider provider/tool policy surfaces. | `usable` | Command parsing, path-bound enforcement, explainable approval reasons, and tests for destructive edge cases. | Needs deeper command parsing, approval explanations, and policy observability. | Current risk classification is useful but too shallow. |
| Shell and file safety | Claude Code has command prefix, wrapper, path, sed, sandbox, and compound-command analysis. | `usable` | Deeper shell parsing, platform-specific destructive command regressions, and broader approval event observability. | Needs broader platform destructive-command regressions and runbook-backed recovery proof. | Command wrapper, destructive/network execution, workspace path boundary, symlink escape, cleanup-root, and subagent write-target tests now exist. |
| Built-in tools | The references have broader and more polished tool ecosystems. | `usable` | More real integrations, better repair paths, and stronger per-tool observability. | Needs stronger integration depth and per-tool failure recovery evidence. | Broad local coverage, uneven depth. |
| MCP runtime | Claude Code supports richer MCP tool/resource workflows. | `usable` | OAuth/account-aware server management, broader live-server fixtures, and provider-specific diagnostics. | Needs account-aware MCP management plus live or contract server matrix. | stdio/http/sse discovery, `mcp__server__tool` calls, resource/prompt tools, runtime health, CLI `/mcp`, gateway `/mcp/status`, and subagent inheritance tests now exist. |
| Subagents | Claude Code and OpenClaw expose stronger foreground/background operation and progress surfaces. | `usable` | Path leases, artifact collection, live progress events, explicit tool inheritance, and workbench visibility. | Needs persisted authority, budgets, write leases, artifacts, and progress topology. | Orchestration exists; isolation and product behavior need work. |
| Context and compaction | Hermes and OpenClaw handle long-running context and cache pressure more deeply. | `usable` | Compression regression tests, budget observability, and loss/distortion checks. | Needs distortion/loss regression tests under budget pressure. | Functional, but quality gates should be stronger. |
| Memory lifecycle | Hermes has stronger provider lifecycle, review, and long-running memory behavior. | `usable` | Deeper recall precision attribution and long-running review fixtures. | Needs precision attribution, stale-memory rejection history, and long-running provider recovery. | Provider lifecycle hooks, persisted success/failure audit, gateway/workbench health, fenced recalls, session-end memory extraction, delegation recall, and memory usefulness metrics now exist. |
| Skill lifecycle | Hermes has full skill create/edit/patch/delete/write file flows and review. | `usable` | Richer revision history, remote sync, and larger skill-hub compatibility before maturity. | Needs revision history, remote sync, compatibility fixtures, and unsafe-skill recovery proof. | `skill_manage` now covers create, review, patch, write support files, remove support files, promote, rollback, disable, and unsafe script gating. |
| Execution backends | Hermes and OpenClaw have broader host/sandbox/provider execution experience. | `usable` | More provider-specific failure handling and real credential/account tests. | Needs provider-specific failure contracts and live credential probes. | Multiple descriptors exist; operational depth varies by backend. |
| Gateway routes | OpenClaw has a deeper channel ecosystem and plugin contract. | `usable` | Plugin contract, setup/status/security/bindings/agentTools, and real channel health surfaces. | Needs full lifecycle, auth health, retry/dead-letter, and channel contract proof. | Route adapters exist; channel plugin runtime is not mature. |
| Consumer channels | OpenClaw is broader across mobile, voice, canvas, media, and channel products. | `scaffolded` | Real channel plugins, inbound/outbound loop tests, auth health, and delivery failure recovery. | Needs real provider loops, auth health, and delivery recovery before usable/mature. | Contracts exist; product-grade adapters are incomplete. |
| Native outbound senders | Hermes/OpenClaw include real platform senders and config discipline. | `usable` | Live provider account validation and richer retry/error handling. | Needs live provider validation and richer retry/error classification. | Payloads and sender shapes exist, but live maturity is external and unproven. |
| Model runtime | OpenClaw has stronger fallback, auth profile health, cooldown, and runtime switching. | `usable` | Live provider account probes and provider-specific retry contracts. | Needs live provider probes, cooldown/fallback matrix, and provider-specific retries. | `ModelRouter`, error classification, cooldown, fallback attempts, auth profile health, usage metrics, CLI/gateway/workbench visibility, and tests now exist. |
| Operator workbench | OpenClaw has a richer operational surface. | `usable` | Modular frontend, richer live controls, and operator workflows for startup failures. | Needs modular operator workflows and live startup-failure controls. | Workbench/gateway surfaces runs, tool events, approvals, subagents, auth profiles, channel plugins, memory providers, MCP status, diagnostics, and runtime controls. |
| Benchmark quality | Mature agent projects need fixed regression sets, eval-program governance, real runtime runs, history, and blocking gates. | `usable` | More real fixture execution, calibrated human-review samples, and public benchmark packs. | Needs larger real-repo task sets, judge disagreement history, and cross-model repeated runs. | Default benchmark remains synthetic for fast regression; `eval:benchmark -- --mode openai --model-profile <id>` now runs the real CLI eval path and saves trace, duration, token/cost, failure, and longitudinal history artifacts. |
| Long-running automation | Hermes and OpenClaw include scheduled work, event-triggered tasks, messaging, retry, and daemon-oriented operation. | `usable` | More live channel-triggered automations, daemon soak tests, and operator workflows. | Needs live channel triggers, daemon soak, and operator recovery matrix. | Interval, event, heartbeat, relay, retry, cooldown, dead-letter, CLI/gateway controls, and automation tests now exist. |
| Production operations | OpenClaw and Hermes carry more operational lessons. | `usable` | Signed releases, migration rehearsal, and live deployment smoke tests. | Needs signed artifacts, migration rehearsal, and live deployment smoke. | Doctor, `--fix`, deploy templates, Docker/env baseline, security docs, release checklist, and deployment template tests now exist. |

## Upgrade Rules

Before any row is upgraded:

1. Add or update the runtime/API/tool implementation.
2. Add targeted tests for the successful path and at least one failure path.
3. Add or update an eval scenario when the capability affects agent behavior.
4. Record the safety boundary and observability surface in this file or a dedicated package document.
5. Run the relevant commands listed in `IMPROVE.MD`.

The machine-readable scorecard is validated by `validateCapabilityMaturityClaims()` in `packages/evals/src/index.ts`.
The gate enforces that:

- `usable` and `mature` capabilities cite implementation or test evidence.
- `usable` and `mature` capabilities link to at least one eval scenario.
- `mature` capabilities document the reference strength they claim to match.
- `mature` capabilities cite mature evidence files, live or contract tests, an operational runbook, failure recovery tests, and explicit mature criteria.
- `mature` capabilities cannot pass benchmark gating unless all linked scenarios completed successfully.

## Immediate Priorities

The P0-P10 implementation pass moves all tracked core areas to at least `usable`.
The next implementation sequence should focus on maturity, not more feature-name coverage:

1. Add a public real-repo task pack with issue fixtures, hidden tests, and repeated cross-model runs.
2. Add calibrated LLM-judge and human-review queues with disagreement history.
3. Add live MCP/channel/model account probes behind explicit opt-in credentials.
4. Split the workbench into modular views with operator actions and startup-failure workflows.
5. Add release artifact signing, migration rehearsal, and deployment smoke tests.

## Verification

The baseline verification for this comparison document is:

```bash
npm run typecheck
node --import tsx ./scripts/eval-program-check.ts
npm run eval:benchmark -- --mode synthetic
node ./scripts/run-tests.mjs tests/evals.test.ts
```

Release-grade parity claims require `npm run release:check`, including `npm run eval:release-local` and `npm run reference:evidence-smoke`, before the strict reference parity report is treated as evidence. Real model benchmark claims must cite saved `.artifacts/benchmarks/history.json` and `report.md` from `npm run eval:benchmark -- --mode openai --model-profile <id>`.
