import { randomUUID } from "node:crypto";
import { basename, join, relative } from "node:path";

import {
  classifyToolCall,
  resolveApprovalDecision,
  type ApprovalGrantScope,
  type ApprovalGrantStore,
  type ApprovalPolicy,
  type ToolRiskAssessment,
} from "@omni-agent/approvals";
import {
  compactToolObservationsForModel,
  createContextEngine,
  createThreadSummarySnapshot,
  findRelevantAgentPlaybooks,
  getAgentRoleContract,
  mergeThreadHandoffSummaries,
  normalizeAgentRole,
  type AgentPlaybook,
  type ContextEngineConfig,
  type ContextEngineFactory,
  type ContextEngineStatus,
  type AgentRole,
  type TaskContract,
  type TaskState,
  type ThreadMessage,
  type VerificationMode,
} from "@omni-agent/context";
import { assessVerification, inferVerificationPlan, type VerificationAssessment } from "@omni-agent/evals";
import {
  createExtensionRuntimeTools,
  loadExtensionRegistry,
  mergeExtensionRegistries,
  type ExtensionRegistry,
  type ToolLifecycleHookPhase,
  type ToolLifecycleHookStatus,
} from "@omni-agent/extensions";
import type { ModelClient, ModelTurnResult, ToolObservation } from "@omni-agent/model-client";
import { redactSensitiveText, redactSensitiveValue } from "@omni-agent/safety";
import {
  SqliteSessionStore,
  type ArtifactRecord,
  type LearnedSkillRecord,
  type MemoryRecord,
  type MessageRecord,
  type PersistedSubagentJobRecord,
  type ProfileFactRecord,
  type RunMetricsRecord,
  type RunRecord,
  type RunStatus,
  type SessionSearchResult,
  type ThreadRecord,
  type ThreadUsageSummary,
  type ToolEventRecord,
  type WorkspaceRecord,
} from "@omni-agent/session-store";
import {
  ToolRegistry,
  collectTodoTaskBoardHandoff,
  type SubagentAuthority,
  type SubagentBudget,
  type SubagentCompletionReport,
  type SubagentController,
  type SubagentExecutionMode,
  type SubagentExecutionRequest,
  type SubagentMessageRecord,
  type SubagentOutcomeVisibility,
  type SubagentProgressEvent,
  type StructuredSubagentResult,
  type ToolInterruptRequest,
  type SubagentJobRecord,
  type ToolCallRequest,
  type ToolPresentation,
  type ToolResult,
} from "@omni-agent/tools";
import {
  createWorkspaceExecutionPolicy,
  LocalWorkspaceService,
  type ExecutionDomain,
  type GitDiffSummary,
  type VerificationExecutionResult,
  type WorkspaceCheckpointRecord,
  type WorkspaceInstructionFile,
  type WorkspaceMemoryFile,
  type WorkspaceSkillFile,
  type WorkspaceSnapshot,
} from "@omni-agent/workspace";
import {
  type AutomaticMemoryEntry,
  BuiltinSqliteMemoryProvider,
  MemoryProviderCoordinator,
  type MemoryDelegationContext,
  type MemoryProvider,
  type MemoryProviderContext,
  type MemoryProviderSessionContext,
  type MemorySessionEndContext,
  type MemoryTurnSyncContext,
  type MemoryWriteContext,
} from "./memory-provider.js";

export interface ApprovalRequest {
  readonly assessment: ToolRiskAssessment;
  readonly toolCall: ToolCallRequest;
}

export type ApprovalHandlerResult =
  | boolean
  | ApprovalGrantScope
  | {
    readonly approved: boolean;
    readonly scope?: ApprovalGrantScope;
  };

const TOOL_NAME_REPAIR_THRESHOLD = 0.7;
const TOOL_NAME_REPAIR_FALLBACK_THRESHOLD = 0.62;
const TOOL_NAME_DECORATION_TOKENS = new Set(["tool", "tools"]);
const TOOL_NAME_ALIASES = new Map([
  ["bash", "run_command"],
  ["cmd", "run_command"],
  ["exec", "run_command"],
  ["exec_command", "run_command"],
  ["execute_command", "run_command"],
  ["run_shell", "run_command"],
  ["run_terminal", "run_command"],
  ["shell", "run_command"],
  ["terminal", "run_command"],
  ["run_test", "run_verification"],
  ["run_tests", "run_verification"],
  ["test", "run_verification"],
  ["verify", "run_verification"],
  ["verification", "run_verification"],
]);
const MAX_PARALLEL_SAFE_TOOL_CALLS = 4;
const INITIAL_READ_ONLY_PROGRESS_GUARD_THRESHOLD = 6;
const MUTATION_RECOVERY_TOOL_NAMES = new Set([
  "append_file",
  "write_file",
  "edit_file",
  "replace_file_range",
  "python_execute",
  "run_command",
  "run_verification",
]);
const NON_WORKSPACE_MUTATION_TOOL_NAMES = new Set([
  "todo_write",
  "write_plan",
]);
const POTENTIALLY_MUTATING_EXEC_TOOL_NAMES = new Set([
  "python_execute",
  "run_command",
  "process_start",
]);
const PARALLEL_SAFE_TOOL_NAMES = new Set([
  "workspace_info",
  "git_status",
  "git_diff",
  "list_directory",
  "read_file",
  "read_plan",
  "list_tasks",
  "lsp_diagnostics",
  "notebook_read",
  "process_list",
  "process_read",
  "search_memory",
  "search_profile",
  "search_files",
  "search_learned_skills",
  "search_sessions",
  "search_text",
  "list_automations",
  "list_extension_resources",
]);

interface PreparedParallelToolCall {
  readonly requestedToolName: string;
  readonly resolved: ToolCallRequest;
  readonly assessment: ToolRiskAssessment;
  readonly resolvedLabel: string;
}

function canExecutePreparedToolCallsInParallel(preparedToolCalls: readonly PreparedParallelToolCall[]): boolean {
  return (
    preparedToolCalls.length > 1 &&
    preparedToolCalls.length <= MAX_PARALLEL_SAFE_TOOL_CALLS &&
    preparedToolCalls.every(
      (entry) =>
        PARALLEL_SAFE_TOOL_NAMES.has(entry.resolved.toolName) &&
        entry.assessment.approvalClass === "readonly_scoped" &&
        entry.assessment.riskTier === 0 &&
        !entry.assessment.mutating,
    )
  );
}

function mergeDistinctRecordsById<T extends { id: string }>(
  preferred: readonly T[],
  fallback: readonly T[],
  limit: number,
): T[] {
  if (limit <= 0) {
    return [];
  }
  const merged: T[] = [];
  const seenIds = new Set<string>();
  for (const record of [...preferred, ...fallback]) {
    if (seenIds.has(record.id)) {
      continue;
    }
    seenIds.add(record.id);
    merged.push(record);
    if (merged.length >= limit) {
      break;
    }
  }
  return merged;
}

export interface AgentRuntimeOptions {
  readonly approvalPolicy: ApprovalPolicy;
  readonly executionDomain: ExecutionDomain;
  readonly verificationMode: VerificationMode;
  readonly independentVerificationMode?: IndependentVerificationMode;
  readonly mutationCheckpointMode?: MutationCheckpointMode;
  readonly verificationFailureRollbackMode?: VerificationFailureRollbackMode;
  readonly toolPolicy?: RuntimeToolPolicy;
  readonly toolPolicyContext?: RuntimeToolPolicyContext;
  readonly roleRuntimeOverrides?: Partial<Record<AgentRole, AgentRoleRuntimeOverride>>;
  readonly contextEngineFactory?: ContextEngineFactory;
  readonly contextEngineConfig?: ContextEngineConfig;
  readonly memoryProviders?: readonly MemoryProvider[];
  readonly approvalHandler?: (request: ApprovalRequest) => Promise<ApprovalHandlerResult>;
  readonly approvalGrants?: ApprovalGrantStore;
  readonly eventHandler?: (event: AgentRuntimeEvent) => void | Promise<void>;
  readonly subagentRuntime?: SubagentRuntimeContext;
  readonly awaitExecutionPermit?: () => Promise<void>;
}

export interface ToolPolicyRule {
  readonly allowTools?: readonly string[];
  readonly denyTools?: readonly string[];
}

export interface RuntimeToolPolicyContext {
  readonly agentId?: string;
  readonly authProfileId?: string;
  readonly channelId?: string;
  readonly channelKey?: string;
  readonly channelType?: string;
  readonly executionDomain?: ExecutionDomain;
  readonly profileId?: string;
  readonly providerId?: string;
  readonly routeId?: string;
  readonly sessionId?: string;
  readonly threadId?: string;
}

export interface AgentRoleRuntimeOverride {
  readonly modelClient?: ModelClient;
  readonly toolPolicyContext?: RuntimeToolPolicyContext;
}

export interface RuntimeToolPolicy {
  readonly global?: ToolPolicyRule;
  readonly runtime?: ToolPolicyRule;
  readonly authProfiles?: Readonly<Record<string, ToolPolicyRule>>;
  readonly executionDomains?: Partial<Record<ExecutionDomain, ToolPolicyRule>>;
  readonly providers?: Readonly<Record<string, ToolPolicyRule>>;
  readonly profiles?: Readonly<Record<string, ToolPolicyRule>>;
  readonly sessions?: Readonly<Record<string, ToolPolicyRule>>;
  readonly routes?: Readonly<Record<string, ToolPolicyRule>>;
  readonly channels?: Readonly<Record<string, ToolPolicyRule>>;
  readonly agents?: Readonly<Record<string, ToolPolicyRule>>;
  readonly roles?: Partial<Record<AgentRole, ToolPolicyRule>>;
  readonly subagents?: Partial<Record<SubagentAuthority, ToolPolicyRule>>;
}

export interface RunTaskInput {
  readonly objective: string;
  readonly role?: AgentRole;
  readonly threadTitle?: string;
  readonly threadId?: string;
  readonly continueLatest?: boolean;
  readonly successCriteria?: string[];
  readonly constraints?: string[];
  readonly extraInstructions?: string[];
  readonly verificationCommands?: string[];
  readonly maxIterations?: number;
  readonly abortSignal?: AbortSignal;
}

export type IndependentVerificationMode = "disabled" | "on-mutation" | "required";
export type IndependentVerificationStatus = "error" | "failed" | "passed" | "skipped";
export type MutationCheckpointMode = "disabled" | "best-effort" | "required";
export type VerificationFailureRollbackMode = "disabled" | "final-failure";

interface RoleExecutionSemantics {
  readonly defaultMaxIterations: number;
  readonly verificationMode: VerificationMode;
  readonly independentVerificationMode: IndependentVerificationMode;
  readonly defaultSuccessCriteria: readonly string[];
  readonly extraConstraints: readonly string[];
}

export interface IndependentVerificationReport {
  readonly status: IndependentVerificationStatus;
  readonly summary: string;
  readonly verifierJobId?: string;
  readonly verifierThreadId?: string;
  readonly verifierRunId?: string;
  readonly verifierResponse?: string;
}

export interface AgentRunSummary {
  readonly workspace: WorkspaceRecord;
  readonly thread: ThreadRecord;
  readonly resumedThread: boolean;
  readonly run: RunRecord;
  readonly executionDomain: ExecutionDomain;
  readonly sourceRoot: string;
  readonly executionRoot: string;
  readonly worktreePath: string | null;
  readonly worktreeBranch: string | null;
  readonly sandboxPath: string | null;
  readonly userMessage: MessageRecord;
  readonly assistantMessage: MessageRecord;
  readonly workspaceSnapshot: WorkspaceSnapshot;
  readonly verification: VerificationAssessment;
  readonly independentVerification: IndependentVerificationReport | null;
  readonly diffSummary: GitDiffSummary | null;
  readonly changedFiles: string[];
  readonly toolEvents: ToolEventRecord[];
  readonly artifacts: ArtifactRecord[];
  readonly blockedApprovals: string[];
  readonly contextEngineStatus: ContextEngineStatus;
  readonly runMetrics: RunMetricsRecord | null;
  readonly threadUsage: ThreadUsageSummary | null;
  readonly finalResponse: string;
}

export interface AgentRuntimeEvent {
  readonly type:
    | "run.started"
    | "subagent.progress"
    | "tool.hook"
    | "tool.started"
    | "tool.blocked"
    | "tool.completed"
    | "tool.failed"
    | "verification.completed"
    | "run.completed";
  readonly at: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly payload?: unknown;
  readonly presentation?: ToolPresentation;
}

function createApprovalEventPayload(input: {
  readonly args: unknown;
  readonly assessment: ToolRiskAssessment;
  readonly decision?: string;
  readonly reason?: string;
  readonly hookBlock?: { readonly extensionId: string; readonly summary: string };
  readonly blockKind?: "approval_policy" | "hook_blocked" | "runtime_checkpoint";
}): Record<string, unknown> {
  return {
    blockKind: input.blockKind ?? (input.hookBlock ? "hook_blocked" : "approval_policy"),
    args: input.args,
    approvalClass: input.assessment.approvalClass,
    riskTier: input.assessment.riskTier,
    mutating: input.assessment.mutating,
    decision: input.decision,
    reason: input.reason ?? input.assessment.reason,
    hookBlock: input.hookBlock,
  };
}

function createToolInterruptEventPayload(interrupt: ToolInterruptRequest, data: unknown): Record<string, unknown> {
  return {
    blockKind: "user_input_required",
    interruptKind: interrupt.kind,
    questionId: interrupt.questionId,
    question: interrupt.question,
    context: interrupt.context ?? null,
    suggestedResponses: interrupt.suggestedResponses ?? [],
    data,
  };
}

class SubagentAbortError extends Error {
  public constructor(
    public readonly kind: "cancelled" | "interrupted" | "timed_out",
    message: string,
  ) {
    super(message);
    this.name = "SubagentAbortError";
  }
}

const SUBAGENT_CONTROL_TOOL_NAMES = new Set([
  "cancel_subagent",
  "interrupt_subagent",
  "list_subagents",
  "message_subagent",
  "pause_subagent",
  "resume_subagent",
  "run_swarm",
  "spawn_subagent",
  "wait_any_subagent",
  "wait_subagent",
]);

const DEFAULT_SUBAGENT_MAX_CONCURRENCY = 2;
const DEFAULT_SUBAGENT_MAX_DEPTH = 2;
const DEFAULT_SUBAGENT_POLL_DELAY_MS = 125;

const activeSubagentControllers = new Map<string, SubagentController>();

interface SubagentOrchestrationState {
  readonly jobs: Map<string, SubagentJobRecord>;
  readonly queuedJobIds: string[];
  readonly activeJobIds: Set<string>;
  readonly pendingLaunches: Map<string, () => void>;
  readonly maxConcurrent: number;
  readonly maxDepth: number;
}

interface SubagentRuntimeContext {
  readonly currentJobId: string | null;
  readonly currentDepth: number;
  readonly rootJobId: string | null;
  readonly orchestration: SubagentOrchestrationState;
}

function createRootSubagentRuntimeContext(): SubagentRuntimeContext {
  return {
    currentJobId: null,
    currentDepth: 0,
    rootJobId: null,
    orchestration: {
      jobs: new Map<string, SubagentJobRecord>(),
      queuedJobIds: [],
      activeJobIds: new Set<string>(),
      pendingLaunches: new Map<string, () => void>(),
      maxConcurrent: DEFAULT_SUBAGENT_MAX_CONCURRENCY,
      maxDepth: DEFAULT_SUBAGENT_MAX_DEPTH,
    },
  };
}

function buildRoleConstraints(role: AgentRole): string[] {
  return getAgentRoleContract(role).guidance;
}

