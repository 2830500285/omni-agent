import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assessVerification,
  buildBenchmarkQualityReport,
  buildCapabilityMaturityReport,
  buildEvalProgramReadinessReport,
  buildLongitudinalBenchmarkReport,
  normalizeCapabilityScorecardDefinition,
  normalizeEvalSuiteDefinition,
  runEvalSuite,
  validateCapabilityMaturityClaims,
} from "../packages/evals/src/index.ts";

test("verification assessment distinguishes missing plans from skipped execution", () => {
  const noPlan = assessVerification(
    {
      mode: "auto",
      commands: [],
      summary: "No commands inferred.",
    },
    null,
  );
  assert.equal(noPlan.status, "skipped");
  assert.match(noPlan.summary, /no verification command was inferred/i);

  const skippedExecution = assessVerification(
    {
      mode: "auto",
      commands: ["npm run build"],
      summary: "Inferred verification commands.",
    },
    null,
  );
  assert.equal(skippedExecution.status, "skipped");
  assert.match(skippedExecution.summary, /no verification run was executed/i);
});

test("eval suite runner aggregates P8 metrics across bugfix, multi-agent, and long-context scenarios", async () => {
  const suite = normalizeEvalSuiteDefinition(
    {
      title: "P8 core suite",
      scenarios: [
        {
          id: "bugfix",
          category: "single_agent_bugfix",
          workspaceCwd: "./fixtures/bugfix",
          steps: [
            {
              objective: "Fix the parser regression.",
              expectation: {
                verificationStatus: "passed",
                requiredChangedFiles: ["src/parser.ts"],
                requiredFinalResponseIncludes: ["parser regression fixed"],
              },
            },
          ],
        },
        {
          id: "investigation",
          category: "multi_agent_investigation",
          workspaceCwd: "./fixtures/investigation",
          steps: [
            {
              objective: "Investigate the intermittent route failure.",
              expectation: {
                verificationStatus: "passed",
                requiredToolNames: ["spawn_subagent", "run_verification"],
                requiredFinalResponseIncludes: ["root cause isolated"],
              },
            },
          ],
        },
        {
          id: "long-context",
          category: "long_context_modification",
          workspaceCwd: "./fixtures/long-context",
          steps: [
            {
              id: "step-1",
              objective: "Refactor the planner state builder.",
              expectation: {
                verificationStatus: "passed",
                requiredChangedFiles: ["src/planner.ts"],
                requiredFinalResponseIncludes: ["planner state updated"],
              },
            },
            {
              id: "step-2",
              objective: "Continue the same thread and document the planner changes.",
              expectation: {
                verificationStatus: "passed",
                requiredChangedFiles: ["docs/planner.md"],
                requiredFinalResponseIncludes: ["planner changes documented"],
              },
            },
          ],
        },
      ],
    },
    { baseDir: "E:/Temporary/Paper Agent/omni-agent" },
  );

  const receivedThreadIds: string[] = [];
  const result = await runEvalSuite(suite, async ({ scenario, stepIndex, threadId }) => {
    if (scenario.id === "bugfix") {
      return {
        observedRun: {
          runId: "run-bugfix",
          threadId: "thread-bugfix",
          verificationStatus: "passed",
          finalResponse: "parser regression fixed",
          changedFiles: ["src/parser.ts"],
          toolEvents: [
            { toolName: "search_text", status: "ok" },
            { toolName: "run_verification", status: "failed" },
            { toolName: "replace_file_range", status: "ok" },
            { toolName: "run_verification", status: "ok" },
          ],
          toolCallCount: 5,
          turnCount: 3,
          durationMs: 1200,
        },
      };
    }

    if (scenario.id === "investigation") {
      return {
        observedRun: {
          runId: "run-investigation",
          threadId: "thread-investigation",
          verificationStatus: "passed",
          finalResponse: "root cause isolated",
          changedFiles: [],
          toolEvents: [
            { toolName: "spawn_subagent", status: "ok" },
            { toolName: "run_verification", status: "ok" },
          ],
          toolCallCount: 3,
          turnCount: 2,
          durationMs: 900,
        },
      };
    }

    receivedThreadIds.push(threadId ?? "");
    return {
      observedRun: {
        runId: `run-long-${stepIndex + 1}`,
        threadId: "thread-long",
        verificationStatus: "passed",
        finalResponse: stepIndex === 0 ? "planner state updated" : "planner changes documented",
        changedFiles: stepIndex === 0 ? ["src/planner.ts"] : ["docs/planner.md"],
        toolEvents: [{ toolName: "run_verification", status: "ok" }],
        toolCallCount: stepIndex === 0 ? 4 : 2,
        turnCount: 2,
        durationMs: 800,
      },
    };
  });

  assert.equal(receivedThreadIds[0], "");
  assert.equal(receivedThreadIds[1], "thread-long");
  assert.equal(result.metrics.scenarioCount, 3);
  assert.equal(result.metrics.completedCount, 3);
  assert.equal(result.metrics.verificationPassedCount, 4);
  assert.equal(result.metrics.firstPassCount, 2);
  assert.equal(result.metrics.repairEligibleCount, 1);
  assert.equal(result.metrics.repairedCount, 1);
  assert.equal(result.metrics.longContextScenarioCount, 1);
  assert.equal(result.metrics.retainedStateCount, 1);
  assert.equal(result.metrics.completionRate, 1);
  assert.equal(result.metrics.verificationPassRate, 1);
  assert.equal(result.metrics.firstPassRate, 2 / 3);
  assert.equal(result.metrics.repairRate, 1);
  assert.equal(result.metrics.averageToolCallCount, 3.5);
  assert.equal(result.metrics.toolFailureRate, 0);
  assert.equal(result.metrics.memoryHitRate, null);
  assert.equal(result.metrics.routeDeliverySuccessRate, null);
  assert.equal(result.metrics.stateRetentionRate, 1);
  assert.equal(result.scenarioResults[0]?.scoreType, "pass");
  assert.equal(result.scenarioResults[0]?.stepResults[0]?.scoreType, "regression");
  assert.equal(result.scenarioResults[2]?.scoreType, "pass");
});

