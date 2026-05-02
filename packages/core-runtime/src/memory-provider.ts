import type { VerificationAssessment } from "@omni-agent/evals";
import type { ToolObservation } from "@omni-agent/model-client";
import type {
  LearnedSkillRecord,
  MemoryRecord,
  MessageRecord,
  ProfileFactRecord,
  RunStatus,
  SessionSearchResult,
  SqliteSessionStore,
  ThreadRecord,
  WorkspaceRecord,
} from "@omni-agent/session-store";
import type {
  LocalWorkspaceService,
  WorkspaceMemoryFile,
  WorkspaceSnapshot,
} from "@omni-agent/workspace";

const DEFAULT_MEMORY_RECALL_LIMIT = 4;

type RecallKind =
  | "sessionMemories"
  | "workspaceMemories"
  | "profileFacts"
  | "learnedSkills"
  | "workspaceMemoryFiles"
  | "relatedSessions";

type MaybePromise<T> = Promise<T> | T;

interface RankedRecallItem<T> {
  readonly item: T;
  readonly score: number;
  readonly sourceId: string;
}

interface RankedRecallBundle {
  readonly sessionMemories?: readonly RankedRecallItem<MemoryRecord>[];
  readonly workspaceMemories?: readonly RankedRecallItem<MemoryRecord>[];
  readonly profileFacts?: readonly RankedRecallItem<ProfileFactRecord>[];
  readonly learnedSkills?: readonly RankedRecallItem<LearnedSkillRecord>[];
  readonly workspaceMemoryFiles?: readonly RankedRecallItem<WorkspaceMemoryFile>[];
  readonly relatedSessions?: readonly RankedRecallItem<SessionSearchResult>[];
}

export type HybridRecallSourceChannel = "other" | "text" | "vector";

export interface HybridMemoryRankingOptions {
  readonly minScore?: number;
  readonly candidateMultiplier?: number;
  readonly vectorWeight?: number;
  readonly textWeight?: number;
  readonly sourceChannels?: Readonly<Record<string, HybridRecallSourceChannel>>;
  readonly mmr?: {
    readonly enabled?: boolean;
    readonly lambda?: number;
  };
  readonly temporalDecay?: {
    readonly enabled?: boolean;
    readonly halfLifeDays?: number;
  };
}

export interface MemoryProviderToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface MemoryProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly kind: "builtin" | "extension";
  readonly extensionId?: string;
}

export interface MemoryRecallProvider {
  readonly id: string;
  recall(context: MemoryProviderContext): MaybePromise<RankedRecallBundle | null | undefined>;
}

export interface BuiltinSqliteMemoryProviderOptions {
  readonly perKindLimit?: Partial<Record<RecallKind, number>>;
}

export interface HybridMemoryProviderOptions {
  readonly perKindLimit?: Partial<Record<RecallKind, number>>;
  readonly recallProviders?: readonly MemoryRecallProvider[];
  readonly fallbackProvider?: Pick<MemoryProvider, "onTurnStart" | "prefetch" | "queuePrefetch">;
  readonly ranking?: HybridMemoryRankingOptions;
}

interface NormalizedHybridMemoryRanking {
  readonly minScore: number;
  readonly candidateMultiplier: number;
  readonly vectorWeight: number;
  readonly textWeight: number;
  readonly sourceChannels: Readonly<Record<string, HybridRecallSourceChannel>>;
  readonly mmr: {
    readonly enabled: boolean;
    readonly lambda: number;
  };
  readonly temporalDecay: {
    readonly enabled: boolean;
    readonly halfLifeDays: number;
  };
}

interface RankedRecallCandidate<T> {
  readonly key: string;
  readonly item: T;
  readonly sourceId: string;
  readonly adjustedScore: number;
  readonly text: string;
}

export interface MemoryRecallBundle {
  readonly sessionMemories: MemoryRecord[];
  readonly workspaceMemories: MemoryRecord[];
  readonly profileFacts: ProfileFactRecord[];
  readonly learnedSkills: LearnedSkillRecord[];
  readonly workspaceMemoryFiles: WorkspaceMemoryFile[];
  readonly relatedSessions: SessionSearchResult[];
}

export type MemoryProviderLifecyclePhase =
  | "initialize"
  | "onDelegation"
  | "onMemoryWrite"
  | "onPreCompress"
  | "onSessionEnd"
  | "onTurnStart"
  | "prefetch"
  | "queuePrefetch"
  | "shutdown"
  | "syncTurn";

export type AccountableMemorySource =
  | "automatic"
  | "delegation"
  | "pre-compress"
  | "run-summary"
  | "verified-learning";
export type AccountableMemoryConfidence = "low" | "medium" | "high";
export type AccountableMemoryExpiry = "session" | "project" | "none";
export type AccountableMemoryReviewState = "unreviewed" | "verified" | "needs-reverify";

export interface AccountableMemoryMetadata {
  readonly source: AccountableMemorySource;
  readonly scope: "thread" | "workspace";
  readonly confidence: AccountableMemoryConfidence;
  readonly expiry: AccountableMemoryExpiry;
  readonly review: AccountableMemoryReviewState;
}

export interface MemoryProviderHealth {
  readonly providerId: string;
  readonly successCounts: Partial<Record<MemoryProviderLifecyclePhase, number>>;
  readonly failureCounts: Partial<Record<MemoryProviderLifecyclePhase, number>>;
  readonly lastSucceededAt: string | null;
  readonly lastError: string | null;
  readonly lastFailedAt: string | null;
}

interface MutableMemoryProviderHealth {
  readonly providerId: string;
  readonly successCounts: Partial<Record<MemoryProviderLifecyclePhase, number>>;
  readonly failureCounts: Partial<Record<MemoryProviderLifecyclePhase, number>>;
  lastSucceededAt: string | null;
  lastError: string | null;
  lastFailedAt: string | null;
}

type MemoryProviderAuditContext =
  | MemoryProviderSessionContext
  | MemoryProviderContext
  | MemoryTurnSyncContext
  | MemorySessionEndContext
  | MemoryDelegationContext
  | MemoryWriteContext;

export interface AutomaticMemoryEntry {
  readonly scope: "thread" | "workspace";
  readonly content: string;
  readonly tags: readonly string[];
  readonly accountability?: Partial<Omit<AccountableMemoryMetadata, "scope">>;
}

export interface MemoryProviderSessionContext {
  readonly sessionStore: SqliteSessionStore;
  readonly workspace: LocalWorkspaceService;
  readonly workspaceRecord: WorkspaceRecord;
  readonly threadRecord: ThreadRecord;
  readonly runId: string;
  readonly agentId?: string | null;
  readonly objective: string;
  readonly verificationMode?: string;
  readonly agentRole?: string;
}

export interface MemoryProviderContext extends MemoryProviderSessionContext {
  readonly query: string;
  readonly assistantText: string;
  readonly toolObservations: readonly ToolObservation[];
  readonly workspaceSnapshot: WorkspaceSnapshot;
  readonly loadedWorkspaceMemoryFiles: readonly WorkspaceMemoryFile[];
}

export interface MemoryTurnSyncContext extends MemoryProviderContext {
  readonly turnNumber: number;
  readonly automaticMemories: readonly AutomaticMemoryEntry[];
}

export interface MemorySessionEndContext extends MemoryProviderSessionContext {
  readonly status: RunStatus;
  readonly verification: VerificationAssessment;
  readonly changedFiles: readonly string[];
  readonly blockedApprovals: readonly string[];
  readonly assistantText: string;
  readonly finalResponse: string;
  readonly errorMessage?: string;
  readonly messages: readonly MessageRecord[];
  readonly workspaceSnapshot: WorkspaceSnapshot;
  readonly loadedWorkspaceMemoryFiles: readonly WorkspaceMemoryFile[];
}

export interface MemoryDelegationContext {
  readonly sessionStore: SqliteSessionStore;
  readonly workspace: LocalWorkspaceService;
  readonly workspaceRecord: WorkspaceRecord;
  readonly parentThreadId: string;
  readonly agentId?: string | null;
  readonly jobId: string;
  readonly objective: string;
  readonly status: string;
  readonly verification: VerificationAssessment;
  readonly changedFiles: readonly string[];
  readonly finalResponse: string;
  readonly errorMessage?: string;
}