function mergeUniqueStrings(...groups: Array<readonly string[] | undefined>): string[] {
  return Array.from(
    new Set(
      groups
        .flatMap((group) => group ?? [])
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function resolveSubagentAuthority(request: SubagentExecutionRequest): SubagentAuthority {
  if (request.authority) {
    return request.authority;
  }
  const normalizedRole = normalizeAgentRole(request.role);
  return getAgentRoleContract(normalizedRole).defaultAuthority;
}

function resolveSubagentBudget(request: SubagentExecutionRequest, authority: SubagentAuthority): SubagentBudget {
  const roleSemantics = resolveRoleExecutionSemantics(normalizeAgentRole(request.role), undefined, undefined);
  const defaultMaxIterations = authority === "orchestrator"
    ? Math.min(6, roleSemantics.defaultMaxIterations)
    : Math.min(4, roleSemantics.defaultMaxIterations);
  return {
    maxIterations: Math.max(1, request.maxIterations ?? defaultMaxIterations),
    timeoutMs: Math.max(1_000, request.timeoutMs ?? 300_000),
    maxRetries: Math.max(0, request.maxRetries ?? 0),
  };
}

function resolveAllowedSubagentTools(
  requested: readonly string[] | undefined,
  toolRegistry: ToolRegistry,
  authority: SubagentAuthority,
  extensionRegistry: ExtensionRegistry,
  runtimePolicy: RuntimeToolPolicy | undefined,
  policyContext: RuntimeToolPolicyContext | undefined,
  role?: string,
): { readonly toolNames: string[]; readonly trace: string[] } {
  return resolveToolPolicy({
    availableToolNames: toolRegistry.listSpecs().map((entry) => entry.name),
    role: normalizeAgentRole(role),
    extensionRegistry,
    runtimePolicy,
    policyContext,
    authority,
    requestedTools: requested,
  });
}

export function describeEffectiveToolPolicy(input: {
  readonly toolRegistry: ToolRegistry;
  readonly extensionRegistry: ExtensionRegistry;
  readonly runtimePolicy?: RuntimeToolPolicy;
  readonly policyContext?: RuntimeToolPolicyContext;
  readonly authority?: SubagentAuthority;
  readonly requestedTools?: readonly string[];
  readonly role?: string;
}): { readonly toolNames: string[]; readonly trace: string[] } {
  return resolveToolPolicy({
    availableToolNames: input.toolRegistry.listSpecs().map((entry) => entry.name),
    role: normalizeAgentRole(input.role),
    extensionRegistry: input.extensionRegistry,
    runtimePolicy: input.runtimePolicy,
    policyContext: input.policyContext,
    authority: input.authority,
    requestedTools: input.requestedTools,
  });
}

function resolveAvailableToolSpecsForRole(
  availableTools: ReturnType<ToolRegistry["listSpecs"]>,
  role: AgentRole,
  extensionRegistry: ExtensionRegistry,
  runtimePolicy: RuntimeToolPolicy | undefined,
  policyContext: RuntimeToolPolicyContext | undefined,
): ReturnType<ToolRegistry["listSpecs"]> {
  const resolved = resolveToolPolicy({
    availableToolNames: availableTools.map((tool) => tool.name),
    role,
    extensionRegistry,
    runtimePolicy,
    policyContext,
  });
  const allowlist = new Set(resolved.toolNames);
  return availableTools.filter((tool) => allowlist.has(tool.name));
}

function resolveRoleExecutionSemantics(
  role: AgentRole,
  configuredVerificationMode: VerificationMode | undefined,
  configuredIndependentVerificationMode: IndependentVerificationMode | undefined,
): RoleExecutionSemantics {
  const defaultVerificationMode = configuredVerificationMode ?? "required";
  const defaultIndependentVerificationMode = configuredIndependentVerificationMode ??
    (getAgentRoleContract(role).canEditFiles ? "on-mutation" : "disabled");
  switch (role) {
    case "planner":
      return {
        defaultMaxIterations: 4,
        verificationMode: "best-effort",
        independentVerificationMode: "disabled",
        defaultSuccessCriteria: ["Return a structured plan with the smallest useful execution steps."],
        extraConstraints: ["Prefer decomposition and dispatch over direct execution."],
      };
    case "supervisor":
      return {
        defaultMaxIterations: 5,
        verificationMode: "best-effort",
        independentVerificationMode: "disabled",
        defaultSuccessCriteria: ["Return a structured dispatch plan that keeps child work coherent."],
        extraConstraints: ["Coordinate child work instead of performing direct edits unless no delegation is needed."],
      };
    case "researcher":
      return {
        defaultMaxIterations: 4,
        verificationMode: "best-effort",
        independentVerificationMode: "disabled",
        defaultSuccessCriteria: ["Return structured findings with concrete evidence from the workspace."],
        extraConstraints: ["Stay read-only and prioritize evidence collection over proposing edits."],
      };
    case "reviewer":
      return {
        defaultMaxIterations: 3,
        verificationMode: "best-effort",
        independentVerificationMode: "disabled",
        defaultSuccessCriteria: ["Return a structured review with concrete findings and supporting evidence."],
        extraConstraints: ["Stay read-only and avoid speculative changes without direct evidence."],
      };
    case "verifier":
      return {
        defaultMaxIterations: 3,
        verificationMode: "required",
        independentVerificationMode: "disabled",
        defaultSuccessCriteria: ["Return a structured verification verdict backed by execution or inspection evidence."],
        extraConstraints: ["Stay read-only and base the verdict on direct verification evidence."],
      };
    case "worker":
    case "executor":
      return {
        defaultMaxIterations: 8,
        verificationMode: defaultVerificationMode,
        independentVerificationMode: defaultIndependentVerificationMode,
        defaultSuccessCriteria: ["Deliver a verified code change or explain why no code change was made."],
        extraConstraints: [],
      };
    default:
      return {
        defaultMaxIterations: 8,
        verificationMode: defaultVerificationMode,
        independentVerificationMode: defaultIndependentVerificationMode,
        defaultSuccessCriteria: ["Deliver a verified code change or explain why no code change was made."],
        extraConstraints: [],
      };
  }
}

function resolveToolPolicy(input: {
  readonly availableToolNames: readonly string[];
  readonly role: AgentRole;
  readonly extensionRegistry: ExtensionRegistry;
  readonly runtimePolicy?: RuntimeToolPolicy;
  readonly policyContext?: RuntimeToolPolicyContext;
  readonly authority?: SubagentAuthority;
  readonly requestedTools?: readonly string[];
}): { readonly toolNames: string[]; readonly trace: string[] } {
  const available = new Set(input.availableToolNames.map((entry) => entry.trim()).filter(Boolean));
  const trace = [`base: ${available.size} available tool(s)`];
  let current = new Set(available);
  current = applyToolPolicyRule(current, available, input.runtimePolicy?.global, "global", trace);
  current = applyToolPolicyRule(current, available, input.runtimePolicy?.runtime, "runtime", trace);
  if (input.policyContext?.executionDomain) {
    current = applyToolPolicyRule(
      current,
      available,
      input.runtimePolicy?.executionDomains?.[input.policyContext.executionDomain],
      `execution-domain:${input.policyContext.executionDomain}`,
      trace,
    );
  }
  if (input.policyContext?.sessionId) {
    current = applyToolPolicyRule(
      current,
      available,
      input.runtimePolicy?.sessions?.[input.policyContext.sessionId],
      `session:${input.policyContext.sessionId}`,
      trace,
    );
  }
  if (input.policyContext?.routeId) {
    current = applyToolPolicyRule(
      current,
      available,
      input.runtimePolicy?.routes?.[input.policyContext.routeId],
      `route:${input.policyContext.routeId}`,
      trace,
    );
  }
  for (const channelKey of resolveToolPolicyChannelKeys(input.policyContext)) {
    current = applyToolPolicyRule(
      current,
      available,
      input.runtimePolicy?.channels?.[channelKey],
      `channel:${channelKey}`,
      trace,
    );
  }
  if (input.policyContext?.providerId) {
    current = applyToolPolicyRule(
      current,
      available,
      input.runtimePolicy?.providers?.[input.policyContext.providerId],
      `provider:${input.policyContext.providerId}`,
      trace,
    );
  }
  if (input.policyContext?.authProfileId) {
    current = applyToolPolicyRule(
      current,
      available,
      input.runtimePolicy?.authProfiles?.[input.policyContext.authProfileId],
      `auth-profile:${input.policyContext.authProfileId}`,
      trace,
    );
  }
  if (input.policyContext?.profileId) {
    current = applyToolPolicyRule(
      current,
      available,
      input.runtimePolicy?.profiles?.[input.policyContext.profileId],
      `profile:${input.policyContext.profileId}`,
      trace,
    );
  }
  if (input.policyContext?.agentId) {
    current = applyToolPolicyRule(
      current,
      available,
      input.runtimePolicy?.agents?.[input.policyContext.agentId],
      `agent:${input.policyContext.agentId}`,
      trace,
    );
  }

  const contractAllowlist = getAgentRoleContract(input.role).defaultAllowedTools;
  const shouldApplyDefaultRoleAllowlist =
    !input.authority || !input.requestedTools || input.requestedTools.length === 0;
  if (shouldApplyDefaultRoleAllowlist && contractAllowlist && contractAllowlist.length > 0) {
    current = applyToolPolicyRule(
      current,
      available,
      { allowTools: contractAllowlist },
      `role-contract:${input.role}`,
      trace,
    );
  }
  current = applyToolPolicyRule(current, available, input.runtimePolicy?.roles?.[input.role], `role:${input.role}`, trace);

  if (input.authority === "leaf") {
    current = applyToolPolicyRule(
      current,
      available,
      { denyTools: [...SUBAGENT_CONTROL_TOOL_NAMES] },
      "subagent:leaf-control-plane",
      trace,
    );
  }
  if (input.authority) {
    current = applyToolPolicyRule(
      current,
      available,
      input.runtimePolicy?.subagents?.[input.authority],
      `subagent:${input.authority}`,
      trace,
    );
  }
  if (input.requestedTools && input.requestedTools.length > 0) {
    current = applyToolPolicyRule(
      current,
      available,
      { allowTools: input.requestedTools },
      "subagent-request",
      trace,
    );
  }

  for (const toolName of Array.from(current)) {
    if (!input.extensionRegistry.ownsTool(toolName)) {
      continue;
    }
    const policy = input.extensionRegistry.getToolPolicy(toolName);
    if (input.authority && !policy?.allowInSubagents) {
      current.delete(toolName);
      trace.push(`extension:${toolName} denied because subagent inheritance is not explicitly allowed`);
      continue;
    }
    if (policy?.allowedRoles && !policy.allowedRoles.includes(input.role)) {
      current.delete(toolName);
      trace.push(`extension:${toolName} denied for role ${input.role}`);
      continue;
    }
    if (policy?.deniedRoles?.includes(input.role)) {
      current.delete(toolName);
      trace.push(`extension:${toolName} denied by role blocklist`);
      continue;
    }
    if (input.authority && policy?.allowedAuthorities && !policy.allowedAuthorities.includes(input.authority)) {
      current.delete(toolName);
      trace.push(`extension:${toolName} denied for authority ${input.authority}`);
    }
  }

  if (current.size === 0) {
    throw new Error(`Tool policy resolved to an empty set. Trace: ${trace.join(" | ")}`);
  }
  trace.push(`final: ${current.size} allowed tool(s)`);
  return {
    toolNames: Array.from(current).sort((left, right) => left.localeCompare(right)),
    trace,
  };
}

function applyToolPolicyRule(
  current: Set<string>,
  available: Set<string>,
  rule: ToolPolicyRule | undefined,
  label: string,
  trace: string[],
): Set<string> {
  let next = new Set(current);
  const allowTools = expandPolicyToolSelectors(normalizePolicyToolNames(rule?.allowTools), available);
  if (allowTools.length > 0) {
    const allowlist = new Set(allowTools);
    next = new Set(Array.from(next).filter((toolName) => allowlist.has(toolName)));
    trace.push(`${label}: allow ${allowTools.length} tool(s)`);
  }
  const denyTools = expandPolicyToolSelectors(normalizePolicyToolNames(rule?.denyTools), available);
  if (denyTools.length > 0) {
    for (const toolName of denyTools) {
      next.delete(toolName);
    }
    trace.push(`${label}: deny ${denyTools.length} tool(s)`);
  }
  return next;
}

function normalizePolicyToolNames(values: readonly string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  return Array.from(new Set(values.map((entry) => entry.trim()).filter(Boolean)));
}

function expandPolicyToolSelectors(selectors: readonly string[], available: Set<string>): string[] {
  const expanded = new Set<string>();
  for (const selector of selectors) {
    if (available.has(selector)) {
      expanded.add(selector);
      continue;
    }
    const prefix = resolvePolicyToolSelectorPrefix(selector);
    if (!prefix) {
      continue;
    }
    for (const toolName of available) {
      if (toolName.startsWith(prefix)) {
        expanded.add(toolName);
      }
    }
  }
  return Array.from(expanded).sort((left, right) => left.localeCompare(right));
}

function resolvePolicyToolSelectorPrefix(selector: string): string | null {
  if (selector.endsWith("*")) {
    return selector.slice(0, -1);
  }
  if (/^mcp__[^_].+$/.test(selector) && !selector.slice("mcp__".length).includes("__")) {
    return `${selector}__`;
  }
  return null;
}

function resolveRuntimeToolPolicyContext(input: {
  readonly base?: RuntimeToolPolicyContext;
  readonly executionDomain: ExecutionDomain;
  readonly threadId: string;
  readonly sessionId?: string | null;
}): RuntimeToolPolicyContext {
  return {
    ...input.base,
    executionDomain: input.executionDomain,
    threadId: input.threadId,
    sessionId: input.sessionId?.trim() || input.base?.sessionId || input.threadId,
  };
}

function resolveToolPolicyChannelKeys(context: RuntimeToolPolicyContext | undefined): string[] {
  if (!context) {
    return [];
  }
  const keys = new Set<string>();
  const typedChannelKey =
    context.channelType && context.channelKey
      ? `${context.channelType.trim()}:${context.channelKey.trim()}`
      : "";
  for (const value of [context.channelId, typedChannelKey, context.channelKey]) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized) {
      keys.add(normalized);
    }
  }
  return Array.from(keys);
}

function resolveRoleRuntimeOverride(
  role: AgentRole,
  options: AgentRuntimeOptions,
): AgentRoleRuntimeOverride | undefined {
  return options.roleRuntimeOverrides?.[role];
}

export class AgentRuntime {
  public constructor(
    private readonly sessionStore: SqliteSessionStore,
    private readonly workspace: LocalWorkspaceService,
    private readonly toolRegistry: ToolRegistry,
    private readonly modelClient: ModelClient,
    private readonly extensionRegistry: ExtensionRegistry,
    private readonly options: AgentRuntimeOptions,
  ) {
    if (this.extensionRegistry.list().length > 0) {
      this.toolRegistry.registerMany(this.extensionRegistry.listToolDefinitions());
      this.toolRegistry.registerMany(createExtensionRuntimeTools(this.extensionRegistry));
    }
  }

  public async runTask(input: RunTaskInput): Promise<AgentRunSummary> {
    this.sessionStore.initialize();
    await this.workspace.ensureReady();

    const workspaceRecord = this.sessionStore.upsertWorkspace(this.workspace.root);
    const { thread: threadRecord, resumedThread } = this.resolveThread(workspaceRecord, input);
    const runRecord = this.sessionStore.createRun({
      threadId: threadRecord.id,
      agentId: this.options.toolPolicyContext?.agentId ?? null,
      objective: input.objective,
      executionDomain: this.options.executionDomain,
    });
    const execution = await this.prepareExecutionWorkspace(runRecord, threadRecord);
    this.sessionStore.updateRunExecutionContext({
      runId: runRecord.id,
      sourceRoot: execution.sourceRoot,
      executionRoot: execution.executionRoot,
      worktreePath: execution.worktreePath,
      worktreeBranch: execution.worktreeBranch,
      sandboxPath: execution.sandboxPath,
    });
    await this.emitEvent({
      type: "run.started",
      at: new Date().toISOString(),
      workspaceId: workspaceRecord.id,
      threadId: threadRecord.id,
      runId: runRecord.id,
      status: "running",
      summary: input.objective,
      payload: {
        executionDomain: execution.executionDomain,
        executionRoot: execution.executionRoot,
      },
    });

    const userMessage = this.sessionStore.appendMessage({
      threadId: threadRecord.id,
      runId: runRecord.id,
      role: "user",
      text: input.objective,
    });

    const workspaceSnapshot = await execution.workspace.inspect();
    let workspaceInstructions = await execution.workspace.loadInstructionFiles();
    const knownWorkspaceInstructionPathKeys = new Set(
      workspaceInstructions.map((entry) => normalizeInstructionPathKey(entry.path)),
    );
    const threadMessages = this.sessionStore
      .listThreadMessages(threadRecord.id, 40)
      .map<ThreadMessage>((message) => ({
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
      }));
    const threadSummaryRecord = this.sessionStore.getThreadSummary(threadRecord.id);
    let sessionMemories: MemoryRecord[] = [];
    let workspaceMemories: MemoryRecord[] = [];
    let workspaceMemoryFiles = await execution.workspace.loadMemoryFiles();
    const knownWorkspaceMemoryPathKeys = new Set(workspaceMemoryFiles.map((entry) => normalizeWorkspacePathKey(entry.path)));
    let workspaceSkillFiles = await execution.workspace.loadSkillFiles({
      query: input.objective,
      maxFiles: 4,
    });
    let profileFacts: ProfileFactRecord[] = [];
    let learnedSkills: LearnedSkillRecord[] = [];
    const recalledLearnedSkillIds = new Set<string>();
    let relatedSessions: SessionSearchResult[] = [];
    const promptHookInstructions = await this.extensionRegistry.buildPromptInstructions({
      cwd: execution.executionRoot,
      objective: input.objective,
      workspaceId: workspaceRecord.id,
      threadId: threadRecord.id,
    });

      const agentRole = normalizeAgentRole(input.role);
      const rolePlaybooks = agentRole === "primary"
        ? []
        : prioritizeInjectedPlaybooks(
            agentRole,
            findRelevantAgentPlaybooks({
              query: input.objective,
              role: agentRole,
              limit: 4,
            }),
          ).slice(0, 2);
      const roleExecutionSemantics = resolveRoleExecutionSemantics(
        agentRole,
        this.options.verificationMode,
        this.options.independentVerificationMode,
      );
      const roleRuntimeOverride = resolveRoleRuntimeOverride(agentRole, this.options);
      const turnModelClient = roleRuntimeOverride?.modelClient ?? this.modelClient;
      const taskContract: TaskContract = {
        objective: input.objective,
        agentRole,
        workspaceId: workspaceRecord.id,
        threadId: threadRecord.id,
        cwd: execution.executionRoot,
        successCriteria: input.successCriteria ?? [...roleExecutionSemantics.defaultSuccessCriteria],
        constraints: mergeUniqueStrings(
          ["Prefer the smallest safe action.", "Keep all side effects observable."],
          roleExecutionSemantics.extraConstraints,
          buildRoleConstraints(agentRole),
          input.constraints,
        ),
        verificationMode: roleExecutionSemantics.verificationMode,
        preferredExecutionDomain: execution.executionDomain,
      };

    let extraInstructions = mergeUniqueStrings(
      input.extraInstructions,
      buildExtraInstructions(
        input.objective,
        agentRole,
        this.extensionRegistry.list().map((entry) => entry.id),
        sessionMemories,
        workspaceMemories,
        workspaceMemoryFiles,
        workspaceSkillFiles,
        rolePlaybooks,
        profileFacts,
        learnedSkills,
        relatedSessions,
        promptHookInstructions,
      ),
    );
    const toolPolicyContext = resolveRuntimeToolPolicyContext({
      base: {
        ...(this.options.toolPolicyContext ?? {}),
        ...(roleRuntimeOverride?.toolPolicyContext ?? {}),
      },
      executionDomain: execution.executionDomain,
      threadId: threadRecord.id,
    });
    const resolvedToolPolicy = describeEffectiveToolPolicy({
      toolRegistry: this.toolRegistry,
      extensionRegistry: this.extensionRegistry,
      runtimePolicy: this.options.toolPolicy,
      policyContext: toolPolicyContext,
      role: agentRole,
    });
    const availableToolNames = resolvedToolPolicy.toolNames;
    const availableTools = this.toolRegistry
      .listSpecs()
      .filter((toolSpec) => availableToolNames.includes(toolSpec.name));
    const toolObservations: ToolObservation[] = [];
    const buildToolResultsForModel = (): ToolObservation[] => compactToolObservationsForModel(toolObservations);
    const configuredMemoryProviders = [...(this.options.memoryProviders ?? [])];
    if (!configuredMemoryProviders.some((provider) => provider.id === "builtin-sqlite-memory-provider")) {
      configuredMemoryProviders.push(new BuiltinSqliteMemoryProvider());
    }
    const memoryProviderCoordinator = new MemoryProviderCoordinator(configuredMemoryProviders);
    const toolEvents: ToolEventRecord[] = [];
    const artifacts: ArtifactRecord[] = [];
    const persistToolOutput = (toolName: string, result: ToolResult): PersistedToolOutput => {
      const output = buildPersistedToolOutput({
        toolName,
        result,
        addArtifact: (content, summary) => {
          const artifact = this.sessionStore.addArtifactContent({
            runId: runRecord.id,
            kind: `${toolName}-output`,
            content,
            summary,
            extension: "json",
          });
          artifacts.push(artifact);
          return artifact;
        },
      });
      return output;
    };
    const blockedApprovals: string[] = [];
    const changedFiles = new Set<string>(workspaceSnapshot.changedFiles);
    const subagentRuntime = this.options.subagentRuntime ?? createRootSubagentRuntimeContext();
    const subagentController = new LocalSubagentController({
      sessionStore: this.sessionStore,
      workspaceRecord,
      parentThreadId: threadRecord.id,
      parentRunId: runRecord.id,
      baseWorkspace: execution.workspace,
      toolRegistry: this.toolRegistry,
      modelClient: this.modelClient,
      extensionRegistry: this.extensionRegistry,
      memoryProviderCoordinator,
      parentOptions: this.options,
      subagentRuntime,
      prepareContextHandoff: (_request, job) =>
        contextEngine.prepareSubagentSpawn({
          objective: job.objective,
          role: job.role,
          depth: job.depth,
          maxDepth: job.maxDepth,
          parentJobId: job.parentJobId ?? null,
          rootJobId: job.rootJobId,
        }),
      onSubagentSettled: async (job) => {
        if (job.outcomeVisibility === "artifacts_only") {
          return;
        }
        const finalResponse =
          job.outcomeVisibility === "summary_only"
            ? buildSummaryOnlySubagentOutcome(job)
            : job.finalResponse ?? job.completion?.finalResponse ?? null;
        context = contextEngine.onSubagentEnded({
          objective: job.objective,
          role: job.role ?? null,
          status: job.status,
          verificationStatus: job.completion?.verificationStatus ?? null,
          changedFiles: job.completion?.changedFiles ?? [],
          finalResponse,
          error: job.error ?? job.completion?.error ?? null,
        });
      },
      eventHandler: this.options.eventHandler,
    });
    let assistantText = "No assistant response was produced.";
    let mutatingToolSucceeded = false;
    let failedToolCount = 0;
    let mutationRevision = 0;
    let verifiedRevision = -1;
    let verificationExecution: VerificationExecutionResult | null = null;
    let independentVerification: IndependentVerificationReport | null = null;
    let turnCount = 0;
    let toolCallCount = 0;
    let toolSuccessCount = 0;
    let toolFailureCount = 0;
    let blockedApprovalCount = 0;
    let recentFailureReason: string | null = null;
    let activeFailureReason: string | null = null;
    let activeBlockReason: string | null = null;
    let interruptedRequest: ToolInterruptRequest | null = null;
    let successfulReadOnlyActionCount = 0;
    let nextReadOnlyProgressGuardAt = INITIAL_READ_ONLY_PROGRESS_GUARD_THRESHOLD;
    let mutationRecoveryToolsOnly = false;
    const modelProfilesUsed = new Set<string>();
    const usageTotals = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      hasInputTokens: false,
      hasOutputTokens: false,
      hasTotalTokens: false,
    };
    let finalWorkspaceSnapshot = workspaceSnapshot;
    let diffSummary: GitDiffSummary | null = null;
    const configuredMaxIterations = Math.max(1, input.maxIterations ?? roleExecutionSemantics.defaultMaxIterations);
    let maxIterations = configuredMaxIterations;
    const maxRecoveryIterations = configuredMaxIterations + 2;
    const independentVerificationMode = roleExecutionSemantics.independentVerificationMode;
    const mutationCheckpointMode = this.options.mutationCheckpointMode ?? "disabled";
    const verificationFailureRollbackMode = this.options.verificationFailureRollbackMode ?? "disabled";
    let mutationCheckpoint: WorkspaceCheckpointRecord | null = null;
    const buildMemorySessionContext = (): MemoryProviderSessionContext => ({
      sessionStore: this.sessionStore,
      workspace: execution.workspace,
      workspaceRecord,
      threadRecord,
        runId: runRecord.id,
        agentId: runRecord.agentId,
        objective: input.objective,
        verificationMode: roleExecutionSemantics.verificationMode,
        agentRole,
      });
    const buildMemoryProviderContext = (query: string, snapshot: WorkspaceSnapshot): MemoryProviderContext => ({
      ...buildMemorySessionContext(),
      query,
      assistantText,
      toolObservations,
      workspaceSnapshot: snapshot,
      loadedWorkspaceMemoryFiles: workspaceMemoryFiles,
    });
    const runAbortSignal = input.abortSignal;
    const throwIfAborted = (): void => {
      if (!runAbortSignal?.aborted) {
        return;
      }
      const reason = runAbortSignal.reason;
      if (reason instanceof Error) {
        throw reason;
      }
      throw new Error(typeof reason === "string" && reason.trim().length > 0 ? reason : "Run aborted.");
    };
    const awaitExecutionPermit = async (): Promise<void> => {
      await this.options.awaitExecutionPermit?.();
      throwIfAborted();
    };
    const hasExplicitVerificationCommands = (input.verificationCommands?.length ?? 0) > 0;
    const verificationPlan =
      hasExplicitVerificationCommands
        ? {
            mode: "task-specified" as const,
            commands: input.verificationCommands ?? [],
            summary: `Task-specified verification commands: ${(input.verificationCommands ?? []).join(" -> ")}`,
          }
        : inferVerificationPlan(workspaceSnapshot);
    const contextEngine = createContextEngine({
      taskContract,
      workspaceSnapshot,
      threadMessages,
      previousThreadSummary: threadSummaryRecord?.summary ?? null,
      workspaceInstructions,
      extraInstructions,
      taskState: derivePromptTaskState({
        taskContract,
        toolObservations,
        verificationPlan,
        verificationExecution,
        recentFailureReason,
        activeFailureReason,
        activeBlockReason,
        mutatingToolSucceeded,
        turnCount,
        allowToolCalls: true,
      }),
      config: this.options.contextEngineConfig,
    }, this.options.contextEngineFactory);
    const buildRuntimeExtraInstructions = (): string[] => {
      const runtimeInstructions: string[] = [];
      const currentSubagentJob = subagentRuntime.currentJobId ? subagentController.get(subagentRuntime.currentJobId) : null;
      if (currentSubagentJob && currentSubagentJob.messages.length > 0) {
        runtimeInstructions.push(formatSubagentMailboxInstructions(currentSubagentJob.messages));
      }
      return [...runtimeInstructions, ...extraInstructions];
    };
    let context = contextEngine.afterTurn({
      workspaceSnapshot,
      workspaceInstructions,
      extraInstructions: buildRuntimeExtraInstructions(),
      taskState: derivePromptTaskState({
        taskContract,
        toolObservations,
        verificationPlan,
        verificationExecution,
        recentFailureReason,
        activeFailureReason,
        activeBlockReason,
        mutatingToolSucceeded,
        turnCount,
        allowToolCalls: true,
      }),
    });
    const rebuildContext = (
      snapshot: WorkspaceSnapshot,
      allowToolCalls = true,
      lifecycle: "afterTurn" | "compact" | "ingest" = "afterTurn",
    ): void => {
      const update = {
        workspaceSnapshot: snapshot,
        workspaceInstructions,
        extraInstructions: buildRuntimeExtraInstructions(),
        taskState: derivePromptTaskState({
          taskContract,
          toolObservations,
          verificationPlan,
          verificationExecution,
          recentFailureReason,
          activeFailureReason,
          activeBlockReason,
          mutatingToolSucceeded,
          turnCount,
          allowToolCalls,
        }),
      };
      context =
        lifecycle === "compact"
          ? contextEngine.compact(update)
          : lifecycle === "ingest"
            ? contextEngine.ingest(update)
            : contextEngine.afterTurn(update);
    };
    const pendingAutomaticMemories: AutomaticMemoryEntry[] = [];
    const automaticMemoryKeys = new Set<string>();
    const persistAutomaticMemory = (input: {
      readonly scope: "thread" | "workspace";
      readonly content: string;
      readonly tags: string[];
    }): void => {
      const normalizedContent = trimForModel(redactSensitiveText(input.content).replace(/\s+/g, " ").trim(), 600);
      if (normalizedContent.length < 24) {
        return;
      }
      const normalizedTags = Array.from(new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))).sort();
      const key = `${input.scope}:${normalizedTags.join(",")}:${normalizedContent}`;
      if (automaticMemoryKeys.has(key)) {
        return;
      }
      automaticMemoryKeys.add(key);
      pendingAutomaticMemories.push({
        scope: input.scope,
        content: normalizedContent,
        tags: normalizedTags,
      });
    };
    const touchLearnedSkills = (skills: LearnedSkillRecord[]): void => {
      for (const skill of skills) {
        if (recalledLearnedSkillIds.has(skill.id)) {
          continue;
        }
        this.sessionStore.touchLearnedSkill(skill.id);
        recalledLearnedSkillIds.add(skill.id);
      }
    };
    const buildMemoryRecallQuery = (seed?: string): string => {
      const recentToolSummaries = toolObservations
        .slice(-3)
        .map((observation) => `${observation.toolName}: ${observation.summary}`);
      return trimForModel(
        [
          input.objective,
          seed ?? null,
          assistantText !== "No assistant response was produced." ? assistantText : null,
          recentFailureReason,
          activeFailureReason,
          activeBlockReason,
          ...recentToolSummaries,
        ]
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .join(" "),
        480,
      );
    };
    const queueMemoryPrefetch = (query = buildMemoryRecallQuery(), snapshot = finalWorkspaceSnapshot): void => {
      const recallQuery = query.trim() || input.objective;
      memoryProviderCoordinator.queuePrefetch(buildMemoryProviderContext(recallQuery, snapshot));
    };
    const refreshMemoryRecall = async (
      query = buildMemoryRecallQuery(),
      phase: "onPreCompress" | "onTurnStart" = "onTurnStart",
      snapshot = finalWorkspaceSnapshot,
    ): Promise<void> => {
      const recallQuery = query.trim() || input.objective;
      const providerContext = buildMemoryProviderContext(recallQuery, snapshot);
      const bundle =
        phase === "onPreCompress"
          ? await memoryProviderCoordinator.onPreCompress(providerContext)
          : await memoryProviderCoordinator.onTurnStart(providerContext);
      sessionMemories = bundle.sessionMemories;
      workspaceMemories = bundle.workspaceMemories;
      profileFacts = bundle.profileFacts;
      learnedSkills = bundle.learnedSkills;
      workspaceSkillFiles = await execution.workspace.loadSkillFiles({
        query: buildUnifiedSkillRecallQuery(input.objective, agentRole, learnedSkills),
        maxFiles: 4,
      });
      workspaceMemoryFiles = bundle.workspaceMemoryFiles;
      touchLearnedSkills(learnedSkills);
      relatedSessions = bundle.relatedSessions;
      extraInstructions = mergeUniqueStrings(
        input.extraInstructions,
        buildExtraInstructions(
          input.objective,
          agentRole,
          this.extensionRegistry.list().map((entry) => entry.id),
          sessionMemories,
          workspaceMemories,
          workspaceMemoryFiles,
          workspaceSkillFiles,
          rolePlaybooks,
          profileFacts,
          learnedSkills,
          relatedSessions,
          promptHookInstructions,
        ),
      );
    };
    const syncMemoryTurn = async (
      query = buildMemoryRecallQuery(),
      snapshot = finalWorkspaceSnapshot,
    ): Promise<void> => {
      const recallQuery = query.trim() || input.objective;
      const providerContext: MemoryTurnSyncContext = {
        ...buildMemoryProviderContext(recallQuery, snapshot),
        turnNumber: turnCount,
        automaticMemories: pendingAutomaticMemories.splice(0),
      };
      await memoryProviderCoordinator.syncTurn(providerContext);
    };
    const notifyMemoryProviderWrite = async (
      toolName: string,
      args: Record<string, unknown>,
      result: ToolResult,
    ): Promise<void> => {
      const context = buildMemoryWriteContext({
        baseContext: buildMemorySessionContext(),
        toolName,
        args,
        result,
      });
      if (!context) {
        return;
      }
      await memoryProviderCoordinator.onMemoryWrite(context);
    };
    const emitToolLifecycleHookDiagnostics = async (input: {
      readonly toolCallId?: string;
      readonly phase: ToolLifecycleHookPhase;
      readonly toolName: string;
      readonly args: Record<string, unknown>;
      readonly status: ToolLifecycleHookStatus;
      readonly summary?: string;
      readonly result?: ToolResult;
      readonly assessment?: ToolRiskAssessment;
      readonly abortSignal?: AbortSignal;
    }): Promise<{ readonly blocked: { readonly extensionId: string; readonly summary: string } | null }> => {
      try {
        const hookResult = await this.extensionRegistry.runToolLifecycleHooks({
          cwd: execution.workspace.root,
          workspaceId: workspaceRecord.id,
          threadId: threadRecord.id,
          runId: runRecord.id,
          abortSignal: runAbortSignal,
          phase: input.phase,
          toolName: input.toolName,
          args: input.args,
          status: input.status,
          summary: input.summary,
          result: input.result,
          riskTier: input.assessment?.riskTier,
          approvalClass: input.assessment?.approvalClass,
        });
        for (const diagnostic of hookResult.diagnostics) {
          const summary = `[${diagnostic.extensionId}] ${diagnostic.message}`;
          toolEvents.push(
            this.sessionStore.recordToolEvent({
              runId: runRecord.id,
              toolCallId: input.toolCallId,
              toolName: `${input.toolName}:hook:${input.phase}`,
              riskTier: input.assessment?.riskTier ?? 0,
              status: `hook_${input.phase}`,
              summary,
            }),
          );
          await this.emitEvent({
            type: "tool.hook",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            status: input.status,
            summary,
            payload: {
              phase: input.phase,
              extensionId: diagnostic.extensionId,
            },
          });
        }
        return { blocked: hookResult.blocked };
      } catch (error) {
        const summary = error instanceof Error ? error.message : String(error);
        toolEvents.push(
          this.sessionStore.recordToolEvent({
            runId: runRecord.id,
            toolCallId: input.toolCallId,
            toolName: `${input.toolName}:hook:${input.phase}`,
            riskTier: input.assessment?.riskTier ?? 0,
            status: "hook_failed",
            summary,
          }),
        );
        await this.emitEvent({
          type: "tool.hook",
          at: new Date().toISOString(),
          workspaceId: workspaceRecord.id,
          threadId: threadRecord.id,
          runId: runRecord.id,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          status: "failed",
          summary,
          payload: {
            phase: input.phase,
          },
        });
        return {
          blocked:
            input.phase === "pre"
              ? { extensionId: "tool_lifecycle", summary: `Tool lifecycle pre-hook failed: ${summary}` }
              : null,
        };
      }
    };
    const executeRuntimeManagedTool = async (request: {
      readonly toolName: "create_checkpoint" | "rollback_checkpoint";
      readonly args: Record<string, unknown>;
      readonly startedSummary: string;
    }): Promise<ToolResult> => {
      const spec = this.toolRegistry.getSpec(request.toolName);
      const assessment = classifyToolCall({
        toolName: request.toolName,
        args: request.args,
        riskHint: spec?.riskHint,
      });
      const toolCall: ToolCallRequest = {
        id: `runtime-${request.toolName}-${randomUUID()}`,
        toolName: request.toolName,
        args: request.args,
      };
      await this.emitEvent({
        type: "tool.started",
        at: new Date().toISOString(),
        workspaceId: workspaceRecord.id,
        threadId: threadRecord.id,
        runId: runRecord.id,
        toolCallId: toolCall.id,
        toolName: request.toolName,
        status: "started",
        summary: request.startedSummary,
        payload: request.args,
      });

      const decision = resolveApprovalDecision(this.options.approvalPolicy, assessment);
      const approved = await this.resolveApproval(toolCall, assessment, decision, {
        workspaceId: workspaceRecord.id,
        threadId: threadRecord.id,
      });
      if (!approved) {
        const summary =
          `Blocked runtime-managed ${request.toolName} due to approval policy (${decision}). Class=${assessment.approvalClass}; tier=${assessment.riskTier}; reason=${assessment.reason}`;
        await emitToolLifecycleHookDiagnostics({
          toolCallId: toolCall.id,
          phase: "stop",
          toolName: request.toolName,
          args: request.args,
          status: "blocked",
          summary,
          assessment,
        });
        toolEvents.push(
          this.sessionStore.recordToolEvent({
            runId: runRecord.id,
            toolCallId: toolCall.id,
            toolName: request.toolName,
            riskTier: assessment.riskTier,
            status: "blocked",
            summary,
          }),
        );
        await this.emitEvent({
          type: "tool.blocked",
          at: new Date().toISOString(),
          workspaceId: workspaceRecord.id,
          threadId: threadRecord.id,
          runId: runRecord.id,
          toolCallId: toolCall.id,
          toolName: request.toolName,
          status: "blocked",
          summary,
          payload: createApprovalEventPayload({
            args: request.args,
            assessment,
            decision,
            blockKind: "approval_policy",
          }),
        });
        return { ok: false, summary };
      }

      const preHookResult = await emitToolLifecycleHookDiagnostics({
        toolCallId: toolCall.id,
        phase: "pre",
        toolName: request.toolName,
        args: request.args,
        status: "started",
        summary: request.startedSummary,
        assessment,
      });
      if (preHookResult.blocked) {
        const summary =
          `Blocked runtime-managed ${request.toolName} by pre tool hook [${preHookResult.blocked.extensionId}]: ${preHookResult.blocked.summary}`;
        toolEvents.push(
          this.sessionStore.recordToolEvent({
            runId: runRecord.id,
            toolCallId: toolCall.id,
            toolName: request.toolName,
            riskTier: assessment.riskTier,
            status: "hook_blocked",
            summary,
          }),
        );
        await this.emitEvent({
          type: "tool.blocked",
          at: new Date().toISOString(),
          workspaceId: workspaceRecord.id,
          threadId: threadRecord.id,
          runId: runRecord.id,
          toolCallId: toolCall.id,
          toolName: request.toolName,
          status: "hook_blocked",
          summary,
          payload: createApprovalEventPayload({
            args: request.args,
            assessment,
            decision: "hook_blocked",
            hookBlock: preHookResult.blocked,
            blockKind: "hook_blocked",
          }),
        });
        return { ok: false, summary };
      }

      try {
        throwIfAborted();
        const result = await this.toolRegistry.execute(
          request.toolName,
          {
            workspace: execution.workspace,
            executionDomain: execution.executionDomain,
            abortSignal: input.abortSignal,
            sessionStore: this.sessionStore,
            workspaceId: workspaceRecord.id,
            agentId: runRecord.agentId ?? undefined,
            threadId: threadRecord.id,
            runId: runRecord.id,
            subagentJobId: subagentRuntime.currentJobId ?? undefined,
            agentRole,
            allowedToolNames: availableToolNames,
            toolPolicyTrace: resolvedToolPolicy.trace,
            allowedWriteTargets:
              subagentRuntime.currentJobId
                ? subagentRuntime.orchestration.jobs.get(subagentRuntime.currentJobId)?.targetPaths
                : undefined,
            subagentController,
          },
          request.args,
        );
        const persistedOutput = persistToolOutput(request.toolName, result);
        const redactedResult = redactToolResultForRuntime(result);
        await emitToolLifecycleHookDiagnostics({
          toolCallId: toolCall.id,
          phase: "post",
          toolName: request.toolName,
          args: request.args,
          status: result.ok ? "ok" : "failed",
          summary: redactedResult.summary,
          result: redactedResult,
          assessment,
        });
        toolEvents.push(
          this.sessionStore.recordToolEvent({
            runId: runRecord.id,
            toolCallId: toolCall.id,
            toolName: request.toolName,
            riskTier: assessment.riskTier,
            status: result.ok ? "ok" : "failed",
            summary: redactedResult.summary,
            outputPreview: persistedOutput.preview,
            outputTruncated: persistedOutput.truncated,
            storedOutputRef: persistedOutput.storedOutputRef,
            presentation: redactedResult.presentation,
          }),
        );
        for (const artifactPath of result.artifactPaths ?? []) {
          artifacts.push(
            this.sessionStore.addArtifact({
              runId: runRecord.id,
              kind: request.toolName,
              path: artifactPath,
              summary: `${request.toolName} artifact`,
            }),
          );
        }
        await notifyMemoryProviderWrite(request.toolName, request.args, redactedResult);
        await this.emitEvent({
          type: result.ok ? "tool.completed" : "tool.failed",
          at: new Date().toISOString(),
          workspaceId: workspaceRecord.id,
          threadId: threadRecord.id,
          runId: runRecord.id,
          toolCallId: toolCall.id,
          toolName: request.toolName,
          status: result.ok ? "ok" : "failed",
          summary: redactedResult.summary,
          payload: redactedResult.data,
          presentation: redactedResult.presentation,
        });
        persistAutomaticMemory({
          scope: "thread",
          content: `${request.toolName}: ${redactedResult.summary}`,
          tags: ["session", "tool", result.ok ? "success" : "failure", request.toolName],
        });
        return result;
      } catch (error) {
        const summary = error instanceof Error ? error.message : String(error);
        await emitToolLifecycleHookDiagnostics({
          toolCallId: toolCall.id,
          phase: "post",
          toolName: request.toolName,
          args: request.args,
          status: "failed",
          summary,
          assessment,
        });
        toolEvents.push(
          this.sessionStore.recordToolEvent({
            runId: runRecord.id,
            toolCallId: toolCall.id,
            toolName: request.toolName,
            riskTier: assessment.riskTier,
            status: "failed",
            summary,
          }),
        );
        await this.emitEvent({
          type: "tool.failed",
          at: new Date().toISOString(),
          workspaceId: workspaceRecord.id,
          threadId: threadRecord.id,
          runId: runRecord.id,
          toolCallId: toolCall.id,
          toolName: request.toolName,
          status: "failed",
          summary,
        });
        persistAutomaticMemory({
          scope: "thread",
          content: `${request.toolName}: ${summary}`,
          tags: ["session", "tool", "failure", request.toolName],
        });
        return { ok: false, summary };
      }
    };
    const ensureMutationCheckpoint = async (triggerToolName: string): Promise<boolean> => {
      if (mutationCheckpointMode === "disabled" || mutationCheckpoint) {
        return true;
      }
      const result = await executeRuntimeManagedTool({
        toolName: "create_checkpoint",
        args: { name: `run-${runRecord.id.slice(0, 8)}-before-mutation` },
        startedSummary: `Creating runtime mutation checkpoint before ${triggerToolName}.`,
      });
      if (result.ok && isWorkspaceCheckpointRecord(result.data)) {
        mutationCheckpoint = result.data;
        artifacts.push(
          this.sessionStore.addArtifactContent({
            runId: runRecord.id,
            kind: "runtime-mutation-checkpoint",
            content: JSON.stringify(
              {
                checkpoint: mutationCheckpoint,
                triggerToolName,
                mode: mutationCheckpointMode,
              },
              null,
              2,
            ),
            summary: `Runtime mutation checkpoint ${mutationCheckpoint.id} created before ${triggerToolName}.`,
            extension: "json",
          }),
        );
        return true;
      }

      const summary = result.ok
        ? "Runtime-managed create_checkpoint returned an invalid checkpoint record."
        : result.summary;
      recentFailureReason = summary;
      if (mutationCheckpointMode === "required") {
        activeBlockReason = summary;
        return false;
      }
      return true;
    };
    const capturePreRollbackFailureEvidence = async (verification: VerificationAssessment): Promise<void> => {
      let capturedDiffSummary: GitDiffSummary | null = null;
      try {
        capturedDiffSummary = await execution.workspace.getGitDiffSummary();
        if (capturedDiffSummary) {
          diffSummary = capturedDiffSummary;
          for (const changedPath of capturedDiffSummary.changedFiles) {
            changedFiles.add(changedPath);
          }
          const artifactPath = await execution.workspace.writeArtifact(
            "pre-rollback-git-diff-summary",
            [
              `Changed files: ${capturedDiffSummary.changedFiles.join(", ") || "none"}`,
              "",
              capturedDiffSummary.stat,
              "",
              capturedDiffSummary.patchPreview,
            ].join("\n"),
          );
          artifacts.push(
            this.sessionStore.addArtifact({
              runId: runRecord.id,
              kind: "pre-rollback-git-diff-summary",
              path: artifactPath,
              summary: `Captured pre-rollback diff summary for ${capturedDiffSummary.changedFiles.length} changed file(s).`,
            }),
          );

          const fullPatch = await execution.workspace.getGitDiffPatch();
          if (fullPatch) {
            const patchArtifactPath = await execution.workspace.writeArtifact("pre-rollback-git-diff", fullPatch, ".patch");
            artifacts.push(
              this.sessionStore.addArtifact({
                runId: runRecord.id,
                kind: "pre-rollback-git-diff-patch",
                path: patchArtifactPath,
                summary: `Captured pre-rollback full git patch for ${capturedDiffSummary.changedFiles.length} changed file(s).`,
              }),
            );
          }
        }
      } catch (error) {
        const summary = `Failed to capture pre-rollback git diff evidence: ${error instanceof Error ? error.message : String(error)}`;
        toolEvents.push(
          this.sessionStore.recordToolEvent({
            runId: runRecord.id,
            toolName: "pre_rollback_diff",
            riskTier: 0,
            status: "failed",
            summary,
          }),
        );
      }

      artifacts.push(
        this.sessionStore.addArtifactContent({
          runId: runRecord.id,
          kind: "pre-rollback-failure-evidence",
          content: JSON.stringify(
            {
              checkpoint: mutationCheckpoint,
              verification,
              recentFailureReason,
              activeFailureReason,
              changedFiles: Array.from(changedFiles).sort(),
              diffSummary: capturedDiffSummary,
            },
            null,
            2,
          ),
          summary: "Captured final verification failure evidence before runtime rollback.",
          extension: "json",
        }),
      );
    };
    const maybeRollbackAfterFinalFailure = async (
      finalStatus: RunStatus,
      verification: VerificationAssessment,
    ): Promise<void> => {
      if (
        verificationFailureRollbackMode !== "final-failure" ||
        finalStatus !== "failed" ||
        verification.status !== "failed" ||
        !mutationCheckpoint
      ) {
        return;
      }
      await capturePreRollbackFailureEvidence(verification);
      const result = await executeRuntimeManagedTool({
        toolName: "rollback_checkpoint",
        args: { checkpointId: mutationCheckpoint.id },
        startedSummary: `Rolling back runtime mutation checkpoint ${mutationCheckpoint.id} after final verification failure.`,
      });
      if (!result.ok) {
        recentFailureReason = `Runtime rollback failed after final verification failure: ${result.summary}`;
        activeFailureReason = recentFailureReason;
        return;
      }
      artifacts.push(
        this.sessionStore.addArtifactContent({
          runId: runRecord.id,
          kind: "runtime-final-failure-rollback",
          content: JSON.stringify(
            {
              checkpoint: mutationCheckpoint,
              rollback: result.data ?? null,
              verification,
            },
            null,
            2,
          ),
          summary: `Rolled back runtime mutation checkpoint ${mutationCheckpoint.id} after final verification failure.`,
          extension: "json",
        }),
      );
      try {
        finalWorkspaceSnapshot = await execution.workspace.inspect();
      } catch {
        finalWorkspaceSnapshot = workspaceSnapshot;
      }
    };
    await memoryProviderCoordinator.initialize(buildMemorySessionContext());
    const initialRecallBundle = await memoryProviderCoordinator.prefetch(
      buildMemoryProviderContext(input.objective, workspaceSnapshot),
    );
    sessionMemories = initialRecallBundle.sessionMemories;
    workspaceMemories = initialRecallBundle.workspaceMemories;
    profileFacts = initialRecallBundle.profileFacts;
    learnedSkills = initialRecallBundle.learnedSkills;
    workspaceSkillFiles = await execution.workspace.loadSkillFiles({
      query: buildUnifiedSkillRecallQuery(input.objective, agentRole, learnedSkills),
      maxFiles: 4,
    });
    workspaceMemoryFiles = initialRecallBundle.workspaceMemoryFiles;
    relatedSessions = initialRecallBundle.relatedSessions;
    touchLearnedSkills(learnedSkills);
    extraInstructions = mergeUniqueStrings(
      input.extraInstructions,
      buildExtraInstructions(
        input.objective,
        agentRole,
        this.extensionRegistry.list().map((entry) => entry.id),
        sessionMemories,
        workspaceMemories,
        workspaceMemoryFiles,
        workspaceSkillFiles,
        rolePlaybooks,
        profileFacts,
        learnedSkills,
        relatedSessions,
        promptHookInstructions,
      ),
    );

    const executeAutomaticVerification = async (): Promise<void> => {
      throwIfAborted();
      const toolCallId = `runtime-run_verification-${randomUUID()}`;
      const assessment = classifyToolCall({
        toolName: "run_verification",
        args: { commands: verificationPlan.commands },
        riskHint: this.toolRegistry.getSpec("run_verification")?.riskHint,
      });
      const preHookResult = await emitToolLifecycleHookDiagnostics({
        toolCallId,
        phase: "pre",
        toolName: "run_verification",
        args: { commands: verificationPlan.commands },
        status: "started",
        summary: "Starting automatic verification.",
        assessment,
      });
      if (preHookResult.blocked) {
        const detailedSummary =
          `Blocked run_verification by pre tool hook [${preHookResult.blocked.extensionId}]: ${preHookResult.blocked.summary}`;
        toolEvents.push(
          this.sessionStore.recordToolEvent({
            runId: runRecord.id,
            toolCallId,
            toolName: "run_verification",
            riskTier: assessment.riskTier,
            status: "hook_blocked",
            summary: detailedSummary,
          }),
        );
        recentFailureReason = detailedSummary;
        activeBlockReason = detailedSummary;
        toolFailureCount += 1;
        toolObservations.push({
          toolName: "run_verification",
          ok: false,
          summary: detailedSummary,
        });
        return;
      }
      const result = await this.toolRegistry.execute(
        "run_verification",
        {
          workspace: execution.workspace,
          executionDomain: execution.executionDomain,
          sessionStore: this.sessionStore,
          workspaceId: workspaceRecord.id,
          agentId: runRecord.agentId ?? undefined,
          threadId: threadRecord.id,
          runId: runRecord.id,
          subagentJobId: subagentRuntime.currentJobId ?? undefined,
          allowedWriteTargets:
            subagentRuntime.currentJobId
              ? subagentRuntime.orchestration.jobs.get(subagentRuntime.currentJobId)?.targetPaths
              : undefined,
        },
        {
          commands: verificationPlan.commands,
        },
      );
      const redactedResult = redactToolResultForRuntime(result);
      await emitToolLifecycleHookDiagnostics({
        toolCallId,
        phase: "post",
        toolName: "run_verification",
        args: { commands: verificationPlan.commands },
        status: result.ok ? "ok" : "failed",
        summary: redactedResult.summary,
        result: redactedResult,
        assessment,
      });

      toolEvents.push(
        this.sessionStore.recordToolEvent({
          runId: runRecord.id,
          toolCallId,
          toolName: "run_verification",
          riskTier: 1,
          status: result.ok ? "ok" : "failed",
          summary: redactedResult.summary,
        }),
      );

      for (const artifactPath of result.artifactPaths ?? []) {
        artifacts.push(
          this.sessionStore.addArtifact({
            runId: runRecord.id,
            kind: "verification",
            path: artifactPath,
            summary: "Verification artifact",
          }),
        );
      }

      verificationExecution = (result.data ?? null) as VerificationExecutionResult | null;
      verifiedRevision = mutationRevision;
      if (result.ok) {
        activeFailureReason = null;
        activeBlockReason = null;
      } else {
        recentFailureReason = redactedResult.summary;
        activeFailureReason = redactedResult.summary;
      }
      persistAutomaticMemory({
        scope: "thread",
        content: `Verification ${result.ok ? "passed" : "failed"}: ${redactedResult.summary}`,
        tags: ["session", "verification", result.ok ? "passed" : "failed"],
      });
      toolCallCount += 1;
      if (result.ok) {
        toolSuccessCount += 1;
      } else {
        toolFailureCount += 1;
      }
      toolObservations.push({
        toolName: "run_verification",
        ok: result.ok,
        summary: redactedResult.summary,
        details: redactSensitiveText(summarizeToolData("run_verification", result.data) ?? "") || undefined,
      });
    };

    const extendRecoveryBudget = (reason: string): boolean => {
      if (maxIterations >= maxRecoveryIterations || blockedApprovals.length > 0 || interruptedRequest) {
        return false;
      }
      maxIterations += 1;
      const summary = `Extended run by one recovery iteration after ${reason}.`;
      recentFailureReason = summary;
      activeFailureReason = activeFailureReason ?? summary;
      persistAutomaticMemory({
        scope: "thread",
        content: summary,
        tags: ["session", "recovery"],
      });
      return true;
    };

    const noteToolProgress = (input: {
      readonly toolName: string;
      readonly ok: boolean;
      readonly assessment: ToolRiskAssessment;
    }): void => {
      if (!input.ok) {
        return;
      }
      if (shouldTrackWorkspaceMutation(input.toolName, input.assessment)) {
        successfulReadOnlyActionCount = 0;
        mutationRecoveryToolsOnly = false;
        return;
      }
      if (input.toolName !== "run_verification") {
        successfulReadOnlyActionCount += 1;
      }
    };

    const maybeEnforceMutationProgress = async (): Promise<void> => {
      if (
        successfulReadOnlyActionCount < nextReadOnlyProgressGuardAt ||
        mutatingToolSucceeded ||
        !objectiveSuggestsMutation(input.objective)
      ) {
        return;
      }
      nextReadOnlyProgressGuardAt += 6;
      const summary =
        `Progress guard: ${successfulReadOnlyActionCount} successful read-only tool calls have run without a mutating action. Next step must apply the smallest relevant edit or run verification; mutation recovery will expose only write and verification tools.`;
      mutationRecoveryToolsOnly = true;
      recentFailureReason = summary;
      activeFailureReason = summary;
      toolObservations.push({
        toolName: "progress_guard",
        ok: false,
        summary,
      });
      if (verificationPlan.commands.length > 0 && !verificationExecution) {
        await executeAutomaticVerification();
      }
    };

    const getAvailableToolsForTurn = (): typeof availableTools => {
      if (!mutationRecoveryToolsOnly) {
        return availableTools;
      }
      const recoveryTools = availableTools.filter((toolSpec) => MUTATION_RECOVERY_TOOL_NAMES.has(toolSpec.name));
      return recoveryTools.length > 0 ? recoveryTools : availableTools;
    };

    const shouldBlockToolForMutationRecovery = (toolName: string): boolean =>
      objectiveSuggestsMutation(input.objective) &&
      !mutatingToolSucceeded &&
      !hasSuccessfulDelegationObservation(toolObservations) &&
      successfulReadOnlyActionCount >= INITIAL_READ_ONLY_PROGRESS_GUARD_THRESHOLD &&
      !MUTATION_RECOVERY_TOOL_NAMES.has(toolName);

    const refreshContextFromWorkspace = async (): Promise<void> => {
      throwIfAborted();
      try {
        finalWorkspaceSnapshot = await execution.workspace.inspect();
      } catch {
        finalWorkspaceSnapshot = workspaceSnapshot;
      }
      workspaceMemoryFiles = await execution.workspace.loadMemoryFiles();
      knownWorkspaceMemoryPathKeys.clear();
      for (const entry of workspaceMemoryFiles) {
        knownWorkspaceMemoryPathKeys.add(normalizeWorkspacePathKey(entry.path));
      }
      await refreshMemoryRecall(undefined, "onTurnStart", finalWorkspaceSnapshot);
      rebuildContext(finalWorkspaceSnapshot, true, "ingest");
    };
    const maybeRunIndependentVerification = async (verification: VerificationAssessment): Promise<void> => {
      if (independentVerificationMode === "disabled" || subagentRuntime.currentJobId !== null || independentVerification) {
        return;
      }
      const shouldRun =
        independentVerificationMode === "required" ||
        mutatingToolSucceeded ||
        verification.status === "failed";
      if (!shouldRun) {
        return;
      }
      const verifierJob = await subagentController.spawn({
        objective: `Independent verification review for parent objective: ${input.objective}`,
        threadTitle: `Verifier: ${shortenTitle(input.objective)}`,
        role: "verifier",
        authority: "leaf",
        executionDomain: "workspace",
        verificationCommands: verificationPlan.commands,
        maxIterations: 3,
        allowedTools: [...(getAgentRoleContract("verifier").defaultAllowedTools ?? [])],
      });
      try {
        const completedVerifierJob = await subagentController.wait(verifierJob.id, 60_000);
        const verifierResponse =
          completedVerifierJob.finalResponse ?? completedVerifierJob.completion?.finalResponse ?? "";
        const parsedVerdict = parseIndependentVerifierVerdict(verifierResponse);
        const fallbackStatus =
          completedVerifierJob.completion?.verificationStatus === "failed"
            ? "failed"
            : completedVerifierJob.completion?.verificationStatus === "passed"
              ? "passed"
              : "skipped";
        const resolvedStatus =
          completedVerifierJob.status !== "completed"
            ? "error"
            : parsedVerdict.status === "skipped"
              ? fallbackStatus
              : parsedVerdict.status;
        independentVerification = {
          status: resolvedStatus,
          summary:
            completedVerifierJob.status === "completed"
              ? parsedVerdict.status === "skipped"
                ? resolvedStatus === "passed"
                  ? "Independent verifier completed and verification evidence passed, but no explicit verdict was returned."
                  : resolvedStatus === "failed"
                    ? "Independent verifier completed and observed failing verification evidence."
                    : parsedVerdict.summary
                : parsedVerdict.summary
              : completedVerifierJob.error ?? `Independent verifier finished with status ${completedVerifierJob.status}.`,
          verifierJobId: completedVerifierJob.id,
          verifierThreadId: completedVerifierJob.threadId,
          verifierRunId: completedVerifierJob.runId,
          verifierResponse,
        };
      } catch (error) {
        independentVerification = {
          status: "error",
          summary: error instanceof Error ? error.message : String(error),
          verifierJobId: verifierJob.id,
        };
      }
    };
    const maybeContinueAfterIndependentVerificationFailure = async (iteration: number): Promise<boolean> => {
      if (!independentVerification) {
        return false;
      }
      if (independentVerification.status !== "failed" && independentVerification.status !== "error") {
        return false;
      }
      const summary = `Independent verification ${independentVerification.status}: ${independentVerification.summary}`;
      recentFailureReason = summary;
      activeFailureReason = summary;
      toolObservations.push({
        toolName: "independent_verifier",
        ok: false,
        summary,
        details: independentVerification.verifierResponse ? trimForModel(independentVerification.verifierResponse, 2_000) : undefined,
      });
      persistAutomaticMemory({
        scope: "thread",
        content: summary,
        tags: ["session", "verification", "independent", independentVerification.status],
      });
      failedToolCount += 1;
      toolFailureCount += 1;
      if (iteration + 1 >= maxIterations) {
        return false;
      }
      independentVerification = null;
      await refreshContextFromWorkspace();
      return true;
    };

    const finalizeRun = async (result: {
      readonly status: RunStatus;
      readonly verification: VerificationAssessment;
      readonly assistantText: string;
      readonly errorMessage?: string;
    }): Promise<AgentRunSummary> => {
      try {
        await syncMemoryTurn(buildMemoryRecallQuery(result.assistantText), finalWorkspaceSnapshot);
        await subagentController.shutdown();

        let finalAssistantText = result.assistantText.trim() || "No assistant response was produced.";
        if (result.errorMessage) {
          finalAssistantText =
            finalAssistantText === "No assistant response was produced."
              ? `Run failed: ${result.errorMessage}`
              : `${finalAssistantText}\n\nRun failed: ${result.errorMessage}`;
        }

        if (!finalWorkspaceSnapshot) {
          try {
            finalWorkspaceSnapshot = await execution.workspace.inspect();
          } catch {
            finalWorkspaceSnapshot = workspaceSnapshot;
          }
        }

        if (!diffSummary && mutatingToolSucceeded) {
          try {
            diffSummary = await execution.workspace.getGitDiffSummary();
            if (diffSummary) {
              const artifactPath = await execution.workspace.writeArtifact(
                "git-diff-summary",
                [`Changed files: ${diffSummary.changedFiles.join(", ") || "none"}`, "", diffSummary.stat, "", diffSummary.patchPreview].join(
                  "\n",
                ),
              );
              artifacts.push(
                this.sessionStore.addArtifact({
                  runId: runRecord.id,
                  kind: "git-diff-summary",
                  path: artifactPath,
                  summary: `Captured diff summary for ${diffSummary.changedFiles.length} changed file(s).`,
                }),
              );
              for (const changedPath of diffSummary.changedFiles) {
                changedFiles.add(changedPath);
              }
              toolObservations.push({
                toolName: "git_diff",
                ok: true,
                summary: `Captured git diff for ${diffSummary.changedFiles.length} changed file(s).`,
                details: summarizeToolData("git_diff", diffSummary),
              });

              const fullPatch = await execution.workspace.getGitDiffPatch();
              if (fullPatch) {
                const patchArtifactPath = await execution.workspace.writeArtifact("git-diff", fullPatch, ".patch");
                artifacts.push(
                  this.sessionStore.addArtifact({
                    runId: runRecord.id,
                    kind: "git-diff-patch",
                    path: patchArtifactPath,
                    summary: `Captured full git patch for ${diffSummary.changedFiles.length} changed file(s).`,
                  }),
                );
              }
            }
          } catch {
            diffSummary = null;
          }
        }

        const changedFilesList = Array.from(changedFiles).sort();
        const finalResponse = buildFinalResponse({
          assistantText: finalAssistantText,
          changedFiles: changedFilesList,
          diffSummary,
          verification: result.verification,
          independentVerification,
          blockedApprovals,
        });
        const assistantMessage = this.sessionStore.appendMessage({
          threadId: threadRecord.id,
          runId: runRecord.id,
          role: "assistant",
          text: finalResponse,
        });
        const completedRun = this.sessionStore.completeRun({
          runId: runRecord.id,
          status: result.status,
          finalResponse,
          verificationStatus: result.verification.status,
        });
        const runMetrics = this.sessionStore.upsertRunMetrics({
          runId: completedRun.id,
          modelProfiles: Array.from(modelProfilesUsed).sort(),
          turnCount,
          toolCallCount,
          toolSuccessCount,
          toolFailureCount,
          blockedApprovalCount,
          inputTokens: usageTotals.hasInputTokens ? usageTotals.inputTokens : null,
          outputTokens: usageTotals.hasOutputTokens ? usageTotals.outputTokens : null,
          totalTokens: usageTotals.hasTotalTokens ? usageTotals.totalTokens : null,
          startedAt: runRecord.createdAt,
          completedAt: completedRun.updatedAt,
          durationMs: Math.max(0, new Date(completedRun.updatedAt).getTime() - new Date(runRecord.createdAt).getTime()),
          contextEngineId: contextEngine.getStatus().engineId,
          contextEngineStatus: contextEngine.getStatus(),
        });
        const taskBoardHandoff = await collectTodoTaskBoardHandoff(
          {
            workspace: execution.workspace,
            executionDomain: execution.executionDomain,
            abortSignal: input.abortSignal,
            sessionStore: this.sessionStore,
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: completedRun.id,
            agentRole,
          },
          { limit: 6 },
        );
        const finalTaskState = derivePromptTaskState({
          taskContract,
          toolObservations,
          verificationPlan,
          verificationExecution,
          recentFailureReason,
          activeFailureReason,
          activeBlockReason,
          mutatingToolSucceeded,
          turnCount,
          allowToolCalls: false,
        });
        const threadSummarySnapshot = createThreadSummarySnapshot(
          mergeThreadHandoffSummaries(
            threadSummaryRecord?.summary ?? null,
            buildThreadSummary({
              objective: input.objective,
              assistantText: finalAssistantText,
              taskState: finalTaskState,
              changedFiles: changedFilesList,
              verification: result.verification,
              independentVerification,
              blockedApprovals,
              taskBoardHandoffItems: taskBoardHandoff.pendingItems,
              taskBoardObserved: taskBoardHandoff.observed,
              failedToolCount,
              mutatingToolSucceeded,
            }),
          ),
        );
        this.sessionStore.upsertThreadSummary({
          threadId: threadRecord.id,
          workspaceId: workspaceRecord.id,
          lastRunId: completedRun.id,
          summary: threadSummarySnapshot.summary,
          summaryVersion: threadSummarySnapshot.summaryVersion,
          summaryHash: threadSummarySnapshot.summaryHash,
          handoff: threadSummarySnapshot.handoff as unknown as Readonly<Record<string, unknown>> | null,
        });
        for (const skill of learnedSkills) {
          this.sessionStore.recordLearnedSkillOutcome({
            skillId: skill.id,
            succeeded: result.status !== "failed",
          });
        }
        try {
          const sessionEndContext: MemorySessionEndContext = {
            ...buildMemorySessionContext(),
            status: result.status,
            verification: result.verification,
            changedFiles: changedFilesList,
            blockedApprovals,
            assistantText: finalAssistantText,
            finalResponse,
            errorMessage: result.errorMessage,
            messages: this.sessionStore.listAllThreadMessages(threadRecord.id),
            workspaceSnapshot: finalWorkspaceSnapshot,
            loadedWorkspaceMemoryFiles: workspaceMemoryFiles,
          };
          await memoryProviderCoordinator.onSessionEnd(sessionEndContext);
        } catch {
          // End-of-session memory extraction must not fail the run.
        }
        try {
          await this.emitEvent({
            type: "run.completed",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            status: completedRun.status,
            summary: finalResponse,
            payload: {
              changedFiles: changedFilesList,
              verification: result.verification.status,
              independentVerification: independentVerification?.status ?? null,
              usage: runMetrics,
              contextEngine: contextEngine.getStatus(),
              error: result.errorMessage,
            },
          });
        } catch {
          // Final completion bookkeeping should not fail the whole run.
        }
        const threadUsage = this.sessionStore.summarizeThreadUsage(threadRecord.id);

        return {
          workspace: workspaceRecord,
          thread: threadRecord,
          resumedThread,
          run: completedRun,
          executionDomain: execution.executionDomain,
          sourceRoot: execution.sourceRoot,
          executionRoot: execution.executionRoot,
          worktreePath: execution.worktreePath,
          worktreeBranch: execution.worktreeBranch,
          sandboxPath: execution.sandboxPath,
          userMessage,
          assistantMessage,
          workspaceSnapshot: finalWorkspaceSnapshot,
          verification: result.verification,
          independentVerification,
          diffSummary,
          changedFiles: changedFilesList,
          toolEvents,
          artifacts,
          blockedApprovals,
          contextEngineStatus: contextEngine.getStatus(),
          runMetrics,
          threadUsage,
          finalResponse,
        };
      } finally {
        await memoryProviderCoordinator.shutdown();
      }
    };
    throwIfAborted();
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      throwIfAborted();
      await awaitExecutionPermit();
      let turn: ModelTurnResult;
      const executedToolNames: string[] = [];
      queueMemoryPrefetch();
      await refreshMemoryRecall();
      rebuildContext(finalWorkspaceSnapshot, true);
      const turnAvailableTools = getAvailableToolsForTurn();
      const turnAvailableToolNames = turnAvailableTools.map((toolSpec) => toolSpec.name);
      try {
        throwIfAborted();
        turn = await turnModelClient.generateTurn({
          context,
          taskContract,
          availableTools: turnAvailableTools,
          toolResults: buildToolResultsForModel(),
        });
      } catch (error) {
        const verification = assessVerification(verificationPlan, verificationExecution);
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (mutatingToolSucceeded && verification.status === "passed") {
          return finalizeRun({
            status: "completed_with_warnings",
            verification,
            assistantText: `${assistantText.trim() || "Verified changes completed."}\n\nRun warning: model turn failed after verified changes: ${errorMessage}`,
          });
        }
        return finalizeRun({
          status: "failed",
          verification,
          assistantText,
          errorMessage,
        });
      }
      applyTurnMetrics(turn, {
        modelProfilesUsed,
        usageTotals,
      });
      turnCount += 1;
      toolCallCount += turn.toolCalls.length;
      const allowFuzzyToolRepair = !mutationRecoveryToolsOnly;

      assistantText = turn.assistantText.trim() || assistantText;
      if (assistantText !== "No assistant response was produced.") {
        persistAutomaticMemory({
          scope: "thread",
          content: `Turn ${turnCount}: ${assistantText}`,
          tags: ["session", "turn", turn.toolCalls.length > 0 ? "intent" : "response"],
        });
        queueMemoryPrefetch(buildMemoryRecallQuery(assistantText));
      }
      await syncMemoryTurn(buildMemoryRecallQuery(assistantText));
      if (turn.toolCalls.length === 0) {
        if (
          objectiveSuggestsMutation(input.objective) &&
          !mutatingToolSucceeded &&
          containsMalformedToolCallIntent(assistantText)
        ) {
          const summary =
            "Model returned a malformed or truncated tool-call envelope instead of executable tool calls. Retry with smaller write_file or append_file payloads.";
          recentFailureReason = summary;
          activeFailureReason = summary;
          mutationRecoveryToolsOnly = true;
          toolObservations.push({
            toolName: "tool_call_parser",
            ok: false,
            summary,
            details: trimForModel(assistantText, 1_000),
          });
          if (iteration + 1 >= maxIterations) {
            extendRecoveryBudget("a malformed tool-call envelope");
          }
          if (iteration + 1 < maxIterations) {
            await refreshContextFromWorkspace();
            continue;
          }
        }
        if (
          objectiveSuggestsMutation(input.objective) &&
          !mutatingToolSucceeded &&
          !hasSuccessfulDelegationObservation(toolObservations) &&
          containsUnfulfilledMutationIntent(assistantText)
        ) {
          const summary =
            "Model described a future write or deliverable action but did not call an executable edit tool. It must write the requested artifact, edit a file, or delegate implementation before finalizing.";
          recentFailureReason = summary;
          activeFailureReason = summary;
          mutationRecoveryToolsOnly = true;
          toolObservations.push({
            toolName: "completion_gate",
            ok: false,
            summary,
            details: trimForModel(assistantText, 1_000),
          });
          if (iteration + 1 >= maxIterations) {
            extendRecoveryBudget("a prose-only future action");
          }
          if (iteration + 1 < maxIterations) {
            await refreshContextFromWorkspace();
            continue;
          }
        }
        const verificationIsStale =
          mutatingToolSucceeded && verificationPlan.commands.length > 0 && verifiedRevision < mutationRevision;
        const shouldCollectInitialVerification =
          !mutatingToolSucceeded &&
          objectiveSuggestsMutation(input.objective) &&
          !hasSuccessfulDelegationObservation(toolObservations) &&
          verificationPlan.commands.length > 0 &&
          !verificationExecution;
        if (verificationIsStale || shouldCollectInitialVerification) {
          await executeAutomaticVerification();
          const verification = assessVerification(verificationPlan, verificationExecution);
          if (
            verification.status === "failed" &&
            iteration + 1 >= maxIterations &&
            (mutatingToolSucceeded || shouldCollectInitialVerification)
          ) {
            extendRecoveryBudget("failed verification");
          }
          if (verification.status === "failed" && iteration + 1 < maxIterations) {
            await refreshContextFromWorkspace();
            continue;
          }
        }
        const verification = assessVerification(verificationPlan, verificationExecution);
        if (
          objectiveSuggestsMutation(input.objective) &&
          !mutatingToolSucceeded &&
          !hasSuccessfulDelegationObservation(toolObservations) &&
          verification.status === "failed"
        ) {
          const summary =
            `Model stopped without applying the required repository change after failed verification. It must call an edit tool or delegate an implementation subtask before finalizing. ${verification.summary}`;
          recentFailureReason = summary;
          activeFailureReason = summary;
          mutationRecoveryToolsOnly = true;
          toolObservations.push({
            toolName: "completion_gate",
            ok: false,
            summary,
          });
          if (iteration + 1 >= maxIterations) {
            extendRecoveryBudget("a prose-only implementation response");
          }
          if (iteration + 1 < maxIterations) {
            await refreshContextFromWorkspace();
            continue;
          }
        }
        await maybeRunIndependentVerification(verification);
        if (await maybeContinueAfterIndependentVerificationFailure(iteration)) {
          continue;
        }
        break;
      }

      const preparedParallelToolCalls: PreparedParallelToolCall[] = [];
      let shouldTryParallelToolExecution =
        turn.toolCalls.length > 1 && turn.toolCalls.length <= MAX_PARALLEL_SAFE_TOOL_CALLS;
      if (shouldTryParallelToolExecution) {
        for (const toolCall of turn.toolCalls) {
          const requestedToolName = toolCall.toolName;
          const resolvedToolName = resolveToolName(requestedToolName, turnAvailableToolNames, allowFuzzyToolRepair);
          if (!resolvedToolName) {
            shouldTryParallelToolExecution = false;
            break;
          }
          const resolved = {
            ...toolCall,
            toolName: resolvedToolName,
          };
          if (shouldBlockToolForMutationRecovery(resolved.toolName)) {
            shouldTryParallelToolExecution = false;
            break;
          }
          const assessment = classifyToolCall({
            toolName: resolved.toolName,
            args: resolved.args,
            riskHint: this.toolRegistry.getSpec(resolved.toolName)?.riskHint,
          });
          const decision = resolveApprovalDecision(this.options.approvalPolicy, assessment);
          if (decision !== "allow") {
            shouldTryParallelToolExecution = false;
            break;
          }
          preparedParallelToolCalls.push({
            requestedToolName,
            resolved,
            assessment,
            resolvedLabel:
              requestedToolName === resolved.toolName
                ? resolved.toolName
                : `${requestedToolName} (resolved to ${resolved.toolName})`,
          });
        }
      }

      if (shouldTryParallelToolExecution && canExecutePreparedToolCallsInParallel(preparedParallelToolCalls)) {
        const preHookBlocks = new Map<string, { readonly extensionId: string; readonly summary: string }>();
        for (const prepared of preparedParallelToolCalls) {
          throwIfAborted();
          executedToolNames.push(prepared.resolved.toolName);
          await this.emitEvent({
            type: "tool.started",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            toolCallId: prepared.resolved.id,
            toolName: prepared.resolved.toolName,
            status: "started",
            summary: `Starting ${prepared.resolvedLabel}.`,
            payload: prepared.resolved.args,
          });
          const preHookResult = await emitToolLifecycleHookDiagnostics({
            toolCallId: prepared.resolved.id,
            phase: "pre",
            toolName: prepared.resolved.toolName,
            args: prepared.resolved.args,
            status: "started",
            summary: `Starting ${prepared.resolvedLabel}.`,
            assessment: prepared.assessment,
          });
          if (preHookResult.blocked) {
            preHookBlocks.set(prepared.resolved.id, preHookResult.blocked);
          }
        }

        const settledResults = await Promise.all(
          preparedParallelToolCalls.map(async (prepared) => {
            try {
              throwIfAborted();
              const hookBlock = preHookBlocks.get(prepared.resolved.id);
              if (hookBlock) {
                return { hookBlock };
              }
              const result = await this.toolRegistry.execute(
                prepared.resolved.toolName,
                {
                  workspace: execution.workspace,
                  executionDomain: execution.executionDomain,
                  abortSignal: input.abortSignal,
                  sessionStore: this.sessionStore,
                  workspaceId: workspaceRecord.id,
                  agentId: runRecord.agentId ?? undefined,
                  threadId: threadRecord.id,
                  runId: runRecord.id,
                  subagentJobId: subagentRuntime.currentJobId ?? undefined,
                  agentRole,
                  allowedToolNames: turnAvailableToolNames,
                  toolPolicyTrace: resolvedToolPolicy.trace,
                  allowedWriteTargets:
                    subagentRuntime.currentJobId
                      ? subagentRuntime.orchestration.jobs.get(subagentRuntime.currentJobId)?.targetPaths
                      : undefined,
                  subagentController,
                },
                prepared.resolved.args,
              );
              return { result };
            } catch (error) {
              return { error };
            }
          }),
        );

        for (let index = 0; index < preparedParallelToolCalls.length; index += 1) {
          const prepared = preparedParallelToolCalls[index]!;
          const { resolved, assessment } = prepared;
          const settled = settledResults[index]!;
          if ("hookBlock" in settled) {
            const hookBlock = settled.hookBlock;
            if (!hookBlock) {
              continue;
            }
            const detailedSummary =
              `Blocked ${resolved.toolName} by pre tool hook [${hookBlock.extensionId}]: ${hookBlock.summary}`;
            recentFailureReason = detailedSummary;
            activeBlockReason = detailedSummary;
            toolEvents.push(
              this.sessionStore.recordToolEvent({
                runId: runRecord.id,
                toolCallId: resolved.id,
                toolName: resolved.toolName,
                riskTier: assessment.riskTier,
                status: "hook_blocked",
                summary: detailedSummary,
              }),
            );
            toolObservations.push({
              toolName: resolved.toolName,
              ok: false,
              summary: detailedSummary,
            });
            await this.emitEvent({
              type: "tool.blocked",
              at: new Date().toISOString(),
              workspaceId: workspaceRecord.id,
              threadId: threadRecord.id,
              runId: runRecord.id,
              toolCallId: resolved.id,
              toolName: resolved.toolName,
              status: "hook_blocked",
              summary: detailedSummary,
              payload: createApprovalEventPayload({
                args: resolved.args,
                assessment,
                decision: "hook_blocked",
                hookBlock,
                blockKind: "hook_blocked",
              }),
            });
            failedToolCount += 1;
            continue;
          }
          if ("error" in settled) {
            const summary = settled.error instanceof Error ? settled.error.message : String(settled.error);
            recentFailureReason = summary;
            activeFailureReason = summary;
            toolEvents.push(
              this.sessionStore.recordToolEvent({
                runId: runRecord.id,
                toolCallId: resolved.id,
                toolName: resolved.toolName,
                riskTier: assessment.riskTier,
                status: "failed",
                summary,
              }),
            );
            await emitToolLifecycleHookDiagnostics({
              toolCallId: resolved.id,
              phase: "post",
              toolName: resolved.toolName,
              args: resolved.args,
              status: "failed",
              summary,
              assessment,
            });
            toolObservations.push({
              toolName: resolved.toolName,
              ok: false,
              summary,
            });
            await this.emitEvent({
              type: "tool.failed",
              at: new Date().toISOString(),
              workspaceId: workspaceRecord.id,
              threadId: threadRecord.id,
              runId: runRecord.id,
              toolCallId: resolved.id,
              toolName: resolved.toolName,
              status: "failed",
              summary,
            });
            persistAutomaticMemory({
              scope: "thread",
              content: `${resolved.toolName}: ${summary}`,
              tags: ["session", "tool", "failure", resolved.toolName],
            });
            failedToolCount += 1;
            toolFailureCount += 1;
            continue;
          }

          const result: ToolResult = settled.result;
          const persistedOutput = persistToolOutput(resolved.toolName, result);
          const redactedResult = redactToolResultForRuntime(result);
          toolEvents.push(
            this.sessionStore.recordToolEvent({
              runId: runRecord.id,
              toolCallId: resolved.id,
              toolName: resolved.toolName,
              riskTier: assessment.riskTier,
              status: result.interrupt ? "interrupted" : result.ok ? "ok" : "failed",
              summary: redactedResult.summary,
              outputPreview: persistedOutput.preview,
              outputTruncated: persistedOutput.truncated,
              storedOutputRef: persistedOutput.storedOutputRef,
              presentation: redactedResult.presentation,
            }),
          );
          await emitToolLifecycleHookDiagnostics({
            toolCallId: resolved.id,
            phase: "post",
            toolName: resolved.toolName,
            args: resolved.args,
            status: result.interrupt ? "stopped" : result.ok ? "ok" : "failed",
            summary: redactedResult.summary,
            result: redactedResult,
            assessment,
          });

          for (const artifactPath of result.artifactPaths ?? []) {
            artifacts.push(
              this.sessionStore.addArtifact({
                runId: runRecord.id,
                kind: resolved.toolName,
                path: artifactPath,
                summary: `${resolved.toolName} artifact`,
              }),
            );
          }

          await notifyMemoryProviderWrite(resolved.toolName, resolved.args, redactedResult);

          toolObservations.push({
            toolName: resolved.toolName,
            ok: result.ok,
            summary: redactedResult.summary,
            details: persistedOutput.details,
          });

          for (const changedPath of extractChangedPaths(resolved.toolName, result.data)) {
            changedFiles.add(changedPath);
          }

          if (result.ok && shouldTrackWorkspaceMutation(resolved.toolName, assessment)) {
            mutatingToolSucceeded = true;
            mutationRevision += 1;
          }
          noteToolProgress({
            toolName: resolved.toolName,
            ok: result.ok,
            assessment,
          });
          if (result.interrupt) {
            interruptedRequest = result.interrupt;
            activeFailureReason = null;
            activeBlockReason = buildToolInterruptSummary(result.interrupt);
          } else if (result.ok) {
            activeFailureReason = null;
            activeBlockReason = null;
          } else {
            recentFailureReason = redactedResult.summary;
            activeFailureReason = redactedResult.summary;
          }

          const discoveredWorkspaceInstructions = await discoverWorkspaceInstructionsForTool({
            workspace: execution.workspace,
            toolName: resolved.toolName,
            args: resolved.args,
            knownInstructionPathKeys: knownWorkspaceInstructionPathKeys,
          });
          const discoveredWorkspaceMemoryFiles = await discoverWorkspaceMemoryFilesForTool({
            workspace: execution.workspace,
            toolName: resolved.toolName,
            args: resolved.args,
            knownMemoryPathKeys: knownWorkspaceMemoryPathKeys,
          });
          let shouldRefreshContext = false;
          if (discoveredWorkspaceInstructions.length > 0) {
            workspaceInstructions = [...workspaceInstructions, ...discoveredWorkspaceInstructions];
            shouldRefreshContext = true;
          }
          if (discoveredWorkspaceMemoryFiles.length > 0) {
            workspaceMemoryFiles = [...workspaceMemoryFiles, ...discoveredWorkspaceMemoryFiles];
            extraInstructions = mergeUniqueStrings(
              input.extraInstructions,
              buildExtraInstructions(
                input.objective,
                agentRole,
                this.extensionRegistry.list().map((entry) => entry.id),
                sessionMemories,
                workspaceMemories,
                workspaceMemoryFiles,
                workspaceSkillFiles,
                rolePlaybooks,
                profileFacts,
                learnedSkills,
                relatedSessions,
                promptHookInstructions,
              ),
            );
            shouldRefreshContext = true;
          }
          if (shouldRefreshContext) {
            rebuildContext(contextEngine.getState().workspaceSnapshot, true, "ingest");
          }

          await this.emitEvent({
            type: result.interrupt ? "tool.blocked" : result.ok ? "tool.completed" : "tool.failed",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            toolCallId: resolved.id,
            toolName: resolved.toolName,
            status: result.interrupt ? "interrupted" : result.ok ? "ok" : "failed",
            summary: redactedResult.summary,
            payload: result.interrupt ? createToolInterruptEventPayload(result.interrupt, redactedResult.data) : redactedResult.data,
            presentation: redactedResult.presentation,
          });
          if (!result.ok) {
            persistAutomaticMemory({
              scope: "thread",
              content: `${resolved.toolName}: ${redactedResult.summary}`,
              tags: ["session", "tool", "failure", resolved.toolName],
            });
          }
          if (result.interrupt) {
            persistAutomaticMemory({
              scope: "thread",
              content: `${resolved.toolName}: ${buildToolInterruptSummary(result.interrupt)}`,
              tags: ["session", "tool", "blocked", resolved.toolName],
            });
            break;
          }
          if (!result.ok) {
            failedToolCount += 1;
            toolFailureCount += 1;
          } else {
            toolSuccessCount += 1;
          }
        }
      } else {
      for (const toolCall of turn.toolCalls) {
        throwIfAborted();
        await awaitExecutionPermit();
        const requestedToolName = toolCall.toolName;
        const resolvedToolName = resolveToolName(requestedToolName, turnAvailableToolNames, allowFuzzyToolRepair);
        if (!resolvedToolName) {
          const summary = `Unknown tool: ${requestedToolName}.`;
          recentFailureReason = summary;
          activeFailureReason = summary;
          toolEvents.push(
            this.sessionStore.recordToolEvent({
              runId: runRecord.id,
              toolCallId: toolCall.id,
              toolName: requestedToolName,
              riskTier: 2,
              status: "failed",
              summary,
            }),
          );
          toolObservations.push({
            toolName: requestedToolName,
            ok: false,
            summary,
          });
          await this.emitEvent({
            type: "tool.failed",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            toolCallId: toolCall.id,
            toolName: requestedToolName,
            status: "failed",
            summary,
          });
          persistAutomaticMemory({
            scope: "thread",
            content: summary,
            tags: ["session", "tool", "failure"],
          });
          failedToolCount += 1;
          toolFailureCount += 1;
          continue;
        }

        const resolved = {
          ...toolCall,
          toolName: resolvedToolName,
        };
        if (shouldBlockToolForMutationRecovery(resolved.toolName)) {
          const summary =
            `Read-only progress budget is exhausted for this mutation task; ${resolved.toolName} is blocked until the model writes, edits, runs verification, or delegates implementation.`;
          recentFailureReason = summary;
          activeFailureReason = summary;
          mutationRecoveryToolsOnly = true;
          toolEvents.push(
            this.sessionStore.recordToolEvent({
              runId: runRecord.id,
              toolCallId: resolved.id,
              toolName: resolved.toolName,
              riskTier: 1,
              status: "failed",
              summary,
            }),
          );
          toolObservations.push({
            toolName: resolved.toolName,
            ok: false,
            summary,
          });
          await this.emitEvent({
            type: "tool.failed",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            toolCallId: resolved.id,
            toolName: resolved.toolName,
            status: "failed",
            summary,
          });
          failedToolCount += 1;
          toolFailureCount += 1;
          continue;
        }
        executedToolNames.push(resolved.toolName);

        const assessment = classifyToolCall({
          toolName: resolved.toolName,
          args: resolved.args,
          riskHint: this.toolRegistry.getSpec(resolved.toolName)?.riskHint,
        });
        const resolvedLabel =
          requestedToolName === resolved.toolName
            ? resolved.toolName
            : `${requestedToolName} (resolved to ${resolved.toolName})`;
        await this.emitEvent({
          type: "tool.started",
          at: new Date().toISOString(),
          workspaceId: workspaceRecord.id,
          threadId: threadRecord.id,
          runId: runRecord.id,
          toolCallId: resolved.id,
          toolName: resolved.toolName,
          status: "started",
          summary: `Starting ${resolvedLabel}.`,
          payload: resolved.args,
        });
        const decision = resolveApprovalDecision(this.options.approvalPolicy, assessment);
        const approved = await this.resolveApproval(resolved, assessment, decision, {
          workspaceId: workspaceRecord.id,
          threadId: threadRecord.id,
        });

        if (!approved) {
          const summary = `Blocked ${resolvedLabel} due to approval policy (${decision}).`;
          const detailedSummary =
            `${summary} Class=${assessment.approvalClass}; tier=${assessment.riskTier}; reason=${assessment.reason}`;
          blockedApprovals.push(detailedSummary);
          blockedApprovalCount += 1;
          activeBlockReason = detailedSummary;
          toolEvents.push(
            this.sessionStore.recordToolEvent({
              runId: runRecord.id,
              toolCallId: resolved.id,
              toolName: resolved.toolName,
              riskTier: assessment.riskTier,
              status: "blocked",
              summary: detailedSummary,
            }),
          );
          await emitToolLifecycleHookDiagnostics({
            toolCallId: resolved.id,
            phase: "stop",
            toolName: resolved.toolName,
            args: resolved.args,
            status: "blocked",
            summary: detailedSummary,
            assessment,
          });
          await this.emitEvent({
            type: "tool.blocked",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            toolCallId: resolved.id,
            toolName: resolved.toolName,
            status: "blocked",
            summary: detailedSummary,
            payload: createApprovalEventPayload({
              args: resolved.args,
              assessment,
              decision,
              blockKind: "approval_policy",
            }),
          });
          persistAutomaticMemory({
            scope: "thread",
            content: detailedSummary,
            tags: ["session", "tool", "blocked"],
          });
          failedToolCount += 1;
          continue;
        }

        if (shouldTrackWorkspaceMutation(resolved.toolName, assessment)) {
          const checkpointReady = await ensureMutationCheckpoint(resolved.toolName);
          if (!checkpointReady) {
            const summary =
              `Blocked ${resolvedLabel} because required runtime mutation checkpoint could not be created before execution.`;
            toolEvents.push(
              this.sessionStore.recordToolEvent({
                runId: runRecord.id,
                toolCallId: resolved.id,
                toolName: resolved.toolName,
                riskTier: assessment.riskTier,
                status: "blocked",
                summary,
              }),
            );
            toolObservations.push({
              toolName: resolved.toolName,
              ok: false,
              summary,
            });
            await this.emitEvent({
              type: "tool.blocked",
              at: new Date().toISOString(),
              workspaceId: workspaceRecord.id,
              threadId: threadRecord.id,
              runId: runRecord.id,
              toolCallId: resolved.id,
              toolName: resolved.toolName,
              status: "blocked",
              summary,
              payload: createApprovalEventPayload({
                args: resolved.args,
                assessment,
                decision: "runtime_checkpoint",
                reason: summary,
                blockKind: "runtime_checkpoint",
              }),
            });
            failedToolCount += 1;
            toolFailureCount += 1;
            continue;
          }
        }

        const preHookResult = await emitToolLifecycleHookDiagnostics({
          toolCallId: resolved.id,
          phase: "pre",
          toolName: resolved.toolName,
          args: resolved.args,
          status: "started",
          summary: `Starting ${resolvedLabel}.`,
          assessment,
        });
        if (preHookResult.blocked) {
          const detailedSummary =
            `Blocked ${resolvedLabel} by pre tool hook [${preHookResult.blocked.extensionId}]: ${preHookResult.blocked.summary}`;
          failedToolCount += 1;
          activeBlockReason = detailedSummary;
          toolEvents.push(
            this.sessionStore.recordToolEvent({
              runId: runRecord.id,
              toolCallId: resolved.id,
              toolName: resolved.toolName,
              riskTier: assessment.riskTier,
              status: "hook_blocked",
              summary: detailedSummary,
            }),
          );
          toolObservations.push({
            toolName: resolved.toolName,
            ok: false,
            summary: detailedSummary,
          });
          await this.emitEvent({
            type: "tool.blocked",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            toolCallId: resolved.id,
            toolName: resolved.toolName,
            status: "hook_blocked",
            summary: detailedSummary,
            payload: createApprovalEventPayload({
              args: resolved.args,
              assessment,
              decision: "hook_blocked",
              hookBlock: preHookResult.blocked,
              blockKind: "hook_blocked",
            }),
          });
          continue;
        }

        try {
          throwIfAborted();
          const toolArgs =
            resolved.toolName === "run_verification" && verificationPlan.commands.length > 0
              ? {
                  ...resolved.args,
                  commands: verificationPlan.commands,
                }
              : resolved.args;
          const result = await this.toolRegistry.execute(
            resolved.toolName,
            {
              workspace: execution.workspace,
              executionDomain: execution.executionDomain,
              abortSignal: input.abortSignal,
              sessionStore: this.sessionStore,
              workspaceId: workspaceRecord.id,
              agentId: runRecord.agentId ?? undefined,
              threadId: threadRecord.id,
              runId: runRecord.id,
              subagentJobId: subagentRuntime.currentJobId ?? undefined,
              agentRole,
              allowedToolNames: turnAvailableToolNames,
              toolPolicyTrace: resolvedToolPolicy.trace,
              allowedWriteTargets:
                subagentRuntime.currentJobId
                  ? subagentRuntime.orchestration.jobs.get(subagentRuntime.currentJobId)?.targetPaths
                  : undefined,
              subagentController,
            },
            toolArgs,
          );

          const persistedOutput = persistToolOutput(resolved.toolName, result);
          const redactedResult = redactToolResultForRuntime(result);
          toolEvents.push(
            this.sessionStore.recordToolEvent({
              runId: runRecord.id,
              toolCallId: resolved.id,
              toolName: resolved.toolName,
              riskTier: assessment.riskTier,
              status: result.interrupt ? "interrupted" : result.ok ? "ok" : "failed",
              summary: redactedResult.summary,
              outputPreview: persistedOutput.preview,
              outputTruncated: persistedOutput.truncated,
              storedOutputRef: persistedOutput.storedOutputRef,
              presentation: redactedResult.presentation,
            }),
          );
          await emitToolLifecycleHookDiagnostics({
            toolCallId: resolved.id,
            phase: "post",
            toolName: resolved.toolName,
            args: toolArgs,
            status: result.interrupt ? "stopped" : result.ok ? "ok" : "failed",
            summary: redactedResult.summary,
            result: redactedResult,
            assessment,
          });

          for (const artifactPath of result.artifactPaths ?? []) {
            artifacts.push(
              this.sessionStore.addArtifact({
                runId: runRecord.id,
                kind: resolved.toolName,
                path: artifactPath,
                summary: `${resolved.toolName} artifact`,
              }),
            );
          }

          await notifyMemoryProviderWrite(resolved.toolName, toolArgs, redactedResult);

          toolObservations.push({
            toolName: resolved.toolName,
            ok: result.ok,
            summary: redactedResult.summary,
            details: persistedOutput.details,
          });

          for (const changedPath of extractChangedPaths(resolved.toolName, result.data)) {
            changedFiles.add(changedPath);
          }

          if (result.ok && shouldTrackWorkspaceMutation(resolved.toolName, assessment)) {
            mutatingToolSucceeded = true;
            mutationRevision += 1;
          }
          noteToolProgress({
            toolName: resolved.toolName,
            ok: result.ok,
            assessment,
          });
          if (result.interrupt) {
            interruptedRequest = result.interrupt;
            activeFailureReason = null;
            activeBlockReason = buildToolInterruptSummary(result.interrupt);
          } else if (result.ok) {
            activeFailureReason = null;
            activeBlockReason = null;
          } else {
            recentFailureReason = redactedResult.summary;
            activeFailureReason = redactedResult.summary;
          }

          const discoveredWorkspaceInstructions = await discoverWorkspaceInstructionsForTool({
            workspace: execution.workspace,
            toolName: resolved.toolName,
            args: resolved.args,
            knownInstructionPathKeys: knownWorkspaceInstructionPathKeys,
          });
          const discoveredWorkspaceMemoryFiles = await discoverWorkspaceMemoryFilesForTool({
            workspace: execution.workspace,
            toolName: resolved.toolName,
            args: resolved.args,
            knownMemoryPathKeys: knownWorkspaceMemoryPathKeys,
          });
          let shouldRefreshContext = false;
          if (discoveredWorkspaceInstructions.length > 0) {
            workspaceInstructions = [...workspaceInstructions, ...discoveredWorkspaceInstructions];
            shouldRefreshContext = true;
          }
          if (discoveredWorkspaceMemoryFiles.length > 0) {
            workspaceMemoryFiles = [...workspaceMemoryFiles, ...discoveredWorkspaceMemoryFiles];
            extraInstructions = mergeUniqueStrings(
              input.extraInstructions,
              buildExtraInstructions(
                input.objective,
                agentRole,
                this.extensionRegistry.list().map((entry) => entry.id),
                sessionMemories,
                workspaceMemories,
                workspaceMemoryFiles,
                workspaceSkillFiles,
                rolePlaybooks,
                profileFacts,
                learnedSkills,
                relatedSessions,
                promptHookInstructions,
              ),
            );
            shouldRefreshContext = true;
          }
          if (shouldRefreshContext) {
            rebuildContext(contextEngine.getState().workspaceSnapshot, true, "ingest");
          }

          if (resolved.toolName === "run_verification") {
            verificationExecution = (result.data ?? null) as VerificationExecutionResult | null;
            verifiedRevision = mutationRevision;
          }

          if (result.interrupt) {
            activeBlockReason = buildToolInterruptSummary(result.interrupt);
          } else if (!result.ok) {
            failedToolCount += 1;
            toolFailureCount += 1;
          } else {
            toolSuccessCount += 1;
          }
          await this.emitEvent({
            type: result.interrupt ? "tool.blocked" : result.ok ? "tool.completed" : "tool.failed",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            toolCallId: resolved.id,
            toolName: resolved.toolName,
            status: result.interrupt ? "interrupted" : result.ok ? "ok" : "failed",
            summary: redactedResult.summary,
            payload: result.interrupt ? createToolInterruptEventPayload(result.interrupt, redactedResult.data) : redactedResult.data,
            presentation: redactedResult.presentation,
          });
          if (!result.ok || resolved.toolName === "run_verification" || resolved.toolName === "spawn_subagent" || resolved.toolName === "wait_subagent" || resolved.toolName === "message_subagent" || resolved.toolName === "pause_subagent" || resolved.toolName === "resume_subagent" || resolved.toolName === "interrupt_subagent" || resolved.toolName === "run_swarm" || resolved.toolName === "save_memory" || resolved.toolName === "save_profile_fact") {
            persistAutomaticMemory({
              scope: "thread",
              content: `${resolved.toolName}: ${redactedResult.summary}`,
              tags: ["session", "tool", result.ok ? "success" : "failure", resolved.toolName],
            });
          }
          if (result.interrupt) {
            persistAutomaticMemory({
              scope: "thread",
              content: `${resolved.toolName}: ${buildToolInterruptSummary(result.interrupt)}`,
              tags: ["session", "tool", "blocked", resolved.toolName],
            });
            break;
          }
        } catch (error) {
          const summary = error instanceof Error ? error.message : String(error);
          recentFailureReason = summary;
          activeFailureReason = summary;
          toolEvents.push(
            this.sessionStore.recordToolEvent({
              runId: runRecord.id,
              toolCallId: resolved.id,
              toolName: resolved.toolName,
              riskTier: assessment.riskTier,
              status: "failed",
              summary,
            }),
          );
          await emitToolLifecycleHookDiagnostics({
            toolCallId: resolved.id,
            phase: "post",
            toolName: resolved.toolName,
            args: resolved.args,
            status: "failed",
            summary,
            assessment,
          });
          toolObservations.push({
            toolName: resolved.toolName,
            ok: false,
            summary,
          });
          await this.emitEvent({
            type: "tool.failed",
            at: new Date().toISOString(),
            workspaceId: workspaceRecord.id,
            threadId: threadRecord.id,
            runId: runRecord.id,
            toolCallId: resolved.id,
            toolName: resolved.toolName,
            status: "failed",
            summary,
          });
          persistAutomaticMemory({
            scope: "thread",
            content: `${resolved.toolName}: ${summary}`,
            tags: ["session", "tool", "failure", resolved.toolName],
          });
          failedToolCount += 1;
          toolFailureCount += 1;
        }
      }
      }
      await maybeEnforceMutationProgress();
      const latestVerification = assessVerification(verificationPlan, verificationExecution);
      if (
        iteration + 1 >= maxIterations &&
        (activeFailureReason || latestVerification.status === "failed") &&
        (mutatingToolSucceeded || toolFailureCount > 0) &&
        extendRecoveryBudget(activeFailureReason ? "a failed tool call" : "failed verification")
      ) {
        await refreshContextFromWorkspace();
        continue;
      }
      if (
        iteration + 1 >= maxIterations &&
        mutatingToolSucceeded &&
        verificationPlan.commands.length > 0 &&
        verifiedRevision < mutationRevision &&
        extendRecoveryBudget("pending verification")
      ) {
        await refreshContextFromWorkspace();
        continue;
      }
      if (interruptedRequest) {
        break;
      }
      if (shouldPauseForSubagentPolling(executedToolNames, subagentController)) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, DEFAULT_SUBAGENT_POLL_DELAY_MS));
      }
    }

    if (interruptedRequest) {
      const verification = assessVerification(verificationPlan, verificationExecution);
      return finalizeRun({
        status: "interrupted",
        verification,
        assistantText: formatInterruptedAssistantText(interruptedRequest),
      });
    }

    if (mutatingToolSucceeded && verificationPlan.commands.length > 0 && verifiedRevision < mutationRevision) {
      await executeAutomaticVerification();
    }
    if (
      !verificationExecution &&
      hasExplicitVerificationCommands &&
      taskContract.verificationMode === "required"
    ) {
      await executeAutomaticVerification();
    }
    if (
      !mutatingToolSucceeded &&
      objectiveSuggestsMutation(input.objective) &&
      !hasSuccessfulDelegationObservation(toolObservations) &&
      verificationPlan.commands.length > 0 &&
      !verificationExecution
    ) {
      await executeAutomaticVerification();
    }

    throwIfAborted();
    let verification = assessVerification(verificationPlan, verificationExecution);
    try {
      finalWorkspaceSnapshot = await execution.workspace.inspect();
    } catch {
      finalWorkspaceSnapshot = workspaceSnapshot;
    }

    if (toolObservations.length > 0) {
      await refreshMemoryRecall(buildMemoryRecallQuery(assistantText), "onPreCompress", finalWorkspaceSnapshot);
      rebuildContext(finalWorkspaceSnapshot, false, "compact");
      throwIfAborted();
      const finalTurn = await turnModelClient.generateTurn({
        context,
        taskContract,
        availableTools: [],
        toolResults: buildToolResultsForModel(),
      });
      applyTurnMetrics(finalTurn, {
        modelProfilesUsed,
        usageTotals,
      });
      turnCount += 1;
      assistantText = finalTurn.assistantText.trim() || assistantText;
      if (finalTurn.toolCalls.length > 0) {
        const requestedTools = finalTurn.toolCalls.map((toolCall) => toolCall.toolName).join(", ");
        const summary = `Model requested tool call(s) after tool execution had closed: ${requestedTools}.`;
        recentFailureReason = summary;
        activeFailureReason = summary;
        failedToolCount += 1;
        toolFailureCount += 1;
        toolObservations.push({
          toolName: "final_tool_request",
          ok: false,
          summary,
          details: trimForModel(JSON.stringify(finalTurn.toolCalls), 2_000),
        });
      }
      await syncMemoryTurn(buildMemoryRecallQuery(assistantText), finalWorkspaceSnapshot);
    }

    if (
      objectiveSuggestsMutation(input.objective) &&
      !mutatingToolSucceeded &&
      !hasSuccessfulDelegationObservation(toolObservations) &&
      verificationPlan.commands.length > 0 &&
      verification.status === "skipped"
    ) {
      const summary =
        `Task appears to require repository changes, but no mutating tool succeeded and planned verification was not executed. ${verification.summary}`;
      recentFailureReason = summary;
      activeFailureReason = summary;
      verification = {
        status: "failed",
        summary,
        commands: verification.commands,
      };
      toolObservations.push({
        toolName: "completion_gate",
        ok: false,
        summary,
      });
    }

    await this.emitEvent({
      type: "verification.completed",
      at: new Date().toISOString(),
      workspaceId: workspaceRecord.id,
      threadId: threadRecord.id,
      runId: runRecord.id,
      status: verification.status,
      summary: verification.summary,
      payload: verificationExecution,
    });

    await maybeRunIndependentVerification(verification);
    const finalStatus = deriveRunStatus({
      blockedApprovals,
      mutatingToolSucceeded,
      verification,
      independentVerification,
      independentVerificationMode,
      failedToolCount,
    });
    await maybeRollbackAfterFinalFailure(finalStatus, verification);
    return finalizeRun({
      status: finalStatus,
      verification,
      assistantText,
    });
  }

  private resolveThread(
    workspace: WorkspaceRecord,
    input: RunTaskInput,
  ): { thread: ThreadRecord; resumedThread: boolean } {
    if (input.threadId) {
      const existing = this.sessionStore.getThread(input.threadId);
      if (!existing) {
        throw new Error(`Thread ${input.threadId} was not found.`);
      }
      if (existing.workspaceId !== workspace.id) {
        throw new Error(`Thread ${input.threadId} does not belong to workspace ${workspace.cwd}.`);
      }
      return {
        thread: this.sessionStore.touchThread(existing.id),
        resumedThread: true,
      };
    }

    if (input.continueLatest) {
      const recent = this.sessionStore.findRecentThread(workspace.id);
      if (recent) {
        return {
          thread: this.sessionStore.touchThread(recent.id),
          resumedThread: true,
        };
      }
    }

    return {
      thread: this.sessionStore.createThread(workspace.id, input.threadTitle ?? shortenTitle(input.objective)),
      resumedThread: false,
    };
  }

  private async prepareExecutionWorkspace(
    run: RunRecord,
    thread: ThreadRecord,
  ): Promise<{
    readonly executionDomain: ExecutionDomain;
    readonly sourceRoot: string;
    readonly executionRoot: string;
    readonly worktreePath: string | null;
    readonly worktreeBranch: string | null;
    readonly sandboxPath: string | null;
    readonly workspace: LocalWorkspaceService;
  }> {
    if (this.options.executionDomain === "workspace") {
      return {
        executionDomain: this.options.executionDomain,
        sourceRoot: this.workspace.root,
        executionRoot: this.workspace.root,
        worktreePath: null,
        worktreeBranch: null,
        sandboxPath: null,
        workspace: this.workspace,
      };
    }

    if (this.options.executionDomain === "sandbox") {
      const sandboxName = `run-${sanitizeSegment(run.id.slice(0, 8))}`;
      const created = await this.workspace.createSandbox(sandboxName);
      const executionWorkspace = new LocalWorkspaceService(
        created.path,
        join(this.workspace.artifactsRoot, "sandboxes", sanitizeSegment(run.id)),
        createWorkspaceExecutionPolicy("sandbox"),
      );
      await executionWorkspace.ensureReady();

      return {
        executionDomain: "sandbox",
        sourceRoot: this.workspace.root,
        executionRoot: created.path,
        worktreePath: null,
        worktreeBranch: null,
        sandboxPath: created.path,
        workspace: executionWorkspace,
      };
    }

    const sourceSnapshot = await this.workspace.inspect();
    if (!sourceSnapshot.repoRoot) {
      throw new Error("Worktree execution requires a git repository.");
    }

    const relativeSubpath = relative(sourceSnapshot.repoRoot, this.workspace.root);
    const worktreeName = `run-${sanitizeSegment(run.id.slice(0, 8))}`;
    const worktreeBranch = `omni/${sanitizeSegment(thread.id.slice(0, 8))}/${sanitizeSegment(run.id.slice(0, 8))}`;
    const created = await this.workspace.createWorktree(worktreeName, worktreeBranch);
    const executionRoot =
      relativeSubpath && relativeSubpath !== "." ? join(created.path, relativeSubpath) : created.path;

    const executionWorkspace = new LocalWorkspaceService(
      executionRoot,
      join(this.workspace.artifactsRoot, "worktrees", sanitizeSegment(run.id)),
      createWorkspaceExecutionPolicy("worktree"),
    );
    await executionWorkspace.ensureReady();

    return {
      executionDomain: "worktree",
      sourceRoot: this.workspace.root,
      executionRoot,
      worktreePath: created.path,
      worktreeBranch: created.branch,
      sandboxPath: null,
      workspace: executionWorkspace,
    };
  }

  private async resolveApproval(
    toolCall: ToolCallRequest,
    assessment: ToolRiskAssessment,
    decision: ReturnType<typeof resolveApprovalDecision>,
    scope: { readonly workspaceId: string; readonly threadId: string },
  ): Promise<boolean> {
    if (decision === "allow") {
      return true;
    }
    if (decision === "deny") {
      return false;
    }
    const grantRequest = {
      assessment,
      args: toolCall.args,
      workspaceId: scope.workspaceId,
      threadId: scope.threadId,
    };
    const matchingGrant = this.options.approvalGrants?.findGrant(grantRequest);
    if (matchingGrant) {
      this.options.approvalGrants?.consumeGrant(matchingGrant.id);
      return true;
    }
    if (!this.options.approvalHandler) {
      return false;
    }
    const result = await this.options.approvalHandler({
      assessment,
      toolCall,
    });
    if (typeof result === "boolean") {
      return result;
    }
    if (typeof result === "string") {
      if (result !== "once") {
        this.options.approvalGrants?.addGrant(result, grantRequest);
      }
      return true;
    }
    if (!result.approved) {
      return false;
    }
    if (result.scope && result.scope !== "once") {
      this.options.approvalGrants?.addGrant(result.scope, grantRequest);
    }
    return true;
  }

  private async emitEvent(event: AgentRuntimeEvent): Promise<void> {
    await this.options.eventHandler?.({
      ...event,
      summary: event.summary ? redactSensitiveText(event.summary) : event.summary,
      payload: event.payload === undefined ? undefined : redactSensitiveValue(event.payload),
      presentation: event.presentation
        ? (redactSensitiveValue(event.presentation) as ToolPresentation)
        : event.presentation,
    });
  }
}