test("eval expectations can require successful tool events", async () => {
  const suite = normalizeEvalSuiteDefinition(
    {
      title: "Successful tool expectation",
      scenarios: [
        {
          id: "tool-success",
          category: "single_agent_bugfix",
          steps: [
            {
              objective: "Run a required tool successfully.",
              expectation: {
                verificationStatus: "passed",
                requiredToolNames: ["workspace_info", "run_verification"],
                requiredSuccessfulToolNames: ["workspace_info", "run_verification"],
              },
            },
          ],
        },
      ],
    },
    { baseDir: "E:/Temporary/Paper Agent/omni-agent" },
  );

  const result = await runEvalSuite(suite, async () => ({
    observedRun: {
      runId: "run-tool-success",
      threadId: "thread-tool-success",
      verificationStatus: "passed",
      finalResponse: "done",
      changedFiles: [],
      toolEvents: [
        { toolName: "workspace_info", status: "failed" },
        { toolName: "run_verification", status: "ok" },
      ],
      toolCallCount: 2,
      turnCount: 1,
      durationMs: 100,
    },
  }));

  assert.equal(result.metrics.completedCount, 0);
  assert.match(result.scenarioResults[0]?.stepResults[0]?.reasons.join(" "), /workspace_info/);
});

test("verification-native policy requires passed evidence before completing a task", async () => {
  const suite = normalizeEvalSuiteDefinition({
    title: "Verification-native completion",
    verificationPolicy: {
      completionRequiresEvidence: true,
      requiredEvidenceKinds: ["command"],
    },
    scenarios: [
      {
        id: "verification-native",
        category: "verification_repair",
        steps: [
          {
            objective: "Complete the task only after recording verification evidence.",
            expectation: {
              verificationStatus: "passed",
              requiredVerificationEvidenceKinds: ["command"],
            },
          },
        ],
      },
    ],
  });

  const missingEvidence = await runEvalSuite(suite, async () => ({
    observedRun: {
      verificationStatus: "passed",
      finalResponse: "done",
      changedFiles: [],
      toolEvents: [],
      toolCallCount: 1,
      turnCount: 1,
      durationMs: 50,
    },
  }));

  assert.equal(missingEvidence.verificationPolicy?.completionRequiresEvidence, true);
  assert.equal(missingEvidence.metrics.completedCount, 0);
  assert.match(missingEvidence.scenarioResults[0]?.stepResults[0]?.reasons.join(" "), /verification evidence/i);
  assert.match(missingEvidence.scenarioResults[0]?.stepResults[0]?.reasons.join(" "), /command/i);

  const withCommandEvidence = await runEvalSuite(suite, async () => ({
    observedRun: {
      verificationStatus: "passed",
      finalResponse: "done",
      changedFiles: [],
      toolEvents: [{ toolName: "run_verification", status: "ok" }],
      toolCallCount: 1,
      turnCount: 1,
      durationMs: 50,
    },
  }));

  assert.equal(withCommandEvidence.metrics.completedCount, 1);
  assert.equal(withCommandEvidence.scenarioResults[0]?.completed, true);
});

test("eval scorecards cover profile capability categories and channel metrics", async () => {
  const suite = normalizeEvalSuiteDefinition(
    {
      title: "Profile capability scorecard",
      scenarios: [
        {
          id: "coding",
          category: "coding_fix",
          workspaceCwd: "./fixtures/coding",
          steps: [
            {
              objective: "Fix a coding issue and verify it.",
              expectation: {
                verificationStatus: "passed",
                requiredToolNames: ["run_verification"],
              },
            },
          ],
        },
        {
          id: "memory",
          category: "memory_recall",
          workspaceCwd: "./fixtures/memory",
          steps: [
            {
              objective: "Recall a stored project convention.",
              expectation: {
                verificationStatus: "passed",
                requiredToolNames: ["search_memory"],
              },
            },
          ],
        },
        {
          id: "route",
          category: "route_handling",
          workspaceCwd: "./fixtures/route",
          steps: [
            {
              objective: "Accept an inbound route message and deliver a reply.",
              expectation: {
                verificationStatus: "passed",
                requiredToolNames: ["deliver_route"],
              },
            },
          ],
        },
        {
          id: "repair",
          category: "verification_repair",
          workspaceCwd: "./fixtures/repair",
          steps: [
            {
              objective: "Repair after a failing verification command.",
              expectation: {
                verificationStatus: "passed",
                requiredToolNames: ["run_verification"],
              },
            },
          ],
        },
      ],
    },
    { baseDir: "E:/Temporary/Paper Agent/omni-agent" },
  );

  const result = await runEvalSuite(suite, async ({ scenario }) => {
    if (scenario.id === "memory") {
      return {
        observedRun: {
          verificationStatus: "passed",
          finalResponse: "memory recalled",
          changedFiles: [],
          toolEvents: [{ toolName: "search_memory", status: "ok" }],
          memoryUseful: true,
          toolCallCount: 1,
          turnCount: 1,
        },
      };
    }
    if (scenario.id === "route") {
      return {
        observedRun: {
          verificationStatus: "passed",
          finalResponse: "route delivered",
          changedFiles: [],
          toolEvents: [{ toolName: "deliver_route", status: "ok" }],
          toolCallCount: 1,
          turnCount: 1,
        },
      };
    }
    if (scenario.id === "repair") {
      return {
        observedRun: {
          verificationStatus: "passed",
          finalResponse: "verification repaired",
          changedFiles: ["src/fix.ts"],
          toolEvents: [
            { toolName: "run_verification", status: "failed" },
            { toolName: "run_verification", status: "ok" },
          ],
          toolCallCount: 2,
          turnCount: 2,
        },
      };
    }
    return {
      observedRun: {
        verificationStatus: "passed",
        finalResponse: "coding fix complete",
        changedFiles: ["src/fix.ts"],
        toolEvents: [{ toolName: "run_verification", status: "ok" }],
        toolCallCount: 1,
        turnCount: 1,
      },
    };
  });

  assert.deepEqual(
    result.scenarioResults.map((entry) => entry.category).sort(),
    ["coding_fix", "memory_recall", "route_handling", "verification_repair"],
  );
  assert.equal(result.metrics.completedCount, 4);
  assert.equal(result.metrics.verificationPassedCount, 4);
  assert.equal(result.metrics.repairEligibleCount, 1);
  assert.equal(result.metrics.repairedCount, 1);
  assert.equal(result.metrics.toolFailureRate, 0);
  assert.equal(result.metrics.memoryHitRate, 1);
  assert.equal(result.metrics.memoryUsefulnessRate, 1);
  assert.equal(result.metrics.verificationPassRate, 1);
  assert.equal(result.metrics.toolSafetyViolationRate, 0);
  assert.equal(result.metrics.routeDeliverySuccessRate, 1);
  assert.equal(result.metrics.fallbackRecoveryRate, null);
});

