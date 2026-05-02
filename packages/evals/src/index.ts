import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { VerificationExecutionResult, WorkspaceSnapshot } from "@omni-agent/workspace";

export type VerificationPlanMode = "auto" | "configured" | "task-specified";
export type VerificationStatus = "passed" | "failed" | "skipped";
export type VerificationEvidenceKind = "artifact" | "command" | "test" | "trace";
export type EvalScenarioCategory =
  | "channel_delivery"
  | "coding_bugfix"
  | "coding_fix"
  | "gateway_route_delivery"
  | "mcp_resource"
  | "mcp_tool_use"
  | "memory_recall"
  | "model_fallback"
  | "route_handling"
  | "skill_creation"
  | "skill_improvement"
  | "single_agent_bugfix"
  | "subagent_delegation"
  | "subagent_parallel"
  | "multi_agent_investigation"
  | "long_context_modification"
  | "long_running_automation"
  | "verification_repair";
export type CapabilityMaturityStatus = "missing" | "scaffolded" | "usable" | "mature";
export type ReferenceProject =
  | "Harness-Learning"
  | "agent-eval-learning"
  | "claudecode-source"
  | "hermes-agent-main"
  | "openclaw-main";
export type EvalScoreType = "fail" | "maturity" | "partial" | "pass" | "regression" | "risk";
export type EvalProgramUnit =
  | "final_answer"
  | "full_trace"
  | "multi_turn_session"
  | "retrieval_result_set"
  | "tool_use_episode";
export type EvalJudgeType = "deterministic" | "heuristic" | "human_review" | "llm_judge";
export type EvalReleaseGateSeverity = "advisory" | "blocking";
export type EvalReleaseGateOperator = "at_least" | "at_most" | "equals";

export interface VerificationPlan {
  readonly mode: VerificationPlanMode;
  readonly commands: string[];
  readonly summary: string;
}

export interface VerificationAssessment {
  readonly status: VerificationStatus;
  readonly summary: string;
  readonly commands: string[];
}

export interface EvalVerificationEvidence {
  readonly kind: VerificationEvidenceKind;
  readonly status: VerificationStatus;
  readonly command?: string;
  readonly artifactPath?: string;
  readonly summary?: string;
}

export interface VerificationNativePolicyDefinition {
  readonly completionRequiresEvidence?: boolean;
  readonly minimumEvidenceCount?: number;
  readonly requiredEvidenceKinds?: readonly VerificationEvidenceKind[];
}

export interface VerificationNativePolicy extends VerificationNativePolicyDefinition {
  readonly completionRequiresEvidence: boolean;
  readonly minimumEvidenceCount: number;
  readonly requiredEvidenceKinds: readonly VerificationEvidenceKind[];
}

export interface EvalStepExpectation {
  readonly verificationStatus?: VerificationStatus;
  readonly requiredChangedFiles?: string[];
  readonly requiredToolNames?: string[];
  readonly requiredSuccessfulToolNames?: string[];
  readonly requiredFinalResponseIncludes?: string[];
  readonly requiredVerificationEvidenceKinds?: readonly VerificationEvidenceKind[];
}

export interface EvalScenarioStepDefinition {
  readonly id?: string;
  readonly objective: string;
  readonly successCriteria?: string[];
  readonly constraints?: string[];
  readonly verificationCommands?: string[];
  readonly maxIterations?: number;
  readonly expectation?: EvalStepExpectation;
}

export interface EvalScenarioDefinition {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
  readonly category: EvalScenarioCategory;
  readonly workspaceCwd?: string;
  readonly threadTitle?: string;
  readonly steps: readonly EvalScenarioStepDefinition[];
}

export interface EvalProgramDatasetDefinition {
  readonly minExamples?: number;
  readonly sources?: readonly string[];
  readonly samplingStrategy?: string;
  readonly labelingProcess?: string;
  readonly versioning?: string;
  readonly failureCategories?: readonly string[];
}

export interface EvalProgramJudgeDefinition {
  readonly id: string;
  readonly type: EvalJudgeType;
  readonly description?: string;
  readonly rubric?: readonly string[];
  readonly calibration?: string;
}

export interface EvalProgramMetricDefinition {
  readonly id: string;
  readonly description?: string;
  readonly target?: string;
}

export interface EvalProgramReleaseGateDefinition {
  readonly id: string;
  readonly metricId: string;
  readonly operator?: EvalReleaseGateOperator;
  readonly threshold?: number;
  readonly severity?: EvalReleaseGateSeverity;
  readonly description?: string;
}

export interface EvalProgramDefinition {
  readonly supportedDecision: string;
  readonly evalUnit: EvalProgramUnit;
  readonly dataset: EvalProgramDatasetDefinition;
  readonly judges: readonly EvalProgramJudgeDefinition[];
  readonly metrics: readonly EvalProgramMetricDefinition[];
  readonly releaseGates: readonly EvalProgramReleaseGateDefinition[];
  readonly operationalMetrics?: readonly string[];
  readonly reviewCadence?: string;
  readonly traceArtifacts?: readonly string[];
  readonly sourceProjects?: readonly string[];
}

export interface EvalProgramDataset extends Required<EvalProgramDatasetDefinition> {}

export interface EvalProgramJudge extends Omit<EvalProgramJudgeDefinition, "calibration" | "description" | "rubric"> {
  readonly description?: string;
  readonly rubric: readonly string[];
  readonly calibration?: string;
}

export interface EvalProgramMetric extends Omit<EvalProgramMetricDefinition, "description" | "target"> {
  readonly description?: string;
  readonly target?: string;
}

export interface EvalProgramReleaseGate
  extends Omit<EvalProgramReleaseGateDefinition, "description" | "operator" | "severity" | "threshold"> {
  readonly operator: EvalReleaseGateOperator;
  readonly severity: EvalReleaseGateSeverity;
  readonly threshold?: number;
  readonly description?: string;
}

export interface EvalProgram extends Omit<EvalProgramDefinition, "dataset" | "judges" | "metrics" | "releaseGates"> {
  readonly dataset: EvalProgramDataset;
  readonly judges: readonly EvalProgramJudge[];
  readonly metrics: readonly EvalProgramMetric[];
  readonly releaseGates: readonly EvalProgramReleaseGate[];
  readonly operationalMetrics: readonly string[];
  readonly traceArtifacts: readonly string[];
  readonly sourceProjects: readonly string[];
}

export interface EvalProgramReadinessIssue {
  readonly field: string;
  readonly severity: "error" | "warning";
  readonly reason: string;
}

export interface EvalProgramReadinessReport {
  readonly generatedAt: string;
  readonly ready: boolean;
  readonly issueCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly releaseGateCount: number;
  readonly blockingGateCount: number;
  readonly judgeTypes: readonly EvalJudgeType[];
  readonly failureCategories: readonly string[];
  readonly issues: readonly EvalProgramReadinessIssue[];
  readonly recommendations: readonly string[];
}

export interface EvalSuiteDefinition {
  readonly title?: string;
  readonly description?: string;
  readonly program?: EvalProgramDefinition;
  readonly verificationPolicy?: VerificationNativePolicyDefinition;
  readonly qualityThresholds?: BenchmarkQualityThresholds;
  readonly scenarios: readonly EvalScenarioDefinition[];
}

export interface CapabilityScorecardItemDefinition {
  readonly id: string;
  readonly title?: string;
  readonly status: CapabilityMaturityStatus;
  readonly referenceProject?: ReferenceProject | readonly ReferenceProject[];
  readonly referenceStrength?: string;
  readonly evidence?: readonly string[];
  readonly evidenceFiles?: readonly string[];
  readonly matureEvidenceFiles?: readonly string[];
  readonly matureBenchmarkScenarioIds?: readonly string[];
  readonly liveOrContractTests?: readonly string[];
  readonly operationalRunbook?: string;
  readonly failureRecoveryTests?: readonly string[];
  readonly matureCriteria?: readonly string[];
  readonly blockedBy?: readonly string[];
  readonly nextMilestone?: string;
  readonly requiredTests?: readonly string[];
  readonly scenarioIds?: readonly string[];
}

export interface CapabilityScorecardItem
  extends Omit<
    CapabilityScorecardItemDefinition,
    | "blockedBy"
    | "evidence"
    | "evidenceFiles"
    | "failureRecoveryTests"
    | "liveOrContractTests"
    | "matureBenchmarkScenarioIds"
    | "matureCriteria"
    | "matureEvidenceFiles"
    | "referenceProject"
    | "requiredTests"
    | "scenarioIds"
    | "title"
  > {
  readonly title: string;
  readonly evidence: readonly string[];
  readonly evidenceFiles: readonly string[];
  readonly matureEvidenceFiles: readonly string[];
  readonly matureBenchmarkScenarioIds: readonly string[];
  readonly liveOrContractTests: readonly string[];
  readonly failureRecoveryTests: readonly string[];
  readonly matureCriteria: readonly string[];
  readonly blockedBy: readonly string[];
  readonly referenceProject: readonly ReferenceProject[];
  readonly requiredTests: readonly string[];
  readonly scenarioIds: readonly string[];
}

export interface CapabilityScorecardDefinition extends EvalSuiteDefinition {
  readonly capabilities?: readonly CapabilityScorecardItemDefinition[];
}

export interface CapabilityScorecard extends EvalSuite {
  readonly capabilities: readonly CapabilityScorecardItem[];
}

export interface CapabilityMaturityValidationIssue {
  readonly capabilityId: string;
  readonly status: CapabilityMaturityStatus;
  readonly severity: "error" | "warning";
  readonly reason: string;
}

export interface CapabilityMaturityReport {
  readonly capabilityCount: number;
  readonly countsByStatus: Readonly<Record<CapabilityMaturityStatus, number>>;
  readonly scoreByStatus: Readonly<Record<CapabilityMaturityStatus, number>>;
  readonly totalScore: number;
  readonly maxScore: number;
  readonly maturityRate: number;
  readonly issues: readonly CapabilityMaturityValidationIssue[];
}

export interface CapabilityMaturityValidationOptions {
  readonly passingScenarioIds?: ReadonlySet<string>;
  readonly requirePassingScenariosForUsable?: boolean;
  readonly requirePassingScenariosForMature?: boolean;
  readonly requireMatureBenchmarkScenarios?: boolean;
}

export interface EvalScenarioStep extends EvalScenarioStepDefinition {
  readonly id: string;
}

export interface EvalScenario {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly category: EvalScenarioCategory;
  readonly workspaceCwd: string;
  readonly threadTitle?: string;
  readonly steps: readonly EvalScenarioStep[];
}

