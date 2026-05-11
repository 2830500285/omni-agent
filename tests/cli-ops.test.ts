import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";

import { SqliteSessionStore } from "../packages/session-store/src/index.ts";

const cliTestEnv = {
  ...process.env,
  GOMAXPROCS: "1",
  TSX_TSCONFIG_PATH: resolve("tsconfig.base.json"),
  TSX_DISABLE_CACHE: "1",
};

test("models command lists configured profiles and missing keys", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-models-workspace-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { test: "node verify.js" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceRoot, "verify.js"), "console.log('ok');\n", "utf8");
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("apps/cli/src/index.ts"), "models", "--cwd", workspaceRoot],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...cliTestEnv,
          PRIMARY_API_KEY: "present",
          OMNI_AGENT_MODEL_PROFILES_JSON: JSON.stringify([
            {
              id: "primary",
              name: "Primary",
              protocol: "anthropic",
              baseUrl: "https://primary.example.com/v1",
              apiKeyEnv: "PRIMARY_API_KEY",
              model: "m-primary",
            },
            {
              id: "backup",
              name: "Backup",
              baseUrl: "https://backup.example.com/v1",
              apiKeyEnv: "BACKUP_API_KEY",
              model: "m-backup",
              supportsTools: false,
            },
          ]),
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /(Configured model profiles|Loaded Model Profiles)/i);
    assert.match(result.stdout, /Source:\s+json/i);
    assert.match(result.stdout, /Profiles:/i);
    assert.match(result.stdout, /primary/);
    assert.match(result.stdout, /protocol=anthropic/);
    assert.match(result.stdout, /configured/);
    assert.match(result.stdout, /missing:BACKUP_API_KEY/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("doctor command reports workspace and model diagnostics", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-doctor-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-doctor-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    initializeGitRepository(workspaceRoot);

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "doctor",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...cliTestEnv,
          PRIMARY_API_KEY: "present",
          OMNI_AGENT_MODEL_PROFILES_JSON: JSON.stringify([
            {
              id: "primary",
              name: "Primary",
              baseUrl: "https://primary.example.com/v1",
              apiKeyEnv: "PRIMARY_API_KEY",
              model: "m-primary",
            },
          ]),
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Omni Agent Doctor/);
    assert.match(result.stdout, /\[ok\]\s+workspace/i);
    assert.match(result.stdout, /\[ok\]\s+storage/i);
    assert.match(result.stdout, /\[ok\]\s+git/i);
    assert.match(result.stdout, /\[ok\]\s+model/i);
    assert.match(result.stdout, /Summary:\s+\d+\s+ok,\s+\d+\s+warning\(s\),\s+0\s+error\(s\)/i);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("doctor strict mode fails on warnings and prints action items", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-doctor-strict-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-doctor-strict-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "doctor",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--strict",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stdout, /Action items:/);
    assert.match(result.stdout, /Initialize a Git repository for this workspace/i);
    assert.match(result.stdout, /Strict mode enabled: warnings are treated as errors\./i);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("evals command runs a manifest and prints benchmark metrics", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-evals-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-evals-store-"));
  const manifestPath = join(workspaceRoot, "suite.json");

  try {
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ name: "fixture" }, null, 2), "utf8");
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          title: "Mock suite",
          scenarios: [
            {
              id: "mock-single",
              title: "Mock single",
              category: "single_agent_bugfix",
              steps: [
                {
                  objective: "Inspect the workspace and summarize the next step.",
                  expectation: {
                    verificationStatus: "skipped",
                    requiredToolNames: ["workspace_info", "git_status"],
                    requiredFinalResponseIncludes: ["Scaffold runtime completed an inspection cycle."],
                  },
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "evals",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--manifest",
        manifestPath,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Eval Suite:\s+Mock suite/);
    assert.match(result.stdout, /Completion rate:\s+100\.0% \(1\/1\)/);
    assert.match(result.stdout, /Quality scorecard:/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("setup command bootstraps config and workspace starter files", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "omni-agent-setup-"));
  const workspaceRoot = join(tempRoot, "workspace");
  const storageRoot = join(tempRoot, "store");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "setup",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Omni Agent Setup/);
    assert.match(result.stdout, /Created:/);
    assert.match(result.stdout, /Setup checks:/);
    assert.match(result.stdout, /Next steps:/);
    assert.match(result.stdout, /doctor/);
    assert.match(result.stdout, /serve/);
    assert.ok(existsSync(join(storageRoot, "config.json")));
    assert.ok(existsSync(join(workspaceRoot, "memory")));
    assert.ok(existsSync(join(workspaceRoot, "AGENTS.md")));
    assert.ok(existsSync(join(workspaceRoot, "SOUL.md")));
    assert.ok(existsSync(join(workspaceRoot, "TOOLS.md")));
    assert.ok(existsSync(join(workspaceRoot, "MEMORY.md")));
    assert.ok(existsSync(join(workspaceRoot, "USER.md")));

    const config = JSON.parse(readFileSync(join(storageRoot, "config.json"), "utf8")) as {
      defaultWorkspace?: string;
      gatewayToken?: string;
    };
    assert.equal(config.defaultWorkspace, workspaceRoot);
    assert.equal(typeof config.gatewayToken, "string");
    assert.ok((config.gatewayToken ?? "").length > 0);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("setup command creates a B.AI model profile from provider template", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "omni-agent-setup-bai-"));
  const workspaceRoot = join(tempRoot, "workspace");
  const storageRoot = join(tempRoot, "store");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "setup",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--provider",
        "b.ai",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Profiles: bai:openai:gpt-5\.2/);
    const config = JSON.parse(readFileSync(join(storageRoot, "config.json"), "utf8")) as {
      modelProfiles?: Array<{
        id?: string;
        protocol?: string;
        baseUrl?: string;
        apiKeyEnv?: string;
        model?: string;
        credentials?: Array<{ apiKeyEnv?: string }>;
      }>;
    };
    const profile = config.modelProfiles?.[0];
    assert.equal(profile?.id, "bai");
    assert.equal(profile?.protocol, "openai");
    assert.equal(profile?.baseUrl, "https://api.b.ai/v1");
    assert.equal(profile?.apiKeyEnv, "BAI_API_KEY");
    assert.equal(profile?.model, "gpt-5.2");
    assert.deepEqual(
      profile?.credentials?.map((credential) => credential.apiKeyEnv),
      ["BAI_API_KEY", "B_AI_API_KEY", "OMNI_AGENT_BAI_API_KEY"],
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("setup rejects partial profile configuration flags", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "omni-agent-setup-invalid-profile-"));
  const workspaceRoot = join(tempRoot, "workspace");
  const storageRoot = join(tempRoot, "store");

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "setup",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--model",
        "gpt-4.1-mini",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(
      result.stderr,
      /Setup profile creation requires --base-url, --api-key-env, and --model whenever any profile setup flags are provided\./,
    );
    assert.equal(existsSync(join(storageRoot, "config.json")), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("run command accepts a task file for long objectives", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-task-file-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-task-file-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "task-file-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceRoot, "task.txt"), "Inspect the workspace from a task file.", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "run",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--mode",
        "mock",
        "--task-file",
        "task.txt",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Inspect the workspace from a task file/);
    assert.match(result.stdout, /Omni Agent Run Summary/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("run command supports json and stream-json headless output", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-run-output-workspace-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "omni-agent-run-output-store-"));
  const streamSecret = `sk-proj-${"c".repeat(32)}`;

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "run-output-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    writeFileSync(join(workspaceRoot, "README.md"), "# run output fixture\n", "utf8");

    const jsonResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "run",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--task",
        `Inspect the repository scaffold apiKey=${streamSecret}`,
        "--mode",
        "mock",
        "--output-format",
        "json",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.equal(jsonResult.status, 0, jsonResult.stderr || jsonResult.stdout);
    const jsonLines = jsonResult.stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(jsonLines.length, 1);
    const parsedJson = JSON.parse(jsonResult.stdout) as {
      run?: { id?: string; status?: string };
      thread?: { id?: string };
      toolEvents?: Array<{ toolName?: string; status?: string }>;
      blockedApprovals?: Array<{ summary?: string }>;
      artifacts?: Array<{ path?: string; kind?: string }>;
      finalResponse?: string;
    };
    assert.ok(parsedJson.run?.status === "completed" || parsedJson.run?.status === "completed_with_warnings");
    assert.ok(parsedJson.run?.id);
    assert.ok(parsedJson.thread?.id);
    assert.ok(parsedJson.toolEvents?.some((entry) => entry.toolName === "workspace_info" && entry.status === "ok"));
    assert.ok(Array.isArray(parsedJson.blockedApprovals));
    assert.ok(Array.isArray(parsedJson.artifacts));
    assert.match(parsedJson.finalResponse ?? "", /Scaffold runtime completed/);

    const streamResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "run",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storeRoot,
        "--task",
        "Inspect the repository scaffold",
        "--mode",
        "mock",
        "--output-format",
        "stream-json",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
        timeout: 20_000,
      },
    );

    assert.equal(streamResult.status, 0, streamResult.stderr || streamResult.stdout);
    assert.doesNotMatch(streamResult.stdout, new RegExp(streamSecret));
    assert.match(streamResult.stdout, /\[redacted\]/);
    const events = streamResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type?: string; rawType?: string; summary?: unknown; toolName?: string; presentation?: { kind?: string; title?: string } });
    assert.ok(events.some((entry) => entry.type === "run_start"));
    assert.ok(events.some((entry) => entry.rawType === "run.started"));
    assert.ok(events.some((entry) => entry.type === "tool_start" && entry.toolName === "workspace_info"));
    assert.ok(events.some((entry) => entry.type === "tool_result" && entry.toolName === "workspace_info"));
    assert.ok(events.some((entry) => entry.toolName === "workspace_info" && entry.presentation?.kind === "read"));
    assert.ok(events.some((entry) => entry.type === "run_end"));
    assert.equal(events.at(-1)?.type, "result");

  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
});

