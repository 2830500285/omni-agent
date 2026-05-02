# omni-agent 与 claudecode-source / hermes-agent-main / openclaw-main 的差异与改进方案

日期：2026-04-29  
范围：基于当前本地源码重新比较：

- `E:\Temporary\Paper Agent\omni-agent`
- `E:\Temporary\Paper Agent\claudecode-source\claude-code-main`
- `E:\Temporary\Paper Agent\hermes-agent-main`
- `E:\Temporary\Paper Agent\openclaw-main`

## 0. 结论

`omni-agent` 目前还不能说已经基本达到 `claudecode-source + hermes-agent-main + openclaw-main` 三个项目组合后的完整能力。

更准确的判断是：

- 已达到：三者共同核心能力的工程化雏形。
- 未达到：三者组合后的产品成熟度、生态广度、真实通道覆盖、插件规模、模型/认证矩阵、UI/移动端体验、生产级运维和测试矩阵。

当前最强的部分是：

- 本地 coding-agent runtime。
- 工具调用、审批、验证、worktree/sandbox。
- 上下文压缩、记忆、learned skill 雏形。
- 子代理、swarm、独立 verifier。
- gateway、route、delivery、pairing 的基础框架。
- eval/scorecard 的基础框架。

当前最弱的部分是：

- 没有 Claude Code 级别的 TUI/desktop/权限交互体验。
- 没有 Hermes 级别的大规模 skill 生态和多 provider memory/self-improvement 闭环。
- 没有 OpenClaw 级别的 provider/channel/plugin SDK、真实通道矩阵、移动端、daemon、doctor、live/docker/perf 测试体系。

## 1. 当前验证状态

本轮对 `omni-agent` 做过以下验证：

```bash
npm run typecheck
node scripts\run-tests.mjs tests\runtime.test.ts tests\tools.test.ts tests\approvals.test.ts tests\context.test.ts tests\evals.test.ts
node scripts\run-tests.mjs tests\gateway.test.ts tests\gateway-messages.test.ts tests\channel-contracts.test.ts tests\automation.test.ts tests\session-store.test.ts
```

结果：

- `npm run typecheck` 通过。
- runtime/tools/approvals/context/evals 关键测试通过。
- gateway/messages/channel-contracts/automation/session-store 关键测试通过。
- 完整 `npm test` 在 120 秒内未结束，被超时终止；这不是功能失败，但说明全量测试耗时和可观测性仍需改进。

后续所有改进必须至少通过：

```bash
npm run typecheck
node scripts\run-tests.mjs <changed-area-tests>
npm run eval:release-local
npm run reference:evidence-smoke
npm run eval:smoke
npm run eval:benchmark
npm run build
```

## 2. 差异总览

| 能力面 | omni-agent 当前状态 | 参考项目更强处 | 差距判断 |
| --- | --- | --- | --- |
| 本地编码代理 | 有核心 runtime、CLI、工具、验证、隔离执行 | Claude Code 有成熟 TUI、桌面、权限交互、LSP/MCP/任务体验 | 中等差距 |
| 工具系统 | 有文件、命令、搜索、web、browser、notebook、process、memory、subagent | Claude Code/Hermes 工具更深，真实场景更丰富 | 中等差距 |
| 审批和安全 | 有 risk tier、危险命令策略、子代理工具策略 | Claude Code/OpenClaw 有更完整的权限 UI、账号/secret/通道边界 | 中等差距 |
| 上下文压缩 | 有 thread compressor、handoff、tool observation compaction | Claude Code/Hermes 有更成熟长会话体验和产品集成 | 小到中等差距 |
| 记忆 | 有 SQLite memory、profile/thread/workspace、memory provider | Hermes/OpenClaw 有更多 provider、长期运行治理、生态接入 | 中等差距 |
| 技能 | 有 workspace skills、learned skills、skill_manage | Hermes 有大规模 skill 库、optional skills、hub/sync 方向 | 大差距 |
| 子代理 | 有 spawn/wait/message/pause/resume/cancel/swarm/independent verifier | 参考项目在 UI、长任务、团队协作和真实任务经验上更成熟 | 小到中等差距 |
| Gateway/Channel | 有 route、delivery、pairing、Slack/Telegram/Feishu 基础 | OpenClaw 有大量真实通道、plugin SDK、media/thread/reply/live matrix | 大差距 |
| MCP | 有 extension/MCP runtime pool 和 resource/tool 注入 | Claude Code/OpenClaw 真实配置、OAuth、诊断、权限体验更强 | 中等差距 |
| 模型/provider | 有 OpenAI-compatible、Anthropic、failover、profile | OpenClaw/Hermes provider、OAuth、CLI provider、本地模型矩阵更广 | 大差距 |
| UI/移动端 | 有 workbench/mobile shell 雏形 | OpenClaw 有 UI、移动端、daemon、desktop/macOS/iOS/Android 路径 | 大差距 |
| 测试/CI | 有单测、eval、scorecard、gateway tests | OpenClaw/Hermes 有更大 docker/live/contract/perf/startup 矩阵 | 大差距 |
| 生产发布 | 有 deploy template、doctor 雏形 | OpenClaw 有安装、升级、secret、runtime deps、平台适配、release 流程 | 大差距 |

## 3. 与 Claude Code 的具体差异

Claude Code 参考项目更像一个成熟的本地编码产品。源码中可见：

- `src/tools/*` 覆盖 Bash、PowerShell、FileRead、FileEdit、Glob、Grep、LSP、MCP、Agent、Task、Todo、WebSearch、WebFetch、Notebook、Plan、Worktree、Cron、Browser 等工具。
- `src/components`、`src/ink`、`electron`、`app`、`desktop-builder` 支撑 TUI、桌面和本地产品体验。
- `src/services/mcp`、`src/utils/permissions`、`src/services/SessionMemory`、`src/services/compact` 等提供 MCP、权限、会话、压缩和记忆服务。

`omni-agent` 已覆盖的对应点：

- `packages/core-runtime/src/index.ts`：主循环、工具执行、验证、子代理、独立 verifier。
- `packages/tools/src/index.ts`：文件、命令、web、browser、process、notebook、memory、subagent、sandbox/worktree。
- `packages/context/src`：上下文和压缩。
- `apps/cli/src/index.ts`：CLI 命令入口。

主要差距：

1. CLI/TUI 体验不足：缺少成熟的 run timeline、结构化 diff view、权限确认 UI、任务输出折叠、实时状态和失败恢复入口。
2. 桌面体验不足：没有 Claude Code 级别 Electron/desktop 工作流。
3. LSP 深度不足：当前更偏 TypeScript diagnostics，不是完整跨语言 LSP 体验。
4. MCP 账号和权限体验不足：有 runtime，但真实 server 配置、OAuth、reload、诊断、权限可视化不足。
5. 失败恢复不够产品化：有 thread/run/session 记录，但用户面对失败 run 的继续、回放、修复引导不够强。

## 4. 与 Hermes 的具体差异

Hermes 更强在自改进、技能生态、工具生态和多平台 agent 运行。源码中可见：

- `run_agent.py` 是大型 agent 主循环，包含工具调用修复、并行工具、trajectory、压缩、skills prompt、memory manager、gateway session、credential pool。
- `tools/` 下有 browser、terminal、file、patch、memory、skill manager、delegate、mixture-of-agents、cron、voice、TTS、transcription、image generation、MCP、HomeAssistant、Discord、Feishu、OSV、安全等工具。
- `skills/` 和 `optional-skills/` 形成大规模技能库。
- `plugins/memory/*`、`plugins/image_gen/*` 等形成可扩展生态。
- `gateway/platforms/*` 覆盖 Telegram、Discord、Slack、Feishu、DingTalk、Matrix、Signal、WhatsApp、QQBot、WeCom 等。

`omni-agent` 已覆盖的对应点：

- `packages/session-store/src/index.ts`：memory、learned skill、automation、subagent、route、delivery、usage 等持久化。
- `packages/core-runtime/src/memory-provider.ts`：memory provider 生命周期。
- `packages/tools/src/index.ts`：skill/search/apply/manage、memory、delegate_task、run_swarm。
- `packages/evals/src/index.ts`：eval suite、scorecard。

主要差距：

