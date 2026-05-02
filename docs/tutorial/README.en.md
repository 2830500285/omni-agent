# Omni Agent Tutorial

This tutorial teaches Omni Agent as a verification-native coding-agent
runtime. It is written for developers who want to understand the repository,
run the CLI, connect a real model, evaluate agent behavior, and extend the
system without turning it into a loose demo.

Omni Agent should be taught in this order:

1. Quickstart
2. Project map
3. Runtime loop
4. Model profiles
5. Tools, workspace, and approvals
6. Context and memory
7. Subagents and task control
8. Gateway and workbench
9. Eval harness
10. Real-model benchmarks
11. Security and safety
12. Deployment and operations
13. Build your own feature
14. Case studies

## 1. Quickstart

Goal: install dependencies, verify the repo, and run the local agent path.

```bash
npm ci
npm run typecheck
npm run dev -- models
npm run dev -- doctor --cwd "."
npm run dev -- run --cwd "." --task "Summarize this repository"
```

The default runtime path is intentionally local-friendly. If no remote model is
configured, Omni Agent can still exercise scaffolding, workspace inspection,
mock runtime behavior, and eval plumbing.

Success criteria:

- `npm run typecheck` completes.
- `models` prints the loaded model profile status.
- `doctor` reports workspace, storage, model, gateway, route, automation, and
extension diagnostics.
- `run` creates a task summary without requiring hidden setup.

## 2. Project Map

Goal: know where each system responsibility lives before editing code.

```text
apps/cli                 CLI entrypoint, command parsing, chat commands
apps/workbench           Operator-facing workbench surface
apps/mobile-node         Node-side mobile client surface
apps/mobile-native       Native mobile shell surface
packages/core-runtime    Agent runtime loop and task execution
packages/model-client    OpenAI-compatible and Anthropic-compatible clients
packages/tools           Tool registry and executable tool contracts
packages/workspace       Repository inspection and file/workspace services
packages/context         Prompt context and thread compaction
packages/session-store   Durable sessions, runs, memory, routes, automation
packages/approvals       Approval policy and command risk handling
packages/evals           Eval suite schema, runners, score reports
packages/gateway         HTTP/SSE/WS gateway and control-plane APIs
packages/automation      Scheduled and event-triggered agent work
packages/safety          Safety checks and secret-pattern handling
examples/evals           Benchmark manifest and task fixtures
scripts                  Benchmark, release, maturity, and build scripts
docs                     Operations, security, parity, and tutorial docs
```

Teaching rule: every concept should be tied back to one of these directories.
If a lesson cannot point to code, it is probably product language instead of
engineering instruction.

## 3. Runtime Loop

Goal: understand what happens when a task runs.

The runtime path starts in `apps/cli`, builds runtime options, selects a model
profile, prepares workspace context, runs the agent loop, records tool/model
events, and returns a run summary. The central implementation is in
`packages/core-runtime`.

Read these areas first:

- `apps/cli/src/index.ts` for CLI command wiring.
- `packages/core-runtime/src/index.ts` for task execution.
- `packages/model-client/src/index.ts` for provider calls and usage data.
- `packages/session-store/src/index.ts` for persisted threads and runs.

Hands-on exercise:

```bash
npm run dev -- run --cwd "." --task "List the main runtime packages and say what each one does"
```

Then inspect the emitted summary and compare it with the runtime code path.

## 4. Model Profiles

Goal: connect a real provider without hardcoding secrets.

Omni Agent supports OpenAI-compatible profiles and Anthropic Messages profiles.
Use environment variables for keys and persist only the profile metadata.

```bash
npm run dev -- setup \
  --storage-root "%USERPROFILE%\\.omni-agent" \
  --default-workspace "E:\\repo" \
  --profile-id primary \
  --protocol openai \
  --base-url "https://api.openai.com/v1" \
  --api-key-env OPENAI_API_KEY \
  --model gpt-4.1-mini \
  --supports-tools true \
  --supports-streaming true
```

For DeepSeek or another OpenAI-compatible endpoint, keep the same shape and
replace the base URL, environment variable name, and model id:

