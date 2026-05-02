import { basename, join, resolve } from "node:path";

import type { ApprovalPolicy } from "@omni-agent/approvals";
import { getAgentCapabilityProfile, listBuiltinContextEngines, type AgentRole } from "@omni-agent/context";
import {
  AgentRuntime,
  type AgentRuntimeEvent,
  type AgentRoleRuntimeOverride,
  listBuiltinMemoryProviders,
  type RuntimeToolPolicy,
  type RuntimeToolPolicyContext,
  type ToolPolicyRule,
  createBuiltinMemoryProvider,
} from "@omni-agent/core-runtime";
import type { VerificationMode } from "@omni-agent/context";
import {
  createDefaultExtensionRegistry,
  createExtensionRuntimeTools,
  loadExtensionRegistry,
  mergeExtensionRegistries,
} from "@omni-agent/extensions";
import {
  AnthropicMessagesModelClient,
  FailoverModelClient,
  MockModelClient,
  OpenAiCompatibleModelClient,
  loadModelProfilesFromEnv,
  selectModelProfiles,
  type ModelProfile,
  type ModelClient,
} from "@omni-agent/model-client";
import {
  SqliteSessionStore,
  type AgentRecord,
  type ArtifactRecord,
  type AutomationRecord,
  type FileLeaseRecord,
  type PersistedSubagentJobRecord,
  type RunMetricsRecord,
  type RunRecord,
  type ToolEventRecord,
} from "@omni-agent/session-store";
import { ToolRegistry, registerBuiltInTools } from "@omni-agent/tools";
import { LocalWorkspaceService, type ExecutionDomain } from "@omni-agent/workspace";

export type GatewayMode = "mock" | "openai";

interface RunSubagentTreeNode {
  readonly job: PersistedSubagentJobRecord;
  readonly leases: FileLeaseRecord[];
  readonly children: RunSubagentTreeNode[];
}

interface RunTimelineEntry {
  readonly at: string;
  readonly kind: "run" | "tool" | "artifact";
  readonly label: string;
  readonly status?: string;
  readonly summary: string;
  readonly refId?: string;
}

interface RunReviewSummary {
  readonly status: "ready" | "needs_verification" | "verification_failed" | "blocked" | "needs_repair";
  readonly runStatus: string;
  readonly verificationStatus: string | null;
  readonly toolFailures: Array<Pick<ToolEventRecord, "toolName" | "status" | "summary" | "createdAt">>;
  readonly blockedApprovals: Array<Pick<ToolEventRecord, "toolName" | "status" | "summary" | "createdAt">>;
  readonly diffArtifacts: Array<Pick<ArtifactRecord, "kind" | "path" | "summary" | "createdAt">>;
}

interface RunRecoverySummary {
  readonly task: string;
  readonly continueCommand: string;
  readonly cleanupState: "available" | "already_cleaned" | "not_needed";
  readonly cleanupCommand: string | null;
}

export interface GatewayRuntimeDefaults {
  readonly cwd?: string;
  readonly storageRoot?: string;
  readonly mode?: GatewayMode;
  readonly modelProfileId?: string;
  readonly modelProfiles?: ModelProfile[];
  readonly approvalPolicy?: ApprovalPolicy;
  readonly executionDomain?: ExecutionDomain;
  readonly verificationMode?: VerificationMode;
  readonly verificationCommands?: string[];
  readonly autoApproveRisky?: boolean;
  readonly maxIterations?: number;
  readonly pluginDirs?: string[];
  readonly role?: AgentRole;
  readonly contextEngineId?: string;
  readonly memoryProviderIds?: string[];
  readonly extraInstructions?: string[];
  readonly roleModelProfileIds?: Partial<Record<AgentRole, string>>;
  readonly toolPolicy?: RuntimeToolPolicy;
  readonly toolPolicyContext?: RuntimeToolPolicyContext;
}

export interface GatewayRunRequest extends GatewayRuntimeDefaults {
  readonly agentId?: string;
  readonly task: string;
  readonly threadTitle?: string;
  readonly threadId?: string;
  readonly continueLatest?: boolean;
}