export interface EvalSuite {
  readonly title: string;
  readonly description?: string;
  readonly program?: EvalProgram;
  readonly verificationPolicy?: VerificationNativePolicy;
  readonly qualityThresholds?: BenchmarkQualityThresholds;
  readonly scenarios: readonly EvalScenario[];
}

export interface EvalObservedToolEvent {
  readonly toolName: string;
  readonly status: string;
}

export interface EvalObservedRun {
  readonly runId?: string;
  readonly threadId?: string;
  readonly verificationStatus: VerificationStatus;
  readonly verificationEvidence?: readonly EvalVerificationEvidence[];
  readonly finalResponse: string;
  readonly changedFiles: readonly string[];
  readonly toolEvents: readonly EvalObservedToolEvent[];
  readonly modelProfiles?: readonly string[];
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly totalTokens?: number | null;
  readonly memoryUseful?: boolean;
  readonly toolSafetyViolation?: boolean;
  readonly fallbackRecovered?: boolean;
  readonly toolCallCount: number;
  readonly turnCount: number;
  readonly durationMs: number | null;
}

export interface EvalExecutionRequest {
  readonly scenario: EvalScenario;
  readonly step: EvalScenarioStep;
  readonly stepIndex: number;
  readonly priorRuns: readonly EvalObservedRun[];
  readonly threadId?: string;
}

export interface EvalExecutionOutcome {
  readonly observedRun: EvalObservedRun;
  readonly threadId?: string;
}

export type EvalScenarioExecutor = (request: EvalExecutionRequest) => Promise<EvalExecutionOutcome>;

export interface EvalStepResult {
  readonly scenarioId: string;
  readonly category: EvalScenarioCategory;
  readonly stepId: string;
  readonly objective: string;
  readonly passed: boolean;
  readonly scoreType: EvalScoreType;
  readonly reasons: string[];
  readonly firstPass: boolean;
  readonly verificationFailedInitially: boolean;
  readonly repairedAfterVerificationFailure: boolean;
  readonly toolCallCount: number;
  readonly turnCount: number;
  readonly durationMs: number | null;
  readonly observedRun: EvalObservedRun;
}

export interface EvalScenarioResult {
  readonly scenarioId: string;
  readonly title: string;
  readonly category: EvalScenarioCategory;
  readonly workspaceCwd: string;
  readonly completed: boolean;
  readonly scoreType: EvalScoreType;
  readonly firstPass: boolean;
  readonly hadVerificationFailure: boolean;
  readonly repairedAfterVerificationFailure: boolean;
  readonly averageToolCallCount: number;
  readonly stateRetained: boolean | null;
  readonly stepResults: readonly EvalStepResult[];
}

export interface EvalSuiteMetrics {
  readonly scenarioCount: number;
  readonly completedCount: number;
  readonly firstPassCount: number;
  readonly repairEligibleCount: number;
  readonly repairedCount: number;
  readonly longContextScenarioCount: number;
  readonly retainedStateCount: number;
  readonly memoryUsefulCount: number;
  readonly toolSafetyViolationCount: number;
  readonly fallbackEligibleCount: number;
  readonly fallbackRecoveredCount: number;
  readonly runCount: number;
  readonly verificationPassedCount: number;
  readonly completionRate: number;
  readonly verificationPassRate: number;
  readonly firstPassRate: number;
  readonly repairRate: number | null;
  readonly averageToolCallCount: number;
  readonly toolFailureRate: number;
  readonly memoryHitRate: number | null;
  readonly memoryUsefulnessRate: number | null;
  readonly toolSafetyViolationRate: number;
  readonly routeDeliverySuccessRate: number | null;
  readonly fallbackRecoveryRate: number | null;
  readonly stateRetentionRate: number | null;
}

export interface EvalSuiteResult {
  readonly title: string;
  readonly description?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly verificationPolicy?: VerificationNativePolicy;
  readonly qualityThresholds?: BenchmarkQualityThresholds;
  readonly scenarioResults: readonly EvalScenarioResult[];
  readonly metrics: EvalSuiteMetrics;
}

export interface BenchmarkQualityThresholds {
  readonly completionRate?: number;
  readonly verificationPassRate?: number;
  readonly firstPassRate?: number;
  readonly repairRate?: number;
  readonly toolReliabilityRate?: number;
  readonly memoryHitRate?: number;
  readonly memoryUsefulnessRate?: number;
  readonly toolSafetyRate?: number;
  readonly routeDeliverySuccessRate?: number;
  readonly fallbackRecoveryRate?: number;
  readonly stateRetentionRate?: number;
  readonly efficiencyScore?: number;
  readonly targetAverageToolCalls?: number;
}

export interface BenchmarkQualityDimensionScore {
  readonly id: string;
  readonly label: string;
  readonly score: number | null;
  readonly threshold: number | null;
  readonly passed: boolean | null;
  readonly scoreType: EvalScoreType;
  readonly weight: number;
  readonly summary: string;
}

export interface BenchmarkQualityReport {
  readonly suiteTitle: string;
  readonly generatedAt: string;
  readonly overallScore: number;
  readonly passed: boolean;
  readonly thresholds: Required<BenchmarkQualityThresholds>;
  readonly dimensions: readonly BenchmarkQualityDimensionScore[];
  readonly categoryBreakdown: readonly {
    readonly category: EvalScenarioCategory;
    readonly scenarioCount: number;
    readonly completedCount: number;
    readonly completionRate: number;
    readonly averageToolCallCount: number;
  }[];
  readonly recommendations: readonly string[];
}

export interface LongitudinalBenchmarkRun {
  readonly id: string;
  readonly completedAt: string;
  readonly report: BenchmarkQualityReport;
}

export interface LongitudinalBenchmarkReport {
  readonly generatedAt: string;
  readonly runCount: number;
  readonly latestRunId: string | null;
  readonly baselineRunId: string | null;
  readonly latestOverallScore: number | null;
  readonly baselineOverallScore: number | null;
  readonly overallScoreDelta: number | null;
  readonly regressions: readonly {
    readonly dimensionId: string;
    readonly label: string;
    readonly baselineScore: number | null;
    readonly latestScore: number | null;
    readonly delta: number | null;
  }[];
  readonly trend: readonly {
    readonly runId: string;
    readonly completedAt: string;
    readonly overallScore: number;
    readonly passed: boolean;
  }[];
  readonly recommendations: readonly string[];
}

