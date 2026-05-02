import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const repoRoot = resolve(process.cwd());
const checkId = process.argv[2];
const failures: string[] = [];

switch (checkId) {
  case "metadata":
    assertPackageMetadata();
    break;
  case "release-gates":
    assertReleaseGates();
    break;
  case "state-continuation":
    assertReleaseLocalStateContinuation();
    break;
  default:
    failures.push(`Unknown release-local verification check: ${checkId ?? "(missing)"}`);
}

if (failures.length > 0) {
  console.error(`Release-local verification failed: ${failures.join("; ")}`);
  process.exit(1);
}

console.log(`Release-local verification passed: ${checkId}`);

function assertPackageMetadata(): void {
  const packageJson = readJsonFile<{
    bin?: Record<string, string>;
    files?: string[];
    scripts?: Record<string, string>;
  }>("package.json");

  requireEqual(packageJson.bin?.["omni-agent"], "./dist/omni-agent.js", "package.json bin.omni-agent");
  for (const scriptName of ["build", "release:artifact-smoke", "eval:release-local", "release:diagnostics", "reference:parity"]) {
    requirePresent(packageJson.scripts?.[scriptName], `package.json scripts.${scriptName}`);
  }
  for (const packageFile of ["dist/", "README.md", "docs/", "deploy/", "examples/evals/*.json"]) {
    if (!packageJson.files?.includes(packageFile)) {
      failures.push(`package.json files is missing ${packageFile}`);
    }
  }
  requireFile("README.md");
  requireFile("examples/evals/release-local.json");
  requireFile("packages/core-runtime/src/index.ts");
}

function assertReleaseGates(): void {
  const releaseCheck = readTextFile("scripts/release-check.ts");
  const ciWorkflow = readTextFile(".github/workflows/ci.yml");

  for (const command of [
    "typecheck",
    "build",
    "release:artifact-smoke",
    "eval:release-local",
    "release:diagnostics",
    "reference:parity",
    "test",
    "eval:benchmark",
    "maturity:check",
  ]) {
    if (!releaseCheck.includes(`"${command}"`)) {
      failures.push(`release-check.ts is missing ${command}`);
    }
  }

  for (const ciCommand of [
    "npm run release:artifact-smoke",
    "npm run eval:release-local",
    "npm run release:diagnostics",
    "npm run reference:parity -- --strict",
  ]) {
    if (!ciWorkflow.includes(ciCommand)) {
      failures.push(`CI workflow is missing ${ciCommand}`);
    }
  }
}

function assertReleaseLocalStateContinuation(): void {
  const releaseLocal = readJsonFile<{
    scenarios?: Array<{
      id?: string;
      category?: string;
      steps?: Array<{
        id?: string;
        expectation?: {
          requiredFinalResponseIncludes?: string[];
          requiredSuccessfulToolNames?: string[];
        };
      }>;
    }>;
  }>("examples/evals/release-local.json");

  const scenario = releaseLocal.scenarios?.find((entry) => entry.id === "release.state-continuation");
  if (!scenario) {
    failures.push("release-local manifest is missing release.state-continuation");
    return;
  }
  requireEqual(scenario.category, "long_context_modification", "release.state-continuation category");
  const continueStep = scenario.steps?.find((step) => step.id === "continue");
  if (!continueStep) {
    failures.push("release.state-continuation is missing continue step");
    return;
  }
  if (!continueStep.expectation?.requiredFinalResponseIncludes?.includes("release-local eval")) {
    failures.push("continue step does not require release-local eval in the final response");
  }
  if (!continueStep.expectation?.requiredSuccessfulToolNames?.includes("run_verification")) {
    failures.push("continue step does not require successful run_verification");
  }
}

function requireFile(path: string): void {
  if (!existsSync(resolve(repoRoot, path))) {
    failures.push(`missing required file: ${path}`);
  }
}

function requirePresent(value: unknown, label: string): void {
  if (value === undefined || value === null || value === "") {
    failures.push(`${label} is missing`);
  }
}

function requireEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    failures.push(`${label} expected ${JSON.stringify(expected)} but saw ${JSON.stringify(actual)}`);
  }
}

function readTextFile(path: string): string {
  const absolutePath = resolve(repoRoot, path);
  if (!existsSync(absolutePath)) {
    failures.push(`missing required file: ${path}`);
    return "";
  }
  return readFileSync(absolutePath, "utf8");
}

function readJsonFile<T>(path: string): T {
  const content = readTextFile(path);
  if (!content) {
    return {} as T;
  }
  return JSON.parse(content) as T;
}
