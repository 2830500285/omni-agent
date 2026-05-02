import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";

const cliTestEnv = {
  ...process.env,
  GOMAXPROCS: "1",
  TSX_TSCONFIG_PATH: resolve("tsconfig.base.json"),
  TSX_DISABLE_CACHE: "1",
};

test("setup persists local config and config prints it", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-setup-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-setup-store-"));

  try {
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ name: "fixture" }, null, 2), "utf8");

    const setupResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "setup",
        "--storage-root",
        storageRoot,
        "--default-workspace",
        workspaceRoot,
        "--gateway-token",
        "local-dev-token",
        "--profile-id",
        "primary",
        "--profile-name",
        "Primary",
        "--protocol",
        "anthropic",
        "--base-url",
        "https://api.anthropic.com",
        "--api-key-env",
        "ANTHROPIC_API_KEY",
        "--model",
        "claude-sonnet-4-5",
        "--supports-tools",
        "true",
        "--supports-streaming",
        "true",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);
    assert.match(setupResult.stdout, /Omni Agent Setup/);
    const configPath = join(storageRoot, "config.json");
    assert.equal(existsSync(configPath), true);

    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      defaultWorkspace?: string;
      gatewayToken?: string;
      modelProfiles?: Array<{ id?: string; protocol?: string; model?: string }>;
    };
    assert.equal(config.defaultWorkspace, resolve(workspaceRoot));
    assert.equal(config.gatewayToken, "local-dev-token");
    assert.deepEqual(config.modelProfiles, [
      {
        id: "primary",
        name: "Primary",
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        model: "claude-sonnet-4-5",
        supportsTools: true,
        supportsStreaming: true,
      },
    ]);

    const configResult = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("apps/cli/src/index.ts"), "config", "--storage-root", storageRoot],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(configResult.status, 0, configResult.stderr || configResult.stdout);
    assert.match(configResult.stdout, /Omni Agent Config/);
    assert.match(configResult.stdout, /Gateway token: configured/);
    assert.match(configResult.stdout, /primary:anthropic:claude-sonnet-4-5/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("models and doctor use persisted config when env profile JSON is absent", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-config-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-config-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    initializeGitRepository(workspaceRoot);

    const setupResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "setup",
        "--storage-root",
        storageRoot,
        "--default-workspace",
        workspaceRoot,
        "--profile-id",
        "primary",
        "--protocol",
        "openai",
        "--base-url",
        "https://api.openai.com/v1",
        "--api-key-env",
        "OPENAI_API_KEY",
        "--model",
        "gpt-4.1-mini",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );
    assert.equal(setupResult.status, 0, setupResult.stderr || setupResult.stdout);

    const modelsResult = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("apps/cli/src/index.ts"), "models", "--storage-root", storageRoot],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...cliTestEnv,
          OPENAI_API_KEY: "present",
        },
      },
    );

    assert.equal(modelsResult.status, 0, modelsResult.stderr || modelsResult.stdout);
    assert.match(modelsResult.stdout, /Source:\s+json/i);
    assert.match(modelsResult.stdout, /primary/);
    assert.match(modelsResult.stdout, /configured/);

    const doctorResult = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("apps/cli/src/index.ts"), "doctor", "--storage-root", storageRoot, "--mode", "openai"],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...cliTestEnv,
          OPENAI_API_KEY: "present",
        },
      },
    );

    assert.equal(doctorResult.status, 0, doctorResult.stderr || doctorResult.stdout);
    assert.match(doctorResult.stdout, /Workspace:\s+.*omni-agent-config-workspace-/i);
    assert.match(doctorResult.stdout, /Source:\s+json/i);
    assert.match(doctorResult.stdout, /\[ok\]\s+Models:/i);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

function initializeGitRepository(cwd: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "omni-agent@example.com"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Omni Agent"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd, stdio: "ignore" });
}