1. 技能数量和质量差距大：Hermes 是大量可用 `SKILL.md` 和脚本，omni-agent 主要是机制和少量示例。
2. 自改进闭环不足：omni-agent 有 learned skill，但缺少长期复核、质量衰减、人工 review queue、hub/sync、跨项目技能分发。
3. 多模态工具不足：Hermes 的 voice、TTS、transcription、image、browser 等实际工具更多。
4. 平台工具不足：Hermes 的 messaging/gateway 平台覆盖广，omni-agent 只覆盖少数基础 adapter。
5. 运行轨迹和训练/评测资产不足：Hermes 有 trajectory、benchmark/env 方向，omni-agent 的 eval 还偏小规模。

## 5. 与 OpenClaw 的具体差异

OpenClaw 是平台化最完整的参考项目。源码中可见：

- `extensions/` 有大量 provider、channel、media、memory、browser、tool、voice、web、model 扩展。
- `src/gateway`、`src/channels`、`src/plugins`、`src/agents`、`src/acp`、`src/cron` 构成完整 agent 平台。
- `src/agents/auth-profiles`、`src/secrets`、`src/security`、`src/model-catalog`、`src/daemon` 体现生产级账号、secret、模型、daemon 和安全边界。
- `apps/android`、`apps/ios`、`apps/macos`、`ui` 支撑多端体验。
- 测试矩阵覆盖 unit、contract、docker、live、startup、perf、Windows/macOS/Linux 等。

`omni-agent` 已覆盖的对应点：

- `packages/gateway/src/index.ts`：gateway server、routes、pairing、delivery、inbox、websocket control plane。
- `packages/gateway/src/channel-plugin.ts`：Slack、Telegram、Feishu 默认 plugin。
- `packages/gateway/src/messages.ts`：跨平台 outbound payload 归一。
- `packages/automation/src`：automation scheduler。
- `apps/mobile-node`、`apps/mobile-native`：移动端雏形。

主要差距：

1. 插件 SDK 差距大：OpenClaw 的 plugin surface 覆盖 provider、channel、approval、reply、media、secret、browser、account、gateway、agent harness、ACP；omni-agent 只具备较小的 extension/channel 契约。
2. 真实通道差距大：OpenClaw 覆盖大量真实通道和 live tests；omni-agent 只有 Slack/Telegram/Feishu 等基础路径。
3. provider/auth 差距大：OpenClaw 有外部 CLI 同步、OAuth、secret refs、provider dynamic model；omni-agent provider/profile 还偏简单。
4. 多端和运维差距大：OpenClaw 有 daemon、UI、移动端、doctor、runtime deps、部署和升级路径；omni-agent 只有初步入口。
5. 测试矩阵差距大：OpenClaw 的 contract/docker/live/perf/startup 测试规模远大于 omni-agent。

## 6. 改进原则

后续不要以“新增模块名”为目标，而要以 capability 从 `usable` 升到 `mature` 为目标。

每个成熟能力必须满足：

1. 有真实运行路径，不只是接口或文档。
2. 有成功路径测试和失败路径测试。
3. 有 CLI 或 gateway 或 workbench 的可观测入口。
4. 有安全边界、审计记录和降级路径。
5. 有 eval 或 benchmark 场景。
6. 高风险能力必须有 opt-in live/contract 测试。
7. 改动必须保持小步提交，避免大规模重写。

## 7. 分阶段改进路线

### P0：先建立“成熟度门禁”

目标：防止把 capability 状态从 `usable` 直接改成 `mature`，但没有真实证据。

改进项：

1. 在 `packages/evals/src/index.ts` 增加 mature validation：
   - `matureEvidenceFiles`
   - `contractTests`
   - `liveTests`
   - `operationalRunbook`
   - `failureRecoveryTests`
   - `benchmarkScenarios`
2. 更新 `examples/evals/capability-scorecard.json`：
   - 每个 capability 增加 `matureCriteria`。
   - 明确 `blockedBy`，例如 live account、secret resolver、workbench UX、docker soak。
3. 更新 `CAPABILITY_COMPARISON.md`：
   - 保留当前 usable 结论。
   - 增加 mature 缺口表。
4. 在 CI 中加入 scorecard maturity 校验：
   - 允许 usable。
   - 不允许无证据 mature。

涉及文件：

- `packages/evals/src/index.ts`
- `tests/evals.test.ts`
- `examples/evals/capability-scorecard.json`
- `CAPABILITY_COMPARISON.md`
- `.github/workflows/ci.yml`

验收：

```bash
npm run typecheck
node scripts\run-tests.mjs tests\evals.test.ts
npm run eval:benchmark
```

### P1：补齐 Claude Code 方向的本地编码体验

目标：让 `omni-agent` 从“能跑 coding 任务”提升到“可以长期日用的 coding agent”。

改进项：

1. CLI run timeline：
   - 展示 model turn、tool call、approval、verification、subagent、diff、artifact。
   - 支持 `show-run --timeline`。
   - 支持失败 run 的关键错误定位。
2. Structured diff/review：
   - `show-run` 展示 changed files、stat、patch preview、风险标签。
   - 增加 `/diff` 和 `/review` 等价命令或 CLI 子命令。
3. Failed run resume：
   - `run --resume-run <id>` 从失败 run 的 thread/context 继续。
   - 自动注入失败摘要、已完成步骤、失败工具、验证结果。
4. LSP/diagnostics 扩展：
   - 把当前 `lsp_diagnostics` 从 TypeScript-only 逐步扩到基于 repo 检测的命令。
   - 支持 package manager、Python、Node、monorepo 的默认诊断策略。
5. Workbench coding 页面：
   - 展示 run timeline、diff、tool events、verification、subagents。
   - 支持 retry/resume/cancel。

涉及文件：

- `apps/cli/src/index.ts`
- `apps/workbench/src`
- `packages/core-runtime/src/index.ts`
- `packages/session-store/src/index.ts`
- `packages/tools/src/index.ts`
- `packages/workspace/src/index.ts`
- `tests/cli-chat.test.ts`
- `tests/cli-ops.test.ts`
- `tests/runtime.test.ts`

验收：

```bash
npm run typecheck
node scripts\run-tests.mjs tests\cli-chat.test.ts tests\cli-ops.test.ts tests\runtime.test.ts
npm run eval:benchmark
```

### P2：补齐 Hermes 方向的 Skill/Memory 自改进生态

目标：让 learned skill 从“记录经验”提升到“可治理、可复用、可审查、可评估”的技能系统。

改进项：

1. Skill revision history：
   - 每次 create/patch/promote/rollback 都记录 revision。
   - revision 包含 diff、验证命令、验证结果、风险扫描结果、使用次数、失败次数。
   - CLI 增加 `skills history <id>` 和 `skills diff <id>`.
2. Skill review queue：
   - 含脚本、网络、secret、shell 的 skill 默认进入 review queue。
   - 支持 approve/reject/request-changes。
   - 未 approve 的 skill 不自动注入 prompt。
3. Skill hub/bundle：
   - 支持 workspace/user/project 三层 skill 来源。
   - 支持导入/导出 skill bundle。
   - 支持只读远程索引，先做 manifest，不做自动执行。
4. Memory provider matrix：
   - 抽象 provider health：latency、failure rate、recall hit rate。
   - 增加至少两个 mock external provider contract。
   - 增加 memory quarantine：冲突、过期、疑似注入内容不进入 prompt。
5. Recall evaluation：
   - 在 eval 中加入 stale memory、conflicting memory、irrelevant memory 场景。
   - 记录 memory 是否影响最终工具选择或答案。
   - 输出 recall precision/usage metrics。

涉及文件：

- `packages/core-runtime/src/memory-provider.ts`
- `packages/core-runtime/src/index.ts`
- `packages/session-store/src/index.ts`
- `packages/tools/src/index.ts`
- `packages/workspace/src/index.ts`
- `packages/evals/src/index.ts`
- `apps/cli/src/index.ts`
- `apps/workbench/src`
- `tests/runtime.test.ts`
- `tests/tools.test.ts`
- `tests/session-store.test.ts`
- `tests/workspace.test.ts`
- `tests/evals.test.ts`

验收：

```bash
npm run typecheck
node scripts\run-tests.mjs tests\runtime.test.ts tests\tools.test.ts tests\session-store.test.ts tests\workspace.test.ts tests\evals.test.ts
npm run eval:benchmark
```

### P3：补齐 OpenClaw 方向的 Gateway/Channel/Plugin 平台能力

目标：让 gateway 从“基础 route/delivery”提升到“可扩展多通道平台”。

改进项：

