import { basename, resolve } from "node:path";

import type {
  AcpSessionBindingRecord,
  AcpSessionResetResult,
  ThreadRecord,
  WorkspaceRecord,
  RunRecord,
} from "@omni-agent/session-store";

import type { GatewayRuntimeDefaults, NormalizedGatewayRunRequest } from "./runner.js";

export interface AcpBridgeManifest {
  readonly protocol: "omni.acp-lite";
  readonly protocolVersion: string;
  readonly implementation: {
    readonly name: string;
    readonly version: string;
  };
  readonly referenceProjects: readonly string[];
  readonly capabilities: {
    readonly sessions: {
      readonly create: boolean;
      readonly list: boolean;
      readonly load: boolean;
      readonly fork: boolean;
    };
    readonly prompt: {
      readonly sync: boolean;
      readonly async: boolean;
      readonly contentBlocks: readonly string[];
    };
    readonly cancel: {
      readonly bestEffort: boolean;
    };
    readonly channels: {
      readonly providerManifests: boolean;
      readonly inboundRoutes: boolean;
      readonly outboundDelivery: boolean;
    };
    readonly tools: {
      readonly builtinTools: boolean;
      readonly extensionTools: boolean;
      readonly approvalPolicy: boolean;
    };
    readonly modelSelection: boolean;
    readonly mcpServers: boolean;
    readonly gatewayRuns: boolean;
  };
  readonly concepts: {
    readonly session: "thread";
    readonly run: "gateway-run";
    readonly workspace: "workspace";
    readonly model: "model-profile";
    readonly mcp: "extension-mcp";
    readonly channels: "channel-routes";
    readonly tools: "runtime-tool-registry";
  };
  readonly endpoints: readonly {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly description: string;
  }[];
}

export interface AcpSessionPresentation {
  readonly id: string;
  readonly cwd: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly workspaceId: string;
  readonly activeRunId?: string | null;
  readonly binding?: AcpSessionBinding | null;
}

export interface AcpSessionBinding {
  readonly channelType: string;
  readonly channelKey: string;
  readonly conversationId: string;
}

export interface AcpPromptPayload {
  readonly text: string;
  readonly title?: string;
  readonly async: boolean;
}

export interface AcpRuntimeEventInput {
  readonly type: string;
  readonly at: string;
  readonly workspaceId?: string;
  readonly threadId?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly status?: string;
  readonly summary?: string;
  readonly payload?: unknown;
  readonly presentation?: unknown;
}

export interface AcpGatewayEventInput {
  readonly id?: string;
  readonly type: string;
  readonly at: string;
  readonly data?: unknown;
}

export interface AcpEventProjection {
  readonly protocol: "omni.acp-lite";
  readonly type: string;
  readonly at: string;
  readonly sessionId: string;
  readonly runId: string;
  readonly workspaceId?: string;
  readonly payload: {
    readonly kind: "run" | "tool_call" | "verification";
    readonly rawType: string;
    readonly status?: string;
    readonly summary?: string;
    readonly toolCall?: {
      readonly id: string;
      readonly name: string;
      readonly input?: unknown;
      readonly output?: unknown;
      readonly error?: string;
      readonly title?: string;
      readonly kind?: string;
      readonly locations?: unknown;
      readonly content?: unknown;
      readonly rawInput?: unknown;
      readonly rawOutput?: unknown;
    };
  };
}

export interface AcpListSessionsRequest {
  readonly cwd?: string;
  readonly workspaceId?: string;
  readonly limit: number;
}

export interface AcpCreateSessionRequest {
  readonly cwd: string;
  readonly title: string;
  readonly binding?: AcpSessionBinding;
}

export interface AcpLoadSessionRequest {
  readonly sessionId: string;
}

export interface AcpResolveSessionRequest {
  readonly binding: AcpSessionBinding;
}

export interface AcpResetSessionRequest {
  readonly sessionId?: string;
  readonly binding?: AcpSessionBinding;
}

export interface AcpCancelSessionRequest {
  readonly sessionId: string;
  readonly activeJobId: string | null;
  readonly reason?: string;
}

export interface AcpCancelSessionResult {
  readonly sessionId: string;
  readonly activeJobId: string | null;
  readonly cancelled: boolean;
  readonly reason?: string;
}