export interface NormalizedGatewayRunRequest {
  readonly agentId?: string;
  readonly task: string;
  readonly cwd: string;
  readonly storageRoot?: string;
  readonly mode: GatewayMode;
  readonly modelProfileId?: string;
  readonly threadTitle?: string;
  readonly threadId?: string;
  readonly continueLatest: boolean;
  readonly approvalPolicy: ApprovalPolicy;
  readonly executionDomain: ExecutionDomain;
  readonly verificationMode: VerificationMode;
  readonly verificationCommands: string[];
  readonly autoApproveRisky: boolean;
  readonly maxIterations: number;
  readonly pluginDirs: string[];
  readonly role?: AgentRole;
  readonly contextEngineId?: string;
  readonly memoryProviderIds?: string[];
  readonly extraInstructions?: string[];
  readonly roleModelProfileIds?: Partial<Record<AgentRole, string>>;
  readonly toolPolicy?: RuntimeToolPolicy;
  readonly toolPolicyContext?: RuntimeToolPolicyContext;
}

export async function executeGatewayRunRequest(
  input: NormalizedGatewayRunRequest,
  options: {
    readonly eventHandler?: (event: AgentRuntimeEvent) => void | Promise<void>;
    readonly modelProfiles?: ModelProfile[];
    readonly abortSignal?: AbortSignal;
  } = {},
): Promise<Record<string, unknown>> {
  const sessionStore = new SqliteSessionStore(input.storageRoot);
  let loadedExtensionRegistry: Awaited<ReturnType<typeof loadExtensionRegistry>> | null = null;
  let extensionRegistry = createDefaultExtensionRegistry();
  try {
    sessionStore.initialize();
    const agent = input.agentId ? sessionStore.getAgent(input.agentId) : null;
    const resolved = resolveAgentScopedRunRequest(input, agent);
    const workspaceArtifactsRoot = agent
      ? join(agent.stateRoot, "artifacts")
      : join(
          sessionStore.artifactsRoot,
          sanitizeSegment(basename(resolve(resolved.cwd)) || "workspace"),
        );
    const workspace = new LocalWorkspaceService(resolved.cwd, workspaceArtifactsRoot);
    const toolRegistry = new ToolRegistry();
    registerBuiltInTools(toolRegistry);

    loadedExtensionRegistry = await loadExtensionRegistry({
      cwd: resolved.cwd,
      pluginDirs: resolved.pluginDirs,
    });
    extensionRegistry = mergeExtensionRegistries(extensionRegistry, loadedExtensionRegistry);
    toolRegistry.registerMany(extensionRegistry.listToolDefinitions());
    toolRegistry.registerMany(createExtensionRuntimeTools(extensionRegistry));

    const modelSelection =
      resolved.mode === "openai"
        ? createGatewayModelClient(resolved.modelProfileId, options.modelProfiles)
        : { client: new MockModelClient(), toolPolicyContext: undefined };
    const runtimeToolPolicyContext = mergeRuntimeToolPolicyContext(
      resolved.toolPolicyContext,
      modelSelection.toolPolicyContext,
    );
    const roleRuntimeOverrides = createGatewayRoleRuntimeOverrides(resolved.roleModelProfileIds, options.modelProfiles);
    const selectedMemoryProviders = resolveGatewayMemoryProviders(resolved.memoryProviderIds, extensionRegistry);
    const contextEngineFactory = resolved.contextEngineId
      ? extensionRegistry.getContextEngineFactory(resolved.contextEngineId)
      : null;

    const runtime = new AgentRuntime(
      sessionStore,
      workspace,
      toolRegistry,
      modelSelection.client,
      extensionRegistry,
      {
        approvalPolicy: resolved.approvalPolicy,
        executionDomain: resolved.executionDomain,
        verificationMode: resolved.verificationMode,
        toolPolicy: resolved.toolPolicy,
        toolPolicyContext: runtimeToolPolicyContext,
        roleRuntimeOverrides,
        memoryProviders: selectedMemoryProviders,
        contextEngineFactory: contextEngineFactory ?? undefined,
        contextEngineConfig: resolved.contextEngineId ? { engineId: resolved.contextEngineId } : undefined,
        approvalHandler: async () => resolved.autoApproveRisky,
        eventHandler: options.eventHandler,
      },
    );

    const summary = await runtime.runTask({
      objective: resolved.task,
      role: resolved.role,
      threadTitle: resolved.threadTitle,
      threadId: resolved.threadId,
      continueLatest: resolved.continueLatest,
      extraInstructions: resolved.extraInstructions,
      verificationCommands: resolved.verificationCommands,
      maxIterations: resolved.maxIterations,
      abortSignal: options.abortSignal,
    });

    const extensions = extensionRegistry.list();
    const summarizedExtensions =
      extensions.some((entry) => entry.id === "mcp-placeholder") || !extensions.some((entry) => entry.capability === "mcp")
        ? extensions
        : [
            ...extensions,
            {
              id: "mcp-placeholder",
              name: "MCP Placeholder",
              capability: "mcp" as const,
              description: "Synthetic MCP placeholder surfaced in gateway run summaries.",
              sourcePath: undefined,
              toolNames: [],
              resourceCount: 0,
              promptTemplateCount: 0,
              promptHookCount: 0,
            },
          ];

    return {
      summary,
      extensions: summarizedExtensions,
    };
  } finally {
    await loadedExtensionRegistry?.dispose();
    await extensionRegistry.dispose();
    sessionStore.close();
  }
}

