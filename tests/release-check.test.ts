import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
  workspaces?: string[];
};
const evalSmoke = readFileSync("scripts/eval-smoke.ts", "utf8");
const evalBenchmark = readFileSync("scripts/eval-benchmark.ts", "utf8");
const evalReleaseLocal = readFileSync("scripts/eval-release-local.ts", "utf8");
const releaseCheck = readFileSync("scripts/release-check.ts", "utf8");
const releaseChecklist = readFileSync("docs/release-checklist.md", "utf8");
const operationsDoc = readFileSync("docs/operations.md", "utf8");
const commandPolicy = readFileSync("packages/approvals/src/command-policy.ts", "utf8");
const scorecard = JSON.parse(readFileSync("examples/evals/capability-scorecard.json", "utf8")) as {
  capabilities?: Array<{ id?: string; status?: string; matureBenchmarkScenarioIds?: string[] }>;
};
const benchmarkSuite = JSON.parse(readFileSync("examples/evals/suite.json", "utf8")) as {
  scenarios?: Array<{
    id?: string;
    steps?: Array<{
      expectation?: {
        requiredToolNames?: string[];
        requiredFinalResponseIncludes?: string[];
      };
    }>;
  }>;
};
const releaseLocal = JSON.parse(readFileSync("examples/evals/release-local.json", "utf8")) as {
  scenarios?: Array<{
    steps?: Array<{
      verificationCommands?: string[];
      expectation?: {
        requiredSuccessfulToolNames?: string[];
      };
    }>;
  }>;
};
const securityDoc = readFileSync("docs/security.md", "utf8");

test("package exposes a release check gate", () => {
  assert.deepEqual(packageJson.workspaces, ["apps/*", "packages/*"]);
  assert.equal(packageJson.scripts?.["release:check"], "node --import tsx ./scripts/release-check.ts");
  assert.equal(packageJson.scripts?.["release:diagnostics"], "node --import tsx ./scripts/release-diagnostics.ts");
  assert.equal(packageJson.scripts?.["release:artifact-smoke"], "node --import tsx ./scripts/release-artifact-smoke.ts");
  assert.equal(packageJson.scripts?.["eval:release-local"], "node --import tsx ./scripts/eval-release-local.ts");
  assert.equal(packageJson.scripts?.["reference:evidence-smoke"], "node --import tsx ./scripts/reference-evidence-smoke.ts");
  assert.match(packageJson.scripts?.["test:core"] ?? "", /tests\/session-store\.test\.ts|tests\\session-store\.test\.ts/);
  assert.match(packageJson.scripts?.["test:core"] ?? "", /tests\/safety\.test\.ts|tests\\safety\.test\.ts/);
  assert.match(packageJson.scripts?.["test:gateway"] ?? "", /tests\/gateway\.test\.ts|tests\\gateway\.test\.ts/);
  assert.match(packageJson.scripts?.["test:ops"] ?? "", /tests\/cli-ops\.test\.ts|tests\\cli-ops\.test\.ts/);
});

test("release check runs the maturity gate command set", () => {
  for (const expected of ["typecheck", "release:artifact-smoke", "release:diagnostics", "reference:evidence-smoke", "reference:parity", "test", "eval:smoke", "eval:benchmark", "eval:release-local", "build"]) {
    assert.match(releaseCheck, new RegExp(`\"${expected}\"`));
  }
  assert.ok(releaseCheck.indexOf('"build"') < releaseCheck.indexOf('"release:artifact-smoke"'));
  assert.ok(releaseCheck.indexOf('"build"') < releaseCheck.indexOf('"release:diagnostics"'));
  assert.ok(releaseCheck.indexOf('"eval:release-local"') < releaseCheck.indexOf('"release:diagnostics"'));
  assert.ok(releaseCheck.indexOf('"reference:evidence-smoke"') > releaseCheck.indexOf('"release:diagnostics"'));
  assert.ok(releaseCheck.indexOf('"reference:evidence-smoke"') < releaseCheck.indexOf('"reference:parity"'));
  assert.ok(releaseCheck.indexOf('"reference:parity"') > releaseCheck.indexOf('"release:diagnostics"'));
  for (const expectedFile of [
    "docs/operations.md",
    "docs/live-testing.md",
    "examples/evals/capability-scorecard.json",
    "examples/evals/release-local.json",
    "deploy/docker-compose.production.yml",
  ]) {
    assert.match(releaseCheck, new RegExp(expectedFile.replaceAll(".", "\\.")));
  }
});