export interface MemoryWriteContext extends MemoryProviderSessionContext {
  readonly kind: "memory" | "profile_fact";
  readonly toolName: "save_memory" | "save_profile_fact";
  readonly content: string;
  readonly tags: readonly string[];
  readonly scope?: "thread" | "workspace";
  readonly backend?: "both" | "file" | "store";
  readonly targetIds: readonly string[];
  readonly data?: unknown;
}

export interface MemoryProvider {
  readonly id: string;
  getToolDefinitions?(): readonly MemoryProviderToolDefinition[];
  initialize?(context: MemoryProviderSessionContext): MaybePromise<void>;
  shutdown?(): MaybePromise<void>;
  queuePrefetch?(context: MemoryProviderContext): MaybePromise<void>;
  prefetch?(context: MemoryProviderContext): MaybePromise<MemoryRecallBundle | null | undefined>;
  onTurnStart?(context: MemoryProviderContext): MaybePromise<MemoryRecallBundle | null | undefined>;
  syncTurn?(context: MemoryTurnSyncContext): MaybePromise<void>;
  onPreCompress?(context: MemoryProviderContext): MaybePromise<MemoryRecallBundle | null | undefined>;
  onSessionEnd?(context: MemorySessionEndContext): MaybePromise<void>;
  onDelegation?(context: MemoryDelegationContext): MaybePromise<void>;
  onMemoryWrite?(context: MemoryWriteContext): MaybePromise<void>;
}

const BUILTIN_MEMORY_PROVIDER_DESCRIPTORS = {
  "builtin-sqlite-memory-provider": {
    id: "builtin-sqlite-memory-provider",
    label: "Builtin SQLite Memory",
    description: "Persists session, workspace, profile, and learned-skill recall in the local SQLite session store.",
    kind: "builtin",
  },
  "hybrid-memory-provider": {
    id: "hybrid-memory-provider",
    label: "Hybrid Memory",
    description: "Fuses scored recall providers with the builtin SQLite memory provider for richer retrieval.",
    kind: "builtin",
  },
} satisfies Record<string, MemoryProviderDescriptor>;

export function listBuiltinMemoryProviders(): MemoryProviderDescriptor[] {
  return Object.values(BUILTIN_MEMORY_PROVIDER_DESCRIPTORS).map((entry) => ({ ...entry }));
}

export function createBuiltinMemoryProvider(memoryProviderId: string): MemoryProvider | null {
  switch (memoryProviderId.trim()) {
    case "builtin-sqlite-memory-provider":
      return new BuiltinSqliteMemoryProvider();
    case "hybrid-memory-provider":
      return new HybridMemoryProvider();
    default:
      return null;
  }
}

export class MemoryProviderCoordinator {
  private readonly health = new Map<string, MutableMemoryProviderHealth>();

  public constructor(private readonly providers: readonly MemoryProvider[]) {
    for (const provider of providers) {
      this.health.set(provider.id, {
        providerId: provider.id,
        successCounts: {},
        failureCounts: {},
        lastSucceededAt: null,
        lastError: null,
        lastFailedAt: null,
      });
    }
  }

  public getHealth(): MemoryProviderHealth[] {
    return Array.from(this.health.values()).map((entry) => ({
      providerId: entry.providerId,
      successCounts: { ...entry.successCounts },
      failureCounts: { ...entry.failureCounts },
      lastSucceededAt: entry.lastSucceededAt,
      lastError: entry.lastError,
      lastFailedAt: entry.lastFailedAt,
    }));
  }

  public getToolDefinitions(): MemoryProviderToolDefinition[] {
    const merged: MemoryProviderToolDefinition[] = [];
    const seenNames = new Set<string>();
    for (const provider of this.providers) {
      for (const definition of provider.getToolDefinitions?.() ?? []) {
        if (seenNames.has(definition.name)) {
          continue;
        }
        seenNames.add(definition.name);
        merged.push(definition);
      }
    }
    return merged;
  }

  public async initialize(context: MemoryProviderSessionContext): Promise<void> {
    for (const provider of this.providers) {
      if (!provider.initialize) {
        continue;
      }
      try {
        await provider.initialize(context);
        this.recordSuccess(provider.id, "initialize", context);
      } catch (error) {
        this.recordFailure(provider.id, "initialize", error, context);
        // Provider initialization is best-effort.
      }
    }
  }

  public async shutdown(): Promise<void> {
    for (const provider of this.providers) {
      if (!provider.shutdown) {
        continue;
      }
      try {
        await provider.shutdown();
        this.recordSuccess(provider.id, "shutdown");
      } catch (error) {
        this.recordFailure(provider.id, "shutdown", error);
        // Provider shutdown is best-effort.
      }
    }
  }

  public async prefetch(context: MemoryProviderContext): Promise<MemoryRecallBundle> {
    return this.collect(context, "prefetch");
  }

  public async onTurnStart(context: MemoryProviderContext): Promise<MemoryRecallBundle> {
    return this.collect(context, "onTurnStart");
  }

  public async syncTurn(context: MemoryTurnSyncContext): Promise<void> {
    for (const provider of this.providers) {
      if (!provider.syncTurn) {
        continue;
      }
      try {
        await provider.syncTurn(context);
        this.recordSuccess(provider.id, "syncTurn", context);
      } catch (error) {
        this.recordFailure(provider.id, "syncTurn", error, context);
        // Turn sync is best-effort.
      }
    }
  }

  public async onPreCompress(context: MemoryProviderContext): Promise<MemoryRecallBundle> {
    return this.collect(context, "onPreCompress");
  }

  public async onSessionEnd(context: MemorySessionEndContext): Promise<void> {
    for (const provider of this.providers) {
      if (!provider.onSessionEnd) {
        continue;
      }
      try {
        await provider.onSessionEnd(context);
        this.recordSuccess(provider.id, "onSessionEnd", context);
      } catch (error) {
        this.recordFailure(provider.id, "onSessionEnd", error, context);
        // End-of-session memory extraction is best-effort.
      }
    }
  }

  public queuePrefetch(context: MemoryProviderContext): void {
    for (const provider of this.providers) {
      if (!provider.queuePrefetch) {
        continue;
      }
      void Promise.resolve(provider.queuePrefetch(context)).then(() => {
        this.recordSuccess(provider.id, "queuePrefetch", context);
      }).catch((error) => {
        this.recordFailure(provider.id, "queuePrefetch", error, context);
      });
    }
  }

  public async onDelegation(context: MemoryDelegationContext): Promise<void> {
    for (const provider of this.providers) {
      if (!provider.onDelegation) {
        continue;
      }
      try {
        await provider.onDelegation(context);
        this.recordSuccess(provider.id, "onDelegation", context);
      } catch (error) {
        this.recordFailure(provider.id, "onDelegation", error, context);
        // Memory providers must not break delegation completion.
      }
    }
  }

  public async onMemoryWrite(context: MemoryWriteContext): Promise<void> {
    for (const provider of this.providers) {
      if (!provider.onMemoryWrite) {
        continue;
      }
      try {
        await provider.onMemoryWrite(context);
        this.recordSuccess(provider.id, "onMemoryWrite", context);
      } catch (error) {
        this.recordFailure(provider.id, "onMemoryWrite", error, context);
        // Explicit memory writes are already persisted; provider hooks are best-effort.
      }
    }
  }

  private async collect(
    context: MemoryProviderContext,
    phase: "onPreCompress" | "onTurnStart" | "prefetch",
  ): Promise<MemoryRecallBundle> {
    const bundles: MemoryRecallBundle[] = [];
    for (const provider of this.providers) {
      const bundle = await this.invokeProvider(provider, phase, context);
      if (bundle) {
        bundles.push(fenceMemoryRecallBundle(bundle));
      }
    }
    return mergeRecallBundles(bundles);
  }