function createGatewayModelClient(
  modelProfileId?: string,
  modelProfiles?: readonly ModelProfile[],
): { readonly client: ModelClient; readonly toolPolicyContext?: RuntimeToolPolicyContext } {
  const profiles = selectModelProfiles(modelProfiles && modelProfiles.length > 0 ? [...modelProfiles] : loadModelProfilesFromEnv(), modelProfileId);
  const selectedProfile = profiles.length === 1 ? profiles[0] : undefined;
  const toolPolicyContext =
    selectedProfile || modelProfileId
      ? {
          profileId: selectedProfile?.id ?? modelProfileId,
          providerId: selectedProfile?.protocol,
        }
      : undefined;
  if (profiles.length === 1) {
    return {
      client:
        profiles[0]?.protocol === "anthropic"
          ? new AnthropicMessagesModelClient(profiles[0])
          : new OpenAiCompatibleModelClient(profiles[0]),
      toolPolicyContext,
    };
  }
  return {
    client: new FailoverModelClient(profiles),
    toolPolicyContext,
  };
}

export function getRunDetails(runId: string, storageRoot?: string): Record<string, unknown> | null {
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    const run = sessionStore.getRun(runId);
    if (!run) {
      return null;
    }
    const metrics = sessionStore.getRunMetrics(runId);
    const toolEvents = sessionStore.listRunToolEvents(runId);
    const artifacts = sessionStore.listRunArtifacts(runId);
    const subagents = sessionStore.listSubagentJobs({ runId });
    return {
      run,
      agent: run.agentId ? sessionStore.getAgent(run.agentId) : null,
      metrics,
      threadUsage: sessionStore.summarizeThreadUsage(run.threadId),
      toolEvents,
      artifacts,
      timeline: buildRunTimeline(run, metrics, toolEvents, artifacts),
      review: buildRunReviewSummary(run, metrics, toolEvents, artifacts),
      recovery: buildRunRecoverySummary(run),
      subagents,
      subagentTree: buildSubagentTree(sessionStore, subagents),
    };
  } finally {
    sessionStore.close();
  }
}

function buildRunTimeline(
  run: RunRecord,
  metrics: RunMetricsRecord | null,
  toolEvents: readonly ToolEventRecord[],
  artifacts: readonly ArtifactRecord[],
): RunTimelineEntry[] {
  const entries: Array<RunTimelineEntry & { readonly order: number }> = [
    {
      at: metrics?.startedAt ?? run.createdAt,
      kind: "run",
      label: "Run started",
      status: run.status,
      summary: run.objective,
      refId: run.id,
      order: 0,
    },
  ];

  for (const [index, event] of toolEvents.entries()) {
    entries.push({
      at: event.createdAt,
      kind: "tool",
      label: `${event.toolName} [tier ${event.riskTier}]`,
      status: event.status,
      summary: event.summary,
      refId: event.id,
      order: 100 + index,
    });
  }

  for (const [index, artifact] of artifacts.entries()) {
    entries.push({
      at: artifact.createdAt,
      kind: "artifact",
      label: `Artifact: ${artifact.kind}`,
      summary: artifact.summary,
      refId: artifact.id,
      order: 200 + index,
    });
  }

  entries.push({
    at: metrics?.completedAt ?? run.updatedAt,
    kind: "run",
    label: "Run completed",
    status: run.status,
    summary: `status=${run.status}; verification=${run.verificationStatus ?? "n/a"}`,
    refId: run.id,
    order: 1000,
  });

  return entries
    .sort((left, right) => left.at.localeCompare(right.at) || left.order - right.order)
    .map(({ order: _order, ...entry }) => entry);
}