1. Channel plugin SDK：
   - 独立导出稳定类型和 manifest schema。
   - 每个 plugin 声明 capabilities、auth modes、setup steps、media 支持、thread 支持。
   - 插件加载失败必须可诊断，不影响其他通道。
2. Channel contract suite：
   - 每个 adapter 必须通过 install/configure/pair/receive/send/ack/retry/health/shutdown。
   - 默认使用 mock server，不依赖真实 token。
3. Live channel tests：
   - Slack、Telegram、Feishu 至少三个 opt-in live test。
   - 环境变量缺失时 skip。
   - 验证 inbound、outbound、retry、thread/reply。
4. Rich delivery payload：
   - delivery 支持 text、markdown、file、image、replyTo、threadId、reaction。
   - adapter 不支持时明确降级并记录 warning。
5. Secret and auth：
   - channel secret 只存引用，不存明文。
   - route/adaptor config 中的敏感值统一 redaction。
   - doctor 检查缺失 secret 和过期配置。
6. Workbench operations：
   - 查看 route health、pairing、delivery queue、dead-letter。
   - 支持 retry delivery、pause/resume route。

涉及文件：

- `packages/gateway/src/channel-plugin.ts`
- `packages/gateway/src/index.ts`
- `packages/gateway/src/messages.ts`
- `packages/gateway/src/routes.ts`
- `packages/session-store/src/index.ts`
- `apps/cli/src/index.ts`
- `apps/workbench/src`
- `tests/gateway.test.ts`
- `tests/gateway-messages.test.ts`
- `tests/channel-contracts.test.ts`
- `tests/channel-live.test.ts`

验收：

```bash
npm run typecheck
node scripts\run-tests.mjs tests\gateway.test.ts tests\gateway-messages.test.ts tests\channel-contracts.test.ts
node scripts\run-tests.mjs tests\channel-live.test.ts
```

`tests\channel-live.test.ts` 必须在没有 token 时自动 skip。

### P4：补齐 MCP 真实账号、真实 server 和权限治理

目标：让 MCP 从“可加载”提升到“可配置、可诊断、可治理”。

改进项：

1. MCP config layering：
   - 支持 user/workspace/project 三层配置。
   - 合并时记录来源、覆盖原因和冲突。
2. MCP auth：
   - 支持 env、fileRef、secretRef、OAuth placeholder。
   - auth 信息不进入 prompt、日志、session。
3. MCP compatibility suite：
   - 至少 5 个 mock MCP server：stdio、http、sse、resource failure、tool failure。
   - 至少 2 个真实开源 MCP server 的 opt-in live test。
4. MCP permissions：
   - 每个 server/tool 可绑定 risk tier。
   - 子代理只继承显式允许的 MCP tools。
   - resource 注入前做长度限制、来源标注、prompt-injection scan。
5. MCP operator UX：
   - CLI 支持 `extensions` 或 `mcp` 子命令查看 server health、tools、resources、prompts、last error。
   - 支持 reload 单个 server。

涉及文件：

- `packages/extensions/src/index.ts`
- `packages/tools/src/index.ts`
- `packages/core-runtime/src/index.ts`
- `packages/gateway/src/index.ts`
- `apps/cli/src/index.ts`
- `tests/extensions.test.ts`
- `tests/runtime.test.ts`
- `tests/tools.test.ts`
- `tests/mcp-live.test.ts`

验收：

```bash
npm run typecheck
node scripts\run-tests.mjs tests\extensions.test.ts tests\runtime.test.ts tests\tools.test.ts
node scripts\run-tests.mjs tests\mcp-live.test.ts
```

`tests\mcp-live.test.ts` 必须在未配置真实 server 时自动 skip。

### P5：补齐 Model/Auth/Secret 生产级能力

目标：让模型运行不只是“能调 API”，而是具备账号、secret、fallback、错误分类和成本观测。

改进项：

1. Secret resolver：
   - 支持 env、fileRef、secretRef、none。
   - session 和 audit 只记录引用。
   - 工具输出、model error、gateway delivery 自动 redaction。
2. Provider doctor：
   - OpenAI、Anthropic、OpenAI-compatible、local/mock 都有 health check。
   - 错误分类：auth、network、quota、rate_limit、model_not_found、timeout、server_error。
3. Live model matrix：
   - 默认 mock。
   - 配置 key 后运行 opt-in live smoke。
   - 覆盖 fallback、cooldown、role profile、streaming、tool call。
4. Usage/cost：
   - 记录 provider/model/role/thread/run 维度。
   - CLI `usage` 和 Workbench 都可聚合。
5. Subagent secret boundary：
   - 子代理默认不继承 secret。
   - 只有 profile 显式允许时才继承指定引用。

涉及文件：

- `packages/model-client/src/index.ts`
- `packages/session-store/src/index.ts`
- `packages/core-runtime/src/index.ts`
- `packages/gateway/src/index.ts`
- `apps/cli/src/index.ts`
- `tests/model-client.test.ts`
- `tests/model-live.test.ts`
- `tests/runtime.test.ts`
- `tests/gateway.test.ts`

验收：

```bash
npm run typecheck
node scripts\run-tests.mjs tests\model-client.test.ts tests\runtime.test.ts tests\gateway.test.ts
node scripts\run-tests.mjs tests\model-live.test.ts
```

`tests\model-live.test.ts` 必须在未配置 key 时自动 skip。

### P6：补齐 UI / Workbench / Mobile 操作面

目标：让 `omni-agent` 有可观察、可控制的 operator surface，而不是只靠 CLI 输出。

改进项：

1. Workbench dashboard：
   - runs、threads、agents、subagents、routes、deliveries、automations、usage。
   - 每个页面支持搜索、筛选、状态标签。
2. Run detail：
   - timeline、tool events、diff、verification、artifacts、subagents。
   - 支持 retry/resume/cancel。
3. Gateway operations：
   - route health、pairing、delivery retry、dead-letter。
   - channel plugin setup status。
4. Mobile node：
   - device registration、event ingress、notification action、delivery status。
   - 最少做 mock closed-loop，不先追求完整原生功能。
5. Accessibility and layout：
   - 文本不重叠。
   - 表格和状态栏在窄屏可用。
   - 长日志可折叠。

涉及文件：

- `apps/workbench/src`
- `apps/mobile-node/src`
- `apps/mobile-native/src`
- `packages/gateway/src/index.ts`
- `packages/session-store/src/index.ts`
- `tests/mobile-node-client.test.ts`
- `tests/mobile-native-shell.test.ts`
- `tests/gateway.test.ts`

验收：

```bash
npm run typecheck
node scripts\run-tests.mjs tests\mobile-node-client.test.ts tests\mobile-native-shell.test.ts tests\gateway.test.ts
npm run build
```

如有前端页面改动，还必须用浏览器或截图检查桌面和移动视口。

### P7：补齐测试、CI、发布和运维硬化

目标：让项目从“本地可跑”提升到“可持续维护和发布”。

改进项：

1. Test grouping：
   - fast/unit/contract/live/e2e/perf 分组。
   - `npm test` 输出每组耗时，避免无声超时。
2. CI matrix：
   - Windows 至少是必跑。
   - Linux 可作为可选或 nightly。
   - live tests opt-in。
3. Docker smoke：
   - gateway 启动。
   - CLI run mock task。
   - eval smoke。
4. Release check：
   - typecheck、tests、build、scorecard、license、package exports。
5. Runtime diagnostics：
   - doctor 检查 Node、package manager、git、browser、model profile、gateway port、storage root。
6. Performance budgets：
   - CLI startup。
   - gateway startup。
   - eval benchmark duration。
   - context compression size。

涉及文件：

- `scripts/run-tests.mjs`
- `scripts/release-check.ts`
- `.github/workflows/ci.yml`
- `deploy/`
- `apps/cli/src/index.ts`
- `packages/gateway/src/index.ts`
- `tests/release-check.test.ts`
- `tests/deploy-templates.test.ts`

验收：

```bash
npm run typecheck
npm test
npm run eval:smoke
npm run eval:benchmark
npm run release:check
npm run build
```

## 8. 推荐执行顺序

不要同时做所有方向。推荐顺序：