export interface LocalBenchmarkTaskDefinition {
  readonly id: string;
  readonly prompt: string;
  readonly workspaceCwd?: string;
  readonly verificationCommands?: readonly string[];
  readonly timeoutMs?: number;
  readonly score?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface LocalBenchmarkSuiteDefinition {
  readonly title?: string;
  readonly description?: string;
  readonly defaultWorkspaceCwd?: string;
  readonly defaultTimeoutMs?: number;
  readonly maxConcurrency?: number;
  readonly tasks: readonly LocalBenchmarkTaskDefinition[];
}

export interface LocalBenchmarkTask {
  readonly id: string;
  readonly prompt: string;
  readonly workspaceCwd: string;
  readonly verificationCommands: readonly string[];
  readonly timeoutMs: number;
  readonly score: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface LocalBenchmarkSuite {
  readonly title: string;
  readonly description?: string;
  readonly maxConcurrency: number;
  readonly tasks: readonly LocalBenchmarkTask[];
}

export interface LocalBenchmarkTaskRequest {
  readonly task: LocalBenchmarkTask;
  readonly taskIndex: number;
}

export interface LocalBenchmarkTaskExecution {
  readonly finalResponse?: string;
  readonly changedFiles?: readonly string[];
  readonly toolEvents?: readonly EvalObservedToolEvent[];
}

export type LocalBenchmarkTaskExecutor = (
  request: LocalBenchmarkTaskRequest,
) => Promise<LocalBenchmarkTaskExecution>;

export interface LocalBenchmarkCommandResult {
  readonly command: string;
  readonly cwd: string;
  readonly ok: boolean;
  readonly timedOut: boolean;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface LocalBenchmarkTaskResult {
  readonly taskId: string;
  readonly prompt: string;
  readonly workspaceCwd: string;
  readonly passed: boolean;
  readonly score: number;
  readonly maxScore: number;
  readonly verificationStatus: VerificationStatus;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly executorError?: string;
  readonly finalResponse: string;
  readonly changedFiles: readonly string[];
  readonly toolEvents: readonly EvalObservedToolEvent[];
  readonly verificationResults: readonly LocalBenchmarkCommandResult[];
}

export interface LocalBenchmarkSuiteResult {
  readonly title: string;
  readonly description?: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly maxConcurrency: number;
  readonly taskCount: number;
  readonly completedCount: number;
  readonly passedCount: number;
  readonly timeoutCount: number;
  readonly totalScore: number;
  readonly maxScore: number;
  readonly scoreRate: number;
  readonly results: readonly LocalBenchmarkTaskResult[];
}

export function inferVerificationPlan(snapshot: WorkspaceSnapshot): VerificationPlan {
  const commands: string[] = [];

  if (snapshot.packageManager === "pnpm" || snapshot.packageManager === "npm") {
    if (snapshot.packageScripts.includes("test")) {
      commands.push(snapshot.packageManager === "pnpm" ? "pnpm test" : "npm test");
    }
    if (snapshot.packageScripts.includes("lint")) {
      commands.push(snapshot.packageManager === "pnpm" ? "pnpm lint" : "npm run lint");
    }
    if (snapshot.packageScripts.includes("typecheck")) {
      commands.push(snapshot.packageManager === "pnpm" ? "pnpm typecheck" : "npm run typecheck");
    }
    if (snapshot.packageScripts.includes("build")) {
      commands.push(snapshot.packageManager === "pnpm" ? "pnpm build" : "npm run build");
    }
  } else if (snapshot.packageManager === "python") {
    commands.push("python -m pytest");
  } else if (snapshot.packageManager === "cargo") {
    commands.push("cargo test");
  }

  if (commands.length === 0 && snapshot.detectedFiles.includes("verify.js")) {
    commands.push("node verify.js");
  }

  return {
    mode: "auto",
    commands,
    summary:
      commands.length > 0
        ? `Inferred verification commands: ${commands.join(" -> ")}`
        : "No repository-aware verification command was inferred.",
  };
}

export function assessVerification(
  plan: VerificationPlan,
  executionResult: VerificationExecutionResult | null,
): VerificationAssessment {
  if (plan.commands.length === 0) {
    return {
      status: "skipped",
      summary: "Verification skipped because no verification command was inferred.",
      commands: plan.commands,
    };
  }

  if (!executionResult) {
    return {
      status: "skipped",
      summary: `Verification commands were available (${plan.commands.join(" -> ")}), but no verification run was executed.`,
      commands: plan.commands,
    };
  }

  return {
    status: executionResult.ok ? "passed" : "failed",
    summary: executionResult.ok
      ? `Verification passed across ${executionResult.results.length} command(s).`
      : `Verification failed on command: ${executionResult.results.find((result) => !result.ok)?.command ?? "unknown"}`,
    commands: plan.commands,
  };
}

export function normalizeEvalSuiteDefinition(
  definition: EvalSuiteDefinition,
  options: {
    readonly baseDir?: string;
    readonly defaultWorkspaceCwd?: string;
  } = {},
): EvalSuite {
  const baseDir = resolve(options.baseDir ?? process.cwd());
  const defaultWorkspaceCwd = options.defaultWorkspaceCwd ? resolve(options.defaultWorkspaceCwd) : baseDir;
  const scenarios = definition.scenarios ?? [];
  if (scenarios.length === 0) {
    throw new Error("Eval suite must include at least one scenario.");
  }

  return {
    title: normalizeText(definition.title) ?? "Omni Agent Eval Suite",
    description: normalizeText(definition.description),
    program: definition.program ? normalizeEvalProgram(definition.program) : undefined,
    verificationPolicy: normalizeVerificationNativePolicy(definition.verificationPolicy),
    qualityThresholds: definition.qualityThresholds,
    scenarios: scenarios.map((scenario, scenarioIndex) => normalizeEvalScenario(scenario, scenarioIndex, baseDir, defaultWorkspaceCwd)),
  };
}

export function normalizeCapabilityScorecardDefinition(
  definition: CapabilityScorecardDefinition,
  options: {
    readonly baseDir?: string;
    readonly defaultWorkspaceCwd?: string;
  } = {},
): CapabilityScorecard {
  const suite = normalizeEvalSuiteDefinition(definition, options);
  const knownScenarioIds = new Set(suite.scenarios.map((scenario) => scenario.id));
  return {
    ...suite,
    capabilities: (definition.capabilities ?? []).map((capability, index) =>
      normalizeCapabilityScorecardItem(capability, index, knownScenarioIds),
    ),
  };
}

export function validateCapabilityMaturityClaims(
  scorecard: CapabilityScorecard,
  options: CapabilityMaturityValidationOptions = {},
): CapabilityMaturityValidationIssue[] {
  const issues: CapabilityMaturityValidationIssue[] = [];
  const requirePassingScenariosForUsable = options.requirePassingScenariosForUsable ?? false;
  const requirePassingScenariosForMature = options.requirePassingScenariosForMature ?? true;
  const requireMatureBenchmarkScenarios = options.requireMatureBenchmarkScenarios ?? true;

  for (const capability of scorecard.capabilities) {
    if (capability.status === "missing") {
      continue;
    }

    if (capability.referenceProject.length === 0) {
      issues.push({
        capabilityId: capability.id,
        status: capability.status,
        severity: capability.status === "scaffolded" ? "warning" : "error",
        reason: "Implemented or claimed capabilities must name at least one reference project.",
      });
    }

    if (capability.status !== "scaffolded" && capability.evidenceFiles.length === 0) {
      issues.push({
        capabilityId: capability.id,
        status: capability.status,
        severity: "error",
        reason: "Usable and mature capabilities must cite implementation evidence files.",
      });
    }

    if (capability.status !== "scaffolded" && capability.requiredTests.length === 0) {
      issues.push({
        capabilityId: capability.id,
        status: capability.status,
        severity: "error",
        reason: "Usable and mature capabilities must cite at least one required test.",
      });
    }

    if (capability.status !== "scaffolded" && capability.scenarioIds.length === 0) {
      issues.push({
        capabilityId: capability.id,
        status: capability.status,
        severity: "error",
        reason: "Usable and mature capabilities must be linked to at least one eval scenario.",
      });
    }

    if (capability.status === "mature") {
      if (!capability.referenceStrength) {
        issues.push({
          capabilityId: capability.id,
          status: capability.status,
          severity: "error",
          reason: "Mature capabilities must document the reference strength they claim to match.",
        });
      }
      if (capability.matureEvidenceFiles.length === 0) {
        issues.push({
          capabilityId: capability.id,
          status: capability.status,
          severity: "error",
          reason: "Mature capabilities must cite mature evidence files beyond baseline implementation evidence.",
        });
      }
      if (capability.liveOrContractTests.length === 0) {
        issues.push({
          capabilityId: capability.id,
          status: capability.status,
          severity: "error",
          reason: "Mature capabilities must cite at least one live or contract test.",
        });
      }
      if (requireMatureBenchmarkScenarios && capability.matureBenchmarkScenarioIds.length === 0) {
        issues.push({
          capabilityId: capability.id,
          status: capability.status,
          severity: "error",
          reason: "Mature capabilities must cite at least one benchmark scenario that must pass before release.",
        });
      }
      if (!capability.operationalRunbook) {
        issues.push({
          capabilityId: capability.id,
          status: capability.status,
          severity: "error",
          reason: "Mature capabilities must cite an operational runbook.",
        });
      }
      if (capability.failureRecoveryTests.length === 0) {
        issues.push({
          capabilityId: capability.id,
          status: capability.status,
          severity: "error",
          reason: "Mature capabilities must cite failure recovery tests.",
        });
      }
      if (capability.matureCriteria.length === 0) {
        issues.push({
          capabilityId: capability.id,
          status: capability.status,
          severity: "error",
          reason: "Mature capabilities must document explicit mature criteria.",
        });
      }
      if (!capability.nextMilestone) {
        issues.push({
          capabilityId: capability.id,
          status: capability.status,
          severity: "warning",
          reason: "Mature capabilities should still record the next hardening milestone.",
        });
      }
    }

    const shouldRequirePassingCoverage =
      capability.status === "mature"
        ? requirePassingScenariosForMature
        : capability.status === "usable" && requirePassingScenariosForUsable;
    if (shouldRequirePassingCoverage && options.passingScenarioIds) {
      const coverageScenarioIds =
        capability.status === "mature" && capability.matureBenchmarkScenarioIds.length > 0
          ? capability.matureBenchmarkScenarioIds
          : capability.scenarioIds;
      const missingPassingScenarioIds = coverageScenarioIds.filter((scenarioId) => !options.passingScenarioIds?.has(scenarioId));
      if (missingPassingScenarioIds.length > 0) {
        issues.push({
          capabilityId: capability.id,
          status: capability.status,
          severity: "error",
          reason: `Capability has non-passing or missing benchmark scenario coverage: ${missingPassingScenarioIds.join(", ")}.`,
        });
      }
    }
  }

  return issues;
}

export function buildCapabilityMaturityReport(
  scorecard: CapabilityScorecard,
  options: CapabilityMaturityValidationOptions = {},
): CapabilityMaturityReport {
  const countsByStatus: Record<CapabilityMaturityStatus, number> = {
    missing: 0,
    scaffolded: 0,
    usable: 0,
    mature: 0,
  };
  const scoreByStatus: Record<CapabilityMaturityStatus, number> = {
    missing: 0,
    scaffolded: 1,
    usable: 2,
    mature: 3,
  };
  let totalScore = 0;
  for (const capability of scorecard.capabilities) {
    countsByStatus[capability.status] += 1;
    totalScore += scoreByStatus[capability.status];
  }
  const maxScore = scorecard.capabilities.length * scoreByStatus.mature;
  return {
    capabilityCount: scorecard.capabilities.length,
    countsByStatus,
    scoreByStatus,
    totalScore,
    maxScore,
    maturityRate: maxScore === 0 ? 0 : roundRate(totalScore / maxScore),
    issues: validateCapabilityMaturityClaims(scorecard, options),
  };
}

export function buildEvalProgramReadinessReport(suite: EvalSuite): EvalProgramReadinessReport {
  const issues: EvalProgramReadinessIssue[] = [];
  const program = suite.program;
  if (!program) {
    issues.push({
      field: "program",
      severity: "error",
      reason: "Eval suite must include an eval program spec before it can support release decisions.",
    });
    return finalizeEvalProgramReadinessReport(null, issues);
  }

  const agentCategories = new Set<EvalScenarioCategory>([
    "coding_bugfix",
    "coding_fix",
    "gateway_route_delivery",
    "long_context_modification",
    "long_running_automation",
    "memory_recall",
    "model_fallback",
    "mcp_resource",
    "mcp_tool_use",
    "multi_agent_investigation",
    "route_handling",
    "single_agent_bugfix",
    "skill_creation",
    "skill_improvement",
    "subagent_delegation",
    "subagent_parallel",
    "verification_repair",
  ]);
  const evaluatesAgentWork = suite.scenarios.some((scenario) => agentCategories.has(scenario.category));
  if (evaluatesAgentWork && program.evalUnit === "final_answer") {
    issues.push({
      field: "program.evalUnit",
      severity: "error",
      reason: "Agent eval suites must use full_trace, multi_turn_session, or tool_use_episode instead of final_answer only.",
    });
  }

  if (program.dataset.minExamples <= 0) {
    issues.push({
      field: "program.dataset.minExamples",
      severity: "error",
      reason: "Dataset must declare at least one curated example.",
    });
  } else if (program.dataset.minExamples < 30) {
    issues.push({
      field: "program.dataset.minExamples",
      severity: "warning",
      reason: "Reference guidance recommends starting with roughly 30 to 100 curated examples.",
    });
  }
  if (program.dataset.sources.length === 0) {
    issues.push({
      field: "program.dataset.sources",
      severity: "error",
      reason: "Dataset sources must be recorded so failures can be traced back to real workflows.",
    });
  }
  if (program.dataset.failureCategories.length === 0) {
    issues.push({
      field: "program.dataset.failureCategories",
      severity: "error",
      reason: "Dataset must tag failure categories for per-category regression analysis.",
    });
  }
  if (!program.dataset.labelingProcess) {
    issues.push({
      field: "program.dataset.labelingProcess",
      severity: "warning",
      reason: "Dataset should explain how examples are labeled or reviewed.",
    });
  }
  if (!program.dataset.versioning) {
    issues.push({
      field: "program.dataset.versioning",
      severity: "warning",
      reason: "Dataset should declare a versioning rule before benchmark history is treated as stable.",
    });
  }

  if (program.judges.length === 0) {
    issues.push({
      field: "program.judges",
      severity: "error",
      reason: "Eval program must define at least one judge.",
    });
  }
  const judgeTypes = new Set(program.judges.map((judge) => judge.type));
  if (judgeTypes.size < 2) {
    issues.push({
      field: "program.judges",
      severity: "warning",
      reason: "Use more than one judge role when possible to avoid single-judge blind spots.",
    });
  }
  if (!judgeTypes.has("deterministic") && !judgeTypes.has("heuristic")) {
    issues.push({
      field: "program.judges",
      severity: "warning",
      reason: "Add deterministic or heuristic checks for cheap, stable regression coverage.",
    });
  }
  if (program.judges.some((judge) => judge.type === "llm_judge" && judge.rubric.length === 0)) {
    issues.push({
      field: "program.judges",
      severity: "error",
      reason: "LLM judges must include a rubric before their scores can be trusted.",
    });
  }

  const metricIds = new Set(program.metrics.map((metric) => metric.id));
  if (metricIds.size === 0) {
    issues.push({
      field: "program.metrics",
      severity: "error",
      reason: "Eval program must define the metrics it reports.",
    });
  }
  if (program.releaseGates.length === 0) {
    issues.push({
      field: "program.releaseGates",
      severity: "error",
      reason: "Eval program must define release gates that can block shipping.",
    });
  }
  for (const gate of program.releaseGates) {
    if (!metricIds.has(gate.metricId)) {
      issues.push({
        field: `program.releaseGates.${gate.id}`,
        severity: "error",
        reason: `Release gate references unknown metric ${gate.metricId}.`,
      });
    }
  }

  const operationalMetrics = new Set(program.operationalMetrics);
  for (const metric of ["latency", "cost", "tool_calls", "retries"]) {
    if (!operationalMetrics.has(metric)) {
      issues.push({
        field: "program.operationalMetrics",
        severity: "warning",
        reason: `Operational metric ${metric} should be tracked for agent evals.`,
      });
    }
  }
  if (evaluatesAgentWork) {
    const traceArtifacts = new Set(program.traceArtifacts);
    for (const artifact of ["tool_calls", "verification_results", "final_response"]) {
      if (!traceArtifacts.has(artifact)) {
        issues.push({
          field: "program.traceArtifacts",
          severity: "warning",
          reason: `Agent evals should capture ${artifact} as trace evidence.`,
        });
      }
    }
  }
  if (!program.reviewCadence) {
    issues.push({
      field: "program.reviewCadence",
      severity: "warning",
      reason: "Eval program should declare a review cadence for prompt, model, and tool changes.",
    });
  }

  return finalizeEvalProgramReadinessReport(program, issues);
}

export async function runEvalSuite(
  suite: EvalSuite,
  executor: EvalScenarioExecutor,
): Promise<EvalSuiteResult> {
  const startedAt = new Date().toISOString();
  const scenarioResults: EvalScenarioResult[] = [];

  for (const scenario of suite.scenarios) {
    let threadId: string | undefined = undefined;
    const observedRuns: EvalObservedRun[] = [];

    for (let stepIndex = 0; stepIndex < scenario.steps.length; stepIndex += 1) {
      const step = scenario.steps[stepIndex];
      if (!step) {
        continue;
      }
      const outcome = await executor({
        scenario,
        step,
        stepIndex,
        priorRuns: observedRuns,
        threadId,
      });
      observedRuns.push(outcome.observedRun);
      threadId = outcome.threadId ?? outcome.observedRun.threadId ?? threadId;
    }

    scenarioResults.push(evaluateScenarioResult(scenario, observedRuns, suite.verificationPolicy));
  }

  return {
    title: suite.title,
    description: suite.description,
    startedAt,
    completedAt: new Date().toISOString(),
    verificationPolicy: suite.verificationPolicy,
    qualityThresholds: suite.qualityThresholds,
    scenarioResults,
    metrics: summarizeEvalSuiteMetrics(scenarioResults),
  };
}

export function evaluateScenarioResult(
  scenario: EvalScenario,
  observedRuns: readonly EvalObservedRun[],
  verificationPolicy?: VerificationNativePolicy,
): EvalScenarioResult {
  if (observedRuns.length !== scenario.steps.length) {
    throw new Error(
      `Scenario ${scenario.id} expected ${scenario.steps.length} observed run(s), received ${observedRuns.length}.`,
    );
  }

  const stepResults = scenario.steps.map((step, index) =>
    evaluateStepResult(scenario, step, observedRuns[index] ?? null, verificationPolicy),
  );
  const completed = stepResults.every((result) => result.passed);
  const firstPass = completed && stepResults.every((result) => result.firstPass);
  const hadVerificationFailure = stepResults.some((result) => result.verificationFailedInitially);
  const repairedAfterVerificationFailure = completed && hadVerificationFailure;
  const scoreType = classifyScenarioScore(stepResults);
  const averageToolCallCount =
    stepResults.reduce((total, result) => total + result.toolCallCount, 0) / Math.max(stepResults.length, 1);
  const stateRetained =
    scenario.category === "long_context_modification" && stepResults.length > 1
      ? stepResults.slice(1).every((result) => result.passed)
      : null;

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    category: scenario.category,
    workspaceCwd: scenario.workspaceCwd,
    completed,
    scoreType,
    firstPass,
    hadVerificationFailure,
    repairedAfterVerificationFailure,
    averageToolCallCount,
    stateRetained,
    stepResults,
  };
}

export function summarizeEvalSuiteMetrics(results: readonly EvalScenarioResult[]): EvalSuiteMetrics {
  const scenarioCount = results.length;
  const completedCount = results.filter((result) => result.completed).length;
  const firstPassCount = results.filter((result) => result.firstPass).length;
  const repairEligibleCount = results.filter((result) => result.hadVerificationFailure).length;
  const repairedCount = results.filter((result) => result.repairedAfterVerificationFailure).length;
  const longContextResults = results.filter((result) => result.category === "long_context_modification");
  const retainedStateCount = longContextResults.filter((result) => result.stateRetained === true).length;
  const runCount = results.reduce((total, result) => total + result.stepResults.length, 0);
  const totalToolCalls = results.reduce(
    (total, result) => total + result.stepResults.reduce((stepTotal, step) => stepTotal + step.toolCallCount, 0),
    0,
  );
  const allSteps = results.flatMap((result) => [...result.stepResults]);
  const verificationPassedCount = allSteps.filter((step) => step.observedRun.verificationStatus === "passed").length;
  const toolEvents = allSteps.flatMap((step) => [...step.observedRun.toolEvents]);
  const failedToolEvents = toolEvents.filter(
    (event) => event.status.toLowerCase() === "failed" && event.toolName !== "run_verification",
  );
  const memorySteps = allSteps.filter((step) =>
    step.observedRun.toolEvents.some((event) => event.toolName === "search_memory" || event.toolName === "search_profile"),
  );
  const successfulMemorySteps = memorySteps.filter((step) =>
    step.observedRun.toolEvents.some(
      (event) =>
        (event.toolName === "search_memory" || event.toolName === "search_profile") &&
        event.status.toLowerCase() !== "failed",
    ),
  );
  const memoryUsefulCount = memorySteps.filter((step) => step.observedRun.memoryUseful !== false).length;
  const toolSafetyViolationCount = allSteps.filter((step) => step.observedRun.toolSafetyViolation === true).length;
  const routeSteps = allSteps.filter((step) =>
    step.observedRun.toolEvents.some(
      (event) =>
        event.toolName === "route_delivery" ||
        event.toolName === "gateway_route_delivery" ||
        event.toolName === "deliver_route" ||
        event.toolName === "create_automation" ||
        event.toolName === "list_automations",
    ),
  );
  const successfulRouteSteps = routeSteps.filter((step) =>
    step.observedRun.toolEvents.some(
      (event) =>
        (event.toolName === "route_delivery" ||
          event.toolName === "gateway_route_delivery" ||
          event.toolName === "deliver_route" ||
          event.toolName === "create_automation" ||
          event.toolName === "list_automations") &&
        event.status.toLowerCase() !== "failed",
    ),
  );
  const fallbackSteps = allSteps.filter(
    (step) =>
      step.category === "model_fallback" ||
      step.observedRun.toolEvents.some((event) => event.toolName === "model_fallback"),
  );
  const fallbackRecoveredCount = fallbackSteps.filter(
    (step) => step.observedRun.fallbackRecovered !== false && step.passed,
  ).length;

  return {
    scenarioCount,
    completedCount,
    firstPassCount,
    repairEligibleCount,
    repairedCount,
    longContextScenarioCount: longContextResults.length,
    retainedStateCount,
    memoryUsefulCount,
    toolSafetyViolationCount,
    fallbackEligibleCount: fallbackSteps.length,
    fallbackRecoveredCount,
    runCount,
    verificationPassedCount,
    completionRate: scenarioCount === 0 ? 0 : completedCount / scenarioCount,
    verificationPassRate: runCount === 0 ? 0 : verificationPassedCount / runCount,
    firstPassRate: scenarioCount === 0 ? 0 : firstPassCount / scenarioCount,
    repairRate: repairEligibleCount === 0 ? null : repairedCount / repairEligibleCount,
    averageToolCallCount: runCount === 0 ? 0 : totalToolCalls / runCount,
    toolFailureRate: toolEvents.length === 0 ? 0 : failedToolEvents.length / toolEvents.length,
    memoryHitRate: memorySteps.length === 0 ? null : successfulMemorySteps.length / memorySteps.length,
    memoryUsefulnessRate: memorySteps.length === 0 ? null : memoryUsefulCount / memorySteps.length,
    toolSafetyViolationRate: runCount === 0 ? 0 : toolSafetyViolationCount / runCount,
    routeDeliverySuccessRate: routeSteps.length === 0 ? null : successfulRouteSteps.length / routeSteps.length,
    fallbackRecoveryRate: fallbackSteps.length === 0 ? null : fallbackRecoveredCount / fallbackSteps.length,
    stateRetentionRate: longContextResults.length === 0 ? null : retainedStateCount / longContextResults.length,
  };
}

export function buildBenchmarkQualityReport(
  result: EvalSuiteResult,
  thresholds: BenchmarkQualityThresholds = {},
): BenchmarkQualityReport {
  const resolvedThresholds = resolveBenchmarkQualityThresholds(thresholds);
  const metrics = result.metrics;
  const toolReliabilityRate = 1 - metrics.toolFailureRate;
  const toolSafetyRate = 1 - metrics.toolSafetyViolationRate;
  const efficiencyScore = calculateEfficiencyScore(
    metrics.averageToolCallCount,
    resolvedThresholds.targetAverageToolCalls,
  );

  const dimensions: BenchmarkQualityDimensionScore[] = [
    buildDimensionScore({
      id: "completion",
      label: "Scenario completion",
      score: metrics.completionRate,
      threshold: resolvedThresholds.completionRate,
      weight: 0.22,
      summary: `${metrics.completedCount}/${metrics.scenarioCount} scenario(s) completed.`,
    }),
    buildDimensionScore({
      id: "verification_pass",
      label: "Verification pass rate",
      score: metrics.verificationPassRate,
      threshold: resolvedThresholds.verificationPassRate,
      weight: 0.1,
      summary: `${metrics.verificationPassedCount}/${metrics.runCount} run(s) ended with passed verification.`,
    }),
    buildDimensionScore({
      id: "first_pass",
      label: "First-pass quality",
      score: metrics.firstPassRate,
      threshold: resolvedThresholds.firstPassRate,
      weight: 0.14,
      summary: `${metrics.firstPassCount}/${metrics.scenarioCount} scenario(s) passed without repair.`,
    }),
    buildDimensionScore({
      id: "repair",
      label: "Verification repair",
      score: metrics.repairRate,
      threshold: metrics.repairRate === null ? null : resolvedThresholds.repairRate,
      weight: 0.1,
      summary:
        metrics.repairRate === null
          ? "No verification-repair scenario was eligible."
          : `${metrics.repairedCount}/${metrics.repairEligibleCount} verification failure(s) repaired.`,
    }),
    buildDimensionScore({
      id: "tool_reliability",
      label: "Tool reliability",
      score: toolReliabilityRate,
      threshold: resolvedThresholds.toolReliabilityRate,
      weight: 0.12,
      summary: `Tool failure rate was ${(metrics.toolFailureRate * 100).toFixed(1)}%.`,
    }),
    buildDimensionScore({
      id: "tool_safety",
      label: "Tool safety violations",
      score: toolSafetyRate,
      threshold: resolvedThresholds.toolSafetyRate,
      weight: 0.08,
      summary: `${metrics.toolSafetyViolationCount}/${metrics.runCount} run(s) recorded a safety violation.`,
    }),
    buildDimensionScore({
      id: "memory",
      label: "Memory recall",
      score: metrics.memoryHitRate,
      threshold: metrics.memoryHitRate === null ? null : resolvedThresholds.memoryHitRate,
      weight: 0.08,
      summary:
        metrics.memoryHitRate === null
          ? "No memory-recall scenario was measured."
          : `Memory hit rate was ${(metrics.memoryHitRate * 100).toFixed(1)}%.`,
    }),
    buildDimensionScore({
      id: "memory_usefulness",
      label: "Memory usefulness",
      score: metrics.memoryUsefulnessRate,
      threshold: metrics.memoryUsefulnessRate === null ? null : resolvedThresholds.memoryUsefulnessRate,
      weight: 0.07,
      summary:
        metrics.memoryUsefulnessRate === null
          ? "No memory-usefulness scenario was measured."
          : `${metrics.memoryUsefulCount} memory recall step(s) were marked useful.`,
    }),
    buildDimensionScore({
      id: "route_delivery",
      label: "Route delivery",
      score: metrics.routeDeliverySuccessRate,
      threshold: metrics.routeDeliverySuccessRate === null ? null : resolvedThresholds.routeDeliverySuccessRate,
      weight: 0.08,
      summary:
        metrics.routeDeliverySuccessRate === null
          ? "No route-delivery scenario was measured."
          : `Route delivery success rate was ${(metrics.routeDeliverySuccessRate * 100).toFixed(1)}%.`,
    }),
    buildDimensionScore({
      id: "fallback_recovery",
      label: "Fallback recovery",
      score: metrics.fallbackRecoveryRate,
      threshold: metrics.fallbackRecoveryRate === null ? null : resolvedThresholds.fallbackRecoveryRate,
      weight: 0.07,
      summary:
        metrics.fallbackRecoveryRate === null
          ? "No model-fallback scenario was measured."
          : `${metrics.fallbackRecoveredCount}/${metrics.fallbackEligibleCount} fallback step(s) recovered.`,
    }),
    buildDimensionScore({
      id: "state_retention",
      label: "State retention",
      score: metrics.stateRetentionRate,
      threshold: metrics.stateRetentionRate === null ? null : resolvedThresholds.stateRetentionRate,
      weight: 0.08,
      summary:
        metrics.stateRetentionRate === null
          ? "No long-context state-retention scenario was measured."
          : `${metrics.retainedStateCount}/${metrics.longContextScenarioCount} long-context scenario(s) retained state.`,
    }),
    buildDimensionScore({
      id: "efficiency",
      label: "Tool efficiency",
      score: efficiencyScore,
      threshold: resolvedThresholds.efficiencyScore,
      weight: 0.08,
      summary: `Average tool calls per run: ${metrics.averageToolCallCount.toFixed(1)}; target: ${resolvedThresholds.targetAverageToolCalls.toFixed(1)}.`,
    }),
  ];

  const scoredDimensions = dimensions.filter((dimension) => dimension.score !== null);
  const totalWeight = scoredDimensions.reduce((total, dimension) => total + dimension.weight, 0);
  const overallScore =
    totalWeight === 0
      ? 0
      : scoredDimensions.reduce((total, dimension) => total + (dimension.score ?? 0) * dimension.weight, 0) / totalWeight;
  const failedDimensions = dimensions.filter((dimension) => dimension.passed === false);

  return {
    suiteTitle: result.title,
    generatedAt: new Date().toISOString(),
    overallScore: roundRate(overallScore),
    passed: failedDimensions.length === 0 && metrics.scenarioCount > 0,
    thresholds: resolvedThresholds,
    dimensions,
    categoryBreakdown: buildCategoryBreakdown(result.scenarioResults),
    recommendations: buildBenchmarkRecommendations(failedDimensions, metrics),
  };
}

export function buildLongitudinalBenchmarkReport(
  runs: readonly LongitudinalBenchmarkRun[],
  options: { readonly regressionTolerance?: number } = {},
): LongitudinalBenchmarkReport {
  const ordered = [...runs].sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
  const latest = ordered.at(-1) ?? null;
  const baseline = ordered.length > 1 ? ordered[0] ?? null : null;
  const regressionTolerance = normalizeRateThreshold(options.regressionTolerance, 0.03);
  const regressions =
    latest && baseline
      ? latest.report.dimensions
          .map((latestDimension) => {
            const baselineDimension = baseline.report.dimensions.find((entry) => entry.id === latestDimension.id);
            const delta =
              latestDimension.score === null || baselineDimension?.score === null || baselineDimension?.score === undefined
                ? null
                : roundRate(latestDimension.score - baselineDimension.score);
            return {
              dimensionId: latestDimension.id,
              label: latestDimension.label,
              baselineScore: baselineDimension?.score ?? null,
              latestScore: latestDimension.score,
              delta,
            };
          })
          .filter((entry) => entry.delta !== null && entry.delta < -regressionTolerance)
      : [];
  const recommendations: string[] = [];
  if (!latest) {
    recommendations.push("No benchmark runs are available for longitudinal tracking.");
  } else if (!latest.report.passed) {
    recommendations.push("Latest benchmark did not pass all quality gates.");
  }
  if (regressions.length > 0) {
    recommendations.push(`Investigate ${regressions.length} benchmark dimension regression(s).`);
  }
  if (ordered.length < 3) {
    recommendations.push("Keep at least three benchmark runs to establish a useful trend.");
  }
  return {
    generatedAt: new Date().toISOString(),
    runCount: ordered.length,
    latestRunId: latest?.id ?? null,
    baselineRunId: baseline?.id ?? null,
    latestOverallScore: latest?.report.overallScore ?? null,
    baselineOverallScore: baseline?.report.overallScore ?? null,
    overallScoreDelta: latest && baseline ? roundRate(latest.report.overallScore - baseline.report.overallScore) : null,
    regressions,
    trend: ordered.map((run) => ({
      runId: run.id,
      completedAt: run.completedAt,
      overallScore: run.report.overallScore,
      passed: run.report.passed,
    })),
    recommendations,
  };
}

export function loadLocalBenchmarkJsonl(
  filePath: string,
  options: {
    readonly title?: string;
    readonly description?: string;
    readonly baseDir?: string;
    readonly defaultWorkspaceCwd?: string;
    readonly defaultTimeoutMs?: number;
    readonly maxConcurrency?: number;
  } = {},
): LocalBenchmarkSuite {
  const content = readFileSync(filePath, "utf8");
  const tasks = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as LocalBenchmarkTaskDefinition;
      return {
        ...parsed,
        id: parsed.id ?? `task-${index + 1}`,
      };
    });