export interface AcpResetSessionResult {
  readonly sessionId: string;
  readonly activeRunId: string | null;
  readonly binding: AcpSessionBinding | null;
  readonly reset: AcpSessionResetResult | null;
  readonly session: AcpSessionPresentation | null;
}

export interface AcpSessionStoreLike {
  upsertWorkspace(cwd: string): WorkspaceRecord;
  getWorkspace(workspaceId: string): WorkspaceRecord | null;
  listWorkspaces(): WorkspaceRecord[];
  createThread(workspaceId: string, title: string): ThreadRecord;
  getThread(threadId: string): ThreadRecord | null;
  listThreads(workspaceId: string): ThreadRecord[];
  listRuns?(threadId: string, limit?: number): RunRecord[];
  bindAcpSession?(input: {
    readonly threadId: string;
    readonly channelType: string;
    readonly channelKey: string;
    readonly conversationId: string;
  }): AcpSessionBindingRecord;
  getAcpSessionBinding?(threadId: string): AcpSessionBindingRecord | null;
  findAcpSessionBinding?(input: {
    readonly channelType: string;
    readonly channelKey: string;
    readonly conversationId: string;
  }): AcpSessionBindingRecord | null;
  resetAcpSessionState?(threadId: string): AcpSessionResetResult;
}

const ACP_SENSITIVE_KEY_RE = /(?:api[_-]?key|apikey|authorization|bearer|credential|password|secret|token|webhook)/i;
const ACP_ARTIFACT_PATH_KEY_RE = /^artifactpaths?$/i;
const ACP_SENSITIVE_ARTIFACT_NAME_RE = /\b(?:api[_-]?key|authorization|bearer|credential|password|secret|token|webhook)\b/i;

export interface AcpBridgeOperationContext {
  readonly store: AcpSessionStoreLike;
  readonly defaults: GatewayRuntimeDefaults;
  readonly activeJobs?: ReadonlyMap<string, string>;
}

export interface AcpBridgeOptions extends AcpBridgeOperationContext {
  readonly cancelActiveJob?: (jobId: string, request: AcpCancelSessionRequest) => boolean | Promise<boolean>;
}

export class AcpBridge {
  public constructor(private readonly options: AcpBridgeOptions) {}

  public manifest(): AcpBridgeManifest {
    return buildAcpManifest();
  }

  public list(input: unknown = {}): AcpSessionPresentation[] {
    return listAcpSessions({
      ...this.options,
      request: normalizeAcpListSessionsRequest(input, this.options.defaults),
    });
  }

  public create(input: unknown = {}): AcpSessionPresentation {
    return createAcpSession({
      ...this.options,
      request: normalizeAcpCreateSessionRequest(input, this.options.defaults),
    });
  }

  public load(input: unknown): AcpSessionPresentation | null {
    return loadAcpSession({
      ...this.options,
      request: normalizeAcpLoadSessionRequest(input),
    });
  }

  public resolve(input: unknown): AcpSessionPresentation | null {
    return resolveAcpSession({
      ...this.options,
      request: normalizeAcpResolveSessionRequest(input),
    });
  }

  public reset(input: unknown): AcpResetSessionResult | null {
    return resetAcpSession({
      ...this.options,
      request: normalizeAcpResetSessionRequest(input),
    });
  }

  public async cancel(input: unknown): Promise<AcpCancelSessionResult> {
    const request = normalizeAcpCancelSessionRequest(input, this.options.activeJobs);
    if (!request.activeJobId || !this.options.cancelActiveJob) {
      return {
        sessionId: request.sessionId,
        activeJobId: request.activeJobId,
        cancelled: false,
        reason: request.reason,
      };
    }
    const cancelled = await this.options.cancelActiveJob(request.activeJobId, request);
    return {
      sessionId: request.sessionId,
      activeJobId: request.activeJobId,
      cancelled,
      reason: request.reason,
    };
  }
}

export function buildAcpManifest(): AcpBridgeManifest {
  return buildAcpBridgeManifest();
}

