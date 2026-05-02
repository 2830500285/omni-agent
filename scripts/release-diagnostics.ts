import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { buildMcpGovernanceReport } from "@omni-agent/extensions";
import { buildChannelPluginContractReport } from "@omni-agent/gateway";
import { buildModelProfileDiagnostics } from "@omni-agent/model-client";
import { redactSensitiveValue } from "@omni-agent/safety";

interface ReleaseDiagnosticIssue {
  readonly severity: "error" | "warning";
  readonly area: string;
  readonly message: string;
}

const repoRoot = resolve(process.cwd());
const packageJson = readJsonFile<{ scripts?: Record<string, string> }>("package.json");
const packageName = readJsonFile<{ name?: string }>("package.json").name ?? "omni-agent";
const packageDependencies = readJsonFile<{
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}>("package.json");
const packageLock = readJsonFile<{ packages?: Record<string, { resolved?: string; link?: boolean }> }>("package-lock.json");
const scorecard = readJsonFile<{
  capabilities?: Array<{
    id?: string;
    maturity?: string;
    matureCriteria?: string[];
    blockedBy?: string[];
    liveOrContractTests?: string[];
  }>;
}>("examples/evals/capability-scorecard.json");
const releaseLocal = readJsonFile<{
  scenarios?: Array<{
    id?: string;
    category?: string;
    steps?: Array<{
      verificationCommands?: string[];
      expectation?: {
        verificationStatus?: string;
        requiredToolNames?: string[];
        requiredSuccessfulToolNames?: string[];
        requiredFinalResponseIncludes?: string[];
      };
    }>;
  }>;
}>("examples/evals/release-local.json");
const ciWorkflow = readTextFile(".github/workflows/ci.yml");
const rootBundle = readTextFile("dist/omni-agent.js");
const issues: ReleaseDiagnosticIssue[] = [];

for (const file of [
  "CAPABILITY_COMPARISON.md",
  "IMPROVE.MD",
  "docs/operations.md",
  "docs/live-testing.md",
  "docs/release-checklist.md",
  "deploy/env.example",
  "deploy/Dockerfile",
  "deploy/docker-compose.production.yml",
  "examples/evals/capability-scorecard.json",
  "examples/evals/release-local.json",
  "packages/safety/src/index.ts",
  "tests/safety.test.ts",
  ".github/workflows/ci.yml",
]) {
  if (!existsSync(resolve(repoRoot, file))) {
    addIssue("error", "files", `Missing required release artifact: ${file}`);
  }
}

const requiredScripts = {
  "test:core": "node ./scripts/run-tests.mjs",
  "test:gateway": "node ./scripts/run-tests.mjs",
  "test:ops": "node ./scripts/run-tests.mjs",
  "eval:release-local": "node --import tsx ./scripts/eval-release-local.ts",
  "release:artifact-smoke": "node --import tsx ./scripts/release-artifact-smoke.ts",
  "release:diagnostics": "node --import tsx ./scripts/release-diagnostics.ts",
  "reference:evidence-smoke": "node --import tsx ./scripts/reference-evidence-smoke.ts",
  "reference:parity": "node --import tsx ./scripts/reference-parity.ts",
  "maturity:check": "node --import tsx ./scripts/maturity-check.ts",
  "release:check": "node --import tsx ./scripts/release-check.ts",
} as const;

for (const [scriptName, expectedCommandPrefix] of Object.entries(requiredScripts)) {
  const command = packageJson.scripts?.[scriptName];
  if (!command) {
    addIssue("error", "scripts", `package.json is missing ${scriptName}.`);
    continue;
  }
  if (!command.startsWith(expectedCommandPrefix)) {
    addIssue("error", "scripts", `${scriptName} should start with "${expectedCommandPrefix}".`);
  }
}

for (const [dependencyName, dependencySpec] of Object.entries({
  ...(packageDependencies.dependencies ?? {}),
  ...(packageDependencies.optionalDependencies ?? {}),
})) {
  if (dependencyName === packageName) {
    addIssue("error", "package", `package.json must not depend on itself: ${dependencyName}.`);
  }
  if (dependencySpec.includes(".artifacts/") || dependencySpec.includes(".artifacts\\")) {
    addIssue("error", "package", `package.json dependency ${dependencyName} points at generated artifacts: ${dependencySpec}.`);
  }
}

