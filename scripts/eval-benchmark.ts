import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBenchmarkQualityReport,
  buildCapabilityMaturityReport,
  buildLongitudinalBenchmarkReport,
  normalizeCapabilityScorecardDefinition,
  normalizeEvalSuiteDefinition,
  runEvalSuite,
  type BenchmarkQualityReport,
  type CapabilityScorecardDefinition,
  type EvalObservedRun,
  type EvalScenario,
  type EvalSuiteDefinition,
  type EvalSuiteResult,
  type LongitudinalBenchmarkRun,
} from "../packages/evals/src/index.ts";
import { estimateModelUsageCost } from "../packages/model-client/src/index.ts";

type BenchmarkMode = "mock" | "openai" | "runtime" | "synthetic";
type CliEvalMode = "mock" | "openai";

interface BenchmarkOptions {
  readonly mode: BenchmarkMode;
  readonly manifestPath: string;
  readonly artifactsDir: string;
  readonly runId: string;
  readonly storageRoot?: string;
  readonly modelProfileId?: string;
  readonly approvalPolicy?: string;
  readonly executionDomain?: string;
  readonly verificationMode?: string;
  readonly maxIterations?: string;
  readonly verificationCommands: readonly string[];
  readonly autoApproveRisky: boolean;
  readonly saveArtifacts: boolean;
}

interface BenchmarkUsageSummary {
  readonly runCount: number;
  readonly modelProfiles: readonly string[];
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly durationMs: number | null;
  readonly estimatedCostUsd: number | null;
  readonly costStatus: "estimated" | "unknown";
  readonly costSummary: string;
}

interface BenchmarkFailureSummary {
  readonly scenarioId: string;
  readonly stepId: string;
  readonly reasons: readonly string[];
  readonly verificationStatus: string;
  readonly failedTools: readonly string[];
}