function buildRunReviewSummary(
  run: RunRecord,
  metrics: RunMetricsRecord | null,
  toolEvents: readonly ToolEventRecord[],
  artifacts: readonly ArtifactRecord[],
): RunReviewSummary {
  const toolFailures = toolEvents
    .filter((event) => event.status !== "ok" && event.status !== "approved" && event.status !== "blocked")
    .map((event) => ({
      toolName: event.toolName,
      status: event.status,
      summary: event.summary,
      createdAt: event.createdAt,
    }));
  const blockedApprovals = toolEvents
    .filter((event) => event.status === "blocked")
    .map((event) => ({
      toolName: event.toolName,
      status: event.status,
      summary: event.summary,
      createdAt: event.createdAt,
    }));
  const diffArtifacts = artifacts
    .filter((artifact) => artifact.kind.startsWith("git-diff"))
    .map((artifact) => ({
      kind: artifact.kind,
      path: artifact.path,
      summary: artifact.summary,
      createdAt: artifact.createdAt,
    }));
  return {
    status: deriveRunReviewStatus(run, metrics, toolFailures.length, blockedApprovals.length),
    runStatus: run.status,
    verificationStatus: run.verificationStatus,
    toolFailures,
    blockedApprovals,
    diffArtifacts,
  };
}

function deriveRunReviewStatus(
  run: RunRecord,
  metrics: RunMetricsRecord | null,
  toolFailureCount: number,
  blockedApprovalCount: number,
): RunReviewSummary["status"] {
  if (run.status === "failed" || (metrics?.toolFailureCount ?? toolFailureCount) > 0) {
    return "needs_repair";
  }
  if (run.verificationStatus === "failed") {
    return "verification_failed";
  }
  if ((metrics?.blockedApprovalCount ?? blockedApprovalCount) > 0) {
    return "blocked";
  }
  if (!run.verificationStatus || run.verificationStatus === "skipped") {
    return "needs_verification";
  }
  return "ready";
}

function buildRunRecoverySummary(run: RunRecord): RunRecoverySummary {
  const task = buildRunRecoveryTask(run.status, run.verificationStatus, run.id);
  const cleanupAvailable = Boolean(run.worktreePath || run.sandboxPath);
  return {
    task,
    continueCommand: `npm run dev -- run --cwd ${quoteCliValue(run.sourceRoot ?? process.cwd())} --thread-id ${run.threadId} --task ${quoteCliValue(task)}`,
    cleanupState: cleanupAvailable ? (run.executionCleanedAt ? "already_cleaned" : "available") : "not_needed",
    cleanupCommand: cleanupAvailable && !run.executionCleanedAt ? `npm run dev -- cleanup-run --run-id ${run.id}` : null,
  };
}

function buildRunRecoveryTask(status: string, verificationStatus: string | null, runId: string): string {
  if (status === "failed" || verificationStatus === "failed") {
    return `Continue from run ${runId}: inspect the failed tool or verification output, make the smallest repair, and rerun verification.`;
  }
  if (verificationStatus === "skipped" || !verificationStatus) {
    return `Continue from run ${runId}: add or run an appropriate verification command, then summarize any remaining risk.`;
  }
  return `Continue from run ${runId}: review the diff and confirm no follow-up changes are needed.`;
}