class LocalSubagentController implements SubagentController {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly pauseWaiters = new Map<string, Array<() => void>>();
  private readonly timeoutHandles = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly runningJobs = new Map<string, Promise<void>>();
  private readonly ownedJobIds = new Set<string>();
  private isShuttingDown = false;

  public constructor(
    private readonly input: {
      readonly sessionStore: SqliteSessionStore;
      readonly workspaceRecord: WorkspaceRecord;
      readonly parentThreadId: string;
      readonly parentRunId: string;
      readonly baseWorkspace: LocalWorkspaceService;
      readonly toolRegistry: ToolRegistry;
      readonly modelClient: ModelClient;
      readonly extensionRegistry: ExtensionRegistry;
      readonly memoryProviderCoordinator: MemoryProviderCoordinator;
      readonly parentOptions: AgentRuntimeOptions;
      readonly subagentRuntime: SubagentRuntimeContext;
      readonly prepareContextHandoff?: (request: SubagentExecutionRequest, job: SubagentJobRecord) => string[];
      readonly onSubagentSettled?: (job: SubagentJobRecord) => void | Promise<void>;
      readonly eventHandler?: (event: AgentRuntimeEvent) => void | Promise<void>;
    },
  ) {}

  public async spawn(request: SubagentExecutionRequest): Promise<SubagentJobRecord> {
    if (this.isShuttingDown) {
      throw new Error("Subagent controller is shutting down.");
    }
    const executionDomain = await this.resolveExecutionDomain(request.executionDomain);
    const jobId = randomUUID();
    const now = new Date().toISOString();
    const authority = resolveSubagentAuthority(request);
    const mode = resolveSubagentExecutionMode(request);
    const outcomeVisibility = resolveSubagentOutcomeVisibility(request, mode);
    const sessionMode = request.sessionMode ?? "run";
    const budget = resolveSubagentBudget(request, authority);
    const role = request.role?.trim() || (authority === "orchestrator" ? "planner" : "worker");
    const depth = this.input.subagentRuntime.currentDepth + 1;
    const parentJobId = this.input.subagentRuntime.currentJobId ?? undefined;
    const rootJobId = this.input.subagentRuntime.rootJobId ?? jobId;
    const roleRuntimeOverride = resolveRoleRuntimeOverride(normalizeAgentRole(role), this.input.parentOptions);
    const parent = parentJobId ? this.get(parentJobId) : null;
    const inheritedMaxDepth = parent?.maxDepth ?? this.input.subagentRuntime.orchestration.maxDepth;
    const inheritedMaxConcurrentChildren = parent?.maxConcurrentChildren ?? this.input.subagentRuntime.orchestration.maxConcurrent;
    const maxDepth = clampSubagentBudgetValue(
      request.maxDepth,
      inheritedMaxDepth,
      1,
      this.input.subagentRuntime.orchestration.maxDepth,
    );
    const maxConcurrentChildren = clampSubagentBudgetValue(
      request.maxConcurrentChildren,
      inheritedMaxConcurrentChildren,
      1,
      this.input.subagentRuntime.orchestration.maxConcurrent,
    );
    const sessionThreadId = resolveSubagentSessionThreadId({
      request,
      sessionMode,
      workspaceRecord: this.input.workspaceRecord,
      sessionStore: this.input.sessionStore,
    });
    const toolPolicyContext = resolveRuntimeToolPolicyContext({
      base: {
        ...(this.input.parentOptions.toolPolicyContext ?? {}),
        ...(roleRuntimeOverride?.toolPolicyContext ?? {}),
      },
      executionDomain,
      threadId: sessionThreadId ?? this.input.parentThreadId,
      sessionId: sessionThreadId ?? this.input.parentOptions.toolPolicyContext?.sessionId ?? this.input.parentThreadId,
    });
    const resolvedToolPolicy = resolveAllowedSubagentTools(
      request.allowedTools,
      this.input.toolRegistry,
      authority,
      this.input.extensionRegistry,
      this.input.parentOptions.toolPolicy,
      toolPolicyContext,
      role,
    );
    const allowedTools = resolvedToolPolicy.toolNames;
    const targetPaths = normalizeSubagentTargetPaths(request.targetPaths);
    const queued: SubagentJobRecord = {
      id: jobId,
      objective: request.objective,
      sessionMode,
      role,
      mode,
      outcomeVisibility,
      authority,
      rootJobId,
      parentJobId,
      depth,
      maxDepth,
      maxConcurrentChildren,
      childJobIds: [],
      status: "queued",
      executionDomain,
      budget,
        pluginDirs: request.pluginDirs,
        returnedArtifactKinds: request.returnedArtifactKinds,
        targetPaths,
        allowedTools,
        toolPolicyTrace: resolvedToolPolicy.trace,
      attempts: 0,
      createdAt: now,
      queuedAt: now,
      blockedReason: undefined,
      blockedByJobIds: undefined,
      blockedPaths: undefined,
      queuePosition: 0,
      updatedAt: now,
      messages: [],
      progressEvents: [],
      threadId: sessionThreadId ?? undefined,
    };
    this.ownedJobIds.add(jobId);
    activeSubagentControllers.set(jobId, this);
    this.input.subagentRuntime.orchestration.jobs.set(jobId, queued);
    this.persistJob(queued);
    if (parentJobId && parent) {
      this.updateJob(parentJobId, {
        childJobIds: [...parent.childJobIds, jobId],
      });
    }
    if (depth > maxDepth) {
      const failedJob = this.updateJob(jobId, {
        status: "failed",
        error: `Subagent depth ${depth} exceeds the maximum depth ${maxDepth}.`,
        completedAt: now,
        queuePosition: undefined,
        completion: {
          status: "failed",
          verificationStatus: "not-run",
          changedFiles: [],
          finalResponse: "",
          error: `Subagent depth ${depth} exceeds the maximum depth ${maxDepth}.`,
        },
      });
      void this.emitSubagentProgress(failedJob, "depth-limit");
      return failedJob;
    }
    this.input.subagentRuntime.orchestration.queuedJobIds.push(jobId);
    this.input.subagentRuntime.orchestration.pendingLaunches.set(jobId, () => {
      const runPromise = this.runJob(jobId, request, executionDomain).finally(() => {
        this.runningJobs.delete(jobId);
      });
      this.runningJobs.set(jobId, runPromise);
      void runPromise;
    });
    this.refreshQueuePositions();
    void this.emitSubagentProgress(this.get(jobId)!, "queued");
    this.processQueue();
    return this.get(jobId)!;
  }

