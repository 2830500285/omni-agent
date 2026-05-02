import { spawn, spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { ContextEngineDescriptor, ContextEngineFactory } from "@omni-agent/context";
import type { ToolDefinition, ToolResult } from "@omni-agent/tools";

export type ExtensionCapability = "bridge" | "gateway" | "mcp" | "prompt-hook" | "tool";

export interface ExtensionMemoryProviderToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
}

export interface MemoryProvider {
  readonly id: string;
  getToolDefinitions?(): readonly ExtensionMemoryProviderToolDefinition[];
  initialize?(context: any): any;
  shutdown?(): any;
  queuePrefetch?(context: any): any;
  prefetch?(context: any): any;
  onTurnStart?(context: any): any;
  syncTurn?(context: any): any;
  onPreCompress?(context: any): any;
  onSessionEnd?(context: any): any;
  onDelegation?(context: any): any;
}

export interface ExtensionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly capability: ExtensionCapability;
  readonly description: string;
  readonly sourcePath?: string;
  readonly toolNames: string[];
  readonly resourceCount: number;
  readonly promptTemplateCount: number;
  readonly promptHookCount: number;
  readonly toolHookCount: number;
}

export interface ExtensionResourceDescriptor {
  readonly extensionId: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
  readonly sourcePath?: string;
}

export interface ExtensionResourceContent extends ExtensionResourceDescriptor {
  readonly content: string;
}

export interface PromptTemplateArgumentDefinition {
  readonly name: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly defaultValue?: string;
}

export interface ExtensionPromptTemplateDescriptor {
  readonly extensionId: string;
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly PromptTemplateArgumentDefinition[];
  readonly sourcePath?: string;
}

export interface ExtensionPromptMessage {
  readonly role: "assistant" | "user";
  readonly contentType: "audio" | "image" | "resource" | "text";
  readonly text: string;
}

export interface RenderedExtensionPrompt extends ExtensionPromptTemplateDescriptor {
  readonly content: string;
  readonly messages: readonly ExtensionPromptMessage[];
}

export interface FixedCommandToolManifest {
  readonly name: string;
  readonly description: string;
  readonly inputHint?: string;
  readonly riskHint?: string;
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly successExitCodes?: number[];
}

export interface ExtensionToolPolicy {
  readonly toolName: string;
  readonly allowInSubagents?: boolean;
  readonly allowedRoles?: readonly string[];
  readonly deniedRoles?: readonly string[];
  readonly allowedAuthorities?: readonly string[];
}

export interface LocalExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly capability?: ExtensionCapability;
  readonly description: string;
  readonly tools?: FixedCommandToolManifest[];
  readonly bridge?: BridgeManifest;
  readonly mcp?: McpServerManifest;
  readonly resources?: readonly LocalExtensionResourceManifest[];
  readonly prompts?: readonly LocalExtensionPromptTemplateManifest[];
  readonly toolHooks?: LocalExtensionToolHooksManifest;
  readonly toolPolicies?: readonly ExtensionToolPolicy[];
}

export interface ExtensionPackageJsonContract {
  readonly name?: string;
  readonly version?: string;
  readonly omniAgent?: {
    readonly compat?: {
      readonly pluginApi?: string;
    };
    readonly build?: {
      readonly omniAgentVersion?: string;
    };
  };
}

export interface ExtensionPackageContractIssue {
  readonly sourcePath: string;
  readonly severity: "error" | "warning";
  readonly reason: string;
}

export interface ExtensionPackageContractReport {
  readonly sourcePath: string;
  readonly packageName: string | null;
  readonly packageVersion: string | null;
  readonly pluginApi: string | null;
  readonly pluginApiCompatible: boolean | null;
  readonly currentPluginApi: string;
  readonly omniAgentVersion: string | null;
  readonly ok: boolean;
  readonly issues: readonly ExtensionPackageContractIssue[];
}

export interface ExtensionContextEngineDefinition {
  readonly descriptor: ContextEngineDescriptor;
  readonly create: ContextEngineFactory;
}

export interface ExtensionContextEngineDescriptor extends ContextEngineDescriptor {
  readonly extensionId: string;
  readonly sourcePath?: string;
}

const CURRENT_PLUGIN_API_VERSION = "1.0.0";

export interface ExtensionMemoryProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly create: () => MemoryProvider;
}

export interface ExtensionMemoryProviderDescriptor {
  readonly extensionId: string;
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly sourcePath?: string;
}

export interface McpStdioServerManifest {
  readonly transport?: "stdio";
  readonly command: string;
  readonly args?: string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly auth?: McpAuthManifest;
  readonly allowlist?: McpAllowlistManifest;
  readonly timeoutMs?: number;
}

export interface McpHttpServerManifest {
  readonly transport: "http" | "sse";
  readonly url: string;
  readonly headers?: Record<string, string>;
  readonly auth?: McpAuthManifest;
  readonly allowlist?: McpAllowlistManifest;
  readonly timeoutMs?: number;
}

export type McpServerManifest = McpHttpServerManifest | McpStdioServerManifest;

export interface McpOAuthAuthManifest {
  readonly type: "oauth";
  readonly tokenEnv?: string;
  readonly scopes?: readonly string[];
}

export type McpAuthManifest = McpOAuthAuthManifest;

export interface McpAllowlistManifest {
  readonly tools?: readonly string[];
  readonly resources?: readonly string[];
}

export interface McpServerLayer {
  readonly source: string;
  readonly servers: Readonly<Record<string, McpServerManifest>>;
}

export interface McpGovernanceIssue {
  readonly serverId: string;
  readonly source?: string;
  readonly severity: "error" | "warning";
  readonly reason: string;
}

export interface McpGovernanceReport {
  readonly generatedAt: string;
  readonly serverCount: number;
  readonly ok: boolean;
  readonly mergedServers: Readonly<Record<string, McpServerManifest>>;
  readonly issues: readonly McpGovernanceIssue[];
}

export interface McpGovernanceOptions {
  readonly allowUnauthenticatedRemote?: boolean;
  readonly allowedRemoteHosts?: readonly string[];
  readonly deniedRemoteHosts?: readonly string[];
}

export function buildMcpGovernanceReport(
  layers: readonly McpServerLayer[],
  options: McpGovernanceOptions = {},
): McpGovernanceReport {
  const mergedServers: Record<string, McpServerManifest> = {};
  const sources = new Map<string, string>();
  const issues: McpGovernanceIssue[] = [];
  for (const layer of layers) {
    for (const [serverId, manifest] of Object.entries(layer.servers)) {
      const normalizedId = serverId.trim();
      if (!normalizedId) {
        issues.push({
          serverId: serverId || "(empty)",
          source: layer.source,
          severity: "error",
          reason: "MCP server ids must be non-empty.",
        });
        continue;
      }
      mergedServers[normalizedId] = mergeMcpServerManifest(mergedServers[normalizedId], manifest);
      sources.set(normalizedId, layer.source);
    }
  }
  for (const [serverId, manifest] of Object.entries(mergedServers)) {
    issues.push(...validateMcpServerManifest(serverId, manifest, sources.get(serverId), options));
  }
  return {
    generatedAt: new Date().toISOString(),
    serverCount: Object.keys(mergedServers).length,
    ok: !issues.some((issue) => issue.severity === "error"),
    mergedServers,
    issues,
  };
}

export function mergeMcpServerManifest(
  base: McpServerManifest | undefined,
  override: McpServerManifest,
): McpServerManifest {
  if (!base || (override.transport ?? "stdio") !== (base.transport ?? "stdio")) {
    return { ...override } as McpServerManifest;
  }
  if ((override.transport ?? "stdio") === "stdio") {
    const baseStdio = base as McpStdioServerManifest;
    const overrideStdio = override as McpStdioServerManifest;
    return {
      ...baseStdio,
      ...overrideStdio,
      args: overrideStdio.args ?? baseStdio.args,
      env: { ...(baseStdio.env ?? {}), ...(overrideStdio.env ?? {}) },
      ...((overrideStdio.auth ?? baseStdio.auth) ? { auth: overrideStdio.auth ?? baseStdio.auth } : {}),
      ...(mergeMcpAllowlist(baseStdio.allowlist, overrideStdio.allowlist)
        ? { allowlist: mergeMcpAllowlist(baseStdio.allowlist, overrideStdio.allowlist) }
        : {}),
    };
  }
  const baseHttp = base as McpHttpServerManifest;
  const overrideHttp = override as McpHttpServerManifest;
  return {
    ...baseHttp,
    ...overrideHttp,
    headers: { ...(baseHttp.headers ?? {}), ...(overrideHttp.headers ?? {}) },
    ...((overrideHttp.auth ?? baseHttp.auth) ? { auth: overrideHttp.auth ?? baseHttp.auth } : {}),
    ...(mergeMcpAllowlist(baseHttp.allowlist, overrideHttp.allowlist)
      ? { allowlist: mergeMcpAllowlist(baseHttp.allowlist, overrideHttp.allowlist) }
      : {}),
  };
}

function mergeMcpAllowlist(
  base: McpAllowlistManifest | undefined,
  override: McpAllowlistManifest | undefined,
): McpAllowlistManifest | undefined {
  if (!base) {
    return override;
  }
  if (!override) {
    return base;
  }
  return {
    tools: override.tools ?? base.tools,
    resources: override.resources ?? base.resources,
  };
}

export function validateMcpServerManifest(
  serverId: string,
  manifest: McpServerManifest,
  source?: string,
  options: McpGovernanceOptions = {},
): McpGovernanceIssue[] {
  const issues: McpGovernanceIssue[] = [];
  const addIssue = (severity: McpGovernanceIssue["severity"], reason: string): void => {
    issues.push({ serverId, source, severity, reason });
  };
  const transport = manifest.transport ?? "stdio";

  if (transport === "stdio") {
    const stdio = manifest as McpStdioServerManifest;
    if (!stdio.command.trim()) {
      addIssue("error", "stdio MCP servers must define a command.");
    }
    for (const [key, value] of Object.entries(stdio.env ?? {})) {
      if (looksLikeInlineSecret(key, value)) {
        addIssue("warning", `Environment variable ${key} looks like an inline secret; prefer an environment reference.`);
      }
    }
    return issues;
  }

  const remote = manifest as McpHttpServerManifest;
  let url: URL;
  try {
    url = new URL(remote.url);
  } catch {
    addIssue("error", "Remote MCP server URL must be a valid URL.");
    return issues;
  }

  if (options.deniedRemoteHosts?.includes(url.hostname)) {
    addIssue("error", `Remote MCP host ${url.hostname} is denied by policy.`);
  }
  if (options.allowedRemoteHosts && !options.allowedRemoteHosts.includes(url.hostname)) {
    addIssue("error", `Remote MCP host ${url.hostname} is not in the allowed host policy.`);
  }
  const headers = normalizeHeaderKeys(remote.headers ?? {});
  const hasAuthHeader = headers.has("authorization") || headers.has("x-api-key") || headers.has("api-key");
  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (!isLoopback && !hasAuthHeader && options.allowUnauthenticatedRemote !== true) {
    addIssue("warning", "Remote MCP servers should configure an Authorization or API key header.");
  }
  if (url.protocol !== "https:" && !isLoopback) {
    addIssue("warning", "Remote MCP servers should use HTTPS outside loopback hosts.");
  }
  return issues;
}