test("complex product parity benchmark suite captures previous manual stress scenarios", () => {
  const definition = JSON.parse(readFileSync("examples/evals/complex-suite.json", "utf8")) as Parameters<typeof normalizeEvalSuiteDefinition>[0];
  const suite = normalizeEvalSuiteDefinition(definition, { baseDir: "E:/Temporary/Paper Agent/omni-agent/examples/evals" });

  assert.equal(suite.scenarios.length, 5);
  assert.deepEqual(
    suite.scenarios.map((scenario) => scenario.id),
    [
      "complex.renewal_billing",
      "complex.health_claims",
      "complex.microgrid_dispatch",
      "complex.pharma_coldchain",
      "complex.math_model_word",
    ],
  );
  assert.ok(suite.scenarios.every((scenario) => scenario.workspaceCwd.includes(".tmp")));
  assert.equal(suite.scenarios.find((scenario) => scenario.id === "complex.math_model_word")?.steps.length, 2);
  assert.equal(suite.qualityThresholds?.completionRate, 0.9);
});

test("capability scorecard normalizes maturity states and P0 benchmark categories", () => {
  const scorecard = normalizeCapabilityScorecardDefinition(
    {
      title: "Capability scorecard",
      capabilities: [
        {
          id: "coding-runtime",
          status: "usable",
          referenceProject: "claudecode-source",
          evidenceFiles: ["packages/core-runtime/src/index.ts"],
          requiredTests: ["tests/runtime.test.ts"],
          scenarioIds: ["coding"],
        },
        {
          id: "mcp-runtime",
          status: "scaffolded",
          scenarioIds: ["mcp"],
        },
      ],
      scenarios: [
        {
          id: "coding",
          category: "coding_bugfix",
          steps: [{ objective: "Fix a bug." }],
        },
        {
          id: "mcp",
          category: "mcp_tool_use",
          steps: [{ objective: "Read an MCP resource." }],
        },
        {
          id: "gateway",
          category: "gateway_route_delivery",
          steps: [{ objective: "Deliver a route reply." }],
        },
        {
          id: "skill",
          category: "skill_creation",
          steps: [{ objective: "Create a skill." }],
        },
        {
          id: "subagent",
          category: "subagent_delegation",
          steps: [{ objective: "Delegate a task." }],
        },
        {
          id: "automation",
          category: "long_running_automation",
          steps: [{ objective: "Create an automation." }],
        },
      ],
    },
    { baseDir: "E:/Temporary/Paper Agent/omni-agent" },
  );

  assert.deepEqual(scorecard.capabilities.map((entry) => entry.status), ["usable", "scaffolded"]);
  assert.deepEqual(
    scorecard.scenarios.map((entry) => entry.category).sort(),
    [
      "coding_bugfix",
      "gateway_route_delivery",
      "long_running_automation",
      "mcp_tool_use",
      "skill_creation",
      "subagent_delegation",
    ],
  );
  assert.equal(scorecard.capabilities[0]?.title, "coding-runtime");
  assert.deepEqual(scorecard.capabilities[0]?.referenceProject, ["claudecode-source"]);
  assert.deepEqual(scorecard.capabilities[0]?.evidenceFiles, ["packages/core-runtime/src/index.ts"]);
  assert.deepEqual(scorecard.capabilities[0]?.requiredTests, ["tests/runtime.test.ts"]);
  assert.deepEqual(scorecard.capabilities[0]?.scenarioIds, ["coding"]);
});