  public get(jobId: string): SubagentJobRecord | null {
    return this.input.subagentRuntime.orchestration.jobs.get(jobId) ?? null;
  }

  public list(): SubagentJobRecord[] {
    const queuedPositions = new Map<string, number>();
    for (const [index, jobId] of this.input.subagentRuntime.orchestration.queuedJobIds.entries()) {
      queuedPositions.set(jobId, index + 1);
    }
    return Array.from(this.input.subagentRuntime.orchestration.jobs.values())
      .map((job) => ({
        ...job,
        queuePosition: queuedPositions.get(job.id),
      }))
      .sort((left, right) => {
        const leftQueued = typeof left.queuePosition === "number";
        const rightQueued = typeof right.queuePosition === "number";
        if (leftQueued && rightQueued && left.queuePosition !== right.queuePosition) {
          return (left.queuePosition ?? 0) - (right.queuePosition ?? 0);
        }
        if (leftQueued !== rightQueued) {
          return leftQueued ? -1 : 1;
        }
        return right.createdAt.localeCompare(left.createdAt);
      });
  }

  public async wait(jobId: string, timeoutMs = 300_000): Promise<SubagentJobRecord> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const job = this.get(jobId);
      if (!job) {
        throw new Error(`Subagent job ${jobId} was not found.`);
      }
      if (isTerminalSubagentStatus(job.status)) {
        return job;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Timed out waiting for subagent job ${jobId}.`);
  }

  public async waitAny(jobIds?: readonly string[], timeoutMs = 300_000): Promise<SubagentJobRecord> {
    const trackedJobIds = jobIds?.length
      ? Array.from(new Set(jobIds.map((entry) => entry.trim()).filter(Boolean)))
      : Array.from(this.ownedJobIds);
    if (trackedJobIds.length === 0) {
      throw new Error("waitAny requires at least one known subagent job.");
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const terminalJobs = trackedJobIds
        .map((jobId) => this.get(jobId))
        .filter((job): job is SubagentJobRecord => job !== null)
        .filter((job) => isTerminalSubagentStatus(job.status))
        .sort((left, right) => (left.completedAt ?? left.updatedAt).localeCompare(right.completedAt ?? right.updatedAt));
      if (terminalJobs.length > 0) {
        return terminalJobs[0]!;
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Timed out waiting for any of ${trackedJobIds.length} subagent job(s).`);
  }

  public async pause(jobId: string): Promise<SubagentJobRecord> {
    const current = this.get(jobId);
    if (!current) {
      throw new Error(`Subagent job ${jobId} was not found.`);
    }
    if (isTerminalSubagentStatus(current.status) || current.status === "paused") {
      return current;
    }
    const paused = this.updateJob(jobId, {
      status: "paused",
      blockedReason: undefined,
      blockedByJobIds: undefined,
      blockedPaths: undefined,
      pausedFromStatus: current.status === "running" ? "running" : "queued",
    });
    void this.emitSubagentProgress(paused, "paused");
    return paused;
  }

  public async resume(jobId: string): Promise<SubagentJobRecord> {
    const current = this.get(jobId);
    if (!current) {
      throw new Error(`Subagent job ${jobId} was not found.`);
    }
    if (current.status !== "paused") {
      return current;
    }
    const nextStatus = current.pausedFromStatus ?? (current.startedAt ? "running" : "queued");
    const resumed = this.updateJob(jobId, {
      status: nextStatus,
      blockedReason: undefined,
      blockedByJobIds: undefined,
      blockedPaths: undefined,
      pausedFromStatus: undefined,
    });
    this.releasePauseWaiters(jobId);
    if (nextStatus === "queued") {
      this.processQueue();
    }
    void this.emitSubagentProgress(resumed, "resumed");
    return resumed;
  }

  public async interrupt(jobId: string): Promise<SubagentJobRecord> {
    const current = this.get(jobId);
    if (!current) {
      throw new Error(`Subagent job ${jobId} was not found.`);
    }
    if (isTerminalSubagentStatus(current.status)) {
      return current;
    }
    const interruptionMessage = "Interrupted by parent agent.";
    const subtreeJobIds = this.collectSubtreeJobIds(jobId);
    const synchronouslyInterrupted: SubagentJobRecord[] = [];

    for (const descendantJobId of subtreeJobIds) {
      const job = this.get(descendantJobId);
      if (!job || isTerminalSubagentStatus(job.status)) {
        continue;
      }
      const abortController = this.abortControllers.get(descendantJobId);
      if (abortController && !abortController.signal.aborted) {
        abortController.abort(new SubagentAbortError("interrupted", interruptionMessage));
      }
      this.removeQueuedJob(descendantJobId);
      this.releasePauseWaiters(descendantJobId);
      synchronouslyInterrupted.push(
        this.updateJob(descendantJobId, {
          status: "interrupted",
          error: interruptionMessage,
          completedAt: new Date().toISOString(),
          blockedReason: undefined,
          blockedByJobIds: undefined,
          blockedPaths: undefined,
          pausedFromStatus: undefined,
          queuePosition: undefined,
          completion: {
            status: "interrupted",
            verificationStatus: "not-run",
            changedFiles: [],
            finalResponse: "",
            error: interruptionMessage,
          },
        }),
      );
    }

    this.refreshQueuePositions();
    this.processQueue();
    for (const job of synchronouslyInterrupted) {
      void this.emitSubagentProgress(job, "interrupted");
    }
    return this.get(jobId)!;
  }

  public async send(jobId: string, message: string): Promise<SubagentJobRecord> {
    const current = this.get(jobId);
    if (!current) {
      throw new Error(`Subagent job ${jobId} was not found.`);
    }
    if (isTerminalSubagentStatus(current.status)) {
      throw new Error(`Subagent job ${jobId} is already ${current.status} and cannot receive new instructions.`);
    }
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      throw new Error("Subagent message cannot be empty.");
    }
    const updated = this.updateJob(jobId, {
      messages: [
        ...current.messages,
        {
          id: randomUUID(),
          author: "parent",
          content: trimmedMessage,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    void this.emitSubagentProgress(updated, "message");
    return updated;
  }

  public async cancel(jobId: string): Promise<SubagentJobRecord> {
    const current = this.get(jobId);
    if (!current) {
      throw new Error(`Subagent job ${jobId} was not found.`);
    }
    if (isTerminalSubagentStatus(current.status)) {
      return current;
    }
    const cancellationMessage = "Cancelled by parent agent.";
    const subtreeJobIds = this.collectSubtreeJobIds(jobId);
    const synchronouslyCancelled: SubagentJobRecord[] = [];

    for (const descendantJobId of subtreeJobIds) {
      const job = this.get(descendantJobId);
      if (!job || isTerminalSubagentStatus(job.status)) {
        continue;
      }
      const abortController = this.abortControllers.get(descendantJobId);
      if (abortController && !abortController.signal.aborted) {
        abortController.abort(new SubagentAbortError("cancelled", cancellationMessage));
      }
      this.removeQueuedJob(descendantJobId);
      this.releasePauseWaiters(descendantJobId);
      synchronouslyCancelled.push(
        this.updateJob(descendantJobId, {
          status: "cancelled",
          error: cancellationMessage,
          completedAt: new Date().toISOString(),
          blockedReason: undefined,
          blockedByJobIds: undefined,
          blockedPaths: undefined,
          queuePosition: undefined,
          completion: {
            status: "cancelled",
            verificationStatus: "not-run",
            changedFiles: [],
            finalResponse: "",
            error: cancellationMessage,
          },
        }),
      );
    }

    this.refreshQueuePositions();
    this.processQueue();
    for (const job of synchronouslyCancelled) {
      void this.emitSubagentProgress(job, "cancelled");
    }
    return this.get(jobId)!;
  }

  public async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    const cancellationMessage = "Parent run completed before observing this subagent result.";
    const completedAt = new Date().toISOString();

    for (const jobId of this.ownedJobIds) {
      const job = this.get(jobId);
      if (!job || isTerminalSubagentStatus(job.status)) {
        continue;
      }
      const abortController = this.abortControllers.get(jobId);
      if (abortController && !abortController.signal.aborted) {
        abortController.abort(new SubagentAbortError("cancelled", cancellationMessage));
      }
      if (job.status === "queued") {
        this.removeQueuedJob(jobId);
      }
      this.releasePauseWaiters(jobId);
      if (!abortController) {
        this.updateJob(jobId, {
          status: "cancelled",
          error: cancellationMessage,
          completedAt,
          blockedReason: undefined,
          blockedByJobIds: undefined,
          blockedPaths: undefined,
          queuePosition: undefined,
          completion: {
            status: "cancelled",
            verificationStatus: "not-run",
            changedFiles: [],
            finalResponse: "",
            error: cancellationMessage,
          },
        });
      }
    }

    this.refreshQueuePositions();
    await Promise.allSettled(Array.from(this.runningJobs.values()));
    this.unregisterOwnedJobs();
  }

  private async runJob(
    jobId: string,
    request: SubagentExecutionRequest,
    executionDomain: ExecutionDomain,
  ): Promise<void> {
    const current = this.get(jobId);
    if (!current || current.status === "cancelled") {
      return;
    }
    const maxAttempts = current.budget.maxRetries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const activeJob = this.get(jobId);
      if (!activeJob || activeJob.status === "cancelled") {
        return;
      }

      let childExtensionRegistry: ExtensionRegistry | null = null;
      const abortController = new AbortController();
      this.abortControllers.set(jobId, abortController);
      const timeoutHandle = setTimeout(() => {
        if (!abortController.signal.aborted) {
          abortController.abort(
            new SubagentAbortError(
              "timed_out",
              `Subagent job ${jobId} timed out after ${activeJob.budget.timeoutMs}ms.`,
            ),
          );
        }
      }, activeJob.budget.timeoutMs);
      this.timeoutHandles.set(jobId, timeoutHandle);
      const startedAt = new Date().toISOString();
      this.updateJob(jobId, {
        status: activeJob.status === "paused" ? "paused" : "running",
        attempts: attempt,
        startedAt: activeJob.startedAt ?? startedAt,
        blockedReason: undefined,
        blockedByJobIds: undefined,
        blockedPaths: undefined,
        error: undefined,
        completion: undefined,
        queuePosition: undefined,
      });
      void this.emitSubagentProgress(
        this.get(jobId)!,
        activeJob.status === "paused" ? "paused" : attempt > 1 ? "retrying" : "running",
      );

      try {
        const runtimeToolPolicyContext = resolveRuntimeToolPolicyContext({
          base: {
            ...(this.input.parentOptions.toolPolicyContext ?? {}),
            ...(resolveRoleRuntimeOverride(normalizeAgentRole(activeJob.role), this.input.parentOptions)?.toolPolicyContext ?? {}),
          },
          executionDomain,
          threadId: activeJob.threadId ?? this.input.parentThreadId,
          sessionId: activeJob.threadId ?? this.input.parentOptions.toolPolicyContext?.sessionId ?? this.input.parentThreadId,
        });
        const activeRole = normalizeAgentRole(activeJob.role);
        const activeRoleSemantics = resolveRoleExecutionSemantics(
          activeRole,
          this.input.parentOptions.verificationMode,
          this.input.parentOptions.independentVerificationMode,
        );
        let runtimeExtensionRegistry = this.input.extensionRegistry;
        let runtimeToolRegistry = this.input.toolRegistry.cloneSubset(
          resolveRuntimeSubagentTools(
            activeJob,
            this.input.toolRegistry,
            this.input.extensionRegistry,
            this.input.parentOptions.toolPolicy,
            runtimeToolPolicyContext,
          ),
        );

        if (request.pluginDirs && request.pluginDirs.length > 0) {
          childExtensionRegistry = await loadExtensionRegistry({
            cwd: this.input.baseWorkspace.root,
            pluginDirs: request.pluginDirs,
            mcpRuntimePool: this.input.extensionRegistry.getMcpRuntimePool() ?? undefined,
          });
          runtimeExtensionRegistry = mergeExtensionRegistries(this.input.extensionRegistry, childExtensionRegistry);
          runtimeToolRegistry.registerMany(runtimeExtensionRegistry.listToolDefinitions());
          runtimeToolRegistry.registerMany(createExtensionRuntimeTools(runtimeExtensionRegistry));
          runtimeToolRegistry = runtimeToolRegistry.cloneSubset(
            resolveRuntimeSubagentTools(
              activeJob,
              runtimeToolRegistry,
              runtimeExtensionRegistry,
              this.input.parentOptions.toolPolicy,
              runtimeToolPolicyContext,
            ),
          );
        }

        const handoffInstructions = mergeUniqueStrings(
          request.handoffInstructions,
          this.input.prepareContextHandoff?.(request, activeJob),
          modeSpecificHandoffInstructions(activeJob),
        );

        const runtime = new AgentRuntime(
          this.input.sessionStore,
          new LocalWorkspaceService(
            this.input.baseWorkspace.root,
            join(this.input.baseWorkspace.artifactsRoot, "subagents", sanitizeSegment(jobId), `attempt-${attempt}`),
            createSubagentWorkspaceExecutionPolicy(activeRole, executionDomain),
          ),
          runtimeToolRegistry,
          this.input.modelClient,
          runtimeExtensionRegistry,
          {
            approvalPolicy: this.input.parentOptions.approvalPolicy,
            executionDomain,
            verificationMode: activeRoleSemantics.verificationMode,
            independentVerificationMode: activeRoleSemantics.independentVerificationMode,
            toolPolicy: this.input.parentOptions.toolPolicy,
            toolPolicyContext: resolveRuntimeToolPolicyContext({
              base: this.input.parentOptions.toolPolicyContext,
              executionDomain,
              threadId: activeJob.threadId ?? this.input.parentThreadId,
              sessionId: activeJob.threadId ?? this.input.parentOptions.toolPolicyContext?.sessionId ?? this.input.parentThreadId,
            }),
            roleRuntimeOverrides: this.input.parentOptions.roleRuntimeOverrides,
            memoryProviders: this.input.parentOptions.memoryProviders,
            approvalHandler: this.input.parentOptions.approvalHandler,
            subagentRuntime: {
              currentJobId: activeJob.id,
              currentDepth: activeJob.depth,
              rootJobId: activeJob.rootJobId,
              orchestration: this.input.subagentRuntime.orchestration,
            },
            eventHandler: this.input.eventHandler,
            awaitExecutionPermit: () => this.awaitExecutionPermit(activeJob.id),
          },
        );

        const summary = await runtime.runTask({
          objective: request.objective,
          role: activeRole,
          threadTitle: request.threadTitle ?? shortenTitle(`Subagent: ${request.objective}`),
          threadId: activeJob.sessionMode === "thread" ? activeJob.threadId : undefined,
          extraInstructions: handoffInstructions,
          verificationCommands: request.verificationCommands,
          maxIterations: activeJob.budget.maxIterations,
          abortSignal: abortController.signal,
          constraints: mergeUniqueStrings(
            [
              "Work independently and return only the information needed by the parent agent.",
              "Avoid broad refactors unless the subtask explicitly requires them.",
              `Current subagent depth: ${activeJob.depth}/${activeJob.maxDepth}.`,
              activeJob.authority === "leaf"
                ? "Do not delegate to additional subagents."
                  : activeJob.depth >= activeJob.maxDepth
                    ? "You have reached the maximum subagent depth. Do not delegate further."
                    : `Delegate only when decomposition materially improves the result and keep child work within depth ${activeJob.maxDepth}.`,
              ],
              activeRoleSemantics.extraConstraints,
              buildRoleConstraints(activeRole),
            ),
            successCriteria: mergeUniqueStrings(
              activeRoleSemantics.defaultSuccessCriteria,
              ["Finish the scoped subtask and return a concise structured result for the parent agent."],
            ),
          });
        this.clearJobExecution(jobId);
        const terminalJob = this.get(jobId);
        if (terminalJob?.status === "cancelled" || terminalJob?.status === "interrupted") {
          this.updateJob(jobId, {
            threadId: summary.thread.id,
            runId: summary.run.id,
            finalResponse: summary.finalResponse,
            blockedReason: undefined,
            blockedByJobIds: undefined,
            blockedPaths: undefined,
            completion: buildSubagentCompletionReport(summary, terminalJob.status, activeJob.role, terminalJob.error),
          });
          await this.notifySubagentSettled(jobId);
          await this.persistSubagentOutcomeMemory(jobId, request.objective, terminalJob.status, summary);
          return;
        }

        if (abortController.signal.aborted && abortController.signal.reason instanceof SubagentAbortError) {
          const abortError = abortController.signal.reason;
          const status = abortError.kind;
          this.updateJob(jobId, {
            status,
            threadId: summary.thread.id,
            runId: summary.run.id,
            finalResponse: summary.finalResponse,
            error: abortError.message,
            completedAt: new Date().toISOString(),
            blockedReason: undefined,
            blockedByJobIds: undefined,
            blockedPaths: undefined,
            completion: buildSubagentCompletionReport(summary, status, activeJob.role, abortError.message),
          });
          void this.emitSubagentProgress(this.get(jobId)!, status);
          await this.notifySubagentSettled(jobId);
          await this.persistSubagentOutcomeMemory(jobId, request.objective, status, summary);
          return;
        }

        if (summary.run.status === "failed" && attempt < maxAttempts) {
          continue;
        }

        const finalStatus = summary.run.status === "failed" ? "failed" : "completed";
        this.updateJob(jobId, {
          status: finalStatus,
          threadId: summary.thread.id,
          runId: summary.run.id,
          finalResponse: summary.finalResponse,
          error: finalStatus === "failed" ? summary.finalResponse : undefined,
          completedAt: new Date().toISOString(),
          blockedReason: undefined,
          blockedByJobIds: undefined,
          blockedPaths: undefined,
          completion: buildSubagentCompletionReport(
            summary,
            finalStatus,
            activeJob.role,
            finalStatus === "failed" ? summary.finalResponse : undefined,
          ),
        });
        void this.emitSubagentProgress(this.get(jobId)!, finalStatus);
        await this.notifySubagentSettled(jobId);
        await this.persistSubagentOutcomeMemory(jobId, request.objective, finalStatus, summary);
        return;
      } catch (error) {
        this.clearJobExecution(jobId);
        const terminalJob = this.get(jobId);
        if (terminalJob?.status === "cancelled" || terminalJob?.status === "interrupted") {
          return;
        }
        const normalizedError =
          error instanceof SubagentAbortError
            ? error
            : abortController.signal.reason instanceof SubagentAbortError
              ? abortController.signal.reason
              : error instanceof Error
                ? error
                : new Error(String(error));

        if (normalizedError instanceof SubagentAbortError) {
          this.updateJob(jobId, {
            status: normalizedError.kind,
            error: normalizedError.message,
            completedAt: new Date().toISOString(),
            blockedReason: undefined,
            blockedByJobIds: undefined,
            blockedPaths: undefined,
            completion: {
              status: normalizedError.kind,
              verificationStatus: "not-run",
              changedFiles: [],
              finalResponse: "",
              error: normalizedError.message,
            },
          });
          void this.emitSubagentProgress(this.get(jobId)!, normalizedError.kind);
          await this.notifySubagentSettled(jobId);
          await this.persistSubagentFailureMemory(jobId, request.objective, normalizedError.message, normalizedError.kind);
          return;
        }

        if (attempt < maxAttempts) {
          continue;
        }

        this.updateJob(jobId, {
          status: "failed",
          error: normalizedError.message,
          completedAt: new Date().toISOString(),
          blockedReason: undefined,
          blockedByJobIds: undefined,
          blockedPaths: undefined,
          completion: {
            status: "failed",
            verificationStatus: "not-run",
            changedFiles: [],
            finalResponse: "",
            error: normalizedError.message,
          },
        });
        void this.emitSubagentProgress(this.get(jobId)!, "failed");
        await this.notifySubagentSettled(jobId);
        await this.persistSubagentFailureMemory(jobId, request.objective, normalizedError.message, "failed");
        return;
      } finally {
        this.clearJobExecution(jobId);
        this.input.subagentRuntime.orchestration.activeJobIds.delete(jobId);
        this.processQueue();
        await childExtensionRegistry?.dispose();
      }
    }
  }

  private async notifySubagentSettled(jobId: string): Promise<void> {
    const job = this.get(jobId);
    if (!job || !isTerminalSubagentStatus(job.status)) {
      return;
    }
    this.input.sessionStore.releaseFileLeasesForJob(jobId);
    await this.input.onSubagentSettled?.(job);
  }

  private clearJobExecution(jobId: string): void {
    const timeoutHandle = this.timeoutHandles.get(jobId);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      this.timeoutHandles.delete(jobId);
    }
    this.abortControllers.delete(jobId);
  }

  private processQueue(): void {
    if (this.isShuttingDown) {
      return;
    }
    const orchestration = this.input.subagentRuntime.orchestration;
    while (
      orchestration.activeJobIds.size < orchestration.maxConcurrent &&
      orchestration.queuedJobIds.length > 0
    ) {
      let launchedJob = false;
      for (let queueIndex = 0; queueIndex < orchestration.queuedJobIds.length; queueIndex += 1) {
        const nextJobId = orchestration.queuedJobIds[queueIndex];
        if (!nextJobId) {
          continue;
        }
        const job = this.get(nextJobId);
        if (!job || isTerminalSubagentStatus(job.status)) {
          orchestration.queuedJobIds.splice(queueIndex, 1);
          orchestration.pendingLaunches.delete(nextJobId);
          queueIndex -= 1;
          continue;
        }
        if (job.status === "paused") {
          continue;
        }
        if (!this.canLaunchJob(job)) {
          continue;
        }
        if (!this.prepareJobForLaunch(job)) {
          continue;
        }
        const launcher = orchestration.pendingLaunches.get(nextJobId);
        if (!launcher) {
          orchestration.queuedJobIds.splice(queueIndex, 1);
          queueIndex -= 1;
          continue;
        }
        orchestration.queuedJobIds.splice(queueIndex, 1);
        orchestration.pendingLaunches.delete(nextJobId);
        orchestration.activeJobIds.add(nextJobId);
        this.refreshQueuePositions();
        launcher();
        launchedJob = true;
        break;
      }
      if (!launchedJob) {
        break;
      }
    }
    this.refreshQueuePositions();
  }

  private canLaunchJob(job: SubagentJobRecord): boolean {
    if (!job.parentJobId) {
      return true;
    }
    const parent = this.get(job.parentJobId);
    if (!parent) {
      return true;
    }
    const runningChildren = parent.childJobIds.reduce((count, childJobId) => {
      const childJob = this.get(childJobId);
      return childJob?.status === "running" ? count + 1 : count;
    }, 0);
    return runningChildren < parent.maxConcurrentChildren;
  }

  private prepareJobForLaunch(job: SubagentJobRecord): boolean {
    if (!job.targetPaths || job.targetPaths.length === 0) {
      if (job.blockedReason || job.blockedByJobIds?.length || job.blockedPaths?.length) {
        this.updateJob(job.id, {
          blockedReason: undefined,
          blockedByJobIds: undefined,
          blockedPaths: undefined,
        });
      }
      return true;
    }

    const conflicts = this.input.sessionStore.findFileLeaseConflicts({
      workspaceId: this.input.workspaceRecord.id,
      ownerJobId: job.id,
      paths: job.targetPaths,
    });
    if (conflicts.length > 0) {
      this.markJobBlockedOnLease(job, conflicts);
      return false;
    }

    try {
      this.input.sessionStore.acquireFileLeases({
        workspaceId: this.input.workspaceRecord.id,
        ownerJobId: job.id,
        ownerThreadId: job.threadId ?? this.input.parentThreadId,
        ownerRunId: this.input.parentRunId,
        paths: job.targetPaths,
      });
    } catch (error) {
      const refreshedConflicts = this.input.sessionStore.findFileLeaseConflicts({
        workspaceId: this.input.workspaceRecord.id,
        ownerJobId: job.id,
        paths: job.targetPaths,
      });
      if (refreshedConflicts.length > 0) {
        this.markJobBlockedOnLease(job, refreshedConflicts);
        return false;
      }
      throw error;
    }

    if (job.blockedReason || job.blockedByJobIds?.length || job.blockedPaths?.length) {
      this.updateJob(job.id, {
        blockedReason: undefined,
        blockedByJobIds: undefined,
        blockedPaths: undefined,
      });
    }
    return true;
  }

  private markJobBlockedOnLease(
    job: SubagentJobRecord,
    conflicts: Array<{
      readonly ownerJobId: string;
      readonly path: string;
    }>,
  ): void {
    const blockedByJobIds = Array.from(new Set(conflicts.map((entry) => entry.ownerJobId))).sort();
    const blockedPaths = Array.from(new Set(conflicts.map((entry) => entry.path))).sort();
    const blockedReason = `Waiting for file lease on ${blockedPaths.join(", ")} held by ${blockedByJobIds.join(", ")}.`;
    const current = this.get(job.id);
    if (
      current?.blockedReason === blockedReason &&
      JSON.stringify(current.blockedByJobIds ?? []) === JSON.stringify(blockedByJobIds) &&
      JSON.stringify(current.blockedPaths ?? []) === JSON.stringify(blockedPaths)
    ) {
      return;
    }
    const blockedJob = this.updateJob(job.id, {
      blockedReason,
      blockedByJobIds,
      blockedPaths,
    });
    void this.emitSubagentProgress(blockedJob, "blocked-on-lease");
  }

  private collectSubtreeJobIds(jobId: string): string[] {
    const visited = new Set<string>();
    const ordered: string[] = [];
    const visit = (candidateJobId: string): void => {
      if (visited.has(candidateJobId)) {
        return;
      }
      visited.add(candidateJobId);
      const job = this.get(candidateJobId);
      if (!job) {
        return;
      }
      ordered.push(candidateJobId);
      const discoveredChildJobIds = new Set(job.childJobIds);
      for (const candidate of this.input.subagentRuntime.orchestration.jobs.values()) {
        if (candidate.parentJobId === candidateJobId) {
          discoveredChildJobIds.add(candidate.id);
        }
      }
      for (const childJobId of discoveredChildJobIds) {
        visit(childJobId);
      }
    };
    visit(jobId);
    return ordered;
  }

  private removeQueuedJob(jobId: string): void {
    const orchestration = this.input.subagentRuntime.orchestration;
    const queueIndex = orchestration.queuedJobIds.indexOf(jobId);
    if (queueIndex >= 0) {
      orchestration.queuedJobIds.splice(queueIndex, 1);
    }
    orchestration.pendingLaunches.delete(jobId);
  }

  private refreshQueuePositions(): void {
    const queuedPositions = new Map<string, number>();
    for (const [index, queuedJobId] of this.input.subagentRuntime.orchestration.queuedJobIds.entries()) {
      queuedPositions.set(queuedJobId, index + 1);
    }
    for (const job of this.input.subagentRuntime.orchestration.jobs.values()) {
      const queuePosition = queuedPositions.get(job.id);
      const nextQueuePosition = queuePosition ?? undefined;
      if (job.queuePosition === nextQueuePosition) {
        continue;
      }
      this.updateJob(job.id, {
        queuePosition: nextQueuePosition,
      });
    }
  }

  private async awaitExecutionPermit(jobId: string): Promise<void> {
    while (true) {
      const job = this.get(jobId);
      if (!job) {
        throw new Error(`Subagent job ${jobId} was not found.`);
      }
      if (job.status !== "paused") {
        return;
      }
      await new Promise<void>((resolve) => {
        const waiters = this.pauseWaiters.get(jobId) ?? [];
        waiters.push(resolve);
        this.pauseWaiters.set(jobId, waiters);
      });
    }
  }

  private releasePauseWaiters(jobId: string): void {
    const waiters = this.pauseWaiters.get(jobId);
    if (!waiters || waiters.length === 0) {
      return;
    }
    this.pauseWaiters.delete(jobId);
    for (const resolve of waiters) {
      resolve();
    }
  }

  private async persistSubagentOutcomeMemory(
    jobId: string,
    objective: string,
    status: SubagentJobRecord["status"],
    summary: AgentRunSummary,
  ): Promise<void> {
    const context: MemoryDelegationContext = {
      sessionStore: this.input.sessionStore,
      workspace: this.input.baseWorkspace,
      workspaceRecord: this.input.workspaceRecord,
      parentThreadId: this.input.parentThreadId,
      agentId: this.input.parentOptions.toolPolicyContext?.agentId ?? null,
      jobId,
      objective,
      status,
      verification: summary.verification,
      changedFiles: summary.changedFiles,
      finalResponse: summary.finalResponse,
    };
    try {
      await this.input.memoryProviderCoordinator.onDelegation(context);
    } catch {
      // Delegation memories are best-effort and must not affect job completion.
    }
  }

  private async persistSubagentFailureMemory(
    jobId: string,
    objective: string,
    errorMessage: string,
    status: SubagentJobRecord["status"],
  ): Promise<void> {
    try {
      await this.input.memoryProviderCoordinator.onDelegation({
        sessionStore: this.input.sessionStore,
        workspace: this.input.baseWorkspace,
        workspaceRecord: this.input.workspaceRecord,
        parentThreadId: this.input.parentThreadId,
        agentId: this.input.parentOptions.toolPolicyContext?.agentId ?? null,
        jobId,
        objective,
        status,
        verification: {
          status: "skipped",
          summary: errorMessage,
          commands: [],
        },
        changedFiles: [],
        finalResponse: "",
        errorMessage,
      });
    } catch {
      // Failure memories are best-effort and must not affect job completion.
    }
  }

  private updateJob(jobId: string, patch: Partial<SubagentJobRecord>): SubagentJobRecord {
    const current = this.input.subagentRuntime.orchestration.jobs.get(jobId);
    if (!current) {
      throw new Error(`Subagent job ${jobId} was not found.`);
    }
    const updated: SubagentJobRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.input.subagentRuntime.orchestration.jobs.set(jobId, updated);
    this.persistJob(updated);
    return updated;
  }

  private persistJob(job: SubagentJobRecord): void {
    this.input.sessionStore.upsertSubagentJob(this.toPersistedJob(job));
  }

  private toPersistedJob(job: SubagentJobRecord): PersistedSubagentJobRecord {
    return {
      id: job.id,
      workspaceId: this.input.workspaceRecord.id,
      parentThreadId: this.input.parentThreadId,
      parentRunId: this.input.parentRunId,
      objective: job.objective,
      sessionMode: job.sessionMode,
      role: job.role,
      mode: job.mode,
      outcomeVisibility: job.outcomeVisibility,
      authority: job.authority,
      status: job.status,
      rootJobId: job.rootJobId,
      parentJobId: job.parentJobId,
      depth: job.depth,
      maxDepth: job.maxDepth,
      maxConcurrentChildren: job.maxConcurrentChildren,
      childJobIds: [...job.childJobIds],
      executionDomain: job.executionDomain,
      budget: {
        maxIterations: job.budget.maxIterations,
        timeoutMs: job.budget.timeoutMs,
        maxRetries: job.budget.maxRetries,
      },
      pluginDirs: job.pluginDirs ? [...job.pluginDirs] : undefined,
      allowedTools: job.allowedTools ? [...job.allowedTools] : undefined,
      returnedArtifactKinds: job.returnedArtifactKinds ? [...job.returnedArtifactKinds] : undefined,
      targetPaths: job.targetPaths ? [...job.targetPaths] : undefined,
      toolPolicyTrace: job.toolPolicyTrace ? [...job.toolPolicyTrace] : undefined,
      attempts: job.attempts,
      createdAt: job.createdAt,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      blockedReason: job.blockedReason,
      blockedByJobIds: job.blockedByJobIds ? [...job.blockedByJobIds] : undefined,
      blockedPaths: job.blockedPaths ? [...job.blockedPaths] : undefined,
      pausedFromStatus: job.pausedFromStatus,
      queuePosition: job.queuePosition,
      updatedAt: job.updatedAt,
      messages: [...job.messages],
      threadId: job.threadId,
      runId: job.runId,
      finalResponse: job.finalResponse,
      error: job.error,
      progressEvents: job.progressEvents ? [...job.progressEvents] : undefined,
      completion: job.completion
        ? {
            status: job.completion.status,
            verificationStatus: job.completion.verificationStatus,
            changedFiles: [...job.completion.changedFiles],
            finalResponse: job.completion.finalResponse,
            error: job.completion.error,
            structuredResult: job.completion.structuredResult
              ? {
                  kind: job.completion.structuredResult.kind,
                  status: job.completion.structuredResult.status,
                  summary: job.completion.structuredResult.summary,
                  bullets: job.completion.structuredResult.bullets
                    ? [...job.completion.structuredResult.bullets]
                    : undefined,
                }
              : undefined,
          }
        : undefined,
    };
  }

  private unregisterOwnedJobs(): void {
    for (const jobId of this.ownedJobIds) {
      if (activeSubagentControllers.get(jobId) === this) {
        activeSubagentControllers.delete(jobId);
      }
    }
  }

  private async emitSubagentProgress(job: SubagentJobRecord, reason: string): Promise<void> {
    const at = new Date().toISOString();
    const summary = `${job.role ?? "subagent"} ${job.id} ${reason}`;
    const event: SubagentProgressEvent = {
      at,
      status: job.status,
      reason,
      summary,
    };
    const current = this.get(job.id) ?? job;
    const progressEvents = [...(current.progressEvents ?? []), event].slice(-50);
    const trackedJob = this.updateJob(job.id, { progressEvents });
    await this.input.eventHandler?.({
      type: "subagent.progress",
      at,
      workspaceId: this.input.workspaceRecord.id,
      threadId: this.input.parentThreadId,
      runId: this.input.parentRunId,
      status: job.status,
      summary,
      payload: {
        reason,
        job: {
          id: trackedJob.id,
          objective: trackedJob.objective,
          role: trackedJob.role,
          mode: trackedJob.mode,
          outcomeVisibility: trackedJob.outcomeVisibility,
          authority: trackedJob.authority,
          status: trackedJob.status,
          depth: trackedJob.depth,
          maxDepth: trackedJob.maxDepth,
          maxConcurrentChildren: trackedJob.maxConcurrentChildren,
          parentJobId: trackedJob.parentJobId,
          rootJobId: trackedJob.rootJobId,
          childJobIds: trackedJob.childJobIds,
          executionDomain: trackedJob.executionDomain,
          budget: {
            maxIterations: trackedJob.budget.maxIterations,
            timeoutMs: trackedJob.budget.timeoutMs,
            maxRetries: trackedJob.budget.maxRetries,
          },
          targetPaths: trackedJob.targetPaths,
          blockedReason: trackedJob.blockedReason,
          blockedByJobIds: trackedJob.blockedByJobIds,
          blockedPaths: trackedJob.blockedPaths,
          attempts: trackedJob.attempts,
          queuePosition: trackedJob.queuePosition,
          threadId: trackedJob.threadId,
          runId: trackedJob.runId,
          finalResponse: trackedJob.finalResponse,
          error: trackedJob.error,
          progressEvents: trackedJob.progressEvents ?? [],
        },
      },
    });
  }

  private async resolveExecutionDomain(requested: ExecutionDomain | undefined): Promise<ExecutionDomain> {
    if (requested) {
      return requested;
    }

    if (this.input.parentOptions.executionDomain !== "workspace") {
      return "sandbox";
    }

    const snapshot = await this.input.baseWorkspace.inspect();
    return snapshot.isGitRepo ? "worktree" : "sandbox";
  }
}

