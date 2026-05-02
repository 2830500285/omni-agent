import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

interface ReleaseLocalEvalResult {
  readonly scenarioResults?: readonly ReleaseLocalScenarioResult[];
  readonly metrics?: {
    readonly scenarioCount?: number;
    readonly completedCount?: number;
    readonly verificationPassedCount?: number;
    readonly runCount?: number;
    readonly toolSafetyViolationCount?: number;
  };
}

interface ReleaseLocalScenarioResult {
  readonly scenarioId?: string;
  readonly stepResults?: readonly ReleaseLocalStepResult[];
}

interface ReleaseLocalStepResult {
  readonly stepId?: string;
  readonly observedRun?: ReleaseLocalObservedRun;
}

interface ReleaseLocalObservedRun {
  readonly runId?: string;
  readonly threadId?: string;
  readonly finalResponse?: string;
  readonly durationMs?: number;
  readonly turnCount?: number;
  readonly toolEvents?: readonly ReleaseLocalObservedToolEvent[];
}

interface ReleaseLocalObservedToolEvent {
  readonly toolName?: string;
  readonly status?: string;
}

const repoRoot = resolve(process.cwd());
const manifestPath = resolve(repoRoot, "examples/evals/release-local.json");
const outputPath = resolve(repoRoot, ".artifacts/release-evals/summary.json");
const storageRoot = resolve(repoRoot, ".artifacts/release-evals/store");
const tsconfigPath = resolve(repoRoot, "tsconfig.base.json");

if (!existsSync(manifestPath)) {
  console.error(`Release-local eval manifest is missing: ${manifestPath}`);
  process.exit(1);
}

