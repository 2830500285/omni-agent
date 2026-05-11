import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const files = {
  cli: "apps/cli/src/index.ts",
  cliChatTest: "tests/cli-chat.test.ts",
  tools: "packages/tools/src/index.ts",
  evals: "packages/evals/src/index.ts",
  scorecard: "examples/evals/capability-scorecard.json",
  releaseLocal: "examples/evals/release-local.json",
  toolsLive: "tests/tools-live.test.ts",
  gatewayPlugin: "packages/gateway/src/channel-plugin.ts",
  extensions: "packages/extensions/src/index.ts",
  modelClient: "packages/model-client/src/index.ts",
  sessionStore: "packages/session-store/src/index.ts",
  releaseCheck: "scripts/release-check.ts",
  releaseDiagnostics: "scripts/release-diagnostics.ts",
  maturityCheck: "scripts/maturity-check.ts",
  improve: "IMPROVE.MD",
  security: "docs/security.md",
  operations: "docs/operations.md",
  releaseChecklist: "docs/release-checklist.md",
  liveTesting: "docs/live-testing.md",
  tradingSafety: "docs/trading-safety.md",
  htxReadonlyGateway: "docs/htx-readonly-gateway-contract.md",
  htxLiveGuarded: "examples/evals/htx-live-guarded.json",
  capabilityBackedClaims: "docs/capability-backed-claims.md",
  referenceTranslated: "packages/reference-translated/src/index.ts",
  referenceTranslateScript: "scripts/translate-reference-source-lines.ts",
  referenceTranslatedManifest: "packages/reference-translated/generated/manifest.json",
  referenceNativeImplementationReport: "docs/reference-native-implementation.generated.json",
} as const;