  private async invokeProvider(
    provider: MemoryProvider,
    phase: "onPreCompress" | "onTurnStart" | "prefetch",
    context: MemoryProviderContext,
  ): Promise<MemoryRecallBundle | null> {
    try {
      if (phase === "onTurnStart" && provider.onTurnStart) {
        const bundle = (await provider.onTurnStart(context)) ?? null;
        this.recordSuccess(provider.id, phase, context);
        return bundle;
      }
      if (phase === "onPreCompress" && provider.onPreCompress) {
        const bundle = (await provider.onPreCompress(context)) ?? null;
        this.recordSuccess(provider.id, phase, context);
        return bundle;
      }
      if (phase === "prefetch" && provider.prefetch) {
        const bundle = (await provider.prefetch(context)) ?? null;
        this.recordSuccess(provider.id, phase, context);
        return bundle;
      }
      if ((phase === "onTurnStart" || phase === "onPreCompress") && provider.prefetch) {
        const bundle = (await provider.prefetch(context)) ?? null;
        this.recordSuccess(provider.id, phase, context);
        return bundle;
      }
    } catch (error) {
      this.recordFailure(provider.id, phase, error, context);
      return null;
    }
    return null;
  }

  private recordFailure(
    providerId: string,
    phase: MemoryProviderLifecyclePhase,
    error: unknown,
    context?: MemoryProviderAuditContext,
  ): void {
    const current = this.health.get(providerId) ?? {
      providerId,
      successCounts: {},
      failureCounts: {},
      lastSucceededAt: null,
      lastError: null,
      lastFailedAt: null,
    };
    current.failureCounts[phase] = (current.failureCounts[phase] ?? 0) + 1;
    current.lastError = error instanceof Error ? error.message : String(error);
    current.lastFailedAt = new Date().toISOString();
    this.health.set(providerId, current);
    this.persistLifecycleAudit(context, current, phase, "failure");
  }

  private recordSuccess(
    providerId: string,
    phase: MemoryProviderLifecyclePhase,
    context?: MemoryProviderAuditContext,
  ): void {
    const current = this.health.get(providerId) ?? {
      providerId,
      successCounts: {},
      failureCounts: {},
      lastSucceededAt: null,
      lastError: null,
      lastFailedAt: null,
    };
    current.successCounts[phase] = (current.successCounts[phase] ?? 0) + 1;
    current.lastSucceededAt = new Date().toISOString();
    this.health.set(providerId, current);
    this.persistLifecycleAudit(context, current, phase, "success");
  }

  private persistLifecycleAudit(
    context: MemoryProviderAuditContext | undefined,
    health: MutableMemoryProviderHealth,
    phase: MemoryProviderLifecyclePhase,
    status: "success" | "failure",
  ): void {
    if (!context) {
      return;
    }
    const threadId = "threadRecord" in context ? context.threadRecord.id : "parentThreadId" in context ? context.parentThreadId : null;
    const runId = "runId" in context ? context.runId : null;
    try {
      context.sessionStore.addAuditLog({
        workspaceId: context.workspaceRecord.id,
        agentId: context.agentId ?? null,
        actorType: "system",
        action: status === "success" ? "memory_provider.lifecycle.success" : "memory_provider.lifecycle.failure",
        targetType: "memory_provider",
        targetId: health.providerId,
        riskLevel: status === "failure" ? "medium" : "low",
        summary:
          status === "success"
            ? `Memory provider ${health.providerId} completed ${phase}.`
            : `Memory provider ${health.providerId} failed ${phase}: ${health.lastError ?? "unknown error"}.`,
        metadata: {
          providerId: health.providerId,
          phase,
          status,
          threadId,
          runId,
          successCounts: { ...health.successCounts },
          failureCounts: { ...health.failureCounts },
          lastSucceededAt: health.lastSucceededAt,
          lastFailedAt: health.lastFailedAt,
          lastError: health.lastError,
        },
      });
    } catch {
      // Provider health persistence is diagnostic only and must not affect runtime execution.
    }
  }
}

export class BuiltinSqliteMemoryProvider implements MemoryProvider {
  public readonly id = "builtin-sqlite-memory-provider";

  private readonly queuedPrefetches = new Map<string, Promise<MemoryRecallBundle>>();
  private readonly persistedAutomaticMemoryKeys = new Set<string>();
  private readonly perKindLimit: Partial<Record<RecallKind, number>>;

  public constructor(options: BuiltinSqliteMemoryProviderOptions = {}) {
    this.perKindLimit = options.perKindLimit ?? {};
  }

  public getToolDefinitions(): readonly MemoryProviderToolDefinition[] {
    return [];
  }

  public initialize(): void {
    this.persistedAutomaticMemoryKeys.clear();
  }

  public queuePrefetch(context: MemoryProviderContext): void {
    const cacheKey = this.buildCacheKey(context);
    if (this.queuedPrefetches.has(cacheKey)) {
      return;
    }
    this.queuedPrefetches.set(cacheKey, this.buildRecallBundle(context));
  }

  public async prefetch(context: MemoryProviderContext): Promise<MemoryRecallBundle> {
    return this.getQueuedOrBuild(context);
  }

  public async onTurnStart(context: MemoryProviderContext): Promise<MemoryRecallBundle> {
    return this.getQueuedOrBuild(context, true);
  }

  public syncTurn(context: MemoryTurnSyncContext): void {
    for (const entry of context.automaticMemories) {
      const normalizedContent = compactModelText(entry.content, 600);
      if (normalizedContent.length < 24) {
        continue;
      }
      const normalizedTags = buildAccountableMemoryTags({
        tags: entry.tags,
        source: entry.accountability?.source ?? "automatic",
        scope: entry.scope,
        confidence: entry.accountability?.confidence ?? "medium",
        expiry: entry.accountability?.expiry ?? "session",
        review: entry.accountability?.review ?? "unreviewed",
      });
      const dedupeKey = `${context.runId}:${entry.scope}:${normalizedTags.join(",")}:${normalizedContent}`;
      if (this.persistedAutomaticMemoryKeys.has(dedupeKey)) {
        continue;
      }
      this.persistedAutomaticMemoryKeys.add(dedupeKey);
      context.sessionStore.addMemory({
        workspaceId: context.workspaceRecord.id,
        agentId: context.agentId ?? null,
        threadId: entry.scope === "thread" ? context.threadRecord.id : null,
        scope: entry.scope,
        content: normalizedContent,
        tags: normalizedTags,
      });
    }
  }

  public async onPreCompress(context: MemoryProviderContext): Promise<MemoryRecallBundle> {
    const summary = normalizeCompactText(context.assistantText, 420);
    if (summary.length >= 24) {
      context.sessionStore.addMemory({
        workspaceId: context.workspaceRecord.id,
        agentId: context.agentId ?? null,
        threadId: context.threadRecord.id,
        scope: "thread",
        content: `Pre-compress handoff: ${summary}`,
        tags: buildAccountableMemoryTags({
          tags: ["pre-compress", "session", "summary"],
          source: "pre-compress",
          scope: "thread",
          confidence: "medium",
          expiry: "session",
          review: "unreviewed",
        }),
      });
    }
    return this.getQueuedOrBuild(context);
  }

