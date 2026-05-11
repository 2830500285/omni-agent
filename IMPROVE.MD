# Omni Agent 改进清单

审查日期：2026-05-11
审查范围：当前 `omni-agent` 本地仓库，重点覆盖 runtime、tools、approvals、evals、gateway、workspace、docs、deploy，以及最新 Genesis / HTX / Web3 / B.AI 能力。

## 0. 当前结论

项目已经不是空壳。它现在具备可运行的本地 agent runtime、工具注册、审批分类、session store、gateway、eval/scorecard、release checks、Genesis 金融代理 demo，以及 HTX/Web3/B.AI 的安全适配层。

但它仍然不应被描述为“生产级自动交易 agent”或“完整 agent 平台”。更准确的状态是：

- 核心 runtime：可用，但大多数能力还不是 mature。
- Genesis demo：适合比赛展示，尤其适合强调可审计、可审批、可回放。
- Web3/HTX：支持只读、预览、纸面执行和本地模拟；不支持真实签名、广播、提现、杠杆或合约交易。
- 平台化能力：覆盖面广，但很多 live/contract/soak 证据还不足。

当前 scorecard 状态：

- capabilityCount: 34
- mature: 3
- usable: 31
- maturityRate: 0.6961
- maturity structural issues: 0

这说明项目工程骨架已经成形，但下一阶段应该把少数关键能力从 `usable` 推到 `mature`，不要继续横向堆工具名。

## 1. 本次验证证据

本次审查实际运行并通过：

```bash
npm run maturity:check
node ./scripts/run-tests.mjs tests/tools.test.ts tests/approvals.test.ts tests/evals.test.ts
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode synthetic --no-save
npm run build
```

结果摘要：

- `tests/tools.test.ts`: 48 passed
- `tests/approvals.test.ts`: 18 passed
- `tests/evals.test.ts`: 16 passed
- Genesis benchmark: 3/3 scenarios completed, verificationPassRate 1, toolSafetyViolationRate 0
- Build/typecheck: passed

注意：Genesis benchmark 已有 runtime executor 覆盖，但当前 runtimeMode 仍使用 mock model，不等同于真实模型、真实交易所、真实链上环境验证。

追加进展（2026-05-11）：

- Genesis benchmark 已扩展为 7 个 runtime 场景：正常 HTX/Web3/B.AI paper workflow、TRON preview risk gate、oversized order blocked、missing approval blocked、missing TRON address blocked、B.AI key missing blocked、live endpoint timeout fallback。
- 已运行并通过 `npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode runtime --run-id genesis-runtime-risk-gates-2026-05-11`，结果为 7/7 completed、verificationPassRate 1、toolSafetyViolationRate 0、overallScore 0.9722。
- benchmark 持久化已补充 `runs.jsonl`，同时继续输出 `eval-result.json`、`summary.json`、`quality.json`、`history.json`、`latest.json`、`trend.json` 和 `report.md`。

## 2. P0 必须优先改

### P0.1 取消 Genesis/Web3 必填地址的隐式默认值

能力映射：`genesis-finance-agent`, `shell-file-safety`

问题：

`packages/tools/src/genesis.ts` 里 `normalizeTronAddress()` 在缺少地址时会返回 `DEFAULT_TRON_ADDRESS`。这对 mock demo 方便，但对 live read、allowance read、transfer/revoke preview 来说风险较高。缺少 `owner`、`spender`、`to`、`address` 时应该直接返回结构化错误，而不是悄悄使用默认地址。

涉及文件：

- `packages/tools/src/genesis.ts`
- `tests/tools.test.ts`

改进要求：

- 增加 `normalizeRequiredTronAddress()`，缺失或格式错误时返回 error/blocked result。
- mock fixture 允许显式传默认样例地址，但不能由 live 工具隐式补。
- `web3_tron_account_snapshot` live 模式缺 `address` 必须失败。
- `web3_trc20_allowance` 缺 `owner`、`spender`、`token` 必须失败。
- `web3_transfer_preview` 缺 `to` 必须失败，且不应在 data 里出现默认接收方。
- `web3_revoke_approval_preview` 缺 `spender` 必须失败。

验收：

```bash
node ./scripts/run-tests.mjs tests/tools.test.ts tests/approvals.test.ts
npm run build
```

### P0.2 把“本地交易模拟”改名或升级，避免误导

能力映射：`genesis-finance-agent`, `verification-native-runtime`

问题：

`web3_transaction_simulation` 当前是本地规则聚合，不是真正的链上 transaction simulation。它不会调用 full node、不会做 estimate energy、不会执行 callStatic，也不会模拟合约状态变化。

改进路径二选一：

