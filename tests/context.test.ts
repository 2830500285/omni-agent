import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildExecutionContext,
  compactToolObservationsForModel,
  createContextEngine,
  createThreadSummarySnapshot,
  findRelevantAgentPlaybooks,
  listAgentRoleContracts,
  mergeThreadHandoffSummaries,
  summarizeThread,
} from "../packages/context/src/index.ts";

test("execution context compacts long thread history while preserving the prior summary", () => {
  const context = buildExecutionContext({
    taskContract: {
      objective: "Refactor the parser",
      workspaceId: "workspace-1",
      threadId: "thread-1",
      cwd: "E:/repo",
      successCriteria: ["Keep the parser behavior intact"],
      constraints: ["Prefer small edits"],
      verificationMode: "required",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["build", "test"],
    },
    previousThreadSummary: [
      "## Active Task",
      "Refactor the parser without changing behavior.",
      "",
      "## Resolved",
      "- Updated parser scaffolding.",
      "",
      "## Pending",
      "- Re-run parser verification after the next edit.",
      "",
      "## Files Changed",
      "- src/parser.ts",
      "",
      "## Verification Status",
      "failed: Parser regression still needs a follow-up build.",
      "",
      "## Open Risks",
      "- Build is still red until parser verification passes.",
    ].join("\n"),
    threadMessages: Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message-${index + 1} ${"detail ".repeat(40)}`,
      createdAt: new Date(2026, 3, index + 1).toISOString(),
    })),
  });

  assert.match(context.threadSummary, /Structured thread handoff/);
  assert.match(context.threadSummary, /## Active Task/);
  assert.match(context.threadSummary, /## Pending/);
  assert.match(context.threadSummary, /## Verification Status/);
  assert.match(context.threadSummary, /Protected head context/);
  assert.match(context.threadSummary, /Earlier transcript compacted/);
  assert.match(context.threadSummary, /Recent tail context/);
  assert.match(context.threadSummary, /message-1/);
  assert.match(context.threadSummary, /message-10/);
  assert.match(context.systemPrompt, /Task scene/);
  assert.match(context.systemPrompt, /Agent role: primary/);
  assert.match(context.systemPrompt, /Phase: understanding/);
  assert.ok(context.systemPrompt.length < 4_000);
});

test("execution context attaches inline file and folder refs from objective and extra instructions", () => {
  const workspace = mkdtempSync(join(tmpdir(), "omni-context-refs-"));
  try {
    mkdirSync(join(workspace, "src", "nested"), { recursive: true });
    writeFileSync(join(workspace, "src", "parser.ts"), "export const parser = 'attached-file';\n");
    writeFileSync(join(workspace, "src", "nested", "helper.ts"), "export const helper = true;\n");
    writeFileSync(join(workspace, "README.md"), "# Attached README\n\nUse repository-local context only.\n");

    const context = buildExecutionContext({
      taskContract: {
        objective: "Inspect @file(src/parser.ts) and @folder(src) before editing.",
        workspaceId: "workspace-inline-context",
        threadId: "thread-inline-context",
        cwd: workspace,
        successCriteria: ["Attach referenced context"],
        constraints: ["Keep prompt context bounded"],
        verificationMode: "required",
        preferredExecutionDomain: "workspace",
      },
      workspaceSnapshot: {
        cwd: workspace,
        repoRoot: workspace,
        repoName: "repo",
        branch: "main",
        dirty: true,
        isGitRepo: true,
        gitStatusLines: [],
        changedFiles: ["src/parser.ts"],
        detectedFiles: ["package.json"],
        packageManager: "npm",
        packageScripts: ["test"],
      },
      threadMessages: [],
      extraInstructions: ["Also include @file:README.md for repository notes."],
    });

    assert.match(context.systemPrompt, /Attached Context:/);
    assert.match(context.systemPrompt, /\[1\] @file src\/parser\.ts/);
    assert.match(context.systemPrompt, /attached-file/);
    assert.match(context.systemPrompt, /\[2\] @folder src/);
    assert.match(context.systemPrompt, /src\/nested\/helper\.ts/);
    assert.match(context.systemPrompt, /\[3\] @file README\.md/);
    assert.match(context.systemPrompt, /Attached README/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("execution context keeps attached refs inside the workspace and truncates large files", () => {
  const parent = mkdtempSync(join(tmpdir(), "omni-context-safety-"));
  const workspace = join(parent, "repo");
  try {
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(parent, "secret.txt"), "outside-workspace-secret\n");
    writeFileSync(join(workspace, "large.txt"), `${"large-context-line\n".repeat(200)}tail-marker\n`);

    const context = buildExecutionContext({
      taskContract: {
        objective: "Read @file(../secret.txt) and @file(large.txt) safely.",
        workspaceId: "workspace-inline-safety",
        threadId: "thread-inline-safety",
        cwd: workspace,
        successCriteria: ["Reject unsafe refs", "Bound attached context"],
        constraints: ["No outside-workspace reads"],
        verificationMode: "required",
        preferredExecutionDomain: "workspace",
      },
      workspaceSnapshot: {
        cwd: workspace,
        repoRoot: workspace,
        repoName: "repo",
        branch: "main",
        dirty: true,
        isGitRepo: true,
        gitStatusLines: [],
        changedFiles: [],
        detectedFiles: ["package.json"],
        packageManager: "npm",
        packageScripts: ["test"],
      },
      threadMessages: [],
    });

    assert.match(context.systemPrompt, /path is outside workspace root/);
    assert.doesNotMatch(context.systemPrompt, /outside-workspace-secret/);
    assert.match(context.systemPrompt, /\[2\] @file large\.txt/);
    assert.match(context.systemPrompt, /\[truncated to fit attached-context budget\]/);
    assert.ok(context.systemPrompt.length < 6_500);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("execution context attaches inline unstaged and staged git diffs", (t) => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("git is not available");
    return;
  }

  const workspace = mkdtempSync(join(tmpdir(), "omni-context-git-"));
  try {
    execFileSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: workspace, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Context Test"], { cwd: workspace, stdio: "ignore" });
    writeFileSync(join(workspace, "unstaged.txt"), "initial\n");
    writeFileSync(join(workspace, "staged.txt"), "initial\n");
    execFileSync("git", ["add", "."], { cwd: workspace, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: workspace, stdio: "ignore" });
    writeFileSync(join(workspace, "unstaged.txt"), "initial\nunstaged-change\n");
    writeFileSync(join(workspace, "staged.txt"), "initial\nstaged-change\n");
    execFileSync("git", ["add", "staged.txt"], { cwd: workspace, stdio: "ignore" });

    const context = buildExecutionContext({
      taskContract: {
        objective: "Review @diff and @staged before planning.",
        workspaceId: "workspace-inline-diff",
        threadId: "thread-inline-diff",
        cwd: workspace,
        successCriteria: ["Attach git diffs"],
        constraints: ["Keep diff context bounded"],
        verificationMode: "best-effort",
        preferredExecutionDomain: "workspace",
      },
      workspaceSnapshot: {
        cwd: workspace,
        repoRoot: workspace,
        repoName: "repo",
        branch: "main",
        dirty: true,
        isGitRepo: true,
        gitStatusLines: [" M unstaged.txt", "M  staged.txt"],
        changedFiles: ["unstaged.txt", "staged.txt"],
        detectedFiles: [".git"],
        packageManager: "npm",
        packageScripts: ["test"],
      },
      threadMessages: [],
    });

    assert.match(context.systemPrompt, /\[1\] @diff/);
    assert.match(context.systemPrompt, /unstaged-change/);
    assert.match(context.systemPrompt, /\[2\] @staged/);
    assert.match(context.systemPrompt, /staged-change/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("context engine prepares a structured parent handoff for subagents", () => {
  const engine = createContextEngine({
    taskContract: {
      objective: "Repair the parser regression without losing the failing verification context.",
      workspaceId: "workspace-handoff",
      threadId: "thread-handoff",
      cwd: "E:/repo",
      successCriteria: ["Keep parser behavior intact", "Return verified evidence"],
      constraints: ["Prefer the smallest safe repair"],
      verificationMode: "required",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["build", "test"],
    },
    threadMessages: [
      {
        role: "user",
        text: "Repair the parser and preserve the failing verification context.",
        createdAt: new Date(2026, 3, 26).toISOString(),
      },
    ],
    taskState: {
      phase: "acting",
      currentGoal: "Repair the parser regression and preserve the verification evidence.",
      completedSubgoals: ["Collected repository evidence and task constraints."],
      pendingSubgoals: ["Apply the smallest safe parser repair.", "Run verification evidence after the repair."],
      recentFailureReason: "Verification failed on command: npm test",
      latestVerification: {
        status: "failed",
        summary: "Failed on verification command: npm test",
      },
    },
  });

  const handoff = engine.prepareSubagentSpawn({
    objective: "Inspect the failing parser fixture and report the smallest fix.",
    role: "researcher",
    depth: 1,
    maxDepth: 2,
    parentJobId: null,
    rootJobId: "root-job",
  });

  assert.ok(handoff.length >= 4);
  assert.match(handoff.join("\n\n"), /Parent task handoff:/);
  assert.match(handoff.join("\n\n"), /Parent task scene:/);
  assert.match(handoff.join("\n\n"), /Parent thread summary:/);
  assert.match(handoff.join("\n\n"), /Assigned subagent scope:/);
  assert.match(handoff.join("\n\n"), /Repair the parser regression/);
  assert.match(handoff.join("\n\n"), /researcher/);
});

test("thread handoff merge clears stale task-board pending items when the board has no active items", () => {
  const previous = [
    "## Active Task",
    "Track the task board.",
    "",
    "## Resolved",
    "None.",
    "",
    "## Pending",
    "- Task board [in_progress/high]: stale completed item",
    "- Keep unrelated follow-up",
    "",
    "## Files Changed",
    "None.",
    "",
    "## Verification Status",
    "not-run: No verification status recorded.",
    "",
    "## Open Risks",
    "None.",
  ].join("\n");
  const latest = [
    "## Active Task",
    "Track the task board.",
    "",
    "## Resolved",
    "- Task board has no active items.",
    "",
    "## Pending",
    "None.",
    "",
    "## Files Changed",
    "None.",
    "",
    "## Verification Status",
    "passed: No verification needed.",
    "",
    "## Open Risks",
    "None.",
  ].join("\n");

  const merged = mergeThreadHandoffSummaries(previous, latest);
  assert.doesNotMatch(merged, /stale completed item/);
  assert.match(merged, /Keep unrelated follow-up/);
  assert.match(merged, /Task board has no active items/);
});

test("thread handoff merge preserves prior task-board pending when no current board was observed", () => {
  const previous = [
    "## Active Task",
    "Track the task board.",
    "",
    "## Resolved",
    "None.",
    "",
    "## Pending",
    "- Task board [pending/medium]: still open from previous run",
    "- Keep unrelated follow-up",
    "",
    "## Files Changed",
    "None.",
    "",
    "## Verification Status",
    "not-run: No verification status recorded.",
    "",
    "## Open Risks",
    "None.",
  ].join("\n");
  const latest = [
    "## Active Task",
    "Track the task board.",
    "",
    "## Resolved",
    "- Latest outcome: inspected without touching the board.",
    "",
    "## Pending",
    "None.",
    "",
    "## Files Changed",
    "None.",
    "",
    "## Verification Status",
    "passed: No verification needed.",
    "",
    "## Open Risks",
    "None.",
  ].join("\n");

  const merged = mergeThreadHandoffSummaries(previous, latest);
  assert.match(merged, /still open from previous run/);
  assert.match(merged, /Keep unrelated follow-up/);
});

test("context engine feeds recent subagent outcomes back into the next prompt", () => {
  const engine = createContextEngine({
    taskContract: {
      objective: "Coordinate a worker and summarize the result.",
      workspaceId: "workspace-subagent",
      threadId: "thread-subagent",
      cwd: "E:/repo",
      successCriteria: ["Return the worker outcome"],
      constraints: ["Stay concise"],
      verificationMode: "best-effort",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: false,
      isGitRepo: true,
      gitStatusLines: [],
      changedFiles: [],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["test"],
    },
    threadMessages: [
      {
        role: "user",
        text: "Delegate the parser read-only audit and report back.",
        createdAt: new Date(2026, 3, 26).toISOString(),
      },
    ],
  });

  const rendered = engine.onSubagentEnded({
    objective: "Audit the parser fixture and report back.",
    role: "worker",
    status: "completed",
    verificationStatus: "passed",
    changedFiles: ["src/parser.ts"],
    finalResponse: "Audit completed with one concrete parser follow-up.",
  });

  assert.match(rendered.systemPrompt, /Recent subagent outcomes:/);
  assert.match(rendered.systemPrompt, /worker subagent; completed for objective/i);
  assert.match(rendered.systemPrompt, /changed=src\/parser\.ts/);
  assert.match(rendered.systemPrompt, /response=Audit completed with one concrete parser follow-up/);
});

test("context engine archives older subagent outcomes while preserving recent ones", () => {
  const engine = createContextEngine({
    taskContract: {
      objective: "Coordinate several worker outcomes.",
      agentRole: "supervisor",
      workspaceId: "workspace-archive",
      threadId: "thread-archive",
      cwd: "E:/repo",
      successCriteria: ["Preserve the most relevant worker feedback"],
      constraints: ["Keep context compact"],
      verificationMode: "best-effort",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["test"],
    },
    threadMessages: [],
  });

  for (let index = 0; index < 6; index += 1) {
    engine.onSubagentEnded({
      objective: `Worker follow-up ${index + 1}`,
      role: "worker",
      status: "completed",
      verificationStatus: "passed",
      changedFiles: [`src/parser-${index + 1}.ts`],
      finalResponse: `Completed worker follow-up ${index + 1}.`,
    });
  }

  const rendered = engine.compact();
  assert.match(rendered.systemPrompt, /Archived subagent outcomes:/);
  assert.match(rendered.systemPrompt, /Worker follow-up 1/);
  assert.match(rendered.systemPrompt, /Worker follow-up 6/);
  assert.match(
    engine
      .prepareSubagentSpawn({
        objective: "Review the preserved worker feedback.",
        role: "reviewer",
        depth: 1,
        maxDepth: 3,
      })
      .join("\n\n"),
    /Archived sibling outcomes:/,
  );
});

test("context engine exposes maintenance and prompt-budget status", () => {
  const engine = createContextEngine({
    taskContract: {
      objective: "Coordinate a long-running repair loop and keep the prompt compact.",
      agentRole: "supervisor",
      workspaceId: "workspace-status",
      threadId: "thread-status",
      cwd: "E:/repo",
      successCriteria: ["Keep the prompt under control"],
      constraints: ["Track context pressure"],
      verificationMode: "best-effort",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["test"],
    },
    threadMessages: [
      {
        role: "user",
        text: "Coordinate a long-running repair loop.",
        createdAt: new Date(2026, 3, 27).toISOString(),
      },
    ],
    extraInstructions: Array.from({ length: 6 }, (_, index) => `Extra instruction ${index + 1}: ${"detail ".repeat(90)}`),
  });

  engine.maintain();
  engine.compact();

  const status = engine.getStatus();
  assert.equal(status.engineId, "default");
  assert.ok(status.maintenanceCycles >= 2);
  assert.ok(status.compactionCount >= 1);
  assert.ok(status.estimatedPromptTokens > 0);
});

test("createContextEngine can use a custom factory", () => {
  const bootstrapInput = {
    taskContract: {
      objective: "Use a custom context engine factory.",
      workspaceId: "workspace-custom-engine",
      threadId: "thread-custom-engine",
      cwd: "E:/repo",
      successCriteria: ["Return a custom context"],
      constraints: ["Keep the factory hook simple"],
      verificationMode: "best-effort" as const,
      preferredExecutionDomain: "workspace" as const,
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: false,
      isGitRepo: true,
      gitStatusLines: [],
      changedFiles: [],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["test"],
    },
    threadMessages: [],
  };
  let factoryCalls = 0;
  const engine = createContextEngine(bootstrapInput, (input) => {
    factoryCalls += 1;
    const fallback = createContextEngine(input);
    return fallback;
  });

  assert.equal(factoryCalls, 1);
  assert.equal(engine.getState().taskContract.objective, "Use a custom context engine factory.");
});

test("execution context includes a reviewer response contract", () => {
  const context = buildExecutionContext({
    taskContract: {
      objective: "Review the parser patch and report concrete risks.",
      agentRole: "reviewer",
      workspaceId: "workspace-reviewer",
      threadId: "thread-reviewer",
      cwd: "E:/repo",
      successCriteria: ["Return actionable review findings"],
      constraints: ["Do not edit files"],
      verificationMode: "best-effort",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["test"],
    },
    threadMessages: [
      {
        role: "user",
        text: "Review the parser patch and report risks.",
        createdAt: new Date(2026, 3, 27).toISOString(),
      },
    ],
  });

  assert.match(context.systemPrompt, /Role guidance:/);
  assert.match(context.systemPrompt, /Role response contract:/);
  assert.match(context.systemPrompt, /Response kind: review/);
  assert.match(context.systemPrompt, /May edit files: no/);
  assert.match(context.systemPrompt, /REVIEW_STATUS: PASS/);
});

test("execution context includes a supervisor response contract", () => {
  const context = buildExecutionContext({
    taskContract: {
      objective: "Coordinate the repair work across subagents.",
      agentRole: "supervisor",
      workspaceId: "workspace-supervisor",
      threadId: "thread-supervisor",
      cwd: "E:/repo",
      successCriteria: ["Return an actionable dispatch plan"],
      constraints: ["Do not edit files directly"],
      verificationMode: "best-effort",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["test"],
    },
    threadMessages: [
      {
        role: "user",
        text: "Coordinate the repair plan across child agents.",
        createdAt: new Date(2026, 3, 27).toISOString(),
      },
    ],
  });

  assert.match(context.systemPrompt, /Role response contract:/);
  assert.match(context.systemPrompt, /Response kind: plan/);
  assert.match(context.systemPrompt, /May edit files: no/);
  assert.match(context.systemPrompt, /PLAN_STATUS: READY/);
});

test("agent role contracts and built-in playbooks expose orchestration and verification guidance", () => {
  const contracts = listAgentRoleContracts();
  const planner = contracts.find((entry) => entry.role === "planner");
  const verifier = contracts.find((entry) => entry.role === "verifier");
  assert.ok(planner);
  assert.ok(verifier);
  assert.ok(planner?.defaultAllowedTools?.includes("search_tools"));
  assert.ok(planner?.defaultAllowedTools?.includes("search_agent_playbooks"));
  assert.ok(planner?.defaultAllowedTools?.includes("select_skills"));
  assert.ok(verifier?.defaultAllowedTools?.includes("search_memory"));
  assert.ok(verifier?.defaultAllowedTools?.includes("apply_skills"));
  assert.match(planner?.responseInstructions.join("\n") ?? "", /verification expectation/i);
  assert.match(verifier?.guidance.join("\n") ?? "", /fail closed/i);

  const playbooks = findRelevantAgentPlaybooks({
    query: "delegate parallel compare verify",
    role: "supervisor",
    limit: 2,
  });
  assert.equal(playbooks.length, 2);
  assert.equal(playbooks[0]?.name, "Decompose And Dispatch");
  assert.ok(playbooks.some((entry) => entry.name === "Evidence-First Verification"));
});

test("read-only roles receive a narrower context slice than editing roles", () => {
  const context = buildExecutionContext({
    taskContract: {
      objective: "Verify the parser patch and report whether it is safe to ship.",
      agentRole: "verifier",
      workspaceId: "workspace-readonly-slice",
      threadId: "thread-readonly-slice",
      cwd: "E:/repo",
      successCriteria: ["Return an evidence-backed verdict"],
      constraints: ["Do not edit files"],
      verificationMode: "required",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json", "verify.js"],
      packageManager: "npm",
      packageScripts: ["build", "test"],
    },
    threadMessages: [],
    workspaceInstructions: Array.from({ length: 6 }, (_, index) => ({
      path: `workspace-rule-${index + 1}.md`,
      scope: index >= 4 ? "packages/parser" : ".",
      name: `rule-${index + 1}`,
      content: `workspace instruction ${index + 1}`,
      truncated: false,
    })),
    extraInstructions: Array.from({ length: 6 }, (_, index) => `extra instruction section ${index + 1}`),
  });

  assert.match(context.systemPrompt, /workspace-rule-6\.md/);
  assert.doesNotMatch(context.systemPrompt, /workspace-rule-1\.md/);
  assert.match(context.systemPrompt, /extra instruction section 1/);
  assert.doesNotMatch(context.systemPrompt, /extra instruction section 6/);
});

test("execution context compacts large workspace summary lists to fit prompt budgets", () => {
  const context = buildExecutionContext({
    taskContract: {
      objective: "Audit the repository state",
      workspaceId: "workspace-2",
      threadId: "thread-2",
      cwd: "E:/repo",
      successCriteria: ["Keep the prompt concise"],
      constraints: ["Preserve the most relevant repository signals"],
      verificationMode: "best-effort",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [],
      changedFiles: Array.from({ length: 20 }, (_, index) => `src/modules/very-long-file-name-${index + 1}.ts`),
      detectedFiles: Array.from({ length: 16 }, (_, index) => `signal-${index + 1}`),
      packageManager: "npm",
      packageScripts: Array.from({ length: 18 }, (_, index) => `script-${index + 1}`),
    },
    threadMessages: [
      {
        role: "user",
        text: "Summarize the current repository state before making changes.",
        createdAt: new Date(2026, 3, 1).toISOString(),
      },
    ],
  });

  assert.match(context.repoSummary, /changed files: .* \+\d+ more/);
  assert.match(context.repoSummary, /signals: .* \+\d+ more/);
  assert.match(context.repoSummary, /scripts: .* \+\d+ more/);
  assert.ok(context.systemPrompt.length < 3_500);
});

test("execution context applies strict budgets to workspace instructions and extra instructions", () => {
  const instructionContent = `${"instruction-detail ".repeat(220)}tail`;
  const context = buildExecutionContext({
    taskContract: {
      objective: "Validate prompt-budget compaction behavior.",
      workspaceId: "workspace-3",
      threadId: "thread-3",
      cwd: "E:/repo",
      successCriteria: ["Keep context compact and still actionable."],
      constraints: ["Prefer highest-priority instructions when budgets are exceeded."],
      verificationMode: "required",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts", "src/runner.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["build", "test", "lint"],
    },
    previousThreadSummary: "Compacted history was already tracked by prior iteration.",
    threadMessages: [
      {
        role: "user",
        text: "Check the repository and summarize constraints.",
        createdAt: new Date(2026, 3, 26).toISOString(),
      },
    ],
    workspaceInstructions: Array.from({ length: 12 }, (_, index) => ({
      path: `workspace-rule-${index + 1}.md`,
      scope: index >= 10 ? "packages/api" : ".",
      name: `workspace-rule-${index + 1}`,
      content: `${instructionContent} #${index + 1}`,
      truncated: false,
    })),
    extraInstructions: Array.from({ length: 12 }, (_, index) => [
      `Session notes for index ${index + 1}:`,
      `${"extra-instruction ".repeat(220)}end`,
    ].join("\n")),
  });

  assert.match(context.systemPrompt, /Workspace instruction files/);
  assert.match(context.systemPrompt, /Earlier workspace instructions compacted/);
  assert.match(context.systemPrompt, /Additional extra-instruction sections compacted/);
  assert.match(context.systemPrompt, /workspace-rule-12/);
  assert.ok(context.systemPrompt.length < 6_000);
  assert.ok(context.systemPrompt.length >= 1_800);
});