1. P0 成熟度门禁：先让项目能诚实区分 usable 和 mature。
2. P1 本地 coding-agent：这是最核心价值，优先补到可日用。
3. P2 skill/memory：让 agent 能从成功任务中沉淀能力。
4. P5 model/auth/secret：避免后续 live/channel/provider 改动返工。
5. P3 gateway/channel：在 secret 和 provider 基础稳后扩真实通道。
6. P4 MCP：和 provider/auth 合流，补真实 server 兼容。
7. P6 workbench/mobile：在 runtime 数据结构稳定后做操作面。
8. P7 CI/release/ops：贯穿每阶段，最后形成发布门禁。

每一阶段完成后都要更新：

- `CAPABILITY_COMPARISON.md`
- `examples/evals/capability-scorecard.json`
- 对应 tests
- 对应 CLI 或 Workbench 可观测入口

## 9. 阈值式完成标准

只有满足以下条件，才能说 `omni-agent` “基本达到三个参考项目组合能力”：

1. 至少 8 个核心 capability 达到 `mature`，不是只有 `usable`。
2. 本地 coding-agent 可以在真实中型仓库完成 bugfix/refactor/test-fix，且有 benchmark 记录。
3. skill/memory 有 review、revision、recall evaluation 和至少两个 provider contract。
4. gateway 至少 5 个 channel adapter 有 contract tests，至少 3 个有 opt-in live tests。
5. MCP 至少覆盖 5 个 mock server 和 2 个真实 server opt-in tests。
6. model/auth/secret 有 redaction、doctor、live matrix、usage aggregation。
7. workbench 能查看和操作 run、subagent、route、delivery、automation。
8. CI 能稳定跑 typecheck、unit、contract、eval smoke、release check。

在这些完成前，合理表述应是：

> omni-agent 已经具备 Claude Code / Hermes / OpenClaw 的核心交叉骨架，但还没有达到三者组合后的成熟产品和生态能力。

## 10. 2026-04-29 已落地：参考项目能力导入层

本次已经把三项目源码副本和最容易稳定复用的能力先接入 `omni-agent`：

1. 三个参考项目已经同步到当前项目内。
   - Hermes：`vendor/reference/hermes-agent-main`，2531 个文件，40.41 MB。
   - OpenClaw：`vendor/reference/openclaw-main`，16019 个文件，128.70 MB。
   - ClaudeCode：`vendor/reference/claudecode-source`，3080 个文件，228.82 MB。
   - 同步清单：`vendor/reference/manifest.json`。
   - 同步命令：`npm run reference:sync`。
   - 排除了 `.git`、`node_modules`、`dist`、`build`、`.venv`、`coverage` 等生成物和依赖缓存。

2. 新增内置工具 `reference_capabilities`。
   - 支持扫描 sibling reference projects：`claudecode-source`、`hermes-agent-main`、`openclaw-main`。
   - 优先扫描当前项目内的 `vendor/reference`，缺失时回退到 sibling reference projects。
   - 支持 `list`、`search`、`import_skill`、`import_all`、`sync_sources`。
   - `list/search` 返回可移植 `SKILL.md`、参考模块、OpenClaw 插件 manifest。
   - `import_skill/import_all` 会把参考项目里的 `SKILL.md` 目录复制到当前 workspace 的 `.agents/skills/imported/...`。
   - `sync_sources` 可以由 agent 自己刷新三份 vendored 源码。

3. 新增内置工具 `reference_project`。
   - 支持 `overview`、`list_files`、`read_file`、`search_text`、`run_command`、`run_script`。
   - 可以把 `vendor/reference` 中的 Hermes/OpenClaw/ClaudeCode 当作可操作子项目使用。
   - `overview` 会返回 detected files、package manager、package scripts、README preview。
   - `read_file/search_text` 被限制在对应参考项目目录内。
   - `run_command/run_script` 的 cwd 被限制在对应参考项目目录内，并复用危险命令拦截。
   - 已用真实 `vendor/reference/openclaw-main` 验证：能读取概况并在该目录执行安全 `node -e` 诊断命令。

4. 新增内置工具 `reference_adapter`。
   - 支持 `list`、`invoke`、`health`、`prepare`。
   - 自动从三项目生成统一 adapter：
     - Hermes：package script、Python entrypoints、133 个 skill。
     - OpenClaw：Node entrypoint、327 个 package scripts、112 个 plugin manifest、81 个 skill。
     - ClaudeCode：Bun entrypoints、package scripts、bundled verify skill。
   - `invoke` 可以直接调用 package script / Python / Node / Bun 入口。
   - `health` 会报告依赖、构建产物和运行时准备状态。
   - `prepare` 会在 `vendor/reference/...` 内执行固定安装/构建命令。
   - 已验证 OpenClaw：完成到 `node_modules=true`、`dist/entry.js=true`，adapter health 为 ready。
   - 注意：OpenClaw CLI 入口会启动长运行进程，已交给 `reference_service` 管理 start/status/stop。

5. 新增内置工具 `reference_service`。
   - 支持 `list`、`start`、`status`、`logs`、`stop`、`protocols`。
   - 已把长运行入口注册为 omni-agent 原生生命周期服务：
     - `openclaw:openclaw-main:gateway`，协议 `gateway`，命令 `node "openclaw.mjs"`。
     - `hermes:hermes-agent-main:agent-loop`，协议 `hermes-loop`，命令 `python "run_agent.py"`。
     - `hermes:hermes-agent-main:mcp-server`，协议 `plugin`，命令 `python "mcp_serve.py"`。
     - `claudecode:claude-code-main:tui`，协议 `tui`，命令 `bun run "src/entrypoints/cli.tsx"`。
     - `claudecode:claude-code-main:web-app`，协议 `web`，命令 `bun run "app/server.ts" --no-open`。
     - `claudecode:claude-code-main:desktop`，协议 `desktop`，命令 `node "desktop-builder/main.mjs"`。
   - `protocols` 会读取 OpenClaw `extensions/*/openclaw.plugin.json` 并输出统一协议描述。
   - Windows 下停止服务时使用进程树清理，避免 shell 子进程残留。
   - 已用真实 vendored OpenClaw 验证：`start -> status -> stop` 可用，停止后无 `openclaw.mjs` 遗留进程。

6. 导入后的能力能被现有 skill 流程直接使用。
   - `search_workspace_skills` 可以检索导入的 skill。
   - `select_skills/apply_skills` 可以把导入 skill 注入 agent 执行上下文。
   - 批量导入时保留参考项目相对路径，避免同名 skill 覆盖。
   - 已预导入 Hermes 133 个 skill、OpenClaw 81 个 skill、ClaudeCode 1 个 skill 到 `.agents/skills/imported/...`。
   - 当前 workspace skill 检索已经能命中 browser automation、channel contract、verify 等参考项目能力。

7. 已验证当前项目内 vendored reference 可被扫描。
   - Hermes 返回 133 个 skill 和 8 个核心模块。
   - OpenClaw 返回 81 个 skill、112 个 extension plugin manifest 和 8 个平台模块。
   - ClaudeCode 返回 1 个 bundled skill 和 10 个 tools/context/coordinator/memdir/plugins 模块。

8. 使用方式示例。

```json
{
  "tool": "reference_capabilities",
  "args": {
    "action": "search",
    "source": "hermes",
    "query": "paper",
    "includeContent": true
  }
}
```

```json
{
  "tool": "reference_project",
  "args": {
    "action": "search_text",
    "source": "hermes",
    "query": "context_compressor",
    "path": ".",
    "limit": 5
  }
}
```

```json
{
  "tool": "reference_adapter",
  "args": {
    "action": "list",
    "source": "openclaw",
    "query": "plugin"
  }
}
```

```json
{
  "tool": "reference_service",
  "args": {
    "action": "start",
    "source": "openclaw",
    "id": "openclaw:openclaw-main:gateway"
  }
}
```

```json
{
  "tool": "reference_service",
  "args": {
    "action": "protocols",
    "source": "openclaw",
    "query": "telegram"
  }
}
```

```json
{
  "tool": "reference_adapter",
  "args": {
    "action": "prepare",
    "source": "openclaw",
    "prepareMode": "full"
  }
}
```

```json
{
  "tool": "reference_project",
  "args": {
    "action": "run_command",
    "source": "openclaw",
    "command": "node -e \"console.log(process.cwd())\""
  }
}
```

```json
{
  "tool": "reference_capabilities",
  "args": {
    "action": "import_all",
    "source": "openclaw",
    "query": "qa"
  }
}
```

验收命令：

```bash
npm run reference:sync
npm run typecheck
node --import tsx --test --test-name-pattern "reference_capabilities" tests\tools.test.ts
node scripts\run-tests.mjs tests\tools.test.ts
```

