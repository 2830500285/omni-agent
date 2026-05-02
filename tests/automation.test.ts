import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AutomationScheduler } from "../packages/automation/src/index.ts";
import { computeAutomationNextRunAt, SqliteSessionStore } from "../packages/session-store/src/index.ts";

test("automation scheduler moves failing interval automations through cooldown into dead letter", async () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-automation-dead-letter-"));
  const events: string[] = [];
  let store: SqliteSessionStore | null = null;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/automation-dead-letter");
    const automation = store.createAutomation({
      workspaceId: workspace.id,
      title: "Flaky interval automation",
      task: "Always fail",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "best-effort",
      scheduleKind: "interval",
      intervalSeconds: 60,
      retryDelaySeconds: 15,
      maxConsecutiveFailures: 2,
    });
    store.updateAutomationState({
      automationId: automation.id,
      nextRunAt: "2000-01-01T00:00:00.000Z",
    });

    const scheduler = new AutomationScheduler(store, {
      onAutomationRun: async () => {
        throw new Error("synthetic scheduler failure");
      },
      eventHandler: async (event) => {
        events.push(event.type);
      },
    });

    await scheduler.poll();
    const firstFailure = await waitForAutomationState(store, automation.id, (entry) => entry.deliveryState === "cooldown");
    assert.equal(firstFailure?.deliveryState, "cooldown");
    assert.equal(firstFailure?.failureCount, 1);
    assert.equal(firstFailure?.consecutiveFailures, 1);
    assert.equal(firstFailure?.lastError, "synthetic scheduler failure");
    assert.ok(firstFailure?.cooldownUntil);
    assert.equal(firstFailure?.deadLetteredAt, null);

    store.updateAutomationState({
      automationId: automation.id,
      nextRunAt: "2000-01-01T00:00:00.000Z",
      cooldownUntil: "2000-01-01T00:00:00.000Z",
    });

    await scheduler.poll();
    const deadLettered = await waitForAutomationState(store, automation.id, (entry) => entry.deliveryState === "dead_letter");
    assert.equal(deadLettered?.deliveryState, "dead_letter");
    assert.equal(deadLettered?.failureCount, 2);
    assert.equal(deadLettered?.consecutiveFailures, 2);
    assert.ok(deadLettered?.deadLetteredAt);
    assert.equal(deadLettered?.nextRunAt, null);
    assert.deepEqual(events, [
      "automation.started",
      "automation.cooldown",
      "automation.started",
      "automation.dead_lettered",
    ]);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("automation scheduler resets failure state after a successful retry", async () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-automation-recovery-"));
  let store: SqliteSessionStore | null = null;
  let attempts = 0;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/automation-recovery");
    const automation = store.createAutomation({
      workspaceId: workspace.id,
      title: "Recovering automation",
      task: "Fail once then recover",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "best-effort",
      scheduleKind: "interval",
      intervalSeconds: 60,
      retryDelaySeconds: 10,
      maxConsecutiveFailures: 3,
    });
    store.updateAutomationState({
      automationId: automation.id,
      nextRunAt: "2000-01-01T00:00:00.000Z",
    });

    const scheduler = new AutomationScheduler(store, {
      onAutomationRun: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("first failure");
        }
        return {
          runId: "run-recovered",
          summary: "Recovered run",
        };
      },
    });

    await scheduler.poll();
    const firstFailure = await waitForAutomationState(store, automation.id, (entry) => entry.deliveryState === "cooldown");
    assert.equal(firstFailure?.deliveryState, "cooldown");
    assert.equal(firstFailure?.failureCount, 1);
    assert.equal(firstFailure?.consecutiveFailures, 1);

    store.updateAutomationState({
      automationId: automation.id,
      nextRunAt: "2000-01-01T00:00:00.000Z",
      cooldownUntil: "2000-01-01T00:00:00.000Z",
    });

    await scheduler.poll();
    const recovered = await waitForAutomationState(store, automation.id, (entry) => entry.deliveryState === "idle" && entry.lastRunId === "run-recovered");
    assert.equal(recovered?.deliveryState, "idle");
    assert.equal(recovered?.failureCount, 1);
    assert.equal(recovered?.consecutiveFailures, 0);
    assert.equal(recovered?.lastError, null);
    assert.equal(recovered?.deadLetteredAt, null);
    assert.equal(recovered?.lastRunId, "run-recovered");
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("automation scheduler dispatches event automations and advances heartbeat automations", async () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-automation-event-heartbeat-"));
  let store: SqliteSessionStore | null = null;
  const triggered: string[] = [];

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/automation-events");
    const eventAutomation = store.createAutomation({
      workspaceId: workspace.id,
      title: "Relay inbound alerts",
      task: "Relay alert {{message}}",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "best-effort",
      scheduleKind: "event",
      triggerEventTypes: ["inbox.received"],
      triggerChannelType: "slack",
      triggerChannelKey: "C-trigger",
      triggerSenders: ["alice"],
      triggerTextPattern: "alert",
      deliveryMode: "relay",
      relayTemplate: "From {{sender}}: {{message}}",
    });
    const heartbeatAutomation = store.createAutomation({
      workspaceId: workspace.id,
      title: "Heartbeat monitor",
      task: "Check standing order health",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "best-effort",
      scheduleKind: "heartbeat",
      intervalSeconds: 30,
      heartbeatWindowSeconds: 90,
    });
    store.updateAutomationState({
      automationId: heartbeatAutomation.id,
      nextRunAt: "2000-01-01T00:00:00.000Z",
    });

    const scheduler = new AutomationScheduler(store, {
      onAutomationRun: async (automation, trigger) => {
        triggered.push(trigger ? `${automation.id}:${trigger.eventType}` : automation.id);
        return {
          runId: trigger ? null : "heartbeat-run",
          summary: automation.title,
        };
      },
    });

    await scheduler.dispatchEvent({
      eventType: "inbox.received",
      workspaceId: workspace.id,
      channelType: "slack",
      channelKey: "C-trigger",
      sender: "alice",
      text: "critical alert from slack",
    });
    const eventRun = await waitForAutomationState(store, eventAutomation.id, (entry) => entry.lastRunAt !== null);
    assert.equal(eventRun?.lastRunId, null);
    assert.deepEqual(triggered, [`${eventAutomation.id}:inbox.received`]);

    await scheduler.poll();
    const heartbeatRun = await waitForAutomationState(
      store,
      heartbeatAutomation.id,
      (entry) => entry.lastRunId === "heartbeat-run" && entry.nextRunAt !== null,
    );
    assert.equal(heartbeatRun?.scheduleKind, "heartbeat");
    assert.equal(heartbeatRun?.deliveryState, "idle");
    assert.ok(heartbeatRun?.nextRunAt);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("automation scheduler supports at and cron schedules", async () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-automation-at-cron-"));
  let store: SqliteSessionStore | null = null;
  const ran: string[] = [];

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/automation-at-cron");
    const atAutomation = store.createAutomation({
      workspaceId: workspace.id,
      title: "One-time report",
      task: "Run once",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "best-effort",
      scheduleKind: "at",
      scheduleExpression: "2000-01-01T00:00:00.000Z",
    });
    const cronAutomation = store.createAutomation({
      workspaceId: workspace.id,
      title: "Quarter-hour report",
      task: "Run on cron",
      mode: "mock",
      executionDomain: "workspace",
      verificationMode: "best-effort",
      scheduleKind: "cron",
      scheduleExpression: "*/15 * * * *",
      timezone: "UTC",
    });
    assert.equal(
      computeAutomationNextRunAt(cronAutomation, "2026-01-01T00:07:00.000Z"),
      "2026-01-01T00:15:00.000Z",
    );
    store.updateAutomationState({
      automationId: cronAutomation.id,
      nextRunAt: "2000-01-01T00:00:00.000Z",
    });

    const scheduler = new AutomationScheduler(store, {
      onAutomationRun: async (automation) => {
        ran.push(automation.id);
        return {
          runId: `${automation.scheduleKind}-run`,
          summary: automation.title,
        };
      },
    });

    await scheduler.poll();
    const atRun = await waitForAutomationState(store, atAutomation.id, (entry) => entry.lastRunId === "at-run");
    assert.equal(atRun.nextRunAt, null);
    const cronRun = await waitForAutomationState(store, cronAutomation.id, (entry) =>
      entry.lastRunId === "cron-run" && entry.nextRunAt !== null,
    );
    assert.equal(cronRun.scheduleExpression, "*/15 * * * *");
    assert.equal(cronRun.timezone, "UTC");
    assert.ok(cronRun.nextRunAt);
    assert.ok(new Date(cronRun.nextRunAt).getTime() > new Date(cronRun.lastRunAt ?? "").getTime());
    assert.deepEqual(new Set(ran), new Set([atAutomation.id, cronAutomation.id]));
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("automation creation rejects invalid cron and at expressions", () => {
  const root = mkdtempSync(join(tmpdir(), "omni-agent-automation-invalid-schedule-"));
  let store: SqliteSessionStore | null = null;

  try {
    store = new SqliteSessionStore(root);
    store.initialize();
    const workspace = store.upsertWorkspace("E:/example/automation-invalid-schedule");
    assert.throws(
      () => store!.createAutomation({
        workspaceId: workspace.id,
        title: "Invalid cron",
        task: "Run bad cron",
        mode: "mock",
        executionDomain: "workspace",
        verificationMode: "best-effort",
        scheduleKind: "cron",
        scheduleExpression: "bad cron",
      }),
      /5 fields/,
    );
    assert.throws(
      () => store!.createAutomation({
        workspaceId: workspace.id,
        title: "Invalid at",
        task: "Run bad at",
        mode: "mock",
        executionDomain: "workspace",
        verificationMode: "best-effort",
        scheduleKind: "at",
        scheduleExpression: "not-a-date",
      }),
      /Invalid at automation timestamp/,
    );
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});

async function waitForAutomationState(
  store: SqliteSessionStore,
  automationId: string,
  predicate: (automation: NonNullable<ReturnType<SqliteSessionStore["getAutomation"]>>) => boolean,
  timeoutMs = 5_000,
): Promise<NonNullable<ReturnType<SqliteSessionStore["getAutomation"]>>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const automation = store.getAutomation(automationId);
    if (automation && predicate(automation)) {
      return automation;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const latest = store.getAutomation(automationId);
  if (!latest) {
    throw new Error(`Automation ${automationId} was not found.`);
  }
  throw new Error(`Automation ${automationId} did not reach the expected state. Current state: ${latest.deliveryState}`);
}