function quoteCliValue(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildSubagentTree(
  sessionStore: SqliteSessionStore,
  jobs: PersistedSubagentJobRecord[],
): RunSubagentTreeNode[] {
  const jobsById = new Map(jobs.map((job) => [job.id, job] as const));
  const childrenByParentId = new Map<string, PersistedSubagentJobRecord[]>();
  const roots: PersistedSubagentJobRecord[] = [];

  for (const job of jobs) {
    if (job.parentJobId && jobsById.has(job.parentJobId)) {
      const siblings = childrenByParentId.get(job.parentJobId) ?? [];
      siblings.push(job);
      childrenByParentId.set(job.parentJobId, siblings);
      continue;
    }
    roots.push(job);
  }

  const sortJobs = (entries: PersistedSubagentJobRecord[]): PersistedSubagentJobRecord[] =>
    [...entries].sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const visit = (
    job: PersistedSubagentJobRecord,
  ): RunSubagentTreeNode => ({
    job,
    leases: sessionStore.listFileLeases({ ownerJobId: job.id, limit: 200 }),
    children: sortJobs(childrenByParentId.get(job.id) ?? []).map((child) => visit(child)),
  });

  return sortJobs(roots).map((job) => visit(job));
}

export function listContextEngines(): ReturnType<typeof listBuiltinContextEngines> {
  return listBuiltinContextEngines();
}

export function listMemoryProviders(): ReturnType<typeof listBuiltinMemoryProviders> {
  return listBuiltinMemoryProviders();
}

export async function cleanupRunExecution(
  runId: string,
  storageRoot?: string,
): Promise<Record<string, unknown> | null> {
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    const run = sessionStore.getRun(runId);
    if (!run) {
      return null;
    }

    if (run.executionCleanedAt) {
      return {
        cleaned: false,
        alreadyCleanedAt: run.executionCleanedAt,
        run,
      };
    }

    if (!run.sourceRoot && !run.executionRoot) {
      return {
        cleaned: false,
        reason: "Run has no persisted execution root.",
        run,
      };
    }

    const workspaceRoot = run.sourceRoot ?? run.executionRoot ?? process.cwd();
    const workspaceArtifactsRoot = join(
      sessionStore.artifactsRoot,
      sanitizeSegment(basename(resolve(workspaceRoot)) || "workspace"),
    );
    const workspace = new LocalWorkspaceService(workspaceRoot, workspaceArtifactsRoot);
    if (run.worktreePath) {
      await workspace.cleanupWorktree(run.worktreePath);
    } else if (run.sandboxPath) {
      await workspace.cleanupSandbox(run.sandboxPath);
    } else {
      return {
        cleaned: false,
        reason:
          run.executionRoot && run.executionRoot !== run.sourceRoot
            ? `Run uses an unmanaged execution root: ${run.executionRoot}`
            : "Run executed directly in the workspace.",
        run,
      };
    }

    const updated = sessionStore.markRunExecutionCleaned(run.id);
    return {
      cleaned: true,
      run: updated,
    };
  } finally {
    sessionStore.close();
  }
}

export function normalizeRunRequest(
  raw: Record<string, unknown>,
  defaults: GatewayRuntimeDefaults,
): NormalizedGatewayRunRequest {
  const task = typeof raw.task === "string" && raw.task.trim().length > 0 ? raw.task.trim() : null;
  if (!task) {
    throw new Error("The /runs endpoint requires a non-empty task.");
  }

  return {
    agentId: optionalString(raw.agentId),
    task,
    cwd: resolve(stringOrDefault(raw.cwd, defaults.cwd ?? process.cwd())),
    storageRoot: stringOrDefault(raw.storageRoot, defaults.storageRoot),
    mode: normalizeMode(raw.mode, defaults.mode),
    modelProfileId: optionalString(raw.modelProfileId) ?? defaults.modelProfileId,
    threadTitle: optionalString(raw.threadTitle),
    threadId: optionalString(raw.threadId),
    continueLatest: booleanOrDefault(raw.continueLatest, false),
    approvalPolicy: normalizeApprovalPolicy(raw.approvalPolicy, defaults.approvalPolicy),
    executionDomain: normalizeExecutionDomain(raw.executionDomain, defaults.executionDomain),
    verificationMode: normalizeVerificationMode(raw.verificationMode, defaults.verificationMode),
    verificationCommands: stringArrayOrDefault(raw.verificationCommands, defaults.verificationCommands ?? []),
    autoApproveRisky: booleanOrDefault(raw.autoApproveRisky, defaults.autoApproveRisky ?? false),
    maxIterations: parsePositiveNumber(raw.maxIterations, defaults.maxIterations ?? 8),
    pluginDirs: stringArrayOrDefault(raw.pluginDirs, defaults.pluginDirs ?? []),
    role: normalizeRunRole(raw.role, defaults.role),
    contextEngineId: optionalString(raw.contextEngineId) ?? defaults.contextEngineId,
    memoryProviderIds: stringArrayOrDefault(raw.memoryProviderIds, defaults.memoryProviderIds ?? []),
    extraInstructions: stringArrayOrDefault(raw.extraInstructions, defaults.extraInstructions ?? []),
    roleModelProfileIds: normalizeRoleModelProfileIds(raw.roleModelProfileIds, defaults.roleModelProfileIds),
    toolPolicy: defaults.toolPolicy,
    toolPolicyContext: normalizeToolPolicyContext(raw, defaults),
  };
}