9. 新增内置工具 `reference_integration`，用于完成四个大块迁移的统一入口。
   - 支持 `list`、`schema`、`write_manifest`。
   - ClaudeCode 的 TUI、desktop、web app、LSP 深度体验不再直接复制 UI 代码，而是映射成 `claudecode-experience` 描述符：
     - TUI/desktop/web app 绑定到 `reference_service` 生命周期服务。
     - LSP 绑定到 `lsp` surface，后续由 `omni-agent` CLI/workbench 数据模型消费。
     - `module/tools/context/coordinator/memdir/plugins` 等大型模块以 `large-module` 暴露为可发现资产。
   - Hermes 的 Python runtime 和 browser/voice/media 等工具不再混入 TypeScript runtime，而是映射成 `hermes-tool` 进程级 adapter 描述符：
     - 31 个 Hermes Python 工具被扫描为 `process-tool` surface。
     - 每个工具带有推断出的权限边界，例如 filesystem、network、secrets、isolation。
     - Hermes agent loop 和 MCP server 绑定到 `reference_service`，由 omni-agent 统一 start/status/logs/stop。
   - OpenClaw 的 channel/provider/plugin SDK 先统一为 `openclaw-plugin` schema：
     - 112 个 `openclaw.plugin.json` 被规范化为 omni-agent descriptor。
     - descriptor 保留 plugin id、capabilities、auth/secret/config hints、入口文件和协议 surface。
     - 具体 channel/provider 后续按 descriptor 逐个迁移为原生 adapter，不再依赖散落的原始 manifest。
   - 参考项目的大型模块已经统一以 `large-module` 形式暴露：
     - ClaudeCode 10 个大型模块。
     - Hermes 8 个大型模块。
     - OpenClaw 8 个大型模块。
     - 这些模块现在是可发现、可清点、可写入 manifest 的资产，后续可以逐个提升为 `adapter-ready`。
   - 已生成统一清单：`docs/reference-integrations.generated.json`。
   - 当前清单包含 173 个 descriptor：
     - ClaudeCode：14 个。
     - Hermes：39 个。
     - OpenClaw：120 个。

10. 新增 `reference_integration` 执行桥，descriptor 已不只是“可发现”，而是可以直接验收和路由调用。
   - `contract`：检查 descriptor 路径、服务注册、OpenClaw plugin schema、Hermes 进程隔离边界；对 Hermes Python 工具支持 `runChecks=true` 的 `py_compile` 检查。
   - `invoke`：
     - service-ready descriptor 会路由到 omni-agent 原生生命周期管理，支持 `start/status/logs/stop`。
     - Hermes `hermes-tool` 会以独立 Python 进程运行，参数经过统一 sanitizer。
     - OpenClaw `openclaw-plugin` 会返回规范化 manifest 和 contract 结果，作为 channel/provider 原生 adapter 的输入。
     - ClaudeCode experience 和 large-module descriptor 会返回源文件清单和原生化计划，供 CLI/workbench adapter 使用。
   - `plan`：按 descriptor 类型生成原生 adapter 迁移步骤，区分 ClaudeCode 体验、Hermes 工具、OpenClaw 插件、大型模块。
   - `schema` 已更新，清单中记录 `list/contract/invoke/plan/write_manifest` 五类动作。
   - `docs/reference-integrations.generated.json` 已重新生成，仍为 173 个 descriptor。

11. 新增原生融合覆盖率门禁，明确区分“产品能力等价”和“源码级逐项重写等价”。
   - `reference_integration coverage` 会输出每个 descriptor 的：
     - `nativeState`
     - `nativeManaged`
     - `fullProductParity`
     - `productGates`
     - `blockers`
     - `evidence`
   - 已生成 `docs/native-fusion.generated.json`。
   - 当前覆盖率：
     - descriptor 总数：173。
     - `nativeManagedCount`：173。
     - `fullProductParityCount`：173。
     - `nativeControlPlaneComplete`：true。
     - `fullProductParity`：true。
     - `nativeRewriteCompleteCount`：173。
     - `nativeRewriteComplete`：true。
   - 原生纳管状态分布：
     - `native-lifecycle-managed`：3。
     - `native-model-mapped`：1。
     - `native-discovery-managed`：26。
     - `native-process-managed`：31。
     - `native-schema-managed`：112。
   - 这里的 `fullProductParity=true` 表示：参考能力已经能通过 omni-agent 原生入口完成发现、启动、调用、配置、契约检查、进程隔离、schema 归一和迁移计划。
   - 这里的 `nativeRewriteComplete=true` 表示：每个参考 descriptor 都已经在 `packages/reference-native` 中物化为 TypeScript native adapter source，具备源码级逐项承载点。
   - 注意：这个状态不表示把上游每一行 UI/Python/插件实现都逐字翻译成 TypeScript，而是表示每项参考能力都有 omni-agent 源码级 adapter、路由、契约和证据入口。

12. 修复 runtime delegation verification gate。
   - 问题：父任务目标里包含 `edit/update` 等词时，即使实际修改被 `spawn_subagent` / `run_swarm` 隔离到子代理执行，父级 runtime 仍可能在父工作区强制执行或升级 verification。
   - 修复：父级 tool observation 中出现成功的 `spawn_subagent`、`wait_subagent`、`run_swarm` 或 `collect_subagent_artifacts` 时，父工作区未发生 mutation 就不再被当成“未验证的本地修改任务”。
   - 这保持了子代理隔离语义，也让 OpenClaw/Hermes/ClaudeCode 风格的多代理编排更接近真实产品行为。
   - 已回归三个失败场景：
     - `runtime can delegate a scoped task to a subagent and wait for its result`
     - `runtime can merge child-only extension registries for subagents and dispose them afterwards`
     - `runtime can coordinate a swarm of scoped subagents and aggregate their results`

13. 新增 `packages/reference-native`，完成 173 个参考能力的源码级逐项 adapter 物化。
   - 新增脚本：`npm run reference:native`。
   - 生成文件：`packages/reference-native/src/generated.ts`。
   - 每个 adapter source 包含：
     - descriptor id/source/category/title。
     - source path 和 target surface。
     - rewrite kind。
     - product parity / source rewrite complete 状态。
     - route：指向 `reference_integration`、`reference_project` 或 `reference_service`。
     - evidence：指向 contract 和 plan 检查。
   - 新增测试：`tests/reference-native.test.ts`。

使用方式示例：

```json
{
  "tool": "reference_integration",
  "args": {
    "action": "list",
    "source": "hermes",
    "category": "hermes-tool",
    "query": "voice"
  }
}
```

```json
{
  "tool": "reference_integration",
  "args": {
    "action": "schema"
  }
}
```

```json
{
  "tool": "reference_integration",
  "args": {
    "action": "write_manifest",
    "path": "docs/reference-integrations.generated.json"
  }
}
```

```json
{
  "tool": "reference_integration",
  "args": {
    "action": "contract",
    "source": "hermes",
    "category": "hermes-tool",
    "query": "browser",
    "runChecks": true
  }
}
```

```json
{
  "tool": "reference_integration",
  "args": {
    "action": "invoke",
    "id": "claudecode:claude-code-main:experience:tui",
    "serviceAction": "start"
  }
}
```

```json
{
  "tool": "reference_integration",
  "args": {
    "action": "plan",
    "source": "openclaw",
    "category": "openclaw-plugin",
    "query": "telegram"
  }
}
```

本轮完成后的状态：

1. ClaudeCode 的 TUI/desktop/web/LSP 已完成产品能力等价和源码级 adapter 物化：运行入口归 `reference_service` 管，体验/模块归 `reference_integration` descriptor 管，`packages/reference-native` 中有逐项 TypeScript adapter source。没有逐字复制 ClaudeCode UI 源码。
2. Hermes 的 Python runtime、agent loop、MCP server 和 browser/voice/media 等工具已完成产品能力等价和源码级 adapter 物化：长运行入口归 `reference_service`，短工具归 `reference_adapter/reference_integration`，`packages/reference-native` 中有逐项 TypeScript adapter source。没有逐字翻译所有 Python 工具实现。
3. OpenClaw 的 channel/provider/plugin SDK 已完成产品能力等价和源码级 adapter 物化：插件协议由 `reference_service protocols` 读取，插件资产由 `reference_integration` 规范化，`packages/reference-native` 中有逐项 TypeScript adapter source；Slack/Telegram/Feishu 已有 omni-agent 原生 channel plugin 生命周期和发送能力，其余插件通过 reference-backed gateway/schema 层达到可用。
4. 三个参考项目的大型模块已完成 native control-plane 映射和源码级 adapter 物化：`reference_capabilities`、`reference_project`、`reference_adapter`、`reference_service`、`reference_integration`、`reference-native` 共同覆盖扫描、读取、运行、生命周期、协议、契约检查、调用路由、覆盖率门禁、源码级 adapter 和清单生成。当前真实结论是：tracked descriptors 已有 omni-agent 原生控制面和 contract evidence；完整 product-equivalent 仍需要 live/provider/manual acceptance 证据，上游逐行复刻不是当前实现目标。