for (const expectedSnippet of [
  "npm run build",
  "npm test",
  "npm run release:artifact-smoke",
  "npm run eval:smoke",
  "npm run eval:benchmark",
  "npm run eval:release-local",
  "npm run release:diagnostics",
  "npm run reference:evidence-smoke",
  "npm run reference:parity -- --strict",
  "npm run maturity:check",
]) {
  if (!ciWorkflow.includes(expectedSnippet)) {
    addIssue("error", "ci", `CI workflow does not run "${expectedSnippet}".`);
  }
}

if (!rootBundle) {
  addIssue("error", "bundle", "dist/omni-agent.js is missing; run npm run build before release diagnostics.");
} else {
  for (const expectedSnippet of [
    "redactToolResultForRuntime",
    "redactSensitiveText",
    "redactSensitiveValue",
    "summary: redactedResult.summary",
    "payload: redactedResult.data",
    "presentation: redactedResult.presentation",
    "notifyMemoryProviderWrite(resolved.toolName, resolved.args, redactedResult)",
  ]) {
    if (!rootBundle.includes(expectedSnippet)) {
      addIssue("error", "bundle", `dist/omni-agent.js is missing redacted runtime marker: ${expectedSnippet}`);
    }
  }
  for (const staleSnippet of [
    "summary: result.summary,\n            payload: result.data,\n            presentation: result.presentation",
    "summary: result.summary,\n              details: persistedOutput.details",
  ]) {
    if (rootBundle.includes(staleSnippet)) {
      addIssue("error", "bundle", `dist/omni-agent.js still contains stale raw runtime output marker: ${staleSnippet}`);
    }
  }
}

const safetySource = readTextFile("packages/safety/src/index.ts");
for (const expectedSnippet of [
  "SENSITIVE_KEY_RE",
  "SENSITIVE_VALUE_PATTERNS",
  "redactSensitiveText",
  "redactSensitiveValue",
]) {
  if (!safetySource.includes(expectedSnippet)) {
    addIssue("error", "safety", `Shared safety module is missing marker: ${expectedSnippet}`);
  }
}

const capabilities = scorecard.capabilities ?? [];
if (capabilities.length < 13) {
  addIssue("error", "evals", `Capability scorecard has only ${capabilities.length} capabilities.`);
}

const releaseLocalScenarios = releaseLocal.scenarios ?? [];
const releaseLocalSteps = releaseLocalScenarios.flatMap((scenario) =>
  (scenario.steps ?? []).map((step) => ({ scenario, step }))
);
if (releaseLocalScenarios.length < 3) {
  addIssue("error", "evals", `Release-local eval has only ${releaseLocalScenarios.length} scenarios.`);
}
for (const category of ["single_agent_bugfix", "verification_repair", "long_context_modification"]) {
  if (!releaseLocalScenarios.some((scenario) => scenario.category === category)) {
    addIssue("error", "evals", `Release-local eval is missing category coverage: ${category}.`);
  }
}
for (const { scenario, step } of releaseLocalSteps) {
  const label = scenario.id ?? "(unknown)";
  const verificationCommands = step.verificationCommands ?? [];
  if (verificationCommands.length === 0) {
    addIssue("error", "evals", `${label} has a release-local step without verificationCommands.`);
  }
  for (const command of verificationCommands) {
    if (isTrivialVerificationCommand(command)) {
      addIssue("error", "evals", `${label} uses a trivial release-local verification command: ${command}`);
    }
  }
  if (step.expectation?.verificationStatus !== "passed") {
    addIssue("error", "evals", `${label} does not require passed verification.`);
  }
  if (!step.expectation?.requiredToolNames?.includes("run_verification")) {
    addIssue("error", "evals", `${label} does not require run_verification.`);
  }
  if (!step.expectation?.requiredSuccessfulToolNames?.includes("run_verification")) {
    addIssue("error", "evals", `${label} does not require successful run_verification.`);
  }
}
for (const capability of capabilities) {
  const label = capability.id ?? "(unknown)";
  if ((capability.matureCriteria?.length ?? 0) === 0) {
    addIssue("error", "evals", `${label} has no matureCriteria.`);
  }
  if ((capability.blockedBy?.length ?? 0) === 0) {
    addIssue("error", "evals", `${label} has no blockedBy list.`);
  }
  if ((capability.liveOrContractTests?.length ?? 0) === 0) {
    addIssue("warning", "evals", `${label} has no liveOrContractTests evidence.`);
  }
}