  public async onSessionEnd(context: MemorySessionEndContext): Promise<void> {
    const summary = compactModelText(context.assistantText || context.finalResponse, 600);
    const runSummary = [
      `Run ${context.runId} finished with status ${context.status}.`,
      `Objective: ${compactModelText(context.objective, 180)}.`,
      `Verification: ${context.verification.status}.`,
      context.changedFiles.length > 0 ? `Changed files: ${context.changedFiles.join(", ")}.` : "No files changed.",
      context.blockedApprovals.length > 0
        ? `Blocked approvals: ${context.blockedApprovals.join(" | ")}.`
        : null,
      summary ? `Outcome: ${summary}` : null,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join(" ");

    context.sessionStore.addMemory({
      workspaceId: context.workspaceRecord.id,
      agentId: context.agentId ?? null,
      threadId: context.threadRecord.id,
      scope: "thread",
      content: runSummary,
      tags: buildAccountableMemoryTags({
        tags: [
          "session",
          "run-summary",
          context.status,
          context.verification.status,
          context.changedFiles.length > 0 ? "changed-files" : "no-file-change",
        ],
        source: "run-summary",
        scope: "thread",
        confidence: context.verification.status === "passed" ? "high" : "medium",
        expiry: "session",
        review: context.verification.status === "passed" ? "verified" : "needs-reverify",
      }),
    });

    if (context.changedFiles.length === 0) {
      return;
    }

    const problemPattern = compactModelText(context.objective, 240);
    const procedureSteps = buildLearnedProcedureSteps({
      changedFiles: context.changedFiles,
      verificationSummary: context.verification.summary,
      outcomeSummary: summary,
    });
    const taskMode = inferLearnedSkillTaskMode(context.objective, context.agentRole);
    const triggerSignals = buildLearnedSkillTriggerSignals({
      objective: context.objective,
      changedFiles: context.changedFiles,
      verificationMode: context.verificationMode,
      verificationSummary: context.verification.summary,
      verificationStatus: context.verification.status,
      taskMode,
    });
    const guidance = compactModelText(
      [
        `When a task matches "${problemPattern}", start with the files ${context.changedFiles.join(", ")}.`,
        triggerSignals.length > 0 ? `Trigger signals: ${triggerSignals.join(", ")}.` : null,
        procedureSteps.length > 0 ? `Procedure: ${procedureSteps.join(" -> ")}.` : null,
        summary ? `Working pattern: ${summary}` : null,
        `Verification evidence: ${context.verification.summary}.`,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" "),
      900,
    );
    if (context.verification.status !== "passed") {
      const candidate = context.sessionStore.addLearnedSkill({
        workspaceId: context.workspaceRecord.id,
        agentId: context.agentId ?? null,
        sourceRunId: context.runId,
        kind: "procedure",
        dedupeKey: buildLearnedSkillDedupeKey({
          objective: context.objective,
          changedFiles: context.changedFiles,
          taskMode,
        }),
        lifecycleState: "needs_reverify",
        lifecycleReason: "Captured as a self-learning candidate after non-passing verification.",
        title: buildLearnedSkillCandidateTitle(problemPattern, context.changedFiles),
        problemPattern,
        guidance,
        exampleObjective: context.objective,
        changedFiles: [...context.changedFiles],
        tags: [
          ...buildLearnedSkillTags(context.changedFiles).filter((tag) => tag !== "verified"),
          "candidate",
          "needs-reverify",
        ],
        triggerSignals,
        procedureSteps,
        verificationStatus: context.verification.status,
        verificationSummary: context.verification.summary,
      });
      const updatedCandidate = context.sessionStore.recordLearnedSkillOutcome({
        skillId: candidate.id,
        succeeded: false,
      });
      context.sessionStore.addProfileFact({
        workspaceId: context.workspaceRecord.id,
        agentId: context.agentId ?? null,
        sourceRunId: context.runId,
        content: compactModelText(
          `Self-learning candidate: ${updatedCandidate.title} needs re-verification before reuse. Evidence: changedFiles=${updatedCandidate.changedFiles.join(", ")}, verification=${updatedCandidate.verificationStatus}, quality=${updatedCandidate.qualityScore}.`,
          700,
        ),
        tags: ["self-learning", "skill-candidate", "needs-reverify", `mode:${taskMode}`],
      });
      return;
    }

    const learnedMemory = [
      `Verified change from run ${context.runId}.`,
      `Status: ${context.status}.`,
      `Changed files: ${context.changedFiles.join(", ")}.`,
      summary ? `Outcome: ${summary}` : null,
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join(" ");

    context.sessionStore.addMemory({
      workspaceId: context.workspaceRecord.id,
      agentId: context.agentId ?? null,
      threadId: context.threadRecord.id,
      scope: "workspace",
      content: learnedMemory,
      tags: buildAccountableMemoryTags({
        tags: ["learned", "verified", "code-change"],
        source: "verified-learning",
        scope: "workspace",
        confidence: "high",
        expiry: "project",
        review: "verified",
      }),
    });

    const learnedSkill = context.sessionStore.addLearnedSkill({
      workspaceId: context.workspaceRecord.id,
      agentId: context.agentId ?? null,
      sourceRunId: context.runId,
      kind: "procedure",
      dedupeKey: buildLearnedSkillDedupeKey({
        objective: context.objective,
        changedFiles: context.changedFiles,
        taskMode,
      }),
      title: buildLearnedSkillTitle(problemPattern, context.changedFiles),
      problemPattern,
      guidance,
      exampleObjective: context.objective,
      changedFiles: [...context.changedFiles],
      tags: buildLearnedSkillTags(context.changedFiles),
      triggerSignals,
      procedureSteps,
      verificationStatus: context.verification.status,
      verificationSummary: context.verification.summary,
    });
    const learningAssessment = buildSelfLearningAssessment({
      skill: learnedSkill,
      taskMode,
      changedFiles: context.changedFiles,
      verificationSummary: context.verification.summary,
      outcomeSummary: summary,
    });
    context.sessionStore.addProfileFact({
      workspaceId: context.workspaceRecord.id,
      agentId: context.agentId ?? null,
      sourceRunId: context.runId,
      content: learningAssessment.content,
      tags: learningAssessment.tags,
    });
    if (shouldMaterializeLearnedSkill(learnedSkill)) {
      const materialized = await context.workspace.materializeLearnedSkill({
        title: learnedSkill.title,
        problemPattern: learnedSkill.problemPattern,
        guidance: learnedSkill.guidance,
        triggerSignals: learnedSkill.triggerSignals,
        procedureSteps: learnedSkill.procedureSteps,
        verificationSummary: learnedSkill.verificationSummary,
        tags: learnedSkill.tags,
        changedFiles: learnedSkill.changedFiles,
        revisionCount: learnedSkill.revisionCount,
      });
      const promoted =
        learnedSkill.sourceType === "learned" && shouldAutoPromoteLearnedSkill(learnedSkill)
          ? context.sessionStore.promoteLearnedSkill({
              skillId: learnedSkill.id,
              target: "workspace",
              reason: "Auto-promoted after repeated verified self-learning evidence.",
              materializedSkillPath: materialized.path,
            })
          : context.sessionStore.updateLearnedSkillLifecycle({
              skillId: learnedSkill.id,
              lifecycleState: "active",
              lifecycleReason: null,
              materializedSkillPath: materialized.path,
            });
      context.sessionStore.addProfileFact({
        workspaceId: context.workspaceRecord.id,
        agentId: context.agentId ?? null,
        sourceRunId: context.runId,
        content: compactModelText(
          `Self-learning promotion: ${promoted.title} is now ${promoted.sourceType} with skill file ${promoted.materializedSkillPath ?? materialized.path}. Evidence: revisions=${promoted.revisionCount}, uses=${promoted.useCount}, quality=${promoted.qualityScore}, verification=${promoted.verificationStatus}.`,
          700,
        ),
        tags: ["self-learning", "skill-promotion", promoted.sourceType, `mode:${taskMode}`],
      });
    }
  }

  public async onDelegation(context: MemoryDelegationContext): Promise<void> {
    const content = normalizeCompactText(
      [
        `Subagent ${context.jobId} finished with status ${context.status}.`,
        `Objective: ${context.objective}.`,
        `Verification: ${context.verification.status}.`,
        context.changedFiles.length > 0 ? `Changed files: ${context.changedFiles.join(", ")}.` : "No files changed.",
        context.errorMessage ? `Error: ${context.errorMessage}.` : null,
        context.finalResponse ? `Outcome: ${context.finalResponse}` : null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" "),
      700,
    );
    if (content.length < 24) {
      return;
    }
    context.sessionStore.addMemory({
      workspaceId: context.workspaceRecord.id,
      agentId: context.agentId ?? null,
      threadId: context.parentThreadId,
      scope: "thread",
      content,
      tags: buildAccountableMemoryTags({
        tags: ["session", "subagent", context.status, context.verification.status],
        source: "delegation",
        scope: "thread",
        confidence: context.verification.status === "passed" ? "high" : "medium",
        expiry: "session",
        review: context.verification.status === "passed" ? "verified" : "needs-reverify",
      }),
    });
  }

  private async getQueuedOrBuild(
    context: MemoryProviderContext,
    consume = false,
  ): Promise<MemoryRecallBundle> {
    const cacheKey = this.buildCacheKey(context);
    const queued = this.queuedPrefetches.get(cacheKey);
    if (queued) {
      if (consume) {
        this.queuedPrefetches.delete(cacheKey);
      }
      return await queued;
    }
    return this.buildRecallBundle(context);
  }

  private buildCacheKey(context: MemoryProviderContext): string {
    return [
      context.workspaceRecord.id,
      context.threadRecord.id,
      context.runId,
      context.query.trim().toLowerCase(),
    ].join(":");
  }

  private resolveKindLimit(kind: RecallKind): number {
    const configured = this.perKindLimit[kind];
    if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
      return Math.trunc(configured);
    }
    return DEFAULT_MEMORY_RECALL_LIMIT;
  }

  private async buildRecallBundle(context: MemoryProviderContext): Promise<MemoryRecallBundle> {
    const recallQuery = context.query.trim() || context.objective;
    const localSessionMemories = mergeDistinctById(
      context.sessionStore.listMemories({
        workspaceId: context.workspaceRecord.id,
        threadId: context.threadRecord.id,
        scope: "thread",
        limit: DEFAULT_MEMORY_RECALL_LIMIT,
      }),
      context.sessionStore.searchMemories({
        workspaceId: context.workspaceRecord.id,
        threadId: context.threadRecord.id,
        scope: "thread",
        query: recallQuery,
        limit: DEFAULT_MEMORY_RECALL_LIMIT,
      }),
      DEFAULT_MEMORY_RECALL_LIMIT,
    );
    const localWorkspaceMemories = mergeDistinctById(
      context.sessionStore.searchMemories({
        workspaceId: context.workspaceRecord.id,
        scope: "workspace",
        query: recallQuery,
        limit: DEFAULT_MEMORY_RECALL_LIMIT,
      }),
      context.sessionStore.listMemories({
        workspaceId: context.workspaceRecord.id,
        scope: "workspace",
        limit: DEFAULT_MEMORY_RECALL_LIMIT,
      }),
      DEFAULT_MEMORY_RECALL_LIMIT,
    );
    const localProfileFacts = mergeDistinctById(
      context.sessionStore.searchProfileFacts({
        workspaceId: context.workspaceRecord.id,
        query: recallQuery,
        limit: DEFAULT_MEMORY_RECALL_LIMIT,
      }),
      context.sessionStore.listProfileFacts({
        workspaceId: context.workspaceRecord.id,
        limit: DEFAULT_MEMORY_RECALL_LIMIT,
      }),
      DEFAULT_MEMORY_RECALL_LIMIT,
    );
    const localLearnedSkills = mergeDistinctById(
      context.sessionStore.searchLearnedSkills({
        workspaceId: context.workspaceRecord.id,
        query: recallQuery,
        limit: DEFAULT_MEMORY_RECALL_LIMIT,
      }),
      context.sessionStore.listLearnedSkills({
        workspaceId: context.workspaceRecord.id,
        limit: DEFAULT_MEMORY_RECALL_LIMIT,
      }),
      DEFAULT_MEMORY_RECALL_LIMIT,
    );
    const localRelatedSessions = context.sessionStore
      .searchSessions({
        workspaceId: context.workspaceRecord.id,
        query: recallQuery,
        limit: DEFAULT_MEMORY_RECALL_LIMIT,
      })
      .filter((entry) => entry.threadId !== context.threadRecord.id);
    const searchedMemoryFiles = await context.workspace.searchMemoryFiles({
      query: recallQuery,
      limit: DEFAULT_MEMORY_RECALL_LIMIT,
      includeDailyNotes: true,
    });
    const localWorkspaceMemoryFiles = mergeWorkspaceMemoryFiles(
      searchedMemoryFiles.map(convertSearchResultToMemoryFile),
      context.loadedWorkspaceMemoryFiles,
      DEFAULT_MEMORY_RECALL_LIMIT,
    );

    return {
      sessionMemories: mergeDistinctById(
        localSessionMemories,
        this.resolveKindLimit("sessionMemories"),
      ),
      workspaceMemories: mergeDistinctById(
        localWorkspaceMemories,
        this.resolveKindLimit("workspaceMemories"),
      ),
      profileFacts: mergeDistinctById(
        localProfileFacts,
        this.resolveKindLimit("profileFacts"),
      ),
      learnedSkills: mergeDistinctById(
        localLearnedSkills,
        this.resolveKindLimit("learnedSkills"),
      ),
      workspaceMemoryFiles: mergeWorkspaceMemoryFiles(
        localWorkspaceMemoryFiles,
        this.resolveKindLimit("workspaceMemoryFiles"),
      ),
      relatedSessions: mergeDistinctByMessageKey(
        localRelatedSessions,
      ).slice(0, this.resolveKindLimit("relatedSessions")),
    };
  }
}

export class HybridMemoryProvider implements MemoryProvider {
  public readonly id = "hybrid-memory-provider";

