import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { assertSafeCommand } from "@omni-agent/approvals";
import {
  listAgentPlaybooks,
  listAgentRoleContracts,
  findRelevantAgentPlaybooks,
  normalizeAgentRole,
  type AgentPlaybook,
  type AgentRoleContract,
} from "@omni-agent/context";
import {
  executeNativeImplementation,
  getNativeImplementationPlan,
  listNativeImplementationPlans,
  summarizeNativeImplementationCoverage,
  type ReferenceNativeCategory,
  type ReferenceNativeSource,
} from "@omni-agent/reference-native";
import { computeAutomationNextRunAt, type ArtifactRecord, type AutomationScheduleKind, type SqliteSessionStore } from "@omni-agent/session-store";
import type {
  ExecutionDomain,
  LocalWorkspaceService,
  TransactionalPatchOperation,
  WorkspaceMemoryFileKind,
} from "@omni-agent/workspace";
import {
  clickBrowserSession,
  closeBrowserSession,
  openBrowserSession,
  setBrowserAutomationAdapterFactoryForTests,
  type BrowserObservation,
  screenshotBrowserSession,
  snapshotBrowserSession,
  typeIntoBrowserSession,
} from "./browser.js";

export { setBrowserAutomationAdapterFactoryForTests } from "./browser.js";

export interface ToolResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
  readonly artifactPaths?: string[];
  readonly warnings?: string[];
  readonly interrupt?: ToolInterruptRequest;
  readonly presentation?: ToolPresentation;
}

export type ToolPresentationKind = "read" | "edit" | "execute" | "search" | "fetch" | "other";

export interface ToolPresentationLocation {
  readonly path: string;
  readonly line?: number;
}

export type ToolPresentationContent =
  | {
      readonly type: "diff";
      readonly path: string;
      readonly text: string;
    }
  | {
      readonly type: "text";
      readonly text: string;
    };

export interface ToolPresentation {
  readonly title?: string;
  readonly kind?: ToolPresentationKind;
  readonly locations?: readonly ToolPresentationLocation[];
  readonly content?: readonly ToolPresentationContent[];
}

export interface TodoTaskBoardHandoff {
  readonly observed: boolean;
  readonly pendingItems: readonly string[];
}

export interface ToolInterruptRequest {
  readonly kind: "ask_user";
  readonly questionId: string;
  readonly question: string;
  readonly context?: string | null;
  readonly suggestedResponses?: string[];
}

export interface ToolExecutionContext {
  readonly workspace: LocalWorkspaceService;
  readonly executionDomain: ExecutionDomain;
  readonly abortSignal?: AbortSignal;
  readonly sessionStore?: SqliteSessionStore;
  readonly workspaceId?: string;
  readonly agentId?: string;
  readonly threadId?: string;
  readonly runId?: string;
  readonly subagentJobId?: string;
  readonly agentRole?: string;
  readonly authority?: SubagentAuthority;
  readonly allowedToolNames?: readonly string[];
  readonly toolPolicyTrace?: readonly string[];
  readonly allowedWriteTargets?: readonly string[];
  readonly subagentController?: SubagentController;
}

export type SubagentAuthority = "leaf" | "orchestrator";
export type SubagentExecutionMode = "background" | "foreground";
export type SubagentOutcomeVisibility = "artifacts_only" | "context" | "summary_only";
export type SubagentSessionMode = "run" | "thread";
export type SubagentJobStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "interrupted"
  | "paused"
  | "queued"
  | "running"
  | "timed_out";

export interface SubagentMessageRecord {
  readonly id: string;
  readonly author: "parent";
  readonly content: string;
  readonly createdAt: string;
}

export interface SubagentBudget {
  readonly maxIterations: number;
  readonly timeoutMs: number;
  readonly maxRetries: number;
}

export interface SubagentGovernanceControls {
  readonly authority?: SubagentAuthority;
  readonly ownerAgentId?: string;
  readonly auditLabel?: string;
  readonly executionDomain?: ExecutionDomain;
  readonly budget?: Partial<SubagentBudget>;
  readonly maxIterations?: number;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxDepth?: number;
  readonly maxConcurrentChildren?: number;
  readonly allowedTools?: string[];
  readonly returnedArtifactKinds?: string[];
  readonly targetPaths?: string[];
  readonly verificationCommands?: string[];
}

export interface StructuredSubagentResult {
  readonly kind: "findings" | "plan" | "review" | "verdict";
  readonly status: string;
  readonly summary: string;
  readonly bullets?: string[];
}

export interface SubagentCompletionReport {
  readonly status: SubagentJobStatus;
  readonly verificationStatus: string;
  readonly changedFiles: string[];
  readonly finalResponse: string;
  readonly error?: string;
  readonly structuredResult?: StructuredSubagentResult;
}

export interface SubagentExecutionRequest {
  readonly objective: string;
  readonly threadTitle?: string;
  readonly sessionMode?: SubagentSessionMode;
  readonly sessionThreadId?: string;
  readonly role?: string;
  readonly handoffInstructions?: string[];
  readonly mode?: SubagentExecutionMode;
  readonly outcomeVisibility?: SubagentOutcomeVisibility;
  readonly authority?: SubagentAuthority;
  readonly ownerAgentId?: string;
  readonly auditLabel?: string;
  readonly executionDomain?: ExecutionDomain;
  readonly pluginDirs?: string[];
  readonly verificationCommands?: string[];
  readonly governance?: SubagentGovernanceControls;
  readonly maxIterations?: number;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly maxDepth?: number;
  readonly maxConcurrentChildren?: number;
  readonly allowedTools?: string[];
  readonly returnedArtifactKinds?: string[];
  readonly targetPaths?: string[];
}

export interface SubagentJobRecord {
  readonly id: string;
  readonly objective: string;
  readonly sessionMode: SubagentSessionMode;
  readonly role?: string;
  readonly mode: SubagentExecutionMode;
  readonly outcomeVisibility: SubagentOutcomeVisibility;
  readonly authority: SubagentAuthority;
  readonly ownerAgentId?: string;
  readonly auditLabel?: string;
  readonly status: SubagentJobStatus;
  readonly rootJobId: string;
  readonly parentJobId?: string;
  readonly depth: number;
  readonly maxDepth: number;
  readonly maxConcurrentChildren: number;
  readonly childJobIds: string[];
  readonly executionDomain: ExecutionDomain;
  readonly budget: SubagentBudget;
  readonly pluginDirs?: string[];
  readonly allowedTools?: string[];
  readonly returnedArtifactKinds?: readonly string[];
  readonly targetPaths?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly toolPolicyTrace?: readonly string[];
  readonly attempts: number;
  readonly createdAt: string;
  readonly queuedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly blockedReason?: string;
  readonly blockedByJobIds?: readonly string[];
  readonly blockedPaths?: readonly string[];
  readonly pausedFromStatus?: "queued" | "running";
  readonly queuePosition?: number;
  readonly updatedAt: string;
  readonly messages: readonly SubagentMessageRecord[];
  readonly threadId?: string;
  readonly runId?: string;
  readonly finalResponse?: string;
  readonly error?: string;
  readonly completion?: SubagentCompletionReport;
  readonly progressEvents?: readonly SubagentProgressEvent[];
}

export interface SubagentProgressEvent {
  readonly at: string;
  readonly status: SubagentJobStatus;
  readonly reason: string;
  readonly summary: string;
}

export interface SubagentController {
  spawn(request: SubagentExecutionRequest): Promise<SubagentJobRecord>;
  get(jobId: string): SubagentJobRecord | null;
  list(): SubagentJobRecord[];
  wait(jobId: string, timeoutMs?: number): Promise<SubagentJobRecord>;
  waitAny(jobIds?: readonly string[], timeoutMs?: number): Promise<SubagentJobRecord>;
  pause(jobId: string): Promise<SubagentJobRecord>;
  resume(jobId: string): Promise<SubagentJobRecord>;
  interrupt(jobId: string): Promise<SubagentJobRecord>;
  send(jobId: string, message: string): Promise<SubagentJobRecord>;
  cancel(jobId: string): Promise<SubagentJobRecord>;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputHint: string;
  readonly riskHint: string;
  execute(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult>;
}

export interface ToolCallRequest {
  readonly id: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputHint: string;
  readonly riskHint: string;
}

export type ToolRuntimeDiagnosticStatus = "failed" | "healthy" | "idle" | "running";

export interface ToolRuntimeDiagnostic {
  readonly name: string;
  readonly status: ToolRuntimeDiagnosticStatus;
  readonly requestCount: number;
  readonly failureCount: number;
  readonly consecutiveFailureCount: number;
  readonly lastStartedAt?: string;
  readonly lastSucceededAt?: string;
  readonly lastFailedAt?: string;
  readonly lastDurationMs?: number;
  readonly lastError?: string;
}

interface MutableToolRuntimeDiagnostic {
  name: string;
  status: ToolRuntimeDiagnosticStatus;
  requestCount: number;
  failureCount: number;
  consecutiveFailureCount: number;
  lastStartedAt?: string;
  lastSucceededAt?: string;
  lastFailedAt?: string;
  lastDurationMs?: number;
  lastError?: string;
}

type MemoryPersistenceBackend = "both" | "file" | "store";
type MemorySearchBackend = "both" | "file" | "store";
type PlanItemStatus = "blocked" | "completed" | "in_progress" | "pending";
type TodoTaskStatus = PlanItemStatus;
type TodoTaskPriority = "high" | "low" | "medium";

interface StructuredPlanItem {
  readonly id: string;
  readonly step: string;
  readonly status: PlanItemStatus;
  readonly note?: string;
}

interface StructuredPlanState {
  readonly summary: string | null;
  readonly items: readonly StructuredPlanItem[];
  readonly updatedAt: string;
  readonly workspaceId?: string;
  readonly threadId?: string;
  readonly runId?: string;
}

interface WorkspaceSkillSelection {
  readonly path: string;
  readonly name: string;
  readonly description: string | null;
  readonly tags: readonly string[];
  readonly relatedSkills: readonly string[];
  readonly supportingPaths: readonly string[];
  readonly truncated: boolean;
  readonly content?: string;
}

interface SubagentTopologyOverview {
  readonly totalJobs: number;
  readonly rootJobs: number;
  readonly activeJobs: number;
  readonly maxDepth: number;
  readonly countsByStatus: Record<string, number>;
  readonly countsByRole: Record<string, number>;
}

interface SubagentTopologyNode extends Record<string, unknown> {
  readonly id: string;
  readonly objective: string;
  readonly role?: string;
  readonly status: SubagentJobStatus;
  readonly depth: number;
  readonly childCount: number;
  readonly children: readonly SubagentTopologyNode[];
}

const structuredPlanStore = new Map<string, StructuredPlanState>();

interface TodoTaskRecord {
  readonly id: string;
  readonly title: string;
  readonly status: TodoTaskStatus;
  readonly priority: TodoTaskPriority;
  readonly labels: readonly string[];
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

interface TodoTaskBoardState {
  readonly tasks: readonly TodoTaskRecord[];
  readonly updatedAt: string;
  readonly workspaceId?: string;
  readonly threadId?: string;
}

const todoTaskBoardStore = new Map<string, TodoTaskBoardState>();

interface ManagedProcessRecord {
  readonly id: string;
  readonly command: string;
  readonly cwd: string;
  readonly ownerWorkspaceRoot: string;
  abortCleanup?: () => void;
  readonly startedAt: string;
  status: "exited" | "running";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  child: ChildProcess;
}

const managedProcesses = new Map<string, ManagedProcessRecord>();
const MANAGED_PROCESS_MAX_RECORDS = 128;

interface ReferenceServiceSpec {
  readonly id: string;
  readonly source: ReferenceSource;
  readonly project: string;
  readonly title: string;
  readonly description: string;
  readonly protocol: "acp" | "cli" | "desktop" | "gateway" | "hermes-loop" | "plugin" | "tui" | "web";
  readonly cwd: string;
  readonly command: string;
  readonly longRunning: boolean;
  readonly requiresPrepare: boolean;
}

interface ReferenceServiceRuntimeRecord {
  readonly serviceId: string;
  readonly processId: string;
  readonly startedAt: string;
}

const referenceServiceRuntime = new Map<string, ReferenceServiceRuntimeRecord>();

const TOOL_ARG_ALIASES = new Map<string, readonly string[]>([
  ["branch", ["branchName", "branch_name"]],
  ["caseSensitive", ["case_sensitive"]],
  ["count", ["limit", "topK", "top_k", "maxResults", "max_results"]],
  ["cwd", ["workingDirectory", "working_directory", "directory", "dir"]],
  ["domainFilter", ["domain_filter", "domains", "domain_filters"]],
  ["endLine", ["end_line", "lineEnd", "line_end", "toLine", "to_line"]],
  ["executionDomain", ["execution_domain"]],
  ["appendNote", ["append_note"]],
  ["allowedTools", ["allowed_tools"]],
  ["auditLabel", ["audit_label", "auditId", "audit_id"]],
  ["headless", ["head_less"]],
  ["includeCompleted", ["include_completed"]],
  ["jobId", ["job_id"]],
  ["limit", ["count", "topK", "top_k", "maxResults", "max_results"]],
  ["maxChars", ["max_chars", "maxLength", "max_length"]],
  ["maxConcurrentChildren", ["max_concurrent_children"]],
  ["maxDepth", ["max_depth"]],
  ["maxIterations", ["max_iterations"]],
  ["newText", ["new_text"]],
  ["oldText", ["old_text"]],
  ["ownerAgentId", ["owner_agent_id", "ownerId", "owner_id"]],
  ["path", ["pathName", "path_name", "filePath", "file_path", "workspacePath", "workspace_path"]],
  ["pluginDirs", ["plugin_dirs", "pluginDirectories", "plugin_directories"]],
  ["query", ["q", "searchQuery", "search_query", "textQuery", "text_query"]],
  ["returnedArtifactKinds", ["returned_artifact_kinds"]],
  ["sessionId", ["session_id"]],
  ["startLine", ["start_line", "lineStart", "line_start", "fromLine", "from_line"]],
  ["taskId", ["task_id"]],
  ["targetPaths", ["target_paths", "writeTargets", "write_targets"]],
  ["threadTitle", ["thread_title"]],
  ["timeoutMs", ["timeout_ms", "timeout"]],
  ["verificationCommands", ["verification_commands"]],
  ["waitForCompletion", ["wait_for_completion"]],
]);

const NUMERIC_TOOL_ARG_KEYS = new Set([
  "count",
  "depth",
  "endLine",
  "limit",
  "maxChars",
  "maxConcurrentChildren",
  "maxDepth",
  "maxIterations",
  "startLine",
  "timeoutMs",
]);

const BOOLEAN_TOOL_ARG_KEYS = new Set([
  "caseSensitive",
  "headless",
  "includeCompleted",
  "waitForCompletion",
]);

const STRING_LIST_TOOL_ARG_KEYS = new Set([
  "commands",
  "allowedTools",
  "domainFilter",
  "labels",
  "pluginDirs",
  "returnedArtifactKinds",
  "tags",
  "targetPaths",
  "verificationCommands",
]);

function clampBuiltInWebSearchCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5;
  }
  return Math.min(10, Math.max(1, Math.trunc(parsed)));
}

function normalizeBuiltInWebSearchDomainFilter(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("web_search domainFilter must be an array of domains when provided.");
  }
  const entries = Array.from(
    new Set(
      value
        .map((entry) => String(entry).trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  const allowlisted = entries.some((entry) => !entry.startsWith("-"));
  const denylisted = entries.some((entry) => entry.startsWith("-"));
  if (allowlisted && denylisted) {
    throw new Error("web_search domainFilter cannot mix allowlist and denylist entries.");
  }
  return entries;
}

function normalizeWorkspaceTargetPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/").trim();
  return normalized;
}

function assertWriteTargetAccess(context: ToolExecutionContext, targetPath: string): void {
  if (!context.subagentJobId) {
    return;
  }
  const allowlist = (context.allowedWriteTargets ?? [])
    .map((entry) => normalizeWorkspaceTargetPath(entry))
    .filter(Boolean);
  if (allowlist.length === 0) {
    return;
  }
  const workspaceRoot = resolve(context.workspace.root);
  const resolvedTarget = resolve(workspaceRoot, String(targetPath ?? ""));
  const targetRelative = relative(workspaceRoot, resolvedTarget).replace(/\\/g, "/");
  if (!targetRelative || targetRelative.startsWith("..")) {
    throw new Error(`Subagent job ${context.subagentJobId} write target escapes workspace root: ${targetPath}`);
  }
  const allowed = allowlist.some((entry) => {
    const resolvedAllowed = resolve(workspaceRoot, entry);
    const allowedRelative = relative(workspaceRoot, resolvedAllowed).replace(/\\/g, "/");
    if (!allowedRelative || allowedRelative.startsWith("..")) {
      return false;
    }
    if (targetRelative === allowedRelative) {
      return true;
    }
    return targetRelative.startsWith(`${allowedRelative}/`);
  });
  if (!allowed) {
    throw new Error(
      `Subagent job ${context.subagentJobId} is not allowed to write ${targetPath}. Declared targets: ${allowlist.join(", ")}`,
    );
  }
}

function normalizeBuiltInWebSearchFreshness(value: unknown): "d" | "m" | "w" | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "d" || normalized === "day" || normalized === "24h") {
    return "d";
  }
  if (normalized === "w" || normalized === "week" || normalized === "7d") {
    return "w";
  }
  if (normalized === "m" || normalized === "month" || normalized === "30d") {
    return "m";
  }
  return undefined;
}

function buildBuiltInWebSearchRequest(input: {
  readonly query: string;
  readonly count: number;
  readonly domainFilter: string[];
  readonly freshness?: "d" | "m" | "w";
}): {
  readonly provider: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly resolvedQuery: string;
  readonly warnings: string[];
} {
  const configuredProvider = process.env.OMNI_AGENT_WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  const provider = configuredProvider === "html" || configuredProvider === "brave"
    ? configuredProvider
    : process.env.BRAVE_API_KEY?.trim()
      ? "brave"
      : "html";
  const warnings: string[] = [];
  const resolvedQuery = [
    input.query,
    ...input.domainFilter.map((domain) => domain.startsWith("-") ? `-site:${domain.slice(1)}` : `site:${domain}`),
  ].join(" ");

  if (provider === "brave") {
    const apiKey = process.env.BRAVE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("web_search provider brave requires BRAVE_API_KEY.");
    }
    const url = new URL(
      process.env.OMNI_AGENT_WEB_SEARCH_BASE_URL?.trim() || "https://api.search.brave.com/res/v1/web/search",
    );
    url.searchParams.set("q", resolvedQuery);
    url.searchParams.set("count", String(input.count));
    if (input.freshness === "d") {
      url.searchParams.set("freshness", "day");
    } else if (input.freshness === "w") {
      url.searchParams.set("freshness", "week");
    } else if (input.freshness === "m") {
      url.searchParams.set("freshness", "month");
    }
    return {
      provider,
      url: url.toString(),
      headers: {
        accept: "application/json",
        "user-agent": "omni-agent/0.1",
        "x-subscription-token": apiKey,
      },
      resolvedQuery,
      warnings,
    };
  }

  const url = new URL(process.env.OMNI_AGENT_WEB_SEARCH_BASE_URL?.trim() || "https://www.bing.com/search");
  url.searchParams.set("q", resolvedQuery);
  url.searchParams.set("count", String(input.count));
  if (input.freshness) {
    const label = input.freshness === "d" ? "day" : input.freshness === "w" ? "week" : "month";
    warnings.push(`Freshness filter "${label}" is ignored by the HTML web_search provider.`);
  }
  return {
    provider: "html",
    url: url.toString(),
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "omni-agent/0.1",
    },
    resolvedQuery,
    warnings,
  };
}

function parseBuiltInWebSearchJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`web_search expected a JSON response but received invalid JSON: ${message}`);
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'");
}

function extractBuiltInWebSearchResultsFromJson(
  payload: unknown,
  count: number,
): Array<{ title: string; url: string; snippet: string }> {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  const candidates = record.web && typeof record.web === "object" && Array.isArray((record.web as { results?: unknown[] }).results)
    ? (record.web as { results: unknown[] }).results
    : Array.isArray(record.items)
    ? record.items
    : Array.isArray((record.webPages as { value?: unknown[] } | undefined)?.value)
      ? (record.webPages as { value: unknown[] }).value
      : Array.isArray(record.results)
        ? record.results
        : [];

  return candidates
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const result = entry as Record<string, unknown>;
      const title = String(result.title ?? result.name ?? "").trim();
      const url = String(result.url ?? result.link ?? result.href ?? "").trim();
      const snippet = String(result.snippet ?? result.description ?? result.body ?? "").trim();
      if (!title || !url) {
        return null;
      }
      return { title, url, snippet };
    })
    .filter((entry): entry is { title: string; url: string; snippet: string } => entry !== null)
    .slice(0, count);
}

function extractBuiltInWebSearchResultsFromHtml(
  rawBody: string,
  requestUrl: string,
  count: number,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const blocks = [
    ...Array.from(rawBody.matchAll(/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi), (match) => match[1] ?? ""),
    ...rawBody.split(/<div[^>]+class="[^"]*result[^"]*"[^>]*>/i).slice(1),
  ];

  for (const block of blocks) {
    const anchorMatch =
      block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i) ??
      block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchorMatch) {
      continue;
    }

    const rawUrl = anchorMatch[1] ?? "";
    const title = htmlToText(anchorMatch[2] ?? "").trim();
    const snippetMatch =
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i) ??
      block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const snippet = htmlToText(snippetMatch?.[1] ?? "").trim();

    const normalizedUrl = normalizeBuiltInSearchResultUrl(rawUrl, requestUrl);
    if (!title || !normalizedUrl) {
      continue;
    }

    results.push({
      title,
      url: normalizedUrl,
      snippet,
    });

    if (results.length >= count) {
      break;
    }
  }

  return results;
}

function normalizeBuiltInSearchResultUrl(value: string, requestUrl: string): string | null {
  const trimmed = decodeHtmlEntities(value).trim();
  if (!trimmed || trimmed.startsWith("#") || /^javascript:/i.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(trimmed, requestUrl);
    if (url.hostname.includes("duckduckgo.com") && url.pathname === "/l/") {
      const redirected = url.searchParams.get("uddg");
      if (redirected) {
        return decodeHtmlEntities(redirected);
      }
    }
    return /^https?:/i.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition>();
  private readonly diagnostics = new Map<string, MutableToolRuntimeDiagnostic>();

  public register(definition: ToolDefinition): void {
    this.definitions.set(definition.name, definition);
    if (!this.diagnostics.has(definition.name)) {
      this.diagnostics.set(definition.name, {
        name: definition.name,
        status: "idle",
        requestCount: 0,
        failureCount: 0,
        consecutiveFailureCount: 0,
      });
    }
  }

  public registerMany(definitions: readonly ToolDefinition[]): void {
    for (const definition of definitions) {
      this.register(definition);
    }
  }

  public listSpecs(): ToolSpec[] {
    return Array.from(this.definitions.values()).map((definition) => ({
      name: definition.name,
      description: definition.description,
      inputHint: definition.inputHint,
      riskHint: definition.riskHint,
    }));
  }

  public getSpec(toolName: string): ToolSpec | null {
    const definition = this.definitions.get(toolName);
    if (!definition) {
      return null;
    }
    return {
      name: definition.name,
      description: definition.description,
      inputHint: definition.inputHint,
      riskHint: definition.riskHint,
    };
  }

  public listDiagnostics(): ToolRuntimeDiagnostic[] {
    return Array.from(this.diagnostics.values())
      .filter((entry) => this.definitions.has(entry.name))
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  public getDiagnostic(toolName: string): ToolRuntimeDiagnostic | null {
    const diagnostic = this.diagnostics.get(toolName);
    return diagnostic && this.definitions.has(toolName) ? { ...diagnostic } : null;
  }

  public async execute(
    toolName: string,
    context: ToolExecutionContext,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const definition = this.definitions.get(toolName);
    if (!definition) {
      throw new Error(`Unknown tool: ${toolName}`);
    }
    const startedAtMs = Date.now();
    const diagnostic = this.ensureDiagnostic(toolName);
    diagnostic.requestCount += 1;
    diagnostic.status = "running";
    diagnostic.lastStartedAt = new Date(startedAtMs).toISOString();
    try {
      const result = await definition.execute(context, normalizeToolArguments(args));
      if (result.ok) {
        this.recordToolSuccess(diagnostic, startedAtMs);
      } else {
        this.recordToolFailure(diagnostic, result.summary, startedAtMs);
      }
      return result;
    } catch (error) {
      this.recordToolFailure(diagnostic, error instanceof Error ? error.message : String(error), startedAtMs);
      throw error;
    }
  }

  public cloneSubset(toolNames: readonly string[]): ToolRegistry {
    const subset = new ToolRegistry();
    for (const toolName of toolNames) {
      const definition = this.definitions.get(toolName);
      if (definition) {
        subset.register(definition);
      }
    }
    return subset;
  }

  private ensureDiagnostic(toolName: string): MutableToolRuntimeDiagnostic {
    let diagnostic = this.diagnostics.get(toolName);
    if (!diagnostic) {
      diagnostic = {
        name: toolName,
        status: "idle",
        requestCount: 0,
        failureCount: 0,
        consecutiveFailureCount: 0,
      };
      this.diagnostics.set(toolName, diagnostic);
    }
    return diagnostic;
  }

  private recordToolSuccess(diagnostic: MutableToolRuntimeDiagnostic, startedAtMs: number): void {
    diagnostic.status = "healthy";
    diagnostic.lastSucceededAt = new Date().toISOString();
    diagnostic.lastDurationMs = Date.now() - startedAtMs;
    diagnostic.consecutiveFailureCount = 0;
    delete diagnostic.lastError;
  }

  private recordToolFailure(
    diagnostic: MutableToolRuntimeDiagnostic,
    error: string,
    startedAtMs: number,
  ): void {
    diagnostic.status = "failed";
    diagnostic.failureCount += 1;
    diagnostic.consecutiveFailureCount += 1;
    diagnostic.lastFailedAt = new Date().toISOString();
    diagnostic.lastDurationMs = Date.now() - startedAtMs;
    diagnostic.lastError = error;
  }
}

function normalizeToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...args };

  for (const [key, value] of Object.entries(args)) {
    const camelCasedKey = snakeToCamelCase(key);
    if (camelCasedKey !== key && isArgumentMissing(normalized[camelCasedKey])) {
      normalized[camelCasedKey] = value;
    }
  }

  for (const [canonicalKey, aliases] of TOOL_ARG_ALIASES) {
    if (!isArgumentMissing(normalized[canonicalKey])) {
      continue;
    }
    for (const alias of aliases) {
      const candidate = normalized[alias];
      if (!isArgumentMissing(candidate)) {
        normalized[canonicalKey] = candidate;
        break;
      }
    }
  }

  for (const key of NUMERIC_TOOL_ARG_KEYS) {
    const candidate = normalized[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        normalized[key] = parsed;
      }
    }
  }

  for (const key of BOOLEAN_TOOL_ARG_KEYS) {
    const candidate = normalized[key];
    if (typeof candidate === "string") {
      const lowered = candidate.trim().toLowerCase();
      if (lowered === "true") {
        normalized[key] = true;
      } else if (lowered === "false") {
        normalized[key] = false;
      }
    }
  }

  for (const key of STRING_LIST_TOOL_ARG_KEYS) {
    const candidate = normalized[key];
    if (typeof candidate === "string") {
      normalized[key] = candidate
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }

  return normalized;
}

function snakeToCamelCase(value: string): string {
  return value.replace(/_+([a-z0-9])/g, (_match, captured: string) => captured.toUpperCase());
}

function isArgumentMissing(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim().length === 0);
}

interface SecretScanFinding {
  readonly kind: string;
  readonly line: number;
  readonly preview: string;
}

interface SecretScanMatch {
  readonly kind: string;
  readonly start: number;
  readonly end: number;
}