test("eval program readiness captures dataset, judge, trace, and release-gate governance", () => {
  const suite = normalizeEvalSuiteDefinition(
    {
      title: "Governed coding agent suite",
      program: {
        supportedDecision: "Block or allow a coding-agent release candidate.",
        evalUnit: "full_trace",
        sourceProjects: ["Harness-Learning", "agent-eval-learning"],
        dataset: {
          minExamples: 30,
          sources: ["manual regression tasks", "production incident review"],
          samplingStrategy: "Blend common flows, edge cases, costly failures, and policy-sensitive cases.",
          labelingProcess: "Human reviewer labels expected tool behavior, failure category, and acceptance notes.",
          versioning: "Freeze dataset version for each release candidate.",
          failureCategories: ["tool_misuse", "verification_skipped", "unsafe_write"],
        },
        judges: [
          {
            id: "verification",
            type: "deterministic",
            description: "Run the configured verifier.",
          },
          {
            id: "trace-rubric",
            type: "llm_judge",
            rubric: ["Check task completion, tool discipline, recovery, and final evidence."],
            calibration: "Review disagreements against human labels before changing prompts or models.",
          },
        ],
        metrics: [
          { id: "completionRate", target: ">= 0.85" },
          { id: "verificationPassRate", target: ">= 0.9" },
          { id: "toolSafetyRate", target: "= 1" },
        ],
        releaseGates: [
          {
            id: "completion",
            metricId: "completionRate",
            operator: "at_least",
            threshold: 0.85,
            severity: "blocking",
          },
          {
            id: "safety",
            metricId: "toolSafetyRate",
            operator: "equals",
            threshold: 1,
            severity: "blocking",
          },
        ],
        operationalMetrics: ["latency", "cost", "tool_calls", "retries"],
        traceArtifacts: ["task_prompt", "tool_calls", "verification_results", "final_response"],
        reviewCadence: "Before prompt, model, tool-schema, or permission-policy changes.",
      },
      scenarios: [
        {
          id: "coding",
          category: "coding_bugfix",
          steps: [{ objective: "Fix a bug and prove it with tests." }],
        },
      ],
    },
    { baseDir: "E:/Temporary/Paper Agent/omni-agent" },
  );

  const report = buildEvalProgramReadinessReport(suite);
  assert.equal(suite.program?.evalUnit, "full_trace");
  assert.deepEqual(suite.program?.sourceProjects, ["Harness-Learning", "agent-eval-learning"]);
  assert.equal(report.ready, true);
  assert.equal(report.errorCount, 0);
  assert.equal(report.blockingGateCount, 2);
  assert.deepEqual(report.judgeTypes, ["deterministic", "llm_judge"]);
});

test("eval program readiness rejects final-answer-only agent suites and missing gates", () => {
  const suite = normalizeEvalSuiteDefinition({
    title: "Weak eval program",
    program: {
      supportedDecision: "Ship a coding agent prompt.",
      evalUnit: "final_answer",
      dataset: {
        minExamples: 10,
        sources: ["ad hoc sample"],
        failureCategories: [],
      },
      judges: [{ id: "judge", type: "llm_judge" }],
      metrics: [{ id: "completionRate" }],
      releaseGates: [],
    },
    scenarios: [
      {
        id: "coding",
        category: "coding_bugfix",
        steps: [{ objective: "Fix a bug." }],
      },
    ],
  });

  const report = buildEvalProgramReadinessReport(suite);
  assert.equal(report.ready, false);
  assert.ok(report.issues.some((issue) => issue.field === "program.evalUnit" && issue.severity === "error"));
  assert.ok(report.issues.some((issue) => issue.field === "program.releaseGates" && issue.severity === "error"));
  assert.ok(report.issues.some((issue) => /LLM judges must include a rubric/i.test(issue.reason)));
  assert.ok(report.issues.some((issue) => /30 to 100/i.test(issue.reason) && issue.severity === "warning"));
});

