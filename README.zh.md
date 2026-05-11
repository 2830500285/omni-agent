![Omni Agent banner](docs/assets/omni-agent-banner.png)

<p align="center">
  <a href="README.zh.md"><img alt="Docs" src="https://img.shields.io/badge/DOCS-README-22c55e?style=for-the-badge&labelColor=0b1f14"></a>
  <a href="#状态"><img alt="Status" src="https://img.shields.io/badge/STATUS-BETA-65a30d?style=for-the-badge&labelColor=0b1f14"></a>
  <a href="https://github.com/2830500285/omni-agent/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/2830500285/omni-agent/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=0b1f14&color=22c55e"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/LICENSE-MIT-84cc16?style=for-the-badge&labelColor=0b1f14"></a>
  <a href="docs/security.md"><img alt="Security" src="https://img.shields.io/badge/SECURITY-GOVERNED-059669?style=for-the-badge&labelColor=0b1f14"></a>
  <a href="examples/evals/suite.json"><img alt="Agent eval" src="https://img.shields.io/badge/AGENT_EVAL-REGRESSION-10b981?style=for-the-badge&labelColor=0b1f14"></a>
</p>

# Omni Agent

语言：[English](README.en.md) | [中文](README.zh.md)

**Omni Agent 是一个本地优先的仓库工作 Agent 运行时。** 它把编码 CLI、受治理的工具执行、持久记忆、子 Agent、网关和 eval 支撑的能力声明放在一起，让 Agent 能真正做事，同时留下可复查的证据链。

它面向重视验证的操作者：每一个重要能力都应该能对应到可运行命令、持久化 artifact、scorecard 条目或 release gate，而不是只停留在宣传式功能描述。

常用入口：[教程](docs/tutorial/README.zh.md) |
[Security](docs/security.md) |
[Operations](docs/operations.md) |
[Capability claims](docs/capability-backed-claims.md) |
[Genesis profile](docs/htx-genesis.md) |
[Release checklist](docs/release-checklist.md)

## 亮点

<table>
<tr><td><b>验证原生运行时</b></td><td>运行记录可以捕获工具调用、验证命令、diff 摘要、artifact 和 eval 证据，避免只靠无法验证的功能声明。</td></tr>
<tr><td><b>受治理的执行</b></td><td>workspace、worktree、sandbox 三种执行域都有能力边界。审批分类和风险等级会区分安全读取、写入、shell 命令和控制面操作。</td></tr>
<tr><td><b>本地编码工作流</b></td><td>通过 CLI 进行聊天式协作、一次性任务、线程恢复、上下文压缩、运行检查，并可要求验证命令通过后再接受结果。</td></tr>
<tr><td><b>记忆和学习技能</b></td><td>支持 SQLite 记忆、兼容 workspace 记忆文件、learned skills、候选技能提升、过期技能检查，以及重复模式的运行时召回。</td></tr>
<tr><td><b>子 Agent 和并行运行</b></td><td>可以协调隔离的工作流、收集 artifact，并通过 CLI 或 gateway 检查批量进度。</td></tr>
<tr><td><b>Gateway 和多通道</b></td><td>提供 HTTP、SSE、WebSocket 控制面，支持 routes、inbox messages、outbound deliveries、pairing、bearer-token auth，以及 filesystem、webhook、Telegram、Slack、Discord、Feishu、DingTalk、Teams 风格 relay。</td></tr>
<tr><td><b>灵活模型 Profile</b></td><td>支持 OpenAI 兼容和 Anthropic 风格模型 profile、failover chain、streaming、可用时的原生 tool calling，以及不可用时的 JSON-envelope fallback。</td></tr>
<tr><td><b>Eval 支撑成熟度</b></td><td>通过 manifest smoke test、synthetic benchmark、capability scorecard、maturity check、release diagnostics 和 CI gate，把公开能力绑定到可复现检查。</td></tr>
</table>

## 快速开始

已验证的本地基线：**Node.js 24** 和 **npm 11**。

```bash
git clone https://github.com/2830500285/omni-agent.git
cd omni-agent
npm install
npm run build
```

启动一个本地 workspace：

```bash
npm run dev -- onboard --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\\repo"
npm run dev -- chat --cwd "E:\\repo"
```

配置真实模型 profile：

```bash
npm run dev -- setup --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\\repo" --profile-id primary --protocol openai --base-url "https://api.openai.com/v1" --api-key-env OPENAI_API_KEY --model gpt-4.1-mini
```

运行一个带强制验证的一次性任务：

```bash
npm run dev -- run --cwd "E:\\repo" --task "Summarize this repository and list the riskiest files" --verify "npm run build"
```

启动本地 gateway：

```bash
npm run dev -- serve --cwd "E:\\repo" --port 4040 --gateway-token local-dev-token
```

然后打开 `http://localhost:4040/app?token=local-dev-token` 使用本地 workbench。

## 入门用法

CLI 是本地仓库工作的最快入口：