export function buildRunRequestFromAutomation(
  automation: AutomationRecord,
  workspaceCwd: string,
  storageRoot?: string,
  pluginDirs: string[] = [],
  overrides: Partial<Pick<NormalizedGatewayRunRequest, "task" | "threadId" | "threadTitle" | "toolPolicyContext">> = {},
): NormalizedGatewayRunRequest {
  return {
    agentId: automation.agentId ?? undefined,
    task: overrides.task ?? automation.task,
    cwd: workspaceCwd,
    storageRoot,
    mode: automation.mode as GatewayMode,
    threadTitle: overrides.threadTitle ?? automation.threadTitle ?? automation.title,
    threadId: overrides.threadId ?? automation.threadId ?? undefined,
    continueLatest: automation.threadId ? false : true,
    approvalPolicy: "on-request",
    executionDomain: automation.executionDomain as ExecutionDomain,
    verificationMode: automation.verificationMode as VerificationMode,
    verificationCommands: automation.verificationCommands,
    autoApproveRisky: automation.autoApproveRisky,
    maxIterations: automation.maxIterations,
    pluginDirs,
    role: undefined,
    contextEngineId: undefined,
    memoryProviderIds: undefined,
    extraInstructions: undefined,
    roleModelProfileIds: undefined,
    toolPolicy: undefined,
    toolPolicyContext: overrides.toolPolicyContext,
  };
}

function resolveAgentScopedRunRequest(
  input: NormalizedGatewayRunRequest,
  agent: AgentRecord | null,
): NormalizedGatewayRunRequest {
  if (!agent) {
    return input;
  }
  const capabilityProfile = getAgentCapabilityProfile(readAgentCapabilityProfileId(agent.metadata));
  const profileToolPolicy = capabilityProfile?.toolPolicy as RuntimeToolPolicy | undefined;
  return {
    ...input,
    cwd: agent.cwd,
    role: input.role ?? agent.defaultRole ?? capabilityProfile?.defaultRole ?? undefined,
    modelProfileId: input.modelProfileId ?? agent.defaultModelProfileId ?? undefined,
    contextEngineId: input.contextEngineId ?? agent.contextEngineId ?? capabilityProfile?.contextEngineId ?? undefined,
    memoryProviderIds:
      input.memoryProviderIds && input.memoryProviderIds.length > 0
        ? input.memoryProviderIds
        : agent.memoryProviderIds.length > 0
          ? [...agent.memoryProviderIds]
          : capabilityProfile?.memoryProviderIds && capabilityProfile.memoryProviderIds.length > 0
            ? [...capabilityProfile.memoryProviderIds]
          : undefined,
    verificationMode:
      capabilityProfile?.verificationMode === "required" ? "required" : input.verificationMode,
    maxIterations: Math.max(input.maxIterations, capabilityProfile?.maxIterations ?? input.maxIterations),
    extraInstructions: mergeStringLists(
      input.extraInstructions,
      mergeStringLists(capabilityProfile?.defaultInstructions, agent.instruction ? [agent.instruction] : undefined),
    ),
    toolPolicy: mergeRuntimeToolPolicies(profileToolPolicy, input.toolPolicy),
    toolPolicyContext: mergeRuntimeToolPolicyContext(input.toolPolicyContext, {
      agentId: agent.id,
      authProfileId: agent.authProfileId ?? undefined,
    }),
  };
}

function readAgentCapabilityProfileId(metadata: Readonly<Record<string, unknown>> | null | undefined): string | null {
  if (!metadata) {
    return null;
  }
  const direct = metadata.capabilityProfileId;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const nested = metadata.capabilityProfile;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedId = (nested as Record<string, unknown>).id;
    return typeof nestedId === "string" && nestedId.trim() ? nestedId.trim() : null;
  }
  return null;
}

function mergeRuntimeToolPolicies(
  base: RuntimeToolPolicy | undefined,
  overlay: RuntimeToolPolicy | undefined,
): RuntimeToolPolicy | undefined {
  if (!base && !overlay) {
    return undefined;
  }
  return {
    ...(base ?? {}),
    ...(overlay ?? {}),
    global: mergeOptionalToolPolicyRules(base?.global, overlay?.global),
    runtime: mergeOptionalToolPolicyRules(base?.runtime, overlay?.runtime),
    authProfiles: mergeToolPolicyRuleMap(base?.authProfiles, overlay?.authProfiles),
    executionDomains: mergeToolPolicyRuleMap(base?.executionDomains, overlay?.executionDomains),
    providers: mergeToolPolicyRuleMap(base?.providers, overlay?.providers),
    profiles: mergeToolPolicyRuleMap(base?.profiles, overlay?.profiles),
    sessions: mergeToolPolicyRuleMap(base?.sessions, overlay?.sessions),
    routes: mergeToolPolicyRuleMap(base?.routes, overlay?.routes),
    channels: mergeToolPolicyRuleMap(base?.channels, overlay?.channels),
    agents: mergeToolPolicyRuleMap(base?.agents, overlay?.agents),
    roles: mergeToolPolicyRuleMap(base?.roles, overlay?.roles),
    subagents: mergeToolPolicyRuleMap(base?.subagents, overlay?.subagents),
  };
}