export function buildAcpBridgeManifest(): AcpBridgeManifest {
  return {
    protocol: "omni.acp-lite",
    protocolVersion: "2026-05-01",
    implementation: {
      name: "Omni Agent Gateway ACP Bridge",
      version: "1",
    },
    referenceProjects: ["hermes-agent-main/acp_adapter", "openclaw-main/src/acp"],
    capabilities: {
      sessions: {
        create: true,
        list: true,
        load: true,
        fork: true,
      },
      prompt: {
        sync: true,
        async: true,
        contentBlocks: ["text", "resource", "embedded_resource"],
      },
      cancel: {
        bestEffort: true,
      },
      channels: {
        providerManifests: true,
        inboundRoutes: true,
        outboundDelivery: true,
      },
      tools: {
        builtinTools: true,
        extensionTools: true,
        approvalPolicy: true,
      },
      modelSelection: true,
      mcpServers: true,
      gatewayRuns: true,
    },
    concepts: {
      session: "thread",
      run: "gateway-run",
      workspace: "workspace",
      model: "model-profile",
      mcp: "extension-mcp",
      channels: "channel-routes",
      tools: "runtime-tool-registry",
    },
    endpoints: [
      {
        method: "GET",
        path: "/acp/manifest",
        description: "Describe the gateway ACP-compatible bridge and supported operations.",
      },
      {
        method: "GET",
        path: "/acp/sessions",
        description: "List ACP sessions backed by Omni Agent threads.",
      },
      {
        method: "POST",
        path: "/acp/sessions",
        description: "Create an ACP session for a workspace.",
      },
      {
        method: "GET",
        path: "/acp/sessions/:sessionId",
        description: "Load a single ACP session.",
      },
      {
        method: "POST",
        path: "/acp/sessions/:sessionId/fork",
        description: "Fork an ACP session into a new Omni Agent thread.",
      },
      {
        method: "POST",
        path: "/acp/sessions/:sessionId/prompt",
        description: "Run a prompt through the Omni Agent gateway runtime.",
      },
      {
        method: "POST",
        path: "/acp/sessions/:sessionId/cancel",
        description: "Best-effort cancellation for the active gateway run associated with a session.",
      },
      {
        method: "GET",
        path: "/acp/events/history",
        description: "List ACP-projected runtime events derived from gateway event history.",
      },
    ],
  };
}

export function normalizeAcpListSessionsRequest(
  input: unknown,
  defaults: GatewayRuntimeDefaults,
): AcpListSessionsRequest {
  const record = toRecord(input);
  const cwd = normalizeOptionalString(record.cwd) ?? normalizeOptionalString(defaults.cwd);
  return {
    cwd: cwd ? normalizeAcpCwd(cwd, defaults) : undefined,
    workspaceId: normalizeOptionalString(record.workspaceId ?? record.workspace_id),
    limit: normalizePositiveInteger(record.limit) ?? 50,
  };
}

export function normalizeAcpCreateSessionRequest(
  input: unknown,
  defaults: GatewayRuntimeDefaults,
): AcpCreateSessionRequest {
  const record = toRecord(input);
  const cwd = normalizeAcpCwd(record.cwd, defaults);
  return {
    cwd,
    title: normalizeAcpSessionTitle(record.title ?? record.name, cwd),
    binding: normalizeAcpSessionBinding(record.binding ?? record),
  };
}

export function normalizeAcpLoadSessionRequest(input: unknown): AcpLoadSessionRequest {
  const record = toRecord(input);
  const sessionId = normalizeOptionalString(record.sessionId ?? record.session_id ?? record.id);
  if (!sessionId) {
    throw new Error("ACP load requires a non-empty sessionId.");
  }
  return { sessionId };
}

export function normalizeAcpResolveSessionRequest(input: unknown): AcpResolveSessionRequest {
  const binding = normalizeAcpSessionBinding(input);
  if (!binding) {
    throw new Error("ACP resolve requires channelType, channelKey, and conversationId.");
  }
  return { binding };
}

export function normalizeAcpResetSessionRequest(input: unknown): AcpResetSessionRequest {
  const record = toRecord(input);
  const sessionId = normalizeOptionalString(record.sessionId ?? record.session_id ?? record.id);
  const binding = normalizeAcpSessionBinding(record.binding ?? record);
  if (!sessionId && !binding) {
    throw new Error("ACP reset requires a sessionId or binding.");
  }
  return { sessionId, binding };
}