export function validateExtensionPackageJson(
  raw: unknown,
  sourcePath = "package.json",
): ExtensionPackageContractReport {
  const issues: ExtensionPackageContractIssue[] = [];
  const addIssue = (severity: ExtensionPackageContractIssue["severity"], reason: string): void => {
    issues.push({ sourcePath, severity, reason });
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    addIssue("error", "Extension package.json must be a JSON object.");
    return {
      sourcePath,
      packageName: null,
      packageVersion: null,
      pluginApi: null,
      pluginApiCompatible: null,
      currentPluginApi: CURRENT_PLUGIN_API_VERSION,
      omniAgentVersion: null,
      ok: false,
      issues,
    };
  }

  const record = raw as Record<string, unknown>;
  const omniAgent = asRecord(record.omniAgent);
  const compat = asRecord(omniAgent?.compat);
  const build = asRecord(omniAgent?.build);
  const packageName = optionalNonEmptyString(record.name) ?? null;
  const packageVersion = optionalNonEmptyString(record.version) ?? null;
  const pluginApi = optionalNonEmptyString(compat?.pluginApi) ?? null;
  const omniAgentVersion = optionalNonEmptyString(build?.omniAgentVersion) ?? null;

  if (!omniAgent) {
    addIssue("warning", "package.json does not declare omniAgent metadata; add omniAgent.compat.pluginApi and omniAgent.build.omniAgentVersion before publishing.");
  }
  if (!pluginApi) {
    addIssue("error", "Missing omniAgent.compat.pluginApi.");
  } else {
    const compatibility = checkPluginApiCompatibility(pluginApi, CURRENT_PLUGIN_API_VERSION);
    if (compatibility === null) {
      addIssue(
        "error",
        `Invalid omniAgent.compat.pluginApi range "${pluginApi}". Use a semver range such as 1.x, ^1.0.0, or >=1.0.0 <2.0.0.`,
      );
    } else if (!compatibility) {
      addIssue("error", `omniAgent.compat.pluginApi "${pluginApi}" does not include current plugin API ${CURRENT_PLUGIN_API_VERSION}.`);
    }
  }
  if (!omniAgentVersion) {
    addIssue("error", "Missing omniAgent.build.omniAgentVersion.");
  }

  return {
    sourcePath,
    packageName,
    packageVersion,
    pluginApi,
    pluginApiCompatible: pluginApi ? checkPluginApiCompatibility(pluginApi, CURRENT_PLUGIN_API_VERSION) : null,
    currentPluginApi: CURRENT_PLUGIN_API_VERSION,
    omniAgentVersion,
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function checkPluginApiCompatibility(range: string, currentVersion: string): boolean | null {
  const current = parseSemver(currentVersion);
  if (!current) {
    return null;
  }
  const normalizedRange = range.trim();
  if (normalizedRange === "*" || normalizedRange.toLowerCase() === "x") {
    return true;
  }
  const alternatives = normalizedRange.split("||").map((entry) => entry.trim()).filter(Boolean);
  if (alternatives.length === 0) {
    return null;
  }
  let sawValidAlternative = false;
  for (const alternative of alternatives) {
    const result = checkPluginApiRangeAlternative(alternative, current);
    if (result === null) {
      continue;
    }
    sawValidAlternative = true;
    if (result) {
      return true;
    }
  }
  return sawValidAlternative ? false : null;
}

function checkPluginApiRangeAlternative(range: string, current: ParsedSemver): boolean | null {
  const wildcard = parseWildcardRange(range);
  if (wildcard) {
    return wildcard(current);
  }
  const prefix = range[0];
  if (prefix === "^" || prefix === "~") {
    const base = parseSemver(range.slice(1));
    if (!base) {
      return null;
    }
    return prefix === "^"
      ? compareSemver(current, base) >= 0 && current.major === base.major
      : compareSemver(current, base) >= 0 && current.major === base.major && current.minor === base.minor;
  }
  const comparatorTokens = range.split(/\s+/).filter(Boolean);
  if (comparatorTokens.length > 1 || /^[<>=]/.test(comparatorTokens[0] ?? "")) {
    let result = true;
    for (const token of comparatorTokens) {
      const comparator = parseComparator(token);
      if (!comparator) {
        return null;
      }
      result = result && comparator(current);
    }
    return result;
  }
  const exact = parseSemver(range);
  if (!exact) {
    return null;
  }
  return compareSemver(current, exact) === 0;
}

function parseWildcardRange(range: string): ((current: ParsedSemver) => boolean) | null {
  const match = /^(\d+|x|\*)\.(\d+|x|\*)(?:\.(\d+|x|\*))?$/i.exec(range);
  if (!match) {
    if (/^\d+$/.test(range)) {
      const major = Number(range);
      return (current) => current.major === major;
    }
    return null;
  }
  const [majorRaw, minorRaw, patchRaw] = match.slice(1);
  if (majorRaw === undefined || majorRaw.toLowerCase() === "x" || majorRaw === "*") {
    return () => true;
  }
  const major = Number(majorRaw);
  if (minorRaw === undefined || minorRaw.toLowerCase() === "x" || minorRaw === "*") {
    return (current) => current.major === major;
  }
  const minor = Number(minorRaw);
  if (patchRaw === undefined || patchRaw.toLowerCase() === "x" || patchRaw === "*") {
    return (current) => current.major === major && current.minor === minor;
  }
  const patch = Number(patchRaw);
  return (current) => current.major === major && current.minor === minor && current.patch === patch;
}

function parseComparator(token: string): ((current: ParsedSemver) => boolean) | null {
  const match = /^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})$/.exec(token);
  if (!match) {
    return null;
  }
  const operator = match[1] ?? "=";
  const version = parseSemver(match[2] ?? "");
  if (!version) {
    return null;
  }
  return (current) => {
    const comparison = compareSemver(current, version);
    switch (operator) {
      case ">":
        return comparison > 0;
      case ">=":
        return comparison >= 0;
      case "<":
        return comparison < 0;
      case "<=":
        return comparison <= 0;
      case "=":
        return comparison === 0;
      default:
        return false;
    }
  };
}

function parseSemver(value: string): ParsedSemver | null {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
  };
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export type McpRuntimeHealthStatus = "auth_required" | "idle" | "starting" | "healthy" | "failed" | "disposed";

export interface McpRuntimeAuthDiagnostics {
  readonly type: "oauth";
  readonly tokenEnv?: string;
  readonly scopes?: readonly string[];
  readonly configured: boolean;
  readonly token?: "[REDACTED]";
}

export interface McpRuntimeHealth {
  readonly key: string;
  readonly extensionId: string;
  readonly transport: "http" | "sse" | "stdio";
  readonly label: string;
  readonly status: McpRuntimeHealthStatus;
  readonly requestCount: number;
  readonly failureCount: number;
  readonly consecutiveFailureCount: number;
  readonly recoveryCount: number;
  readonly lastMethod?: string;
  readonly lastStartedAt?: string;
  readonly lastSucceededAt?: string;
  readonly lastFailedAt?: string;
  readonly lastRecoveredAt?: string;
  readonly lastDurationMs?: number;
  readonly lastError?: string;
  readonly auth?: McpRuntimeAuthDiagnostics;
}

export interface LocalExtensionResourceManifest {
  readonly id: string;
  readonly name?: string;
  readonly description: string;
  readonly mimeType?: string;
  readonly content?: string;
  readonly filePath?: string;
}

export interface LocalExtensionPromptTemplateManifest {
  readonly name: string;
  readonly description: string;
  readonly arguments?: readonly PromptTemplateArgumentDefinition[];
  readonly template: string;
}

export interface BridgeToolManifest {
  readonly name: string;
  readonly description: string;
  readonly inputHint?: string;
  readonly riskHint?: string;
}

export interface StdioBridgeManifest {
  readonly transport?: "stdio";
  readonly command: string;
  readonly args?: string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly timeoutMs?: number;
}

export interface HttpBridgeManifest {
  readonly transport: "http";
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly timeoutMs?: number;
}

export type BridgeManifest = HttpBridgeManifest | StdioBridgeManifest;

export interface PromptHookContext {
  readonly extensionId: string;
  readonly cwd: string;
  readonly objective: string;
  readonly workspaceId: string;
  readonly threadId: string;
}

export type PromptHookResult = null | string | string[] | undefined;
export type PromptHook = (context: PromptHookContext) => Promise<PromptHookResult> | PromptHookResult;

export type ToolLifecycleHookPhase = "pre" | "post" | "stop";
export type ToolLifecycleHookStatus = "blocked" | "failed" | "ok" | "started" | "stopped";

export interface ToolLifecycleHookContext {
  readonly extensionId: string;
  readonly cwd: string;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly abortSignal?: AbortSignal;
  readonly phase: ToolLifecycleHookPhase;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly status: ToolLifecycleHookStatus;
  readonly summary?: string;
  readonly result?: ToolResult;
  readonly riskTier?: number;
  readonly approvalClass?: string;
}

export interface ToolLifecycleHookBlockResult {
  readonly block: true;
  readonly summary: string;
  readonly diagnostics?: readonly string[];
}

export type ToolLifecycleHookResult = null | string | string[] | ToolLifecycleHookBlockResult | undefined;
export type ToolLifecycleHook = (
  context: ToolLifecycleHookContext,
) => Promise<ToolLifecycleHookResult> | ToolLifecycleHookResult;

export interface LocalExtensionToolHooks {
  readonly pre?: readonly ToolLifecycleHook[];
  readonly post?: readonly ToolLifecycleHook[];
  readonly stop?: readonly ToolLifecycleHook[];
}

export interface LocalExtensionToolHookManifest {
  readonly toolName?: string;
  readonly message: string;
}

export interface LocalExtensionToolHooksManifest {
  readonly pre?: readonly LocalExtensionToolHookManifest[];
  readonly post?: readonly LocalExtensionToolHookManifest[];
  readonly stop?: readonly LocalExtensionToolHookManifest[];
}

export interface LocalModuleExtension {
  readonly id: string;
  readonly name: string;
  readonly capability?: ExtensionCapability;
  readonly description: string;
  readonly tools?: readonly ToolDefinition[];
  readonly resources?: readonly LocalExtensionResourceDefinition[];
  readonly promptTemplates?: readonly LocalExtensionPromptTemplateDefinition[];
  readonly promptHooks?: readonly PromptHook[];
  readonly toolHooks?: LocalExtensionToolHooks;
  readonly contextEngines?: readonly ExtensionContextEngineDefinition[];
  readonly memoryProviders?: readonly ExtensionMemoryProviderDefinition[];
  readonly toolPolicies?: readonly ExtensionToolPolicy[];
  readonly dispose?: () => Promise<void> | void;
}

export interface LocalExtensionResourceDefinition {
  readonly id: string;
  readonly name?: string;
  readonly description: string;
  readonly mimeType?: string;
  readonly content?: string;
  readonly load?: () => Promise<string> | string;
}

export interface LocalExtensionPromptTemplateDefinition {
  readonly name: string;
  readonly description: string;
  readonly arguments?: readonly PromptTemplateArgumentDefinition[];
  readonly template?: string;
  readonly render?: (
    args: Record<string, unknown>,
  ) =>
    | Promise<string | { readonly content: string; readonly messages?: readonly ExtensionPromptMessage[] }>
    | string
    | { readonly content: string; readonly messages?: readonly ExtensionPromptMessage[] };
}

export interface LoadExtensionRegistryOptions {
  readonly pluginDirs?: string[];
  readonly cwd?: string;
  readonly mcpRuntimePool?: McpRuntimePool;
}

interface RegisteredExtension {
  readonly descriptor: ExtensionDescriptor;
  readonly tools: ToolDefinition[];
  readonly resources: RegisteredExtensionResource[];
  readonly promptTemplates: RegisteredExtensionPromptTemplate[];
  readonly promptHooks: PromptHook[];
  readonly toolHooks: Required<LocalExtensionToolHooks>;
  readonly contextEngines: RegisteredExtensionContextEngine[];
  readonly memoryProviders: RegisteredExtensionMemoryProvider[];
  readonly toolPolicies: ExtensionToolPolicy[];
}

interface RegisteredExtensionResource {
  readonly descriptor: ExtensionResourceDescriptor;
  load(): Promise<string>;
}

interface RegisteredExtensionPromptTemplate {
  readonly descriptor: ExtensionPromptTemplateDescriptor;
  render(args: Record<string, unknown>): Promise<RenderedExtensionPrompt>;
}

interface RegisteredExtensionContextEngine {
  readonly descriptor: ExtensionContextEngineDescriptor;
  readonly create: ContextEngineFactory;
}

interface RegisteredExtensionMemoryProvider {
  readonly descriptor: ExtensionMemoryProviderDescriptor;
  create(): MemoryProvider;
}

export class McpRuntimePool {
  private readonly runtimes = new Map<string, McpRuntimeHandle>();

  public getOrCreate(extensionId: string, manifest: McpServerManifest): McpRuntimeHandle {
    const key = `${extensionId}::${serializeMcpRuntimeManifest(manifest)}`;
    const existing = this.runtimes.get(key);
    if (existing) {
      return existing;
    }
    const created = createMcpRuntime(extensionId, key, manifest);
    this.runtimes.set(key, created);
    return created;
  }

  public listHealth(): McpRuntimeHealth[] {
    return Array.from(this.runtimes.values())
      .map((runtime) => runtime.getHealth())
      .sort((left, right) => left.extensionId.localeCompare(right.extensionId) || left.key.localeCompare(right.key));
  }

  public async dispose(): Promise<void> {
    const runtimes = Array.from(this.runtimes.values()).reverse();
    this.runtimes.clear();
    for (const runtime of runtimes) {
      await runtime.dispose();
    }
  }
}

export class ExtensionRegistry {
  private readonly extensions = new Map<string, RegisteredExtension>();
  private readonly pluginDirs = new Set<string>();
  private readonly cleanupCallbacks: Array<() => Promise<void> | void> = [];

  public constructor(
    pluginDirs: readonly string[] = [],
    private readonly mcpRuntimePool: McpRuntimePool | null = null,
  ) {
    this.addPluginDirectories(pluginDirs);
  }

  public addPluginDirectories(pluginDirs: readonly string[]): void {
    for (const pluginDir of pluginDirs) {
      const normalized = String(pluginDir).trim();
      if (normalized.length > 0) {
        this.pluginDirs.add(resolve(normalized));
      }
    }
  }

  public register(
    extension: ExtensionDescriptor,
    tools: readonly ToolDefinition[] = [],
    resources: readonly RegisteredExtensionResource[] = [],
    promptTemplates: readonly RegisteredExtensionPromptTemplate[] = [],
    promptHooks: readonly PromptHook[] = [],
    toolHooks: LocalExtensionToolHooks = {},
    contextEngines: readonly RegisteredExtensionContextEngine[] = [],
    memoryProviders: readonly RegisteredExtensionMemoryProvider[] = [],
    toolPolicies: readonly ExtensionToolPolicy[] = [],
  ): void {
    this.extensions.set(extension.id, {
      descriptor: extension,
      tools: [...tools],
      resources: [...resources],
      promptTemplates: [...promptTemplates],
      promptHooks: [...promptHooks],
      toolHooks: normalizeRegisteredToolHooks(toolHooks),
      contextEngines: [...contextEngines],
      memoryProviders: [...memoryProviders],
      toolPolicies: [...toolPolicies],
    });
  }

  public registerCleanup(callback: () => Promise<void> | void): void {
    this.cleanupCallbacks.push(callback);
  }

  public listPluginDirectories(): string[] {
    return Array.from(this.pluginDirs).sort((left, right) => left.localeCompare(right));
  }