test("run command with a model profile defaults to openai mode", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-profile-mode-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-profile-mode-store-"));

  try {
    writeFileSync(join(workspaceRoot, "task.txt"), "Inspect the workspace with a real profile.", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "run",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--model-profile",
        "real-profile",
        "--task-file",
        "task.txt",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: {
          ...cliTestEnv,
          OMNI_AGENT_MODEL_PROFILES_JSON: JSON.stringify([
            {
              id: "real-profile",
              name: "real-profile",
              protocol: "openai",
              baseUrl: "https://example.invalid/v1",
              apiKeyEnv: "OMNI_AGENT_MISSING_TEST_KEY",
              model: "example-model",
              supportsTools: true,
              supportsStreaming: false,
            },
          ]),
        },
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /Missing API key in environment variable OMNI_AGENT_MISSING_TEST_KEY/);
    assert.doesNotMatch(result.stdout, /Profiles:\s+mock/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("onboard preserves existing files unless forced", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-onboard-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-onboard-store-"));
  const customSoul = "# SOUL.md\n\ncustom soul\n";

  try {
    writeFileSync(join(workspaceRoot, "SOUL.md"), customSoul, "utf8");

    const firstResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "onboard",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(firstResult.status, 0, firstResult.stderr || firstResult.stdout);
    assert.match(firstResult.stdout, /Omni Agent Onboard/);
    assert.match(firstResult.stdout, /Kept existing:/);
    assert.equal(readFileSync(join(workspaceRoot, "SOUL.md"), "utf8"), customSoul);

    const secondResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "onboard",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--force",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(secondResult.status, 0, secondResult.stderr || secondResult.stdout);
    assert.match(secondResult.stdout, /Updated:/);
    assert.notEqual(readFileSync(join(workspaceRoot, "SOUL.md"), "utf8"), customSoul);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("skills command surfaces compatible workspace skill files without stored history", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-skills-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-skills-store-"));

  try {
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ name: "fixture" }, null, 2), "utf8");
    mkdirSync(join(workspaceRoot, "skills", "release", "release-check", "references"), { recursive: true });
    writeFileSync(
      join(workspaceRoot, "skills", "release", "DESCRIPTION.md"),
      "Release category: validate shipping workflows.\n",
      "utf8",
    );
    writeFileSync(
      join(workspaceRoot, "skills", "release", "release-check", "SKILL.md"),
      [
        "---",
        'name: release-check',
        'description: "Verify release readiness before shipping."',
        "metadata:",
        "  hermes:",
        "    tags: [release, shipping, checklist]",
        "    related_skills: [ci-ops]",
        "---",
        "",
        "# Release Check",
        "Verify migrations and smoke tests before shipping.",
        "",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(workspaceRoot, "skills", "release", "release-check", "references", "ci.md"),
      "CI guide: rerun shipping pipelines before release.\n",
      "utf8",
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "skills",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--query",
        "release shipping",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Skills for/);
    assert.match(result.stdout, /Learned skills:\s*\n\(none\)/);
    assert.match(result.stdout, /Workspace skill files:/);
    assert.match(result.stdout, /release-check/);
    assert.match(result.stdout, /description: Verify release readiness before shipping\./);
    assert.match(result.stdout, /tags: release, shipping, checklist/);
    assert.match(result.stdout, /related: ci-ops/);
    assert.match(result.stdout, /support: .*DESCRIPTION\.md.*ci\.md/);
    assert.match(result.stdout, /Verify migrations and smoke tests before shipping/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("route-create rejects incomplete filesystem routes", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-route-create-invalid-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-route-create-invalid-store-"));

  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "route-create",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--title",
        "Broken Slack route",
        "--channel-type",
        "slack",
        "--channel-key",
        "C12345",
        "--adapter-type",
        "filesystem",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.match(result.stderr, /Filesystem routes require adapterConfig\.outboxDir\./);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("route-create defaults Slack routes to pairing", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-route-create-pairing-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-route-create-pairing-store-"));
  const outboxRoot = join(workspaceRoot, "outbox");
  const routeSecret = "xoxb-routecreatesensitive1234567890";
  const webhookSecret = "route-create-webhook-secret";
  const baseUrlSecret = "route-create-base-url-secret";
  const headerSecret = "route-create-header-secret";

  try {
    const createResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "route-create",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--title",
        "Slack triage",
        "--channel-type",
        "slack",
        "--channel-key",
        "C12345",
        "--adapter-type",
        "filesystem",
        "--outbox-dir",
        outboxRoot,
        "--adapter-config",
        JSON.stringify({
          botToken: routeSecret,
          webhookUrl: `https://hooks.slack.example/services/${webhookSecret}`,
          baseUrl: `https://slack.example.invalid/api?token=${baseUrlSecret}`,
          publicUrl: "https://docs.example/slack",
          homepageUrl: "https://slack.example/home",
          headers: {
            "x-api-key": headerSecret,
          },
        }),
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );
    assert.equal(createResult.status, 0, createResult.stderr || createResult.stdout);
    assert.doesNotMatch(createResult.stdout, new RegExp(routeSecret));
    assert.doesNotMatch(createResult.stdout, new RegExp(webhookSecret));
    assert.doesNotMatch(createResult.stdout, new RegExp(baseUrlSecret));
    assert.doesNotMatch(createResult.stdout, new RegExp(headerSecret));
    assert.doesNotMatch(createResult.stdout, /slack\.example\.invalid/);
    assert.match(createResult.stdout, /https:\/\/docs\.example\/slack/);
    assert.match(createResult.stdout, /https:\/\/slack\.example\/home/);
    assert.match(createResult.stdout, /secretRef/);

    const listResult = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("apps/cli/src/index.ts"), "routes", "--cwd", workspaceRoot, "--storage-root", storageRoot],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout);
    assert.match(listResult.stdout, /adapter=filesystem/);
    assert.match(listResult.stdout, /dmPolicy=pairing/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("memory-save can persist to store and compatible workspace memory files", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-memory-save-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-memory-save-store-"));

  try {
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ name: "fixture" }, null, 2), "utf8");

    const saveResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "memory-save",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--content",
        "Use pnpm before shipping workspace changes",
        "--backend",
        "both",
        "--tag",
        "build",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(saveResult.status, 0, saveResult.stderr || saveResult.stdout);
    assert.match(saveResult.stdout, /Saved workspace memory to store/i);
    assert.match(readFileSync(join(workspaceRoot, "MEMORY.md"), "utf8"), /Use pnpm before shipping workspace changes/);

    const searchResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "memory-search",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--query",
        "pnpm",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(searchResult.status, 0, searchResult.stderr || searchResult.stdout);
    assert.match(searchResult.stdout, /Use pnpm before shipping workspace changes/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("memory-search defaults to combined search and still returns file-backed memories without stored workspace state", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-memory-search-file-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-memory-search-file-store-"));

  try {
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ name: "fixture" }, null, 2), "utf8");
    writeFileSync(join(workspaceRoot, "MEMORY.md"), "Operator note: preserve webhook signing checks.\n", "utf8");

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "memory-search",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--query",
        "webhook",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /warning: Memory store unavailable/i);
    assert.match(result.stdout, /file:memory/i);
    assert.match(result.stdout, /MEMORY\.md/);
    assert.match(result.stdout, /webhook signing checks/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("usage command summarizes metrics for the latest workspace thread", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-usage-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-usage-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "usage-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    initializeGitRepository(workspaceRoot);

    const runResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "run",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--mode",
        "mock",
        "--task",
        "Inspect the repository scaffold",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);

    const usageResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "usage",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(usageResult.status, 0, usageResult.stderr || usageResult.stdout);
    assert.match(usageResult.stdout, /Usage for thread/);
    assert.match(usageResult.stdout, /Runs:\s+1/);
    assert.match(usageResult.stdout, /Tool calls:\s+2/);
    assert.match(usageResult.stdout, /Profiles:\s+mock/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("insights command summarizes global and workspace metrics", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-insights-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-insights-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "insights-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    initializeGitRepository(workspaceRoot);

    const runResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "run",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--mode",
        "mock",
        "--task",
        "Inspect usage reporting",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);

    const insightsResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "insights",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(insightsResult.status, 0, insightsResult.stderr || insightsResult.stdout);
    assert.match(insightsResult.stdout, /Usage Insights/);
    assert.match(insightsResult.stdout, /Global/);
    assert.match(insightsResult.stdout, /Workspaces:\s+1/);
    assert.match(insightsResult.stdout, /Workspace/);
    assert.match(insightsResult.stdout, /Runs:\s+1/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("show-run prints timeline, review checklist, and recovery command", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-show-run-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-show-run-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "show-run-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    initializeGitRepository(workspaceRoot);

    const runResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "run",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--mode",
        "mock",
        "--task",
        `Inspect show-run diagnostics api_key=${"q".repeat(24)}`,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);
    const runId = /Run ID:\s+([^\s]+)/.exec(runResult.stdout)?.[1];
    assert.ok(runId, runResult.stdout);
    const rawArtifactPath = join(storageRoot, "artifacts", "prod-secret-token.log");
    const store = new SqliteSessionStore(storageRoot);
    try {
      store.initialize();
      store.addArtifact({
        runId,
        kind: "git-diff-secret",
        path: rawArtifactPath,
        summary: "Synthetic artifact with a sensitive basename.",
      });
      const run = store.getRun(runId);
      assert.ok(run);
      store.completeRun({
        runId,
        status: run.status,
        finalResponse: `Final response token=${"r".repeat(24)}`,
        verificationStatus: run.verificationStatus,
      });
    } finally {
      store.close();
    }

    const showResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "show-run",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--run-id",
        runId,
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(showResult.status, 0, showResult.stderr || showResult.stdout);
    assert.match(showResult.stdout, /Timeline:/);
    assert.match(showResult.stdout, /tool workspace_info/);
    assert.match(showResult.stdout, /Review Checklist:/);
    assert.match(showResult.stdout, /Tool failures:\s+0/);
    assert.match(showResult.stdout, /Trajectory Replay:/);
    assert.match(showResult.stdout, /"toolName":/);
    assert.match(showResult.stdout, /"toolCallId":/);
    assert.match(showResult.stdout, /"presentation":/);
    assert.match(showResult.stdout, /presentation=read: Inspect workspace/);
    assert.match(showResult.stdout, /"storedOutputRef":/);
    assert.match(showResult.stdout, /Recovery:/);
    assert.doesNotMatch(showResult.stdout, /api_key=q{24}/);
    assert.doesNotMatch(showResult.stdout, /token=r{24}/);
    assert.match(showResult.stdout, /\[redacted\]/);
    assert.match(showResult.stdout, /npm run dev -- run --cwd/);
    assert.match(showResult.stdout, new RegExp(`--thread-id\\s+${runId ? "[^\\s]+" : ""}`));
    assert.doesNotMatch(showResult.stdout, new RegExp(rawArtifactPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(showResult.stdout, /prod-secret-token\.log/);
    assert.match(showResult.stdout, /artifact:[^/]+\/\[redacted-artifact\]/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("chat events command shows latest run tool events", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-events-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-chat-events-store-"));

  try {
    writeFileSync(
      join(workspaceRoot, "package.json"),
      JSON.stringify({ name: "chat-events-fixture", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    initializeGitRepository(workspaceRoot);

    const runResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "run",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--mode",
        "mock",
        "--task",
        "Inspect event diagnostics",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);

    const chatResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("apps/cli/src/index.ts"),
        "chat",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--mode",
        "mock",
      ],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
        input: "/events 2\n/exit\n",
      },
    );

    assert.equal(chatResult.status, 0, chatResult.stderr || chatResult.stdout);
    assert.match(chatResult.stdout, /Event Stream/);
    assert.match(chatResult.stdout, /Latest run: .*\(completed\/skipped\)/);
    assert.match(chatResult.stdout, /Events:\s+2 shown\s+Counts:.*ok=/);
    assert.match(chatResult.stdout, /git_status|workspace_info/);
    assert.match(chatResult.stdout, /call=/);
    assert.match(chatResult.stdout, /presentation=/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storageRoot, { recursive: true, force: true });
  }
});

test("extensions command reports package contract diagnostics", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-extensions-workspace-"));
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-extensions-plugin-"));

  try {
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ name: "fixture" }, null, 2), "utf8");
    writeFileSync(
      join(pluginRoot, "package.json"),
      JSON.stringify(
        {
          name: "@example/cli-extension",
          version: "0.0.1",
          omniAgent: {
            compat: { pluginApi: "1.x" },
            build: { omniAgentVersion: "0.1.0" },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(pluginRoot, "cli-extension.json"),
      JSON.stringify(
        {
          id: "cli-extension",
          name: "CLI Extension",
          capability: "tool",
          description: "Extension surfaced by the CLI.",
          tools: [
            {
              name: "cli_extension_tool",
              description: "Print Node.js version.",
              command: "node --version",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("apps/cli/src/index.ts"), "extensions", "--cwd", workspaceRoot, "--plugin-dir", pluginRoot],
      {
        cwd: resolve("."),
        encoding: "utf8",
        env: cliTestEnv,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /cli-extension/);
    assert.match(result.stdout, /Package contracts:\s+1\/1 ok/);
    assert.match(result.stdout, /pluginApi=1\.x/);
    assert.match(result.stdout, /hostPluginApi=1\.0\.0/);
    assert.match(result.stdout, /compatible=true/);
    assert.match(result.stdout, /omniAgentVersion=0\.1\.0/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(pluginRoot, { recursive: true, force: true });
  }
});

test("automation-create infers at and cron schedules from shortcut flags", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-automation-cli-workspace-"));
  const storageRoot = mkdtempSync(join(tmpdir(), "omni-agent-automation-cli-store-"));

  try {
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ name: "automation-cli-fixture" }, null, 2), "utf8");
    const cliEntry = resolve("apps/cli/src/index.ts");
    const atResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "automation-create",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--title",
        "One shot",
        "--task",
        "Run once",
        "--at",
        "2030-01-01T00:00:00.000Z",
      ],
      { cwd: resolve("."), encoding: "utf8", env: cliTestEnv, timeout: 20_000 },
    );
    assert.equal(atResult.status, 0, atResult.stderr || atResult.stdout);

    const cronResult = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cliEntry,
        "automation-create",
        "--cwd",
        workspaceRoot,
        "--storage-root",
        storageRoot,
        "--title",
        "Cron",
        "--task",
        "Run on cron",
        "--cron",
        "*/15 * * * *",
        "--timezone",
        "UTC",
      ],
      { cwd: resolve("."), encoding: "utf8", env: cliTestEnv, timeout: 20_000 },
    );
    assert.equal(cronResult.status, 0, cronResult.stderr || cronResult.stdout);

    const listResult = spawnSync(
      process.execPath,
      ["--import", "tsx", cliEntry, "automations", "--cwd", workspaceRoot, "--storage-root", storageRoot],
      { cwd: resolve("."), encoding: "utf8", env: cliTestEnv, timeout: 20_000 },
    );
    assert.equal(listResult.status, 0, listResult.stderr || listResult.stdout);
    assert.match(listResult.stdout, /at\/2030-01-01T00:00:00\.000Z/);
    assert.match(listResult.stdout, /cron\/\*\/15 \* \* \* \*/);
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