  private readonly queuedPrefetches = new Map<string, Promise<MemoryRecallBundle>>();
  private readonly perKindLimit: Partial<Record<RecallKind, number>>;
  private readonly recallProviders: readonly MemoryRecallProvider[];
  private readonly fallbackProvider?: Pick<MemoryProvider, "onTurnStart" | "prefetch" | "queuePrefetch">;
  private readonly ranking: NormalizedHybridMemoryRanking;

  public constructor(options: HybridMemoryProviderOptions = {}) {
    this.perKindLimit = options.perKindLimit ?? {};
    this.recallProviders = options.recallProviders ?? [];
    this.fallbackProvider = options.fallbackProvider;
    this.ranking = normalizeHybridMemoryRanking(options.ranking);
  }

  public getToolDefinitions(): readonly MemoryProviderToolDefinition[] {
    return [];
  }

  public queuePrefetch(context: MemoryProviderContext): void {
    this.fallbackProvider?.queuePrefetch?.(context);
    const cacheKey = this.buildCacheKey(context);
    if (this.queuedPrefetches.has(cacheKey)) {
      return;
    }
    this.queuedPrefetches.set(cacheKey, this.buildRecallBundle(context, "prefetch"));
  }

  public async prefetch(context: MemoryProviderContext): Promise<MemoryRecallBundle> {
    return this.getQueuedOrBuild(context, "prefetch");
  }

  public async onTurnStart(context: MemoryProviderContext): Promise<MemoryRecallBundle> {
    return this.getQueuedOrBuild(context, "onTurnStart", true);
  }

  private async getQueuedOrBuild(
    context: MemoryProviderContext,
    phase: "onTurnStart" | "prefetch",
    consume = false,
  ): Promise<MemoryRecallBundle> {
    const cacheKey = this.buildCacheKey(context);
    const queued = this.queuedPrefetches.get(cacheKey);
    if (queued) {
      if (consume) {
        this.queuedPrefetches.delete(cacheKey);
      }
      return await queued;
    }
    return this.buildRecallBundle(context, phase);
  }

  private buildCacheKey(context: MemoryProviderContext): string {
    return [
      context.workspaceRecord.id,
      context.threadRecord.id,
      context.runId,
      context.query.trim().toLowerCase(),
    ].join(":");
  }

  private resolveKindLimit(kind: RecallKind): number {
    const configured = this.perKindLimit[kind];
    if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
      return Math.trunc(configured);
    }
    return DEFAULT_MEMORY_RECALL_LIMIT;
  }

  private async buildRecallBundle(
    context: MemoryProviderContext,
    phase: "onTurnStart" | "prefetch",
  ): Promise<MemoryRecallBundle> {
    const rankedRecall = await this.collectRankedRecall(context);
    const fallbackBundle = await this.collectFallbackRecall(context, phase);
    return {
      sessionMemories: mergeDistinctById(
        rankAndFuseRankedById(rankedRecall.sessionMemories, this.resolveKindLimit("sessionMemories"), this.ranking),
        fallbackBundle.sessionMemories,
        this.resolveKindLimit("sessionMemories"),
      ),
      workspaceMemories: mergeDistinctById(
        rankAndFuseRankedById(
          rankedRecall.workspaceMemories,
          this.resolveKindLimit("workspaceMemories"),
          this.ranking,
        ),
        fallbackBundle.workspaceMemories,
        this.resolveKindLimit("workspaceMemories"),
      ),
      profileFacts: mergeDistinctById(
        rankAndFuseRankedById(rankedRecall.profileFacts, this.resolveKindLimit("profileFacts"), this.ranking),
        fallbackBundle.profileFacts,
        this.resolveKindLimit("profileFacts"),
      ),
      learnedSkills: mergeDistinctById(
        rankAndFuseRankedById(rankedRecall.learnedSkills, this.resolveKindLimit("learnedSkills"), this.ranking),
        fallbackBundle.learnedSkills,
        this.resolveKindLimit("learnedSkills"),
      ),
      workspaceMemoryFiles: mergeWorkspaceMemoryFiles(
        rankAndFuseRankedWorkspaceFiles(
          rankedRecall.workspaceMemoryFiles,
          this.resolveKindLimit("workspaceMemoryFiles"),
          this.ranking,
        ),
        fallbackBundle.workspaceMemoryFiles,
        this.resolveKindLimit("workspaceMemoryFiles"),
      ),
      relatedSessions: mergeDistinctByMessageKey(
        rankAndFuseRankedSessions(rankedRecall.relatedSessions, this.resolveKindLimit("relatedSessions"), this.ranking),
        fallbackBundle.relatedSessions,
      ).slice(0, this.resolveKindLimit("relatedSessions")),
    };
  }