export async function controlLiveSubagent(input: {
  readonly jobId: string;
  readonly action: "cancel" | "interrupt" | "message" | "pause" | "resume";
  readonly message?: string;
}): Promise<SubagentJobRecord> {
  const controller = activeSubagentControllers.get(input.jobId);
  if (!controller) {
    throw new Error(`Subagent job ${input.jobId} is not available for live control.`);
  }
  switch (input.action) {
    case "pause":
      return controller.pause(input.jobId);
    case "resume":
      return controller.resume(input.jobId);
    case "interrupt":
      return controller.interrupt(input.jobId);
    case "cancel":
      return controller.cancel(input.jobId);
    case "message":
      return controller.send(input.jobId, input.message ?? "");
    default:
      throw new Error(`Unsupported subagent action ${(input as { action: string }).action}.`);
  }
}

export function isSubagentLiveControllable(jobId: string): boolean {
  return activeSubagentControllers.has(jobId);
}

function resolveSubagentSessionThreadId(input: {
  readonly request: SubagentExecutionRequest;
  readonly sessionMode: "run" | "thread";
  readonly workspaceRecord: WorkspaceRecord;
  readonly sessionStore: SqliteSessionStore;
}): string | null {
  if (input.sessionMode !== "thread") {
    return null;
  }
  const requestedThreadId = input.request.sessionThreadId?.trim();
  if (requestedThreadId) {
    const thread = input.sessionStore.getThread(requestedThreadId);
    if (!thread) {
      throw new Error(`Subagent session thread ${requestedThreadId} was not found.`);
    }
    if (thread.workspaceId !== input.workspaceRecord.id) {
      throw new Error(`Subagent session thread ${requestedThreadId} does not belong to workspace ${input.workspaceRecord.id}.`);
    }
    return thread.id;
  }
  return input.sessionStore.createThread(
    input.workspaceRecord.id,
    input.request.threadTitle ?? shortenTitle(`Subagent: ${input.request.objective}`),
  ).id;
}