  public importFrom(other: ExtensionRegistry): void {
    this.addPluginDirectories(other.listPluginDirectories());
    for (const [extensionId, entry] of other.extensions.entries()) {
      this.extensions.set(extensionId, {
        descriptor: { ...entry.descriptor },
        tools: [...entry.tools],
        resources: [...entry.resources],
        promptTemplates: [...entry.promptTemplates],
        promptHooks: [...entry.promptHooks],
        toolHooks: normalizeRegisteredToolHooks(entry.toolHooks),
        contextEngines: [...entry.contextEngines],
        memoryProviders: [...entry.memoryProviders],
        toolPolicies: [...entry.toolPolicies],
      });
    }
  }

  public clone(): ExtensionRegistry {
    const cloned = new ExtensionRegistry([], this.mcpRuntimePool);
    cloned.importFrom(this);
    return cloned;
  }

  public getMcpRuntimePool(): McpRuntimePool | null {
    return this.mcpRuntimePool;
  }

  public async dispose(): Promise<void> {
    const cleanupCallbacks = this.cleanupCallbacks.splice(0).reverse();
    for (const callback of cleanupCallbacks) {
      await callback();
    }
  }

  public list(): ExtensionDescriptor[] {
    return Array.from(this.extensions.values())
      .map((entry) => entry.descriptor)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public listToolDefinitions(): ToolDefinition[] {
    return Array.from(this.extensions.values())
      .flatMap((entry) => entry.tools)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  public listResources(): ExtensionResourceDescriptor[] {
    return Array.from(this.extensions.values())
      .flatMap((entry) => entry.resources.map((resource) => resource.descriptor))
      .sort((left, right) =>
        left.extensionId === right.extensionId
          ? left.id.localeCompare(right.id)
          : left.extensionId.localeCompare(right.extensionId),
      );
  }

  public async readResource(extensionId: string, resourceId: string): Promise<ExtensionResourceContent | null> {
    const extension = this.extensions.get(extensionId);
    if (!extension) {
      return null;
    }
    const resource = extension.resources.find((entry) => entry.descriptor.id === resourceId);
    if (!resource) {
      return null;
    }
    return {
      ...resource.descriptor,
      content: await resource.load(),
    };
  }

  public listPromptTemplates(): ExtensionPromptTemplateDescriptor[] {
    return Array.from(this.extensions.values())
      .flatMap((entry) => entry.promptTemplates.map((prompt) => prompt.descriptor))
      .sort((left, right) =>
        left.extensionId === right.extensionId
          ? left.name.localeCompare(right.name)
          : left.extensionId.localeCompare(right.extensionId),
      );
  }

  public listMcpRuntimeHealth(): McpRuntimeHealth[] {
    return this.mcpRuntimePool?.listHealth() ?? [];
  }

  public listContextEngines(): ExtensionContextEngineDescriptor[] {
    return Array.from(this.extensions.values())
      .flatMap((entry) => entry.contextEngines.map((engine) => engine.descriptor))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public getContextEngineFactory(engineId: string): ContextEngineFactory | null {
    for (const entry of this.extensions.values()) {
      const matched = entry.contextEngines.find((engine) => engine.descriptor.id === engineId);
      if (matched) {
        return matched.create;
      }
    }
    return null;
  }

  public listMemoryProviders(): ExtensionMemoryProviderDescriptor[] {
    return Array.from(this.extensions.values())
      .flatMap((entry) => entry.memoryProviders.map((provider) => provider.descriptor))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  public createMemoryProviders(ids: readonly string[]): MemoryProvider[] {
    const requested = new Set(ids.map((entry) => entry.trim()).filter(Boolean));
    if (requested.size === 0) {
      return [];
    }
    const created: MemoryProvider[] = [];
    for (const entry of this.extensions.values()) {
      for (const provider of entry.memoryProviders) {
        if (requested.has(provider.descriptor.id)) {
          created.push(provider.create());
        }
      }
    }
    return created;
  }

  public async renderPromptTemplate(
    extensionId: string,
    promptName: string,
    args: Record<string, unknown> = {},
  ): Promise<RenderedExtensionPrompt | null> {
    const extension = this.extensions.get(extensionId);
    if (!extension) {
      return null;
    }
    const prompt = extension.promptTemplates.find((entry) => entry.descriptor.name === promptName);
    if (!prompt) {
      return null;
    }
    return prompt.render(args);
  }

  public async buildPromptInstructions(context: Omit<PromptHookContext, "extensionId">): Promise<string[]> {
    const instructions: string[] = [];

    for (const entry of this.extensions.values()) {
      for (const promptHook of entry.promptHooks) {
        const result = await promptHook({
          ...context,
          extensionId: entry.descriptor.id,
        });
        const lines = Array.isArray(result) ? result : result ? [result] : [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            instructions.push(`[${entry.descriptor.id}] ${trimmed}`);
          }
        }
      }
    }

    return instructions;
  }

  public async runToolLifecycleHooks(
    context: Omit<ToolLifecycleHookContext, "extensionId">,
  ): Promise<{
    readonly diagnostics: Array<{ readonly extensionId: string; readonly message: string }>;
    readonly blocked: { readonly extensionId: string; readonly summary: string } | null;
  }> {
    const diagnostics: Array<{ readonly extensionId: string; readonly message: string }> = [];
    let blocked: { readonly extensionId: string; readonly summary: string } | null = null;

    for (const entry of this.extensions.values()) {
      for (const hook of entry.toolHooks[context.phase]) {
        throwIfToolLifecycleHookAborted(context.abortSignal);
        const result = await runAbortableToolLifecycleHook(() =>
          hook({
            ...context,
            extensionId: entry.descriptor.id,
          }),
        context.abortSignal);
        if (isToolLifecycleHookBlockResult(result)) {
          const summary = result.summary.trim();
          if (summary.length > 0 && context.phase === "pre" && !blocked) {
            blocked = { extensionId: entry.descriptor.id, summary };
          }
          const lines = result.diagnostics ?? [];
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0) {
              diagnostics.push({ extensionId: entry.descriptor.id, message: trimmed });
            }
          }
          continue;
        }
        const lines = Array.isArray(result) ? result : result ? [result] : [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            diagnostics.push({ extensionId: entry.descriptor.id, message: trimmed });
          }
        }
      }
    }

    return { diagnostics, blocked };
  }

  public getToolPolicy(toolName: string): (ExtensionToolPolicy & { readonly extensionId: string }) | null {
    for (const entry of this.extensions.values()) {
      const matched = entry.toolPolicies.find((policy) => policy.toolName === toolName);
      if (matched) {
        return {
          extensionId: entry.descriptor.id,
          ...matched,
        };
      }
    }
    return null;
  }

  public ownsTool(toolName: string): boolean {
    return Array.from(this.extensions.values()).some((entry) => entry.tools.some((tool) => tool.name === toolName));
  }
}

export function createDefaultExtensionRegistry(): ExtensionRegistry {
  return new ExtensionRegistry();
}

function normalizeRegisteredToolHooks(toolHooks: LocalExtensionToolHooks): Required<LocalExtensionToolHooks> {
  return {
    pre: [...(toolHooks.pre ?? [])],
    post: [...(toolHooks.post ?? [])],
    stop: [...(toolHooks.stop ?? [])],
  };
}

function isToolLifecycleHookBlockResult(value: ToolLifecycleHookResult): value is ToolLifecycleHookBlockResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { block?: unknown }).block === true &&
      typeof (value as { summary?: unknown }).summary === "string",
  );
}

async function runAbortableToolLifecycleHook(
  run: () => Promise<ToolLifecycleHookResult> | ToolLifecycleHookResult,
  abortSignal: AbortSignal | undefined,
): Promise<ToolLifecycleHookResult> {
  throwIfToolLifecycleHookAborted(abortSignal);
  if (!abortSignal) {
    return run();
  }
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(createToolLifecycleHookAbortError(abortSignal));
    abortSignal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve().then(run), aborted]);
  } finally {
    if (onAbort) {
      abortSignal.removeEventListener("abort", onAbort);
    }
  }
}

function throwIfToolLifecycleHookAborted(abortSignal: AbortSignal | undefined): void {
  if (!abortSignal?.aborted) {
    return;
  }
  throw createToolLifecycleHookAbortError(abortSignal);
}

function createToolLifecycleHookAbortError(abortSignal: AbortSignal): Error {
  const reason = abortSignal.reason;
  if (reason instanceof Error) {
    return reason;
  }
  return new Error(typeof reason === "string" && reason.trim().length > 0 ? reason : "Tool lifecycle hook aborted.");
}

export function mergeExtensionRegistries(
  baseRegistry: ExtensionRegistry,
  overlayRegistry: ExtensionRegistry,
): ExtensionRegistry {
  const merged = baseRegistry.clone();
  merged.importFrom(overlayRegistry);
  return merged;
}

export function createExtensionRuntimeTools(registry: ExtensionRegistry): ToolDefinition[] {
  const maxMcpResourceContentChars = 12_000;
  const listResources = (): ExtensionResourceDescriptor[] => registry.listResources();
  const getMcpHealth = (extensionId: string): McpRuntimeHealth | null =>
    registry.listMcpRuntimeHealth().find((entry) => entry.extensionId === extensionId) ?? null;
  const resolveMcpExtensionIds = (): Set<string> =>
    new Set(
      registry
        .list()
        .filter((entry) => entry.capability === "mcp")
        .map((entry) => entry.id),
    );
  const readResource = async (extensionId: string, resourceId: string): Promise<ExtensionResourceContent | null> =>
    registry.readResource(extensionId, resourceId);
  return [
    {
      name: "extension_package_contract",
      description: "Inspect extension package.json compatibility contracts for configured plugin directories.",
      inputHint: "{}",
      riskHint: "read-only",
      async execute(): Promise<ToolResult> {
        const reports = await inspectExtensionPackageContracts({
          pluginDirs: registry.listPluginDirectories(),
        });
        const issueCount = reports.reduce((total, report) => total + report.issues.length, 0);
        const errorCount = reports.reduce(
          (total, report) => total + report.issues.filter((issue) => issue.severity === "error").length,
          0,
        );
        return {
          ok: errorCount === 0,
          summary: `Checked ${reports.length} extension package contract(s); ${issueCount} issue(s).`,
          data: { reports, issueCount, errorCount },
        };
      },
    },
    {
      name: "list_extension_resources",
      description: "List extension-backed resources that can be read during a task.",
      inputHint: "{}",
      riskHint: "read-only",
      async execute(): Promise<ToolResult> {
        const resources = registry.listResources();
        return {
          ok: true,
          summary: `Listed ${resources.length} extension resource(s).`,
          data: resources,
        };
      },
    },
    {
      name: "list_mcp_resources",
      description: "List MCP-backed extension resources using the native MCP resource surface.",
      inputHint: "{}",
      riskHint: "read-only",
      async execute(_context, args): Promise<ToolResult> {
        const mcpExtensionIds = resolveMcpExtensionIds();
        const requestedServer = optionalNonEmptyString(args.server ?? args.extensionId);
        const selectedMcpExtensionIds = requestedServer
          ? new Set([...mcpExtensionIds].filter((extensionId) => extensionId === requestedServer))
          : mcpExtensionIds;
        const resources = listResources()
          .filter((resource) => selectedMcpExtensionIds.has(resource.extensionId))
          .map((resource) => ({
          server: resource.extensionId,
          uri: resource.id,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType,
          sourcePath: resource.sourcePath,
          health: getMcpHealth(resource.extensionId),
          }));
        const health = [...selectedMcpExtensionIds]
          .map((extensionId) => getMcpHealth(extensionId))
          .filter((entry): entry is McpRuntimeHealth => Boolean(entry));
        return {
          ok: true,
          summary: `Listed ${resources.length} MCP resource alias record(s).`,
          data: resources,
          warnings: health
            .filter((entry) => entry.status === "failed")
            .map((entry) => `MCP server ${entry.extensionId} is failed: ${entry.lastError ?? "unknown error"}`),
        };
      },
    },
    {
      name: "read_extension_resource",
      description: "Read a named extension resource.",
      inputHint: "{ extensionId: string, resourceId: string }",
      riskHint: "read-only",
      async execute(_context, args): Promise<ToolResult> {
        const extensionId = String(args.extensionId ?? "").trim();
        const resourceId = String(args.resourceId ?? "").trim();
        if (!extensionId || !resourceId) {
          throw new Error("read_extension_resource requires extensionId and resourceId.");
        }
        const resource = await readResource(extensionId, resourceId);
        if (!resource) {
          return {
            ok: false,
            summary: `Extension resource ${extensionId}/${resourceId} was not found.`,
            data: null,
          };
        }
        return {
          ok: true,
          summary: `Read extension resource ${extensionId}/${resourceId}.`,
          data: resource,
        };
      },
    },
    {
      name: "read_mcp_resource",
      description: "Read an MCP-backed extension resource using server and uri coordinates.",
      inputHint: "{ server: string, uri: string }",
      riskHint: "read-only",
      async execute(_context, args): Promise<ToolResult> {
        const extensionId = String(args.server ?? args.extensionId ?? "").trim();
        const resourceId = String(args.uri ?? args.resourceId ?? "").trim();
        if (!extensionId || !resourceId) {
          throw new Error("read_mcp_resource requires server and uri.");
        }
        if (!resolveMcpExtensionIds().has(extensionId)) {
          return {
            ok: false,
            summary: `MCP resource ${extensionId}/${resourceId} was not found.`,
            data: {
              server: extensionId,
              uri: resourceId,
              health: getMcpHealth(extensionId),
              diagnostics: {
                stage: "server_lookup",
                reason: "server is not registered as an MCP extension",
              },
            },
          };
        }
        let resource: ExtensionResourceContent | null;
        try {
          resource = await readResource(extensionId, resourceId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            ok: false,
            summary: `MCP resource ${extensionId}/${resourceId} failed to read: ${message}`,
            data: {
              server: extensionId,
              uri: resourceId,
              health: getMcpHealth(extensionId),
              diagnostics: {
                stage: "resources/read",
                error: message,
              },
            },
          };
        }
        if (!resource) {
          return {
            ok: false,
            summary: `MCP resource ${extensionId}/${resourceId} was not found.`,
            data: {
              server: extensionId,
              uri: resourceId,
              health: getMcpHealth(extensionId),
              diagnostics: {
                stage: "resource_lookup",
                reason: "resource uri is not exposed by the MCP server",
              },
            },
          };
        }
        return {
          ok: true,
          summary: `Read MCP resource ${extensionId}/${resourceId}.`,
          data: {
            server: extensionId,
            uri: resourceId,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
            content: formatMcpResourceContentForContext(extensionId, resourceId, resource.content, maxMcpResourceContentChars),
            rawContentLength: resource.content.length,
            truncated: resource.content.length > maxMcpResourceContentChars,
            sourcePath: resource.sourcePath,
            health: getMcpHealth(extensionId),
          },
        };
      },
    },
    {
      name: "list_extension_prompts",
      description: "List reusable extension prompt templates.",
      inputHint: "{}",
      riskHint: "read-only",
      async execute(): Promise<ToolResult> {
        const prompts = registry.listPromptTemplates();
        return {
          ok: true,
          summary: `Listed ${prompts.length} extension prompt template(s).`,
          data: prompts,
        };
      },
    },
    {
      name: "render_extension_prompt",
      description: "Render a reusable extension prompt template with arguments.",
      inputHint: "{ extensionId: string, promptName: string, args?: Record<string, unknown> }",
      riskHint: "read-only",
      async execute(_context, args): Promise<ToolResult> {
        const extensionId = String(args.extensionId ?? "").trim();
        const promptName = String(args.promptName ?? "").trim();
        if (!extensionId || !promptName) {
          throw new Error("render_extension_prompt requires extensionId and promptName.");
        }
        const rendered = await registry.renderPromptTemplate(
          extensionId,
          promptName,
          normalizeToolArguments(args.args),
        );
        if (!rendered) {
          return {
            ok: false,
            summary: `Extension prompt ${extensionId}/${promptName} was not found.`,
            data: null,
          };
        }
        return {
          ok: true,
          summary: `Rendered extension prompt ${extensionId}/${promptName}.`,
          data: rendered,
        };
      },
    },
  ];
}