  private async collectRankedRecall(context: MemoryProviderContext): Promise<RankedRecallBundle> {
    const bundles: RankedRecallBundle[] = [];
    for (const provider of this.recallProviders) {
      try {
        const bundle = await provider.recall(context);
        if (bundle) {
          bundles.push(bundle);
        }
      } catch {
        // External recall providers are best-effort.
      }
    }
    return {
      sessionMemories: bundles.flatMap((bundle) => bundle.sessionMemories ?? []),
      workspaceMemories: bundles.flatMap((bundle) => bundle.workspaceMemories ?? []),
      profileFacts: bundles.flatMap((bundle) => bundle.profileFacts ?? []),
      learnedSkills: bundles.flatMap((bundle) => bundle.learnedSkills ?? []),
      workspaceMemoryFiles: bundles.flatMap((bundle) => bundle.workspaceMemoryFiles ?? []),
      relatedSessions: bundles.flatMap((bundle) => bundle.relatedSessions ?? []),
    };
  }

  private async collectFallbackRecall(
    context: MemoryProviderContext,
    phase: "onTurnStart" | "prefetch",
  ): Promise<MemoryRecallBundle> {
    if (!this.fallbackProvider) {
      return createEmptyRecallBundle();
    }
    if (phase === "onTurnStart" && this.fallbackProvider.onTurnStart) {
      return (await this.fallbackProvider.onTurnStart(context)) ?? createEmptyRecallBundle();
    }
    if (this.fallbackProvider.prefetch) {
      return (await this.fallbackProvider.prefetch(context)) ?? createEmptyRecallBundle();
    }
    return createEmptyRecallBundle();
  }
}

function convertSearchResultToMemoryFile(result: {
  readonly path: string;
  readonly kind: WorkspaceMemoryFile["kind"];
  readonly content: string;
}): WorkspaceMemoryFile {
  return {
    path: result.path,
    kind: result.kind,
    content: result.content,
    truncated: true,
  };
}

function mergeRecallBundles(bundles: readonly MemoryRecallBundle[]): MemoryRecallBundle {
  return {
    sessionMemories: mergeDistinctById(...bundles.map((bundle) => bundle.sessionMemories)),
    workspaceMemories: mergeDistinctById(...bundles.map((bundle) => bundle.workspaceMemories)),
    profileFacts: mergeDistinctById(...bundles.map((bundle) => bundle.profileFacts)),
    learnedSkills: mergeDistinctById(...bundles.map((bundle) => bundle.learnedSkills)),
    workspaceMemoryFiles: mergeWorkspaceMemoryFiles(...bundles.map((bundle) => bundle.workspaceMemoryFiles)),
    relatedSessions: mergeDistinctByMessageKey(...bundles.map((bundle) => bundle.relatedSessions)),
  };
}

function rankAndFuseRankedById<T extends { readonly id: string }>(
  items: readonly RankedRecallItem<T>[] | undefined,
  limit: number,
  ranking: NormalizedHybridMemoryRanking,
): T[] {
  return rankAndSelectRecallItems(items, limit, ranking, (item) => item.id);
}

function rankAndFuseRankedWorkspaceFiles(
  items: readonly RankedRecallItem<WorkspaceMemoryFile>[] | undefined,
  limit: number,
  ranking: NormalizedHybridMemoryRanking,
): WorkspaceMemoryFile[] {
  return rankAndSelectRecallItems(
    items,
    limit,
    ranking,
    (item) => `${item.kind}:${item.path.replace(/\\/g, "/").toLowerCase()}`,
  );
}

function rankAndFuseRankedSessions(
  items: readonly RankedRecallItem<SessionSearchResult>[] | undefined,
  limit: number,
  ranking: NormalizedHybridMemoryRanking,
): SessionSearchResult[] {
  return rankAndSelectRecallItems(
    items,
    limit,
    ranking,
    (item) => `${item.threadId}:${item.messageId}`,
  );
}

function rankAndSelectRecallItems<T>(
  items: readonly RankedRecallItem<T>[] | undefined,
  limit: number,
  ranking: NormalizedHybridMemoryRanking,
  getKey: (item: T) => string,
): T[] {
  if (!items || items.length === 0 || limit <= 0) {
    return [];
  }

  const mergedByKey = new Map<string, RankedRecallCandidate<T>>();
  for (const entry of items) {
    const candidate = buildRankedRecallCandidate(entry, ranking, getKey);
    if (!candidate || candidate.adjustedScore < ranking.minScore) {
      continue;
    }
    const previous = mergedByKey.get(candidate.key);
    if (
      !previous ||
      candidate.adjustedScore > previous.adjustedScore ||
      (candidate.adjustedScore === previous.adjustedScore && candidate.sourceId.localeCompare(previous.sourceId) < 0)
    ) {
      mergedByKey.set(candidate.key, candidate);
    }
  }

  const ranked = [...mergedByKey.values()].sort((left, right) => {
    if (right.adjustedScore !== left.adjustedScore) {
      return right.adjustedScore - left.adjustedScore;
    }
    if (left.sourceId !== right.sourceId) {
      return left.sourceId.localeCompare(right.sourceId);
    }
    return left.key.localeCompare(right.key);
  });
  const candidateLimit = Math.max(limit, ranking.candidateMultiplier * limit);
  const shortlisted = ranked.slice(0, candidateLimit);
  const selected = ranking.mmr.enabled
    ? applyMaxMarginalRelevance(shortlisted, limit, ranking.mmr.lambda)
    : shortlisted.slice(0, limit);
  return selected.map((candidate) => candidate.item);
}

function buildRankedRecallCandidate<T>(
  entry: RankedRecallItem<T>,
  ranking: NormalizedHybridMemoryRanking,
  getKey: (item: T) => string,
): RankedRecallCandidate<T> | null {
  const rawScore = Number.isFinite(entry.score) ? entry.score : 0;
  if (rawScore <= 0) {
    return null;
  }
  const sourceWeight = resolveHybridRecallSourceWeight(entry.sourceId, ranking);
  const temporalWeight = computeTemporalDecayMultiplier(entry.item, ranking);
  const adjustedScore = rawScore * sourceWeight * temporalWeight;
  if (!Number.isFinite(adjustedScore) || adjustedScore <= 0) {
    return null;
  }
  return {
    key: getKey(entry.item),
    item: entry.item,
    sourceId: entry.sourceId,
    adjustedScore,
    text: extractTextualRecallContent(entry.item),
  };
}

function applyMaxMarginalRelevance<T>(
  candidates: readonly RankedRecallCandidate<T>[],
  limit: number,
  lambda: number,
): RankedRecallCandidate<T>[] {
  if (candidates.length <= limit || limit <= 0) {
    return [...candidates.slice(0, Math.max(0, limit))];
  }

  const remaining = [...candidates];
  const selected: RankedRecallCandidate<T>[] = [];
  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const similarityPenalty =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((picked) => computeRecallTextSimilarity(candidate.text, picked.text)));
      const score = lambda * candidate.adjustedScore - (1 - lambda) * similarityPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected;
}

function normalizeHybridMemoryRanking(options: HybridMemoryRankingOptions | undefined): NormalizedHybridMemoryRanking {
  const rawVectorWeight = clampRecallNumber(options?.vectorWeight, 0, 1, 0.55);
  const rawTextWeight = clampRecallNumber(options?.textWeight, 0, 1, 0.45);
  const weightSum = rawVectorWeight + rawTextWeight;
  const vectorWeight = weightSum > 0 ? rawVectorWeight / weightSum : 0.55;
  const textWeight = weightSum > 0 ? rawTextWeight / weightSum : 0.45;
  return {
    minScore: Math.max(0, options?.minScore ?? 0),
    candidateMultiplier: clampRecallInteger(options?.candidateMultiplier, 1, 20, 4),
    vectorWeight,
    textWeight,
    sourceChannels: options?.sourceChannels ?? {},
    mmr: {
      enabled: options?.mmr?.enabled ?? false,
      lambda: clampRecallNumber(options?.mmr?.lambda, 0, 1, 0.7),
    },
    temporalDecay: {
      enabled: options?.temporalDecay?.enabled ?? false,
      halfLifeDays: clampRecallInteger(options?.temporalDecay?.halfLifeDays, 1, 3650, 30),
    },
  };
}