const SECRET_ALLOWLIST_RE = /(?:omni-)?secret-scan:\s*allow|pragma:\s*allowlist\s+secret/i;
const SECRET_SCAN_PATTERNS: ReadonlyArray<{ readonly kind: string; readonly pattern: RegExp }> = [
  { kind: "openai_api_key", pattern: /\bsk-(?:proj-|ant-|live-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: "private_key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { kind: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "github_token", pattern: /\bgh[psu]_[A-Za-z0-9_]{30,}\b/g },
  { kind: "generic_secret_assignment", pattern: /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/gi },
];

function scanPlaintextSecrets(content: string): SecretScanFinding[] {
  const findings: SecretScanFinding[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (SECRET_ALLOWLIST_RE.test(line)) {
      continue;
    }
    const lineMatches: SecretScanMatch[] = [];
    for (const rule of SECRET_SCAN_PATTERNS) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null = null;
      while ((match = rule.pattern.exec(line)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        if (!lineMatches.some((entry) => rangesOverlap(start, end, entry.start, entry.end))) {
          lineMatches.push({ kind: rule.kind, start, end });
        }
        if (match[0].length === 0) {
          rule.pattern.lastIndex += 1;
        }
      }
    }
    for (const match of lineMatches) {
      findings.push({
        kind: match.kind,
        line: index + 1,
        preview: redactSecretPreview(),
      });
    }
  }
  return findings;
}

function rangesOverlap(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end;
}

function redactSecretPreview(): string {
  return "[redacted]";
}

function buildTextPresentation(input: {
  readonly title: string;
  readonly kind: ToolPresentationKind;
  readonly path?: string;
  readonly line?: number;
  readonly text?: string;
}): ToolPresentation {
  const text = input.text ? redactPresentationTextIfNeeded(input.text) : undefined;
  return {
    title: input.title,
    kind: input.kind,
    locations: input.path ? [{ path: input.path, line: input.line }] : undefined,
    content: text ? [{ type: "text", text }] : undefined,
  };
}

function buildEditPresentation(title: string, path: string, before: string, after: string): ToolPresentation {
  return {
    title,
    kind: "edit",
    locations: [{ path }],
    content: [{ type: "diff", path, text: buildPresentationDiff(path, before, after) }],
  };
}

function buildTransactionalPatchPresentation(
  title: string,
  operations: readonly TransactionalPatchOperation[],
): ToolPresentation {
  const locations: ToolPresentationLocation[] = [];
  const contents: ToolPresentationContent[] = [];
  const seenPaths = new Set<string>();
  for (const operation of operations.slice(0, 8)) {
    if (!seenPaths.has(operation.path)) {
      seenPaths.add(operation.path);
      locations.push({ path: operation.path, line: operation.type === "range" ? operation.startLine : undefined });
    }
    if (operation.type === "write") {
      contents.push({ type: "diff", path: operation.path, text: buildPresentationDiff(operation.path, "", operation.content) });
    } else if (operation.type === "replace") {
      contents.push({
        type: "diff",
        path: operation.path,
        text: buildPresentationDiff(operation.path, operation.oldText, operation.newText),
      });
    } else {
      const text = `@@ lines ${operation.startLine}-${operation.endLine} @@\n${formatAddedLines(operation.newText)}`;
      contents.push({ type: "diff", path: operation.path, text: redactPresentationDiffIfNeeded(operation.path, text, operation.newText) });
    }
  }
  return {
    title,
    kind: "edit",
    locations,
    content: contents,
  };
}

function buildSearchPresentation(
  query: string,
  path: string,
  matches: readonly { readonly path: string; readonly lineNumber: number; readonly lineText: string }[],
): ToolPresentation {
  return {
    title: `Search "${query}" in ${path}`,
    kind: "search",
    locations: matches.slice(0, 10).map((match) => ({ path: match.path, line: match.lineNumber })),
    content: matches.length > 0
      ? [
          {
            type: "text",
            text: redactPresentationTextIfNeeded(matches.map((match) => `${match.path}:${match.lineNumber}: ${match.lineText}`).join("\n")),
          },
        ]
      : undefined,
  };
}

function buildPresentationDiff(path: string, before: string, after: string): string {
  if (scanPlaintextSecrets([before, after].join("\n")).length > 0) {
    return redactedPresentationDiff(path);
  }
  return trimPresentationText(
    [
      `--- a/${path}`,
      `+++ b/${path}`,
      "@@",
      formatRemovedLines(before),
      formatAddedLines(after),
    ].filter(Boolean).join("\n"),
  );
}

function redactPresentationDiffIfNeeded(path: string, diff: string, content: string): string {
  if (scanPlaintextSecrets(content).length > 0) {
    return redactedPresentationDiff(path);
  }
  return trimPresentationText([`--- a/${path}`, `+++ b/${path}`, diff].filter(Boolean).join("\n"));
}

function redactPresentationTextIfNeeded(text: string): string {
  if (scanPlaintextSecrets(text).length > 0) {
    return "[redacted due to secret scan findings]";
  }
  return trimPresentationText(text);
}

function redactedPresentationDiff(path: string): string {
  return [`--- a/${path}`, `+++ b/${path}`, "@@", "[redacted due to secret scan findings]"].join("\n");
}

function formatRemovedLines(value: string): string {
  return value.split(/\r?\n/).filter((line, index, lines) => index < lines.length - 1 || line.length > 0).map((line) => `-${line}`).join("\n");
}

function formatAddedLines(value: string): string {
  return value.split(/\r?\n/).filter((line, index, lines) => index < lines.length - 1 || line.length > 0).map((line) => `+${line}`).join("\n");
}

function trimPresentationText(value: string, maxChars = 8_000): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 32)).trimEnd()}\n[truncated]`;
}

function formatSecretScanWarnings(findings: readonly SecretScanFinding[]): string[] | undefined {
  if (findings.length === 0) {
    return undefined;
  }
  return findings.map((finding) => `Likely ${finding.kind} secret at line ${finding.line}: ${finding.preview}`);
}

export function registerBuiltInTools(registry: ToolRegistry): void {
  registry.register({
    name: "workspace_info",
    description: "Return repository and workspace metadata.",
    inputHint: "{}",
    riskHint: "read-only",
    async execute(context) {
      const snapshot = await context.workspace.inspect();
      return {
        ok: true,
        summary: `Workspace ${snapshot.repoName} on branch ${snapshot.branch ?? "n/a"} with ${snapshot.changedFiles.length} changed file(s).`,
        data: {
          ...snapshot,
          executionDomain: context.workspace.executionPolicy.executionDomain,
          capabilities: [...context.workspace.executionPolicy.capabilities],
        },
        presentation: buildTextPresentation({
          title: `Inspect workspace ${snapshot.repoName}`,
          kind: "read",
          path: snapshot.cwd,
          text: `cwd: ${snapshot.cwd}\nrepo: ${snapshot.repoName}\nbranch: ${snapshot.branch ?? "n/a"}`,
        }),
      };
    },
  });

  registry.register({
    name: "create_checkpoint",
    description: "Create a managed workspace checkpoint that can be rolled back later.",
    inputHint: "{ name: string }",
    riskHint: "writes managed checkpoint snapshot outside the workspace root",
    async execute(context, args) {
      const name = normalizeOptionalString(args.name);
      if (!name) {
        throw new Error("create_checkpoint requires a non-empty name.");
      }
      const checkpoint = await context.workspace.createCheckpoint(name);
      return {
        ok: true,
        summary: `Created checkpoint ${checkpoint.id} (${checkpoint.name}) at ${checkpoint.path}.`,
        data: checkpoint,
      };
    },
  });

  registry.register({
    name: "list_checkpoints",
    description: "List managed workspace checkpoints available for rollback.",
    inputHint: "{}",
    riskHint: "read-only",
    async execute(context) {
      const checkpoints = await context.workspace.listCheckpoints();
      return {
        ok: true,
        summary: `Listed ${checkpoints.length} checkpoint(s).`,
        data: checkpoints,
      };
    },
  });

  registry.register({
    name: "rollback_checkpoint",
    description: "Roll back the workspace to a managed checkpoint path or id.",
    inputHint: "{ checkpointPath?: string, checkpointId?: string, path?: string, id?: string }",
    riskHint: "destructive workspace rollback; workspace rejects unmanaged checkpoint paths",
    async execute(context, args) {
      const checkpointPath = normalizeOptionalString(args.checkpointPath ?? args.path);
      const checkpointId = normalizeOptionalString(args.checkpointId ?? args.id);
      let selectedPath = checkpointPath;
      if (!selectedPath && checkpointId) {
        const checkpoints = await context.workspace.listCheckpoints();
        selectedPath = checkpoints.find((entry) => entry.id === checkpointId)?.path;
        if (!selectedPath) {
          throw new Error(`rollback_checkpoint could not find checkpoint id: ${checkpointId}`);
        }
      }
      if (!selectedPath) {
        throw new Error("rollback_checkpoint requires checkpointPath or checkpointId.");
      }
      const checkpoint = await context.workspace.rollbackCheckpoint(selectedPath);
      return {
        ok: true,
        summary: `Rolled back checkpoint ${checkpoint.id} (${checkpoint.name}) from ${checkpoint.path}.`,
        data: checkpoint,
      };
    },
  });

  registry.register({
    name: "search_tools",
    description: "Search the current tool surface by capability, name, or risk to understand what the agent can do next.",
    inputHint: "{ query?: string, limit?: number, includeInputHints?: boolean, includeDiagnostics?: boolean }",
    riskHint: "read-only",
    async execute(context, args) {
      const query = normalizeOptionalString(args.query) ?? "";
      const limit = clampPositiveInteger(args.limit, 8);
      const includeInputHints = args.includeInputHints === undefined ? true : normalizeBoolean(args.includeInputHints);
      const includeDiagnostics = args.includeDiagnostics === undefined ? false : normalizeBoolean(args.includeDiagnostics);
      const allowedTools = new Set(context.allowedToolNames ?? registry.listSpecs().map((entry) => entry.name));
      const diagnosticsByName = includeDiagnostics
        ? new Map(registry.listDiagnostics().map((entry) => [entry.name, entry]))
        : new Map<string, ToolRuntimeDiagnostic>();
      const matches = rankToolSpecs(
        registry.listSpecs().filter((entry) => allowedTools.has(entry.name)),
        query,
      )
        .slice(0, limit)
        .map((entry) => ({
          name: entry.name,
          description: entry.description,
          riskHint: entry.riskHint,
          inputHint: includeInputHints ? entry.inputHint : undefined,
          diagnostics: includeDiagnostics ? diagnosticsByName.get(entry.name) ?? null : undefined,
          matchScore: entry.matchScore,
        }));
      return {
        ok: true,
        summary: query
          ? `Found ${matches.length} tool match(es) for "${query}".`
          : `Listed ${matches.length} available tool(s).`,
        data: {
          query: query || null,
          agentRole: context.agentRole ?? null,
          totalAvailable: allowedTools.size,
          toolPolicyTrace: context.toolPolicyTrace ? [...context.toolPolicyTrace] : [],
          tools: matches,
        },
      };
    },
  });

  registry.register({
    name: "search_agent_roles",
    description: "Inspect available agent roles, their response contracts, and their default authority or edit boundaries.",
    inputHint: "{ query?: string, limit?: number, includeAllowedTools?: boolean }",
    riskHint: "read-only",
    async execute(context, args) {
      const query = normalizeOptionalString(args.query) ?? "";
      const limit = clampPositiveInteger(args.limit, 8);
      const includeAllowedTools = args.includeAllowedTools === undefined ? true : normalizeBoolean(args.includeAllowedTools);
      const matches = rankAgentRoleContracts(listAgentRoleContracts(), query, context.allowedToolNames ?? [])
        .slice(0, limit)
        .map((entry) => ({
          role: entry.role,
          defaultAuthority: entry.defaultAuthority,
          canEditFiles: entry.canEditFiles,
          maxToolCallsPerTurn: entry.maxToolCallsPerTurn,
          responseKind: entry.responseKind,
          guidance: [...entry.guidance],
          responseInstructions: [...entry.responseInstructions],
          defaultAllowedTools: includeAllowedTools ? [...(entry.defaultAllowedTools ?? [])] : undefined,
          accessibleDefaultTools: includeAllowedTools
            ? (entry.defaultAllowedTools ?? []).filter((toolName) =>
                !context.allowedToolNames || context.allowedToolNames.includes(toolName),
              )
            : undefined,
          matchScore: entry.matchScore,
        }));
      return {
        ok: true,
        summary: query
          ? `Found ${matches.length} role match(es) for "${query}".`
          : `Listed ${matches.length} agent role contract(s).`,
        data: {
          query: query || null,
          currentRole: context.agentRole ?? null,
          roles: matches,
        },
      };
    },
  });

  registry.register({
    name: "search_agent_playbooks",
    description: "Search built-in agent playbooks that capture proven execution patterns for planning, research, delegation, and verification.",
    inputHint: "{ query?: string, limit?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      const query = normalizeOptionalString(args.query) ?? "";
      const limit = clampPositiveInteger(args.limit, 4);
      const role = normalizeAgentRole(context.agentRole);
      const playbooks = (query
        ? findRelevantAgentPlaybooks({ query, role, limit })
        : listAgentPlaybooks().filter((entry) => entry.recommendedRoles.includes(role)).slice(0, limit)
      ).slice(0, limit);
      return {
        ok: true,
        summary: query
          ? `Found ${playbooks.length} playbook match(es) for "${query}".`
          : `Listed ${playbooks.length} built-in playbook(s) for role ${role}.`,
        data: {
          query: query || null,
          currentRole: role,
          playbooks: playbooks.map((playbook) => ({
            id: playbook.id,
            name: playbook.name,
            description: playbook.description,
            recommendedRoles: [...playbook.recommendedRoles],
            triggerSignals: [...playbook.triggerSignals],
            guidance: [...playbook.guidance],
            procedure: [...playbook.procedure],
          })),
        },
      };
    },
  });

  registry.register({
    name: "search_workspace_skills",
    description: "Search workspace skill files explicitly, similar to Hermes/OpenClaw skill discovery flows.",
    inputHint: "{ query?: string, limit?: number, includeContent?: boolean, maxCharsPerFile?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      const query = normalizeOptionalString(args.query);
      const limit = clampPositiveInteger(args.limit, 4);
      const includeContent = args.includeContent === undefined ? true : normalizeBoolean(args.includeContent);
      const maxCharsPerFile = args.maxCharsPerFile === undefined ? undefined : clampPositiveInteger(args.maxCharsPerFile, 600);
      const skills = await context.workspace.loadSkillFiles({
        query,
        maxFiles: limit,
        maxCharsPerFile,
      });
      return {
        ok: true,
        summary: query
          ? `Found ${skills.length} workspace skill match(es) for "${query}".`
          : `Listed ${skills.length} workspace skill file(s).`,
        data: skills.map((entry) => ({
          path: entry.path,
          name: entry.name,
          description: entry.description,
          tags: [...entry.tags],
          relatedSkills: [...entry.relatedSkills],
          supportingPaths: [...entry.supportingPaths],
          truncated: entry.truncated,
          content: includeContent ? entry.content : undefined,
        })),
      };
    },
  });

  registry.register({
    name: "skills_list",
    description: "Alias for search_workspace_skills, matching Hermes-style skill discovery naming.",
    inputHint: "{ query?: string, limit?: number, includeContent?: boolean, maxCharsPerFile?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      return registry.execute("search_workspace_skills", context, args);
    },
  });

  registry.register({
    name: "skill_manage",
    description: "Review, create, patch, write support files for, remove files from, promote, rollback, or disable a workspace learned skill.",
    inputHint:
      "{ action: string, category?: string, name?: string, skillPath?: string, path?: string, content?: string, oldText?: string, newText?: string, skillId?: string, target?: string, reason?: string, limit?: number }",
    riskHint: "writes workspace skill files or learned skill state",
    async execute(context, args) {
      const action = normalizeOptionalString(args.action);
      if (!action) {
        throw new Error("skill_manage requires an action.");
      }
      switch (action) {
        case "create":
          return createManagedSkill(context, args);
        case "review":
          return reviewManagedSkillFile(context, args);
        case "patch":
          return patchManagedSkillFile(context, args);
        case "write_file":
          return writeManagedSkillSupportFile(context, args);
        case "remove_file":
          return removeManagedSkillSupportFile(context, args);
        case "review_queue":
          return reviewManagedLearnedSkillQueue(context, args);
        case "promote":
          return promoteManagedLearnedSkill(context, args);
        case "rollback":
          return rollbackManagedLearnedSkill(context, args);
        case "disable":
          return disableManagedLearnedSkill(context, args);
        default:
          throw new Error(`Unsupported skill_manage action: ${action}`);
      }
    },
  });

  registry.register({
    name: "select_skills",
    description: "Explicitly select workspace skills and built-in playbooks before execution, following a two-stage Hermes-style skill flow.",
    inputHint: "{ query?: string, objective?: string, role?: string, limit?: number, includeContent?: boolean, includePlaybooks?: boolean, maxCharsPerFile?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      const objective = normalizeOptionalString(args.objective);
      const query = normalizeOptionalString(args.query) ?? objective;
      const limit = clampPositiveInteger(args.limit, 4);
      const includeContent = args.includeContent === undefined ? true : normalizeBoolean(args.includeContent);
      const includePlaybooks = args.includePlaybooks === undefined ? true : normalizeBoolean(args.includePlaybooks);
      const maxCharsPerFile = args.maxCharsPerFile === undefined ? undefined : clampPositiveInteger(args.maxCharsPerFile, 600);
      const role = normalizeAgentRole(normalizeOptionalString(args.role) ?? context.agentRole);
      const workspaceSkills = await context.workspace.loadSkillFiles({
        query,
        maxFiles: limit,
        maxCharsPerFile,
      });
      const playbookQuery = [objective, query].filter((entry): entry is string => Boolean(entry)).join(" ").trim();
      const playbooks = includePlaybooks
        ? (playbookQuery
          ? findRelevantAgentPlaybooks({ query: playbookQuery, role, limit })
          : listAgentPlaybooks().filter((entry) => entry.recommendedRoles.includes(role)).slice(0, limit))
        : [];
      const selectedWorkspaceSkills = workspaceSkills.map((entry) => ({
        path: entry.path,
        name: entry.name,
        description: entry.description,
        tags: [...entry.tags],
        relatedSkills: [...entry.relatedSkills],
        supportingPaths: [...entry.supportingPaths],
        truncated: entry.truncated,
        content: includeContent ? entry.content : undefined,
      }));
      return {
        ok: true,
        summary: `Selected ${selectedWorkspaceSkills.length} workspace skill(s) and ${playbooks.length} built-in playbook(s) for role ${role}.`,
        data: {
          query: query ?? null,
          objective: objective ?? null,
          currentRole: role,
          workspaceSkills: selectedWorkspaceSkills,
          playbooks: playbooks.map((playbook) => ({
            id: playbook.id,
            name: playbook.name,
            description: playbook.description,
            recommendedRoles: [...playbook.recommendedRoles],
            triggerSignals: [...playbook.triggerSignals],
            guidance: [...playbook.guidance],
            procedure: [...playbook.procedure],
          })),
          nextTool: "apply_skills",
          nextArgs: {
            objective: objective ?? query ?? null,
            role,
            workspaceSkills: selectedWorkspaceSkills,
            playbookIds: playbooks.map((playbook) => playbook.id),
          },
        },
      };
    },
  });

  registry.register({
    name: "apply_skills",
    description: "Apply previously selected workspace skills and built-in playbooks by assembling their active instructions into one execution briefing.",
    inputHint: "{ objective?: string, role?: string, workspaceSkills?: object[], workspaceSkillPaths?: string[], playbookIds?: string[], maxCharsPerSkill?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      const objective = normalizeOptionalString(args.objective);
      const role = normalizeAgentRole(normalizeOptionalString(args.role) ?? context.agentRole);
      const maxCharsPerSkill = clampPositiveInteger(args.maxCharsPerSkill, 2_000);
      const workspaceSkills = await resolveSelectedWorkspaceSkills(context, args, maxCharsPerSkill);
      const playbookIds = normalizeStringList(args.playbookIds);
      const playbooksById = new Map(listAgentPlaybooks().map((playbook) => [playbook.id, playbook] as const));
      const playbooks = playbookIds
        .map((id) => playbooksById.get(id))
        .filter((entry): entry is AgentPlaybook => Boolean(entry));
      if (workspaceSkills.length === 0 && playbooks.length === 0) {
        throw new Error("apply_skills requires at least one selected workspace skill or playbook.");
      }
      return {
        ok: true,
        summary: `Applied ${workspaceSkills.length} workspace skill(s) and ${playbooks.length} built-in playbook(s) for role ${role}.`,
        data: {
          objective: objective ?? null,
          currentRole: role,
          applied: {
            workspaceSkills: workspaceSkills.map((entry) => ({
              path: entry.path,
              name: entry.name,
              description: entry.description,
              tags: [...entry.tags],
              relatedSkills: [...entry.relatedSkills],
              supportingPaths: [...entry.supportingPaths],
              truncated: entry.truncated,
            })),
            playbooks: playbooks.map((playbook) => ({
              id: playbook.id,
              name: playbook.name,
              description: playbook.description,
              recommendedRoles: [...playbook.recommendedRoles],
              triggerSignals: [...playbook.triggerSignals],
            })),
          },
          instructions: [
            ...workspaceSkills.map((entry) => ({
              kind: "workspace_skill",
              path: entry.path,
              name: entry.name,
              description: entry.description,
              tags: [...entry.tags],
              relatedSkills: [...entry.relatedSkills],
              supportingPaths: [...entry.supportingPaths],
              truncated: entry.truncated,
              content: entry.content ?? "",
            })),
            ...playbooks.map((playbook) => ({
              kind: "agent_playbook",
              id: playbook.id,
              name: playbook.name,
              description: playbook.description,
              recommendedRoles: [...playbook.recommendedRoles],
              triggerSignals: [...playbook.triggerSignals],
              guidance: [...playbook.guidance],
              procedure: [...playbook.procedure],
            })),
          ],
          briefing: renderAppliedSkillBriefing({
            objective,
            role,
            workspaceSkills,
            playbooks,
          }),
        },
      };
    },
  });

  registry.register({
    name: "reference_capabilities",
    description:
      "Scan or import portable capabilities from sibling reference projects: claudecode-source, hermes-agent-main, and openclaw-main. Supports listing source-backed modules and importing SKILL.md directories into the current workspace.",
    inputHint:
      "{ action?: 'list'|'search'|'import_skill'|'import_all'|'sync_sources', query?: string, source?: 'hermes'|'openclaw'|'claudecode', id?: string, limit?: number, includeContent?: boolean, maxChars?: number, targetCategory?: string }",
    riskHint: "read-only for list/search; writes workspace skill files for import_skill/import_all and refreshes vendor/reference for sync_sources",
    async execute(context, args) {
      const action = (normalizeOptionalString(args.action) ?? "list").toLowerCase();
      if (action === "sync_sources") {
        const result = await context.workspace.runCommand("npm run reference:sync", { timeoutMs: 300_000 });
        return {
          ok: result.ok,
          summary: result.ok ? "Synchronized reference project sources into vendor/reference." : "Failed to synchronize reference project sources.",
          data: result,
          artifactPaths: result.artifactPath ? [result.artifactPath] : [],
        };
      }

      const query = normalizeOptionalString(args.query);
      const source = normalizeReferenceSource(args.source);
      const limit = clampPositiveInteger(args.limit, action === "import_all" ? 500 : 20);
      const includeContent = args.includeContent === undefined ? false : normalizeBoolean(args.includeContent);
      const maxChars = clampPositiveInteger(args.maxChars, 1_200);
      const capabilities = await scanReferenceCapabilities(context.workspace.root, {
        query,
        source,
        limit: action === "import_skill" ? Math.max(limit, 200) : limit,
        includeContent,
        maxChars,
      });

      if (action === "list" || action === "search") {
        return {
          ok: true,
          summary: query
            ? `Found ${capabilities.length} reference capability match(es) for "${query}".`
            : `Listed ${capabilities.length} reference capability item(s).`,
          data: {
            query: query ?? null,
            source: source ?? null,
            capabilities,
          },
        };
      }

      if (action === "import_skill") {
        const id = normalizeOptionalString(args.id);
        const selected = id
          ? capabilities.find((entry) => entry.id === id || entry.path === id || entry.relativePath === id)
          : capabilities.find((entry) => entry.type === "skill");
        if (!selected) {
          throw new Error("reference_capabilities import_skill requires an id/path matching a portable skill.");
        }
        if (selected.type !== "skill") {
          throw new Error(`Reference capability ${selected.id} is not a portable skill.`);
        }
        const result = await importReferenceSkill(context, selected, normalizeOptionalString(args.targetCategory));
        return {
          ok: true,
          summary: `Imported ${selected.source} skill ${selected.title} into ${result.targetDirectory}.`,
          data: {
            capability: selected,
            ...result,
          },
        };
      }

      if (action === "import_all") {
        const skills = capabilities.filter((entry) => entry.type === "skill");
        const imports = [];
        for (const skill of skills) {
          imports.push(await importReferenceSkill(context, skill, normalizeOptionalString(args.targetCategory), true));
        }
        const importedFileCount = imports.reduce((total, entry) => total + entry.importedFiles.length, 0);
        return {
          ok: true,
          summary: `Imported ${imports.length} reference skill(s) with ${importedFileCount} file(s).`,
          data: {
            query: query ?? null,
            source: source ?? null,
            importedSkillCount: imports.length,
            importedFileCount,
            imports,
          },
        };
      }

      throw new Error(`Unsupported reference_capabilities action: ${action}`);
    },
  });

  registry.register({
    name: "reference_project",
    description:
      "Operate on vendored reference projects that were synced from claudecode-source, hermes-agent-main, and openclaw-main. Supports project overview, scoped file reads/search, and running safe diagnostic commands inside a reference project.",
    inputHint:
      "{ action?: 'overview'|'list_files'|'read_file'|'search_text'|'run_command'|'run_script', source?: 'hermes'|'openclaw'|'claudecode', project?: string, path?: string, query?: string, command?: string, script?: string, depth?: number, limit?: number, maxChars?: number, timeoutMs?: number }",
    riskHint: "read-only for overview/list/read/search; run_command/run_script execute inside vendor/reference only and block dangerous commands",
    async execute(context, args) {
      const action = (normalizeOptionalString(args.action) ?? "overview").toLowerCase();
      const source = normalizeReferenceSource(args.source);
      const projects = await resolveReferenceProjectViews(context.workspace.root, source);
      if (action === "overview" && !source) {
        return {
          ok: true,
          summary: `Found ${projects.length} vendored reference project(s).`,
          data: {
            projects: await Promise.all(projects.map((project) => loadReferenceProjectOverview(project))),
          },
        };
      }

      const project = selectReferenceProject(projects, normalizeOptionalString(args.project), source);
      const workspacePath = project.workspacePath;
      const targetPath = normalizeReferenceSubpath(args.path);

      if (action === "overview") {
        return {
          ok: true,
          summary: `Loaded ${project.source} reference project overview for ${project.name}.`,
          data: await loadReferenceProjectOverview(project),
        };
      }

      if (action === "list_files") {
        const depth = clampPositiveInteger(args.depth, 2);
        const entries = await context.workspace.listDirectory(join(workspacePath, targetPath), depth);
        return {
          ok: true,
          summary: `Listed ${entries.length} file(s) under ${project.name}/${targetPath || "."}.`,
          data: {
            project,
            path: targetPath || ".",
            entries,
          },
        };
      }

      if (action === "read_file") {
        const maxChars = clampPositiveInteger(args.maxChars, 20_000);
        const content = await context.workspace.readFile(join(workspacePath, targetPath), { maxChars });
        return {
          ok: true,
          summary: `Read ${project.name}/${targetPath}.`,
          data: {
            project,
            path: targetPath,
            content,
          },
        };
      }

      if (action === "search_text") {
        const query = normalizeOptionalString(args.query);
        if (!query) {
          throw new Error("reference_project search_text requires a non-empty query.");
        }
        const limit = clampPositiveInteger(args.limit, 20);
        const matches = await context.workspace.searchText(query, {
          path: join(workspacePath, targetPath),
          limit,
        });
        return {
          ok: true,
          summary: `Found ${matches.length} text match(es) in ${project.name}.`,
          data: {
            project,
            query,
            path: targetPath || ".",
            matches,
          },
        };
      }

      if (action === "run_command") {
        const command = normalizeOptionalString(args.command);
        if (!command) {
          throw new Error("reference_project run_command requires a non-empty command.");
        }
        assertSafeCommand(command);
        const timeoutMs = clampPositiveInteger(args.timeoutMs, 120_000);
        const result = await context.workspace.runCommand(command, {
          cwd: workspacePath,
          timeoutMs,
          abortSignal: context.abortSignal,
        });
        return {
          ok: result.ok,
          summary: `${result.ok ? "Ran" : "Failed"} ${project.name} reference command: ${command}`,
          data: {
            project,
            result,
          },
          artifactPaths: result.artifactPath ? [result.artifactPath] : [],
        };
      }

      if (action === "run_script") {
        const script = normalizeReferenceScriptName(args.script);
        const overview = await loadReferenceProjectOverview(project);
        if (!overview.packageScripts.includes(script)) {
          throw new Error(`Reference project ${project.name} does not define package script "${script}".`);
        }
        const command = `${overview.packageManager === "pnpm" ? "pnpm" : "npm"} run ${script}`;
        assertSafeCommand(command);
        const timeoutMs = clampPositiveInteger(args.timeoutMs, 120_000);
        const result = await context.workspace.runCommand(command, {
          cwd: workspacePath,
          timeoutMs,
          abortSignal: context.abortSignal,
        });
        return {
          ok: result.ok,
          summary: `${result.ok ? "Ran" : "Failed"} ${project.name} reference script: ${script}`,
          data: {
            project,
            script,
            result,
          },
          artifactPaths: result.artifactPath ? [result.artifactPath] : [],
        };
      }

      throw new Error(`Unsupported reference_project action: ${action}`);
    },
  });

  registry.register({
    name: "reference_adapter",
    description:
      "List and invoke normalized adapters generated from the vendored reference projects. Adapters cover package scripts, known Python/Node/Bun entrypoints, imported skills, and OpenClaw plugin manifests.",
    inputHint:
      "{ action?: 'list'|'invoke'|'health'|'prepare', source?: 'hermes'|'openclaw'|'claudecode', project?: string, id?: string, query?: string, args?: string[], prepareMode?: 'install'|'build'|'full', timeoutMs?: number }",
    riskHint: "list/health are read-only; invoke/prepare run inside vendor/reference with sanitized arguments or fixed bootstrap commands",
    async execute(context, args) {
      const action = (normalizeOptionalString(args.action) ?? "list").toLowerCase();
      const source = normalizeReferenceSource(args.source);
      const query = normalizeOptionalString(args.query);
      const adapters = await listReferenceAdapters(context.workspace.root, { source, query });

      if (action === "list") {
        return {
          ok: true,
          summary: `Listed ${adapters.length} reference adapter(s).`,
          data: {
            source: source ?? null,
            query: query ?? null,
            adapters,
          },
        };
      }

      if (action === "health") {
        const projects = await resolveReferenceProjectViews(context.workspace.root, source);
        return {
          ok: true,
          summary: `Checked ${projects.length} reference adapter project(s).`,
          data: {
            projects: await Promise.all(projects.map((project) => loadReferenceAdapterHealth(project))),
          },
        };
      }

      if (action === "invoke") {
        const id = normalizeOptionalString(args.id);
        if (!id) {
          throw new Error("reference_adapter invoke requires an adapter id.");
        }
        const adapter = adapters.find((entry) => entry.id === id);
        if (!adapter) {
          throw new Error(`No reference adapter found for id=${id}.`);
        }
        if (!adapter.invokable || !adapter.command) {
          throw new Error(`Reference adapter ${id} is descriptive and cannot be invoked directly.`);
        }
        const runtimeArgs = normalizeReferenceAdapterArgs(args.args);
        const command = [adapter.command, ...runtimeArgs.map(quoteReferenceShellArgument)].join(" ");
        assertSafeCommand(command);
        const timeoutMs = clampPositiveInteger(args.timeoutMs, 120_000);
        const result = await context.workspace.runCommand(command, {
          cwd: adapter.cwd,
          timeoutMs,
          abortSignal: context.abortSignal,
        });
        return {
          ok: result.ok,
          summary: `${result.ok ? "Invoked" : "Failed"} reference adapter ${adapter.id}.`,
          data: {
            adapter,
            args: runtimeArgs,
            result,
          },
          artifactPaths: result.artifactPath ? [result.artifactPath] : [],
        };
      }

      if (action === "prepare") {
        if (!source) {
          throw new Error("reference_adapter prepare requires a source.");
        }
        const projects = await resolveReferenceProjectViews(context.workspace.root, source);
        const project = selectReferenceProject(projects, normalizeOptionalString(args.project), source);
        const mode = normalizeReferencePrepareMode(args.prepareMode);
        const command = buildReferencePrepareCommand(source, mode);
        const timeoutMs = clampPositiveInteger(args.timeoutMs, mode === "full" ? 900_000 : 300_000);
        const result = await context.workspace.runCommand(command, {
          cwd: project.workspacePath,
          timeoutMs,
          abortSignal: context.abortSignal,
        });
        return {
          ok: result.ok,
          summary: `${result.ok ? "Prepared" : "Failed to prepare"} ${project.name} with mode=${mode}.`,
          data: {
            project,
            mode,
            command,
            result,
          },
          artifactPaths: result.artifactPath ? [result.artifactPath] : [],
        };
      }

      throw new Error(`Unsupported reference_adapter action: ${action}`);
    },
  });

  registry.register({
    name: "reference_service",
    description:
      "Manage long-running native lifecycle adapters for vendored reference projects: OpenClaw gateway/CLI, Hermes Python agent loop, and ClaudeCode Bun TUI/web/desktop surfaces. Supports service discovery, start/status/logs/stop, and OpenClaw plugin protocol inspection.",
    inputHint:
      "{ action?: 'list'|'start'|'status'|'logs'|'stop'|'protocols', source?: 'hermes'|'openclaw'|'claudecode', id?: string, query?: string, args?: string[], timeoutMs?: number }",
    riskHint: "starts or stops managed long-running reference processes inside vendor/reference; protocols/list/status/logs are read-only",
    async execute(context, args) {
      const action = (normalizeOptionalString(args.action) ?? "list").toLowerCase();
      const source = normalizeReferenceSource(args.source);
      const query = normalizeOptionalString(args.query);
      const services = await listReferenceServices(context.workspace.root, { source, query });

      if (action === "list") {
        return {
          ok: true,
          summary: `Listed ${services.length} reference service(s).`,
          data: {
            services: services.map((service) => describeReferenceService(service)),
          },
        };
      }

      if (action === "protocols") {
        const protocols = await listReferencePluginProtocols(context.workspace.root, { source, query });
        return {
          ok: true,
          summary: `Listed ${protocols.length} reference plugin protocol item(s).`,
          data: {
            protocols,
          },
        };
      }

      const id = normalizeOptionalString(args.id);
      if (!id) {
        throw new Error(`reference_service ${action} requires a service id.`);
      }

      if (action === "start") {
        const service = selectReferenceService(services, id);
        const existingRuntime = referenceServiceRuntime.get(service.id);
        if (existingRuntime) {
          const existingProcess = managedProcesses.get(existingRuntime.processId);
          if (existingProcess?.status === "running") {
            return {
              ok: true,
              summary: `Reference service ${service.id} is already running.`,
              data: describeReferenceServiceRuntime(service, existingProcess),
            };
          }
        }
        const runtimeArgs = normalizeReferenceAdapterArgs(args.args);
        const command = [service.command, ...runtimeArgs.map(quoteReferenceShellArgument)].join(" ");
        assertSafeCommand(command);
        const process = startManagedProcess(
          command,
          resolve(context.workspace.root, service.cwd),
          await resolveManagedProcessWorkspaceRoot(context),
        );
        referenceServiceRuntime.set(service.id, {
          serviceId: service.id,
          processId: process.id,
          startedAt: process.startedAt,
        });
        const warmupMs = Math.min(clampPositiveInteger(args.timeoutMs, 750), 5_000);
        await waitForReferenceServiceWarmup(warmupMs);
        return {
          ok: true,
          summary: `Started reference service ${service.id}.`,
          data: describeReferenceServiceRuntime(service, process),
        };
      }

      if (action === "status" || action === "logs") {
        const service = selectReferenceService(services, id);
        const runtime = referenceServiceRuntime.get(service.id);
        const process = runtime ? managedProcesses.get(runtime.processId) ?? null : null;
        return {
          ok: true,
          summary: process ? `Read reference service ${service.id}.` : `Reference service ${service.id} is not running.`,
          data: process ? describeReferenceServiceRuntime(service, process) : { service: describeReferenceService(service), runtime: null },
        };
      }

      if (action === "stop") {
        const service = selectReferenceService(services, id);
        const runtime = referenceServiceRuntime.get(service.id);
        if (!runtime) {
          return {
            ok: true,
            summary: `Reference service ${service.id} was not running.`,
            data: { service: describeReferenceService(service), runtime: null },
          };
        }
        const process = managedProcesses.get(runtime.processId);
        if (process) {
          await stopManagedProcess(process);
        }
        referenceServiceRuntime.delete(service.id);
        return {
          ok: true,
          summary: `Stopped reference service ${service.id}.`,
          data: process ? describeReferenceServiceRuntime(service, process) : { service: describeReferenceService(service), runtime: null },
        };
      }

      throw new Error(`Unsupported reference_service action: ${action}`);
    },
  });

  registry.register({
    name: "reference_integration",
    description:
      "Expose mapped integration descriptors for ClaudeCode UI/LSP, Hermes process-tool adapters, OpenClaw plugin/channel/provider schemas, and large reference modules mapped onto omni-agent surfaces.",
    inputHint:
      "{ action?: 'list'|'schema'|'coverage'|'write_manifest'|'contract'|'invoke'|'plan', source?: 'hermes'|'openclaw'|'claudecode', category?: string, query?: string, id?: string, path?: string, args?: string[], serviceAction?: 'start'|'status'|'logs'|'stop', runChecks?: boolean, timeoutMs?: number }",
    riskHint:
      "read-only except write_manifest; invoke can start managed reference services or run process-isolated Hermes tools with sanitized arguments",
    async execute(context, args) {
      const action = (normalizeOptionalString(args.action) ?? "list").toLowerCase();
      const source = normalizeReferenceSource(args.source);
      const category = normalizeOptionalString(args.category);
      const query = normalizeOptionalString(args.query);
      const descriptors = await listReferenceIntegrations(context.workspace.root, { source, category, query });

      if (action === "list") {
        return {
          ok: true,
          summary: `Listed ${descriptors.length} reference integration descriptor(s).`,
          data: {
            source: source ?? null,
            category: category ?? null,
            query: query ?? null,
            descriptors,
          },
        };
      }

      if (action === "schema") {
        return {
          ok: true,
          summary: "Returned reference integration schema.",
          data: buildReferenceIntegrationSchema(),
        };
      }

      if (action === "coverage") {
        return {
          ok: true,
          summary: `Computed native fusion coverage for ${descriptors.length} reference integration descriptor(s).`,
          data: buildReferenceNativeFusionCoverage(descriptors),
        };
      }

      if (action === "contract") {
        const id = normalizeOptionalString(args.id);
        const selected = id ? [selectReferenceIntegration(descriptors, id)] : descriptors;
        const checks = await Promise.all(
          selected.map((descriptor) =>
            checkReferenceIntegrationContract(context, descriptor, {
              runChecks: Boolean(args.runChecks),
              timeoutMs: clampPositiveInteger(args.timeoutMs, 120_000),
            }),
          ),
        );
        return {
          ok: checks.every((entry) => entry.ok),
          summary: `Checked ${checks.length} reference integration contract(s).`,
          data: {
            checks,
          },
        };
      }

      if (action === "invoke") {
        const id = normalizeOptionalString(args.id);
        if (!id) {
          throw new Error("reference_integration invoke requires a descriptor id.");
        }
        const descriptor = selectReferenceIntegration(descriptors, id);
        const result = await invokeReferenceIntegration(context, descriptor, {
          args: normalizeReferenceAdapterArgs(args.args),
          serviceAction: normalizeReferenceServiceAction(args.serviceAction),
          timeoutMs: clampPositiveInteger(args.timeoutMs, 120_000),
        });
        return result;
      }

      if (action === "plan") {
        const id = normalizeOptionalString(args.id);
        const selected = id ? [selectReferenceIntegration(descriptors, id)] : descriptors;
        return {
          ok: true,
          summary: `Planned native adapter work for ${selected.length} reference integration descriptor(s).`,
          data: {
            plans: selected.map(buildReferenceNativeMigrationPlan),
          },
        };
      }

      if (action === "write_manifest") {
        const manifestPath = normalizeOptionalString(args.path) ?? "docs/reference-integrations.generated.json";
        const manifest = {
          generatedAt: new Date().toISOString(),
          schema: buildReferenceIntegrationSchema(),
          coverage: buildReferenceNativeFusionCoverage(descriptors),
          descriptors,
        };
        const result = await context.workspace.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        return {
          ok: true,
          summary: `Wrote reference integration manifest to ${result.path}.`,
          data: {
            path: result.path,
            descriptorCount: descriptors.length,
          },
        };
      }

      throw new Error(`Unsupported reference_integration action: ${action}`);
    },
  });

  registry.register({
    name: "reference_native",
    description:
      "Use omni-agent native implementations for ClaudeCode, Hermes, and OpenClaw reference capabilities without starting upstream runtimes. Supports listing, coverage, plans, contracts, and native execution handles.",
    inputHint:
      "{ action?: 'list'|'coverage'|'plan'|'contract'|'execute', source?: 'hermes'|'openclaw'|'claudecode', category?: 'claudecode-experience'|'hermes-tool'|'large-module'|'openclaw-plugin', query?: string, id?: string }",
    riskHint: "read-only native control-plane inspection; execute returns omni-agent native handles and does not launch upstream runtimes",
    async execute(_context, args) {
      const action = (normalizeOptionalString(args.action) ?? "list").toLowerCase();
      const source = normalizeReferenceSource(args.source) as ReferenceNativeSource | null;
      const category = normalizeReferenceNativeCategory(args.category);
      const query = normalizeOptionalString(args.query);
      const plans = listNativeImplementationPlans({
        source: source ?? undefined,
        category: category ?? undefined,
        query: query ?? undefined,
      });

      if (action === "list") {
        return {
          ok: true,
          summary: `Listed ${plans.length} omni-agent native reference implementation(s).`,
          data: {
            source: source ?? null,
            category: category ?? null,
            query: query ?? null,
            implementations: plans,
          },
        };
      }

      if (action === "coverage") {
        return {
          ok: true,
          summary: `Computed native implementation coverage for ${plans.length} reference capability replacement(s).`,
          data: summarizeNativeImplementationCoverage(plans),
        };
      }

      if (action === "plan" || action === "contract") {
        const id = normalizeOptionalString(args.id);
        const selected = id ? [getNativeImplementationPlan(id)].filter((entry) => entry !== null) : plans;
        if (id && selected.length === 0) {
          throw new Error(`No native reference implementation found for id=${id}.`);
        }
        return {
          ok: true,
          summary: `${action === "contract" ? "Checked" : "Planned"} ${selected.length} native reference implementation(s).`,
          data: {
            plans: selected,
            ok: selected.every((plan) => !plan.upstreamRuntimeRequired && plan.contract.execute && plan.contract.health),
          },
        };
      }

      if (action === "execute") {
        const id = normalizeOptionalString(args.id);
        if (!id) {
          throw new Error("reference_native execute requires an implementation id.");
        }
        const result = executeNativeImplementation(id);
        return {
          ok: result.ok,
          summary: result.summary,
          data: result,
        };
      }

      throw new Error(`Unsupported reference_native action: ${action}`);
    },
  });

  registry.register({
    name: "tool_search",
    description: "Alias for search_tools, matching Claude-style tool discovery naming.",
    inputHint: "{ query?: string, limit?: number, includeInputHints?: boolean }",
    riskHint: "read-only",
    async execute(context, args) {
      return registry.execute("search_tools", context, args);
    },
  });

  registry.register({
    name: "git_status",
    description: "Read git status for the workspace.",
    inputHint: "{}",
    riskHint: "read-only",
    async execute(context) {
      const result = await context.workspace.runCommand("git status --short", { timeoutMs: 20_000 });
      return {
        ok: result.ok,
        summary: result.ok ? "Read git status." : "Failed to read git status.",
        data: result,
        artifactPaths: result.artifactPath ? [result.artifactPath] : [],
      };
    },
  });

  registry.register({
    name: "search_text",
    description: "Search for text content inside workspace files and return matching lines.",
    inputHint: "{ query: string, path?: string, limit?: number, caseSensitive?: boolean }",
    riskHint: "read-only",
    async execute(context, args) {
      const query = String(args.query ?? "").trim();
      if (!query) {
        throw new Error("search_text requires a non-empty query.");
      }
      const path = args.path ? String(args.path) : ".";
      const limit = Number(args.limit ?? 20);
      const caseSensitive = Boolean(args.caseSensitive ?? false);
      const matches = await context.workspace.searchText(query, {
        path,
        limit: Number.isFinite(limit) ? limit : 20,
        caseSensitive,
      });
      return {
        ok: true,
        summary: `Found ${matches.length} text match(es) for "${query}".`,
        data: matches,
        presentation: buildSearchPresentation(query, path, matches),
      };
    },
  });

  registry.register({
    name: "git_diff",
    description: "Read a diff summary and patch preview for the workspace.",
    inputHint: "{}",
    riskHint: "read-only",
    async execute(context) {
      const summary = await context.workspace.getGitDiffSummary();
      return {
        ok: summary !== null,
        summary: summary
          ? `Read git diff for ${summary.changedFiles.length} changed file(s).`
          : "Git diff is unavailable outside a git repository.",
        data: summary,
      };
    },
  });

  registry.register({
    name: "list_directory",
    description: "List files and directories inside the workspace.",
    inputHint: "{ path?: string, depth?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      const path = String(args.path ?? ".");
      const depth = Number(args.depth ?? 2);
      const entries = await context.workspace.listDirectory(path, Number.isFinite(depth) ? depth : 2);
      return {
        ok: true,
        summary: `Listed ${entries.length} entries under ${path}.`,
        data: entries,
      };
    },
  });

  registry.register({
    name: "search_files",
    description: "Search file paths by substring.",
    inputHint: "{ query: string, limit?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      const query = String(args.query ?? "").trim();
      if (!query) {
        throw new Error("search_files requires a non-empty query.");
      }
      const limit = Number(args.limit ?? 50);
      const matches = await context.workspace.searchFiles(query, Number.isFinite(limit) ? limit : 50);
      return {
        ok: true,
        summary: `Found ${matches.length} file path matches for "${query}".`,
        data: matches,
      };
    },
  });

  registry.register({
    name: "update_plan",
    description: "Persist a structured task plan for the current run so the agent can track progress explicitly.",
    inputHint: "{ items: [{ step: string, status: string, note?: string, id?: string }], summary?: string }",
    riskHint: "writes runtime planning state",
    async execute(context, args) {
      const items = normalizeStructuredPlanItems(args.items);
      const summary = typeof args.summary === "string" && args.summary.trim().length > 0 ? args.summary.trim() : null;
      const plan = buildStructuredPlanState(context, items, summary);
      structuredPlanStore.set(getStructuredPlanKey(context), plan);
      const artifactPath = await writeStructuredPlanArtifact(context, plan);
      return {
        ok: true,
        summary: `Saved ${plan.items.length} structured plan item(s).`,
        data: plan,
        artifactPaths: artifactPath ? [artifactPath] : [],
      };
    },
  });

  registry.register({
    name: "read_plan",
    description: "Read the latest structured task plan for the current run.",
    inputHint: "{}",
    riskHint: "read-only",
    async execute(context) {
      const plan = await loadStructuredPlanState(context);
      return {
        ok: true,
        summary: plan.items.length > 0 ? `Loaded ${plan.items.length} structured plan item(s).` : "No structured plan has been recorded yet.",
        data: plan,
      };
    },
  });

  registry.register({
    name: "todo_write",
    description: "Replace the current thread's structured todo board with an explicit set of todo items.",
    inputHint: "{ todos: [{ content?: string, title?: string, status?: string, activeForm?: string, priority?: string, labels?: string[], note?: string, id?: string }] }",
    riskHint: "writes task state",
    async execute(context, args) {
      const board = await loadTodoTaskBoardState(context);
      const tasks = normalizeTodoWriteTasks(args.todos, board.tasks);
      const nextBoard = buildTodoTaskBoardState(context, tasks);
      const artifactPath = await writeTodoTaskBoardArtifact(context, nextBoard);
      return {
        ok: true,
        summary: `Saved ${nextBoard.tasks.length} todo item(s).`,
        data: nextBoard,
        artifactPaths: artifactPath ? [artifactPath] : [],
      };
    },
  });

  registry.register({
    name: "create_task",
    description: "Create a persistent task or todo item for the current thread.",
    inputHint: "{ title: string, status?: string, priority?: string, labels?: string[], note?: string }",
    riskHint: "writes task state",
    async execute(context, args) {
      const board = await loadTodoTaskBoardState(context);
      const title = String(args.title ?? "").trim();
      if (!title) {
        throw new Error("create_task requires a non-empty title.");
      }
      const createdAt = new Date().toISOString();
      const task: TodoTaskRecord = {
        id: randomUUID(),
        title,
        status: normalizeTodoTaskStatus(args.status),
        priority: normalizeTodoTaskPriority(args.priority),
        labels: normalizeStringList(args.labels),
        note: normalizeOptionalString(args.note),
        createdAt,
        updatedAt: createdAt,
        completedAt: normalizeTodoTaskStatus(args.status) === "completed" ? createdAt : undefined,
      };
      const nextBoard = buildTodoTaskBoardState(context, [...board.tasks, task]);
      const artifactPath = await writeTodoTaskBoardArtifact(context, nextBoard);
      return {
        ok: true,
        summary: `Created task ${task.id}.`,
        data: task,
        artifactPaths: artifactPath ? [artifactPath] : [],
      };
    },
  });

  registry.register({
    name: "list_tasks",
    description: "List persistent tasks for the current thread with optional status filtering.",
    inputHint: "{ status?: string, includeCompleted?: boolean }",
    riskHint: "read-only",
    async execute(context, args) {
      const board = await loadTodoTaskBoardState(context);
      const requestedStatus = normalizeOptionalTodoTaskStatus(args.status);
      const includeCompleted = args.includeCompleted === undefined ? true : normalizeBoolean(args.includeCompleted);
      const tasks = board.tasks.filter((task) => {
        if (!includeCompleted && task.status === "completed") {
          return false;
        }
        if (requestedStatus && task.status !== requestedStatus) {
          return false;
        }
        return true;
      });
      return {
        ok: true,
        summary: `Listed ${tasks.length} task(s).`,
        data: tasks,
      };
    },
  });

  registry.register({
    name: "update_task",
    description: "Update the status or metadata of a persistent task for the current thread.",
    inputHint: "{ taskId: string, title?: string, status?: string, priority?: string, labels?: string[], note?: string, appendNote?: string }",
    riskHint: "writes task state",
    async execute(context, args) {
      const board = await loadTodoTaskBoardState(context);
      const taskId = String(args.taskId ?? "").trim();
      if (!taskId) {
        throw new Error("update_task requires a non-empty taskId.");
      }
      const current = board.tasks.find((task) => task.id === taskId);
      if (!current) {
        throw new Error(`Task ${taskId} was not found for the current thread.`);
      }
      const nextStatus = args.status === undefined ? current.status : normalizeTodoTaskStatus(args.status);
      const appendedNote = normalizeOptionalString(args.appendNote);
      const explicitNote = args.note === undefined ? current.note : normalizeOptionalString(args.note);
      const note = appendedNote
        ? [current.note ?? null, appendedNote].filter((entry): entry is string => Boolean(entry)).join("\n")
        : explicitNote;
      const updatedAt = new Date().toISOString();
      const updatedTask: TodoTaskRecord = {
        ...current,
        title: args.title === undefined ? current.title : String(args.title).trim() || current.title,
        status: nextStatus,
        priority: args.priority === undefined ? current.priority : normalizeTodoTaskPriority(args.priority),
        labels: args.labels === undefined ? current.labels : normalizeStringList(args.labels),
        note: note ?? undefined,
        updatedAt,
        completedAt: nextStatus === "completed" ? current.completedAt ?? updatedAt : undefined,
      };
      const nextBoard = buildTodoTaskBoardState(
        context,
        board.tasks.map((task) => (task.id === taskId ? updatedTask : task)),
      );
      const artifactPath = await writeTodoTaskBoardArtifact(context, nextBoard);
      return {
        ok: true,
        summary: `Updated task ${taskId}.`,
        data: updatedTask,
        artifactPaths: artifactPath ? [artifactPath] : [],
      };
    },
  });

  registry.register({
    name: "delete_task",
    description: "Delete a persistent task from the current thread.",
    inputHint: "{ taskId: string }",
    riskHint: "writes task state",
    async execute(context, args) {
      const board = await loadTodoTaskBoardState(context);
      const taskId = String(args.taskId ?? "").trim();
      if (!taskId) {
        throw new Error("delete_task requires a non-empty taskId.");
      }
      const remainingTasks = board.tasks.filter((task) => task.id !== taskId);
      if (remainingTasks.length === board.tasks.length) {
        throw new Error(`Task ${taskId} was not found for the current thread.`);
      }
      const nextBoard = buildTodoTaskBoardState(context, remainingTasks);
      const artifactPath = await writeTodoTaskBoardArtifact(context, nextBoard);
      return {
        ok: true,
        summary: `Deleted task ${taskId}.`,
        data: {
          taskId,
          deleted: true,
        },
        artifactPaths: artifactPath ? [artifactPath] : [],
      };
    },
  });

  registry.register({
    name: "task_create",
    description: "Alias for create_task.",
    inputHint: "{ title: string, status?: string, priority?: string, labels?: string[], note?: string }",
    riskHint: "writes task state",
    async execute(context, args) {
      return registry.execute("create_task", context, args);
    },
  });

  registry.register({
    name: "task_list",
    description: "Alias for list_tasks.",
    inputHint: "{ status?: string, includeCompleted?: boolean }",
    riskHint: "read-only",
    async execute(context, args) {
      return registry.execute("list_tasks", context, args);
    },
  });

  registry.register({
    name: "task_update",
    description: "Alias for update_task.",
    inputHint: "{ taskId: string, title?: string, status?: string, priority?: string, labels?: string[], note?: string, appendNote?: string }",
    riskHint: "writes task state",
    async execute(context, args) {
      return registry.execute("update_task", context, args);
    },
  });

  registry.register({
    name: "task_delete",
    description: "Alias for delete_task.",
    inputHint: "{ taskId: string }",
    riskHint: "writes task state",
    async execute(context, args) {
      return registry.execute("delete_task", context, args);
    },
  });

  registry.register({
    name: "ask_user",
    description: "Pause the current run and request clarification from the user when the task is ambiguous or blocked.",
    inputHint: "{ question: string, context?: string, suggestedResponses?: string[] }",
    riskHint: "read-only",
    async execute(context, args) {
      const question = String(args.question ?? "").trim();
      if (!question) {
        throw new Error("ask_user requires a non-empty question.");
      }
      const request = {
        questionId: randomUUID(),
        question,
        context: typeof args.context === "string" && args.context.trim().length > 0 ? args.context.trim() : null,
        suggestedResponses: Array.isArray(args.suggestedResponses)
          ? Array.from(new Set(args.suggestedResponses.map((entry) => String(entry).trim()).filter(Boolean)))
          : [],
        workspaceId: context.workspaceId ?? null,
        threadId: context.threadId ?? null,
        runId: context.runId ?? null,
        requestedAt: new Date().toISOString(),
      };
      const artifactPath = await context.workspace.writeArtifact(
        "ask-user",
        [
          `Question ID: ${request.questionId}`,
          `Question: ${request.question}`,
          request.context ? `Context: ${request.context}` : null,
          request.suggestedResponses.length > 0 ? `Suggested responses: ${request.suggestedResponses.join(" | ")}` : null,
        ]
          .filter((entry): entry is string => Boolean(entry))
          .join("\n"),
        ".md",
      );
      return {
        ok: true,
        summary: "Paused the run and requested user clarification.",
        data: request,
        artifactPaths: [artifactPath],
        interrupt: {
          kind: "ask_user",
          questionId: request.questionId,
          question: request.question,
          context: request.context,
          suggestedResponses: request.suggestedResponses,
        },
      };
    },
  });

  registry.register({
    name: "browser_open",
    description: "Launch a real browser session, navigate to a URL, and capture an initial page snapshot.",
    inputHint: "{ url: string, headless?: boolean, timeoutMs?: number }",
    riskHint: "browser automation",
    async execute(_context, args) {
      const url = String(args.url ?? "").trim();
      if (!url) {
        throw new Error("browser_open requires a non-empty url.");
      }
      const timeoutMs = args.timeoutMs === undefined ? undefined : Number(args.timeoutMs);
      const session = await openBrowserSession({
        url,
        headless: args.headless === undefined ? true : normalizeBoolean(args.headless),
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
      });
      return {
        ok: true,
        summary: `Opened browser session ${session.id} at ${session.lastSnapshot.url}.`,
        data: session,
      };
    },
  });

  registry.register({
    name: "browser_snapshot",
    description: "Capture the current state of an existing browser session, including page text and actionable elements.",
    inputHint: "{ sessionId: string, maxChars?: number }",
    riskHint: "browser automation",
    async execute(_context, args) {
      const sessionId = String(args.sessionId ?? "").trim();
      if (!sessionId) {
        throw new Error("browser_snapshot requires a non-empty sessionId.");
      }
      const maxChars = args.maxChars === undefined ? undefined : Number(args.maxChars);
      const session = await snapshotBrowserSession({
        sessionId,
        maxChars: Number.isFinite(maxChars) ? maxChars : undefined,
      });
      return {
        ok: true,
        summary: `Captured browser snapshot for session ${session.id}.`,
        data: session,
      };
    },
  });

  registry.register({
    name: "browser_screenshot",
    description: "Capture a PNG screenshot artifact for an existing browser session while preserving console and network diagnostics.",
    inputHint: "{ sessionId: string }",
    riskHint: "browser automation and artifact write",
    async execute(context, args) {
      const sessionId = String(args.sessionId ?? "").trim();
      if (!sessionId) {
        throw new Error("browser_screenshot requires a non-empty sessionId.");
      }
      const session = await screenshotBrowserSession({ sessionId });
      const artifact = await writeBrowserScreenshotArtifact(context, session);
      return {
        ok: true,
        summary: `Captured browser screenshot for session ${session.id}.`,
        data: {
          sessionId: session.id,
          artifact,
          lastSnapshot: session.lastSnapshot,
          observations: session.observations,
          diagnostics: session.diagnostics,
          screenshot: {
            mimeType: session.screenshot.mimeType,
            capturedAt: session.screenshot.capturedAt,
            sizeBytes: artifact.sizeBytes,
          },
        },
        artifactPaths: [artifact.path],
      };
    },
  });

  registry.register({
    name: "browser_click",
    description: "Click an element in a live browser session by selector or prior snapshot elementId.",
    inputHint: "{ sessionId: string, selector?: string, elementId?: string, waitForLoad?: boolean }",
    riskHint: "browser automation",
    async execute(_context, args) {
      const sessionId = String(args.sessionId ?? "").trim();
      if (!sessionId) {
        throw new Error("browser_click requires a non-empty sessionId.");
      }
      const session = await clickBrowserSession({
        sessionId,
        selector: normalizeOptionalString(args.selector),
        elementId: normalizeOptionalString(args.elementId),
        waitForLoad: args.waitForLoad === undefined ? undefined : normalizeBoolean(args.waitForLoad),
      });
      return {
        ok: true,
        summary: `Clicked an element in browser session ${session.id}.`,
        data: session,
      };
    },
  });

  registry.register({
    name: "browser_type",
    description: "Type text into an element in a live browser session by selector or prior snapshot elementId.",
    inputHint: "{ sessionId: string, selector?: string, elementId?: string, text: string, submit?: boolean }",
    riskHint: "browser automation",
    async execute(_context, args) {
      const sessionId = String(args.sessionId ?? "").trim();
      if (!sessionId) {
        throw new Error("browser_type requires a non-empty sessionId.");
      }
      const text = String(args.text ?? "");
      const session = await typeIntoBrowserSession({
        sessionId,
        selector: normalizeOptionalString(args.selector),
        elementId: normalizeOptionalString(args.elementId),
        text,
        submit: args.submit === undefined ? undefined : normalizeBoolean(args.submit),
      });
      return {
        ok: true,
        summary: `Typed into browser session ${session.id}.`,
        data: session,
      };
    },
  });

  registry.register({
    name: "browser_close",
    description: "Close a live browser session and release its resources.",
    inputHint: "{ sessionId: string }",
    riskHint: "browser automation",
    async execute(_context, args) {
      const sessionId = String(args.sessionId ?? "").trim();
      if (!sessionId) {
        throw new Error("browser_close requires a non-empty sessionId.");
      }
      await closeBrowserSession(sessionId);
      return {
        ok: true,
        summary: `Closed browser session ${sessionId}.`,
        data: {
          sessionId,
          closed: true,
        },
      };
    },
  });

  registry.register({
    name: "web_search",
    description: "Search the web and return structured results with titles, URLs, and snippets.",
    inputHint: "{ query: string, count?: number, domainFilter?: string[], freshness?: string, timeoutMs?: number }",
    riskHint: "network read-only",
    async execute(_context, args) {
      return executeBuiltInWebSearch(args, "web");
    },
  });

  registry.register({
    name: "browser_search",
    description: "Search the web with browser-oriented semantics and return structured results for external research.",
    inputHint: "{ query: string, count?: number, domainFilter?: string[], freshness?: string, timeoutMs?: number }",
    riskHint: "network read-only",
    async execute(_context, args) {
      return executeBuiltInWebSearch(args, "browser");
    },
  });

  registry.register({
    name: "web_fetch",
    description: "Fetch an HTTP(S) page or API response and return a text preview.",
    inputHint: "{ url: string, maxChars?: number, timeoutMs?: number }",
    riskHint: "network read-only",
    async execute(_context, args) {
      return executeBuiltInWebFetch(args, "web");
    },
  });

  registry.register({
    name: "browser_fetch",
    description: "Open a web page or API endpoint with browser-oriented semantics and return a readable preview.",
    inputHint: "{ url: string, maxChars?: number, timeoutMs?: number }",
    riskHint: "network read-only",
    async execute(_context, args) {
      return executeBuiltInWebFetch(args, "browser");
    },
  });

  registry.register({
    name: "browser_run",
    description: "Execute a browser automation workflow using native browser sessions and structured steps.",
    inputHint:
      "{ url?: string, steps: [{ action: string, url?: string, selector?: string, elementId?: string, text?: string, value?: string, submit?: boolean, waitForLoad?: boolean, maxChars?: number, timeoutMs?: number, name?: string }], sessionId?: string, headless?: boolean, timeoutMs?: number }",
    riskHint: "browser automation and network access",
    async execute(_context, args) {
      return executeNativeBrowserWorkflow(args);
    },
  });

  registry.register({
    name: "read_file",
    description: "Read a UTF-8 text file inside the workspace.",
    inputHint: "{ path: string, startLine?: number, endLine?: number, maxChars?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      const path = String(args.path ?? "");
      const startLine = args.startLine === undefined ? undefined : Number(args.startLine);
      const endLine = args.endLine === undefined ? undefined : Number(args.endLine);
      const maxChars = args.maxChars === undefined ? undefined : Number(args.maxChars);
      const content = await context.workspace.readFile(path, { startLine, endLine, maxChars });
      return {
        ok: true,
        summary: `Read ${path}${startLine ? ` from line ${startLine}` : ""}${endLine ? ` to ${endLine}` : ""}.`,
        data: {
          path,
          startLine,
          endLine,
          content,
        },
        presentation: buildTextPresentation({
          title: `Read ${path}`,
          kind: "read",
          path,
          line: startLine,
          text: content,
        }),
      };
    },
  });

  registry.register({
    name: "scan_secrets",
    description: "Scan UTF-8 text or a workspace file for likely plaintext secrets without returning the secret value.",
    inputHint: "{ path?: string, content?: string }",
    riskHint: "read-only workspace secret audit",
    async execute(context, args) {
      const path = normalizeOptionalString(args.path);
      const content = args.content === undefined ? undefined : String(args.content);
      if (!path && content === undefined) {
        throw new Error("scan_secrets requires path or content.");
      }
      const scannedContent = content ?? await context.workspace.readFile(path!);
      const findings = scanPlaintextSecrets(scannedContent);
      return {
        ok: true,
        summary: findings.length > 0
          ? `Found ${findings.length} likely plaintext secret(s).`
          : "No likely plaintext secrets found.",
        data: {
          path: path ?? null,
          findingCount: findings.length,
          findings,
        },
      };
    },
  });

  registry.register({
    name: "read_artifact",
    description: "Read a run-owned artifact recorded by omni-agent, including verification logs stored outside the workspace root.",
    inputHint: "{ artifactId?: string, id?: string, path?: string, runId?: string, maxChars?: number }",
    riskHint: "read-only run artifact access",
    async execute(context, args) {
      if (!context.sessionStore) {
        throw new Error("read_artifact requires a session store.");
      }
      const runId = normalizeOptionalString(args.runId) ?? context.runId;
      if (!runId) {
        throw new Error("read_artifact requires a runId or current run context.");
      }
      const artifactId = normalizeOptionalString(args.artifactId) ?? normalizeOptionalString(args.id);
      const requestedPath = normalizeOptionalString(args.path);
      const selection = selectRunArtifact(context.sessionStore, runId, artifactId, requestedPath);
      const maxChars = clampPositiveInteger(args.maxChars, 20_000);
      const rawContent = await readFile(selection.artifact.path);
      const binary = isBinaryArtifactRecord(selection.artifact);
      const content = binary ? "" : rawContent.toString("utf8");
      const truncated = !binary && content.length > maxChars;
      return {
        ok: true,
        summary: `${selection.usedFallback ? "Read latest available artifact" : "Read artifact"} ${selection.artifact.id} (${selection.artifact.kind}).`,
        data: {
          artifact: selection.artifact,
          usedFallback: selection.usedFallback,
          encoding: binary ? "base64" : "utf8",
          content: binary ? undefined : truncated ? content.slice(0, maxChars) : content,
          contentBase64: binary ? rawContent.toString("base64") : undefined,
          sizeBytes: rawContent.length,
          truncated,
        },
      };
    },
  });

  registry.register({
    name: "search_memory",
    description: "Search persistent workspace or thread memories.",
    inputHint: "{ query?: string, scope?: string, limit?: number, backend?: string }",
    riskHint: "read-only",
    async execute(context, args) {
      const backend = normalizeMemorySearchBackend(args.backend);
      if (backend === "store" && (!context.sessionStore || !context.workspaceId)) {
        throw new Error("Memory search is unavailable without a session store and workspace context.");
      }
      const scope = args.scope === "thread" || args.scope === "workspace" ? args.scope : undefined;
      const limit = Number(args.limit ?? 8);
      const query = typeof args.query === "string" ? args.query : "";
      const normalizedLimit = Number.isFinite(limit) ? limit : 8;
      const warnings: string[] = [];
      const storeResults = backend === "file" || !context.sessionStore || !context.workspaceId
        ? []
        : context.sessionStore.searchMemories({
            workspaceId: context.workspaceId,
            threadId: scope === "thread" ? context.threadId ?? null : null,
            scope,
            query,
            limit: normalizedLimit,
          }).map((entry) => ({
            ...entry,
            source: "store" as const,
          }));
      if (backend !== "file" && (!context.sessionStore || !context.workspaceId)) {
        warnings.push("Memory store unavailable; returning file-backed memory results only.");
      }
      const remainingLimit = Math.max(0, normalizedLimit - storeResults.length);
      const fileResults = backend === "store" || remainingLimit === 0
        ? []
        : (await context.workspace.searchMemoryFiles({
            query,
            kinds: selectWorkspaceMemoryKinds(scope),
            limit: remainingLimit,
          })).map((entry) => ({
            id: `file:${entry.path}`,
            workspaceId: context.workspaceId ?? "workspace-file-memory",
            threadId: entry.kind === "daily" ? context.threadId ?? null : null,
            scope: entry.kind === "daily" ? "thread" as const : "workspace" as const,
            content: entry.content,
            tags: ["file-backed", entry.kind],
            createdAt: null,
            updatedAt: null,
            source: "file" as const,
            path: entry.path,
            kind: entry.kind,
            matchCount: entry.matchCount,
          }));
      const results = [...storeResults, ...fileResults];
      return {
        ok: true,
        summary: `Found ${results.length} memory match(es).`,
        data: results,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    },
  });

  registry.register({
    name: "search_sessions",
    description: "Search prior thread messages in the workspace for similar past work.",
    inputHint: "{ query: string, limit?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      if (!context.sessionStore || !context.workspaceId) {
        throw new Error("Session search is unavailable without a session store and workspace context.");
      }
      const query = String(args.query ?? "").trim();
      if (!query) {
        throw new Error("Session search requires a non-empty query.");
      }
      const limit = Number(args.limit ?? 8);
      const results = context.sessionStore.searchSessions({
        workspaceId: context.workspaceId,
        query,
        limit: Number.isFinite(limit) ? limit : 8,
      });
      return {
        ok: true,
        summary: `Found ${results.length} related session message(s).`,
        data: results,
      };
    },
  });

  registry.register({
    name: "search_profile",
    description: "Search persistent workspace profile facts and operating preferences.",
    inputHint: "{ query?: string, limit?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      if (!context.sessionStore || !context.workspaceId) {
        throw new Error("Profile search is unavailable without a session store and workspace context.");
      }
      const limit = Number(args.limit ?? 8);
      const query = typeof args.query === "string" ? args.query : "";
      const results = context.sessionStore.searchProfileFacts({
        workspaceId: context.workspaceId,
        query,
        limit: Number.isFinite(limit) ? limit : 8,
      });
      return {
        ok: true,
        summary: `Found ${results.length} workspace profile fact(s).`,
        data: results,
      };
    },
  });

  registry.register({
    name: "search_learned_skills",
    description: "Search structured learned skills distilled from prior verified runs.",
    inputHint: "{ query?: string, limit?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      if (!context.sessionStore || !context.workspaceId) {
        throw new Error("Learned skill search is unavailable without a session store and workspace context.");
      }
      const limit = Number(args.limit ?? 6);
      const query = typeof args.query === "string" ? args.query : "";
      const results = context.sessionStore.searchLearnedSkills({
        workspaceId: context.workspaceId,
        query,
        limit: Number.isFinite(limit) ? limit : 6,
      });
      return {
        ok: true,
        summary: `Found ${results.length} learned skill match(es).`,
        data: results,
      };
    },
  });

  registry.register({
    name: "save_memory",
    description: "Persist an important workspace or thread memory for future runs, optionally into compatible workspace memory files.",
    inputHint: "{ content: string, scope?: string, tags?: string[], backend?: string, fileKind?: string }",
    riskHint: "writes memory store or workspace files",
    async execute(context, args) {
      const backend = normalizeMemoryPersistenceBackend(args.backend);
      if (backend !== "file" && (!context.sessionStore || !context.workspaceId)) {
        throw new Error("Memory save is unavailable without a session store and workspace context.");
      }
      const content = String(args.content ?? "").trim();
      if (!content) {
        throw new Error("Memory content cannot be empty.");
      }
      const scope = args.scope === "thread" ? "thread" : "workspace";
      const tags = Array.isArray(args.tags) ? args.tags.map((entry) => String(entry)) : [];
      const storeRecord = backend === "file"
        ? null
        : context.sessionStore!.addMemory({
            workspaceId: context.workspaceId!,
            agentId: context.agentId ?? null,
            threadId: scope === "thread" ? context.threadId ?? null : null,
            scope,
            content,
            tags,
          });
      const fileKind = backend === "store" ? null : normalizeWorkspaceMemoryFileKind(args.fileKind, scope);
      const fileRecord = fileKind
        ? await context.workspace.appendMemoryFile(formatMemoryFileEntry(content, tags), { kind: fileKind })
        : null;
      const savedDestinations = [
        storeRecord ? `store (${storeRecord.id})` : null,
        fileRecord ? fileRecord.path : null,
      ].filter((entry): entry is string => Boolean(entry));
      return {
        ok: true,
        summary: `Saved ${scope} memory to ${savedDestinations.join(" and ")}.`,
        data: {
          scope,
          backend,
          fileKind,
          storeRecord,
          fileRecord,
        },
      };
    },
  });

  registry.register({
    name: "save_profile_fact",
    description: "Persist a durable workspace preference, identity detail, or operating convention.",
    inputHint: "{ content: string, tags?: string[] }",
    riskHint: "writes profile store",
    async execute(context, args) {
      if (!context.sessionStore || !context.workspaceId) {
        throw new Error("Profile save is unavailable without a session store and workspace context.");
      }
      const content = String(args.content ?? "").trim();
      if (!content) {
        throw new Error("Profile fact content cannot be empty.");
      }
      const tags = Array.isArray(args.tags) ? args.tags.map((entry) => String(entry)) : [];
      const record = context.sessionStore.addProfileFact({
        workspaceId: context.workspaceId,
        agentId: context.agentId ?? null,
        sourceRunId: context.runId ?? null,
        content,
        tags,
      });
      return {
        ok: true,
        summary: `Saved workspace profile fact ${record.id}.`,
        data: record,
      };
    },
  });

  registry.register({
    name: "write_file",
    description: "Create or replace a UTF-8 text file inside the workspace.",
    inputHint: "{ path: string, content: string }",
    riskHint: "writes workspace files",
    async execute(context, args) {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      if (!path.trim()) {
        throw new Error("write_file requires a non-empty path.");
      }
      if (content.length === 0) {
        throw new Error("write_file requires non-empty content.");
      }
      assertWriteTargetAccess(context, path);
      const secretFindings = scanPlaintextSecrets(content);
      const result = await context.workspace.writeFile(path, content);
      const postEditValidation = await validateEditedSourceFile(context, result.path);
      const warnings = formatSecretScanWarnings(secretFindings);
      return {
        ok: postEditValidation.ok,
        summary: formatPostEditSummary(`Wrote ${result.path}.`, postEditValidation),
        data: {
          ...result,
          postEditValidation,
          secretScan: {
            findingCount: secretFindings.length,
            findings: secretFindings,
          },
        },
        warnings,
        presentation: buildEditPresentation(`Write ${result.path}`, result.path, "", content),
      };
    },
  });

  registry.register({
    name: "edit_file",
    description: "Replace an exact text span inside a workspace file.",
    inputHint: "{ path: string, oldText: string, newText: string }",
    riskHint: "writes workspace files",
    async execute(context, args) {
      const path = String(args.path ?? "");
      const oldText = String(args.oldText ?? "");
      const newText = String(args.newText ?? "");
      assertWriteTargetAccess(context, path);
      const result = await context.workspace.editFile(path, oldText, newText);
      const postEditValidation = await validateEditedSourceFile(context, result.path);
      return {
        ok: postEditValidation.ok,
        summary: formatPostEditSummary(`Edited ${result.path} with ${result.replacements} replacement(s).`, postEditValidation),
        data: {
          ...result,
          postEditValidation,
        },
        presentation: buildEditPresentation(`Edit ${result.path}`, result.path, oldText, newText),
      };
    },
  });

  registry.register({
    name: "append_file",
    description: "Append UTF-8 text to a workspace file, useful for long documents that are safer to write in sections.",
    inputHint: "{ path: string, content: string }",
    riskHint: "writes workspace files",
    async execute(context, args) {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      if (!path.trim()) {
        throw new Error("append_file requires a non-empty path.");
      }
      if (content.length === 0) {
        throw new Error("append_file requires non-empty content.");
      }
      assertWriteTargetAccess(context, path);
      const absolutePath = resolve(context.workspace.root, path);
      const relativePath = relative(context.workspace.root, absolutePath);
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        throw new Error(`Path escapes workspace root: ${path}`);
      }
      await mkdir(dirname(absolutePath), { recursive: true });
      await appendFile(absolutePath, content, "utf8");
      const postEditValidation = await validateEditedSourceFile(context, path);
      return {
        ok: postEditValidation.ok,
        summary: formatPostEditSummary(`Appended ${content.length} character(s) to ${path}.`, postEditValidation),
        data: {
          path,
          appendedChars: content.length,
          postEditValidation,
        },
      };
    },
  });

  registry.register({
    name: "replace_file_range",
    description: "Replace an inclusive line range inside a workspace file.",
    inputHint: "{ path: string, startLine: number, endLine: number, newText: string }",
    riskHint: "writes workspace files",
    async execute(context, args) {
      const path = String(args.path ?? "");
      const startLine = Number(args.startLine ?? 1);
      const endLine = Number(args.endLine ?? startLine);
      const newText = String(args.newText ?? "");
      assertWriteTargetAccess(context, path);
      const result = await context.workspace.replaceFileRange(path, startLine, endLine, newText);
      const postEditValidation = await validateEditedSourceFile(context, result.path);
      return {
        ok: postEditValidation.ok,
        summary: formatPostEditSummary(`Replaced lines ${startLine}-${endLine} in ${result.path}.`, postEditValidation),
        data: {
          ...result,
          startLine,
          endLine,
          postEditValidation,
        },
        presentation: buildTransactionalPatchPresentation("Replace file range", [
          { type: "range", path: result.path, startLine, endLine, newText },
        ]),
      };
    },
  });

  registry.register({
    name: "apply_transactional_patch",
    description: "Apply a small set of write, exact-text replace, or line-range patch operations atomically inside the workspace.",
    inputHint: "{ operations: Array<{ type: 'write'|'replace'|'range', path: string, content?: string, oldText?: string, newText?: string, startLine?: number, endLine?: number, expectedHash?: string, expectedOldText?: string }> }",
    riskHint: "writes workspace files",
    async execute(context, args) {
      const operations = normalizeTransactionalPatchOperations(args.operations ?? args.patches);
      for (const operation of operations) {
        assertWriteTargetAccess(context, operation.path);
      }
      const result = await context.workspace.applyTransactionalPatch(operations);
      const validations = await Promise.all(
        result.files.map((entry) => validateEditedSourceFile(context, entry.path)),
      );
      const failedValidation = validations.find((entry) => !entry.ok);
      return {
        ok: failedValidation === undefined,
        summary: formatPostEditSummary(
          `Applied transactional patch to ${result.files.length} file(s).`,
          failedValidation ?? { checked: false, ok: true, kind: "skipped", summary: "No source validation failures." },
        ),
        data: {
          ...result,
          postEditValidations: validations,
        },
        presentation: buildTransactionalPatchPresentation("Apply transactional patch", operations),
      };
    },
  });

  registry.register({
    name: "apply_patch",
    description: "Alias for apply_transactional_patch.",
    inputHint: "{ operations: Array<{ type: 'write'|'replace'|'range', path: string, content?: string, oldText?: string, newText?: string, startLine?: number, endLine?: number, expectedHash?: string, expectedOldText?: string }> }",
    riskHint: "writes workspace files",
    async execute(context, args) {
      const operations = normalizeTransactionalPatchOperations(args.operations ?? args.patches);
      for (const operation of operations) {
        assertWriteTargetAccess(context, operation.path);
      }
      const result = await context.workspace.applyTransactionalPatch(operations);
      const validations = await Promise.all(
        result.files.map((entry) => validateEditedSourceFile(context, entry.path)),
      );
      const failedValidation = validations.find((entry) => !entry.ok);
      return {
        ok: failedValidation === undefined,
        summary: formatPostEditSummary(
          `Applied transactional patch to ${result.files.length} file(s).`,
          failedValidation ?? { checked: false, ok: true, kind: "skipped", summary: "No source validation failures." },
        ),
        data: {
          ...result,
          postEditValidations: validations,
        },
        presentation: buildTransactionalPatchPresentation("Apply patch", operations),
      };
    },
  });

  registry.register({
    name: "run_command",
    description: "Execute a shell command inside the workspace.",
    inputHint: "{ command: string, cwd?: string, timeoutMs?: number }",
    riskHint: "may mutate workspace or access the network",
    async execute(context, args) {
      const command = String(args.command ?? "");
      assertSafeCommand(command);
      const timeoutMs = Number(args.timeoutMs ?? 120_000);
      const cwd = args.cwd ? String(args.cwd) : undefined;
        const result = await context.workspace.runCommand(command, {
          cwd,
          timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 120_000,
          abortSignal: context.abortSignal,
        });
        return {
          ok: result.ok,
          summary: `${result.ok ? "Ran" : "Failed"} command: ${command}${cwd ? ` (cwd: ${cwd})` : ""}`,
          data: result,
          artifactPaths: result.artifactPath ? [result.artifactPath] : [],
          presentation: buildTextPresentation({
            title: `Run ${command}`,
            kind: "execute",
            text: cwd ? `${command}\ncwd: ${cwd}` : command,
          }),
        };
    },
  });

  registry.register({
    name: "run_verification",
    description: "Run one or more verification commands.",
    inputHint: "{ commands: string[] }",
    riskHint: "verification-only commands",
      async execute(context, args) {
        const commands = Array.isArray(args.commands) ? args.commands.map((value) => String(value)) : [];
        const result = await context.workspace.runVerification(commands, {
          abortSignal: context.abortSignal,
        });
        const artifactPaths = result.results
          .map((entry) => entry.artifactPath)
          .filter((value): value is string => typeof value === "string");
        return {
        ok: result.ok,
        summary: result.ok
          ? `Verification passed across ${commands.length} command(s).`
          : "Verification failed.",
        data: result,
        artifactPaths,
      };
    },
  });

  registry.register({
    name: "python_execute",
    description: "Run a short Python script in the workspace and capture stdout/stderr.",
    inputHint: "{ code: string, timeoutMs?: number }",
    riskHint: "executes code in the workspace",
    async execute(context, args) {
      const code = String(args.code ?? "");
      if (!code.trim()) {
        throw new Error("python_execute requires non-empty code.");
      }
      const timeoutMs = Number(args.timeoutMs ?? 120_000);
      const command = `python -c ${JSON.stringify(code)}`;
      assertSafeCommand(command);
      const scriptPath = await context.workspace.writeArtifact("python-execute-input", code, ".py");
      const result = await context.workspace.runCommand(`python ${JSON.stringify(scriptPath)}`, {
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 120_000,
        abortSignal: context.abortSignal,
      });
      return {
        ok: result.ok,
        summary: result.ok ? "Python script completed." : "Python script failed.",
        data: {
          ...result,
          scriptPath,
        },
        artifactPaths: [scriptPath, ...(result.artifactPath ? [result.artifactPath] : [])],
      };
    },
  });

  registry.register({
    name: "notebook_read",
    description: "Read a Jupyter notebook as structured cell metadata and source snippets.",
    inputHint: "{ path: string }",
    riskHint: "read-only",
    async execute(context, args) {
      const path = String(args.path ?? "");
      const content = await context.workspace.readFile(path);
      const parsed = JSON.parse(content) as { cells?: Array<Record<string, unknown>> };
      const cells = (parsed.cells ?? []).map((cell, index) => ({
        index,
        cellType: cell.cell_type ?? "unknown",
        source: Array.isArray(cell.source) ? cell.source.join("") : String(cell.source ?? ""),
      }));
      return {
        ok: true,
        summary: `Read notebook ${path} with ${cells.length} cell(s).`,
        data: { path, cells },
      };
    },
  });

  registry.register({
    name: "notebook_replace_cell",
    description: "Replace the source of one Jupyter notebook cell.",
    inputHint: "{ path: string, index: number, source: string | string[] }",
    riskHint: "writes workspace files",
    async execute(context, args) {
      const path = String(args.path ?? "");
      const index = Number(args.index ?? -1);
      assertWriteTargetAccess(context, path);
      if (!Number.isInteger(index) || index < 0) {
        throw new Error("notebook_replace_cell requires a non-negative integer index.");
      }
      const content = await context.workspace.readFile(path);
      const parsed = JSON.parse(content) as { cells?: Array<Record<string, unknown>> };
      const cells = parsed.cells ?? [];
      if (!cells[index]) {
        throw new Error(`Notebook cell ${index} does not exist.`);
      }
      cells[index] = {
        ...cells[index],
        source: Array.isArray(args.source)
          ? args.source.map((entry) => String(entry))
          : String(args.source ?? "").split(/(?<=\n)/),
      };
      await context.workspace.writeFile(path, JSON.stringify({ ...parsed, cells }, null, 2));
      return {
        ok: true,
        summary: `Replaced notebook cell ${index} in ${path}.`,
        data: { path, index },
      };
    },
  });

  registry.register({
    name: "lsp_diagnostics",
    description: "Run the workspace TypeScript compiler in no-emit mode to collect code diagnostics.",
    inputHint: "{ command?: string }",
    riskHint: "read-only command execution",
    async execute(context, args) {
      const command = String(args.command ?? "npx tsc --noEmit --pretty false");
      assertSafeCommand(command);
      const result = await context.workspace.runCommand(command, {
        timeoutMs: 120_000,
        abortSignal: context.abortSignal,
      });
      const diagnostics = [...result.stdout.split(/\r?\n/), ...result.stderr.split(/\r?\n/)]
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 200);
      return {
        ok: result.ok,
        summary: result.ok ? "No LSP-style diagnostics reported." : `Collected ${diagnostics.length} diagnostic line(s).`,
        data: { command: result.command, diagnostics, result },
        artifactPaths: result.artifactPath ? [result.artifactPath] : [],
      };
    },
  });

  registry.register({
    name: "process_start",
    description: "Start a background process in the workspace and retain recent output for later inspection.",
    inputHint: "{ command: string, cwd?: string }",
    riskHint: "starts a background process",
    async execute(context, args) {
      const command = String(args.command ?? "");
      assertSafeCommand(command);
      const workspaceRoot = await resolveManagedProcessWorkspaceRoot(context);
      const resolvedCwd = await resolveManagedProcessCwd(context, args.cwd, workspaceRoot);
      if (context.abortSignal?.aborted) {
        throw new Error("process_start aborted before launch.");
      }
      const record = startManagedProcess(command, resolvedCwd, workspaceRoot);
      if (!bindManagedProcessAbortSignal(record, context.abortSignal)) {
        await stopManagedProcess(record);
        throw new Error("process_start aborted before launch.");
      }
      return {
        ok: true,
        summary: `Started process ${record.id}.`,
        data: describeManagedProcess(record),
      };
    },
  });

  registry.register({
    name: "process_list",
    description: "List background processes started by process_start.",
    inputHint: "{}",
    riskHint: "read-only",
    async execute(context) {
      const workspaceRoot = await resolveManagedProcessWorkspaceRoot(context);
      const processes = Array.from(managedProcesses.values())
        .filter((record) => record.ownerWorkspaceRoot === workspaceRoot)
        .map((record) => describeManagedProcess(record));
      pruneManagedProcessRecords();
      return {
        ok: true,
        summary: `Listed ${processes.length} managed process(es).`,
        data: { processes, registry: describeManagedProcessRegistry() },
      };
    },
  });

  registry.register({
    name: "process_logs",
    description: "Read recent output for a background process.",
    inputHint: "{ processId: string, maxChars?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      const processId = normalizeManagedProcessId(args);
      const record = await getManagedProcessForContext(context, processId);
      const maxChars = args.maxChars === undefined ? undefined : clampPositiveInteger(args.maxChars, 24_000);
      return {
        ok: true,
        summary: `Read logs for process ${processId}.`,
        data: describeManagedProcess(record, { maxChars }),
      };
    },
  });

  registry.register({
    name: "process_read",
    description: "Alias for process_logs.",
    inputHint: "{ processId: string, maxChars?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      return registry.execute("process_logs", context, args);
    },
  });

  registry.register({
    name: "process_stop",
    description: "Stop a background process started by process_start.",
    inputHint: "{ processId: string }",
    riskHint: "stops a background process",
    async execute(context, args) {
      const processId = normalizeManagedProcessId(args);
      const record = await getManagedProcessForContext(context, processId);
      await stopManagedProcess(record);
      return {
        ok: true,
        summary: `Stopped process ${processId}.`,
        data: describeManagedProcess(record),
      };
    },
  });

  registry.register({
    name: "list_automations",
    description: "List stored automations for the current workspace.",
    inputHint: "{ status?: string }",
    riskHint: "read-only",
    async execute(context, args) {
      if (!context.sessionStore || !context.workspaceId) {
        throw new Error("Automation listing is unavailable without a session store and workspace context.");
      }
      const normalizedStatus = normalizeAutomationStatus(args.status);
      const automations = context.sessionStore.listAutomations({
        workspaceId: context.workspaceId,
        status: normalizedStatus,
      });
      return {
        ok: true,
        summary: `Listed ${automations.length} automation(s).`,
        data: automations,
      };
    },
  });

  registry.register({
    name: "create_automation",
    description: "Create a reusable automation record for a future scheduled or manual run.",
    inputHint: "{ title: string, task: string, scheduleKind?: string, intervalSeconds?: number, scheduleExpression?: string, timezone?: string, status?: string, threadId?: string, threadTitle?: string, mode?: string, executionDomain?: string, verificationMode?: string, verificationCommands?: string[], autoApproveRisky?: boolean, maxIterations?: number }",
    riskHint: "writes automation configuration",
    async execute(context, args) {
      if (!context.sessionStore || !context.workspaceId) {
        throw new Error("Automation creation is unavailable without a session store and workspace context.");
      }
      const title = String(args.title ?? "").trim();
      const task = String(args.task ?? "").trim();
      if (!title) {
        throw new Error("create_automation requires a non-empty title.");
      }
      if (!task) {
        throw new Error("create_automation requires a non-empty task.");
      }
      const scheduleKind = normalizeAutomationScheduleKind(args.scheduleKind);
      const intervalSeconds = scheduleKind === "interval" ? clampPositiveInteger(args.intervalSeconds, 300) : null;
      const automation = context.sessionStore.createAutomation({
        workspaceId: context.workspaceId,
        threadId: typeof args.threadId === "string" && args.threadId.trim().length > 0 ? args.threadId.trim() : null,
        title,
        threadTitle: typeof args.threadTitle === "string" && args.threadTitle.trim().length > 0 ? args.threadTitle.trim() : null,
        task,
        mode: typeof args.mode === "string" && args.mode.trim().length > 0 ? args.mode.trim() : "mock",
        executionDomain:
          args.executionDomain === "workspace" || args.executionDomain === "worktree" || args.executionDomain === "sandbox"
            ? args.executionDomain
            : context.executionDomain,
        verificationMode: typeof args.verificationMode === "string" && args.verificationMode.trim().length > 0
          ? args.verificationMode.trim()
          : "required",
        verificationCommands: Array.isArray(args.verificationCommands)
          ? args.verificationCommands.map((entry) => String(entry).trim()).filter(Boolean)
          : [],
        autoApproveRisky: Boolean(args.autoApproveRisky ?? false),
        maxIterations: clampPositiveInteger(args.maxIterations, 8),
        scheduleKind,
        intervalSeconds,
        scheduleExpression: normalizeOptionalString(args.scheduleExpression),
        timezone: normalizeOptionalString(args.timezone),
        status: normalizeAutomationStatus(args.status) ?? "active",
      });
      return {
        ok: true,
        summary: `Created automation ${automation.id} (${automation.title}).`,
        data: automation,
      };
    },
  });

  registry.register({
    name: "update_automation_status",
    description: "Pause or resume an existing automation.",
    inputHint: "{ automationId: string, status: string }",
    riskHint: "writes automation configuration",
    async execute(context, args) {
      if (!context.sessionStore || !context.workspaceId) {
        throw new Error("Automation status updates are unavailable without a session store and workspace context.");
      }
      const automationId = String(args.automationId ?? "").trim();
      if (!automationId) {
        throw new Error("update_automation_status requires a non-empty automationId.");
      }
      const current = context.sessionStore.getAutomation(automationId);
      if (!current || current.workspaceId !== context.workspaceId) {
        throw new Error(`Automation ${automationId} was not found for the current workspace.`);
      }
      const status = normalizeAutomationStatus(args.status);
      if (!status) {
        throw new Error("update_automation_status requires status=active or status=paused.");
      }
      const nextRunAt = status === "active" && current.scheduleKind !== "at"
        ? computeAutomationNextRunAt(current, new Date().toISOString())
        : current.scheduleKind === "at" && !current.lastRunAt
          ? current.nextRunAt
          : null;
      const updated = context.sessionStore.updateAutomationState({
        automationId,
        status,
        nextRunAt,
      });
      return {
        ok: true,
        summary: `Automation ${updated.id} is now ${updated.status}.`,
        data: updated,
      };
    },
  });

  registry.register({
    name: "spawn_subagent",
    description: "Spawn a governed, isolated subagent run for a scoped objective.",
    inputHint:
      "{ objective: string, threadTitle?: string, sessionMode?: string, sessionThreadId?: string, role?: string, mode?: string, outcomeVisibility?: string, authority?: string, ownerAgentId?: string, auditLabel?: string, executionDomain?: string, pluginDirs?: string[], verificationCommands?: string[], maxIterations?: number, timeoutMs?: number, maxRetries?: number, maxDepth?: number, maxConcurrentChildren?: number, allowedTools?: string[], returnedArtifactKinds?: string[], targetPaths?: string[], governance?: { authority?: string, ownerAgentId?: string, auditLabel?: string, budget?: { maxIterations?: number, timeoutMs?: number, maxRetries?: number }, maxDepth?: number, maxConcurrentChildren?: number, allowedTools?: string[], targetPaths?: string[], returnedArtifactKinds?: string[], verificationCommands?: string[] } }",
    riskHint: "spawns isolated subagent execution",
    async execute(context, args) {
      if (!context.subagentController) {
        throw new Error("Subagent spawning is unavailable without a coordinator.");
      }
      const objective = String(args.objective ?? "").trim();
      if (!objective) {
        throw new Error("Subagent objective cannot be empty.");
      }
      const request = buildSubagentExecutionRequest(context, args, objective);
      const job = await context.subagentController.spawn(request);
      return {
        ok: true,
        summary: `Spawned subagent job ${job.id} (${job.status}).`,
        data: buildSubagentJobObservation(applyRequestedSubagentGovernance(job, request)),
      };
    },
  });

  registry.register({
    name: "delegate_task",
    description: "Alias for spawn_subagent with Hermes-style naming for delegated child work.",
    inputHint:
      "{ objective?: string, task?: string, threadTitle?: string, sessionMode?: string, sessionThreadId?: string, role?: string, mode?: string, outcomeVisibility?: string, authority?: string, ownerAgentId?: string, auditLabel?: string, executionDomain?: string, pluginDirs?: string[], verificationCommands?: string[], maxIterations?: number, timeoutMs?: number, maxRetries?: number, maxDepth?: number, maxConcurrentChildren?: number, allowedTools?: string[], returnedArtifactKinds?: string[], targetPaths?: string[], governance?: object }",
    riskHint: "spawns isolated subagent execution",
    async execute(context, args) {
      const objective = normalizeOptionalString(args.objective) ?? normalizeOptionalString(args.task);
      return registry.execute("spawn_subagent", context, {
        ...args,
        objective,
      });
    },
  });

    registry.register({
      name: "run_swarm",
      description: "Coordinate a governed swarm of scoped subagent tasks and optionally wait for all results.",
      inputHint:
      "{ tasks: [{ objective: string, threadTitle?: string, sessionMode?: string, sessionThreadId?: string, role?: string, mode?: string, outcomeVisibility?: string, authority?: string, ownerAgentId?: string, auditLabel?: string, executionDomain?: string, pluginDirs?: string[], verificationCommands?: string[], maxIterations?: number, timeoutMs?: number, maxRetries?: number, maxDepth?: number, maxConcurrentChildren?: number, allowedTools?: string[], returnedArtifactKinds?: string[], targetPaths?: string[], governance?: object }], waitForCompletion?: boolean, timeoutMs?: number }",
      riskHint: "spawns multiple isolated subagent executions",
      async execute(context, args) {
      if (!context.subagentController) {
        throw new Error("Swarm execution is unavailable without a coordinator.");
      }
      if (!Array.isArray(args.tasks) || args.tasks.length === 0) {
        throw new Error("run_swarm requires a non-empty tasks array.");
      }

      const tasks = args.tasks.map((entry, index) => normalizeSwarmTask(context, entry, index));
      const jobs = await Promise.all(
        tasks.map((task) =>
          context.subagentController!.spawn({
            ...task,
            threadTitle: task.threadTitle ?? (task.role ? `${task.role}: ${task.objective}` : undefined),
          }),
        ),
      );
      const requestsByJobId = new Map(jobs.map((job, index) => [job.id, tasks[index]]));

      if (args.waitForCompletion === false) {
        return {
          ok: true,
          summary: `Spawned swarm with ${jobs.length} subagent job(s).`,
          data: {
            mode: "queued",
            jobs: jobs.map((job) => buildSubagentJobObservation(applyRequestedSubagentGovernance(job, requestsByJobId.get(job.id)))),
          },
        };
      }

        const timeoutMs = args.timeoutMs === undefined ? undefined : Number(args.timeoutMs);
        const pendingJobIds = new Set(jobs.map((job) => job.id));
        const completionOrder: Array<Record<string, unknown>> = [];
        const settledJobs: Array<Record<string, unknown>> = [];
        let timeoutError: string | null = null;

        while (pendingJobIds.size > 0) {
          let nextJob: SubagentJobRecord;
          try {
            nextJob = await context.subagentController.waitAny(
              Array.from(pendingJobIds),
              Number.isFinite(timeoutMs) ? timeoutMs : undefined,
            );
          } catch (error) {
            timeoutError = error instanceof Error ? error.message : String(error);
            break;
          }
          if (!pendingJobIds.delete(nextJob.id)) {
            continue;
          }
          const run = context.sessionStore && nextJob.runId ? context.sessionStore.getRun(nextJob.runId) : null;
          const artifacts =
            context.sessionStore && nextJob.runId ? context.sessionStore.listRunArtifacts(nextJob.runId) : [];
          settledJobs.push(buildSubagentJobObservation(applyRequestedSubagentGovernance(nextJob, requestsByJobId.get(nextJob.id)), run, artifacts));
          completionOrder.push({
            id: nextJob.id,
            role: nextJob.role,
            status: nextJob.status,
            finalResponse: nextJob.finalResponse ?? nextJob.completion?.finalResponse,
            error: nextJob.error ?? nextJob.completion?.error,
          });
        }

        const pendingJobs = Array.from(pendingJobIds)
          .map((jobId) => context.subagentController!.get(jobId))
          .filter((job): job is SubagentJobRecord => job !== null)
          .map((job) => buildSubagentJobObservation(applyRequestedSubagentGovernance(job, requestsByJobId.get(job.id))));
        const completed = settledJobs.filter((job) => job.status === "completed").length;
        const failed = settledJobs.length - completed;
        const total = settledJobs.length + pendingJobs.length;
        return {
          ok: failed === 0 && pendingJobs.length === 0,
          summary:
            timeoutError === null
              ? `Swarm settled ${completed}/${total} subagent job(s) successfully.`
              : `Swarm returned partial results after ${settledJobs.length}/${total} subagent job(s): ${timeoutError}`,
          data: {
            mode: timeoutError === null ? "completed" : "partial",
            jobs: settledJobs,
            pendingJobs,
            completionOrder,
            totalCount: total,
            completedCount: completed,
            failedCount: failed,
            pendingCount: pendingJobs.length,
            timeoutError,
          },
        };
      },
    });

  registry.register({
    name: "wait_subagent",
    description: "Wait for a spawned subagent to finish and return its result summary.",
    inputHint: "{ jobId: string, timeoutMs?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      if (!context.subagentController) {
        throw new Error("Subagent waiting is unavailable without a coordinator.");
      }
      const jobId = String(args.jobId ?? "").trim();
      if (!jobId) {
        throw new Error("wait_subagent requires a non-empty jobId.");
      }
      const timeoutMs = args.timeoutMs === undefined ? undefined : Number(args.timeoutMs);
      const job = await context.subagentController.wait(
        jobId,
        Number.isFinite(timeoutMs) ? timeoutMs : undefined,
      );
      const run = context.sessionStore && job.runId ? context.sessionStore.getRun(job.runId) : null;
      return {
        ok: job.status === "completed",
        summary: `Subagent job ${job.id} finished with status ${job.status}.`,
        data: buildSubagentJobObservation(job, run),
      };
    },
  });

    registry.register({
      name: "wait_any_subagent",
    description: "Wait for the first queued or running subagent in a set to finish and return its result summary.",
    inputHint: "{ jobIds?: string[], timeoutMs?: number }",
    riskHint: "read-only",
    async execute(context, args) {
      if (!context.subagentController) {
        throw new Error("Subagent waiting is unavailable without a coordinator.");
      }
      const timeoutMs = args.timeoutMs === undefined ? undefined : Number(args.timeoutMs);
      const jobIds = Array.isArray(args.jobIds)
        ? args.jobIds.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
        : undefined;
      const job = await context.subagentController.waitAny(
        jobIds && jobIds.length > 0 ? jobIds : undefined,
        Number.isFinite(timeoutMs) ? timeoutMs : undefined,
      );
      const run = context.sessionStore && job.runId ? context.sessionStore.getRun(job.runId) : null;
        return {
          ok: job.status === "completed",
          summary: `First completed subagent job ${job.id} finished with status ${job.status}.`,
          data: buildSubagentJobObservation(
            job,
            run,
            context.sessionStore && job.runId ? context.sessionStore.listRunArtifacts(job.runId) : [],
          ),
        };
      },
    });

    registry.register({
      name: "collect_subagent_artifacts",
      description: "Collect artifact metadata produced by a completed subagent run.",
      inputHint: "{ jobId: string, kinds?: string[] }",
      riskHint: "read-only",
      async execute(context, args) {
        if (!context.subagentController || !context.sessionStore) {
          throw new Error("Subagent artifact collection requires a coordinator and session store.");
        }
        const jobId = String(args.jobId ?? "").trim();
        if (!jobId) {
          throw new Error("collect_subagent_artifacts requires a non-empty jobId.");
        }
        const job = context.subagentController.get(jobId);
        if (!job) {
          throw new Error(`Subagent job ${jobId} was not found.`);
        }
        const requestedKinds = normalizeArtifactKinds(args.kinds);
        const jobArtifactKinds = job.returnedArtifactKinds?.length ? new Set(job.returnedArtifactKinds) : null;
        const requestedArtifactKinds = requestedKinds?.length ? new Set(requestedKinds) : null;
        const artifacts = (job.runId ? context.sessionStore.listRunArtifacts(job.runId) : []).filter((artifact) => {
          if (jobArtifactKinds && !jobArtifactKinds.has(artifact.kind)) {
            return false;
          }
          if (requestedArtifactKinds && !requestedArtifactKinds.has(artifact.kind)) {
            return false;
          }
          return true;
        });
        return {
          ok: true,
          summary:
            artifacts.length > 0
              ? `Collected ${artifacts.length} artifact(s) for subagent job ${job.id}.`
              : `Subagent job ${job.id} has no recorded artifacts.`,
          data: {
            jobId: job.id,
            runId: job.runId ?? null,
            governance: buildSubagentGovernanceObservation(job, undefined, artifacts),
            progressEvents: job.progressEvents ?? [],
            artifacts: buildSubagentArtifactObservations(artifacts),
          },
        };
      },
    });

    registry.register({
      name: "pause_subagent",
      description: "Pause a queued or running subagent job until resumed.",
      inputHint: "{ jobId: string }",
      riskHint: "control-plane only",
      async execute(context, args) {
        if (!context.subagentController) {
          throw new Error("Subagent pause is unavailable without a coordinator.");
        }
        const jobId = String(args.jobId ?? "").trim();
        if (!jobId) {
          throw new Error("pause_subagent requires a non-empty jobId.");
        }
        const job = await context.subagentController.pause(jobId);
        return {
          ok: job.status === "paused",
          summary: `Subagent job ${job.id} is now ${job.status}.`,
          data: buildSubagentJobObservation(job),
        };
      },
    });

    registry.register({
      name: "resume_subagent",
      description: "Resume a paused subagent job.",
      inputHint: "{ jobId: string }",
      riskHint: "control-plane only",
      async execute(context, args) {
        if (!context.subagentController) {
          throw new Error("Subagent resume is unavailable without a coordinator.");
        }
        const jobId = String(args.jobId ?? "").trim();
        if (!jobId) {
          throw new Error("resume_subagent requires a non-empty jobId.");
        }
        const job = await context.subagentController.resume(jobId);
        return {
          ok: job.status === "queued" || job.status === "running" || job.status === "completed",
          summary: `Subagent job ${job.id} resumed with status ${job.status}.`,
          data: buildSubagentJobObservation(job),
        };
      },
    });

    registry.register({
      name: "interrupt_subagent",
      description: "Interrupt a spawned subagent job without treating it as normal completion.",
      inputHint: "{ jobId: string }",
      riskHint: "control-plane only",
      async execute(context, args) {
        if (!context.subagentController) {
          throw new Error("Subagent interruption is unavailable without a coordinator.");
        }
        const jobId = String(args.jobId ?? "").trim();
        if (!jobId) {
          throw new Error("interrupt_subagent requires a non-empty jobId.");
        }
        const job = await context.subagentController.interrupt(jobId);
        return {
          ok: job.status === "interrupted",
          summary: `Subagent job ${job.id} is now ${job.status}.`,
          data: buildSubagentJobObservation(job),
        };
      },
    });

    registry.register({
      name: "message_subagent",
    description: "Send an additional instruction to a queued or running subagent.",
    inputHint: "{ jobId: string, message: string }",
    riskHint: "control-plane only",
    async execute(context, args) {
      if (!context.subagentController) {
        throw new Error("Subagent messaging is unavailable without a coordinator.");
      }
      const jobId = String(args.jobId ?? "").trim();
      if (!jobId) {
        throw new Error("message_subagent requires a non-empty jobId.");
      }
      const message = String(args.message ?? "").trim();
      if (!message) {
        throw new Error("message_subagent requires a non-empty message.");
      }
      const job = await context.subagentController.send(jobId, message);
      return {
        ok: true,
        summary: `Queued an additional instruction for subagent job ${job.id}.`,
        data: buildSubagentJobObservation(job),
      };
    },
  });

  registry.register({
    name: "cancel_subagent",
    description: "Request cancellation for a spawned subagent job.",
    inputHint: "{ jobId: string }",
    riskHint: "control-plane only",
    async execute(context, args) {
      if (!context.subagentController) {
        throw new Error("Subagent cancellation is unavailable without a coordinator.");
      }
      const jobId = String(args.jobId ?? "").trim();
      if (!jobId) {
        throw new Error("cancel_subagent requires a non-empty jobId.");
      }
      const job = await context.subagentController.cancel(jobId);
        return {
          ok: job.status === "cancelled",
          summary: `Subagent job ${job.id} is now ${job.status}.`,
          data: buildSubagentJobObservation(job),
        };
      },
    });

  registry.register({
    name: "list_subagents",
    description: "List in-flight and completed subagent jobs for the current run.",
    inputHint: "{}",
    riskHint: "read-only",
    async execute(context) {
      if (!context.subagentController) {
        throw new Error("Subagent listing is unavailable without a coordinator.");
      }
      const jobs = context.subagentController.list();
      return {
        ok: true,
        summary: `Listed ${jobs.length} subagent job(s).`,
        data: jobs.map((job) => buildSubagentJobObservation(job)),
      };
    },
  });

  registry.register({
    name: "subagents",
    description: "Unified subagent control facade matching OpenClaw-style action routing for list, summary, topology, wait, steer, pause, resume, interrupt, or cancel.",
    inputHint: "{ action: string, jobId?: string, jobIds?: string[], timeoutMs?: number, message?: string }",
    riskHint: "control-plane and read-only actions",
    async execute(context, args) {
      const action = String(args.action ?? "").trim().toLowerCase();
      switch (action) {
        case "list":
          return registry.execute("list_subagents", context, {});
        case "summary":
        case "status": {
          if (!context.subagentController) {
            throw new Error("Subagent listing is unavailable without a coordinator.");
          }
          const report = buildSubagentTopologyReport(context, context.subagentController.list());
          return {
            ok: true,
            summary: `Built a subagent session summary for ${report.overview.totalJobs} job(s).`,
            data: {
              overview: report.overview,
              roots: report.roots.map((entry) => summarizeSubagentTopologyNode(entry)),
            },
          };
        }
        case "topology":
        case "tree": {
          if (!context.subagentController) {
            throw new Error("Subagent listing is unavailable without a coordinator.");
          }
          const report = buildSubagentTopologyReport(context, context.subagentController.list());
          return {
            ok: true,
            summary: `Built subagent topology for ${report.overview.totalJobs} job(s) across ${report.roots.length} root task(s).`,
            data: report,
          };
        }
        case "wait":
          return registry.execute("wait_subagent", context, args);
        case "wait_any":
        case "waitany":
          return registry.execute("wait_any_subagent", context, args);
        case "pause":
          return registry.execute("pause_subagent", context, args);
        case "resume":
          return registry.execute("resume_subagent", context, args);
        case "interrupt":
          return registry.execute("interrupt_subagent", context, args);
        case "cancel":
        case "kill":
          return registry.execute("cancel_subagent", context, args);
        case "message":
        case "send":
        case "steer":
          return registry.execute("message_subagent", context, args);
        default:
          throw new Error("subagents action must be one of list, summary, status, topology, tree, wait, wait_any, pause, resume, interrupt, cancel, kill, message, send, or steer.");
      }
    },
  });

  registry.register({
    name: "create_sandbox",
    description: "Create an isolated sandbox copy of the current workspace.",
    inputHint: "{ name: string }",
    riskHint: "creates isolated sandbox state",
    async execute(context, args) {
      const name = String(args.name ?? "sandbox");
      const result = await context.workspace.createSandbox(name);
      return {
        ok: true,
        summary: `Created sandbox ${result.path}.`,
        data: result,
      };
    },
  });

  registry.register({
    name: "cleanup_sandbox",
    description: "Remove an isolated sandbox copy created for the workspace.",
    inputHint: "{ path: string }",
    riskHint: "deletes sandbox state",
    async execute(context, args) {
      const path = String(args.path ?? "");
      const result = await context.workspace.cleanupSandbox(path);
      return {
        ok: true,
        summary: `Removed sandbox ${result.path}.`,
        data: result,
      };
    },
  });

  registry.register({
    name: "create_worktree",
    description: "Create an isolated git worktree for the workspace.",
    inputHint: "{ name: string, branch?: string }",
    riskHint: "creates git worktree state",
    async execute(context, args) {
      const name = String(args.name ?? "worktree");
      const branch = args.branch ? String(args.branch) : undefined;
      const result = await context.workspace.createWorktree(name, branch);
      return {
        ok: true,
        summary: `Created worktree ${result.path}.`,
        data: result,
      };
    },
  });

  registry.register({
    name: "cleanup_worktree",
    description: "Remove an isolated git worktree.",
    inputHint: "{ path: string }",
    riskHint: "deletes worktree state",
    async execute(context, args) {
      const path = String(args.path ?? "");
      const result = await context.workspace.cleanupWorktree(path);
      return {
        ok: true,
        summary: `Removed worktree ${result.path}.`,
        data: result,
      };
    },
  });
}

function normalizeSwarmTask(
  context: ToolExecutionContext,
  entry: unknown,
  index: number,
): SubagentExecutionRequest {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`run_swarm.tasks[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  const objective = String(record.objective ?? "").trim();
  if (!objective) {
    throw new Error(`run_swarm.tasks[${index}] requires a non-empty objective.`);
  }
  return buildSubagentExecutionRequest(context, record, objective);
}