function formatMcpResourceContentForContext(
  server: string,
  uri: string,
  content: string,
  maxChars: number,
): string {
  const truncated = content.length > maxChars ? `${content.slice(0, maxChars)}\n[truncated]` : content;
  return [`[MCP resource: ${server} ${uri}]`, truncated].join("\n");
}

export async function loadExtensionRegistry(
  options: LoadExtensionRegistryOptions = {},
): Promise<ExtensionRegistry> {
  const pluginDirs = resolvePluginDirectories(options);
  const runtimePool = options.mcpRuntimePool ?? new McpRuntimePool();
  const registry = new ExtensionRegistry([], runtimePool);
  registry.addPluginDirectories(pluginDirs);
  if (!options.mcpRuntimePool) {
    registry.registerCleanup(async () => runtimePool.dispose());
  }

  for (const pluginDir of pluginDirs) {
    const definitions = await readLocalExtensions(pluginDir, runtimePool);
    for (const definition of definitions) {
      const tools = [...(definition.tools ?? [])];
        const resources = [...(definition.resources ?? [])];
        const promptTemplates = [...(definition.promptTemplates ?? [])];
        const promptHooks = [...(definition.promptHooks ?? [])];
        const toolHooks = normalizeRegisteredToolHooks(definition.toolHooks ?? {});
        const contextEngines = [...(definition.contextEngines ?? [])];
        const memoryProviders = [...(definition.memoryProviders ?? [])];
        const toolPolicies = [...(definition.toolPolicies ?? [])];
        if (typeof definition.dispose === "function") {
          registry.registerCleanup(definition.dispose);
        }
      const capability =
        definition.capability ??
        (promptHooks.length > 0
          ? "prompt-hook"
          : tools.length > 0 || toolHooks.pre.length + toolHooks.post.length + toolHooks.stop.length > 0
            ? "tool"
            : resources.length > 0 || promptTemplates.length > 0
              ? "mcp"
              : "mcp");
      registry.register(
        {
          id: definition.id,
          name: definition.name,
          capability,
          description: definition.description,
          sourcePath: definition.sourcePath,
          toolNames: tools.map((tool) => tool.name),
          resourceCount: resources.length,
          promptTemplateCount: promptTemplates.length,
          promptHookCount: promptHooks.length,
          toolHookCount: toolHooks.pre.length + toolHooks.post.length + toolHooks.stop.length,
        },
        tools,
        resources.map((resource) =>
          createRegisteredExtensionResource(definition.id, resource, definition.sourcePath),
        ),
          promptTemplates.map((prompt) =>
            createRegisteredExtensionPromptTemplate(definition.id, prompt, definition.sourcePath),
          ),
          promptHooks,
          toolHooks,
          contextEngines.map((engine) => ({
            descriptor: {
              ...engine.descriptor,
              extensionId: definition.id,
              sourcePath: definition.sourcePath,
            },
            create: engine.create,
          })),
          memoryProviders.map((provider) => ({
            descriptor: {
              extensionId: definition.id,
              id: provider.id,
              label: provider.label,
              description: provider.description,
              sourcePath: definition.sourcePath,
            },
            create: provider.create,
          })),
          toolPolicies,
        );
      }
    }

  return registry;
}

export function resolvePluginDirectories(options: LoadExtensionRegistryOptions = {}): string[] {
  const envValue = process.env.OMNI_AGENT_PLUGIN_DIRS ?? process.env.OMNI_AGENT_PLUGIN_DIR ?? "";
  const envDirs = envValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const configuredDirs = options.pluginDirs ?? [];
  const merged = [...configuredDirs, ...envDirs];

  return Array.from(new Set(merged.map((directory) => resolve(options.cwd ?? process.cwd(), directory))));
}

export async function inspectExtensionPackageContracts(
  options: LoadExtensionRegistryOptions = {},
): Promise<ExtensionPackageContractReport[]> {
  const pluginDirs = resolvePluginDirectories(options);
  const reports: ExtensionPackageContractReport[] = [];
  for (const pluginDir of pluginDirs) {
    const sourcePath = join(pluginDir, "package.json");
    try {
      const raw = await readFile(sourcePath, "utf8");
      reports.push(validateExtensionPackageJson(JSON.parse(raw) as unknown, sourcePath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      reports.push({
        sourcePath,
        packageName: null,
        packageVersion: null,
        pluginApi: null,
        pluginApiCompatible: null,
        currentPluginApi: CURRENT_PLUGIN_API_VERSION,
        omniAgentVersion: null,
        ok: false,
        issues: [
          {
            sourcePath,
            severity: "warning",
            reason: `No readable extension package.json contract found: ${message}`,
          },
        ],
      });
    }
  }
  return reports;
}

async function readLocalExtensions(
  pluginDir: string,
  runtimePool: McpRuntimePool,
): Promise<Array<(LocalModuleExtension & { readonly sourcePath: string })>> {
  let entries;
  try {
    entries = await readdir(pluginDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const extensions: Array<LocalModuleExtension & { readonly sourcePath: string }> = [];
  const reservedModulePaths = new Set<string>();
  const moduleCandidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = extname(entry.name).toLowerCase();
    const sourcePath = resolve(pluginDir, entry.name);
    if (extension === ".json") {
      if (entry.name.toLowerCase() === "package.json") {
        continue;
      }
      const raw = await readFile(sourcePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      for (const referencedPath of collectReferencedHelperPaths(parsed, sourcePath)) {
        reservedModulePaths.add(referencedPath);
      }
      extensions.push(await loadManifestExtension(parsed, sourcePath, runtimePool));
      continue;
    }

    if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
      moduleCandidates.push(sourcePath);
    }
  }

  for (const sourcePath of moduleCandidates) {
    if (reservedModulePaths.has(sourcePath)) {
      continue;
    }
    extensions.push(await loadModuleExtension(sourcePath));
  }

  return extensions.sort((left, right) => left.id.localeCompare(right.id));
}

async function loadModuleExtension(sourcePath: string): Promise<LocalModuleExtension & { readonly sourcePath: string }> {
  const module = (await import(pathToFileURL(sourcePath).href)) as { default?: unknown; extension?: unknown };
  const raw = module.default ?? module.extension;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid extension module at ${sourcePath}: expected a default export object.`);
  }

  const record = raw as Record<string, unknown>;
  const id = requireNonEmptyString(record.id, `${sourcePath}: id`);
  const name = requireNonEmptyString(record.name, `${sourcePath}: name`);
  const description = requireNonEmptyString(record.description, `${sourcePath}: description`);
  const capability = normalizeCapability(record.capability, sourcePath);
  const tools = normalizeModuleTools(record.tools, sourcePath);
  const resources = normalizeModuleResources(record.resources, sourcePath);
  const promptTemplates = normalizeModulePromptTemplates(record.promptTemplates, sourcePath);
  const promptHooks = normalizePromptHooks(record.promptHooks, sourcePath);
  const toolHooks = normalizeToolLifecycleHooks(record.toolHooks, sourcePath);
  const contextEngines = normalizeContextEngines(record.contextEngines, sourcePath);
  const memoryProviders = normalizeMemoryProviders(record.memoryProviders, sourcePath);
  const toolPolicies = normalizeExtensionToolPolicies(record.toolPolicies, sourcePath, tools.map((tool) => tool.name));
  const dispose = typeof record.dispose === "function" ? record.dispose.bind(record) : undefined;

  return {
    id,
    name,
    description,
    capability,
    tools,
    resources,
    promptTemplates,
    promptHooks,
    toolHooks,
    contextEngines,
    memoryProviders,
    toolPolicies,
    dispose,
    sourcePath,
  };
}

async function loadManifestExtension(
  raw: unknown,
  sourcePath: string,
  runtimePool: McpRuntimePool,
): Promise<LocalModuleExtension & { readonly sourcePath: string }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid extension manifest at ${sourcePath}: expected an object.`);
  }

  const record = raw as Record<string, unknown>;
  const id = requireNonEmptyString(record.id, `${sourcePath}: id`);
  const name = requireNonEmptyString(record.name, `${sourcePath}: name`);
  const description = requireNonEmptyString(record.description, `${sourcePath}: description`);
  const capability = normalizeCapability(record.capability, sourcePath);
  const bridge = normalizeBridge(record.bridge, sourcePath);
  const mcp = normalizeMcp(record.mcp, sourcePath);
  const tools = bridge
    ? normalizeBridgeTools(record.tools, sourcePath).map((tool) => createBridgeToolDefinition(tool, bridge, sourcePath))
    : normalizeTools(record.tools, sourcePath).map((tool) => createManifestToolDefinition(tool));
  const resources = normalizeManifestResources(record.resources, sourcePath);
  const promptTemplates = normalizeManifestPromptTemplates(record.prompts, sourcePath);
  const toolHooks = normalizeManifestToolLifecycleHooks(record.toolHooks, sourcePath);
  const mcpRuntime = mcp ? runtimePool.getOrCreate(id, mcp) : null;
  let mcpExtension: McpDiscoveredExtension | null = null;
  try {
    mcpExtension = mcp && mcpRuntime ? await loadMcpExtension(id, mcpRuntime, mcp, sourcePath) : null;
  } catch (error) {
    throw error;
  }
  const toolPolicies = normalizeExtensionToolPolicies(
    record.toolPolicies,
    sourcePath,
    [...tools, ...(mcpExtension?.tools ?? [])].map((tool) => tool.name),
  );

  return {
    id,
    name,
    description,
    capability: capability ?? (mcp ? "mcp" : bridge ? "bridge" : undefined),
      tools: [...tools, ...(mcpExtension?.tools ?? [])],
      resources: [...resources, ...(mcpExtension?.resources ?? [])],
      promptTemplates: [...promptTemplates, ...(mcpExtension?.promptTemplates ?? [])],
      promptHooks: [],
      toolHooks,
      toolPolicies,
      dispose: undefined,
      sourcePath,
    };
}

function normalizeCapability(value: unknown, sourcePath: string): ExtensionCapability | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "bridge" || value === "gateway" || value === "mcp" || value === "prompt-hook" || value === "tool") {
    return value;
  }

  throw new Error(`${sourcePath}: capability must be one of bridge, gateway, mcp, prompt-hook, tool.`);
}

function normalizeTools(value: unknown, sourcePath: string): FixedCommandToolManifest[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: tools must be an array.`);
  }

  return value.map((entry, index) => normalizeTool(entry, sourcePath, index));
}

function normalizeManifestResources(value: unknown, sourcePath: string): LocalExtensionResourceDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: resources must be an array.`);
  }
  return value.map((entry, index) => normalizeManifestResource(entry, sourcePath, index));
}