export function normalizeAcpCancelSessionRequest(
  input: unknown,
  activeJobs?: ReadonlyMap<string, string>,
): AcpCancelSessionRequest {
  const record = toRecord(input);
  const sessionId = normalizeOptionalString(record.sessionId ?? record.session_id ?? record.id);
  if (!sessionId) {
    throw new Error("ACP cancel requires a non-empty sessionId.");
  }
  return {
    sessionId,
    activeJobId: normalizeOptionalString(record.activeJobId ?? record.active_job_id) ?? activeJobs?.get(sessionId) ?? null,
    reason: normalizeOptionalString(record.reason),
  };
}

export function listAcpSessions(input: {
  readonly store: AcpSessionStoreLike;
  readonly request: AcpListSessionsRequest;
  readonly activeJobs?: ReadonlyMap<string, string>;
}): AcpSessionPresentation[] {
  const workspaces = resolveAcpSessionWorkspaces(input.store, input.request);
  const sessions: AcpSessionPresentation[] = [];
  for (const workspace of workspaces) {
    for (const thread of input.store.listThreads(workspace.id)) {
      sessions.push(
        presentAcpSession(
          workspace,
          thread,
          input.activeJobs?.get(thread.id) ?? null,
          input.store.getAcpSessionBinding?.(thread.id) ?? null,
        ),
      );
      if (sessions.length >= input.request.limit) {
        return sessions;
      }
    }
  }
  return sessions;
}

export function createAcpSession(input: {
  readonly store: AcpSessionStoreLike;
  readonly request: AcpCreateSessionRequest;
  readonly activeJobs?: ReadonlyMap<string, string>;
}): AcpSessionPresentation {
  const workspace = input.store.upsertWorkspace(input.request.cwd);
  const thread = input.store.createThread(workspace.id, input.request.title);
  const binding = input.request.binding
    ? input.store.bindAcpSession?.({ threadId: thread.id, ...input.request.binding }) ?? null
    : null;
  return presentAcpSession(workspace, thread, input.activeJobs?.get(thread.id) ?? null, binding);
}

export function loadAcpSession(input: {
  readonly store: AcpSessionStoreLike;
  readonly request: AcpLoadSessionRequest;
  readonly activeJobs?: ReadonlyMap<string, string>;
}): AcpSessionPresentation | null {
  const thread = input.store.getThread(input.request.sessionId);
  if (!thread) {
    return null;
  }
  const workspace = input.store.getWorkspace(thread.workspaceId);
  if (!workspace) {
    return null;
  }
  return presentAcpSession(
    workspace,
    thread,
    input.activeJobs?.get(thread.id) ?? null,
    input.store.getAcpSessionBinding?.(thread.id) ?? null,
  );
}

export function resolveAcpSession(input: {
  readonly store: AcpSessionStoreLike;
  readonly request: AcpResolveSessionRequest;
  readonly activeJobs?: ReadonlyMap<string, string>;
}): AcpSessionPresentation | null {
  const binding = input.store.findAcpSessionBinding?.(input.request.binding);
  if (!binding) {
    return null;
  }
  const thread = input.store.getThread(binding.threadId);
  if (!thread) {
    return null;
  }
  const workspace = input.store.getWorkspace(thread.workspaceId);
  if (!workspace) {
    return null;
  }
  return presentAcpSession(workspace, thread, input.activeJobs?.get(thread.id) ?? null, binding);
}

export function resetAcpSession(input: {
  readonly store: AcpSessionStoreLike;
  readonly request: AcpResetSessionRequest;
  readonly activeJobs?: ReadonlyMap<string, string>;
}): AcpResetSessionResult | null {
  const sessionId = input.request.sessionId ?? resolveAcpSession({ ...input, request: { binding: input.request.binding! } })?.id;
  if (!sessionId) {
    return null;
  }
  const binding = input.store.getAcpSessionBinding?.(sessionId) ?? null;
  const activeRunId = input.activeJobs?.get(sessionId) ?? null;
  const reset = input.store.resetAcpSessionState?.(sessionId) ?? null;
  const session = loadAcpSession({
    store: input.store,
    request: { sessionId },
    activeJobs: input.activeJobs,
  });
  return {
    sessionId,
    activeRunId,
    binding: binding ? presentAcpBinding(binding) : null,
    reset,
    session,
  };
}

export function buildAcpCancelRequest(
  sessionId: string,
  activeJobs?: ReadonlyMap<string, string>,
  reason?: string,
): AcpCancelSessionRequest {
  return normalizeAcpCancelSessionRequest({ sessionId, reason }, activeJobs);
}