test("M0-M8 maturity upgrade artifacts are present", () => {
  for (const file of Object.values(files)) {
    assert.equal(existsSync(file), true, `${file} should exist`);
  }

  const evals = readFileSync(files.evals, "utf8");
  for (const token of [
    "matureEvidenceFiles",
    "liveOrContractTests",
    "operationalRunbook",
    "failureRecoveryTests",
    "matureCriteria",
    "blockedBy",
  ]) {
    assert.match(evals, new RegExp(token));
  }

  const scorecard = JSON.parse(readFileSync(files.scorecard, "utf8")) as {
    capabilities: Array<{
      id?: string;
      status?: string;
      requiredTests?: string[];
      matureCriteria?: string[];
      blockedBy?: string[];
      matureEvidenceFiles?: string[];
      matureBenchmarkScenarioIds?: string[];
      operationalRunbook?: string;
      failureRecoveryTests?: string[];
    }>;
  };
  assert.ok(scorecard.capabilities.length >= 13);
  assert.ok(scorecard.capabilities.every((capability) => (capability.matureCriteria?.length ?? 0) > 0));
  assert.ok(scorecard.capabilities.every((capability) => (capability.blockedBy?.length ?? 0) > 0));
  for (const capabilityId of [
    "acp-cancel-and-event-projection",
    "responses-streaming-adapter",
    "memory-lifecycle",
    "inline-context-references",
    "skill-platform-gates",
    "browser-screenshot-artifact",
    "model-routing-policy-diagnostics",
    "cli-checkpoint-slash-surface",
  ]) {
    const capability = scorecard.capabilities.find((entry) => entry.id === capabilityId);
    assert.ok(capability, `Missing capability ${capabilityId}`);
    assert.equal(capability.status, "usable");
    assert.ok((capability.requiredTests?.length ?? 0) > 0);
  }
  for (const capabilityId of ["workspace-checkpoints", "runtime-mutation-checkpoint-rollback"]) {
    const capability = scorecard.capabilities.find((entry) => entry.id === capabilityId);
    assert.ok(capability, `Missing rollback hardening capability ${capabilityId}`);
    assert.equal(capability.status, "mature");
    assert.ok(capability.matureEvidenceFiles?.includes(files.releaseLocal));
    assert.ok((capability.matureBenchmarkScenarioIds?.length ?? 0) > 0);
    assert.match(capability.operationalRunbook ?? "", /docs\/operations\.md#checkpoint-and-rollback-recovery/);
    assert.ok((capability.failureRecoveryTests?.length ?? 0) > 0);
  }
  const hookCapability = scorecard.capabilities.find((entry) => entry.id === "tool-lifecycle-hooks");
  assert.ok(hookCapability, "Missing mature tool lifecycle hooks capability");
  assert.equal(hookCapability.status, "mature");
  assert.ok(hookCapability.matureEvidenceFiles?.includes("tests/extensions.test.ts"));
  assert.ok(hookCapability.matureEvidenceFiles?.includes("tests/runtime.test.ts"));
  assert.ok(hookCapability.matureBenchmarkScenarioIds?.includes("compat.tool_lifecycle_hooks"));
  assert.match(hookCapability.operationalRunbook ?? "", /docs\/operations\.md#tool-lifecycle-hooks/);
  assert.ok(hookCapability.failureRecoveryTests?.includes("tests/runtime.test.ts"));

  const genesisCapability = scorecard.capabilities.find((entry) => entry.id === "genesis-finance-agent");
  assert.ok(genesisCapability, "Missing Genesis finance capability");
  assert.ok(genesisCapability.requiredTests?.includes(files.toolsLive));
  assert.ok(genesisCapability.liveOrContractTests?.includes(files.toolsLive));

  const releaseLocal = JSON.parse(readFileSync(files.releaseLocal, "utf8")) as {
    scenarios: Array<{
      id?: string;
      category?: string;
      steps?: Array<{
        objective?: string;
        expectation?: {
          requiredToolNames?: string[];
          requiredSuccessfulToolNames?: string[];
          requiredFinalResponseIncludes?: string[];
        };
      }>;
    }>;
  };
  const rollbackScenario = releaseLocal.scenarios.find((scenario) => scenario.id === "release.runtime-rollback-recovery");
  assert.ok(rollbackScenario, "release-local gate should cover runtime rollback failure recovery");
  assert.equal(rollbackScenario.category, "verification_repair");
  const rollbackStep = rollbackScenario.steps?.[0];
  assert.match(rollbackStep?.objective ?? "", /final verification failure/);
  assert.ok(rollbackStep?.expectation?.requiredToolNames?.includes("create_checkpoint"));
  assert.ok(rollbackStep?.expectation?.requiredToolNames?.includes("run_verification"));
  assert.ok(rollbackStep?.expectation?.requiredToolNames?.includes("rollback_checkpoint"));
  assert.ok(rollbackStep?.expectation?.requiredSuccessfulToolNames?.includes("rollback_checkpoint"));
  assert.ok(rollbackStep?.expectation?.requiredFinalResponseIncludes?.includes("pre-rollback-failure-evidence"));

  const cli = readFileSync(files.cli, "utf8");
  for (const token of ["/health", "/diff", "/review", "/mcp", "/checkpoints", "/checkpoint <label>", "/rollback <id>"]) {
    assert.match(cli, new RegExp(token.replace("/", "\\/")));
  }

  const cliChatTest = readFileSync(files.cliChatTest, "utf8");
  for (const token of ["/checkpoint baseline", "/rollback", "Checkpoint Created", "Checkpoint Rolled Back"]) {
    assert.match(cliChatTest, new RegExp(token.replace("/", "\\/")));
  }

  const gatewayPlugin = readFileSync(files.gatewayPlugin, "utf8");
  for (const token of ["install", "configure", "pair", "receive", "ack", "retry", "health", "shutdown"]) {
    assert.match(gatewayPlugin, new RegExp(token));
  }

  const extensions = readFileSync(files.extensions, "utf8");
  for (const token of ["stdio", "http", "sse", "resource"]) {
    assert.match(extensions, new RegExp(token));
  }

  const modelClient = readFileSync(files.modelClient, "utf8");
  for (const token of ["ModelRouter", "cooldown", "auth_failed", "routeDiagnostics", "buildModelProfileDiagnostics", "[redacted]"]) {
    assert.match(modelClient, new RegExp(token));
  }

  const sessionStore = readFileSync(files.sessionStore, "utf8");
  for (const token of ["subagent_jobs", "file_leases", "automations", "dead_letter"]) {
    assert.match(sessionStore, new RegExp(token));
  }

  const releaseCheck = readFileSync(files.releaseCheck, "utf8");
  for (const token of ["typecheck", "release:diagnostics", "test", "eval:smoke", "eval:benchmark", "build"]) {
    assert.match(releaseCheck, new RegExp(token));
  }

  const releaseDiagnostics = readFileSync(files.releaseDiagnostics, "utf8");
  for (const token of ["buildChannelPluginContractReport", "buildMcpGovernanceReport", "buildModelProfileDiagnostics"]) {
    assert.match(releaseDiagnostics, new RegExp(token));
  }

  const maturityCheck = readFileSync(files.maturityCheck, "utf8");
  for (const token of [
    "validateCapabilityBackedClaims",
    "validateImproveCapabilityMap",
    "IMPROVE.MD",
    "docs/capability-backed-claims.md",
    "severity: \"risk\"",
  ]) {
    assert.match(maturityCheck, new RegExp(token.replaceAll("/", "\\/")));
  }

  const improve = readFileSync(files.improve, "utf8");
  for (const token of [
    "能力映射：`genesis-finance-agent`",
    "能力映射：`benchmark-quality`",
    "能力映射：`production-operations`",
    "能力映射：`memory-lifecycle`",
  ]) {
    assert.match(improve, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const capabilityBackedClaims = readFileSync(files.capabilityBackedClaims, "utf8");
  for (const token of [
    "Capability-Backed Agent Claims",
    "local-coding-runtime-usable",
    "workspace-checkpoints-mature",
    "runtime-mutation-rollback-mature",
    "tool-lifecycle-hooks-mature",
    "npm run maturity:check",
  ]) {
    assert.match(capabilityBackedClaims, new RegExp(token));
  }

  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /docs\/capability-backed-claims\.md/);
  assert.match(readme, /npm run maturity:check/);

  const security = readFileSync(files.security, "utf8");
  for (const token of [
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
    assert.match(security, new RegExp(token));
  }

  const tradingSafety = readFileSync(files.tradingSafety, "utf8");
  for (const token of [
    "OMNI_AGENT_ENABLE_LIVE_HTX_SPOT=1",
    "spot-trade scope only",
    "Withdrawal, margin, loan, leverage, derivatives, futures, and contract scopes are disabled",
    "human approval",
    "post-order status payload",
  ]) {
    assert.match(tradingSafety, new RegExp(token.replaceAll(".", "\\.")));
  }

  const htxReadonlyGateway = readFileSync(files.htxReadonlyGateway, "utf8");
  for (const token of ["GET /htx/account-snapshot", "auth_missing", "permission_denied", "rate_limit", "network_timeout"]) {
    assert.match(htxReadonlyGateway, new RegExp(token.replaceAll("/", "\\/")));
  }

  const htxLiveGuarded = readFileSync(files.htxLiveGuarded, "utf8");
  for (const token of ["htx.live_spot_disabled_by_default", "OMNI_AGENT_ENABLE_LIVE_HTX_SPOT", "missing_approval"]) {
    assert.match(htxLiveGuarded, new RegExp(token));
  }

  const releaseChecklist = readFileSync(files.releaseChecklist, "utf8");
  for (const token of [
    "tests/release-check.test.ts",
    "tests/maturity-artifacts.test.ts",
    "tests/model-client.test.ts",
    "acp-cancel-and-event-projection",
    "responses-streaming-adapter",
    "memory-lifecycle",
    "inline-context-references",
    "skill-platform-gates",
    "workspace-checkpoints",
    "transactional patch",
    "MCP OAuth/allowlist",
    "credential-pool-rotation",
    "tool-lifecycle-hooks",
    "browser-screenshot-artifact",
    "model-routing-policy-diagnostics",
    "runtime-mutation-checkpoint-rollback",
    "cli-checkpoint-slash-surface",
    "tests/tools.test.ts",
    "tests/cli-chat.test.ts",
  ]) {
    assert.match(releaseChecklist, new RegExp(token.replaceAll(".", "\\.")));
  }

  const tools = readFileSync(files.tools, "utf8");
  for (const token of ["browser_screenshot", "browser-screenshot", "read_artifact"]) {
    assert.match(tools, new RegExp(token));
  }

  const operations = readFileSync(files.operations, "utf8");
  for (const token of ["Checkpoint And Rollback Recovery", "pre-rollback-failure-evidence", "modified text and binary files"]) {
    assert.match(operations, new RegExp(token));
  }

  const runtime = readFileSync("packages/core-runtime/src/index.ts", "utf8");
  for (const token of [
    "mutationCheckpointMode",
    "verificationFailureRollbackMode",
    "runtime-mutation-checkpoint",
    "runtime-final-failure-rollback",
    "pre-rollback-failure-evidence",
  ]) {
    assert.match(runtime, new RegExp(token));
  }

  const referenceTranslated = readFileSync(files.referenceTranslated, "utf8");
  for (const token of ["loadTranslatedReferenceManifest", "findTranslatedReferenceFile", "TranslatedReferenceFileEntry"]) {
    assert.match(referenceTranslated, new RegExp(token));
  }

  const referenceTranslateScript = readFileSync(files.referenceTranslateScript, "utf8");
  for (const token of ["hermes-agent-main", "openclaw-main", "claudecode-source", "export const lines"]) {
    assert.match(referenceTranslateScript, new RegExp(token));
  }

  const toolsReferenceNative = readFileSync(files.tools, "utf8");
  for (const token of ["reference_native", "summarizeNativeImplementationCoverage", "executeNativeImplementation"]) {
    assert.match(toolsReferenceNative, new RegExp(token));
  }

  const nativeImplementationReport = JSON.parse(readFileSync(files.referenceNativeImplementationReport, "utf8")) as {
    coverage?: { total?: number; nativeImplemented?: number; upstreamRuntimeRequired?: number };
  };
  assert.equal(nativeImplementationReport.coverage?.total, 173);
  assert.equal(nativeImplementationReport.coverage?.nativeImplemented, 173);
  assert.equal(nativeImplementationReport.coverage?.upstreamRuntimeRequired, 0);
});

test("capability-backed README and doc claims pass maturity validation", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", files.maturityCheck], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      TSX_DISABLE_CACHE: "1",
      TSX_TSCONFIG_PATH: "./tsconfig.base.json",
    },
  });
  const report = JSON.parse(output) as {
    claimEvidence?: {
      claimCount?: number;
      risks?: Array<{ claimId?: string; severity?: string }>;
      issues?: Array<{ severity?: string }>;
      claims?: Array<{ claimId?: string; minimumStatus?: string }>;
    };
    improveCapabilityMap?: {
      sectionCount?: number;
      mappedSectionCount?: number;
      issues?: Array<{ severity?: string }>;
      mappings?: Array<{ sectionId?: string; capabilityIds?: string[] }>;
    };
  };

  assert.ok((report.claimEvidence?.claimCount ?? 0) >= 5);
  assert.equal(report.claimEvidence?.issues?.some((issue) => issue.severity === "error"), false);
  assert.ok(report.claimEvidence?.risks?.some((issue) => issue.claimId === "local-coding-runtime-usable"));
  assert.ok(report.claimEvidence?.claims?.some((claim) => claim.claimId === "workspace-checkpoints-mature" && claim.minimumStatus === "mature"));
  assert.ok((report.improveCapabilityMap?.sectionCount ?? 0) >= 14);
  assert.equal(report.improveCapabilityMap?.mappedSectionCount, report.improveCapabilityMap?.sectionCount);
  assert.equal(report.improveCapabilityMap?.issues?.some((issue) => issue.severity === "error"), false);
  assert.ok(
    report.improveCapabilityMap?.mappings?.some(
      (mapping) => mapping.sectionId === "P1.4" && mapping.capabilityIds?.includes("eval-program-governance"),
    ),
  );
});