1. 保守路线：改名为 `web3_transaction_risk_summary`，文档明确它是 local risk summary。
2. 增强路线：保留 `web3_transaction_simulation`，但增加真实只读模拟：
   - TRON: `triggerconstantcontract` / energy estimate / contract result decode
   - EVM: `eth_call` / `estimateGas`
   - 失败时降级为 local risk summary，并在 data 里标注 `networkSimulation=false`

验收：

- eval 中区分 `localRiskSummary` 和 `networkSimulation`。
- tests 覆盖 live endpoint 不可用时的降级。
- 文档不再把本地规则判断写成真实链上模拟。

### P0.3 Genesis 工具需要拆分，避免单文件继续膨胀

能力映射：`genesis-finance-agent`, `shell-file-safety`

问题：

`packages/tools/src/genesis.ts` 目前约 1600 行，混合了 HTX、B.AI、TRON、EVM、计划生成、地址编码、金额格式化和风险策略。继续添加真实交易能力会让安全边界难以审查。

拆分建议：

- `packages/tools/src/genesis/htx.ts`
- `packages/tools/src/genesis/bai.ts`
- `packages/tools/src/genesis/tron.ts`
- `packages/tools/src/genesis/web3-risk.ts`
- `packages/tools/src/genesis/plan.ts`
- `packages/tools/src/genesis/shared.ts`

验收：

- 外部仍通过 `registerGenesisTools(registry)` 注册。
- 每个模块有对应 focused tests。
- `genesis.ts` 只保留聚合导出或删除。

### P0.4 真实交易执行必须继续默认关闭

能力映射：`genesis-finance-agent`, `shell-file-safety`

问题：

用户已经关心“能否让 agent 自己交易”。当前代码安全地停在纸面交易和预览层，这是正确的。下一步如果接 HTX 下单 API，必须先写安全框架，不能直接做交易工具。

真实交易前置条件：

- API key 只允许 read + spot trade，禁止 withdrawal。
- 只支持现货，不支持合约、杠杆、借贷、衍生品。
- 强制交易对白名单和单笔金额上限。
- 强制 human approval。
- 每次下单前必须生成 order preview、risk report、approval record。
- 每次下单后必须记录 order id、状态查询结果、失败原因和回放证据。
- 默认 dry-run，live adapter 需要显式环境变量启用，例如 `OMNI_AGENT_ENABLE_LIVE_HTX_SPOT=1`。

新增真实交易前必须先写：

- `docs/trading-safety.md`
- `tests/approvals.test.ts` live trading classification tests
- `tests/tools.htx-live.test.ts` opt-in live/contract tests
- `examples/evals/htx-live-guarded.json`

### P0.5 清理本地 Git/GitHub 状态

能力映射：`production-operations`

问题：

上一次 README 更新因为 Git HTTPS 连接失败，使用 GitHub Contents API 成功写入远端。当前本地分支显示 `ahead 1`，但远端实际已经有 API 生成的 README 提交。后续如果直接 push，可能再次出现历史分叉。

改进要求：

- 网络恢复后执行 `git fetch origin main`。
- 比对本地 `README.md` 与远端 API 提交内容。
- 选择一种干净路线：
  - reset 本地分支到远端 API 提交后重新应用后续本地改动；
  - 或 rebase/cherry-pick，确保 `main` 线性。
- 不要 force push，除非明确确认远端历史可以重写。

验收：

```bash
git fetch origin main
git status --short --branch
git rev-list --left-right --count HEAD...origin/main
```

## 3. P1 高价值改进

### P1.1 把 synthetic benchmark 推进到 real-runtime benchmark

能力映射：`benchmark-quality`, `genesis-finance-agent`

状态：核心 runtime 覆盖已完成。后续只需要把 `.artifacts/benchmarks` 接入 CI artifact 上传策略，不需要再扩 Genesis 风险场景数量。

问题：

`npm run eval:benchmark -- --mode synthetic` 能证明 eval harness 和 tool expectation 配置正确，但不能证明真实模型会稳定走正确工具、正确拒绝风险动作。

改进要求：

- 增加 `--mode runtime` 或复用已有 real executor，把 eval scenario 真正交给 runtime。
- Genesis 场景至少覆盖：
  - 正常 HTX/Web3/B.AI paper workflow
  - oversized order blocked
  - missing approval blocked
  - missing TRON address blocked
  - B.AI key missing blocked without leaking secret
  - live endpoint timeout fallback
- 输出 JSONL run artifacts，纳入 `.artifacts/benchmarks` 或 CI artifact。

验收：

```bash
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode runtime --no-save
npm run maturity:check
```

### P1.2 live tests 不能只检查环境变量

能力映射：`model-runtime`, `gateway-channels`, `mcp-runtime`, `genesis-finance-agent`