  return normalizeLocalBenchmarkSuiteDefinition(
    {
      title: options.title,
      description: options.description,
      defaultWorkspaceCwd: options.defaultWorkspaceCwd,
      defaultTimeoutMs: options.defaultTimeoutMs,
      maxConcurrency: options.maxConcurrency,
      tasks,
    },
    { baseDir: options.baseDir ?? process.cwd() },
  );
}

export function normalizeLocalBenchmarkSuiteDefinition(
  definition: LocalBenchmarkSuiteDefinition,
  options: {
    readonly baseDir?: string;
  } = {},
): LocalBenchmarkSuite {
  const baseDir = resolve(options.baseDir ?? process.cwd());
  const defaultWorkspaceCwd = resolve(baseDir, definition.defaultWorkspaceCwd ?? ".");
  const tasks = definition.tasks ?? [];
  if (tasks.length === 0) {
    throw new Error("Local benchmark suite must include at least one task.");
  }

  return {
    title: normalizeText(definition.title) ?? "Omni Agent Local Benchmark",
    description: normalizeText(definition.description),
    maxConcurrency: normalizeConcurrency(definition.maxConcurrency),
    tasks: tasks.map((task, index) => normalizeLocalBenchmarkTask(task, index, baseDir, defaultWorkspaceCwd, definition.defaultTimeoutMs)),
  };
}