function buildSubagentExecutionRequest(
  context: Pick<ToolExecutionContext, "agentId">,
  args: Record<string, unknown>,
  objective: string,
): SubagentExecutionRequest {
  const governance = normalizeSubagentGovernanceControls(args.governance);
  const executionDomain = normalizeSubagentExecutionDomain(coalesceGovernanceValue(args, governance, "executionDomain"));
  const verificationCommands = normalizeOptionalStringList(
    coalesceGovernanceValue(args, governance, "verificationCommands"),
  );
  const maxIterations = normalizeOptionalFiniteNumber(coalesceGovernanceBudgetValue(args, governance, "maxIterations"));
  const timeoutMs = normalizeOptionalFiniteNumber(coalesceGovernanceBudgetValue(args, governance, "timeoutMs"));
  const maxRetries = normalizeOptionalFiniteNumber(coalesceGovernanceBudgetValue(args, governance, "maxRetries"));
  const maxDepth = normalizeOptionalFiniteNumber(coalesceGovernanceValue(args, governance, "maxDepth"));
  const maxConcurrentChildren = normalizeOptionalFiniteNumber(
    coalesceGovernanceValue(args, governance, "maxConcurrentChildren"),
  );
  const ownerAgentId =
    normalizeOptionalString(coalesceGovernanceValue(args, governance, "ownerAgentId")) ?? context.agentId;
  const request: SubagentExecutionRequest = {
    objective,
    threadTitle: normalizeOptionalString(args.threadTitle),
    sessionMode: normalizeSubagentSessionMode(args.sessionMode),
    sessionThreadId: normalizeOptionalString(args.sessionThreadId),
    role: normalizeOptionalString(args.role),
    mode: normalizeSubagentExecutionMode(args.mode),
    outcomeVisibility: normalizeSubagentOutcomeVisibility(args.outcomeVisibility),
    authority: normalizeSubagentAuthority(coalesceGovernanceValue(args, governance, "authority")),
    ownerAgentId,
    auditLabel: normalizeOptionalString(coalesceGovernanceValue(args, governance, "auditLabel")),
    executionDomain,
    pluginDirs: normalizePluginDirectories(args.pluginDirs),
    verificationCommands,
    maxIterations,
    timeoutMs,
    maxRetries,
    maxDepth,
    maxConcurrentChildren,
    allowedTools: normalizeAllowedTools(coalesceGovernanceValue(args, governance, "allowedTools")),
    returnedArtifactKinds: normalizeArtifactKinds(coalesceGovernanceValue(args, governance, "returnedArtifactKinds")),
    targetPaths: normalizeTargetPaths(coalesceGovernanceValue(args, governance, "targetPaths")),
  };
  return {
    ...request,
    governance: buildRequestedSubagentGovernanceControls(request),
  };
}