test("execution context surfaces an explicit task scene instead of only thread history", () => {
  const context = buildExecutionContext({
    taskContract: {
      objective: "Repair the failed verification run and summarize the fix.",
      workspaceId: "workspace-4",
      threadId: "thread-4",
      cwd: "E:/repo",
      successCriteria: ["Recover the failing build", "Explain what changed"],
      constraints: ["Prefer the smallest safe repair"],
      verificationMode: "required",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["build", "test"],
    },
    threadMessages: [
      {
        role: "user",
        text: "Fix the parser failure and verify it.",
        createdAt: new Date(2026, 3, 26).toISOString(),
      },
    ],
    taskState: {
      phase: "repairing",
      currentGoal: "Repair the parser regression that broke verification.",
      completedSubgoals: [
        "Collected repository evidence and task constraints.",
        "Applied the requested repository changes.",
      ],
      pendingSubgoals: ["Repair the failing change and re-run verification."],
      recentFailureReason: "Verification failed on command: npm test",
      latestVerification: {
        status: "failed",
        summary: "Failed on verification command: npm test",
      },
    },
  });

  assert.equal(context.taskState.phase, "repairing");
  assert.match(context.taskSceneSummary, /Phase: repairing/);
  assert.match(context.taskSceneSummary, /Current goal: Repair the parser regression/);
  assert.match(context.taskSceneSummary, /Completed subgoals:/);
  assert.match(context.taskSceneSummary, /Applied the requested repository changes/);
  assert.match(context.taskSceneSummary, /Pending subgoals:/);
  assert.match(context.taskSceneSummary, /Latest verification result: failed/);
  assert.match(context.systemPrompt, /Task scene:/);
  assert.match(context.systemPrompt, /Recent failure reason: Verification failed on command: npm test/);
});