function resolveHybridRecallSourceWeight(
  sourceId: string,
  ranking: NormalizedHybridMemoryRanking,
): number {
  const channel = resolveHybridRecallSourceChannel(sourceId, ranking.sourceChannels);
  if (channel === "vector") {
    return ranking.vectorWeight;
  }
  if (channel === "text") {
    return ranking.textWeight;
  }
  return 1;
}

function resolveHybridRecallSourceChannel(
  sourceId: string,
  sourceChannels: Readonly<Record<string, HybridRecallSourceChannel>>,
): HybridRecallSourceChannel {
  const explicit = sourceChannels[sourceId];
  if (explicit) {
    return explicit;
  }
  const normalized = sourceId.trim().toLowerCase();
  if (/(vector|embedding|semantic)/.test(normalized)) {
    return "vector";
  }
  if (/(fts|text|keyword|bm25|search)/.test(normalized)) {
    return "text";
  }
  return "other";
}

function computeTemporalDecayMultiplier<T>(
  item: T,
  ranking: NormalizedHybridMemoryRanking,
): number {
  if (!ranking.temporalDecay.enabled) {
    return 1;
  }
  const timestamp = extractRecallTimestamp(item);
  if (timestamp === null) {
    return 1;
  }
  const ageMs = Date.now() - timestamp;
  if (!Number.isFinite(ageMs) || ageMs <= 0) {
    return 1;
  }
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return 0.5 ** (ageDays / ranking.temporalDecay.halfLifeDays);
}