function normalizeManifestResource(
  entry: unknown,
  sourcePath: string,
  index: number,
): LocalExtensionResourceDefinition {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: resources[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  const id = requireNonEmptyString(record.id, `${sourcePath}: resources[${index}].id`);
  const description = requireNonEmptyString(record.description, `${sourcePath}: resources[${index}].description`);
  const inlineContent = typeof record.content === "string" ? record.content : undefined;
  const filePath = optionalNonEmptyString(record.filePath);
  if (!inlineContent && !filePath) {
    throw new Error(`${sourcePath}: resources[${index}] must define content or filePath.`);
  }
  const resolvedFilePath = filePath ? resolve(dirname(sourcePath), filePath) : undefined;
  return {
    id,
    name: optionalNonEmptyString(record.name),
    description,
    mimeType: optionalNonEmptyString(record.mimeType) ?? "text/plain; charset=utf-8",
    content: inlineContent,
    load: resolvedFilePath ? async () => readFile(resolvedFilePath, "utf8") : undefined,
  };
}

function normalizeManifestPromptTemplates(
  value: unknown,
  sourcePath: string,
): LocalExtensionPromptTemplateDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: prompts must be an array.`);
  }
  return value.map((entry, index) => normalizeManifestPromptTemplate(entry, sourcePath, index));
}

function normalizeManifestPromptTemplate(
  entry: unknown,
  sourcePath: string,
  index: number,
): LocalExtensionPromptTemplateDefinition {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: prompts[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  return {
    name: requireNonEmptyString(record.name, `${sourcePath}: prompts[${index}].name`),
    description: requireNonEmptyString(record.description, `${sourcePath}: prompts[${index}].description`),
    arguments: normalizePromptTemplateArguments(
      record.arguments,
      `${sourcePath}: prompts[${index}].arguments`,
    ),
    template: requireNonEmptyString(record.template, `${sourcePath}: prompts[${index}].template`),
  };
}

function normalizeBridge(value: unknown, sourcePath: string): BridgeManifest | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourcePath}: bridge must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const timeoutMs = normalizePositiveNumber(record.timeoutMs);
  if (record.transport === "http") {
    const headers =
      record.headers && typeof record.headers === "object" && !Array.isArray(record.headers)
        ? Object.fromEntries(
            Object.entries(record.headers as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]),
          )
        : undefined;
    return {
      transport: "http",
      url: requireNonEmptyString(record.url, `${sourcePath}: bridge.url`),
      method: optionalNonEmptyString(record.method)?.toUpperCase() ?? "POST",
      headers,
      timeoutMs,
    };
  }
  const env =
    record.env && typeof record.env === "object" && !Array.isArray(record.env)
      ? Object.fromEntries(
          Object.entries(record.env as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]),
        )
      : undefined;
  return {
    transport: record.transport === "stdio" || record.transport === undefined ? "stdio" : invalidBridgeTransport(sourcePath),
    command: requireNonEmptyString(record.command, `${sourcePath}: bridge.command`),
    args: Array.isArray(record.args) ? record.args.map((entry) => String(entry)) : [],
    cwd: optionalNonEmptyString(record.cwd),
    env,
    timeoutMs,
  };
}

function normalizeMcp(value: unknown, sourcePath: string): McpServerManifest | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourcePath}: mcp must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const timeoutMs = normalizePositiveNumber(record.timeoutMs);
  const auth = normalizeMcpAuth(record.auth, `${sourcePath}: mcp.auth`);
  const allowlist = normalizeMcpAllowlist(record.allowlist, `${sourcePath}: mcp.allowlist`);
  if (record.transport === "http" || record.transport === "sse") {
    const headers =
      record.headers && typeof record.headers === "object" && !Array.isArray(record.headers)
        ? Object.fromEntries(
            Object.entries(record.headers as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]),
          )
        : undefined;
    return {
      transport: record.transport,
      url: requireNonEmptyString(record.url, `${sourcePath}: mcp.url`),
      headers,
      auth,
      allowlist,
      timeoutMs,
    };
  }

  const env =
    record.env && typeof record.env === "object" && !Array.isArray(record.env)
      ? Object.fromEntries(
          Object.entries(record.env as Record<string, unknown>).map(([key, entry]) => [key, String(entry)]),
        )
      : undefined;
  return {
    transport: record.transport === "stdio" || record.transport === undefined ? "stdio" : invalidMcpTransport(sourcePath),
    command: requireNonEmptyString(record.command, `${sourcePath}: mcp.command`),
    args: Array.isArray(record.args) ? record.args.map((entry) => String(entry)) : [],
    cwd: resolve(dirname(sourcePath), optionalNonEmptyString(record.cwd) ?? "."),
    env,
    auth,
    allowlist,
    timeoutMs,
  };
}

function normalizeMcpAuth(value: unknown, label: string): McpAuthManifest | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (record.type !== "oauth") {
    throw new Error(`${label}.type must be "oauth".`);
  }
  return {
    type: "oauth",
    tokenEnv: optionalNonEmptyString(record.tokenEnv),
    scopes: normalizeStringList(record.scopes, `${label}.scopes`),
  };
}

function normalizeMcpAllowlist(value: unknown, label: string): McpAllowlistManifest | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    tools: normalizeStringList(record.tools, `${label}.tools`),
    resources: normalizeStringList(record.resources, `${label}.resources`),
  };
}

function normalizeStringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value
    .map((entry) => String(entry).trim())
    .filter(Boolean);
}

function normalizeBridgeTools(value: unknown, sourcePath: string): BridgeToolManifest[] {
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: bridge manifests require tools to be an array.`);
  }
  return value.map((entry, index) => normalizeBridgeTool(entry, sourcePath, index));
}

function collectReferencedHelperPaths(raw: unknown, sourcePath: string): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }

  const record = raw as Record<string, unknown>;
  const bridge = record.bridge;
  const paths = new Set<string>();
  const extensionRoot = dirname(sourcePath);
  const addIfLocalHelper = (value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("-")) {
      return;
    }
    const extension = extname(trimmed).toLowerCase();
    if (
      extension !== ".js" &&
      extension !== ".mjs" &&
      extension !== ".cjs" &&
      extension !== ".ts" &&
      extension !== ".mts" &&
      extension !== ".cts"
    ) {
      return;
    }
    paths.add(resolve(extensionRoot, trimmed));
  };

  if (bridge && typeof bridge === "object" && !Array.isArray(bridge)) {
    const bridgeRecord = bridge as Record<string, unknown>;
    if (bridgeRecord.transport !== "http") {
      addIfLocalHelper(bridgeRecord.command);
      if (Array.isArray(bridgeRecord.args)) {
        for (const arg of bridgeRecord.args) {
          addIfLocalHelper(arg);
        }
      }
    }
  }

  const mcp = record.mcp;
  if (mcp && typeof mcp === "object" && !Array.isArray(mcp)) {
    const mcpRecord = mcp as Record<string, unknown>;
    if (mcpRecord.transport !== "http" && mcpRecord.transport !== "sse") {
      addIfLocalHelper(mcpRecord.command);
      if (Array.isArray(mcpRecord.args)) {
        for (const arg of mcpRecord.args) {
          addIfLocalHelper(arg);
        }
      }
    }
  }

  return Array.from(paths);
}

function normalizeTool(entry: unknown, sourcePath: string, index: number): FixedCommandToolManifest {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: tools[${index}] must be an object.`);
  }

  const record = entry as Record<string, unknown>;
  const tool = {
    name: requireNonEmptyString(record.name, `${sourcePath}: tools[${index}].name`),
    description: requireNonEmptyString(record.description, `${sourcePath}: tools[${index}].description`),
    inputHint: optionalNonEmptyString(record.inputHint),
    riskHint: optionalNonEmptyString(record.riskHint),
    command: requireNonEmptyString(record.command, `${sourcePath}: tools[${index}].command`),
    cwd: optionalNonEmptyString(record.cwd),
    timeoutMs: normalizePositiveNumber(record.timeoutMs),
    successExitCodes: normalizeSuccessExitCodes(record.successExitCodes, sourcePath, index),
  } satisfies FixedCommandToolManifest;

  return tool;
}

function normalizeBridgeTool(entry: unknown, sourcePath: string, index: number): BridgeToolManifest {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: tools[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  return {
    name: requireNonEmptyString(record.name, `${sourcePath}: tools[${index}].name`),
    description: requireNonEmptyString(record.description, `${sourcePath}: tools[${index}].description`),
    inputHint: optionalNonEmptyString(record.inputHint),
    riskHint: optionalNonEmptyString(record.riskHint),
  };
}

function normalizeExtensionToolPolicies(
  value: unknown,
  sourcePath: string,
  knownToolNames: readonly string[],
): ExtensionToolPolicy[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: toolPolicies must be an array.`);
  }
  return value.map((entry, index) => normalizeExtensionToolPolicy(entry, sourcePath, index, knownToolNames));
}

function normalizeContextEngines(
  value: unknown,
  sourcePath: string,
): ExtensionContextEngineDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: contextEngines must be an array.`);
  }
  return value.map((entry, index) => normalizeContextEngine(entry, sourcePath, index));
}

function normalizeContextEngine(
  entry: unknown,
  sourcePath: string,
  index: number,
): ExtensionContextEngineDefinition {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: contextEngines[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  const descriptor = record.descriptor;
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new Error(`${sourcePath}: contextEngines[${index}].descriptor must be an object.`);
  }
  if (typeof record.create !== "function") {
    throw new Error(`${sourcePath}: contextEngines[${index}].create must be a function.`);
  }
  const descriptorRecord = descriptor as Record<string, unknown>;
  return {
    descriptor: {
      id: requireNonEmptyString(descriptorRecord.id, `${sourcePath}: contextEngines[${index}].descriptor.id`),
      label: requireNonEmptyString(descriptorRecord.label, `${sourcePath}: contextEngines[${index}].descriptor.label`),
      description: requireNonEmptyString(
        descriptorRecord.description,
        `${sourcePath}: contextEngines[${index}].descriptor.description`,
      ),
      ownsCompaction: descriptorRecord.ownsCompaction === true,
      ownsBudgetPolicy: descriptorRecord.ownsBudgetPolicy === true,
      supportsSubagentHooks: descriptorRecord.supportsSubagentHooks === true,
      defaultPromptBudgetTokens: requirePositiveInteger(
        descriptorRecord.defaultPromptBudgetTokens,
        `${sourcePath}: contextEngines[${index}].descriptor.defaultPromptBudgetTokens`,
      ),
      defaultSubagentNoteLimit: requirePositiveInteger(
        descriptorRecord.defaultSubagentNoteLimit,
        `${sourcePath}: contextEngines[${index}].descriptor.defaultSubagentNoteLimit`,
      ),
      defaultExtraInstructionLimit: requirePositiveInteger(
        descriptorRecord.defaultExtraInstructionLimit,
        `${sourcePath}: contextEngines[${index}].descriptor.defaultExtraInstructionLimit`,
      ),
      statusSchema: normalizeStringArray(
        descriptorRecord.statusSchema,
        `${sourcePath}: contextEngines[${index}].descriptor.statusSchema`,
      ) ?? [],
    },
    create: record.create as ContextEngineFactory,
  };
}

function normalizeMemoryProviders(
  value: unknown,
  sourcePath: string,
): ExtensionMemoryProviderDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: memoryProviders must be an array.`);
  }
  return value.map((entry, index) => normalizeMemoryProvider(entry, sourcePath, index));
}

function normalizeMemoryProvider(
  entry: unknown,
  sourcePath: string,
  index: number,
): ExtensionMemoryProviderDefinition {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: memoryProviders[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  if (typeof record.create !== "function") {
    throw new Error(`${sourcePath}: memoryProviders[${index}].create must be a function.`);
  }
  return {
    id: requireNonEmptyString(record.id, `${sourcePath}: memoryProviders[${index}].id`),
    label: requireNonEmptyString(record.label, `${sourcePath}: memoryProviders[${index}].label`),
    description: requireNonEmptyString(record.description, `${sourcePath}: memoryProviders[${index}].description`),
    create: record.create as () => MemoryProvider,
  };
}

function requirePositiveInteger(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return parsed;
}

function normalizeExtensionToolPolicy(
  entry: unknown,
  sourcePath: string,
  index: number,
  knownToolNames: readonly string[],
): ExtensionToolPolicy {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: toolPolicies[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  const toolName = requireNonEmptyString(record.toolName, `${sourcePath}: toolPolicies[${index}].toolName`);
  if (!knownToolNames.includes(toolName)) {
    throw new Error(`${sourcePath}: toolPolicies[${index}].toolName must reference a declared tool.`);
  }
  return {
    toolName,
    allowInSubagents: record.allowInSubagents === true,
    allowedRoles: normalizeStringArray(record.allowedRoles, `${sourcePath}: toolPolicies[${index}].allowedRoles`),
    deniedRoles: normalizeStringArray(record.deniedRoles, `${sourcePath}: toolPolicies[${index}].deniedRoles`),
    allowedAuthorities: normalizeStringArray(
      record.allowedAuthorities,
      `${sourcePath}: toolPolicies[${index}].allowedAuthorities`,
    ),
  };
}

function normalizeModuleTools(value: unknown, sourcePath: string): ToolDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: tools must be an array.`);
  }

  return value.map((entry, index) => validateModuleTool(entry, sourcePath, index));
}

function normalizeStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function validateModuleTool(entry: unknown, sourcePath: string, index: number): ToolDefinition {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: tools[${index}] must be an object.`);
  }

  const record = entry as Partial<ToolDefinition>;
  if (typeof record.name !== "string" || typeof record.description !== "string" || typeof record.inputHint !== "string") {
    throw new Error(`${sourcePath}: tools[${index}] must define name, description, and inputHint.`);
  }
  if (typeof record.riskHint !== "string" || typeof record.execute !== "function") {
    throw new Error(`${sourcePath}: tools[${index}] must define riskHint and execute(context, args).`);
  }

  return {
    name: record.name,
    description: record.description,
    inputHint: record.inputHint,
    riskHint: record.riskHint,
    execute: record.execute.bind(record),
  };
}