export function normalizeAcpCwd(value: unknown, defaults: GatewayRuntimeDefaults): string {
  const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : defaults.cwd;
  return resolve(raw && raw.trim().length > 0 ? raw : process.cwd());
}

export function normalizeAcpSessionTitle(value: unknown, cwd: string): string {
  const explicit = typeof value === "string" ? value.trim() : "";
  if (explicit) {
    return explicit;
  }
  return basename(cwd) || "ACP session";
}

export function presentAcpSession(
  workspace: WorkspaceRecord,
  thread: ThreadRecord,
  activeRunId?: string | null,
  binding?: AcpSessionBindingRecord | AcpSessionBinding | null,
): AcpSessionPresentation {
  return {
    id: thread.id,
    cwd: workspace.cwd,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    workspaceId: workspace.id,
    activeRunId: activeRunId ?? null,
    binding: binding ? presentAcpBinding(binding) : null,
  };
}

export function normalizeAcpPromptPayload(body: Record<string, unknown>): AcpPromptPayload {
  const text = extractAcpPromptText(body.prompt ?? body.content ?? body.text ?? body.message);
  if (!text) {
    throw new Error("ACP prompt requires text, message, content, or prompt text blocks.");
  }
  return {
    text,
    title: typeof body.title === "string" && body.title.trim().length > 0 ? body.title.trim() : undefined,
    async: body.async === true,
  };
}

export function normalizeAcpPromptRequest(input: unknown): AcpPromptPayload {
  return normalizeAcpPromptPayload(toRecord(input));
}

export function buildAcpRunRequest(input: {
  readonly session: AcpSessionPresentation;
  readonly payload: AcpPromptPayload;
  readonly body: Record<string, unknown>;
  readonly defaults: GatewayRuntimeDefaults;
}): NormalizedGatewayRunRequest {
  const body = input.body;
  return {
    task: input.payload.text,
    cwd: normalizeAcpCwd(body.cwd, { ...input.defaults, cwd: input.session.cwd }),
    storageRoot: input.defaults.storageRoot,
    mode: body.mode === "openai" || body.mode === "mock" ? body.mode : input.defaults.mode ?? "mock",
    modelProfileId: normalizeOptionalString(body.modelProfileId) ?? input.defaults.modelProfileId,
    threadTitle: input.payload.title ?? input.session.title,
    threadId: input.session.id,
    continueLatest: body.continueLatest !== false,
    approvalPolicy:
      body.approvalPolicy === "never" ||
      body.approvalPolicy === "on-request" ||
      body.approvalPolicy === "on-failure" ||
      body.approvalPolicy === "manual"
        ? body.approvalPolicy
        : input.defaults.approvalPolicy ?? "on-request",
    executionDomain:
      body.executionDomain === "sandbox" || body.executionDomain === "worktree" || body.executionDomain === "workspace"
        ? body.executionDomain
        : input.defaults.executionDomain ?? "workspace",
    verificationMode:
      body.verificationMode === "best-effort" || body.verificationMode === "required"
        ? body.verificationMode
        : input.defaults.verificationMode ?? "required",
    verificationCommands: normalizeStringArray(body.verificationCommands) ?? input.defaults.verificationCommands ?? [],
    autoApproveRisky: body.autoApproveRisky === true || input.defaults.autoApproveRisky === true,
    maxIterations: normalizePositiveInteger(body.maxIterations) ?? input.defaults.maxIterations ?? 6,
    pluginDirs: normalizeStringArray(body.pluginDirs) ?? input.defaults.pluginDirs ?? [],
    role:
      body.role === "primary" ||
      body.role === "worker" ||
      body.role === "executor" ||
      body.role === "supervisor" ||
      body.role === "verifier" ||
      body.role === "reviewer" ||
      body.role === "researcher" ||
      body.role === "planner"
        ? body.role
        : input.defaults.role,
    contextEngineId: normalizeOptionalString(body.contextEngineId) ?? input.defaults.contextEngineId,
    memoryProviderIds: normalizeStringArray(body.memoryProviderIds) ?? input.defaults.memoryProviderIds,
    extraInstructions: normalizeStringArray(body.extraInstructions) ?? input.defaults.extraInstructions,
    roleModelProfileIds: input.defaults.roleModelProfileIds,
    toolPolicy: input.defaults.toolPolicy,
    toolPolicyContext: input.defaults.toolPolicyContext,
  };
}