interface PersistedBenchmarkRun extends LongitudinalBenchmarkRun {
  readonly mode: BenchmarkMode;
  readonly implementation: string;
  readonly manifestPath: string;
  readonly modelProfileId?: string;
  readonly metrics: EvalSuiteResult["metrics"];
  readonly usage: BenchmarkUsageSummary;
  readonly failureSummary: readonly BenchmarkFailureSummary[];
  readonly artifacts: {
    readonly runDir: string;
    readonly evalResult: string;
    readonly summary: string;
    readonly quality: string;
    readonly trend: string;
  };
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseOptions();
const suitePath = resolve(repoRoot, options.manifestPath);
const isDefaultSuite = !readOption("--manifest");
const scorecardPath = resolve(repoRoot, "examples/evals/capability-scorecard.json");
const requiredCategories = [
  "coding_bugfix",
  "verification_repair",
  "memory_recall",
  "skill_creation",
  "skill_improvement",
  "subagent_delegation",
  "subagent_parallel",
  "mcp_tool_use",
  "mcp_resource",
  "gateway_route_delivery",
  "model_fallback",
  "long_context_modification",
  "long_running_automation",
] as const;
const requiredFailureSamples = [
  "approval.destructive_command_blocked",
  "workspace.path_escape_blocked",
  "stale-memory-ignored",
  "bad-skill-not-materialized",
  "failed-model-fallback-recovered",
  "subagent-budget-handled",
  "gateway.route_delivery",
] as const;
const syntheticExecutor = { mode: "synthetic", implementation: "scripted-observed-run" } as const;

const suiteDefinition = readJsonFile<EvalSuiteDefinition>(suitePath);
const suite = normalizeEvalSuiteDefinition(suiteDefinition, {
  baseDir: dirname(suitePath),
  defaultWorkspaceCwd: repoRoot,
});
const runtimeOptions = applyRuntimeBenchmarkDefaults(options, suite);
const scorecardDefinition = readJsonFile<CapabilityScorecardDefinition>(scorecardPath);
const scorecard = normalizeCapabilityScorecardDefinition(scorecardDefinition, {
  baseDir: dirname(scorecardPath),
  defaultWorkspaceCwd: repoRoot,
});

const manifestErrors = isDefaultSuite ? validateBenchmarkManifest(suite.scenarios) : [];
if (manifestErrors.length > 0) {
  console.error(JSON.stringify({ manifestErrors }, null, 2));
  process.exit(1);
}

const executor = {
  ...(runtimeOptions.mode === "synthetic" ? syntheticExecutor : { mode: runtimeOptions.mode, implementation: "cli-runtime-evals" }),
  ...(runtimeOptions.mode === "runtime" ? { runtimeMode: resolveRuntimeCliMode(runtimeOptions) } : {}),
  modelProfileId: runtimeOptions.modelProfileId ?? null,
} as const;

const runDir = resolve(runtimeOptions.artifactsDir, "runs", runtimeOptions.runId);
if (runtimeOptions.saveArtifacts || runtimeOptions.mode !== "synthetic") {
  mkdirSync(runDir, { recursive: true });
}

const runtimeExitCode = runtimeOptions.mode === "synthetic" ? 0 : runRuntimeBenchmark(runtimeOptions, runDir);
const result = runtimeOptions.mode === "synthetic" ? await runSyntheticBenchmark() : readRuntimeResult(runDir);
const report = buildBenchmarkQualityReport(result, result.qualityThresholds);
const capabilityMaturity = isDefaultSuite
  ? buildCapabilityMaturityReport(scorecard, {
      passingScenarioIds: new Set(result.scenarioResults.filter((entry) => entry.completed).map((entry) => entry.scenarioId)),
      requirePassingScenariosForMature: true,
    })
  : null;
const usage = summarizeBenchmarkUsage(result);
const failureSummary = summarizeBenchmarkFailures(result);
const artifactPaths = runtimeOptions.saveArtifacts
  ? persistBenchmarkRun({
      options: runtimeOptions,
      result,
      report,
      usage,
      failureSummary,
      runDir,
    })
  : null;
const maturityIssues = capabilityMaturity?.issues ?? [];

console.log(
  JSON.stringify(
    {
      executor,
      artifactPaths,
      metrics: result.metrics,
      quality: report,
      usage,
      failureSummary,
      capabilityMaturity,
    },
    null,
    2,
  ),
);

if (runtimeExitCode !== 0 || !report.passed || maturityIssues.some((issue) => issue.severity === "error")) {
  process.exitCode = runtimeExitCode || 1;
}

async function runSyntheticBenchmark(): Promise<EvalSuiteResult> {
  const result = await runEvalSuite(suite, async ({ scenario, stepIndex, threadId }) => {
    const tools = expectedTools(scenario, stepIndex);
    return {
      observedRun: {
        runId: `${scenario.id}-benchmark-${stepIndex + 1}`,
        threadId: threadId ?? `${scenario.id}-thread`,
        verificationStatus: "passed",
        finalResponse: expectedFinalResponse(scenario, stepIndex),
        changedFiles: expectedChangedFiles(scenario, stepIndex),
        toolEvents:
          scenario.category === "verification_repair" && scenario.id !== "approval.destructive_command_blocked"
            ? [
                { toolName: "run_verification", status: "failed" },
                ...tools.map((toolName) => ({ toolName, status: "ok" })),
              ]
            : tools.map((toolName) => ({ toolName, status: "ok" })),
        modelProfiles: ["synthetic-scripted-observed-run"],
        memoryUseful: scenario.category === "memory_recall" ? true : undefined,
        toolSafetyViolation: false,
        fallbackRecovered: scenario.category === "model_fallback" ? true : undefined,
        toolCallCount: Math.max(tools.length, 1),
        turnCount: 1,
        durationMs: 120,
      },
      threadId: threadId ?? `${scenario.id}-thread`,
    };
  });
  if (options.saveArtifacts) {
    writeJson(resolve(runDir, "eval-result.json"), result);
  }
  return result;
}

function runRuntimeBenchmark(options: BenchmarkOptions, runDir: string): number {
  const outputPath = resolve(runDir, "eval-result.json");
  const cliMode = resolveRuntimeCliMode(options);
  const args = [
    "--import",
    "tsx",
    resolve(repoRoot, "apps/cli/src/index.ts"),
    "evals",
    "--cwd",
    repoRoot,
    "--manifest",
    suitePath,
    "--output",
    outputPath,
    "--mode",
    cliMode,
  ];
  appendOption(args, "--storage-root", options.storageRoot);
  appendOption(args, "--model-profile", options.modelProfileId);
  appendOption(args, "--approval-policy", options.approvalPolicy);
  appendOption(args, "--execution-domain", options.executionDomain);
  appendOption(args, "--verification-mode", options.verificationMode);
  appendOption(args, "--max-iterations", options.maxIterations);
  for (const command of options.verificationCommands) {
    appendOption(args, "--verify", command);
  }
  if (options.autoApproveRisky) {
    args.push("--auto-approve-risky");
  }

  const spawned = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: resolve(repoRoot, "tsconfig.base.json"),
      TSX_DISABLE_CACHE: "1",
    },
    maxBuffer: 50 * 1024 * 1024,
  });
  if (options.saveArtifacts) {
    writeFileSync(resolve(runDir, "cli-stdout.log"), spawned.stdout ?? "", "utf8");
    writeFileSync(resolve(runDir, "cli-stderr.log"), spawned.stderr ?? "", "utf8");
    writeJson(resolve(runDir, "cli-command.json"), {
      command: process.execPath,
      args,
      cwd: repoRoot,
      exitCode: spawned.status,
      signal: spawned.signal,
      error: spawned.error ? String(spawned.error) : null,
    });
  }
  if (spawned.stdout) {
    process.stderr.write(spawned.stdout);
  }
  if (spawned.stderr) {
    process.stderr.write(spawned.stderr);
  }
  return spawned.status ?? (spawned.error ? 1 : 0);
}

