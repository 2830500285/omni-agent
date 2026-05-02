import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

interface PackFile {
  readonly path?: string;
}

interface PackEntry {
  readonly filename?: string;
  readonly files?: PackFile[];
}

const repoRoot = resolve(process.cwd());
const cliPath = resolve(repoRoot, "dist/omni-agent.js");
const artifactRoot = resolve(repoRoot, ".artifacts/release-artifact-smoke");
const packDir = resolve(artifactRoot, "pack");
const installDir = resolve(artifactRoot, "install");
const npmCliPath = resolveNpmCliPath(process.env.npm_execpath);

if (!existsSync(cliPath)) {
  console.error(`Built CLI is missing: ${cliPath}`);
  process.exit(1);
}

const helpResult = spawnSync(process.execPath, [cliPath, "--help"], {
  cwd: repoRoot,
  encoding: "utf8",
});
if (helpResult.status !== 0) {
  console.error(`Built CLI help smoke failed with exit code ${helpResult.status ?? 1}.`);
  if (helpResult.stderr.trim()) {
    console.error(helpResult.stderr.trim());
  }
  process.exit(helpResult.status ?? 1);
}
if (!/omni-agent|Usage/i.test(`${helpResult.stdout}\n${helpResult.stderr}`)) {
  console.error("Built CLI help smoke did not print recognizable help output.");
  process.exit(1);
}

rmSync(artifactRoot, { recursive: true, force: true });
mkdirSync(packDir, { recursive: true });
mkdirSync(installDir, { recursive: true });
writeFileSync(
  resolve(installDir, "package.json"),
  `${JSON.stringify({ name: "omni-agent-release-smoke-consumer", private: true }, null, 2)}\n`,
  "utf8",
);

const dryRunResult = runNpm(["pack", "--dry-run", "--json"], repoRoot);
if (dryRunResult.status !== 0) {
  console.error(`npm pack dry-run failed with exit code ${dryRunResult.status ?? 1}.`);
  printSpawnFailure(dryRunResult);
  process.exit(dryRunResult.status ?? 1);
}

const dryRunEntries = parsePackEntries(dryRunResult.stdout, "npm pack dry-run");
const packedFiles = new Set(dryRunEntries.flatMap((entry) => entry.files ?? []).map((file) => file.path).filter(Boolean));
const requiredFiles = ["dist/omni-agent.js", "package.json", "README.md"];
const missingFiles = requiredFiles.filter((file) => !packedFiles.has(file));
if (missingFiles.length > 0) {
  console.error(`npm pack dry-run is missing required file(s): ${missingFiles.join(", ")}`);
  process.exit(1);
}

const packResult = runNpm(["pack", "--json", "--pack-destination", packDir], repoRoot);
if (packResult.status !== 0) {
  console.error(`npm pack failed with exit code ${packResult.status ?? 1}.`);
  printSpawnFailure(packResult);
  process.exit(packResult.status ?? 1);
}
const packEntries = parsePackEntries(packResult.stdout, "npm pack");
const tarballName = packEntries[0]?.filename;
if (!tarballName) {
  console.error("npm pack did not report a tarball filename.");
  process.exit(1);
}
const tarballPath = resolve(packDir, tarballName);
if (!existsSync(tarballPath)) {
  console.error(`npm pack did not create the expected tarball: ${tarballPath}`);
  process.exit(1);
}

const installResult = runNpm(
  ["install", "--ignore-scripts", "--omit=dev", "--no-save", "--package-lock=false", "--prefix", installDir, tarballPath],
  installDir,
);
if (installResult.status !== 0) {
  console.error(`npm install tarball smoke failed with exit code ${installResult.status ?? 1}.`);
  printSpawnFailure(installResult);
  process.exit(installResult.status ?? 1);
}

const installedCliPath = resolve(installDir, "node_modules/omni-agent/dist/omni-agent.js");
if (!existsSync(installedCliPath)) {
  console.error(`Installed CLI entry is missing: ${installedCliPath}`);
  process.exit(1);
}
const installedHelpResult = spawnSync(process.execPath, [installedCliPath, "--help"], {
  cwd: installDir,
  encoding: "utf8",
});
if (installedHelpResult.status !== 0) {
  console.error(`Installed CLI help smoke failed with exit code ${installedHelpResult.status ?? 1}.`);
  if (installedHelpResult.stderr.trim()) {
    console.error(installedHelpResult.stderr.trim());
  }
  process.exit(installedHelpResult.status ?? 1);
}
if (!/omni-agent|Usage/i.test(`${installedHelpResult.stdout}\n${installedHelpResult.stderr}`)) {
  console.error("Installed CLI help smoke did not print recognizable help output.");
  process.exit(1);
}

console.log(
  `Release artifact smoke passed: built CLI help works, pack includes ${requiredFiles.join(", ")}, and installed tarball CLI starts.`,
);

function runNpm(args: string[], cwd: string): ReturnType<typeof spawnSync> {
  const command = npmCliPath ? process.execPath : "npm";
  const commandArgs = npmCliPath ? [npmCliPath, ...args] : args;
  return spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: buildCleanNpmEnv(cwd),
    shell: !npmCliPath && process.platform === "win32",
  });
}

function printSpawnFailure(result: ReturnType<typeof spawnSync>): void {
  const error = result.error;
  if (error) {
    console.error(error.message);
  }
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  if (stderr) {
    console.error(stderr);
  }
}

function buildCleanNpmEnv(cwd: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("npm_package_") || key.startsWith("npm_lifecycle_")) {
      delete env[key];
    }
  }
  delete env.npm_package_json;
  delete env.npm_config_workspace;
  delete env.npm_config_workspaces;
  delete env.npm_config_include_workspace_root;
  delete env.npm_execpath;
  delete env.npm_node_execpath;
  env.npm_config_local_prefix = cwd;
  env.npm_config_workspaces = "false";
  env.npm_config_include_workspace_root = "false";
  env.INIT_CWD = cwd;
  return env;
}

function parsePackEntries(stdout: string, label: string): PackEntry[] {
  try {
    return JSON.parse(stdout) as PackEntry[];
  } catch (error) {
    console.error(`Could not parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function resolveNpmCliPath(candidate: string | undefined): string | null {
  if (!candidate) {
    return null;
  }
  const normalized = candidate.replace(/\\/g, "/").toLowerCase();
  const base = basename(normalized);
  if (base === "npm-cli.js" || normalized.includes("/npm/bin/npm-cli.js")) {
    return candidate;
  }
  console.error(`release:artifact-smoke must run with npm; npm_execpath points at a non-npm CLI: ${candidate}`);
  process.exit(1);
}