test("example scorecard and suite track ACP compatibility and ecosystem gap evidence", () => {
  const scorecardDefinition = JSON.parse(readFileSync("examples/evals/capability-scorecard.json", "utf8")) as Parameters<
    typeof normalizeCapabilityScorecardDefinition
  >[0];
  const suiteDefinition = JSON.parse(readFileSync("examples/evals/suite.json", "utf8")) as Parameters<
    typeof normalizeEvalSuiteDefinition
  >[0];
  const verificationNativeDefinition = JSON.parse(
    readFileSync("examples/evals/verification-native-runtime.json", "utf8"),
  ) as Parameters<typeof normalizeEvalSuiteDefinition>[0];

  const scorecard = normalizeCapabilityScorecardDefinition(scorecardDefinition, {
    baseDir: "E:/Temporary/Paper Agent/omni-agent",
  });
  const suite = normalizeEvalSuiteDefinition(suiteDefinition, {
    baseDir: "E:/Temporary/Paper Agent/omni-agent/examples/evals",
  });
  const verificationNativeFixture = normalizeEvalSuiteDefinition(verificationNativeDefinition, {
    baseDir: "E:/Temporary/Paper Agent/omni-agent/examples/evals",
  });
  const programReadiness = buildEvalProgramReadinessReport(suite);

  const acpCapability = scorecard.capabilities.find((entry) => entry.id === "acp-external-client-compatibility");
  const ecosystemCapability = scorecard.capabilities.find((entry) => entry.id === "reference-project-ecosystem-gap");
  const evalProgramCapability = scorecard.capabilities.find((entry) => entry.id === "eval-program-governance");
  const verificationNativeCapability = scorecard.capabilities.find((entry) => entry.id === "verification-native-runtime");

  assert.ok(acpCapability);
  assert.ok(ecosystemCapability);
  assert.ok(evalProgramCapability);
  assert.ok(verificationNativeCapability);
  assert.equal(acpCapability.status, "usable");
  assert.equal(ecosystemCapability.status, "usable");
  assert.equal(evalProgramCapability.status, "usable");
  assert.equal(verificationNativeCapability.status, "usable");
  assert.deepEqual(evalProgramCapability.referenceProject, ["Harness-Learning", "agent-eval-learning"]);
  assert.deepEqual(suite.program?.sourceProjects, ["Harness-Learning", "agent-eval-learning"]);
  assert.equal(suite.program?.evalUnit, "full_trace");
  assert.ok(suite.program?.dataset.failureCategories.includes("verification_evidence_missing"));
  assert.ok(suite.program?.traceArtifacts.includes("verification_evidence"));
  assert.equal(verificationNativeFixture.verificationPolicy?.completionRequiresEvidence, true);
  assert.deepEqual(verificationNativeFixture.verificationPolicy?.requiredEvidenceKinds, ["command"]);
  assert.equal(programReadiness.ready, true);
  assert.equal(programReadiness.blockingGateCount, 4);
  assert.deepEqual(acpCapability.scenarioIds, ["acp-external-client-compatibility"]);
  assert.deepEqual(ecosystemCapability.scenarioIds, ["reference-project-ecosystem-gap"]);
  assert.deepEqual(evalProgramCapability.scenarioIds, ["eval-program-governance"]);
  assert.deepEqual(verificationNativeCapability.scenarioIds, ["verification-native-completion-evidence"]);
  assert.ok(acpCapability.requiredTests.includes("tests/evals.test.ts"));
  assert.ok(ecosystemCapability.requiredTests.includes("tests/evals.test.ts"));
  assert.ok(evalProgramCapability.requiredTests.includes("tests/evals.test.ts"));
  assert.ok(verificationNativeCapability.requiredTests.includes("tests/evals.test.ts"));

  const scorecardScenarioIds = new Set(scorecard.scenarios.map((entry) => entry.id));
  assert.ok(scorecardScenarioIds.has("acp-external-client-compatibility"));
  assert.ok(scorecardScenarioIds.has("reference-project-ecosystem-gap"));
  assert.ok(scorecardScenarioIds.has("eval-program-governance"));
  assert.ok(scorecardScenarioIds.has("verification-native-completion-evidence"));

  const suiteScenarioIds = new Set(suite.scenarios.map((entry) => entry.id));
  assert.ok(suiteScenarioIds.has("compat.acp_external_client"));
  assert.ok(suiteScenarioIds.has("compat.reference_ecosystem_gap"));
  assert.ok(suiteScenarioIds.has("eval.program_governance"));
  assert.ok(suiteScenarioIds.has("verification.native_completion_evidence"));
  assert.equal(suite.scenarios.find((entry) => entry.id === "compat.acp_external_client")?.category, "gateway_route_delivery");
  assert.equal(suite.scenarios.find((entry) => entry.id === "compat.reference_ecosystem_gap")?.category, "verification_repair");
  assert.equal(suite.scenarios.find((entry) => entry.id === "eval.program_governance")?.category, "verification_repair");
  assert.equal(suite.scenarios.find((entry) => entry.id === "verification.native_completion_evidence")?.category, "verification_repair");
  for (const id of [
    "acp-cancel-and-event-projection",
    "inline-context-references",
    "channel-human-readable-transcripts",
    "responses-streaming-adapter",
    "skill-platform-gates",
    "credential-pool-rotation",
    "browser-supervisor-observations",
    "browser-screenshot-artifact",
    "model-routing-policy-diagnostics",
    "cli-checkpoint-slash-surface",
  ]) {
    const capability = scorecard.capabilities.find((entry) => entry.id === id);
    assert.ok(capability, `Missing capability ${id}`);
    assert.equal(capability.status, "usable");
    assert.ok(capability.requiredTests.includes("tests/evals.test.ts"));
  }
  const matureRollbackCapability = scorecard.capabilities.find((entry) => entry.id === "runtime-mutation-checkpoint-rollback");
  assert.ok(matureRollbackCapability);
  assert.equal(matureRollbackCapability.status, "mature");
  assert.ok(matureRollbackCapability.requiredTests.includes("tests/evals.test.ts"));
  const matureWorkspaceCheckpointCapability = scorecard.capabilities.find((entry) => entry.id === "workspace-checkpoints");
  assert.ok(matureWorkspaceCheckpointCapability);
  assert.equal(matureWorkspaceCheckpointCapability.status, "mature");
  assert.ok(matureWorkspaceCheckpointCapability.requiredTests.includes("tests/evals.test.ts"));
  const matureToolLifecycleCapability = scorecard.capabilities.find((entry) => entry.id === "tool-lifecycle-hooks");
  assert.ok(matureToolLifecycleCapability);
  assert.equal(matureToolLifecycleCapability.status, "mature");
  assert.ok(matureToolLifecycleCapability.requiredTests.includes("tests/evals.test.ts"));
  assert.ok(matureToolLifecycleCapability.matureEvidenceFiles?.includes("tests/extensions.test.ts"));
  assert.ok(matureToolLifecycleCapability.matureEvidenceFiles?.includes("tests/runtime.test.ts"));
  for (const id of [
    "compat.acp_cancel_events",
    "compat.inline_context_refs",
    "compat.channel_transcripts",
    "compat.responses_streaming",
    "compat.skill_platform_gates",
    "compat.workspace_skill_slash_command",
    "compat.credential_pool_rotation",
    "compat.browser_supervisor_observations",
    "compat.headless_run_json_stream",
    "compat.structured_tool_presentation",
    "compat.structured_tool_history",
    "compat.tool_lifecycle_hooks",
    "compat.workspace_checkpoints",
    "compat.browser_screenshot_artifact",
    "compat.model_routing_policy_diagnostics",
    "compat.runtime_mutation_checkpoint_rollback",
    "compat.cli_checkpoint_slash_surface",
    "compat.extension_package_contracts",
    "compat.long_running_process_tools",
    "compat.secret_scan_warning",
    "compat.long_context_task_board_retention",
  ]) {
    assert.ok(suiteScenarioIds.has(id), `Missing suite scenario ${id}`);
  }

  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "shell-file-safety")
      ?.scenarioIds.includes("secret-scan-warning"),
  );
  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "skill-lifecycle")
      ?.scenarioIds.includes("workspace-skill-slash-command"),
  );
  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "coding-runtime")
      ?.scenarioIds.includes("headless-run-json-stream"),
  );
  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "coding-runtime")
      ?.scenarioIds.includes("structured-tool-presentation"),
  );
  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "coding-runtime")
      ?.scenarioIds.includes("structured-tool-history"),
  );
  assert.ok(
    scorecard.capabilities.find((entry) => entry.id === "coding-runtime")?.evidenceFiles.includes("packages/session-store/src/index.ts"),
  );
  assert.ok(
    scorecard.capabilities.find((entry) => entry.id === "coding-runtime")?.requiredTests.includes("tests/session-store.test.ts"),
  );
  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "long-context")
      ?.scenarioIds.includes("long-context-task-board-retention"),
  );
  assert.ok(
    scorecard.capabilities.find((entry) => entry.id === "long-context")?.evidenceFiles.includes("packages/tools/src/index.ts"),
  );
  assert.ok(
    scorecard.capabilities.find((entry) => entry.id === "skill-lifecycle")?.requiredTests.includes("tests/cli-chat.test.ts"),
  );
  assert.ok(
    scorecard.capabilities.find((entry) => entry.id === "shell-file-safety")?.evidenceFiles.includes("packages/tools/src/index.ts"),
  );
  assert.ok(
    scorecard.capabilities.find((entry) => entry.id === "browser-screenshot-artifact")?.requiredTests.includes("tests/tools.test.ts"),
  );
  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "model-routing-policy-diagnostics")
      ?.requiredTests.includes("tests/model-client.test.ts"),
  );
  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "runtime-mutation-checkpoint-rollback")
      ?.requiredTests.includes("tests/runtime.test.ts"),
  );
  assert.ok(
    scorecard.capabilities.find((entry) => entry.id === "cli-checkpoint-slash-surface")?.requiredTests.includes("tests/cli-chat.test.ts"),
  );
  assert.ok(
    scorecard.capabilities.find((entry) => entry.id === "extension-package-contracts")?.requiredTests.includes("tests/extensions.test.ts"),
  );
  assert.ok(
    scorecard.capabilities.find((entry) => entry.id === "long-running-process-tools")?.requiredTests.includes("tests/tools.test.ts"),
  );
  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "long-running-automation")
      ?.scenarioIds.includes("automation-cron-at-schedule"),
  );
  assert.ok(
    scorecard.capabilities
      .find((entry) => entry.id === "model-runtime")
      ?.scenarioIds.includes("model-cost-estimation"),
  );

  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.browser_screenshot_artifact")?.steps[0]?.expectation?.requiredToolNames,
    ["browser_screenshot", "read_artifact", "run_verification"],
  );
  assert.equal(suite.scenarios.find((entry) => entry.id === "compat.browser_screenshot_artifact")?.category, "verification_repair");
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.secret_scan_warning")?.steps[0]?.expectation?.requiredToolNames,
    ["scan_secrets", "write_file", "run_verification"],
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.workspace_skill_slash_command")?.steps[0]?.expectation?.requiredToolNames,
    ["run_verification"],
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.headless_run_json_stream")?.steps[0]?.expectation?.requiredToolNames,
    ["run_verification"],
  );
  assert.equal(suite.scenarios.find((entry) => entry.id === "compat.headless_run_json_stream")?.category, "coding_bugfix");
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.structured_tool_presentation")?.steps[0]?.expectation?.requiredToolNames,
    ["write_file", "run_verification"],
  );
  assert.ok(
    suite.scenarios
      .find((entry) => entry.id === "compat.structured_tool_presentation")
      ?.steps[0]?.expectation?.requiredFinalResponseIncludes?.includes("acp projection includes presentation"),
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.structured_tool_history")?.steps[0]?.expectation?.requiredToolNames,
    ["workspace_info", "run_verification"],
  );
  assert.ok(
    suite.scenarios
      .find((entry) => entry.id === "compat.structured_tool_history")
      ?.steps[0]?.expectation?.requiredFinalResponseIncludes?.includes("presentation persisted"),
  );
  assert.ok(
    suite.scenarios
      .find((entry) => entry.id === "compat.workspace_skill_slash_command")
      ?.steps[0]?.expectation?.requiredFinalResponseIncludes?.includes("built-in slash command preserved"),
  );
  assert.ok(
    suite.scenarios
      .find((entry) => entry.id === "compat.secret_scan_warning")
      ?.steps[0]?.expectation?.requiredFinalResponseIncludes?.includes("secret preview redacted"),
  );
  assert.ok(
    suite.scenarios
      .find((entry) => entry.id === "compat.model_routing_policy_diagnostics")
      ?.steps[0]?.objective.includes("credential raw redaction"),
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.model_routing_policy_diagnostics")?.steps[0]?.expectation?.requiredToolNames,
    ["model_fallback"],
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.tool_lifecycle_hooks")?.steps[0]?.expectation?.requiredToolNames,
    ["audited_tool:hook:pre", "audited_tool:hook:post", "write_file:hook:stop", "run_verification"],
  );
  assert.ok(
    suite.scenarios
      .find((entry) => entry.id === "compat.tool_lifecycle_hooks")
      ?.steps[0]?.expectation?.requiredFinalResponseIncludes?.includes("pre hook failed closed"),
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.runtime_mutation_checkpoint_rollback")?.steps[0]?.expectation?.requiredToolNames,
    ["create_checkpoint", "rollback_checkpoint", "run_verification"],
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.cli_checkpoint_slash_surface")?.steps[0]?.expectation?.requiredToolNames,
    ["create_checkpoint", "rollback_checkpoint", "run_verification"],
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.extension_package_contracts")?.steps[0]?.expectation?.requiredToolNames,
    ["extension_package_contract", "run_verification"],
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.long_running_process_tools")?.steps[0]?.expectation?.requiredToolNames,
    ["process_start", "process_logs", "process_list", "process_stop"],
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.automation_cron_at_schedule")?.steps[0]?.expectation?.requiredToolNames,
    ["create_automation", "list_automations", "run_verification"],
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "compat.model_cost_estimation")?.steps[0]?.expectation?.requiredToolNames,
    ["model_fallback", "run_verification"],
  );
  assert.deepEqual(
    suite.scenarios.find((entry) => entry.id === "verification.native_completion_evidence")?.steps[0]?.expectation
      ?.requiredVerificationEvidenceKinds,
    ["command"],
  );
  assert.deepEqual(
    verificationNativeFixture.scenarios[0]?.steps[0]?.expectation?.requiredVerificationEvidenceKinds,
    ["command"],
  );
});