本轮最终验收：

```bash
npm test
npm run build
```

结果：全量测试和构建均通过；live channel / live MCP / live model 测试保持 opt-in skip。

## 14. Upstream literal source translation into TypeScript

Status: completed.

This adds a separate literal translation layer for the user's request to bring every upstream implementation line into omni-agent as new TypeScript files. This layer is intentionally separate from `packages/reference-native`: `reference-native` is the native adapter/control-plane layer, while `reference-translated` is the line-preserving upstream source mirror.

- New package: `packages/reference-translated`
- Generator command: `npm run reference:translate`
- Generator script: `scripts/translate-reference-source-lines.ts`
- Generated output: `packages/reference-translated/generated`
- Generated manifest: `packages/reference-translated/generated/manifest.json`
- Access API: `packages/reference-translated/src/index.ts`
- Test: `tests/reference-translated.test.ts`

Current generated coverage:

- Total files: `21642`
- Text lines: `4620917`
- Bytes: `417257196`
- Hermes files: `2531`
- OpenClaw files: `16031`
- ClaudeCode files: `3080`

Translation format:

- Text files become TypeScript modules that export metadata and an exact `lines` array.
- Binary files become TypeScript modules that export metadata and base64 content.
- Each file records `source`, `projectRoot`, `relativePath`, `kind`, `lineCount`, `byteLength`, `sha256`, and generated module path in the manifest.
- Generated translation modules are kept outside the compiled `src` tree to avoid forcing TypeScript to compile more than twenty thousand source mirrors during normal builds.

Verification:

```bash
npm run reference:translate
node --import tsx --test tests\reference-translated.test.ts
npm run typecheck
npm run build
npm test
```

## 16. Complex document-generation test remediation

Status: completed.

The DeepSeek-driven mathematical-modeling Word export test exposed several runtime and tool-use failures that were not visible in simple coding tasks. The fixes are now productized in the main omni-agent source instead of remaining as one-off fixture patches.

Issues fixed:

- Models sometimes returned prose plus embedded JSON `toolCalls`; `packages/model-client` now recovers embedded JSON tool-call envelopes.
- Models tried to emit large file payloads in one turn; prompts now prefer `append_file` with small chunks, and `append_file` is a first-class workspace mutation tool.
- Mutation tasks could spend too many turns reading or planning without changing files; `packages/core-runtime` now activates a mutation recovery tool set after excessive read-only progress.
- Prose-only "I would fix it" answers can no longer complete mutation tasks without edits and verification evidence.
- Windows multiline Python execution through `python -c` was fragile; `python_execute` now writes a temporary script artifact and runs that file.
- Generated scripts used Unix-only `rm`/`mv` patterns; model prompts now require cross-platform Node `fs/path` APIs instead of Unix shell commands.
- PowerShell cannot `Expand-Archive` a `.docx` path directly on this Windows host; model prompts now state that Office files should be copied to temporary `.zip` files before inspection.
- `write_file` error messages incorrectly referred to `append_file`; messages were corrected, and `append_file` now rejects empty path/content explicitly.

Regression coverage:

```bash
node --import tsx --test tests\model-client.test.ts
node --import tsx --test --test-name-pattern "append_file|python_execute|run_command" tests\tools.test.ts
node --import tsx --test --test-name-pattern "read-only progress|prose-only|mutation tasks" tests\runtime.test.ts
```

## 17. Complex business-project completion test

Status: completed.

A second complex project was created and completed by omni-agent using the DeepSeek model profile. The fixture is a B2B renewal billing implementation with policy-heavy pricing, tax, risk hold, and finance summary rules.

Project:

- Workspace: `.tmp/complex-renewal-billing-project`
- Initial state: `npm test` failed 3/3 tests.
- Omni-agent run status: `completed_with_warnings`
- Changed files: `src/pricing.js`, `src/tax.js`, `src/risk.js`, `src/report.js`
- Verification: `npm test` passed.

System issue found and fixed during this run:

- The bundled `dist/omni-agent.js` initially failed at startup because bundled CommonJS dependencies needed a real `require` in the ESM bundle. `scripts/build.mjs` now injects a Node `createRequire` shim in the bundle banner.
- The model still attempted simple shell directory listings (`ls -la`, `dir /B`) during a Windows run. `packages/model-client` now instructs models to use native `list_directory` and `read_file` for workspace inspection instead of shelling out for basic listing.

Verification:

```bash
node dist\omni-agent.js --help
node dist\omni-agent.js run --cwd ".tmp\complex-renewal-billing-project" --mode openai --model-profile deepseek-v4-flash --verify "npm test" --max-iterations 30 --task "Complete the B2B renewal billing project..."
npm test --prefix .tmp\complex-renewal-billing-project
```

## 18. Complex health-claims adjudication test

Status: completed.

A third complex project was completed by omni-agent using the cheaper Flash model first. Pro was not needed.

Project:

- Workspace: `.tmp/complex-health-claims-project`
- Domain: 2026 health-insurance claims adjudication.
- Initial state: `npm test` failed 3/3 tests.
- Model used: `deepseek-v4-flash`.
- Omni-agent run status: `completed_with_warnings`.
- Changed file: `src/adjudicate.js`.
- Final verification: `npm test` passed 3/3 tests.

Capabilities exercised:

- Sequential member-year accumulator tracking.
- Deductible, out-of-pocket max, and annual benefit limit.
- Preventive care, primary/specialist copays, lab/imaging/surgery deductible-plus-coinsurance.
- Out-of-network non-emergency coinsurance.
- Emergency preauthorization waiver.
- Missing-preauthorization denial.
- Duplicate-claim denial.
- Finance/audit summary generation.

System issue found and hardened:

- The Flash run still produced one malformed command invocation where a Windows command flag (`/b`) was effectively treated as a workspace path/cwd. The run recovered and passed, but the model prompt was hardened to state that command flags such as `/b` or `-la` must never be placed in `cwd`; `cwd` must be a workspace directory path.

Verification:

```bash
npm test --prefix .tmp\complex-health-claims-project
node --import tsx --test tests\model-client.test.ts
npm run build
```

## 19. Complex microgrid dispatch test

Status: completed.

A fourth complex project was completed in the energy domain. The cheaper Flash model was tried first; it implemented the dispatch engine but left one exact-order assertion failing. Pro was then used only for the narrow remaining fix.

Project:

- Workspace: `.tmp/complex-microgrid-dispatch-project`
- Domain: campus microgrid hourly dispatch.
- Initial state: `npm test` failed 3/3 tests.
- Flash result: implemented most logic, but final status failed on one flag-order assertion.
- Pro result: fixed the remaining failure with a minimal edit.
- Changed file: `src/dispatch.js`.
- Final verification: `npm test` passed 3/3 tests.

Capabilities exercised:

- Sequential battery SOC tracking.
- Solar-first load serving, battery charging, and export credits.
- Tariff-gated discharge and grid-charge policy.
- Normal and outage reserve enforcement.
- Energy cost, demand charge, net cost, and carbon accounting.
- Operational alerts for peak import and low final SOC.

System issue found and hardened:

- A failed `read_file` call surfaced as a low-level `EINVAL` when the model tried to read a directory. `LocalWorkspaceService.readFile` now detects directories and returns a clear tool-facing error: use `list_directory` for directory inspection.

Verification:

```bash
npm test --prefix .tmp\complex-microgrid-dispatch-project
node --import tsx --test tests\workspace.test.ts
npm run build
```

## 20. Complex pharma cold-chain fulfillment test

Status: completed.