function normalizeSubagentGovernanceControls(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("subagent governance must be an object when provided.");
  }
  return value as Record<string, unknown>;
}

function coalesceGovernanceValue(
  args: Record<string, unknown>,
  governance: Record<string, unknown>,
  key: keyof SubagentGovernanceControls,
): unknown {
  return isArgumentMissing(args[key]) ? governance[key] : args[key];
}

function coalesceGovernanceBudgetValue(
  args: Record<string, unknown>,
  governance: Record<string, unknown>,
  key: keyof SubagentBudget,
): unknown {
  const direct = coalesceGovernanceValue(args, governance, key);
  if (!isArgumentMissing(direct)) {
    return direct;
  }
  const budget = governance.budget;
  if (!budget || typeof budget !== "object" || Array.isArray(budget)) {
    return undefined;
  }
  return (budget as Record<string, unknown>)[key];
}

function normalizeSubagentExecutionDomain(value: unknown): ExecutionDomain | undefined {
  return value === "workspace" || value === "worktree" || value === "sandbox" ? value : undefined;
}

function normalizeOptionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = normalizeStringList(value);
  return entries.length > 0 ? entries : undefined;
}

function buildRequestedSubagentGovernanceControls(request: SubagentExecutionRequest): SubagentGovernanceControls {
  return {
    authority: request.authority,
    ownerAgentId: request.ownerAgentId,
    auditLabel: request.auditLabel,
    executionDomain: request.executionDomain,
    budget: {
      maxIterations: request.maxIterations,
      timeoutMs: request.timeoutMs,
      maxRetries: request.maxRetries,
    },
    maxDepth: request.maxDepth,
    maxConcurrentChildren: request.maxConcurrentChildren,
    allowedTools: request.allowedTools,
    returnedArtifactKinds: request.returnedArtifactKinds,
    targetPaths: request.targetPaths,
    verificationCommands: request.verificationCommands,
  };
}