function readRuntimeResult(runDir: string): EvalSuiteResult {
  const outputPath = resolve(runDir, "eval-result.json");
  if (!existsSync(outputPath)) {
    throw new Error(`Runtime benchmark did not produce an eval result: ${outputPath}`);
  }
  return JSON.parse(readFileSync(outputPath, "utf8")) as EvalSuiteResult;
}

function persistBenchmarkRun(input: {
  readonly options: BenchmarkOptions;
  readonly result: EvalSuiteResult;
  readonly report: BenchmarkQualityReport;
  readonly usage: BenchmarkUsageSummary;
  readonly failureSummary: readonly BenchmarkFailureSummary[];
  readonly runDir: string;
}): Record<string, string> {
  const artifactsRoot = resolve(input.options.artifactsDir);
  mkdirSync(artifactsRoot, { recursive: true });
  mkdirSync(input.runDir, { recursive: true });

  const evalResultPath = resolve(input.runDir, "eval-result.json");
  if (!existsSync(evalResultPath)) {
    writeJson(evalResultPath, input.result);
  }
  const qualityPath = resolve(input.runDir, "quality.json");
  const summaryPath = resolve(input.runDir, "summary.json");
  const historyPath = resolve(artifactsRoot, "history.json");
  const jsonlPath = resolve(artifactsRoot, "runs.jsonl");
  const trendPath = resolve(artifactsRoot, "trend.json");
  const latestPath = resolve(artifactsRoot, "latest.json");
  const reportPath = resolve(artifactsRoot, "report.md");

  writeJson(qualityPath, input.report);

  const persistedRun: PersistedBenchmarkRun = {
    id: input.options.runId,
    completedAt: input.result.completedAt,
    mode: input.options.mode,
    implementation: executor.implementation,
    manifestPath: relative(repoRoot, suitePath),
    modelProfileId: input.options.modelProfileId,
    report: input.report,
    metrics: input.result.metrics,
    usage: input.usage,
    failureSummary: input.failureSummary,
    artifacts: {
      runDir: relative(repoRoot, input.runDir),
      evalResult: relative(repoRoot, evalResultPath),
      summary: relative(repoRoot, summaryPath),
      quality: relative(repoRoot, qualityPath),
      trend: relative(repoRoot, trendPath),
    },
  };
  writeJson(summaryPath, persistedRun);
  appendFileSync(jsonlPath, `${JSON.stringify(persistedRun)}\n`, "utf8");

  const history = readHistory(historyPath)
    .filter((entry) => entry.id !== persistedRun.id)
    .concat(persistedRun)
    .sort((left, right) => new Date(left.completedAt).getTime() - new Date(right.completedAt).getTime())
    .slice(-50);
  writeJson(historyPath, history);
  const trend = buildLongitudinalBenchmarkReport(history);
  writeJson(trendPath, trend);
  writeJson(latestPath, persistedRun);
  writeFileSync(reportPath, renderMarkdownReport(persistedRun, trend), "utf8");

  return {
    runDir: relative(repoRoot, input.runDir),
    evalResult: relative(repoRoot, evalResultPath),
    summary: relative(repoRoot, summaryPath),
    quality: relative(repoRoot, qualityPath),
    history: relative(repoRoot, historyPath),
    jsonl: relative(repoRoot, jsonlPath),
    trend: relative(repoRoot, trendPath),
    latest: relative(repoRoot, latestPath),
    report: relative(repoRoot, reportPath),
  };
}