```bash
npm run dev -- setup \
  --profile-id deepseek-flash \
  --protocol openai \
  --base-url "<openai-compatible-base-url>" \
  --api-key-env DEEPSEEK_API_KEY \
  --model "<model-id>" \
  --supports-tools true \
  --supports-streaming true
```

Verify the profile:

```bash
npm run dev -- models
npm run dev -- doctor --cwd "." --mode openai
```

Do not commit `.env`, local config files containing secrets, DPAPI files, or
runtime traces that include provider payloads.

## 5. Tools, Workspace, And Approvals

Goal: understand how the agent is allowed to act on a repository.

The important packages are:

- `packages/tools` for tool definitions and execution contracts.
- `packages/workspace` for file, git, and repository inspection.
- `packages/approvals` for risk decisions and command approval policy.
- `packages/safety` for prompt, command, path, and secret safety checks.

The design intent is not "let the model do anything." The runtime should make
capabilities explicit, gate risky actions, and leave evidence in the run
record.

Hands-on checks:

```bash
npm run dev -- doctor --cwd "."
node ./scripts/run-tests.mjs tests/safety.test.ts tests/approvals.test.ts tests/workspace.test.ts
```

When writing tests, avoid realistic complete fake tokens. Build partial token
strings at runtime or use obviously invalid placeholders so GitHub push
protection does not treat them as leaked secrets.

## 6. Context And Memory

Goal: understand what the agent remembers and what it should ignore.

Context and memory are split across:

- `packages/context` for prompt context and thread compression.
- `packages/session-store` for durable records.
- CLI memory commands for saving and searching user/project facts.

Try:

```bash
npm run dev -- memory-save --cwd "." --content "Use npm scripts for verification in this repository" --tag build
npm run dev -- memory-search --cwd "." --query "verification"
```

Teaching focus:

- Memory must be useful to the current task.
- Stale memory must not override current source.
- Compression should preserve handoff facts, tool evidence, and verification
  state.

## 7. Subagents And Task Control

Goal: learn how Omni Agent represents delegated work without losing control of
the parent task.

The runtime should treat subagents as governed execution units, not as free
threads. Useful teaching questions:

- What task was delegated?
- What files or responsibility did the subagent own?
- What budget or approval constraints applied?
- What evidence came back?
- How did the parent runtime merge or reject the result?

Related materials:

- `docs/governed-subagents.md`
- `docs/agent-run-artifacts.md`
- `packages/core-runtime`
- `packages/session-store`

## 8. Gateway And Workbench

Goal: expose Omni Agent as an inspectable local service.

The CLI can start a gateway for local orchestration and operator inspection:

```bash
npm run dev -- serve --cwd "." --port 4040 --gateway-token local-dev-token
```

The gateway package supports HTTP APIs, realtime events, async jobs, memories,
automations, and node control-plane sessions. The workbench is the user-facing
operator surface.

Read:

- `packages/gateway`
- `apps/workbench`
- `docs/operations.md`
- `docs/live-testing.md`

For teaching, make students trace one run from CLI command, to gateway event,
to stored run artifact.

## 9. Eval Harness

Goal: distinguish harness regression from real model capability.

The eval system lives in `packages/evals`, `examples/evals`, and benchmark
scripts under `scripts`.

Run the fast checks:

```bash
npm run eval:smoke
npm run eval:benchmark -- --mode synthetic --no-save
```

The default benchmark mode is `synthetic`. That is useful, but its meaning is
limited: it proves the harness, manifest normalization, score calculation, and
quality gates still work. It does not prove a real model completed every task.

Mock runtime mode is stronger than synthetic because it exercises the runtime
path, but it is still not a remote model evaluation:

```bash
npm run eval:release-local
npm run eval:benchmark -- --mode mock --no-save
```

Teach the distinction clearly:

- `synthetic`: scripted observed runs, best for harness regression.
- `mock`: real runtime path without remote model cost.
- `openai`: real model/provider path with actual model behavior, duration, and
  usage.

## 10. Real-Model Benchmarks

Goal: turn Omni Agent from a self-checking harness into a persuasive agent eval.

Use a configured real profile:

```bash
npm run eval:benchmark -- \
  --mode openai \
  --model-profile deepseek-flash \
  --run-id "deepseek-flash-45-full" \
  --approval-policy suggest \
  --verification-mode required
```

Or let `--model-profile` imply real model mode:

```bash
npm run eval:benchmark -- --model-profile deepseek-flash --run-id "deepseek-flash-45-full"
```

Each real benchmark should preserve:

- Manifest version.
- Model profile id.
- Runtime mode.
- Trace artifacts.
- Cost and token usage when available.
- Duration.
- Failed scenario ids.
- Failure reasons.
- Verification commands and exit codes.

Interpretation rule:

If a model can write good natural-language answers but fails required tool
events, snippets, or verification contracts, that is not only "model weakness."
It may also mean the benchmark requires stronger prompting, clearer tool
contracts, better fixture design, or a model with tool-use support. Judge the
trace before blaming the model.

## 11. Security And Safety

Goal: keep the project publishable and safe to run.

Read:

- `docs/security.md`
- `packages/safety`
- `packages/approvals`
- `tests/safety.test.ts`

Rules for contributors:

- Never commit real secrets.
- Never commit realistic complete fake secrets.
- Keep `.artifacts`, `.tmp`, `.agents`, `node_modules`, provider traces, and
  local runtime stores out of git.
- Treat tool execution, path traversal, prompt injection, and credential
  exfiltration as first-class test cases.

Run:

```bash
node ./scripts/run-tests.mjs tests/safety.test.ts
```

## 12. Deployment And Operations

Goal: know the release gates before claiming the project is ready.

Useful commands:

```bash
npm run typecheck
npm test
npm run maturity:check
npm run release:check
npm run release:artifact-smoke
```

Useful docs:

- `docs/operations.md`
- `docs/release-checklist.md`
- `docs/product-parity-dashboard.md`
- `docs/capability-backed-claims.md`

Teaching standard:

A capability claim should cite a command, a test, an eval result, or a stored
artifact. If it cannot be verified, present it as planned work instead of
completed behavior.

## 13. Build Your Own Feature

Goal: make one small production-style change with verification.

Recommended exercise: add a new eval scenario.

1. Add a focused fixture under `examples/evals/fixtures`.
2. Add the scenario to `examples/evals/suite.json`.
3. Add or update deterministic or heuristic scorers in `packages/evals`.
4. Run the smoke eval.
5. Run the synthetic benchmark.
6. If the scenario depends on real model behavior, run an `openai` benchmark
   with a named model profile and save the artifacts.

Verification:

```bash
npm run eval:smoke
npm run eval:benchmark -- --mode synthetic --no-save
npm run typecheck
```

## 14. Case Studies

Goal: teach from real agent failures instead of only happy paths.

Good case-study topics:

- A synthetic benchmark passes but a real model fails.
- A model edits the right file but misses the required verification evidence.
- A tool call is blocked by approval policy.
- A stale memory conflicts with current source.
- A gateway route succeeds locally but lacks production credentials.
- A benchmark score improves but cost or duration regresses.

Each case study should include:

- Starting command.
- Relevant model profile.
- Manifest/scenario id.
- Trace or artifact path.
- Expected behavior.
- Actual behavior.
- Root cause.
- Fix.
- Regression check.

## Recommended Course Directory

If this repository becomes a public learning project, use this teaching
directory structure:

```text
docs/tutorial/
  README.md
  README.en.md
  README.zh.md
  lessons/
    01-quickstart.en.md
    01-quickstart.zh.md
    02-runtime-loop.en.md
    02-runtime-loop.zh.md
    03-model-profiles.en.md
    03-model-profiles.zh.md
    04-tools-approvals.en.md
    04-tools-approvals.zh.md
    05-memory-context.en.md
    05-memory-context.zh.md
    06-evals.en.md
    06-evals.zh.md
    07-real-benchmark.en.md
    07-real-benchmark.zh.md
  labs/
    add-eval-scenario/
    connect-openai-compatible-model/
    inspect-gateway-run/
  reports/
    benchmark-template.md
    failure-analysis-template.md
```

Keep the first version compact. Split into separate lesson files only after the
single tutorial becomes too long to maintain.