test("execution context uses a long-term compressor with head and tail protection", () => {
  const bulkyAssistantLog = [
    "Verification failed with structured output:",
    "{",
    '  "stdout": "line 1\\nline 2\\nline 3",',
    '  "stderr": "boom",',
    '  "exitCode": 1,',
    '  "durationMs": 5230',
    "}",
    "Retry is still pending.",
  ].join("\n");

  const context = buildExecutionContext({
    taskContract: {
      objective: "Continue the long parser migration without losing earlier context.",
      workspaceId: "workspace-5",
      threadId: "thread-5",
      cwd: "E:/repo",
      successCriteria: ["Preserve the migration plan and recent blocker state"],
      constraints: ["Keep long-session context compact"],
      verificationMode: "required",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["build", "test"],
    },
    previousThreadSummary: [
      "## Active Task",
      "Continue the parser migration from the last verified checkpoint.",
      "",
      "## Resolved",
      "- Captured the previous migration checkpoint.",
      "",
      "## Pending",
      "- Re-run parser verification after the next repair.",
      "",
      "## Files Changed",
      "- src/parser.ts",
      "",
      "## Verification Status",
      "failed: Parser verification still needs a follow-up run.",
      "",
      "## Open Risks",
      "- Verification remains red until the parser repair lands.",
    ].join("\n"),
    threadMessages: [
      {
        role: "user",
        text: "Initial migration request: preserve parser compatibility while moving the module boundary.",
        createdAt: new Date(2026, 3, 1).toISOString(),
      },
      {
        role: "assistant",
        text: "Captured the initial migration plan and the first compatibility constraints.",
        createdAt: new Date(2026, 3, 1, 0, 1).toISOString(),
      },
      {
        role: "user",
        text: "Check the parser verification output and explain the next fix.",
        createdAt: new Date(2026, 3, 2).toISOString(),
      },
      {
        role: "assistant",
        text: bulkyAssistantLog,
        createdAt: new Date(2026, 3, 2, 0, 1).toISOString(),
      },
      ...Array.from({ length: 7 }, (_, index) => ({
        role: index % 2 === 0 ? "assistant" : "user",
        text: `mid-message-${index + 1} ${"detail ".repeat(36)}`,
        createdAt: new Date(2026, 3, 3 + index).toISOString(),
      })),
      {
        role: "user",
        text: "Latest request: keep the migration moving, but do not lose the failing verification context.",
        createdAt: new Date(2026, 3, 12).toISOString(),
      },
      {
        role: "assistant",
        text: "Most recent update: verification is still failing and the parser repair remains in progress.",
        createdAt: new Date(2026, 3, 12, 0, 1).toISOString(),
      },
    ],
  });

  assert.match(context.threadSummary, /Protected head context:/);
  assert.match(context.threadSummary, /Earlier transcript compacted:/);
  assert.match(context.threadSummary, /Recent tail context:/);
  assert.match(context.threadSummary, /Initial migration request/);
  assert.match(context.threadSummary, /Latest request: keep the migration moving/);
  assert.match(context.threadSummary, /Assistant tool\/log output compacted/);
  assert.match(context.threadSummary, /verification log: exit 1, stderr output/);
  assert.doesNotMatch(context.threadSummary, /"durationMs": 5230/);
});