```bash
npm run dev -- chat --cwd "E:\\repo"                         # 交互式线程
npm run dev -- run --cwd "E:\\repo" --task "Fix the build"   # 一次性运行
npm run dev -- threads --cwd "E:\\repo"                      # 列出线程
npm run dev -- runs --thread-id <thread-id>                  # 检查运行历史
npm run dev -- show-run --run-id <run-id>                    # 查看单次运行
npm run dev -- compact-thread --thread-id <thread-id>        # 压缩旧上下文
npm run dev -- doctor --cwd "E:\\repo" --mode openai         # 诊断配置
npm run dev -- models                                        # 查看模型 profile
```

在 `chat` 中，常用 slash command 包括：

| 命令 | 用途 |
|------|------|
| `/help` | 显示可用聊天命令 |
| `/status` | 查看当前 workspace、mode、domain 和验证设置 |
| `/new` | 开启新线程 |
| `/threads` | 列出历史线程 |
| `/resume <thread-id>` | 恢复已保存线程 |
| `/model [profile-id\|auto]` | 切换模型 profile |
| `/mode <mock\|openai>` | 切换运行模式 |
| `/domain <workspace\|worktree\|sandbox>` | 选择执行隔离域 |
| `/verify [command]` | 增加验证命令 |
| `/verification-mode <required\|best-effort>` | 控制验证严格度 |
| `/compact [keep-messages]` | 压缩旧上下文 |
| `/usage` | 在可用时显示用量元数据 |

## CLI vs Gateway

Omni Agent 有两个实际入口：本地 CLI 适合直接操作仓库，gateway 适合自动化、多通道路由和远程检查。

| 操作 | CLI | Gateway |
|------|-----|---------|
| 开始工作 | `npm run dev -- chat --cwd "E:\\repo"` | `POST /runs` |
| 后台运行 | `npm run dev -- run --task "..."` | `POST /runs` async job events |
| 并行化 | `npm run dev -- run --execution-domain worktree` | `POST /parallel-runs` |
| 检查状态 | `threads`、`runs`、`show-run`、`usage` | `GET /threads`、`GET /runs`、`GET /events/history` |
| 记忆 | `memory-save`、`memory-search` | `GET /memories`、`POST /memories` |
| 学习技能 | `skills` | `GET /skills`、`GET /skills/maintenance` |
| 自动化 | `automation-create`、`automations`、`automation-run` | `GET /automations`、`POST /automations`、pause/resume/run endpoints |
| 多通道 | `route-create`、`routes`、`deliveries`、`pairing-approve` | `GET /routes`、`POST /routes`、`POST /inbox/messages`、`POST /pairings/approve` |
| 本地 UI | `serve` | `/app`、`/events`、`/ws` |

## 文档

| 目标 | 入口 |
|------|------|
| 从头理解系统 | [教程书](docs/tutorial/README.zh.md) |
| 理解项目主张 | [Omni Agent paradigms](docs/omni-agent-paradigms.md) |
| 在真实 workspace 中安全运行 | [Security guide](docs/security.md) |
| 操作 gateway 和本地 workbench | [Operations](docs/operations.md) |
| 验证公开能力声明 | [Capability-backed claims](docs/capability-backed-claims.md) |
| 理解运行证据 | [Agent run artifacts](docs/agent-run-artifacts.md) |
| 理解记忆行为 | [Accountable memory](docs/accountable-memory.md) |
| 理解子 Agent 边界 | [Governed subagents](docs/governed-subagents.md) |
| 谨慎测试真实集成 | [Live testing](docs/live-testing.md) |
| 带证据发布 | [Release checklist](docs/release-checklist.md) |
| 查看当前对比状态 | [Capability comparison](CAPABILITY_COMPARISON.md) |

## Genesis Profile

**Omni Agent Genesis** 是当前用于竞赛和演示的 HTX、Web3、B.AI 受保护工作流。它是一个可审计的金融 Agent workflow，不是自动交易机器人。

已实现的表面包括：

- HTX 行情读取、只读账户快照、订单预览、paper-only 订单记录。
- Web3 钱包读取、TRON 账户快照、TRC20 allowance 读取、合约风险报告、revoke/transfer 预览、本地交易模拟。
- B.AI provider 探测，以及在环境变量提供 key 后的 OpenAI 兼容 chat-completions 调用。
- 审批策略、金额上限、allowlist、eval manifest、maturity scorecard 和可回放 run artifact。

安全边界：

- 未启用真实 HTX 下单。
- 未启用钱包签名和交易广播。
- 未启用任意合约调用、杠杆、衍生品或提现。
- 如果未来加入真实执行，应放在已审计的 signer custody、显式审批策略、小额现货限制和执行后验证之后。

快速 Genesis 验证：

```bash
node ./scripts/run-tests.mjs tests/tools.test.ts tests/approvals.test.ts tests/evals.test.ts
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode synthetic --no-save
npm run maturity:check
npm run build
```