test("release evidence keeps mature capability and security regressions hard-gated", () => {
  const matureIds = new Set((scorecard.capabilities ?? []).filter((entry) => entry.status === "mature").map((entry) => entry.id));
  assert.deepEqual([...matureIds].sort(), [
    "runtime-mutation-checkpoint-rollback",
    "tool-lifecycle-hooks",
    "workspace-checkpoints",
  ]);

  const hookScenario = benchmarkSuite.scenarios?.find((entry) => entry.id === "compat.tool_lifecycle_hooks");
  assert.ok(hookScenario, "tool lifecycle hook benchmark scenario should exist");
  assert.deepEqual(hookScenario.steps?.[0]?.expectation?.requiredToolNames, [
    "audited_tool:hook:pre",
    "audited_tool:hook:post",
    "write_file:hook:stop",
    "run_verification",
  ]);
  assert.ok(hookScenario.steps?.[0]?.expectation?.requiredFinalResponseIncludes?.includes("approval denial not bypassed"));

  for (const token of [
    "powershell.encoded_command",
    "EncodedCommand",
    "utf16le",
    "powershell.pipeline_remove_item",
    "remove-item|rm|ri|del|erase|rd|rmdir",
    "cmd.del_recursive",
    "del|erase",
  ]) {
    assert.match(commandPolicy, new RegExp(token.replaceAll("|", "\\|")));
  }
});

test("release diagnostics is wired into CI", () => {
  const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
  for (const expected of [
    "npm run build",
    "npm run release:artifact-smoke",
    "npm test",
    "npm run eval:smoke",
    "npm run eval:benchmark",
    "npm run eval:release-local",
    "npm run release:diagnostics",
    "npm run reference:evidence-smoke",
    "npm run reference:parity -- --strict",
  ]) {
    assert.match(ciWorkflow, new RegExp(expected.replaceAll(" ", "\\s+")));
  }
});

test("release diagnostics checks the runnable root bundle redaction path", () => {
  const releaseDiagnostics = readFileSync("scripts/release-diagnostics.ts", "utf8");
  const referenceEvidenceSmoke = readFileSync("scripts/reference-evidence-smoke.ts", "utf8");
  for (const expected of [
    "dist/omni-agent.js",
    "packages/safety/src/index.ts",
    "redactToolResultForRuntime",
    "redactSensitiveText",
    "redactSensitiveValue",
    "modelDiagnostics",
    "poolHealth",
    "packages/session-store/dist/index.js",
    "packages/workspace/dist/index.js",
    "package-lock.json",
    "packageLock.packages",
    "reference:evidence-smoke",
    "releaseLocal.scenarios",
    "run_verification",
    "requiredSuccessfulToolNames",
    "verificationCommands",
    "isTrivialVerificationCommand",
    "must not depend on itself",
    ".artifacts/",
    "summary: redactedResult.summary",
    "payload: redactedResult.data",
    "presentation: redactedResult.presentation",
  ]) {
    assert.match(releaseDiagnostics, new RegExp(expected.replaceAll(".", "\\.")));
  }
  assert.match(releaseDiagnostics, /redactSensitiveValue\(report\)/);
  assert.match(referenceEvidenceSmoke, /redactSensitiveValue\(report\)/);
  assert.match(operationsDoc, /retain the `modelDiagnostics` block with release notes/);
  assert.match(operationsDoc, /aggregate pool health without raw URLs or key values/);
});

