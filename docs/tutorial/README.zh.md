# Omni Agent 教程

这份教程把 Omni Agent 当成一个“以验证为中心”的本地编码 Agent 运行时来讲。目标读者是想理解代码仓库、运行 CLI、接入真实模型、做 Agent 评测，并且能继续扩展系统的开发者。

建议按下面顺序教学：

1. 快速开始
2. 项目目录地图
3. Runtime 运行循环
4. 模型 Profile
5. 工具、工作区与审批
6. 上下文与记忆
7. 子 Agent 与任务控制
8. Gateway 与 Workbench
9. Eval Harness
10. 真实模型 Benchmark
11. 安全与风控
12. 部署与运维
13. 自己实现一个功能
14. 失败案例复盘

## 1. 快速开始

目标：安装依赖、验证仓库、跑通本地 Agent 路径。

```bash
npm ci
npm run typecheck
npm run dev -- models
npm run dev -- doctor --cwd "."
npm run dev -- run --cwd "." --task "Summarize this repository"
```

默认路径是本地友好的。即使还没有配置远程模型，Omni Agent 也可以验证脚手架、工作区检查、mock runtime 行为和 eval 基础链路。

成功标准：

- `npm run typecheck` 能通过。
- `models` 能打印当前模型 profile 状态。
- `doctor` 能给出工作区、存储、模型、gateway、route、automation、extension 诊断。
- `run` 能生成任务总结，不依赖隐藏配置。

## 2. 项目目录地图

目标：改代码前先知道每个系统职责在哪里。

```text
apps/cli                 CLI 入口、命令解析、chat 命令
apps/workbench           面向操作者的工作台界面
apps/mobile-node         Node 侧移动端客户端
apps/mobile-native       原生移动端壳
packages/core-runtime    Agent runtime 循环与任务执行
packages/model-client    OpenAI 兼容与 Anthropic 兼容模型客户端
packages/tools           工具注册表与工具执行契约
packages/workspace       仓库检查、文件服务、工作区服务
packages/context         Prompt 上下文与线程压缩
packages/session-store   持久化 session、run、memory、route、automation
packages/approvals       审批策略与命令风险处理
packages/evals           Eval suite schema、runner、评分报告
packages/gateway         HTTP/SSE/WS gateway 与控制面 API
packages/automation      定时与事件触发的 Agent 工作
packages/safety          安全检查与 secret pattern 处理
examples/evals           Benchmark manifest 与任务 fixture
scripts                  Benchmark、release、maturity、build 脚本
docs                     运维、安全、能力对齐与教程文档
```

教学规则：每一个概念都要能指回具体目录。如果某一节完全不能指向代码，那它大概率是产品描述，不是工程教学。

## 3. Runtime 运行循环

目标：理解一次任务运行时到底发生了什么。

运行链路从 `apps/cli` 开始，构造 runtime options，选择模型 profile，准备工作区上下文，执行 Agent loop，记录 tool/model events，最后返回 run summary。核心实现位于 `packages/core-runtime`。

优先阅读：

- `apps/cli/src/index.ts`：CLI 命令如何接到 runtime。
- `packages/core-runtime/src/index.ts`：任务执行主循环。
- `packages/model-client/src/index.ts`：Provider 调用与 usage 数据。
- `packages/session-store/src/index.ts`：线程和 run 如何持久化。

练习：

```bash
npm run dev -- run --cwd "." --task "List the main runtime packages and say what each one does"
```

跑完以后，把输出 summary 和 runtime 代码路径对照起来看。

## 4. 模型 Profile

目标：接入真实 provider，但不把密钥写进代码。

Omni Agent 支持 OpenAI 兼容 profile，也支持 Anthropic Messages profile。密钥只放在环境变量里，仓库和配置里只保留 profile 元数据。

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

如果接 DeepSeek 或其他 OpenAI 兼容端点，结构一样，只替换 base URL、环境变量名和模型 id：

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

验证 profile：