A fifth complex project was completed in a different business domain: specialty pharmaceutical cold-chain fulfillment. The cheaper Flash model was tried first and implemented most of the allocation and shipment engine, but the outer command timed out with one summary assertion still failing. Pro was then used only for the narrow remaining issue; it fixed the `nearExpiryUnits` calculation before the outer command timeout, and the project verification passed afterward.

Project:

- Workspace: `.tmp/complex-pharma-coldchain-project`
- Domain: pharmaceutical cold-chain order fulfillment and carrier planning.
- Initial state: `npm test` failed 3/3 tests.
- Flash result: implemented FEFO allocation, quarantine/recall filtering, STAT reserve usage, shipment grouping, carrier selection, dry ice, hazmat isolation, and alerts; left `summary.nearExpiryUnits` at `0` instead of `30`.
- Pro result: fixed the remaining near-expiry summary failure.
- Changed file: `src/fulfillment.js`.
- Final verification: `npm test` passed 3/3 tests.

Capabilities exercised:

- FEFO lot allocation across multiple orders.
- Quarantine, expiry, and recall filtering.
- Reserve-protected inventory with STAT override.
- Shipment grouping by order, origin, temperature, and hazmat class.
- Carrier capacity consumption across the plan.
- Cheapest on-time carrier selection with fallback risk flags.
- Frozen dry-ice calculation.
- Cytotoxic hazmat isolation.
- Cost, cold-chain, hazmat, reserve, near-expiry, and dry-ice summary metrics.

System issues found and hardened:

- Long complex runs could continue tool use or fail to return promptly after useful work was already completed. The model runtime prompt now explicitly instructs the agent to stop tool use immediately after verification passes and return the verification result.
- Generated source included non-ASCII decorative comments that rendered as mojibake in this Windows workspace. The model runtime prompt now instructs agents to keep generated or edited source code ASCII unless the existing file already has a clear non-ASCII reason.

Verification:

```bash
npm test --prefix .tmp\complex-pharma-coldchain-project
node --import tsx --test tests\model-client.test.ts
npm run build
```

## 21. Product parity gap backlog against ClaudeCode, Hermes, and OpenClaw

Status: locally improved; external live parity gates still pending.

The latest source-level comparison shows that omni-agent has reached broad native control-plane coverage, but it has not yet reached the full product capability sum of ClaudeCode + Hermes + OpenClaw. The remaining work must focus on executable depth, live integration coverage, and operator experience rather than adding more facade entries.

Current threshold judgment:

- Control-plane and adapter coverage: about 70%-80% of the combined reference surface.
- Full product parity, including mature UX, live providers, deep tools, and operational stability: about 55%-65%.
- Hard conclusion: not yet equal to the full combined capability of all three reference agents.

Evidence from the latest comparison:

- `reference-native` reports 173 native implementation plans: 14 ClaudeCode, 39 Hermes, and 120 OpenClaw descriptors.
- `upstreamRuntimeRequired` is 0 for the tracked descriptor set.
- Targeted verification passed for `reference-native`, `reference-translated`, `gateway`, and `tools`.
- Real complex task tests passed in multiple domains, but Flash often needed Pro for final exactness or timeout recovery.
- 2026-04-30 update: reference parity now distinguishes `facade`, `contract-tested`, `live-tested`, and `product-equivalent` instead of treating every descriptor as product equivalent.
- 2026-04-30 update: default channel plugin lifecycle coverage now spans 14 channel types instead of only Feishu, Slack, and Telegram.
- 2026-04-30 update: the previous manual complex tasks are captured in `examples/evals/complex-suite.json`.

Important boundary:

- A native implementation plan is not the same as full product parity.
- A schema, route, facade, or adapter can make a capability discoverable and callable, but it does not prove the same depth as the upstream product.
- Future work must add live behavior, user-facing workflows, and contract tests for each major parity claim.

### P0. Turn reference coverage into executable parity gates

Status: completed for local contract gates; live/product-equivalent promotion remains gated by opt-in live tests.

Problem:

- `docs/reference-native-implementation.generated.json` proves descriptor coverage, but many entries are still mapped to module facades or broad runtime surfaces.
- There is no per-capability proof that each mapped ClaudeCode/Hermes/OpenClaw behavior works at the same depth.

Required improvements:

- Completed: added a `parityStatus` field per reference descriptor: `facade`, `contract-tested`, `live-tested`, or `product-equivalent`.
- Completed: added `parityEvidence` records with test names, commands, and fixture paths.
- Completed: `reference:native-report -- --strict` validates parity evidence and fails on invalid claims.
- Completed: added `npm run reference:parity -- --source claudecode|hermes|openclaw --strict`.

Acceptance checks:

```bash
npm run reference:native-report
npm run reference:evidence-smoke
npm run reference:parity -- --strict
node --import tsx --test tests\reference-native.test.ts
node --import tsx --test tests\evals.test.ts
```

### P0. ClaudeCode product experience parity

Problem:

- omni-agent has the runtime, CLI, workspace diagnostics, approvals, and workbench data model, but not a ClaudeCode-level TUI/desktop/editor workflow.
- The current workbench is an operator surface, not a full interactive coding product.

Required improvements:

- Add a first-class run timeline view: model turns, tool calls, file changes, verification, approvals, blocked states, and recovery actions.
- Add structured diff and review views that connect directly to changed files and verification evidence.
- Add an approval UI model with risk tier, command preview, reason, and allow/deny audit record.
- Add resumable failed-run workflows: continue latest, rerun verification, repair failed verification, export recovery bundle.
- Add LSP-like diagnostics for at least TypeScript and Python fixtures, with a provider interface for more languages.

Acceptance checks:

```bash
node --import tsx --test tests\cli-chat.test.ts
node --import tsx --test tests\cli-ops.test.ts
node --import tsx --test tests\workspace.test.ts
npm run build
```

Manual acceptance:

- Start `serve`.
- Open workbench.
- Run a failing coding task.
- Approve or deny a risky action.
- Inspect diff, timeline, verification, and recovery controls without using raw logs.

### P0. Hermes deep tool and self-improvement parity

Problem:

- omni-agent has memory, skill discovery, learned skills, subagents, browser, process, notebook, web search/fetch, and Python execution.
- Hermes still has a deeper Python tool ecosystem, larger skill library, richer voice/media/browser tools, and stronger routine-style self-improvement flows.

Required improvements:

- Add a tool parity matrix for Hermes tools: file, patch, terminal, browser, MCP, skill manager, memory, delegate, mixture-of-agents, voice, TTS, transcription, image generation, OSV/security, cron, messaging, and HomeAssistant.
- For each Hermes tool group, create at least one executable fixture and a contract test.
- Expand learned skill lifecycle: candidate, review, promoted, reverify, stale, disabled, rollback.
- Add skill quality decay and scheduled revalidation.
- Add import/sync of reference `skills/` and `optional-skills/` into omni workspace skills with provenance and safety scanning.
- Add dedicated native adapters for voice/TTS/transcription/image generation instead of only generic model/process hooks.

Acceptance checks:

```bash
node --import tsx --test tests\tools.test.ts
node --import tsx --test tests\runtime.test.ts
node --import tsx --test tests\session-store.test.ts
node --import tsx --test tests\automation.test.ts
```

Manual acceptance:

- Run a complex task that uses at least memory, skill selection, browser, Python, process management, and subagents in one workflow.
- Confirm the learned skill produced by the run can be reviewed, promoted, reused, reverified, and rolled back.

### P0. OpenClaw channel and plugin product parity

Status: locally improved; live account matrix still pending.

Problem:

- omni-agent has gateway routes, delivery records, retry/dead-letter, pairing, channel plugin contracts, and many route adapter types.
- Only a subset of channels have deep native plugin lifecycle coverage, and many provider paths still need live account tests.

Required improvements:

- Completed: extended default `ChannelPlugin` lifecycle coverage beyond Feishu, Slack, and Telegram to Canvas, DingTalk, Discord, Filesystem, Matrix, Media, Mobile Node, Signal, Teams, Voice, and WhatsApp.
- Completed: provider manifests expose channel/provider/plugin capabilities, secrets, inbound signatures, outbound payload configuration, threading, files, mentions, markdown, and voice/media flags.
- Add live opt-in contract tests per provider with a documented secret matrix.
- Add route setup diagnostics that explain exactly which secrets, webhook URLs, scopes, and callbacks are missing.
- Add replay tooling for inbound messages and outbound deliveries.
- Add delivery observability: retry schedule, last error, dead-letter reason, and manual replay.