function mergeToolPolicyRuleMap<TKey extends string>(
  base: Readonly<Partial<Record<TKey, ToolPolicyRule>>> | undefined,
  overlay: Readonly<Partial<Record<TKey, ToolPolicyRule>>> | undefined,
): Record<TKey, ToolPolicyRule> | undefined {
  if (!base && !overlay) {
    return undefined;
  }
  const merged = {} as Record<TKey, ToolPolicyRule>;
  for (const key of Object.keys(base ?? {}) as TKey[]) {
    const rule = base?.[key];
    if (rule) {
      merged[key] = rule;
    }
  }
  for (const key of Object.keys(overlay ?? {}) as TKey[]) {
    merged[key] = mergeToolPolicyRules(base?.[key], overlay?.[key]);
  }
  return merged;
}

function mergeToolPolicyRules(
  base: ToolPolicyRule | undefined,
  overlay: ToolPolicyRule | undefined,
): ToolPolicyRule {
  const allowTools = mergeStringLists(base?.allowTools, overlay?.allowTools);
  const denyTools = mergeStringLists(base?.denyTools, overlay?.denyTools);
  const merged: { allowTools?: readonly string[]; denyTools?: readonly string[] } = {};
  if (allowTools) {
    merged.allowTools = allowTools;
  }
  if (denyTools) {
    merged.denyTools = denyTools;
  }
  return merged;
}

function mergeOptionalToolPolicyRules(
  base: ToolPolicyRule | undefined,
  overlay: ToolPolicyRule | undefined,
): ToolPolicyRule | undefined {
  if (!base && !overlay) {
    return undefined;
  }
  return mergeToolPolicyRules(base, overlay);
}

function mergeRuntimeToolPolicyContext(
  primary: RuntimeToolPolicyContext | undefined,
  secondary: RuntimeToolPolicyContext | undefined,
): RuntimeToolPolicyContext | undefined {
  if (!primary && !secondary) {
    return undefined;
  }
  return {
    ...(secondary ?? {}),
    ...(primary ?? {}),
  };
}

function normalizeToolPolicyContext(
  raw: Record<string, unknown>,
  defaults: GatewayRuntimeDefaults,
): RuntimeToolPolicyContext | undefined {
  const nested =
    raw.toolPolicyContext && typeof raw.toolPolicyContext === "object" && !Array.isArray(raw.toolPolicyContext)
      ? (raw.toolPolicyContext as Record<string, unknown>)
      : {};
  const context: RuntimeToolPolicyContext = {
    ...(defaults.toolPolicyContext ?? {}),
    agentId: optionalString(raw.agentId) ?? optionalString(nested.agentId) ?? defaults.toolPolicyContext?.agentId,
    authProfileId:
      optionalString(raw.authProfileId) ?? optionalString(nested.authProfileId) ?? defaults.toolPolicyContext?.authProfileId,
    channelId: optionalString(raw.channelId) ?? optionalString(nested.channelId) ?? defaults.toolPolicyContext?.channelId,
    channelKey: optionalString(raw.channelKey) ?? optionalString(nested.channelKey) ?? defaults.toolPolicyContext?.channelKey,
    channelType: optionalString(raw.channelType) ?? optionalString(nested.channelType) ?? defaults.toolPolicyContext?.channelType,
    executionDomain:
      nested.executionDomain === "sandbox" || nested.executionDomain === "worktree" || nested.executionDomain === "workspace"
        ? nested.executionDomain
        : defaults.toolPolicyContext?.executionDomain,
    profileId:
      optionalString(nested.profileId) ??
      optionalString(raw.modelProfileId) ??
      defaults.toolPolicyContext?.profileId,
    providerId: optionalString(raw.providerId) ?? optionalString(nested.providerId) ?? defaults.toolPolicyContext?.providerId,
    routeId: optionalString(raw.routeId) ?? optionalString(nested.routeId) ?? defaults.toolPolicyContext?.routeId,
    sessionId: optionalString(raw.sessionId) ?? optionalString(nested.sessionId) ?? defaults.toolPolicyContext?.sessionId,
    threadId: optionalString(raw.threadId) ?? optionalString(nested.threadId) ?? defaults.toolPolicyContext?.threadId,
  };
  return Object.values(context).some((value) => value !== undefined) ? context : undefined;
}