export async function runLocalBenchmarkSuite(
  suite: LocalBenchmarkSuite,
  executor: LocalBenchmarkTaskExecutor,
): Promise<LocalBenchmarkSuiteResult> {
  const startedAt = new Date();
  const results = await runWithConcurrency(suite.tasks, suite.maxConcurrency, async (task, taskIndex) =>
    runLocalBenchmarkTask(task, taskIndex, executor),
  );
  const completedAt = new Date();
  const completedCount = results.filter((result) => !result.executorError && !result.timedOut).length;
  const passedCount = results.filter((result) => result.passed).length;
  const timeoutCount = results.filter((result) => result.timedOut).length;
  const totalScore = results.reduce((total, result) => total + result.score, 0);
  const maxScore = results.reduce((total, result) => total + result.maxScore, 0);

  return {
    title: suite.title,
    description: suite.description,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    maxConcurrency: suite.maxConcurrency,
    taskCount: results.length,
    completedCount,
    passedCount,
    timeoutCount,
    totalScore: roundMetric(totalScore),
    maxScore: roundMetric(maxScore),
    scoreRate: maxScore === 0 ? 0 : roundRate(totalScore / maxScore),
    results,
  };
}

function normalizeEvalProgram(program: EvalProgramDefinition): EvalProgram {
  const dataset = program.dataset ?? {};
  const judges = program.judges ?? [];
  const metrics = program.metrics ?? [];
  const releaseGates = program.releaseGates ?? [];
  return {
    supportedDecision: normalizeRequiredText(
      program.supportedDecision,
      "Eval program must declare the product or release decision it supports.",
    ),
    evalUnit: normalizeEvalProgramUnit(program.evalUnit),
    dataset: {
      minExamples: normalizeOptionalPositiveInteger(dataset.minExamples) ?? 0,
      sources: normalizeStringArray(dataset.sources) ?? [],
      samplingStrategy: normalizeText(dataset.samplingStrategy) ?? "",
      labelingProcess: normalizeText(dataset.labelingProcess) ?? "",
      versioning: normalizeText(dataset.versioning) ?? "",
      failureCategories: normalizeStringArray(dataset.failureCategories) ?? [],
    },
    judges: judges.map((judge, index) => normalizeEvalProgramJudge(judge, index)),
    metrics: metrics.map((metric, index) => normalizeEvalProgramMetric(metric, index)),
    releaseGates: releaseGates.map((gate, index) => normalizeEvalProgramReleaseGate(gate, index)),
    operationalMetrics: normalizeStringArray(program.operationalMetrics) ?? [],
    reviewCadence: normalizeText(program.reviewCadence),
    traceArtifacts: normalizeStringArray(program.traceArtifacts) ?? [],
    sourceProjects: normalizeStringArray(program.sourceProjects) ?? [],
  };
}

