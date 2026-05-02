import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const repoRoot = resolve(process.cwd());
const npmExecPath = process.env.npm_execpath;
const requiredFiles = [
  "CAPABILITY_COMPARISON.md",
  "IMPROVE.MD",
  "docs/security.md",
  "docs/operations.md",
  "docs/live-testing.md",
  "docs/release-checklist.md",
  "deploy/env.example",
  "deploy/Dockerfile",
  "deploy/docker-compose.production.yml",
  "examples/evals/capability-scorecard.json",
  "examples/evals/release-local.json",
] as const;
const gates = [
  ["run", "typecheck"],
  ["run", "build"],
  ["run", "release:artifact-smoke"],
  ["run", "eval:release-local"],
  ["run", "release:diagnostics"],
  ["run", "reference:evidence-smoke"],
  ["run", "reference:parity", "--", "--strict"],
  ["test"],
  ["run", "eval:smoke"],
  ["run", "eval:benchmark"],
  ["run", "maturity:check"],
] as const;

const missingFiles = requiredFiles.filter((file) => !existsSync(resolve(repoRoot, file)));
if (missingFiles.length > 0) {
  console.error(`Release check is missing required file(s): ${missingFiles.join(", ")}`);
  process.exit(1);
}

for (const args of gates) {
  const label = `npm ${args.join(" ")}`;
  console.log(`\n==> ${label}`);
  const command = npmExecPath ? process.execPath : "npm";
  const commandArgs = npmExecPath ? [npmExecPath, ...args] : [...args];
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
    shell: !npmExecPath && process.platform === "win32",
  });
  if (result.error) {
    console.error(`Failed to run ${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nRelease check completed.");
