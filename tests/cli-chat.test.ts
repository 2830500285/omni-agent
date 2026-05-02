import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("chat command supports status, task execution, history, and exit", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-workspace-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "chat-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceRoot, "README.md"), "# chat fixture\n", "utf8");
    initializeGitRepository(workspaceRoot);

    const cliEntry = resolve("apps/cli/src/index.ts");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
        "--history-limit",
        "4",
      ],
      {
        cwd: resolve("."),
        input: ["/status", "/model", "Inspect the repository scaffold", "/usage", "/history 4", "/exit"].join("\n") + "\n",
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Omni Agent Chat/);
    assert.match(result.stdout, /Chat Status/);
    assert.match(result.stdout, /Model Selection/);
    assert.match(result.stdout, /assistant>/);
    assert.match(result.stdout, /Session Usage/);
    assert.match(result.stdout, /Tool calls:/);
    assert.match(result.stdout, /Thread /);
    assert.match(result.stdout, /Exiting chat\./);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("chat command can show session details and compact older history", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-compact-workspace-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-compact-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "chat-compact-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceRoot, "README.md"), "# chat compact fixture\n", "utf8");
    initializeGitRepository(workspaceRoot);

    const cliEntry = resolve("apps/cli/src/index.ts");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
      ],
      {
        cwd: resolve("."),
        input: [
          "Inspect the repository scaffold",
          "Review the repository again",
          "/session",
          "/compact 2",
          "/session",
          "/history 10",
          "/exit",
        ].join("\n") + "\n",
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Session Details/);
    assert.match(result.stdout, /Compacted thread/);
    assert.match(result.stdout, /Stored Summary:/);
    assert.match(result.stdout, /Earlier thread history compacted|Prior thread summary|\[assistant\]/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("chat command exposes diff, review, and health slash commands", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-review-workspace-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-review-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "chat-review-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceRoot, "README.md"), "# chat review fixture\n", "utf8");
    initializeGitRepository(workspaceRoot);
    writeFileSync(join(workspaceRoot, "README.md"), "# chat review fixture\n\nupdated\n", "utf8");

    const cliEntry = resolve("apps/cli/src/index.ts");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
      ],
      {
        cwd: resolve("."),
        input: ["/diff", "/review", "/health", "/exit"].join("\n") + "\n",
        encoding: "utf8",
        timeout: 20_000,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Workspace Diff/);
    assert.match(result.stdout, /Review Findings/);
    assert.match(result.stdout, /README\.md/);
    assert.match(result.stdout, /Omni Agent Doctor/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("chat command can create, list, and explicitly roll back checkpoints", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-checkpoint-workspace-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-checkpoint-store-"));
  const readmePath = join(workspaceRoot, "README.md");

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "chat-checkpoint-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    writeFileSync(readmePath, "# checkpoint fixture\n", "utf8");

    const cliEntry = resolve("apps/cli/src/index.ts");
    const createResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
      ],
      {
        cwd: resolve("."),
        input: ["/checkpoint baseline", "/checkpoints", "/exit"].join("\n") + "\n",
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.equal(createResult.status, 0, createResult.stderr || createResult.stdout);
    assert.match(createResult.stdout, /Checkpoint Created/);
    assert.match(createResult.stdout, /Checkpoints/);
    assert.match(createResult.stdout, /label: baseline/);
    assert.match(createResult.stdout, /createdAt: \d{4}-\d{2}-\d{2}T/);
    const checkpointId = /id: ([^\r\n]+)/.exec(createResult.stdout)?.[1];
    assert.ok(checkpointId, createResult.stdout);

    writeFileSync(readmePath, "# checkpoint fixture\n\nbroken change\n", "utf8");

    const blockedRollbackResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
        "--approval-policy",
        "never",
      ],
      {
        cwd: resolve("."),
        input: [`/rollback ${checkpointId}`, "/exit"].join("\n") + "\n",
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.notEqual(blockedRollbackResult.status, 0);
    assert.match(blockedRollbackResult.stderr + blockedRollbackResult.stdout, /Blocked rollback_checkpoint due to approval policy \(deny\)/);
    assert.equal(readFileSync(readmePath, "utf8"), "# checkpoint fixture\n\nbroken change\n");

    const promptGatedRollbackResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
      ],
      {
        cwd: resolve("."),
        input: [`/rollback ${checkpointId}`, "/exit"].join("\n") + "\n",
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.notEqual(promptGatedRollbackResult.status, 0);
    assert.match(promptGatedRollbackResult.stderr + promptGatedRollbackResult.stdout, /Blocked rollback_checkpoint due to approval policy \(prompt\)/);
    assert.equal(readFileSync(readmePath, "utf8"), "# checkpoint fixture\n\nbroken change\n");

    const rollbackResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
        "--auto-approve-risky",
      ],
      {
        cwd: resolve("."),
        input: [`/rollback ${checkpointId}`, "/exit"].join("\n") + "\n",
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.equal(rollbackResult.status, 0, rollbackResult.stderr || rollbackResult.stdout);
    assert.match(rollbackResult.stdout, /Checkpoint Rolled Back/);
    assert.match(rollbackResult.stdout, new RegExp(`id: ${escapeRegExp(checkpointId)}`));
    assert.match(rollbackResult.stdout, /label: baseline/);
    assert.match(rollbackResult.stdout, /createdAt: \d{4}-\d{2}-\d{2}T/);
    assert.equal(readFileSync(readmePath, "utf8"), "# checkpoint fixture\n");
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("chat command exposes coding workflow inspection slash commands", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-inspect-workspace-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-inspect-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "chat-inspect-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceRoot, "README.md"), "# chat inspect fixture\n", "utf8");
    initializeGitRepository(workspaceRoot);

    const cliEntry = resolve("apps/cli/src/index.ts");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
      ],
      {
        cwd: resolve("."),
        input: [
          "Inspect the repository scaffold",
          "/help",
          "/tools run_command --limit 8",
          "/approvals",
          "/context",
          "/sessions 5",
          "/subagents",
          "/mcp",
          "/cost",
          "/exit",
        ].join("\n") + "\n",
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Chat Commands/);
    assert.match(result.stdout, /\/status\s+Show the current chat session state/);
    assert.match(result.stdout, /\/tools \[query\]\s+Show available tools/);
    assert.match(result.stdout, /\/diff\s+Show the current workspace git diff summary/);
    assert.match(result.stdout, /\/review\s+Review the current diff/);
    assert.match(result.stdout, /\/approvals\s+Show approval policy/);
    assert.match(result.stdout, /\/cost\s+Show token usage/);
    assert.match(result.stdout, /\/checkpoints\s+List managed workspace rollback checkpoints/);
    assert.match(result.stdout, /Available Tools/);
    assert.match(result.stdout, /run_command/);
    assert.match(result.stdout, /exec_capable\/tier-/);
    assert.match(result.stdout, /Approval State/);
    assert.match(result.stdout, /Policy: on-request/);
    assert.match(result.stdout, /Context State/);
    assert.match(result.stdout, /Stored summary version:/);
    assert.match(result.stdout, /Sessions|No sessions recorded for the current workspace/);
    assert.match(result.stdout, /Use \/resume <thread-id>/);
    assert.match(result.stdout, /Subagents/);
    assert.match(result.stdout, /No subagent jobs recorded/);
    assert.match(result.stdout, /MCP Status/);
    assert.match(result.stdout, /Cost and Usage/);
    assert.match(result.stdout, /Estimated cost: unknown/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("chat command registry handles aliases, case-insensitive commands, and unknown commands", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-registry-workspace-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-registry-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "chat-registry-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceRoot, "README.md"), "# chat registry fixture\n", "utf8");
    initializeGitRepository(workspaceRoot);

    const cliEntry = resolve("apps/cli/src/index.ts");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
      ],
      {
        cwd: resolve("."),
        input: [
          "/STATUS",
          "/Tools run_command --limit 2",
          "/does-not-exist",
          "/reset",
          "/sessions 5",
          "/quit",
        ].join("\n") + "\n",
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Chat Status/);
    assert.match(result.stdout, /Available Tools/);
    assert.match(result.stdout, /run_command/);
    assert.match(result.stdout, /Unknown chat command: \/does-not-exist/);
    assert.match(result.stdout, /Started a fresh thread context/);
    assert.match(result.stdout, /Sessions|No sessions recorded for the current workspace/);
    assert.match(result.stdout, /Exiting chat\./);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("chat command registry exposes workspace skills as dynamic slash commands", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-skill-slash-workspace-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-skill-slash-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "chat-skill-slash-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceRoot, "README.md"), "# chat skill slash fixture\n", "utf8");
    mkdirSync(join(workspaceRoot, ".agents", "skills", "demo-skill"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".agents", "skills", "demo-skill", "SKILL.md"),
      [
        "---",
        "name: Demo Skill",
        "description: Use demo skill instructions from workspace.",
        "---",
        "",
        "Demo skill body: always mention DEMO_SKILL_ACTIVATED in the reasoning context.",
        "",
      ].join("\n"),
      "utf8",
    );
    mkdirSync(join(workspaceRoot, ".agents", "skills", "disabled-skill"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".agents", "skills", "disabled-skill", "SKILL.md"),
      [
        "---",
        "name: Disabled Skill",
        "description: Hidden disabled skill.",
        "disabled: true",
        "---",
        "",
        "This should not be invocable.",
        "",
      ].join("\n"),
      "utf8",
    );
    mkdirSync(join(workspaceRoot, ".agents", "skills", "status"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".agents", "skills", "status", "SKILL.md"),
      [
        "---",
        "name: status",
        "description: This dynamic command conflicts with a built-in command.",
        "---",
        "",
        "This should not override /status.",
        "",
      ].join("\n"),
      "utf8",
    );
    mkdirSync(join(workspaceRoot, ".agents", "skills", "ascii-fallback"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, ".agents", "skills", "ascii-fallback", "SKILL.md"),
      [
        "---",
        "name: 中文技能",
        "description: Non-ASCII display names fall back to the directory slug.",
        "---",
        "",
        "Non-ASCII skill body: always mention ASCII_FALLBACK_SKILL_ACTIVATED.",
        "",
      ].join("\n"),
      "utf8",
    );
    initializeGitRepository(workspaceRoot);

    const cliEntry = resolve("apps/cli/src/index.ts");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--mode",
        "mock",
      ],
      {
        cwd: resolve("."),
        input: [
          "/help",
          "/demo-skill apply this workspace procedure",
          "/ascii-fallback use directory fallback",
          "/status",
          "/disabled-skill",
          "/exit",
        ].join("\n") + "\n",
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 30_000,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /\/demo-skill\s+Workspace skill: Demo Skill/);
    assert.match(result.stdout, /\/ascii-fallback\s+Workspace skill: 中文技能/);
    assert.doesNotMatch(result.stdout, /\/disabled-skill\s+Workspace skill/);
    assert.match(result.stdout, /Objective: Workspace skill slash command invoked/);
    assert.match(result.stdout, /Skill: Demo Skill/);
    assert.match(result.stdout, /User arguments:\s*apply this workspace procedure/);
    assert.match(result.stdout, /DEMO_SKILL_ACTIVATED/);
    assert.match(result.stdout, /Skill: 中文技能/);
    assert.match(result.stdout, /User arguments:\s*use directory fallback/);
    assert.match(result.stdout, /ASCII_FALLBACK_SKILL_ACTIVATED/);
    assert.match(result.stdout, /Chat Status/);
    assert.match(result.stdout, /Unknown chat command: \/disabled-skill/);
    assert.match(result.stdout, /Exiting chat\./);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function initializeGitRepository(cwd: string): void {
  execFileSync("git", ["init", "--initial-branch=main"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "omni-agent@example.com"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Omni Agent"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd, stdio: "ignore" });
}