function normalizeModuleResources(value: unknown, sourcePath: string): LocalExtensionResourceDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: resources must be an array.`);
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${sourcePath}: resources[${index}] must be an object.`);
    }
    const record = entry as LocalExtensionResourceDefinition;
    const id = requireNonEmptyString(record.id, `${sourcePath}: resources[${index}].id`);
    const description = requireNonEmptyString(record.description, `${sourcePath}: resources[${index}].description`);
    const load = typeof record.load === "function" ? record.load.bind(record) : undefined;
    const content = typeof record.content === "string" ? record.content : undefined;
    if (!load && !content) {
      throw new Error(`${sourcePath}: resources[${index}] must define content or load().`);
    }
    return {
      id,
      name: optionalNonEmptyString(record.name),
      description,
      mimeType: optionalNonEmptyString(record.mimeType) ?? "text/plain; charset=utf-8",
      content,
      load,
    };
  });
}

function normalizeModulePromptTemplates(
  value: unknown,
  sourcePath: string,
): LocalExtensionPromptTemplateDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: promptTemplates must be an array.`);
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${sourcePath}: promptTemplates[${index}] must be an object.`);
    }
    const record = entry as LocalExtensionPromptTemplateDefinition;
    const name = requireNonEmptyString(record.name, `${sourcePath}: promptTemplates[${index}].name`);
    const description = requireNonEmptyString(
      record.description,
      `${sourcePath}: promptTemplates[${index}].description`,
    );
    const template = typeof record.template === "string" ? record.template : undefined;
    const render = typeof record.render === "function" ? record.render.bind(record) : undefined;
    if (!template && !render) {
      throw new Error(`${sourcePath}: promptTemplates[${index}] must define template or render(args).`);
    }
    return {
      name,
      description,
      arguments: normalizePromptTemplateArguments(
        record.arguments,
        `${sourcePath}: promptTemplates[${index}].arguments`,
      ),
      template,
      render,
    };
  });
}

function normalizePromptHooks(value: unknown, sourcePath: string): PromptHook[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: promptHooks must be an array.`);
  }

  return value.map((entry, index) => {
    if (typeof entry !== "function") {
      throw new Error(`${sourcePath}: promptHooks[${index}] must be a function.`);
    }
    return entry as PromptHook;
  });
}

function normalizeToolLifecycleHooks(value: unknown, sourcePath: string): LocalExtensionToolHooks {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourcePath}: toolHooks must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    pre: normalizeToolLifecycleHookArray(record.pre, sourcePath, "pre"),
    post: normalizeToolLifecycleHookArray(record.post, sourcePath, "post"),
    stop: normalizeToolLifecycleHookArray(record.stop, sourcePath, "stop"),
  };
}

function normalizeToolLifecycleHookArray(
  value: unknown,
  sourcePath: string,
  phase: ToolLifecycleHookPhase,
): ToolLifecycleHook[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: toolHooks.${phase} must be an array.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "function") {
      throw new Error(`${sourcePath}: toolHooks.${phase}[${index}] must be a function.`);
    }
    return entry as ToolLifecycleHook;
  });
}

function normalizeManifestToolLifecycleHooks(value: unknown, sourcePath: string): LocalExtensionToolHooks {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${sourcePath}: toolHooks must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    pre: normalizeManifestToolLifecycleHookArray(record.pre, sourcePath, "pre"),
    post: normalizeManifestToolLifecycleHookArray(record.post, sourcePath, "post"),
    stop: normalizeManifestToolLifecycleHookArray(record.stop, sourcePath, "stop"),
  };
}

function normalizeManifestToolLifecycleHookArray(
  value: unknown,
  sourcePath: string,
  phase: ToolLifecycleHookPhase,
): ToolLifecycleHook[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: toolHooks.${phase} must be an array.`);
  }
  return value.map((entry, index) => createManifestToolLifecycleHook(entry, sourcePath, phase, index));
}

function createManifestToolLifecycleHook(
  entry: unknown,
  sourcePath: string,
  phase: ToolLifecycleHookPhase,
  index: number,
): ToolLifecycleHook {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${sourcePath}: toolHooks.${phase}[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  const toolName = optionalNonEmptyString(record.toolName);
  const message = requireNonEmptyString(record.message, `${sourcePath}: toolHooks.${phase}[${index}].message`);
  return (context) => {
    if (toolName && context.toolName !== toolName) {
      return undefined;
    }
    return message
      .replace(/\{\{\s*phase\s*\}\}/g, context.phase)
      .replace(/\{\{\s*toolName\s*\}\}/g, context.toolName)
      .replace(/\{\{\s*status\s*\}\}/g, context.status);
  };
}

function normalizePromptTemplateArguments(
  value: unknown,
  label: string,
): readonly PromptTemplateArgumentDefinition[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => normalizePromptTemplateArgument(entry, `${label}[${index}]`));
}

function normalizePromptTemplateArgument(
  entry: unknown,
  label: string,
): PromptTemplateArgumentDefinition {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`${label} must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  return {
    name: requireNonEmptyString(record.name, `${label}.name`),
    description: optionalNonEmptyString(record.description),
    required: record.required === true,
    defaultValue: record.defaultValue === undefined ? undefined : String(record.defaultValue),
  };
}

function normalizeSuccessExitCodes(
  value: unknown,
  sourcePath: string,
  index: number,
): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${sourcePath}: tools[${index}].successExitCodes must be an array of numbers.`);
  }
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => Math.trunc(entry));
}

function createRegisteredExtensionResource(
  extensionId: string,
  resource: LocalExtensionResourceDefinition,
  sourcePath?: string,
): RegisteredExtensionResource {
  return {
    descriptor: {
      extensionId,
      id: resource.id,
      name: resource.name?.trim() || resource.id,
      description: resource.description,
      mimeType: resource.mimeType?.trim() || "text/plain; charset=utf-8",
      sourcePath,
    },
    load: async () => {
      if (typeof resource.content === "string") {
        return resource.content;
      }
      if (typeof resource.load === "function") {
        return String(await resource.load());
      }
      throw new Error(`Extension resource ${extensionId}/${resource.id} has no content loader.`);
    },
  };
}

function createRegisteredExtensionPromptTemplate(
  extensionId: string,
  prompt: LocalExtensionPromptTemplateDefinition,
  sourcePath?: string,
): RegisteredExtensionPromptTemplate {
  const descriptor: ExtensionPromptTemplateDescriptor = {
    extensionId,
    name: prompt.name,
    description: prompt.description,
    arguments: prompt.arguments ?? [],
    sourcePath,
  };

  return {
    descriptor,
    render: async (args) => {
      const resolvedArgs = resolvePromptTemplateArguments(prompt.arguments ?? [], args);
      if (typeof prompt.render === "function") {
        const rendered = await prompt.render(resolvedArgs);
        if (typeof rendered === "string") {
          return {
            ...descriptor,
            content: rendered,
            messages: [
              {
                role: "user",
                contentType: "text",
                text: rendered,
              },
            ],
          };
        }
        return {
          ...descriptor,
          content: rendered.content,
          messages: rendered.messages ?? [
            {
              role: "user",
              contentType: "text",
              text: rendered.content,
            },
          ],
        };
      }
      if (typeof prompt.template === "string") {
        const content = interpolatePromptTemplate(prompt.template, resolvedArgs);
        return {
          ...descriptor,
          content,
          messages: [
            {
              role: "user",
              contentType: "text",
              text: content,
            },
          ],
        };
      }
      throw new Error(`Extension prompt ${extensionId}/${prompt.name} has no renderer.`);
    },
  };
}

function resolvePromptTemplateArguments(
  definitions: readonly PromptTemplateArgumentDefinition[],
  args: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...args };
  for (const definition of definitions) {
    if (resolved[definition.name] === undefined && definition.defaultValue !== undefined) {
      resolved[definition.name] = definition.defaultValue;
    }
    if (definition.required && resolved[definition.name] === undefined) {
      throw new Error(`Missing required prompt argument: ${definition.name}`);
    }
  }
  return resolved;
}

function interpolatePromptTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, name: string) => {
    const value = args[name];
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return JSON.stringify(value);
  });
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

const MCP_PROTOCOL_VERSION = "2025-06-18";

interface McpClient {
  request<TResult>(method: string, params?: Record<string, unknown>): Promise<TResult>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
}

interface McpSession extends McpClient {
  dispose(): Promise<void>;
}

interface McpRuntimeHandle extends McpClient {
  getHealth(): McpRuntimeHealth;
  dispose(): Promise<void>;
}

class McpAuthRequiredError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "McpAuthRequiredError";
  }
}

interface McpDiscoveredExtension {
  readonly tools: ToolDefinition[];
  readonly resources: LocalExtensionResourceDefinition[];
  readonly promptTemplates: LocalExtensionPromptTemplateDefinition[];
}

async function loadMcpExtension(
  extensionId: string,
  runtime: McpRuntimeHandle,
  manifest: McpServerManifest,
  sourcePath: string,
): Promise<McpDiscoveredExtension> {
  const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
    runtime.request<{ tools?: Array<Record<string, unknown>> }>("tools/list").catch(() => ({ tools: [] })),
    runtime.request<{ resources?: Array<Record<string, unknown>> }>("resources/list").catch(() => ({ resources: [] })),
    runtime.request<{ prompts?: Array<Record<string, unknown>> }>("prompts/list").catch(() => ({ prompts: [] })),
  ]);

  const tools = Array.isArray(toolsResult.tools)
    ? toolsResult.tools
        .filter((entry) => typeof entry.name === "string" && entry.name.trim().length > 0)
        .filter((entry) => isMcpToolAllowed(manifest, String(entry.name)))
        .map((entry) => createMcpToolDefinition(extensionId, runtime, manifest, sourcePath, entry))
    : [];
  const resources = Array.isArray(resourcesResult.resources)
    ? resourcesResult.resources
        .filter((entry) => typeof entry.uri === "string" && entry.uri.trim().length > 0)
        .filter((entry) => isMcpResourceAllowed(manifest, entry))
        .map((entry) => createMcpResourceDefinition(runtime, manifest, entry))
    : [];
  const promptTemplates = Array.isArray(promptsResult.prompts)
    ? promptsResult.prompts
        .filter((entry) => typeof entry.name === "string" && entry.name.trim().length > 0)
        .map((entry) => createMcpPromptTemplateDefinition(runtime, manifest, entry))
    : [];

  return {
    tools,
    resources,
    promptTemplates,
  };
}

function isMcpToolAllowed(manifest: McpServerManifest, name: string): boolean {
  const allowed = manifest.allowlist?.tools;
  return !allowed || allowed.length === 0 || allowed.includes(name.trim());
}

function isMcpResourceAllowed(manifest: McpServerManifest, entry: Record<string, unknown>): boolean {
  const allowed = manifest.allowlist?.resources;
  if (!allowed || allowed.length === 0) {
    return true;
  }
  const uri = String(entry.uri ?? "").trim();
  const name = optionalNonEmptyString(entry.name);
  return allowed.includes(uri) || (name ? allowed.includes(name) : false);
}

function createMcpToolDefinition(
  extensionId: string,
  runtime: McpRuntimeHandle,
  manifest: McpServerManifest,
  sourcePath: string,
  entry: Record<string, unknown>,
): ToolDefinition {
  const name = requireNonEmptyString(entry.name, `${sourcePath}: mcp.tools[].name`);
  const toolName = `mcp__${normalizeMcpToolNameSegment(extensionId, "server")}__${normalizeMcpToolNameSegment(name, "tool")}`;
  const description = optionalNonEmptyString(entry.description) ?? `MCP tool ${name}`;
  const inputSchema = entry.inputSchema;
  return {
    name: toolName,
    description: `${description} (mcp server: ${extensionId}; tool: ${name}; transport: ${isMcpHttpManifest(manifest) ? manifest.url : basename(manifest.command)})`,
    inputHint: inputSchema ? JSON.stringify(inputSchema) : "{}",
    riskHint: "external MCP tool",
    async execute(_context, args): Promise<ToolResult> {
      const result = await runtime.request<Record<string, unknown>>("tools/call", {
        name,
        arguments: args,
      });
      const converted = convertMcpToolResult(toolName, result);
      return {
        ...converted,
        data: {
          ...(converted.data && typeof converted.data === "object" && !Array.isArray(converted.data)
            ? converted.data
            : { value: converted.data }),
          mcp: {
            server: extensionId,
            tool: name,
            health: runtime.getHealth(),
          },
        },
      };
    },
  };
}

function normalizeMcpToolNameSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function createMcpResourceDefinition(
  runtime: McpRuntimeHandle,
  manifest: McpServerManifest,
  entry: Record<string, unknown>,
): LocalExtensionResourceDefinition {
  const uri = String(entry.uri ?? "").trim();
  return {
    id: uri,
    name: optionalNonEmptyString(entry.name) ?? uri,
    description: optionalNonEmptyString(entry.description) ?? `MCP resource ${uri}`,
    mimeType: optionalNonEmptyString(entry.mimeType) ?? "text/plain; charset=utf-8",
    load: async () => readMcpResourceContent(runtime, uri),
  };
}