function normalizeRoleModelProfileIds(
  value: unknown,
  defaults: GatewayRuntimeDefaults["roleModelProfileIds"],
): Partial<Record<AgentRole, string>> | undefined {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const normalized: Partial<Record<AgentRole, string>> = { ...(defaults ?? {}) };
  for (const role of ["planner", "researcher", "reviewer", "supervisor", "verifier", "worker"] as const) {
    const profileId = optionalString(source[role]);
    if (profileId) {
      normalized[role] = profileId;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function resolveGatewayMemoryProviders(
  memoryProviderIds: readonly string[] | undefined,
  extensionRegistry: ReturnType<typeof createDefaultExtensionRegistry>,
): ReturnType<typeof extensionRegistry.createMemoryProviders> | undefined {
  const requested = Array.from(new Set((memoryProviderIds ?? []).map((entry) => entry.trim()).filter(Boolean)));
  if (requested.length === 0) {
    return undefined;
  }
  const builtins = requested
    .map((memoryProviderId) => createBuiltinMemoryProvider(memoryProviderId))
    .filter((provider): provider is NonNullable<typeof provider> => Boolean(provider));
  const extensions = extensionRegistry.createMemoryProviders(requested);
  return [...builtins, ...extensions];
}

function mergeStringLists(primary?: readonly string[], secondary?: readonly string[]): string[] | undefined {
  const merged = Array.from(new Set([...(primary ?? []), ...(secondary ?? [])].map((entry) => entry.trim()).filter(Boolean)));
  return merged.length > 0 ? merged : undefined;
}

function normalizeRunRole(value: unknown, fallback?: AgentRole): AgentRole | undefined {
  const normalized = typeof value === "string" ? value.trim() : "";
  switch (normalized) {
    case "primary":
    case "planner":
    case "researcher":
    case "reviewer":
    case "verifier":
    case "worker":
    case "executor":
    case "supervisor":
      return normalized as AgentRole;
    default:
      return fallback;
  }
}

function createGatewayRoleRuntimeOverrides(
  roleModelProfileIds: Partial<Record<AgentRole, string>> | undefined,
  modelProfiles?: readonly ModelProfile[],
): Partial<Record<AgentRole, AgentRoleRuntimeOverride>> | undefined {
  if (!roleModelProfileIds) {
    return undefined;
  }
  const overrides: Partial<Record<AgentRole, AgentRoleRuntimeOverride>> = {};
  for (const [role, profileId] of Object.entries(roleModelProfileIds) as Array<[AgentRole, string]>) {
    const normalizedProfileId = profileId.trim();
    if (!normalizedProfileId) {
      continue;
    }
    const selection = createGatewayModelClient(normalizedProfileId, modelProfiles);
    overrides[role] = {
      modelClient: selection.client,
      toolPolicyContext: selection.toolPolicyContext,
    };
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringOrDefault(value: unknown, fallback?: string): string {
  return optionalString(value) ?? fallback ?? "";
}

function stringArrayOrDefault(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return value
    .map((entry) => optionalString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeMode(value: unknown, fallback: GatewayMode | undefined): GatewayMode {
  return value === "openai" || value === "mock" ? value : fallback ?? "mock";
}

function normalizeApprovalPolicy(
  value: unknown,
  fallback: ApprovalPolicy | undefined,
): ApprovalPolicy {
  return value === "never" || value === "manual" || value === "on-failure" || value === "on-request"
    ? value
    : fallback ?? "on-request";
}

function normalizeExecutionDomain(
  value: unknown,
  fallback: ExecutionDomain | undefined,
): ExecutionDomain {
  return value === "sandbox" || value === "worktree" || value === "workspace"
    ? value
    : fallback ?? "workspace";
}

function normalizeVerificationMode(
  value: unknown,
  fallback: VerificationMode | undefined,
): VerificationMode {
  return value === "best-effort" || value === "required" ? value : fallback ?? "required";
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}