function normalizeSubagentTargetPaths(value: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? [])
        .map((entry) => entry.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim())
        .filter(Boolean),
    ),
  );
}

function createSubagentWorkspaceExecutionPolicy(
  role: AgentRole,
  executionDomain: ExecutionDomain,
): ReturnType<typeof createWorkspaceExecutionPolicy> {
  // Subagents need control capability to materialize their assigned sandbox/worktree
  // before the child runtime starts, even for read-only reviewer/planner-style roles.
  const withControl = (...capabilities: Array<"command" | "control" | "read" | "search" | "write">) =>
    createWorkspaceExecutionPolicy(executionDomain, capabilities);
  if (role === "planner" || role === "supervisor" || role === "reviewer" || role === "verifier") {
    return withControl("search", "read", "command", "control");
  }
  if (role === "researcher") {
    return withControl("search", "read", "command", "control");
  }
  return withControl("search", "read", "write", "command", "control");
}

function buildSubagentCompletionReport(
  summary: AgentRunSummary,
  status: SubagentJobRecord["status"],
  role?: string,
  error?: string,
): SubagentCompletionReport {
  const structuredResult = parseStructuredRoleResult(role, summary.finalResponse);
  return {
    status,
    verificationStatus: summary.verification.status,
    changedFiles: summary.changedFiles,
    finalResponse: summary.finalResponse,
    error,
    structuredResult: structuredResult ?? undefined,
  };
}