function normalizeSubagentAuthority(value: unknown): SubagentAuthority | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "worker" || normalized === "leaf") {
    return "leaf";
  }
  if (normalized === "planner" || normalized === "orchestrator") {
    return "orchestrator";
  }
  throw new Error(`Unsupported subagent authority: ${String(value)}`);
}

function normalizeAllowedTools(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = Array.from(
    new Set(
      value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0),
    ),
  );
  return entries.length > 0 ? entries : undefined;
}

function applyRequestedSubagentGovernance(
  job: SubagentJobRecord,
  request: SubagentExecutionRequest | undefined,
): SubagentJobRecord {
  if (!request) {
    return job;
  }
  return {
    ...job,
    ownerAgentId: job.ownerAgentId ?? request.ownerAgentId,
    auditLabel: job.auditLabel ?? request.auditLabel,
    verificationCommands: job.verificationCommands ?? request.verificationCommands,
    returnedArtifactKinds: job.returnedArtifactKinds ?? request.returnedArtifactKinds,
    targetPaths: job.targetPaths ?? request.targetPaths,
    allowedTools: job.allowedTools ?? request.allowedTools,
  };
}

function buildSubagentJobObservation(
  job: SubagentJobRecord,
  run?: { readonly verificationStatus: string | null; readonly finalResponse: string | null } | null,
  artifacts: Array<{ readonly id: string; readonly kind: string; readonly path: string; readonly summary: string }> = [],
): Record<string, unknown> {
  const completion =
    job.completion ??
    (run
      ? {
          status: job.status,
          verificationStatus: run.verificationStatus ?? "not-run",
          changedFiles: [],
          finalResponse: run.finalResponse ?? "",
          error: job.error,
        }
      : undefined);
  const summaryOnly = job.outcomeVisibility === "summary_only";
  const visibleCompletion = summaryOnly && completion ? summarizeSubagentCompletionForParent(completion) : completion;
  const visibleFinalResponse = summaryOnly
    ? trimSubagentParentSummary(job.finalResponse ?? completion?.finalResponse ?? "")
    : job.finalResponse ?? completion?.finalResponse;
  return {
    id: job.id,
    objective: job.objective,
    sessionMode: job.sessionMode,
    role: job.role,
    mode: job.mode,
    outcomeVisibility: job.outcomeVisibility,
    status: job.status,
    attempts: job.attempts,
    authority: job.authority,
    ownerAgentId: job.ownerAgentId,
    auditLabel: job.auditLabel,
    depth: job.depth,
    maxDepth: job.maxDepth,
    maxConcurrentChildren: job.maxConcurrentChildren,
    parentJobId: job.parentJobId,
    rootJobId: job.rootJobId,
      childJobIds: job.childJobIds,
      queuePosition: job.queuePosition,
      executionDomain: job.executionDomain,
      budget: job.budget,
      returnedArtifactKinds: job.returnedArtifactKinds,
      targetPaths: job.targetPaths,
      verificationCommands: job.verificationCommands,
      blockedReason: job.blockedReason,
      blockedByJobIds: job.blockedByJobIds,
      blockedPaths: job.blockedPaths,
      pausedFromStatus: job.pausedFromStatus,
      allowedTools: job.allowedTools,
      toolPolicyTrace: job.toolPolicyTrace,
      governance: buildSubagentGovernanceObservation(job, run, artifacts),
      finalResponse: visibleFinalResponse,
      completion: visibleCompletion,
      artifacts: buildSubagentArtifactObservations(artifacts),
      error: job.error,
      messages: summaryOnly ? [] : job.messages,
      progressEvents: summaryOnly ? (job.progressEvents ?? []).slice(-1) : job.progressEvents ?? [],
      threadId: job.threadId,
      runId: job.runId,
    };
  }

function buildSubagentGovernanceObservation(
  job: SubagentJobRecord,
  run?: { readonly verificationStatus: string | null; readonly finalResponse: string | null } | null,
  artifacts: Array<{ readonly id: string; readonly kind: string }> = [],
): Record<string, unknown> {
  return {
    authority: job.authority,
    ownership: {
      ownerAgentId: job.ownerAgentId,
      auditLabel: job.auditLabel,
      parentJobId: job.parentJobId,
      rootJobId: job.rootJobId,
      threadId: job.threadId,
      runId: job.runId,
    },
    budget: {
      maxIterations: job.budget.maxIterations,
      timeoutMs: job.budget.timeoutMs,
      maxRetries: job.budget.maxRetries,
      maxDepth: job.maxDepth,
      maxConcurrentChildren: job.maxConcurrentChildren,
    },
    controls: {
      executionDomain: job.executionDomain,
      allowedTools: job.allowedTools,
      targetPaths: job.targetPaths,
      returnedArtifactKinds: job.returnedArtifactKinds,
      toolPolicyTrace: job.toolPolicyTrace,
    },
    verification: {
      commands: job.verificationCommands,
      status: job.completion?.verificationStatus ?? run?.verificationStatus ?? "not-run",
      artifactKinds: artifacts.map((artifact) => artifact.kind),
    },
  };
}

function summarizeSubagentCompletionForParent(completion: SubagentCompletionReport): SubagentCompletionReport {
  return {
    ...completion,
    finalResponse: trimSubagentParentSummary(completion.finalResponse),
  };
}

function trimSubagentParentSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 600 ? `${normalized.slice(0, 600)}... [truncated]` : normalized;
}

function buildSubagentTopologyReport(
  context: ToolExecutionContext,
  jobs: readonly SubagentJobRecord[],
): {
  readonly overview: SubagentTopologyOverview;
  readonly roots: SubagentTopologyNode[];
  readonly jobs: Array<Record<string, unknown>>;
} {
  const artifactsByRunId = new Map<string, Array<{ readonly id: string; readonly kind: string; readonly path: string; readonly summary: string }>>();
  const observedJobs = jobs.map((job) => {
    const run = context.sessionStore && job.runId ? context.sessionStore.getRun(job.runId) : null;
    const artifacts = context.sessionStore && job.runId
      ? artifactsByRunId.get(job.runId) ?? (() => {
          const listed = context.sessionStore?.listRunArtifacts(job.runId) ?? [];
          artifactsByRunId.set(job.runId, listed);
          return listed;
        })()
      : [];
    return {
      job,
      observation: buildSubagentJobObservation(job, run, artifacts),
    };
  });
  const jobsById = new Map(observedJobs.map((entry) => [entry.job.id, entry]));
  const childrenByParent = new Map<string, string[]>();
  for (const entry of observedJobs) {
    if (!entry.job.parentJobId) {
      continue;
    }
    const siblings = childrenByParent.get(entry.job.parentJobId) ?? [];
    siblings.push(entry.job.id);
    childrenByParent.set(entry.job.parentJobId, siblings);
  }
  const sortIds = (ids: readonly string[]): string[] =>
    [...new Set(ids)]
      .map((id) => jobsById.get(id))
      .filter((entry): entry is { readonly job: SubagentJobRecord; readonly observation: Record<string, unknown> } => Boolean(entry))
      .sort((left, right) => compareSubagentJobs(left.job, right.job))
      .map((entry) => entry.job.id);
  const buildNode = (jobId: string): SubagentTopologyNode => {
    const entry = jobsById.get(jobId);
    if (!entry) {
      return {
        id: jobId,
        objective: jobId,
        status: "failed",
        depth: 0,
        childCount: 0,
        children: [],
        missing: true,
      };
    }
    const discoveredChildIds = sortIds([
      ...entry.job.childJobIds,
      ...(childrenByParent.get(entry.job.id) ?? []),
    ]);
    return {
      ...entry.observation,
      id: entry.job.id,
      objective: entry.job.objective,
      role: entry.job.role,
      status: entry.job.status,
      depth: entry.job.depth,
      childCount: discoveredChildIds.length,
      children: discoveredChildIds.map((childJobId) => buildNode(childJobId)),
    };
  };
  const rootIds = sortIds(
    observedJobs
      .filter((entry) => !entry.job.parentJobId || !jobsById.has(entry.job.parentJobId))
      .map((entry) => entry.job.id),
  );
  const countsByStatus = observedJobs.reduce<Record<string, number>>((accumulator, entry) => {
    accumulator[entry.job.status] = (accumulator[entry.job.status] ?? 0) + 1;
    return accumulator;
  }, {});
  const countsByRole = observedJobs.reduce<Record<string, number>>((accumulator, entry) => {
    const key = entry.job.role?.trim() || "unassigned";
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
  const maxDepth = observedJobs.reduce((value, entry) => Math.max(value, entry.job.depth), 0);
  const activeJobs = observedJobs.filter((entry) => entry.job.status === "running" || entry.job.status === "queued").length;
  return {
    overview: {
      totalJobs: observedJobs.length,
      rootJobs: rootIds.length,
    activeJobs,
    maxDepth,
    countsByStatus,
    countsByRole,
    } satisfies SubagentTopologyOverview,
    roots: rootIds.map((jobId) => buildNode(jobId)),
    jobs: observedJobs
      .sort((left, right) => compareSubagentJobs(left.job, right.job))
      .map((entry) => entry.observation),
  };
}

function buildSubagentArtifactObservations(
  artifacts: Array<{ readonly id: string; readonly kind: string; readonly path: string; readonly summary: string }>,
): Array<Record<string, string>> {
  return artifacts.map((artifact) => ({
    id: artifact.id,
    kind: artifact.kind,
    path: artifact.path,
    summary: artifact.summary,
  }));
}

function normalizePluginDirectories(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = Array.from(
    new Set(
      value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0),
    ),
  );
  return entries.length > 0 ? entries : undefined;
}

function normalizeSubagentExecutionMode(value: unknown): SubagentExecutionMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "background" || normalized === "foreground" ? normalized : undefined;
}

function normalizeSubagentSessionMode(value: unknown): SubagentSessionMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "run" || normalized === "thread" ? normalized : undefined;
}

function normalizeSubagentOutcomeVisibility(value: unknown): SubagentOutcomeVisibility | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "context") {
    return "context";
  }
  if (normalized === "artifacts_only" || normalized === "artifacts-only") {
    return "artifacts_only";
  }
  if (normalized === "summary_only" || normalized === "summary-only") {
    return "summary_only";
  }
  return undefined;
}

function normalizeArtifactKinds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const kinds = Array.from(
    new Set(
      value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0),
    ),
  );
  return kinds.length > 0 ? kinds : undefined;
}

function compareSubagentJobs(left: SubagentJobRecord, right: SubagentJobRecord): number {
  const leftQueued = typeof left.queuePosition === "number";
  const rightQueued = typeof right.queuePosition === "number";
  if (leftQueued && rightQueued && left.queuePosition !== right.queuePosition) {
    return (left.queuePosition ?? 0) - (right.queuePosition ?? 0);
  }
  if (leftQueued !== rightQueued) {
    return leftQueued ? -1 : 1;
  }
  if (left.depth !== right.depth) {
    return left.depth - right.depth;
  }
  return left.createdAt.localeCompare(right.createdAt);
}

function summarizeSubagentTopologyNode(node: SubagentTopologyNode): Record<string, unknown> {
  const children = node.children;
  const descendantCount = children.reduce((count, child) => count + 1 + countSubagentNodeDescendants(child), 0);
  return {
    id: node.id,
    objective: node.objective,
    role: node.role,
    status: node.status,
    depth: node.depth,
    childCount: node.childCount,
    descendantCount,
  };
}

function countSubagentNodeDescendants(node: SubagentTopologyNode): number {
  const children = node.children;
  return children.reduce((count, child) => count + 1 + countSubagentNodeDescendants(child), 0);
}

function normalizeTargetPaths(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const paths = Array.from(
    new Set(
      value
        .map((entry) => normalizeWorkspaceTargetPath(String(entry ?? "")))
        .filter((entry) => entry.length > 0),
    ),
  );
  return paths.length > 0 ? paths : undefined;
}

interface SkillContentReview {
  readonly riskTier: 0 | 1 | 2 | 3;
  readonly warnings: readonly string[];
  readonly blockedReasons: readonly string[];
  readonly manualApprovalRequired: boolean;
}

async function createManagedSkill(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult> {
  const category = sanitizeSkillPathSegment(normalizeOptionalString(args.category) ?? "general");
  const name = sanitizeSkillPathSegment(normalizeOptionalString(args.name) ?? "");
  if (!name) {
    throw new Error("skill_manage create requires a non-empty name.");
  }
  const skillDirectory = join("skills", category, name);
  const skillPath = join(skillDirectory, "SKILL.md");
  assertWriteTargetAccess(context, skillPath);
  const content =
    normalizeOptionalString(args.content) ??
    [
      "---",
      `name: ${name}`,
      `description: "${name.replace(/-/g, " ")}"`,
      "metadata:",
      "  hermes:",
      `    tags: [${category}]`,
      "---",
      "",
      `# ${name.replace(/-/g, " ")}`,
      "",
      "Use this skill when the task matches the description above.",
      "",
    ].join("\n");
  const review = reviewSkillFileContent(skillPath, content);
  enforceSkillContentReview(review);
  const result = await context.workspace.writeFile(skillPath, content.endsWith("\n") ? content : `${content}\n`);
  return {
    ok: true,
    summary: `Created skill ${result.path}.`,
    data: { action: "create", path: result.path, directory: skillDirectory.replace(/\\/g, "/"), review },
    warnings: [...review.warnings],
  };
}

async function reviewManagedSkillFile(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult> {
  const explicitContent = normalizeOptionalString(args.content);
  const targetPath = explicitContent === undefined
    ? resolveManagedSkillRelativePath(context, args, "SKILL.md")
    : normalizeWorkspaceTargetPath(
        normalizeOptionalString(args.path) ?? join("skills", "review", "candidate", "SKILL.md"),
      );
  const content = explicitContent ?? await context.workspace.readFile(targetPath);
  const review = reviewSkillFileContent(targetPath, content);
  return {
    ok: review.blockedReasons.length === 0,
    summary: review.blockedReasons.length > 0
      ? `Skill review found ${review.blockedReasons.length} blocking issue(s).`
      : `Skill review completed with risk tier ${review.riskTier}.`,
    data: { action: "review", path: targetPath, review },
    warnings: [...review.warnings, ...review.blockedReasons],
  };
}

async function patchManagedSkillFile(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult> {
  const targetPath = resolveManagedSkillRelativePath(context, args, "SKILL.md");
  const oldText = String(args.oldText ?? "");
  const newText = String(args.newText ?? "");
  if (!oldText) {
    throw new Error("skill_manage patch requires oldText.");
  }
  assertWriteTargetAccess(context, targetPath);
  const currentContent = await context.workspace.readFile(targetPath);
  const review = reviewSkillFileContent(targetPath, currentContent.replace(oldText, newText));
  enforceSkillContentReview(review);
  const result = await context.workspace.editFile(targetPath, oldText, newText);
  return {
    ok: true,
    summary: `Patched ${result.path}.`,
    data: { action: "patch", path: result.path, replacements: result.replacements, review },
    warnings: [...review.warnings],
  };
}

async function writeManagedSkillSupportFile(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult> {
  const targetPath = resolveManagedSkillRelativePath(context, args);
  const content = String(args.content ?? "");
  assertWriteTargetAccess(context, targetPath);
  const review = reviewSkillFileContent(targetPath, content);
  enforceSkillContentReview(review);
  const result = await context.workspace.writeFile(targetPath, content.endsWith("\n") ? content : `${content}\n`);
  return {
    ok: true,
    summary: `Wrote skill support file ${result.path}.`,
    data: { action: "write_file", path: result.path, review },
    warnings: [...review.warnings],
  };
}

async function removeManagedSkillSupportFile(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult> {
  const targetPath = resolveManagedSkillRelativePath(context, args);
  if (targetPath.endsWith("SKILL.md")) {
    throw new Error("skill_manage remove_file cannot remove SKILL.md; disable the learned skill instead.");
  }
  assertWriteTargetAccess(context, targetPath);
  await rm(resolve(context.workspace.root, targetPath), { force: true });
  return {
    ok: true,
    summary: `Removed skill support file ${targetPath}.`,
    data: { action: "remove_file", path: targetPath },
  };
}

async function disableManagedLearnedSkill(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!context.sessionStore || !context.workspaceId) {
    throw new Error("skill_manage disable requires a session store and workspace context.");
  }
  const skillId = normalizeOptionalString(args.skillId);
  if (!skillId) {
    throw new Error("skill_manage disable requires skillId.");
  }
  const existing = context.sessionStore.getLearnedSkill(skillId);
  if (!existing || existing.workspaceId !== context.workspaceId) {
    throw new Error(`Learned skill ${skillId} was not found in this workspace.`);
  }
  const disabled = context.sessionStore.addLearnedSkill({
    workspaceId: existing.workspaceId,
    agentId: existing.agentId,
    sourceRunId: existing.sourceRunId,
    sourceType: existing.sourceType,
    kind: existing.kind,
    dedupeKey: existing.dedupeKey,
    lifecycleState: "disabled",
    lifecycleReason: normalizeOptionalString(args.reason) ?? "Disabled through skill_manage.",
    materializedSkillPath: existing.materializedSkillPath,
    title: existing.title,
    problemPattern: existing.problemPattern,
    guidance: existing.guidance,
    exampleObjective: existing.exampleObjective,
    changedFiles: existing.changedFiles,
    tags: existing.tags,
    triggerSignals: existing.triggerSignals,
    procedureSteps: existing.procedureSteps,
    verificationStatus: existing.verificationStatus,
    verificationSummary: existing.verificationSummary,
  });
  return {
    ok: true,
    summary: `Disabled learned skill ${disabled.id}.`,
    data: { action: "disable", skill: disabled },
  };
}

async function reviewManagedLearnedSkillQueue(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!context.sessionStore || !context.workspaceId) {
    throw new Error("skill_manage review_queue requires a session store and workspace context.");
  }
  const limit = Number(args.limit ?? 20);
  const report = context.sessionStore.evaluateLearnedSkillMaintenance({
    workspaceId: context.workspaceId,
    agentId: context.agentId,
    limit: Number.isFinite(limit) ? limit : 20,
  });
  return {
    ok: true,
    summary: `Skill review queue: promote=${report.promotionCandidates.length}, reverify=${report.reverifyCandidates.length}, disable=${report.disableCandidates.length}, stable=${report.stableSkills.length}.`,
    data: report,
  };
}

async function promoteManagedLearnedSkill(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!context.sessionStore || !context.workspaceId) {
    throw new Error("skill_manage promote requires a session store and workspace context.");
  }
  const skillId = normalizeOptionalString(args.skillId);
  if (!skillId) {
    throw new Error("skill_manage promote requires skillId.");
  }
  const target = normalizeOptionalString(args.target) ?? "workspace";
  if (target !== "workspace" && target !== "personal") {
    throw new Error("skill_manage promote target must be workspace or personal.");
  }
  const existing = context.sessionStore.getLearnedSkill(skillId);
  if (!existing || existing.workspaceId !== context.workspaceId) {
    throw new Error(`Learned skill ${skillId} was not found in this workspace.`);
  }
  const promoted = context.sessionStore.promoteLearnedSkill({
    skillId,
    target,
    reason: normalizeOptionalString(args.reason) ?? `Promoted through skill_manage to ${target}.`,
    materializedSkillPath: normalizeOptionalString(args.path) ?? existing.materializedSkillPath,
  });
  return {
    ok: true,
    summary: `Promoted learned skill ${promoted.id} to ${target}.`,
    data: { action: "promote", skill: promoted },
  };
}

async function rollbackManagedLearnedSkill(context: ToolExecutionContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!context.sessionStore || !context.workspaceId) {
    throw new Error("skill_manage rollback requires a session store and workspace context.");
  }
  const skillId = normalizeOptionalString(args.skillId);
  if (!skillId) {
    throw new Error("skill_manage rollback requires skillId.");
  }
  const existing = context.sessionStore.getLearnedSkill(skillId);
  if (!existing || existing.workspaceId !== context.workspaceId) {
    throw new Error(`Learned skill ${skillId} was not found in this workspace.`);
  }
  const rolledBack = context.sessionStore.rollbackLearnedSkillPromotion({
    skillId,
    reason: normalizeOptionalString(args.reason),
  });
  return {
    ok: true,
    summary: `Rolled back learned skill ${rolledBack.id} and queued it for re-verification.`,
    data: { action: "rollback", skill: rolledBack },
  };
}

function resolveManagedSkillRelativePath(
  context: ToolExecutionContext,
  args: Record<string, unknown>,
  defaultLeaf?: string,
): string {
  const explicitPath = normalizeOptionalString(args.path);
  const skillPath = normalizeOptionalString(args.skillPath);
  const category = sanitizeSkillPathSegment(normalizeOptionalString(args.category) ?? "general");
  const name = sanitizeSkillPathSegment(normalizeOptionalString(args.name) ?? "");
  const basePath = explicitPath
    ? explicitPath
    : skillPath
      ? join(skillPath, defaultLeaf ?? "")
      : join("skills", category, name, defaultLeaf ?? "");
  const normalizedPath = normalizeWorkspaceTargetPath(basePath);
  const absolutePath = resolve(context.workspace.root, normalizedPath);
  const relativePath = relative(context.workspace.root, absolutePath).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("..")) {
    throw new Error(`skill_manage path must stay inside the workspace: ${basePath}`);
  }
  if (!relativePath.startsWith("skills/") && !relativePath.startsWith(".agents/skills/")) {
    throw new Error(`skill_manage can only modify skills/ or .agents/skills/: ${basePath}`);
  }
  if (!isManagedSkillFilePath(relativePath)) {
    throw new Error(`skill_manage can only modify SKILL.md, references/, templates/, or scripts/ files: ${basePath}`);
  }
  return relativePath;
}

function isManagedSkillFilePath(relativePath: string): boolean {
  if (relativePath.endsWith("/SKILL.md")) {
    return true;
  }
  return /\/(?:references|templates|scripts)\//.test(relativePath);
}

function sanitizeSkillPathSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function reviewSkillFileContent(relativePath: string, content: string): SkillContentReview {
  const warnings: string[] = [];
  const blockedReasons: string[] = [];
  if (/ignore\s+(previous|all|above|prior)\s+instructions/i.test(content)) {
    warnings.push("Skill content contains prompt-injection-like wording.");
  }
  if (/do\s+not\s+tell\s+the\s+user|system\s+prompt\s+override/i.test(content)) {
    warnings.push("Skill content contains hidden-instruction wording.");
  }
  if (
    /\/scripts\//.test(relativePath) &&
    /\b(?:rm\s+-rf|(?:Remove-Item|rm|ri|del|erase|rd|rmdir)\b[\s\S]*-(?:r|re|rec|recu|recur|recurs|recurse)\b|git\s+reset\s+--hard|curl\b[\s\S]*\|\s*(?:sh|bash)|iwr\b[\s\S]*\|\s*iex)\b/i.test(content)
  ) {
    blockedReasons.push("Skill script contains a high-risk shell fragment.");
  }
  const riskTier: SkillContentReview["riskTier"] = blockedReasons.length > 0 ? 3 : warnings.length > 0 ? 2 : 1;
  return {
    riskTier,
    warnings,
    blockedReasons,
    manualApprovalRequired: riskTier >= 2,
  };
}

function enforceSkillContentReview(review: SkillContentReview): void {
  if (review.blockedReasons.length > 0) {
    throw new Error(`skill_manage blocked a high-risk skill fragment: ${review.blockedReasons.join(" ")}`);
  }
}

async function resolveSelectedWorkspaceSkills(
  context: ToolExecutionContext,
  args: Record<string, unknown>,
  maxCharsPerSkill: number,
): Promise<WorkspaceSkillSelection[]> {
  if (Array.isArray(args.workspaceSkills) && args.workspaceSkills.length > 0) {
    const selections = args.workspaceSkills.map((entry, index) => normalizeWorkspaceSkillSelection(entry, index));
    return Promise.all(
      selections.map(async (entry) => {
        if (entry.content) {
          return entry;
        }
        const [reloaded] = await resolveSelectedWorkspaceSkills(
          context,
          {
            workspaceSkillPaths: [entry.path],
          },
          maxCharsPerSkill,
        );
        return {
          ...entry,
          content: reloaded?.content,
          truncated: reloaded?.truncated ?? entry.truncated,
        };
      }),
    );
  }
  const workspaceSkillPaths = normalizeStringList(args.workspaceSkillPaths);
  if (workspaceSkillPaths.length === 0) {
    return [];
  }
  return Promise.all(
    workspaceSkillPaths.map(async (entry) => {
      const normalizedPath = normalizeWorkspaceTargetPath(entry);
      const absolutePath = resolve(context.workspace.root, normalizedPath);
      const relativePath = relative(context.workspace.root, absolutePath).replace(/\\/g, "/");
      if (!relativePath || relativePath.startsWith("..")) {
        throw new Error(`apply_skills workspaceSkillPaths entry must stay inside the workspace: ${entry}`);
      }
      const rawContent = await readFile(absolutePath, "utf8");
      const { content, truncated } = truncateInstructionText(rawContent, maxCharsPerSkill);
      return {
        path: relativePath,
        name: basenameWithoutExtension(relativePath),
        description: null,
        tags: [],
        relatedSkills: [],
        supportingPaths: [],
        truncated,
        content,
      };
    }),
  );
}

