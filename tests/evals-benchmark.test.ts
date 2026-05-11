import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadLocalBenchmarkJsonl,
  normalizeLocalBenchmarkSuiteDefinition,
  runLocalBenchmarkSuite,
} from "../packages/evals/src/index.ts";

const nodeCommand = `"${process.execPath}"`;

test("local benchmark adapter runs tasks with concurrency, verification, and score aggregation", async () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-local-benchmark-"));
  try {
    const suite = normalizeLocalBenchmarkSuiteDefinition(
      {
        title: "Local fixture benchmark",
        defaultWorkspaceCwd: ".",
        maxConcurrency: 2,
        tasks: [
          {
            id: "pass",
            prompt: "Create the passing artifact.",
            verificationCommands: [`${nodeCommand} -e "process.exit(0)"`],
            score: 2,
          },
          {
            id: "fail",
            prompt: "Leave verification failing.",
            verificationCommands: [`${nodeCommand} -e "process.exit(1)"`],
            score: 3,
          },
          {
            id: "pass-two",
            prompt: "Create the second passing artifact.",
            verificationCommands: [`${nodeCommand} -e "process.exit(0)"`],
            score: 5,
          },
        ],
      },
      { baseDir: root },
    );

    let active = 0;
    let maxActive = 0;
    const result = await runLocalBenchmarkSuite(suite, async ({ task }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return {
        finalResponse: `handled ${task.id}`,
        changedFiles: [`${task.id}.txt`],
        toolEvents: [{ toolName: "task_executor", status: "ok" }],
      };
    });

    assert.equal(result.taskCount, 3);
    assert.equal(result.completedCount, 3);
    assert.equal(result.passedCount, 2);
    assert.equal(result.timeoutCount, 0);
    assert.equal(result.totalScore, 7);
    assert.equal(result.maxScore, 10);
    assert.equal(result.scoreRate, 0.7);
    assert.equal(result.maxConcurrency, 2);
    assert.equal(maxActive, 2);
    assert.deepEqual(
      result.results.map((taskResult) => taskResult.taskId),
      ["pass", "fail", "pass-two"],
    );
    assert.equal(result.results[0]?.verificationStatus, "passed");
    assert.equal(result.results[1]?.verificationStatus, "failed");
    assert.equal(result.results[1]?.verificationResults[0]?.exitCode, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("local benchmark adapter loads JSONL tasks and marks executor timeouts", async () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-local-benchmark-jsonl-"));
  try {
    mkdirSync(join(root, "workspace"), { recursive: true });
    const datasetPath = join(root, "tasks.jsonl");
    writeFileSync(
      datasetPath,
      [
        JSON.stringify({
          id: "timeout",
          prompt: "This task times out.",
          workspaceCwd: "workspace",
          verificationCommands: [`${nodeCommand} -e "process.exit(0)"`],
          timeoutMs: 10,
        }),
        JSON.stringify({
          id: "skipped",
          prompt: "This task has no verifier.",
          workspaceCwd: "workspace",
        }),
      ].join("\n"),
      "utf8",
    );

    const suite = loadLocalBenchmarkJsonl(datasetPath, {
      title: "JSONL fixture",
      baseDir: root,
      maxConcurrency: 1,
    });
    assert.equal(suite.title, "JSONL fixture");
    assert.equal(suite.tasks[0]?.workspaceCwd, join(root, "workspace"));

    const result = await runLocalBenchmarkSuite(suite, async ({ task }) => {
      if (task.id === "timeout") {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { finalResponse: task.prompt };
    });

    assert.equal(result.taskCount, 2);
    assert.equal(result.completedCount, 1);
    assert.equal(result.passedCount, 0);
    assert.equal(result.timeoutCount, 1);
    assert.equal(result.results[0]?.timedOut, true);
    assert.match(result.results[0]?.executorError ?? "", /timed out/i);
    assert.equal(result.results[1]?.verificationStatus, "skipped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("eval benchmark script persists synthetic run history and trend artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-benchmark-artifacts-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/eval-benchmark.ts",
        "--mode",
        "synthetic",
        "--artifacts-dir",
        root,
        "--run-id",
        "test-synthetic-run",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: "./tsconfig.base.json",
          TSX_DISABLE_CACHE: "1",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const latestPath = join(root, "latest.json");
    const historyPath = join(root, "history.json");
    const trendPath = join(root, "trend.json");
    const reportPath = join(root, "report.md");
    assert.ok(existsSync(latestPath));
    assert.ok(existsSync(historyPath));
    assert.ok(existsSync(trendPath));
    assert.ok(existsSync(reportPath));

    const latest = JSON.parse(readFileSync(latestPath, "utf8")) as {
      id?: string;
      mode?: string;
      implementation?: string;
      usage?: { durationMs?: number | null; costStatus?: string };
      failureSummary?: unknown[];
    };
    const history = JSON.parse(readFileSync(historyPath, "utf8")) as unknown[];
    const trend = JSON.parse(readFileSync(trendPath, "utf8")) as { runCount?: number; latestRunId?: string | null };

    assert.equal(latest.id, "test-synthetic-run");
    assert.equal(latest.mode, "synthetic");
    assert.equal(latest.implementation, "scripted-observed-run");
    assert.equal(latest.usage?.costStatus, "unknown");
    assert.ok((latest.usage?.durationMs ?? 0) > 0);
    assert.deepEqual(latest.failureSummary, []);
    assert.equal(history.length, 1);
    assert.equal(trend.runCount, 1);
    assert.equal(trend.latestRunId, "test-synthetic-run");
    assert.match(result.stdout, /"artifactPaths"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("eval benchmark script accepts custom manifests without default maturity gates", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-custom-benchmark-"));
  try {
    const manifestPath = join(root, "suite.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        title: "Custom smoke benchmark",
        scenarios: [
          {
            id: "custom.smoke",
            title: "Custom Smoke",
            category: "coding_bugfix",
            workspaceCwd: ".",
            steps: [{ objective: "Run a small custom benchmark scenario." }],
          },
        ],
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/eval-benchmark.ts", "--mode", "synthetic", "--manifest", manifestPath, "--no-save"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: "./tsconfig.base.json",
          TSX_DISABLE_CACHE: "1",
        },
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout) as { capabilityMaturity?: unknown };
    assert.equal(output.capabilityMaturity, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("eval benchmark script supports runtime mode for custom manifests", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-runtime-benchmark-"));
  try {
    const manifestPath = join(root, "suite.json");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        title: "Runtime smoke benchmark",
        qualityThresholds: {
          completionRate: 1,
          verificationPassRate: 0,
          firstPassRate: 0,
          toolReliabilityRate: 1,
          toolSafetyRate: 1,
        },
        scenarios: [
          {
            id: "runtime.smoke",
            title: "Runtime Smoke",
            category: "coding_bugfix",
            workspaceCwd: process.cwd(),
            steps: [
              {
                objective: "Inspect the repository scaffold through the real CLI eval pipeline.",
                expectation: { verificationStatus: "skipped" },
              },
            ],
          },
        ],
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/eval-benchmark.ts", "--mode", "runtime", "--manifest", manifestPath, "--no-save"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: "./tsconfig.base.json",
          TSX_DISABLE_CACHE: "1",
        },
        timeout: 30_000,
      },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const output = JSON.parse(result.stdout) as {
      executor?: { mode?: string; runtimeMode?: string; implementation?: string };
      capabilityMaturity?: unknown;
    };
    assert.equal(output.executor?.mode, "runtime");
    assert.equal(output.executor?.runtimeMode, "mock");
    assert.equal(output.executor?.implementation, "cli-runtime-evals");
    assert.equal(output.capabilityMaturity, null);

    const verifiedManifestPath = join(root, "suite-verified.json");
    writeFileSync(
      verifiedManifestPath,
      JSON.stringify({
        title: "Runtime verified smoke benchmark",
        qualityThresholds: {
          completionRate: 1,
          verificationPassRate: 1,
          firstPassRate: 0,
          toolReliabilityRate: 1,
          toolSafetyRate: 1,
        },
        scenarios: [
          {
            id: "runtime.verified-smoke",
            title: "Runtime Verified Smoke",
            category: "coding_bugfix",
            workspaceCwd: process.cwd(),
            steps: [
              {
                objective: "Inspect the repository scaffold through the real CLI eval pipeline.",
                expectation: { verificationStatus: "passed" },
              },
            ],
          },
        ],
      }),
      "utf8",
    );

    const verifiedResult = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/eval-benchmark.ts", "--mode", "runtime", "--manifest", verifiedManifestPath, "--no-save"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: "./tsconfig.base.json",
          TSX_DISABLE_CACHE: "1",
        },
        timeout: 30_000,
      },
    );

    assert.equal(verifiedResult.status, 0, verifiedResult.stderr || verifiedResult.stdout);
    const verifiedOutput = JSON.parse(verifiedResult.stdout) as {
      metrics?: { verificationPassRate?: number };
      quality?: { passed?: boolean };
    };
    assert.equal(verifiedOutput.metrics?.verificationPassRate, 1);
    assert.equal(verifiedOutput.quality?.passed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