function buildSummaryOnlySubagentOutcome(job: SubagentJobRecord): string | null {
  const structuredSummary = job.completion?.structuredResult?.summary?.trim();
  const rawSummary = structuredSummary || job.finalResponse || job.completion?.finalResponse || "";
  const normalized = rawSummary.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return trimForModel(normalized, 600);
}

function isTerminalSubagentStatus(status: SubagentJobRecord["status"]): boolean {
  return status === "cancelled" || status === "completed" || status === "failed" || status === "interrupted" || status === "timed_out";
}

function resolveSubagentExecutionMode(request: SubagentExecutionRequest): SubagentExecutionMode {
  return request.mode ?? "foreground";
}

function resolveSubagentOutcomeVisibility(
  request: SubagentExecutionRequest,
  mode: SubagentExecutionMode,
): SubagentOutcomeVisibility {
  if (request.outcomeVisibility) {
    return request.outcomeVisibility;
  }
  return mode === "background" ? "artifacts_only" : "context";
}

function modeSpecificHandoffInstructions(job: SubagentJobRecord): string[] {
  if (job.mode !== "background") {
    return [];
  }
  return [
    "You are running in background mode.",
    "Do not assume the parent will see your raw transcript or intermediate tool output.",
    "Return only a concise summary and produce reusable artifacts when the task benefits from them.",
  ];
}

function shouldPauseForSubagentPolling(
  executedToolNames: readonly string[],
  subagentController: SubagentController,
): boolean {
  if (executedToolNames.length === 0 || !executedToolNames.every((entry) => entry === "list_subagents")) {
    return false;
  }
  return subagentController.list().some((job) => !isTerminalSubagentStatus(job.status));
}

function resolveRuntimeSubagentTools(
  job: SubagentJobRecord,
  toolRegistry: ToolRegistry,
  extensionRegistry: ExtensionRegistry,
  runtimePolicy: RuntimeToolPolicy | undefined,
  policyContext: RuntimeToolPolicyContext | undefined,
): string[] {
  return resolveToolPolicy({
    availableToolNames: toolRegistry.listSpecs().map((entry) => entry.name),
    role: normalizeAgentRole(job.role),
    extensionRegistry,
    runtimePolicy,
    policyContext,
    authority: job.authority,
    requestedTools: job.allowedTools,
  }).toolNames;
}

function shortenTitle(objective: string): string {
  const normalized = objective.trim().replace(/\s+/g, " ");
  return normalized.length <= 60 ? normalized : `${normalized.slice(0, 57)}...`;
}

function derivePromptTaskState(input: {
  readonly taskContract: TaskContract;
  readonly toolObservations: readonly ToolObservation[];
  readonly verificationPlan: {
    readonly commands: string[];
    readonly summary: string;
  };
  readonly verificationExecution: VerificationExecutionResult | null;
  readonly recentFailureReason: string | null;
  readonly activeFailureReason: string | null;
  readonly activeBlockReason: string | null;
  readonly mutatingToolSucceeded: boolean;
  readonly turnCount: number;
  readonly allowToolCalls: boolean;
}): TaskState {
  const mutationExpected = objectiveSuggestsMutation(input.taskContract.objective);
  const hasEvidence = input.turnCount > 0 || input.toolObservations.some((entry) => entry.ok);
  const latestVerification = summarizeTaskVerification(input.verificationPlan, input.verificationExecution);
  const completedSubgoals: string[] = [];
  const pendingSubgoals: string[] = [];

  if (hasEvidence) {
    completedSubgoals.push("Collected repository evidence and task constraints.");
  } else {
    pendingSubgoals.push("Understand the repository state and identify the next safe action.");
  }

  if (input.mutatingToolSucceeded) {
    completedSubgoals.push("Applied the requested repository changes.");
  } else if (mutationExpected) {
    pendingSubgoals.push("Apply the smallest repository change that satisfies the objective.");
  }

  if (latestVerification.status === "passed") {
    completedSubgoals.push("Verified the latest changes with execution evidence.");
  } else if (latestVerification.status === "failed") {
    completedSubgoals.push("Captured verification evidence for the failing revision.");
    pendingSubgoals.push("Repair the failing change and re-run verification.");
  } else if ((mutationExpected || input.mutatingToolSucceeded || input.taskContract.verificationMode === "required") && input.verificationPlan.commands.length > 0) {
    pendingSubgoals.push("Run verification and capture evidence before claiming success.");
  }

  if (input.activeBlockReason) {
    pendingSubgoals.push("Resolve the blocked action or choose a safer alternative.");
  }

  let phase: TaskState["phase"] = "understanding";
  if (!input.allowToolCalls && !input.activeFailureReason && !input.activeBlockReason) {
    phase = "done";
  } else if (input.activeBlockReason) {
    phase = "blocked";
  } else if (input.activeFailureReason || latestVerification.status === "failed") {
    phase = "repairing";
  } else if (input.mutatingToolSucceeded && latestVerification.status !== "passed" && input.verificationPlan.commands.length > 0) {
    phase = "verifying";
  } else if (hasEvidence) {
    phase = "acting";
  }

  return {
    phase,
    currentGoal: deriveCurrentGoal({
      phase,
      objective: input.taskContract.objective,
      activeFailureReason: input.activeFailureReason,
      activeBlockReason: input.activeBlockReason,
      pendingSubgoals,
    }),
    completedSubgoals,
    pendingSubgoals,
    recentFailureReason: input.recentFailureReason,
    latestVerification,
  };
}

function deriveCurrentGoal(input: {
  readonly phase: TaskState["phase"];
  readonly objective: string;
  readonly activeFailureReason: string | null;
  readonly activeBlockReason: string | null;
  readonly pendingSubgoals: readonly string[];
}): string {
  switch (input.phase) {
    case "understanding":
      return "Understand the repository and identify the next safe action.";
    case "acting":
      return input.objective;
    case "verifying":
      return "Run verification and capture evidence for the latest changes.";
    case "repairing":
      return input.activeFailureReason ? `Repair the most recent failure: ${trimForModel(input.activeFailureReason, 220)}` : "Repair the failing change and recover the task.";
    case "blocked":
      return input.activeBlockReason ? `Resolve the blocked action: ${trimForModel(input.activeBlockReason, 220)}` : "Resolve the blocked action before continuing.";
    case "done":
      return "Summarize the completed work and its verification evidence.";
    default:
      return input.pendingSubgoals[0] ?? input.objective;
  }
}

function summarizeTaskVerification(
  plan: {
    readonly commands: string[];
    readonly summary: string;
  },
  execution: VerificationExecutionResult | null,
): TaskState["latestVerification"] {
  if (!execution) {
    return {
      status: "not-run",
      summary:
        plan.commands.length > 0
          ? `Awaiting verification. ${plan.summary}`
          : "No verification command has been executed or inferred yet.",
    };
  }
  const failedCommand = execution.results.find((entry) => !entry.ok)?.command ?? "unknown";
  return execution.ok
    ? {
        status: "passed",
        summary: `Passed ${execution.results.length} verification command(s).`,
      }
    : {
        status: "failed",
        summary: `Failed on verification command: ${failedCommand}`,
      };
}

function objectiveSuggestsMutation(objective: string): boolean {
  return (
    /\b(add|build|change|create|edit|fix|implement|modify|refactor|rename|replace|update|write|generate|produce|deliver|complete)\b/i.test(objective) ||
    /完成|生成|创建|建立|写|撰写|输出|提交|交付|修复|修改|改进|实现|制作|编写|形成|补全|完善/.test(objective)
  );
}

function containsMalformedToolCallIntent(text: string): boolean {
  return (
    /["']?toolCalls["']?|["']?tool_calls["']?/i.test(text) &&
    /\b(append_file|write_file|edit_file|replace_file_range|run_verification)\b/i.test(text)
  );
}

function containsUnfulfilledMutationIntent(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /\b(?:i|we)\s+(?:will|am going to|are going to)\s+(?:write|create|generate|produce|deliver|add|update|edit|modify|build)\b/i.test(
      normalized,
    ) ||
    /\bnow\s+(?:i|we)\s+(?:will|am going to|are going to)\s+(?:write|create|generate|produce|deliver|add|update|edit|modify|build)\b/i.test(
      normalized,
    ) ||
    /(?:我|我们)(?:将|会|准备|接下来)(?:写|创建|生成|输出|交付|修改|更新|制作|编写)/.test(normalized)
  );
}

function hasSuccessfulDelegationObservation(observations: readonly ToolObservation[]): boolean {
  return observations.some(
    (entry) =>
      entry.ok &&
      (entry.toolName === "spawn_subagent" ||
        entry.toolName === "wait_subagent" ||
        entry.toolName === "run_swarm" ||
        entry.toolName === "collect_subagent_artifacts"),
  );
}

function deriveRunStatus(input: {
  readonly blockedApprovals: string[];
  readonly mutatingToolSucceeded: boolean;
  readonly verification: VerificationAssessment;
  readonly independentVerification: IndependentVerificationReport | null;
  readonly independentVerificationMode: IndependentVerificationMode;
  readonly failedToolCount: number;
}): RunStatus {
  if (input.verification.status === "failed") {
    return "failed";
  }
  if (input.independentVerification?.status === "failed") {
    return "failed";
  }
  if (input.independentVerification?.status === "error" && input.independentVerificationMode === "required") {
    return "failed";
  }
  if (input.mutatingToolSucceeded && input.verification.status === "skipped") {
    return "completed_with_warnings";
  }
  if (input.independentVerification?.status === "error") {
    return "completed_with_warnings";
  }
  if (input.blockedApprovals.length > 0) {
    return "completed_with_warnings";
  }
  if (input.failedToolCount > 0) {
    return "completed_with_warnings";
  }
  return "completed";
}

function shouldTrackWorkspaceMutation(toolName: string, assessment: ToolRiskAssessment): boolean {
  if (NON_WORKSPACE_MUTATION_TOOL_NAMES.has(toolName)) {
    return false;
  }
  if (assessment.approvalClass === "exec_capable" && POTENTIALLY_MUTATING_EXEC_TOOL_NAMES.has(toolName)) {
    return true;
  }
  if (!assessment.mutating) {
    return false;
  }
  return assessment.approvalClass === "mutating" || assessment.approvalClass === "exec_capable";
}

function isWorkspaceCheckpointRecord(value: unknown): value is WorkspaceCheckpointRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<WorkspaceCheckpointRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.path === "string" &&
    typeof record.createdAt === "string"
  );
}

function buildToolInterruptSummary(interrupt: ToolInterruptRequest): string {
  if (interrupt.kind === "ask_user") {
    return `Awaiting user input: ${interrupt.question}`;
  }
  return "Run interrupted by tool request.";
}

function formatSubagentMailboxInstructions(messages: readonly SubagentMessageRecord[]): string {
  const recentMessages = messages.slice(-4);
  return [
    "Parent mailbox updates:",
    ...recentMessages.map((message) => `- [${message.createdAt}] ${message.content}`),
  ].join("\n");
}

function parseIndependentVerifierVerdict(response: string): Pick<IndependentVerificationReport, "status" | "summary"> {
  const verdictMatch = response.match(/^\s*VERDICT:\s*([A-Z_]+)/im);
  const rationaleMatch = response.match(/^\s*RATIONALE:\s*(.+)$/im);
  const normalizedVerdict = verdictMatch?.[1]?.trim().toUpperCase();
  const summary = rationaleMatch?.[1]?.trim() || trimForModel(response.replace(/\s+/g, " ").trim(), 260);
  switch (normalizedVerdict) {
    case "PASS":
      return {
        status: "passed",
        summary: summary || "Independent verifier accepted the result.",
      };
    case "FAIL":
    case "NEEDS_MORE_WORK":
      return {
        status: "failed",
        summary: summary || "Independent verifier rejected the result.",
      };
    default:
      return {
        status: "skipped",
        summary: summary || "Independent verifier did not return a structured verdict.",
      };
  }
}

function parseStructuredRoleResult(role: string | null | undefined, response: string): StructuredSubagentResult | null {
  const normalizedRole = normalizeAgentRole(role);
  if (!response.trim()) {
    return null;
  }
  if (normalizedRole === "planner" || normalizedRole === "supervisor") {
    const statusMatch = response.match(/^\s*PLAN_STATUS:\s*([A-Z_]+)/im);
    const summaryMatch = response.match(/^\s*SUMMARY:\s*(.+)$/im);
    const bullets = extractStructuredBulletSection(response, "STEPS");
    return {
      kind: "plan",
      status: statusMatch?.[1]?.trim().toLowerCase() ?? "unstructured",
      summary: summaryMatch?.[1]?.trim() || trimForModel(response.replace(/\s+/g, " ").trim(), 260),
      ...(bullets.length > 0 ? { bullets } : {}),
    };
  }
  if (normalizedRole === "researcher") {
    const statusMatch = response.match(/^\s*FINDINGS_STATUS:\s*([A-Z_]+)/im);
    const summaryMatch = response.match(/^\s*SUMMARY:\s*(.+)$/im);
    const bullets = extractStructuredBulletSection(response, "FINDINGS");
    return {
      kind: "findings",
      status: statusMatch?.[1]?.trim().toLowerCase() ?? "unstructured",
      summary: summaryMatch?.[1]?.trim() || trimForModel(response.replace(/\s+/g, " ").trim(), 260),
      ...(bullets.length > 0 ? { bullets } : {}),
    };
  }
  if (normalizedRole === "verifier") {
    const verdict = parseIndependentVerifierVerdict(response);
    return {
      kind: "verdict",
      status: verdict.status,
      summary: verdict.summary,
    };
  }
  if (normalizedRole === "reviewer") {
    const statusMatch = response.match(/^\s*REVIEW_STATUS:\s*([A-Z_]+)/im);
    const summaryMatch = response.match(/^\s*SUMMARY:\s*(.+)$/im);
    const bullets = extractStructuredBulletSection(response, "FINDINGS");
    return {
      kind: "review",
      status: statusMatch?.[1]?.trim().toLowerCase() ?? "unstructured",
      summary: summaryMatch?.[1]?.trim() || trimForModel(response.replace(/\s+/g, " ").trim(), 260),
      ...(bullets.length > 0 ? { bullets } : {}),
    };
  }
  return null;
}

function extractStructuredBulletSection(response: string, heading: string): string[] {
  const sectionMatch = response.match(new RegExp(`^\\s*${heading}:\\s*([\\s\\S]+)$`, "im"));
  const block = sectionMatch?.[1] ?? "";
  return block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function formatInterruptedAssistantText(interrupt: ToolInterruptRequest): string {
  if (interrupt.kind !== "ask_user") {
    return "Run interrupted.";
  }
  return [
    `Awaiting user input: ${interrupt.question}`,
    `Question ID: ${interrupt.questionId}`,
    interrupt.context ? `Context: ${interrupt.context}` : null,
    interrupt.suggestedResponses && interrupt.suggestedResponses.length > 0
      ? `Suggested responses: ${interrupt.suggestedResponses.join(" | ")}`
      : null,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n");
}

function buildFinalResponse(input: {
  readonly assistantText: string;
  readonly changedFiles: string[];
  readonly diffSummary: GitDiffSummary | null;
  readonly verification: VerificationAssessment;
  readonly independentVerification: IndependentVerificationReport | null;
  readonly blockedApprovals: string[];
}): string {
  const sections = [input.assistantText.trim() || "Run completed."];

  if (input.changedFiles.length > 0) {
    sections.push(`Changed files:\n${input.changedFiles.map((entry) => `- ${entry}`).join("\n")}`);
  }

  if (input.diffSummary?.stat) {
    sections.push(`Diff summary:\n${input.diffSummary.stat}`);
  }

  sections.push(`Verification:\n- Status: ${input.verification.status}\n- ${input.verification.summary}`);

  if (input.independentVerification) {
    sections.push(
      `Independent verification:\n- Status: ${input.independentVerification.status}\n- ${input.independentVerification.summary}`,
    );
  }

  if (input.blockedApprovals.length > 0) {
    sections.push(`Approval warnings:\n${input.blockedApprovals.map((entry) => `- ${entry}`).join("\n")}`);
  }

  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

function applyTurnMetrics(
  turn: ModelTurnResult,
  state: {
    readonly modelProfilesUsed: Set<string>;
    readonly usageTotals: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      hasInputTokens: boolean;
      hasOutputTokens: boolean;
      hasTotalTokens: boolean;
    };
  },
): void {
  if (turn.provider?.id) {
    state.modelProfilesUsed.add(turn.provider.id);
  }
  if (turn.usage?.inputTokens !== undefined) {
    state.usageTotals.inputTokens += turn.usage.inputTokens;
    state.usageTotals.hasInputTokens = true;
  }
  if (turn.usage?.outputTokens !== undefined) {
    state.usageTotals.outputTokens += turn.usage.outputTokens;
    state.usageTotals.hasOutputTokens = true;
  }
  if (turn.usage?.totalTokens !== undefined) {
    state.usageTotals.totalTokens += turn.usage.totalTokens;
    state.usageTotals.hasTotalTokens = true;
  }
}

function normalizeToolName(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_");

  const tokens = normalized
    .split("_")
    .filter(Boolean);

  while (tokens.length > 0 && TOOL_NAME_DECORATION_TOKENS.has(tokens[0] ?? "")) {
    tokens.shift();
  }

  while (tokens.length > 0 && TOOL_NAME_DECORATION_TOKENS.has(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }

  return tokens.join("_");
}

function resolveToolName(
  requestedToolName: string,
  availableToolNames: string[],
  allowFuzzyRepair = true,
): string | null {
  const requestedNormalized = normalizeToolName(requestedToolName);
  if (!requestedNormalized) {
    return null;
  }

  if (availableToolNames.includes(requestedToolName)) {
    return requestedToolName;
  }

  const exactNormalized = availableToolNames.find((candidate) => normalizeToolName(candidate) === requestedNormalized);
  if (exactNormalized) {
    return exactNormalized;
  }

  const aliasedToolName = TOOL_NAME_ALIASES.get(requestedNormalized);
  if (aliasedToolName && availableToolNames.includes(aliasedToolName)) {
    return aliasedToolName;
  }

  if (!allowFuzzyRepair) {
    return null;
  }

  const scored = availableToolNames
    .map((candidate) => ({
      candidate,
      score: stringSimilarity(requestedNormalized, normalizeToolName(candidate)),
    }))
    .filter((entry) => entry.score >= TOOL_NAME_REPAIR_FALLBACK_THRESHOLD)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return null;
  }

  const top = scored[0];
  const second = scored[1];
  if (top.score >= TOOL_NAME_REPAIR_THRESHOLD) {
    return top.candidate;
  }
  if (top.score >= TOOL_NAME_REPAIR_FALLBACK_THRESHOLD && second && top.score - second.score < 0.08) {
    return null;
  }
  return top.candidate;
}

function stringSimilarity(left: string, right: string): number {
  const leftLength = left.length;
  const rightLength = right.length;
  if (leftLength === 0 && rightLength === 0) {
    return 1;
  }
  if (leftLength === 0 || rightLength === 0) {
    return 0;
  }
  const distance = levenshteinDistance(left, right);
  return 1 - distance / Math.max(leftLength, rightLength);
}

function levenshteinDistance(left: string, right: string): number {
  if (left.length < right.length) {
    return levenshteinDistance(right, left);
  }

  const rightLength = right.length;
  const leftLength = left.length;

  if (rightLength === 0) {
    return leftLength;
  }

  let previousRow = Array.from({ length: rightLength + 1 }, (_, index) => index);
  let currentRow = new Array<number>(rightLength + 1);

  for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
    currentRow[0] = leftIndex;
    const leftChar = left[leftIndex - 1];
    for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
      const rightChar = right[rightIndex - 1];
      const insertion = currentRow[rightIndex - 1] + 1;
      const deletion = previousRow[rightIndex] + 1;
      const substitution = previousRow[rightIndex - 1] + (leftChar === rightChar ? 0 : 1);
      currentRow[rightIndex] = Math.min(insertion, deletion, substitution);
    }
    previousRow = currentRow;
    currentRow = new Array<number>(rightLength + 1);
  }

  return previousRow[rightLength];
}

function buildMemoryWriteContext(input: {
  readonly baseContext: MemoryProviderSessionContext;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly result: ToolResult;
}): MemoryWriteContext | null {
  if (!input.result.ok) {
    return null;
  }
  const content = String(input.args.content ?? "").trim();
  if (!content) {
    return null;
  }
  const tags = normalizeMemoryWriteTags(input.args.tags);
  if (input.toolName === "save_memory") {
    const scope = input.args.scope === "thread" ? "thread" : "workspace";
    return {
      ...input.baseContext,
      kind: "memory",
      toolName: "save_memory",
      content,
      tags,
      scope,
      backend: normalizeMemoryWriteBackend(input.args.backend),
      targetIds: extractMemoryWriteTargetIds(input.result.data),
      data: input.result.data,
    };
  }
  if (input.toolName === "save_profile_fact") {
    return {
      ...input.baseContext,
      kind: "profile_fact",
      toolName: "save_profile_fact",
      content,
      tags,
      targetIds: extractMemoryWriteTargetIds(input.result.data),
      data: input.result.data,
    };
  }
  return null;
}

function normalizeMemoryWriteTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.map((entry) => String(entry).trim()).filter(Boolean)));
}

function normalizeMemoryWriteBackend(value: unknown): "both" | "file" | "store" {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "both" || normalized === "file" || normalized === "store" ? normalized : "store";
}

function extractMemoryWriteTargetIds(data: unknown): string[] {
  const record = asMemoryWriteRecord(data);
  if (!record) {
    return [];
  }
  const targetIds = new Set<string>();
  addMemoryWriteTargetId(targetIds, record.id);
  addMemoryWriteTargetId(targetIds, record.path);
  addMemoryWriteTargetId(targetIds, asMemoryWriteRecord(record.storeRecord)?.id);
  const fileRecord = asMemoryWriteRecord(record.fileRecord);
  addMemoryWriteTargetId(targetIds, fileRecord?.id);
  addMemoryWriteTargetId(targetIds, fileRecord?.path);
  return [...targetIds];
}

function addMemoryWriteTargetId(targetIds: Set<string>, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const normalized = value.trim();
  if (normalized) {
    targetIds.add(normalized);
  }
}

function asMemoryWriteRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function summarizeToolData(toolName: string, data: unknown): string | undefined {
  if (data === undefined || data === null) {
    return undefined;
  }

  if (typeof data === "string") {
    return trimForModel(summarizeStructuredString(data, MAX_TOOL_DETAIL_CHARS), MAX_TOOL_DETAIL_CHARS);
  }

  if (
    (toolName === "spawn_subagent" || toolName === "wait_subagent" || toolName === "wait_any_subagent") &&
    typeof data === "object" &&
    data !== null
  ) {
    return trimForModel(JSON.stringify(projectSubagentJobForModel(data as SubagentJobRecord), null, 2), MAX_TOOL_DETAIL_CHARS);
  }

  if (toolName === "list_subagents" && Array.isArray(data)) {
    return trimForModel(
      JSON.stringify(
        data
          .filter((entry): entry is SubagentJobRecord => Boolean(entry) && typeof entry === "object")
          .map((entry) => projectListedSubagentJobForModel(entry))
          .slice(0, MAX_STRUCTURED_JSON_ARRAY_ITEMS),
        null,
        2,
      ),
      MAX_TOOL_DETAIL_CHARS,
    );
  }

  if (toolName === "read_file" && typeof data === "object" && data !== null) {
    const record = data as { path?: unknown; content?: unknown; startLine?: unknown; endLine?: unknown };
    return trimForModel(
      [
        typeof record.path === "string" ? `path: ${record.path}` : null,
        typeof record.startLine === "number" ? `startLine: ${record.startLine}` : null,
        typeof record.endLine === "number" ? `endLine: ${record.endLine}` : null,
        "",
        typeof record.content === "string" ? record.content : null,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join("\n"),
    );
  }

  if (
    (toolName === "spawn_subagent" ||
      toolName === "wait_subagent" ||
      toolName === "wait_any_subagent" ||
      toolName === "cancel_subagent" ||
      toolName === "pause_subagent" ||
      toolName === "resume_subagent" ||
      toolName === "interrupt_subagent") &&
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data)
  ) {
    return stringifyForModel(summarizeSubagentJobForModel(data as Record<string, unknown>));
  }

  if ((toolName === "run_swarm" || toolName === "list_subagents") && typeof data === "object" && data !== null) {
    return stringifyForModel(summarizeSubagentCollectionForModel(data));
  }

  return stringifyForModel(data);
}

