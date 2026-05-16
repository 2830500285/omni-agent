![Omni Agent banner](docs/assets/omni-agent-banner.png)

<p align="center">
  <a href="README.en.md"><img alt="Docs" src="https://img.shields.io/badge/DOCS-README-22c55e?style=for-the-badge&labelColor=0b1f14"></a>
  <a href="#status"><img alt="Status" src="https://img.shields.io/badge/STATUS-BETA-65a30d?style=for-the-badge&labelColor=0b1f14"></a>
  <a href="https://github.com/2830500285/omni-agent/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/2830500285/omni-agent/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=0b1f14&color=22c55e"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/LICENSE-MIT-84cc16?style=for-the-badge&labelColor=0b1f14"></a>
  <a href="docs/security.md"><img alt="Security" src="https://img.shields.io/badge/SECURITY-GOVERNED-059669?style=for-the-badge&labelColor=0b1f14"></a>
  <a href="examples/evals/suite.json"><img alt="Agent eval" src="https://img.shields.io/badge/AGENT_EVAL-REGRESSION-10b981?style=for-the-badge&labelColor=0b1f14"></a>
</p>

# Omni Agent

Languages: [English](README.en.md) | [Chinese](README.zh.md)

**Omni Agent is a local-first agent runtime for repository work.** It combines a
coding CLI, governed tool execution, persistent memory, subagents, a gateway,
and eval-backed capability claims so an agent can do useful work without hiding
the evidence trail.

It is built for operators who care about verification: every serious capability
should have a runnable command, a persisted artifact, a scorecard entry, or a
release gate behind it.

