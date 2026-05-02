# Omni Agent

Languages: [English](README.en.md) | [中文](README.zh.md)

Local-first CLI/TUI coding agent for repository work.

## Project thesis

Omni Agent is a verification-native multi-agent runtime: tasks, subagents,
memory, capability claims, and run records are designed around reproducible
evidence instead of unsupported feature claims. The five core project paradigms
are documented in `docs/omni-agent-paradigms.md`.

## Tutorials

- [English tutorial](docs/tutorial/README.en.md)
- [Chinese tutorial](docs/tutorial/README.zh.md)

## Scripts

```bash
npm install
npm run build
npm run dev -- onboard --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\\repo"
npm run dev -- setup --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\\repo" --profile-id primary --protocol openai --base-url "https://api.openai.com/v1" --api-key-env OPENAI_API_KEY --model gpt-4.1-mini
npm run dev -- config
npm run dev -- chat --cwd "E:\\repo"
npm run dev -- models
npm run dev -- evals --cwd "E:\\repo" --manifest ".\\examples\\evals\\suite.json"
npm run dev -- run --task "Summarize this repository"
npm run dev -- memory-save --cwd "E:\\repo" --content "Use pnpm in this repo" --tag build
npm run dev -- memory-search --cwd "E:\\repo" --query "pnpm"
npm run dev -- memory-search --cwd "E:\\repo" --query "pairing" --backend file
npm run dev -- skills --cwd "E:\\repo" --query "verification"
npm run dev -- automation-create --cwd "E:\\repo" --title "Nightly build" --task "Run the build and summarize failures" --interval-seconds 3600
npm run dev -- automations --cwd "E:\\repo"
npm run dev -- routes --cwd "E:\\repo"
npm run dev -- route-create --cwd "E:\\repo" --title "Slack triage" --channel-type slack --channel-key C12345 --adapter-type filesystem --outbox-dir ".\\outbox" --inbound-secret route-secret
npm run dev -- route-create --cwd "E:\\repo" --title "Telegram triage" --channel-type telegram --channel-key 12345 --adapter-type telegram --telegram-bot-token "<bot-token>" --retry-max-attempts 5 --retry-delay-ms 3000
npm run dev -- route-create --cwd "E:\\repo" --title "Slack live" --channel-type slack --channel-key C12345 --adapter-type slack --slack-bot-token "<token>"
npm run dev -- route-create --cwd "E:\\repo" --title "Discord live" --channel-type discord --channel-key 998877 --adapter-type discord --discord-webhook-url "https://discord.com/api/webhooks/..."
npm run dev -- deliveries --cwd "E:\\repo"
npm run dev -- extensions --plugin-dir ".\\examples\\plugins"
npm run dev -- doctor --cwd "E:\\repo" --mode openai
npm run dev -- serve --cwd "E:\\repo" --port 4040
npm run dev -- daemon-start --cwd "E:\\repo" --port 4040 --gateway-token local-dev-token
npm run dev -- daemon-status
npm run dev -- daemon-stop
npm test
```

`npm test` now auto-discovers every `tests/**/*.test.ts` suite instead of relying on a hand-maintained file list. That keeps new coverage, such as CLI config or approval-policy tests, from being added to the repository but silently skipped by the default verification path.

## Runtime modes

- `mock` (default): runs the scaffold without remote model access
- `openai`: uses `OMNI_AGENT_BASE_URL`, `OMNI_AGENT_API_KEY`, and `OMNI_AGENT_MODEL`
- `openai` runtime now supports both `protocol=openai` chat-completions profiles and `protocol=anthropic` Messages API profiles
- `openai` prefers native tool-calling when the provider supports it
- set `OMNI_AGENT_SUPPORTS_STREAMING=true` to request SSE streaming from compatible providers
- set `OMNI_AGENT_SUPPORTS_TOOLS=false` to force JSON-envelope fallback for providers without tool-call support
- set `OMNI_AGENT_MODEL_PROTOCOL=anthropic` to use Anthropic Messages as the default single-profile transport
- set `OMNI_AGENT_MODEL_API_PATH` to override the request path under `OMNI_AGENT_BASE_URL`
- set `OMNI_AGENT_MODEL_HEADERS_JSON` to attach provider-specific headers
- set `OMNI_AGENT_MODEL_BODY_JSON` to merge provider-specific request fields such as token limits or reasoning flags
- set `OMNI_AGENT_MODEL_PROFILES_JSON` to a JSON array of OpenAI-compatible profiles for failover routing
- `npm run dev -- models` shows loaded profiles, tool support, and missing API-key env vars
- `serve` exposes the same runtime over HTTP for remote orchestration and inspection
- `serve` also enables realtime SSE/WS events, async jobs, memories, automations, and node control-plane sessions
- set `OMNI_AGENT_GATEWAY_TOKEN` or pass `--gateway-token` to require bearer-token access for gateway APIs