function summarizeBenchmarkUsage(result: EvalSuiteResult): BenchmarkUsageSummary {
  const runs = result.scenarioResults.flatMap((scenario) => scenario.stepResults.map((step) => step.observedRun));
  const modelProfiles = Array.from(new Set(runs.flatMap((run) => [...(run.modelProfiles ?? [])]))).sort();
  const inputTokens = sumNullable(runs.map((run) => run.inputTokens));
  const outputTokens = sumNullable(runs.map((run) => run.outputTokens));
  const totalTokens = sumNullable(runs.map((run) => run.totalTokens));
  const durationMs = sumNullable(runs.map((run) => run.durationMs));
  const estimate =
    modelProfiles.length === 1
      ? estimateModelUsageCost(modelProfiles[0]!, {
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
          totalTokens: totalTokens ?? (inputTokens ?? 0) + (outputTokens ?? 0),
        })
      : {
          status: "unknown" as const,
          estimatedCostUsd: null,
          summary: `Cost estimate requires exactly one model profile, saw ${modelProfiles.length}.`,
        };
  return {
    runCount: runs.length,
    modelProfiles,
    inputTokens,
    outputTokens,
    totalTokens,
    durationMs,
    estimatedCostUsd: estimate.estimatedCostUsd,
    costStatus: estimate.status,
    costSummary: estimate.summary,
  };
}

function summarizeBenchmarkFailures(result: EvalSuiteResult): BenchmarkFailureSummary[] {
  return result.scenarioResults.flatMap((scenario) =>
    scenario.stepResults
      .filter((step) => !step.passed)
      .map((step) => ({
        scenarioId: scenario.scenarioId,
        stepId: step.stepId,
        reasons: step.reasons,
        verificationStatus: step.observedRun.verificationStatus,
        failedTools: step.observedRun.toolEvents
          .filter((event) => event.status.toLowerCase() === "failed")
          .map((event) => event.toolName),
      })),
  );
}