可选真实端点通过环境变量配置，例如 `BAI_API_KEY`、`OMNI_AGENT_BAI_BASE_URL`、`OMNI_AGENT_TRONSCAN_BASE_URL`、`OMNI_AGENT_TRON_FULL_NODE_URL` 和 `OMNI_AGENT_HTX_ACCOUNT_ENDPOINT`。不要把交易所私钥、钱包助记词或 signer 凭证放进 demo adapter。

## 安全模型

Omni Agent 设计为本地操作者控制，但它可以连接真实仓库、shell、gateway 和消息通道。每一条远程消息和每一次模型输出，在策略和验证通过之前都应视为不可信输入。

重要默认行为：

- 读取、写入、shell 执行和控制面动作会分别分类。
- `workspace`、`worktree`、`sandbox` 暴露不同的能力集合。
- 高风险动作可以要求显式审批。
- Gateway API 在一次性本地测试之外应使用 bearer-token auth。
- Route inbox 可以要求 route secret、pairing、sender allowlist 和 delivery retry policy。
- Financial Genesis adapter 默认只读、预览和 paper-only。

在暴露 gateway、连接真实消息通道或增加真实执行 adapter 之前，请先阅读 [Security](docs/security.md)。

## 模型 Profile

Omni Agent 可以在 mock 模式下运行，也可以使用已配置的模型 profile：

```bash
npm run dev -- models
npm run dev -- config
```

Failover 配置示例：

```powershell
$env:OMNI_AGENT_MODEL_PROFILES_JSON='[
  {"id":"primary","name":"Claude","protocol":"anthropic","baseUrl":"https://api.anthropic.com","apiKeyEnv":"ANTHROPIC_API_KEY","model":"claude-sonnet-4-5","supportsStreaming":true},
  {"id":"backup","name":"OpenAI","protocol":"openai","baseUrl":"https://api.openai.com/v1","apiKeyEnv":"OPENAI_API_KEY","model":"gpt-4.1-mini","supportsStreaming":true}
]'
```

常用环境变量：

- `OMNI_AGENT_BASE_URL`
- `OMNI_AGENT_API_KEY`
- `OMNI_AGENT_MODEL`
- `OMNI_AGENT_MODEL_PROTOCOL`
- `OMNI_AGENT_MODEL_PROFILES_JSON`
- `OMNI_AGENT_SUPPORTS_STREAMING`
- `OMNI_AGENT_SUPPORTS_TOOLS`
- `OMNI_AGENT_GATEWAY_TOKEN`

## Evals 和发布门禁

运行主要本地检查：

```bash
npm run typecheck
npm test
npm run eval:smoke
npm run eval:benchmark -- --manifest examples/evals/suite.json --mode synthetic --no-save
npm run maturity:check
npm run release:check
```

聚焦 eval：

```bash
npm run eval:benchmark -- --manifest examples/evals/verification-native-runtime.json --mode synthetic --no-save
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode synthetic --no-save
npm run eval:benchmark -- --manifest examples/evals/omni-workflows.json --mode synthetic --no-save
```

Capability scorecard 位于 [examples/evals/capability-scorecard.json](examples/evals/capability-scorecard.json)。

## 项目结构

```text
apps/
  cli/                  CLI、chat shell、daemon 命令、gateway 入口
  mobile-node/          轻量 node client 示例
  mobile-native/        native shell 占位
packages/
  core-runtime/         task loop、工具执行、验证、run metadata
  workspace/            workspace、worktree、sandbox、SSH、cloud backend
  model-client/         model profiles 和 provider transports
  tools/                内置工具和 Genesis adapters
  approvals/            审批策略和动作分类
  context/              上下文构建和压缩
  evals/                manifest-driven scoring
docs/                   安全、运维、教程、范式、发布文档
examples/evals/         benchmark manifests 和 scorecards
deploy/                 Dockerfile 和环境模板
tests/                  runtime、gateway、CLI、tools、evals、ops 覆盖
```

## 从源码开发

```bash
npm install
npm run typecheck
npm test
npm run build
```

常用开发命令：

```bash
npm run dev -- doctor --cwd "E:\\repo" --mode openai
npm run dev -- serve --cwd "E:\\repo" --port 4040 --gateway-token local-dev-token
npm run test:core
npm run test:gateway
npm run test:ops
```

Docker 和环境模板位于 [deploy](deploy/)。

## 状态

Omni Agent 目前是 beta 阶段的本地 Agent 运行时。核心仓库工作流、gateway、memory、learned skills、governed execution 和 eval 表面已经实现，但它仍应被视为面向操作者的工程系统，而不是开箱即用的消费者助手。

当前非目标：

- 它不是实时交易系统。
- 它不是钱包签名器。
- 它默认不是托管 SaaS。
- 它不会把 synthetic eval 分数当作真实模型解决同一任务的证明。

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。改动应保持小而明确，有证据支撑，并用最窄但有意义的验证命令覆盖。

提交改动前：

```bash
npm run typecheck
npm test
npm run build
```

## License

[MIT](LICENSE)