test("compressed thread summaries deduplicate repeated tool logs inside the compacted span", () => {
  const repeatedToolLog = [
    "Verification failed with structured output:",
    "{",
    '  "command": "npm test -- parser",',
    '  "stderr": "boom",',
    '  "exitCode": 1,',
    "}",
  ].join("\n");

  const summary = summarizeThread(
    [
      {
        role: "user",
        text: "Initial request: keep the parser migration intact.",
        createdAt: new Date(2026, 3, 1).toISOString(),
      },
      {
        role: "assistant",
        text: "Captured the migration plan.",
        createdAt: new Date(2026, 3, 1, 0, 1).toISOString(),
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        role: "assistant" as const,
        text: repeatedToolLog,
        createdAt: new Date(2026, 3, 2 + index).toISOString(),
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        text: `mid-span-${index + 1} ${"detail ".repeat(30)}`,
        createdAt: new Date(2026, 3, 10 + index).toISOString(),
      })),
      {
        role: "user",
        text: "Latest ask: finish the parser repair after the verification issue is understood.",
        createdAt: new Date(2026, 3, 20).toISOString(),
      },
    ],
    {
      maxChars: 2_400,
      previousSummary: [
        "## Active Task",
        "Repair the parser verification failure.",
        "",
        "## Resolved",
        "- Captured the initial migration plan.",
        "",
        "## Pending",
        "- Re-run the parser verification after the next fix.",
        "",
        "## Files Changed",
        "- src/parser.ts",
        "",
        "## Verification Status",
        "failed: Parser verification is still red.",
        "",
        "## Open Risks",
        "- The parser verification blocker is unresolved.",
      ].join("\n"),
    },
  );

  assert.match(summary, /verification log: command `npm test -- parser`, exit 1, stderr output/);
  assert.match(summary, /\[repeated 4x in compacted span\]/);
});