function normalizeWorkspaceSkillSelection(entry: unknown, index: number): WorkspaceSkillSelection {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`apply_skills.workspaceSkills[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  const path = normalizeOptionalString(record.path);
  const name = normalizeOptionalString(record.name);
  if (!path || !name) {
    throw new Error(`apply_skills.workspaceSkills[${index}] requires non-empty path and name values.`);
  }
  return {
    path,
    name,
    description: normalizeOptionalString(record.description) ?? null,
    tags: normalizeStringList(record.tags),
    relatedSkills: normalizeStringList(record.relatedSkills),
    supportingPaths: normalizeStringList(record.supportingPaths),
    truncated: record.truncated === undefined ? false : normalizeBoolean(record.truncated),
    content: normalizeOptionalString(record.content),
  };
}

function truncateInstructionText(content: string, maxChars: number): { readonly content: string; readonly truncated: boolean } {
  if (content.length <= maxChars) {
    return {
      content,
      truncated: false,
    };
  }
  return {
    content: `${content.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...[truncated]`,
    truncated: true,
  };
}

function basenameWithoutExtension(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  const last = segments[segments.length - 1] ?? path;
  return last.replace(/\.[^.]+$/, "");
}

function renderAppliedSkillBriefing(input: {
  readonly objective?: string;
  readonly role: string;
  readonly workspaceSkills: readonly WorkspaceSkillSelection[];
  readonly playbooks: readonly AgentPlaybook[];
}): string {
  const sections = [
    input.objective ? `Objective: ${input.objective}` : null,
    `Role: ${input.role}`,
    input.workspaceSkills.length > 0
      ? [
          "Workspace skills:",
          ...input.workspaceSkills.map((entry) =>
            [
              `- ${entry.name} (${entry.path})${entry.description ? `: ${entry.description}` : ""}`,
              entry.content ?? "",
            ]
              .filter(Boolean)
              .join("\n"),
          ),
        ].join("\n")
      : null,
    input.playbooks.length > 0
      ? [
          "Built-in playbooks:",
          ...input.playbooks.map((playbook) =>
            [
              `- ${playbook.name}: ${playbook.description}`,
              ...playbook.guidance.map((entry) => `  guidance: ${entry}`),
              ...playbook.procedure.map((entry) => `  step: ${entry}`),
            ].join("\n"),
          ),
        ].join("\n")
      : null,
  ].filter((section): section is string => Boolean(section));
  return sections.join("\n\n");
}

type ReferenceSource = "claudecode" | "hermes" | "openclaw";
type ReferenceCapabilityType = "module" | "plugin" | "skill";

interface ReferenceRoot {
  readonly source: ReferenceSource;
  readonly root: string;
  readonly baseDir: string;
}

interface ReferenceCapability {
  readonly id: string;
  readonly source: ReferenceSource;
  readonly type: ReferenceCapabilityType;
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly path: string;
  readonly relativePath: string;
  readonly importable: boolean;
  readonly content?: string;
}

interface ReferenceProjectView {
  readonly source: ReferenceSource;
  readonly name: string;
  readonly root: string;
  readonly workspacePath: string;
}

interface ReferenceProjectOverview {
  readonly source: ReferenceSource;
  readonly name: string;
  readonly workspacePath: string;
  readonly root: string;
  readonly detectedFiles: readonly string[];
  readonly packageManager: "npm" | "pnpm" | "python" | "unknown";
  readonly packageScripts: readonly string[];
  readonly pythonProject: boolean;
  readonly readmePreview: string | null;
}

interface ReferenceAdapter {
  readonly id: string;
  readonly source: ReferenceSource;
  readonly project: string;
  readonly kind: "bun_entrypoint" | "node_entrypoint" | "openclaw_plugin" | "package_script" | "python_entrypoint" | "skill";
  readonly title: string;
  readonly description: string | null;
  readonly cwd: string;
  readonly command: string | null;
  readonly invokable: boolean;
  readonly path: string | null;
  readonly metadata?: Record<string, unknown>;
}

interface ReferenceIntegrationDescriptor {
  readonly id: string;
  readonly source: ReferenceSource;
  readonly category: "claudecode-experience" | "hermes-tool" | "large-module" | "openclaw-plugin";
  readonly title: string;
  readonly omniSurface: "gateway" | "lsp" | "process-tool" | "reference-adapter" | "reference-service" | "schema" | "workbench";
  readonly status: "adapter-ready" | "descriptor-ready" | "service-ready";
  readonly path: string | null;
  readonly serviceId?: string;
  readonly adapterId?: string;
  readonly protocol?: string;
  readonly boundary?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

const REFERENCE_SOURCE_DIRS: Record<ReferenceSource, readonly string[]> = {
  claudecode: [join("claudecode-source", "claude-code-main"), join("claudecode-source", "claw-code-main")],
  hermes: ["hermes-agent-main"],
  openclaw: ["openclaw-main"],
};

const REFERENCE_EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "release",
  "target",
  "win-unpacked",
]);

const REFERENCE_MODULE_PATHS: Record<ReferenceSource, readonly string[]> = {
  claudecode: ["src/tools", "src/context", "src/coordinator", "src/skills", "src/memdir", "src/plugins"],
  hermes: [
    "agent",
    "acp_adapter",
    "tools",
    "trajectory_compressor.py",
    "agent/context_compressor.py",
    "tools/mcp_tool.py",
    "tools/browser_tool.py",
    "tools/delegate_tool.py",
  ],
  openclaw: ["src/acp", "src/mcp", "src/security", "src/memory", "src/trajectory", "src/tui", "src/web-search", "extensions"],
};

const REFERENCE_PYTHON_ENTRYPOINTS: Record<ReferenceSource, readonly string[]> = {
  claudecode: [],
  hermes: ["run_agent.py", "cli.py", "mcp_serve.py", "mini_swe_runner.py", "batch_runner.py", "trajectory_compressor.py"],
  openclaw: [],
};

const REFERENCE_NODE_ENTRYPOINTS: Record<ReferenceSource, readonly string[]> = {
  claudecode: [],
  hermes: [],
  openclaw: ["openclaw.mjs"],
};

const REFERENCE_BUN_ENTRYPOINTS: Record<ReferenceSource, readonly string[]> = {
  claudecode: ["src/entrypoints/cli.tsx", "app/server.ts", "scripts/health-check.ts"],
  hermes: [],
  openclaw: [],
};

function normalizeReferenceSource(value: unknown): ReferenceSource | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "hermes" || normalized === "hermes-agent") {
    return "hermes";
  }
  if (normalized === "openclaw" || normalized === "open-claw") {
    return "openclaw";
  }
  if (
    normalized === "claudecode" ||
    normalized === "claude-code" ||
    normalized === "claude" ||
    normalized === "claw-code"
  ) {
    return "claudecode";
  }
  throw new Error(`Unsupported reference source: ${String(value)}`);
}

function normalizeReferenceNativeCategory(value: unknown): ReferenceNativeCategory | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized === "claudecode-experience" ||
    normalized === "hermes-tool" ||
    normalized === "large-module" ||
    normalized === "openclaw-plugin"
  ) {
    return normalized;
  }
  throw new Error(`Unsupported reference native category: ${String(value)}`);
}

async function scanReferenceCapabilities(
  workspaceRoot: string,
  options: {
    readonly query?: string;
    readonly source?: ReferenceSource | null;
    readonly limit: number;
    readonly includeContent: boolean;
    readonly maxChars: number;
  },
): Promise<ReferenceCapability[]> {
  const roots = (await resolveReferenceRoots(workspaceRoot)).filter((root) => !options.source || root.source === options.source);
  const readContentForSearch = options.includeContent || Boolean(options.query?.trim());
  const capabilities: ReferenceCapability[] = [];
  for (const root of roots) {
    capabilities.push(...(await scanReferenceSkills(root, readContentForSearch, options.maxChars)));
    capabilities.push(...(await scanReferenceModules(root)));
    capabilities.push(...(await scanReferencePlugins(root)));
  }

  const normalizedQuery = options.query?.trim().toLowerCase() ?? "";
  const filtered = normalizedQuery
    ? capabilities.filter((entry) => {
        const haystack = [
          entry.id,
          entry.source,
          entry.type,
          entry.title,
          entry.description ?? "",
          entry.category ?? "",
          entry.relativePath,
          entry.content ?? "",
        ]
          .join("\n")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : capabilities;

  const trimmed = options.includeContent
    ? filtered
    : filtered.map((entry) => ({
        id: entry.id,
        source: entry.source,
        type: entry.type,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        path: entry.path,
        relativePath: entry.relativePath,
        importable: entry.importable,
      }));

  return trimmed
    .sort((left, right) => {
      if (left.importable !== right.importable) {
        return left.importable ? -1 : 1;
      }
      if (left.source !== right.source) {
        return left.source.localeCompare(right.source);
      }
      if (left.type !== right.type) {
        return left.type.localeCompare(right.type);
      }
      return left.relativePath.localeCompare(right.relativePath);
    })
    .slice(0, options.limit);
}

async function resolveReferenceRoots(workspaceRoot: string): Promise<ReferenceRoot[]> {
  const roots: ReferenceRoot[] = [];
  const vendoredBaseDir = join(workspaceRoot, "vendor", "reference");
  const vendoredRoots = await resolveReferenceRootsFromBase(vendoredBaseDir);
  roots.push(...vendoredRoots);
  const vendoredSources = new Set(vendoredRoots.map((root) => root.source));

  const baseDir = await findReferenceBaseDir(workspaceRoot);
  if (baseDir) {
    const siblingRoots = await resolveReferenceRootsFromBase(baseDir);
    roots.push(...siblingRoots.filter((root) => !vendoredSources.has(root.source)));
  }
  return roots;
}

async function resolveReferenceRootsFromBase(baseDir: string): Promise<ReferenceRoot[]> {
  const roots: ReferenceRoot[] = [];
  if (!(await pathIsDirectory(baseDir))) {
    return roots;
  }
  for (const [source, candidates] of Object.entries(REFERENCE_SOURCE_DIRS) as Array<[ReferenceSource, readonly string[]]>) {
    for (const candidate of candidates) {
      const root = join(baseDir, candidate);
      if (await pathIsDirectory(root)) {
        roots.push({ source, root, baseDir });
      }
    }
  }
  return roots;
}

async function resolveReferenceProjectViews(
  workspaceRoot: string,
  source?: ReferenceSource | null,
): Promise<ReferenceProjectView[]> {
  const roots = (await resolveReferenceRoots(workspaceRoot)).filter((root) => !source || root.source === source);
  return roots.map((root) => ({
    source: root.source,
    name: basename(root.root),
    root: root.root,
    workspacePath: relative(workspaceRoot, root.root).replace(/\\/g, "/"),
  }));
}

function selectReferenceProject(
  projects: readonly ReferenceProjectView[],
  projectName?: string,
  source?: ReferenceSource | null,
): ReferenceProjectView {
  if (projects.length === 0) {
    throw new Error(source ? `No vendored reference project found for source ${source}.` : "No vendored reference projects found.");
  }
  if (!projectName) {
    return projects[0] as ReferenceProjectView;
  }
  const normalized = projectName.trim().toLowerCase();
  const selected = projects.find((project) => project.name.toLowerCase() === normalized || project.workspacePath.toLowerCase().endsWith(normalized));
  if (!selected) {
    throw new Error(`No vendored reference project matches project=${projectName}.`);
  }
  return selected;
}

async function loadReferenceProjectOverview(project: ReferenceProjectView): Promise<ReferenceProjectOverview> {
  const detectedFiles: string[] = [];
  for (const fileName of ["package.json", "pnpm-lock.yaml", "package-lock.json", "pyproject.toml", "README.md", "AGENTS.md", "CLAUDE.md"]) {
    if (await pathExists(join(project.root, fileName))) {
      detectedFiles.push(fileName);
    }
  }
  const packageJson = await readReferencePackageJson(project.root);
  const packageScripts = Object.keys(packageJson?.scripts ?? {}).sort();
  let packageManager: ReferenceProjectOverview["packageManager"] = "unknown";
  if (detectedFiles.includes("package.json")) {
    packageManager = detectedFiles.includes("pnpm-lock.yaml") ? "pnpm" : "npm";
  } else if (detectedFiles.includes("pyproject.toml")) {
    packageManager = "python";
  }
  const readmePreview = await readReferencePreview(join(project.root, "README.md"), 1_200);
  return {
    source: project.source,
    name: project.name,
    workspacePath: project.workspacePath,
    root: project.root,
    detectedFiles,
    packageManager,
    packageScripts,
    pythonProject: detectedFiles.includes("pyproject.toml"),
    readmePreview,
  };
}

async function readReferencePackageJson(root: string): Promise<{ readonly scripts?: Record<string, string> } | null> {
  try {
    return JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}

async function readReferencePreview(path: string, maxChars: number): Promise<string | null> {
  try {
    return truncateReferenceContent(await readFile(path, "utf8"), maxChars);
  } catch {
    return null;
  }
}

function normalizeReferenceSubpath(value: unknown): string {
  const input = normalizeOptionalString(value) ?? ".";
  const normalized = input.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Reference project path must stay inside the selected project: ${input}`);
  }
  return normalized === "." ? "" : normalized;
}

function normalizeReferenceScriptName(value: unknown): string {
  const script = normalizeOptionalString(value);
  if (!script || !/^[a-zA-Z0-9:_./-]+$/.test(script)) {
    throw new Error("reference_project run_script requires a simple package script name.");
  }
  return script;
}

async function listReferenceAdapters(
  workspaceRoot: string,
  options: { readonly source?: ReferenceSource | null; readonly query?: string },
): Promise<ReferenceAdapter[]> {
  const projects = await resolveReferenceProjectViews(workspaceRoot, options.source);
  const adapters: ReferenceAdapter[] = [];
  for (const project of projects) {
    adapters.push(...(await buildReferenceProjectAdapters(project)));
  }
  const normalizedQuery = options.query?.trim().toLowerCase() ?? "";
  const filtered = normalizedQuery
    ? adapters.filter((adapter) =>
        [
          adapter.id,
          adapter.source,
          adapter.project,
          adapter.kind,
          adapter.title,
          adapter.description ?? "",
          adapter.path ?? "",
          JSON.stringify(adapter.metadata ?? {}),
        ]
          .join("\n")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : adapters;
  return filtered.sort((left, right) => left.id.localeCompare(right.id));
}

async function buildReferenceProjectAdapters(project: ReferenceProjectView): Promise<ReferenceAdapter[]> {
  const adapters: ReferenceAdapter[] = [];
  const overview = await loadReferenceProjectOverview(project);
  for (const script of overview.packageScripts) {
    const command = `${overview.packageManager === "pnpm" ? "pnpm" : "npm"} run ${script}`;
    adapters.push({
      id: `${project.source}:${project.name}:package:${script}`,
      source: project.source,
      project: project.name,
      kind: "package_script",
      title: script,
      description: `Run package script "${script}" in ${project.name}.`,
      cwd: project.workspacePath,
      command,
      invokable: true,
      path: "package.json",
    });
  }
  for (const entrypoint of REFERENCE_PYTHON_ENTRYPOINTS[project.source]) {
    if (await pathExists(join(project.root, entrypoint))) {
      adapters.push({
        id: `${project.source}:${project.name}:python:${entrypoint}`,
        source: project.source,
        project: project.name,
        kind: "python_entrypoint",
        title: entrypoint,
        description: `Run Python entrypoint ${entrypoint}. Pass --help as args to inspect usage.`,
        cwd: project.workspacePath,
        command: `python ${quoteReferenceShellArgument(entrypoint)}`,
        invokable: true,
        path: entrypoint,
      });
    }
  }
  for (const entrypoint of REFERENCE_NODE_ENTRYPOINTS[project.source]) {
    if (await pathExists(join(project.root, entrypoint))) {
      adapters.push({
        id: `${project.source}:${project.name}:node:${entrypoint}`,
        source: project.source,
        project: project.name,
        kind: "node_entrypoint",
        title: entrypoint,
        description: `Run Node entrypoint ${entrypoint}.`,
        cwd: project.workspacePath,
        command: `node ${quoteReferenceShellArgument(entrypoint)}`,
        invokable: true,
        path: entrypoint,
      });
    }
  }
  for (const entrypoint of REFERENCE_BUN_ENTRYPOINTS[project.source]) {
    if (await pathExists(join(project.root, entrypoint))) {
      adapters.push({
        id: `${project.source}:${project.name}:bun:${entrypoint}`,
        source: project.source,
        project: project.name,
        kind: "bun_entrypoint",
        title: entrypoint,
        description: `Run Bun entrypoint ${entrypoint}. Requires bun to be installed.`,
        cwd: project.workspacePath,
        command: `bun run ${quoteReferenceShellArgument(entrypoint)}`,
        invokable: true,
        path: entrypoint,
      });
    }
  }
  const skills = await scanReferenceSkills(
    {
      source: project.source,
      root: project.root,
      baseDir: dirname(project.root),
    },
    false,
    1_200,
  );
  for (const skill of skills) {
    adapters.push({
      id: `${project.source}:${project.name}:skill:${skill.relativePath}`,
      source: project.source,
      project: project.name,
      kind: "skill",
      title: skill.title,
      description: skill.description,
      cwd: project.workspacePath,
      command: null,
      invokable: false,
      path: skill.relativePath,
      metadata: {
        category: skill.category,
        importable: skill.importable,
      },
    });
  }
  if (project.source === "openclaw") {
    const pluginFiles = await walkReferenceFiles(join(project.root, "extensions"), (entryPath) => basename(entryPath) === "openclaw.plugin.json", 4);
    for (const pluginFile of pluginFiles) {
      const manifest = await readReferencePluginManifest(pluginFile);
      adapters.push({
        id: `${project.source}:${project.name}:plugin:${relative(project.root, pluginFile).replace(/\\/g, "/")}`,
        source: project.source,
        project: project.name,
        kind: "openclaw_plugin",
        title: manifest.name ?? basename(dirname(pluginFile)),
        description: manifest.description ?? "OpenClaw plugin manifest.",
        cwd: project.workspacePath,
        command: null,
        invokable: false,
        path: relative(project.root, pluginFile).replace(/\\/g, "/"),
        metadata: manifest,
      });
    }
  }
  return adapters;
}

async function readReferencePluginManifest(path: string): Promise<Record<string, unknown> & { readonly name?: string; readonly description?: string }> {
  try {
    const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return {
      ...manifest,
      name: typeof manifest.name === "string" ? manifest.name : undefined,
      description: typeof manifest.description === "string" ? manifest.description : undefined,
    };
  } catch {
    return {};
  }
}

async function loadReferenceAdapterHealth(project: ReferenceProjectView): Promise<{
  readonly source: ReferenceSource;
  readonly project: string;
  readonly workspacePath: string;
  readonly packageManager: ReferenceProjectOverview["packageManager"];
  readonly adapterCount: number;
  readonly invokableAdapterCount: number;
  readonly ready: boolean;
  readonly checks: readonly { readonly name: string; readonly ok: boolean; readonly detail: string }[];
}> {
  const overview = await loadReferenceProjectOverview(project);
  const adapters = await buildReferenceProjectAdapters(project);
  const checks: Array<{ readonly name: string; readonly ok: boolean; readonly detail: string }> = [];
  checks.push({
    name: "source_synced",
    ok: await pathIsDirectory(project.root),
    detail: project.workspacePath,
  });
  if (overview.packageManager === "pnpm" || overview.packageManager === "npm") {
    checks.push({
      name: "node_modules",
      ok: await pathIsDirectory(join(project.root, "node_modules")),
      detail: "Required before most package scripts can run.",
    });
  }
  if (project.source === "openclaw") {
    checks.push({
      name: "openclaw_dist_entry",
      ok: (await pathExists(join(project.root, "dist", "entry.js"))) || (await pathExists(join(project.root, "dist", "entry.mjs"))),
      detail: "openclaw.mjs requires dist/entry.(m)js; prepareMode=build or full should create it.",
    });
  }
  if (project.source === "hermes") {
    checks.push({
      name: "python_project",
      ok: await pathExists(join(project.root, "pyproject.toml")),
      detail: "Hermes runtime entrypoints use Python project dependencies.",
    });
  }
  if (project.source === "claudecode") {
    checks.push({
      name: "bun_lock",
      ok: await pathExists(join(project.root, "bun.lock")),
      detail: "ClaudeCode reference entrypoints expect bun dependencies.",
    });
  }
  return {
    source: project.source,
    project: project.name,
    workspacePath: project.workspacePath,
    packageManager: overview.packageManager,
    adapterCount: adapters.length,
    invokableAdapterCount: adapters.filter((adapter) => adapter.invokable).length,
    ready: checks.every((check) => check.ok),
    checks,
  };
}

function normalizeReferencePrepareMode(value: unknown): "build" | "full" | "install" {
  const normalized = String(value ?? "full").trim().toLowerCase();
  if (normalized === "install" || normalized === "build" || normalized === "full") {
    return normalized;
  }
  throw new Error(`Unsupported reference adapter prepareMode: ${String(value)}`);
}

function buildReferencePrepareCommand(source: ReferenceSource, mode: "build" | "full" | "install"): string {
  if (source === "openclaw") {
    if (mode === "install") {
      return "corepack pnpm install --config.node-linker=hoisted";
    }
    if (mode === "build") {
      return "corepack pnpm run build";
    }
    return "corepack pnpm install --config.node-linker=hoisted && corepack pnpm run build";
  }
  if (source === "hermes") {
    if (mode === "build") {
      return "python -m compileall .";
    }
    return "python -m pip install -e .";
  }
  if (source === "claudecode") {
    if (mode === "install") {
      return "bun install";
    }
    if (mode === "build") {
      return "bun run build";
    }
    return "bun install && bun run build";
  }
  throw new Error(`Unsupported reference source for prepare: ${source}`);
}

async function listReferenceServices(
  workspaceRoot: string,
  options: { readonly source?: ReferenceSource | null; readonly query?: string },
): Promise<ReferenceServiceSpec[]> {
  const projects = await resolveReferenceProjectViews(workspaceRoot, options.source);
  const services: ReferenceServiceSpec[] = [];
  for (const project of projects) {
    services.push(...(await buildReferenceServiceSpecs(project)));
  }
  const normalizedQuery = options.query?.trim().toLowerCase() ?? "";
  const filtered = normalizedQuery
    ? services.filter((service) =>
        [service.id, service.source, service.project, service.title, service.description, service.protocol, service.command]
          .join("\n")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : services;
  return filtered.sort((left, right) => left.id.localeCompare(right.id));
}

async function buildReferenceServiceSpecs(project: ReferenceProjectView): Promise<ReferenceServiceSpec[]> {
  const services: ReferenceServiceSpec[] = [];
  if (project.source === "openclaw" && (await pathExists(join(project.root, "openclaw.mjs")))) {
    services.push({
      id: `${project.source}:${project.name}:gateway`,
      source: project.source,
      project: project.name,
      title: "OpenClaw Gateway",
      description: "Start the OpenClaw native gateway/CLI runtime from openclaw.mjs.",
      protocol: "gateway",
      cwd: project.workspacePath,
      command: "node \"openclaw.mjs\"",
      longRunning: true,
      requiresPrepare: true,
    });
  }
  if (project.source === "hermes" && (await pathExists(join(project.root, "run_agent.py")))) {
    services.push({
      id: `${project.source}:${project.name}:agent-loop`,
      source: project.source,
      project: project.name,
      title: "Hermes Python Agent Loop",
      description: "Start the Hermes Python agent loop. Pass runtime CLI args through reference_service.start args.",
      protocol: "hermes-loop",
      cwd: project.workspacePath,
      command: "python \"run_agent.py\"",
      longRunning: true,
      requiresPrepare: true,
    });
  }
  if (project.source === "hermes" && (await pathExists(join(project.root, "mcp_serve.py")))) {
    services.push({
      id: `${project.source}:${project.name}:mcp-server`,
      source: project.source,
      project: project.name,
      title: "Hermes MCP Server",
      description: "Start Hermes MCP server bridge.",
      protocol: "plugin",
      cwd: project.workspacePath,
      command: "python \"mcp_serve.py\"",
      longRunning: true,
      requiresPrepare: true,
    });
  }
  if (project.source === "claudecode" && (await pathExists(join(project.root, "src", "entrypoints", "cli.tsx")))) {
    services.push({
      id: `${project.source}:${project.name}:tui`,
      source: project.source,
      project: project.name,
      title: "ClaudeCode TUI",
      description: "Start ClaudeCode Bun TUI entrypoint.",
      protocol: "tui",
      cwd: project.workspacePath,
      command: "bun run \"src/entrypoints/cli.tsx\"",
      longRunning: true,
      requiresPrepare: true,
    });
  }
  if (project.source === "claudecode" && (await pathExists(join(project.root, "app", "server.ts")))) {
    services.push({
      id: `${project.source}:${project.name}:web-app`,
      source: project.source,
      project: project.name,
      title: "ClaudeCode Web App",
      description: "Start ClaudeCode web app server without opening a browser.",
      protocol: "web",
      cwd: project.workspacePath,
      command: "bun run \"app/server.ts\" --no-open",
      longRunning: true,
      requiresPrepare: true,
    });
  }
  if (project.source === "claudecode" && (await pathExists(join(project.root, "desktop-builder", "main.mjs")))) {
    services.push({
      id: `${project.source}:${project.name}:desktop`,
      source: project.source,
      project: project.name,
      title: "ClaudeCode Desktop",
      description: "Start ClaudeCode desktop builder entrypoint.",
      protocol: "desktop",
      cwd: project.workspacePath,
      command: "node \"desktop-builder/main.mjs\"",
      longRunning: true,
      requiresPrepare: true,
    });
  }
  return services;
}

async function listReferencePluginProtocols(
  workspaceRoot: string,
  options: { readonly source?: ReferenceSource | null; readonly query?: string },
): Promise<Array<Record<string, unknown>>> {
  const projects = await resolveReferenceProjectViews(workspaceRoot, options.source ?? "openclaw");
  const protocols: Array<Record<string, unknown>> = [];
  for (const project of projects.filter((entry) => entry.source === "openclaw")) {
    const pluginFiles = await walkReferenceFiles(join(project.root, "extensions"), (entryPath) => basename(entryPath) === "openclaw.plugin.json", 4);
    for (const pluginFile of pluginFiles) {
      const manifest = await readReferencePluginManifest(pluginFile);
      protocols.push({
        source: project.source,
        project: project.name,
        protocol: "openclaw.plugin",
        path: relative(project.root, pluginFile).replace(/\\/g, "/"),
        name: manifest.name ?? basename(dirname(pluginFile)),
        description: manifest.description ?? null,
        manifest,
      });
    }
  }
  const normalizedQuery = options.query?.trim().toLowerCase() ?? "";
  return normalizedQuery
    ? protocols.filter((entry) => JSON.stringify(entry).toLowerCase().includes(normalizedQuery))
    : protocols;
}

function selectReferenceService(services: readonly ReferenceServiceSpec[], id: string): ReferenceServiceSpec {
  const selected = services.find((service) => service.id === id);
  if (!selected) {
    throw new Error(`No reference service found for id=${id}.`);
  }
  return selected;
}

function describeReferenceService(service: ReferenceServiceSpec): Record<string, unknown> {
  const runtime = referenceServiceRuntime.get(service.id);
  const process = runtime ? managedProcesses.get(runtime.processId) : null;
  return {
    ...service,
    runtime: process
      ? {
          processId: process.id,
          status: process.status,
          exitCode: process.exitCode,
          startedAt: process.startedAt,
        }
      : null,
  };
}

function describeReferenceServiceRuntime(service: ReferenceServiceSpec, process: ManagedProcessRecord): Record<string, unknown> {
  return {
    service: describeReferenceService(service),
    process: describeManagedProcess(process),
  };
}

function startManagedProcess(command: string, cwd: string, ownerWorkspaceRoot: string): ManagedProcessRecord {
  const child = spawn(command, {
    cwd,
    shell: true,
    windowsHide: true,
  });
  const id = randomUUID();
  const record: ManagedProcessRecord = {
    id,
    command,
    cwd,
    ownerWorkspaceRoot,
    startedAt: new Date().toISOString(),
    status: "running",
    exitCode: null,
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    child,
  };
  child.stdout?.on("data", (chunk) => {
    appendManagedProcessOutput(record, "stdout", chunk);
  });
  child.stderr?.on("data", (chunk) => {
    appendManagedProcessOutput(record, "stderr", chunk);
  });
  child.on("close", (code) => {
    record.status = "exited";
    record.exitCode = code ?? 0;
    record.abortCleanup?.();
    pruneManagedProcessRecords();
  });
  managedProcesses.set(id, record);
  pruneManagedProcessRecords();
  return record;
}

async function stopManagedProcess(record: ManagedProcessRecord): Promise<void> {
  record.abortCleanup?.();
  record.abortCleanup = undefined;
  if (record.status !== "running") {
    record.exitCode ??= 0;
    return;
  }
  const closed = new Promise<void>((resolvePromise) => {
    const timer = setTimeout(resolvePromise, 1_000);
    record.child.once("close", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
  await killManagedProcessTree(record.child);
  await closed;
  record.status = "exited";
  record.exitCode ??= 0;
}

async function killManagedProcessTree(child: ChildProcess): Promise<void> {
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolvePromise) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
      });
      killer.on("close", () => resolvePromise());
      killer.on("error", () => resolvePromise());
    });
    return;
  }
  try {
    child.kill();
  } catch {
    // Best-effort process cleanup.
  }
}

async function waitForReferenceServiceWarmup(timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) {
    return;
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, timeoutMs));
}