Example failover configuration:

```powershell
$env:OMNI_AGENT_MODEL_PROFILES_JSON='[
  {"id":"primary","name":"Claude","protocol":"anthropic","baseUrl":"https://api.anthropic.com","apiKeyEnv":"ANTHROPIC_API_KEY","model":"claude-sonnet-4-5","supportsStreaming":true},
  {"id":"backup","name":"OpenAI","protocol":"openai","baseUrl":"https://api.openai.com/v1","apiKeyEnv":"OPENAI_API_KEY","model":"gpt-4.1-mini","supportsStreaming":true}
]'
```

## CLI workflows

```bash
npm run dev -- onboard --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\repo"
npm run dev -- setup --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\repo" --profile-id primary --protocol openai --base-url "https://api.openai.com/v1" --api-key-env OPENAI_API_KEY --model gpt-4.1-mini
npm run dev -- config
npm run dev -- chat --cwd "E:\repo" --continue-latest
npm run dev -- threads --cwd "E:\repo"
npm run dev -- runs --thread-id <thread-id>
npm run dev -- show-thread --thread-id <thread-id>
npm run dev -- compact-thread --thread-id <thread-id> --keep-messages 8
npm run dev -- show-run --run-id <run-id>
npm run dev -- cleanup-run --run-id <run-id>
npm run dev -- memory-save --cwd "E:\repo" --content "Use npm run build before shipping" --tag build
npm run dev -- memory-search --cwd "E:\repo" --query "shipping"
npm run dev -- memory-search --cwd "E:\repo" --query "pairing" --backend file
npm run dev -- skills --cwd "E:\repo" --query "build"
npm run dev -- automation-create --cwd "E:\repo" --title "Hourly audit" --task "Inspect the repository and summarize risks" --interval-seconds 3600
npm run dev -- automations --cwd "E:\repo"
npm run dev -- automation-run --automation-id <automation-id>
npm run dev -- routes --cwd "E:\repo"
npm run dev -- usage --thread-id <thread-id>
npm run dev -- pairings --cwd "E:\repo"
npm run dev -- pairing-approve --code ABC123
npm run dev -- route-create --cwd "E:\repo" --title "Secure Slack triage" --channel-type slack --channel-key C12345 --adapter-type webhook --webhook-url "https://example.com/hook" --inbound-secret route-secret
npm run dev -- deliveries --cwd "E:\repo"
npm run dev -- extensions --cwd "E:\repo" --plugin-dir ".\examples\plugins"
npm run dev -- doctor --cwd "E:\repo" --mode openai
npm run dev -- run --task "Fix the failing build" --cwd "E:\repo" --continue-latest
npm run dev -- run --task "Refactor the parser" --mode openai --thread-id <thread-id> --verify "npm run typecheck" --verify "npm run build"
npm run dev -- run --task "Try a risky refactor in isolation" --cwd "E:\repo" --execution-domain worktree
npm run dev -- run --task "Try a non-git experiment in isolation" --cwd "E:\repo" --execution-domain sandbox
npm run dev -- serve --cwd "E:\repo" --plugin-dir ".\examples\plugins" --port 4040
npm run dev -- daemon-start --cwd "E:\repo" --plugin-dir ".\examples\plugins" --port 4040 --gateway-token local-dev-token
```