test("compressed thread summaries stay within budget and preserve middle user asks", () => {
  const previousSummary = [
    "## Active Task",
    "Continue the parser migration and preserve the release checklist.",
    "",
    "## Resolved",
    ...Array.from({ length: 10 }, (_, index) => `- Completed migration checkpoint ${index + 1}.`),
    "",
    "## Pending",
    ...Array.from({ length: 8 }, (_, index) => `- Pending migration follow-up ${index + 1}.`),
    "",
    "## Files Changed",
    ...Array.from({ length: 8 }, (_, index) => `- packages/module-${index + 1}/src/parser.ts`),
    "",
    "## Verification Status",
    "failed: Parser verification still needs another run with the release checklist synced.",
    "",
    "## Open Risks",
    ...Array.from({ length: 8 }, (_, index) => `- Risk ${index + 1}: keep the release checklist aligned with parser migration.`),
  ].join("\n");

  const context = buildExecutionContext({
    taskContract: {
      objective: "Keep the parser migration moving without losing the checklist state.",
      workspaceId: "workspace-6",
      threadId: "thread-6",
      cwd: "E:/repo",
      successCriteria: ["Preserve recent blocker state and user asks"],
      constraints: ["Stay inside the thread-summary budget"],
      verificationMode: "required",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["build", "test"],
    },
    previousThreadSummary: previousSummary,
    threadMessages: [
      {
        role: "user",
        text: "Original request: preserve parser compatibility throughout the migration.",
        createdAt: new Date(2026, 3, 1).toISOString(),
      },
      {
        role: "assistant",
        text: "Captured the first compatibility checkpoint and the migration plan.",
        createdAt: new Date(2026, 3, 1, 0, 1).toISOString(),
      },
      {
        role: "user",
        text: "Do not lose the release checklist while you repair the parser regression.",
        createdAt: new Date(2026, 3, 2).toISOString(),
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        role: index % 2 === 0 ? "assistant" as const : "user" as const,
        text:
          index % 2 === 0
            ? [
                "Verification output:",
                "{",
                '  "stdout": "alpha\\nbeta\\ngamma",',
                '  "stderr": "still failing",',
                '  "exitCode": 1,',
                '  "durationMs": 4200',
                "}",
                `assistant-log-${index + 1}`,
              ].join("\n")
            : `mid-user-${index + 1} ${"detail ".repeat(40)}`,
        createdAt: new Date(2026, 3, 3 + index).toISOString(),
      })),
      {
        role: "assistant",
        text: "Most recent update: the parser repair is in progress and the release checklist still needs syncing.",
        createdAt: new Date(2026, 3, 20).toISOString(),
      },
      {
        role: "user",
        text: "Latest tail ask: finish the parser repair after the checklist is synced.",
        createdAt: new Date(2026, 3, 21).toISOString(),
      },
    ],
  });

  assert.ok(context.threadSummary.length <= 2_400);
  assert.match(context.threadSummary, /Do not lose the release checklist while you repair the parser regression/);
  assert.match(context.threadSummary, /Latest tail ask: finish the parser repair/);
  assert.match(context.threadSummary, /Assistant tool\/log output compacted/);
});