function normalizeEvalProgramJudge(judge: EvalProgramJudgeDefinition, index: number): EvalProgramJudge {
  const id = normalizeRequiredText(judge.id, `Eval program judge ${index + 1} is missing id.`);
  return {
    id,
    type: normalizeEvalJudgeType(judge.type, id),
    description: normalizeText(judge.description),
    rubric: normalizeStringArray(judge.rubric) ?? [],
    calibration: normalizeText(judge.calibration),
  };
}

function normalizeEvalProgramMetric(metric: EvalProgramMetricDefinition, index: number): EvalProgramMetric {
  return {
    id: normalizeRequiredText(metric.id, `Eval program metric ${index + 1} is missing id.`),
    description: normalizeText(metric.description),
    target: normalizeText(metric.target),
  };
}

function normalizeEvalProgramReleaseGate(
  gate: EvalProgramReleaseGateDefinition,
  index: number,
): EvalProgramReleaseGate {
  const id = normalizeRequiredText(gate.id, `Eval program release gate ${index + 1} is missing id.`);
  return {
    id,
    metricId: normalizeRequiredText(gate.metricId, `Eval program release gate ${id} is missing metricId.`),
    operator: normalizeReleaseGateOperator(gate.operator),
    threshold: typeof gate.threshold === "number" && Number.isFinite(gate.threshold) ? gate.threshold : undefined,
    severity: normalizeReleaseGateSeverity(gate.severity),
    description: normalizeText(gate.description),
  };
}

function normalizeEvalScenario(
  scenario: EvalScenarioDefinition,
  scenarioIndex: number,
  baseDir: string,
  defaultWorkspaceCwd: string,
): EvalScenario {
  const id = normalizeRequiredText(scenario.id, `Scenario ${scenarioIndex + 1} is missing id.`);
  const steps = scenario.steps ?? [];
  if (steps.length === 0) {
    throw new Error(`Scenario ${id} must include at least one step.`);
  }

  return {
    id,
    title: normalizeText(scenario.title) ?? id,
    description: normalizeText(scenario.description),
    category: normalizeScenarioCategory(scenario.category, id),
    workspaceCwd: scenario.workspaceCwd ? resolve(baseDir, scenario.workspaceCwd) : defaultWorkspaceCwd,
    threadTitle: normalizeText(scenario.threadTitle),
    steps: steps.map((step, stepIndex) => normalizeEvalStep(step, stepIndex, id)),
  };
}

function normalizeEvalStep(step: EvalScenarioStepDefinition, stepIndex: number, scenarioId: string): EvalScenarioStep {
  const objective = normalizeRequiredText(step.objective, `Scenario ${scenarioId} step ${stepIndex + 1} is missing objective.`);
  return {
    id: normalizeText(step.id) ?? `${scenarioId}-step-${stepIndex + 1}`,
    objective,
    successCriteria: normalizeStringArray(step.successCriteria),
    constraints: normalizeStringArray(step.constraints),
    verificationCommands: normalizeStringArray(step.verificationCommands),
    maxIterations: normalizeOptionalPositiveInteger(step.maxIterations),
    expectation: normalizeStepExpectation(step.expectation),
  };
}

function normalizeStepExpectation(expectation: EvalStepExpectation | undefined): EvalStepExpectation | undefined {
  if (!expectation) {
    return undefined;
  }
  return {
    verificationStatus: expectation.verificationStatus,
    requiredChangedFiles: normalizeStringArray(expectation.requiredChangedFiles),
    requiredToolNames: normalizeStringArray(expectation.requiredToolNames),
    requiredSuccessfulToolNames: normalizeStringArray(expectation.requiredSuccessfulToolNames),
    requiredFinalResponseIncludes: normalizeStringArray(expectation.requiredFinalResponseIncludes),
    requiredVerificationEvidenceKinds: normalizeVerificationEvidenceKinds(expectation.requiredVerificationEvidenceKinds),
  };
}

function normalizeVerificationNativePolicy(
  policy: VerificationNativePolicyDefinition | undefined,
): VerificationNativePolicy | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    completionRequiresEvidence: policy.completionRequiresEvidence ?? false,
    minimumEvidenceCount: normalizeOptionalPositiveInteger(policy.minimumEvidenceCount) ?? 1,
    requiredEvidenceKinds: normalizeVerificationEvidenceKinds(policy.requiredEvidenceKinds) ?? [],
  };
}

function normalizeVerificationEvidenceKinds(
  kinds: readonly VerificationEvidenceKind[] | undefined,
): VerificationEvidenceKind[] | undefined {
  const normalized = normalizeStringArray(kinds);
  return normalized?.map((kind) => normalizeVerificationEvidenceKind(kind));
}

function normalizeVerificationEvidenceKind(kind: string): VerificationEvidenceKind {
  if (kind === "artifact" || kind === "command" || kind === "test" || kind === "trace") {
    return kind;
  }
  throw new Error(`Unsupported verification evidence kind: ${kind}`);
}

function normalizeScenarioCategory(category: EvalScenarioCategory, scenarioId: string): EvalScenarioCategory {
  if (
    category === "coding_bugfix" ||
    category === "coding_fix" ||
    category === "channel_delivery" ||
    category === "gateway_route_delivery" ||
    category === "mcp_resource" ||
    category === "mcp_tool_use" ||
    category === "memory_recall" ||
    category === "model_fallback" ||
    category === "route_handling" ||
    category === "skill_creation" ||
    category === "skill_improvement" ||
    category === "single_agent_bugfix" ||
    category === "subagent_delegation" ||
    category === "subagent_parallel" ||
    category === "multi_agent_investigation" ||
    category === "long_context_modification" ||
    category === "long_running_automation" ||
    category === "verification_repair"
  ) {
    return category;
  }
  throw new Error(`Scenario ${scenarioId} uses unsupported category: ${String(category)}`);
}

function normalizeCapabilityScorecardItem(
  capability: CapabilityScorecardItemDefinition,
  index: number,
  knownScenarioIds: ReadonlySet<string>,
): CapabilityScorecardItem {
  const id = normalizeRequiredText(capability.id, `Capability ${index + 1} is missing id.`);
  const evidenceFiles = normalizeStringArray(capability.evidenceFiles) ?? normalizeStringArray(capability.evidence) ?? [];
  const scenarioIds = normalizeStringArray(capability.scenarioIds) ?? [];
  const unknownScenarioIds = scenarioIds.filter((scenarioId) => !knownScenarioIds.has(scenarioId));
  if (unknownScenarioIds.length > 0) {
    throw new Error(`Capability ${id} references unknown scenario(s): ${unknownScenarioIds.join(", ")}`);
  }
  return {
    id,
    title: normalizeText(capability.title) ?? id,
    status: normalizeCapabilityMaturityStatus(capability.status, id),
    referenceProject: normalizeReferenceProjects(capability.referenceProject, id),
    referenceStrength: normalizeText(capability.referenceStrength),
    evidence: evidenceFiles,
    evidenceFiles,
    matureEvidenceFiles: normalizeStringArray(capability.matureEvidenceFiles) ?? [],
    matureBenchmarkScenarioIds: normalizeStringArray(capability.matureBenchmarkScenarioIds) ?? [],
    liveOrContractTests: normalizeStringArray(capability.liveOrContractTests) ?? [],
    operationalRunbook: normalizeText(capability.operationalRunbook),
    failureRecoveryTests: normalizeStringArray(capability.failureRecoveryTests) ?? [],
    matureCriteria: normalizeStringArray(capability.matureCriteria) ?? [],
    blockedBy: normalizeStringArray(capability.blockedBy) ?? [],
    nextMilestone: normalizeText(capability.nextMilestone),
    requiredTests: normalizeStringArray(capability.requiredTests) ?? [],
    scenarioIds,
  };
}

function normalizeCapabilityMaturityStatus(status: CapabilityMaturityStatus, capabilityId: string): CapabilityMaturityStatus {
  if (status === "missing" || status === "scaffolded" || status === "usable" || status === "mature") {
    return status;
  }
  throw new Error(`Capability ${capabilityId} uses unsupported status: ${String(status)}`);
}

function normalizeEvalProgramUnit(unit: EvalProgramUnit): EvalProgramUnit {
  if (
    unit === "final_answer" ||
    unit === "full_trace" ||
    unit === "multi_turn_session" ||
    unit === "retrieval_result_set" ||
    unit === "tool_use_episode"
  ) {
    return unit;
  }
  throw new Error(`Eval program uses unsupported evaluation unit: ${String(unit)}`);
}