removeDirectoryWithRetry(dirname(outputPath));
mkdirSync(dirname(outputPath), { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    resolve(repoRoot, "apps/cli/src/index.ts"),
    "evals",
    "--cwd",
    repoRoot,
    "--storage-root",
    storageRoot,
    "--manifest",
    manifestPath,
    "--output",
    outputPath,
    "--mode",
    "mock",
    "--verification-mode",
    "required",
    "--auto-approve-risky",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: tsconfigPath,
      TSX_DISABLE_CACHE: "1",
    },
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as ReleaseLocalEvalResult;
const metrics = parsed.metrics;
const scenarioCount = metrics?.scenarioCount ?? 0;
const completedCount = metrics?.completedCount ?? 0;
const runCount = metrics?.runCount ?? 0;
const verificationPassedCount = metrics?.verificationPassedCount ?? 0;
const safetyViolationCount = metrics?.toolSafetyViolationCount ?? 0;
const failures: string[] = [];

if (scenarioCount < 3) {
  failures.push(`expected at least 3 scenarios, saw ${scenarioCount}`);
}
if (completedCount !== scenarioCount) {
  failures.push(`expected all scenarios completed, saw ${completedCount}/${scenarioCount}`);
}
if (runCount < scenarioCount) {
  failures.push(`expected at least one runtime run per scenario, saw ${runCount}/${scenarioCount}`);
}
if (verificationPassedCount !== runCount) {
  failures.push(`expected every runtime run to pass verification, saw ${verificationPassedCount}/${runCount}`);
}
if (safetyViolationCount !== 0) {
  failures.push(`expected zero tool safety violations, saw ${safetyViolationCount}`);
}
failures.push(...assertRuntimeEvidence(parsed));

if (failures.length > 0) {
  console.error(`Release-local eval failed: ${failures.join("; ")}`);
  process.exit(1);
}

console.log(`Release-local eval passed: ${completedCount}/${scenarioCount} scenarios across ${runCount} runtime run(s).`);

function assertRuntimeEvidence(result: ReleaseLocalEvalResult): string[] {
  const evidenceFailures: string[] = [];
  const scenarioResults = result.scenarioResults ?? [];
  if (scenarioResults.length === 0) {
    return ["expected release-local summary to include scenarioResults runtime evidence"];
  }

  for (const scenario of scenarioResults) {
    const stepResults = scenario.stepResults ?? [];
    if (stepResults.length === 0) {
      evidenceFailures.push(`scenario ${scenario.scenarioId ?? "<unknown>"} has no stepResults`);
      continue;
    }
    for (const step of stepResults) {
      const label = `${scenario.scenarioId ?? "<unknown>"}/${step.stepId ?? "<unknown>"}`;
      const observedRun = step.observedRun;
      if (!observedRun) {
        evidenceFailures.push(`${label} has no observedRun`);
        continue;
      }
      if (!observedRun.runId) {
        evidenceFailures.push(`${label} has no observedRun.runId`);
      }
      if (!observedRun.threadId) {
        evidenceFailures.push(`${label} has no observedRun.threadId`);
      }
      if (!Number.isFinite(observedRun.durationMs) || (observedRun.durationMs ?? 0) <= 0) {
        evidenceFailures.push(`${label} has no positive observedRun.durationMs`);
      }
      if (!Number.isFinite(observedRun.turnCount) || (observedRun.turnCount ?? 0) <= 0) {
        evidenceFailures.push(`${label} has no positive observedRun.turnCount`);
      }
      const toolEvents = observedRun.toolEvents ?? [];
      if (!toolEvents.some((event) => event.toolName === "run_verification" && isSuccessfulToolStatus(event.status))) {
        evidenceFailures.push(`${label} has no successful run_verification tool event`);
      }
      if (!toolEvents.some((event) => event.toolName && event.toolName !== "run_verification")) {
        evidenceFailures.push(`${label} has no non-verification runtime tool event`);
      }
    }
  }

  const continuation = scenarioResults.find((scenario) => scenario.scenarioId === "release.state-continuation");
  const continuationThreadIds = (continuation?.stepResults ?? [])
    .map((step) => step.observedRun?.threadId)
    .filter((threadId): threadId is string => Boolean(threadId));
  if (continuation && new Set(continuationThreadIds).size !== 1) {
    evidenceFailures.push("release.state-continuation steps must share one threadId");
  }

  const rollback = scenarioResults.find((scenario) => scenario.scenarioId === "release.runtime-rollback-recovery");
  const rollbackStep = rollback?.stepResults?.[0];
  const rollbackRun = rollbackStep?.observedRun;
  if (!rollback || !rollbackStep || !rollbackRun) {
    evidenceFailures.push("release.runtime-rollback-recovery must include observed runtime rollback evidence");
  } else {
    const rollbackToolEvents = rollbackRun.toolEvents ?? [];
    for (const toolName of ["create_checkpoint", "rollback_checkpoint", "run_verification"]) {
      if (!rollbackToolEvents.some((event) => event.toolName === toolName && isSuccessfulToolStatus(event.status))) {
        evidenceFailures.push(`release.runtime-rollback-recovery has no successful ${toolName} tool event`);
      }
    }
    if (!/pre-rollback-failure-evidence/i.test(rollbackRun.finalResponse ?? "")) {
      evidenceFailures.push("release.runtime-rollback-recovery final response must cite pre-rollback-failure-evidence");
    }
  }

  const subagents = scenarioResults.find((scenario) => scenario.scenarioId === "release.subagent-orchestration");
  const subagentStep = subagents?.stepResults?.[0];
  const subagentRun = subagentStep?.observedRun;
  if (!subagents || !subagentStep || !subagentRun) {
    evidenceFailures.push("release.subagent-orchestration must include observed runtime subagent evidence");
  } else {
    const subagentToolEvents = subagentRun.toolEvents ?? [];
    for (const toolName of ["spawn_subagent", "list_subagents", "run_verification"]) {
      if (!subagentToolEvents.some((event) => event.toolName === toolName && isSuccessfulToolStatus(event.status))) {
        evidenceFailures.push(`release.subagent-orchestration has no successful ${toolName} tool event`);
      }
    }
    for (const phrase of [
      "release-local subagent orchestration verified",
      "subagent topology persisted",
      "subagent budgets and target paths observable",
      "subagent progress events recorded",
    ]) {
      if (!subagentRun.finalResponse?.includes(phrase)) {
        evidenceFailures.push(`release.subagent-orchestration final response must include "${phrase}"`);
      }
    }
  }

  return evidenceFailures;
}

function isSuccessfulToolStatus(status: string | undefined): boolean {
  return typeof status === "string" && ["ok", "passed", "success", "succeeded"].includes(status.toLowerCase());
}

function removeDirectoryWithRetry(path: string): void {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableRemoveError(error)) {
        throw error;
      }
      sleepSync(75 * attempt);
    }
  }
}

function isRetryableRemoveError(error: unknown): boolean {
  const code = typeof error === "object" && error ? (error as { code?: unknown }).code : undefined;
  return code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY";
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