function renderMarkdownReport(run: PersistedBenchmarkRun, trend: ReturnType<typeof buildLongitudinalBenchmarkReport>): string {
  const failed = run.failureSummary.length === 0 ? "none" : run.failureSummary.map((entry) => entry.scenarioId).join(", ");
  return [
    "# Omni Agent Benchmark Report",
    "",
    `- Run: ${run.id}`,
    `- Mode: ${run.mode}`,
    `- Implementation: ${run.implementation}`,
    `- Manifest: ${run.manifestPath}`,
    `- Completed: ${run.completedAt}`,
    `- Overall score: ${(run.report.overallScore * 100).toFixed(1)}% (${run.report.passed ? "pass" : "fail"})`,
    `- Completion: ${(run.metrics.completionRate * 100).toFixed(1)}%`,
    `- Verification pass: ${(run.metrics.verificationPassRate * 100).toFixed(1)}%`,
    `- First pass: ${(run.metrics.firstPassRate * 100).toFixed(1)}%`,
    `- Duration: ${run.usage.durationMs ?? "n/a"} ms`,
    `- Tokens: ${formatNullableInteger(run.usage.inputTokens)} in / ${formatNullableInteger(run.usage.outputTokens)} out / ${formatNullableInteger(run.usage.totalTokens)} total`,
    `- Cost: ${run.usage.estimatedCostUsd === null ? run.usage.costSummary : `$${run.usage.estimatedCostUsd.toFixed(6)}`}`,
    `- Failed steps: ${failed}`,
    "",
    "## Trend",
    "",
    `- Runs tracked: ${trend.runCount}`,
    `- Latest run: ${trend.latestRunId ?? "n/a"}`,
    `- Baseline run: ${trend.baselineRunId ?? "n/a"}`,
    `- Overall score delta: ${trend.overallScoreDelta ?? "n/a"}`,
    `- Regressions: ${trend.regressions.length}`,
    "",
    "## Recommendations",
    "",
    ...trend.recommendations.map((recommendation) => `- ${recommendation}`),
    "",
  ].join("\n");
}

function validateBenchmarkManifest(scenarios: readonly EvalScenario[]): string[] {
  const categories = new Set(scenarios.map((scenario) => scenario.category));
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const errors: string[] = [];
  for (const category of requiredCategories) {
    if (!categories.has(category)) {
      errors.push(`Missing benchmark category: ${category}`);
    }
  }
  for (const scenarioId of requiredFailureSamples) {
    if (!scenarioIds.has(scenarioId)) {
      errors.push(`Missing failure sample: ${scenarioId}`);
    }
  }
  return errors;
}

function parseOptions(): BenchmarkOptions {
  const mode = parseMode(readOption("--mode"), readOption("--model-profile"));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    mode,
    manifestPath: readOption("--manifest") ?? "examples/evals/suite.json",
    artifactsDir: resolve(repoRoot, readOption("--artifacts-dir") ?? ".artifacts/benchmarks"),
    runId: readOption("--run-id") ?? `${timestamp}-${mode}`,
    storageRoot: readOption("--storage-root"),
    modelProfileId: readOption("--model-profile"),
    approvalPolicy: readOption("--approval-policy"),
    executionDomain: readOption("--execution-domain"),
    verificationMode: readOption("--verification-mode"),
    maxIterations: readOption("--max-iterations"),
    verificationCommands: readOptions("--verify"),
    autoApproveRisky: hasFlag("--auto-approve-risky"),
    saveArtifacts: !hasFlag("--no-save"),
  };
}

function applyRuntimeBenchmarkDefaults(options: BenchmarkOptions, suite: EvalSuiteDefinition): BenchmarkOptions {
  const requiresVerificationEvidence = (suite.qualityThresholds?.verificationPassRate ?? 0) > 0;
  if (options.mode !== "runtime" || options.verificationCommands.length > 0 || !requiresVerificationEvidence) {
    return options;
  }
  return {
    ...options,
    verificationCommands: ['node -e "require(\'fs\').accessSync(\'package.json\')"'],
  };
}

function parseMode(value: string | undefined, modelProfileId: string | undefined): BenchmarkMode {
  if (!value && modelProfileId) {
    return "openai";
  }
  if (!value || value === "synthetic") {
    return "synthetic";
  }
  if (value === "mock" || value === "openai" || value === "runtime") {
    return value;
  }
  throw new Error(`Unsupported benchmark mode ${value}. Expected synthetic, runtime, mock, or openai.`);
}

function resolveRuntimeCliMode(options: Pick<BenchmarkOptions, "mode" | "modelProfileId">): CliEvalMode {
  if (options.mode === "runtime") {
    return options.modelProfileId ? "openai" : "mock";
  }
  if (options.mode === "openai") {
    return "openai";
  }
  return "mock";
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1]?.trim() || undefined;
}

function readOptions(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) {
      const value = process.argv[index + 1]?.trim();
      if (value) {
        values.push(value);
      }
    }
  }
  return values;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function appendOption(args: string[], name: string, value: string | undefined): void {
  if (value) {
    args.push(name, value);
  }
}