```bash
npm run dev -- models
npm run dev -- doctor --cwd "." --mode openai
```

不要提交 `.env`、包含密钥的本地配置、DPAPI 文件，或者含有 provider payload 的运行 trace。

## 5. 工具、工作区与审批

目标：理解 Agent 被允许如何操作一个仓库。

关键包：

- `packages/tools`：工具定义与执行契约。
- `packages/workspace`：文件、git、仓库检查。
- `packages/approvals`：风险判断与命令审批策略。
- `packages/safety`：prompt、命令、路径、secret 安全检查。

设计目标不是“让模型随便做任何事”。Runtime 应该显式声明能力，对高风险动作加 gate，并把证据留在 run record 里。

动手检查：

```bash
npm run dev -- doctor --cwd "."
node ./scripts/run-tests.mjs tests/safety.test.ts tests/approvals.test.ts tests/workspace.test.ts
```

写测试时，不要放完整且逼真的假 token。可以在运行时拼接字符串，或者用明显无效的 placeholder，避免 GitHub push protection 把它识别成泄露密钥。

## 6. 上下文与记忆

目标：理解 Agent 记住什么，以及什么时候应该忽略记忆。

上下文和记忆主要分布在：

- `packages/context`：prompt context 与 thread compression。
- `packages/session-store`：持久化记录。
- CLI memory 命令：保存与检索用户/项目事实。

试一下：

```bash
npm run dev -- memory-save --cwd "." --content "Use npm scripts for verification in this repository" --tag build
npm run dev -- memory-search --cwd "." --query "verification"
```

教学重点：

- 记忆必须对当前任务有用。
- 过期记忆不能覆盖当前源码。
- 压缩要保留 handoff facts、tool evidence 和 verification state。

## 7. 子 Agent 与任务控制

目标：理解 Omni Agent 如何表达委派工作，同时不失去父任务控制权。

Runtime 应该把子 Agent 当作受治理的执行单元，而不是自由发散的线程。教学时重点问：

- 委派了什么任务？
- 子 Agent 拥有哪些文件或职责？
- 预算和审批限制是什么？
- 返回了什么证据？
- 父 runtime 如何合并或拒绝结果？

相关材料：

- `docs/governed-subagents.md`
- `docs/agent-run-artifacts.md`
- `packages/core-runtime`
- `packages/session-store`

## 8. Gateway 与 Workbench

目标：把 Omni Agent 暴露成可检查的本地服务。

CLI 可以启动 gateway，用于本地编排和 operator inspection：

```bash
npm run dev -- serve --cwd "." --port 4040 --gateway-token local-dev-token
```

Gateway 支持 HTTP API、实时事件、异步 job、memory、automation 和 node control-plane session。Workbench 是面向操作者的界面。

阅读：

- `packages/gateway`
- `apps/workbench`
- `docs/operations.md`
- `docs/live-testing.md`

教学时，让学习者追踪一次 run：从 CLI 命令，到 gateway event，再到持久化 run artifact。

## 9. Eval Harness

目标：把 harness 回归和真实模型能力区分开。

Eval 系统位于 `packages/evals`、`examples/evals` 和 `scripts` 里的 benchmark 脚本。

先跑快速检查：

```bash
npm run eval:smoke
npm run eval:benchmark -- --mode synthetic --no-save
```

默认 benchmark 是 `synthetic`。它很有用，但含义有限：它证明 harness、manifest 归一化、评分计算和质量门禁没有坏。它不证明真实模型完成了所有任务。

Mock runtime 模式比 synthetic 更强，因为它会走 runtime 路径，但仍然不是远程模型评测：

```bash
npm run eval:release-local
npm run eval:benchmark -- --mode mock --no-save
```

必须讲清楚三者区别：

- `synthetic`：脚本化 observed run，适合 harness 回归。
- `mock`：真实 runtime 路径，但没有远程模型成本。
- `openai`：真实模型/provider 路径，包含实际模型行为、耗时和 usage。