export function buildAcpPromptResponse(input: {
  readonly session: AcpSessionPresentation;
  readonly result: Record<string, unknown>;
}): Record<string, unknown> {
  const summary = input.result.summary as { run?: RunRecord; finalResponse?: string } | undefined;
  const finalResponse = typeof summary?.finalResponse === "string" ? summary.finalResponse : "";
  return {
    session: input.session,
    runId: summary?.run?.id ?? null,
    threadId: summary?.run?.threadId ?? input.session.id,
    stopReason: "end_turn",
    output: finalResponse ? [{ type: "text", text: finalResponse }] : [],
    result: input.result,
  };
}

export function projectRuntimeEventToAcpEvent(event: AcpRuntimeEventInput): AcpEventProjection | null {
  const sessionId = normalizeOptionalString(event.threadId);
  const runId = normalizeOptionalString(event.runId);
  if (!sessionId || !runId) {
    return null;
  }

  const kind = resolveAcpEventKind(event.type);
  if (!kind) {
    return null;
  }

  const toolName = normalizeOptionalString(event.toolName);
  const isToolEvent = kind === "tool_call";
  if (isToolEvent && !toolName) {
    return null;
  }
  const toolCallName = isToolEvent ? toolName : undefined;
  const toolCallId = normalizeOptionalString(event.toolCallId);
  const presentation = normalizeToolPresentation(redactAcpProjectionValue(event.presentation));
  const toolInput = event.type === "tool.started" ? redactAcpProjectionValue(event.payload) : undefined;
  const toolOutput =
    event.type === "tool.completed" || event.type === "tool.blocked" || event.type === "tool.failed"
      ? redactAcpProjectionValue(event.payload)
      : undefined;
  const summary = normalizeAndRedactAcpProjectionString(event.summary);

  return {
    protocol: "omni.acp-lite",
    type: toAcpEventType(event.type),
    at: event.at,
    sessionId,
    runId,
    workspaceId: normalizeOptionalString(event.workspaceId),
    payload: {
      kind,
      rawType: event.type,
      status: normalizeOptionalString(event.status),
      summary,
      toolCall: toolCallName
        ? {
            id: `${runId}:${toolCallId ?? toolCallName}`,
            name: toolCallName,
            input: toolInput,
            output: toolOutput,
            error: event.type === "tool.failed" ? summary : undefined,
            title: presentation.title,
            kind: presentation.kind,
            locations: presentation.locations,
            content: presentation.content,
            rawInput: toolInput,
            rawOutput: toolOutput,
          }
        : undefined,
    },
  };
}

function normalizeAndRedactAcpProjectionString(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized ? redactAcpProjectionText(normalized) : undefined;
}

function redactAcpProjectionValue(value: unknown, key = "", seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") {
    if (ACP_ARTIFACT_PATH_KEY_RE.test(key)) {
      return formatAcpArtifactPathForDisplay(value);
    }
    if (ACP_SENSITIVE_KEY_RE.test(key)) {
      return "[redacted]";
    }
    return redactAcpProjectionText(value);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const output = value.map((entry) => redactAcpProjectionValue(entry, key, seen));
    seen.delete(value);
    return output;
  }

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    output[entryKey] = redactAcpProjectionValue(entryValue, entryKey, seen);
  }
  seen.delete(value);
  return output;
}