test("release-local eval uses non-trivial successful verification commands", () => {
  const steps = releaseLocal.scenarios?.flatMap((scenario) => scenario.steps ?? []) ?? [];
  assert.ok(steps.length >= 5);
  for (const step of steps) {
    assert.ok((step.verificationCommands?.length ?? 0) > 0);
    assert.ok(step.expectation?.requiredSuccessfulToolNames?.includes("run_verification"));
    for (const command of step.verificationCommands ?? []) {
      assert.doesNotMatch(command, /console\.log\(\s*['"][^'"]*(?:ok|pass|passed|success|verification ok)[^'"]*['"]\s*\)/i);
      assert.doesNotMatch(command, /process\.exit\(\s*0\s*\)/i);
      assert.doesNotMatch(command, /^(?:echo|write-output)\s+['"]?(?:ok|pass|passed|success|verification ok)\b/i);
    }
  }
});

test("release-local eval asserts runtime evidence provenance", () => {
  for (const expected of [
    "scenarioResults",
    "stepResults",
    "observedRun",
    "runId",
    "threadId",
    "durationMs",
    "turnCount",
    "toolEvents",
    "run_verification",
    "release.state-continuation",
    "release.subagent-orchestration",
    "spawn_subagent",
    "list_subagents",
  ]) {
    assert.match(evalReleaseLocal, new RegExp(expected.replaceAll(".", "\\.")));
  }
  assert.match(evalReleaseLocal, /toolName\s*!==\s*"run_verification"/);
  assert.match(evalReleaseLocal, /new Set\(continuationThreadIds\)\.size !== 1/);
  assert.match(evalReleaseLocal, /release\.subagent-orchestration has no successful/);
});

test("release-local cleanup retries transient Windows filesystem locks", () => {
  assert.match(evalReleaseLocal, /removeDirectoryWithRetry\(dirname\(outputPath\)\)/);
  assert.match(evalReleaseLocal, /EPERM/);
  assert.match(evalReleaseLocal, /EBUSY/);
  assert.match(evalReleaseLocal, /ENOTEMPTY/);
  assert.match(evalReleaseLocal, /sleepSync\(75 \* attempt\)/);
});

test("synthetic benchmark scripts label their executor provenance", () => {
  for (const script of [evalSmoke, evalBenchmark]) {
    assert.match(script, /mode:\s*"synthetic"/);
    assert.match(script, /implementation:\s*"scripted-observed-run"/);
    assert.match(script, /executor/);
  }
  for (const expected of [
    "cli-runtime-evals",
    "buildLongitudinalBenchmarkReport",
    "history.json",
    "trend.json",
    "latest.json",
    "report.md",
    "failureSummary",
    "estimatedCostUsd",
    "spawnSync",
    "--model-profile",
    "--mode",
  ]) {
    assert.match(evalBenchmark, new RegExp(expected.replaceAll(".", "\\.")));
  }
});

test("release docs gate recently added compatibility surfaces", () => {
  assert.match(releaseChecklist, /Run the targeted capability and security regression set when ACP, Responses, memory hooks/);
  assert.match(
    releaseChecklist,
    /Treat transactional patch and MCP OAuth\/allowlist changes as security\/evidence surfaces covered by `docs\/security\.md`/,
  );
  assert.match(securityDoc, /Every release or deployment image must keep these capability and security review items visible in docs and tests:/);

  for (const expected of [
    "ACP",
    "Responses",
    "memory hooks",
    "inline context references",
    "skill platform gates",
    "checkpoint/rollback",
    "transactional patch",
    "MCP OAuth/allowlist",
    "credential pool",
    "tool lifecycle hooks",
    "browser screenshot artifacts",
    "model routing policy diagnostics",
    "runtime mutation checkpoint rollback",
    "CLI checkpoint slash operations",
    "tests/gateway.test.ts",
    "tests/model-client.test.ts",
    "tests/runtime.test.ts",
    "tests/context.test.ts",
    "tests/workspace.test.ts",
    "tests/tools.test.ts",
    "tests/cli-chat.test.ts",
    "tests/evals.test.ts",
  ]) {
    assert.match(releaseChecklist, new RegExp(expected.replaceAll("/", "\\/")));
  }

  for (const expected of [
    "ACP bridge endpoints",
    "OpenAI Responses profiles",
    "Memory provider hooks",
    "Inline context references",
    "Skill platform gates",
    "Checkpoint and rollback state",
    "Transactional patch application",
    "MCP OAuth and allowlists",
    "Credential pools",
    "Tool lifecycle hooks",
    "Browser screenshot artifacts",
    "Model routing policy diagnostics",
    "CLI checkpoint slash operations",
    "Deployment Security Review",
  ]) {
    assert.match(securityDoc, new RegExp(expected));
  }

  for (const capabilityId of [
    "workspace-checkpoints",
    "credential-pool-rotation",
    "tool-lifecycle-hooks",
    "browser-screenshot-artifact",
    "model-routing-policy-diagnostics",
    "runtime-mutation-checkpoint-rollback",
    "cli-checkpoint-slash-surface",
  ]) {
    assert.match(releaseChecklist, new RegExp(capabilityId));
  }

  for (const checklistSurface of ["transactional patch", "MCP OAuth\\/allowlist"]) {
    assert.match(releaseChecklist, new RegExp(checklistSurface));
  }

  for (const capabilityId of [
    "checkpoint/rollback path",
    "transactional patch flow",
    "MCP OAuth and allowlist evidence surface",
    "credential-pool-rotation",
    "tool-lifecycle-hooks",
    "browser-screenshot-artifact",
    "model-routing-policy-diagnostics",
    "runtime-mutation-checkpoint-rollback",
    "cli-checkpoint-slash-surface",
  ]) {
    assert.match(securityDoc, new RegExp(capabilityId));
  }

  for (const slashCommand of ["/checkpoints", "/checkpoint <label>", "/rollback <id>"]) {
    assert.match(releaseChecklist, new RegExp(slashCommand.replaceAll("/", "\\/")));
    assert.match(securityDoc, new RegExp(slashCommand.replaceAll("/", "\\/")));
  }
});