test("compressed thread summaries preserve active task board and verification risk under pressure", () => {
  const previousSummary = [
    "## Active Task",
    "Finish parser migration without losing the task board.",
    "",
    "## Resolved",
    "- Captured parser migration baseline.",
    "",
    "## Pending",
    "- Task board [pending/high]: rerun parser verification after repair.",
    "",
    "## Files Changed",
    "- src/parser.ts",
    "",
    "## Verification Status",
    "failed: npm test -- parser is still red.",
    "",
    "## Open Risks",
    "- Verification remains red until parser regression is fixed.",
  ].join("\n");

  const context = buildExecutionContext({
    taskContract: {
      objective: "Keep the parser migration moving without losing current task state.",
      workspaceId: "workspace-task-board-retention",
      threadId: "thread-task-board-retention",
      cwd: "E:/repo",
      successCriteria: ["Preserve active task, pending task-board, verification, and open risk"],
      constraints: ["Stay inside the thread-summary budget"],
      verificationMode: "required",
      preferredExecutionDomain: "workspace",
    },
    workspaceSnapshot: {
      cwd: "E:/repo",
      repoRoot: "E:/repo",
      repoName: "repo",
      branch: "main",
      dirty: true,
      isGitRepo: true,
      gitStatusLines: [" M src/parser.ts"],
      changedFiles: ["src/parser.ts"],
      detectedFiles: ["package.json"],
      packageManager: "npm",
      packageScripts: ["build", "test"],
    },
    previousThreadSummary: previousSummary,
    threadMessages: [
      {
        role: "user",
        text: "Initial request: migrate the parser but preserve every task-board blocker.",
        createdAt: new Date(2026, 3, 1).toISOString(),
      },
      ...Array.from({ length: 18 }, (_, index) => ({
        role: index % 2 === 0 ? "assistant" as const : "user" as const,
        text:
          index % 2 === 0
            ? [
                "Verification output:",
                "{",
                '  "command": "npm test -- parser",',
                '  "stderr": "parser regression remains red",',
                '  "exitCode": 1',
                "}",
                `assistant-compaction-pressure-${index + 1} ${"detail ".repeat(45)}`,
              ].join("\n")
            : `mid-user-pressure-${index + 1} ${"detail ".repeat(60)}`,
        createdAt: new Date(2026, 3, 2 + index).toISOString(),
      })),
      {
        role: "user",
        text: "Latest ask: keep the pending verification task visible before another repair.",
        createdAt: new Date(2026, 3, 30).toISOString(),
      },
    ],
  });

  assert.ok(context.threadSummary.length <= 2_400);
  assert.match(context.threadSummary, /Earlier transcript compacted:/);
  assert.match(context.threadSummary, /Finish parser migration without losing the task board/);
  assert.match(context.threadSummary, /Task board \[pending\/high\]: rerun parser verification after repair/);
  assert.match(context.threadSummary, /failed: npm test -- parser is still red/);
  assert.match(context.threadSummary, /Verification remains red until parser regression is fixed/);
});