test("capability scorecard rejects unknown linked scenarios", () => {
  assert.throws(
    () =>
      normalizeCapabilityScorecardDefinition({
        title: "Invalid scorecard",
        capabilities: [{ id: "missing-link", status: "missing", scenarioIds: ["missing-scenario"] }],
        scenarios: [{ id: "known", category: "coding_bugfix", steps: [{ objective: "Fix a bug." }] }],
      }),
    /unknown scenario/i,
  );
});

test("capability maturity validation enforces evidence and benchmark coverage", () => {
  const scorecard = normalizeCapabilityScorecardDefinition(
    {
      title: "Capability maturity gates",
      capabilities: [
        {
          id: "usable-without-evidence",
          status: "usable",
          referenceProject: "claudecode-source",
          scenarioIds: ["coding"],
        },
        {
          id: "mature-with-failing-scenario",
          status: "mature",
          referenceProject: "openclaw-main",
          referenceStrength: "Reference has production-grade command safety.",
          evidenceFiles: ["packages/approvals/src/index.ts"],
          matureEvidenceFiles: ["packages/approvals/src/command-policy.ts"],
          liveOrContractTests: ["tests/channel-contracts.test.ts"],
          matureBenchmarkScenarioIds: ["safety-benchmark"],
          operationalRunbook: "docs/operations.md#shell-and-file-safety",
          failureRecoveryTests: ["tests/approvals.test.ts"],
          matureCriteria: ["Blocks destructive commands with auditable recovery behavior."],
          nextMilestone: "Broaden platform-specific command parsing regressions.",
          requiredTests: ["tests/approvals.test.ts"],
          scenarioIds: ["safety"],
        },
        {
          id: "valid-scaffold",
          status: "scaffolded",
          referenceProject: "hermes-agent-main",
        },
      ],
      scenarios: [
        {
          id: "coding",
          category: "coding_bugfix",
          steps: [{ objective: "Fix a bug." }],
        },
        {
          id: "safety",
          category: "verification_repair",
          steps: [{ objective: "Block a destructive command." }],
        },
      ],
    },
    { baseDir: "E:/Temporary/Paper Agent/omni-agent" },
  );

  const issues = validateCapabilityMaturityClaims(scorecard, {
    passingScenarioIds: new Set(["coding"]),
    requirePassingScenariosForUsable: true,
  });

  assert.deepEqual(
    issues.map((issue) => [issue.capabilityId, issue.severity]),
    [
      ["usable-without-evidence", "error"],
      ["usable-without-evidence", "error"],
      ["mature-with-failing-scenario", "error"],
    ],
  );
  assert.match(issues[0]?.reason ?? "", /evidence/i);
  assert.match(issues[1]?.reason ?? "", /test/i);
  assert.match(issues[2]?.reason ?? "", /scenario coverage/i);
});