function redactAcpProjectionText(value: string): string {
  return value
    .replace(
      /((?:[?&]|\b)(?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|sig|signature|token|password|webhook|x-amz-signature|awsaccesskeyid)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(Bearer|Bot)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 [redacted]")
    .replace(/\b(?:xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9_-]{10,})\b/g, "[redacted]");
}

function formatAcpArtifactPathForDisplay(value: string): string {
  const fileName = basename(value.replace(/\\/g, "/")).trim();
  const safeName = fileName && !ACP_SENSITIVE_ARTIFACT_NAME_RE.test(fileName) ? redactAcpProjectionText(fileName) : "[redacted-artifact]";
  return `artifact-path:${safeName}`;
}

export function projectGatewayEventToAcpEvent(event: AcpGatewayEventInput): AcpEventProjection | null {
  const runtimeEvent = coerceRuntimeEvent(event.data) ?? coerceRuntimeEvent(event);
  return runtimeEvent ? projectRuntimeEventToAcpEvent(runtimeEvent) : null;
}

export function presentGatewayEventWithAcpProjection(event: AcpGatewayEventInput): Record<string, unknown> {
  const redactedEvent = redactAcpProjectionValue(event) as Record<string, unknown>;
  return {
    ...redactedEvent,
    acp: projectGatewayEventToAcpEvent(event),
  };
}

function extractAcpPromptText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => extractAcpPromptText(entry))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") {
    return record.text.trim();
  }
  if (typeof record.content === "string") {
    return record.content.trim();
  }
  if (Array.isArray(record.content)) {
    return extractAcpPromptText(record.content);
  }
  return "";
}

function normalizeAcpSessionBinding(value: unknown): AcpSessionBinding | undefined {
  const record = toRecord(value);
  const channelType = normalizeOptionalString(record.channelType ?? record.channel_type);
  const channelKey = normalizeOptionalString(record.channelKey ?? record.channel_key);
  const conversationId = normalizeOptionalString(
    record.conversationId ?? record.conversation_id ?? record.conversation ?? record.threadKey ?? record.thread_key,
  );
  if (!channelType && !channelKey && !conversationId) {
    return undefined;
  }
  if (!channelType || !channelKey || !conversationId) {
    throw new Error("ACP binding requires channelType, channelKey, and conversationId.");
  }
  return { channelType, channelKey, conversationId };
}

function presentAcpBinding(binding: AcpSessionBindingRecord | AcpSessionBinding): AcpSessionBinding {
  return {
    channelType: binding.channelType,
    channelKey: binding.channelKey,
    conversationId: binding.conversationId,
  };
}

function resolveAcpSessionWorkspaces(
  store: AcpSessionStoreLike,
  request: AcpListSessionsRequest,
): WorkspaceRecord[] {
  if (request.workspaceId) {
    const workspace = store.getWorkspace(request.workspaceId);
    return workspace ? [workspace] : [];
  }
  if (request.cwd) {
    return [store.upsertWorkspace(request.cwd)];
  }
  return store.listWorkspaces();
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value instanceof URLSearchParams) {
    return Object.fromEntries(value.entries());
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function resolveAcpEventKind(type: string): AcpEventProjection["payload"]["kind"] | null {
  if (type === "run.started" || type === "run.completed") {
    return "run";
  }
  if (type === "verification.completed") {
    return "verification";
  }
  if (type === "tool.started" || type === "tool.completed" || type === "tool.failed" || type === "tool.blocked") {
    return "tool_call";
  }
  return null;
}

function toAcpEventType(type: string): string {
  if (type.startsWith("tool.")) {
    return `acp.tool_call.${type.slice("tool.".length)}`;
  }
  if (type.startsWith("run.")) {
    return `acp.session.${type.slice("run.".length)}`;
  }
  if (type === "verification.completed") {
    return "acp.verification.completed";
  }
  return `acp.${type}`;
}

function coerceRuntimeEvent(value: unknown): AcpRuntimeEventInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const type = normalizeOptionalString(record.type);
  const at = normalizeOptionalString(record.at);
  if (!type || !at) {
    return null;
  }
  return {
    type,
    at,
    workspaceId: normalizeOptionalString(record.workspaceId),
    threadId: normalizeOptionalString(record.threadId),
    runId: normalizeOptionalString(record.runId),
    toolCallId: normalizeOptionalString(record.toolCallId),
    toolName: normalizeOptionalString(record.toolName),
    status: normalizeOptionalString(record.status),
    summary: normalizeOptionalString(record.summary),
    payload: record.payload,
    presentation: record.presentation,
  };
}

function normalizeToolPresentation(value: unknown): {
  readonly title?: string;
  readonly kind?: string;
  readonly locations?: unknown;
  readonly content?: unknown;
} {
  const record = toRecord(value);
  return {
    title: normalizeOptionalString(record.title),
    kind: normalizeOptionalString(record.kind),
    locations: Array.isArray(record.locations) ? record.locations : undefined,
    content: Array.isArray(record.content) ? record.content : undefined,
  };
}