Useful links: [Tutorial](docs/tutorial/README.en.md) |
[Security](docs/security.md) |
[Operations](docs/operations.md) |
[Agent tooling](#project-agent-tooling) |
[Capability claims](docs/capability-backed-claims.md) |
[Genesis profile](docs/htx-genesis.md) |
[Release checklist](docs/release-checklist.md)

## Highlights

<table>
<tr><td><b>Verification-native runtime</b></td><td>Runs can capture tool calls, verification commands, diff summaries, artifacts, and eval evidence instead of relying on unsupported feature claims.</td></tr>
<tr><td><b>Governed execution</b></td><td>Workspace, worktree, and sandbox execution domains are capability-scoped. Approval classes and risk tiers separate safe reads from writes, shell commands, and control-plane actions.</td></tr>
<tr><td><b>Local coding workflow</b></td><td>Use the CLI to chat, run one-shot tasks, resume threads, compact history, inspect runs, and require verification commands before accepting a result.</td></tr>
<tr><td><b>Memory and learned skills</b></td><td>SQLite-backed memories, compatible workspace memory files, learned skills, promotion candidates, stale-skill review, and runtime recall for repeated patterns.</td></tr>
<tr><td><b>Subagents and parallel runs</b></td><td>Coordinate isolated workstreams, collect artifacts, and inspect batch progress through CLI and gateway surfaces.</td></tr>
<tr><td><b>Gateway and channels</b></td><td>HTTP, SSE, and WebSocket control plane with routes, inbox messages, outbound deliveries, pairing, bearer-token auth, and adapters for filesystem, webhook, Telegram, Slack, Discord, Feishu, DingTalk, and Teams style relays.</td></tr>
<tr><td><b>Provider-flexible models</b></td><td>OpenAI-compatible and Anthropic-style model profiles, failover chains, streaming support, native tool-calling when available, and JSON-envelope fallback when it is not.</td></tr>
<tr><td><b>Eval-backed maturity</b></td><td>Manifest-driven smoke tests, synthetic benchmarks, capability scorecards, maturity checks, release diagnostics, and CI gates keep public claims tied to reproducible checks.</td></tr>
</table>

## Quick Start

Runtime: **Node.js 24** and **npm 11** are the tested local baseline.

```bash
git clone https://github.com/2830500285/omni-agent.git
cd omni-agent
npm install
npm run build
```

Start a local workspace:

```bash
npm run dev -- onboard --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\\repo"
npm run dev -- chat --cwd "E:\\repo"
```

Configure a real model profile:

```bash
npm run dev -- setup --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\\repo" --profile-id primary --protocol openai --base-url "https://api.openai.com/v1" --api-key-env OPENAI_API_KEY --model gpt-4.1-mini
```

Run a one-shot task with required verification:

```bash
npm run dev -- run --cwd "E:\\repo" --task "Summarize this repository and list the riskiest files" --verify "npm run build"
```

Start the local gateway:

```bash
npm run dev -- serve --cwd "E:\\repo" --port 4040 --gateway-token local-dev-token
```

Then open `http://localhost:4040/app?token=local-dev-token` for the local
workbench.

## Project Agent Tooling

This repository includes optional project tooling for spec-driven development
and local Codex workflow orchestration.

| Tooling | What is checked in | Local setup and verification |
|---------|--------------------|------------------------------|
| GitHub Spec Kit | `.specify/`, `AGENTS.md`, and Codex skills under `.agents/skills/speckit-*` | `specify check`, `specify integration list`, `specify workflow list` |
| oh-my-codex | Portable ignore rules in `.gitignore`; project runtime state stays local under `.codex/` and `.omx/` | `omx setup --scope project --plugin --merge-agents`, then `omx doctor` |

Spec Kit commands are exposed as Codex skills such as
`$speckit-constitution`, `$speckit-specify`, `$speckit-plan`,
`$speckit-tasks`, and `$speckit-implement`.

oh-my-codex is intentionally project-local because `.codex/` can contain
machine-specific plugin cache paths and hook trust state. Re-run the setup
command after cloning if you want OMX skills, hooks, goals, and HUD state in
your local Codex session.

## Getting Started

The CLI is the fastest path for local repository work:

```bash
npm run dev -- chat --cwd "E:\\repo"                         # interactive thread
npm run dev -- run --cwd "E:\\repo" --task "Fix the build"   # one-shot run
npm run dev -- threads --cwd "E:\\repo"                      # list threads
npm run dev -- runs --thread-id <thread-id>                  # inspect run history
npm run dev -- show-run --run-id <run-id>                    # inspect one run
npm run dev -- compact-thread --thread-id <thread-id>        # summarize older context
npm run dev -- doctor --cwd "E:\\repo" --mode openai         # diagnose setup
npm run dev -- models                                        # inspect model profiles
```

Inside `chat`, the main slash commands are:

| Command | Purpose |
|---------|---------|
| `/help` | Show available chat commands |
| `/status` | Inspect active workspace, mode, domain, and verification settings |
| `/new` | Start a fresh thread |
| `/threads` | List previous threads |
| `/resume <thread-id>` | Resume a stored thread |
| `/model [profile-id\|auto]` | Switch model profile |
| `/mode <mock\|openai>` | Switch runtime mode |
| `/domain <workspace\|worktree\|sandbox>` | Choose execution isolation |
| `/verify [command]` | Add a verification command |
| `/verification-mode <required\|best-effort>` | Control verification strictness |
| `/compact [keep-messages]` | Summarize older context |
| `/usage` | Show usage metadata when available |

## CLI vs Gateway

Omni Agent has two practical entry points: the local CLI for direct operator
work, and the gateway for automation, channel routing, and remote inspection.

| Action | CLI | Gateway |
|--------|-----|---------|
| Start work | `npm run dev -- chat --cwd "E:\\repo"` | `POST /runs` |
| Run in background | `npm run dev -- run --task "..."` | `POST /runs` async job events |
| Parallelize | `npm run dev -- run --execution-domain worktree` | `POST /parallel-runs` |
| Inspect state | `threads`, `runs`, `show-run`, `usage` | `GET /threads`, `GET /runs`, `GET /events/history` |
| Memory | `memory-save`, `memory-search` | `GET /memories`, `POST /memories` |
| Learned skills | `skills` | `GET /skills`, `GET /skills/maintenance` |
| Automations | `automation-create`, `automations`, `automation-run` | `GET /automations`, `POST /automations`, pause/resume/run endpoints |
| Channels | `route-create`, `routes`, `deliveries`, `pairing-approve` | `GET /routes`, `POST /routes`, `POST /inbox/messages`, `POST /pairings/approve` |
| Local UI | `serve` | `/app`, `/events`, `/ws` |

## Documentation

| Goal | Start here |
|------|------------|
| Learn the system end to end | [Tutorial book](docs/tutorial/README.en.md) |
| Understand the project thesis | [Omni Agent paradigms](docs/omni-agent-paradigms.md) |
| Run safely in real workspaces | [Security guide](docs/security.md) |
| Operate the gateway and local workbench | [Operations](docs/operations.md) |
| Verify public capability claims | [Capability-backed claims](docs/capability-backed-claims.md) |
| Understand run evidence | [Agent run artifacts](docs/agent-run-artifacts.md) |
| Understand memory behavior | [Accountable memory](docs/accountable-memory.md) |
| Understand subagent boundaries | [Governed subagents](docs/governed-subagents.md) |
| Test live integrations carefully | [Live testing](docs/live-testing.md) |
| Release with evidence | [Release checklist](docs/release-checklist.md) |
| Review the current comparison state | [Capability comparison](CAPABILITY_COMPARISON.md) |

## Genesis Profile

**Omni Agent Genesis** is the current competition/demo profile for guarded
HTX, Web3, and B.AI workflows. It is an auditable financial-agent workflow, not
an autonomous trading bot.

Implemented surfaces include:

- HTX market reads, read-only account snapshots, order previews, and paper-only order records.
- Web3 wallet reads, TRON account snapshots, TRC20 allowance reads, contract risk reports, revoke/transfer previews, and local transaction simulation.
- B.AI provider probing and OpenAI-compatible chat-completions calls when a key is supplied through the environment.
- Approval policy, amount caps, allowlists, eval manifests, maturity scorecards, and replayable run artifacts.

Safety boundary:

- Live HTX order placement is not enabled.
- Wallet signing and transaction broadcasting are not enabled.
- Arbitrary contract calls, leverage, derivatives, and withdrawals are not enabled.
- Real execution should only be added behind audited signer custody, explicit approval policy, small spot-only limits, and post-execution verification.

Fast Genesis verification:

```bash
node ./scripts/run-tests.mjs tests/tools.test.ts tests/approvals.test.ts tests/evals.test.ts
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode synthetic --no-save
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode runtime --no-save
npm run maturity:check
npm run build
```

Optional live endpoints are configured through environment variables such as
`BAI_API_KEY`, `OMNI_AGENT_BAI_BASE_URL`, `OMNI_AGENT_TRONSCAN_BASE_URL`,
`OMNI_AGENT_TRON_FULL_NODE_URL`, and `OMNI_AGENT_HTX_ACCOUNT_ENDPOINT`. Keep
private exchange keys, wallet seed phrases, and signer credentials out of the
demo adapter.

## Security Model

Omni Agent is designed for local operator control, but it can connect to real
repositories, shells, gateways, and message surfaces. Treat every remote message
and every model output as untrusted until policy and verification pass.

Important defaults:

- Reads, writes, shell execution, and control-plane actions are classified separately.
- `workspace`, `worktree`, and `sandbox` domains expose different capability sets.
- Risky actions can require explicit approval.
- Gateway APIs should use bearer-token auth outside throwaway local testing.
- Route inboxes can require route secrets, pairing, sender allowlists, and delivery retry policy.
- Financial Genesis adapters are read/preview/paper-only by default.

Read [Security](docs/security.md) before exposing the gateway, connecting real
message channels, or adding live execution adapters.

## Model Profiles

Omni Agent can run in mock mode or use configured model profiles:

```bash
npm run dev -- models
npm run dev -- config
```

Example failover configuration:

```powershell
$env:OMNI_AGENT_MODEL_PROFILES_JSON='[
  {"id":"primary","name":"Claude","protocol":"anthropic","baseUrl":"https://api.anthropic.com","apiKeyEnv":"ANTHROPIC_API_KEY","model":"claude-sonnet-4-5","supportsStreaming":true},
  {"id":"backup","name":"OpenAI","protocol":"openai","baseUrl":"https://api.openai.com/v1","apiKeyEnv":"OPENAI_API_KEY","model":"gpt-4.1-mini","supportsStreaming":true}
]'
```

Useful environment variables:

- `OMNI_AGENT_BASE_URL`
- `OMNI_AGENT_API_KEY`
- `OMNI_AGENT_MODEL`
- `OMNI_AGENT_MODEL_PROTOCOL`
- `OMNI_AGENT_MODEL_PROFILES_JSON`
- `OMNI_AGENT_SUPPORTS_STREAMING`
- `OMNI_AGENT_SUPPORTS_TOOLS`
- `OMNI_AGENT_GATEWAY_TOKEN`

## Evals and Release Gates

Run the main local checks:

```bash
npm run typecheck
npm test
npm run eval:smoke
npm run eval:benchmark -- --manifest examples/evals/suite.json --mode synthetic --no-save
npm run maturity:check
npm run release:check
```

Focused evals:

```bash
npm run eval:benchmark -- --manifest examples/evals/verification-native-runtime.json --mode synthetic --no-save
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode synthetic --no-save
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode runtime --no-save
npm run eval:benchmark -- --manifest examples/evals/omni-workflows.json --mode synthetic --no-save
```

Capability scorecards live in
[examples/evals/capability-scorecard.json](examples/evals/capability-scorecard.json).

## Architecture Map

```text
omni-agent/
├── operator surfaces/
│   ├── apps/cli/                 CLI, chat shell, daemon commands, gateway startup
│   ├── apps/workbench/           local browser workbench served by the gateway
│   ├── apps/mobile-node/         lightweight remote node client
│   └── apps/mobile-native/       native mobile shell placeholder
├── gateway control plane/
│   ├── packages/gateway/         HTTP API, SSE events, WebSocket control plane
│   ├── packages/gateway/src/routes.ts
│   │                              route definitions, inbox intake, outbound delivery
│   ├── packages/gateway/src/jobs.ts
│   │                              async run jobs and batch status
│   └── packages/automation/      persisted interval/manual automations
├── agent runtime/
│   ├── packages/core-runtime/    task loop, tool calls, verification, run metadata
│   ├── packages/context/         context construction, compression, handoff summaries
│   ├── packages/model-client/    model profiles, provider transports, failover
│   ├── packages/tools/           built-in tools, browser tools, Genesis adapters
│   ├── packages/approvals/       approval policy, action classes, risk tiers
│   ├── packages/safety/          safety checks and guardrail helpers
│   └── packages/workspace/       workspace, worktree, sandbox, SSH, cloud execution
├── persistence and learning/
│   ├── packages/session-store/   SQLite sessions, threads, runs, artifacts, usage
│   ├── packages/core-runtime/src/memory-provider.ts
│   │                              memory providers, learned patterns, recall hooks
│   └── workspace files           AGENTS.md, MEMORY.md, USER.md, memory/*.md
├── extension and integration layer/
│   ├── packages/extensions/      local extension manifests, prompts, resources
│   ├── packages/reference-native/
│   │                              generated native-reference integration evidence
│   ├── packages/reference-translated/
│   │                              translated reference-source evidence
│   └── deploy/                   Dockerfile and environment templates
├── evidence, evals, and release gates/
│   ├── examples/evals/           eval manifests, fixtures, capability scorecards
│   ├── packages/evals/           manifest scoring and benchmark primitives
│   ├── scripts/                  build, tests, evals, maturity, release checks
│   ├── tests/                    runtime, gateway, CLI, safety, tools, eval coverage
│   └── .github/workflows/        CI gates
└── documentation/
    ├── docs/security.md          security model and operator guidance
    ├── docs/operations.md        gateway/workbench operating guide
    ├── docs/tutorial/            guided tutorial book
    ├── docs/htx-genesis.md       Genesis demo profile
    └── CAPABILITY_COMPARISON.md  verified comparison state
```

## Development From Source

```bash
npm install
npm run typecheck
npm test
npm run build
```

Useful development commands:

```bash
npm run dev -- doctor --cwd "E:\\repo" --mode openai
npm run dev -- serve --cwd "E:\\repo" --port 4040 --gateway-token local-dev-token
npm run test:core
npm run test:gateway
npm run test:ops
```

Docker and environment templates are in [deploy](deploy/).

## Status

Omni Agent is a beta-stage local agent runtime. The core repository workflow,
gateway, memory, learned skills, governed execution, and eval surfaces are
implemented, but the project should still be treated as an operator-facing
engineering system rather than a turnkey consumer assistant.

Current non-goals:

- It is not a live trading system.
- It is not a wallet signer.
- It is not a hosted SaaS by default.
- It does not treat synthetic eval scores as proof that a real model solved the same task.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Keep changes small, evidence-backed, and
covered by the narrowest meaningful verification command.

Before opening a change:

```bash
npm run typecheck
npm test
npm run build
```

## License

[MIT](LICENSE)