test("mature capability validation requires mature evidence, contracts, runbook, recovery tests, and criteria", () => {
  const scorecard = normalizeCapabilityScorecardDefinition({
    title: "Mature-only gates",
    capabilities: [
      {
        id: "mature-without-operational-proof",
        status: "mature",
        referenceProject: "openclaw-main",
        referenceStrength: "Reference exposes a production channel gateway.",
        evidenceFiles: ["packages/gateway/src/index.ts"],
        requiredTests: ["tests/gateway.test.ts"],
        nextMilestone: "Keep expanding live provider coverage.",
        scenarioIds: ["gateway"],
      },
    ],
    scenarios: [{ id: "gateway", category: "gateway_route_delivery", steps: [{ objective: "Deliver a routed message." }] }],
  });

  const issues = validateCapabilityMaturityClaims(scorecard, {
    passingScenarioIds: new Set(["gateway"]),
  });

  assert.deepEqual(
    issues.map((issue) => issue.reason),
    [
      "Mature capabilities must cite mature evidence files beyond baseline implementation evidence.",
      "Mature capabilities must cite at least one live or contract test.",
      "Mature capabilities must cite at least one benchmark scenario that must pass before release.",
      "Mature capabilities must cite an operational runbook.",
      "Mature capabilities must cite failure recovery tests.",
      "Mature capabilities must document explicit mature criteria.",
    ],
  );
  assert.ok(issues.every((issue) => issue.severity === "error"));
});

test("capability maturity report summarizes status scores and issues", () => {
  const scorecard = normalizeCapabilityScorecardDefinition({
    title: "Capability maturity report",
    capabilities: [
      {
        id: "missing-capability",
        status: "missing",
      },
      {
        id: "scaffolded-capability",
        status: "scaffolded",
        referenceProject: "hermes-agent-main",
      },
      {
        id: "usable-capability",
        status: "usable",
        referenceProject: ["claudecode-source", "openclaw-main"],
        evidenceFiles: ["packages/core-runtime/src/index.ts"],
        requiredTests: ["tests/runtime.test.ts"],
        scenarioIds: ["coding"],
      },
    ],
    scenarios: [{ id: "coding", category: "coding_bugfix", steps: [{ objective: "Fix a bug." }] }],
  });

  const report = buildCapabilityMaturityReport(scorecard, {
    passingScenarioIds: new Set(["coding"]),
    requirePassingScenariosForUsable: true,
  });

  assert.equal(report.capabilityCount, 3);
  assert.deepEqual(report.countsByStatus, { missing: 1, scaffolded: 1, usable: 1, mature: 0 });
  assert.equal(report.totalScore, 3);
  assert.equal(report.maxScore, 9);
  assert.equal(report.maturityRate, 0.3333);
  assert.deepEqual(report.issues, []);
});