test("compressed context preserves inline refs alongside task board and verification risk", () => {
  const workspace = mkdtempSync(join(tmpdir(), "omni-context-cross-surface-"));
  try {
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src", "parser.ts"), "export const marker = 'inline-ref-survived';\n", "utf8");
    const previousSummary = [
      "## Active Task",
      "Finish parser migration without losing inline context.",
      "",
      "## Pending",
      "- Task board [pending/high]: rerun parser verification after repair.",
      "",
      "## Files Changed",
      "- src/parser.ts",
      "",
      "## Verification Status",
      "failed: npm test -- parser is still red.",
      "",
      "## Open Risks",
      "- Verification remains red until parser regression is fixed.",
    ].join("\n");

    const context = buildExecutionContext({
      taskContract: {
        objective: "Inspect @file(src/parser.ts) while preserving parser migration state.",
        workspaceId: "workspace-cross-surface-retention",
        threadId: "thread-cross-surface-retention",
        cwd: workspace,
        successCriteria: ["Preserve attached refs and compressed state"],
        constraints: ["Stay inside the thread-summary budget"],
        verificationMode: "required",
        preferredExecutionDomain: "workspace",
      },
      workspaceSnapshot: {
        cwd: workspace,
        repoRoot: workspace,
        repoName: "repo",
        branch: "main",
        dirty: true,
        isGitRepo: true,
        gitStatusLines: [" M src/parser.ts"],
        changedFiles: ["src/parser.ts"],
        detectedFiles: ["package.json"],
        packageManager: "npm",
        packageScripts: ["build", "test"],
      },
      previousThreadSummary: previousSummary,
      threadMessages: [
        {
          role: "user",
          text: "Initial request: keep @file(src/parser.ts), task board, and verification risk together.",
          createdAt: new Date(2026, 3, 1).toISOString(),
        },
        ...Array.from({ length: 18 }, (_, index) => ({
          role: index % 2 === 0 ? "assistant" as const : "user" as const,
          text:
            index % 2 === 0
              ? [
                  "Verification output:",
                  "{",
                  '  "command": "npm test -- parser",',
                  '  "stderr": "parser regression remains red",',
                  '  "exitCode": 1',
                  "}",
                  `assistant-cross-pressure-${index + 1} ${"detail ".repeat(45)}`,
                ].join("\n")
              : `mid-user-cross-pressure-${index + 1} ${"detail ".repeat(60)}`,
          createdAt: new Date(2026, 3, 2 + index).toISOString(),
        })),
        {
          role: "user",
          text: "Latest ask: use the attached parser file after preserving the failed verification risk.",
          createdAt: new Date(2026, 3, 30).toISOString(),
        },
      ],
    });

    assert.match(context.threadSummary, /Earlier transcript compacted:/);
    assert.match(context.threadSummary, /Task board \[pending\/high\]: rerun parser verification after repair/);
    assert.match(context.threadSummary, /failed: npm test -- parser is still red/);
    assert.match(context.threadSummary, /Verification remains red until parser regression is fixed/);
    assert.match(context.systemPrompt, /Attached Context:/);
    assert.match(context.systemPrompt, /\[1\] @file src\/parser\.ts/);
    assert.match(context.systemPrompt, /inline-ref-survived/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("thread handoff summaries merge iteratively across repeated compactions", () => {
  const previousSummary = [
    "## Active Task",
    "Repair the parser verification failure.",
    "",
    "## Resolved",
    "- Captured the parser failure mode.",
    "- Updated the migration checklist.",
    "",
    "## Pending",
    "- Re-run parser verification after the next edit.",
    "",
    "## Files Changed",
    "- src/parser.ts",
    "",
    "## Verification Status",
    "failed: npm test still breaks on the parser fixture.",
    "",
    "## Open Risks",
    "- Verification is still red.",
  ].join("\n");
  const latestSummary = [
    "## Active Task",
    "Finalize the API-side parser repair and verify it.",
    "",
    "## Resolved",
    "- Repaired the API parser shim.",
    "",
    "## Pending",
    "- Run the planned verification commands before treating the change as complete.",
    "",
    "## Files Changed",
    "- packages/api/src/parser.ts",
    "",
    "## Verification Status",
    "skipped: Verification commands were inferred but not executed yet.",
    "",
    "## Open Risks",
    "- Verification has not run on the repaired API parser yet.",
  ].join("\n");

  const merged = mergeThreadHandoffSummaries(previousSummary, latestSummary);

  assert.match(merged, /Finalize the API-side parser repair and verify it/);
  assert.match(merged, /Captured the parser failure mode/);
  assert.match(merged, /Repaired the API parser shim/);
  assert.match(merged, /src\/parser\.ts/);
  assert.match(merged, /packages\/api\/src\/parser\.ts/);
  assert.match(merged, /Verification Status/);
  assert.match(merged, /skipped: Verification commands were inferred but not executed yet/);
});

test("thread summary snapshots preserve structured handoff metadata", () => {
  const snapshot = createThreadSummarySnapshot([
    "## Active Task",
    "Complete the parser repair.",
    "",
    "## Resolved",
    "- Captured the failing case.",
    "",
    "## Pending",
    "- Re-run npm test.",
    "",
    "## Files Changed",
    "- src/parser.ts",
    "",
    "## Verification Status",
    "failed: npm test still fails.",
    "",
    "## Open Risks",
    "- Verification remains red.",
  ].join("\n"));

  assert.equal(snapshot.summaryVersion, 1);
  assert.match(snapshot.summaryHash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.handoff?.activeTask, "Complete the parser repair.");
  assert.deepEqual(snapshot.handoff?.pending, ["Re-run npm test."]);
});

test("tool observation compaction keeps head-tail state while aging middle details", () => {
  const compacted = compactToolObservationsForModel(
    Array.from({ length: 10 }, (_, index) => ({
      toolName: `fixture_tool_${index + 1}`,
      ok: index !== 8,
      summary: `Observation ${index + 1} ${"detail ".repeat(12)}`,
      details: [`detail-${index + 1}`, "x".repeat(700)].join("\n"),
    })),
  );

  assert.equal(compacted.length, 10);
  assert.match(compacted[0]?.summary ?? "", /Observation 1/);
  assert.equal(compacted[0]?.details?.includes("detail-1"), true);
  assert.equal(compacted[2]?.details, undefined);
  assert.match(compacted[2]?.summary ?? "", /Aged tool output compacted/);
  assert.equal(compacted[8]?.details?.includes("detail-9"), true);
  assert.equal(compacted[9]?.details?.includes("detail-10"), true);
});