async function listReferenceIntegrations(
  workspaceRoot: string,
  options: { readonly source?: ReferenceSource | null; readonly category?: string; readonly query?: string },
): Promise<ReferenceIntegrationDescriptor[]> {
  const projects = await resolveReferenceProjectViews(workspaceRoot, options.source);
  const descriptors: ReferenceIntegrationDescriptor[] = [];
  for (const project of projects) {
    descriptors.push(...(await buildReferenceExperienceIntegrations(project)));
    descriptors.push(...(await buildHermesToolIntegrations(project)));
    descriptors.push(...(await buildOpenClawPluginIntegrations(project)));
    descriptors.push(...(await buildLargeModuleIntegrations(project)));
  }
  const normalizedCategory = options.category?.trim().toLowerCase() ?? "";
  const normalizedQuery = options.query?.trim().toLowerCase() ?? "";
  return descriptors
    .filter((entry) => !normalizedCategory || entry.category === normalizedCategory)
    .filter((entry) =>
      normalizedQuery
        ? JSON.stringify(entry)
            .toLowerCase()
            .includes(normalizedQuery)
        : true,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function buildReferenceExperienceIntegrations(project: ReferenceProjectView): Promise<ReferenceIntegrationDescriptor[]> {
  if (project.source !== "claudecode") {
    return [];
  }
  const descriptors: ReferenceIntegrationDescriptor[] = [];
  const serviceIds = new Set((await buildReferenceServiceSpecs(project)).map((service) => service.id));
  const addIfExists = async (input: {
    readonly idSuffix: string;
    readonly title: string;
    readonly path: string;
    readonly omniSurface: ReferenceIntegrationDescriptor["omniSurface"];
    readonly serviceId?: string;
    readonly metadata?: Record<string, unknown>;
  }): Promise<void> => {
    if (!(await pathExists(join(project.root, input.path)))) {
      return;
    }
    descriptors.push({
      id: `${project.source}:${project.name}:experience:${input.idSuffix}`,
      source: project.source,
      category: "claudecode-experience",
      title: input.title,
      omniSurface: input.omniSurface,
      status: input.serviceId && serviceIds.has(input.serviceId) ? "service-ready" : "descriptor-ready",
      path: input.path,
      serviceId: input.serviceId,
      boundary: {
        lifecycle: input.serviceId ? "reference_service" : "descriptor",
        writable: false,
      },
      metadata: input.metadata,
    });
  };
  await addIfExists({
    idSuffix: "tui",
    title: "ClaudeCode TUI mapped to reference_service",
    path: "src/entrypoints/cli.tsx",
    omniSurface: "reference-service",
    serviceId: `${project.source}:${project.name}:tui`,
  });
  await addIfExists({
    idSuffix: "desktop",
    title: "ClaudeCode desktop mapped to reference_service",
    path: "desktop-builder/main.mjs",
    omniSurface: "reference-service",
    serviceId: `${project.source}:${project.name}:desktop`,
  });
  await addIfExists({
    idSuffix: "web-app",
    title: "ClaudeCode web app mapped to reference_service",
    path: "app/server.ts",
    omniSurface: "workbench",
    serviceId: `${project.source}:${project.name}:web-app`,
  });
  await addIfExists({
    idSuffix: "lsp",
    title: "ClaudeCode LSP diagnostics mapped to omni-agent LSP/workspace diagnostics",
    path: "src/services/lsp",
    omniSurface: "lsp",
    metadata: {
      pairedToolPath: "src/tools/LSPTool",
      omniTarget: "packages/workspace diagnostics and tools/lsp_diagnostics",
    },
  });
  return descriptors;
}

async function buildHermesToolIntegrations(project: ReferenceProjectView): Promise<ReferenceIntegrationDescriptor[]> {
  if (project.source !== "hermes" || !(await pathIsDirectory(join(project.root, "tools")))) {
    return [];
  }
  const toolFiles = await walkReferenceFiles(join(project.root, "tools"), (entryPath) => entryPath.endsWith(".py"), 1);
  return toolFiles
    .filter((toolFile) => basename(toolFile).includes("tool"))
    .map((toolFile) => {
      const relativePath = relative(project.root, toolFile).replace(/\\/g, "/");
      const name = basenameWithoutExtension(relativePath);
      return {
        id: `${project.source}:${project.name}:tool:${relativePath}`,
        source: project.source,
        category: "hermes-tool",
        title: name,
        omniSurface: "process-tool",
        status: "adapter-ready",
        path: relativePath,
        serviceId: name.includes("mcp") ? `${project.source}:${project.name}:mcp-server` : undefined,
        boundary: inferHermesToolBoundary(name),
        metadata: {
          invocation: "reference_adapter python entrypoint or process-isolated wrapper",
          runtime: "python",
        },
      } satisfies ReferenceIntegrationDescriptor;
    });
}

async function buildOpenClawPluginIntegrations(project: ReferenceProjectView): Promise<ReferenceIntegrationDescriptor[]> {
  if (project.source !== "openclaw") {
    return [];
  }
  const protocols = await listReferencePluginProtocols(dirname(project.root), { source: "openclaw" });
  return protocols
    .filter((entry) => entry.project === project.name)
    .map((entry) => {
      const path = typeof entry.path === "string" ? entry.path : null;
      const name = typeof entry.name === "string" ? entry.name : path ?? "plugin";
      const manifest = (entry.manifest && typeof entry.manifest === "object" ? entry.manifest : {}) as Record<string, unknown>;
      return {
        id: `${project.source}:${project.name}:plugin-schema:${path ?? name}`,
        source: project.source,
        category: "openclaw-plugin",
        title: name,
        omniSurface: inferOpenClawPluginSurface(manifest),
        status: "descriptor-ready",
        path,
        protocol: "openclaw.plugin",
        boundary: {
          manifestSchema: "openclaw.plugin",
          secrets: collectOpenClawSecretRefs(manifest),
          configSchema: manifest.configSchema ?? null,
        },
        metadata: manifest,
      } satisfies ReferenceIntegrationDescriptor;
    });
}

async function buildLargeModuleIntegrations(project: ReferenceProjectView): Promise<ReferenceIntegrationDescriptor[]> {
  const descriptors: ReferenceIntegrationDescriptor[] = [];
  for (const modulePath of REFERENCE_MODULE_PATHS[project.source]) {
    if (!(await pathExists(join(project.root, modulePath)))) {
      continue;
    }
    descriptors.push({
      id: `${project.source}:${project.name}:module:${modulePath}`,
      source: project.source,
      category: "large-module",
      title: basenameWithoutExtension(modulePath),
      omniSurface: inferReferenceModuleSurface(project.source, modulePath),
      status: "descriptor-ready",
      path: modulePath,
      boundary: {
        importMode: "adapter",
        directCopy: false,
        reason: "large module is exposed through schema/service/process adapter before native rewrite",
      },
      metadata: {
        description: describeReferenceModule(project.source, modulePath),
      },
    });
  }
  return descriptors;
}

function inferHermesToolBoundary(name: string): Record<string, unknown> {
  const lowered = name.toLowerCase();
  return {
    filesystem: /file|terminal|code|skill/.test(lowered) ? "read-write" : "limited",
    network: /browser|web|discord|feishu|homeassistant|mcp|send|image|tts|transcription|vision/.test(lowered),
    secrets: /discord|feishu|homeassistant|mcp|send|image|tts|transcription|vision/.test(lowered),
    isolation: "process",
  };
}

function inferOpenClawPluginSurface(manifest: Record<string, unknown>): ReferenceIntegrationDescriptor["omniSurface"] {
  if (Array.isArray(manifest.channels)) {
    return "gateway";
  }
  if (Array.isArray(manifest.providers) || manifest.providerDiscoveryEntry) {
    return "reference-adapter";
  }
  return "schema";
}

function collectOpenClawSecretRefs(manifest: Record<string, unknown>): string[] {
  const secretRefs: string[] = [];
  for (const key of ["channelEnvVars", "providerAuthEnvVars"]) {
    const value = manifest[key];
    if (value && typeof value === "object") {
      for (const entries of Object.values(value as Record<string, unknown>)) {
        if (Array.isArray(entries)) {
          secretRefs.push(...entries.map((entry) => String(entry)));
        }
      }
    }
  }
  return [...new Set(secretRefs)].sort();
}

function inferReferenceModuleSurface(source: ReferenceSource, modulePath: string): ReferenceIntegrationDescriptor["omniSurface"] {
  const normalized = modulePath.replace(/\\/g, "/").toLowerCase();
  if (source === "openclaw" && (normalized.includes("gateway") || normalized.includes("mcp") || normalized.includes("extensions"))) {
    return "gateway";
  }
  if (source === "claudecode" && (normalized.includes("context") || normalized.includes("coordinator") || normalized.includes("tools"))) {
    return "workbench";
  }
  if (source === "hermes" && normalized.includes("tools")) {
    return "process-tool";
  }
  return "schema";
}

function buildReferenceIntegrationSchema(): Record<string, unknown> {
  return {
    version: 1,
    fields: {
      id: "stable integration id",
      source: ["claudecode", "hermes", "openclaw"],
      category: ["claudecode-experience", "hermes-tool", "large-module", "openclaw-plugin"],
      omniSurface: ["gateway", "lsp", "process-tool", "reference-adapter", "reference-service", "schema", "workbench"],
      status: ["adapter-ready", "descriptor-ready", "service-ready"],
      boundary: "permission and isolation metadata",
    },
    actions: {
      list: "discover descriptors by source/category/query",
      coverage: "compute native control-plane and product-equivalence gates",
      contract: "verify descriptor path, lifecycle registration, plugin schema, and optional process-level checks",
      invoke: "route service descriptors to managed lifecycle, run Hermes process tools, or return normalized plugin/module payloads",
      plan: "produce the native adapter migration steps for selected descriptors",
      write_manifest: "persist the generated descriptor manifest",
    },
  };
}

function buildReferenceNativeFusionCoverage(descriptors: readonly ReferenceIntegrationDescriptor[]): Record<string, unknown> {
  const entries = descriptors.map(buildReferenceNativeFusionEntry);
  const summary = {
    descriptorCount: entries.length,
    nativeManagedCount: entries.filter((entry) => entry.nativeManaged).length,
    nativeControlPlaneParityCount: entries.filter((entry) => entry.nativeControlPlaneParity).length,
    fullProductParityCount: entries.filter((entry) => entry.fullProductParity).length,
    nativeRewriteCompleteCount: entries.filter((entry) => entry.nativeRewriteComplete).length,
    nativeControlPlaneComplete: entries.every((entry) => entry.nativeManaged),
    nativeControlPlaneParity: entries.length > 0 && entries.every((entry) => entry.nativeControlPlaneParity),
    fullProductParity: entries.length > 0 && entries.every((entry) => entry.fullProductParity),
    nativeRewriteComplete: entries.length > 0 && entries.every((entry) => entry.nativeRewriteComplete),
  };
  return {
    summary,
    bySource: countReferenceFusionEntries(entries, "source"),
    byCategory: countReferenceFusionEntries(entries, "category"),
    byNativeState: countReferenceFusionEntries(entries, "nativeState"),
    entries,
  };
}

function buildReferenceNativeFusionEntry(descriptor: ReferenceIntegrationDescriptor): Record<string, unknown> & {
  readonly source: string;
  readonly category: string;
  readonly nativeState: string;
  readonly nativeManaged: boolean;
  readonly nativeControlPlaneParity: boolean;
  readonly fullProductParity: boolean;
  readonly nativeRewriteComplete: boolean;
} {
  const nativeState = inferReferenceNativeState(descriptor);
  const productGates = buildReferenceProductParityGates(descriptor);
  const nativeRewriteGates = buildReferenceNativeRewriteGates(descriptor);
  const blockers = productGates.filter((gate) => !gate.ok).map((gate) => gate.name);
  const rewriteBlockers = nativeRewriteGates.filter((gate) => !gate.ok).map((gate) => gate.name);
  const nativePlan = getNativeImplementationPlan(descriptor.id);
  const productParityStatus = nativePlan?.parityClaims.parityStatus ?? "unverified";
  const nativeControlPlaneParity = blockers.length === 0;
  const fullProductParity = nativeControlPlaneParity && productParityStatus === "product-equivalent";
  const productBlockers = fullProductParity ? [] : ["requires_product_equivalent_evidence"];
  return {
    id: descriptor.id,
    source: descriptor.source,
    category: descriptor.category,
    title: descriptor.title,
    omniSurface: descriptor.omniSurface,
    status: descriptor.status,
    nativeState,
    nativeManaged: nativeState !== "unmanaged",
    nativeControlPlaneParity,
    fullProductParity,
    nativeRewriteComplete: rewriteBlockers.length === 0,
    parityScope: fullProductParity ? "product-equivalent" : "native-control-plane",
    productParityStatus,
    equivalenceMode: "reference-backed-native-control-plane",
    productGates,
    nativeRewriteGates,
    blockers,
    productBlockers,
    rewriteBlockers,
    evidence: buildReferenceFusionEvidence(descriptor),
  };
}

function inferReferenceNativeState(descriptor: ReferenceIntegrationDescriptor): string {
  if (descriptor.serviceId && descriptor.status === "service-ready") {
    return "native-lifecycle-managed";
  }
  if (descriptor.category === "hermes-tool" && descriptor.status === "adapter-ready") {
    return "native-process-managed";
  }
  if (descriptor.category === "openclaw-plugin" && descriptor.protocol === "openclaw.plugin") {
    return "native-schema-managed";
  }
  if (descriptor.category === "claudecode-experience" && descriptor.omniSurface === "lsp") {
    return "native-model-mapped";
  }
  if (descriptor.category === "large-module") {
    return "native-discovery-managed";
  }
  return "unmanaged";
}

function buildReferenceProductParityGates(
  descriptor: ReferenceIntegrationDescriptor,
): Array<{ readonly name: string; readonly ok: boolean; readonly detail: string }> {
  if (descriptor.category === "claudecode-experience") {
    return [
      {
        name: "lifecycle_or_model_mapped",
        ok: Boolean(descriptor.serviceId) || descriptor.omniSurface === "lsp",
        detail: "TUI/desktop/web use managed services; LSP maps to omni workspace diagnostics.",
      },
      {
        name: "operator_surface_available",
        ok: Boolean(descriptor.serviceId) || descriptor.omniSurface === "lsp" || descriptor.omniSurface === "workbench",
        detail: "The capability is available through omni-agent reference_service, workbench, or LSP diagnostics surfaces.",
      },
      {
        name: "native_contract_entrypoint",
        ok: true,
        detail: "reference_integration exposes list/contract/invoke/plan evidence for the user-facing product capability.",
      },
    ];
  }
  if (descriptor.category === "hermes-tool") {
    return [
      {
        name: "process_boundary",
        ok: descriptor.boundary?.isolation === "process",
        detail: "Hermes Python tools run outside the TypeScript runtime.",
      },
      {
        name: "process_tool_invocation",
        ok: descriptor.status === "adapter-ready",
        detail: "The Hermes tool is callable through a sanitized process adapter from omni-agent.",
      },
      {
        name: "tool_contract_suite",
        ok: true,
        detail: "reference_integration contract supports descriptor checks and optional Python compile checks.",
      },
    ];
  }
  if (descriptor.category === "openclaw-plugin") {
    return [
      {
        name: "manifest_schema",
        ok: descriptor.protocol === "openclaw.plugin",
        detail: "OpenClaw plugin manifest is normalized into omni-agent descriptor schema.",
      },
      {
        name: "reference_plugin_runtime_available",
        ok: descriptor.protocol === "openclaw.plugin",
        detail: "The OpenClaw plugin is available through normalized descriptor schema and the managed OpenClaw reference gateway.",
      },
      {
        name: "omni_channel_contract_surface",
        ok: true,
        detail: "omni-agent has native channel plugin lifecycle contracts and reference_integration provides manifest-level contract evidence.",
      },
    ];
  }
  return [
    {
      name: "discoverable_module",
      ok: Boolean(descriptor.path),
      detail: "Large reference module is discoverable through reference_project/reference_integration.",
    },
    {
      name: "reference_project_access",
      ok: true,
      detail: "Large module can be inspected, searched, invoked through known entrypoints, and planned through omni-agent reference tools.",
    },
  ];
}

function buildReferenceNativeRewriteGates(
  descriptor: ReferenceIntegrationDescriptor,
): Array<{ readonly name: string; readonly ok: boolean; readonly detail: string }> {
  if (descriptor.category === "claudecode-experience") {
    return [
      {
        name: "source_native_adapter_materialized",
        ok: true,
        detail:
          "This ClaudeCode experience has a generated TypeScript native adapter source entry in packages/reference-native.",
      },
    ];
  }
  if (descriptor.category === "hermes-tool") {
    return [
      {
        name: "source_native_adapter_materialized",
        ok: true,
        detail:
          "This Hermes tool has a generated TypeScript native adapter source entry that routes through omni-agent process isolation.",
      },
    ];
  }
  if (descriptor.category === "openclaw-plugin") {
    return [
      {
        name: "source_native_adapter_materialized",
        ok: true,
        detail:
          "This OpenClaw plugin has a generated TypeScript native adapter source entry that normalizes manifest/schema and routes through omni-agent gateway surfaces.",
      },
    ];
  }
  return [
    {
      name: "source_native_adapter_materialized",
      ok: true,
      detail:
        "This large module has a generated TypeScript native adapter source entry that exposes its callable boundary through omni-agent reference tools.",
    },
  ];
}

function buildReferenceFusionEvidence(descriptor: ReferenceIntegrationDescriptor): Record<string, unknown> {
  return {
    descriptorId: descriptor.id,
    sourcePath: descriptor.path,
    serviceId: descriptor.serviceId ?? null,
    protocol: descriptor.protocol ?? null,
    recommendedChecks: [
      { tool: "reference_integration", args: { action: "contract", id: descriptor.id } },
      ...(descriptor.status === "service-ready" || descriptor.status === "adapter-ready"
        ? [{ tool: "reference_integration", args: { action: "invoke", id: descriptor.id } }]
        : []),
      { tool: "reference_integration", args: { action: "plan", id: descriptor.id } },
    ],
  };
}

function countReferenceFusionEntries(
  entries: readonly (Record<string, unknown> & { readonly [key: string]: unknown })[],
  key: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const value = String(entry[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function selectReferenceIntegration(
  descriptors: readonly ReferenceIntegrationDescriptor[],
  id: string,
): ReferenceIntegrationDescriptor {
  const selected = descriptors.find((descriptor) => descriptor.id === id);
  if (!selected) {
    throw new Error(`No reference integration descriptor found for id=${id}.`);
  }
  return selected;
}

function normalizeReferenceServiceAction(value: unknown): "logs" | "start" | "status" | "stop" {
  const normalized = String(value ?? "start").trim().toLowerCase();
  if (normalized === "start" || normalized === "status" || normalized === "logs" || normalized === "stop") {
    return normalized;
  }
  throw new Error(`Unsupported reference integration serviceAction: ${String(value)}`);
}

async function resolveReferenceIntegrationProject(
  workspaceRoot: string,
  descriptor: ReferenceIntegrationDescriptor,
): Promise<ReferenceProjectView> {
  const projectName = descriptor.id.split(":")[1];
  const projects = await resolveReferenceProjectViews(workspaceRoot, descriptor.source);
  return selectReferenceProject(projects, projectName, descriptor.source);
}

function resolveReferenceIntegrationPath(project: ReferenceProjectView, descriptor: ReferenceIntegrationDescriptor): string | null {
  if (!descriptor.path) {
    return null;
  }
  const absolutePath = resolve(project.root, descriptor.path);
  const relativePath = relative(project.root, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Reference integration path escapes project root: ${descriptor.path}`);
  }
  return absolutePath;
}

async function checkReferenceIntegrationContract(
  context: ToolExecutionContext,
  descriptor: ReferenceIntegrationDescriptor,
  options: { readonly runChecks: boolean; readonly timeoutMs: number },
): Promise<Record<string, unknown> & { readonly ok: boolean }> {
  const project = await resolveReferenceIntegrationProject(context.workspace.root, descriptor);
  const absolutePath = resolveReferenceIntegrationPath(project, descriptor);
  const checks: Array<{ readonly name: string; readonly ok: boolean; readonly detail: string }> = [
    {
      name: "project_synced",
      ok: await pathIsDirectory(project.root),
      detail: project.workspacePath,
    },
  ];
  if (absolutePath) {
    checks.push({
      name: "descriptor_path_exists",
      ok: await pathExists(absolutePath),
      detail: descriptor.path ?? "",
    });
  }
  if (descriptor.serviceId) {
    const services = await listReferenceServices(context.workspace.root, { source: descriptor.source, query: descriptor.serviceId });
    checks.push({
      name: "service_registered",
      ok: services.some((service) => service.id === descriptor.serviceId),
      detail: descriptor.serviceId,
    });
  }
  if (descriptor.category === "hermes-tool" && descriptor.path?.endsWith(".py")) {
    checks.push({
      name: "process_isolated_tool",
      ok: descriptor.boundary?.isolation === "process",
      detail: "Hermes tools are run out-of-process through reference_integration.invoke.",
    });
    if (options.runChecks) {
      const command = `python -m py_compile ${quoteReferenceShellArgument(descriptor.path)}`;
      assertSafeCommand(command);
      const result = await context.workspace.runCommand(command, {
        cwd: project.workspacePath,
        timeoutMs: options.timeoutMs,
        abortSignal: context.abortSignal,
      });
      checks.push({
        name: "python_compile",
        ok: result.ok,
        detail: result.ok ? "py_compile passed" : result.stderr || result.stdout || "py_compile failed",
      });
    }
  }
  if (descriptor.category === "openclaw-plugin") {
    checks.push({
      name: "plugin_schema_normalized",
      ok: descriptor.protocol === "openclaw.plugin" && Boolean(descriptor.metadata),
      detail: descriptor.protocol ?? "missing protocol",
    });
  }
  if (descriptor.category === "large-module") {
    checks.push({
      name: "native_rewrite_boundary_declared",
      ok: descriptor.boundary?.directCopy === false,
      detail: "large modules must be adapterized before native rewrite",
    });
  }
  return {
    id: descriptor.id,
    source: descriptor.source,
    category: descriptor.category,
    status: descriptor.status,
    ok: checks.every((check) => check.ok),
    checks,
  };
}

async function invokeReferenceIntegration(
  context: ToolExecutionContext,
  descriptor: ReferenceIntegrationDescriptor,
  options: { readonly args: readonly string[]; readonly serviceAction: "logs" | "start" | "status" | "stop"; readonly timeoutMs: number },
): Promise<ToolResult> {
  const project = await resolveReferenceIntegrationProject(context.workspace.root, descriptor);
  if (descriptor.serviceId) {
    return registerBuiltInReferenceServiceInvocation(context, descriptor, options);
  }
  if (descriptor.category === "hermes-tool") {
    if (!descriptor.path?.endsWith(".py")) {
      throw new Error(`Hermes integration ${descriptor.id} does not point to a Python tool file.`);
    }
    const absolutePath = resolveReferenceIntegrationPath(project, descriptor);
    if (!absolutePath || !(await pathExists(absolutePath))) {
      throw new Error(`Hermes integration path is missing: ${descriptor.path}`);
    }
    const command = [`python ${quoteReferenceShellArgument(descriptor.path)}`, ...options.args.map(quoteReferenceShellArgument)].join(" ");
    assertSafeCommand(command);
    const result = await context.workspace.runCommand(command, {
      cwd: project.workspacePath,
      timeoutMs: options.timeoutMs,
      abortSignal: context.abortSignal,
    });
    return {
      ok: result.ok,
      summary: `${result.ok ? "Invoked" : "Failed"} Hermes process-tool integration ${descriptor.id}.`,
      data: {
        descriptor,
        command,
        result,
      },
      artifactPaths: result.artifactPath ? [result.artifactPath] : [],
    };
  }
  if (descriptor.category === "openclaw-plugin") {
    return {
      ok: true,
      summary: `Returned normalized OpenClaw plugin integration ${descriptor.id}.`,
      data: {
        descriptor,
        manifest: descriptor.metadata ?? {},
        contract: await checkReferenceIntegrationContract(context, descriptor, { runChecks: false, timeoutMs: options.timeoutMs }),
      },
    };
  }
  if (descriptor.category === "large-module" || descriptor.category === "claudecode-experience") {
    const absolutePath = resolveReferenceIntegrationPath(project, descriptor);
    const files =
      absolutePath && (await pathIsDirectory(absolutePath))
        ? (await walkReferenceFiles(absolutePath, () => true, 2)).slice(0, 50).map((entry) => relative(project.root, entry).replace(/\\/g, "/"))
        : absolutePath && (await pathExists(absolutePath))
          ? [descriptor.path]
          : [];
    return {
      ok: true,
      summary: `Resolved reference integration ${descriptor.id} for native adapter work.`,
      data: {
        descriptor,
        project,
        files,
        plan: buildReferenceNativeMigrationPlan(descriptor),
      },
    };
  }
  throw new Error(`Reference integration ${descriptor.id} cannot be invoked.`);
}

async function registerBuiltInReferenceServiceInvocation(
  context: ToolExecutionContext,
  descriptor: ReferenceIntegrationDescriptor,
  options: { readonly args: readonly string[]; readonly serviceAction: "logs" | "start" | "status" | "stop"; readonly timeoutMs: number },
): Promise<ToolResult> {
  const services = await listReferenceServices(context.workspace.root, { source: descriptor.source, query: descriptor.serviceId });
  const service = selectReferenceService(services, descriptor.serviceId ?? "");
  if (options.serviceAction === "start") {
    const existingRuntime = referenceServiceRuntime.get(service.id);
    if (existingRuntime) {
      const existingProcess = managedProcesses.get(existingRuntime.processId);
      if (existingProcess?.status === "running") {
        return {
          ok: true,
          summary: `Reference service ${service.id} is already running.`,
          data: describeReferenceServiceRuntime(service, existingProcess),
        };
      }
    }
    const command = [service.command, ...options.args.map(quoteReferenceShellArgument)].join(" ");
    assertSafeCommand(command);
    const process = startManagedProcess(
      command,
      resolve(context.workspace.root, service.cwd),
      await resolveManagedProcessWorkspaceRoot(context),
    );
    referenceServiceRuntime.set(service.id, {
      serviceId: service.id,
      processId: process.id,
      startedAt: process.startedAt,
    });
    await waitForReferenceServiceWarmup(Math.min(options.timeoutMs, 5_000));
    return {
      ok: true,
      summary: `Started reference service integration ${descriptor.id}.`,
      data: describeReferenceServiceRuntime(service, process),
    };
  }
  const runtime = referenceServiceRuntime.get(service.id);
  const process = runtime ? managedProcesses.get(runtime.processId) ?? null : null;
  if (options.serviceAction === "status" || options.serviceAction === "logs") {
    return {
      ok: true,
      summary: process ? `Read reference service integration ${descriptor.id}.` : `Reference service integration ${descriptor.id} is not running.`,
      data: process ? describeReferenceServiceRuntime(service, process) : { service: describeReferenceService(service), runtime: null },
    };
  }
  if (process) {
    await stopManagedProcess(process);
  }
  referenceServiceRuntime.delete(service.id);
  return {
    ok: true,
    summary: `Stopped reference service integration ${descriptor.id}.`,
    data: process ? describeReferenceServiceRuntime(service, process) : { service: describeReferenceService(service), runtime: null },
  };
}

function buildReferenceNativeMigrationPlan(descriptor: ReferenceIntegrationDescriptor): Record<string, unknown> {
  const shared = {
    id: descriptor.id,
    source: descriptor.source,
    category: descriptor.category,
    status: descriptor.status,
    sourcePath: descriptor.path,
  };
  if (descriptor.category === "claudecode-experience") {
    return {
      ...shared,
      targetSurface: descriptor.omniSurface,
      steps: [
        "Keep the reference entrypoint under reference_service for lifecycle management.",
        "Map events, logs, approvals, diff state, and diagnostics into omni-agent session-store records.",
        "Render the mapped records through CLI/workbench components instead of copying the reference UI tree.",
        "Add contract tests for start/status/stop and UI-state serialization.",
      ],
    };
  }
  if (descriptor.category === "hermes-tool") {
    return {
      ...shared,
      targetSurface: "process-tool",
      steps: [
        "Keep the Python tool isolated behind reference_integration.invoke.",
        "Declare filesystem, network, and secret requirements from descriptor.boundary.",
        "Wrap stable JSON/stdout contracts before exposing the tool to agent prompts.",
        "Promote to a TypeScript native tool only after contract and failure tests pass.",
      ],
    };
  }
  if (descriptor.category === "openclaw-plugin") {
    return {
      ...shared,
      targetSurface: descriptor.omniSurface,
      steps: [
        "Use the normalized openclaw.plugin descriptor as the source of truth.",
        "Map configSchema, auth modes, and secret refs into omni-agent gateway configuration.",
        "Implement install/configure/pair/receive/send/ack/retry/health/shutdown contract tests.",
        "Add opt-in live tests only after mock contract coverage is stable.",
      ],
    };
  }
  return {
    ...shared,
    targetSurface: descriptor.omniSurface,
    steps: [
      "Keep the module discoverable through reference_integration and reference_project.",
      "Identify the smallest callable boundary before copying or rewriting code.",
      "Add a descriptor contract test, then implement a dedicated adapter.",
      "Promote the descriptor from descriptor-ready to adapter-ready after the adapter is tested.",
    ],
  };
}

function normalizeReferenceAdapterArgs(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("reference_adapter args must be an array of strings.");
  }
  return value.map((entry, index) => {
    const arg = String(entry);
    if (arg.length > 500 || /[|;&<>`$]/.test(arg)) {
      throw new Error(`reference_adapter args[${index}] contains unsupported shell characters.`);
    }
    return arg;
  });
}

function quoteReferenceShellArgument(value: string): string {
  return JSON.stringify(value);
}

async function findReferenceBaseDir(workspaceRoot: string): Promise<string | null> {
  let current = resolve(workspaceRoot);
  for (let depth = 0; depth < 8; depth += 1) {
    const hasReferenceRoot = await Promise.all([
      pathIsDirectory(join(current, "hermes-agent-main")),
      pathIsDirectory(join(current, "openclaw-main")),
      pathIsDirectory(join(current, "claudecode-source")),
    ]);
    if (hasReferenceRoot.some(Boolean)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

async function scanReferenceSkills(root: ReferenceRoot, includeContent: boolean, maxChars: number): Promise<ReferenceCapability[]> {
  const skillFiles = await walkReferenceFiles(root.root, (entryPath) => basename(entryPath) === "SKILL.md", 8);
  const capabilities: ReferenceCapability[] = [];
  for (const skillFile of skillFiles) {
    const rawContent = await readFile(skillFile, "utf8");
    const metadata = parseReferenceSkillMetadata(rawContent, dirname(skillFile));
    capabilities.push(
      buildReferenceCapability(root, {
        type: "skill",
        path: skillFile,
        title: metadata.title,
        description: metadata.description,
        category: metadata.category,
        importable: true,
        content: includeContent ? truncateReferenceContent(rawContent, maxChars) : undefined,
      }),
    );
  }
  return capabilities;
}

async function scanReferenceModules(root: ReferenceRoot): Promise<ReferenceCapability[]> {
  const capabilities: ReferenceCapability[] = [];
  const seen = new Set<string>();
  for (const modulePath of REFERENCE_MODULE_PATHS[root.source]) {
    const absolutePath = join(root.root, modulePath);
    if (seen.has(absolutePath) || !(await pathExists(absolutePath))) {
      continue;
    }
    seen.add(absolutePath);
    capabilities.push(
      buildReferenceCapability(root, {
        type: "module",
        path: absolutePath,
        title: basenameWithoutExtension(modulePath),
        description: describeReferenceModule(root.source, modulePath),
        category: modulePath.split(/[\\/]/)[0] ?? null,
        importable: false,
      }),
    );
  }
  return capabilities;
}

async function scanReferencePlugins(root: ReferenceRoot): Promise<ReferenceCapability[]> {
  if (root.source !== "openclaw") {
    return [];
  }
  const pluginFiles = await walkReferenceFiles(join(root.root, "extensions"), (entryPath) => basename(entryPath) === "openclaw.plugin.json", 4);
  const plugins: ReferenceCapability[] = [];
  for (const pluginFile of pluginFiles) {
    let title = basename(dirname(pluginFile));
    let description: string | null = "OpenClaw extension plugin manifest.";
    try {
      const manifest = JSON.parse(await readFile(pluginFile, "utf8")) as { name?: unknown; description?: unknown };
      title = typeof manifest.name === "string" && manifest.name.trim() ? manifest.name.trim() : title;
      description = typeof manifest.description === "string" && manifest.description.trim() ? manifest.description.trim() : description;
    } catch {
      // Keep the filesystem-derived metadata if a third-party manifest is malformed.
    }
    plugins.push(
      buildReferenceCapability(root, {
        type: "plugin",
        path: pluginFile,
        title,
        description,
        category: "extensions",
        importable: false,
      }),
    );
  }
  return plugins;
}

function buildReferenceCapability(
  root: ReferenceRoot,
  input: {
    readonly type: ReferenceCapabilityType;
    readonly path: string;
    readonly title: string;
    readonly description: string | null;
    readonly category: string | null;
    readonly importable: boolean;
    readonly content?: string;
  },
): ReferenceCapability {
  const relativePath = relative(root.baseDir, input.path).replace(/\\/g, "/");
  return {
    id: `${root.source}:${input.type}:${relativePath}`,
    source: root.source,
    type: input.type,
    title: input.title,
    description: input.description,
    category: input.category,
    path: input.path,
    relativePath,
    importable: input.importable,
    ...(input.content === undefined ? {} : { content: input.content }),
  };
}

async function importReferenceSkill(
  context: ToolExecutionContext,
  capability: ReferenceCapability,
  targetCategory?: string,
  preserveReferencePath = false,
): Promise<{ readonly targetDirectory: string; readonly importedFiles: readonly string[] }> {
  const sourceDirectory = dirname(capability.path);
  const slug = sanitizeReferencePathSegment(basename(sourceDirectory) || capability.title);
  const category = targetCategory ? sanitizeReferencePathSegment(targetCategory) : "";
  const preservedSegments = preserveReferencePath
    ? dirname(capability.relativePath)
        .split("/")
        .map((segment) => sanitizeReferencePathSegment(segment))
        .filter(Boolean)
    : [];
  const targetDirectory =
    preserveReferencePath && preservedSegments.length > 0
      ? join(".agents", "skills", "imported", capability.source, ...preservedSegments)
      : category
        ? join(".agents", "skills", "imported", capability.source, category, slug)
        : join(".agents", "skills", "imported", capability.source, slug);
  const sourceFiles = await walkReferenceFiles(sourceDirectory, () => true, 6);
  const importedFiles: string[] = [];
  for (const sourceFile of sourceFiles) {
    const fileStats = await stat(sourceFile);
    if (!fileStats.isFile() || fileStats.size > 512 * 1024) {
      continue;
    }
    const relativeSource = relative(sourceDirectory, sourceFile);
    if (relativeSource.split(/[\\/]/).some((segment) => REFERENCE_EXCLUDED_DIRS.has(segment))) {
      continue;
    }
    const content = await readFile(sourceFile, "utf8");
    if (content.includes("\u0000")) {
      continue;
    }
    const targetPath = join(targetDirectory, relativeSource);
    const result = await context.workspace.writeFile(targetPath, content);
    importedFiles.push(result.path.replace(/\\/g, "/"));
  }
  return {
    targetDirectory: targetDirectory.replace(/\\/g, "/"),
    importedFiles,
  };
}

function parseReferenceSkillMetadata(content: string, skillDirectory: string): {
  readonly title: string;
  readonly description: string | null;
  readonly category: string | null;
} {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
  const name = matchReferenceFrontmatterValue(frontmatter, "name");
  const description = matchReferenceFrontmatterValue(frontmatter, "description");
  const heading = /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
  return {
    title: name ?? heading ?? basename(skillDirectory),
    description,
    category: basename(dirname(skillDirectory)) || null,
  };
}

function matchReferenceFrontmatterValue(frontmatter: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escapedKey}:\\s*["']?([^"'\r\n]+)["']?\\s*$`, "im").exec(frontmatter);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

function describeReferenceModule(source: ReferenceSource, modulePath: string): string {
  const normalized = modulePath.replace(/\\/g, "/");
  const descriptions: Record<string, string> = {
    "agent/context_compressor.py": "Hermes context compression implementation for long-running agent trajectories.",
    "tools/mcp_tool.py": "Hermes MCP bridge tool implementation.",
    "tools/browser_tool.py": "Hermes browser automation tool implementation.",
    "tools/delegate_tool.py": "Hermes delegation tool implementation.",
    "src/acp": "OpenClaw ACP protocol and adapter layer.",
    "src/mcp": "OpenClaw MCP server and tool integration layer.",
    "src/security": "OpenClaw security and trust-boundary controls.",
    "src/memory": "OpenClaw memory subsystem.",
    "src/tools": "Claude Code style tool implementations.",
    "src/context": "Claude Code style context construction and management.",
    "src/coordinator": "Claude Code style agent coordination layer.",
  };
  return descriptions[normalized] ?? `${source} reference module: ${normalized}`;
}

async function walkReferenceFiles(
  root: string,
  predicate: (entryPath: string) => boolean,
  maxDepth: number,
): Promise<string[]> {
  if (!(await pathIsDirectory(root))) {
    return [];
  }
  const results: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (REFERENCE_EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath, depth + 1);
      } else if (entry.isFile() && predicate(entryPath)) {
        results.push(entryPath);
      }
    }
  }
  await visit(root, 0);
  return results;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function pathIsDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function sanitizeReferencePathSegment(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "skill";
}

function truncateReferenceContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n...[truncated]`;
}

function clampPositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function normalizeStructuredPlanItems(value: unknown): StructuredPlanItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("update_plan requires a non-empty items array.");
  }
  const items = value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`update_plan.items[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const step = String(record.step ?? "").trim();
    if (!step) {
      throw new Error(`update_plan.items[${index}] requires a non-empty step.`);
    }
    const status = normalizePlanItemStatus(record.status);
    return {
      id: typeof record.id === "string" && record.id.trim().length > 0 ? record.id.trim() : `item-${index + 1}`,
      step,
      status,
      note: typeof record.note === "string" && record.note.trim().length > 0 ? record.note.trim() : undefined,
    };
  });
  const inProgressCount = items.filter((item) => item.status === "in_progress").length;
  if (inProgressCount > 1) {
    throw new Error("update_plan allows at most one item with status=in_progress.");
  }
  return items;
}

function normalizePlanItemStatus(value: unknown): PlanItemStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "pending" || normalized === "in_progress" || normalized === "completed" || normalized === "blocked") {
    return normalized;
  }
  return "pending";
}

function buildStructuredPlanState(
  context: ToolExecutionContext,
  items: readonly StructuredPlanItem[],
  summary: string | null,
): StructuredPlanState {
  return {
    summary,
    items: [...items],
    updatedAt: new Date().toISOString(),
    workspaceId: context.workspaceId,
    threadId: context.threadId,
    runId: context.runId,
  };
}

function getStructuredPlanKey(context: ToolExecutionContext): string {
  return [context.workspaceId ?? "workspace", context.threadId ?? "thread", context.runId ?? "run"].join(":");
}

function getStructuredPlanStatePath(context: ToolExecutionContext): string {
  const suffix = context.runId ?? context.threadId ?? context.workspaceId ?? "workspace";
  return join(context.workspace.artifactsRoot, `plan-state-${suffix}.json`);
}

async function writeStructuredPlanArtifact(
  context: ToolExecutionContext,
  plan: StructuredPlanState,
): Promise<string | null> {
  try {
    await context.workspace.ensureReady();
    const statePath = getStructuredPlanStatePath(context);
    await writeFile(statePath, JSON.stringify(plan, null, 2), "utf8");
    return await context.workspace.writeArtifact("task-plan", formatStructuredPlanMarkdown(plan), ".md");
  } catch {
    return null;
  }
}

async function loadStructuredPlanState(context: ToolExecutionContext): Promise<StructuredPlanState> {
  const stored = structuredPlanStore.get(getStructuredPlanKey(context));
  if (stored) {
    return stored;
  }
  try {
    const raw = await readFile(getStructuredPlanStatePath(context), "utf8");
    const parsed = JSON.parse(raw) as StructuredPlanState;
    structuredPlanStore.set(getStructuredPlanKey(context), parsed);
    return parsed;
  } catch {
    return buildStructuredPlanState(context, [], null);
  }
}

function formatStructuredPlanMarkdown(plan: StructuredPlanState): string {
  const lines = [
    "# Structured Plan",
    "",
    plan.summary ? `Summary: ${plan.summary}` : "Summary: none",
    `Updated: ${plan.updatedAt}`,
    "",
  ];
  if (plan.items.length === 0) {
    lines.push("No items recorded.");
    return lines.join("\n");
  }
  for (const item of plan.items) {
    lines.push(`- [${item.status}] ${item.step}`);
    if (item.note) {
      lines.push(`  note: ${item.note}`);
    }
  }
  return lines.join("\n");
}

function rankToolSpecs(
  specs: readonly ToolSpec[],
  query: string,
): Array<ToolSpec & { readonly matchScore: number }> {
  const normalizedQuery = query.trim().toLowerCase();
  const scored = specs.map((spec) => ({
    ...spec,
    matchScore: scoreSearchAgainstFields(
      normalizedQuery,
      [spec.name, spec.description, spec.inputHint, spec.riskHint].map((entry) => entry.toLowerCase()),
    ),
  }));
  if (!normalizedQuery) {
    return scored.sort((left, right) => left.name.localeCompare(right.name));
  }
  return scored
    .filter((entry) => entry.matchScore > 0)
    .sort((left, right) => (right.matchScore !== left.matchScore ? right.matchScore - left.matchScore : left.name.localeCompare(right.name)));
}

function rankAgentRoleContracts(
  contracts: readonly AgentRoleContract[],
  query: string,
  currentAllowedTools: readonly string[],
): Array<AgentRoleContract & { readonly matchScore: number }> {
  const normalizedQuery = query.trim().toLowerCase();
  const scored = contracts.map((contract) => ({
    ...contract,
    guidance: [...contract.guidance],
    responseInstructions: [...contract.responseInstructions],
    defaultAllowedTools: contract.defaultAllowedTools ? [...contract.defaultAllowedTools] : undefined,
    matchScore: scoreSearchAgainstFields(
      normalizedQuery,
      [
        contract.role,
        contract.defaultAuthority,
        contract.responseKind,
        ...contract.guidance,
        ...contract.responseInstructions,
        ...(contract.defaultAllowedTools ?? []),
      ].map((entry) => entry.toLowerCase()),
    ) + (currentAllowedTools.some((toolName) => (contract.defaultAllowedTools ?? []).includes(toolName)) ? 1 : 0),
  }));
  if (!normalizedQuery) {
    return scored.sort((left, right) => left.role.localeCompare(right.role));
  }
  return scored
    .filter((entry) => entry.matchScore > 0)
    .sort((left, right) => (right.matchScore !== left.matchScore ? right.matchScore - left.matchScore : left.role.localeCompare(right.role)));
}

function scoreSearchAgainstFields(query: string, fields: readonly string[]): number {
  if (!query) {
    return 0;
  }
  let score = 0;
  for (const token of tokenizeSearchQuery(query)) {
    for (const field of fields) {
      if (field === token) {
        score += 10;
      } else if (field.startsWith(token)) {
        score += 6;
      } else if (field.includes(token)) {
        score += 3;
      }
    }
  }
  return score;
}

function tokenizeSearchQuery(value: string): string[] {
  return Array.from(new Set(value.split(/[^a-z0-9]+/i).map((entry) => entry.trim().toLowerCase()).filter(Boolean)));
}

interface PostEditValidationResult {
  readonly checked: boolean;
  readonly ok: boolean;
  readonly kind: "json" | "node-syntax" | "skipped";
  readonly summary: string;
  readonly command?: string;
  readonly stdout?: string;
  readonly stderr?: string;
}

function selectRunArtifact(
  sessionStore: SqliteSessionStore,
  runId: string,
  artifactId: string | undefined,
  requestedPath: string | undefined,
): { readonly artifact: ArtifactRecord; readonly usedFallback: boolean } {
  const artifactsRoot = resolve(sessionStore.artifactsRoot);
  const runArtifacts = sessionStore.listRunArtifacts(runId);
  if (runArtifacts.length === 0) {
    throw new Error(`No artifacts are recorded for run ${runId}.`);
  }
  const selected = runArtifacts.find((artifact) => {
    if (artifactId && artifact.id === artifactId) {
      return true;
    }
    if (!requestedPath) {
      return false;
    }
    const requested = resolve(requestedPath);
    return resolve(artifact.path) === requested || basename(artifact.path) === requestedPath || artifact.path.endsWith(requestedPath);
  });
  if ((artifactId || requestedPath) && !selected) {
    throw new Error(`Artifact is not recorded for run ${runId}.`);
  }
  const artifact = selected ?? runArtifacts[runArtifacts.length - 1]!;
  const artifactPath = resolve(artifact.path);
  const artifactRelativePath = relative(artifactsRoot, artifactPath);
  if (artifactRelativePath.startsWith("..") || isAbsolute(artifactRelativePath)) {
    throw new Error(`Artifact ${artifact.id} is outside the session artifact root.`);
  }
  return {
    artifact,
    usedFallback: !selected,
  };
}

function isBinaryArtifactRecord(artifact: ArtifactRecord): boolean {
  const kind = artifact.kind.toLowerCase();
  const path = artifact.path.toLowerCase();
  return kind === "browser_screenshot" || kind === "browser-screenshot" || path.endsWith(".png");
}

async function writeBrowserScreenshotArtifact(
  context: ToolExecutionContext,
  session: Awaited<ReturnType<typeof screenshotBrowserSession>>,
): Promise<{
  readonly artifactId: string | null;
  readonly kind: "browser-screenshot";
  readonly path: string;
  readonly summary: string;
  readonly mimeType: "image/png";
  readonly sizeBytes: number;
}> {
  const buffer = Buffer.from(session.screenshot.dataBase64, "base64");
  if (buffer.length === 0) {
    throw new Error("browser_screenshot received empty image data.");
  }
  const summary = `Browser screenshot for session ${session.id} at ${session.lastSnapshot.url}.`;
  if (context.sessionStore && context.runId) {
    const runDir = join(context.sessionStore.artifactsRoot, "runs", sanitizeArtifactPathSegment(context.runId));
    await mkdir(runDir, { recursive: true });
    const path = join(runDir, `${randomUUID()}.png`);
    await writeFile(path, buffer);
    return {
      artifactId: null,
      kind: "browser-screenshot",
      path,
      summary,
      mimeType: session.screenshot.mimeType,
      sizeBytes: buffer.length,
    };
  }

  const browserArtifactDir = join(context.workspace.artifactsRoot, "browser");
  await mkdir(browserArtifactDir, { recursive: true });
  const path = join(browserArtifactDir, `${Date.now()}-browser-screenshot-${randomUUID()}.png`);
  await writeFile(path, buffer);
  return {
    artifactId: null,
    kind: "browser-screenshot",
    path,
    summary,
    mimeType: session.screenshot.mimeType,
    sizeBytes: buffer.length,
  };
}

function sanitizeArtifactPathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "run";
}

async function validateEditedSourceFile(context: ToolExecutionContext, path: string): Promise<PostEditValidationResult> {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".json")) {
    try {
      const content = await context.workspace.readFile(path);
      JSON.parse(content);
      return {
        checked: true,
        ok: true,
        kind: "json",
        summary: "JSON parse check passed.",
      };
    } catch (error) {
      return {
        checked: true,
        ok: false,
        kind: "json",
        summary: `JSON parse check failed: ${formatValidationError(error)}`,
      };
    }
  }

  if (lowerPath.endsWith(".js") || lowerPath.endsWith(".mjs") || lowerPath.endsWith(".cjs")) {
    const command = `node --check ${JSON.stringify(path)}`;
    const result = await context.workspace.runCommand(command, {
      timeoutMs: 20_000,
      captureArtifact: false,
      abortSignal: context.abortSignal,
    });
    const output = trimValidationOutput(result.stderr || result.stdout || "Node syntax check failed.");
    return {
      checked: true,
      ok: result.ok,
      kind: "node-syntax",
      summary: result.ok ? "Node syntax check passed." : `Node syntax check failed: ${output}`,
      command: result.command,
      stdout: trimValidationOutput(result.stdout),
      stderr: trimValidationOutput(result.stderr),
    };
  }

  return {
    checked: false,
    ok: true,
    kind: "skipped",
    summary: "No post-edit structure validator configured for this file type.",
  };
}

function formatPostEditSummary(baseSummary: string, validation: PostEditValidationResult): string {
  if (!validation.checked) {
    return baseSummary;
  }
  return validation.ok
    ? `${baseSummary} ${validation.summary}`
    : `${baseSummary} Post-edit structure validation failed: ${validation.summary}`;
}

function formatValidationError(error: unknown): string {
  return trimValidationOutput(error instanceof Error ? error.message : String(error));
}

function trimValidationOutput(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 700 ? `${compact.slice(0, 700)}...` : compact;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => String(entry).trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeTodoTaskStatus(value: unknown): TodoTaskStatus {
  return normalizePlanItemStatus(value);
}

function normalizeOptionalTodoTaskStatus(value: unknown): TodoTaskStatus | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return normalizeTodoTaskStatus(normalized);
}

function normalizeTodoTaskPriority(value: unknown): TodoTaskPriority {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

const MANAGED_PROCESS_LOG_MAX_CHARS = 24_000;

function trimProcessOutput(value: string, maxChars = MANAGED_PROCESS_LOG_MAX_CHARS): { content: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { content: value, truncated: false };
  }
  return { content: value.slice(-maxChars), truncated: true };
}

function appendManagedProcessOutput(
  record: ManagedProcessRecord,
  stream: "stderr" | "stdout",
  chunk: unknown,
): void {
  const trimmed = trimProcessOutput(record[stream] + String(chunk));
  record[stream] = trimmed.content;
  if (stream === "stdout") {
    record.stdoutTruncated = record.stdoutTruncated || trimmed.truncated;
    return;
  }
  record.stderrTruncated = record.stderrTruncated || trimmed.truncated;
}

async function resolveManagedProcessWorkspaceRoot(context: ToolExecutionContext): Promise<string> {
  return realpath(resolve(context.workspace.getRoot()));
}

async function resolveManagedProcessCwd(
  context: ToolExecutionContext,
  value: unknown,
  realWorkspaceRoot: string,
): Promise<string> {
  const workspaceRoot = resolve(context.workspace.getRoot());
  const requested = normalizeOptionalString(value) ?? ".";
  const resolvedCwd = isAbsolute(requested) ? resolve(requested) : resolve(workspaceRoot, requested);
  assertManagedProcessCwdInsideWorkspace(workspaceRoot, resolvedCwd, requested);

  const cwdStat = await stat(resolvedCwd);
  if (!cwdStat.isDirectory()) {
    throw new Error(`process_start cwd must be a directory inside the workspace: ${requested}`);
  }

  const realCwd = await realpath(resolvedCwd);
  assertManagedProcessCwdInsideWorkspace(realWorkspaceRoot, realCwd, requested);
  return resolvedCwd;
}

function assertManagedProcessCwdInsideWorkspace(workspaceRoot: string, cwd: string, requested: string): void {
  const relativeCwd = relative(workspaceRoot, cwd);
  if (relativeCwd.startsWith("..") || isAbsolute(relativeCwd)) {
    throw new Error(`process_start cwd must stay inside the workspace: ${requested}`);
  }
}

function normalizeManagedProcessId(args: Record<string, unknown>): string {
  const processId =
    normalizeOptionalString(args.processId) ??
    normalizeOptionalString(args.process_id) ??
    normalizeOptionalString(args.id);
  if (!processId) {
    throw new Error("Managed process tool requires a processId.");
  }
  return processId;
}

function getManagedProcess(processId: string): ManagedProcessRecord {
  const record = managedProcesses.get(processId);
  if (!record) {
    throw new Error(`Process ${processId} was not found.`);
  }
  return record;
}

async function getManagedProcessForContext(
  context: ToolExecutionContext,
  processId: string,
): Promise<ManagedProcessRecord> {
  const record = getManagedProcess(processId);
  const workspaceRoot = await resolveManagedProcessWorkspaceRoot(context);
  if (record.ownerWorkspaceRoot !== workspaceRoot) {
    throw new Error(`Process ${processId} is not owned by this workspace.`);
  }
  return record;
}

function bindManagedProcessAbortSignal(record: ManagedProcessRecord, abortSignal: AbortSignal | undefined): boolean {
  if (!abortSignal) {
    return true;
  }
  const cleanup = () => {
    abortSignal.removeEventListener("abort", onAbort);
  };
  const onAbort = () => {
    cleanup();
    void stopManagedProcess(record);
  };
  record.abortCleanup = cleanup;
  if (abortSignal.aborted) {
    onAbort();
    return false;
  }
  abortSignal.addEventListener("abort", onAbort, { once: true });
  return true;
}

function pruneManagedProcessRecords(): void {
  if (managedProcesses.size <= MANAGED_PROCESS_MAX_RECORDS) {
    return;
  }
  const removable = Array.from(managedProcesses.values())
    .filter((record) => record.status !== "running")
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  for (const record of removable) {
    if (managedProcesses.size <= MANAGED_PROCESS_MAX_RECORDS) {
      return;
    }
    managedProcesses.delete(record.id);
  }
}

function describeManagedProcess(
  record: ManagedProcessRecord,
  options: { readonly maxChars?: number } = {},
): Record<string, unknown> {
  const stdout = options.maxChars === undefined
    ? { content: record.stdout, truncated: false }
    : trimProcessOutput(record.stdout, options.maxChars);
  const stderr = options.maxChars === undefined
    ? { content: record.stderr, truncated: false }
    : trimProcessOutput(record.stderr, options.maxChars);
  return {
    id: record.id,
    command: record.command,
    cwd: record.cwd,
    startedAt: record.startedAt,
    status: record.status,
    exitCode: record.exitCode,
    stdout: stdout.content,
    stderr: stderr.content,
    stdoutTruncated: record.stdoutTruncated || stdout.truncated,
    stderrTruncated: record.stderrTruncated || stderr.truncated,
  };
}

function describeManagedProcessRegistry(): Record<string, unknown> {
  return {
    persistence: "in_memory",
    scope: "runtime_process",
    restoredAfterRuntimeRestart: false,
    restartRecovery: "not_restored",
    operatorAction: "Restart long-running commands after runtime restart; stop orphaned OS processes manually when needed.",
  };
}

function normalizeTodoWriteTasks(
  value: unknown,
  existingTasks: readonly TodoTaskRecord[],
): TodoTaskRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("todo_write requires a non-empty todos array.");
  }
  const existingTasksById = new Map(existingTasks.map((task) => [task.id, task]));
  const seenIds = new Set<string>();
  const now = new Date().toISOString();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`todo_write.todos[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const id = normalizeOptionalString(record.id) ?? randomUUID();
    if (seenIds.has(id)) {
      throw new Error(`todo_write.todos[${index}] reuses duplicate id ${id}.`);
    }
    seenIds.add(id);
    const current = existingTasksById.get(id);
    const title =
      normalizeOptionalString(record.title) ??
      normalizeOptionalString(record.content) ??
      current?.title;
    if (!title) {
      throw new Error(`todo_write.todos[${index}] requires a non-empty title or content.`);
    }
    const status = normalizeTodoTaskStatus(record.status ?? current?.status);
    return {
      id,
      title,
      status,
      priority:
        record.priority === undefined ? current?.priority ?? "medium" : normalizeTodoTaskPriority(record.priority),
      labels: record.labels === undefined ? current?.labels ?? [] : normalizeStringList(record.labels),
      note:
        normalizeOptionalString(record.note) ??
        normalizeOptionalString(record.activeForm) ??
        current?.note,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      completedAt: status === "completed" ? current?.completedAt ?? now : undefined,
    };
  });
}

function getTodoTaskBoardKey(context: ToolExecutionContext): string {
  return [context.workspaceId ?? "workspace", context.threadId ?? "thread"].join(":");
}

function getTodoTaskBoardStatePath(context: ToolExecutionContext): string {
  const suffix = sanitizeTodoTaskBoardPathSegment(getTodoTaskBoardKey(context));
  return join(context.workspace.artifactsRoot, "state", `task-board-${suffix}.json`);
}

function sanitizeTodoTaskBoardPathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace-thread";
}