function normalizeEvalJudgeType(type: EvalJudgeType, judgeId: string): EvalJudgeType {
  if (type === "deterministic" || type === "heuristic" || type === "human_review" || type === "llm_judge") {
    return type;
  }
  throw new Error(`Eval program judge ${judgeId} uses unsupported type: ${String(type)}`);
}

function normalizeReleaseGateOperator(operator: EvalReleaseGateOperator | undefined): EvalReleaseGateOperator {
  if (!operator) {
    return "at_least";
  }
  if (operator === "at_least" || operator === "at_most" || operator === "equals") {
    return operator;
  }
  throw new Error(`Eval program release gate uses unsupported operator: ${String(operator)}`);
}

function normalizeReleaseGateSeverity(severity: EvalReleaseGateSeverity | undefined): EvalReleaseGateSeverity {
  if (!severity) {
    return "blocking";
  }
  if (severity === "advisory" || severity === "blocking") {
    return severity;
  }
  throw new Error(`Eval program release gate uses unsupported severity: ${String(severity)}`);
}

function normalizeReferenceProjects(
  referenceProject: ReferenceProject | readonly ReferenceProject[] | undefined,
  capabilityId: string,
): readonly ReferenceProject[] {
  const values = Array.isArray(referenceProject) ? referenceProject : referenceProject ? [referenceProject] : [];
  const normalized: ReferenceProject[] = [];
  for (const value of values) {
    if (
      value !== "Harness-Learning" &&
      value !== "agent-eval-learning" &&
      value !== "claudecode-source" &&
      value !== "hermes-agent-main" &&
      value !== "openclaw-main"
    ) {
      throw new Error(`Capability ${capabilityId} references unsupported project: ${String(value)}`);
    }
    if (!normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return normalized;
}

function resolveBenchmarkQualityThresholds(
  thresholds: BenchmarkQualityThresholds,
): Required<BenchmarkQualityThresholds> {
  return {
    completionRate: normalizeRateThreshold(thresholds.completionRate, 0.85),
    verificationPassRate: normalizeRateThreshold(thresholds.verificationPassRate, 0.9),
    firstPassRate: normalizeRateThreshold(thresholds.firstPassRate, 0.75),
    repairRate: normalizeRateThreshold(thresholds.repairRate, 0.7),
    toolReliabilityRate: normalizeRateThreshold(thresholds.toolReliabilityRate, 0.95),
    memoryHitRate: normalizeRateThreshold(thresholds.memoryHitRate, 0.8),
    memoryUsefulnessRate: normalizeRateThreshold(thresholds.memoryUsefulnessRate, 0.8),
    toolSafetyRate: normalizeRateThreshold(thresholds.toolSafetyRate, 0.98),
    routeDeliverySuccessRate: normalizeRateThreshold(thresholds.routeDeliverySuccessRate, 0.9),
    fallbackRecoveryRate: normalizeRateThreshold(thresholds.fallbackRecoveryRate, 0.8),
    stateRetentionRate: normalizeRateThreshold(thresholds.stateRetentionRate, 0.8),
    efficiencyScore: normalizeRateThreshold(thresholds.efficiencyScore, 0.75),
    targetAverageToolCalls:
      typeof thresholds.targetAverageToolCalls === "number" &&
      Number.isFinite(thresholds.targetAverageToolCalls) &&
      thresholds.targetAverageToolCalls > 0
        ? thresholds.targetAverageToolCalls
        : 6,
  };
}

function buildDimensionScore(input: {
  readonly id: string;
  readonly label: string;
  readonly score: number | null;
  readonly threshold: number | null;
  readonly weight: number;
  readonly summary: string;
}): BenchmarkQualityDimensionScore {
  const passed = input.score === null || input.threshold === null ? null : input.score >= input.threshold;
  return {
    id: input.id,
    label: input.label,
    score: input.score === null ? null : roundRate(input.score),
    threshold: input.threshold === null ? null : roundRate(input.threshold),
    passed,
    scoreType: classifyDimensionScore(input.id, input.score, input.threshold, passed),
    weight: input.weight,
    summary: input.summary,
  };
}

function classifyStepScore(
  observedRun: EvalObservedRun,
  passed: boolean,
  reasons: readonly string[],
  verificationFailedInitially: boolean,
): EvalScoreType {
  if (observedRun.toolSafetyViolation === true) {
    return "risk";
  }
  if (passed) {
    return verificationFailedInitially ? "regression" : "pass";
  }
  if (observedRun.verificationStatus === "passed" && reasons.length > 0) {
    return "partial";
  }
  return verificationFailedInitially ? "regression" : "fail";
}

function classifyScenarioScore(stepResults: readonly EvalStepResult[]): EvalScoreType {
  if (stepResults.some((step) => step.scoreType === "risk")) {
    return "risk";
  }
  if (stepResults.every((step) => step.scoreType === "pass")) {
    return "pass";
  }
  if (stepResults.some((step) => step.scoreType === "regression")) {
    return stepResults.every((step) => step.passed) ? "pass" : "regression";
  }
  if (stepResults.some((step) => step.passed)) {
    return "partial";
  }
  return "fail";
}

function classifyDimensionScore(
  dimensionId: string,
  score: number | null,
  threshold: number | null,
  passed: boolean | null,
): EvalScoreType {
  if (dimensionId === "tool_safety" && score !== null && threshold !== null && score < threshold) {
    return "risk";
  }
  if (dimensionId === "memory" || dimensionId === "memory_usefulness" || dimensionId === "state_retention") {
    return passed === false ? "partial" : "maturity";
  }
  if (passed === true) {
    return "pass";
  }
  if (passed === false) {
    return dimensionId === "completion" || dimensionId === "verification_pass" ? "regression" : "fail";
  }
  return "partial";
}

function calculateEfficiencyScore(averageToolCallCount: number, targetAverageToolCalls: number): number {
  if (averageToolCallCount <= targetAverageToolCalls) {
    return 1;
  }
  return Math.max(0, 1 - (averageToolCallCount - targetAverageToolCalls) / targetAverageToolCalls);
}

function buildCategoryBreakdown(
  scenarioResults: readonly EvalScenarioResult[],
): BenchmarkQualityReport["categoryBreakdown"] {
  const categories = new Map<
    EvalScenarioCategory,
    { scenarioCount: number; completedCount: number; totalAverageToolCallCount: number }
  >();
  for (const result of scenarioResults) {
    const current = categories.get(result.category) ?? {
      scenarioCount: 0,
      completedCount: 0,
      totalAverageToolCallCount: 0,
    };
    categories.set(result.category, {
      scenarioCount: current.scenarioCount + 1,
      completedCount: current.completedCount + (result.completed ? 1 : 0),
      totalAverageToolCallCount: current.totalAverageToolCallCount + result.averageToolCallCount,
    });
  }

  return Array.from(categories.entries())
    .map(([category, value]) => ({
      category,
      scenarioCount: value.scenarioCount,
      completedCount: value.completedCount,
      completionRate: roundRate(value.scenarioCount === 0 ? 0 : value.completedCount / value.scenarioCount),
      averageToolCallCount:
        value.scenarioCount === 0 ? 0 : roundMetric(value.totalAverageToolCallCount / value.scenarioCount),
    }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

function buildBenchmarkRecommendations(
  failedDimensions: readonly BenchmarkQualityDimensionScore[],
  metrics: EvalSuiteMetrics,
): string[] {
  if (metrics.scenarioCount === 0) {
    return ["Add at least one benchmark scenario before using the quality report for release decisions."];
  }
  if (failedDimensions.length === 0) {
    return ["Benchmark quality gates passed. Keep the same scenario mix for regression tracking."];
  }

  return failedDimensions.map((dimension) => {
    switch (dimension.id) {
      case "completion":
        return "Improve failed scenarios first; completion is the release-blocking quality gate.";
      case "verification_pass":
        return "Raise verification pass rate before treating benchmark results as releasable.";
      case "first_pass":
        return "Reduce first-pass misses by tightening task contracts, tool hints, and verification prompts.";
      case "repair":
        return "Add repair-oriented examples and ensure failed verification output is preserved in the next turn.";
      case "tool_reliability":
        return "Audit failing tools and route their errors into deterministic retry or clearer model feedback.";
      case "tool_safety":
        return "Investigate tool safety violations before marking execution capabilities mature.";
      case "memory":
        return "Broaden memory recall coverage and confirm saved memories are scoped to the active workspace or agent.";
      case "memory_usefulness":
        return "Add memory-usefulness checks so recalled facts are applied instead of merely fetched.";
      case "route_delivery":
        return "Test inbound/outbound route adapters with pairing, retry, and dead-letter paths enabled.";
      case "fallback_recovery":
        return "Exercise model fallback recovery and cooldown paths before relying on resilient model routing.";
      case "state_retention":
        return "Strengthen long-context summaries and handoff preservation for multi-step threads.";
      case "efficiency":
        return "Inspect high-tool-count runs and parallelize safe reads or collapse redundant search/read loops.";
      default:
        return `Investigate benchmark dimension ${dimension.label}.`;
    }
  });
}

function finalizeEvalProgramReadinessReport(
  program: EvalProgram | null,
  issues: readonly EvalProgramReadinessIssue[],
): EvalProgramReadinessReport {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const judgeTypes = program ? Array.from(new Set(program.judges.map((judge) => judge.type))).sort() : [];
  const releaseGates = program?.releaseGates ?? [];
  return {
    generatedAt: new Date().toISOString(),
    ready: errors.length === 0,
    issueCount: issues.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    releaseGateCount: releaseGates.length,
    blockingGateCount: releaseGates.filter((gate) => gate.severity === "blocking").length,
    judgeTypes,
    failureCategories: program?.dataset.failureCategories ?? [],
    issues,
    recommendations: buildEvalProgramReadinessRecommendations(program, errors, warnings),
  };
}

function buildEvalProgramReadinessRecommendations(
  program: EvalProgram | null,
  errors: readonly EvalProgramReadinessIssue[],
  warnings: readonly EvalProgramReadinessIssue[],
): string[] {
  if (!program) {
    return ["Add a suite-level program spec with decision, eval unit, dataset, judges, metrics, and release gates."];
  }
  if (errors.length === 0 && warnings.length === 0) {
    return ["Eval program is ready to support release decisions; keep the dataset version stable while comparing runs."];
  }
  const recommendations: string[] = [];
  if (errors.length > 0) {
    recommendations.push("Fix blocking eval program gaps before using this suite as a release gate.");
  }
  if (warnings.length > 0) {
    recommendations.push("Tighten warnings before claiming mature eval governance.");
  }
  if (program.releaseGates.some((gate) => gate.severity === "blocking")) {
    recommendations.push("Keep blocking gates tied to metrics that are reported by the same benchmark run.");
  }
  return recommendations;
}

function normalizeRateThreshold(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function roundRate(value: number): number {
  return Number(value.toFixed(4));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

function evaluateStepResult(
  scenario: EvalScenario,
  step: EvalScenarioStep,
  observedRun: EvalObservedRun | null,
  verificationPolicy?: VerificationNativePolicy,
): EvalStepResult {
  if (!observedRun) {
    return {
      scenarioId: scenario.id,
      category: scenario.category,
      stepId: step.id,
      objective: step.objective,
      passed: false,
      scoreType: "fail",
      reasons: ["No observed run was provided for this step."],
      firstPass: false,
      verificationFailedInitially: false,
      repairedAfterVerificationFailure: false,
      toolCallCount: 0,
      turnCount: 0,
      durationMs: null,
      observedRun: {
        verificationStatus: "failed",
        finalResponse: "",
        changedFiles: [],
        toolEvents: [],
        toolCallCount: 0,
        turnCount: 0,
        durationMs: null,
      },
    };
  }

  const reasons = evaluateStepExpectation(step.expectation, observedRun, verificationPolicy);
  const verificationStatusSequence = observedRun.toolEvents
    .filter((event) => event.toolName === "run_verification")
    .map((event) => event.status.toLowerCase());
  const firstVerificationStatus = verificationStatusSequence.find((status) => status === "ok" || status === "failed");
  const verificationFailedInitially = firstVerificationStatus === "failed";
  const passed = reasons.length === 0;
  const firstPass =
    passed &&
    (firstVerificationStatus === "ok" ||
      (firstVerificationStatus === undefined && observedRun.verificationStatus === "passed"));
  const repairedAfterVerificationFailure = passed && verificationFailedInitially;
  const scoreType = classifyStepScore(observedRun, passed, reasons, verificationFailedInitially);

  return {
    scenarioId: scenario.id,
    category: scenario.category,
    stepId: step.id,
    objective: step.objective,
    passed,
    scoreType,
    reasons,
    firstPass,
    verificationFailedInitially,
    repairedAfterVerificationFailure,
    toolCallCount: observedRun.toolCallCount,
    turnCount: observedRun.turnCount,
    durationMs: observedRun.durationMs,
    observedRun,
  };
}

function evaluateStepExpectation(
  expectation: EvalStepExpectation | undefined,
  observedRun: EvalObservedRun,
  verificationPolicy?: VerificationNativePolicy,
): string[] {
  const reasons: string[] = [];
  if (!expectation) {
    if (observedRun.verificationStatus === "failed") {
      reasons.push("Verification finished in failed state.");
    }
  } else if (expectation.verificationStatus && observedRun.verificationStatus !== expectation.verificationStatus) {
    reasons.push(
      `Expected verification status ${expectation.verificationStatus}, received ${observedRun.verificationStatus}.`,
    );
  }

  for (const changedFile of expectation?.requiredChangedFiles ?? []) {
    if (!observedRun.changedFiles.includes(changedFile)) {
      reasons.push(`Missing changed file: ${changedFile}.`);
    }
  }

  const toolNames = new Set(observedRun.toolEvents.map((event) => event.toolName));
  for (const toolName of expectation?.requiredToolNames ?? []) {
    if (!toolNames.has(toolName)) {
      reasons.push(`Missing required tool event: ${toolName}.`);
    }
  }
  for (const toolName of expectation?.requiredSuccessfulToolNames ?? []) {
    const successfulEvent = observedRun.toolEvents.find(
      (event) => event.toolName === toolName && event.status.toLowerCase() === "ok",
    );
    if (!successfulEvent) {
      reasons.push(`Missing successful required tool event: ${toolName}.`);
    }
  }

  for (const snippet of expectation?.requiredFinalResponseIncludes ?? []) {
    if (!observedRun.finalResponse.includes(snippet)) {
      reasons.push(`Final response is missing required snippet: ${snippet}.`);
    }
  }

  const requiredEvidenceKinds = [
    ...(verificationPolicy?.requiredEvidenceKinds ?? []),
    ...(expectation?.requiredVerificationEvidenceKinds ?? []),
  ];
  const completionRequiresEvidence =
    verificationPolicy?.completionRequiresEvidence === true || (expectation?.requiredVerificationEvidenceKinds?.length ?? 0) > 0;
  if (completionRequiresEvidence) {
    const passedEvidence = collectPassedVerificationEvidence(observedRun);
    const minimumEvidenceCount = verificationPolicy?.minimumEvidenceCount ?? 1;
    if (passedEvidence.length < minimumEvidenceCount) {
      reasons.push(
        `Expected at least ${minimumEvidenceCount} passed verification evidence item(s), received ${passedEvidence.length}.`,
      );
    }
    for (const kind of new Set(requiredEvidenceKinds)) {
      if (!passedEvidence.some((evidence) => evidence.kind === kind)) {
        reasons.push(`Missing passed verification evidence kind: ${kind}.`);
      }
    }
  }

  return reasons;
}

function collectPassedVerificationEvidence(observedRun: EvalObservedRun): EvalVerificationEvidence[] {
  const explicitEvidence = (observedRun.verificationEvidence ?? []).filter((evidence) => evidence.status === "passed");
  const hasSuccessfulVerificationTool = observedRun.toolEvents.some(
    (event) => event.toolName === "run_verification" && event.status.toLowerCase() === "ok",
  );
  if (!hasSuccessfulVerificationTool) {
    return [...explicitEvidence];
  }
  return [
    ...explicitEvidence,
    {
      kind: "command",
      status: "passed",
      summary: "Successful run_verification tool event.",
    },
  ];
}

function normalizeText(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeRequiredText(value: string | null | undefined, errorMessage: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(errorMessage);
  }
  return normalized;
}

function normalizeLocalBenchmarkTask(
  task: LocalBenchmarkTaskDefinition,
  index: number,
  baseDir: string,
  defaultWorkspaceCwd: string,
  defaultTimeoutMs: number | undefined,
): LocalBenchmarkTask {
  const id = normalizeText(task.id) ?? `task-${index + 1}`;
  const prompt = normalizeRequiredText(task.prompt, `Local benchmark task ${id} must include a prompt.`);
  const workspaceCwd = resolve(baseDir, task.workspaceCwd ?? defaultWorkspaceCwd);
  const timeoutMs = normalizeOptionalPositiveInteger(task.timeoutMs) ?? normalizeOptionalPositiveInteger(defaultTimeoutMs) ?? 30_000;
  const score = typeof task.score === "number" && Number.isFinite(task.score) && task.score > 0 ? task.score : 1;

  return {
    id,
    prompt,
    workspaceCwd,
    verificationCommands: normalizeStringArray(task.verificationCommands) ?? [],
    timeoutMs,
    score,
    metadata: task.metadata ?? {},
  };
}

function normalizeConcurrency(value: number | undefined): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return 1;
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeStringArray(values: readonly string[] | undefined): string[] | undefined {
  if (!values) {
    return undefined;
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeOptionalPositiveInteger(value: number | undefined): number | undefined {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

async function runLocalBenchmarkTask(
  task: LocalBenchmarkTask,
  taskIndex: number,
  executor: LocalBenchmarkTaskExecutor,
): Promise<LocalBenchmarkTaskResult> {
  const startedAt = Date.now();
  let execution: LocalBenchmarkTaskExecution;
  try {
    execution = await withTimeout(executor({ task, taskIndex }), task.timeoutMs, `Local benchmark task ${task.id} timed out.`);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    return {
      taskId: task.id,
      prompt: task.prompt,
      workspaceCwd: task.workspaceCwd,
      passed: false,
      score: 0,
      maxScore: task.score,
      verificationStatus: "failed",
      timedOut: isTimeoutError(error),
      durationMs,
      executorError: error instanceof Error ? error.message : String(error),
      finalResponse: "",
      changedFiles: [],
      toolEvents: [],
      verificationResults: [],
    };
  }

  const verificationResults: LocalBenchmarkCommandResult[] = [];
  for (const command of task.verificationCommands) {
    const result = await runLocalBenchmarkCommand(command, task.workspaceCwd, task.timeoutMs);
    verificationResults.push(result);
    if (!result.ok) {
      break;
    }
  }

  const timedOut = verificationResults.some((result) => result.timedOut);
  const verificationStatus =
    task.verificationCommands.length === 0 ? "skipped" : verificationResults.every((result) => result.ok) ? "passed" : "failed";
  const passed = verificationStatus === "passed";

  return {
    taskId: task.id,
    prompt: task.prompt,
    workspaceCwd: task.workspaceCwd,
    passed,
    score: passed ? task.score : 0,
    maxScore: task.score,
    verificationStatus,
    timedOut,
    durationMs: Date.now() - startedAt,
    finalResponse: execution.finalResponse ?? "",
    changedFiles: execution.changedFiles ?? [],
    toolEvents: [
      ...(execution.toolEvents ?? []),
      ...verificationResults.map((result) => ({
        toolName: "run_verification",
        status: result.ok ? "ok" : "failed",
      })),
    ],
    verificationResults,
  };
}

function runLocalBenchmarkCommand(command: string, cwd: string, timeoutMs: number): Promise<LocalBenchmarkCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolveCommand) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    child.on("error", (error) => {
      stderrChunks.push(Buffer.from(error.message));
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const ok = !timedOut && exitCode === 0;
      resolveCommand({
        command,
        cwd,
        ok,
        timedOut,
        exitCode,
        stdout: truncateBenchmarkOutput(Buffer.concat(stdoutChunks).toString("utf8")),
        stderr: truncateBenchmarkOutput(Buffer.concat(stderrChunks).toString("utf8")),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(maxConcurrency, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        const item = items[index];
        if (item !== undefined) {
          results[index] = await worker(item, index);
        }
      }
    }),
  );
  return results;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  return new Promise<T>((resolvePromise, rejectPromise) => {
    timeout = setTimeout(() => {
      const error = new Error(message);
      error.name = "TimeoutError";
      rejectPromise(error);
    }, timeoutMs);
    promise.then(
      (value) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        resolvePromise(value);
      },
      (error) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        rejectPromise(error);
      },
    );
  });
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function truncateBenchmarkOutput(value: string, maxLength = 12_000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`;
}