function extractRecallTimestamp(value: unknown): number | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["updatedAt", "createdAt"]) {
    const candidate = record[key];
    if (typeof candidate === "string" || candidate instanceof Date) {
      const parsed = Date.parse(String(candidate));
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function extractTextualRecallContent(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["content", "excerpt", "text", "title", "threadTitle", "path", "problemPattern", "guidance"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      parts.push(candidate);
    }
  }
  return normalizeRecallText(parts.join(" "));
}

function computeRecallTextSimilarity(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }
  const leftTokens = new Set(tokenizeRecallText(left));
  const rightTokens = new Set(tokenizeRecallText(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function tokenizeRecallText(value: string): string[] {
  return normalizeRecallText(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function normalizeRecallText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clampRecallNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const normalized = value as number;
  return Math.min(max, Math.max(min, normalized));
}

function clampRecallInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  return Math.trunc(clampRecallNumber(value, min, max, fallback));
}

export function buildAccountableMemoryTags(input: AccountableMemoryMetadata & {
  readonly tags?: readonly string[];
}): string[] {
  return Array.from(
    new Set(
      [
        ...(input.tags ?? []),
        `source:${input.source}`,
        `scope:${input.scope}`,
        `confidence:${input.confidence}`,
        `expiry:${input.expiry}`,
        `review:${input.review}`,
      ]
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ).sort();
}

function mergeDistinctById<T extends { readonly id: string }>(
  ...inputs: ReadonlyArray<readonly T[] | number>
): T[] {
  let limit = Number.POSITIVE_INFINITY;
  const merged: T[] = [];
  const seenIds = new Set<string>();
  for (const input of inputs) {
    if (typeof input === "number") {
      limit = input;
      continue;
    }
    for (const record of input) {
      if (seenIds.has(record.id)) {
        continue;
      }
      seenIds.add(record.id);
      merged.push(record);
      if (merged.length >= limit) {
        return merged;
      }
    }
  }
  return merged;
}

function mergeDistinctByMessageKey(...inputs: ReadonlyArray<readonly SessionSearchResult[]>): SessionSearchResult[] {
  const merged: SessionSearchResult[] = [];
  const seenKeys = new Set<string>();
  for (const input of inputs) {
    for (const record of input) {
      const key = `${record.threadId}:${record.messageId}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      merged.push(record);
    }
  }
  return merged;
}

function mergeWorkspaceMemoryFiles(
  ...inputs: ReadonlyArray<readonly WorkspaceMemoryFile[] | number>
): WorkspaceMemoryFile[] {
  let limit = Number.POSITIVE_INFINITY;
  const merged: WorkspaceMemoryFile[] = [];
  const seenKeys = new Set<string>();
  for (const input of inputs) {
    if (typeof input === "number") {
      limit = input;
      continue;
    }
    for (const record of input) {
      const key = `${record.kind}:${record.path.replace(/\\/g, "/").toLowerCase()}`;
      if (seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      merged.push(record);
      if (merged.length >= limit) {
        return merged;
      }
    }
  }
  return merged;
}

function fenceMemoryRecallBundle(bundle: MemoryRecallBundle): MemoryRecallBundle {
  return {
    sessionMemories: bundle.sessionMemories.map((entry) => ({
      ...entry,
      content: fenceRecallText(entry.content),
    })),
    workspaceMemories: bundle.workspaceMemories.map((entry) => ({
      ...entry,
      content: fenceRecallText(entry.content),
    })),
    profileFacts: bundle.profileFacts.map((entry) => ({
      ...entry,
      content: fenceRecallText(entry.content),
    })),
    learnedSkills: bundle.learnedSkills.map((entry) => ({
      ...entry,
      title: fenceRecallText(entry.title),
      problemPattern: fenceRecallText(entry.problemPattern),
      guidance: fenceRecallText(entry.guidance),
      exampleObjective: entry.exampleObjective ? fenceRecallText(entry.exampleObjective) : null,
      triggerSignals: entry.triggerSignals.map((signal) => fenceRecallText(signal)),
      procedureSteps: entry.procedureSteps.map((step) => fenceRecallText(step)),
      verificationSummary: fenceRecallText(entry.verificationSummary),
    })),
    workspaceMemoryFiles: bundle.workspaceMemoryFiles.map((entry) => ({
      ...entry,
      content: fenceRecallText(entry.content),
    })),
    relatedSessions: bundle.relatedSessions.map((entry) => ({
      ...entry,
      excerpt: fenceRecallText(entry.excerpt),
    })),
  };
}

function fenceRecallText(value: string): string {
  return value
    .replace(/<\/?(?:system|user|assistant|tool|tool_result|instruction|developer)[^>]*>/gi, "")
    .replace(/ignore\s+(?:previous|all|above|prior)\s+instructions/gi, "[removed instruction-like text]")
    .replace(/disregard\s+(?:your|all|any)\s+(?:instructions|rules|guidelines)/gi, "[removed instruction-like text]")
    .replace(/system\s+prompt\s+override/gi, "[removed instruction-like text]")
    .trim();
}

function createEmptyRecallBundle(): MemoryRecallBundle {
  return {
    sessionMemories: [],
    workspaceMemories: [],
    profileFacts: [],
    learnedSkills: [],
    workspaceMemoryFiles: [],
    relatedSessions: [],
  };
}

function compactModelText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return normalized.slice(0, maxChars);
}

function buildLearnedSkillTitle(problemPattern: string, changedFiles: readonly string[]): string {
  const primaryFile = changedFiles[0]?.trim();
  if (primaryFile) {
    return compactModelText(`Verified pattern for ${primaryFile}`, 120);
  }
  return compactModelText(`Verified pattern: ${problemPattern}`, 120);
}

function buildLearnedSkillCandidateTitle(problemPattern: string, changedFiles: readonly string[]): string {
  const primaryFile = changedFiles[0]?.trim();
  if (primaryFile) {
    return compactModelText(`Candidate pattern for ${primaryFile}`, 120);
  }
  return compactModelText(`Candidate pattern: ${problemPattern}`, 120);
}

function buildLearnedSkillDedupeKey(input: {
  readonly objective: string;
  readonly changedFiles: readonly string[];
  readonly taskMode: string;
}): string | null {
  const objectiveFingerprint = buildLearnedSkillObjectiveFingerprint(input.objective, input.changedFiles);
  const extensionFingerprint = Array.from(
    new Set(
      input.changedFiles
        .map((entry) => entry.trim().replace(/\\/g, "/"))
        .filter(Boolean)
        .map((entry) => entry.split("/").at(-1) ?? entry)
        .map((entry) => {
          const match = entry.toLowerCase().match(/\.([a-z0-9]+)$/);
          return match ? match[1] : "noext";
        }),
    ),
  )
    .sort()
    .join("|");
  if (!objectiveFingerprint && !extensionFingerprint) {
    return null;
  }
  return `procedure:${input.taskMode}:${objectiveFingerprint || "general"}:${extensionFingerprint || "noext"}`;
}

function buildLearnedSkillTriggerSignals(input: {
  readonly objective: string;
  readonly changedFiles: readonly string[];
  readonly verificationMode?: string;
  readonly verificationSummary: string;
  readonly verificationStatus: string;
  readonly taskMode: string;
}): string[] {
  const objectiveTokens = Array.from(
    new Set(
      input.objective
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 4 && !entry.includes(".") && !entry.includes("/")),
    ),
  ).slice(0, 6);
  const fileTokens = Array.from(
    new Set(
      input.changedFiles.flatMap((entry) =>
        entry
          .toLowerCase()
          .replace(/\\/g, "/")
          .split(/[^a-z0-9_.-]+/)
          .map((segment) => segment.trim())
          .filter((segment) => segment.length >= 3),
      ),
    ),
  ).slice(0, 6);
  const failureSignals = extractVerificationFailureSignals(input.verificationSummary);
  return normalizeLearnedSkillStrings([
    `mode:${input.taskMode}`,
    input.verificationMode ? `verification-mode:${input.verificationMode}` : null,
    `verification-status:${input.verificationStatus}`,
    ...objectiveTokens,
    ...fileTokens,
    ...failureSignals,
  ]);
}

function buildLearnedProcedureSteps(input: {
  readonly changedFiles: readonly string[];
  readonly verificationSummary: string;
  readonly outcomeSummary: string;
}): string[] {
  const targets = input.changedFiles.join(", ") || "the touched files";
  return [
    `Inspect ${targets} before editing.`,
    input.outcomeSummary ? `Apply the verified pattern: ${compactModelText(input.outcomeSummary, 180)}.` : null,
    `Re-run verification and require passing evidence: ${compactModelText(input.verificationSummary, 180)}.`,
  ].filter((entry): entry is string => Boolean(entry));
}

function buildLearnedSkillTags(changedFiles: readonly string[]): string[] {
  const tags = new Set<string>(["verified", "code-change", "procedure"]);
  for (const changedFile of changedFiles) {
    const normalized = changedFile.trim().replace(/\\/g, "/");
    if (!normalized) {
      continue;
    }
    tags.add(normalized);
    const segments = normalized.split("/");
    for (const segment of segments) {
      if (segment) {
        tags.add(segment);
      }
    }
  }
  return [...tags];
}

function shouldMaterializeLearnedSkill(skill: LearnedSkillRecord): boolean {
  if (skill.lifecycleState === "disabled" || skill.verificationStatus !== "passed") {
    return false;
  }
  return skill.revisionCount >= 2 || Boolean(skill.materializedSkillPath);
}

function shouldAutoPromoteLearnedSkill(skill: LearnedSkillRecord): boolean {
  return (
    skill.sourceType === "learned" &&
    skill.verificationStatus === "passed" &&
    skill.lifecycleState === "active" &&
    skill.revisionCount >= 2 &&
    skill.failureCount === 0 &&
    skill.qualityScore >= 50
  );
}

function buildSelfLearningAssessment(input: {
  readonly skill: LearnedSkillRecord;
  readonly taskMode: string;
  readonly changedFiles: readonly string[];
  readonly verificationSummary: string;
  readonly outcomeSummary: string;
}): { readonly content: string; readonly tags: string[] } {
  const confidence = calculateSelfLearningConfidence(input.skill);
  const recommendation = shouldAutoPromoteLearnedSkill(input.skill)
    ? "auto-promote"
    : input.skill.revisionCount >= 2
      ? "operator-review"
      : "observe";
  const evidence = [
    `revisions=${input.skill.revisionCount}`,
    `uses=${input.skill.useCount}`,
    `successes=${input.skill.successCount}`,
    `failures=${input.skill.failureCount}`,
    `quality=${input.skill.qualityScore}`,
    `confidence=${confidence}`,
  ].join(", ");
  return {
    content: compactModelText(
      [
        `Self-learning assessment for skill ${input.skill.id}: ${input.skill.title}.`,
        `Mode=${input.taskMode}; recommendation=${recommendation}; evidence: ${evidence}.`,
        input.changedFiles.length > 0 ? `Files: ${input.changedFiles.join(", ")}.` : null,
        input.skill.triggerSignals.length > 0 ? `Triggers: ${input.skill.triggerSignals.join(", ")}.` : null,
        input.outcomeSummary ? `Outcome pattern: ${input.outcomeSummary}.` : null,
        `Verification: ${input.verificationSummary}.`,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" "),
      900,
    ),
    tags: [
      "self-learning",
      "skill-assessment",
      `mode:${input.taskMode}`,
      `recommendation:${recommendation}`,
      `confidence:${confidence}`,
    ],
  };
}

function calculateSelfLearningConfidence(skill: LearnedSkillRecord): "low" | "medium" | "high" {
  if (skill.verificationStatus !== "passed" || skill.lifecycleState !== "active" || skill.failureCount > 0) {
    return "low";
  }
  if (skill.revisionCount >= 3 || skill.successCount >= 2 || skill.useCount >= 3 || skill.qualityScore >= 80) {
    return "high";
  }
  if (skill.revisionCount >= 2 || skill.qualityScore >= 50) {
    return "medium";
  }
  return "low";
}

function inferLearnedSkillTaskMode(objective: string, agentRole?: string): string {
  const normalized = `${agentRole ?? ""} ${objective}`.toLowerCase();
  if (/\bfix|repair|bug|regression\b/.test(normalized)) {
    return "repair";
  }
  if (/\brefactor|cleanup|simplify\b/.test(normalized)) {
    return "refactor";
  }
  if (/\badd|create|implement|build\b/.test(normalized)) {
    return "implement";
  }
  if (/\breview|audit\b/.test(normalized)) {
    return "review";
  }
  if (/\btest|verify|validation|assert\b/.test(normalized)) {
    return "verification";
  }
  if (/\bresearch|inspect|analy[sz]e\b/.test(normalized)) {
    return "research";
  }
  return "general";
}

function buildLearnedSkillObjectiveFingerprint(objective: string, changedFiles: readonly string[]): string {
  const stopwords = new Set([
    "the",
    "this",
    "that",
    "with",
    "from",
    "into",
    "file",
    "files",
    "code",
    "project",
    "repo",
    "repository",
    "update",
    "change",
  ]);
  const fileTokens = new Set(
    changedFiles.flatMap((entry) =>
      entry
        .toLowerCase()
        .replace(/\\/g, "/")
        .split(/[^a-z0-9_-]+/)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length >= 2),
    ),
  );
  const tokens = Array.from(
    new Set(
      objective
        .toLowerCase()
        .replace(/\\/g, "/")
        .split(/[^a-z0-9_-]+/)
        .map((entry) => entry.trim())
        .filter(
          (entry) =>
            entry.length >= 3 &&
            !stopwords.has(entry) &&
            !fileTokens.has(entry) &&
            !entry.includes("/") &&
            !/\.[a-z0-9]+$/.test(entry),
        ),
    ),
  );
  return tokens.slice(0, 6).join("-");
}

function extractVerificationFailureSignals(summary: string): string[] {
  const normalized = summary.toLowerCase();
  const signals: string[] = [];
  if (normalized.includes("failed") || normalized.includes("error")) {
    signals.push("verification-failed");
  }
  const exitCodeMatch = normalized.match(/exit(?:\s+code)?\s*(\d+)/);
  if (exitCodeMatch?.[1]) {
    signals.push(`exit-${exitCodeMatch[1]}`);
  }
  if (normalized.includes("timeout")) {
    signals.push("timeout");
  }
  return signals;
}

function normalizeLearnedSkillStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((entry) => entry?.trim()).filter((entry): entry is string => Boolean(entry))));
}

function normalizeCompactText(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...[truncated]`;
}