const channelReport = buildChannelPluginContractReport();
for (const issue of channelReport.issues) {
  addIssue(issue.severity, "channel-sdk", `${issue.pluginId}: ${issue.reason}`);
}

const mcpReport = buildMcpGovernanceReport([
  {
    source: "release-diagnostics",
    servers: {
      local_reference: {
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: {
          LOCAL_ONLY: "1",
        },
      },
    },
  },
]);
for (const issue of mcpReport.issues) {
  addIssue(issue.severity, "mcp", `${issue.serverId}: ${issue.reason}`);
}

const modelDiagnostics = buildModelProfileDiagnostics();
if (modelDiagnostics.profileCount === 0) {
  addIssue("warning", "models", "No persisted or environment model profiles were discovered.");
}

for (const entryPoint of ["packages/safety/dist/index.js", "packages/session-store/dist/index.js", "packages/workspace/dist/index.js"]) {
  if (!existsSync(resolve(repoRoot, entryPoint))) {
    addIssue("error", "package-imports", `Built package entry point is missing: ${entryPoint}`);
  }
}

for (const [packageName, resolvedPath] of Object.entries({
  "@omni-agent/safety": "packages/safety",
  "@omni-agent/session-store": "packages/session-store",
  "@omni-agent/workspace": "packages/workspace",
})) {
  const lockEntry = packageLock.packages?.[`node_modules/${packageName}`];
  if (!lockEntry?.link || lockEntry.resolved !== resolvedPath) {
    addIssue("error", "package-imports", `package-lock.json is missing workspace link metadata for ${packageName}.`);
  }
}

const errorCount = issues.filter((issue) => issue.severity === "error").length;
const warningCount = issues.filter((issue) => issue.severity === "warning").length;
const report = {
  generatedAt: new Date().toISOString(),
  ok: errorCount === 0,
  errorCount,
  warningCount,
  scripts: Object.keys(requiredScripts),
  capabilityCount: capabilities.length,
  channelPluginCount: channelReport.pluginCount,
  mcpServerCount: mcpReport.serverCount,
  modelProfileCount: modelDiagnostics.profileCount,
  modelDiagnostics: {
    source: modelDiagnostics.source,
    profileCount: modelDiagnostics.profileCount,
    configuredKeyCount: modelDiagnostics.configuredKeyCount,
    toolCapableCount: modelDiagnostics.toolCapableCount,
    streamingCapableCount: modelDiagnostics.streamingCapableCount,
    issueCount: modelDiagnostics.issues.length,
    profileIds: modelDiagnostics.profiles.map((profile) => profile.id),
    protocols: Array.from(new Set(modelDiagnostics.profiles.map((profile) => profile.protocol))).sort(),
    poolHealth: {
      totalCount: modelDiagnostics.profiles.reduce((total, profile) => total + profile.credentialPool.credentialCount, 0),
      configuredCount: modelDiagnostics.profiles.reduce((total, profile) => total + profile.credentialPool.configuredCount, 0),
      healthyCount: modelDiagnostics.profiles.reduce((total, profile) => total + profile.credentialPool.healthyCount, 0),
      cooldownCount: modelDiagnostics.profiles.reduce((total, profile) => total + profile.credentialPool.cooldownCount, 0),
    },
  },
  issues,
};

console.log(JSON.stringify(redactSensitiveValue(report), null, 2));
if (errorCount > 0) {
  process.exit(1);
}

function addIssue(severity: ReleaseDiagnosticIssue["severity"], area: string, message: string): void {
  issues.push({ severity, area, message });
}

function readTextFile(path: string): string {
  const absolutePath = resolve(repoRoot, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
}

function readJsonFile<T>(path: string): T {
  const content = readTextFile(path);
  return content ? (JSON.parse(content) as T) : ({} as T);
}

function isTrivialVerificationCommand(command: string): boolean {
  const normalized = command.trim();
  return [
    /console\.log\(\s*['"][^'"]*(?:ok|pass|passed|success|verification ok)[^'"]*['"]\s*\)/i,
    /process\.exit\(\s*0\s*\)/i,
    /^(?:echo|write-output)\s+['"]?(?:ok|pass|passed|success|verification ok)\b/i,
  ].some((pattern) => pattern.test(normalized));
}
