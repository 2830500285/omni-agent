import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteSessionStore } from "../packages/session-store/src/index.ts";

test("session store persists workspaces, threads, and runs", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-store-"));
  let store: SqliteSessionStore | null = null;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();

    const workspace = store.upsertWorkspace("E:/example/repo");
    const agent = store.createAgent({
      name: "primary-agent",
      cwd: "E:/example/repo",
      agentType: "review-specialist",
      defaultRole: "reviewer",
      mode: "bound",
      defaultModelProfileId: "profile-primary",
      contextEngineId: "compact",
      memoryProviderIds: ["builtin-sqlite-memory-provider", "hybrid-memory-provider"],
      instruction: "Prefer concise findings-first reviews.",
      authProfileId: "auth-primary",
      metadata: {
        persona: "default",
      },
    });
    const thread = store.createThread(workspace.id, "Test thread");
    const run = store.createRun({
      threadId: thread.id,
      agentId: agent.id,
      objective: "Inspect repository",
      executionDomain: "workspace",
    });
    store.updateRunExecutionContext({
      runId: run.id,
      sourceRoot: "E:/example/repo",
      executionRoot: "E:/example/repo",
      worktreePath: null,
      worktreeBranch: null,
      sandboxPath: null,
    });
    store.appendMessage({
      threadId: thread.id,
      runId: run.id,
      role: "user",
      text: "Inspect repository",
    });
    store.appendMessage({
      threadId: thread.id,
      runId: run.id,
      role: "assistant",
      text: "Build the repository with npm run build after edits.",
    });
    store.recordToolEvent({
      runId: run.id,
      toolCallId: "call-workspace-info",
      toolName: "workspace_info",
      riskTier: 0,
      status: "ok",
      summary: "Inspected workspace",
      presentation: {
        kind: "read",
        title: "Inspect workspace",
      },
    });
    store.addArtifact({
      runId: run.id,
      kind: "summary",
      path: "E:/artifact.log",
      summary: "Summary artifact",
    });
    const memory = store.addMemory({
      workspaceId: workspace.id,
      agentId: agent.id,
      threadId: thread.id,
      scope: "thread",
      content: "Use npm run build for verification",
      tags: ["build", "verification"],
    });
    const workspaceMemory = store.addMemory({
      workspaceId: workspace.id,
      scope: "workspace",
      content: "Preferred package manager is pnpm for workspace-level tasks",
      tags: ["pnpm", "workspace"],
    });
    const agentWorkspaceMemory = store.addMemory({
      workspaceId: workspace.id,
      agentId: agent.id,
      scope: "workspace",
      content: "Agent-specific workspace preference: keep package scaffolds minimal",
      tags: ["agent", "workspace"],
    });
    const profileFact = store.addProfileFact({
      workspaceId: workspace.id,
      agentId: agent.id,
      sourceRunId: run.id,
      content: "The preferred verification command is npm run build.",
      tags: ["preference", "verification"],
    });
    const directAgentProfileFact = store.addProfileFact({
      workspaceId: workspace.id,
      agentId: agent.id,
      content: "Agent persona prefers minimal scaffold conventions.",
      tags: ["agent", "persona"],
    });
    const threadSummary = store.upsertThreadSummary({
      threadId: thread.id,
      workspaceId: workspace.id,
      lastRunId: run.id,
      summary: "Repository inspection thread focused on build verification.",
      summaryVersion: 2,
      summaryHash: "summary-hash-fixture",
      handoff: {
        activeTask: "Keep build verification intact.",
        pending: ["Run npm run build before closing the thread."],
      },
    });
    const learnedSkill = store.addLearnedSkill({
      workspaceId: workspace.id,
      agentId: agent.id,
      sourceRunId: run.id,
      title: "Verified pattern for package.json",
      problemPattern: "Run the build after changing package scripts",
      guidance: "Inspect package.json first, then run npm run build before reporting success.",
      exampleObjective: "Update the package build flow and verify it",
      changedFiles: ["package.json"],
      tags: ["verified", "build"],
    });
    const directAgentSkill = store.addLearnedSkill({
      workspaceId: workspace.id,
      agentId: agent.id,
      title: "Agent workspace scaffold preference",
      problemPattern: "Reuse the same workspace scaffold conventions for this agent",
      guidance: "Keep scaffolds lean and prefer the agent workspace defaults.",
      changedFiles: ["package.json"],
      tags: ["agent", "workspace"],
    });
    const automation = store.createAutomation({
      workspaceId: workspace.id,
      agentId: agent.id,
      threadId: thread.id,
      title: "Nightly build",
      threadTitle: "Nightly automation",
      task: "Run the build and report failures",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "required",
      verificationCommands: ["npm run build"],
      scheduleKind: "interval",
      intervalSeconds: 300,
    });
    const heartbeatAutomation = store.createAutomation({
      workspaceId: workspace.id,
      agentId: agent.id,
      title: "Heartbeat monitor",
      task: "Check the standing route inbox health",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "best-effort",
      scheduleKind: "heartbeat",
      intervalSeconds: 120,
      heartbeatWindowSeconds: 240,
    });
    const eventAutomation = store.createAutomation({
      workspaceId: workspace.id,
      agentId: agent.id,
      title: "Slack relay",
      task: "Relay inbound alert: {{message}}",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "best-effort",
      scheduleKind: "event",
      triggerEventTypes: ["inbox.received"],
      triggerChannelType: "slack",
      triggerChannelKey: "C12345",
      triggerSenders: ["alice"],
      triggerTextPattern: "inspect",
      deliveryMode: "relay",
      relayTemplate: "Forwarded from {{sender}}: {{message}}",
    });
    const authProfileState = store.recordAuthProfileFailure({
      authProfileId: "auth-primary",
      error: "Synthetic token failure",
      cooldownUntil: "2026-04-27T10:00:00.000Z",
    });
    const route = store.createRoute({
      workspaceId: workspace.id,
      threadId: thread.id,
      title: "Slack triage",
      channelType: "slack",
      channelKey: "C12345",
      adapterType: "filesystem",
      adapterConfig: { outboxDir: "E:/example/outbox" },
      inboundSecret: "route-secret",
    });
    const inbound = store.createInboundMessage({
      routeId: route.id,
      workspaceId: workspace.id,
      threadId: thread.id,
      channelType: "slack",
      channelKey: "C12345",
      channelMessageId: "msg-1",
      sender: "alice",
      text: "please inspect the repo",
      metadata: {
        threadTs: "1712345.000100",
        replyToMessageId: "msg-1",
      },
    });
    const delivery = store.createOutboundDelivery({
      routeId: route.id,
      workspaceId: workspace.id,
      threadId: thread.id,
      runId: run.id,
      channelType: "slack",
      channelKey: "C12345",
      adapterType: "filesystem",
      payload: "Repository inspection complete.",
      status: "queued",
    });
    const pairing = store.createOrRefreshRoutePairing({
      routeId: route.id,
      workspaceId: workspace.id,
      sender: "mallory",
      channelType: "slack",
      channelKey: "C12345",
      code: "PAIR12",
    });
    store.completeRun({
      runId: run.id,
      status: "completed",
      finalResponse: "Done",
      verificationStatus: "skipped",
    });
    const runMetrics = store.upsertRunMetrics({
      runId: run.id,
      modelProfiles: ["mock", "backup"],
      turnCount: 3,
      toolCallCount: 2,
      toolSuccessCount: 2,
      toolFailureCount: 0,
      blockedApprovalCount: 1,
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      startedAt: run.createdAt,
      completedAt: run.updatedAt,
      durationMs: 1500,
      contextEngineId: "compact",
      contextEngineStatus: {
        engineId: "compact",
        promptBudgetTokens: 1400,
      },
    });

    assert.equal(store.getWorkspaceByCwd("E:/example/repo")?.id, workspace.id);
    assert.equal(store.listWorkspaces().length, 1);
    assert.equal(store.getAgent(agent.id)?.id, agent.id);
    assert.equal(store.getAgent(agent.id)?.workspaceId, workspace.id);
    assert.equal(store.getAgent(agent.id)?.agentType, "review-specialist");
    assert.equal(store.getAgent(agent.id)?.defaultRole, "reviewer");
    assert.equal(store.getAgent(agent.id)?.mode, "bound");
    assert.ok(store.getAgent(agent.id)?.stateRoot.includes(agent.id));
    assert.equal(store.getAgent(agent.id)?.defaultModelProfileId, "profile-primary");
    assert.equal(store.getAgent(agent.id)?.contextEngineId, "compact");
    assert.deepEqual(store.getAgent(agent.id)?.memoryProviderIds, ["builtin-sqlite-memory-provider", "hybrid-memory-provider"]);
    assert.equal(store.getAgent(agent.id)?.instruction, "Prefer concise findings-first reviews.");
    assert.equal(store.listAgents({ workspaceId: workspace.id }).at(0)?.id, agent.id);
    assert.equal(
      store.updateAgent({
        agentId: agent.id,
        status: "paused",
        mode: "locked_down",
        defaultRole: "verifier",
        contextEngineId: "delegation",
        memoryProviderIds: ["builtin-sqlite-memory-provider"],
        instruction: "Return strict verdicts.",
        metadata: { persona: "locked-down" },
      }).status,
      "paused",
    );
    assert.equal(store.getAgent(agent.id)?.mode, "locked_down");
    assert.equal(store.getAgent(agent.id)?.defaultRole, "verifier");
    assert.equal(store.getAgent(agent.id)?.contextEngineId, "delegation");
    assert.deepEqual(store.getAgent(agent.id)?.memoryProviderIds, ["builtin-sqlite-memory-provider"]);
    assert.equal(store.getAgent(agent.id)?.instruction, "Return strict verdicts.");
    assert.equal(store.getAgent(agent.id)?.metadata.persona, "locked-down");
    assert.equal(authProfileState.status, "cooldown");
    assert.equal(authProfileState.successCount, 0);
    assert.equal(authProfileState.failureCount, 1);
    assert.ok(authProfileState.lastFailureAt);
    assert.equal(store.getAuthProfileState("auth-primary")?.lastError, "Synthetic token failure");
    assert.equal(store.listAuthProfileStates().at(0)?.authProfileId, "auth-primary");
    const authProfileSuccess = store.recordAuthProfileSuccess("auth-primary");
    assert.equal(authProfileSuccess.status, "healthy");
    assert.equal(authProfileSuccess.successCount, 1);
    assert.equal(authProfileSuccess.failureCount, 1);
    assert.equal(authProfileSuccess.consecutiveFailures, 0);
    assert.ok(authProfileSuccess.lastSuccessAt);
    assert.equal(authProfileSuccess.lastError, null);
    assert.equal(store.getThread(thread.id)?.title, "Test thread");
    assert.equal(store.findRecentThread(workspace.id)?.id, thread.id);
    assert.equal(store.listThreads(workspace.id).length, 1);
    assert.equal(store.listRuns(thread.id).length, 1);
    assert.equal(store.getRun(run.id)?.agentId, agent.id);
    assert.equal(store.listAgentRuns(agent.id).at(0)?.id, run.id);
    assert.equal(store.listAgentThreads(agent.id).at(0)?.id, thread.id);
    assert.equal(store.listAgentSubagentJobs(agent.id).length, 0);
    store.upsertSubagentJob({
      id: "lease-child-a",
      workspaceId: workspace.id,
      parentThreadId: thread.id,
      parentRunId: run.id,
      objective: "Hold a lease",
      sessionMode: "thread",
      role: "worker",
      mode: "foreground",
      outcomeVisibility: "context",
      authority: "leaf",
      status: "queued",
      rootJobId: "lease-child-a",
      depth: 1,
      maxDepth: 2,
      maxConcurrentChildren: 2,
      childJobIds: [],
      executionDomain: "workspace",
      budget: {
        maxIterations: 2,
        timeoutMs: 1_000,
        maxRetries: 0,
      },
      attempts: 0,
      createdAt: run.createdAt,
      queuedAt: run.createdAt,
      blockedReason: "Waiting for file lease on src/shared.ts held by competing-child.",
      blockedByJobIds: ["competing-child"],
      blockedPaths: ["src/shared.ts"],
      updatedAt: run.createdAt,
      messages: [],
      threadId: thread.id,
    });
    store.acquireFileLeases({
      workspaceId: workspace.id,
      ownerJobId: "competing-child",
      ownerThreadId: thread.id,
      ownerRunId: run.id,
      paths: ["src/shared.ts"],
    });
    const persistedSubagent = store.getSubagentJob("lease-child-a");
    assert.equal(persistedSubagent?.blockedReason, "Waiting for file lease on src/shared.ts held by competing-child.");
    assert.deepEqual(persistedSubagent?.blockedByJobIds, ["competing-child"]);
    assert.deepEqual(persistedSubagent?.blockedPaths, ["src/shared.ts"]);
    assert.deepEqual(
      store.findFileLeaseConflicts({
        workspaceId: workspace.id,
        ownerJobId: "lease-child-a",
        paths: ["src/shared.ts"],
      }).map((entry) => entry.ownerJobId),
      ["competing-child"],
    );
    assert.equal(store.getRunMetrics(run.id)?.runId, runMetrics.runId);
    assert.equal(store.getRunMetrics(run.id)?.contextEngineId, "compact");
    assert.equal(store.getRunMetrics(run.id)?.contextEngineStatus?.engineId, "compact");
    assert.equal(store.summarizeWorkspaceUsage(workspace.id)?.runCount, 1);
    assert.equal(store.summarizeWorkspaceUsage(workspace.id)?.threadCount, 1);
    assert.equal(store.summarizeWorkspaceUsage(workspace.id)?.workspaceId, workspace.id);
    assert.equal(store.summarizeWorkspaceUsage(workspace.id)?.totalTokens, 165);
    assert.deepEqual(store.summarizeWorkspaceUsage(workspace.id)?.modelProfiles, ["backup", "mock"]);
    assert.equal(store.summarizeGlobalUsage().workspaceCount, 1);
    assert.equal(store.summarizeGlobalUsage().threadCount, 1);
    assert.equal(store.summarizeGlobalUsage().runCount, 1);
    assert.deepEqual(store.summarizeGlobalUsage().modelProfiles, ["backup", "mock"]);
    assert.equal(store.summarizeAgentUsage(agent.id)?.agentId, agent.id);
    assert.equal(store.summarizeAgentUsage(agent.id)?.workspaceId, workspace.id);
    assert.equal(store.summarizeAgentUsage(agent.id)?.threadCount, 1);
    assert.equal(store.summarizeAgentUsage(agent.id)?.runCount, 1);
    assert.equal(store.summarizeAgentUsage(agent.id)?.totalTokens, 165);
    assert.equal(store.summarizeThreadUsage(thread.id)?.totalTokens, 165);
    assert.ok(store.summarizeThreadUsage(thread.id)?.modelProfiles.includes("mock"));
    assert.equal(store.listThreadMessages(thread.id).length, 2);
    assert.equal(store.getRun(run.id)?.executionRoot, "E:\\example\\repo");
    const toolEvents = store.listRunToolEvents(run.id);
    assert.equal(toolEvents.length, 1);
    assert.equal(toolEvents[0]?.toolCallId, "call-workspace-info");
    assert.deepEqual(toolEvents[0]?.presentation, {
      kind: "read",
      title: "Inspect workspace",
    });
    assert.equal(store.listRunArtifacts(run.id).length, 1);
    assert.ok(store.searchMemories({ workspaceId: workspace.id, query: "build" }).some((entry) => entry.id === memory.id));
    assert.ok(
      store.searchMemories({ workspaceId: workspace.id, query: "verification build policy" }).some(
        (entry) => entry.id === memory.id,
      ),
    );
    assert.ok(
      store.listMemories({ workspaceId: workspace.id, threadId: thread.id }).some((entry) => entry.id === workspaceMemory.id),
    );
    assert.ok(
      store.searchMemories({ workspaceId: workspace.id, threadId: thread.id, query: "workspace pnpm" }).some(
        (entry) => entry.id === workspaceMemory.id,
      ),
    );
    assert.ok(store.listAgentMemories({ agentId: agent.id }).some((entry) => entry.id === memory.id));
    assert.ok(store.listAgentMemories({ agentId: agent.id }).some((entry) => entry.id === agentWorkspaceMemory.id));
    assert.ok(!store.listAgentMemories({ agentId: agent.id }).some((entry) => entry.id === workspaceMemory.id));
    assert.ok(store.listAgentLearnedSkills({ agentId: agent.id }).some((entry) => entry.id === learnedSkill.id));
    assert.ok(store.listAgentLearnedSkills({ agentId: agent.id }).some((entry) => entry.id === directAgentSkill.id));
    assert.equal(
      store.listAgentLearnedSkills({ agentId: agent.id, query: "package scripts" }).at(0)?.id,
      learnedSkill.id,
    );
    assert.ok(
      store.searchMemories({ workspaceId: workspace.id, agentId: agent.id, query: "scaffold minimal" }).some(
        (entry) => entry.id === agentWorkspaceMemory.id,
      ),
    );
    assert.ok(
      store.searchLearnedSkills({ workspaceId: workspace.id, agentId: agent.id, query: "workspace scaffold" }).some(
        (entry) => entry.id === directAgentSkill.id,
      ),
    );
    assert.equal(store.searchProfileFacts({ workspaceId: workspace.id, query: "verification" }).at(0)?.id, profileFact.id);
    assert.equal(
      store.searchProfileFacts({ workspaceId: workspace.id, query: "preferred verification build" }).at(0)?.id,
      profileFact.id,
    );
    assert.ok(store.listAgentProfileFacts({ agentId: agent.id }).some((entry) => entry.id === profileFact.id));
    assert.ok(store.listAgentProfileFacts({ agentId: agent.id }).some((entry) => entry.id === directAgentProfileFact.id));
    assert.ok(
      store.searchProfileFacts({ workspaceId: workspace.id, agentId: agent.id, query: "minimal scaffold" }).some(
        (entry) => entry.id === directAgentProfileFact.id,
      ),
    );
    assert.equal(store.getThreadSummary(thread.id)?.threadId, threadSummary.threadId);
    assert.equal(store.getThreadSummary(thread.id)?.summaryVersion, 2);
    assert.equal(store.getThreadSummary(thread.id)?.summaryHash, "summary-hash-fixture");
    assert.equal(store.getThreadSummary(thread.id)?.handoff?.activeTask, "Keep build verification intact.");
    assert.equal(store.listThreadSummaries({ workspaceId: workspace.id }).at(0)?.threadId, thread.id);
    assert.ok(store.searchSessions({ workspaceId: workspace.id, query: "npm run build" }).some((entry) => entry.threadId === thread.id));
    assert.ok(
      store.searchSessions({ workspaceId: workspace.id, query: "repository build summarize" }).some(
        (entry) => entry.threadId === thread.id,
      ),
    );
    assert.ok(
      store.searchAgentSessions({ agentId: agent.id, query: "npm run build" }).some((entry) => entry.threadId === thread.id),
    );
    assert.equal(store.getLearnedSkill(learnedSkill.id)?.id, learnedSkill.id);
    assert.equal(store.getLearnedSkill(learnedSkill.id)?.sourceType, "learned");
    assert.ok(store.listLearnedSkills({ workspaceId: workspace.id }).some((entry) => entry.id === learnedSkill.id));
    assert.equal(
      store.searchLearnedSkills({ workspaceId: workspace.id, query: "package scripts" }).at(0)?.id,
      learnedSkill.id,
    );
    assert.equal(
      store.searchLearnedSkills({ workspaceId: workspace.id, query: "summarize package build scripts" }).at(0)?.id,
      learnedSkill.id,
    );
    assert.equal(store.touchLearnedSkill(learnedSkill.id).useCount, 1);
    assert.equal(store.recordLearnedSkillOutcome({ skillId: learnedSkill.id, succeeded: true }).successCount, 1);
    assert.equal(store.recordLearnedSkillOutcome({ skillId: learnedSkill.id, succeeded: false }).lifecycleState, "needs_reverify");
    assert.equal(store.recordLearnedSkillOutcome({ skillId: learnedSkill.id, succeeded: false }).failureCount, 2);
    assert.equal(store.recordLearnedSkillOutcome({ skillId: learnedSkill.id, succeeded: false }).lifecycleState, "disabled");
    assert.equal(
      store.updateLearnedSkillLifecycle({
        skillId: learnedSkill.id,
        lifecycleState: "active",
        lifecycleReason: null,
        materializedSkillPath: "skills/learned/package-build/SKILL.md",
      }).materializedSkillPath,
      "skills/learned/package-build/SKILL.md",
    );
    assert.equal(store.promoteLearnedSkill({ skillId: learnedSkill.id, target: "workspace" }).sourceType, "workspace");
    assert.equal(store.getLearnedSkill(learnedSkill.id)?.promotedFromSourceType, "learned");
    assert.equal(store.listLearnedSkills({ workspaceId: workspace.id, sourceType: "workspace" }).at(0)?.id, learnedSkill.id);
    assert.equal(store.recordLearnedSkillOutcome({ skillId: learnedSkill.id, succeeded: true }).lifecycleState, "active");
    assert.ok(store.listAutomations({ workspaceId: workspace.id }).some((entry) => entry.id === automation.id));
    assert.ok(store.listAutomations({ agentId: agent.id }).some((entry) => entry.id === automation.id));
    assert.equal(store.getAutomation(automation.id)?.title, "Nightly build");
    assert.equal(store.getAutomation(automation.id)?.agentId, agent.id);
    assert.equal(store.getAutomation(automation.id)?.deliveryState, "idle");
    assert.equal(store.getAutomation(automation.id)?.failureCount, 0);
    assert.equal(store.getAutomation(automation.id)?.maxConsecutiveFailures, 3);
    assert.ok(store.listDueAutomations("9999-01-01T00:00:00.000Z").some((entry) => entry.id === automation.id));
    assert.ok(store.listDueAutomations("9999-01-01T00:00:00.000Z").some((entry) => entry.id === heartbeatAutomation.id));
    assert.equal(store.getAutomation(heartbeatAutomation.id)?.scheduleKind, "heartbeat");
    assert.equal(store.getAutomation(heartbeatAutomation.id)?.heartbeatWindowSeconds, 240);
    assert.equal(store.getAutomation(eventAutomation.id)?.scheduleKind, "event");
    assert.equal(store.getAutomation(eventAutomation.id)?.deliveryMode, "relay");
    assert.equal(store.getAutomation(eventAutomation.id)?.triggerChannelType, "slack");
    assert.deepEqual(store.getAutomation(eventAutomation.id)?.triggerSenders, ["alice"]);
    assert.equal(store.listAutomations({ workspaceId: workspace.id, scheduleKind: "event" }).at(0)?.id, eventAutomation.id);
    assert.equal(
      store.listTriggeredAutomations({
        eventType: "inbox.received",
        workspaceId: workspace.id,
        routeId: route.id,
        channelType: "slack",
        channelKey: "C12345",
        sender: "alice",
        text: "please inspect the repo",
      }).at(0)?.id,
      eventAutomation.id,
    );
    assert.equal(
      store.listTriggeredAutomations({
        eventType: "inbox.received",
        workspaceId: workspace.id,
        routeId: route.id,
        channelType: "slack",
        channelKey: "C12345",
        sender: "bob",
        text: "please inspect the repo",
      }).length,
      0,
    );
    assert.equal(store.findRouteByChannel("slack", "C12345")?.id, route.id);
    assert.equal(store.listRoutes({ workspaceId: workspace.id }).at(0)?.id, route.id);
    assert.equal(store.getRoute(route.id)?.adapterType, "filesystem");
    assert.deepEqual(store.getRoute(route.id)?.adapterConfig, { outboxDir: "E:/example/outbox" });
    assert.equal(store.getRoute(route.id)?.inboundSecret, "route-secret");
    assert.equal(store.getInboundMessage(inbound.id)?.id, inbound.id);
    assert.equal(store.getInboundMessage(inbound.id)?.metadata.threadTs, "1712345.000100");
    assert.equal(store.listInboundMessages({ workspaceId: workspace.id }).at(0)?.id, inbound.id);
    assert.equal(store.getOutboundDelivery(delivery.id)?.id, delivery.id);
    assert.equal(store.listOutboundDeliveries({ workspaceId: workspace.id }).at(0)?.id, delivery.id);
    assert.equal(store.getRoutePairing(pairing.id)?.id, pairing.id);
    assert.equal(store.getRoutePairingByCode("PAIR12")?.id, pairing.id);
    assert.equal(store.findPendingRoutePairing(route.id, "mallory")?.id, pairing.id);
    assert.equal(store.listRoutePairings({ workspaceId: workspace.id }).at(0)?.id, pairing.id);
    assert.equal(
      store.updateRoute({
        routeId: route.id,
        status: "paused",
      }).status,
      "paused",
    );
    assert.equal(
      store.updateInboundMessage({
        messageId: inbound.id,
        status: "processed",
        runId: run.id,
      }).status,
      "processed",
    );
    assert.equal(
      store.updateOutboundDelivery({
        deliveryId: delivery.id,
        status: "delivered",
        responseSummary: "Delivered to filesystem outbox.",
      }).status,
      "delivered",
    );
    assert.equal(
      store.updateRoutePairing({
        pairingId: pairing.id,
        status: "approved",
        approvedAt: run.updatedAt,
      }).status,
      "approved",
    );
    assert.equal(store.updateAutomationState({
      automationId: automation.id,
      status: "paused",
      lastRunId: run.id,
      nextRunAt: null,
    }).status, "paused");
    assert.equal(store.deleteAutomation(automation.id), true);
    assert.equal(store.deleteLearnedSkill(learnedSkill.id)?.id, learnedSkill.id);
    assert.equal(store.getLearnedSkill(learnedSkill.id), null);
    assert.equal(store.listLearnedSkills({ workspaceId: workspace.id }).some((entry) => entry.id === learnedSkill.id), false);
    assert.ok(store.listLearnedSkills({ workspaceId: workspace.id }).some((entry) => entry.id === directAgentSkill.id));
    assert.equal(
      store.searchLearnedSkills({ workspaceId: workspace.id, query: "package scripts verification" }).some(
        (entry) => entry.id === learnedSkill.id,
      ),
      false,
    );
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session store redacts sensitive facts, summaries, tags, and artifact summaries", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-store-redaction-"));
  let store: SqliteSessionStore | null = null;
  const secret = `ghp_${"a".repeat(36)}`;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/redaction");
    const thread = store.createThread(workspace.id, "Redaction thread");
    const run = store.createRun({
      threadId: thread.id,
      objective: "Inspect sensitive persistence",
      executionDomain: "workspace",
    });

    const artifact = store.addArtifact({
      runId: run.id,
      kind: "summary",
      path: "E:/artifact.log",
      summary: `artifact token ${secret}`,
    });
    const profileFact = store.addProfileFact({
      workspaceId: workspace.id,
      sourceRunId: run.id,
      content: `profile token ${secret}`,
      tags: [`tag-${secret}`],
    });
    const threadSummary = store.upsertThreadSummary({
      threadId: thread.id,
      workspaceId: workspace.id,
      summary: `summary token ${secret}`,
      handoff: {
        activeTask: `handoff token ${secret}`,
      },
    });
    const auditLog = store.addAuditLog({
      workspaceId: workspace.id,
      actorType: "test",
      action: "redaction.audit",
      targetType: "fixture",
      summary: `audit token ${secret}`,
      metadata: {
        payload: `api_key=${"b".repeat(24)}`,
        adapterConfig: {
          botToken: `xoxb-${"c".repeat(24)}`,
          webhookUrl: "https://hooks.example/services/raw-secret",
          baseUrl: "https://provider.example/api?token=base-url-secret",
          endpointUrl: "https://endpoint.example/push",
          headers: {
            "x-api-key": "header-api-key-secret",
          },
        },
      },
    });

    assert.equal(JSON.stringify(artifact).includes(secret), false);
    assert.match(artifact.summary, /\[redacted\]/);
    assert.equal(JSON.stringify(profileFact).includes(secret), false);
    assert.match(profileFact.content, /\[redacted\]/);
    assert.match(JSON.stringify(profileFact.tags), /\[redacted\]/);
    assert.equal(JSON.stringify(threadSummary).includes(secret), false);
    assert.match(threadSummary.summary, /\[redacted\]/);
    assert.match(JSON.stringify(threadSummary.handoff), /\[redacted\]/);
    assert.equal(JSON.stringify(auditLog).includes(secret), false);
    assert.equal(JSON.stringify(auditLog).includes("raw-secret"), false);
    assert.equal(JSON.stringify(auditLog).includes("base-url-secret"), false);
    assert.equal(JSON.stringify(auditLog).includes("endpoint.example"), false);
    assert.equal(JSON.stringify(auditLog).includes("header-api-key-secret"), false);
    assert.equal(JSON.stringify(store.listAuditLogs({ action: "redaction.audit" })).includes("raw-secret"), false);
    assert.match(JSON.stringify(auditLog.metadata), /\[redacted\]/);
    assert.equal(JSON.stringify(store.searchProfileFacts({ workspaceId: workspace.id, query: "profile", limit: 5 })).includes(secret), false);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session store returns JSON-safe tool presentations", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-store-json-safe-"));
  let store: SqliteSessionStore | null = null;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/repo");
    const thread = store.createThread(workspace.id, "JSON-safe presentation thread");
    const run = store.createRun({
      threadId: thread.id,
      objective: "Persist a non-json-native presentation",
      executionDomain: "workspace",
    });
    const presentation: Record<string, unknown> = {
      kind: "read",
      title: "Non JSON native",
      count: 1n,
      apiKey: `sk-proj-${"g".repeat(32)}`,
      text: `token=${"h".repeat(32)}`,
    };
    presentation.self = presentation;

    const record = store.recordToolEvent({
      runId: run.id,
      toolCallId: "call-json-safe",
      toolName: "custom_tool",
      riskTier: 0,
      status: "ok",
      summary: "Recorded custom tool",
      outputPreview: `Authorization: Bearer eyJ${"a".repeat(16)}.eyJ${"b".repeat(16)}.${"c".repeat(16)}`,
      presentation,
    });

    assert.doesNotThrow(() => JSON.stringify(record));
    assert.deepEqual(record.presentation, {
      kind: "read",
      title: "Non JSON native",
      count: "1n",
      apiKey: "[redacted]",
      text: "[redacted]",
      self: "[circular]",
    });
    assert.equal(record.outputPreview?.includes("Bearer eyJ"), false);
    assert.deepEqual(store.listRunToolEvents(run.id)[0]?.presentation, record.presentation);

    const artifact = store.addArtifactContent({
      runId: run.id,
      kind: "secret-output",
      content: `token=${"z".repeat(32)}`,
      summary: `secret=${"y".repeat(32)}`,
      extension: "log",
    });
    assert.equal(readFileSync(artifact.path, "utf8").includes("z".repeat(32)), false);
    assert.equal(artifact.summary.includes("y".repeat(32)), false);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session store persists agent runs as structured artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-store-run-artifact-"));
  let store: SqliteSessionStore | null = null;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/run-artifact");
    const thread = store.createThread(workspace.id, "Run artifact thread");
    const run = store.createRun({
      threadId: thread.id,
      objective: "Patch parser and verify tests",
      executionDomain: "workspace",
    });
    store.updateRunExecutionContext({
      runId: run.id,
      sourceRoot: "E:/example/run-artifact",
      executionRoot: "E:/example/run-artifact",
      worktreePath: null,
      worktreeBranch: null,
      sandboxPath: null,
    });
    store.recordToolEvent({
      runId: run.id,
      toolCallId: "call-test",
      toolName: "run_command",
      riskTier: 1,
      status: "ok",
      summary: "Ran targeted parser tests",
      outputPreview: `token=${"a".repeat(32)}`,
    });
    store.completeRun({
      runId: run.id,
      status: "completed",
      finalResponse: "Parser patch completed.",
      verificationStatus: "passed",
    });

    const artifact = store.addAgentRunArtifact({
      runId: run.id,
      taskContract: {
        successCriteria: ["parser tests pass"],
        constraints: ["only touch parser files"],
      },
      approvals: [
        {
          toolName: "run_command",
          decision: "allow",
          riskTier: 1,
          approvalClass: "exec_capable",
          summary: "Allowed targeted verification.",
        },
      ],
      diff: {
        changedFiles: ["src/parser.ts"],
        summary: "Adjusted whitespace parsing.",
      },
      verification: {
        commands: ["npm test -- tests/parser.test.ts"],
        summary: "Targeted parser tests passed.",
      },
      summary: {
        notes: ["No follow-up migration needed."],
      },
    });

    const persistedArtifacts = store.listRunArtifacts(run.id);
    assert.equal(persistedArtifacts.length, 1);
    assert.equal(persistedArtifacts[0]?.kind, "agent-run");

    const payload = JSON.parse(readFileSync(artifact.path, "utf8")) as {
      schemaVersion?: number;
      kind?: string;
      runId?: string;
      taskContract?: { objective?: string; successCriteria?: string[]; constraints?: string[] };
      toolTrace?: Array<{ toolName?: string; outputPreview?: string }>;
      approvals?: Array<{ decision?: string; approvalClass?: string }>;
      diff?: { changedFiles?: string[]; summary?: string };
      verification?: { status?: string; commands?: string[] };
      summary?: { finalResponse?: string; notes?: string[] };
    };
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.kind, "agent-run");
    assert.equal(payload.runId, run.id);
    assert.equal(payload.taskContract?.objective, "Patch parser and verify tests");
    assert.deepEqual(payload.taskContract?.successCriteria, ["parser tests pass"]);
    assert.deepEqual(payload.taskContract?.constraints, ["only touch parser files"]);
    assert.equal(payload.toolTrace?.[0]?.toolName, "run_command");
    assert.equal(payload.toolTrace?.[0]?.outputPreview?.includes("a".repeat(32)), false);
    assert.equal(payload.approvals?.[0]?.decision, "allow");
    assert.equal(payload.approvals?.[0]?.approvalClass, "exec_capable");
    assert.deepEqual(payload.diff?.changedFiles, ["src/parser.ts"]);
    assert.equal(payload.diff?.summary, "Adjusted whitespace parsing.");
    assert.equal(payload.verification?.status, "passed");
    assert.deepEqual(payload.verification?.commands, ["npm test -- tests/parser.test.ts"]);
    assert.equal(payload.summary?.finalResponse, "Parser patch completed.");
    assert.deepEqual(payload.summary?.notes, ["No follow-up migration needed."]);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session store persists ACP session bindings and resets thread state", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-store-acp-binding-"));
  let store: SqliteSessionStore | null = null;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/acp-binding-store");
    const thread = store.createThread(workspace.id, "Persisted ACP binding");
    store.upsertThreadSummary({
      threadId: thread.id,
      workspaceId: workspace.id,
      summary: "Thread state that reset should clear.",
    });
    const binding = store.bindAcpSession({
      threadId: thread.id,
      channelType: "slack",
      channelKey: "C98765",
      conversationId: "1720000.000100",
    });

    assert.equal(binding.threadId, thread.id);
    assert.equal(store.getAcpSessionBinding(thread.id)?.conversationId, "1720000.000100");

    store.close();
    store = new SqliteSessionStore(root);
    store.initialize();
    assert.equal(
      store.findAcpSessionBinding({
        channelType: "slack",
        channelKey: "C98765",
        conversationId: "1720000.000100",
      })?.threadId,
      thread.id,
    );

    const reset = store.resetAcpSessionState(thread.id);
    assert.equal(reset.bindingCleared, true);
    assert.equal(reset.threadSummaryCleared, true);
    assert.equal(store.getAcpSessionBinding(thread.id), null);
    assert.equal(store.getThreadSummary(thread.id), null);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session store returns recent thread history in chronological order and prunes older messages", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-store-history-"));
  let store: SqliteSessionStore | null = null;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();

    const workspace = store.upsertWorkspace("E:/example/recent-history");
    const thread = store.createThread(workspace.id, "Recent history");
    const messages = [
      store.appendMessage({ threadId: thread.id, runId: null, role: "user", text: "message-1" }),
      store.appendMessage({ threadId: thread.id, runId: null, role: "assistant", text: "message-2" }),
      store.appendMessage({ threadId: thread.id, runId: null, role: "user", text: "message-3" }),
      store.appendMessage({ threadId: thread.id, runId: null, role: "assistant", text: "message-4" }),
      store.appendMessage({ threadId: thread.id, runId: null, role: "user", text: "message-5" }),
    ];

    assert.deepEqual(
      store.listThreadMessages(thread.id, 3).map((message) => message.text),
      ["message-3", "message-4", "message-5"],
    );
    assert.equal(store.countThreadMessages(thread.id), 5);

    const prunedCount = store.pruneThreadMessages(thread.id, messages.slice(-2).map((message) => message.id));
    assert.equal(prunedCount, 3);
    assert.equal(store.countThreadMessages(thread.id), 2);
    assert.deepEqual(
      store.listAllThreadMessages(thread.id).map((message) => message.text),
      ["message-4", "message-5"],
    );
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session store search falls back cleanly for unicode and non-phrase queries", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-store-search-"));
  let store: SqliteSessionStore | null = null;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();

    const workspace = store.upsertWorkspace("E:/example/unicode-repo");
    const thread = store.createThread(workspace.id, "中文检索线程");
    const run = store.createRun({
      threadId: thread.id,
      objective: "验证中文检索",
      executionDomain: "workspace",
    });

    const memory = store.addMemory({
      workspaceId: workspace.id,
      threadId: thread.id,
      scope: "thread",
      content: "请优先运行构建验证，然后再汇报结果。",
      tags: ["构建", "验证"],
    });
    const profileFact = store.addProfileFact({
      workspaceId: workspace.id,
      sourceRunId: run.id,
      content: "默认回复语言为中文，并保留关键构建日志。",
      tags: ["语言", "构建"],
    });
    store.appendMessage({
      threadId: thread.id,
      runId: run.id,
      role: "assistant",
      text: "如果需要修改 parser.ts，请先运行构建，再汇报中文摘要。",
    });

    assert.equal(store.searchMemories({ workspaceId: workspace.id, query: "构建" }).at(0)?.id, memory.id);
    assert.equal(store.searchProfileFacts({ workspaceId: workspace.id, query: "中文 构建" }).at(0)?.id, profileFact.id);
    assert.ok(
      store.searchSessions({ workspaceId: workspace.id, query: "构建 中文" }).some((entry) =>
        entry.text.includes("中文摘要") || entry.text.includes("构建"),
      ),
    );
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("session store persists profile evaluations, audit logs, and applies skill maintenance", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-store-maintenance-"));
  let store: SqliteSessionStore | null = null;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/maintenance");
    const agent = store.createAgent({
      name: "maintenance-agent",
      cwd: "E:/example/maintenance",
      agentType: "self-improving-agent",
      defaultRole: "supervisor",
      mode: "shared",
    });
    const thread = store.createThread(workspace.id, "Maintenance thread");

    const stableSkill = store.addLearnedSkill({
      workspaceId: workspace.id,
      agentId: agent.id,
      title: "Stable cleanup skill",
      problemPattern: "Repeated successful cleanup tasks",
      guidance: "Use the verified cleanup sequence.",
      verificationStatus: "passed",
    });
    store.recordLearnedSkillOutcome({ skillId: stableSkill.id, succeeded: true });
    store.recordLearnedSkillOutcome({ skillId: stableSkill.id, succeeded: true });

    const reverifySkill = store.addLearnedSkill({
      workspaceId: workspace.id,
      agentId: agent.id,
      title: "Needs recheck skill",
      problemPattern: "A skill with uncertain verification",
      guidance: "Re-check this before reuse.",
      verificationStatus: "failed",
    });

    const automation = store.createAutomation({
      workspaceId: workspace.id,
      agentId: agent.id,
      threadId: thread.id,
      title: "Skill maintenance",
      task: "Maintain learned skills",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "best-effort",
      scheduleKind: "maintenance",
      intervalSeconds: 60,
    });

    const evaluation = store.createProfileEvaluation({
      profileId: "hermes-self-improver",
      workspaceId: workspace.id,
      agentId: agent.id,
      suiteTitle: "Capability scorecard",
      categories: ["memory_recall", "verification_repair"],
      metrics: { completionRate: 1, memoryHitRate: 1 },
      scores: { overall: 0.91 },
      passed: true,
      summary: "Profile passed maintenance scorecard.",
    });
    const audit = store.addAuditLog({
      workspaceId: workspace.id,
      agentId: agent.id,
      actorType: "test",
      actorId: "suite",
      action: "test.audit",
      targetType: "profile",
      targetId: "hermes-self-improver",
      riskLevel: "medium",
      summary: "Synthetic audit event.",
      metadata: { fixture: true },
    });

    const application = store.applyLearnedSkillMaintenance({
      workspaceId: workspace.id,
      agentId: agent.id,
      materializePathForSkill: (skill) => `skills/${skill.id}.md`,
    });

    assert.equal(store.getAutomation(automation.id)?.scheduleKind, "maintenance");
    assert.ok(store.listDueAutomations("9999-01-01T00:00:00.000Z").some((entry) => entry.id === automation.id));
    assert.equal(store.listProfileEvaluations({ profileId: "hermes-self-improver" }).at(0)?.id, evaluation.id);
    assert.equal(store.listProfileEvaluations({ agentId: agent.id }).at(0)?.summary, "Profile passed maintenance scorecard.");
    assert.equal(store.listAuditLogs({ action: "test.audit" }).at(0)?.id, audit.id);
    assert.equal(application.promotedSkills.length, 1);
    assert.equal(application.reverifySkills.length, 1);
    assert.equal(application.promotedSkills[0]?.sourceType, "workspace");
    assert.equal(store.getLearnedSkill(stableSkill.id)?.materializedSkillPath, `skills/${stableSkill.id}.md`);
    assert.equal(store.getLearnedSkill(reverifySkill.id)?.lifecycleState, "needs_reverify");
    assert.ok(store.listAgentProfileFacts({ agentId: agent.id }).some((entry) => entry.content.includes("Self-learning maintenance applied")));
    assert.ok(store.listAuditLogs({ action: "skills.maintenance.apply" }).length >= 1);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