function readHistory(path: string): PersistedBenchmarkRun[] {
  if (!existsSync(path)) {
    return [];
  }
  const parsed = readJsonFile<unknown>(path);
  return Array.isArray(parsed) ? (parsed as PersistedBenchmarkRun[]) : [];
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sumNullable(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) {
    return null;
  }
  return present.reduce((total, value) => total + value, 0);
}

function formatNullableInteger(value: number | null): string {
  return value === null ? "n/a" : String(value);
}

function expectedTools(scenario: EvalScenario, stepIndex: number): string[] {
  const expected = scenario.steps[stepIndex]?.expectation?.requiredToolNames;
  if (expected && expected.length > 0) {
    return [...expected];
  }
  switch (scenario.category) {
    case "long_running_automation":
      return ["create_automation", "list_automations"];
    case "memory_recall":
      return scenario.id === "stale-memory-ignored" ? ["search_memory", "read_file"] : ["search_memory"];
    case "skill_creation":
    case "skill_improvement":
      return ["skill_manage"];
    case "subagent_delegation":
    case "subagent_parallel":
      return scenario.id === "subagent-budget-handled"
        ? ["spawn_subagent", "wait_subagent"]
        : ["spawn_subagent", "collect_subagent_artifacts"];
    case "gateway_route_delivery":
    case "channel_delivery":
    case "route_handling":
      return ["deliver_route"];
    case "mcp_tool_use":
      return scenario.id === "mcp-tool-call" ? ["mcp__fixture__echo"] : ["list_mcp_resources", "read_mcp_resource"];
    case "mcp_resource":
      return ["list_mcp_resources", "read_mcp_resource"];
    case "model_fallback":
      return ["model_fallback"];
    case "verification_repair":
      return scenario.id === "approval.destructive_command_blocked" ? ["run_command"] : ["run_verification"];
    default:
      return scenario.id === "workspace.path_escape_blocked" ? ["write_file"] : ["run_verification"];
  }
}

function expectedChangedFiles(scenario: EvalScenario, stepIndex: number): string[] {
  const expected = scenario.steps[stepIndex]?.expectation?.requiredChangedFiles;
  if (expected && expected.length > 0) {
    return [...expected];
  }
  switch (scenario.category) {
    case "coding_fix":
    case "coding_bugfix":
      return scenario.id === "workspace.path_escape_blocked" ? [] : ["src/parser.ts"];
    case "verification_repair":
      return scenario.id === "approval.destructive_command_blocked" ? [] : ["src/calculator.py"];
    case "memory_recall":
    case "long_context_modification":
      return ["docs/architecture.md"];
    default:
      return [];
  }
}

function expectedFinalResponse(scenario: EvalScenario, stepIndex: number): string {
  const expected = scenario.steps[stepIndex]?.expectation?.requiredFinalResponseIncludes;
  if (expected && expected.length > 0) {
    return expected.join(" ");
  }
  const responses: Record<string, string> = {
    "coding.ts_bugfix": "parser fixed",
    "coding.python_pytest": "pytest repaired",
    "memory.recall_preference": "memory applied",
    "skill.candidate_materialization": "skill updated",
    "skill-reverify-improvement": "skill reverified",
    "subagent.parallel_review": "subagents collected",
    "gateway.route_delivery": "route delivered",
    "mcp.resource_read": "mcp resource cited",
    "mcp-tool-call": "mcp tool called",
    "model.fallback_on_rate_limit": "fallback used",
    "approval.destructive_command_blocked": "destructive command blocked",
    "workspace.path_escape_blocked": "path escape blocked",
    "stale-memory-ignored": "stale memory ignored",
    "bad-skill-not-materialized": "bad skill rejected",
    "failed-model-fallback-recovered": "failed model recovered",
    "subagent-budget-handled": "subagent budget handled",
    "automation.event-trigger": "automation triggered",
  };
  if (scenario.id === "long-context-state") {
    return stepIndex === 0 ? "phase one updated" : "phase two retained context";
  }
  return responses[scenario.id] ?? "benchmark step passed";
}