function createMcpPromptTemplateDefinition(
  runtime: McpRuntimeHandle,
  manifest: McpServerManifest,
  entry: Record<string, unknown>,
): LocalExtensionPromptTemplateDefinition {
  const name = String(entry.name ?? "").trim();
  return {
    name,
    description: optionalNonEmptyString(entry.description) ?? `MCP prompt ${name}`,
    arguments: normalizePromptTemplateArguments(entry.arguments, `mcp.prompt.${name}.arguments`),
    render: async (args) => getMcpPromptRender(runtime, name, args),
  };
}

async function readMcpResourceContent(runtime: McpRuntimeHandle, uri: string): Promise<string> {
  const result = await runtime.request<{ contents?: Array<Record<string, unknown>> }>("resources/read", { uri });
  const contents = Array.isArray(result.contents) ? result.contents : [];
  return contents
    .map((entry) => {
      if (typeof entry.text === "string") {
        return entry.text;
      }
      if (typeof entry.blob === "string") {
        return entry.blob;
      }
      return JSON.stringify(entry);
    })
    .join("\n\n");
}

async function getMcpPromptRender(
  runtime: McpRuntimeHandle,
  name: string,
  args: Record<string, unknown>,
): Promise<{ readonly content: string; readonly messages: readonly ExtensionPromptMessage[] }> {
  const result = await runtime.request<{ messages?: Array<Record<string, unknown>> }>("prompts/get", {
    name,
    arguments: args,
  });
  const messages = normalizeMcpPromptMessages(result.messages);
  return {
    content: messages.map((message) => `[${message.role}] ${message.text}`).join("\n\n"),
    messages,
  };
}

function normalizeMcpPromptMessages(value: unknown): ExtensionPromptMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeMcpPromptMessage(entry))
    .filter((entry): entry is ExtensionPromptMessage => entry !== null);
}

function normalizeMcpPromptMessage(entry: unknown): ExtensionPromptMessage | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const record = entry as Record<string, unknown>;
  const role = record.role === "assistant" ? "assistant" : "user";
  const content = record.content;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return null;
  }
  const contentRecord = content as Record<string, unknown>;
  const type = typeof contentRecord.type === "string" ? contentRecord.type : "text";
  if (type === "resource" && contentRecord.resource && typeof contentRecord.resource === "object") {
    const resource = contentRecord.resource as Record<string, unknown>;
    return {
      role,
      contentType: "resource",
      text:
        typeof resource.text === "string"
          ? resource.text
          : typeof resource.uri === "string"
            ? resource.uri
            : JSON.stringify(resource),
    };
  }
  if (type === "image") {
    return {
      role,
      contentType: "image",
      text: typeof contentRecord.mimeType === "string" ? `[image:${contentRecord.mimeType}]` : "[image]",
    };
  }
  if (type === "audio") {
    return {
      role,
      contentType: "audio",
      text: typeof contentRecord.mimeType === "string" ? `[audio:${contentRecord.mimeType}]` : "[audio]",
    };
  }
  return {
    role,
    contentType: "text",
    text: typeof contentRecord.text === "string" ? contentRecord.text : JSON.stringify(contentRecord),
  };
}

function convertMcpToolResult(toolName: string, result: Record<string, unknown>): ToolResult {
  const content = Array.isArray(result.content) ? result.content : [];
  const summary = summarizeMcpContent(content) || `MCP tool ${toolName} completed.`;
  return {
    ok: result.isError !== true,
    summary,
    data: {
      content,
      structuredContent: result.structuredContent,
      isError: result.isError === true,
    },
  };
}

function summarizeMcpContent(content: readonly unknown[]): string {
  const parts = content
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const record = entry as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        return record.text;
      }
      if (record.type === "resource" && record.resource && typeof record.resource === "object") {
        const resource = record.resource as Record<string, unknown>;
        return typeof resource.text === "string"
          ? resource.text
          : typeof resource.uri === "string"
            ? resource.uri
            : "";
      }
      return "";
    })
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parts.join("\n").slice(0, 500);
}

function serializeMcpRuntimeManifest(manifest: McpServerManifest): string {
  if (isMcpHttpManifest(manifest)) {
    return JSON.stringify({
      transport: manifest.transport,
      url: manifest.url,
      headers: sortRedactedRecordEntries(manifest.headers),
      auth: manifest.auth ? { type: manifest.auth.type, tokenEnv: manifest.auth.tokenEnv ?? null, scopes: manifest.auth.scopes ?? [] } : null,
      allowlist: manifest.allowlist ?? null,
      timeoutMs: manifest.timeoutMs ?? null,
    });
  }
  return JSON.stringify({
    transport: "stdio",
    command: manifest.command,
    args: manifest.args ?? [],
    cwd: manifest.cwd ? resolve(manifest.cwd) : process.cwd(),
    env: sortRedactedRecordEntries(manifest.env),
    auth: manifest.auth ? { type: manifest.auth.type, tokenEnv: manifest.auth.tokenEnv ?? null, scopes: manifest.auth.scopes ?? [] } : null,
    allowlist: manifest.allowlist ?? null,
    timeoutMs: manifest.timeoutMs ?? null,
  });
}

function sortRedactedRecordEntries(value: Record<string, string> | undefined): Record<string, string> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, looksLikeSecretKey(key) ? "[REDACTED]" : entry]),
  );
}

function isMcpHttpManifest(manifest: McpServerManifest): manifest is McpHttpServerManifest {
  return manifest.transport === "http" || manifest.transport === "sse";
}

function createMcpRuntime(extensionId: string, key: string, manifest: McpServerManifest): McpRuntimeHandle {
  let session: McpSession | null = null;
  let sessionPromise: Promise<McpSession> | null = null;
  let disposed = false;
  const health: {
    key: string;
    extensionId: string;
    transport: "http" | "sse" | "stdio";
    label: string;
    status: McpRuntimeHealthStatus;
    requestCount: number;
    failureCount: number;
    consecutiveFailureCount: number;
    recoveryCount: number;
    lastMethod?: string;
    lastStartedAt?: string;
    lastSucceededAt?: string;
    lastFailedAt?: string;
    lastRecoveredAt?: string;
    lastDurationMs?: number;
    lastError?: string;
    auth?: McpRuntimeAuthDiagnostics;
  } = {
    key,
    extensionId,
    transport: isMcpHttpManifest(manifest) ? manifest.transport : "stdio",
    label: isMcpHttpManifest(manifest) ? manifest.url : basename(manifest.command),
    status: getMcpAuthRequiredMessage(manifest) ? "auth_required" : "idle",
    requestCount: 0,
    failureCount: 0,
    consecutiveFailureCount: 0,
    recoveryCount: 0,
    auth: getMcpAuthDiagnostics(manifest),
  };

  const recordSuccess = (method: string, startedAtMs: number): void => {
    if (health.status === "failed") {
      health.recoveryCount += 1;
      health.lastRecoveredAt = new Date().toISOString();
    }
    health.status = "healthy";
    health.lastMethod = method;
    health.lastSucceededAt = new Date().toISOString();
    health.lastDurationMs = Date.now() - startedAtMs;
    health.consecutiveFailureCount = 0;
    delete health.lastError;
  };

  const recordFailure = (method: string, error: unknown, startedAtMs: number): void => {
    health.status = "failed";
    health.lastMethod = method;
    health.failureCount += 1;
    health.consecutiveFailureCount += 1;
    health.lastFailedAt = new Date().toISOString();
    health.lastDurationMs = Date.now() - startedAtMs;
    health.lastError = error instanceof Error ? error.message : String(error);
  };

  const recordAuthRequired = (method: string, error: McpAuthRequiredError, startedAtMs: number): void => {
    health.status = "auth_required";
    health.lastMethod = method;
    health.lastFailedAt = new Date().toISOString();
    health.lastDurationMs = Date.now() - startedAtMs;
    health.lastError = error.message;
    health.auth = getMcpAuthDiagnostics(manifest);
  };

  const ensureSession = async (): Promise<McpSession> => {
    if (disposed) {
      throw new Error("MCP runtime has already been disposed.");
    }
    const authRequired = getMcpAuthRequiredMessage(manifest);
    if (authRequired) {
      throw new McpAuthRequiredError(authRequired);
    }
    if (session) {
      return session;
    }
    if (!sessionPromise) {
      health.status = "starting";
      health.lastMethod = "initialize";
      health.lastStartedAt = new Date().toISOString();
      const startedAtMs = Date.now();
      sessionPromise = (isMcpHttpManifest(manifest) ? createHttpMcpSession(manifest) : createStdioMcpSession(manifest))
        .then((connected) => {
          session = connected;
          recordSuccess("initialize", startedAtMs);
          return connected;
        })
        .catch((error) => {
          sessionPromise = null;
          session = null;
          recordFailure("initialize", error, startedAtMs);
          throw error;
        });
    }
    return sessionPromise;
  };

  return {
    getHealth(): McpRuntimeHealth {
      return { ...health };
    },
    async request<TResult>(method: string, params?: Record<string, unknown>): Promise<TResult> {
      health.requestCount += 1;
      health.lastMethod = method;
      const startedAtMs = Date.now();
      health.lastStartedAt = new Date(startedAtMs).toISOString();
      try {
        const result = await (await ensureSession()).request<TResult>(method, params);
        recordSuccess(method, startedAtMs);
        return result;
      } catch (error) {
        if (error instanceof McpAuthRequiredError) {
          recordAuthRequired(method, error, startedAtMs);
        } else {
          recordFailure(method, error, startedAtMs);
        }
        throw error;
      }
    },
    async notify(method: string, params?: Record<string, unknown>): Promise<void> {
      health.requestCount += 1;
      health.lastMethod = method;
      const startedAtMs = Date.now();
      health.lastStartedAt = new Date(startedAtMs).toISOString();
      try {
        await (await ensureSession()).notify(method, params);
        recordSuccess(method, startedAtMs);
      } catch (error) {
        if (error instanceof McpAuthRequiredError) {
          recordAuthRequired(method, error, startedAtMs);
        } else {
          recordFailure(method, error, startedAtMs);
        }
        throw error;
      }
    },
    async dispose(): Promise<void> {
      disposed = true;
      const activeSession = session ?? (sessionPromise ? await sessionPromise.catch(() => null) : null);
      session = null;
      sessionPromise = null;
      await activeSession?.dispose();
      health.status = "disposed";
    },
  };
}

