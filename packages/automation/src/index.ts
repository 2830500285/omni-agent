import { computeAutomationNextRunAt, type AutomationRecord, type AutomationTriggerEvent, type SqliteSessionStore } from "@omni-agent/session-store";

export interface AutomationRunResult {
  readonly runId?: string | null;
  readonly summary?: string;
}

export interface AutomationSchedulerEvent {
  readonly type: "automation.completed" | "automation.cooldown" | "automation.dead_lettered" | "automation.failed" | "automation.started";
  readonly at: string;
  readonly automationId: string;
  readonly workspaceId: string;
  readonly runId?: string | null;
  readonly summary?: string;
}

export interface AutomationSchedulerOptions {
  readonly pollIntervalMs?: number;
  readonly onAutomationRun: (
    automation: AutomationRecord,
    trigger?: AutomationTriggerEvent,
  ) => Promise<AutomationRunResult>;
  readonly eventHandler?: (event: AutomationSchedulerEvent) => void | Promise<void>;
}

export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly inflight = new Set<string>();

  public constructor(
    private readonly sessionStore: SqliteSessionStore,
    private readonly options: AutomationSchedulerOptions,
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }
    const pollIntervalMs = Math.max(1_000, this.options.pollIntervalMs ?? 5_000);
    this.timer = setInterval(() => {
      void this.poll();
    }, pollIntervalMs);
    void this.poll();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async poll(): Promise<void> {
    this.sessionStore.initialize();
    const dueAutomations = this.sessionStore.listDueAutomations();
    for (const automation of dueAutomations) {
      this.queueAutomationRun(automation);
    }
  }

  public async dispatchEvent(trigger: AutomationTriggerEvent): Promise<void> {
    this.sessionStore.initialize();
    const automations = this.sessionStore.listTriggeredAutomations(trigger);
    for (const automation of automations) {
      this.queueAutomationRun(automation, trigger);
    }
  }

  private queueAutomationRun(automation: AutomationRecord, trigger?: AutomationTriggerEvent): void {
    const inflightKey = trigger ? `${automation.id}:${buildTriggerInflightKey(trigger)}` : automation.id;
    if (this.inflight.has(inflightKey)) {
      return;
    }
    this.inflight.add(inflightKey);
    void this.runAutomation(automation, trigger).finally(() => {
      this.inflight.delete(inflightKey);
    });
  }

  private async runAutomation(automation: AutomationRecord, trigger?: AutomationTriggerEvent): Promise<void> {
    const startedAt = new Date().toISOString();
    this.sessionStore.updateAutomationState({
      automationId: automation.id,
      deliveryState: "running",
      cooldownUntil: null,
      deadLetteredAt: automation.deadLetteredAt,
    });
    await this.emit({
      type: "automation.started",
      at: startedAt,
      automationId: automation.id,
      workspaceId: automation.workspaceId,
      summary: automation.title,
    });

    try {
      const result = await this.options.onAutomationRun(automation, trigger);
      const completedAt = new Date().toISOString();
      const nextRunAt = automation.status === "active" && automation.scheduleKind !== "at"
        ? computeAutomationNextRunAt(automation, completedAt)
        : null;
      this.sessionStore.updateAutomationState({
        automationId: automation.id,
        deliveryState: "idle",
        consecutiveFailures: 0,
        lastRunAt: completedAt,
        lastRunId: result.runId ?? null,
        nextRunAt,
        lastFailureAt: null,
        lastError: null,
        cooldownUntil: null,
        deadLetteredAt: null,
      });
      await this.emit({
        type: "automation.completed",
        at: completedAt,
        automationId: automation.id,
        workspaceId: automation.workspaceId,
        runId: result.runId ?? null,
        summary: result.summary ?? automation.title,
      });
    } catch (error) {
      const nextRunAt = automation.status === "active" && automation.scheduleKind !== "at"
        ? computeAutomationNextRunAt(automation, startedAt)
        : null;
      const failureCount = automation.failureCount + 1;
      const consecutiveFailures = automation.consecutiveFailures + 1;
      const errorSummary = error instanceof Error ? error.message : String(error);
      const deadLettered = consecutiveFailures >= automation.maxConsecutiveFailures;
      const cooldownUntil =
        !deadLettered &&
        (automation.scheduleKind === "interval" ||
          automation.scheduleKind === "heartbeat" ||
          automation.scheduleKind === "maintenance" ||
          automation.scheduleKind === "cron") &&
        automation.retryDelaySeconds
          ? computeAutomationNextRunAt({ scheduleKind: "interval", intervalSeconds: automation.retryDelaySeconds }, startedAt)
          : null;
      this.sessionStore.updateAutomationState({
        automationId: automation.id,
        deliveryState: deadLettered ? "dead_letter" : cooldownUntil ? "cooldown" : "idle",
        failureCount,
        consecutiveFailures,
        lastRunAt: startedAt,
        nextRunAt: deadLettered ? null : cooldownUntil ?? nextRunAt,
        lastFailureAt: startedAt,
        lastError: errorSummary,
        cooldownUntil,
        deadLetteredAt: deadLettered ? startedAt : null,
      });
      await this.emit({
        type: deadLettered ? "automation.dead_lettered" : cooldownUntil ? "automation.cooldown" : "automation.failed",
        at: new Date().toISOString(),
        automationId: automation.id,
        workspaceId: automation.workspaceId,
        summary: errorSummary,
      });
    }
  }

  private async emit(event: AutomationSchedulerEvent): Promise<void> {
    await this.options.eventHandler?.(event);
  }
}

function buildTriggerInflightKey(trigger: AutomationTriggerEvent): string {
  return [
    trigger.eventType,
    trigger.routeId ?? "",
    trigger.channelType ?? "",
    trigger.channelKey ?? "",
    trigger.sender ?? "",
    trigger.text ?? "",
  ].join("|");
}
