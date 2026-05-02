import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { redactSensitiveText, redactSensitiveValue } from "@omni-agent/safety";

function hashThreadSummary(summary: string): string {
  return createHash("sha256").update(summary).digest("hex");
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

export type RunStatus =
  | "running"
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "interrupted";

export type MemoryScope = "thread" | "workspace";
export type LearnedSkillSourceType = "bundled" | "workspace" | "personal" | "learned" | "third_party";
export type AgentMode = "default" | "bound" | "shared" | "locked_down";
export type AgentDefaultRole =
  | "primary"
  | "planner"
  | "researcher"
  | "reviewer"
  | "verifier"
  | "worker"
  | "executor"
  | "supervisor";
export type AutomationScheduleKind = "at" | "cron" | "event" | "heartbeat" | "interval" | "maintenance" | "manual";
export type AutomationStatus = "active" | "paused";
export type AutomationDeliveryState = "cooldown" | "dead_letter" | "idle" | "running";
export type AutomationDeliveryMode = "relay" | "run";
export type ChannelRouteStatus = "active" | "paused";
export type InboundMessageStatus = "failed" | "processed" | "processing" | "queued";
export type RouteAdapterType =
  | "canvas"
  | "console"
  | "dingtalk"
  | "discord"
  | "feishu"
  | "filesystem"
  | "matrix"
  | "media"
  | "mobile-node"
  | "slack"
  | "signal"
  | "teams"
  | "telegram"
  | "voice"
  | "whatsapp"
  | "webhook";
export type OutboundDeliveryStatus =
  | "acknowledged"
  | "dead_letter"
  | "delivered"
  | "failed"
  | "queued"
  | "retrying"
  | "sending"
  | "sent";
export type RoutePairingStatus = "approved" | "pending" | "rejected";
export type AuthProfileHealthStatus = "cooldown" | "disabled" | "healthy";

export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
  readonly cwd: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentRecord {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly name: string;
  readonly cwd: string;
  readonly status: "active" | "paused";
  readonly agentType: string;
  readonly defaultRole: AgentDefaultRole | null;
  readonly mode: AgentMode;
  readonly stateRoot: string;
  readonly defaultModelProfileId: string | null;
  readonly contextEngineId: string | null;
  readonly memoryProviderIds: string[];
  readonly instruction: string | null;
  readonly authProfileId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuthProfileStateRecord {
  readonly authProfileId: string;
  readonly status: AuthProfileHealthStatus;
  readonly successCount: number;
  readonly failureCount: number;
  readonly consecutiveFailures: number;
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly cooldownUntil: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ThreadRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AcpSessionBindingRecord {
  readonly threadId: string;
  readonly workspaceId: string;
  readonly channelType: string;
  readonly channelKey: string;
  readonly conversationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AcpSessionResetResult {
  readonly threadId: string;
  readonly bindingCleared: boolean;
  readonly threadSummaryCleared: boolean;
}

export interface RunRecord {
  readonly id: string;
  readonly threadId: string;
  readonly agentId: string | null;
  readonly objective: string;
  readonly status: RunStatus;
  readonly executionDomain: string;
  readonly sourceRoot: string | null;
  readonly executionRoot: string | null;
  readonly worktreePath: string | null;
  readonly worktreeBranch: string | null;
  readonly sandboxPath: string | null;
  readonly executionCleanedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finalResponse: string | null;
  readonly verificationStatus: string | null;
}

export interface RunMetricsRecord {
  readonly runId: string;
  readonly modelProfiles: string[];
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolSuccessCount: number;
  readonly toolFailureCount: number;
  readonly blockedApprovalCount: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly contextEngineId: string | null;
  readonly contextEngineStatus: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ThreadUsageSummary {
  readonly threadId: string;
  readonly runCount: number;
  readonly modelProfiles: string[];
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolSuccessCount: number;
  readonly toolFailureCount: number;
  readonly blockedApprovalCount: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly totalDurationMs: number | null;
  readonly firstStartedAt: string | null;
  readonly lastCompletedAt: string | null;
}

export interface WorkspaceUsageSummary {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly threadCount: number;
  readonly runCount: number;
  readonly modelProfiles: string[];
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolSuccessCount: number;
  readonly toolFailureCount: number;
  readonly blockedApprovalCount: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly totalDurationMs: number | null;
  readonly firstStartedAt: string | null;
  readonly lastCompletedAt: string | null;
}

export interface AgentUsageSummary {
  readonly agentId: string;
  readonly workspaceId: string | null;
  readonly workspaceName: string;
  readonly threadCount: number;
  readonly runCount: number;
  readonly modelProfiles: string[];
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolSuccessCount: number;
  readonly toolFailureCount: number;
  readonly blockedApprovalCount: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly totalDurationMs: number | null;
  readonly firstStartedAt: string | null;
  readonly lastCompletedAt: string | null;
}

export interface GlobalUsageSummary {
  readonly workspaceCount: number;
  readonly threadCount: number;
  readonly runCount: number;
  readonly modelProfiles: string[];
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolSuccessCount: number;
  readonly toolFailureCount: number;
  readonly blockedApprovalCount: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly totalDurationMs: number | null;
  readonly firstStartedAt: string | null;
  readonly lastCompletedAt: string | null;
}

export interface MessageRecord {
  readonly id: string;
  readonly threadId: string;
  readonly runId: string | null;
  readonly role: "assistant" | "system" | "user";
  readonly text: string;
  readonly createdAt: string;
}

export interface ToolEventRecord {
  readonly id: string;
  readonly runId: string;
  readonly toolCallId: string | null;
  readonly toolName: string;
  readonly riskTier: number;
  readonly status: string;
  readonly summary: string;
  readonly outputPreview: string | null;
  readonly outputTruncated: boolean;
  readonly storedOutputRef: string | null;
  readonly presentation: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
}

export interface ArtifactRecord {
  readonly id: string;
  readonly runId: string;
  readonly kind: string;
  readonly path: string;
  readonly summary: string;
  readonly createdAt: string;
}

export interface AgentRunTaskContractArtifact {
  readonly objective: string;
  readonly executionDomain: string;
  readonly sourceRoot: string | null;
  readonly executionRoot: string | null;
  readonly successCriteria?: readonly string[];
  readonly constraints?: readonly string[];
}

export interface AgentRunToolTraceArtifact {
  readonly toolCallId: string | null;
  readonly toolName: string;
  readonly riskTier: number;
  readonly status: string;
  readonly summary: string;
  readonly outputPreview: string | null;
  readonly outputTruncated: boolean;
  readonly storedOutputRef: string | null;
  readonly presentation: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
}

export interface AgentRunApprovalArtifact {
  readonly toolName: string;
  readonly decision: "allow" | "deny" | "prompt" | "approved" | "rejected";
  readonly riskTier?: number;
  readonly approvalClass?: string;
  readonly scope?: string;
  readonly summary?: string;
  readonly createdAt?: string;
}

export interface AgentRunDiffArtifact {
  readonly changedFiles: readonly string[];
  readonly summary?: string;
  readonly patch?: string;
  readonly patchArtifactPath?: string;
}

export interface AgentRunVerificationArtifact {
  readonly status: string;
  readonly commands?: readonly string[];
  readonly summary?: string;
}

export interface AgentRunSummaryArtifact {
  readonly finalResponse: string | null;
  readonly notes?: readonly string[];
  readonly nextSteps?: readonly string[];
}

export interface AgentRunArtifactPayload {
  readonly schemaVersion: 1;
  readonly kind: "agent-run";
  readonly runId: string;
  readonly createdAt: string;
  readonly taskContract: AgentRunTaskContractArtifact;
  readonly toolTrace: readonly AgentRunToolTraceArtifact[];
  readonly approvals: readonly AgentRunApprovalArtifact[];
  readonly diff: AgentRunDiffArtifact | null;
  readonly verification: AgentRunVerificationArtifact;
  readonly summary: AgentRunSummaryArtifact;
}

export interface MemoryRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: string | null;
  readonly threadId: string | null;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly tags: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProfileFactRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: string | null;
  readonly sourceRunId: string | null;
  readonly content: string;
  readonly tags: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ThreadSummaryRecord {
  readonly threadId: string;
  readonly workspaceId: string;
  readonly lastRunId: string | null;
  readonly summary: string;
  readonly summaryVersion: number;
  readonly summaryHash: string;
  readonly handoff: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SessionSearchResult {
  readonly threadId: string;
  readonly threadTitle: string;
  readonly messageId: string;
  readonly runId: string | null;
  readonly role: MessageRecord["role"];
  readonly text: string;
  readonly excerpt: string;
  readonly createdAt: string;
}

export interface LearnedSkillRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: string | null;
  readonly sourceRunId: string | null;
  readonly sourceType: LearnedSkillSourceType;
  readonly promotedFromSourceType: LearnedSkillSourceType | null;
  readonly promotedAt: string | null;
  readonly kind: string;
  readonly dedupeKey: string | null;
  readonly lifecycleState: "active" | "needs_reverify" | "disabled";
  readonly lifecycleReason: string | null;
  readonly materializedSkillPath: string | null;
  readonly title: string;
  readonly problemPattern: string;
  readonly guidance: string;
  readonly exampleObjective: string | null;
  readonly changedFiles: string[];
  readonly tags: string[];
  readonly triggerSignals: string[];
  readonly procedureSteps: string[];
  readonly verificationStatus: string;
  readonly verificationSummary: string;
  readonly revisionCount: number;
  readonly useCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastAttemptAt: string | null;
  readonly lastFailureAt: string | null;
  readonly qualityScore: number;
  readonly expiresAt: string | null;
  readonly lastVerifiedAt: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LearnedSkillMaintenanceReport {
  readonly workspaceId: string;
  readonly agentId: string | null;
  readonly promotionCandidates: LearnedSkillRecord[];
  readonly reverifyCandidates: LearnedSkillRecord[];
  readonly disableCandidates: LearnedSkillRecord[];
  readonly stableSkills: LearnedSkillRecord[];
  readonly generatedAt: string;
}

export interface LearnedSkillMaintenanceApplication {
  readonly report: LearnedSkillMaintenanceReport;
  readonly promotedSkills: LearnedSkillRecord[];
  readonly reverifySkills: LearnedSkillRecord[];
  readonly disabledSkills: LearnedSkillRecord[];
  readonly profileFacts: ProfileFactRecord[];
  readonly appliedAt: string;
}

export interface ProfileEvaluationRecord {
  readonly id: string;
  readonly profileId: string;
  readonly workspaceId: string | null;
  readonly agentId: string | null;
  readonly suiteTitle: string;
  readonly categories: string[];
  readonly metrics: Readonly<Record<string, unknown>>;
  readonly scores: Readonly<Record<string, unknown>>;
  readonly passed: boolean;
  readonly summary: string;
  readonly createdAt: string;
}

export interface AuditLogRecord {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly agentId: string | null;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly riskLevel: "high" | "low" | "medium";
  readonly summary: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface AutomationRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: string | null;
  readonly threadId: string | null;
  readonly title: string;
  readonly threadTitle: string | null;
  readonly task: string;
  readonly mode: string;
  readonly executionDomain: string;
  readonly verificationMode: string;
  readonly verificationCommands: string[];
  readonly autoApproveRisky: boolean;
  readonly maxIterations: number;
  readonly scheduleKind: AutomationScheduleKind;
  readonly intervalSeconds: number | null;
  readonly scheduleExpression: string | null;
  readonly timezone: string | null;
  readonly heartbeatWindowSeconds: number | null;
  readonly triggerEventTypes: string[];
  readonly triggerRouteId: string | null;
  readonly triggerChannelType: string | null;
  readonly triggerChannelKey: string | null;
  readonly triggerSenders: string[];
  readonly triggerTextPattern: string | null;
  readonly deliveryMode: AutomationDeliveryMode;
  readonly relayTemplate: string | null;
  readonly retryDelaySeconds: number | null;
  readonly maxConsecutiveFailures: number;
  readonly status: AutomationStatus;
  readonly deliveryState: AutomationDeliveryState;
  readonly failureCount: number;
  readonly consecutiveFailures: number;
  readonly lastRunAt: string | null;
  readonly lastRunId: string | null;
  readonly nextRunAt: string | null;
  readonly lastFailureAt: string | null;
  readonly lastError: string | null;
  readonly cooldownUntil: string | null;
  readonly deadLetteredAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AutomationTriggerEvent {
  readonly eventType: string;
  readonly workspaceId: string;
  readonly routeId?: string | null;
  readonly channelType?: string | null;
  readonly channelKey?: string | null;
  readonly sender?: string | null;
  readonly text?: string | null;
}

export type PersistedSubagentJobStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "interrupted"
  | "paused"
  | "queued"
  | "running"
  | "timed_out";

export interface PersistedSubagentBudget {
  readonly maxIterations: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export interface PersistedStructuredSubagentResult {
  readonly kind: "findings" | "plan" | "review" | "verdict";
  readonly status: string;
  readonly summary: string;
  readonly bullets?: string[];
}

export interface PersistedSubagentCompletionRecord {
  readonly status: PersistedSubagentJobStatus;
  readonly verificationStatus: string;
  readonly changedFiles: string[];
  readonly finalResponse: string;
  readonly error?: string;
  readonly structuredResult?: PersistedStructuredSubagentResult;
}

export interface PersistedSubagentMessageRecord {
  readonly id: string;
  readonly author: "parent";
  readonly content: string;
  readonly createdAt: string;
}

export interface PersistedSubagentProgressEvent {
  readonly at: string;
  readonly status: PersistedSubagentJobStatus;
  readonly reason: string;
  readonly summary: string;
}

export interface PersistedSubagentJobRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly parentThreadId: string;
  readonly parentRunId: string;
  readonly objective: string;
  readonly sessionMode: "run" | "thread";
  readonly role?: string;
  readonly mode: "background" | "foreground";
  readonly outcomeVisibility: "artifacts_only" | "context" | "summary_only";
  readonly authority: "leaf" | "orchestrator";
  readonly status: PersistedSubagentJobStatus;
  readonly rootJobId: string;
  readonly parentJobId?: string;
  readonly depth: number;
  readonly maxDepth: number;
  readonly maxConcurrentChildren: number;
  readonly childJobIds: string[];
  readonly executionDomain: string;
  readonly budget: PersistedSubagentBudget;
  readonly pluginDirs?: string[];
  readonly allowedTools?: string[];
  readonly returnedArtifactKinds?: string[];
  readonly targetPaths?: string[];
  readonly toolPolicyTrace?: string[];
  readonly attempts: number;
  readonly createdAt: string;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly blockedReason?: string;
  readonly blockedByJobIds?: string[];
  readonly blockedPaths?: string[];
  readonly pausedFromStatus?: "queued" | "running";
  readonly queuePosition?: number;
  readonly updatedAt: string;
  readonly messages: readonly PersistedSubagentMessageRecord[];
  readonly threadId?: string;
  readonly runId?: string;
  readonly finalResponse?: string;
  readonly error?: string;
  readonly completion?: PersistedSubagentCompletionRecord;
  readonly progressEvents?: readonly PersistedSubagentProgressEvent[];
}

export interface FileLeaseRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly path: string;
  readonly ownerJobId: string;
  readonly ownerThreadId: string;
  readonly ownerRunId: string;
  readonly status: "active" | "released";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly releasedAt: string | null;
}

export interface ChannelRouteRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: string | null;
  readonly threadId: string | null;
  readonly title: string;
  readonly channelType: string;
  readonly channelKey: string;
  readonly adapterType: RouteAdapterType;
  readonly adapterConfig: Record<string, unknown>;
  readonly inboundSecret: string | null;
  readonly status: ChannelRouteStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InboundMessageRecord {
  readonly id: string;
  readonly routeId: string;
  readonly workspaceId: string;
  readonly threadId: string | null;
  readonly channelType: string;
  readonly channelKey: string;
  readonly channelMessageId: string | null;
  readonly sender: string | null;
  readonly text: string;
  readonly metadata: Record<string, unknown>;
  readonly status: InboundMessageStatus;
  readonly runId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OutboundDeliveryRecord {
  readonly id: string;
  readonly routeId: string;
  readonly workspaceId: string;
  readonly threadId: string | null;
  readonly runId: string | null;
  readonly channelType: string;
  readonly channelKey: string;
  readonly adapterType: RouteAdapterType;
  readonly payload: string;
  readonly status: OutboundDeliveryStatus;
  readonly responseSummary: string | null;
  readonly attemptCount: number;
  readonly lastAttemptAt: string | null;
  readonly deliveredAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoutePairingRecord {
  readonly id: string;
  readonly routeId: string;
  readonly workspaceId: string;
  readonly sender: string;
  readonly channelType: string;
  readonly channelKey: string;
  readonly code: string;
  readonly status: RoutePairingStatus;
  readonly approvedAt: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class SqliteSessionStore {
  private databaseHandle: DatabaseSync | null = null;
  private searchIndexesEnabled = false;

  public readonly rootDir: string;
  public readonly artifactsRoot: string;
  public readonly databasePath: string;

  public constructor(rootDir = join(homedir(), ".omni-agent")) {
    this.rootDir = resolve(rootDir);
    this.artifactsRoot = join(this.rootDir, "artifacts");
    this.databasePath = join(this.rootDir, "omni-agent.sqlite");
  }

  public initialize(): void {
    mkdirSync(this.rootDir, { recursive: true });
    mkdirSync(this.artifactsRoot, { recursive: true });

    if (!this.databaseHandle) {
      this.databaseHandle = new DatabaseSync(this.databasePath);
      this.databaseHandle.exec("PRAGMA journal_mode = WAL;");
      this.databaseHandle.exec("PRAGMA busy_timeout = 5000;");
      this.setupSchema();
    }
  }

  public close(): void {
    this.databaseHandle?.close();
    this.databaseHandle = null;
    this.searchIndexesEnabled = false;
  }

  public upsertWorkspace(cwd: string): WorkspaceRecord {
    this.initialize();
    const now = new Date().toISOString();
    const normalizedCwd = resolve(cwd);
    const existing = this.database
      .prepare(
        "SELECT id, name, cwd, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE cwd = ?",
      )
      .get(normalizedCwd) as WorkspaceRecord | undefined;

    if (existing) {
      const name = basename(normalizedCwd);
      this.database.prepare("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?").run(name, now, existing.id);
      return {
        ...existing,
        name,
        updatedAt: now,
      };
    }

    const record: WorkspaceRecord = {
      id: randomUUID(),
      name: basename(normalizedCwd),
      cwd: normalizedCwd,
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare("INSERT INTO workspaces (id, name, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(record.id, record.name, record.cwd, record.createdAt, record.updatedAt);
    return record;
  }

  public getWorkspaceByCwd(cwd: string): WorkspaceRecord | null {
    this.initialize();
    const normalizedCwd = resolve(cwd);
    return (
      (this.database
        .prepare(
          "SELECT id, name, cwd, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE cwd = ?",
        )
        .get(normalizedCwd) as WorkspaceRecord | undefined) ?? null
    );
  }

  public getWorkspace(workspaceId: string): WorkspaceRecord | null {
    this.initialize();
    return (
      (this.database
        .prepare(
          "SELECT id, name, cwd, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE id = ?",
        )
        .get(workspaceId) as WorkspaceRecord | undefined) ?? null
    );
  }

  public listWorkspaces(): WorkspaceRecord[] {
    this.initialize();
    return this.database
      .prepare("SELECT id, name, cwd, created_at AS createdAt, updated_at AS updatedAt FROM workspaces ORDER BY updated_at DESC")
      .all() as unknown as WorkspaceRecord[];
  }

  public createAgent(input: {
    readonly name: string;
    readonly cwd: string;
    readonly status?: AgentRecord["status"];
    readonly agentType?: string;
    readonly defaultRole?: AgentDefaultRole | null;
    readonly mode?: AgentMode;
    readonly stateRoot?: string;
    readonly defaultModelProfileId?: string | null;
    readonly contextEngineId?: string | null;
    readonly memoryProviderIds?: readonly string[];
    readonly instruction?: string | null;
    readonly authProfileId?: string | null;
    readonly metadata?: Record<string, unknown>;
  }): AgentRecord {
    this.initialize();
    const now = new Date().toISOString();
    const workspace = this.upsertWorkspace(input.cwd);
    const agentId = randomUUID();
    const resolvedStateRoot = resolve(input.stateRoot?.trim() || join(this.rootDir, "agents", agentId));
    const record: AgentRecord = {
      id: agentId,
      workspaceId: workspace.id,
      name: input.name.trim(),
      cwd: workspace.cwd,
      status: input.status ?? "active",
      agentType: normalizeAgentType(input.agentType),
      defaultRole: normalizeOptionalAgentDefaultRole(input.defaultRole),
      mode: normalizeAgentMode(input.mode),
      stateRoot: resolvedStateRoot,
      defaultModelProfileId: input.defaultModelProfileId?.trim() || null,
      contextEngineId: input.contextEngineId?.trim() || null,
      memoryProviderIds: normalizeStringList(input.memoryProviderIds),
      instruction: input.instruction?.trim() || null,
      authProfileId: input.authProfileId?.trim() || null,
      metadata: normalizeOptionalJsonObject(input.metadata) ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        "INSERT INTO agents (id, workspace_id, name, cwd, status, agent_type, default_role, mode, state_root, default_model_profile_id, context_engine_id, memory_provider_ids, instruction, auth_profile_id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.workspaceId,
        record.name,
        record.cwd,
        record.status,
        record.agentType,
        record.defaultRole,
        record.mode,
        record.stateRoot,
        record.defaultModelProfileId,
        record.contextEngineId,
        JSON.stringify(record.memoryProviderIds),
        record.instruction,
        record.authProfileId,
        JSON.stringify(record.metadata),
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  public getAgent(agentId: string): AgentRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, name, cwd, status, agent_type AS agentType, default_role AS defaultRole, mode, state_root AS stateRoot, default_model_profile_id AS defaultModelProfileId, context_engine_id AS contextEngineId, memory_provider_ids AS memoryProviderIdsJson, instruction, auth_profile_id AS authProfileId, metadata_json AS metadataJson, created_at AS createdAt, updated_at AS updatedAt FROM agents WHERE id = ?",
      )
      .get(agentId) as Record<string, unknown> | undefined;
    return row ? mapAgentRow(row) : null;
  }

  public listAgents(input: { readonly workspaceId?: string; readonly statuses?: readonly AgentRecord["status"][] } = {}): AgentRecord[] {
    this.initialize();
    const clauses: string[] = [];
    const values: string[] = [];
    if (input.workspaceId) {
      clauses.push("workspace_id = ?");
      values.push(input.workspaceId);
    }
    const statuses = (input.statuses ?? []).filter((entry) => entry === "active" || entry === "paused");
    if (statuses.length > 0) {
      clauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      values.push(...statuses);
    }
    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .prepare(
        `SELECT id, workspace_id AS workspaceId, name, cwd, status, agent_type AS agentType, default_role AS defaultRole, mode, state_root AS stateRoot, default_model_profile_id AS defaultModelProfileId, context_engine_id AS contextEngineId, memory_provider_ids AS memoryProviderIdsJson, instruction, auth_profile_id AS authProfileId, metadata_json AS metadataJson, created_at AS createdAt, updated_at AS updatedAt FROM agents ${whereClause} ORDER BY updated_at DESC`,
      )
      .all(...values) as Array<Record<string, unknown>>;
    return rows.map((row) => mapAgentRow(row));
  }

  public updateAgent(input: {
    readonly agentId: string;
    readonly name?: string;
    readonly cwd?: string;
    readonly status?: AgentRecord["status"];
    readonly agentType?: string;
    readonly defaultRole?: AgentDefaultRole | null;
    readonly mode?: AgentMode;
    readonly stateRoot?: string;
    readonly defaultModelProfileId?: string | null;
    readonly contextEngineId?: string | null;
    readonly memoryProviderIds?: readonly string[];
    readonly instruction?: string | null;
    readonly authProfileId?: string | null;
    readonly metadata?: Record<string, unknown>;
  }): AgentRecord {
    this.initialize();
    const current = this.getAgent(input.agentId);
    if (!current) {
      throw new Error(`Agent ${input.agentId} was not found.`);
    }
    const now = new Date().toISOString();
    const workspace = input.cwd ? this.upsertWorkspace(input.cwd) : current.workspaceId ? this.getWorkspace(current.workspaceId) : null;
    this.database
      .prepare(
        "UPDATE agents SET workspace_id = ?, name = ?, cwd = ?, status = ?, agent_type = ?, default_role = ?, mode = ?, state_root = ?, default_model_profile_id = ?, context_engine_id = ?, memory_provider_ids = ?, instruction = ?, auth_profile_id = ?, metadata_json = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        workspace?.id ?? current.workspaceId,
        input.name?.trim() || current.name,
        workspace?.cwd ?? current.cwd,
        input.status ?? current.status,
        input.agentType === undefined ? current.agentType : normalizeAgentType(input.agentType),
        input.defaultRole === undefined ? current.defaultRole : normalizeOptionalAgentDefaultRole(input.defaultRole),
        input.mode ? normalizeAgentMode(input.mode) : current.mode,
        input.stateRoot === undefined ? current.stateRoot : resolve(input.stateRoot.trim()),
        input.defaultModelProfileId === undefined ? current.defaultModelProfileId : input.defaultModelProfileId?.trim() || null,
        input.contextEngineId === undefined ? current.contextEngineId : input.contextEngineId?.trim() || null,
        JSON.stringify(input.memoryProviderIds === undefined ? current.memoryProviderIds : normalizeStringList(input.memoryProviderIds)),
        input.instruction === undefined ? current.instruction : input.instruction?.trim() || null,
        input.authProfileId === undefined ? current.authProfileId : input.authProfileId?.trim() || null,
        JSON.stringify(
          input.metadata === undefined ? current.metadata : normalizeOptionalJsonObject(input.metadata) ?? {},
        ),
        now,
        input.agentId,
      );
    const updated = this.getAgent(input.agentId);
    if (!updated) {
      throw new Error(`Agent ${input.agentId} was not found after update.`);
    }
    return updated;
  }

  public getAuthProfileState(authProfileId: string): AuthProfileStateRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT auth_profile_id AS authProfileId, status, success_count AS successCount, failure_count AS failureCount, consecutive_failures AS consecutiveFailures, last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt, cooldown_until AS cooldownUntil, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt FROM auth_profile_states WHERE auth_profile_id = ?",
      )
      .get(authProfileId.trim()) as Record<string, unknown> | undefined;
    return row ? mapAuthProfileStateRow(row) : null;
  }

  public listAuthProfileStates(input: {
    readonly statuses?: readonly AuthProfileHealthStatus[];
  } = {}): AuthProfileStateRecord[] {
    this.initialize();
    const statuses = (input.statuses ?? []).filter((entry) =>
      entry === "healthy" || entry === "cooldown" || entry === "disabled");
    const whereClause = statuses.length > 0 ? `WHERE status IN (${statuses.map(() => "?").join(", ")})` : "";
    const rows = this.database
      .prepare(
        `SELECT auth_profile_id AS authProfileId, status, success_count AS successCount, failure_count AS failureCount, consecutive_failures AS consecutiveFailures, last_success_at AS lastSuccessAt, last_failure_at AS lastFailureAt, cooldown_until AS cooldownUntil, last_error AS lastError, created_at AS createdAt, updated_at AS updatedAt FROM auth_profile_states ${whereClause} ORDER BY updated_at DESC`,
      )
      .all(...statuses) as Array<Record<string, unknown>>;
    return rows.map((row) => mapAuthProfileStateRow(row));
  }

  public upsertAuthProfileState(input: {
    readonly authProfileId: string;
    readonly status?: AuthProfileHealthStatus;
    readonly successCount?: number;
    readonly failureCount?: number;
    readonly consecutiveFailures?: number;
    readonly lastSuccessAt?: string | null;
    readonly lastFailureAt?: string | null;
    readonly cooldownUntil?: string | null;
    readonly lastError?: string | null;
  }): AuthProfileStateRecord {
    this.initialize();
    const authProfileId = input.authProfileId.trim();
    if (!authProfileId) {
      throw new Error("Auth profile id cannot be empty.");
    }
    const current = this.getAuthProfileState(authProfileId);
    const now = new Date().toISOString();
    const record: AuthProfileStateRecord = {
      authProfileId,
      status: normalizeAuthProfileHealthStatus(input.status ?? current?.status),
      successCount: Math.max(0, Math.trunc(input.successCount ?? current?.successCount ?? 0)),
      failureCount: Math.max(0, Math.trunc(input.failureCount ?? current?.failureCount ?? 0)),
      consecutiveFailures: Math.max(0, Math.trunc(input.consecutiveFailures ?? current?.consecutiveFailures ?? 0)),
      lastSuccessAt: input.lastSuccessAt === undefined ? current?.lastSuccessAt ?? null : input.lastSuccessAt,
      lastFailureAt: input.lastFailureAt === undefined ? current?.lastFailureAt ?? null : input.lastFailureAt,
      cooldownUntil: input.cooldownUntil === undefined ? current?.cooldownUntil ?? null : input.cooldownUntil,
      lastError: input.lastError === undefined ? current?.lastError ?? null : input.lastError,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    this.database
      .prepare(
        [
          "INSERT INTO auth_profile_states (auth_profile_id, status, success_count, failure_count, consecutive_failures, last_success_at, last_failure_at, cooldown_until, last_error, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          "ON CONFLICT(auth_profile_id) DO UPDATE SET",
          "status = excluded.status,",
          "success_count = excluded.success_count,",
          "failure_count = excluded.failure_count,",
          "consecutive_failures = excluded.consecutive_failures,",
          "last_success_at = excluded.last_success_at,",
          "last_failure_at = excluded.last_failure_at,",
          "cooldown_until = excluded.cooldown_until,",
          "last_error = excluded.last_error,",
          "updated_at = excluded.updated_at",
        ].join(" "),
      )
      .run(
        record.authProfileId,
        record.status,
        record.successCount,
        record.failureCount,
        record.consecutiveFailures,
        record.lastSuccessAt,
        record.lastFailureAt,
        record.cooldownUntil,
        record.lastError,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  public recordAuthProfileSuccess(authProfileId: string): AuthProfileStateRecord {
    const current = this.getAuthProfileState(authProfileId.trim());
    const now = new Date().toISOString();
    return this.upsertAuthProfileState({
      authProfileId,
      status: "healthy",
      successCount: (current?.successCount ?? 0) + 1,
      failureCount: current?.failureCount ?? 0,
      consecutiveFailures: 0,
      lastSuccessAt: now,
      cooldownUntil: null,
      lastError: null,
    });
  }

  public recordAuthProfileFailure(input: {
    readonly authProfileId: string;
    readonly error?: string | null;
    readonly cooldownUntil?: string | null;
    readonly disable?: boolean;
  }): AuthProfileStateRecord {
    const current = this.getAuthProfileState(input.authProfileId.trim());
    const now = new Date().toISOString();
    return this.upsertAuthProfileState({
      authProfileId: input.authProfileId,
      status: input.disable ? "disabled" : input.cooldownUntil ? "cooldown" : "healthy",
      successCount: current?.successCount ?? 0,
      failureCount: (current?.failureCount ?? 0) + 1,
      consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
      lastFailureAt: now,
      cooldownUntil: input.cooldownUntil ?? null,
      lastError: input.error ?? null,
    });
  }

  public resetAuthProfileState(authProfileId: string): AuthProfileStateRecord {
    return this.upsertAuthProfileState({
      authProfileId,
      status: "healthy",
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      cooldownUntil: null,
      lastError: null,
    });
  }

  public createThread(workspaceId: string, title: string): ThreadRecord {
    this.initialize();
    const now = new Date().toISOString();
    const record: ThreadRecord = {
      id: randomUUID(),
      workspaceId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare("INSERT INTO threads (id, workspace_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(record.id, record.workspaceId, record.title, record.createdAt, record.updatedAt);
    this.syncMessagesSearchByThread(record.id);
    return record;
  }

  public getThread(threadId: string): ThreadRecord | null {
    this.initialize();
    return (
      (this.database
        .prepare(
          "SELECT id, workspace_id AS workspaceId, title, created_at AS createdAt, updated_at AS updatedAt FROM threads WHERE id = ?",
        )
        .get(threadId) as ThreadRecord | undefined) ?? null
    );
  }

  public findRecentThread(workspaceId: string): ThreadRecord | null {
    this.initialize();
    return (
      (this.database
        .prepare(
          "SELECT id, workspace_id AS workspaceId, title, created_at AS createdAt, updated_at AS updatedAt FROM threads WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 1",
        )
        .get(workspaceId) as ThreadRecord | undefined) ?? null
    );
  }

  public touchThread(threadId: string): ThreadRecord {
    this.initialize();
    const updatedAt = new Date().toISOString();
    this.database.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(updatedAt, threadId);
    const updated = this.getThread(threadId);
    if (!updated) {
      throw new Error(`Thread ${threadId} was not found.`);
    }
    return updated;
  }

  public bindAcpSession(input: {
    readonly threadId: string;
    readonly channelType: string;
    readonly channelKey: string;
    readonly conversationId: string;
  }): AcpSessionBindingRecord {
    this.initialize();
    const thread = this.getThread(input.threadId);
    if (!thread) {
      throw new Error(`Thread ${input.threadId} was not found.`);
    }
    const now = new Date().toISOString();
    const record: AcpSessionBindingRecord = {
      threadId: thread.id,
      workspaceId: thread.workspaceId,
      channelType: input.channelType.trim(),
      channelKey: input.channelKey.trim(),
      conversationId: input.conversationId.trim(),
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        "DELETE FROM acp_session_bindings WHERE thread_id = ? OR (channel_type = ? AND channel_key = ? AND conversation_id = ?)",
      )
      .run(record.threadId, record.channelType, record.channelKey, record.conversationId);
    this.database
      .prepare(
        "INSERT INTO acp_session_bindings (thread_id, workspace_id, channel_type, channel_key, conversation_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.threadId,
        record.workspaceId,
        record.channelType,
        record.channelKey,
        record.conversationId,
        record.createdAt,
        record.updatedAt,
      );
    this.touchThread(record.threadId);
    return this.getAcpSessionBinding(record.threadId) ?? record;
  }

  public getAcpSessionBinding(threadId: string): AcpSessionBindingRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT thread_id AS threadId, workspace_id AS workspaceId, channel_type AS channelType, channel_key AS channelKey, conversation_id AS conversationId, created_at AS createdAt, updated_at AS updatedAt FROM acp_session_bindings WHERE thread_id = ?",
      )
      .get(threadId.trim()) as AcpSessionBindingRecord | undefined;
    return row ?? null;
  }

  public findAcpSessionBinding(input: {
    readonly channelType: string;
    readonly channelKey: string;
    readonly conversationId: string;
  }): AcpSessionBindingRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT thread_id AS threadId, workspace_id AS workspaceId, channel_type AS channelType, channel_key AS channelKey, conversation_id AS conversationId, created_at AS createdAt, updated_at AS updatedAt FROM acp_session_bindings WHERE channel_type = ? AND channel_key = ? AND conversation_id = ?",
      )
      .get(input.channelType.trim(), input.channelKey.trim(), input.conversationId.trim()) as
      | AcpSessionBindingRecord
      | undefined;
    return row ?? null;
  }

  public resetAcpSessionState(threadId: string): AcpSessionResetResult {
    this.initialize();
    const binding = this.getAcpSessionBinding(threadId);
    const summary = this.getThreadSummary(threadId);
    this.database.prepare("DELETE FROM acp_session_bindings WHERE thread_id = ?").run(threadId);
    this.database.prepare("DELETE FROM thread_summaries WHERE thread_id = ?").run(threadId);
    if (this.getThread(threadId)) {
      this.touchThread(threadId);
    }
    return {
      threadId,
      bindingCleared: Boolean(binding),
      threadSummaryCleared: Boolean(summary),
    };
  }

  public createRun(input: {
    readonly threadId: string;
    readonly agentId?: string | null;
    readonly objective: string;
    readonly executionDomain: string;
  }): RunRecord {
    this.initialize();
    const now = new Date().toISOString();
    const record: RunRecord = {
      id: randomUUID(),
      threadId: input.threadId,
      agentId: input.agentId?.trim() || null,
      objective: input.objective,
      status: "running",
      executionDomain: input.executionDomain,
      sourceRoot: null,
      executionRoot: null,
      worktreePath: null,
      worktreeBranch: null,
      sandboxPath: null,
      executionCleanedAt: null,
      createdAt: now,
      updatedAt: now,
      finalResponse: null,
      verificationStatus: null,
    };
    this.database
      .prepare(
        "INSERT INTO runs (id, thread_id, agent_id, objective, status, execution_domain, source_root, execution_root, worktree_path, worktree_branch, sandbox_path, execution_cleaned_at, final_response, verification_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.threadId,
        record.agentId,
        record.objective,
        record.status,
        record.executionDomain,
        record.sourceRoot,
        record.executionRoot,
        record.worktreePath,
        record.worktreeBranch,
        record.sandboxPath,
        record.executionCleanedAt,
        record.finalResponse,
        record.verificationStatus,
        record.createdAt,
        record.updatedAt,
      );
    this.touchThread(record.threadId);
    return record;
  }

  public updateRunExecutionContext(input: {
    readonly runId: string;
    readonly sourceRoot: string;
    readonly executionRoot: string;
    readonly worktreePath: string | null;
    readonly worktreeBranch: string | null;
    readonly sandboxPath: string | null;
  }): RunRecord {
    this.initialize();
    const now = new Date().toISOString();
    this.database
      .prepare(
        "UPDATE runs SET source_root = ?, execution_root = ?, worktree_path = ?, worktree_branch = ?, sandbox_path = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        resolve(input.sourceRoot),
        resolve(input.executionRoot),
        input.worktreePath ? resolve(input.worktreePath) : null,
        input.worktreeBranch,
        input.sandboxPath ? resolve(input.sandboxPath) : null,
        now,
        input.runId,
      );
    const updated = this.getRun(input.runId);
    if (!updated) {
      throw new Error(`Run ${input.runId} was not found.`);
    }
    return updated;
  }

  public markRunExecutionCleaned(runId: string): RunRecord {
    this.initialize();
    const now = new Date().toISOString();
    this.database.prepare("UPDATE runs SET execution_cleaned_at = ?, updated_at = ? WHERE id = ?").run(now, now, runId);
    const updated = this.getRun(runId);
    if (!updated) {
      throw new Error(`Run ${runId} was not found.`);
    }
    return updated;
  }

  public getRun(runId: string): RunRecord | null {
    this.initialize();
    return (
      (this.database
        .prepare(
          "SELECT id, thread_id AS threadId, agent_id AS agentId, objective, status, execution_domain AS executionDomain, source_root AS sourceRoot, execution_root AS executionRoot, worktree_path AS worktreePath, worktree_branch AS worktreeBranch, sandbox_path AS sandboxPath, execution_cleaned_at AS executionCleanedAt, final_response AS finalResponse, verification_status AS verificationStatus, created_at AS createdAt, updated_at AS updatedAt FROM runs WHERE id = ?",
        )
        .get(runId) as RunRecord | undefined) ?? null
    );
  }

  public listRuns(threadId: string, limit = 20): RunRecord[] {
    this.initialize();
    return this.database
      .prepare(
        "SELECT id, thread_id AS threadId, agent_id AS agentId, objective, status, execution_domain AS executionDomain, source_root AS sourceRoot, execution_root AS executionRoot, worktree_path AS worktreePath, worktree_branch AS worktreeBranch, sandbox_path AS sandboxPath, execution_cleaned_at AS executionCleanedAt, final_response AS finalResponse, verification_status AS verificationStatus, created_at AS createdAt, updated_at AS updatedAt FROM runs WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(threadId, limit) as unknown as RunRecord[];
  }

  public listAgentRuns(agentId: string, limit = 20): RunRecord[] {
    this.initialize();
    return this.database
      .prepare(
        "SELECT id, thread_id AS threadId, agent_id AS agentId, objective, status, execution_domain AS executionDomain, source_root AS sourceRoot, execution_root AS executionRoot, worktree_path AS worktreePath, worktree_branch AS worktreeBranch, sandbox_path AS sandboxPath, execution_cleaned_at AS executionCleanedAt, final_response AS finalResponse, verification_status AS verificationStatus, created_at AS createdAt, updated_at AS updatedAt FROM runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(agentId, limit) as unknown as RunRecord[];
  }

  public listAgentThreads(agentId: string, limit = 20): ThreadRecord[] {
    this.initialize();
    return this.database
      .prepare(
        [
          "SELECT t.id, t.workspace_id AS workspaceId, t.title, t.created_at AS createdAt, t.updated_at AS updatedAt",
          "FROM threads t",
          "INNER JOIN runs r ON r.thread_id = t.id",
          "WHERE r.agent_id = ?",
          "GROUP BY t.id, t.workspace_id, t.title, t.created_at, t.updated_at",
          "ORDER BY t.updated_at DESC",
          "LIMIT ?",
        ].join(" "),
      )
      .all(agentId, limit) as unknown as ThreadRecord[];
  }

  public upsertRunMetrics(input: {
    readonly runId: string;
    readonly modelProfiles: string[];
    readonly turnCount: number;
    readonly toolCallCount: number;
    readonly toolSuccessCount: number;
    readonly toolFailureCount: number;
    readonly blockedApprovalCount: number;
    readonly inputTokens?: number | null;
    readonly outputTokens?: number | null;
    readonly totalTokens?: number | null;
    readonly startedAt: string;
    readonly completedAt?: string | null;
    readonly durationMs?: number | null;
    readonly contextEngineId?: string | null;
    readonly contextEngineStatus?: Readonly<Record<string, unknown>> | null;
  }): RunMetricsRecord {
    this.initialize();
    const now = new Date().toISOString();
    const record: RunMetricsRecord = {
      runId: input.runId,
      modelProfiles: normalizeTags(input.modelProfiles),
      turnCount: normalizeNonNegativeInteger(input.turnCount),
      toolCallCount: normalizeNonNegativeInteger(input.toolCallCount),
      toolSuccessCount: normalizeNonNegativeInteger(input.toolSuccessCount),
      toolFailureCount: normalizeNonNegativeInteger(input.toolFailureCount),
      blockedApprovalCount: normalizeNonNegativeInteger(input.blockedApprovalCount),
      inputTokens: normalizeOptionalNonNegativeInteger(input.inputTokens),
      outputTokens: normalizeOptionalNonNegativeInteger(input.outputTokens),
      totalTokens: normalizeOptionalNonNegativeInteger(input.totalTokens),
      startedAt: input.startedAt,
      completedAt: input.completedAt ?? null,
      durationMs: normalizeOptionalNonNegativeInteger(input.durationMs),
      contextEngineId: input.contextEngineId?.trim() || null,
      contextEngineStatus: normalizeOptionalJsonObject(input.contextEngineStatus),
      createdAt: now,
      updatedAt: now,
    };
    const existing = this.getRunMetrics(record.runId);

    if (existing) {
      this.database
        .prepare(
          [
            "UPDATE run_metrics SET",
            "model_profiles = ?, turn_count = ?, tool_call_count = ?, tool_success_count = ?,",
            "tool_failure_count = ?, blocked_approval_count = ?, input_tokens = ?, output_tokens = ?,",
            "total_tokens = ?, started_at = ?, completed_at = ?, duration_ms = ?, context_engine_id = ?, context_engine_status_json = ?, updated_at = ?",
            "WHERE run_id = ?",
          ].join(" "),
        )
        .run(
          JSON.stringify(record.modelProfiles),
          record.turnCount,
          record.toolCallCount,
          record.toolSuccessCount,
          record.toolFailureCount,
          record.blockedApprovalCount,
          record.inputTokens,
          record.outputTokens,
          record.totalTokens,
          record.startedAt,
          record.completedAt,
          record.durationMs,
          record.contextEngineId,
          record.contextEngineStatus ? JSON.stringify(record.contextEngineStatus) : null,
          now,
          record.runId,
        );
    } else {
      this.database
        .prepare(
          [
            "INSERT INTO run_metrics (",
            "run_id, model_profiles, turn_count, tool_call_count, tool_success_count, tool_failure_count,",
            "blocked_approval_count, input_tokens, output_tokens, total_tokens, started_at, completed_at, duration_ms, context_engine_id, context_engine_status_json, created_at, updated_at",
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ].join(" "),
        )
        .run(
          record.runId,
          JSON.stringify(record.modelProfiles),
          record.turnCount,
          record.toolCallCount,
          record.toolSuccessCount,
          record.toolFailureCount,
          record.blockedApprovalCount,
          record.inputTokens,
          record.outputTokens,
          record.totalTokens,
          record.startedAt,
          record.completedAt,
          record.durationMs,
          record.contextEngineId,
          record.contextEngineStatus ? JSON.stringify(record.contextEngineStatus) : null,
          record.createdAt,
          record.updatedAt,
        );
    }

    const updated = this.getRunMetrics(record.runId);
    if (!updated) {
      throw new Error(`Run metrics for ${record.runId} were not persisted.`);
    }
    return updated;
  }

  public getRunMetrics(runId: string): RunMetricsRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        [
          "SELECT run_id AS runId, model_profiles AS modelProfiles, turn_count AS turnCount,",
          "tool_call_count AS toolCallCount, tool_success_count AS toolSuccessCount,",
          "tool_failure_count AS toolFailureCount, blocked_approval_count AS blockedApprovalCount,",
          "input_tokens AS inputTokens, output_tokens AS outputTokens, total_tokens AS totalTokens,",
          "started_at AS startedAt, completed_at AS completedAt, duration_ms AS durationMs,",
          "context_engine_id AS contextEngineId, context_engine_status_json AS contextEngineStatusJson,",
          "created_at AS createdAt, updated_at AS updatedAt",
          "FROM run_metrics WHERE run_id = ?",
        ].join(" "),
      )
      .get(runId) as unknown | undefined;
    return row ? mapRunMetricsRow(row) : null;
  }

  public summarizeThreadUsage(threadId: string): ThreadUsageSummary | null {
    this.initialize();
    const rows = this.database
      .prepare(
        [
          "SELECT",
          "  t.id AS threadId,",
          "  rm.run_id AS runId,",
          "  rm.model_profiles AS modelProfiles,",
          "  rm.turn_count AS turnCount,",
          "  rm.tool_call_count AS toolCallCount,",
          "  rm.tool_success_count AS toolSuccessCount,",
          "  rm.tool_failure_count AS toolFailureCount,",
          "  rm.blocked_approval_count AS blockedApprovalCount,",
          "  rm.input_tokens AS inputTokens,",
          "  rm.output_tokens AS outputTokens,",
          "  rm.total_tokens AS totalTokens,",
          "  rm.started_at AS startedAt,",
          "  rm.completed_at AS completedAt,",
          "  rm.duration_ms AS durationMs,",
          "  rm.created_at AS createdAt,",
          "  rm.updated_at AS updatedAt",
          "FROM run_metrics rm",
          "INNER JOIN runs r ON rm.run_id = r.id",
          "INNER JOIN threads t ON t.id = r.thread_id",
          "WHERE t.id = ?",
          "ORDER BY rm.started_at ASC",
        ].join(" "),
      )
      .all(threadId) as unknown[];
    const summary = SqliteSessionStore.summarizeRunUsageRows(rows);
    if (!summary) {
      return null;
    }

    return {
      threadId,
      runCount: summary.runCount,
      modelProfiles: summary.modelProfiles,
      turnCount: summary.turnCount,
      toolCallCount: summary.toolCallCount,
      toolSuccessCount: summary.toolSuccessCount,
      toolFailureCount: summary.toolFailureCount,
      blockedApprovalCount: summary.blockedApprovalCount,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      totalTokens: summary.totalTokens,
      totalDurationMs: summary.totalDurationMs,
      firstStartedAt: summary.firstStartedAt,
      lastCompletedAt: summary.lastCompletedAt,
    };
  }

  public summarizeWorkspaceUsage(workspaceId: string): WorkspaceUsageSummary | null {
    this.initialize();
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace) {
      return null;
    }

    const rows = this.database
      .prepare(
        [
          "SELECT",
          "  t.id AS threadId,",
          "  rm.run_id AS runId,",
          "  rm.model_profiles AS modelProfiles,",
          "  rm.turn_count AS turnCount,",
          "  rm.tool_call_count AS toolCallCount,",
          "  rm.tool_success_count AS toolSuccessCount,",
          "  rm.tool_failure_count AS toolFailureCount,",
          "  rm.blocked_approval_count AS blockedApprovalCount,",
          "  rm.input_tokens AS inputTokens,",
          "  rm.output_tokens AS outputTokens,",
          "  rm.total_tokens AS totalTokens,",
          "  rm.started_at AS startedAt,",
          "  rm.completed_at AS completedAt,",
          "  rm.duration_ms AS durationMs,",
          "  rm.created_at AS createdAt,",
          "  rm.updated_at AS updatedAt",
          "FROM run_metrics rm",
          "INNER JOIN runs r ON rm.run_id = r.id",
          "INNER JOIN threads t ON t.id = r.thread_id",
          "WHERE t.workspace_id = ?",
          "ORDER BY rm.started_at ASC",
        ].join(" "),
      )
      .all(workspaceId) as unknown[];
    const summary = SqliteSessionStore.summarizeRunUsageRows(rows);
    if (!summary) {
      return null;
    }

    return {
      workspaceId,
      workspaceName: workspace.name,
      threadCount: summary.threadCount,
      runCount: summary.runCount,
      modelProfiles: summary.modelProfiles,
      turnCount: summary.turnCount,
      toolCallCount: summary.toolCallCount,
      toolSuccessCount: summary.toolSuccessCount,
      toolFailureCount: summary.toolFailureCount,
      blockedApprovalCount: summary.blockedApprovalCount,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      totalTokens: summary.totalTokens,
      totalDurationMs: summary.totalDurationMs,
      firstStartedAt: summary.firstStartedAt,
      lastCompletedAt: summary.lastCompletedAt,
    };
  }

  public summarizeAgentUsage(agentId: string): AgentUsageSummary | null {
    this.initialize();
    const agent = this.getAgent(agentId);
    if (!agent) {
      return null;
    }
    const workspace = agent.workspaceId ? this.getWorkspace(agent.workspaceId) : null;
    const rows = this.database
      .prepare(
        [
          "SELECT",
          "  t.id AS threadId,",
          "  t.workspace_id AS workspaceId,",
          "  rm.run_id AS runId,",
          "  rm.model_profiles AS modelProfiles,",
          "  rm.turn_count AS turnCount,",
          "  rm.tool_call_count AS toolCallCount,",
          "  rm.tool_success_count AS toolSuccessCount,",
          "  rm.tool_failure_count AS toolFailureCount,",
          "  rm.blocked_approval_count AS blockedApprovalCount,",
          "  rm.input_tokens AS inputTokens,",
          "  rm.output_tokens AS outputTokens,",
          "  rm.total_tokens AS totalTokens,",
          "  rm.started_at AS startedAt,",
          "  rm.completed_at AS completedAt,",
          "  rm.duration_ms AS durationMs,",
          "  rm.context_engine_id AS contextEngineId,",
          "  rm.context_engine_status_json AS contextEngineStatusJson,",
          "  rm.created_at AS createdAt,",
          "  rm.updated_at AS updatedAt",
          "FROM runs r",
          "INNER JOIN run_metrics rm ON rm.run_id = r.id",
          "INNER JOIN threads t ON t.id = r.thread_id",
          "WHERE r.agent_id = ?",
        ].join(" "),
      )
      .all(agentId) as unknown[];
    const summary = SqliteSessionStore.summarizeRunUsageRows(rows);
    if (!summary) {
      return null;
    }
    return {
      agentId: agent.id,
      workspaceId: workspace?.id ?? agent.workspaceId,
      workspaceName: workspace?.name ?? basename(agent.cwd),
      threadCount: summary.threadCount,
      runCount: summary.runCount,
      modelProfiles: summary.modelProfiles,
      turnCount: summary.turnCount,
      toolCallCount: summary.toolCallCount,
      toolSuccessCount: summary.toolSuccessCount,
      toolFailureCount: summary.toolFailureCount,
      blockedApprovalCount: summary.blockedApprovalCount,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      totalTokens: summary.totalTokens,
      totalDurationMs: summary.totalDurationMs,
      firstStartedAt: summary.firstStartedAt,
      lastCompletedAt: summary.lastCompletedAt,
    };
  }

  public summarizeGlobalUsage(): GlobalUsageSummary {
    this.initialize();
    const rows = this.database
      .prepare(
        [
          "SELECT",
          "  t.id AS threadId,",
          "  t.workspace_id AS workspaceId,",
          "  rm.run_id AS runId,",
          "  rm.model_profiles AS modelProfiles,",
          "  rm.turn_count AS turnCount,",
          "  rm.tool_call_count AS toolCallCount,",
          "  rm.tool_success_count AS toolSuccessCount,",
          "  rm.tool_failure_count AS toolFailureCount,",
          "  rm.blocked_approval_count AS blockedApprovalCount,",
          "  rm.input_tokens AS inputTokens,",
          "  rm.output_tokens AS outputTokens,",
          "  rm.total_tokens AS totalTokens,",
          "  rm.started_at AS startedAt,",
          "  rm.completed_at AS completedAt,",
          "  rm.duration_ms AS durationMs,",
          "  rm.created_at AS createdAt,",
          "  rm.updated_at AS updatedAt",
          "FROM run_metrics rm",
          "INNER JOIN runs r ON rm.run_id = r.id",
          "INNER JOIN threads t ON t.id = r.thread_id",
          "ORDER BY rm.started_at ASC",
        ].join(" "),
      )
      .all() as unknown[];
    const summary = SqliteSessionStore.summarizeRunUsageRows(rows);
    if (!summary) {
      return {
        workspaceCount: 0,
        threadCount: 0,
        runCount: 0,
        modelProfiles: [],
        turnCount: 0,
        toolCallCount: 0,
        toolSuccessCount: 0,
        toolFailureCount: 0,
        blockedApprovalCount: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        totalDurationMs: null,
        firstStartedAt: null,
        lastCompletedAt: null,
      };
    }

    return {
      workspaceCount: summary.workspaceCount,
      threadCount: summary.threadCount,
      runCount: summary.runCount,
      modelProfiles: summary.modelProfiles,
      turnCount: summary.turnCount,
      toolCallCount: summary.toolCallCount,
      toolSuccessCount: summary.toolSuccessCount,
      toolFailureCount: summary.toolFailureCount,
      blockedApprovalCount: summary.blockedApprovalCount,
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      totalTokens: summary.totalTokens,
      totalDurationMs: summary.totalDurationMs,
      firstStartedAt: summary.firstStartedAt,
      lastCompletedAt: summary.lastCompletedAt,
    };
  }

  private static summarizeRunUsageRows(rows: readonly unknown[]): {
    readonly workspaceCount: number;
    readonly threadCount: number;
    readonly runCount: number;
    readonly modelProfiles: string[];
    readonly turnCount: number;
    readonly toolCallCount: number;
    readonly toolSuccessCount: number;
    readonly toolFailureCount: number;
    readonly blockedApprovalCount: number;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly totalTokens: number | null;
    readonly totalDurationMs: number | null;
    readonly firstStartedAt: string | null;
    readonly lastCompletedAt: string | null;
  } {
    if (rows.length === 0) {
      return {
        workspaceCount: 0,
        threadCount: 0,
        runCount: 0,
        modelProfiles: [],
        turnCount: 0,
        toolCallCount: 0,
        toolSuccessCount: 0,
        toolFailureCount: 0,
        blockedApprovalCount: 0,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        totalDurationMs: null,
        firstStartedAt: null,
        lastCompletedAt: null,
      };
    }

    const threadIds = new Set<string>();
    const workspaceIds = new Set<string>();
    const modelProfiles = new Set<string>();
    let turnCount = 0;
    let toolCallCount = 0;
    let toolSuccessCount = 0;
    let toolFailureCount = 0;
    let blockedApprovalCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let totalDurationMs = 0;
    let hasInputTokens = false;
    let hasOutputTokens = false;
    let hasTotalTokens = false;
    let hasDuration = false;
    let firstStartedAt: string | null = null;
    let lastCompletedAt: string | null = null;

    for (const rawRow of rows) {
      const row = rawRow as { threadId?: string | null; workspaceId?: string | null };
      if (row.threadId) {
        threadIds.add(row.threadId);
      }
      if (row.workspaceId) {
        workspaceIds.add(row.workspaceId);
      }

      const metric = mapRunMetricsRow(rawRow);
      for (const profileId of metric.modelProfiles) {
        modelProfiles.add(profileId);
      }
      turnCount += metric.turnCount;
      toolCallCount += metric.toolCallCount;
      toolSuccessCount += metric.toolSuccessCount;
      toolFailureCount += metric.toolFailureCount;
      blockedApprovalCount += metric.blockedApprovalCount;
      if (metric.inputTokens !== null) {
        inputTokens += metric.inputTokens;
        hasInputTokens = true;
      }
      if (metric.outputTokens !== null) {
        outputTokens += metric.outputTokens;
        hasOutputTokens = true;
      }
      if (metric.totalTokens !== null) {
        totalTokens += metric.totalTokens;
        hasTotalTokens = true;
      }
      if (metric.durationMs !== null) {
        totalDurationMs += metric.durationMs;
        hasDuration = true;
      }
      if (!firstStartedAt || metric.startedAt < firstStartedAt) {
        firstStartedAt = metric.startedAt;
      }
      if (metric.completedAt && (!lastCompletedAt || metric.completedAt > lastCompletedAt)) {
        lastCompletedAt = metric.completedAt;
      }
    }

    return {
      workspaceCount: workspaceIds.size,
      threadCount: threadIds.size,
      runCount: rows.length,
      modelProfiles: Array.from(modelProfiles).sort(),
      turnCount,
      toolCallCount,
      toolSuccessCount,
      toolFailureCount,
      blockedApprovalCount,
      inputTokens: hasInputTokens ? inputTokens : null,
      outputTokens: hasOutputTokens ? outputTokens : null,
      totalTokens: hasTotalTokens ? totalTokens : null,
      totalDurationMs: hasDuration ? totalDurationMs : null,
      firstStartedAt,
      lastCompletedAt,
    };
  }

  public appendMessage(input: {
    readonly threadId: string;
    readonly runId: string | null;
    readonly role: MessageRecord["role"];
    readonly text: string;
  }): MessageRecord {
    this.initialize();
    const record: MessageRecord = {
      id: randomUUID(),
      threadId: input.threadId,
      runId: input.runId,
      role: input.role,
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare("INSERT INTO messages (id, thread_id, run_id, role, text, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.id, record.threadId, record.runId, record.role, record.text, record.createdAt);
    this.touchThread(record.threadId);
    this.syncMessageSearchRecord(record);
    return record;
  }

  public recordToolEvent(input: {
    readonly runId: string;
    readonly toolCallId?: string | null;
    readonly toolName: string;
    readonly riskTier: number;
    readonly status: string;
    readonly summary: string;
    readonly outputPreview?: string | null;
    readonly outputTruncated?: boolean;
    readonly storedOutputRef?: string | null;
    readonly presentation?: unknown;
  }): ToolEventRecord {
    this.initialize();
    const record: ToolEventRecord = {
      id: randomUUID(),
      runId: input.runId,
      toolCallId: input.toolCallId?.trim() || null,
      toolName: input.toolName,
      riskTier: input.riskTier,
      status: input.status,
      summary: redactSensitiveText(input.summary),
      outputPreview: input.outputPreview ? redactSensitiveText(input.outputPreview) : null,
      outputTruncated: input.outputTruncated ?? false,
      storedOutputRef: input.storedOutputRef ?? null,
      presentation: normalizeOptionalUnknownJsonObject(input.presentation),
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare(
        "INSERT INTO tool_events (id, run_id, tool_call_id, tool_name, risk_tier, status, summary, output_preview, output_truncated, stored_output_ref, presentation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.runId,
        record.toolCallId,
        record.toolName,
        record.riskTier,
        record.status,
        record.summary,
        record.outputPreview,
        record.outputTruncated ? 1 : 0,
        record.storedOutputRef,
        serializeOptionalJsonObject(record.presentation),
        record.createdAt,
      );
    return record;
  }

  public addArtifact(input: {
    readonly runId: string;
    readonly kind: string;
    readonly path: string;
    readonly summary: string;
  }): ArtifactRecord {
    this.initialize();
    const record: ArtifactRecord = {
      id: randomUUID(),
      runId: input.runId,
      kind: input.kind,
      path: input.path,
      summary: redactSensitiveText(input.summary),
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare("INSERT INTO artifacts (id, run_id, kind, path, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.id, record.runId, record.kind, record.path, record.summary, record.createdAt);
    return record;
  }

  public addArtifactContent(input: {
    readonly runId: string;
    readonly kind: string;
    readonly content: string;
    readonly summary: string;
    readonly extension?: string;
  }): ArtifactRecord {
    this.initialize();
    const id = randomUUID();
    const runDir = join(this.artifactsRoot, "runs", sanitizeSegment(input.runId));
    mkdirSync(runDir, { recursive: true });
    const extension = sanitizeSegment(input.extension ?? "json");
    const path = join(runDir, `${id}.${extension || "json"}`);
    writeFileSync(path, redactSensitiveText(input.content), "utf8");
    const record: ArtifactRecord = {
      id,
      runId: input.runId,
      kind: input.kind,
      path,
      summary: redactSensitiveText(input.summary),
      createdAt: new Date().toISOString(),
    };
    this.database
      .prepare("INSERT INTO artifacts (id, run_id, kind, path, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.id, record.runId, record.kind, record.path, record.summary, record.createdAt);
    return record;
  }

  public addAgentRunArtifact(input: {
    readonly runId: string;
    readonly taskContract?: Partial<AgentRunTaskContractArtifact>;
    readonly toolTrace?: readonly AgentRunToolTraceArtifact[];
    readonly approvals?: readonly AgentRunApprovalArtifact[];
    readonly diff?: AgentRunDiffArtifact | null;
    readonly verification?: Partial<AgentRunVerificationArtifact> | null;
    readonly summary?: Partial<AgentRunSummaryArtifact> | null;
    readonly artifactSummary?: string;
  }): ArtifactRecord {
    this.initialize();
    const run = this.getRun(input.runId);
    if (!run) {
      throw new Error(`Run ${input.runId} was not found.`);
    }
    const payload: AgentRunArtifactPayload = normalizeAgentRunArtifactPayload({
      run,
      createdAt: new Date().toISOString(),
      toolTrace: input.toolTrace ?? this.listRunToolEvents(input.runId),
      taskContract: input.taskContract,
      approvals: input.approvals,
      diff: input.diff,
      verification: input.verification,
      summary: input.summary,
    });
    return this.addArtifactContent({
      runId: input.runId,
      kind: "agent-run",
      content: JSON.stringify(payload, null, 2),
      summary: input.artifactSummary ?? `Agent run artifact for ${run.objective}`,
      extension: "json",
    });
  }

  public upsertSubagentJob(input: PersistedSubagentJobRecord): PersistedSubagentJobRecord {
    this.initialize();
    this.database
      .prepare(
        [
          "INSERT INTO subagent_jobs (",
          "id, workspace_id, parent_thread_id, parent_run_id, objective, session_mode, role, mode, outcome_visibility, authority, status,",
          "root_job_id, parent_job_id, depth, max_depth, max_concurrent_children, child_job_ids, execution_domain,",
          "budget_max_iterations, budget_timeout_ms, budget_max_retries, plugin_dirs, allowed_tools, returned_artifact_kinds,",
          "target_paths, tool_policy_trace, attempts, created_at, queued_at, started_at, completed_at, blocked_reason, blocked_by_job_ids, blocked_paths, paused_from_status, queue_position,",
          "updated_at, messages_json, thread_id, run_id, final_response, error, completion_json, progress_events_json",
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          "ON CONFLICT(id) DO UPDATE SET",
          "workspace_id = excluded.workspace_id,",
          "parent_thread_id = excluded.parent_thread_id,",
          "parent_run_id = excluded.parent_run_id,",
          "objective = excluded.objective,",
          "session_mode = excluded.session_mode,",
          "role = excluded.role,",
          "mode = excluded.mode,",
          "outcome_visibility = excluded.outcome_visibility,",
          "authority = excluded.authority,",
          "status = excluded.status,",
          "root_job_id = excluded.root_job_id,",
          "parent_job_id = excluded.parent_job_id,",
          "depth = excluded.depth,",
          "max_depth = excluded.max_depth,",
          "max_concurrent_children = excluded.max_concurrent_children,",
          "child_job_ids = excluded.child_job_ids,",
          "execution_domain = excluded.execution_domain,",
          "budget_max_iterations = excluded.budget_max_iterations,",
          "budget_timeout_ms = excluded.budget_timeout_ms,",
          "budget_max_retries = excluded.budget_max_retries,",
          "plugin_dirs = excluded.plugin_dirs,",
          "allowed_tools = excluded.allowed_tools,",
          "returned_artifact_kinds = excluded.returned_artifact_kinds,",
          "target_paths = excluded.target_paths,",
          "tool_policy_trace = excluded.tool_policy_trace,",
          "attempts = excluded.attempts,",
          "created_at = excluded.created_at,",
          "queued_at = excluded.queued_at,",
          "started_at = excluded.started_at,",
          "completed_at = excluded.completed_at,",
          "blocked_reason = excluded.blocked_reason,",
          "blocked_by_job_ids = excluded.blocked_by_job_ids,",
          "blocked_paths = excluded.blocked_paths,",
          "paused_from_status = excluded.paused_from_status,",
          "queue_position = excluded.queue_position,",
          "updated_at = excluded.updated_at,",
          "messages_json = excluded.messages_json,",
          "thread_id = excluded.thread_id,",
          "run_id = excluded.run_id,",
          "final_response = excluded.final_response,",
          "error = excluded.error,",
          "completion_json = excluded.completion_json,",
          "progress_events_json = excluded.progress_events_json",
        ].join(" "),
      )
      .run(
        input.id,
        input.workspaceId,
        input.parentThreadId,
        input.parentRunId,
        input.objective,
        input.sessionMode,
        input.role ?? null,
        input.mode,
        input.outcomeVisibility,
        input.authority,
        input.status,
        input.rootJobId,
        input.parentJobId ?? null,
        input.depth,
        input.maxDepth,
        input.maxConcurrentChildren,
        JSON.stringify(input.childJobIds),
        input.executionDomain,
        input.budget.maxIterations,
        input.budget.timeoutMs,
        input.budget.maxRetries,
        input.pluginDirs ? JSON.stringify(input.pluginDirs) : null,
        input.allowedTools ? JSON.stringify(input.allowedTools) : null,
        input.returnedArtifactKinds ? JSON.stringify(input.returnedArtifactKinds) : null,
        input.targetPaths ? JSON.stringify(input.targetPaths) : null,
        input.toolPolicyTrace ? JSON.stringify(input.toolPolicyTrace) : null,
        input.attempts,
        input.createdAt,
        input.queuedAt,
        input.startedAt ?? null,
        input.completedAt ?? null,
        input.blockedReason ?? null,
        input.blockedByJobIds ? JSON.stringify(input.blockedByJobIds) : null,
        input.blockedPaths ? JSON.stringify(input.blockedPaths) : null,
        input.pausedFromStatus ?? null,
        input.queuePosition ?? null,
        input.updatedAt,
        JSON.stringify(input.messages),
        input.threadId ?? null,
        input.runId ?? null,
        input.finalResponse ?? null,
        input.error ?? null,
        input.completion ? JSON.stringify(input.completion) : null,
        input.progressEvents ? JSON.stringify(input.progressEvents) : null,
      );
    this.touchThread(input.parentThreadId);
    if (input.threadId && input.threadId !== input.parentThreadId) {
      this.touchThread(input.threadId);
    }
    const persisted = this.getSubagentJob(input.id);
    if (!persisted) {
      throw new Error(`Subagent job ${input.id} was not persisted.`);
    }
    return persisted;
  }

  public getSubagentJob(jobId: string): PersistedSubagentJobRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        [
          "SELECT",
          "id, workspace_id AS workspaceId, parent_thread_id AS parentThreadId, parent_run_id AS parentRunId, objective, session_mode AS sessionMode, role,",
          "mode, outcome_visibility AS outcomeVisibility, authority, status, root_job_id AS rootJobId,",
          "parent_job_id AS parentJobId, depth, max_depth AS maxDepth,",
          "max_concurrent_children AS maxConcurrentChildren, child_job_ids AS childJobIds, execution_domain AS executionDomain,",
          "budget_max_iterations AS budgetMaxIterations, budget_timeout_ms AS budgetTimeoutMs,",
          "budget_max_retries AS budgetMaxRetries, plugin_dirs AS pluginDirs, allowed_tools AS allowedTools,",
          "returned_artifact_kinds AS returnedArtifactKinds, target_paths AS targetPaths, tool_policy_trace AS toolPolicyTrace, attempts, created_at AS createdAt,",
          "queued_at AS queuedAt, started_at AS startedAt, completed_at AS completedAt, blocked_reason AS blockedReason, blocked_by_job_ids AS blockedByJobIds, blocked_paths AS blockedPaths, paused_from_status AS pausedFromStatus,",
          "queue_position AS queuePosition, updated_at AS updatedAt, messages_json AS messagesJson, thread_id AS threadId,",
          "run_id AS runId, final_response AS finalResponse, error, completion_json AS completionJson, progress_events_json AS progressEventsJson",
          "FROM subagent_jobs WHERE id = ?",
        ].join(" "),
      )
      .get(jobId) as unknown | undefined;
    return row ? mapSubagentJobRow(row) : null;
  }

  public listSubagentJobs(input: {
    readonly workspaceId?: string;
    readonly threadId?: string;
    readonly runId?: string;
    readonly parentThreadId?: string;
    readonly parentRunId?: string;
    readonly rootJobId?: string;
    readonly statuses?: readonly PersistedSubagentJobStatus[];
    readonly limit?: number;
  } = {}): PersistedSubagentJobRecord[] {
    this.initialize();
    const whereClauses: string[] = [];
    const params: string[] = [];

    if (input.workspaceId) {
      whereClauses.push("workspace_id = ?");
      params.push(input.workspaceId);
    }
    if (input.threadId) {
      whereClauses.push("(parent_thread_id = ? OR thread_id = ?)");
      params.push(input.threadId, input.threadId);
    }
    if (input.runId) {
      whereClauses.push("(parent_run_id = ? OR run_id = ?)");
      params.push(input.runId, input.runId);
    }
    if (input.parentThreadId) {
      whereClauses.push("parent_thread_id = ?");
      params.push(input.parentThreadId);
    }
    if (input.parentRunId) {
      whereClauses.push("parent_run_id = ?");
      params.push(input.parentRunId);
    }
    if (input.rootJobId) {
      whereClauses.push("root_job_id = ?");
      params.push(input.rootJobId);
    }
    const statuses = Array.from(new Set((input.statuses ?? []).map((entry) => entry.trim()).filter(Boolean)));
    if (statuses.length > 0) {
      whereClauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }

    const rows = this.database
      .prepare(
        [
          "SELECT",
          "id, workspace_id AS workspaceId, parent_thread_id AS parentThreadId, parent_run_id AS parentRunId, objective, session_mode AS sessionMode, role,",
          "mode, outcome_visibility AS outcomeVisibility, authority, status, root_job_id AS rootJobId,",
          "parent_job_id AS parentJobId, depth, max_depth AS maxDepth,",
          "max_concurrent_children AS maxConcurrentChildren, child_job_ids AS childJobIds, execution_domain AS executionDomain,",
          "budget_max_iterations AS budgetMaxIterations, budget_timeout_ms AS budgetTimeoutMs,",
          "budget_max_retries AS budgetMaxRetries, plugin_dirs AS pluginDirs, allowed_tools AS allowedTools,",
          "returned_artifact_kinds AS returnedArtifactKinds, target_paths AS targetPaths, tool_policy_trace AS toolPolicyTrace, attempts, created_at AS createdAt,",
          "queued_at AS queuedAt, started_at AS startedAt, completed_at AS completedAt, blocked_reason AS blockedReason, blocked_by_job_ids AS blockedByJobIds, blocked_paths AS blockedPaths, paused_from_status AS pausedFromStatus,",
          "queue_position AS queuePosition, updated_at AS updatedAt, messages_json AS messagesJson, thread_id AS threadId,",
          "run_id AS runId, final_response AS finalResponse, error, completion_json AS completionJson, progress_events_json AS progressEventsJson",
          "FROM subagent_jobs",
          whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "",
          "ORDER BY updated_at DESC LIMIT ?",
        ].join(" "),
      )
      .all(...params, normalizeLimit(input.limit, 100)) as unknown[];
    return rows.map((row) => mapSubagentJobRow(row));
  }

  public listAgentSubagentJobs(agentId: string, limit = 100): PersistedSubagentJobRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        [
          "SELECT",
          "s.id, s.workspace_id AS workspaceId, s.parent_thread_id AS parentThreadId, s.parent_run_id AS parentRunId, s.objective, s.session_mode AS sessionMode, s.role,",
          "s.mode, s.outcome_visibility AS outcomeVisibility, s.authority, s.status, s.root_job_id AS rootJobId,",
          "s.parent_job_id AS parentJobId, s.depth, s.max_depth AS maxDepth,",
          "s.max_concurrent_children AS maxConcurrentChildren, s.child_job_ids AS childJobIds, s.execution_domain AS executionDomain,",
          "s.budget_max_iterations AS budgetMaxIterations, s.budget_timeout_ms AS budgetTimeoutMs,",
          "s.budget_max_retries AS budgetMaxRetries, s.plugin_dirs AS pluginDirs, s.allowed_tools AS allowedTools,",
          "s.returned_artifact_kinds AS returnedArtifactKinds, s.target_paths AS targetPaths, s.tool_policy_trace AS toolPolicyTrace, s.attempts, s.created_at AS createdAt,",
          "s.queued_at AS queuedAt, s.started_at AS startedAt, s.completed_at AS completedAt, s.blocked_reason AS blockedReason, s.blocked_by_job_ids AS blockedByJobIds, s.blocked_paths AS blockedPaths, s.paused_from_status AS pausedFromStatus,",
          "s.queue_position AS queuePosition, s.updated_at AS updatedAt, s.messages_json AS messagesJson, s.thread_id AS threadId,",
          "s.run_id AS runId, s.final_response AS finalResponse, s.error, s.completion_json AS completionJson, s.progress_events_json AS progressEventsJson",
          "FROM subagent_jobs s",
          "INNER JOIN runs r ON r.id = s.parent_run_id",
          "WHERE r.agent_id = ?",
          "ORDER BY s.updated_at DESC LIMIT ?",
        ].join(" "),
      )
      .all(agentId, normalizeLimit(limit, 100)) as unknown[];
    return rows.map((row) => mapSubagentJobRow(row));
  }

  public listFileLeases(input: {
    readonly workspaceId?: string;
    readonly ownerJobId?: string;
    readonly statuses?: ReadonlyArray<"active" | "released">;
    readonly limit?: number;
  } = {}): FileLeaseRecord[] {
    this.initialize();
    const whereClauses: string[] = [];
    const params: string[] = [];
    if (input.workspaceId) {
      whereClauses.push("workspace_id = ?");
      params.push(input.workspaceId);
    }
    if (input.ownerJobId) {
      whereClauses.push("owner_job_id = ?");
      params.push(input.ownerJobId);
    }
    const statuses = Array.from(new Set((input.statuses ?? []).map((entry) => entry.trim()).filter(Boolean)));
    if (statuses.length > 0) {
      whereClauses.push(`status IN (${statuses.map(() => "?").join(", ")})`);
      params.push(...statuses);
    }
    const rows = this.database
      .prepare(
        [
          "SELECT id, workspace_id AS workspaceId, path, owner_job_id AS ownerJobId, owner_thread_id AS ownerThreadId,",
          "owner_run_id AS ownerRunId, status, created_at AS createdAt, updated_at AS updatedAt, released_at AS releasedAt",
          "FROM file_leases",
          whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "",
          "ORDER BY updated_at DESC LIMIT ?",
        ].join(" "),
      )
      .all(...params, normalizeLimit(input.limit, 200)) as unknown[];
    return rows.map((row) => mapFileLeaseRow(row));
  }

  public acquireFileLeases(input: {
    readonly workspaceId: string;
    readonly ownerJobId: string;
    readonly ownerThreadId: string;
    readonly ownerRunId: string;
    readonly paths: readonly string[];
  }): FileLeaseRecord[] {
    this.initialize();
    const normalizedPaths = Array.from(new Set(input.paths.map(normalizeLeasePath).filter(Boolean)));
    if (normalizedPaths.length === 0) {
      return [];
    }
    const conflicts = this.findFileLeaseConflicts({
      workspaceId: input.workspaceId,
      ownerJobId: input.ownerJobId,
      paths: normalizedPaths,
    });
    if (conflicts.length > 0) {
      const conflictPaths = conflicts.map((row) => row.path);
      throw new Error(`File lease conflict for ${conflictPaths.join(", ")}.`);
    }

    const now = new Date().toISOString();
    for (const leasePath of normalizedPaths) {
      const existing = this.database
        .prepare(
          "SELECT id FROM file_leases WHERE workspace_id = ? AND path = ? AND owner_job_id = ? AND status = 'active' LIMIT 1",
        )
        .get(input.workspaceId, leasePath, input.ownerJobId) as { id?: string } | undefined;
      if (existing?.id) {
        this.database
          .prepare("UPDATE file_leases SET updated_at = ?, released_at = NULL WHERE id = ?")
          .run(now, existing.id);
        continue;
      }
      this.database
        .prepare(
          "INSERT INTO file_leases (id, workspace_id, path, owner_job_id, owner_thread_id, owner_run_id, status, created_at, updated_at, released_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)",
        )
        .run(randomUUID(), input.workspaceId, leasePath, input.ownerJobId, input.ownerThreadId, input.ownerRunId, now, now);
    }
    return this.listFileLeases({
      workspaceId: input.workspaceId,
      ownerJobId: input.ownerJobId,
      statuses: ["active"],
      limit: normalizedPaths.length,
    }).filter((record) => normalizedPaths.includes(record.path));
  }

  public releaseFileLeasesForJob(ownerJobId: string): number {
    this.initialize();
    const now = new Date().toISOString();
    const result = this.database
      .prepare("UPDATE file_leases SET status = 'released', released_at = ?, updated_at = ? WHERE owner_job_id = ? AND status = 'active'")
      .run(now, now, ownerJobId) as { changes?: number };
    return Number(result.changes ?? 0);
  }

  public findFileLeaseConflicts(input: {
    readonly workspaceId: string;
    readonly ownerJobId: string;
    readonly paths: readonly string[];
  }): FileLeaseRecord[] {
    this.initialize();
    const normalizedPaths = Array.from(new Set(input.paths.map(normalizeLeasePath).filter(Boolean)));
    if (normalizedPaths.length === 0) {
      return [];
    }
    const placeholders = normalizedPaths.map(() => "?").join(", ");
    const rows = this.database
      .prepare(
        [
          "SELECT id, workspace_id AS workspaceId, path, owner_job_id AS ownerJobId, owner_thread_id AS ownerThreadId,",
          "owner_run_id AS ownerRunId, status, created_at AS createdAt, updated_at AS updatedAt, released_at AS releasedAt",
          "FROM file_leases WHERE workspace_id = ? AND status = 'active' AND path IN (",
          placeholders,
          ") AND owner_job_id != ?",
        ].join(" "),
      )
      .all(input.workspaceId, ...normalizedPaths, input.ownerJobId) as unknown[];
    return rows.map((row) => mapFileLeaseRow(row));
  }

  public addMemory(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly threadId?: string | null;
    readonly scope: MemoryScope;
    readonly content: string;
    readonly tags?: string[];
  }): MemoryRecord {
    this.initialize();
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      agentId: normalizeAgentId(input.agentId),
      threadId: input.threadId ?? null,
      scope: input.scope,
      content: redactSensitiveText(input.content).trim(),
      tags: normalizeTags(input.tags),
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        "INSERT INTO memories (id, workspace_id, agent_id, thread_id, scope, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.workspaceId,
        record.agentId,
        record.threadId,
        record.scope,
        record.content,
        JSON.stringify(record.tags),
        record.createdAt,
        record.updatedAt,
      );
    this.syncMemorySearchRecord(record);
    return record;
  }

  public listMemories(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly threadId?: string | null;
    readonly scope?: MemoryScope;
    readonly limit?: number;
  }): MemoryRecord[] {
    this.initialize();
    const limit = normalizeLimit(input.limit, 20);
    const rows = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, thread_id AS threadId, scope, content, tags, created_at AS createdAt, updated_at AS updatedAt FROM memories WHERE workspace_id = ? AND (? IS NULL OR agent_id = ?) AND (? IS NULL OR scope = ?) ORDER BY updated_at DESC LIMIT ?",
      )
      .all(
        input.workspaceId,
        normalizeAgentId(input.agentId),
        normalizeAgentId(input.agentId),
        input.scope ?? null,
        input.scope ?? null,
        limit * 5,
      ) as unknown[];
    return rows
      .map((row) => mapMemoryRow(row))
      .filter((row) => matchesMemoryScope(row, input))
      .slice(0, limit);
  }

  public searchMemories(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly threadId?: string | null;
    readonly scope?: MemoryScope;
    readonly query?: string;
    readonly limit?: number;
  }): MemoryRecord[] {
    this.initialize();
    const normalizedQuery = (input.query ?? "").trim();
    if (!normalizedQuery) {
      return this.listMemories(input);
    }

    const limit = normalizeLimit(input.limit, 10);
    const ftsRows = this.searchMemoriesWithFts(input, normalizedQuery);
    if (ftsRows && ftsRows.length > 0) {
      return ftsRows.filter((row) => matchesMemoryScope(row, input)).slice(0, limit);
    }

    const like = `%${normalizedQuery.replace(/\s+/g, "%")}%`;
    const rows = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, thread_id AS threadId, scope, content, tags, created_at AS createdAt, updated_at AS updatedAt FROM memories WHERE workspace_id = ? AND (? IS NULL OR agent_id = ?) AND (? IS NULL OR scope = ?) AND (content LIKE ? OR tags LIKE ?) ORDER BY updated_at DESC LIMIT ?",
      )
      .all(
        input.workspaceId,
        normalizeAgentId(input.agentId),
        normalizeAgentId(input.agentId),
        input.scope ?? null,
        input.scope ?? null,
        like,
        like,
        limit * 5,
      ) as unknown[];
    return rows
      .map((row) => mapMemoryRow(row))
      .filter((row) => matchesMemoryScope(row, input))
      .slice(0, limit);
  }

  public listAgentMemories(input: {
    readonly agentId: string;
    readonly query?: string;
    readonly limit?: number;
  }): MemoryRecord[] {
    this.initialize();
    const normalizedQuery = (input.query ?? "").trim();
    const limit = normalizeLimit(input.limit, 20);
    const like = normalizedQuery ? `%${normalizedQuery.replace(/\s+/g, "%")}%` : null;
    const rows = this.database
      .prepare(
        [
          "SELECT DISTINCT",
          "  m.id,",
          "  m.workspace_id AS workspaceId,",
          "  m.agent_id AS agentId,",
          "  m.thread_id AS threadId,",
          "  m.scope,",
          "  m.content,",
          "  m.tags,",
          "  m.created_at AS createdAt,",
          "  m.updated_at AS updatedAt",
          "FROM memories m",
          "LEFT JOIN runs r ON r.thread_id = m.thread_id",
          "WHERE (m.agent_id = ? OR (m.agent_id IS NULL AND r.agent_id = ?))",
          "  AND (? IS NULL OR m.content LIKE ? OR m.tags LIKE ?)",
          "ORDER BY m.updated_at DESC",
          "LIMIT ?",
        ].join(" "),
      )
      .all(input.agentId, input.agentId, like, like, like, limit) as unknown[];
    return rows.map((row) => mapMemoryRow(row));
  }

  public addProfileFact(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly content: string;
    readonly sourceRunId?: string | null;
    readonly tags?: string[];
  }): ProfileFactRecord {
    this.initialize();
    const now = new Date().toISOString();
    const record: ProfileFactRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      agentId: normalizeAgentId(input.agentId),
      sourceRunId: input.sourceRunId ?? null,
      content: redactSensitiveText(input.content).trim(),
      tags: normalizeTags(input.tags),
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        "INSERT INTO profile_facts (id, workspace_id, agent_id, source_run_id, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.workspaceId,
        record.agentId,
        record.sourceRunId,
        record.content,
        JSON.stringify(record.tags),
        record.createdAt,
        record.updatedAt,
      );
    this.syncProfileFactSearchRecord(record);
    return record;
  }

  public listProfileFacts(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly limit?: number;
  }): ProfileFactRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, source_run_id AS sourceRunId, content, tags, created_at AS createdAt, updated_at AS updatedAt FROM profile_facts WHERE workspace_id = ? AND (? IS NULL OR agent_id = ?) ORDER BY updated_at DESC LIMIT ?",
      )
      .all(input.workspaceId, normalizeAgentId(input.agentId), normalizeAgentId(input.agentId), normalizeLimit(input.limit, 20)) as unknown[];
    return rows.map((row) => mapProfileFactRow(row));
  }

  public searchProfileFacts(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly query?: string;
    readonly limit?: number;
  }): ProfileFactRecord[] {
    this.initialize();
    const normalizedQuery = (input.query ?? "").trim();
    if (!normalizedQuery) {
      return this.listProfileFacts(input);
    }

    const ftsRows = this.searchProfileFactsWithFts(input, normalizedQuery);
    if (ftsRows && ftsRows.length > 0) {
      return ftsRows;
    }

    const like = `%${normalizedQuery.replace(/\s+/g, "%")}%`;
    const rows = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, source_run_id AS sourceRunId, content, tags, created_at AS createdAt, updated_at AS updatedAt FROM profile_facts WHERE workspace_id = ? AND (? IS NULL OR agent_id = ?) AND (content LIKE ? OR tags LIKE ?) ORDER BY updated_at DESC LIMIT ?",
      )
      .all(input.workspaceId, normalizeAgentId(input.agentId), normalizeAgentId(input.agentId), like, like, normalizeLimit(input.limit, 10)) as unknown[];
    return rows.map((row) => mapProfileFactRow(row));
  }

  public listAgentProfileFacts(input: {
    readonly agentId: string;
    readonly query?: string;
    readonly limit?: number;
  }): ProfileFactRecord[] {
    this.initialize();
    return this.searchProfileFacts({
      workspaceId: this.getAgent(input.agentId)?.workspaceId ?? "",
      agentId: input.agentId,
      query: input.query,
      limit: input.limit,
    }).filter((entry) => entry.agentId === input.agentId);
  }

  public upsertThreadSummary(input: {
    readonly threadId: string;
    readonly workspaceId: string;
    readonly lastRunId?: string | null;
    readonly summary: string;
    readonly summaryVersion?: number;
    readonly summaryHash?: string;
    readonly handoff?: Readonly<Record<string, unknown>> | null;
  }): ThreadSummaryRecord {
    this.initialize();
    const now = new Date().toISOString();
    const normalizedSummary = redactSensitiveText(input.summary).trim();
    const normalizedSummaryVersion = Math.max(1, Math.trunc(input.summaryVersion ?? 1));
    const normalizedSummaryHash = input.summaryHash?.trim() || hashThreadSummary(normalizedSummary);
    const normalizedHandoff = normalizeThreadSummaryHandoff(redactSensitiveValue(input.handoff ?? null) as Readonly<Record<string, unknown>> | null);
    const existing = this.getThreadSummary(input.threadId);
    if (existing) {
      this.database
        .prepare(
          "UPDATE thread_summaries SET last_run_id = ?, summary = ?, summary_version = ?, summary_hash = ?, handoff_json = ?, updated_at = ? WHERE thread_id = ?",
        )
        .run(
          input.lastRunId ?? null,
          normalizedSummary,
          normalizedSummaryVersion,
          normalizedSummaryHash,
          normalizedHandoff ? JSON.stringify(normalizedHandoff) : null,
          now,
          input.threadId,
        );
    } else {
      this.database
        .prepare(
          "INSERT INTO thread_summaries (thread_id, workspace_id, last_run_id, summary, summary_version, summary_hash, handoff_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          input.threadId,
          input.workspaceId,
          input.lastRunId ?? null,
          normalizedSummary,
          normalizedSummaryVersion,
          normalizedSummaryHash,
          normalizedHandoff ? JSON.stringify(normalizedHandoff) : null,
          now,
          now,
        );
    }

    const record = this.getThreadSummary(input.threadId);
    if (!record) {
      throw new Error(`Thread summary for ${input.threadId} was not found after upsert.`);
    }
    return record;
  }

  public getThreadSummary(threadId: string): ThreadSummaryRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT thread_id AS threadId, workspace_id AS workspaceId, last_run_id AS lastRunId, summary, summary_version AS summaryVersion, summary_hash AS summaryHash, handoff_json AS handoffJson, created_at AS createdAt, updated_at AS updatedAt FROM thread_summaries WHERE thread_id = ?",
      )
      .get(threadId) as unknown;
    return row ? mapThreadSummaryRow(row) : null;
  }

  public listThreadSummaries(input: {
    readonly workspaceId: string;
    readonly limit?: number;
  }): ThreadSummaryRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        "SELECT thread_id AS threadId, workspace_id AS workspaceId, last_run_id AS lastRunId, summary, summary_version AS summaryVersion, summary_hash AS summaryHash, handoff_json AS handoffJson, created_at AS createdAt, updated_at AS updatedAt FROM thread_summaries WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?",
      )
      .all(input.workspaceId, normalizeLimit(input.limit, 20)) as unknown[];
    return rows.map((row) => mapThreadSummaryRow(row));
  }

  public searchSessions(input: {
    readonly workspaceId: string;
    readonly query: string;
    readonly limit?: number;
  }): SessionSearchResult[] {
    this.initialize();
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const ftsRows = this.searchSessionsWithFts(input, normalizedQuery);
    if (ftsRows && ftsRows.length > 0) {
      return ftsRows;
    }

    const like = `%${normalizedQuery.replace(/\s+/g, "%")}%`;
    const rows = this.database
      .prepare(
        [
          "SELECT m.id AS messageId, m.thread_id AS threadId, t.title AS threadTitle, m.run_id AS runId,",
          "m.role AS role, m.text AS text, m.created_at AS createdAt",
          "FROM messages m",
          "INNER JOIN threads t ON t.id = m.thread_id",
          "WHERE t.workspace_id = ? AND (m.text LIKE ? OR t.title LIKE ?)",
          "ORDER BY m.created_at DESC LIMIT ?",
        ].join(" "),
      )
      .all(input.workspaceId, like, like, normalizeLimit(input.limit, 10)) as unknown[];
    return rows.map((row) => mapSessionSearchRow(row, normalizedQuery));
  }

  public searchAgentSessions(input: {
    readonly agentId: string;
    readonly query: string;
    readonly limit?: number;
  }): SessionSearchResult[] {
    this.initialize();
    const normalizedQuery = input.query.trim();
    if (!normalizedQuery) {
      return [];
    }

    const like = `%${normalizedQuery.replace(/\s+/g, "%")}%`;
    const rows = this.database
      .prepare(
        [
          "SELECT DISTINCT m.id AS messageId, m.thread_id AS threadId, t.title AS threadTitle, m.run_id AS runId,",
          "m.role AS role, m.text AS text, m.created_at AS createdAt",
          "FROM messages m",
          "INNER JOIN threads t ON t.id = m.thread_id",
          "INNER JOIN runs r ON r.thread_id = t.id",
          "WHERE r.agent_id = ? AND (m.text LIKE ? OR t.title LIKE ?)",
          "ORDER BY m.created_at DESC LIMIT ?",
        ].join(" "),
      )
      .all(input.agentId, like, like, normalizeLimit(input.limit, 10)) as unknown[];
    return rows.map((row) => mapSessionSearchRow(row, normalizedQuery));
  }

  public addLearnedSkill(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly sourceRunId?: string | null;
    readonly sourceType?: LearnedSkillSourceType;
    readonly kind?: string;
    readonly dedupeKey?: string | null;
    readonly lifecycleState?: LearnedSkillRecord["lifecycleState"];
    readonly lifecycleReason?: string | null;
    readonly materializedSkillPath?: string | null;
    readonly title: string;
    readonly problemPattern: string;
    readonly guidance: string;
    readonly exampleObjective?: string | null;
    readonly changedFiles?: string[];
    readonly tags?: string[];
    readonly triggerSignals?: string[];
    readonly procedureSteps?: string[];
    readonly verificationStatus?: string;
    readonly verificationSummary?: string;
  }): LearnedSkillRecord {
    this.initialize();
    const now = new Date().toISOString();
    const kind = input.kind?.trim() || "procedure";
    const dedupeKey = input.dedupeKey?.trim() || null;
    const lifecycleState = normalizeLearnedSkillLifecycleState(input.lifecycleState);
    const lifecycleReason = input.lifecycleReason?.trim() || null;
    const materializedSkillPath = input.materializedSkillPath?.trim() || null;
    const title = input.title.trim();
    const problemPattern = input.problemPattern.trim();
    const guidance = input.guidance.trim();
    const exampleObjective = input.exampleObjective?.trim() || null;
    const changedFiles = normalizeTags(input.changedFiles);
    const tags = normalizeTags(input.tags);
    const triggerSignals = normalizeTags(input.triggerSignals);
    const procedureSteps = normalizeSteps(input.procedureSteps);
    const verificationStatus = input.verificationStatus?.trim() || "passed";
    const verificationSummary = input.verificationSummary?.trim() || "";
    const existing = this.findLearnedSkillForUpsert({
      workspaceId: input.workspaceId,
      kind,
      dedupeKey,
      title,
      problemPattern,
    });
    const sourceType = input.sourceType
      ? normalizeLearnedSkillSourceType(input.sourceType)
      : existing?.sourceType ?? "learned";
    const agentId = normalizeAgentId(input.agentId) ?? existing?.agentId ?? null;

    if (existing) {
      const mergedChangedFiles = normalizeTags([...existing.changedFiles, ...changedFiles]);
      const mergedTags = normalizeTags([...existing.tags, ...tags]);
      const mergedTriggerSignals = normalizeTags([...existing.triggerSignals, ...triggerSignals]);
      const mergedProcedureSteps = normalizeSteps(
        procedureSteps.length > 0 ? procedureSteps : existing.procedureSteps,
      );
      this.database
        .prepare(
          [
            "UPDATE learned_skills",
            "SET agent_id = ?, source_run_id = ?, source_type = ?, kind = ?, dedupe_key = ?, lifecycle_state = ?, lifecycle_reason = ?, materialized_skill_path = ?, guidance = ?, example_objective = ?, changed_files = ?, tags = ?,",
            "trigger_signals = ?, procedure_steps = ?, verification_status = ?, verification_summary = ?, revision_count = ?,",
            "last_verified_at = ?, updated_at = ?",
            "WHERE id = ?",
          ].join(" "),
        )
        .run(
          agentId,
          input.sourceRunId ?? existing.sourceRunId,
          sourceType,
          kind,
          dedupeKey ?? existing.dedupeKey,
          lifecycleState,
          lifecycleReason,
          materializedSkillPath ?? existing.materializedSkillPath,
          guidance,
          exampleObjective,
          JSON.stringify(mergedChangedFiles),
          JSON.stringify(mergedTags),
          JSON.stringify(mergedTriggerSignals),
          JSON.stringify(mergedProcedureSteps),
          verificationStatus,
          verificationSummary,
          existing.revisionCount + 1,
          verificationStatus === "passed" ? now : existing.lastVerifiedAt,
          now,
          existing.id,
        );
      const updated = this.getLearnedSkill(existing.id);
      if (!updated) {
        throw new Error(`Learned skill ${existing.id} was not found after update.`);
      }
      this.syncLearnedSkillSearchRecord(updated);
      return updated;
    }

    const record: LearnedSkillRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      agentId,
      sourceRunId: input.sourceRunId ?? null,
      sourceType,
      promotedFromSourceType: null,
      promotedAt: null,
      kind,
      dedupeKey,
      lifecycleState,
      lifecycleReason,
      materializedSkillPath,
      title,
      problemPattern,
      guidance,
      exampleObjective,
      changedFiles,
      tags,
      triggerSignals,
      procedureSteps,
      verificationStatus,
      verificationSummary,
      revisionCount: 1,
      useCount: 0,
      successCount: 0,
      failureCount: 0,
      lastAttemptAt: null,
      lastFailureAt: null,
      qualityScore: 50,
      expiresAt: computeLearnedSkillExpiry(new Date(now), 50),
      lastVerifiedAt: verificationStatus === "passed" ? now : null,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        [
          "INSERT INTO learned_skills (",
          "id, workspace_id, agent_id, source_run_id, source_type, promoted_from_source_type, promoted_at, kind, dedupe_key, lifecycle_state, lifecycle_reason, materialized_skill_path, title, problem_pattern, guidance, example_objective, changed_files, tags,",
          "trigger_signals, procedure_steps, verification_status, verification_summary, revision_count, use_count,",
          "success_count, failure_count, last_attempt_at, last_failure_at, quality_score, expires_at, last_verified_at, last_used_at, created_at, updated_at",
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        record.id,
        record.workspaceId,
        record.agentId,
        record.sourceRunId,
        record.sourceType,
        record.promotedFromSourceType,
        record.promotedAt,
        record.kind,
        record.dedupeKey,
        record.lifecycleState,
        record.lifecycleReason,
        record.materializedSkillPath,
        record.title,
        record.problemPattern,
        record.guidance,
        record.exampleObjective,
        JSON.stringify(record.changedFiles),
        JSON.stringify(record.tags),
        JSON.stringify(record.triggerSignals),
        JSON.stringify(record.procedureSteps),
        record.verificationStatus,
        record.verificationSummary,
        record.revisionCount,
        record.useCount,
        record.successCount,
        record.failureCount,
        record.lastAttemptAt,
        record.lastFailureAt,
        record.qualityScore,
        record.expiresAt,
        record.lastVerifiedAt,
        record.lastUsedAt,
        record.createdAt,
        record.updatedAt,
      );
    this.syncLearnedSkillSearchRecord(record);
    return record;
  }

  public getLearnedSkill(skillId: string): LearnedSkillRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        [
          "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, source_run_id AS sourceRunId, source_type AS sourceType, promoted_from_source_type AS promotedFromSourceType, promoted_at AS promotedAt, kind, dedupe_key AS dedupeKey, lifecycle_state AS lifecycleState, lifecycle_reason AS lifecycleReason, materialized_skill_path AS materializedSkillPath, title,",
          "problem_pattern AS problemPattern, guidance, example_objective AS exampleObjective, changed_files AS changedFiles, tags,",
          "trigger_signals AS triggerSignals, procedure_steps AS procedureSteps, verification_status AS verificationStatus,",
          "verification_summary AS verificationSummary, revision_count AS revisionCount, use_count AS useCount,",
          "success_count AS successCount, failure_count AS failureCount, last_attempt_at AS lastAttemptAt, last_failure_at AS lastFailureAt,",
          "quality_score AS qualityScore, expires_at AS expiresAt, last_verified_at AS lastVerifiedAt,",
          "last_used_at AS lastUsedAt, created_at AS createdAt, updated_at AS updatedAt",
          "FROM learned_skills WHERE id = ?",
        ].join(" "),
      )
      .get(skillId) as unknown;
    return row ? mapLearnedSkillRow(row) : null;
  }

  public listLearnedSkills(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly sourceType?: LearnedSkillSourceType;
    readonly limit?: number;
    readonly includeDisabled?: boolean;
  }): LearnedSkillRecord[] {
    this.initialize();
    const includeDisabled = input.includeDisabled === true ? 1 : 0;
    const rows = this.database
      .prepare(
        [
          "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, source_run_id AS sourceRunId, source_type AS sourceType, promoted_from_source_type AS promotedFromSourceType, promoted_at AS promotedAt, kind, dedupe_key AS dedupeKey, lifecycle_state AS lifecycleState, lifecycle_reason AS lifecycleReason, materialized_skill_path AS materializedSkillPath, title,",
          "problem_pattern AS problemPattern, guidance, example_objective AS exampleObjective, changed_files AS changedFiles, tags,",
          "trigger_signals AS triggerSignals, procedure_steps AS procedureSteps, verification_status AS verificationStatus,",
          "verification_summary AS verificationSummary, revision_count AS revisionCount, use_count AS useCount,",
          "success_count AS successCount, failure_count AS failureCount, last_attempt_at AS lastAttemptAt, last_failure_at AS lastFailureAt,",
          "quality_score AS qualityScore, expires_at AS expiresAt, last_verified_at AS lastVerifiedAt,",
          "last_used_at AS lastUsedAt, created_at AS createdAt, updated_at AS updatedAt",
          "FROM learned_skills WHERE workspace_id = ? AND (? IS NULL OR agent_id = ?) AND (expires_at IS NULL OR expires_at > ?) AND (? = 1 OR lifecycle_state != 'disabled') AND (? IS NULL OR source_type = ?) ORDER BY quality_score DESC, use_count DESC, updated_at DESC LIMIT ?",
        ].join(" "),
      )
      .all(
        input.workspaceId,
        normalizeAgentId(input.agentId),
        normalizeAgentId(input.agentId),
        new Date().toISOString(),
        includeDisabled,
        input.sourceType ?? null,
        input.sourceType ?? null,
        normalizeLimit(input.limit, 20),
      ) as unknown[];
    return rows.map((row) => mapLearnedSkillRow(row));
  }

  public searchLearnedSkills(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly sourceType?: LearnedSkillSourceType;
    readonly query?: string;
    readonly limit?: number;
    readonly includeDisabled?: boolean;
  }): LearnedSkillRecord[] {
    this.initialize();
    const normalizedQuery = (input.query ?? "").trim();
    if (!normalizedQuery) {
      return this.listLearnedSkills(input);
    }

    const ftsRows = this.searchLearnedSkillsWithFts(input.workspaceId, normalizedQuery, input.limit, input.agentId);
    if (ftsRows && ftsRows.length > 0) {
      return input.includeDisabled ? ftsRows : ftsRows.filter((entry) => entry.lifecycleState !== "disabled");
    }

    const skills = this.listLearnedSkills({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      sourceType: input.sourceType,
      limit: Math.max(normalizeLimit(input.limit, 10) * 5, 50),
      includeDisabled: input.includeDisabled,
    });
    const scored = skills
      .map((skill) => ({
        skill,
        score: scoreLearnedSkillMatch(skill, normalizedQuery),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.skill.qualityScore !== left.skill.qualityScore) {
          return right.skill.qualityScore - left.skill.qualityScore;
        }
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        if (right.skill.useCount !== left.skill.useCount) {
          return right.skill.useCount - left.skill.useCount;
        }
        return right.skill.updatedAt.localeCompare(left.skill.updatedAt);
      })
      .slice(0, normalizeLimit(input.limit, 10));
    return scored.map((entry) => entry.skill);
  }

  public listAgentLearnedSkills(input: {
    readonly agentId: string;
    readonly sourceType?: LearnedSkillSourceType;
    readonly query?: string;
    readonly limit?: number;
    readonly includeDisabled?: boolean;
  }): LearnedSkillRecord[] {
    this.initialize();
    const normalizedQuery = (input.query ?? "").trim();
    const includeDisabled = input.includeDisabled === true ? 1 : 0;
    const limit = normalizeLimit(input.limit, 20);
    const like = normalizedQuery ? `%${normalizedQuery.replace(/\s+/g, "%")}%` : null;
    const rows = this.database
      .prepare(
        [
          "SELECT DISTINCT",
          "  ls.id,",
          "  ls.workspace_id AS workspaceId,",
          "  ls.agent_id AS agentId,",
          "  ls.source_run_id AS sourceRunId,",
          "  ls.source_type AS sourceType,",
          "  ls.promoted_from_source_type AS promotedFromSourceType,",
          "  ls.promoted_at AS promotedAt,",
          "  ls.kind,",
          "  ls.dedupe_key AS dedupeKey,",
          "  ls.lifecycle_state AS lifecycleState,",
          "  ls.lifecycle_reason AS lifecycleReason,",
          "  ls.materialized_skill_path AS materializedSkillPath,",
          "  ls.title,",
          "  ls.problem_pattern AS problemPattern,",
          "  ls.guidance,",
          "  ls.example_objective AS exampleObjective,",
          "  ls.changed_files AS changedFiles,",
          "  ls.tags,",
          "  ls.trigger_signals AS triggerSignals,",
          "  ls.procedure_steps AS procedureSteps,",
          "  ls.verification_status AS verificationStatus,",
          "  ls.verification_summary AS verificationSummary,",
          "  ls.revision_count AS revisionCount,",
          "  ls.use_count AS useCount,",
          "  ls.success_count AS successCount,",
          "  ls.failure_count AS failureCount,",
          "  ls.last_attempt_at AS lastAttemptAt,",
          "  ls.last_failure_at AS lastFailureAt,",
          "  ls.quality_score AS qualityScore,",
          "  ls.expires_at AS expiresAt,",
          "  ls.last_verified_at AS lastVerifiedAt,",
          "  ls.last_used_at AS lastUsedAt,",
          "  ls.created_at AS createdAt,",
          "  ls.updated_at AS updatedAt",
          "FROM learned_skills ls",
          "LEFT JOIN runs r ON r.id = ls.source_run_id",
          "WHERE (ls.agent_id = ? OR (ls.agent_id IS NULL AND r.agent_id = ?))",
          "  AND (ls.expires_at IS NULL OR ls.expires_at > ?)",
          "  AND (? = 1 OR ls.lifecycle_state != 'disabled')",
          "  AND (? IS NULL OR ls.source_type = ?)",
          "  AND (",
          "    ? IS NULL",
          "    OR ls.title LIKE ?",
          "    OR ls.problem_pattern LIKE ?",
          "    OR ls.guidance LIKE ?",
          "    OR ls.tags LIKE ?",
          "  )",
          "ORDER BY ls.quality_score DESC, ls.use_count DESC, ls.updated_at DESC",
          "LIMIT ?",
        ].join(" "),
      )
      .all(
        input.agentId,
        input.agentId,
        new Date().toISOString(),
        includeDisabled,
        input.sourceType ?? null,
        input.sourceType ?? null,
        like,
        like,
        like,
        like,
        like,
        limit,
      ) as unknown[];
    return rows.map((row) => mapLearnedSkillRow(row));
  }

  public touchLearnedSkill(skillId: string): LearnedSkillRecord {
    this.initialize();
    const current = this.getLearnedSkill(skillId);
    if (!current) {
      throw new Error(`Learned skill ${skillId} was not found.`);
    }

    const now = new Date().toISOString();
    const qualityScore = calculateLearnedSkillQuality(current.successCount, current.failureCount);
    this.database
      .prepare(
        [
          "UPDATE learned_skills",
          "SET use_count = ?, last_used_at = ?, last_attempt_at = ?, quality_score = ?, expires_at = ?, updated_at = ?",
          "WHERE id = ?",
        ].join(" "),
      )
      .run(
        current.useCount + 1,
        now,
        now,
        qualityScore,
        computeLearnedSkillExpiry(new Date(now), qualityScore),
        now,
        skillId,
      );
    const updated = this.getLearnedSkill(skillId);
    if (!updated) {
      throw new Error(`Learned skill ${skillId} was not found after update.`);
    }
    return updated;
  }

  public updateLearnedSkillLifecycle(input: {
    readonly skillId: string;
    readonly lifecycleState?: LearnedSkillRecord["lifecycleState"];
    readonly lifecycleReason?: string | null;
    readonly materializedSkillPath?: string | null;
    readonly verificationStatus?: string;
    readonly verificationSummary?: string;
  }): LearnedSkillRecord {
    this.initialize();
    const current = this.getLearnedSkill(input.skillId);
    if (!current) {
      throw new Error(`Learned skill ${input.skillId} was not found.`);
    }

    const now = new Date().toISOString();
    this.database
      .prepare(
        [
          "UPDATE learned_skills",
          "SET lifecycle_state = ?, lifecycle_reason = ?, materialized_skill_path = ?, verification_status = ?, verification_summary = ?, updated_at = ?",
          "WHERE id = ?",
        ].join(" "),
      )
      .run(
        normalizeLearnedSkillLifecycleState(input.lifecycleState ?? current.lifecycleState),
        input.lifecycleReason?.trim() || null,
        input.materializedSkillPath?.trim() || current.materializedSkillPath,
        input.verificationStatus?.trim() || current.verificationStatus,
        input.verificationSummary?.trim() || current.verificationSummary,
        now,
        input.skillId,
      );
    const updated = this.getLearnedSkill(input.skillId);
    if (!updated) {
      throw new Error(`Learned skill ${input.skillId} was not found after lifecycle update.`);
    }
    this.syncLearnedSkillSearchRecord(updated);
    return updated;
  }

  public promoteLearnedSkill(input: {
    readonly skillId: string;
    readonly target: Extract<LearnedSkillSourceType, "workspace" | "personal">;
    readonly reason?: string | null;
    readonly materializedSkillPath?: string | null;
  }): LearnedSkillRecord {
    this.initialize();
    const current = this.getLearnedSkill(input.skillId);
    if (!current) {
      throw new Error(`Learned skill ${input.skillId} was not found.`);
    }

    const now = new Date().toISOString();
    this.database
      .prepare(
        [
          "UPDATE learned_skills",
          "SET source_type = ?, promoted_from_source_type = ?, promoted_at = ?, lifecycle_state = ?, lifecycle_reason = ?, materialized_skill_path = ?, updated_at = ?",
          "WHERE id = ?",
        ].join(" "),
      )
      .run(
        input.target,
        current.promotedFromSourceType ?? current.sourceType,
        now,
        "active",
        input.reason?.trim() || `Promoted to ${input.target}.`,
        input.materializedSkillPath?.trim() || current.materializedSkillPath,
        now,
        input.skillId,
      );
    const updated = this.getLearnedSkill(input.skillId);
    if (!updated) {
      throw new Error(`Learned skill ${input.skillId} was not found after promotion.`);
    }
    this.syncLearnedSkillSearchRecord(updated);
    return updated;
  }

  public rollbackLearnedSkillPromotion(input: {
    readonly skillId: string;
    readonly reason?: string | null;
  }): LearnedSkillRecord {
    this.initialize();
    const current = this.getLearnedSkill(input.skillId);
    if (!current) {
      throw new Error(`Learned skill ${input.skillId} was not found.`);
    }

    const rollbackSourceType = current.promotedFromSourceType ?? "learned";
    const now = new Date().toISOString();
    this.database
      .prepare(
        [
          "UPDATE learned_skills",
          "SET source_type = ?, promoted_from_source_type = NULL, promoted_at = NULL, lifecycle_state = ?, lifecycle_reason = ?, materialized_skill_path = NULL, verification_status = ?, verification_summary = ?, updated_at = ?",
          "WHERE id = ?",
        ].join(" "),
      )
      .run(
        rollbackSourceType,
        "needs_reverify",
        input.reason?.trim() || "Rolled back promoted learned skill for re-verification.",
        "needs_reverify",
        "Promotion rolled back; re-verification required before reuse.",
        now,
        input.skillId,
      );
    const updated = this.getLearnedSkill(input.skillId);
    if (!updated) {
      throw new Error(`Learned skill ${input.skillId} was not found after rollback.`);
    }
    this.syncLearnedSkillSearchRecord(updated);
    return updated;
  }

  public evaluateLearnedSkillMaintenance(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly limit?: number;
  }): LearnedSkillMaintenanceReport {
    this.initialize();
    const skills = this.listLearnedSkills({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      includeDisabled: true,
      limit: Math.max(normalizeLimit(input.limit, 50), 50),
    });
    const promotionCandidates: LearnedSkillRecord[] = [];
    const reverifyCandidates: LearnedSkillRecord[] = [];
    const disableCandidates: LearnedSkillRecord[] = [];
    const stableSkills: LearnedSkillRecord[] = [];
    const now = Date.now();

    for (const skill of skills) {
      const totalOutcomes = skill.successCount + skill.failureCount;
      const verifiedAt = skill.lastVerifiedAt ? Date.parse(skill.lastVerifiedAt) : Number.NaN;
      const staleVerification =
        !Number.isFinite(verifiedAt) || now - verifiedAt > 45 * 24 * 60 * 60 * 1000;
      const repeatedEvidence = skill.revisionCount >= 2 || skill.successCount >= 2 || skill.useCount >= 3;
      const reliable =
        skill.lifecycleState === "active" &&
        skill.verificationStatus === "passed" &&
        skill.qualityScore >= 50 &&
        skill.failureCount === 0;

      if (
        skill.lifecycleState !== "disabled" &&
        (skill.failureCount >= 3 || (totalOutcomes >= 3 && skill.qualityScore < 35))
      ) {
        disableCandidates.push(skill);
        continue;
      }
      if (
        skill.lifecycleState === "needs_reverify" ||
        (skill.lifecycleState !== "disabled" && skill.verificationStatus !== "passed") ||
        (skill.lifecycleState !== "disabled" && staleVerification && skill.sourceType === "learned")
      ) {
        reverifyCandidates.push(skill);
        continue;
      }
      if (
        reliable &&
        repeatedEvidence &&
        skill.sourceType === "learned" &&
        !skill.materializedSkillPath
      ) {
        promotionCandidates.push(skill);
        continue;
      }
      if (skill.lifecycleState === "active") {
        stableSkills.push(skill);
      }
    }

    const sortByEvidence = (left: LearnedSkillRecord, right: LearnedSkillRecord): number => {
      const leftEvidence = left.revisionCount + left.successCount + left.useCount;
      const rightEvidence = right.revisionCount + right.successCount + right.useCount;
      if (rightEvidence !== leftEvidence) {
        return rightEvidence - leftEvidence;
      }
      if (right.qualityScore !== left.qualityScore) {
        return right.qualityScore - left.qualityScore;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    };
    const limit = normalizeLimit(input.limit, 20);
    return {
      workspaceId: input.workspaceId,
      agentId: normalizeAgentId(input.agentId),
      promotionCandidates: promotionCandidates.sort(sortByEvidence).slice(0, limit),
      reverifyCandidates: reverifyCandidates.sort(sortByEvidence).slice(0, limit),
      disableCandidates: disableCandidates.sort(sortByEvidence).slice(0, limit),
      stableSkills: stableSkills.sort(sortByEvidence).slice(0, limit),
      generatedAt: new Date(now).toISOString(),
    };
  }

  public applyLearnedSkillMaintenance(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly limit?: number;
    readonly promoteStable?: boolean;
    readonly materializePathForSkill?: (skill: LearnedSkillRecord) => string | null | undefined;
  }): LearnedSkillMaintenanceApplication {
    this.initialize();
    const report = this.evaluateLearnedSkillMaintenance(input);
    const appliedAt = new Date().toISOString();
    const promotedSkills: LearnedSkillRecord[] = [];
    const reverifySkills: LearnedSkillRecord[] = [];
    const disabledSkills: LearnedSkillRecord[] = [];
    const profileFacts: ProfileFactRecord[] = [];

    for (const skill of report.disableCandidates) {
      disabledSkills.push(
        this.updateLearnedSkillLifecycle({
          skillId: skill.id,
          lifecycleState: "disabled",
          lifecycleReason: "Disabled by scheduled self-learning maintenance after repeated failures or low quality.",
        }),
      );
    }

    for (const skill of report.reverifyCandidates) {
      if (skill.lifecycleState === "disabled") {
        continue;
      }
      reverifySkills.push(
        this.updateLearnedSkillLifecycle({
          skillId: skill.id,
          lifecycleState: "needs_reverify",
          lifecycleReason: "Queued by scheduled self-learning maintenance for stale or failed verification.",
          verificationStatus: "needs_reverify",
          verificationSummary: "Queued by scheduled self-learning maintenance.",
        }),
      );
    }

    if (input.promoteStable !== false) {
      for (const skill of report.promotionCandidates) {
        const materializedSkillPath = input.materializePathForSkill?.(skill)?.trim() || skill.materializedSkillPath;
        promotedSkills.push(
          this.promoteLearnedSkill({
            skillId: skill.id,
            target: "workspace",
            reason: "Promoted by scheduled self-learning maintenance after repeated verified use.",
            materializedSkillPath,
          }),
        );
      }
    }

    const agentId = normalizeAgentId(input.agentId);
    const summary = [
      `Self-learning maintenance applied at ${appliedAt}.`,
      `promoted=${promotedSkills.length}`,
      `reverify=${reverifySkills.length}`,
      `disabled=${disabledSkills.length}`,
      `stable=${report.stableSkills.length}`,
    ].join(" ");
    profileFacts.push(
      this.addProfileFact({
        workspaceId: input.workspaceId,
        agentId,
        content: summary,
        tags: ["self-learning", "maintenance"],
      }),
    );
    this.addAuditLog({
      workspaceId: input.workspaceId,
      agentId,
      actorType: "system",
      action: "skills.maintenance.apply",
      targetType: "learned_skill",
      riskLevel: disabledSkills.length > 0 ? "medium" : "low",
      summary,
      metadata: {
        promotedSkillIds: promotedSkills.map((skill) => skill.id),
        reverifySkillIds: reverifySkills.map((skill) => skill.id),
        disabledSkillIds: disabledSkills.map((skill) => skill.id),
        generatedAt: report.generatedAt,
      },
    });

    return {
      report,
      promotedSkills,
      reverifySkills,
      disabledSkills,
      profileFacts,
      appliedAt,
    };
  }

  public createProfileEvaluation(input: {
    readonly profileId: string;
    readonly workspaceId?: string | null;
    readonly agentId?: string | null;
    readonly suiteTitle: string;
    readonly categories?: readonly string[];
    readonly metrics?: Readonly<Record<string, unknown>>;
    readonly scores?: Readonly<Record<string, unknown>>;
    readonly passed?: boolean;
    readonly summary?: string;
  }): ProfileEvaluationRecord {
    this.initialize();
    const profileId = input.profileId.trim();
    if (!profileId) {
      throw new Error("Profile evaluation requires a non-empty profile id.");
    }
    const now = new Date().toISOString();
    const record: ProfileEvaluationRecord = {
      id: randomUUID(),
      profileId,
      workspaceId: input.workspaceId?.trim() || null,
      agentId: normalizeAgentId(input.agentId),
      suiteTitle: input.suiteTitle.trim() || "Capability scorecard",
      categories: normalizeTags(input.categories),
      metrics: input.metrics ?? {},
      scores: input.scores ?? {},
      passed: input.passed !== false,
      summary: input.summary?.trim() || "",
      createdAt: now,
    };
    this.database
      .prepare(
        [
          "INSERT INTO profile_evaluations (",
          "id, profile_id, workspace_id, agent_id, suite_title, categories_json, metrics_json, scores_json, passed, summary, created_at",
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        record.id,
        record.profileId,
        record.workspaceId,
        record.agentId,
        record.suiteTitle,
        JSON.stringify(record.categories),
        JSON.stringify(record.metrics),
        JSON.stringify(record.scores),
        record.passed ? 1 : 0,
        record.summary,
        record.createdAt,
      );
    this.addAuditLog({
      workspaceId: record.workspaceId,
      agentId: record.agentId,
      actorType: "system",
      action: "profile.evaluate",
      targetType: "agent_profile",
      targetId: record.profileId,
      riskLevel: "low",
      summary: record.summary || `Recorded evaluation for ${record.profileId}.`,
      metadata: {
        evaluationId: record.id,
        suiteTitle: record.suiteTitle,
        categories: record.categories,
        passed: record.passed,
      },
    });
    return record;
  }

  public listProfileEvaluations(input: {
    readonly profileId?: string | null;
    readonly workspaceId?: string | null;
    readonly agentId?: string | null;
    readonly limit?: number;
  } = {}): ProfileEvaluationRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        [
          "SELECT id, profile_id AS profileId, workspace_id AS workspaceId, agent_id AS agentId, suite_title AS suiteTitle,",
          "categories_json AS categories, metrics_json AS metrics, scores_json AS scores, passed, summary, created_at AS createdAt",
          "FROM profile_evaluations",
          "WHERE (? IS NULL OR profile_id = ?)",
          "AND (? IS NULL OR workspace_id = ?)",
          "AND (? IS NULL OR agent_id = ?)",
          "ORDER BY created_at DESC LIMIT ?",
        ].join(" "),
      )
      .all(
        input.profileId?.trim() || null,
        input.profileId?.trim() || null,
        input.workspaceId?.trim() || null,
        input.workspaceId?.trim() || null,
        normalizeAgentId(input.agentId),
        normalizeAgentId(input.agentId),
        normalizeLimit(input.limit, 20),
      ) as unknown[];
    return rows.map((row) => mapProfileEvaluationRow(row));
  }

  public addAuditLog(input: {
    readonly workspaceId?: string | null;
    readonly agentId?: string | null;
    readonly actorType: string;
    readonly actorId?: string | null;
    readonly action: string;
    readonly targetType: string;
    readonly targetId?: string | null;
    readonly riskLevel?: AuditLogRecord["riskLevel"];
    readonly summary: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
  }): AuditLogRecord {
    this.initialize();
    const now = new Date().toISOString();
    const record: AuditLogRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId?.trim() || null,
      agentId: normalizeAgentId(input.agentId),
      actorType: input.actorType.trim() || "system",
      actorId: input.actorId?.trim() || null,
      action: input.action.trim(),
      targetType: input.targetType.trim(),
      targetId: input.targetId?.trim() || null,
      riskLevel: normalizeAuditRiskLevel(input.riskLevel),
      summary: redactSensitiveText(input.summary.trim()),
      metadata: redactSensitiveValue(input.metadata ?? {}) as Readonly<Record<string, unknown>>,
      createdAt: now,
    };
    this.database
      .prepare(
        [
          "INSERT INTO audit_logs (",
          "id, workspace_id, agent_id, actor_type, actor_id, action, target_type, target_id, risk_level, summary, metadata_json, created_at",
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        record.id,
        record.workspaceId,
        record.agentId,
        record.actorType,
        record.actorId,
        record.action,
        record.targetType,
        record.targetId,
        record.riskLevel,
        record.summary,
        JSON.stringify(record.metadata),
        record.createdAt,
      );
    return record;
  }

  public listAuditLogs(input: {
    readonly workspaceId?: string | null;
    readonly agentId?: string | null;
    readonly action?: string | null;
    readonly limit?: number;
  } = {}): AuditLogRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        [
          "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, actor_type AS actorType, actor_id AS actorId,",
          "action, target_type AS targetType, target_id AS targetId, risk_level AS riskLevel, summary, metadata_json AS metadata, created_at AS createdAt",
          "FROM audit_logs",
          "WHERE (? IS NULL OR workspace_id = ?)",
          "AND (? IS NULL OR agent_id = ?)",
          "AND (? IS NULL OR action = ?)",
          "ORDER BY created_at DESC LIMIT ?",
        ].join(" "),
      )
      .all(
        input.workspaceId?.trim() || null,
        input.workspaceId?.trim() || null,
        normalizeAgentId(input.agentId),
        normalizeAgentId(input.agentId),
        input.action?.trim() || null,
        input.action?.trim() || null,
        normalizeLimit(input.limit, 50),
      ) as unknown[];
    return rows.map((row) => mapAuditLogRow(row));
  }

  public deleteLearnedSkill(skillId: string): LearnedSkillRecord | null {
    this.initialize();
    const current = this.getLearnedSkill(skillId);
    if (!current) {
      return null;
    }

    this.database.prepare("DELETE FROM learned_skills WHERE id = ?").run(skillId);
    if (this.searchIndexesEnabled) {
      this.database.prepare("DELETE FROM learned_skills_search WHERE skill_id = ?").run(skillId);
    }
    return current;
  }

  private findLearnedSkillByPattern(
    workspaceId: string,
    title: string,
    problemPattern: string,
  ): LearnedSkillRecord | null {
    const row = this.database
      .prepare(
        [
          "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, source_run_id AS sourceRunId, source_type AS sourceType, promoted_from_source_type AS promotedFromSourceType, promoted_at AS promotedAt, kind, dedupe_key AS dedupeKey, lifecycle_state AS lifecycleState, lifecycle_reason AS lifecycleReason, materialized_skill_path AS materializedSkillPath, title,",
          "problem_pattern AS problemPattern, guidance, example_objective AS exampleObjective, changed_files AS changedFiles, tags,",
          "trigger_signals AS triggerSignals, procedure_steps AS procedureSteps, verification_status AS verificationStatus,",
          "verification_summary AS verificationSummary, revision_count AS revisionCount, use_count AS useCount,",
          "success_count AS successCount, failure_count AS failureCount, last_attempt_at AS lastAttemptAt, last_failure_at AS lastFailureAt,",
          "quality_score AS qualityScore, expires_at AS expiresAt, last_verified_at AS lastVerifiedAt,",
          "last_used_at AS lastUsedAt, created_at AS createdAt, updated_at AS updatedAt",
          "FROM learned_skills WHERE workspace_id = ? AND title = ? AND problem_pattern = ? LIMIT 1",
        ].join(" "),
      )
      .get(workspaceId, title, problemPattern) as unknown;
    return row ? mapLearnedSkillRow(row) : null;
  }

  private findLearnedSkillByDedupeKey(
    workspaceId: string,
    kind: string,
    dedupeKey: string,
  ): LearnedSkillRecord | null {
    const row = this.database
      .prepare(
        [
          "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, source_run_id AS sourceRunId, source_type AS sourceType, promoted_from_source_type AS promotedFromSourceType, promoted_at AS promotedAt, kind, dedupe_key AS dedupeKey, lifecycle_state AS lifecycleState, lifecycle_reason AS lifecycleReason, materialized_skill_path AS materializedSkillPath, title,",
          "problem_pattern AS problemPattern, guidance, example_objective AS exampleObjective, changed_files AS changedFiles, tags,",
          "trigger_signals AS triggerSignals, procedure_steps AS procedureSteps, verification_status AS verificationStatus,",
          "verification_summary AS verificationSummary, revision_count AS revisionCount, use_count AS useCount,",
          "success_count AS successCount, failure_count AS failureCount, last_attempt_at AS lastAttemptAt, last_failure_at AS lastFailureAt,",
          "quality_score AS qualityScore, expires_at AS expiresAt, last_verified_at AS lastVerifiedAt,",
          "last_used_at AS lastUsedAt, created_at AS createdAt, updated_at AS updatedAt",
          "FROM learned_skills WHERE workspace_id = ? AND kind = ? AND dedupe_key = ? LIMIT 1",
        ].join(" "),
      )
      .get(workspaceId, kind, dedupeKey) as unknown;
    return row ? mapLearnedSkillRow(row) : null;
  }

  private findLearnedSkillForUpsert(input: {
    readonly workspaceId: string;
    readonly kind: string;
    readonly dedupeKey: string | null;
    readonly title: string;
    readonly problemPattern: string;
  }): LearnedSkillRecord | null {
    if (input.dedupeKey) {
      const matched = this.findLearnedSkillByDedupeKey(input.workspaceId, input.kind, input.dedupeKey);
      if (matched) {
        return matched;
      }
    }
    return this.findLearnedSkillByPattern(input.workspaceId, input.title, input.problemPattern);
  }

  public recordLearnedSkillOutcome(input: {
    readonly skillId: string;
    readonly succeeded: boolean;
  }): LearnedSkillRecord {
    this.initialize();
    const current = this.getLearnedSkill(input.skillId);
    if (!current) {
      throw new Error(`Learned skill ${input.skillId} was not found.`);
    }

    const now = new Date().toISOString();
    const successCount = current.successCount + (input.succeeded ? 1 : 0);
    const failureCount = current.failureCount + (input.succeeded ? 0 : 1);
    const qualityScore = calculateLearnedSkillQuality(successCount, failureCount);
    const lastFailureAt = input.succeeded ? current.lastFailureAt : now;
    const lifecycleState = resolveLearnedSkillLifecycleFromOutcome({
      currentState: current.lifecycleState,
      successCount,
      failureCount,
      succeeded: input.succeeded,
      qualityScore,
    });
    const lifecycleReason =
      lifecycleState === "disabled"
        ? "Disabled automatically after repeated failed reuse."
        : lifecycleState === "needs_reverify"
          ? "Marked for re-verification after a failed reuse."
          : null;

    this.database
      .prepare(
        [
          "UPDATE learned_skills",
          "SET success_count = ?, failure_count = ?, last_attempt_at = ?, last_failure_at = ?, quality_score = ?, expires_at = ?, lifecycle_state = ?, lifecycle_reason = ?, updated_at = ?",
          "WHERE id = ?",
        ].join(" "),
      )
      .run(
        successCount,
        failureCount,
        now,
        lastFailureAt,
        qualityScore,
        computeLearnedSkillExpiry(new Date(now), qualityScore),
        lifecycleState,
        lifecycleReason,
        now,
        input.skillId,
      );
    const updated = this.getLearnedSkill(input.skillId);
    if (!updated) {
      throw new Error(`Learned skill ${input.skillId} was not found after outcome update.`);
    }
    this.syncLearnedSkillSearchRecord(updated);
    return updated;
  }

  public createAutomation(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly threadId?: string | null;
    readonly title: string;
    readonly threadTitle?: string | null;
    readonly task: string;
    readonly mode: string;
    readonly executionDomain: string;
    readonly verificationMode: string;
    readonly verificationCommands?: string[];
    readonly autoApproveRisky?: boolean;
    readonly maxIterations?: number;
    readonly scheduleKind: AutomationScheduleKind;
    readonly intervalSeconds?: number | null;
    readonly scheduleExpression?: string | null;
    readonly timezone?: string | null;
    readonly heartbeatWindowSeconds?: number | null;
    readonly triggerEventTypes?: readonly string[];
    readonly triggerRouteId?: string | null;
    readonly triggerChannelType?: string | null;
    readonly triggerChannelKey?: string | null;
    readonly triggerSenders?: readonly string[];
    readonly triggerTextPattern?: string | null;
    readonly deliveryMode?: AutomationDeliveryMode;
    readonly relayTemplate?: string | null;
    readonly retryDelaySeconds?: number | null;
    readonly maxConsecutiveFailures?: number;
    readonly status?: AutomationStatus;
  }): AutomationRecord {
    this.initialize();
    const now = new Date().toISOString();
    const status = input.status ?? "active";
    const usesIntervalClock =
      input.scheduleKind === "interval" || input.scheduleKind === "heartbeat" || input.scheduleKind === "maintenance";
    const usesRetryClock = usesIntervalClock || input.scheduleKind === "cron";
    const intervalSeconds = usesIntervalClock ? Math.max(10, Math.trunc(input.intervalSeconds ?? 300)) : null;
    const retryDelaySeconds = usesRetryClock
      ? Math.max(10, Math.trunc(input.retryDelaySeconds ?? Math.min(intervalSeconds ?? 300, 60)))
      : null;
    const scheduleExpression = normalizeAutomationScheduleExpression(input.scheduleKind, input.scheduleExpression);
    const timezone = normalizeAutomationTimezone(input.timezone);
    const record: AutomationRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      threadId: input.threadId ?? null,
      title: input.title.trim(),
      threadTitle: input.threadTitle?.trim() || null,
      task: input.task.trim(),
      mode: input.mode,
      executionDomain: input.executionDomain,
      verificationMode: input.verificationMode,
      verificationCommands: [...(input.verificationCommands ?? [])],
      autoApproveRisky: Boolean(input.autoApproveRisky),
      maxIterations: Math.max(1, Math.trunc(input.maxIterations ?? 8)),
      scheduleKind: input.scheduleKind,
      intervalSeconds,
      scheduleExpression,
      timezone,
      heartbeatWindowSeconds:
        input.scheduleKind === "heartbeat"
          ? Math.max(10, Math.trunc(input.heartbeatWindowSeconds ?? intervalSeconds ?? 300))
          : null,
      triggerEventTypes:
        input.scheduleKind === "event"
          ? normalizeAutomationEventTypes(input.triggerEventTypes)
          : [],
      triggerRouteId: input.scheduleKind === "event" ? normalizeOptionalString(input.triggerRouteId) : null,
      triggerChannelType: input.scheduleKind === "event" ? normalizeOptionalString(input.triggerChannelType) : null,
      triggerChannelKey: input.scheduleKind === "event" ? normalizeOptionalString(input.triggerChannelKey) : null,
      triggerSenders: input.scheduleKind === "event" ? normalizeStringArray(input.triggerSenders) : [],
      triggerTextPattern: input.scheduleKind === "event" ? normalizeOptionalString(input.triggerTextPattern) : null,
      deliveryMode: input.deliveryMode === "relay" ? "relay" : "run",
      relayTemplate: normalizeOptionalString(input.relayTemplate),
      retryDelaySeconds,
      maxConsecutiveFailures: Math.max(1, Math.trunc(input.maxConsecutiveFailures ?? 3)),
      status,
      deliveryState: "idle",
      failureCount: 0,
      consecutiveFailures: 0,
      lastRunAt: null,
      lastRunId: null,
      nextRunAt:
        status === "active" && usesIntervalClock && intervalSeconds
            ? computeNextRunAt(now, intervalSeconds)
          : status === "active" && (input.scheduleKind === "at" || input.scheduleKind === "cron")
            ? computeAutomationNextRunAt({
              scheduleKind: input.scheduleKind,
              intervalSeconds,
              scheduleExpression,
              timezone,
            }, now)
          : null,
      lastFailureAt: null,
      lastError: null,
      cooldownUntil: null,
      deadLetteredAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.database
      .prepare(
        "INSERT INTO automations (id, workspace_id, agent_id, thread_id, title, thread_title, task, mode, execution_domain, verification_mode, verification_commands, auto_approve_risky, max_iterations, schedule_kind, interval_seconds, schedule_expression, timezone, heartbeat_window_seconds, trigger_event_types, trigger_route_id, trigger_channel_type, trigger_channel_key, trigger_senders, trigger_text_pattern, delivery_mode, relay_template, retry_delay_seconds, max_consecutive_failures, status, delivery_state, failure_count, consecutive_failures, last_run_at, last_run_id, next_run_at, last_failure_at, last_error, cooldown_until, dead_lettered_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.workspaceId,
        record.agentId,
        record.threadId,
        record.title,
        record.threadTitle,
        record.task,
        record.mode,
        record.executionDomain,
        record.verificationMode,
        JSON.stringify(record.verificationCommands),
        record.autoApproveRisky ? 1 : 0,
        record.maxIterations,
        record.scheduleKind,
        record.intervalSeconds,
        record.scheduleExpression,
        record.timezone,
        record.heartbeatWindowSeconds,
        JSON.stringify(record.triggerEventTypes),
        record.triggerRouteId,
        record.triggerChannelType,
        record.triggerChannelKey,
        JSON.stringify(record.triggerSenders),
        record.triggerTextPattern,
        record.deliveryMode,
        record.relayTemplate,
        record.retryDelaySeconds,
        record.maxConsecutiveFailures,
        record.status,
        record.deliveryState,
        record.failureCount,
        record.consecutiveFailures,
        record.lastRunAt,
        record.lastRunId,
        record.nextRunAt,
        record.lastFailureAt,
        record.lastError,
        record.cooldownUntil,
        record.deadLetteredAt,
        record.createdAt,
        record.updatedAt,
      );

    return record;
  }

  public getAutomation(automationId: string): AutomationRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
          "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, thread_id AS threadId, title, thread_title AS threadTitle, task, mode, execution_domain AS executionDomain, verification_mode AS verificationMode, verification_commands AS verificationCommands, auto_approve_risky AS autoApproveRisky, max_iterations AS maxIterations, schedule_kind AS scheduleKind, interval_seconds AS intervalSeconds, schedule_expression AS scheduleExpression, timezone, heartbeat_window_seconds AS heartbeatWindowSeconds, trigger_event_types AS triggerEventTypes, trigger_route_id AS triggerRouteId, trigger_channel_type AS triggerChannelType, trigger_channel_key AS triggerChannelKey, trigger_senders AS triggerSenders, trigger_text_pattern AS triggerTextPattern, delivery_mode AS deliveryMode, relay_template AS relayTemplate, retry_delay_seconds AS retryDelaySeconds, max_consecutive_failures AS maxConsecutiveFailures, status, delivery_state AS deliveryState, failure_count AS failureCount, consecutive_failures AS consecutiveFailures, last_run_at AS lastRunAt, last_run_id AS lastRunId, next_run_at AS nextRunAt, last_failure_at AS lastFailureAt, last_error AS lastError, cooldown_until AS cooldownUntil, dead_lettered_at AS deadLetteredAt, created_at AS createdAt, updated_at AS updatedAt FROM automations WHERE id = ?",
        )
        .get(automationId) as unknown;
    return row ? mapAutomationRow(row) : null;
  }

  public listAutomations(input: {
    readonly workspaceId?: string;
    readonly agentId?: string;
    readonly scheduleKind?: AutomationScheduleKind;
    readonly status?: AutomationStatus;
    readonly deliveryState?: AutomationDeliveryState;
  } = {}): AutomationRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
          "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, thread_id AS threadId, title, thread_title AS threadTitle, task, mode, execution_domain AS executionDomain, verification_mode AS verificationMode, verification_commands AS verificationCommands, auto_approve_risky AS autoApproveRisky, max_iterations AS maxIterations, schedule_kind AS scheduleKind, interval_seconds AS intervalSeconds, schedule_expression AS scheduleExpression, timezone, heartbeat_window_seconds AS heartbeatWindowSeconds, trigger_event_types AS triggerEventTypes, trigger_route_id AS triggerRouteId, trigger_channel_type AS triggerChannelType, trigger_channel_key AS triggerChannelKey, trigger_senders AS triggerSenders, trigger_text_pattern AS triggerTextPattern, delivery_mode AS deliveryMode, relay_template AS relayTemplate, retry_delay_seconds AS retryDelaySeconds, max_consecutive_failures AS maxConsecutiveFailures, status, delivery_state AS deliveryState, failure_count AS failureCount, consecutive_failures AS consecutiveFailures, last_run_at AS lastRunAt, last_run_id AS lastRunId, next_run_at AS nextRunAt, last_failure_at AS lastFailureAt, last_error AS lastError, cooldown_until AS cooldownUntil, dead_lettered_at AS deadLetteredAt, created_at AS createdAt, updated_at AS updatedAt FROM automations WHERE (? IS NULL OR workspace_id = ?) AND (? IS NULL OR agent_id = ?) AND (? IS NULL OR schedule_kind = ?) AND (? IS NULL OR status = ?) AND (? IS NULL OR delivery_state = ?) ORDER BY updated_at DESC",
        )
        .all(
          input.workspaceId ?? null,
          input.workspaceId ?? null,
          input.agentId ?? null,
          input.agentId ?? null,
          input.scheduleKind ?? null,
          input.scheduleKind ?? null,
          input.status ?? null,
          input.status ?? null,
          input.deliveryState ?? null,
          input.deliveryState ?? null,
        ) as unknown[];
    return rows.map((row) => mapAutomationRow(row));
  }

  public listDueAutomations(now = new Date().toISOString()): AutomationRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
          "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, thread_id AS threadId, title, thread_title AS threadTitle, task, mode, execution_domain AS executionDomain, verification_mode AS verificationMode, verification_commands AS verificationCommands, auto_approve_risky AS autoApproveRisky, max_iterations AS maxIterations, schedule_kind AS scheduleKind, interval_seconds AS intervalSeconds, schedule_expression AS scheduleExpression, timezone, heartbeat_window_seconds AS heartbeatWindowSeconds, trigger_event_types AS triggerEventTypes, trigger_route_id AS triggerRouteId, trigger_channel_type AS triggerChannelType, trigger_channel_key AS triggerChannelKey, trigger_senders AS triggerSenders, trigger_text_pattern AS triggerTextPattern, delivery_mode AS deliveryMode, relay_template AS relayTemplate, retry_delay_seconds AS retryDelaySeconds, max_consecutive_failures AS maxConsecutiveFailures, status, delivery_state AS deliveryState, failure_count AS failureCount, consecutive_failures AS consecutiveFailures, last_run_at AS lastRunAt, last_run_id AS lastRunId, next_run_at AS nextRunAt, last_failure_at AS lastFailureAt, last_error AS lastError, cooldown_until AS cooldownUntil, dead_lettered_at AS deadLetteredAt, created_at AS createdAt, updated_at AS updatedAt FROM automations WHERE status = 'active' AND schedule_kind IN ('at', 'cron', 'interval', 'heartbeat', 'maintenance') AND next_run_at IS NOT NULL AND next_run_at <= ? AND (cooldown_until IS NULL OR cooldown_until <= ?) AND delivery_state != 'dead_letter' ORDER BY next_run_at ASC",
        )
        .all(now, now) as unknown[];
    return rows.map((row) => mapAutomationRow(row));
  }

  public listTriggeredAutomations(input: AutomationTriggerEvent): AutomationRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, thread_id AS threadId, title, thread_title AS threadTitle, task, mode, execution_domain AS executionDomain, verification_mode AS verificationMode, verification_commands AS verificationCommands, auto_approve_risky AS autoApproveRisky, max_iterations AS maxIterations, schedule_kind AS scheduleKind, interval_seconds AS intervalSeconds, schedule_expression AS scheduleExpression, timezone, heartbeat_window_seconds AS heartbeatWindowSeconds, trigger_event_types AS triggerEventTypes, trigger_route_id AS triggerRouteId, trigger_channel_type AS triggerChannelType, trigger_channel_key AS triggerChannelKey, trigger_senders AS triggerSenders, trigger_text_pattern AS triggerTextPattern, delivery_mode AS deliveryMode, relay_template AS relayTemplate, retry_delay_seconds AS retryDelaySeconds, max_consecutive_failures AS maxConsecutiveFailures, status, delivery_state AS deliveryState, failure_count AS failureCount, consecutive_failures AS consecutiveFailures, last_run_at AS lastRunAt, last_run_id AS lastRunId, next_run_at AS nextRunAt, last_failure_at AS lastFailureAt, last_error AS lastError, cooldown_until AS cooldownUntil, dead_lettered_at AS deadLetteredAt, created_at AS createdAt, updated_at AS updatedAt FROM automations WHERE workspace_id = ? AND status = 'active' AND schedule_kind = 'event' AND delivery_state != 'dead_letter' ORDER BY updated_at DESC",
      )
      .all(input.workspaceId) as unknown[];
    return rows
      .map((row) => mapAutomationRow(row))
      .filter((automation) => automationMatchesTrigger(automation, input));
  }

  public updateAutomationState(input: {
    readonly automationId: string;
    readonly status?: AutomationStatus;
    readonly deliveryState?: AutomationDeliveryState;
    readonly failureCount?: number;
    readonly consecutiveFailures?: number;
    readonly lastRunAt?: string | null;
    readonly lastRunId?: string | null;
    readonly nextRunAt?: string | null;
    readonly lastFailureAt?: string | null;
    readonly lastError?: string | null;
    readonly cooldownUntil?: string | null;
    readonly deadLetteredAt?: string | null;
  }): AutomationRecord {
    this.initialize();
    const current = this.getAutomation(input.automationId);
    if (!current) {
      throw new Error(`Automation ${input.automationId} was not found.`);
    }

    const updatedAt = new Date().toISOString();
      const next = {
        status: input.status ?? current.status,
        deliveryState: input.deliveryState ?? current.deliveryState,
        failureCount: input.failureCount === undefined ? current.failureCount : input.failureCount,
        consecutiveFailures:
          input.consecutiveFailures === undefined ? current.consecutiveFailures : input.consecutiveFailures,
        lastRunAt: input.lastRunAt === undefined ? current.lastRunAt : input.lastRunAt,
        lastRunId: input.lastRunId === undefined ? current.lastRunId : input.lastRunId,
        nextRunAt: input.nextRunAt === undefined ? current.nextRunAt : input.nextRunAt,
        lastFailureAt: input.lastFailureAt === undefined ? current.lastFailureAt : input.lastFailureAt,
        lastError: input.lastError === undefined ? current.lastError : input.lastError,
        cooldownUntil: input.cooldownUntil === undefined ? current.cooldownUntil : input.cooldownUntil,
        deadLetteredAt: input.deadLetteredAt === undefined ? current.deadLetteredAt : input.deadLetteredAt,
      };

      this.database
        .prepare(
          "UPDATE automations SET status = ?, delivery_state = ?, failure_count = ?, consecutive_failures = ?, last_run_at = ?, last_run_id = ?, next_run_at = ?, last_failure_at = ?, last_error = ?, cooldown_until = ?, dead_lettered_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          next.status,
          next.deliveryState,
          next.failureCount,
          next.consecutiveFailures,
          next.lastRunAt,
          next.lastRunId,
          next.nextRunAt,
          next.lastFailureAt,
          next.lastError,
          next.cooldownUntil,
          next.deadLetteredAt,
          updatedAt,
          input.automationId,
        );

    const updated = this.getAutomation(input.automationId);
    if (!updated) {
      throw new Error(`Automation ${input.automationId} was not found after update.`);
    }
    return updated;
  }

  public deleteAutomation(automationId: string): boolean {
    this.initialize();
    const result = this.database.prepare("DELETE FROM automations WHERE id = ?").run(automationId) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  public createRoute(input: {
    readonly workspaceId: string;
    readonly agentId?: string | null;
    readonly threadId?: string | null;
    readonly title: string;
    readonly channelType: string;
    readonly channelKey: string;
    readonly adapterType?: RouteAdapterType;
    readonly adapterConfig?: Record<string, unknown>;
    readonly inboundSecret?: string | null;
    readonly status?: ChannelRouteStatus;
  }): ChannelRouteRecord {
    this.initialize();
    const existing = this.findRouteByChannel(input.channelType, input.channelKey);
    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const record: ChannelRouteRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      agentId: input.agentId?.trim() || null,
      threadId: input.threadId ?? null,
      title: input.title.trim(),
      channelType: input.channelType.trim(),
      channelKey: input.channelKey.trim(),
      adapterType: input.adapterType ?? "console",
      adapterConfig: normalizeObject(input.adapterConfig),
      inboundSecret: input.inboundSecret?.trim() || null,
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        "INSERT INTO routes (id, workspace_id, agent_id, thread_id, title, channel_type, channel_key, adapter_type, adapter_config, inbound_secret, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.workspaceId,
        record.agentId,
        record.threadId,
        record.title,
        record.channelType,
        record.channelKey,
        record.adapterType,
        JSON.stringify(record.adapterConfig),
        record.inboundSecret,
        record.status,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  public getRoute(routeId: string): ChannelRouteRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, thread_id AS threadId, title, channel_type AS channelType, channel_key AS channelKey, adapter_type AS adapterType, adapter_config AS adapterConfig, inbound_secret AS inboundSecret, status, created_at AS createdAt, updated_at AS updatedAt FROM routes WHERE id = ?",
      )
      .get(routeId) as unknown;
    return row ? mapRouteRow(row) : null;
  }

  public findRouteByChannel(channelType: string, channelKey: string): ChannelRouteRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, thread_id AS threadId, title, channel_type AS channelType, channel_key AS channelKey, adapter_type AS adapterType, adapter_config AS adapterConfig, inbound_secret AS inboundSecret, status, created_at AS createdAt, updated_at AS updatedAt FROM routes WHERE channel_type = ? AND channel_key = ?",
      )
      .get(channelType.trim(), channelKey.trim()) as unknown;
    return row ? mapRouteRow(row) : null;
  }

  public listRoutes(input: {
    readonly workspaceId?: string;
    readonly agentId?: string;
    readonly status?: ChannelRouteStatus;
  } = {}): ChannelRouteRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, agent_id AS agentId, thread_id AS threadId, title, channel_type AS channelType, channel_key AS channelKey, adapter_type AS adapterType, adapter_config AS adapterConfig, inbound_secret AS inboundSecret, status, created_at AS createdAt, updated_at AS updatedAt FROM routes WHERE (? IS NULL OR workspace_id = ?) AND (? IS NULL OR agent_id = ?) AND (? IS NULL OR status = ?) ORDER BY updated_at DESC",
      )
      .all(
        input.workspaceId ?? null,
        input.workspaceId ?? null,
        input.agentId ?? null,
        input.agentId ?? null,
        input.status ?? null,
        input.status ?? null,
      ) as unknown[];
    return rows.map((row) => mapRouteRow(row));
  }

  public updateRoute(input: {
    readonly routeId: string;
    readonly agentId?: string | null;
    readonly threadId?: string | null;
    readonly status?: ChannelRouteStatus;
    readonly title?: string;
    readonly adapterType?: RouteAdapterType;
    readonly adapterConfig?: Record<string, unknown>;
    readonly inboundSecret?: string | null;
  }): ChannelRouteRecord {
    this.initialize();
    const current = this.getRoute(input.routeId);
    if (!current) {
      throw new Error(`Route ${input.routeId} was not found.`);
    }

    const updatedAt = new Date().toISOString();
    this.database
      .prepare("UPDATE routes SET agent_id = ?, thread_id = ?, status = ?, title = ?, adapter_type = ?, adapter_config = ?, inbound_secret = ?, updated_at = ? WHERE id = ?")
      .run(
        input.agentId === undefined ? current.agentId : input.agentId?.trim() || null,
        input.threadId === undefined ? current.threadId : input.threadId,
        input.status ?? current.status,
        input.title?.trim() || current.title,
        input.adapterType ?? current.adapterType,
        JSON.stringify(input.adapterConfig === undefined ? current.adapterConfig : normalizeObject(input.adapterConfig)),
        input.inboundSecret === undefined ? current.inboundSecret : input.inboundSecret?.trim() || null,
        updatedAt,
        input.routeId,
      );
    const updated = this.getRoute(input.routeId);
    if (!updated) {
      throw new Error(`Route ${input.routeId} was not found after update.`);
    }
    return updated;
  }

  public createOrRefreshRoutePairing(input: {
    readonly routeId: string;
    readonly workspaceId: string;
    readonly sender: string;
    readonly channelType: string;
    readonly channelKey: string;
    readonly code: string;
    readonly expiresAt?: string | null;
  }): RoutePairingRecord {
    this.initialize();
    const existing = this.findPendingRoutePairing(input.routeId, input.sender);
    const now = new Date().toISOString();
    if (existing) {
      this.database
        .prepare(
          "UPDATE route_pairings SET code = ?, expires_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          input.code,
          input.expiresAt ?? existing.expiresAt,
          now,
          existing.id,
        );
      const updated = this.getRoutePairing(existing.id);
      if (!updated) {
        throw new Error(`Route pairing ${existing.id} was not found after refresh.`);
      }
      return updated;
    }

    const record: RoutePairingRecord = {
      id: randomUUID(),
      routeId: input.routeId,
      workspaceId: input.workspaceId,
      sender: input.sender.trim(),
      channelType: input.channelType.trim(),
      channelKey: input.channelKey.trim(),
      code: input.code.trim(),
      status: "pending",
      approvedAt: null,
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        "INSERT INTO route_pairings (id, route_id, workspace_id, sender, channel_type, channel_key, code, status, approved_at, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.routeId,
        record.workspaceId,
        record.sender,
        record.channelType,
        record.channelKey,
        record.code,
        record.status,
        record.approvedAt,
        record.expiresAt,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  public getRoutePairing(pairingId: string): RoutePairingRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT id, route_id AS routeId, workspace_id AS workspaceId, sender, channel_type AS channelType, channel_key AS channelKey, code, status, approved_at AS approvedAt, expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt FROM route_pairings WHERE id = ?",
      )
      .get(pairingId) as unknown;
    return row ? mapRoutePairingRow(row) : null;
  }

  public getRoutePairingByCode(code: string): RoutePairingRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT id, route_id AS routeId, workspace_id AS workspaceId, sender, channel_type AS channelType, channel_key AS channelKey, code, status, approved_at AS approvedAt, expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt FROM route_pairings WHERE code = ?",
      )
      .get(code.trim()) as unknown;
    return row ? mapRoutePairingRow(row) : null;
  }

  public findPendingRoutePairing(routeId: string, sender: string): RoutePairingRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT id, route_id AS routeId, workspace_id AS workspaceId, sender, channel_type AS channelType, channel_key AS channelKey, code, status, approved_at AS approvedAt, expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt FROM route_pairings WHERE route_id = ? AND sender = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      )
      .get(routeId, sender.trim()) as unknown;
    return row ? mapRoutePairingRow(row) : null;
  }

  public listRoutePairings(input: {
    readonly workspaceId?: string;
    readonly routeId?: string;
    readonly status?: RoutePairingStatus;
    readonly limit?: number;
  } = {}): RoutePairingRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        "SELECT id, route_id AS routeId, workspace_id AS workspaceId, sender, channel_type AS channelType, channel_key AS channelKey, code, status, approved_at AS approvedAt, expires_at AS expiresAt, created_at AS createdAt, updated_at AS updatedAt FROM route_pairings WHERE (? IS NULL OR workspace_id = ?) AND (? IS NULL OR route_id = ?) AND (? IS NULL OR status = ?) ORDER BY updated_at DESC LIMIT ?",
      )
      .all(
        input.workspaceId ?? null,
        input.workspaceId ?? null,
        input.routeId ?? null,
        input.routeId ?? null,
        input.status ?? null,
        input.status ?? null,
        normalizeLimit(input.limit, 50),
      ) as unknown[];
    return rows.map((row) => mapRoutePairingRow(row));
  }

  public updateRoutePairing(input: {
    readonly pairingId: string;
    readonly status?: RoutePairingStatus;
    readonly approvedAt?: string | null;
    readonly expiresAt?: string | null;
  }): RoutePairingRecord {
    this.initialize();
    const current = this.getRoutePairing(input.pairingId);
    if (!current) {
      throw new Error(`Route pairing ${input.pairingId} was not found.`);
    }

    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        "UPDATE route_pairings SET status = ?, approved_at = ?, expires_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        input.status ?? current.status,
        input.approvedAt === undefined ? current.approvedAt : input.approvedAt,
        input.expiresAt === undefined ? current.expiresAt : input.expiresAt,
        updatedAt,
        input.pairingId,
      );
    const updated = this.getRoutePairing(input.pairingId);
    if (!updated) {
      throw new Error(`Route pairing ${input.pairingId} was not found after update.`);
    }
    return updated;
  }

  public createInboundMessage(input: {
    readonly routeId: string;
    readonly workspaceId: string;
    readonly threadId?: string | null;
    readonly channelType: string;
    readonly channelKey: string;
      readonly channelMessageId?: string | null;
      readonly sender?: string | null;
      readonly text: string;
      readonly metadata?: Record<string, unknown>;
      readonly status?: InboundMessageStatus;
      readonly runId?: string | null;
    }): InboundMessageRecord {
    this.initialize();
    const normalizedChannelMessageId = input.channelMessageId?.trim() || null;
    if (normalizedChannelMessageId) {
      const existing = this.findInboundMessageByChannelMessage(input.routeId, normalizedChannelMessageId);
      if (existing) {
        return existing;
      }
    }
    const now = new Date().toISOString();
    const record: InboundMessageRecord = {
      id: randomUUID(),
      routeId: input.routeId,
      workspaceId: input.workspaceId,
      threadId: input.threadId ?? null,
      channelType: input.channelType.trim(),
      channelKey: input.channelKey.trim(),
        channelMessageId: normalizedChannelMessageId,
        sender: input.sender?.trim() || null,
        text: input.text.trim(),
        metadata: { ...(input.metadata ?? {}) },
        status: input.status ?? "queued",
        runId: input.runId ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.database
        .prepare(
          "INSERT INTO inbound_messages (id, route_id, workspace_id, thread_id, channel_type, channel_key, channel_message_id, sender, text, metadata_json, status, run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          record.id,
        record.routeId,
        record.workspaceId,
        record.threadId,
        record.channelType,
          record.channelKey,
          record.channelMessageId,
          record.sender,
          record.text,
          JSON.stringify(record.metadata),
          record.status,
          record.runId,
          record.createdAt,
          record.updatedAt,
        );
    return record;
  }

  public findInboundMessageByChannelMessage(routeId: string, channelMessageId: string): InboundMessageRecord | null {
    this.initialize();
      const row = this.database
        .prepare(
          "SELECT id, route_id AS routeId, workspace_id AS workspaceId, thread_id AS threadId, channel_type AS channelType, channel_key AS channelKey, channel_message_id AS channelMessageId, sender, text, metadata_json AS metadataJson, status, run_id AS runId, created_at AS createdAt, updated_at AS updatedAt FROM inbound_messages WHERE route_id = ? AND channel_message_id = ?",
        )
        .get(routeId, channelMessageId) as unknown;
    return row ? mapInboundMessageRow(row) : null;
  }

  public getInboundMessage(messageId: string): InboundMessageRecord | null {
    this.initialize();
      const row = this.database
        .prepare(
          "SELECT id, route_id AS routeId, workspace_id AS workspaceId, thread_id AS threadId, channel_type AS channelType, channel_key AS channelKey, channel_message_id AS channelMessageId, sender, text, metadata_json AS metadataJson, status, run_id AS runId, created_at AS createdAt, updated_at AS updatedAt FROM inbound_messages WHERE id = ?",
        )
        .get(messageId) as unknown;
    return row ? mapInboundMessageRow(row) : null;
  }

  public listInboundMessages(input: {
    readonly workspaceId?: string;
    readonly routeId?: string;
    readonly status?: InboundMessageStatus;
    readonly limit?: number;
  } = {}): InboundMessageRecord[] {
    this.initialize();
      const rows = this.database
        .prepare(
          "SELECT id, route_id AS routeId, workspace_id AS workspaceId, thread_id AS threadId, channel_type AS channelType, channel_key AS channelKey, channel_message_id AS channelMessageId, sender, text, metadata_json AS metadataJson, status, run_id AS runId, created_at AS createdAt, updated_at AS updatedAt FROM inbound_messages WHERE (? IS NULL OR workspace_id = ?) AND (? IS NULL OR route_id = ?) AND (? IS NULL OR status = ?) ORDER BY updated_at DESC LIMIT ?",
        )
        .all(
        input.workspaceId ?? null,
        input.workspaceId ?? null,
        input.routeId ?? null,
        input.routeId ?? null,
        input.status ?? null,
        input.status ?? null,
        normalizeLimit(input.limit, 50),
      ) as unknown[];
    return rows.map((row) => mapInboundMessageRow(row));
  }

  public updateInboundMessage(input: {
    readonly messageId: string;
    readonly threadId?: string | null;
    readonly status?: InboundMessageStatus;
    readonly runId?: string | null;
  }): InboundMessageRecord {
    this.initialize();
    const current = this.getInboundMessage(input.messageId);
    if (!current) {
      throw new Error(`Inbound message ${input.messageId} was not found.`);
    }

    const updatedAt = new Date().toISOString();
    this.database
      .prepare("UPDATE inbound_messages SET thread_id = ?, status = ?, run_id = ?, updated_at = ? WHERE id = ?")
      .run(
        input.threadId === undefined ? current.threadId : input.threadId,
        input.status ?? current.status,
        input.runId === undefined ? current.runId : input.runId,
        updatedAt,
        input.messageId,
      );
    const updated = this.getInboundMessage(input.messageId);
    if (!updated) {
      throw new Error(`Inbound message ${input.messageId} was not found after update.`);
    }
    return updated;
  }

  public createOutboundDelivery(input: {
    readonly routeId: string;
    readonly workspaceId: string;
    readonly threadId?: string | null;
    readonly runId?: string | null;
    readonly channelType: string;
    readonly channelKey: string;
    readonly adapterType: RouteAdapterType;
    readonly payload: string;
    readonly status?: OutboundDeliveryStatus;
    readonly responseSummary?: string | null;
    readonly attemptCount?: number;
    readonly lastAttemptAt?: string | null;
    readonly deliveredAt?: string | null;
  }): OutboundDeliveryRecord {
    this.initialize();
    const now = new Date().toISOString();
    const record: OutboundDeliveryRecord = {
      id: randomUUID(),
      routeId: input.routeId,
      workspaceId: input.workspaceId,
      threadId: input.threadId ?? null,
      runId: input.runId ?? null,
      channelType: input.channelType.trim(),
      channelKey: input.channelKey.trim(),
      adapterType: input.adapterType,
      payload: input.payload,
      status: input.status ?? "queued",
      responseSummary: input.responseSummary ?? null,
      attemptCount: input.attemptCount ?? 0,
      lastAttemptAt: input.lastAttemptAt ?? null,
      deliveredAt: input.deliveredAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.database
      .prepare(
        "INSERT INTO outbound_deliveries (id, route_id, workspace_id, thread_id, run_id, channel_type, channel_key, adapter_type, payload, status, response_summary, attempt_count, last_attempt_at, delivered_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        record.id,
        record.routeId,
        record.workspaceId,
        record.threadId,
        record.runId,
        record.channelType,
        record.channelKey,
        record.adapterType,
        record.payload,
        record.status,
        record.responseSummary,
        record.attemptCount,
        record.lastAttemptAt,
        record.deliveredAt,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  public getOutboundDelivery(deliveryId: string): OutboundDeliveryRecord | null {
    this.initialize();
    const row = this.database
      .prepare(
        "SELECT id, route_id AS routeId, workspace_id AS workspaceId, thread_id AS threadId, run_id AS runId, channel_type AS channelType, channel_key AS channelKey, adapter_type AS adapterType, payload, status, response_summary AS responseSummary, attempt_count AS attemptCount, last_attempt_at AS lastAttemptAt, delivered_at AS deliveredAt, created_at AS createdAt, updated_at AS updatedAt FROM outbound_deliveries WHERE id = ?",
      )
      .get(deliveryId) as unknown;
    return row ? mapOutboundDeliveryRow(row) : null;
  }

  public listOutboundDeliveries(input: {
    readonly workspaceId?: string;
    readonly routeId?: string;
    readonly status?: OutboundDeliveryStatus;
    readonly limit?: number;
  } = {}): OutboundDeliveryRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        "SELECT id, route_id AS routeId, workspace_id AS workspaceId, thread_id AS threadId, run_id AS runId, channel_type AS channelType, channel_key AS channelKey, adapter_type AS adapterType, payload, status, response_summary AS responseSummary, attempt_count AS attemptCount, last_attempt_at AS lastAttemptAt, delivered_at AS deliveredAt, created_at AS createdAt, updated_at AS updatedAt FROM outbound_deliveries WHERE (? IS NULL OR workspace_id = ?) AND (? IS NULL OR route_id = ?) AND (? IS NULL OR status = ?) ORDER BY updated_at DESC LIMIT ?",
      )
      .all(
        input.workspaceId ?? null,
        input.workspaceId ?? null,
        input.routeId ?? null,
        input.routeId ?? null,
        input.status ?? null,
        input.status ?? null,
        normalizeLimit(input.limit, 50),
      ) as unknown[];
    return rows.map((row) => mapOutboundDeliveryRow(row));
  }

  public updateOutboundDelivery(input: {
    readonly deliveryId: string;
    readonly status?: OutboundDeliveryStatus;
    readonly responseSummary?: string | null;
    readonly attemptCount?: number;
    readonly lastAttemptAt?: string | null;
    readonly deliveredAt?: string | null;
  }): OutboundDeliveryRecord {
    this.initialize();
    const current = this.getOutboundDelivery(input.deliveryId);
    if (!current) {
      throw new Error(`Outbound delivery ${input.deliveryId} was not found.`);
    }

    const updatedAt = new Date().toISOString();
    this.database
      .prepare("UPDATE outbound_deliveries SET status = ?, response_summary = ?, attempt_count = ?, last_attempt_at = ?, delivered_at = ?, updated_at = ? WHERE id = ?")
      .run(
        input.status ?? current.status,
        input.responseSummary === undefined ? current.responseSummary : input.responseSummary,
        input.attemptCount ?? current.attemptCount,
        input.lastAttemptAt === undefined ? current.lastAttemptAt : input.lastAttemptAt,
        input.deliveredAt === undefined ? current.deliveredAt : input.deliveredAt,
        updatedAt,
        input.deliveryId,
      );
    const updated = this.getOutboundDelivery(input.deliveryId);
    if (!updated) {
      throw new Error(`Outbound delivery ${input.deliveryId} was not found after update.`);
    }
    return updated;
  }

  public listRunArtifacts(runId: string): ArtifactRecord[] {
    this.initialize();
    return this.database
      .prepare(
        "SELECT id, run_id AS runId, kind, path, summary, created_at AS createdAt FROM artifacts WHERE run_id = ? ORDER BY created_at ASC",
      )
      .all(runId) as unknown as ArtifactRecord[];
  }

  public listRunToolEvents(runId: string): ToolEventRecord[] {
    this.initialize();
    const rows = this.database
      .prepare(
        "SELECT id, run_id AS runId, tool_call_id AS toolCallId, tool_name AS toolName, risk_tier AS riskTier, status, summary, output_preview AS outputPreview, output_truncated AS outputTruncated, stored_output_ref AS storedOutputRef, presentation_json AS presentationJson, created_at AS createdAt FROM tool_events WHERE run_id = ? ORDER BY created_at ASC",
      )
      .all(runId) as Array<
      Omit<ToolEventRecord, "outputTruncated" | "presentation"> & {
        readonly outputTruncated: number;
        readonly presentationJson: string | null;
      }
    >;
    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      toolCallId: row.toolCallId ?? null,
      toolName: row.toolName,
      riskTier: row.riskTier,
      status: row.status,
      summary: row.summary,
      outputPreview: row.outputPreview,
      outputTruncated: Boolean(row.outputTruncated),
      storedOutputRef: row.storedOutputRef,
      presentation: parseOptionalJsonObject(row.presentationJson),
      createdAt: row.createdAt,
    }));
  }

  public completeRun(input: {
    readonly runId: string;
    readonly status: RunStatus;
    readonly finalResponse: string;
    readonly verificationStatus: string | null;
  }): RunRecord {
    this.initialize();
    const now = new Date().toISOString();
    this.database
      .prepare("UPDATE runs SET status = ?, final_response = ?, verification_status = ?, updated_at = ? WHERE id = ?")
      .run(input.status, input.finalResponse, input.verificationStatus, now, input.runId);

    const run = this.getRun(input.runId);
    if (!run) {
      throw new Error(`Run ${input.runId} was not found.`);
    }
    this.touchThread(run.threadId);
    return run;
  }

  public listThreadMessages(threadId: string, limit = 20): MessageRecord[] {
    this.initialize();
    return this.database
      .prepare(
        [
          "SELECT id, thread_id AS threadId, run_id AS runId, role, text, created_at AS createdAt",
          "FROM (",
          "  SELECT id, thread_id, run_id, role, text, created_at",
          "  FROM messages",
          "  WHERE thread_id = ?",
          "  ORDER BY created_at DESC",
          "  LIMIT ?",
          ") recent",
          "ORDER BY created_at ASC",
        ].join(" "),
      )
      .all(threadId, limit) as unknown as MessageRecord[];
  }

  public listAllThreadMessages(threadId: string): MessageRecord[] {
    this.initialize();
    return this.database
      .prepare(
        "SELECT id, thread_id AS threadId, run_id AS runId, role, text, created_at AS createdAt FROM messages WHERE thread_id = ? ORDER BY created_at ASC",
      )
      .all(threadId) as unknown as MessageRecord[];
  }

  public countThreadMessages(threadId: string): number {
    this.initialize();
    const row = this.database
      .prepare("SELECT COUNT(*) AS total FROM messages WHERE thread_id = ?")
      .get(threadId) as { total?: number } | undefined;
    return Math.max(0, Number(row?.total ?? 0));
  }

  public pruneThreadMessages(threadId: string, keepMessageIds: readonly string[]): number {
    this.initialize();
    if (keepMessageIds.length === 0) {
      throw new Error("pruneThreadMessages requires at least one message id to retain.");
    }

    const placeholders = keepMessageIds.map(() => "?").join(", ");
    const result = this.database
      .prepare(`DELETE FROM messages WHERE thread_id = ? AND id NOT IN (${placeholders})`)
      .run(threadId, ...keepMessageIds) as { changes?: number };
    this.syncMessagesSearchByThread(threadId);
    this.touchThread(threadId);
    return Number(result.changes ?? 0);
  }

  public listThreads(workspaceId: string): ThreadRecord[] {
    this.initialize();
    return this.database
      .prepare(
        "SELECT id, workspace_id AS workspaceId, title, created_at AS createdAt, updated_at AS updatedAt FROM threads WHERE workspace_id = ? ORDER BY updated_at DESC",
      )
      .all(workspaceId) as unknown as ThreadRecord[];
  }

  private get database(): DatabaseSync {
    if (!this.databaseHandle) {
      throw new Error("Session store has not been initialized.");
    }
    return this.databaseHandle;
  }

  private setupSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cwd TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        name TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL,
        agent_type TEXT NOT NULL DEFAULT 'general',
        default_role TEXT,
        mode TEXT NOT NULL DEFAULT 'default',
        state_root TEXT NOT NULL DEFAULT '',
        default_model_profile_id TEXT,
        context_engine_id TEXT,
        memory_provider_ids TEXT NOT NULL DEFAULT '[]',
        instruction TEXT,
        auth_profile_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_profile_states (
        auth_profile_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'healthy',
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        last_success_at TEXT,
        last_failure_at TEXT,
        cooldown_until TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS acp_session_bindings (
        thread_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        channel_key TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(channel_type, channel_key, conversation_id)
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        agent_id TEXT,
        objective TEXT NOT NULL,
        status TEXT NOT NULL,
        execution_domain TEXT NOT NULL,
        source_root TEXT,
        execution_root TEXT,
        worktree_path TEXT,
        worktree_branch TEXT,
        sandbox_path TEXT,
        execution_cleaned_at TEXT,
        final_response TEXT,
        verification_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        run_id TEXT,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_call_id TEXT,
        tool_name TEXT NOT NULL,
        risk_tier INTEGER NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        output_preview TEXT,
        output_truncated INTEGER NOT NULL DEFAULT 0,
        stored_output_ref TEXT,
        presentation_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subagent_jobs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        parent_thread_id TEXT NOT NULL,
        parent_run_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        session_mode TEXT NOT NULL DEFAULT 'run',
        role TEXT,
        mode TEXT NOT NULL,
        outcome_visibility TEXT NOT NULL,
        authority TEXT NOT NULL,
        status TEXT NOT NULL,
        root_job_id TEXT NOT NULL,
        parent_job_id TEXT,
        depth INTEGER NOT NULL,
        max_depth INTEGER NOT NULL,
        max_concurrent_children INTEGER NOT NULL,
        child_job_ids TEXT NOT NULL,
        execution_domain TEXT NOT NULL,
        budget_max_iterations INTEGER NOT NULL,
        budget_timeout_ms INTEGER NOT NULL,
        budget_max_retries INTEGER NOT NULL,
        plugin_dirs TEXT,
        allowed_tools TEXT,
        returned_artifact_kinds TEXT,
        target_paths TEXT,
        tool_policy_trace TEXT,
        attempts INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        queued_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        blocked_reason TEXT,
        blocked_by_job_ids TEXT,
        blocked_paths TEXT,
        paused_from_status TEXT,
        queue_position INTEGER,
        updated_at TEXT NOT NULL,
        messages_json TEXT NOT NULL DEFAULT '[]',
        thread_id TEXT,
        run_id TEXT,
        final_response TEXT,
        error TEXT,
        completion_json TEXT,
        progress_events_json TEXT
      );

      CREATE TABLE IF NOT EXISTS file_leases (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        path TEXT NOT NULL,
        owner_job_id TEXT NOT NULL,
        owner_thread_id TEXT NOT NULL,
        owner_run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        released_at TEXT
      );

      CREATE TABLE IF NOT EXISTS run_metrics (
        run_id TEXT PRIMARY KEY,
        model_profiles TEXT NOT NULL,
        turn_count INTEGER NOT NULL,
        tool_call_count INTEGER NOT NULL,
        tool_success_count INTEGER NOT NULL,
        tool_failure_count INTEGER NOT NULL,
        blocked_approval_count INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER,
        context_engine_id TEXT,
        context_engine_status_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_id TEXT,
        thread_id TEXT,
        scope TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profile_facts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_id TEXT,
        source_run_id TEXT,
        content TEXT NOT NULL,
        tags TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS thread_summaries (
        thread_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        last_run_id TEXT,
        summary TEXT NOT NULL,
        summary_version INTEGER NOT NULL DEFAULT 1,
        summary_hash TEXT NOT NULL DEFAULT '',
        handoff_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learned_skills (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_id TEXT,
        source_run_id TEXT,
        source_type TEXT NOT NULL DEFAULT 'learned',
        promoted_from_source_type TEXT,
        promoted_at TEXT,
        kind TEXT NOT NULL DEFAULT 'procedure',
        dedupe_key TEXT,
        lifecycle_state TEXT NOT NULL DEFAULT 'active',
        lifecycle_reason TEXT,
        materialized_skill_path TEXT,
        title TEXT NOT NULL,
        problem_pattern TEXT NOT NULL,
        guidance TEXT NOT NULL,
        example_objective TEXT,
        changed_files TEXT NOT NULL,
        tags TEXT NOT NULL,
        trigger_signals TEXT NOT NULL DEFAULT '[]',
        procedure_steps TEXT NOT NULL DEFAULT '[]',
        verification_status TEXT NOT NULL DEFAULT 'passed',
        verification_summary TEXT NOT NULL DEFAULT '',
        revision_count INTEGER NOT NULL DEFAULT 1,
        use_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        last_failure_at TEXT,
        quality_score INTEGER NOT NULL DEFAULT 50,
        expires_at TEXT,
        last_verified_at TEXT,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

        CREATE TABLE IF NOT EXISTS automations (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          agent_id TEXT,
          thread_id TEXT,
          title TEXT NOT NULL,
        thread_title TEXT,
        task TEXT NOT NULL,
        mode TEXT NOT NULL,
        execution_domain TEXT NOT NULL,
        verification_mode TEXT NOT NULL,
        verification_commands TEXT NOT NULL,
        auto_approve_risky INTEGER NOT NULL,
          max_iterations INTEGER NOT NULL,
          schedule_kind TEXT NOT NULL,
          interval_seconds INTEGER,
          schedule_expression TEXT,
          timezone TEXT,
          heartbeat_window_seconds INTEGER,
          trigger_event_types TEXT NOT NULL DEFAULT '[]',
          trigger_route_id TEXT,
          trigger_channel_type TEXT,
          trigger_channel_key TEXT,
          trigger_senders TEXT NOT NULL DEFAULT '[]',
          trigger_text_pattern TEXT,
          delivery_mode TEXT NOT NULL DEFAULT 'run',
          relay_template TEXT,
          retry_delay_seconds INTEGER,
          max_consecutive_failures INTEGER NOT NULL DEFAULT 3,
          status TEXT NOT NULL,
          delivery_state TEXT NOT NULL DEFAULT 'idle',
          failure_count INTEGER NOT NULL DEFAULT 0,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          last_run_at TEXT,
          last_run_id TEXT,
          next_run_at TEXT,
          last_failure_at TEXT,
          last_error TEXT,
          cooldown_until TEXT,
          dead_lettered_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

      CREATE TABLE IF NOT EXISTS routes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        agent_id TEXT,
        thread_id TEXT,
        title TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        channel_key TEXT NOT NULL,
        adapter_type TEXT NOT NULL DEFAULT 'console',
        adapter_config TEXT NOT NULL DEFAULT '{}',
        inbound_secret TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(channel_type, channel_key)
      );

        CREATE TABLE IF NOT EXISTS inbound_messages (
          id TEXT PRIMARY KEY,
          route_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL,
          thread_id TEXT,
          channel_type TEXT NOT NULL,
          channel_key TEXT NOT NULL,
          channel_message_id TEXT,
          sender TEXT,
          text TEXT NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL,
          run_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

      CREATE TABLE IF NOT EXISTS outbound_deliveries (
        id TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        thread_id TEXT,
        run_id TEXT,
        channel_type TEXT NOT NULL,
        channel_key TEXT NOT NULL,
        adapter_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        response_summary TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TEXT,
        delivered_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS route_pairings (
        id TEXT PRIMARY KEY,
        route_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        channel_key TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        approved_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profile_evaluations (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        workspace_id TEXT,
        agent_id TEXT,
        suite_title TEXT NOT NULL,
        categories_json TEXT NOT NULL DEFAULT '[]',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        scores_json TEXT NOT NULL DEFAULT '{}',
        passed INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT,
        agent_id TEXT,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        risk_level TEXT NOT NULL DEFAULT 'low',
        summary TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
    `);

    this.ensureColumn("runs", "source_root", "TEXT");
    this.ensureColumn("runs", "execution_root", "TEXT");
    this.ensureColumn("runs", "worktree_path", "TEXT");
    this.ensureColumn("runs", "worktree_branch", "TEXT");
    this.ensureColumn("runs", "sandbox_path", "TEXT");
    this.ensureColumn("runs", "execution_cleaned_at", "TEXT");
    this.ensureColumn("runs", "agent_id", "TEXT");
    this.ensureColumn("tool_events", "output_preview", "TEXT");
    this.ensureColumn("tool_events", "output_truncated", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("tool_events", "stored_output_ref", "TEXT");
    this.ensureColumn("tool_events", "tool_call_id", "TEXT");
    this.ensureColumn("tool_events", "presentation_json", "TEXT");
    this.ensureColumn("learned_skills", "success_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("learned_skills", "failure_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("learned_skills", "last_attempt_at", "TEXT");
    this.ensureColumn("learned_skills", "last_failure_at", "TEXT");
    this.ensureColumn("learned_skills", "quality_score", "INTEGER NOT NULL DEFAULT 50");
    this.ensureColumn("learned_skills", "expires_at", "TEXT");
    this.ensureColumn("learned_skills", "kind", "TEXT NOT NULL DEFAULT 'procedure'");
    this.ensureColumn("learned_skills", "dedupe_key", "TEXT");
    this.ensureColumn("learned_skills", "trigger_signals", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("learned_skills", "procedure_steps", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("learned_skills", "verification_status", "TEXT NOT NULL DEFAULT 'passed'");
    this.ensureColumn("learned_skills", "verification_summary", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("learned_skills", "revision_count", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("learned_skills", "last_verified_at", "TEXT");
    this.ensureColumn("learned_skills", "lifecycle_state", "TEXT NOT NULL DEFAULT 'active'");
    this.ensureColumn("learned_skills", "lifecycle_reason", "TEXT");
    this.ensureColumn("learned_skills", "materialized_skill_path", "TEXT");
    this.ensureColumn("learned_skills", "source_type", "TEXT NOT NULL DEFAULT 'learned'");
    this.ensureColumn("learned_skills", "promoted_from_source_type", "TEXT");
    this.ensureColumn("learned_skills", "promoted_at", "TEXT");
    this.ensureColumn("memories", "agent_id", "TEXT");
    this.ensureColumn("profile_facts", "agent_id", "TEXT");
    this.ensureColumn("learned_skills", "agent_id", "TEXT");
    this.ensureColumn("run_metrics", "blocked_approval_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("run_metrics", "context_engine_id", "TEXT");
    this.ensureColumn("run_metrics", "context_engine_status_json", "TEXT");
    this.ensureColumn("routes", "adapter_type", "TEXT NOT NULL DEFAULT 'console'");
    this.ensureColumn("routes", "adapter_config", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("routes", "inbound_secret", "TEXT");
    this.ensureColumn("routes", "agent_id", "TEXT");
    this.ensureColumn("automations", "agent_id", "TEXT");
    this.ensureColumn("automations", "retry_delay_seconds", "INTEGER");
    this.ensureColumn("automations", "schedule_expression", "TEXT");
    this.ensureColumn("automations", "timezone", "TEXT");
    this.ensureColumn("automations", "heartbeat_window_seconds", "INTEGER");
    this.ensureColumn("automations", "trigger_event_types", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("automations", "trigger_route_id", "TEXT");
    this.ensureColumn("automations", "trigger_channel_type", "TEXT");
    this.ensureColumn("automations", "trigger_channel_key", "TEXT");
    this.ensureColumn("automations", "trigger_senders", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("automations", "trigger_text_pattern", "TEXT");
    this.ensureColumn("automations", "delivery_mode", "TEXT NOT NULL DEFAULT 'run'");
    this.ensureColumn("automations", "relay_template", "TEXT");
    this.ensureColumn("automations", "max_consecutive_failures", "INTEGER NOT NULL DEFAULT 3");
    this.ensureColumn("automations", "delivery_state", "TEXT NOT NULL DEFAULT 'idle'");
    this.ensureColumn("automations", "failure_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("automations", "consecutive_failures", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("automations", "last_failure_at", "TEXT");
    this.ensureColumn("automations", "last_error", "TEXT");
    this.ensureColumn("automations", "cooldown_until", "TEXT");
    this.ensureColumn("automations", "dead_lettered_at", "TEXT");
    this.ensureColumn("inbound_messages", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("outbound_deliveries", "attempt_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("outbound_deliveries", "last_attempt_at", "TEXT");
    this.ensureColumn("outbound_deliveries", "delivered_at", "TEXT");
    this.ensureColumn("thread_summaries", "summary_version", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("thread_summaries", "summary_hash", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("thread_summaries", "handoff_json", "TEXT");
    this.ensureColumn("subagent_jobs", "session_mode", "TEXT NOT NULL DEFAULT 'run'");
    this.ensureColumn("subagent_jobs", "target_paths", "TEXT");
    this.ensureColumn("subagent_jobs", "blocked_reason", "TEXT");
    this.ensureColumn("subagent_jobs", "blocked_by_job_ids", "TEXT");
    this.ensureColumn("subagent_jobs", "blocked_paths", "TEXT");
    this.ensureColumn("subagent_jobs", "progress_events_json", "TEXT");
    this.ensureColumn("agents", "workspace_id", "TEXT");
    this.ensureColumn("agents", "agent_type", "TEXT NOT NULL DEFAULT 'general'");
    this.ensureColumn("agents", "default_role", "TEXT");
    this.ensureColumn("agents", "mode", "TEXT NOT NULL DEFAULT 'default'");
    this.ensureColumn("agents", "state_root", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("agents", "default_model_profile_id", "TEXT");
    this.ensureColumn("agents", "context_engine_id", "TEXT");
    this.ensureColumn("agents", "memory_provider_ids", "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn("agents", "instruction", "TEXT");
    this.ensureColumn("agents", "auth_profile_id", "TEXT");
    this.ensureColumn("agents", "metadata_json", "TEXT NOT NULL DEFAULT '{}'");
    this.ensureColumn("auth_profile_states", "success_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("auth_profile_states", "last_success_at", "TEXT");
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS profile_evaluations (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, workspace_id TEXT, agent_id TEXT, suite_title TEXT NOT NULL, categories_json TEXT NOT NULL DEFAULT '[]', metrics_json TEXT NOT NULL DEFAULT '{}', scores_json TEXT NOT NULL DEFAULT '{}', passed INTEGER NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);",
    );
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, workspace_id TEXT, agent_id TEXT, actor_type TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, risk_level TEXT NOT NULL DEFAULT 'low', summary TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);",
    );
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS auth_profile_states (auth_profile_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'healthy', success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0, consecutive_failures INTEGER NOT NULL DEFAULT 0, last_success_at TEXT, last_failure_at TEXT, cooldown_until TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
    );
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS acp_session_bindings (thread_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, channel_type TEXT NOT NULL, channel_key TEXT NOT NULL, conversation_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(channel_type, channel_key, conversation_id));",
    );
    this.database.exec(
      "CREATE INDEX IF NOT EXISTS idx_acp_session_bindings_lookup ON acp_session_bindings(channel_type, channel_key, conversation_id);",
    );
    this.database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_messages_route_channel_message ON inbound_messages(route_id, channel_message_id) WHERE channel_message_id IS NOT NULL;");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id, created_at DESC);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_automations_agent ON automations(agent_id, updated_at DESC);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_automations_workspace_schedule ON automations(workspace_id, schedule_kind, updated_at DESC);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id, updated_at DESC);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_learned_skills_workspace_dedupe ON learned_skills(workspace_id, kind, dedupe_key);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_subagent_jobs_workspace ON subagent_jobs(workspace_id, updated_at DESC);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_subagent_jobs_parent_run ON subagent_jobs(parent_run_id, updated_at DESC);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_subagent_jobs_root_job ON subagent_jobs(root_job_id, updated_at DESC);");
    this.database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_file_leases_workspace_path_active ON file_leases(workspace_id, path) WHERE status = 'active';");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_file_leases_owner_job ON file_leases(owner_job_id, updated_at DESC);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_profile_evaluations_profile ON profile_evaluations(profile_id, created_at DESC);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id, created_at DESC);");
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_audit_logs_agent ON audit_logs(agent_id, created_at DESC);");
    this.setupSearchIndexes();
  }

  private ensureColumn(tableName: string, columnName: string, columnDefinition: string): void {
    const columns = this.database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition};`);
  }

  private setupSearchIndexes(): void {
    try {
      this.database.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_search USING fts5(
          message_id UNINDEXED,
          workspace_id UNINDEXED,
          thread_id UNINDEXED,
          role UNINDEXED,
          thread_title,
          text,
          tokenize = 'porter unicode61 remove_diacritics 2'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_search USING fts5(
          memory_id UNINDEXED,
          workspace_id UNINDEXED,
          thread_id UNINDEXED,
          scope UNINDEXED,
          content,
          tags,
          tokenize = 'porter unicode61 remove_diacritics 2'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS profile_facts_search USING fts5(
          fact_id UNINDEXED,
          workspace_id UNINDEXED,
          content,
          tags,
          tokenize = 'porter unicode61 remove_diacritics 2'
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS learned_skills_search USING fts5(
          skill_id UNINDEXED,
          workspace_id UNINDEXED,
          title,
          problem_pattern,
          guidance,
          example_objective,
          changed_files,
          tags,
          tokenize = 'porter unicode61 remove_diacritics 2'
        );
      `);
      this.searchIndexesEnabled = true;
      this.rebuildSearchIndexes();
    } catch {
      this.searchIndexesEnabled = false;
    }
  }

  private rebuildSearchIndexes(): void {
    if (!this.searchIndexesEnabled) {
      return;
    }

    this.database.exec(`
      DELETE FROM messages_search;
      DELETE FROM memories_search;
      DELETE FROM profile_facts_search;
      DELETE FROM learned_skills_search;
    `);

    const messageRows = this.database
      .prepare(
        [
          "SELECT m.id AS messageId, t.workspace_id AS workspaceId, m.thread_id AS threadId,",
          "m.role AS role, t.title AS threadTitle, m.text AS text",
          "FROM messages m",
          "INNER JOIN threads t ON t.id = m.thread_id",
        ].join(" "),
      )
      .all() as Array<{
        messageId: string;
        workspaceId: string;
        threadId: string;
        role: MessageRecord["role"];
        threadTitle: string;
        text: string;
      }>;
    const insertMessage = this.database.prepare(
      "INSERT INTO messages_search (message_id, workspace_id, thread_id, role, thread_title, text) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const row of messageRows) {
      insertMessage.run(row.messageId, row.workspaceId, row.threadId, row.role, row.threadTitle, row.text);
    }

    const memoryRows = this.listMemorySearchRows();
    for (const row of memoryRows) {
      this.upsertMemorySearchRow(row);
    }

    const profileFactRows = this.listProfileFactSearchRows();
    for (const row of profileFactRows) {
      this.upsertProfileFactSearchRow(row);
    }

    const learnedSkillRows = this.listLearnedSkillSearchRows();
    for (const row of learnedSkillRows) {
      this.upsertLearnedSkillSearchRow(row);
    }
  }

  private listMemorySearchRows(): Array<{
    memoryId: string;
    workspaceId: string;
    threadId: string | null;
    scope: MemoryScope;
    content: string;
    tags: string;
  }> {
    return this.database
      .prepare(
        "SELECT id AS memoryId, workspace_id AS workspaceId, thread_id AS threadId, scope, content, tags FROM memories",
      )
      .all() as Array<{
        memoryId: string;
        workspaceId: string;
        threadId: string | null;
        scope: MemoryScope;
        content: string;
        tags: string;
      }>;
  }

  private listProfileFactSearchRows(): Array<{
    factId: string;
    workspaceId: string;
    content: string;
    tags: string;
  }> {
    return this.database
      .prepare("SELECT id AS factId, workspace_id AS workspaceId, content, tags FROM profile_facts")
      .all() as Array<{
        factId: string;
        workspaceId: string;
        content: string;
        tags: string;
      }>;
  }

  private listLearnedSkillSearchRows(): Array<{
    skillId: string;
    workspaceId: string;
    title: string;
    problemPattern: string;
    guidance: string;
    exampleObjective: string | null;
    changedFiles: string;
    tags: string;
  }> {
    return this.database
      .prepare(
        [
          "SELECT id AS skillId, workspace_id AS workspaceId, title,",
          "problem_pattern AS problemPattern,",
          "guidance || ' triggers: ' || trigger_signals || ' steps: ' || procedure_steps || ' verification: ' || verification_summary AS guidance,",
          "example_objective AS exampleObjective,",
          "changed_files AS changedFiles, tags FROM learned_skills",
        ].join(" "),
      )
      .all() as Array<{
        skillId: string;
        workspaceId: string;
        title: string;
        problemPattern: string;
        guidance: string;
        exampleObjective: string | null;
        changedFiles: string;
        tags: string;
      }>;
  }

  private syncMessagesSearchByThread(threadId: string): void {
    if (!this.searchIndexesEnabled) {
      return;
    }
    const rows = this.database
      .prepare(
        [
          "SELECT m.id AS messageId, t.workspace_id AS workspaceId, m.thread_id AS threadId,",
          "m.role AS role, t.title AS threadTitle, m.text AS text",
          "FROM messages m",
          "INNER JOIN threads t ON t.id = m.thread_id",
          "WHERE m.thread_id = ?",
        ].join(" "),
      )
      .all(threadId) as Array<{
        messageId: string;
        workspaceId: string;
        threadId: string;
        role: MessageRecord["role"];
        threadTitle: string;
        text: string;
      }>;

    this.database.prepare("DELETE FROM messages_search WHERE thread_id = ?").run(threadId);
    const insertMessage = this.database.prepare(
      "INSERT INTO messages_search (message_id, workspace_id, thread_id, role, thread_title, text) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const row of rows) {
      insertMessage.run(row.messageId, row.workspaceId, row.threadId, row.role, row.threadTitle, row.text);
    }
  }

  private syncMessageSearchRecord(record: MessageRecord): void {
    if (!this.searchIndexesEnabled) {
      return;
    }
    const thread = this.getThread(record.threadId);
    if (!thread) {
      return;
    }
    this.database.prepare("DELETE FROM messages_search WHERE message_id = ?").run(record.id);
    this.database
      .prepare(
        "INSERT INTO messages_search (message_id, workspace_id, thread_id, role, thread_title, text) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(record.id, thread.workspaceId, record.threadId, record.role, thread.title, record.text);
  }

  private syncMemorySearchRecord(record: MemoryRecord): void {
    if (!this.searchIndexesEnabled) {
      return;
    }
    this.upsertMemorySearchRow({
      memoryId: record.id,
      workspaceId: record.workspaceId,
      threadId: record.threadId,
      scope: record.scope,
      content: record.content,
      tags: JSON.stringify(record.tags),
    });
  }

  private upsertMemorySearchRow(row: {
    memoryId: string;
    workspaceId: string;
    threadId: string | null;
    scope: MemoryScope;
    content: string;
    tags: string;
  }): void {
    this.database.prepare("DELETE FROM memories_search WHERE memory_id = ?").run(row.memoryId);
    this.database
      .prepare(
        "INSERT INTO memories_search (memory_id, workspace_id, thread_id, scope, content, tags) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(row.memoryId, row.workspaceId, row.threadId, row.scope, row.content, stringifySearchTerms(row.tags));
  }

  private syncProfileFactSearchRecord(record: ProfileFactRecord): void {
    if (!this.searchIndexesEnabled) {
      return;
    }
    this.upsertProfileFactSearchRow({
      factId: record.id,
      workspaceId: record.workspaceId,
      content: record.content,
      tags: JSON.stringify(record.tags),
    });
  }

  private upsertProfileFactSearchRow(row: {
    factId: string;
    workspaceId: string;
    content: string;
    tags: string;
  }): void {
    this.database.prepare("DELETE FROM profile_facts_search WHERE fact_id = ?").run(row.factId);
    this.database
      .prepare(
        "INSERT INTO profile_facts_search (fact_id, workspace_id, content, tags) VALUES (?, ?, ?, ?)",
      )
      .run(row.factId, row.workspaceId, row.content, stringifySearchTerms(row.tags));
  }

  private syncLearnedSkillSearchRecord(record: LearnedSkillRecord): void {
    if (!this.searchIndexesEnabled) {
      return;
    }
    this.upsertLearnedSkillSearchRow({
      skillId: record.id,
      workspaceId: record.workspaceId,
      title: record.title,
      problemPattern: record.problemPattern,
      guidance: record.guidance,
      exampleObjective: record.exampleObjective,
      changedFiles: JSON.stringify(record.changedFiles),
      tags: JSON.stringify(record.tags),
    });
  }

  private upsertLearnedSkillSearchRow(row: {
    skillId: string;
    workspaceId: string;
    title: string;
    problemPattern: string;
    guidance: string;
    exampleObjective: string | null;
    changedFiles: string;
    tags: string;
  }): void {
    this.database.prepare("DELETE FROM learned_skills_search WHERE skill_id = ?").run(row.skillId);
    this.database
      .prepare(
        [
          "INSERT INTO learned_skills_search (",
          "skill_id, workspace_id, title, problem_pattern, guidance, example_objective, changed_files, tags",
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ].join(" "),
      )
      .run(
        row.skillId,
        row.workspaceId,
        row.title,
        row.problemPattern,
        row.guidance,
        row.exampleObjective ?? "",
        stringifySearchTerms(row.changedFiles),
        stringifySearchTerms(row.tags),
      );
  }

  private searchMemoriesWithFts(
    input: {
      readonly workspaceId: string;
      readonly agentId?: string | null;
      readonly threadId?: string | null;
      readonly scope?: MemoryScope;
      readonly limit?: number;
    },
    query: string,
  ): MemoryRecord[] | null {
    if (!this.searchIndexesEnabled) {
      return null;
    }

    const matchQuery = buildFtsMatchQuery(query);
    if (!matchQuery) {
      return null;
    }

    try {
      const rows = this.database
        .prepare(
          [
            "SELECT m.id, m.workspace_id AS workspaceId, m.agent_id AS agentId, m.thread_id AS threadId, m.scope, m.content, m.tags,",
            "m.created_at AS createdAt, m.updated_at AS updatedAt",
            "FROM memories_search",
            "INNER JOIN memories m ON m.id = memories_search.memory_id",
            "WHERE memories_search.workspace_id = ?",
            "AND (? IS NULL OR m.agent_id = ?)",
            "AND (? IS NULL OR memories_search.scope = ?)",
            "AND memories_search MATCH ?",
            "ORDER BY bm25(memories_search), m.updated_at DESC LIMIT ?",
          ].join(" "),
        )
        .all(
          input.workspaceId,
          normalizeAgentId(input.agentId),
          normalizeAgentId(input.agentId),
          input.scope ?? null,
          input.scope ?? null,
          matchQuery,
          normalizeLimit(input.limit, 10) * 5,
        ) as unknown[];
      return rows.map((row) => mapMemoryRow(row));
    } catch {
      return null;
    }
  }

  private searchProfileFactsWithFts(
    input: {
      readonly workspaceId: string;
      readonly agentId?: string | null;
      readonly limit?: number;
    },
    query: string,
  ): ProfileFactRecord[] | null {
    if (!this.searchIndexesEnabled) {
      return null;
    }

    const matchQuery = buildFtsMatchQuery(query);
    if (!matchQuery) {
      return null;
    }

    try {
      const rows = this.database
        .prepare(
          [
            "SELECT p.id, p.workspace_id AS workspaceId, p.agent_id AS agentId, p.source_run_id AS sourceRunId, p.content, p.tags,",
            "p.created_at AS createdAt, p.updated_at AS updatedAt",
            "FROM profile_facts_search",
            "INNER JOIN profile_facts p ON p.id = profile_facts_search.fact_id",
            "WHERE profile_facts_search.workspace_id = ?",
            "AND (? IS NULL OR p.agent_id = ?)",
            "AND profile_facts_search MATCH ?",
            "ORDER BY bm25(profile_facts_search), p.updated_at DESC LIMIT ?",
          ].join(" "),
        )
        .all(input.workspaceId, normalizeAgentId(input.agentId), normalizeAgentId(input.agentId), matchQuery, normalizeLimit(input.limit, 10)) as unknown[];
      return rows.map((row) => mapProfileFactRow(row));
    } catch {
      return null;
    }
  }

  private searchSessionsWithFts(
    input: {
      readonly workspaceId: string;
      readonly limit?: number;
    },
    query: string,
  ): SessionSearchResult[] | null {
    if (!this.searchIndexesEnabled) {
      return null;
    }

    const matchQuery = buildFtsMatchQuery(query);
    if (!matchQuery) {
      return null;
    }

    try {
      const rows = this.database
        .prepare(
          [
            "SELECT m.id AS messageId, m.thread_id AS threadId, t.title AS threadTitle, m.run_id AS runId,",
            "m.role AS role, m.text AS text, m.created_at AS createdAt",
            "FROM messages_search",
            "INNER JOIN messages m ON m.id = messages_search.message_id",
            "INNER JOIN threads t ON t.id = m.thread_id",
            "WHERE messages_search.workspace_id = ?",
            "AND messages_search MATCH ?",
            "ORDER BY bm25(messages_search), m.created_at DESC LIMIT ?",
          ].join(" "),
        )
        .all(input.workspaceId, matchQuery, normalizeLimit(input.limit, 10)) as unknown[];
      return rows.map((row) => mapSessionSearchRow(row, query));
    } catch {
      return null;
    }
  }

  private searchLearnedSkillsWithFts(
    workspaceId: string,
    query: string,
    limit?: number,
    agentId?: string | null,
  ): LearnedSkillRecord[] | null {
    if (!this.searchIndexesEnabled) {
      return null;
    }

    const matchQuery = buildFtsMatchQuery(query);
    if (!matchQuery) {
      return null;
    }

    try {
      const rows = this.database
        .prepare(
          [
            "SELECT ls.id, ls.workspace_id AS workspaceId, ls.agent_id AS agentId, ls.source_run_id AS sourceRunId, ls.source_type AS sourceType, ls.promoted_from_source_type AS promotedFromSourceType, ls.promoted_at AS promotedAt, ls.title,",
            "ls.kind, ls.dedupe_key AS dedupeKey, ls.lifecycle_state AS lifecycleState, ls.lifecycle_reason AS lifecycleReason, ls.materialized_skill_path AS materializedSkillPath, ls.problem_pattern AS problemPattern, ls.guidance,",
            "ls.example_objective AS exampleObjective, ls.changed_files AS changedFiles, ls.tags,",
            "ls.trigger_signals AS triggerSignals, ls.procedure_steps AS procedureSteps,",
            "ls.verification_status AS verificationStatus, ls.verification_summary AS verificationSummary,",
            "ls.revision_count AS revisionCount, ls.use_count AS useCount, ls.last_used_at AS lastUsedAt,",
            "ls.success_count AS successCount, ls.failure_count AS failureCount, ls.last_attempt_at AS lastAttemptAt, ls.last_failure_at AS lastFailureAt,",
            "ls.quality_score AS qualityScore, ls.expires_at AS expiresAt, ls.last_verified_at AS lastVerifiedAt,",
            "ls.created_at AS createdAt, ls.updated_at AS updatedAt",
            "FROM learned_skills_search",
            "INNER JOIN learned_skills ls ON ls.id = learned_skills_search.skill_id",
            "WHERE learned_skills_search.workspace_id = ?",
            "AND (? IS NULL OR ls.agent_id = ?)",
            "AND learned_skills_search MATCH ?",
            "AND (ls.expires_at IS NULL OR ls.expires_at > ?)",
            "AND ls.lifecycle_state != 'disabled'",
            "ORDER BY ls.quality_score DESC, bm25(learned_skills_search), ls.use_count DESC, ls.updated_at DESC LIMIT ?",
          ].join(" "),
        )
        .all(workspaceId, normalizeAgentId(agentId), normalizeAgentId(agentId), matchQuery, new Date().toISOString(), normalizeLimit(limit, 10)) as unknown[];
      return rows.map((row) => mapLearnedSkillRow(row));
    } catch {
      return null;
    }
  }
}

function mapMemoryRow(row: unknown): MemoryRecord {
  const record = row as {
    id: string;
    workspaceId: string;
    agentId?: string | null;
    threadId?: string | null;
    scope: MemoryScope;
    content: string;
    tags?: string;
    createdAt: string;
    updatedAt: string;
  };
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    agentId: normalizeAgentId(record.agentId),
    threadId: record.threadId ?? null,
    scope: record.scope,
    content: record.content,
    tags: parseStringArray(record.tags),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeLearnedSkillSourceType(sourceType?: string | null): LearnedSkillSourceType {
  switch (sourceType?.trim()) {
    case "bundled":
      return "bundled";
    case "workspace":
      return "workspace";
    case "personal":
      return "personal";
    case "third_party":
      return "third_party";
    case "learned":
    default:
      return "learned";
  }
}

function normalizeAgentMode(mode?: string | null): AgentMode {
  switch (mode?.trim()) {
    case "bound":
      return "bound";
    case "shared":
      return "shared";
    case "locked_down":
      return "locked_down";
    case "default":
    default:
      return "default";
  }
}

function normalizeAgentType(value?: string | null): string {
  const normalized = value?.trim();
  return normalized ? normalized : "general";
}

function normalizeOptionalAgentDefaultRole(value?: string | null): AgentDefaultRole | null {
  switch (value?.trim()) {
    case "planner":
    case "researcher":
    case "reviewer":
    case "verifier":
    case "worker":
    case "executor":
    case "supervisor":
    case "primary":
      return value.trim() as AgentDefaultRole;
    default:
      return null;
  }
}

function normalizeAuthProfileHealthStatus(value?: string | null): AuthProfileHealthStatus {
  switch (value?.trim()) {
    case "cooldown":
      return "cooldown";
    case "disabled":
      return "disabled";
    case "healthy":
    default:
      return "healthy";
  }
}

function normalizeAutomationScheduleKind(value: string | null | undefined): AutomationScheduleKind {
  switch (value?.trim()) {
    case "at":
    case "cron":
    case "event":
    case "heartbeat":
    case "interval":
    case "maintenance":
    case "manual":
      return value.trim() as AutomationScheduleKind;
    default:
      return "interval";
  }
}

function normalizeAutomationScheduleExpression(
  scheduleKind: AutomationScheduleKind,
  value: string | null | undefined,
): string | null {
  const expression = value?.trim() || null;
  if (scheduleKind === "at") {
    if (!expression) {
      throw new Error("at automations require a scheduleExpression timestamp.");
    }
    const timestamp = new Date(expression);
    if (Number.isNaN(timestamp.getTime())) {
      throw new Error(`Invalid at automation timestamp: ${expression}`);
    }
    return timestamp.toISOString();
  }
  if (scheduleKind === "cron") {
    if (!expression) {
      throw new Error("cron automations require a scheduleExpression.");
    }
    parseCronExpression(expression);
    return expression;
  }
  return null;
}

function normalizeAutomationTimezone(value: string | null | undefined): string | null {
  const timezone = value?.trim() || null;
  if (!timezone) {
    return null;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid automation timezone: ${timezone}`);
  }
  return timezone;
}

function normalizeAutomationDeliveryMode(value: string | null | undefined): AutomationDeliveryMode {
  return value?.trim() === "relay" ? "relay" : "run";
}

function normalizeAuditRiskLevel(value: string | null | undefined): AuditLogRecord["riskLevel"] {
  switch (value?.trim()) {
    case "high":
    case "medium":
    case "low":
      return value.trim() as AuditLogRecord["riskLevel"];
    default:
      return "low";
  }
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringArray(values: readonly string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeAutomationEventTypes(values: readonly string[] | null | undefined): string[] {
  const normalized = normalizeStringArray(values);
  return normalized.length > 0 ? normalized : ["inbox.received"];
}

function automationMatchesTrigger(automation: AutomationRecord, trigger: AutomationTriggerEvent): boolean {
  if (automation.scheduleKind !== "event" || automation.status !== "active" || automation.deliveryState === "dead_letter") {
    return false;
  }
  if (!automation.triggerEventTypes.includes(trigger.eventType.trim())) {
    return false;
  }
  if (automation.triggerRouteId && automation.triggerRouteId !== (trigger.routeId ?? null)) {
    return false;
  }
  if (automation.triggerChannelType && automation.triggerChannelType !== (trigger.channelType ?? null)) {
    return false;
  }
  if (automation.triggerChannelKey && automation.triggerChannelKey !== (trigger.channelKey ?? null)) {
    return false;
  }
  if (automation.triggerSenders.length > 0) {
    const sender = trigger.sender?.trim().toLowerCase() ?? "";
    if (!sender || !automation.triggerSenders.some((entry) => entry.toLowerCase() === sender)) {
      return false;
    }
  }
  if (automation.triggerTextPattern) {
    const haystack = trigger.text?.trim().toLowerCase() ?? "";
    if (!haystack || !haystack.includes(automation.triggerTextPattern.toLowerCase())) {
      return false;
    }
  }
  return true;
}

function mapSubagentJobRow(row: unknown): PersistedSubagentJobRecord {
  const record = row as {
    id: string;
    workspaceId: string;
    parentThreadId: string;
    parentRunId: string;
    objective: string;
    sessionMode?: "run" | "thread";
    role?: string | null;
    mode: "background" | "foreground";
    outcomeVisibility: "artifacts_only" | "context" | "summary_only";
    authority: "leaf" | "orchestrator";
    status: PersistedSubagentJobStatus;
    rootJobId: string;
    parentJobId?: string | null;
    depth: number;
    maxDepth: number;
    maxConcurrentChildren: number;
    childJobIds?: string;
    executionDomain: string;
    budgetMaxIterations: number;
    budgetTimeoutMs: number;
    budgetMaxRetries: number;
    pluginDirs?: string | null;
    allowedTools?: string | null;
    returnedArtifactKinds?: string | null;
    targetPaths?: string | null;
    toolPolicyTrace?: string | null;
    attempts: number;
    createdAt: string;
    queuedAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
    blockedReason?: string | null;
    blockedByJobIds?: string | null;
    blockedPaths?: string | null;
    pausedFromStatus?: "queued" | "running" | null;
    queuePosition?: number | null;
    updatedAt: string;
    messagesJson?: string | null;
    threadId?: string | null;
    runId?: string | null;
    finalResponse?: string | null;
    error?: string | null;
    completionJson?: string | null;
    progressEventsJson?: string | null;
  };
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    parentThreadId: record.parentThreadId,
    parentRunId: record.parentRunId,
    objective: record.objective,
    sessionMode: record.sessionMode === "thread" ? "thread" : "run",
    role: record.role ?? undefined,
    mode: record.mode,
    outcomeVisibility: record.outcomeVisibility,
    authority: record.authority,
    status: record.status,
    rootJobId: record.rootJobId,
    parentJobId: record.parentJobId ?? undefined,
    depth: record.depth,
    maxDepth: record.maxDepth,
    maxConcurrentChildren: record.maxConcurrentChildren,
    childJobIds: parseStringArray(record.childJobIds),
    executionDomain: record.executionDomain,
    budget: {
      maxIterations: record.budgetMaxIterations,
      timeoutMs: record.budgetTimeoutMs,
      maxRetries: record.budgetMaxRetries,
    },
    pluginDirs: parseOptionalStringArray(record.pluginDirs),
    allowedTools: parseOptionalStringArray(record.allowedTools),
    returnedArtifactKinds: parseOptionalStringArray(record.returnedArtifactKinds),
    targetPaths: parseOptionalStringArray(record.targetPaths),
    toolPolicyTrace: parseOptionalStringArray(record.toolPolicyTrace),
    attempts: record.attempts,
    createdAt: record.createdAt,
    queuedAt: record.queuedAt,
    startedAt: record.startedAt ?? undefined,
    completedAt: record.completedAt ?? undefined,
    blockedReason: record.blockedReason ?? undefined,
    blockedByJobIds: parseOptionalStringArray(record.blockedByJobIds),
    blockedPaths: parseOptionalStringArray(record.blockedPaths),
    pausedFromStatus: record.pausedFromStatus ?? undefined,
    queuePosition: record.queuePosition ?? undefined,
    updatedAt: record.updatedAt,
    messages: parseSubagentMessages(record.messagesJson),
    threadId: record.threadId ?? undefined,
    runId: record.runId ?? undefined,
    finalResponse: record.finalResponse ?? undefined,
    error: record.error ?? undefined,
    completion: parseSubagentCompletion(record.completionJson),
    progressEvents: parseSubagentProgressEvents(record.progressEventsJson),
  };
}

function mapFileLeaseRow(row: unknown): FileLeaseRecord {
  const record = row as {
    id: string;
    workspaceId: string;
    path: string;
    ownerJobId: string;
    ownerThreadId: string;
    ownerRunId: string;
    status: "active" | "released";
    createdAt: string;
    updatedAt: string;
    releasedAt?: string | null;
  };
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    path: record.path,
    ownerJobId: record.ownerJobId,
    ownerThreadId: record.ownerThreadId,
    ownerRunId: record.ownerRunId,
    status: record.status === "released" ? "released" : "active",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    releasedAt: record.releasedAt ?? null,
  };
}

function mapProfileFactRow(row: unknown): ProfileFactRecord {
  const record = row as {
    id: string;
    workspaceId: string;
    agentId?: string | null;
    sourceRunId?: string | null;
    content: string;
    tags?: string;
    createdAt: string;
    updatedAt: string;
  };
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    agentId: normalizeAgentId(record.agentId),
    sourceRunId: record.sourceRunId ?? null,
    content: record.content,
    tags: parseStringArray(record.tags),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapThreadSummaryRow(row: unknown): ThreadSummaryRecord {
  const record = row as {
    threadId: string;
    workspaceId: string;
    lastRunId?: string | null;
    summary: string;
    summaryVersion?: number;
    summaryHash?: string;
    handoffJson?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  return {
    threadId: record.threadId,
    workspaceId: record.workspaceId,
    lastRunId: record.lastRunId ?? null,
    summary: record.summary,
    summaryVersion: Math.max(1, Number(record.summaryVersion ?? 1)),
    summaryHash: typeof record.summaryHash === "string" && record.summaryHash.trim().length > 0
      ? record.summaryHash
      : hashThreadSummary(record.summary),
    handoff: parseThreadSummaryHandoff(record.handoffJson),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeThreadSummaryHandoff(
  value: Readonly<Record<string, unknown>> | null,
): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value;
}

function parseThreadSummaryHandoff(value: string | null | undefined): Readonly<Record<string, unknown>> | null {
  if (!value || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function mapRunMetricsRow(row: unknown): RunMetricsRecord {
  const record = row as {
    runId: string;
    modelProfiles?: string;
    turnCount?: number;
    toolCallCount?: number;
    toolSuccessCount?: number;
    toolFailureCount?: number;
    blockedApprovalCount?: number;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    startedAt: string;
    completedAt?: string | null;
    durationMs?: number | null;
    contextEngineId?: string | null;
    contextEngineStatusJson?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  return {
    runId: record.runId,
    modelProfiles: parseStringArray(record.modelProfiles),
    turnCount: normalizeNonNegativeInteger(record.turnCount),
    toolCallCount: normalizeNonNegativeInteger(record.toolCallCount),
    toolSuccessCount: normalizeNonNegativeInteger(record.toolSuccessCount),
    toolFailureCount: normalizeNonNegativeInteger(record.toolFailureCount),
    blockedApprovalCount: normalizeNonNegativeInteger(record.blockedApprovalCount),
    inputTokens: normalizeOptionalNonNegativeInteger(record.inputTokens),
    outputTokens: normalizeOptionalNonNegativeInteger(record.outputTokens),
    totalTokens: normalizeOptionalNonNegativeInteger(record.totalTokens),
    startedAt: record.startedAt,
    completedAt: record.completedAt ?? null,
    durationMs: normalizeOptionalNonNegativeInteger(record.durationMs),
    contextEngineId: record.contextEngineId?.trim() || null,
    contextEngineStatus: parseOptionalJsonObject(record.contextEngineStatusJson),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapAgentRow(row: Record<string, unknown>): AgentRecord {
  return {
    id: String(row.id ?? ""),
    workspaceId: typeof row.workspaceId === "string" ? row.workspaceId : null,
    name: String(row.name ?? ""),
    cwd: String(row.cwd ?? ""),
    status: row.status === "paused" ? "paused" : "active",
    agentType: normalizeAgentType(typeof row.agentType === "string" ? row.agentType : null),
    defaultRole: normalizeOptionalAgentDefaultRole(typeof row.defaultRole === "string" ? row.defaultRole : null),
    mode: normalizeAgentMode(typeof row.mode === "string" ? row.mode : null),
    stateRoot: typeof row.stateRoot === "string" ? row.stateRoot : "",
    defaultModelProfileId: typeof row.defaultModelProfileId === "string" ? row.defaultModelProfileId : null,
    contextEngineId: typeof row.contextEngineId === "string" ? row.contextEngineId : null,
    memoryProviderIds: parseStringArray(typeof row.memoryProviderIdsJson === "string" ? row.memoryProviderIdsJson : undefined),
    instruction: typeof row.instruction === "string" ? row.instruction : null,
    authProfileId: typeof row.authProfileId === "string" ? row.authProfileId : null,
    metadata: parseOptionalJsonObject(typeof row.metadataJson === "string" ? row.metadataJson : null) ?? {},
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function mapAuthProfileStateRow(row: Record<string, unknown>): AuthProfileStateRecord {
  return {
    authProfileId: String(row.authProfileId ?? ""),
    status: normalizeAuthProfileHealthStatus(typeof row.status === "string" ? row.status : null),
    successCount: normalizeNonNegativeInteger(row.successCount),
    failureCount: normalizeNonNegativeInteger(row.failureCount),
    consecutiveFailures: normalizeNonNegativeInteger(row.consecutiveFailures),
    lastSuccessAt: typeof row.lastSuccessAt === "string" ? row.lastSuccessAt : null,
    lastFailureAt: typeof row.lastFailureAt === "string" ? row.lastFailureAt : null,
    cooldownUntil: typeof row.cooldownUntil === "string" ? row.cooldownUntil : null,
    lastError: typeof row.lastError === "string" ? row.lastError : null,
    createdAt: String(row.createdAt ?? ""),
    updatedAt: String(row.updatedAt ?? ""),
  };
}

function mapSessionSearchRow(row: unknown, query: string): SessionSearchResult {
  const record = row as {
    threadId: string;
    threadTitle: string;
    messageId: string;
    runId?: string | null;
    role: MessageRecord["role"];
    text: string;
    createdAt: string;
  };
  return {
    threadId: record.threadId,
    threadTitle: record.threadTitle,
    messageId: record.messageId,
    runId: record.runId ?? null,
    role: record.role,
    text: record.text,
    excerpt: buildExcerpt(record.text, query),
    createdAt: record.createdAt,
  };
}

function mapLearnedSkillRow(row: unknown): LearnedSkillRecord {
  const record = row as {
    id: string;
    workspaceId: string;
    agentId?: string | null;
    sourceRunId?: string | null;
    sourceType?: string | null;
    promotedFromSourceType?: string | null;
    promotedAt?: string | null;
    kind?: string;
    dedupeKey?: string | null;
    lifecycleState?: string;
    lifecycleReason?: string | null;
    materializedSkillPath?: string | null;
    title: string;
    problemPattern: string;
    guidance: string;
    exampleObjective?: string | null;
    changedFiles?: string;
    tags?: string;
    triggerSignals?: string;
    procedureSteps?: string;
    verificationStatus?: string;
    verificationSummary?: string;
    revisionCount?: number;
    useCount?: number;
    successCount?: number;
    failureCount?: number;
    lastAttemptAt?: string | null;
    lastFailureAt?: string | null;
    qualityScore?: number;
    expiresAt?: string | null;
    lastVerifiedAt?: string | null;
    lastUsedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    agentId: normalizeAgentId(record.agentId),
    sourceRunId: record.sourceRunId ?? null,
    sourceType: normalizeLearnedSkillSourceType(record.sourceType),
    promotedFromSourceType: record.promotedFromSourceType
      ? normalizeLearnedSkillSourceType(record.promotedFromSourceType)
      : null,
    promotedAt: record.promotedAt ?? null,
    kind: record.kind ?? "procedure",
    dedupeKey: record.dedupeKey ?? null,
    lifecycleState: normalizeLearnedSkillLifecycleState(record.lifecycleState),
    lifecycleReason: record.lifecycleReason ?? null,
    materializedSkillPath: record.materializedSkillPath ?? null,
    title: record.title,
    problemPattern: record.problemPattern,
    guidance: record.guidance,
    exampleObjective: record.exampleObjective ?? null,
    changedFiles: parseStringArray(record.changedFiles),
    tags: parseStringArray(record.tags),
    triggerSignals: parseStringArray(record.triggerSignals),
    procedureSteps: parseStringArray(record.procedureSteps),
    verificationStatus: record.verificationStatus ?? "passed",
    verificationSummary: record.verificationSummary ?? "",
    revisionCount: Math.max(1, Number(record.revisionCount ?? 1)),
    useCount: Number(record.useCount ?? 0),
    successCount: Number(record.successCount ?? 0),
    failureCount: Number(record.failureCount ?? 0),
    lastAttemptAt: record.lastAttemptAt ?? null,
    lastFailureAt: record.lastFailureAt ?? null,
    qualityScore: Number(record.qualityScore ?? 50),
    expiresAt: record.expiresAt ?? null,
    lastVerifiedAt: record.lastVerifiedAt ?? null,
    lastUsedAt: record.lastUsedAt ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapAutomationRow(row: unknown): AutomationRecord {
  const record = row as {
    id: string;
    workspaceId: string;
    agentId?: string | null;
    threadId?: string | null;
    title: string;
    threadTitle?: string | null;
    task: string;
    mode: string;
    executionDomain: string;
    verificationMode: string;
    verificationCommands?: string;
    autoApproveRisky?: number | boolean;
    maxIterations: number;
    scheduleKind: AutomationScheduleKind;
    intervalSeconds?: number | null;
    scheduleExpression?: string | null;
    timezone?: string | null;
    heartbeatWindowSeconds?: number | null;
    triggerEventTypes?: string;
    triggerRouteId?: string | null;
    triggerChannelType?: string | null;
    triggerChannelKey?: string | null;
    triggerSenders?: string;
    triggerTextPattern?: string | null;
    deliveryMode?: string | null;
    relayTemplate?: string | null;
    retryDelaySeconds?: number | null;
    maxConsecutiveFailures?: number;
    status: AutomationStatus;
    deliveryState?: AutomationDeliveryState;
    failureCount?: number;
    consecutiveFailures?: number;
    lastRunAt?: string | null;
    lastRunId?: string | null;
    nextRunAt?: string | null;
    lastFailureAt?: string | null;
    lastError?: string | null;
    cooldownUntil?: string | null;
    deadLetteredAt?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    agentId: record.agentId ?? null,
    threadId: record.threadId ?? null,
    title: record.title,
    threadTitle: record.threadTitle ?? null,
    task: record.task,
    mode: record.mode,
    executionDomain: record.executionDomain,
    verificationMode: record.verificationMode,
    verificationCommands: parseStringArray(record.verificationCommands),
    autoApproveRisky: Boolean(record.autoApproveRisky),
    maxIterations: Number(record.maxIterations),
    scheduleKind: normalizeAutomationScheduleKind(record.scheduleKind),
    intervalSeconds:
      record.intervalSeconds === null || record.intervalSeconds === undefined ? null : Number(record.intervalSeconds),
    scheduleExpression: record.scheduleExpression ?? null,
    timezone: record.timezone ?? null,
    heartbeatWindowSeconds:
      record.heartbeatWindowSeconds === null || record.heartbeatWindowSeconds === undefined
        ? null
        : Number(record.heartbeatWindowSeconds),
    triggerEventTypes: normalizeAutomationEventTypes(parseStringArray(record.triggerEventTypes)),
    triggerRouteId: record.triggerRouteId ?? null,
    triggerChannelType: record.triggerChannelType ?? null,
    triggerChannelKey: record.triggerChannelKey ?? null,
    triggerSenders: normalizeStringArray(parseStringArray(record.triggerSenders)),
    triggerTextPattern: record.triggerTextPattern ?? null,
    deliveryMode: normalizeAutomationDeliveryMode(record.deliveryMode),
    relayTemplate: record.relayTemplate ?? null,
    retryDelaySeconds:
      record.retryDelaySeconds === null || record.retryDelaySeconds === undefined ? null : Number(record.retryDelaySeconds),
    maxConsecutiveFailures: Number(record.maxConsecutiveFailures ?? 3),
    status: record.status,
    deliveryState: record.deliveryState ?? "idle",
    failureCount: Number(record.failureCount ?? 0),
    consecutiveFailures: Number(record.consecutiveFailures ?? 0),
    lastRunAt: record.lastRunAt ?? null,
    lastRunId: record.lastRunId ?? null,
    nextRunAt: record.nextRunAt ?? null,
    lastFailureAt: record.lastFailureAt ?? null,
    lastError: record.lastError ?? null,
    cooldownUntil: record.cooldownUntil ?? null,
    deadLetteredAt: record.deadLetteredAt ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapRouteRow(row: unknown): ChannelRouteRecord {
  const record = row as {
    id: string;
    workspaceId: string;
    agentId?: string | null;
    threadId?: string | null;
    title: string;
    channelType: string;
    channelKey: string;
    adapterType?: RouteAdapterType;
    adapterConfig?: string;
    inboundSecret?: string | null;
    status: ChannelRouteStatus;
    createdAt: string;
    updatedAt: string;
  };
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    agentId: record.agentId ?? null,
    threadId: record.threadId ?? null,
    title: record.title,
    channelType: record.channelType,
    channelKey: record.channelKey,
    adapterType: record.adapterType ?? "console",
    adapterConfig: parseJsonObject(record.adapterConfig),
    inboundSecret: record.inboundSecret ?? null,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapProfileEvaluationRow(row: unknown): ProfileEvaluationRecord {
  const record = row as {
    id: string;
    profileId: string;
    workspaceId?: string | null;
    agentId?: string | null;
    suiteTitle: string;
    categories?: string;
    metrics?: string;
    scores?: string;
    passed?: number | boolean;
    summary?: string;
    createdAt: string;
  };
  return {
    id: record.id,
    profileId: record.profileId,
    workspaceId: record.workspaceId ?? null,
    agentId: record.agentId ?? null,
    suiteTitle: record.suiteTitle,
    categories: parseStringArray(record.categories),
    metrics: parseJsonObject(record.metrics),
    scores: parseJsonObject(record.scores),
    passed: Boolean(record.passed),
    summary: record.summary ?? "",
    createdAt: record.createdAt,
  };
}

function mapAuditLogRow(row: unknown): AuditLogRecord {
  const record = row as {
    id: string;
    workspaceId?: string | null;
    agentId?: string | null;
    actorType: string;
    actorId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    riskLevel?: string;
    summary: string;
    metadata?: string;
    createdAt: string;
  };
  return {
    id: record.id,
    workspaceId: record.workspaceId ?? null,
    agentId: record.agentId ?? null,
    actorType: record.actorType,
    actorId: record.actorId ?? null,
    action: record.action,
    targetType: record.targetType,
    targetId: record.targetId ?? null,
    riskLevel: normalizeAuditRiskLevel(record.riskLevel),
    summary: redactSensitiveText(record.summary),
    metadata: redactSensitiveValue(parseJsonObject(record.metadata)) as Readonly<Record<string, unknown>>,
    createdAt: record.createdAt,
  };
}

function mapInboundMessageRow(row: unknown): InboundMessageRecord {
  const record = row as {
    id: string;
    routeId: string;
    workspaceId: string;
    threadId?: string | null;
    channelType: string;
    channelKey: string;
    channelMessageId?: string | null;
    sender?: string | null;
    text: string;
    metadataJson?: string;
    status: InboundMessageStatus;
    runId?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  return {
    id: record.id,
    routeId: record.routeId,
    workspaceId: record.workspaceId,
    threadId: record.threadId ?? null,
    channelType: record.channelType,
    channelKey: record.channelKey,
    channelMessageId: record.channelMessageId ?? null,
    sender: record.sender ?? null,
    text: record.text,
    metadata: parseJsonObject(record.metadataJson),
    status: record.status,
    runId: record.runId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function mapOutboundDeliveryRow(row: unknown): OutboundDeliveryRecord {
  const record = row as {
    id: string;
    routeId: string;
    workspaceId: string;
    threadId?: string | null;
    runId?: string | null;
    channelType: string;
    channelKey: string;
    adapterType?: RouteAdapterType;
    payload: string;
    status: OutboundDeliveryStatus;
    responseSummary?: string | null;
    attemptCount?: number;
    lastAttemptAt?: string | null;
    deliveredAt?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  return {
    id: record.id,
    routeId: record.routeId,
    workspaceId: record.workspaceId,
    threadId: record.threadId ?? null,
    runId: record.runId ?? null,
    channelType: record.channelType,
    channelKey: record.channelKey,
    adapterType: record.adapterType ?? "console",
    payload: record.payload,
    status: normalizeOutboundDeliveryStatus(record.status),
    responseSummary: record.responseSummary ?? null,
    attemptCount: Number(record.attemptCount ?? 0),
    lastAttemptAt: record.lastAttemptAt ?? null,
    deliveredAt: record.deliveredAt ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeOutboundDeliveryStatus(value: unknown): OutboundDeliveryStatus {
  switch (typeof value === "string" ? value.trim() : "") {
    case "acknowledged":
    case "dead_letter":
    case "delivered":
    case "failed":
    case "queued":
    case "retrying":
    case "sending":
    case "sent":
      return value as OutboundDeliveryStatus;
    default:
      return "queued";
  }
}

function mapRoutePairingRow(row: unknown): RoutePairingRecord {
  const record = row as {
    id: string;
    routeId: string;
    workspaceId: string;
    sender: string;
    channelType: string;
    channelKey: string;
    code: string;
    status: RoutePairingStatus;
    approvedAt?: string | null;
    expiresAt?: string | null;
    createdAt: string;
    updatedAt: string;
  };
  return {
    id: record.id,
    routeId: record.routeId,
    workspaceId: record.workspaceId,
    sender: record.sender,
    channelType: record.channelType,
    channelKey: record.channelKey,
    code: record.code,
    status: record.status,
    approvedAt: record.approvedAt ?? null,
    expiresAt: record.expiresAt ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function normalizeAgentRunArtifactPayload(input: {
  readonly run: RunRecord;
  readonly createdAt: string;
  readonly taskContract?: Partial<AgentRunTaskContractArtifact>;
  readonly toolTrace: readonly AgentRunToolTraceArtifact[];
  readonly approvals?: readonly AgentRunApprovalArtifact[];
  readonly diff?: AgentRunDiffArtifact | null;
  readonly verification?: Partial<AgentRunVerificationArtifact> | null;
  readonly summary?: Partial<AgentRunSummaryArtifact> | null;
}): AgentRunArtifactPayload {
  return normalizeJsonSafeValue({
    schemaVersion: 1,
    kind: "agent-run",
    runId: input.run.id,
    createdAt: input.createdAt,
    taskContract: {
      objective: input.taskContract?.objective ?? input.run.objective,
      executionDomain: input.taskContract?.executionDomain ?? input.run.executionDomain,
      sourceRoot: input.taskContract?.sourceRoot ?? input.run.sourceRoot,
      executionRoot: input.taskContract?.executionRoot ?? input.run.executionRoot,
      successCriteria: normalizeSteps(input.taskContract?.successCriteria),
      constraints: normalizeSteps(input.taskContract?.constraints),
    },
    toolTrace: input.toolTrace.map((event) => ({
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      riskTier: normalizeNonNegativeInteger(event.riskTier),
      status: event.status,
      summary: event.summary,
      outputPreview: event.outputPreview,
      outputTruncated: Boolean(event.outputTruncated),
      storedOutputRef: event.storedOutputRef,
      presentation: event.presentation,
      createdAt: event.createdAt,
    })),
    approvals: (input.approvals ?? []).map((approval) => ({
      toolName: approval.toolName,
      decision: approval.decision,
      riskTier: approval.riskTier,
      approvalClass: approval.approvalClass,
      scope: approval.scope,
      summary: approval.summary,
      createdAt: approval.createdAt,
    })),
    diff: input.diff
      ? {
        changedFiles: normalizeSteps(input.diff.changedFiles),
        summary: input.diff.summary,
        patch: input.diff.patch,
        patchArtifactPath: input.diff.patchArtifactPath,
      }
      : null,
    verification: {
      status: input.verification?.status ?? input.run.verificationStatus ?? "not-recorded",
      commands: normalizeSteps(input.verification?.commands),
      summary: input.verification?.summary,
    },
    summary: {
      finalResponse: input.summary?.finalResponse ?? input.run.finalResponse,
      notes: normalizeSteps(input.summary?.notes),
      nextSteps: normalizeSteps(input.summary?.nextSteps),
    },
  }) as AgentRunArtifactPayload;
}

function parseStringArray(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((entry) => entry.trim()).filter(Boolean)));
}

function normalizeLeasePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim();
}

function parseOptionalStringArray(value: string | null | undefined): string[] | undefined {
  const parsed = parseStringArray(value ?? undefined);
  return parsed.length > 0 ? parsed : undefined;
}

function parseSubagentMessages(value: string | null | undefined): PersistedSubagentMessageRecord[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : randomUUID(),
        author: "parent" as const,
        content: typeof entry.content === "string" ? entry.content : "",
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date(0).toISOString(),
      }))
      .filter((entry) => entry.content.length > 0);
  } catch {
    return [];
  }
}

function parseSubagentCompletion(
  value: string | null | undefined,
): PersistedSubagentCompletionRecord | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    return {
      status: (record.status as PersistedSubagentJobStatus) ?? "failed",
      verificationStatus: typeof record.verificationStatus === "string" ? record.verificationStatus : "not-run",
      changedFiles: Array.isArray(record.changedFiles)
        ? record.changedFiles.filter((entry): entry is string => typeof entry === "string")
        : [],
      finalResponse: typeof record.finalResponse === "string" ? record.finalResponse : "",
      error: typeof record.error === "string" ? record.error : undefined,
      structuredResult: parseStructuredSubagentResult(record.structuredResult),
    };
  } catch {
    return undefined;
  }
}

function parseSubagentProgressEvents(value: string | null | undefined): PersistedSubagentProgressEvent[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const events = parsed
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => {
        const status = entry.status as PersistedSubagentJobStatus;
        if (typeof entry.at !== "string" || typeof entry.reason !== "string" || typeof entry.summary !== "string") {
          return null;
        }
        return {
          at: entry.at,
          status,
          reason: entry.reason,
          summary: entry.summary,
        };
      })
      .filter((entry): entry is PersistedSubagentProgressEvent => Boolean(entry));
    return events.length > 0 ? events : undefined;
  } catch {
    return undefined;
  }
}

function parseStructuredSubagentResult(value: unknown): PersistedStructuredSubagentResult | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind !== "findings" && kind !== "plan" && kind !== "review" && kind !== "verdict") {
    return undefined;
  }
  return {
    kind,
    status: typeof record.status === "string" ? record.status : "",
    summary: typeof record.summary === "string" ? record.summary : "",
    bullets: Array.isArray(record.bullets)
      ? record.bullets.filter((entry): entry is string => typeof entry === "string")
      : undefined,
  };
}

function parseJsonObject(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringifySearchTerms(value: string): string {
  const parsed = parseStringArray(value);
  return parsed.length > 0 ? parsed.join(" ") : value;
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (tags ?? [])
        .map((entry) => redactSensitiveText(entry).trim())
        .filter(Boolean),
    ),
  );
}

function normalizeSteps(steps: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (steps ?? [])
        .map((entry) => entry.replace(/\s+/g, " ").trim())
        .filter(Boolean),
    ),
  );
}

function calculateLearnedSkillQuality(successCount: number, failureCount: number): number {
  if (successCount <= 0 && failureCount <= 0) {
    return 50;
  }
  const total = successCount + failureCount;
  const ratio = successCount / total;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function normalizeLearnedSkillLifecycleState(
  value: string | null | undefined,
): LearnedSkillRecord["lifecycleState"] {
  return value === "needs_reverify" || value === "disabled" ? value : "active";
}

function resolveLearnedSkillLifecycleFromOutcome(input: {
  readonly currentState: LearnedSkillRecord["lifecycleState"];
  readonly successCount: number;
  readonly failureCount: number;
  readonly succeeded: boolean;
  readonly qualityScore: number;
}): LearnedSkillRecord["lifecycleState"] {
  if (input.succeeded) {
    return "active";
  }
  if (input.failureCount >= 3) {
    return "disabled";
  }
  return input.currentState === "disabled" ? "disabled" : "needs_reverify";
}

function computeLearnedSkillExpiry(now: Date, qualityScore: number): string | null {
  const days = qualityScore >= 90 ? 180 : qualityScore >= 70 ? 90 : qualityScore >= 50 ? 60 : 14;
  if (!Number.isFinite(days) || days <= 0) {
    return null;
  }
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function normalizeObject(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value && typeof value === "object" ? { ...value } : {};
}

function normalizeOptionalJsonObject(
  value: Readonly<Record<string, unknown>> | null | undefined,
): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return { ...value };
}

function normalizeOptionalUnknownJsonObject(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const normalized = normalizeJsonSafeValue(value);
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
    return null;
  }
  return normalized as Readonly<Record<string, unknown>>;
}

function serializeOptionalJsonObject(value: Readonly<Record<string, unknown>> | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function normalizeJsonSafeValue(value: unknown): unknown {
  return redactSensitiveValue(value);
}

function parseOptionalJsonObject(value: string | null | undefined): Readonly<Record<string, unknown>> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : 0;
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : null;
}

function matchesMemoryScope(
  record: MemoryRecord,
  input: {
    readonly threadId?: string | null;
    readonly scope?: MemoryScope;
  },
): boolean {
  if (input.scope === "workspace") {
    return record.scope === "workspace";
  }
  if (input.scope === "thread") {
    return record.scope === "thread" && record.threadId === (input.threadId ?? null);
  }
  if (input.threadId) {
    return record.scope === "workspace" || record.threadId === input.threadId;
  }
  return true;
}

function buildFtsMatchQuery(query: string): string {
  const terms = extractSearchTerms(query);
  return terms.map((term) => `${term}*`).join(" OR ");
}

function extractSearchTerms(query: string): string[] {
  return Array.from(
    new Set(
      (query.match(/[\p{L}\p{N}_-]+/gu) ?? [])
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function computeAutomationNextRunAt(
  schedule: {
    readonly scheduleKind: AutomationScheduleKind;
    readonly intervalSeconds?: number | null;
    readonly scheduleExpression?: string | null;
    readonly timezone?: string | null;
  },
  baseIso: string,
): string | null {
  if (
    (schedule.scheduleKind === "interval" ||
      schedule.scheduleKind === "heartbeat" ||
      schedule.scheduleKind === "maintenance") &&
    schedule.intervalSeconds
  ) {
    return computeNextRunAt(baseIso, schedule.intervalSeconds);
  }
  if (schedule.scheduleKind === "at") {
    return schedule.scheduleExpression ? new Date(schedule.scheduleExpression).toISOString() : null;
  }
  if (schedule.scheduleKind === "cron" && schedule.scheduleExpression) {
    return computeNextCronRunAt(schedule.scheduleExpression, baseIso, schedule.timezone ?? "UTC");
  }
  return null;
}

function computeNextRunAt(baseIso: string, intervalSeconds: number): string {
  const base = new Date(baseIso).getTime();
  return new Date(base + intervalSeconds * 1000).toISOString();
}

interface ParsedCronExpression {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly daysOfWeek: ReadonlySet<number>;
}

function computeNextCronRunAt(expression: string, baseIso: string, timezone: string): string {
  const parsed = parseCronExpression(expression);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid automation base time: ${baseIso}`);
  }
  let candidateMs = Math.floor(base.getTime() / 60_000) * 60_000 + 60_000;
  const limitMs = candidateMs + 366 * 24 * 60 * 60_000;
  while (candidateMs <= limitMs) {
    const candidate = new Date(candidateMs);
    if (cronMatchesDate(parsed, formatter, candidate)) {
      return candidate.toISOString();
    }
    candidateMs += 60_000;
  }
  throw new Error(`Cron expression did not produce a run time within one year: ${expression}`);
}

function cronMatchesDate(
  parsed: ParsedCronExpression,
  formatter: Intl.DateTimeFormat,
  candidate: Date,
): boolean {
  const parts = Object.fromEntries(
    formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const minute = Number(parts.minute);
  const hour = Number(parts.hour);
  const day = Number(parts.day);
  const month = Number(parts.month);
  const year = Number(parts.year);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return parsed.minutes.has(minute) &&
    parsed.hours.has(hour) &&
    parsed.daysOfMonth.has(day) &&
    parsed.months.has(month) &&
    parsed.daysOfWeek.has(dayOfWeek);
}

function parseCronExpression(expression: string): ParsedCronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have 5 fields: ${expression}`);
  }
  return {
    minutes: parseCronField(fields[0]!, 0, 59),
    hours: parseCronField(fields[1]!, 0, 23),
    daysOfMonth: parseCronField(fields[2]!, 1, 31),
    months: parseCronField(fields[3]!, 1, 12),
    daysOfWeek: parseCronField(fields[4]!, 0, 7, true),
  };
}

function parseCronField(field: string, min: number, max: number, normalizeSevenToZero = false): ReadonlySet<number> {
  const values = new Set<number>();
  for (const rawPart of field.split(",")) {
    const part = rawPart.trim();
    if (!part) {
      throw new Error(`Invalid empty cron field part in ${field}`);
    }
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid cron step in ${field}`);
    }
    const [start, end] = parseCronRange(rangePart ?? "*", min, max);
    for (let value = start; value <= end; value += step) {
      values.add(normalizeSevenToZero && value === 7 ? 0 : value);
    }
  }
  if (values.size === 0) {
    throw new Error(`Cron field produced no values: ${field}`);
  }
  return values;
}

function parseCronRange(value: string, min: number, max: number): [number, number] {
  if (value === "*") {
    return [min, max];
  }
  const range = value.split("-");
  const start = Number(range[0]);
  const end = range.length === 2 ? Number(range[1]) : start;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
    throw new Error(`Invalid cron range: ${value}`);
  }
  return [start, end];
}

function buildExcerpt(text: string, query: string, radius = 80): string {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return "";
  }

  const needle = query.trim().toLowerCase();
  const index = normalizedText.toLowerCase().indexOf(needle);
  if (index < 0) {
    const normalizedHaystack = normalizedText.toLowerCase();
    const token = extractSearchTerms(query).find((term) => normalizedHaystack.includes(term));
    if (token) {
      const tokenIndex = normalizedHaystack.indexOf(token);
      const start = Math.max(0, tokenIndex - radius);
      const end = Math.min(normalizedText.length, tokenIndex + token.length + radius);
      const excerpt = normalizedText.slice(start, end);
      return `${start > 0 ? "..." : ""}${excerpt}${end < normalizedText.length ? "..." : ""}`;
    }
    return normalizedText.length <= radius * 2
      ? normalizedText
      : `${normalizedText.slice(0, radius * 2)}...`;
  }

  const start = Math.max(0, index - radius);
  const end = Math.min(normalizedText.length, index + needle.length + radius);
  const excerpt = normalizedText.slice(start, end);
  return `${start > 0 ? "..." : ""}${excerpt}${end < normalizedText.length ? "..." : ""}`;
}

function scoreLearnedSkillMatch(skill: LearnedSkillRecord, query: string): number {
  const haystack = [
    skill.title,
    skill.problemPattern,
    skill.guidance,
    skill.exampleObjective ?? "",
    skill.changedFiles.join(" "),
    skill.tags.join(" "),
    skill.triggerSignals.join(" "),
    skill.procedureSteps.join(" "),
    skill.verificationSummary,
  ]
    .join(" ")
    .toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const terms = Array.from(
    new Set(
      normalizedQuery
        .split(/[^a-zA-Z0-9_.-]+/)
        .map((term) => term.trim())
        .filter((term) => term.length >= 3),
    ),
  );

  let score = 0;
  if (haystack.includes(normalizedQuery)) {
    score += 10;
  }
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 3;
    }
  }
  if (skill.problemPattern.toLowerCase().startsWith(normalizedQuery)) {
    score += 4;
  }
  if (skill.title.toLowerCase().startsWith(normalizedQuery)) {
    score += 4;
  }
  return score;
}

function normalizeAgentId(agentId?: string | null): string | null {
  if (typeof agentId !== "string") {
    return null;
  }
  const normalized = agentId.trim();
  return normalized.length > 0 ? normalized : null;
}