`onboard` and `setup` now cover the first-run gap that was still obvious versus Hermes and OpenClaw. They persist local config, initialize the default workspace, create starter context files such as `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `MEMORY.md`, and `USER.md`, and print immediate setup checks after writing config. `setup` now generates a gateway bearer token automatically when one is not already configured, so later `serve` and `daemon-start` runs pick up auth by default. `onboard` is the quick alias for bootstrap-only usage; `setup` also accepts persisted model-profile flags for config initialization, and will reject partial profile flag sets unless `--base-url`, `--api-key-env`, and `--model` are all provided. Re-run either command with `--force` to refresh the starter workspace files.

`chat` is the interactive local shell for day-to-day work. It keeps an active thread open and supports slash commands such as:

- `/help`
- `/status`
- `/session`
- `/usage`
- `/new`
- `/threads`
- `/history [limit]`
- `/compact [keep-messages]`
- `/resume <thread-id>`
- `/model [profile-id|auto]`
- `/mode <mock|openai>`
- `/domain <workspace|worktree|sandbox>`
- `/verify [command]`
- `/verify-clear`
- `/verification-mode <required|best-effort>`
- `/iterations <n>`
- `/exit`

`show-thread` now prints the stored session summary alongside message history, and `compact-thread` or `/compact` can roll older turns into that summary while retaining only the most recent messages. That closes a real resume/compaction gap versus Claude Code and OpenClaw: resumed sessions now bias toward the latest turns instead of replaying the oldest ones.

`omni-agent` now also records per-run operator metrics in the same local store that already persists threads and artifacts. Each completed run captures:

- provider/profile ids used across the run
- model turns and executed tool-call counts
- successful, failed, and blocked tool actions
- input/output/total token usage when the upstream provider reports it
- run duration

Those metrics surface in:

- `chat` via `/usage`
- `show-run`
- `show-thread`
- `usage --thread-id <id>`
- gateway run details (`GET /runs/:id`) and thread inspection (`GET /threads/:id`)

## Agent capability profiles

Agents can now be created from built-in capability profiles that bundle role, mode, context engine, memory providers, verification posture, max-iteration budget, default instructions, and runtime tool policy. This turns an agent from a simple `name + cwd + role` record into a reusable execution persona aligned to the main reference systems:

- `claude-coding-operator`: coding/runtime depth, surgical edits, verification, and repair loops.
- `hermes-self-improver`: memory-first execution, learned-skill capture, and self-improvement behavior.
- `openclaw-gateway-operator`: routed inboxes, auth/pairing awareness, automations, and delivery semantics.
- `review-verifier`: locked-down read-only review and acceptance checks.
- `research-analyst`: source-grounded repository discovery and comparison work.

Use `GET /agent-profiles` to list profiles. `POST /agents` and `PATCH /agents/<id>` accept `capabilityProfileId`; the gateway stores the profile in agent metadata and applies its defaults. Agent-scoped runs also re-read that metadata at execution time, so profile instructions and tool policy are enforced even when the run is launched from routes, automations, or the workbench. The `/app` workbench exposes the same profile selector and shows the selected profile in agent detail/effective-tool views.

## Doctor

`doctor` adds the operator diagnostics that `omni-agent` was still missing compared with Claude Code, Hermes, and OpenClaw. It validates:

- workspace inspection and repository visibility
- compatible workspace memory files such as `MEMORY.md`, `USER.md`, and `memory/YYYY-MM-DD.md`
- local SQLite/session storage initialization
- git availability and current repository state
- OpenAI-compatible profile configuration and missing API-key env vars
- gateway daemon status
- route safety checks and automation counts
- extension/plugin directory resolution and extension loading

`doctor` now also groups every non-OK remediation hint into an `Action items` block so operators can see the next fixes in one place. `doctor --strict` treats warnings as failures for CI-friendly checks. `doctor --fix` applies the small set of repairs that are safe to automate: it can generate a missing gateway token, recreate missing starter workspace files, clear stale daemon state, and migrate legacy Slack/Discord/Telegram routes without an explicit `dmPolicy` to `pairing`. It does not invent API keys, webhook URLs, or overwrite routes that were explicitly left `open`.

## Evals

`evals` closes the P8 benchmark gap by running manifest-driven task suites through the normal runtime and summarizing:

- completion rate
- first-pass rate
- repair rate after verification failure
- average tool calls
- long-context state retention rate
- release-decision readiness through a suite-level eval program spec

The suite format supports the three minimum categories called out in `issue.txt`:

- `single_agent_bugfix`
- `multi_agent_investigation`
- `long_context_modification`

Each scenario can include one or more steps plus expectations such as verification status, required changed files, required tool names, and required response snippets. Multi-step scenarios stay on the same thread so long-context retention is measured from actual state carry-over instead of inferred from logs.

The default suite also carries an eval program contract based on the local `Harness-Learning` and `agent-eval-learning` repos: it records the release decision, full-trace evaluation unit, curated dataset sources, judge roles, operational metrics, trace artifacts, and blocking release gates. Use `npm run eval:program` to validate that governance metadata before treating a benchmark as release evidence.

`npm run eval:benchmark` defaults to `--mode synthetic`, which is a fast harness and manifest regression check. It proves the benchmark wiring, scoring, and capability gates still work; it does not claim real model task success. For a real runtime run, use:

```bash
npm run eval:benchmark -- --mode openai --model-profile primary --max-iterations 8
```

Runtime benchmark runs call the normal CLI `evals` command, persist the full eval summary under `.artifacts/benchmarks/runs/<run-id>/`, and update `.artifacts/benchmarks/history.json`, `trend.json`, `latest.json`, and `report.md`. Those artifacts include trace-level observed runs, tool events, duration, token usage when the model reports it, cost estimates when pricing is known, and failed-step reasons. `--mode mock` is still useful for runtime-path verification without remote model calls.

## Capability-backed claims

Public capability claims are tracked in `docs/capability-backed-claims.md` and validated by `npm run maturity:check`. A claim must map to a scorecard capability, benchmark scenario, and maturity evidence; unsupported mature claims fail the check, while supported but non-mature claims are reported as risks.

## Workspace memory files

`omni-agent` now reads file-backed memory layouts that already exist in Hermes and OpenClaw style workspaces. On each run it loads, with prompt-safe truncation:

- `MEMORY.md`
- `USER.md`
- `memory/YYYY-MM-DD.md` for today and yesterday

This means you can move an existing workspace over without rewriting those files into a new storage format first. The files are treated as a run-start snapshot, so edits during a run do not mutate the already-built prompt.

You can now also write back into those files without replacing the existing SQLite memory store:

- `npm run dev -- memory-save --cwd "E:\\repo" --content "Use pnpm before shipping" --backend both`
- `npm run dev -- memory-save --cwd "E:\\repo" --content "Track today's findings" --scope thread --backend file --file-kind daily`
- `npm run dev -- memory-search --cwd "E:\\repo" --query "verification" --backend both`
- `npm run dev -- memory-search --cwd "E:\\repo" --query "pairing" --backend file`

Inside an agent run:

- `save_memory` accepts optional `backend` (`store` | `file` | `both`) and `fileKind` (`memory` | `user` | `daily`) arguments.
- `search_memory` now defaults to `backend=both`, so it searches both SQLite-backed memories and compatible workspace memory files unless you pin it to `store` or `file`.

## Workspace instruction files

`omni-agent` now injects repository guidance from common local instruction files before each run. It looks for these files from the workspace root down to the active target directory and includes them in the runtime prompt with prompt-safe truncation:

- `.hermes.md` / `HERMES.md`
- `AGENTS.md` / `agents.md`
- `CLAUDE.md` / `claude.md`
- `SOUL.md` / `soul.md`
- `TOOLS.md` / `tools.md`
- `.claude/CLAUDE.md` / `.claude/claude.md`
- `.claude/rules/**/*.md` with optional `paths:` frontmatter filtering
- `CLAUDE.local.md` / `claude.local.md`
- `.cursorrules`
- `.cursor/rules/**/*.mdc`

When the runtime later navigates into a deeper module through tools such as `read_file`, `search_text`, `list_directory`, or `run_command`, it also discovers newly relevant subdirectory instruction files and injects them before the next model turn. Claude-style `.claude/rules` files are loaded recursively, scoped rules are included only when their `paths:` selector matches the active target path, and instruction files can pull in Claude-style `@include` fragments. Workspace instruction files stay workspace-local by default, while `CLAUDE.local.md` can also import personal fragments from `~/.claude/` to support sibling or external worktrees without checking those paths into the shared repo.

This closes one of the biggest gaps versus Claude Code, Hermes, and OpenClaw: repo-specific and module-specific rules are no longer invisible to the runtime.

## Workspace skill directories

`omni-agent` now also reads file-backed skill instructions from the layouts that Hermes and OpenClaw already use:

- `skills/**/SKILL.md`
- `.agents/skills/**/SKILL.md`
- parent-category `DESCRIPTION.md`
- `references/*.md` under the matched skill directory

When a task objective matches one of those skill files, the runtime injects the relevant `SKILL.md` content plus nearby category descriptions and matching reference notes into the model context. Hermes/OpenClaw-style frontmatter such as `name`, `description`, `metadata.*.tags`, and `metadata.*.related_skills` is also parsed and used for matching, prompt injection, and CLI display. `npm run dev -- skills --cwd "E:\repo" --query "release"` also shows the parsed metadata and supporting files that were picked up alongside learned skills from SQLite.

This means an existing workspace can bring over reusable operator playbooks without first converting them into a new manifest format.

## External docs

`omni-agent` now also exposes built-in `web_search` and `web_fetch` tools for live model runs. `web_search` returns structured titles, URLs, and snippets for current results, while `web_fetch` pulls HTTP(S) documentation pages and text-based API responses into the same tool loop that already handles local files, shell commands, and verification.

This narrows another capability gap versus Claude Code, Hermes, and OpenClaw: the runtime no longer has to stay blind to external docs when the task depends on online references instead of only repository state.

## Local extensions

Point `--plugin-dir` at a directory of JSON manifests. Example manifest:

```json
{
  "id": "node-version",
  "name": "Node Version",
  "capability": "tool",
  "description": "Expose a fixed command as an Omni Agent tool.",
  "tools": [
    {
      "name": "node_version",
      "description": "Print the current Node.js version.",
      "inputHint": "{}",
      "riskHint": "read-only",
      "command": "node --version"
    }
  ]
}
```

You can repeat `--plugin-dir`, comma-separate it, or set `OMNI_AGENT_PLUGIN_DIRS`.

Module-backed extensions can also export prompt hooks:

```js
export default {
  id: "repo-guidance",
  name: "Repo Guidance",
  description: "Inject repo-specific instructions into the runtime prompt.",
  capability: "prompt-hook",
  promptHooks: [
    ({ objective }) => `Prefer concise edits while working on: ${objective}`,
  ],
};
```

Extensions can now carry MCP-like reusable assets as first-class resources and prompt templates, not just tools. Example manifest:

```json
{
  "id": "repo-playbook",
  "name": "Repo Playbook",
  "capability": "mcp",
  "description": "Reusable review assets for the runtime and gateway.",
  "resources": [
    {
      "id": "ops-guide",
      "description": "Static operational guidance.",
      "content": "Watch verification output before closing the run."
    },
    {
      "id": "checklist",
      "description": "Checklist loaded from disk.",
      "filePath": "checklist.md",
      "mimeType": "text/markdown; charset=utf-8"
    }
  ],
  "prompts": [
    {
      "name": "handoff",
      "description": "Render a handoff prompt.",
      "arguments": [
        { "name": "target", "required": true },
        { "name": "audience", "defaultValue": "maintainer" }
      ],
      "template": "Prepare a handoff for {{target}} aimed at the {{audience}}."
    }
  ]
}
```

Those assets are exposed three ways:

- the runtime can call `list_extension_resources`, `read_extension_resource`, `list_extension_prompts`, and `render_extension_prompt`
- the gateway exposes `/extensions/resources`, `/extensions/resources/:extensionId/:resourceId`, `/extensions/prompts`, and `/extensions/prompts/render`
- the local `/app` workbench lists extensions, resources, and prompt templates alongside the rest of the platform state

The extension layer now also supports real MCP servers over both `stdio` and `http`. Example MCP manifest:

```json
{
  "id": "review-mcp",
  "name": "Review MCP",
  "capability": "mcp",
  "description": "Load tools/resources/prompts from a real MCP server.",
  "mcp": {
    "transport": "stdio",
    "command": "node",
    "args": ["mcp-server.mjs"],
    "timeoutMs": 5000
  }
}
```

For HTTP MCP:

```json
{
  "id": "remote-review-mcp",
  "name": "Remote Review MCP",
  "capability": "mcp",
  "description": "Load tools/resources/prompts from a remote MCP endpoint.",
  "mcp": {
    "transport": "http",
    "url": "http://127.0.0.1:8787/mcp",
    "timeoutMs": 5000
  }
}
```

Loaded MCP assets become first-class runtime tools:

- `list_extension_resources`
- `read_extension_resource`
- `list_extension_prompts`
- `render_extension_prompt`

Bridge-backed extensions can expose external tools over `stdio` or `http`. Example HTTP bridge manifest:

```json
{
  "id": "review-bridge",
  "name": "Review Bridge",
  "capability": "bridge",
  "description": "Forward tool calls to an external review service.",
  "bridge": {
    "transport": "http",
    "url": "http://127.0.0.1:8787/tools/review",
    "method": "POST",
    "headers": {
      "x-bridge-name": "review"
    },
    "timeoutMs": 5000
  },
  "tools": [
    {
      "name": "bridge_review",
      "description": "Request an external review pass.",
      "inputHint": "{ diff: string }",
      "riskHint": "external bridge"
    }
  ]
}
```

Bridge manifests can safely keep helper scripts beside the manifest; the registry skips local helper files that are referenced by bridge definitions.

## Coordinator and swarms

The built-in toolset now includes isolated subagent orchestration:

- `spawn_subagent`: launch one scoped worker and wait on it separately
- `run_swarm`: launch multiple scoped workers in parallel and optionally wait for the whole batch
- `wait_subagent` / `list_subagents`: inspect or join worker progress

This gives the runtime a `Hermes`-style local coordinator path without leaving the main workspace shell.

## Route adapters

Routes can now relay responses back out through nine built-in adapter types:

- `console`: prints delivered content to the gateway stdout
- `filesystem`: writes delivery payloads into `adapterConfig.outboxDir`
- `webhook`: POSTs JSON payloads to `adapterConfig.url`
- `telegram`: calls the Telegram Bot API, supports reply threading, and can be polled inbound by the gateway
- `slack`: uses `adapterConfig.webhookUrl` or `chat.postMessage` via `adapterConfig.botToken`, and can be polled inbound with thread-aware replies
- `discord`: uses `adapterConfig.webhookUrl` or the Discord channel message API via `adapterConfig.botToken`, and can be polled inbound with direct message replies
- `feishu`: delivers text to a Feishu custom bot webhook
- `dingtalk`: delivers text to a DingTalk robot webhook
- `teams`: delivers text to a Microsoft Teams incoming webhook

Route creation now defaults `slack`, `discord`, `telegram`, `feishu`, `dingtalk`, and `teams` channels to `dmPolicy: "pairing"`. Set `dmPolicy: "open"` or pass `--dm-policy open` only for intentionally public routes.

Example route definitions:

```json
{
  "cwd": "E:\\repo",
  "title": "Filesystem triage",
  "channelType": "slack",
  "channelKey": "C12345",
  "adapterType": "filesystem",
  "adapterConfig": {
    "outboxDir": "E:\\repo\\outbox",
    "dmPolicy": "open"
  },
  "inboundSecret": "route-secret"
}
```

```json
{
  "cwd": "E:\\repo",
  "title": "Webhook triage",
  "channelType": "discord",
  "channelKey": "ops-room",
  "adapterType": "webhook",
  "adapterConfig": {
    "url": "https://example.com/omni-agent-webhook",
    "method": "POST",
    "headers": {
      "x-tenant": "ops"
    }
  }
}
```

```json
{
  "cwd": "E:\\repo",
  "title": "Telegram triage",
  "channelType": "telegram",
  "channelKey": "12345",
  "adapterType": "telegram",
  "adapterConfig": {
    "botToken": "<bot-token>",
    "parseMode": "Markdown",
    "retry": {
      "maxAttempts": 5,
      "delayMs": 3000
    }
  }
}
```

```json
{
  "cwd": "E:\\repo",
  "title": "Slack live route",
  "channelType": "slack",
  "channelKey": "C12345",
  "adapterType": "slack",
  "adapterConfig": {
    "botToken": "<slack-bot-token>",
    "retry": {
      "maxAttempts": 4,
      "delayMs": 2000
    }
  }
}
```

```json
{
  "cwd": "E:\\repo",
  "title": "Discord live route",
  "channelType": "discord",
  "channelKey": "998877",
  "adapterType": "discord",
  "adapterConfig": {
    "webhookUrl": "https://discord.com/api/webhooks/...",
    "retry": {
      "maxAttempts": 4,
      "delayMs": 2000
    }
  }
}
```

```json
{
  "cwd": "E:\\repo",
  "title": "Feishu operations route",
  "channelType": "feishu",
  "channelKey": "open-chat-id",
  "adapterType": "feishu",
  "adapterConfig": {
    "webhookUrl": "https://open.feishu.cn/open-apis/bot/v2/hook/..."
  }
}
```

```json
{
  "cwd": "E:\\repo",
  "title": "DingTalk operations route",
  "channelType": "dingtalk",
  "channelKey": "conversation-id",
  "adapterType": "dingtalk",
  "adapterConfig": {
    "webhookUrl": "https://oapi.dingtalk.com/robot/send?access_token=..."
  }
}
```

```json
{
  "cwd": "E:\\repo",
  "title": "Teams operations route",
  "channelType": "teams",
  "channelKey": "channel-id",
  "adapterType": "teams",
  "adapterConfig": {
    "webhookUrl": "https://..."
  }
}
```

## Learned skills

Verified runs now persist both a learned memory and a structured learned skill. The runtime recalls matching learned skills before planning a task, and increments their reuse count when they are surfaced.

- `npm run dev -- skills --cwd "E:\\repo"` lists the highest-signal learned skills for a workspace
- `npm run dev -- skills --cwd "E:\\repo" --query "parser"` searches by problem pattern, guidance, changed files, and tags
- `GET /skills?cwd=<abs-path>&query=<text>` exposes the same view over the gateway
- `GET /skills/maintenance?cwd=<abs-path>` returns promotion, re-verification, disable, and stable-skill buckets for operator review
- `POST /skills/<skill-id>/promote` with `{"target":"workspace"}` promotes a learned skill and materializes it as `skills/learned/<skill>/SKILL.md`
- The `/app` workbench can promote learned skills into workspace skill files after operator review

The self-learning loop now records an explicit profile fact for each verified learned skill assessment. When the same verified pattern repeats, the runtime materializes the skill into `skills/learned/<skill>/SKILL.md` and auto-promotes it to `sourceType: "workspace"` with evidence retained in profile memory. Low-quality or stale skills are exposed through the maintenance report instead of being silently reused forever.

Routes can also enforce sender pairing:

```json
{
  "cwd": "E:\\repo",
  "title": "Secure Slack DM",
  "channelType": "slack",
  "channelKey": "D12345",
  "adapterType": "filesystem",
  "adapterConfig": {
    "outboxDir": "E:\\repo\\outbox",
    "dmPolicy": "pairing",
    "allowFrom": ["alice"]
  }
}
```

Non-console adapters support delivery retries through `adapterConfig.retry`:

```json
{
  "retry": {
    "enabled": true,
    "maxAttempts": 3,
    "delayMs": 5000
  }
}
```

## HTTP gateway

`serve` starts a lightweight REST gateway over the same runtime:

- `GET /health`
- `GET /app`
- `GET /extensions`
- `GET /extensions/resources`
- `GET /extensions/resources/:extensionId/:resourceId`
- `GET /extensions/prompts`
- `POST /extensions/prompts/render`
- `GET /events/history`
- `GET /workspaces`
- `GET /threads?cwd=<abs-path>`
- `GET /threads/:id?limit=50`
- `GET /runs?threadId=<id>`
- `GET /runs/:id`
- `POST /runs`
- `POST /parallel-runs`
- `GET /parallel-runs/:batchId`
- `GET /jobs`
- `POST /runs/:id/cleanup`

Minimal run request:

```json
{
  "task": "Inspect this repository",
  "cwd": "E:\\repo",
  "mode": "mock",
  "executionDomain": "workspace"
}
```

Additional platform endpoints:

- `GET /events` for realtime SSE event streaming
- `GET /jobs`, `GET /jobs/:id` for async run status
- `GET /memories`, `POST /memories`
- `GET /skills`
- `GET /skills/maintenance`
- `GET /agent-profiles`
- `GET /automations`, `POST /automations`
- `POST /automations/:id/run`
- `POST /automations/:id/pause`
- `POST /automations/:id/resume`
- `DELETE /automations/:id`
- `GET /routes`, `POST /routes`
- `POST /routes/:id/deliver`
- `GET /deliveries`
- `GET /pairings`, `POST /pairings/approve`
- `GET /nodes`
- `GET /inbox/messages`, `POST /inbox/messages`

The gateway also exposes a WebSocket control plane at `/ws`:

- bearer token auth can be passed as `?token=<gateway-token>`
- messages support `node.register`, `node.heartbeat`, `run.start`, `route.deliver`, `inbox.accept`, and `subscribe`
- runtime, job, route, delivery, inbox, and node events are broadcast back as `gateway.event`

When a gateway token is configured:

- most API routes require `Authorization: Bearer <token>`
- `/health` stays open for readiness checks
- `/inbox/messages` can also authenticate with `x-omni-route-secret` or `routeSecret`
- `/app?token=<token>` opens the local workbench with authenticated API calls and the live control plane
- `/app` can now queue async runs, inspect threads and run details, approve pending pairings, and inspect extensions/resources/prompt templates directly from the workbench
  - `/ws?token=<token>` opens the authenticated control plane socket
  - routes can additionally require sender-level approval when `adapterConfig.dmPolicy = "pairing"`

`GET /memories` now accepts `backend=store|file|both` and defaults to `both`, so gateway memory queries include compatible workspace memory files (`MEMORY.md`, `USER.md`, `memory/YYYY-MM-DD.md`) alongside SQLite-backed memories. `POST /memories` now accepts the same `backend` and `fileKind=memory|user|daily` options as the CLI/tooling path.

Example route + inbox flow:

```json
POST /routes
{
  "cwd": "E:\\repo",
  "title": "Slack triage",
  "channelType": "slack",
  "channelKey": "C12345",
  "adapterType": "filesystem",
  "adapterConfig": {
    "outboxDir": "E:\\repo\\outbox",
    "dmPolicy": "open"
  },
  "inboundSecret": "route-secret"
}
```

```json
POST /inbox/messages
{
  "routeId": "<route-id>",
  "sender": "alice",
  "text": "Please inspect the repository from Slack.",
  "routeSecret": "route-secret"
}
```

Manual outbound relay:

```json
POST /routes/<route-id>/deliver
{
  "content": "Repository inspection complete."
}
```

## Current scope

- modular single-process layout
- SQLite-backed session store via `node:sqlite`
- local workspace inspection with change tracking
- built-in tool registry with workspace, task, browser, automation, and execution-governance primitives including `search_text`, `read_file`, `replace_file_range`, `run_command`, `create_sandbox`, and `create_worktree`
- basic approval policy
- interactive CLI approval prompts for risky operations
- resumable thread/run history
- iterative tool-calling runtime
- automatic verification and diff-summary capture
- real `worktree` execution isolation for git repositories
- real `sandbox` execution isolation via workspace copies
- persisted run execution metadata, full patch artifacts, and cleanup commands
- local extension manifests that register extra tools
- module-backed extensions with prompt hooks

P6 execution governance is now explicit instead of being only a path swap. The runtime keeps the source workspace on a full-control profile so it can provision managed environments, but execution roots are capability-scoped:

- `workspace`: `search`, `read`, `write`, `command`, `control`
- `worktree`: `search`, `read`, `write`, `command`
- `sandbox`: `search`, `read`, `write`, `command`

The capability model is also available for narrower custom profiles, so tool and workspace calls can be restricted down to search-only or read-only flows when needed. Control-plane operations such as `createWorktree`, `cleanupWorktree`, `createSandbox`, and `cleanupSandbox` are blocked unless the active workspace profile includes `control`.
The built-in tool registry exposes the same control-plane boundary through `create_sandbox`, `cleanup_sandbox`, `create_worktree`, and `cleanup_worktree`, so agents can request isolated execution roots without bypassing the capability model.
Approval classification also uses a dual model instead of raw tiers alone: every tool is tagged with an approval class (`readonly_scoped`, `readonly_search`, `mutating`, `exec_capable`, `control_plane`, `interactive`, `other`) plus a `riskTier`, so policies such as `never` can still allow scoped reads while denying shell or orchestration surfaces.
- extension resources and prompt templates with gateway/workbench access
- HTTP gateway mode for remote orchestration, run inspection, and cleanup
- persistent workspace/thread memories with built-in save/search tools
- structured learned skills distilled from verified runs, with reuse tracking and runtime recall
- persisted automations with interval/manual scheduling and CLI/API management
- realtime SSE event streaming for runs, jobs, memories, and automations
- async gateway jobs for background run execution
- channel routes and inbound inbox processing for multi-surface routing
- outbound deliveries with console, filesystem, webhook, telegram, slack, and discord adapters
- delivery retries with attempt tracking and delayed replay
- sender pairing and allowlist approval for sensitive direct-message routes
- gateway bearer-token auth plus route-scoped inbound secrets
- parallel gateway runs with shared batch ids
- automatic learning memories and learned-skill synthesis from verified code changes
- built-in `/app` workbench for local platform visibility
- CLI-managed gateway daemon lifecycle for long-running relay setups
- WebSocket control plane with live event replay and connected node registry
- OpenAI-compatible profile failover chains without runtime code changes