test("benchmark quality report scores gates, categories, and recommendations", async () => {
  const suite = normalizeEvalSuiteDefinition(
    {
      title: "Quality gate suite",
      scenarios: [
        {
          id: "pass",
          category: "coding_fix",
          steps: [
            {
              objective: "Complete the edit.",
              expectation: { verificationStatus: "passed" },
            },
          ],
        },
        {
          id: "route-fail",
          category: "route_handling",
          steps: [
            {
              objective: "Deliver the route reply.",
              expectation: {
                verificationStatus: "passed",
                requiredToolNames: ["deliver_route"],
              },
            },
          ],
        },
      ],
    },
    { baseDir: "E:/Temporary/Paper Agent/omni-agent" },
  );

  const result = await runEvalSuite(suite, async ({ scenario }) => {
    if (scenario.id === "route-fail") {
      return {
        observedRun: {
          verificationStatus: "failed",
          finalResponse: "route failed",
          changedFiles: [],
          toolEvents: [{ toolName: "deliver_route", status: "failed" }],
          toolSafetyViolation: true,
          toolCallCount: 9,
          turnCount: 3,
        },
      };
    }
    return {
      observedRun: {
        verificationStatus: "passed",
        finalResponse: "done",
        changedFiles: ["src/app.ts"],
        toolEvents: [{ toolName: "run_verification", status: "ok" }],
        toolCallCount: 2,
        turnCount: 1,
      },
    };
  });

  const report = buildBenchmarkQualityReport(result, {
    completionRate: 1,
    routeDeliverySuccessRate: 1,
    toolSafetyRate: 1,
    targetAverageToolCalls: 4,
  });

  assert.equal(report.passed, false);
  assert.ok(report.overallScore > 0);
  assert.ok(report.overallScore < 1);
  assert.equal(report.dimensions.find((entry) => entry.id === "completion")?.passed, false);
  assert.equal(report.dimensions.find((entry) => entry.id === "completion")?.scoreType, "regression");
  assert.equal(report.dimensions.find((entry) => entry.id === "verification_pass")?.passed, false);
  assert.equal(report.dimensions.find((entry) => entry.id === "route_delivery")?.passed, false);
  assert.equal(report.dimensions.find((entry) => entry.id === "tool_safety")?.passed, false);
  assert.equal(report.dimensions.find((entry) => entry.id === "tool_safety")?.scoreType, "risk");
  assert.equal(report.categoryBreakdown.find((entry) => entry.category === "route_handling")?.completionRate, 0);
  assert.ok(report.recommendations.some((entry) => /failed scenarios/i.test(entry)));
});

test("longitudinal benchmark report detects quality regressions across runs", () => {
  const thresholds = {
    completionRate: 0.95,
    verificationPassRate: 0.9,
    firstPassRate: 0.75,
    repairRate: 0.8,
    toolReliabilityRate: 0.95,
    memoryHitRate: 0.8,
    memoryUsefulnessRate: 0.8,
    toolSafetyRate: 0.98,
    routeDeliverySuccessRate: 0.9,
    fallbackRecoveryRate: 0.8,
    stateRetentionRate: 0.85,
    efficiencyScore: 0.75,
    targetAverageToolCalls: 6,
  };
  const baselineReport = {
    suiteTitle: "Product benchmark",
    generatedAt: "2026-04-01T00:00:00.000Z",
    overallScore: 0.9,
    passed: true,
    thresholds,
    dimensions: [
      {
        id: "completion",
        label: "Scenario completion",
        score: 0.96,
        threshold: 0.95,
        passed: true,
        weight: 0.26,
        summary: "Baseline completion.",
      },
      {
        id: "route_delivery",
        label: "Route delivery",
        score: 0.94,
        threshold: 0.9,
        passed: true,
        weight: 0.1,
        summary: "Baseline route delivery.",
      },
    ],
    categoryBreakdown: [],
    recommendations: [],
  };
  const latestReport = {
    ...baselineReport,
    generatedAt: "2026-04-28T00:00:00.000Z",
    overallScore: 0.82,
    passed: false,
    dimensions: [
      {
        id: "completion",
        label: "Scenario completion",
        score: 0.95,
        threshold: 0.95,
        passed: true,
        weight: 0.26,
        summary: "Latest completion.",
      },
      {
        id: "route_delivery",
        label: "Route delivery",
        score: 0.86,
        threshold: 0.9,
        passed: false,
        weight: 0.1,
        summary: "Latest route delivery.",
      },
    ],
  };

  const report = buildLongitudinalBenchmarkReport(
    [
      { id: "latest", completedAt: "2026-04-28T00:00:00.000Z", report: latestReport },
      { id: "baseline", completedAt: "2026-04-01T00:00:00.000Z", report: baselineReport },
    ],
    { regressionTolerance: 0.02 },
  );

  assert.equal(report.runCount, 2);
  assert.equal(report.baselineRunId, "baseline");
  assert.equal(report.latestRunId, "latest");
  assert.equal(report.overallScoreDelta, -0.08);
  assert.deepEqual(report.trend.map((entry) => entry.runId), ["baseline", "latest"]);
  assert.equal(report.regressions.length, 1);
  assert.equal(report.regressions[0]?.dimensionId, "route_delivery");
  assert.ok(report.recommendations.some((entry) => /regression/i.test(entry)));
});