状态：部分完成。`tests/model-live.test.ts` 已覆盖 opt-in 的真实模型和 B.AI 小请求；`tests/channel-live.test.ts` 与 `tests/mcp-live.test.ts` 已有本地 roundtrip fixture。本轮新增 `tests/tools-live.test.ts`，在 `OMNI_LIVE_TRON_TESTS=1` 时执行 Genesis TRON 只读 account/allowance live checks，在 `OMNI_LIVE_BAI_TESTS=1` 时通过 Genesis `bai_chat_completion` 工具执行 B.AI live 小请求。

问题：

当前 live test 文件主要是 opt-in 和 required env 检查：

- `tests/channel-live.test.ts`
- `tests/mcp-live.test.ts`
- `tests/model-live.test.ts`

这对避免误跑有价值，但不能证明 live provider 真可用。

改进要求：

- model live test：实际发一次小请求，验证响应、错误归因、redaction。
- B.AI live test：加入 opt-in `OMNI_LIVE_BAI_TESTS=1`，不提交真实 key。
- TRON live test：查询固定公开地址余额和 USDT allowance，验证只读路径。
- channel live test：至少对一个 sandbox/test channel 做 send + fetch status。
- MCP live test：启动一个本地 stdio fixture server，验证 list tools/resources/call tool。

验收：

```bash
set OMNI_LIVE_MODEL_TESTS=1
node ./scripts/run-tests.mjs tests/model-live.test.ts
```

### P1.3 把大文件模块化

能力映射：`coding-runtime`, `mcp-runtime`, `gateway-channels`, `memory-lifecycle`, `operator-workbench`

当前最大维护风险来自几个超大文件：

- `packages/tools/src/index.ts`
- `packages/gateway/src/index.ts`
- `packages/session-store/src/index.ts`
- `packages/core-runtime/src/index.ts`
- `apps/cli/src/index.ts`
- `tests/runtime.test.ts`
- `tests/gateway.test.ts`
- `tests/tools.test.ts`

改进原则：

- 先抽纯逻辑模块，不先重写 runtime。
- 保持 public API 不变。
- 每拆一个模块，先跑对应 tests。

建议顺序：

1. `packages/tools/src/index.ts` 按 tool family 拆分。
2. `packages/gateway/src/index.ts` 拆 route handlers、event stream、channel delivery、workbench serving。
3. `packages/session-store/src/index.ts` 拆 schema/migrations、runs、threads、memories、automations。
4. `apps/cli/src/index.ts` 拆 command handlers。

### P1.4 让 capability scorecard 成为改进路线的唯一真源

能力映射：`benchmark-quality`, `eval-program-governance`, `verification-native-runtime`

问题：

README、docs、scorecard、IMPROVE 很容易重复描述能力状态。以后必须以 scorecard 为能力状态真源，其他文档只引用或解释。

改进要求：

- `IMPROVE.MD` 中每个大项都映射到 `examples/evals/capability-scorecard.json` 的 capability id。
- 每个 capability 的 `nextMilestone`、`blockedBy`、`matureCriteria` 与本文件同步。
- 增加脚本检查 `IMPROVE.MD` 提到的 capability id 都存在于 scorecard。

验收：

```bash
npm run maturity:check
node ./scripts/run-tests.mjs tests/evals.test.ts
```

### P1.5 增强 operator UX，而不是继续堆工具

能力映射：`coding-runtime`, `operator-workbench`, `cli-checkpoint-slash-surface`, `workspace-checkpoints`, `subagents`

问题：

当前能力很多，但操作者看到的 run timeline、approval recovery、diff/review、subagent artifacts、checkpoint selection 仍不够强。对比 Claude Code/OpenClaw，差距更多在操作体验，不是单个工具数量。

改进要求：

- CLI 增加或完善：
  - `/timeline`
  - `/diff`
  - `/review`
  - `/approvals`
  - `/artifacts`
  - `/resume-failed <run-id>`
- Workbench 增加：
  - run timeline
  - approval queue
  - tool call replay
  - checkpoint diff preview
  - subagent topology + returned artifacts

验收：

- CLI tests 覆盖 slash command。
- Gateway/workbench tests 覆盖接口返回结构。
- eval scenario 覆盖失败 run resume。

## 4. P2 中期改进

### P2.1 B.AI 应作为一等 model profile

能力映射：`model-runtime`, `genesis-finance-agent`, `credential-pool-rotation`

当前 B.AI 已有 `bai_capability_probe` 和 `bai_chat_completion` 工具，但更自然的长期位置是 model profile provider。

改进要求：

- 在 model-client profile 中提供 B.AI template。
- `setup` 支持 `--provider bai`。
- `models` 命令展示 B.AI key/env 状态。
- 保留 `bai_chat_completion` 作为 Genesis demo 工具，但底层复用 model-client。