## 10. 真实模型 Benchmark

目标：把 Omni Agent 从“自检 harness”推进到真正有说服力的 Agent Eval。

使用已配置的真实 profile：

```bash
npm run eval:benchmark -- \
  --mode openai \
  --model-profile deepseek-flash \
  --run-id "deepseek-flash-45-full" \
  --approval-policy suggest \
  --verification-mode required
```

或者让 `--model-profile` 自动推断为真实模型模式：

```bash
npm run eval:benchmark -- --model-profile deepseek-flash --run-id "deepseek-flash-45-full"
```

每次真实 benchmark 都应该保存：

- Manifest 版本。
- Model profile id。
- Runtime mode。
- Trace artifacts。
- 可用时的 cost 与 token usage。
- Duration。
- 失败的 scenario id。
- 失败原因。
- Verification commands 与 exit code。

解读规则：

如果模型能写出不错的自然语言回答，但缺少必需 tool events、snippet 或 verification contract，这不一定只是“模型太弱”。也可能是 prompting、工具契约、fixture 设计或模型 tool-use 支持存在问题。先看 trace，再下结论。

## 11. 安全与风控

目标：保证项目能公开发布，也能安全运行。

阅读：

- `docs/security.md`
- `packages/safety`
- `packages/approvals`
- `tests/safety.test.ts`

贡献规则：

- 不提交真实密钥。
- 不提交完整且逼真的假密钥。
- `.artifacts`、`.tmp`、`.agents`、`node_modules`、provider traces、本地 runtime stores 不进 git。
- tool execution、path traversal、prompt injection、credential exfiltration 都要当作一等测试场景。

运行：

```bash
node ./scripts/run-tests.mjs tests/safety.test.ts
```

## 12. 部署与运维

目标：知道什么门禁通过后，才能声称项目可用。

常用命令：

```bash
npm run typecheck
npm test
npm run maturity:check
npm run release:check
npm run release:artifact-smoke
```

常用文档：

- `docs/operations.md`
- `docs/release-checklist.md`
- `docs/product-parity-dashboard.md`
- `docs/capability-backed-claims.md`

教学标准：

任何能力声明都应该能引用一个命令、测试、eval 结果或持久化 artifact。不能验证的能力，只能写成计划工作，不要写成已完成能力。

## 13. 自己实现一个功能

目标：做一个小但接近生产风格的改动，并完成验证。

推荐练习：新增一个 eval scenario。

1. 在 `examples/evals/fixtures` 下新增一个聚焦 fixture。
2. 把 scenario 加进 `examples/evals/suite.json`。
3. 在 `packages/evals` 中新增或更新 deterministic/heuristic scorer。
4. 运行 smoke eval。
5. 运行 synthetic benchmark。
6. 如果该 scenario 依赖真实模型行为，用命名 model profile 跑一次 `openai` benchmark，并保存 artifacts。

验证：

```bash
npm run eval:smoke
npm run eval:benchmark -- --mode synthetic --no-save
npm run typecheck
```

## 14. 失败案例复盘

目标：从真实 Agent 失败里教学，而不是只讲 happy path。

适合做案例的主题：

- Synthetic benchmark 通过，但真实模型失败。
- 模型改对了文件，但缺少必需 verification evidence。
- 工具调用被 approval policy 拦截。
- 过期记忆与当前源码冲突。
- Gateway route 本地成功，但缺少生产凭证。
- Benchmark 分数提高，但成本或耗时回退。

每个案例都应该包含：

- 起始命令。
- 相关 model profile。
- Manifest/scenario id。
- Trace 或 artifact 路径。
- 期望行为。
- 实际行为。
- 根因。
- 修复。
- 回归检查。

## 推荐课程目录

如果这个仓库继续做成公开学习项目，建议使用下面的教学目录：

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

第一版保持紧凑即可。等单文件教程太长、维护困难时，再拆成独立 lesson 文件。