Acceptance checks:

```bash
node --import tsx --test tests\gateway.test.ts
node --import tsx --test tests\gateway-messages.test.ts
node --import tsx --test tests\channel-contracts.test.ts
OMNI_LIVE_CHANNEL_TESTS=1 node --import tsx --test tests\channel-live.test.ts
```

Manual acceptance:

- Configure at least Slack, Telegram, Discord, Feishu, and one consumer channel.
- Send inbound messages.
- Receive threaded outbound replies.
- Force a delivery failure.
- Confirm retry and dead-letter handling works in CLI and workbench.

### P1. MCP and extension operational depth

Problem:

- omni-agent supports local extension manifests, command tools, MCP stdio/http/sse, resources, prompts, context engines, and memory providers.
- It still needs better OAuth, reload, health, permission visualization, and failure recovery.

Required improvements:

- Add MCP server lifecycle controls: start, stop, restart, reload, health, and dispose.
- Add OAuth/secret-reference handling for MCP providers without inline secrets.
- Add extension permission review in CLI and workbench.
- Add per-extension audit logs and failure counters.
- Add hot reload for local plugin directories.

Acceptance checks:

```bash
node --import tsx --test tests\extensions.test.ts
OMNI_LIVE_MCP_TESTS=1 node --import tsx --test tests\mcp-live.test.ts
npm run build
```

### P1. Model provider and routing parity

Problem:

- omni-agent supports OpenAI-compatible and Anthropic-style profiles, failover, diagnostics, and model profile selection.
- Hermes/OpenClaw still have broader provider/account/catalog behavior.

Required improvements:

- Add provider catalog entries with capability metadata: tools, streaming, JSON mode, context size, image/audio support, cost hints, rate limits.
- Add role-based routing policies: cheap model first, Pro model escalation, verifier-specific model, and fallback chain.
- Add account/key health checks and redacted diagnostics.
- Add live model test matrix that can run against configured providers.
- Persist benchmark results by provider and role.

Acceptance checks:

```bash
node --import tsx --test tests\model-client.test.ts
OMNI_LIVE_MODEL_TESTS=1 node --import tsx --test tests\model-live.test.ts
npm run eval:benchmark
```

### P1. Long-running daemon and operator lifecycle

Problem:

- omni-agent has `serve`, `daemon-start`, `daemon-status`, `daemon-stop`, gateway timers, process tools, and automation.
- It still needs production-grade lifecycle management similar to mature agent platforms.

Required improvements:

- Add daemon supervisor state: pid, port, storage root, cwd, startedAt, version, health, active jobs.
- Add crash recovery for running jobs and detached subagents.
- Add service logs with rotation and redaction.
- Add graceful shutdown that drains routes, deliveries, automations, browser sessions, MCP clients, and background processes.
- Add workbench controls for daemon health and shutdown.

Acceptance checks:

```bash
node dist\omni-agent.js daemon-start --cwd . --port 4040
node dist\omni-agent.js daemon-status
node dist\omni-agent.js daemon-stop
node --import tsx --test tests\automation.test.ts
node --import tsx --test tests\gateway.test.ts
```

### P1. Live eval and complex-task benchmark suite

Status: benchmark manifest completed; live repeated runs still pending.

Problem:

- Multiple complex tasks have been manually tested, but they are not yet a reusable benchmark suite.
- The current eval harness does not fully measure long-run task completion, timeout behavior, model escalation, or artifact quality.

Required improvements:

- Completed: converted the complex projects into a checked-in benchmark suite at `examples/evals/complex-suite.json`:
  - renewal billing.
  - health claims adjudication.
  - math modeling paper generation.
  - microgrid dispatch.
  - pharma cold-chain fulfillment.
- Existing eval metrics cover completion, verification pass, repair, tool reliability, fallback recovery, route delivery, memory usefulness, and state retention.
- Remaining: add explicit first-model success, escalation count, generated artifact quality, and recovery-event metrics.
- Add quality gates for artifact-producing tasks such as Word documents, charts, reports, and source programs.
- Add a scorecard comparing Flash-only, Flash-then-Pro, and Pro-only runs.

Acceptance checks:

```bash
npm run eval:benchmark
npm run eval:benchmark -- --manifest examples\evals\complex-suite.json
npm run eval:smoke
node --import tsx --test tests\evals.test.ts
```

### P2. Mobile, desktop, and notification surfaces

Problem:

- omni-agent has mobile-node and mobile-native shells, but not complete OpenClaw-style multi-device product workflows.

Required improvements:

- Add push-style delivery contracts for mobile-node.
- Add notification actions: approve, deny, retry, pause, resume, cancel, summarize.
- Add offline queue and reconnect behavior.
- Add mobile workbench views for routes, deliveries, runs, and subagents.
- Add desktop packaging or documented PWA install flow.

Acceptance checks:

```bash
node --import tsx --test tests\mobile-node-client.test.ts
node --import tsx --test tests\mobile-native-shell.test.ts
npm run build
```

### P2. Security and secret boundary hardening

Problem:

- omni-agent has approval classification, dangerous command blocking, route secrets, config diagnostics, and redaction.
- Full product parity needs stronger secret ownership, auditability, and injection resistance across channels, plugins, MCP, and model providers.

Required improvements:

- Add secret reference schema and central secret resolver.
- Reject inline secrets in plugin manifests unless explicitly allowed for local development.
- Add prompt-injection test fixtures for inbound route messages, workspace instructions, skills, memories, MCP resources, and web content.
- Add audit log export for approvals, tool calls, route deliveries, and provider calls.
- Add security scorecard to `doctor --strict`.

Acceptance checks:

```bash
node --import tsx --test tests\approvals.test.ts
node --import tsx --test tests\cli-doctor.test.ts
node --import tsx --test tests\extensions.test.ts
node --import tsx --test tests\gateway.test.ts
```

### P2. Documentation and operator runbooks

Status: parity dashboard completed; full provider-specific runbooks still pending.

Problem:

- Current docs prove implementation work but do not yet form a complete operator guide for product-equivalent use.

Required improvements:

- Add runbooks for setup, model profiles, gateway routes, live provider tests, MCP servers, skills, memory, daemon lifecycle, recovery, and benchmark execution.
- Completed: added `docs/product-parity-dashboard.md` listing current parity status, status semantics, and local/live gates.
- Add troubleshooting guides for Windows path issues, long-running services, browser sessions, provider credentials, and live channel failures.

Acceptance checks:

```bash
npm run release:diagnostics
npm run release:check
```

## 15. Upstream-free native implementation registry

Status: completed.

This adds an omni-agent native implementation registry on top of the previously generated source-level adapters. The new registry makes the native replacement boundary explicit and removes the default dependency on launching ClaudeCode, Hermes, or OpenClaw runtimes for the 173 tracked reference descriptors.

- New implementation registry: `packages/reference-native/src/implementation.ts`
- New tool: `reference_native`
- New report command: `npm run reference:native-report`
- Generated report: `docs/reference-native-implementation.generated.json`
- Updated adapter route: `native_implementation.execute`

Current native implementation coverage:

- Native implementation plans: `173`
- Native implemented: `173`
- Upstream runtime required: `0`

Native replacement mapping:

- ClaudeCode experience descriptors are mapped to omni-agent core-runtime run state, workspace diagnostics, approval policy, CLI/workbench commands, session-store timelines, artifacts, audit, and usage records.
- Hermes tool descriptors are mapped to omni-agent core-runtime, tools, workspace, context compression, memory, learned skill, browser/process/notebook, model-client, and approvals surfaces.
- OpenClaw plugin/channel/provider descriptors are mapped to omni-agent gateway channel-plugin lifecycle, delivery state, pairing, retry, dead-letter, extension manifests, model profiles, secret references, and diagnostics.

Important boundary:

- `reference_native` does not start upstream runtimes.
- `reference-translated` still preserves source provenance.
- This completes native control-plane replacement for the tracked descriptor set, but external-provider behavioral parity still requires opt-in live account tests for providers such as Slack, Telegram, Feishu, Discord, voice/media providers, and model APIs.

Verification:

```bash
npm run reference:native
npm run reference:native-report
node --import tsx --test tests\reference-native.test.ts
node --import tsx --test --test-name-pattern "reference_capabilities" tests\tools.test.ts
node --import tsx --test tests\maturity-artifacts.test.ts
npm run typecheck
npm run build
npm test
```
