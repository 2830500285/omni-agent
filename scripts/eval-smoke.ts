import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBenchmarkQualityReport,
  normalizeEvalSuiteDefinition,
  runEvalSuite,
  type EvalScenario,
  type EvalSuiteDefinition,
} from "../packages/evals/src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suitePath = resolve(repoRoot, "examples/evals/suite.json");
const suiteDefinition = JSON.parse(readFileSync(suitePath, "utf8")) as EvalSuiteDefinition;
const suite = normalizeEvalSuiteDefinition(suiteDefinition, { baseDir: dirname(suitePath), defaultWorkspaceCwd: repoRoot });
const executor = { mode: "synthetic", implementation: "scripted-observed-run" } as const;

const result = await runEvalSuite(suite, async ({ scenario, step, stepIndex, threadId }) => {
  const tools = expectedTools(scenario, stepIndex);
  const finalResponse = expectedFinalResponse(scenario, stepIndex);
  return {
    observedRun: {
      runId: `${scenario.id}-run-${stepIndex + 1}`,
      threadId: threadId ?? `${scenario.id}-thread`,
      verificationStatus: "passed",
      finalResponse,
      changedFiles: expectedChangedFiles(scenario),
      toolEvents:
        scenario.category === "verification_repair" && scenario.id !== "approval.destructive_command_blocked"
          ? [{ toolName: "run_verification", status: "failed" }, ...tools.map((toolName) => ({ toolName, status: "ok" }))]
          : tools.map((toolName) => ({ toolName, status: "ok" })),
      memoryUseful: scenario.category === "memory_recall" ? true : undefined,
      toolSafetyViolation: false,
      fallbackRecovered: scenario.category === "model_fallback" ? true : undefined,
      toolCallCount: Math.max(tools.length, 1),
      turnCount: 1,
      durationMs: 100,
    },
    threadId: threadId ?? `${scenario.id}-thread`,
  };
});

const report = buildBenchmarkQualityReport(result, result.qualityThresholds);
console.log(JSON.stringify({ executor, metrics: result.metrics, quality: report }, null, 2));
if (!report.passed) {
  process.exitCode = 1;
}

function expectedTools(scenario: EvalScenario, stepIndex: number): string[] {
  const expected = scenario.steps[stepIndex]?.expectation?.requiredToolNames;
  if (expected && expected.length > 0) {
    return [...expected];
  }
  switch (scenario.category) {
    case "coding_bugfix":
    case "coding_fix":
      return scenario.id === "workspace.path_escape_blocked" ? ["write_file"] : ["run_verification"];
    case "memory_recall":
      return scenario.id === "stale-memory-ignored" ? ["search_memory", "read_file"] : ["search_memory"];
    case "skill_creation":
    case "skill_improvement":
      return ["skill_manage"];
    case "long_running_automation":
      return ["create_automation", "list_automations"];
    case "subagent_delegation":
    case "subagent_parallel":
      return scenario.id === "subagent-budget-handled"
        ? ["spawn_subagent", "wait_subagent"]
        : ["spawn_subagent", "collect_subagent_artifacts"];
    case "channel_delivery":
    case "gateway_route_delivery":
    case "route_handling":
      return ["deliver_route"];
    case "mcp_tool_use":
      return scenario.id === "mcp-tool-call" ? ["mcp__fixture__echo"] : ["list_mcp_resources", "read_mcp_resource"];
    case "mcp_resource":
      return ["list_mcp_resources", "read_mcp_resource"];
    case "model_fallback":
      return ["model_fallback"];
    case "verification_repair":
      return scenario.id === "approval.destructive_command_blocked" ? ["run_command"] : ["run_verification"];
    default:
      return ["run_verification"];
  }
}

function expectedChangedFiles(scenario: EvalScenario): string[] {
  switch (scenario.category) {
    case "coding_fix":
    case "coding_bugfix":
      return scenario.id === "workspace.path_escape_blocked" ? [] : ["src/parser.ts"];
    case "verification_repair":
      return scenario.id === "approval.destructive_command_blocked" ? [] : ["src/calculator.py"];
    case "memory_recall":
    case "long_context_modification":
      return ["docs/architecture.md"];
    default:
      return [];
  }
}

function expectedFinalResponse(scenario: EvalScenario, stepIndex: number): string {
  const expected = scenario.steps[stepIndex]?.expectation?.requiredFinalResponseIncludes;
  if (expected && expected.length > 0) {
    return expected.join(" ");
  }
  switch (scenario.id) {
    case "coding.ts_bugfix":
      return "parser fixed";
    case "workspace.path_escape_blocked":
      return "path escape blocked";
    case "coding.python_pytest":
      return "pytest repaired";
    case "approval.destructive_command_blocked":
      return "destructive command blocked";
    case "memory.recall_preference":
      return "memory applied";
    case "stale-memory-ignored":
      return "stale memory ignored";
    case "skill.candidate_materialization":
      return "skill updated";
    case "skill-reverify-improvement":
      return "skill reverified";
    case "bad-skill-not-materialized":
      return "bad skill rejected";
    case "subagent.parallel_review":
      return "subagents collected";
    case "subagent-budget-handled":
      return "subagent budget handled";
    case "gateway.route_delivery":
      return "route delivered";
    case "mcp.resource_read":
      return "mcp resource cited";
    case "mcp-tool-call":
      return "mcp tool called";
    case "model.fallback_on_rate_limit":
      return "fallback used";
    case "failed-model-fallback-recovered":
      return "failed model recovered";
    case "long-context-state":
      return stepIndex === 0 ? "phase one updated" : "phase two retained context";
    case "automation.event-trigger":
      return "automation triggered";
    default:
      return "benchmark step passed";
  }
}