### P2.2 真正的 HTX read-only account gateway

能力映射：`genesis-finance-agent`, `gateway-channels`, `production-operations`

当前 `htx_account_snapshot` 依赖 fixture 或用户自备 read-only gateway endpoint。比赛 demo 足够，但要提高可信度，应提供一个最小 gateway contract。

改进要求：

- 定义 `docs/htx-readonly-gateway-contract.md`。
- 提供 mock gateway fixture。
- 加入签名请求示例，但不存交易 key。
- 明确错误模型：auth missing、permission denied、rate limit、invalid account、network timeout。

### P2.3 Memory/Skill 的长期治理

能力映射：`memory-lifecycle`, `skill-lifecycle`, `skill-platform-gates`

项目已有 memory provider 和 skill_manage，但距离 Hermes 式长期治理仍差：

- skill revision history 不够产品化。
- skill review queue 需要更明确的人审流程。
- memory recall 缺少 precision/contamination 评估。
- stale/conflicting memory 的 benchmark 还不够。

改进要求：

- `skills history <id>` / `skills diff <id>`
- memory quarantine
- recall attribution in run artifacts
- stale-memory benchmark

### P2.4 生产部署和 release 成熟度

能力映射：`production-operations`, `extension-package-contracts`

当前有 deploy template、security docs、release checklist，但 mature 还需要：

- signed release artifacts
- migration rehearsal
- deployment smoke test
- daemon soak test
- backup/restore rehearsal
- secret-store integration

验收：

```bash
npm run release:check
npm run release:artifact-smoke
npm run maturity:check
```

## 5. P3 可延后改进

这些不是比赛前必须做，但会影响长期竞争力：

- 完整 plugin SDK 和 signed plugin publishing。
- Live Slack/Telegram/Feishu channel matrix。
- ACP external client live compatibility。
- Browser visual diff regression。
- Cross-platform desktop/mobile operator shell。
- Large-repo inline context reference stress tests。
- Long-running process reattach after restart。
- Historical benchmark dashboard。

## 6. Genesis 赛道专项路线

比赛前建议把 Genesis 路线收敛成一个强 demo：

1. 用户输入金融意图。
2. Agent 读取 HTX 行情。
3. Agent 读取 HTX 账户快照或 fixture。
4. Agent 读取 TRON 账户和 TRC20 allowance。
5. Agent 生成转账/撤销授权预览。
6. Agent 运行 local risk summary 或真实只读 simulation。
7. Agent 调用 B.AI 生成风险说明。
8. Agent 生成交易计划。
9. Agent 要求人类审批。
10. Agent 只记录 paper order，不做真实下单。
11. 输出 run artifact 和 eval result。

比赛前不要做：

- 自动实盘交易。
- 链上签名。
- 提现。
- 杠杆/合约。
- 任意合约调用。
- 默认读取用户真实交易 key。

## 7. 推荐下一步执行顺序

第一批：

1. 修复 Genesis/Web3 必填地址默认值问题。
2. 把 `web3_transaction_simulation` 语义改清楚。
3. 给 Genesis 增加 missing-input / timeout / no-key 测试。
4. 更新 `docs/htx-genesis.md` 和 eval 文案。

第二批：

1. 拆分 `packages/tools/src/genesis.ts`。
2. 增加 B.AI model profile template。
3. 增加 TRON/B.AI opt-in live tests。
4. 把 Genesis benchmark 从 synthetic 推进到 runtime mode。

第三批：

1. 模块化 `packages/tools/src/index.ts` 和 `packages/gateway/src/index.ts`。
2. 增强 CLI/workbench operator timeline。
3. 推进 scorecard 中 3-5 个最关键 capability 到 mature。

## 8. 每次改进的最低验收线

每次提交前至少跑：

```bash
npm run build
node ./scripts/run-tests.mjs <changed-area-tests>
git diff --check
```

涉及 Genesis 时额外跑：

```bash
node ./scripts/run-tests.mjs tests/tools.test.ts tests/approvals.test.ts tests/evals.test.ts
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode synthetic --no-save
npm run maturity:check
```

涉及 release/deploy 时额外跑：

```bash
npm run release:check
npm run release:artifact-smoke
```

## 9. 当前无需修改的方向

这些方向当前不要优先做：

- 不要为了“看起来像交易机器人”而加自动实盘。
- 不要继续增加大量 workflow 名称，先把现有 workflow 做成可验证闭环。
- 不要复制参考项目的大文件；只借小 capability unit、schema、策略和测试模式。
- 不要把 synthetic benchmark 结果宣传成真实模型能力。
- 不要把 `usable` 能力改成 `mature`，除非有 live/contract/failure recovery/ops evidence。