async function createStdioMcpSession(manifest: McpStdioServerManifest): Promise<McpSession> {
  const authEnv = resolveMcpAuthEnv(manifest);
  const child = spawn(manifest.command, manifest.args ?? [], {
    cwd: manifest.cwd ? resolve(manifest.cwd) : process.cwd(),
    env: {
      ...process.env,
      ...(manifest.env ?? {}),
      ...(authEnv ?? {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
  let nextId = 1;
  let stderrBuffer = "";
  let stdoutBuffer = "";
  let exitError: Error | null = null;
  let closed = false;
  let disposing = false;
  let exited = false;
  let fullyClosed = false;
  const exitPromise = new Promise<void>((resolvePromise) => {
    child.once("exit", () => {
      exited = true;
      resolvePromise();
    });
  });
  const closePromise = new Promise<void>((resolvePromise) => {
    child.once("close", () => {
      fullyClosed = true;
      resolvePromise();
    });
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrBuffer += chunk;
    if (stderrBuffer.length > 8_192) {
      stderrBuffer = stderrBuffer.slice(-8_192);
    }
  });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        handleMcpResponseLine(line, pending);
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });

  child.once("error", (error) => {
    exitError = error;
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  });

  child.once("exit", (code, signal) => {
    closed = true;
    if (!exitError && (code !== 0 || signal)) {
      exitError = new Error(
        `MCP stdio server exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}${
          stderrBuffer ? `: ${stderrBuffer.trim()}` : ""
        }`,
      );
    }
    if (exitError) {
      for (const entry of pending.values()) {
        entry.reject(exitError);
      }
      pending.clear();
    }
  });
  child.unref();
  (child.stdin as { unref?: () => void } | null)?.unref?.();
  (child.stdout as { unref?: () => void } | null)?.unref?.();
  (child.stderr as { unref?: () => void } | null)?.unref?.();

  const timeoutMs = manifest.timeoutMs ?? 15_000;
  const client: McpSession = {
    request<TResultResponse>(method: string, params?: Record<string, unknown>): Promise<TResultResponse> {
      return new Promise<TResultResponse>((resolve, reject) => {
        if (closed) {
          reject(exitError ?? new Error(`MCP stdio server is closed before ${method}.`));
          return;
        }
        const id = nextId++;
        pending.set(id, {
          resolve: (value) => resolve(value as TResultResponse),
          reject,
        });
        const payload = JSON.stringify({
          jsonrpc: "2.0",
          id,
          method,
          params,
        });
        child.stdin.write(`${payload}\n`, "utf8");
        const timeout = setTimeout(() => {
          if (pending.delete(id)) {
            reject(new Error(`MCP stdio request timed out for ${method}.`));
          }
        }, timeoutMs);
        const original = pending.get(id);
        if (original) {
          pending.set(id, {
            resolve: (value) => {
              clearTimeout(timeout);
              original.resolve(value);
            },
            reject: (reason) => {
              clearTimeout(timeout);
              original.reject(reason);
            },
          });
        }
      });
    },
    async notify(method: string, params?: Record<string, unknown>): Promise<void> {
      if (closed) {
        throw exitError ?? new Error(`MCP stdio server is closed before ${method}.`);
      }
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method,
          params,
        })}\n`,
        "utf8",
      );
    },
    async dispose(): Promise<void> {
      if (closed) {
        await exitPromise;
        return;
      }
      if (disposing) {
        await exitPromise;
        return;
      }
      disposing = true;
      await client.request("shutdown").catch(() => undefined);
      await client.notify("exit").catch(() => undefined);
      child.stdin.end();
      closed = true;
      await Promise.race([
        closePromise,
        new Promise((resolvePromise) => setTimeout(resolvePromise, 300)),
      ]);
      if ((!exited || !fullyClosed) && child.pid) {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        if (process.platform === "win32") {
          spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        } else {
          child.kill("SIGKILL");
        }
        child.unref();
        await Promise.race([
          closePromise,
          new Promise((resolvePromise) => setTimeout(resolvePromise, 300)),
        ]);
      }
    },
  };

  await client.request("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: "omni-agent",
      version: "0.1.0",
    },
  });
  await client.notify("notifications/initialized");
  return client;
}

async function createHttpMcpSession(manifest: McpHttpServerManifest): Promise<McpSession> {
  let sessionId: string | null = null;
  const timeoutMs = manifest.timeoutMs ?? 15_000;
  let nextId = 1;
  let closed = false;
  let disposing = false;
  const client: McpSession = {
    async request<TResultResponse>(method: string, params?: Record<string, unknown>): Promise<TResultResponse> {
      if (closed) {
        throw new Error(`MCP HTTP session is closed before ${method}.`);
      }
      const response = await sendHttpMcpRequest(manifest, {
        jsonrpc: "2.0",
        id: nextId++,
        method,
        params,
      }, {
        sessionId,
        timeoutMs,
      });
      sessionId = response.sessionId ?? sessionId;
      if (response.error) {
        throw new Error(`MCP HTTP request failed for ${method}: ${response.error}`);
      }
      return response.result as TResultResponse;
    },
    async notify(method: string, params?: Record<string, unknown>): Promise<void> {
      if (closed) {
        throw new Error(`MCP HTTP session is closed before ${method}.`);
      }
      const response = await sendHttpMcpRequest(manifest, {
        jsonrpc: "2.0",
        method,
        params,
      }, {
        sessionId,
        timeoutMs,
      });
      sessionId = response.sessionId ?? sessionId;
      if (response.error) {
        throw new Error(`MCP HTTP notification failed for ${method}: ${response.error}`);
      }
    },
    async dispose(): Promise<void> {
      if (closed) {
        return;
      }
      if (disposing) {
        return;
      }
      disposing = true;
      await client.request("shutdown").catch(() => undefined);
      await client.notify("exit").catch(() => undefined);
      sessionId = null;
      closed = true;
    },
  };

  await client.request("initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: "omni-agent",
      version: "0.1.0",
    },
  });
  await client.notify("notifications/initialized");
  return client;
}

async function sendHttpMcpRequest(
  manifest: McpHttpServerManifest,
  body: Record<string, unknown>,
  options: {
    readonly sessionId: string | null;
    readonly timeoutMs: number;
  },
): Promise<{ readonly result?: unknown; readonly error?: string; readonly sessionId?: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(manifest.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        connection: "close",
        "mcp-protocol-version": MCP_PROTOCOL_VERSION,
        ...(options.sessionId ? { "mcp-session-id": options.sessionId } : {}),
        ...(manifest.headers ?? {}),
        ...resolveMcpAuthHeaders(manifest),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const sessionId = response.headers.get("mcp-session-id");
    const raw = await response.text();
    if (!response.ok) {
      return {
        error: raw || `HTTP ${response.status}`,
        sessionId,
      };
    }
    const parsed = parseMcpHttpResponseBody(raw);
    return {
      result: parsed.result,
      error: parsed.error,
      sessionId,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseMcpHttpResponseBody(raw: string): { readonly result?: unknown; readonly error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const dataLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length > 0) {
    return parseMcpJsonRpcPayload(dataLines[dataLines.length - 1] ?? "");
  }
  return parseMcpJsonRpcPayload(trimmed);
}

function parseMcpJsonRpcPayload(raw: string): { readonly result?: unknown; readonly error?: string } {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.error && typeof parsed.error === "object" && !Array.isArray(parsed.error)) {
    const errorRecord = parsed.error as Record<string, unknown>;
    return {
      error:
        typeof errorRecord.message === "string"
          ? errorRecord.message
          : JSON.stringify(errorRecord),
    };
  }
  return {
    result: parsed.result,
  };
}

function handleMcpResponseLine(
  line: string,
  pending: Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>,
): void {
  const payload = JSON.parse(line) as Record<string, unknown>;
  if (typeof payload.id !== "number") {
    return;
  }
  const waiter = pending.get(payload.id);
  if (!waiter) {
    return;
  }
  pending.delete(payload.id);
  if (payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)) {
    const errorRecord = payload.error as Record<string, unknown>;
    waiter.reject(
      new Error(
        typeof errorRecord.message === "string" ? errorRecord.message : JSON.stringify(errorRecord),
      ),
    );
    return;
  }
  waiter.resolve(payload.result);
}

function createManifestToolDefinition(manifest: FixedCommandToolManifest): ToolDefinition {
  return {
    name: manifest.name,
    description: `${manifest.description} (command: ${basename(manifest.command.split(/\s+/)[0] ?? manifest.name)})`,
    inputHint: manifest.inputHint ?? "{}",
    riskHint: manifest.riskHint ?? "extension command",
    async execute(context): Promise<ToolResult> {
      const result = await context.workspace.runCommand(manifest.command, {
        cwd: manifest.cwd,
        timeoutMs: manifest.timeoutMs ?? 120_000,
      });
      const successExitCodes = manifest.successExitCodes ?? [];
      const ok = result.ok || successExitCodes.includes(result.exitCode);
      return {
        ok,
        summary: `${ok ? "Ran" : "Failed"} extension command: ${manifest.command}`,
        data: result,
        artifactPaths: result.artifactPath ? [result.artifactPath] : [],
      };
    },
  };
}

function createBridgeToolDefinition(
  manifest: BridgeToolManifest,
  bridge: BridgeManifest,
  sourcePath: string,
): ToolDefinition {
  const bridgeCwd =
    bridge.transport === "http"
      ? undefined
      : resolve(dirname(sourcePath), bridge.cwd ?? ".");
  const bridgeLabel = bridge.transport === "http" ? bridge.url : basename(bridge.command);
  return {
    name: manifest.name,
    description: `${manifest.description} (bridge: ${bridgeLabel})`,
    inputHint: manifest.inputHint ?? "{}",
    riskHint: manifest.riskHint ?? "external bridge",
    async execute(context, args): Promise<ToolResult> {
      return executeBridgeTool({
        bridge,
        bridgeCwd,
        toolName: manifest.name,
        args,
        context,
      });
    },
  };
}

async function executeBridgeTool(input: {
  readonly bridge: BridgeManifest;
  readonly bridgeCwd?: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly context: Parameters<ToolDefinition["execute"]>[0];
}): Promise<ToolResult> {
  const { bridge } = input;
  if (bridge.transport === "http") {
    return executeHttpBridgeTool({
      bridge,
      toolName: input.toolName,
      args: input.args,
      context: input.context,
    });
  }
  return executeStdioBridgeTool({
    bridge,
    bridgeCwd: input.bridgeCwd ?? process.cwd(),
    toolName: input.toolName,
    args: input.args,
    context: input.context,
  });
}

async function executeStdioBridgeTool(input: {
  readonly bridge: StdioBridgeManifest;
  readonly bridgeCwd: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly context: Parameters<ToolDefinition["execute"]>[0];
}): Promise<ToolResult> {
  const payload = JSON.stringify({
    toolName: input.toolName,
    args: input.args,
    context: {
      workspaceRoot: input.context.workspace.root,
      executionDomain: input.context.executionDomain,
      workspaceId: input.context.workspaceId ?? null,
      threadId: input.context.threadId ?? null,
      runId: input.context.runId ?? null,
    },
  });
  const result = spawnSync(input.bridge.command, input.bridge.args ?? [], {
    cwd: input.bridgeCwd,
    env: {
      ...process.env,
      ...(input.bridge.env ?? {}),
    },
    input: payload,
    encoding: "utf8",
    timeout: input.bridge.timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });

  if (result.error) {
    return {
      ok: false,
      summary: `Bridge tool ${input.toolName} failed to start: ${result.error.message}`,
      data: { error: result.error.message },
    };
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  if (result.signal) {
    return {
      ok: false,
      summary: `Bridge tool ${input.toolName} timed out.`,
      data: { stdout, stderr, signal: result.signal },
    };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      summary: `Bridge tool ${input.toolName} exited with code ${result.status}.`,
      data: { stdout, stderr, exitCode: result.status },
    };
  }

  const parsed = parseBridgeResult(stdout);
  if (parsed) {
    return parsed;
  }

  return {
    ok: true,
    summary: `Bridge tool ${input.toolName} completed successfully.`,
    data: {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    },
  };
}

async function executeHttpBridgeTool(input: {
  readonly bridge: HttpBridgeManifest;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly context: Parameters<ToolDefinition["execute"]>[0];
}): Promise<ToolResult> {
  const controller = new AbortController();
  const timeoutHandle =
    input.bridge.timeoutMs && input.bridge.timeoutMs > 0
      ? setTimeout(() => controller.abort(), input.bridge.timeoutMs)
      : null;

  try {
    const response = await fetch(input.bridge.url, {
      method: input.bridge.method ?? "POST",
      headers: {
        "content-type": "application/json",
        ...(input.bridge.headers ?? {}),
      },
      body: JSON.stringify({
        toolName: input.toolName,
        args: input.args,
        context: {
          workspaceRoot: input.context.workspace.root,
          executionDomain: input.context.executionDomain,
          workspaceId: input.context.workspaceId ?? null,
          threadId: input.context.threadId ?? null,
          runId: input.context.runId ?? null,
        },
      }),
      signal: controller.signal,
    });
    const stdout = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        summary: `Bridge tool ${input.toolName} returned HTTP ${response.status}.`,
        data: {
          status: response.status,
          body: stdout,
        },
      };
    }
    const parsed = parseBridgeResult(stdout);
    if (parsed) {
      return parsed;
    }
    return {
      ok: true,
      summary: `Bridge tool ${input.toolName} completed successfully over HTTP.`,
      data: {
        body: stdout.trim(),
        status: response.status,
      },
    };
  } catch (error) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      summary: aborted
        ? `Bridge tool ${input.toolName} timed out.`
        : `Bridge tool ${input.toolName} failed over HTTP: ${error instanceof Error ? error.message : String(error)}`,
      data: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function parseBridgeResult(stdout: string): ToolResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as Partial<ToolResult> & Record<string, unknown>;
    if (typeof parsed.ok === "boolean" && typeof parsed.summary === "string") {
      return {
        ok: parsed.ok,
        summary: parsed.summary,
        data: parsed.data,
        artifactPaths: Array.isArray(parsed.artifactPaths)
          ? parsed.artifactPaths.map((entry) => String(entry))
          : undefined,
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map((entry) => String(entry)) : undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function invalidBridgeTransport(sourcePath: string): never {
  throw new Error(`${sourcePath}: bridge.transport must be "stdio" or "http".`);
}

function invalidMcpTransport(sourcePath: string): never {
  throw new Error(`${sourcePath}: mcp.transport must be "stdio", "http", or "sse".`);
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function normalizeHeaderKeys(headers: Record<string, string>): Set<string> {
  return new Set(Object.keys(headers).map((key) => key.trim().toLowerCase()).filter(Boolean));
}

function looksLikeSecretKey(key: string): boolean {
  return /(authorization|token|secret|api[_-]?key|password)/i.test(key);
}

function looksLikeInlineSecret(key: string, value: string): boolean {
  const normalizedKey = key.toLowerCase();
  if (!looksLikeSecretKey(normalizedKey)) {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return !/^\$\{?[A-Z0-9_]+\}?$/i.test(trimmed) && !trimmed.startsWith("env:");
}

function getMcpAuthDiagnostics(manifest: McpServerManifest): McpRuntimeAuthDiagnostics | undefined {
  if (!manifest.auth) {
    return undefined;
  }
  const token = getMcpOAuthToken(manifest);
  return {
    type: "oauth",
    tokenEnv: manifest.auth.tokenEnv,
    scopes: manifest.auth.scopes,
    configured: Boolean(token),
    token: token ? "[REDACTED]" : undefined,
  };
}

function getMcpAuthRequiredMessage(manifest: McpServerManifest): string | null {
  if (!manifest.auth) {
    return null;
  }
  if (manifest.auth.type === "oauth" && !getMcpOAuthToken(manifest)) {
    return manifest.auth.tokenEnv
      ? `auth_required: MCP OAuth token environment variable ${manifest.auth.tokenEnv} is not configured.`
      : "auth_required: MCP OAuth tokenEnv is not configured.";
  }
  return null;
}

function getMcpOAuthToken(manifest: McpServerManifest): string | null {
  const tokenEnv = manifest.auth?.type === "oauth" ? manifest.auth.tokenEnv : undefined;
  if (!tokenEnv) {
    return null;
  }
  const token = process.env[tokenEnv];
  return typeof token === "string" && token.trim().length > 0 ? token : null;
}

function resolveMcpAuthHeaders(manifest: McpHttpServerManifest): Record<string, string> {
  const token = getMcpOAuthToken(manifest);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function resolveMcpAuthEnv(manifest: McpStdioServerManifest): Record<string, string> | undefined {
  const tokenEnv = manifest.auth?.type === "oauth" ? manifest.auth.tokenEnv : undefined;
  const token = getMcpOAuthToken(manifest);
  return tokenEnv && token ? { [tokenEnv]: token } : undefined;
}

function normalizePositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.trunc(parsed);
}