function projectSubagentJobForModel(job: SubagentJobRecord): Record<string, unknown> {
  return {
    id: job.id,
    objective: job.objective,
    role: job.role,
    mode: job.mode,
    outcomeVisibility: job.outcomeVisibility,
    authority: job.authority,
    status: job.status,
    attempts: job.attempts,
    depth: job.depth,
    maxDepth: job.maxDepth,
    maxConcurrentChildren: job.maxConcurrentChildren,
    parentJobId: job.parentJobId,
    rootJobId: job.rootJobId,
    childJobIds: job.childJobIds,
    queuePosition: job.queuePosition,
    executionDomain: job.executionDomain,
      blockedReason: job.blockedReason,
      blockedByJobIds: job.blockedByJobIds,
      blockedPaths: job.blockedPaths,
      returnedArtifactKinds: job.returnedArtifactKinds,
      pausedFromStatus: job.pausedFromStatus,
      allowedTools: job.allowedTools,
      toolPolicyTrace: job.toolPolicyTrace,
      finalResponse: job.finalResponse,
      error: job.error,
    completion: job.completion
      ? {
          status: job.completion.status,
          verificationStatus: job.completion.verificationStatus,
          changedFiles: job.completion.changedFiles,
          finalResponse: job.completion.finalResponse,
          error: job.completion.error,
          structuredResult: job.completion.structuredResult,
        }
      : undefined,
  };
}

function projectListedSubagentJobForModel(job: SubagentJobRecord): Record<string, unknown> {
  return {
    id: job.id,
    objective: job.objective,
    rootJobId: job.rootJobId,
    parentJobId: job.parentJobId,
    depth: job.depth,
    maxDepth: job.maxDepth,
    maxConcurrentChildren: job.maxConcurrentChildren,
    childJobIds: job.childJobIds,
    role: job.role,
    mode: job.mode,
    outcomeVisibility: job.outcomeVisibility,
    authority: job.authority,
    status: job.status,
    attempts: job.attempts,
    executionDomain: job.executionDomain,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    queuePosition: job.queuePosition,
    blockedReason: job.blockedReason,
    blockedByJobIds: job.blockedByJobIds,
    blockedPaths: job.blockedPaths,
    threadId: job.threadId,
    runId: job.runId,
      returnedArtifactKinds: job.returnedArtifactKinds,
      pausedFromStatus: job.pausedFromStatus,
      finalResponse: job.finalResponse,
      error: job.error,
      toolPolicyTrace: job.toolPolicyTrace,
    };
  }

function extractChangedPaths(toolName: string, data: unknown): string[] {
  if (!data || typeof data !== "object") {
    return [];
  }

  if (toolName === "write_file" || toolName === "edit_file" || toolName === "replace_file_range") {
    const path = (data as { path?: unknown }).path;
    return typeof path === "string" ? [path] : [];
  }

  if (toolName === "append_file") {
    const path = (data as { path?: unknown }).path;
    return typeof path === "string" ? [path] : [];
  }

  if (toolName === "git_diff") {
    const changed = (data as { changedFiles?: unknown }).changedFiles;
    return Array.isArray(changed) ? changed.filter((entry): entry is string => typeof entry === "string") : [];
  }

  return [];
}

function summarizeSubagentJobForModel(job: Record<string, unknown>): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    depth: job.depth,
    maxDepth: job.maxDepth,
    maxConcurrentChildren: job.maxConcurrentChildren,
      queuePosition: job.queuePosition,
      blockedReason: job.blockedReason,
      blockedByJobIds: job.blockedByJobIds,
      blockedPaths: job.blockedPaths,
      parentJobId: job.parentJobId,
      rootJobId: job.rootJobId,
      childJobIds: job.childJobIds,
      authority: job.authority,
      mode: job.mode,
      outcomeVisibility: job.outcomeVisibility,
      attempts: job.attempts,
      executionDomain: job.executionDomain,
      returnedArtifactKinds: job.returnedArtifactKinds,
      pausedFromStatus: job.pausedFromStatus,
      role: job.role,
      toolPolicyTrace: job.toolPolicyTrace,
      finalResponse: job.finalResponse,
      error: job.error,
    completion:
      job.completion && typeof job.completion === "object"
        ? {
            status: (job.completion as Record<string, unknown>).status,
            verificationStatus: (job.completion as Record<string, unknown>).verificationStatus,
            finalResponse: (job.completion as Record<string, unknown>).finalResponse,
            error: (job.completion as Record<string, unknown>).error,
            structuredResult: (job.completion as Record<string, unknown>).structuredResult,
          }
        : undefined,
  };
}

function summarizeSubagentCollectionForModel(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .map((entry) => summarizeSubagentJobForModel(entry));
  }

  const record = data as Record<string, unknown>;
  return {
    ...record,
    jobs: Array.isArray(record.jobs)
      ? record.jobs
          .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
          .map((entry) => summarizeSubagentJobForModel(entry))
      : record.jobs,
  };
}

async function discoverWorkspaceInstructionsForTool(input: {
  readonly workspace: LocalWorkspaceService;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly knownInstructionPathKeys: Set<string>;
}): Promise<WorkspaceInstructionFile[]> {
  const targets = extractWorkspaceTargetsFromTool(input.toolName, input.args);
  if (targets.length === 0) {
    return [];
  }

  const discovered: WorkspaceInstructionFile[] = [];
  for (const targetPath of targets) {
    const files = await input.workspace.loadInstructionFiles({ targetPath });
    for (const file of files) {
      const key = normalizeInstructionPathKey(file.path);
      if (input.knownInstructionPathKeys.has(key)) {
        continue;
      }
      input.knownInstructionPathKeys.add(key);
      discovered.push(file);
    }
  }

  return discovered;
}

async function discoverWorkspaceMemoryFilesForTool(input: {
  readonly workspace: LocalWorkspaceService;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly knownMemoryPathKeys: Set<string>;
}): Promise<WorkspaceMemoryFile[]> {
  const targets = extractWorkspaceTargetsFromTool(input.toolName, input.args);
  if (targets.length === 0) {
    return [];
  }

  const discovered: WorkspaceMemoryFile[] = [];
  for (const targetPath of targets) {
    const files = await input.workspace.loadMemoryFiles({ targetPath });
    for (const file of files) {
      const key = normalizeWorkspacePathKey(file.path);
      if (input.knownMemoryPathKeys.has(key)) {
        continue;
      }
      input.knownMemoryPathKeys.add(key);
      discovered.push(file);
    }
  }

  return discovered;
}

function extractWorkspaceTargetsFromTool(toolName: string, args: Record<string, unknown>): string[] {
  const targets = new Set<string>();

  for (const key of ["path", "cwd", "filePath", "workdir"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      targets.add(value.trim());
    }
  }

  if (toolName === "run_command") {
    const command = typeof args.command === "string" ? args.command : "";
    for (const token of extractPathLikeCommandTokens(command)) {
      targets.add(token);
    }
  }

  return Array.from(targets);
}

function extractPathLikeCommandTokens(command: string): string[] {
  const targets = new Set<string>();
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^['"]|['"]$/g, "").trim();
    if (!token || token.startsWith("-")) {
      continue;
    }
    if (/^(https?:\/\/|git@)/i.test(token)) {
      continue;
    }
    if (!/[./\\]/.test(token)) {
      continue;
    }
    targets.add(token);
  }
  return Array.from(targets);
}

function normalizeInstructionPathKey(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function normalizeWorkspacePathKey(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

const MAX_TOOL_DETAIL_CHARS = 4_000;
const TOOL_OUTPUT_ARTIFACT_THRESHOLD_CHARS = 8_000;
const MAX_STRUCTURED_JSON_DEPTH = 4;
const MAX_STRUCTURED_JSON_ARRAY_ITEMS = 8;
const MAX_STRUCTURED_JSON_OBJECT_KEYS = 12;
const MAX_STRUCTURED_JSON_STRING_CHARS = 480;
const MAX_STRUCTURED_MEDIA_REF_CHARS = 180;
const ARTIFACT_PATH_KEY_RE = /^artifactpaths?$/i;
const SENSITIVE_ARTIFACT_NAME_RE = /\b(?:api[_-]?key|authorization|bearer|credential|password|secret|token|webhook)\b/i;

function summarizeStructuredMediaRef(label: string, value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const dataUriMatch = trimmed.match(/^data:([^;,]+)?(?:;[^,]*)?,/i);
  if (dataUriMatch) {
    const mimeType = dataUriMatch[1]?.trim() || "unknown";
    return `[${label}] inline data URI (${mimeType}, ${trimmed.length} chars)`;
  }
  if (trimmed.length > MAX_STRUCTURED_MEDIA_REF_CHARS) {
    return `[${label}] ${trimmed.slice(0, MAX_STRUCTURED_MEDIA_REF_CHARS)}... (${trimmed.length} chars)`;
  }
  return undefined;
}

function summarizeStructuredString(value: string, maxChars = MAX_STRUCTURED_JSON_STRING_CHARS): string {
  const mediaSummary = summarizeStructuredMediaRef("value", value);
  if (mediaSummary) {
    return mediaSummary;
  }
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return value;
  }
  return `${trimmed.slice(0, maxChars)}... (${trimmed.length} chars)`;
}

function redactToolResultForRuntime(result: ToolResult): ToolResult {
  return {
    ...result,
    summary: redactSensitiveText(result.summary),
    data: redactToolOutputForRuntimeStorage(result.data),
    presentation: redactSensitiveValue(result.presentation) as ToolPresentation | undefined,
  };
}

function redactToolOutputForRuntimeStorage(value: unknown): unknown {
  return redactArtifactPathsForRuntimeStorage(redactSensitiveValue(value));
}

function redactArtifactPathsForRuntimeStorage(
  value: unknown,
  key = "",
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === "string") {
    return ARTIFACT_PATH_KEY_RE.test(key) ? formatRuntimeArtifactPathForDisplay(value) : value;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((entry) => redactArtifactPathsForRuntimeStorage(entry, key, seen));
    seen.delete(value);
    return output;
  }

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    output[entryKey] = redactArtifactPathsForRuntimeStorage(entryValue, entryKey, seen);
  }
  seen.delete(value);
  return output;
}

function formatRuntimeArtifactPathForDisplay(value: string): string {
  const fileName = basename(value.replace(/\\/g, "/")).trim();
  const safeName = fileName && !SENSITIVE_ARTIFACT_NAME_RE.test(fileName) ? redactSensitiveText(fileName) : "[redacted-artifact]";
  return `artifact-path:${safeName}`;
}

function sanitizeStructuredValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof value === "string") {
    return summarizeStructuredString(value);
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: summarizeStructuredString(value.message),
      stack: typeof value.stack === "string" ? summarizeStructuredString(value.stack, MAX_STRUCTURED_JSON_STRING_CHARS) : undefined,
    };
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  if (depth >= MAX_STRUCTURED_JSON_DEPTH) {
    return "[max depth]";
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const limited = value
      .slice(0, MAX_STRUCTURED_JSON_ARRAY_ITEMS)
      .map((entry) => sanitizeStructuredValue(entry, depth + 1, seen));
    if (value.length > MAX_STRUCTURED_JSON_ARRAY_ITEMS) {
      limited.push(`[${value.length - MAX_STRUCTURED_JSON_ARRAY_ITEMS} more items]`);
    }
    seen.delete(value);
    return limited;
  }

  const output: Record<string, unknown> = {};
  let copied = 0;
  let skipped = 0;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (copied >= MAX_STRUCTURED_JSON_OBJECT_KEYS) {
      skipped += 1;
      continue;
    }
    output[key] = sanitizeStructuredValue(entry, depth + 1, seen);
    copied += 1;
  }
  if (skipped > 0) {
    output.__truncated = `${skipped} more keys`;
  }
  seen.delete(value);
  return output;
}

function stringifyForModel(value: unknown): string {
  if (typeof value === "string") {
    return trimForModel(summarizeStructuredString(value, MAX_TOOL_DETAIL_CHARS), MAX_TOOL_DETAIL_CHARS);
  }
  try {
    return trimForModel(JSON.stringify(sanitizeStructuredValue(value), null, 2), MAX_TOOL_DETAIL_CHARS);
  } catch {
    return trimForModel(String(value), MAX_TOOL_DETAIL_CHARS);
  }
}

interface PersistedToolOutput {
  readonly preview: string | null;
  readonly details: string | undefined;
  readonly truncated: boolean;
  readonly storedOutputRef: string | null;
}

function buildPersistedToolOutput(input: {
  readonly toolName: string;
  readonly result: ToolResult;
  readonly addArtifact: (content: string, summary: string) => ArtifactRecord;
}): PersistedToolOutput {
  const displayData = redactToolOutputForRuntimeStorage(input.result.data);
  const preview = redactSensitiveText(summarizeToolData(input.toolName, displayData) ?? "") || null;
  const fullOutput = stringifyFullToolOutput(input.result);
  if (fullOutput.length <= TOOL_OUTPUT_ARTIFACT_THRESHOLD_CHARS) {
    return {
      preview,
      details: preview ?? undefined,
      truncated: false,
      storedOutputRef: null,
    };
  }

  const artifact = input.addArtifact(
    fullOutput,
    `Stored full ${input.toolName} output (${fullOutput.length} chars).`,
  );
  const storedOutputRef = `artifact:${artifact.id}`;
  return {
    preview,
    details: preview ?? undefined,
    truncated: true,
    storedOutputRef,
  };
}

function stringifyFullToolOutput(result: ToolResult): string {
  try {
    return JSON.stringify(
      {
        ok: result.ok,
        summary: redactSensitiveText(result.summary),
        data: redactToolOutputForRuntimeStorage(result.data ?? null),
      },
      null,
      2,
    );
  } catch {
    return JSON.stringify(
      {
        ok: result.ok,
        summary: redactSensitiveText(result.summary),
        data: redactSensitiveText(String(result.data)),
      },
      null,
      2,
    );
  }
}

function trimForModel(value: string, maxChars = 10_000): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function buildUnifiedSkillRecallQuery(
  objective: string,
  role: AgentRole,
  learnedSkills: Array<{ title: string; triggerSignals: string[]; problemPattern: string }>,
): string {
  const signals = learnedSkills.flatMap((skill) => [
    skill.title,
    skill.problemPattern,
    ...skill.triggerSignals.slice(0, 4),
  ]);
  return trimForModel(
    [objective, `role:${role}`, ...signals]
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(" "),
    320,
  );
}

function clampSubagentBudgetValue(value: number | undefined, fallback: number, min: number, max: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(numericValue)));
}

function buildExtraInstructions(
  objective: string,
  role: AgentRole,
  extensionIds: string[],
  sessionMemories: Array<{ scope: string; content: string; tags: string[] }>,
  workspaceMemories: Array<{ scope: string; content: string; tags: string[] }>,
  workspaceMemoryFiles: WorkspaceMemoryFile[],
  workspaceSkillFiles: WorkspaceSkillFile[],
  rolePlaybooks: AgentPlaybook[],
  profileFacts: Array<{ content: string; tags: string[] }>,
  learnedSkills: Array<{
    title: string;
    problemPattern: string;
    guidance: string;
    changedFiles: string[];
    triggerSignals: string[];
    procedureSteps: string[];
    verificationStatus: string;
    verificationSummary: string;
    revisionCount: number;
    useCount: number;
    qualityScore: number;
    lifecycleState: string;
    materializedSkillPath: string | null;
  }>,
  relatedSessions: Array<{ threadTitle: string; role: string; excerpt: string; createdAt: string }>,
  promptHookInstructions: string[],
): string[] {
  const instructions = [`Registered extensions: ${extensionIds.join(", ")}`];
  const sessionMemoryFiles = workspaceMemoryFiles.filter((entry) => entry.kind === "daily");
  const workspaceMemoryFileRecords = workspaceMemoryFiles.filter((entry) => entry.kind === "memory");
  const profileMemoryFiles = workspaceMemoryFiles.filter((entry) => entry.kind === "user");
  if (sessionMemories.length > 0) {
    instructions.push(
      [
        "Session memory:",
        ...sessionMemories.map((memory) => `- ${memory.content}${memory.tags.length > 0 ? ` (#${memory.tags.join(", #")})` : ""}`),
      ].join("\n"),
    );
  }
  if (sessionMemoryFiles.length > 0) {
    instructions.push(
      [
        "Session memory files:",
        ...sessionMemoryFiles.map((entry) => `- ${entry.path}${entry.truncated ? " [truncated]" : ""}\n${entry.content}`),
      ].join("\n\n"),
    );
  }
  if (workspaceMemories.length > 0) {
    instructions.push(
      [
        "Workspace memory:",
        ...workspaceMemories.map((memory) => `- ${memory.content}${memory.tags.length > 0 ? ` (#${memory.tags.join(", #")})` : ""}`),
      ].join("\n"),
    );
  }
  if (workspaceMemoryFileRecords.length > 0) {
    instructions.push(
      [
        "Workspace memory files (compatible with Hermes/OpenClaw-style file-backed memory):",
        ...workspaceMemoryFileRecords.map((entry) => `- ${entry.path}${entry.truncated ? " [truncated]" : ""}\n${entry.content}`),
      ].join("\n\n"),
    );
  }
  const autoSkillWorkflow = buildRuntimeSkillWorkflowInstructions({
    objective,
    role,
    workspaceSkillFiles,
    rolePlaybooks,
  });
  if (autoSkillWorkflow.length > 0) {
    instructions.push(...autoSkillWorkflow);
  } else if (workspaceSkillFiles.length > 0) {
    instructions.push(
      [
        "Relevant workspace skill files (compatible with Hermes/OpenClaw skill directories):",
        ...workspaceSkillFiles.map(
          (entry) =>
            `- ${entry.name} (${entry.path})${entry.truncated ? " [truncated]" : ""}${entry.description ? `; description=${entry.description}` : ""}${entry.tags.length > 0 ? `; tags=${entry.tags.join(", ")}` : ""}${entry.relatedSkills.length > 0 ? `; related=${entry.relatedSkills.join(", ")}` : ""}${entry.supportingPaths.length > 0 ? `; support=${entry.supportingPaths.join(", ")}` : ""}\n${entry.content}`,
        ),
      ].join("\n\n"),
    );
  }
  if (autoSkillWorkflow.length === 0 && rolePlaybooks.length > 0) {
    instructions.push(
      [
        "Built-in agent playbooks:",
        ...rolePlaybooks.map(
          (playbook) =>
            `- ${playbook.name} (${playbook.id})${playbook.recommendedRoles.length > 0 ? `; roles=${playbook.recommendedRoles.join(", ")}` : ""}; focus=${playbook.description}${playbook.procedure.length > 0 ? `; steps=${playbook.procedure.slice(0, 2).join(" -> ")}` : ""}`,
        ),
      ].join("\n"),
    );
  }
  if (profileFacts.length > 0) {
    instructions.push(
      [
        "Profile memory:",
        ...profileFacts.map((fact) => `- ${fact.content}${fact.tags.length > 0 ? ` (#${fact.tags.join(", #")})` : ""}`),
      ].join("\n"),
    );
  }
  if (profileMemoryFiles.length > 0) {
    instructions.push(
      [
        "Profile memory files:",
        ...profileMemoryFiles.map((entry) => `- ${entry.path}${entry.truncated ? " [truncated]" : ""}\n${entry.content}`),
      ].join("\n\n"),
    );
  }
  if (learnedSkills.length > 0) {
    instructions.push(
      [
        "Learned reusable patterns:",
        ...learnedSkills.map(
          (skill) =>
            [
              `- ${skill.title} (rev=${skill.revisionCount}, uses=${skill.useCount}, quality=${skill.qualityScore}, verified=${skill.verificationStatus}, files=${skill.changedFiles.join(", ") || "n/a"}):`,
              `  pattern=${skill.problemPattern}`,
              `  lifecycle=${skill.lifecycleState}`,
              skill.triggerSignals.length > 0 ? `  triggers=${skill.triggerSignals.join(", ")}` : null,
              skill.procedureSteps.length > 0 ? `  steps=${skill.procedureSteps.join(" -> ")}` : null,
              skill.verificationSummary ? `  verification=${skill.verificationSummary}` : null,
              skill.materializedSkillPath ? `  skill_file=${skill.materializedSkillPath}` : null,
              `  guidance=${skill.guidance}`,
            ]
              .filter((entry): entry is string => Boolean(entry))
              .join("\n"),
        ),
      ].join("\n"),
    );
  }
  if (relatedSessions.length > 0) {
    instructions.push(
      [
        "Related prior session evidence:",
        ...relatedSessions.map(
          (entry) => `- [${entry.threadTitle}] ${entry.createdAt} ${entry.role}: ${entry.excerpt}`,
        ),
      ].join("\n"),
    );
  }
  if (promptHookInstructions.length > 0) {
    instructions.push(["Extension instructions:", ...promptHookInstructions.map((entry) => `- ${entry}`)].join("\n"));
  }
  return instructions;
}

function buildRuntimeSkillWorkflowInstructions(input: {
  readonly objective: string;
  readonly role: AgentRole;
  readonly workspaceSkillFiles: readonly WorkspaceSkillFile[];
  readonly rolePlaybooks: readonly AgentPlaybook[];
}): string[] {
  if (input.workspaceSkillFiles.length === 0 && input.rolePlaybooks.length === 0) {
    return [];
  }
  const selectionLines = [
    "Automatic skill selection:",
    `- role=${input.role}`,
    `- objective=${trimForModel(input.objective, 180)}`,
    ...(input.workspaceSkillFiles.length > 0
      ? [
          `- workspace_skills=${input.workspaceSkillFiles
            .map((entry) => entry.name)
            .join(", ")}`,
        ]
      : []),
    ...(input.rolePlaybooks.length > 0
      ? [
          `- playbooks=${input.rolePlaybooks
            .map((entry) => entry.name)
            .join(", ")}`,
        ]
      : []),
  ];
  const applicationLines = [
    "Skill application briefing:",
    "- Apply workspace skills first when they contain repository-specific checks, references, or operating conventions.",
    "- Apply built-in playbooks as the execution scaffold that organizes planning, delegation, verification, or reporting.",
    ...input.rolePlaybooks.map(
      (playbook) => `- playbook ${playbook.name}: ${playbook.procedure.slice(0, 3).join(" -> ")}`,
    ),
    ...input.workspaceSkillFiles.map(
      (entry) =>
        `- workspace skill ${entry.name}${entry.description ? `: ${entry.description}` : ""}${entry.truncated ? " [truncated]" : ""}${entry.supportingPaths.length > 0 ? `; support=${entry.supportingPaths.join(", ")}` : ""}; preview=${summarizeRuntimeSkillContent(entry.content)}`,
    ),
  ];
  return [selectionLines.join("\n"), applicationLines.join("\n")];
}

function summarizeRuntimeSkillContent(content: string): string {
  const snippets = Array.from(
    new Set(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => !/^---$/.test(line))
        .filter((line) => !/^(Skill|Support)\s*\(/i.test(line))
        .filter((line) => !/^#{1,6}\s*/.test(line))
        .slice(0, 6),
    ),
  )
    .filter((line) => !/^(name|description|metadata)\s*:/i.test(line))
    .map((line) => line.replace(/\s+/g, " "));
  if (snippets.length === 0) {
    return "No concise preview available.";
  }
  return trimForModel(snippets.join(" | "), 280);
}

function prioritizeInjectedPlaybooks(role: AgentRole, playbooks: readonly AgentPlaybook[]): AgentPlaybook[] {
  const preferredIds = role === "planner" || role === "supervisor"
    ? ["plan-decompose-dispatch", "evidence-first-verification"]
    : role === "verifier" || role === "reviewer"
      ? ["evidence-first-verification", "repo-research-handoff"]
      : role === "researcher"
        ? ["repo-research-handoff", "evidence-first-verification"]
        : role === "worker" || role === "executor"
          ? ["focused-execution-loop", "evidence-first-verification"]
          : [];
  if (preferredIds.length === 0) {
    return [...playbooks];
  }
  const byId = new Map(playbooks.map((playbook) => [playbook.id, playbook] as const));
  const prioritized: AgentPlaybook[] = [];
  for (const playbookId of preferredIds) {
    const playbook = byId.get(playbookId);
    if (playbook) {
      prioritized.push(playbook);
      byId.delete(playbookId);
    }
  }
  for (const playbook of playbooks) {
    if (byId.has(playbook.id)) {
      prioritized.push(playbook);
      byId.delete(playbook.id);
    }
  }
  return prioritized;
}

function buildThreadSummary(input: {
  readonly objective: string;
  readonly assistantText: string;
  readonly taskState: TaskState;
  readonly changedFiles: string[];
  readonly verification: VerificationAssessment;
  readonly independentVerification: IndependentVerificationReport | null;
  readonly blockedApprovals: readonly string[];
  readonly taskBoardHandoffItems?: readonly string[];
  readonly taskBoardObserved?: boolean;
  readonly failedToolCount: number;
  readonly mutatingToolSucceeded: boolean;
}): string {
  const resolvedItems = [
    ...input.taskState.completedSubgoals,
    ...(input.assistantText.trim() ? [`Latest outcome: ${trimForModel(input.assistantText.replace(/\s+/g, " ").trim(), 260)}`] : []),
    ...(input.taskBoardObserved && (input.taskBoardHandoffItems?.length ?? 0) === 0 ? ["Task board has no active items."] : []),
  ];
  const pendingItems = Array.from(new Set([
    ...input.taskState.pendingSubgoals,
    ...(input.taskBoardHandoffItems ?? []),
    ...(input.verification.status === "failed" ? ["Repair the failing change and re-run verification."] : []),
    ...(input.mutatingToolSucceeded && input.verification.status === "skipped"
      ? ["Run the planned verification commands before treating the change as complete."]
      : []),
  ]));
  const openRisks = Array.from(new Set([
    ...(input.taskState.recentFailureReason ? [trimForModel(input.taskState.recentFailureReason, 220)] : []),
    ...(input.blockedApprovals.length > 0 ? input.blockedApprovals.map((entry) => trimForModel(entry, 220)) : []),
    ...(input.verification.status === "failed" || input.verification.status === "skipped"
      ? [trimForModel(input.verification.summary, 220)]
      : []),
    ...(input.independentVerification && input.independentVerification.status !== "passed"
      ? [trimForModel(input.independentVerification.summary, 220)]
      : []),
    ...(input.failedToolCount > 0 && !input.taskState.recentFailureReason ? ["One or more tool calls failed during the latest run."] : []),
  ]));

  return trimForModel(
    [
      "## Active Task",
      trimForModel(input.objective, 220),
      "",
      "## Resolved",
      formatThreadSummaryList(resolvedItems),
      "",
      "## Pending",
      formatThreadSummaryList(pendingItems),
      "",
      "## Files Changed",
      formatThreadSummaryList(input.changedFiles),
      "",
      "## Verification Status",
      [
        `${input.verification.status}: ${trimForModel(input.verification.summary, 220)}`,
        ...(input.independentVerification
          ? [
              `Independent verifier ${input.independentVerification.status}: ${trimForModel(
                input.independentVerification.summary,
                220,
              )}`,
            ]
          : []),
      ].join("\n"),
      "",
      "## Open Risks",
      formatThreadSummaryList(openRisks),
    ].join("\n"),
    1_200,
  );
}

function formatThreadSummaryList(values: readonly string[]): string {
  if (values.length === 0) {
    return "None.";
  }
  return values.map((value) => `- ${trimForModel(value, 220)}`).join("\n");
}

function buildLearnedSkillTitle(problemPattern: string, changedFiles: string[]): string {
  const primaryFile = changedFiles[0];
  if (primaryFile) {
    return trimForModel(`Verified pattern for ${primaryFile}`, 120);
  }
  return trimForModel(`Verified pattern: ${problemPattern}`, 120);
}

function buildLearnedSkillTags(changedFiles: string[]): string[] {
  const extensions = changedFiles
    .map((filePath) => {
      const match = /\.([a-zA-Z0-9]+)$/.exec(filePath);
      return match ? match[1]?.toLowerCase() ?? null : null;
    })
    .filter((value): value is string => Boolean(value))
    .map((value) => `ext:${value}`);
  return Array.from(new Set(["auto-learned", "verified", ...extensions]));
}

export * from "./memory-provider.js";