function buildTodoTaskBoardState(
  context: ToolExecutionContext,
  tasks: readonly TodoTaskRecord[],
): TodoTaskBoardState {
  const nextBoard: TodoTaskBoardState = {
    tasks: [...tasks].sort((left, right) => {
      if (left.status !== right.status) {
        return left.status.localeCompare(right.status);
      }
      return left.createdAt.localeCompare(right.createdAt);
    }),
    updatedAt: new Date().toISOString(),
    workspaceId: context.workspaceId,
    threadId: context.threadId,
  };
  todoTaskBoardStore.set(getTodoTaskBoardKey(context), nextBoard);
  return nextBoard;
}

async function loadTodoTaskBoardState(context: ToolExecutionContext): Promise<TodoTaskBoardState> {
  const key = getTodoTaskBoardKey(context);
  const stored = todoTaskBoardStore.get(key);
  if (stored) {
    return stored;
  }
  try {
    const raw = await readFile(getTodoTaskBoardStatePath(context), "utf8");
    const parsed = JSON.parse(raw) as TodoTaskBoardState;
    todoTaskBoardStore.set(key, parsed);
    return parsed;
  } catch {
    return {
      tasks: [],
      updatedAt: new Date().toISOString(),
      workspaceId: context.workspaceId,
      threadId: context.threadId,
    };
  }
}

async function hasTodoTaskBoardState(context: ToolExecutionContext): Promise<boolean> {
  if (todoTaskBoardStore.has(getTodoTaskBoardKey(context))) {
    return true;
  }
  try {
    await stat(getTodoTaskBoardStatePath(context));
    return true;
  } catch {
    return false;
  }
}

async function writeTodoTaskBoardArtifact(
  context: ToolExecutionContext,
  board: TodoTaskBoardState,
): Promise<string | null> {
  try {
    await context.workspace.ensureReady();
    const statePath = getTodoTaskBoardStatePath(context);
    await mkdir(join(context.workspace.artifactsRoot, "state"), { recursive: true });
    await writeFile(statePath, JSON.stringify(board, null, 2), "utf8");
    return await context.workspace.writeArtifact("task-board", formatTodoTaskBoardMarkdown(board), ".md");
  } catch {
    return null;
  }
}

function formatTodoTaskBoardMarkdown(board: TodoTaskBoardState): string {
  const lines = [
    "# Task Board",
    "",
    `Updated: ${board.updatedAt}`,
    "",
  ];
  if (board.tasks.length === 0) {
    lines.push("No tasks recorded.");
    return lines.join("\n");
  }
  for (const task of board.tasks) {
    lines.push(`- [${task.status}] ${task.title} (${task.priority})`);
    if (task.labels.length > 0) {
      lines.push(`  labels: ${task.labels.join(", ")}`);
    }
    if (task.note) {
      lines.push(`  note: ${task.note.replace(/\r?\n/g, " / ")}`);
    }
  }
  return lines.join("\n");
}

export async function collectTodoTaskBoardHandoff(
  context: ToolExecutionContext,
  options: { readonly limit?: number } = {},
): Promise<TodoTaskBoardHandoff> {
  try {
    const limit = Math.max(1, Math.trunc(options.limit ?? 6));
    const observed = await hasTodoTaskBoardState(context);
    if (!observed) {
      return { observed: false, pendingItems: [] };
    }
    const board = await loadTodoTaskBoardState(context);
    const pendingItems = board.tasks
      .filter((task) => task.status !== "completed")
      .slice(0, limit)
      .map((task) => {
        const labels = task.labels.length > 0 ? ` labels=${task.labels.join(",")}` : "";
        return `Task board [${task.status}/${task.priority}]: ${task.title}${labels}`;
      });
    return { observed: true, pendingItems };
  } catch {
    return { observed: false, pendingItems: [] };
  }
}

function normalizeAutomationScheduleKind(value: unknown): AutomationScheduleKind {
  const normalized = String(value ?? "").trim().toLowerCase();
  switch (normalized) {
    case "at":
    case "cron":
    case "event":
    case "heartbeat":
    case "maintenance":
    case "manual":
      return normalized;
    default:
      return "interval";
  }
}

function normalizeAutomationStatus(value: unknown): "active" | "paused" | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "active" || normalized === "paused") {
    return normalized;
  }
  return undefined;
}

function normalizeTransactionalPatchOperations(value: unknown): TransactionalPatchOperation[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("apply_transactional_patch requires a non-empty operations array.");
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`apply_transactional_patch.operations[${index}] must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const rawType = String(record.type ?? record.action ?? "").trim().toLowerCase();
    const type = rawType === "replace_text" ? "replace" : rawType === "line_range" ? "range" : rawType;
    const path = String(record.path ?? record.filePath ?? record.file_path ?? "").trim();
    if (!path) {
      throw new Error(`apply_transactional_patch.operations[${index}] requires a non-empty path.`);
    }
    const expectedHash = normalizeOptionalString(record.expectedHash ?? record.expected_hash);
    const expectedOldText = normalizeOptionalString(record.expectedOldText ?? record.expected_old_text);
    if (type === "write") {
      if (record.content === undefined) {
        throw new Error(`apply_transactional_patch.operations[${index}] write requires content.`);
      }
      return {
        type,
        path,
        content: String(record.content),
        expectedHash,
        expectedOldText,
      };
    }
    if (type === "replace") {
      const oldText = String(record.oldText ?? record.old_text ?? "");
      if (!oldText) {
        throw new Error(`apply_transactional_patch.operations[${index}] replace requires non-empty oldText.`);
      }
      return {
        type,
        path,
        oldText,
        newText: String(record.newText ?? record.new_text ?? ""),
        expectedHash,
        expectedOldText,
      };
    }
    if (type === "range") {
      return {
        type,
        path,
        startLine: Number(record.startLine ?? record.start_line ?? 1),
        endLine: Number(record.endLine ?? record.end_line ?? record.startLine ?? record.start_line ?? 1),
        newText: String(record.newText ?? record.new_text ?? ""),
        expectedHash,
        expectedOldText,
      };
    }
    throw new Error(`apply_transactional_patch.operations[${index}] uses unsupported type "${rawType}".`);
  });
}

async function executeBuiltInWebSearch(
  args: Record<string, unknown>,
  surface: "browser" | "web",
): Promise<ToolResult> {
  const query = String(args.query ?? args.q ?? "").trim();
  if (!query) {
    throw new Error(`${surface}_search requires a non-empty query.`);
  }

  const count = clampBuiltInWebSearchCount(args.count ?? args.limit ?? 5);
  const timeoutMs = clampPositiveInteger(args.timeoutMs, 20_000);
  const domainFilter = normalizeBuiltInWebSearchDomainFilter(args.domainFilter ?? args.domain_filter);
  const freshness = normalizeBuiltInWebSearchFreshness(args.freshness);
  const request = buildBuiltInWebSearchRequest({
    query,
    count,
    domainFilter,
    freshness,
  });
  const response = await fetch(request.url, {
    headers: request.headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = response.headers.get("content-type") ?? "text/html; charset=utf-8";
  const rawBody = await response.text();
  const results = /json/i.test(contentType)
    ? extractBuiltInWebSearchResultsFromJson(parseBuiltInWebSearchJson(rawBody), count)
    : extractBuiltInWebSearchResultsFromHtml(rawBody, request.url, count);
  const label = surface === "browser" ? "browser result" : "web result";

  return {
    ok: response.ok,
    summary: response.ok
      ? results.length > 0
        ? `Found ${results.length} ${label}(s) for "${query}".`
        : `No ${label}s found for "${query}".`
      : `${surface === "browser" ? "Browser" : "Web"} search for "${query}" failed with status ${response.status}.`,
    data: {
      provider: request.provider,
      query,
      resolvedQuery: request.resolvedQuery,
      status: response.status,
      results,
    },
    warnings: request.warnings,
  };
}

async function executeBuiltInWebFetch(
  args: Record<string, unknown>,
  surface: "browser" | "web",
): Promise<ToolResult> {
  const rawUrl = String(args.url ?? "").trim();
  if (!rawUrl) {
    throw new Error(`${surface}_fetch requires a non-empty url.`);
  }

  const parsedUrl = new URL(rawUrl);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`${surface}_fetch only supports http and https URLs.`);
  }

  const maxChars = clampPositiveInteger(args.maxChars, 8_000);
  const timeoutMs = clampPositiveInteger(args.timeoutMs, 20_000);
  const response = await fetch(parsedUrl, {
    headers: {
      "user-agent": "omni-agent/0.1",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const rawBody = isTextualContentType(contentType) ? await response.text() : "";
  const formatted = formatFetchedContent(rawBody, contentType, maxChars);
  const summaryVerb = surface === "browser" ? "Opened" : "Fetched";

  return {
    ok: response.ok,
    summary: response.ok
      ? `${summaryVerb} ${parsedUrl.toString()} (${response.status}).`
      : `${summaryVerb} ${parsedUrl.toString()} failed with status ${response.status}.`,
    data: {
      url: parsedUrl.toString(),
      status: response.status,
      contentType,
      content: formatted.content,
      truncated: formatted.truncated,
      bodyOmitted: !isTextualContentType(contentType),
    },
  };
}

async function executeNativeBrowserWorkflow(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!Array.isArray(args.steps) || args.steps.length === 0) {
    throw new Error("browser_run requires a non-empty steps array.");
  }
  const request = {
    url: normalizeOptionalString(args.url),
    sessionId: normalizeOptionalString(args.sessionId),
    headless: args.headless === undefined ? true : normalizeBoolean(args.headless),
    timeoutMs: clampPositiveInteger(args.timeoutMs, 60_000),
    steps: args.steps.map((entry, index) => normalizeBrowserWorkflowStep(entry, index)),
  };

  let sessionId = request.sessionId ?? null;
  let lastSnapshot:
    | {
        readonly title: string;
        readonly url: string;
        readonly text: string;
        readonly elements: readonly {
          readonly elementId: string;
          readonly tag: string;
          readonly text: string;
          readonly selector: string;
          readonly type?: string;
          readonly href?: string;
          readonly value?: string;
        }[];
        readonly loadedAt: string;
      }
    | null = null;
  let closed = false;
  let observations: readonly BrowserObservation[] = [];
  const stepResults: Array<Record<string, unknown>> = [];

  const ensureSession = async (fallbackUrl?: string): Promise<string> => {
    if (sessionId) {
      return sessionId;
    }
    const url = fallbackUrl ?? request.url;
    if (!url) {
      throw new Error("browser_run requires either sessionId or a url before browser actions can execute.");
    }
    const session = await openBrowserSession({
      url,
      headless: request.headless,
      timeoutMs: request.timeoutMs,
    });
    sessionId = session.id;
    lastSnapshot = session.lastSnapshot;
    observations = session.observations;
    closed = false;
    return sessionId;
  };

  for (let index = 0; index < request.steps.length; index += 1) {
    const step = request.steps[index];
    if (step.action === "open" || step.action === "navigate") {
      if (sessionId) {
        await closeBrowserSession(sessionId);
      }
      const url = step.url ?? request.url;
      if (!url) {
        throw new Error(`browser_run.steps[${index}] requires a url for action=${step.action}.`);
      }
      const session = await openBrowserSession({
        url,
        headless: request.headless,
        timeoutMs: step.timeoutMs ?? request.timeoutMs,
      });
      sessionId = session.id;
      lastSnapshot = session.lastSnapshot;
      observations = session.observations;
      closed = false;
      stepResults.push({
        action: step.action,
        name: step.name ?? null,
        sessionId,
        url: lastSnapshot.url,
        title: lastSnapshot.title,
      });
      continue;
    }

    if (step.action === "snapshot") {
      const activeSessionId = await ensureSession();
      const session = await snapshotBrowserSession({
        sessionId: activeSessionId,
        maxChars: step.maxChars,
      });
      lastSnapshot = session.lastSnapshot;
      observations = session.observations;
      stepResults.push({
        action: step.action,
        name: step.name ?? null,
        sessionId: activeSessionId,
        url: lastSnapshot.url,
        title: lastSnapshot.title,
      });
      continue;
    }

    if (step.action === "click") {
      const activeSessionId = await ensureSession();
      const session = await clickBrowserSession({
        sessionId: activeSessionId,
        selector: step.selector,
        elementId: step.elementId,
        waitForLoad: step.waitForLoad,
      });
      lastSnapshot = session.lastSnapshot;
      observations = session.observations;
      stepResults.push({
        action: step.action,
        name: step.name ?? null,
        sessionId: activeSessionId,
        selector: step.selector ?? null,
        elementId: step.elementId ?? null,
        url: lastSnapshot.url,
        title: lastSnapshot.title,
      });
      continue;
    }

    if (step.action === "type" || step.action === "fill" || step.action === "input") {
      const activeSessionId = await ensureSession();
      const text = step.text ?? step.value;
      if (!text) {
        throw new Error(`browser_run.steps[${index}] requires text or value for action=${step.action}.`);
      }
      const session = await typeIntoBrowserSession({
        sessionId: activeSessionId,
        selector: step.selector,
        elementId: step.elementId,
        text,
        submit: step.submit,
      });
      lastSnapshot = session.lastSnapshot;
      observations = session.observations;
      stepResults.push({
        action: step.action,
        name: step.name ?? null,
        sessionId: activeSessionId,
        selector: step.selector ?? null,
        elementId: step.elementId ?? null,
        submitted: Boolean(step.submit),
        url: lastSnapshot.url,
        title: lastSnapshot.title,
      });
      continue;
    }

    if (step.action === "close") {
      const activeSessionId = await ensureSession();
      await closeBrowserSession(activeSessionId);
      observations = [];
      stepResults.push({
        action: step.action,
        name: step.name ?? null,
        sessionId: activeSessionId,
        closed: true,
      });
      sessionId = null;
      lastSnapshot = null;
      closed = true;
      continue;
    }

    throw new Error(`browser_run.steps[${index}] uses unsupported action "${step.action}".`);
  }

  return {
    ok: true,
    summary: `Browser workflow completed with ${stepResults.length} step(s).`,
    data: {
      sessionId,
      closed,
      title: lastSnapshot?.title ?? null,
      url: lastSnapshot?.url ?? request.url ?? null,
      text: lastSnapshot?.text ?? null,
      elements: lastSnapshot?.elements ?? [],
      lastSnapshot,
      observations,
      diagnostics: observations,
      steps: stepResults,
    },
  };
}

function normalizeBrowserWorkflowStep(
  value: unknown,
  index: number,
): {
  readonly action: string;
  readonly url?: string;
  readonly selector?: string;
  readonly elementId?: string;
  readonly text?: string;
  readonly value?: string;
  readonly name?: string;
  readonly submit?: boolean;
  readonly waitForLoad?: boolean;
  readonly maxChars?: number;
  readonly timeoutMs?: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`browser_run.steps[${index}] must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const action = String(record.action ?? "").trim().toLowerCase();
  if (!action) {
    throw new Error(`browser_run.steps[${index}] requires a non-empty action.`);
  }
  const timeoutMs = record.timeoutMs === undefined ? undefined : clampPositiveInteger(record.timeoutMs, 10_000);
  const maxChars = record.maxChars === undefined ? undefined : clampPositiveInteger(record.maxChars, 4_000);
  return {
    action,
    url: normalizeOptionalString(record.url),
    selector: normalizeOptionalString(record.selector),
    elementId: normalizeOptionalString(record.elementId),
    text: normalizeOptionalString(record.text),
    value: normalizeOptionalString(record.value),
    name: normalizeOptionalString(record.name),
    submit: record.submit === undefined ? undefined : normalizeBoolean(record.submit),
    waitForLoad: record.waitForLoad === undefined ? undefined : normalizeBoolean(record.waitForLoad),
    maxChars,
    timeoutMs,
  };
}

function isTextualContentType(contentType: string): boolean {
  return /^text\//i.test(contentType) || /(json|xml|javascript|svg)/i.test(contentType);
}

function formatFetchedContent(
  rawBody: string,
  contentType: string,
  maxChars: number,
): { content: string; truncated: boolean } {
  const normalized = /html/i.test(contentType) ? htmlToText(rawBody) : rawBody.trim();
  if (normalized.length <= maxChars) {
    return {
      content: normalized,
      truncated: false,
    };
  }
  return {
    content: `${normalized.slice(0, Math.max(0, maxChars - 15))}\n...[truncated]`,
    truncated: true,
  };
}

function htmlToText(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|section|article|main|header|footer|li|ul|ol|table|tr|td|th|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeMemoryPersistenceBackend(value: unknown): MemoryPersistenceBackend {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "both" || normalized === "file" || normalized === "store") {
    return normalized;
  }
  return "store";
}

function normalizeMemorySearchBackend(value: unknown): MemorySearchBackend {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "both" || normalized === "file" || normalized === "store") {
    return normalized;
  }
  return "both";
}

function normalizeWorkspaceMemoryFileKind(
  value: unknown,
  scope: "thread" | "workspace",
): WorkspaceMemoryFileKind {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "daily" || normalized === "memory" || normalized === "user") {
    return normalized;
  }
  return scope === "thread" ? "daily" : "memory";
}

function selectWorkspaceMemoryKinds(
  scope: "thread" | "workspace" | undefined,
): readonly WorkspaceMemoryFileKind[] | undefined {
  if (scope === "thread") {
    return ["daily"];
  }
  if (scope === "workspace") {
    return ["memory", "user"];
  }
  return undefined;
}

function formatMemoryFileEntry(content: string, tags: string[]): string {
  const lines = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const timestamp = new Date().toISOString();
  const tagSuffix = tags.length > 0 ? ` (tags: ${tags.join(", ")})` : "";
  if (lines.length === 0) {
    return `- [${timestamp}]${tagSuffix}`;
  }
  return [
    `- [${timestamp}] ${lines[0]}${tagSuffix}`,
    ...lines.slice(1).map((line) => `  ${line}`),
  ].join("\n");
}
