import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { access, appendFile, cp, lstat, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

import { redactSensitiveText } from "@omni-agent/safety";

export type ExecutionDomain = "workspace" | "worktree" | "sandbox";
export type ExecutionBackendKind = "codesandbox" | "daytona" | "docker" | "e2b" | "local" | "managed-cloud" | "modal" | "ssh";
export type WorkspaceCapability = "search" | "read" | "write" | "command" | "control";

export interface ExecutionBackendDescriptor {
  readonly id: ExecutionBackendKind;
  readonly label: string;
  readonly description: string;
  readonly supportsRemoteWorkspace: boolean;
  readonly supportsFileSync: boolean;
  readonly status: "available" | "configured" | "missing_config";
  readonly requiredEnv: readonly string[];
}

export type CloudRunnerLifecycleAction = "create" | "destroy" | "logs" | "status" | "sync";

export interface CloudRunnerLifecycleRequest {
  readonly provider: Exclude<ExecutionBackendKind, "docker" | "local" | "managed-cloud" | "ssh">;
  readonly action: CloudRunnerLifecycleAction;
  readonly workspaceId?: string;
  readonly cwd?: string;
  readonly files?: readonly { readonly path: string; readonly content: string }[];
  readonly metadata?: Record<string, unknown>;
}

export interface CloudRunnerLifecycleResult {
  readonly ok: boolean;
  readonly provider: CloudRunnerLifecycleRequest["provider"];
  readonly action: CloudRunnerLifecycleAction;
  readonly status: number;
  readonly workspaceId: string | null;
  readonly summary: string;
  readonly data: unknown;
}

export interface WorkspaceExecutionPolicy {
  readonly executionDomain: ExecutionDomain;
  readonly capabilities: readonly WorkspaceCapability[];
}

const EXECUTION_DOMAIN_CAPABILITIES: Record<ExecutionDomain, readonly WorkspaceCapability[]> = {
  workspace: ["search", "read", "write", "command", "control"],
  worktree: ["search", "read", "write", "command"],
  sandbox: ["search", "read", "write", "command"],
};

export function listExecutionBackends(env: NodeJS.ProcessEnv = process.env): ExecutionBackendDescriptor[] {
  return [
    {
      id: "local",
      label: "Local",
      description: "Run commands directly in the selected workspace.",
      supportsRemoteWorkspace: false,
      supportsFileSync: false,
      status: "available",
      requiredEnv: [],
    },
    {
      id: "docker",
      label: "Docker",
      description: "Run commands inside OMNI_AGENT_DOCKER_IMAGE with the workspace mounted at /workspace.",
      supportsRemoteWorkspace: false,
      supportsFileSync: false,
      status: env.OMNI_AGENT_DOCKER_IMAGE ? "configured" : "missing_config",
      requiredEnv: ["OMNI_AGENT_DOCKER_IMAGE"],
    },
    {
      id: "ssh",
      label: "SSH",
      description: "Run commands through an SSH host using OMNI_AGENT_SSH_HOST and optional user, port, and workdir settings.",
      supportsRemoteWorkspace: true,
      supportsFileSync: true,
      status: env.OMNI_AGENT_SSH_HOST ? "configured" : "missing_config",
      requiredEnv: ["OMNI_AGENT_SSH_HOST"],
    },
    {
      id: "managed-cloud",
      label: "Managed Cloud",
      description: "Send command executions to an HTTP cloud runner configured by OMNI_AGENT_CLOUD_BACKEND.",
      supportsRemoteWorkspace: true,
      supportsFileSync: true,
      status: env.OMNI_AGENT_CLOUD_BACKEND ? "configured" : "missing_config",
      requiredEnv: ["OMNI_AGENT_CLOUD_BACKEND"],
    },
    {
      id: "modal",
      label: "Modal",
      description: "Send command executions to a Modal web endpoint configured by OMNI_AGENT_MODAL_ENDPOINT.",
      supportsRemoteWorkspace: true,
      supportsFileSync: true,
      status: env.OMNI_AGENT_MODAL_ENDPOINT ? "configured" : "missing_config",
      requiredEnv: ["OMNI_AGENT_MODAL_ENDPOINT"],
    },
    {
      id: "e2b",
      label: "E2B",
      description: "Send command executions to an E2B sandbox bridge configured by OMNI_AGENT_E2B_ENDPOINT.",
      supportsRemoteWorkspace: true,
      supportsFileSync: true,
      status: env.OMNI_AGENT_E2B_ENDPOINT ? "configured" : "missing_config",
      requiredEnv: ["OMNI_AGENT_E2B_ENDPOINT"],
    },
    {
      id: "daytona",
      label: "Daytona",
      description: "Send command executions to a Daytona workspace bridge configured by OMNI_AGENT_DAYTONA_ENDPOINT.",
      supportsRemoteWorkspace: true,
      supportsFileSync: true,
      status: env.OMNI_AGENT_DAYTONA_ENDPOINT ? "configured" : "missing_config",
      requiredEnv: ["OMNI_AGENT_DAYTONA_ENDPOINT"],
    },
    {
      id: "codesandbox",
      label: "CodeSandbox",
      description: "Send command executions to a CodeSandbox sandbox bridge configured by OMNI_AGENT_CODESANDBOX_ENDPOINT.",
      supportsRemoteWorkspace: true,
      supportsFileSync: true,
      status: env.OMNI_AGENT_CODESANDBOX_ENDPOINT ? "configured" : "missing_config",
      requiredEnv: ["OMNI_AGENT_CODESANDBOX_ENDPOINT"],
    },
  ];
}

export function listCloudRunnerProviders(env: NodeJS.ProcessEnv = process.env): ExecutionBackendDescriptor[] {
  return listExecutionBackends(env).filter((entry) =>
    entry.id === "modal" || entry.id === "e2b" || entry.id === "daytona" || entry.id === "codesandbox"
  );
}

export async function runCloudRunnerLifecycleAction(
  request: CloudRunnerLifecycleRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<CloudRunnerLifecycleResult> {
  const provider = resolveNamedCloudExecutionProvider(request.provider);
  if (!provider) {
    throw new Error(`Unsupported cloud runner provider: ${request.provider}.`);
  }
  const endpoint = env[provider.endpointEnv]?.trim();
  if (!endpoint) {
    throw new Error(`${provider.label} cloud runner lifecycle requires ${provider.endpointEnv}.`);
  }
  const token = env[provider.tokenEnv]?.trim();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers[provider.authHeaderName] = `${provider.authPrefix}${token}`;
  }
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: request.provider,
      action: request.action,
      workspaceId: request.workspaceId ?? null,
      cwd: request.cwd ?? null,
      files: request.files ?? [],
      metadata: request.metadata ?? {},
    }),
  });
  const text = await response.text();
  const data = parseJsonOrText(text);
  const workspaceId = readLifecycleWorkspaceId(data) ?? request.workspaceId ?? null;
  const summary = readLifecycleSummary(data) ?? `${provider.label} ${request.action} returned HTTP ${response.status}.`;
  return {
    ok: response.ok && readLifecycleOk(data),
    provider: request.provider,
    action: request.action,
    status: response.status,
    workspaceId,
    summary,
    data,
  };
}

export function createWorkspaceExecutionPolicy(
  executionDomain: ExecutionDomain,
  capabilities?: readonly WorkspaceCapability[],
): WorkspaceExecutionPolicy {
  return {
    executionDomain,
    capabilities: [...(capabilities ?? EXECUTION_DOMAIN_CAPABILITIES[executionDomain])],
  };
}

export interface WorkspaceSnapshot {
  readonly cwd: string;
  readonly repoRoot: string | null;
  readonly repoName: string;
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly isGitRepo: boolean;
  readonly gitStatusLines: string[];
  readonly changedFiles: string[];
  readonly detectedFiles: string[];
  readonly packageManager: "pnpm" | "npm" | "python" | "cargo" | "unknown";
  readonly packageScripts: string[];
}

export interface CommandExecutionResult {
  readonly ok: boolean;
  readonly command: string;
  readonly cwd: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly artifactPath?: string;
}

export interface VerificationExecutionResult {
  readonly ok: boolean;
  readonly commands: string[];
  readonly results: CommandExecutionResult[];
}

export interface FileEditResult {
  readonly path: string;
  readonly bytes: number;
  readonly replacements: number;
}

export type TransactionalPatchOperation =
  | {
      readonly type: "replace";
      readonly path: string;
      readonly oldText: string;
      readonly newText: string;
      readonly expectedHash?: string;
      readonly expectedOldText?: string;
    }
  | {
      readonly type: "write";
      readonly path: string;
      readonly content: string;
      readonly expectedHash?: string;
      readonly expectedOldText?: string;
    }
  | {
      readonly type: "range";
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
      readonly newText: string;
      readonly expectedHash?: string;
      readonly expectedOldText?: string;
    };

export interface TransactionalPatchResult {
  readonly files: FileEditResult[];
}

export interface WorkspaceCheckpointRecord {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly createdAt: string;
  readonly preservedExternalTopLevelEntries?: readonly string[];
}

export interface TextSearchMatch {
  readonly path: string;
  readonly lineNumber: number;
  readonly lineText: string;
}

export interface GitDiffSummary {
  readonly changedFiles: string[];
  readonly stat: string;
  readonly patchPreview: string;
}

export interface WorkspaceInstructionFile {
  readonly path: string;
  readonly scope: string;
  readonly name: string;
  readonly content: string;
  readonly truncated: boolean;
}

export interface WorkspaceMemoryFile {
  readonly path: string;
  readonly kind: "daily" | "memory" | "user";
  readonly content: string;
  readonly truncated: boolean;
}

export type WorkspaceMemoryFileKind = WorkspaceMemoryFile["kind"];

export interface WorkspaceMemorySearchResult {
  readonly path: string;
  readonly kind: WorkspaceMemoryFileKind;
  readonly content: string;
  readonly matchCount: number;
}

export interface WorkspaceSkillFile {
  readonly path: string;
  readonly name: string;
  readonly description: string | null;
  readonly tags: string[];
  readonly relatedSkills: string[];
  readonly content: string;
  readonly truncated: boolean;
  readonly supportingPaths: string[];
}

export interface WorkspaceSkillIndexEntry {
  readonly path: string;
  readonly name: string;
  readonly description: string | null;
  readonly tags: string[];
  readonly relatedSkills: string[];
}

export interface MaterializedLearnedSkillInput {
  readonly title: string;
  readonly problemPattern: string;
  readonly guidance: string;
  readonly triggerSignals: readonly string[];
  readonly procedureSteps: readonly string[];
  readonly verificationSummary: string;
  readonly tags: readonly string[];
  readonly changedFiles: readonly string[];
  readonly revisionCount: number;
}

export interface MaterializedLearnedSkillResult extends FileEditResult {
  readonly directory: string;
}

interface WorkspaceSkillFrontmatter {
  readonly name: string | null;
  readonly description: string | null;
  readonly tags: string[];
  readonly relatedSkills: string[];
  readonly disabled: boolean;
  readonly platforms: string[];
  readonly os: string[];
  readonly externalDirs: string[];
}

const SIGNAL_FILES = ["package.json", "pnpm-lock.yaml", "pyproject.toml", "Cargo.toml", "Makefile", "verify.js"];
const WORKSPACE_INSTRUCTION_FILE_NAMES = [
  ".hermes.md",
  "HERMES.md",
  "AGENTS.md",
  "agents.md",
  "CLAUDE.md",
  "claude.md",
  "SOUL.md",
  "soul.md",
  "TOOLS.md",
  "tools.md",
  ".cursorrules",
];
const WORKSPACE_LOCAL_INSTRUCTION_FILE_NAMES = ["CLAUDE.local.md", "claude.local.md"];
const WORKSPACE_DOT_CLAUDE_FILE_NAMES = [join(".claude", "CLAUDE.md"), join(".claude", "claude.md")];
const WORKSPACE_DOT_CLAUDE_RULES_DIR = join(".claude", "rules");
const WORKSPACE_DOT_CURSOR_RULES_DIR = join(".cursor", "rules");
const WORKSPACE_SKILL_DIRECTORIES = ["skills", join(".agents", "skills")];
const DEFAULT_MAX_WORKSPACE_INSTRUCTION_FILES = 8;
const DEFAULT_MAX_WORKSPACE_INSTRUCTION_CHARS_PER_FILE = 8_000;
const DEFAULT_MAX_WORKSPACE_INSTRUCTION_TOTAL_CHARS = 20_000;
const DEFAULT_MAX_WORKSPACE_INSTRUCTION_INCLUDE_DEPTH = 5;
const DEFAULT_MAX_WORKSPACE_MEMORY_FILES = 4;
const DEFAULT_MAX_WORKSPACE_MEMORY_CHARS_PER_FILE = 4_000;
const DEFAULT_MAX_WORKSPACE_MEMORY_TOTAL_CHARS = 10_000;
const DEFAULT_MAX_WORKSPACE_SKILL_FILES = 4;
const DEFAULT_MAX_WORKSPACE_SKILL_CHARS_PER_FILE = 4_000;
const DEFAULT_MAX_WORKSPACE_SKILL_TOTAL_CHARS = 12_000;
const INSTRUCTION_THREAT_PATTERNS: Array<readonly [RegExp, string]> = [
  [/ignore\s+(previous|all|above|prior)\s+instructions/i, "prompt_injection"],
  [/do\s+not\s+tell\s+the\s+user/i, "deception_hide"],
  [/system\s+prompt\s+override/i, "sys_prompt_override"],
  [/disregard\s+(your|all|any)\s+(instructions|rules|guidelines)/i, "disregard_rules"],
  [/act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)\s+(restrictions|limits|rules)/i, "bypass_restrictions"],
  [/<!--[^>]*(?:ignore|override|system|secret|hidden)[^>]*-->/i, "html_comment_injection"],
  [/<\s*div\s+style\s*=\s*["'][\s\S]*?display\s*:\s*none/i, "hidden_div"],
  [/translate\s+.*\s+into\s+.*\s+and\s+(execute|run|eval)/i, "translate_execute"],
  [/curl\s+[^\n]*\$\{?\w*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|API)/i, "exfil_curl"],
  [/cat\s+[^\n]*(\.env|credentials|\.netrc|\.pgpass)/i, "read_secrets"],
];
const INSTRUCTION_INVISIBLE_CHARS = new Set([
  "\u200b",
  "\u200c",
  "\u200d",
  "\u2060",
  "\ufeff",
  "\u202a",
  "\u202b",
  "\u202c",
  "\u202d",
  "\u202e",
]);
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", ".omni-agent", "dist", "build", "coverage"]);
const CHECKPOINT_MANIFEST_FILE = "omni-checkpoint.json";
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".ico",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".db",
  ".sqlite",
  ".bin",
]);

function buildWorkspaceCommandEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_PREFIX",
    "GIT_WORK_TREE",
  ]) {
    delete env[key];
  }
  return env;
}

function resolveCommandExecutionBackend(
  command: string,
  cwd: string,
  workspaceRoot: string,
): { readonly command: string; readonly cwd: string; readonly displayCommand: string } {
  const backend = process.env.OMNI_AGENT_EXECUTION_BACKEND?.trim().toLowerCase() || "local";
  if (backend === "docker") {
    const image = process.env.OMNI_AGENT_DOCKER_IMAGE?.trim();
    if (!image) {
      return {
        command: buildNodeFailureCommand("Docker execution backend requires OMNI_AGENT_DOCKER_IMAGE."),
        cwd,
        displayCommand: `${command} [docker backend unavailable: OMNI_AGENT_DOCKER_IMAGE is not set]`,
      };
    }
    const relativeCwd = relative(workspaceRoot, cwd).replace(/\\/g, "/");
    const containerCwd = relativeCwd && !relativeCwd.startsWith("..") ? `/workspace/${relativeCwd}` : "/workspace";
    const dockerCommand = [
      "docker run --rm",
      `-v "${workspaceRoot}:/workspace"`,
      `-w "${containerCwd}"`,
      image,
      "sh -lc",
      JSON.stringify(command),
    ].join(" ");
    return {
      command: dockerCommand,
      cwd: workspaceRoot,
      displayCommand: `[docker:${image}] ${command}`,
    };
  }
  if (backend === "ssh") {
    const host = process.env.OMNI_AGENT_SSH_HOST?.trim();
    if (!host) {
      return {
        command: buildNodeFailureCommand("SSH execution backend requires OMNI_AGENT_SSH_HOST."),
        cwd,
        displayCommand: `${command} [ssh backend unavailable: OMNI_AGENT_SSH_HOST is not set]`,
      };
    }
    const user = process.env.OMNI_AGENT_SSH_USER?.trim();
    const port = process.env.OMNI_AGENT_SSH_PORT?.trim();
    const remoteWorkdir = process.env.OMNI_AGENT_SSH_WORKDIR?.trim() || "/workspace";
    const target = user ? `${user}@${host}` : host;
    const remoteCommand = `cd ${quoteShellArgument(remoteWorkdir)} && ${command}`;
    const sshCommand = [
      "ssh",
      port ? `-p ${quoteShellArgument(port)}` : null,
      quoteShellArgument(target),
      quoteShellArgument(remoteCommand),
    ].filter((entry): entry is string => entry !== null).join(" ");
    return {
      command: sshCommand,
      cwd: workspaceRoot,
      displayCommand: `[ssh:${target}] ${command}`,
    };
  }
  if (backend === "managed-cloud") {
    const endpoint = process.env.OMNI_AGENT_CLOUD_BACKEND?.trim();
    if (!endpoint) {
      return {
        command: buildNodeFailureCommand("Managed cloud execution backend requires OMNI_AGENT_CLOUD_BACKEND."),
        cwd,
        displayCommand: `${command} [managed-cloud backend unavailable: OMNI_AGENT_CLOUD_BACKEND is not set]`,
      };
    }
    return {
      command: buildManagedCloudExecutionCommand({
        endpoint,
        command,
        cwd,
        workspaceRoot,
        provider: "managed-cloud",
        tokenEnv: "OMNI_AGENT_CLOUD_TOKEN",
        authHeaderName: "authorization",
        authPrefix: "Bearer ",
      }),
      cwd: workspaceRoot,
      displayCommand: `[managed-cloud:${endpoint}] ${command}`,
    };
  }
  const cloudProvider = resolveNamedCloudExecutionProvider(backend);
  if (cloudProvider) {
    const endpoint = process.env[cloudProvider.endpointEnv]?.trim();
    if (!endpoint) {
      return {
        command: buildNodeFailureCommand(`${cloudProvider.label} execution backend requires ${cloudProvider.endpointEnv}.`),
        cwd,
        displayCommand: `${command} [${backend} backend unavailable: ${cloudProvider.endpointEnv} is not set]`,
      };
    }
    return {
      command: buildManagedCloudExecutionCommand({
        endpoint,
        command,
        cwd,
        workspaceRoot,
        provider: backend,
        tokenEnv: cloudProvider.tokenEnv,
        authHeaderName: cloudProvider.authHeaderName,
        authPrefix: cloudProvider.authPrefix,
      }),
      cwd: workspaceRoot,
      displayCommand: `[${backend}:${endpoint}] ${command}`,
    };
  }
  return { command, cwd, displayCommand: command };
}

function buildNodeFailureCommand(message: string): string {
  const script = `console.error(${JSON.stringify(message)}); process.exit(127);`;
  return buildNodeScriptCommand(script);
}

function buildManagedCloudExecutionCommand(input: {
  readonly endpoint: string;
  readonly command: string;
  readonly cwd: string;
  readonly workspaceRoot: string;
  readonly provider: string;
  readonly tokenEnv: string;
  readonly authHeaderName: string;
  readonly authPrefix: string;
}): string {
  const script = `
const endpoint = ${JSON.stringify(input.endpoint)};
const payload = ${JSON.stringify({ command: input.command, cwd: input.cwd, workspaceRoot: input.workspaceRoot, provider: input.provider })};
const token = process.env[${JSON.stringify(input.tokenEnv)}] || "";
(async () => {
  const headers = { "content-type": "application/json" };
  if (token) {
    headers[${JSON.stringify(input.authHeaderName)}] = ${JSON.stringify(input.authPrefix)} + token;
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { stderr: text };
    }
  }
  if (typeof data.stdout === "string") {
    process.stdout.write(data.stdout);
  }
  if (typeof data.stderr === "string") {
    process.stderr.write(data.stderr);
  }
  if (!response.ok) {
    if (!data.stderr && !data.error) {
      console.error("Managed cloud execution failed with HTTP " + response.status + ".");
    } else if (data.error) {
      console.error(String(data.error));
    }
    process.exit(typeof data.exitCode === "number" ? data.exitCode : 1);
  }
  process.exit(typeof data.exitCode === "number" ? data.exitCode : (data.ok === false ? 1 : 0));
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`;
  return buildNodeScriptCommand(script);
}

function resolveNamedCloudExecutionProvider(backend: string): {
  readonly label: string;
  readonly endpointEnv: string;
  readonly tokenEnv: string;
  readonly authHeaderName: string;
  readonly authPrefix: string;
} | null {
  switch (backend) {
    case "modal":
      return {
        label: "Modal",
        endpointEnv: "OMNI_AGENT_MODAL_ENDPOINT",
        tokenEnv: "OMNI_AGENT_MODAL_TOKEN",
        authHeaderName: "authorization",
        authPrefix: "Bearer ",
      };
    case "e2b":
      return {
        label: "E2B",
        endpointEnv: "OMNI_AGENT_E2B_ENDPOINT",
        tokenEnv: "OMNI_AGENT_E2B_API_KEY",
        authHeaderName: "x-api-key",
        authPrefix: "",
      };
    case "daytona":
      return {
        label: "Daytona",
        endpointEnv: "OMNI_AGENT_DAYTONA_ENDPOINT",
        tokenEnv: "OMNI_AGENT_DAYTONA_API_KEY",
        authHeaderName: "authorization",
        authPrefix: "Bearer ",
      };
    case "codesandbox":
      return {
        label: "CodeSandbox",
        endpointEnv: "OMNI_AGENT_CODESANDBOX_ENDPOINT",
        tokenEnv: "OMNI_AGENT_CODESANDBOX_TOKEN",
        authHeaderName: "authorization",
        authPrefix: "Bearer ",
      };
    default:
      return null;
  }
}

function parseJsonOrText(text: string): unknown {
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function readLifecycleOk(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return true;
  }
  return (data as Record<string, unknown>).ok !== false;
}

function readLifecycleWorkspaceId(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const value = (data as Record<string, unknown>).workspaceId;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readLifecycleSummary(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  const value = typeof record.summary === "string" ? record.summary : typeof record.message === "string" ? record.message : null;
  return value && value.trim().length > 0 ? value.trim() : null;
}

function buildNodeScriptCommand(script: string): string {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  return `${quoteShellArgument(process.execPath)} -e "eval(Buffer.from('${encoded}','base64').toString('utf8'))"`;
}

function quoteShellArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

async function findNearestExistingAncestorPath(targetPath: string): Promise<string | null> {
  let currentPath = resolve(targetPath);
  while (true) {
    try {
      await access(currentPath, fsConstants.F_OK);
      return currentPath;
    } catch {
      const parentPath = dirname(currentPath);
      if (parentPath === currentPath) {
        return null;
      }
      currentPath = parentPath;
    }
  }
}

async function findNearestGitBoundaryPath(targetPath: string): Promise<string | null> {
  let currentPath = resolve(targetPath);
  while (true) {
    try {
      await access(join(currentPath, ".git"), fsConstants.F_OK);
      return currentPath;
    } catch {
      const parentPath = dirname(currentPath);
      if (parentPath === currentPath) {
        return null;
      }
      currentPath = parentPath;
    }
  }
}

async function resolveWorkspaceBoundaryPath(targetPath: string): Promise<string> {
  try {
    return await realpath(targetPath);
  } catch {
    return resolve(targetPath);
  }
}

async function resolveWorkspaceCheckpointBoundaryPath(targetPath: string): Promise<string | null> {
  try {
    return await realpath(targetPath);
  } catch {
    return null;
  }
}

async function relativeInsideWorkspace(root: string, candidate: string): Promise<string | null> {
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    resolveWorkspaceBoundaryPath(root),
    resolveWorkspaceBoundaryPath(candidate),
  ]);
  const relativePath = relative(canonicalRoot, canonicalCandidate);
  if (!relativePath) {
    return ".";
  }
  if (relativePath.startsWith("..") || isDriveQualified(relativePath)) {
    return null;
  }
  return relativePath;
}

export class LocalWorkspaceService {
  public readonly root: string;
  public readonly artifactsRoot: string;
  public readonly executionPolicy: WorkspaceExecutionPolicy;
  private searchLoopState: {
    lastKey: string | null;
    consecutive: number;
  } = {
    lastKey: null,
    consecutive: 0,
  };

  public constructor(
    root: string,
    artifactsRoot?: string,
    executionPolicy: WorkspaceExecutionPolicy = createWorkspaceExecutionPolicy("workspace"),
  ) {
    this.root = resolve(root);
    this.artifactsRoot = resolve(artifactsRoot ?? join(this.root, ".omni-agent", "artifacts"));
    this.executionPolicy = {
      executionDomain: executionPolicy.executionDomain,
      capabilities: [...executionPolicy.capabilities],
    };
  }

  public hasCapability(capability: WorkspaceCapability): boolean {
    return this.executionPolicy.capabilities.includes(capability);
  }

  public getRoot(): string {
    return this.root;
  }

  private assertCapability(capability: WorkspaceCapability, operation: string): void {
    if (this.hasCapability(capability)) {
      return;
    }
    throw new Error(
      `Execution domain "${this.executionPolicy.executionDomain}" does not allow ${operation}; requires capability "${capability}".`,
    );
  }

  public async ensureReady(): Promise<void> {
    await mkdir(this.artifactsRoot, { recursive: true });
  }

  public async inspect(): Promise<WorkspaceSnapshot> {
    this.resetSearchLoopGuard();
    await this.ensureReady();

    const canRunCommands = this.hasCapability("command");
    const repoRoot = canRunCommands ? await this.tryRunGit("rev-parse --show-toplevel") : null;
    const branch = repoRoot && canRunCommands ? await this.tryRunGit("branch --show-current") : null;
    const statusResult = repoRoot && canRunCommands
      ? await this.runCommand("git status --porcelain", {
          cwd: ".",
          timeoutMs: 10_000,
          captureArtifact: false,
        })
      : null;
    const status = statusResult?.ok ? statusResult.stdout : null;
    const gitStatusLines = status ? status.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean) : [];
    const changedFiles = gitStatusLines.map((line) => extractGitStatusPath(line)).filter(Boolean);

    const detectedFiles: string[] = [];
    for (const fileName of SIGNAL_FILES) {
      const candidate = join(this.root, fileName);
      if (await this.pathExistsInsideWorkspace(candidate)) {
        detectedFiles.push(fileName);
      }
    }

    let packageManager: WorkspaceSnapshot["packageManager"] = "unknown";
    let packageScripts: string[] = [];

    if (detectedFiles.includes("package.json")) {
      packageManager = (await this.pathExistsInsideWorkspace(join(this.root, "pnpm-lock.yaml"))) ? "pnpm" : "npm";
      try {
        const packageJson = JSON.parse(await readFile(await this.resolveWorkspacePath("package.json"), "utf8")) as {
          scripts?: Record<string, string>;
        };
        packageScripts = Object.keys(packageJson.scripts ?? {});
      } catch {
        packageScripts = [];
      }
    } else if (detectedFiles.includes("pyproject.toml")) {
      packageManager = "python";
    } else if (detectedFiles.includes("Cargo.toml")) {
      packageManager = "cargo";
    }

    return {
      cwd: this.root,
      repoRoot,
      repoName: basename(repoRoot ?? this.root),
      branch,
      dirty: Boolean(status && status.trim().length > 0),
      isGitRepo: repoRoot !== null,
      gitStatusLines,
      changedFiles,
      detectedFiles,
      packageManager,
      packageScripts,
    };
  }

  public async listDirectory(targetPath = ".", depth = 2): Promise<string[]> {
    this.resetSearchLoopGuard();
    this.assertCapability("search", "list directories");
    const root = await this.resolveWorkspacePath(targetPath);
    const results: string[] = [];
    await this.walkDirectory(root, depth, results);
    return results.map((entry) => relative(this.root, entry) || ".");
  }

  public async searchFiles(query: string, limit = 50): Promise<string[]> {
    this.assertCapability("search", "search files");
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }
    const normalizedLimit = Math.max(1, Math.trunc(limit));
    this.recordSearchLoopGuard(`search_files:${normalizedQuery.toLowerCase()}:${normalizedLimit}`);

    const gitMatches = await this.searchFilesWithGit(normalizedQuery, normalizedLimit);
    if (gitMatches) {
      return gitMatches;
    }

    const lowered = normalizedQuery.toLowerCase();
    const results: string[] = [];
    await this.walkFileMatches(this.root, lowered, {
      limit: normalizedLimit,
      results,
    });
    return results;
  }

  public async searchText(
    query: string,
    options: {
      readonly path?: string;
      readonly limit?: number;
      readonly caseSensitive?: boolean;
    } = {},
  ): Promise<TextSearchMatch[]> {
    this.assertCapability("search", "search text");
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return [];
    }
    const normalizedPath = options.path ?? ".";
    const root = await this.resolveWorkspacePath(normalizedPath);
    const limit = Math.max(1, Math.trunc(options.limit ?? 20));
    this.recordSearchLoopGuard(
      `search_text:${options.caseSensitive ? "case" : "nocase"}:${normalizedPath}:${limit}:${normalizedQuery}`,
    );

    const gitMatches = await this.searchTextWithGit(normalizedQuery, {
      path: relative(this.root, root) || ".",
      limit,
      caseSensitive: Boolean(options.caseSensitive),
    });
    if (gitMatches) {
      return gitMatches;
    }

    const results: TextSearchMatch[] = [];
    const needle = options.caseSensitive ? normalizedQuery : normalizedQuery.toLowerCase();

    const rootDetails = await stat(root);
    const searchState = {
      caseSensitive: Boolean(options.caseSensitive),
      limit,
      results,
    };
    if (rootDetails.isFile()) {
      await this.collectTextMatchesInFile(root, needle, searchState);
      return results;
    }

    await this.walkTextMatches(root, needle, searchState);

    return results;
  }

  public async readFile(
    targetPath: string,
    options: {
      readonly startLine?: number;
      readonly endLine?: number;
      readonly maxChars?: number;
    } = {},
  ): Promise<string> {
    this.resetSearchLoopGuard();
    this.assertCapability("read", "read files");
    const resolved = await this.resolveWorkspacePath(targetPath);
    const fileStat = await stat(resolved);
    if (fileStat.isDirectory()) {
      throw new Error(`read_file expected a file but received a directory: ${targetPath}. Use list_directory for directory inspection.`);
    }
    const content = await readFile(resolved, "utf8");
    const startLine = normalizeLineBoundary(options.startLine, 1);
    const endLine = normalizeLineBoundary(options.endLine, Number.MAX_SAFE_INTEGER);
    const maxChars = normalizeLineBoundary(options.maxChars, 20_000);

    if (startLine <= 1 && endLine === Number.MAX_SAFE_INTEGER && maxChars >= content.length) {
      return content;
    }

    const lines = content.split(/\r?\n/);
    const sliced = lines.slice(Math.max(0, startLine - 1), Math.max(0, endLine)).join("\n");
    return sliced.length > maxChars ? `${sliced.slice(0, maxChars)}\n...[truncated]` : sliced;
  }

  public async writeFile(targetPath: string, content: string): Promise<FileEditResult> {
    this.resetSearchLoopGuard();
    this.assertCapability("write", "write files");
    const resolved = await this.resolveWorkspacePath(targetPath, { allowMissing: true });
    await mkdir(resolve(resolved, ".."), { recursive: true });
    await writeFile(resolved, content, "utf8");
    return {
      path: relative(this.root, resolved),
      bytes: Buffer.byteLength(content, "utf8"),
      replacements: 1,
    };
  }

  public async editFile(targetPath: string, oldText: string, newText: string): Promise<FileEditResult> {
    this.resetSearchLoopGuard();
    this.assertCapability("write", "edit files");
    const resolved = await this.resolveWorkspacePath(targetPath);
    const current = await readFile(resolved, "utf8");
    if (!current.includes(oldText)) {
      throw new Error(`Could not find target text in ${targetPath}`);
    }

    const next = current.replace(oldText, newText);
    await writeFile(resolved, next, "utf8");
    return {
      path: relative(this.root, resolved),
      bytes: Buffer.byteLength(next, "utf8"),
      replacements: 1,
    };
  }

  public async replaceFileRange(
    targetPath: string,
    startLine: number,
    endLine: number,
    newText: string,
  ): Promise<FileEditResult> {
    this.resetSearchLoopGuard();
    this.assertCapability("write", "edit files");
    const resolved = await this.resolveWorkspacePath(targetPath);
    const current = await readFile(resolved, "utf8");
    const lines = current.split(/\r?\n/);
    const startIndex = Math.max(0, Math.trunc(startLine) - 1);
    const endIndexExclusive = Math.max(startIndex, Math.trunc(endLine));

    if (startIndex >= lines.length) {
      throw new Error(`Start line ${startLine} is outside ${targetPath}`);
    }

    const replacementLines = newText.replace(/\r\n/g, "\n").split("\n");
    const nextLines = [...lines.slice(0, startIndex), ...replacementLines, ...lines.slice(endIndexExclusive)];
    const next = nextLines.join("\n");

    await writeFile(resolved, next, "utf8");
    return {
      path: relative(this.root, resolved),
      bytes: Buffer.byteLength(next, "utf8"),
      replacements: 1,
    };
  }

  public async applyTransactionalPatch(
    operations: readonly TransactionalPatchOperation[],
  ): Promise<TransactionalPatchResult> {
    this.resetSearchLoopGuard();
    this.assertCapability("write", "apply transactional patches");
    if (operations.length === 0) {
      throw new Error("apply_transactional_patch requires at least one operation.");
    }

    const prepared: Array<{
      readonly path: string;
      readonly resolved: string;
      readonly content: string;
      readonly existed: boolean;
      readonly previous: string;
    }> = [];
    const seenPaths = new Set<string>();

    for (const operation of operations) {
      const resolved = await this.resolveWorkspacePath(operation.path, { allowMissing: operation.type === "write" });
      const relativePath = relative(this.root, resolved);
      const pathKey = resolved.toLowerCase();
      if (seenPaths.has(pathKey)) {
        throw new Error(`apply_transactional_patch cannot modify the same file more than once: ${operation.path}`);
      }
      seenPaths.add(pathKey);

      const existing = await this.readExistingPatchTarget(resolved, operation);
      if (operation.expectedHash !== undefined) {
        const actualHash = createHash("sha256").update(existing.content).digest("hex");
        if (actualHash !== operation.expectedHash) {
          throw new Error(`Stale patch rejected for ${operation.path}: expectedHash did not match.`);
        }
      }
      if (operation.expectedOldText !== undefined && !existing.content.includes(operation.expectedOldText)) {
        throw new Error(`Stale patch rejected for ${operation.path}: expectedOldText was not found.`);
      }

      prepared.push({
        path: relativePath,
        resolved,
        content: buildTransactionalPatchContent(operation, existing.content),
        existed: existing.existed,
        previous: existing.content,
      });
    }

    const written: typeof prepared = [];
    try {
      for (const entry of prepared) {
        await mkdir(resolve(entry.resolved, ".."), { recursive: true });
        await writeFile(entry.resolved, entry.content, "utf8");
        written.push(entry);
      }
    } catch (error) {
      try {
        await restoreTransactionalPatchWrites(written);
      } catch {
        // Best-effort rollback: preserve the original write failure for callers.
      }
      throw error;
    }

    return {
      files: prepared.map((entry) => ({
        path: entry.path,
        bytes: Buffer.byteLength(entry.content, "utf8"),
        replacements: 1,
      })),
    };
  }

  public async runCommand(
    command: string,
    options: {
      readonly cwd?: string;
      readonly timeoutMs?: number;
      readonly captureArtifact?: boolean;
      readonly abortSignal?: AbortSignal;
    } = {},
  ): Promise<CommandExecutionResult> {
    this.resetSearchLoopGuard();
    this.assertCapability("command", "execute shell commands");
    await this.ensureReady();
    const startedAt = Date.now();
    const cwd = options.cwd ? await this.resolveWorkspacePath(options.cwd) : this.root;
    const execution = resolveCommandExecutionBackend(command, cwd, this.root);

    return new Promise<CommandExecutionResult>((resolvePromise) => {
      let child: ChildProcess | undefined;
      const abortSignal = options.abortSignal;
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = (result: CommandExecutionResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        abortSignal?.removeEventListener("abort", handleAbort);
        resolvePromise(result);
      };
      const handleAbort = (): void => {
        if (settled) {
          return;
        }
        try {
          child?.kill();
        } catch {
          // Best-effort cancellation.
        }
        settle({
          ok: false,
          command: execution.displayCommand,
          cwd,
          exitCode: -1,
          stdout,
          stderr: `${stderr}\nCommand aborted.`.trim(),
          durationMs: Date.now() - startedAt,
        });
      };
      if (abortSignal?.aborted) {
        settle({
          ok: false,
          command: execution.displayCommand,
          cwd,
          exitCode: -1,
          stdout,
          stderr: "Command aborted.",
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      try {
        child = spawn(execution.command, {
          cwd: execution.cwd,
          env: buildWorkspaceCommandEnv(),
          shell: true,
          windowsHide: true,
        });
      } catch (error) {
        settle({
          ok: false,
          command: execution.displayCommand,
          cwd,
          exitCode: -1,
          stdout: "",
          stderr: String(error),
          durationMs: Date.now() - startedAt,
        });
        return;
      }
      abortSignal?.addEventListener("abort", handleAbort, { once: true });
      timer = options.timeoutMs
        ? setTimeout(() => {
            if (!settled) {
              try {
                child.kill();
              } catch {
                // Best-effort timeout cleanup.
              }
              void this.writeArtifact("command-timeout", `${execution.displayCommand}\n\n${stdout}\n${stderr}`).then(
                (artifactPath) => {
                  settle({
                    ok: false,
                    command: execution.displayCommand,
                    cwd,
                    exitCode: -1,
                    stdout,
                    stderr: `${stderr}\nCommand timed out after ${options.timeoutMs}ms`.trim(),
                    durationMs: Date.now() - startedAt,
                    artifactPath,
                  });
                },
              );
            }
          }, options.timeoutMs)
        : null;

      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stdout?.on("error", () => {});

      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.stderr?.on("error", () => {});

      child.on("error", async (error) => {
        const artifactPath = options.captureArtifact === false
          ? undefined
          : await this.writeArtifact("command-error", `${execution.displayCommand}\n\n${String(error)}`);
        settle({
          ok: false,
          command: execution.displayCommand,
          cwd,
          exitCode: -1,
          stdout,
          stderr: `${stderr}\n${String(error)}`.trim(),
          durationMs: Date.now() - startedAt,
          artifactPath,
        });
      });

      child.on("close", async (code) => {
        const artifactPath = options.captureArtifact === false
          ? undefined
          : await this.writeArtifact("command-output", `# command\n${execution.displayCommand}\n\n# stdout\n${stdout}\n\n# stderr\n${stderr}`);
        settle({
          ok: (code ?? 1) === 0,
          command: execution.displayCommand,
          cwd,
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          artifactPath,
        });
      });
    });
  }

  public async runVerification(
    commands: string[],
    options: {
      readonly abortSignal?: AbortSignal;
    } = {},
  ): Promise<VerificationExecutionResult> {
    this.resetSearchLoopGuard();
    this.assertCapability("command", "run verification commands");
    const results: CommandExecutionResult[] = [];

    for (const command of commands) {
      results.push(
        await this.runCommand(command, {
          timeoutMs: 300_000,
          abortSignal: options.abortSignal,
        }),
      );
      if (!results[results.length - 1]?.ok) {
        break;
      }
    }

    return {
      ok: results.every((result) => result.ok),
      commands,
      results,
    };
  }

  public async createWorktree(name: string, branch?: string): Promise<{ path: string; branch: string }> {
    this.resetSearchLoopGuard();
    this.assertCapability("control", "manage worktrees");
    const snapshot = await this.inspect();
    const repoRoot = snapshot.repoRoot;
    if (!repoRoot) {
      throw new Error("Cannot create a worktree outside a git repository.");
    }

    const worktreesRoot = this.resolveManagedExecutionRoot("worktree", repoRoot);
    await mkdir(worktreesRoot, { recursive: true });
    const safeName = sanitizePathSegment(name) || "worktree";
    const worktreePath = join(worktreesRoot, safeName);
    const branchName = branch ?? `omni/${safeName}`;
    const result = await this.runCommand(`git worktree add -b "${branchName}" "${worktreePath}"`, {
      cwd: ".",
      timeoutMs: 120_000,
    });
    if (!result.ok) {
      throw new Error(result.stderr || `Failed to create worktree ${name}`);
    }

    return {
      path: worktreePath,
      branch: branchName,
    };
  }

  public async cleanupWorktree(worktreePath: string): Promise<{ removed: boolean; path: string }> {
    this.resetSearchLoopGuard();
    this.assertCapability("control", "manage worktrees");
    const snapshot = await this.inspect();
    if (!snapshot.repoRoot) {
      throw new Error("Cannot clean up a worktree outside a git repository.");
    }

    const resolved = resolve(worktreePath);
    const worktreesRoot = this.resolveManagedExecutionRoot("worktree", snapshot.repoRoot);
    if (!isManagedExecutionChild(worktreesRoot, resolved)) {
      throw new Error(`Refusing to remove worktree outside managed root: ${worktreePath}`);
    }

    const result = await this.runCommand(`git worktree remove "${resolved}" --force`, {
      cwd: ".",
      timeoutMs: 120_000,
    });
    if (!result.ok) {
      throw new Error(result.stderr || `Failed to remove worktree ${resolved}`);
    }

    if (await this.pathExists(resolved)) {
      await rm(resolved, { recursive: true, force: true });
    }

    return {
      removed: true,
      path: resolved,
    };
  }

  public async cleanupSandbox(sandboxPath: string): Promise<{ removed: boolean; path: string }> {
    this.resetSearchLoopGuard();
    this.assertCapability("control", "manage sandboxes");
    const resolved = resolve(sandboxPath);
    const sandboxesRoot = this.resolveManagedExecutionRoot("sandbox", this.root);
    if (!isManagedExecutionChild(sandboxesRoot, resolved)) {
      throw new Error(`Refusing to remove sandbox outside managed root: ${sandboxPath}`);
    }

    await rm(resolved, { recursive: true, force: true });
    return {
      removed: true,
      path: resolved,
    };
  }

  public async createSandbox(name: string): Promise<{ path: string }> {
    this.resetSearchLoopGuard();
    this.assertCapability("control", "manage sandboxes");
    await this.ensureReady();
    const sandboxesRoot = this.resolveManagedExecutionRoot("sandbox", this.root);
    await mkdir(sandboxesRoot, { recursive: true });
    const sandboxPath = join(sandboxesRoot, sanitizePathSegment(name) || "sandbox");

    await cp(this.root, sandboxPath, {
      recursive: true,
      force: true,
      filter: (source) => shouldIncludeInSandboxCopy(source, this.root),
    });

    return {
      path: sandboxPath,
    };
  }

  public async createCheckpoint(name: string): Promise<WorkspaceCheckpointRecord> {
    this.resetSearchLoopGuard();
    this.assertCapability("control", "create workspace checkpoints");
    await this.ensureReady();
    const checkpointRoot = this.resolveManagedExecutionRoot("checkpoint", this.root);
    await mkdir(checkpointRoot, { recursive: true });
    const checkpointId = `${Date.now()}-${sanitizePathSegment(name) || "checkpoint"}-${randomUUID().slice(0, 8)}`;
    const checkpointPath = join(checkpointRoot, checkpointId);
    const preservedExternalTopLevelEntries = await collectCheckpointPreservedExternalTopLevelEntries(
      this.root,
      this.artifactsRoot,
    );
    await cp(this.root, checkpointPath, {
      recursive: true,
      force: false,
      filter: (source) => shouldIncludeInWorkspaceCheckpointCopy(source, this.root, this.artifactsRoot),
    });
    const record: WorkspaceCheckpointRecord = {
      id: checkpointId,
      name,
      path: checkpointPath,
      createdAt: new Date().toISOString(),
      ...(preservedExternalTopLevelEntries.length > 0 ? { preservedExternalTopLevelEntries } : {}),
    };
    await writeFile(join(checkpointPath, CHECKPOINT_MANIFEST_FILE), JSON.stringify(record, null, 2), "utf8");
    return record;
  }

  public async listCheckpoints(): Promise<WorkspaceCheckpointRecord[]> {
    this.resetSearchLoopGuard();
    this.assertCapability("control", "list workspace checkpoints");
    const checkpointRoot = this.resolveManagedExecutionRoot("checkpoint", this.root);
    let entries: Array<{ isDirectory(): boolean; name: string }>;
    try {
      entries = await readdir(checkpointRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    const checkpoints: WorkspaceCheckpointRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const checkpointPath = join(checkpointRoot, entry.name);
      try {
        const raw = await readFile(join(checkpointPath, CHECKPOINT_MANIFEST_FILE), "utf8");
        const parsed = JSON.parse(raw) as Partial<WorkspaceCheckpointRecord>;
        if (parsed.id && parsed.createdAt) {
          checkpoints.push({
            id: parsed.id,
            name: parsed.name ?? parsed.id,
            path: checkpointPath,
            createdAt: parsed.createdAt,
          });
        }
      } catch {
        continue;
      }
    }
    return checkpoints.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  public async rollbackCheckpoint(checkpointPath: string): Promise<WorkspaceCheckpointRecord> {
    this.resetSearchLoopGuard();
    this.assertCapability("control", "roll back workspace checkpoints");
    const checkpointRoot = this.resolveManagedExecutionRoot("checkpoint", this.root);
    const resolvedCheckpointPath = resolve(checkpointPath);
    if (!isManagedExecutionChild(checkpointRoot, resolvedCheckpointPath)) {
      throw new Error(`Refusing to roll back checkpoint outside managed root: ${checkpointPath}`);
    }
    const [realCheckpointRoot, realCheckpointPath] = await Promise.all([
      realpath(checkpointRoot),
      realpath(resolvedCheckpointPath),
    ]);
    if (!isManagedExecutionChild(realCheckpointRoot, realCheckpointPath)) {
      throw new Error(`Refusing to roll back checkpoint outside managed root via symbolic link: ${checkpointPath}`);
    }
    const raw = await readFile(join(realCheckpointPath, CHECKPOINT_MANIFEST_FILE), "utf8");
    const record = JSON.parse(raw) as WorkspaceCheckpointRecord;
    const preservedExternalTopLevelEntries = new Set(record.preservedExternalTopLevelEntries ?? []);
    const currentEntries = await readdir(this.root, { withFileTypes: true });
    for (const entry of currentEntries) {
      const target = join(this.root, entry.name);
      if (await shouldIncludeInWorkspaceCheckpointCopy(target, this.root, this.artifactsRoot)) {
        await rm(target, { recursive: true, force: true });
      } else if (
        !preservedExternalTopLevelEntries.has(entry.name) &&
        await isExternalCheckpointLinkEntry(target, this.root)
      ) {
        await rm(target, { recursive: true, force: true });
      }
    }
    await cp(realCheckpointPath, this.root, {
      recursive: true,
      force: true,
      filter: async (source) => {
        if (basename(source) === CHECKPOINT_MANIFEST_FILE) {
          return false;
        }
        return isPathInside(realCheckpointPath, await resolveWorkspaceBoundaryPath(source));
      },
    });
    return {
      id: record.id,
      name: record.name,
      path: resolvedCheckpointPath,
      createdAt: record.createdAt,
    };
  }

  public async writeArtifact(kind: string, content: string, extension = ".log"): Promise<string> {
    this.resetSearchLoopGuard();
    await this.ensureReady();
    const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
    const artifactPath = join(this.artifactsRoot, `${Date.now()}-${kind}-${randomUUID()}${normalizedExtension}`);
    await writeFile(artifactPath, redactSensitiveText(content), "utf8");
    return artifactPath;
  }

  public async getGitDiffSummary(): Promise<GitDiffSummary | null> {
    this.resetSearchLoopGuard();
    this.assertCapability("command", "read git diff");
    const snapshot = await this.inspect();
    if (!snapshot.repoRoot) {
      return null;
    }

    const statResult = await this.runCommand("git diff --stat --no-ext-diff -- .", {
      timeoutMs: 20_000,
      captureArtifact: false,
    });
    const patchResult = await this.runCommand("git diff --no-ext-diff --unified=1 --no-color -- .", {
      timeoutMs: 20_000,
      captureArtifact: false,
    });

    return {
      changedFiles: snapshot.changedFiles,
      stat: statResult.stdout.trim() || "No diff stat available.",
      patchPreview: trimForPreview(patchResult.stdout.trim() || "No diff patch available.", 12_000),
    };
  }

  public async getGitDiffPatch(): Promise<string | null> {
    this.resetSearchLoopGuard();
    this.assertCapability("command", "read git diff");
    const snapshot = await this.inspect();
    if (!snapshot.repoRoot) {
      return null;
    }

    const patchResult = await this.runCommand("git diff --no-ext-diff --unified=3 --no-color -- .", {
      timeoutMs: 20_000,
      captureArtifact: false,
    });
    if (!patchResult.ok) {
      return null;
    }

    const patch = patchResult.stdout.trim();
    return patch.length > 0 ? patch : null;
  }

  public async loadInstructionFiles(
    options: {
      readonly targetPath?: string;
      readonly maxFiles?: number;
      readonly maxCharsPerFile?: number;
      readonly maxTotalChars?: number;
    } = {},
  ): Promise<WorkspaceInstructionFile[]> {
    this.resetSearchLoopGuard();
    this.assertCapability("read", "load instruction files");
    const targetPath = await this.resolveWorkspacePath(options.targetPath ?? ".", { allowMissing: true });
    const targetDirectory = await this.resolveInstructionDirectory(targetPath);
    const directories = listInstructionDirectories(this.root, targetDirectory);
    const maxFiles = Math.max(1, Math.trunc(options.maxFiles ?? DEFAULT_MAX_WORKSPACE_INSTRUCTION_FILES));
    const maxCharsPerFile = Math.max(256, Math.trunc(options.maxCharsPerFile ?? DEFAULT_MAX_WORKSPACE_INSTRUCTION_CHARS_PER_FILE));
    let remainingChars = Math.max(
      maxCharsPerFile,
      Math.trunc(options.maxTotalChars ?? DEFAULT_MAX_WORKSPACE_INSTRUCTION_TOTAL_CHARS),
    );
    const loadedPaths = new Set<string>();
    const files: WorkspaceInstructionFile[] = [];

    for (const directory of directories) {
      const candidatePaths = await this.listInstructionCandidatePaths(directory, targetPath);
      for (const candidate of candidatePaths) {
        if (files.length >= maxFiles || remainingChars <= 0) {
          return files;
        }

        const candidateKey = candidate.toLowerCase();
        if (loadedPaths.has(candidateKey)) {
          continue;
        }

        loadedPaths.add(candidateKey);
        const builtInstruction = await this.buildInstructionFile(candidate, directory, targetPath, Math.min(maxCharsPerFile, remainingChars));
        if (!builtInstruction) {
          continue;
        }
        files.push({
          path: relative(this.root, candidate) || builtInstruction.name,
          scope: relative(this.root, directory) || ".",
          name: builtInstruction.name,
          content: builtInstruction.content,
          truncated: builtInstruction.truncated,
        });
        remainingChars -= builtInstruction.content.length;
      }
    }

    return files;
  }

  public async loadMemoryFiles(
    options: {
      readonly targetPath?: string;
      readonly date?: Date;
      readonly includeDailyNotes?: boolean;
      readonly maxFiles?: number;
      readonly maxCharsPerFile?: number;
      readonly maxTotalChars?: number;
    } = {},
  ): Promise<WorkspaceMemoryFile[]> {
    this.resetSearchLoopGuard();
    this.assertCapability("read", "load memory files");
    const targetPath = await this.resolveWorkspacePath(options.targetPath ?? ".", { allowMissing: true });
    const targetDirectory = await this.resolveInstructionDirectory(targetPath);
    const directories = listInstructionDirectories(this.root, targetDirectory);
    const includeDailyNotes = options.includeDailyNotes !== false;
    const maxFiles = Math.max(1, Math.trunc(options.maxFiles ?? DEFAULT_MAX_WORKSPACE_MEMORY_FILES));
    const maxCharsPerFile = Math.max(256, Math.trunc(options.maxCharsPerFile ?? DEFAULT_MAX_WORKSPACE_MEMORY_CHARS_PER_FILE));
    let remainingChars = Math.max(
      maxCharsPerFile,
      Math.trunc(options.maxTotalChars ?? DEFAULT_MAX_WORKSPACE_MEMORY_TOTAL_CHARS),
    );
    const files: WorkspaceMemoryFile[] = [];
    const loadedPaths = new Set<string>();

    for (const directory of directories) {
      const scopedCandidates = [
        { path: join(directory, "MEMORY.md"), kind: "memory" as const },
        { path: join(directory, "USER.md"), kind: "user" as const },
        ...(
          includeDailyNotes
            ? listWorkspaceMemoryNotePaths(options.date ?? new Date()).map((path) => ({
                path: join(directory, path),
                kind: "daily" as const,
              }))
            : []
        ),
      ];

      for (const candidate of scopedCandidates) {
        if (files.length >= maxFiles || remainingChars <= 0) {
          return files;
        }

        const relativePath = relative(this.root, candidate.path) || basename(candidate.path);
        const candidateKey = relativePath.replace(/\\/g, "/").toLowerCase();
        if (loadedPaths.has(candidateKey)) {
          continue;
        }

        if (!(await this.pathExistsInsideWorkspace(candidate.path))) {
          continue;
        }

        loadedPaths.add(candidateKey);
        const rawContent = (await readFile(candidate.path, "utf8")).trim();
        if (!rawContent) {
          continue;
        }

        const truncated = trimInstructionContent(rawContent, Math.min(maxCharsPerFile, remainingChars));
        files.push({
          path: relativePath,
          kind: candidate.kind,
          content: truncated.content,
          truncated: truncated.truncated,
        });
        remainingChars -= truncated.content.length;
      }
    }

    return files;
  }

  public async loadSkillFiles(
    options: {
      readonly query?: string;
      readonly sessionId?: string;
      readonly maxFiles?: number;
      readonly maxCharsPerFile?: number;
      readonly maxTotalChars?: number;
    } = {},
  ): Promise<WorkspaceSkillFile[]> {
    this.resetSearchLoopGuard();
    this.assertCapability("read", "load skill files");
    const maxFiles = Math.max(1, Math.trunc(options.maxFiles ?? DEFAULT_MAX_WORKSPACE_SKILL_FILES));
    const maxCharsPerFile = Math.max(256, Math.trunc(options.maxCharsPerFile ?? DEFAULT_MAX_WORKSPACE_SKILL_CHARS_PER_FILE));
    let remainingChars = Math.max(
      maxCharsPerFile,
      Math.trunc(options.maxTotalChars ?? DEFAULT_MAX_WORKSPACE_SKILL_TOTAL_CHARS),
    );
    const normalizedQuery = options.query?.trim().toLowerCase() ?? "";
    const sessionId = normalizeWorkspaceSkillSessionId(options.sessionId ?? process.env.OMNI_AGENT_SESSION_ID ?? process.env.HERMES_SESSION_ID);
    const candidatePaths: Array<{ path: string; sourceRoot: string }> = [];

    for (const directory of WORKSPACE_SKILL_DIRECTORIES) {
      const resolved = join(this.root, directory);
      if (await this.pathExistsInsideWorkspace(resolved)) {
        await this.collectWorkspaceSkillPaths(resolved, resolved, candidatePaths);
      }
    }

    if (candidatePaths.length === 0) {
      return [];
    }

    const scoredCandidates: Array<{
      path: string;
      sourceRoot: string;
      name: string;
      metadata: WorkspaceSkillFrontmatter;
      score: number;
    }> = [];
    for (const candidatePath of candidatePaths) {
      const rawContent = (await readFile(candidatePath.path, "utf8")).trim();
      if (!rawContent) {
        continue;
      }

      const metadata = parseWorkspaceSkillFrontmatter(rawContent);
      const name = metadata.name ?? basename(dirname(candidatePath.path));
      if (!isWorkspaceSkillApplicable(metadata)) {
        continue;
      }
      const score = scoreWorkspaceSkillMatch(name, rawContent, normalizedQuery, metadata);
      if (normalizedQuery && score <= 0) {
        continue;
      }

      scoredCandidates.push({
        path: candidatePath.path,
        sourceRoot: candidatePath.sourceRoot,
        name,
        metadata,
        score,
      });
    }

    scoredCandidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.path.localeCompare(right.path);
    });

    const files: WorkspaceSkillFile[] = [];
    for (const candidate of scoredCandidates) {
      if (files.length >= maxFiles || remainingChars <= 0) {
        break;
      }

      const built = await this.buildWorkspaceSkillFile(
        candidate.path,
        candidate.name,
        candidate.metadata,
        candidate.sourceRoot,
        normalizedQuery,
        sessionId,
        Math.min(maxCharsPerFile, remainingChars),
      );
      if (!built) {
        continue;
      }

      files.push(built);
      remainingChars -= built.content.length;
    }

    return files;
  }

  public async listSkillFileIndex(
    options: {
      readonly maxFiles?: number;
      readonly maxFrontmatterChars?: number;
    } = {},
  ): Promise<WorkspaceSkillIndexEntry[]> {
    this.resetSearchLoopGuard();
    this.assertCapability("read", "list skill file metadata");
    const maxFiles = Math.max(1, Math.trunc(options.maxFiles ?? DEFAULT_MAX_WORKSPACE_SKILL_FILES));
    const maxFrontmatterChars = Math.max(512, Math.trunc(options.maxFrontmatterChars ?? 16_384));
    const candidatePaths: Array<{ path: string; sourceRoot: string }> = [];

    for (const directory of WORKSPACE_SKILL_DIRECTORIES) {
      const resolved = join(this.root, directory);
      if (await this.pathExistsInsideWorkspace(resolved)) {
        await this.collectWorkspaceSkillPaths(resolved, resolved, candidatePaths);
      }
    }

    const entries: WorkspaceSkillIndexEntry[] = [];
    for (const candidatePath of candidatePaths) {
      if (entries.length >= maxFiles) {
        break;
      }
      let rawContent = "";
      try {
        rawContent = (await readFilePrefix(candidatePath.path, maxFrontmatterChars)).trim();
      } catch {
        continue;
      }
      if (!rawContent) {
        continue;
      }
      const metadata = parseWorkspaceSkillFrontmatter(rawContent);
      if (!isWorkspaceSkillApplicable(metadata)) {
        continue;
      }
      entries.push({
        path: relative(this.root, candidatePath.path) || candidatePath.path,
        name: metadata.name ?? basename(dirname(candidatePath.path)),
        description: metadata.description,
        tags: metadata.tags,
        relatedSkills: metadata.relatedSkills,
      });
    }

    return entries;
  }

  public async loadSkillFile(
    targetPath: string,
    options: {
      readonly sessionId?: string;
      readonly maxChars?: number;
    } = {},
  ): Promise<WorkspaceSkillFile | null> {
    this.resetSearchLoopGuard();
    this.assertCapability("read", "load skill file");
    const resolved = await this.resolveWorkspacePath(targetPath);
    if (basename(resolved) !== "SKILL.md") {
      throw new Error(`loadSkillFile expected a SKILL.md file: ${targetPath}`);
    }
    const sourceRoot = this.resolveWorkspaceSkillSourceRoot(resolved);
    if (!sourceRoot) {
      throw new Error(`Skill file is outside supported workspace skill directories: ${targetPath}`);
    }
    const rawContent = (await readFile(resolved, "utf8")).trim();
    if (!rawContent) {
      return null;
    }
    const metadata = parseWorkspaceSkillFrontmatter(rawContent);
    if (!isWorkspaceSkillApplicable(metadata)) {
      return null;
    }
    const sessionId = normalizeWorkspaceSkillSessionId(options.sessionId ?? process.env.OMNI_AGENT_SESSION_ID ?? process.env.HERMES_SESSION_ID);
    return this.buildWorkspaceSkillFile(
      resolved,
      metadata.name ?? basename(dirname(resolved)),
      metadata,
      sourceRoot,
      "",
      sessionId,
      Math.max(256, Math.trunc(options.maxChars ?? DEFAULT_MAX_WORKSPACE_SKILL_CHARS_PER_FILE)),
    );
  }

  public async materializeLearnedSkill(input: MaterializedLearnedSkillInput): Promise<MaterializedLearnedSkillResult> {
    this.resetSearchLoopGuard();
    this.assertCapability("write", "materialize learned skills");
    const slug = sanitizeLearnedSkillSlug(input.title);
    const relativeDirectory = join("skills", "learned", slug);
    const relativePath = join(relativeDirectory, "SKILL.md");
    const content = formatMaterializedLearnedSkill(input);
    const result = await this.writeFile(relativePath, content);
    return {
      ...result,
      directory: relativeDirectory.replace(/\\/g, "/"),
      path: result.path.replace(/\\/g, "/"),
    };
  }

  public async appendMemoryFile(
    content: string,
    options: {
      readonly kind?: WorkspaceMemoryFileKind;
      readonly date?: Date;
    } = {},
  ): Promise<FileEditResult & { readonly kind: WorkspaceMemoryFileKind }> {
    this.resetSearchLoopGuard();
    this.assertCapability("write", "append memory files");
    const normalizedContent = redactSensitiveText(content).trim();
    if (!normalizedContent) {
      throw new Error("Memory file content cannot be empty.");
    }

    const kind = options.kind ?? "daily";
    const targetPath = resolveWorkspaceMemoryPath(kind, options.date ?? new Date());
    const resolved = await this.resolveWorkspacePath(targetPath, { allowMissing: true });
    await mkdir(resolve(resolved, ".."), { recursive: true });

    const current = (await this.pathExistsInsideWorkspace(resolved)) ? await readFile(resolved, "utf8") : "";
    const separator = current.length === 0 ? "" : current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
    const appendedContent = `${separator}${normalizedContent}\n`;
    await appendFile(resolved, appendedContent, "utf8");

    return {
      path: relative(this.root, resolved) || targetPath,
      bytes: Buffer.byteLength(current + appendedContent, "utf8"),
      replacements: 1,
      kind,
    };
  }

  public async searchMemoryFiles(
    options: {
      readonly query?: string;
      readonly kinds?: readonly WorkspaceMemoryFileKind[];
      readonly date?: Date;
      readonly includeDailyNotes?: boolean;
      readonly limit?: number;
      readonly previewChars?: number;
    } = {},
  ): Promise<WorkspaceMemorySearchResult[]> {
    this.resetSearchLoopGuard();
    this.assertCapability("read", "search memory files");
    const limit = Math.max(1, Math.trunc(options.limit ?? 8));
    const previewChars = Math.max(80, Math.trunc(options.previewChars ?? 240));
    const normalizedQuery = String(options.query ?? "").trim().toLowerCase();
    const kinds = options.kinds ? new Set(options.kinds) : null;
    const includeDailyNotes = options.includeDailyNotes !== false;
    const results: WorkspaceMemorySearchResult[] = [];
    const candidates = [
      { path: "MEMORY.md", kind: "memory" as const },
      { path: "USER.md", kind: "user" as const },
      ...(
        includeDailyNotes
          ? listWorkspaceMemoryNotePaths(options.date ?? new Date()).map((path) => ({
              path,
              kind: "daily" as const,
            }))
          : []
      ),
    ];

    for (const candidate of candidates) {
      if (results.length >= limit) {
        break;
      }
      if (kinds && !kinds.has(candidate.kind)) {
        continue;
      }

      const resolved = join(this.root, candidate.path);
      if (!(await this.pathExistsInsideWorkspace(resolved))) {
        continue;
      }

      const rawContent = (await readFile(resolved, "utf8")).trim();
      if (!rawContent) {
        continue;
      }

      const preview = buildMemorySearchPreview(rawContent, normalizedQuery, previewChars);
      if (!preview) {
        continue;
      }

      results.push({
        path: candidate.path,
        kind: candidate.kind,
        content: preview.content,
        matchCount: preview.matchCount,
      });
    }

    return results;
  }

  private async walkDirectory(currentPath: string, depth: number, results: string[]): Promise<void> {
    if (depth < 0) {
      return;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const resolved = join(currentPath, entry.name);
      if (!(await this.pathExistsInsideWorkspace(resolved))) {
        continue;
      }
      results.push(resolved);
      if (entry.isDirectory() && depth > 0 && !EXCLUDED_DIRECTORIES.has(entry.name)) {
        await this.walkDirectory(resolved, depth - 1, results);
      }
    }
  }

  private async walkTextMatches(
    currentPath: string,
    needle: string,
    state: {
      readonly caseSensitive: boolean;
      readonly limit: number;
      readonly results: TextSearchMatch[];
    },
  ): Promise<void> {
    if (state.results.length >= state.limit) {
      return;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (state.results.length >= state.limit) {
        return;
      }

      const resolved = join(currentPath, entry.name);
      if (!(await this.pathExistsInsideWorkspace(resolved))) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
          await this.walkTextMatches(resolved, needle, state);
        }
        continue;
      }

      if (!(await this.shouldSearchFile(resolved))) {
        continue;
      }

      await this.collectTextMatchesInFile(resolved, needle, state);
    }
  }

  private async collectTextMatchesInFile(
    targetPath: string,
    needle: string,
    state: {
      readonly caseSensitive: boolean;
      readonly limit: number;
      readonly results: TextSearchMatch[];
    },
  ): Promise<void> {
    if (!(await this.shouldSearchFile(targetPath))) {
      return;
    }
    const content = await readFile(targetPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (state.results.length >= state.limit) {
        return;
      }
      const lineText = lines[index] ?? "";
      const haystack = state.caseSensitive ? lineText : lineText.toLowerCase();
      if (haystack.includes(needle)) {
        state.results.push({
          path: relative(this.root, targetPath) || ".",
          lineNumber: index + 1,
          lineText: trimForSearchPreview(lineText),
        });
      }
    }
  }

  private async walkFileMatches(
    currentPath: string,
    needle: string,
    state: {
      readonly limit: number;
      readonly results: string[];
    },
  ): Promise<void> {
    if (state.results.length >= state.limit) {
      return;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (state.results.length >= state.limit) {
        return;
      }

      const resolved = join(currentPath, entry.name);
      if (!(await this.pathExistsInsideWorkspace(resolved))) {
        continue;
      }
      const relativePath = relative(this.root, resolved) || ".";
      if (relativePath.toLowerCase().includes(needle)) {
        state.results.push(relativePath);
      }

      if (entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name)) {
        await this.walkFileMatches(resolved, needle, state);
      }
    }
  }

  private resolveInsideWorkspace(targetPath: string): string {
    const resolved = resolve(this.root, targetPath);
    const relativePath = relative(this.root, resolved);
    if (relativePath.startsWith("..") || isDriveQualified(relativePath)) {
      throw new Error(`Path escapes workspace root: ${targetPath}`);
    }
    return resolved;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await access(targetPath, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  private async pathExistsInsideWorkspace(targetPath: string): Promise<boolean> {
    if (!(await this.pathExists(targetPath))) {
      return false;
    }

    try {
      await this.assertWorkspaceBoundary(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private async readExistingPatchTarget(
    resolved: string,
    operation: TransactionalPatchOperation,
  ): Promise<{ readonly existed: boolean; readonly content: string }> {
    try {
      const targetStat = await stat(resolved);
      if (targetStat.isDirectory()) {
        throw new Error(`apply_transactional_patch expected a file but received a directory: ${operation.path}`);
      }
      return { existed: true, content: await readFile(resolved, "utf8") };
    } catch (error) {
      if (error instanceof Error && /expected a file/.test(error.message)) {
        throw error;
      }
      if (operation.type !== "write") {
        throw new Error(`apply_transactional_patch ${operation.type} requires an existing file: ${operation.path}`);
      }
      return { existed: false, content: "" };
    }
  }

  private async resolveWorkspacePath(
    targetPath: string,
    options: {
      readonly allowMissing?: boolean;
    } = {},
  ): Promise<string> {
    const resolved = this.resolveInsideWorkspace(targetPath);
    await this.assertWorkspaceBoundary(resolved, options);
    return resolved;
  }

  private async assertWorkspaceBoundary(
    targetPath: string,
    options: {
      readonly allowMissing?: boolean;
    } = {},
  ): Promise<void> {
    const workspaceRoot = await resolveWorkspaceBoundaryPath(this.root);
    const existingPath = await findNearestExistingAncestorPath(targetPath);
    if (!existingPath) {
      if (options.allowMissing) {
        return;
      }
      throw new Error(`Path escapes workspace root: ${targetPath}`);
    }

    const canonicalPath = await resolveWorkspaceBoundaryPath(existingPath);
    if (!isPathInside(workspaceRoot, canonicalPath)) {
      throw new Error(`Path escapes workspace root via symbolic link: ${targetPath}`);
    }
  }

  private async tryRunGit(args: string): Promise<string | null> {
    const gitBoundaryPath = await findNearestGitBoundaryPath(this.root);
    if (!gitBoundaryPath) {
      return null;
    }
    const result = await this.runProcess("git", args.split(/\s+/).filter(Boolean), {
      cwd: gitBoundaryPath,
      timeoutMs: 10_000,
    });
    return result.ok ? result.stdout.trim() : null;
  }

  private async shouldSearchFile(targetPath: string): Promise<boolean> {
    const lowerPath = targetPath.toLowerCase();
    for (const extension of BINARY_EXTENSIONS) {
      if (lowerPath.endsWith(extension)) {
        return false;
      }
    }

    const details = await stat(targetPath);
    return details.size <= 512_000;
  }

  private async searchFilesWithGit(query: string, limit: number): Promise<string[] | null> {
    const repoRoot = await this.tryRunGit("rev-parse --show-toplevel");
    if (!repoRoot) {
      return null;
    }

    const workspacePathSpec = await this.getRepoPathSpec(repoRoot, this.root);
    if (workspacePathSpec === null) {
      return null;
    }

    const args = ["ls-files", "--cached", "--others", "--exclude-standard", "--full-name"];
    if (workspacePathSpec) {
      args.push("--", workspacePathSpec);
    }

    const result = await this.runProcess("git", args, {
      cwd: repoRoot,
      timeoutMs: 20_000,
    });
    if (!result.ok) {
      return null;
    }

    const lowered = query.toLowerCase();
    const matches: string[] = [];
    for (const rawEntry of result.stdout.split(/\r?\n/)) {
      if (matches.length >= limit) {
        break;
      }
      const entry = rawEntry.trim();
      if (!entry) {
        continue;
      }
      const relativePath = await relativeInsideWorkspace(this.root, resolve(repoRoot, entry));
      if (relativePath && relativePath !== "." && relativePath.toLowerCase().includes(lowered)) {
        matches.push(relativePath);
      }
    }
    return matches;
  }

  private async searchTextWithGit(
    query: string,
    options: {
      readonly path: string;
      readonly limit: number;
      readonly caseSensitive: boolean;
    },
  ): Promise<TextSearchMatch[] | null> {
    const repoRoot = await this.tryRunGit("rev-parse --show-toplevel");
    if (!repoRoot) {
      return null;
    }

    const resolvedPath = this.resolveInsideWorkspace(options.path);
    const pathSpec = await this.getRepoPathSpec(repoRoot, resolvedPath);
    if (pathSpec === null) {
      return null;
    }

    const args = ["grep", "-n", "--full-name", "--no-color", "--untracked", "-I", "-F"];
    if (!options.caseSensitive) {
      args.push("-i");
    }
    args.push("-e", query);
    if (pathSpec) {
      args.push("--", pathSpec);
    }

    const result = await this.runProcess("git", args, {
      cwd: repoRoot,
      timeoutMs: 20_000,
    });
    if (!result.ok && result.exitCode !== 1) {
      return null;
    }

    const matches: TextSearchMatch[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const parsed = parseGitGrepLine(line);
      if (!parsed) {
        continue;
      }
      const relativePath = await relativeInsideWorkspace(this.root, resolve(repoRoot, parsed.path));
      if (!relativePath || relativePath === ".") {
        continue;
      }
      matches.push({
        path: relativePath,
        lineNumber: parsed.lineNumber,
        lineText: trimForSearchPreview(parsed.lineText),
      });
      if (matches.length >= options.limit) {
        break;
      }
    }

    return matches;
  }

  private resolveManagedExecutionRoot(kind: "checkpoint" | "sandbox" | "worktree", ownerPath: string): string {
    const normalizedOwner = resolve(ownerPath);
    if (!isPathInside(this.root, this.artifactsRoot)) {
      const directory = kind === "worktree" ? "worktrees" : kind === "checkpoint" ? "checkpoints" : "sandboxes";
      return join(dirname(this.artifactsRoot), directory, buildWorkspaceKey(normalizedOwner));
    }

    const parentRoot = dirname(normalizedOwner);
    const hiddenDir =
      kind === "worktree"
        ? ".omni-agent-worktrees"
        : kind === "checkpoint"
          ? ".omni-agent-checkpoints"
          : ".omni-agent-sandboxes";
    return join(parentRoot, hiddenDir, buildWorkspaceKey(normalizedOwner));
  }

  private async resolveInstructionDirectory(targetPath: string): Promise<string> {
    if (!(await this.pathExistsInsideWorkspace(targetPath))) {
      return dirname(targetPath);
    }

    const details = await stat(targetPath);
    return details.isDirectory() ? targetPath : dirname(targetPath);
  }

  private async getRepoPathSpec(repoRoot: string, targetPath: string): Promise<string | null> {
    const [canonicalRepoRoot, canonicalTargetPath] = await Promise.all([
      resolveWorkspaceBoundaryPath(repoRoot),
      resolveWorkspaceBoundaryPath(targetPath),
    ]);
    const relativePath = relative(canonicalRepoRoot, canonicalTargetPath);
    if (relativePath.startsWith("..") || isDriveQualified(relativePath)) {
      return null;
    }
    return relativePath && relativePath !== "." ? relativePath.replace(/\\/g, "/") : "";
  }

  private recordSearchLoopGuard(key: string): void {
    if (this.searchLoopState.lastKey === key) {
      this.searchLoopState.consecutive += 1;
    } else {
      this.searchLoopState.lastKey = key;
      this.searchLoopState.consecutive = 1;
    }

    if (this.searchLoopState.consecutive >= 4) {
      throw new Error(
        `Blocked repeated identical search after ${this.searchLoopState.consecutive} attempts. Use the existing results or take a different action.`,
      );
    }
  }

  private resetSearchLoopGuard(): void {
    this.searchLoopState.lastKey = null;
    this.searchLoopState.consecutive = 0;
  }

  private async listInstructionCandidatePaths(directory: string, targetPath: string): Promise<string[]> {
    const candidates: string[] = [];

    for (const name of WORKSPACE_INSTRUCTION_FILE_NAMES) {
      const candidate = join(directory, name);
      if (await this.pathExistsInsideWorkspace(candidate)) {
        candidates.push(candidate);
      }
    }

    for (const name of WORKSPACE_DOT_CLAUDE_FILE_NAMES) {
      const candidate = join(directory, name);
      if (await this.pathExistsInsideWorkspace(candidate)) {
        candidates.push(candidate);
      }
    }

    const rulesDir = join(directory, WORKSPACE_DOT_CLAUDE_RULES_DIR);
    if (await this.pathExistsInsideWorkspace(rulesDir)) {
      candidates.push(...(await this.collectInstructionRuleFiles(rulesDir, directory, targetPath, [".md"])));
    }

    const cursorRulesDir = join(directory, WORKSPACE_DOT_CURSOR_RULES_DIR);
    if (await this.pathExistsInsideWorkspace(cursorRulesDir)) {
      candidates.push(...(await this.collectInstructionRuleFiles(cursorRulesDir, directory, targetPath, [".mdc"])));
    }

    for (const name of WORKSPACE_LOCAL_INSTRUCTION_FILE_NAMES) {
      const candidate = join(directory, name);
      if (await this.pathExistsInsideWorkspace(candidate)) {
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  private async collectInstructionRuleFiles(
    rulesDir: string,
    scopeDirectory: string,
    targetPath: string,
    allowedExtensions: string[],
  ): Promise<string[]> {
    const extensionSet = new Set(allowedExtensions.map((extension) => extension.toLowerCase()));
    const entries = await this.collectRuleEntriesRecursive(rulesDir);
    return entries
      .filter((entry) => extensionSet.has(extname(entry.path).toLowerCase()))
      .filter((entry) => stripInstructionFrontmatter(entry.rawContent, entry.path, scopeDirectory, targetPath).content.trim().length > 0)
      .map((entry) => entry.path);
  }

  private async collectRuleEntriesRecursive(root: string): Promise<Array<{ path: string; rawContent: string }>> {
    const entries = await readdir(root, { withFileTypes: true });
    const results: Array<{ path: string; rawContent: string }> = [];

    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      const resolved = join(root, entry.name);
      if (!(await this.pathExistsInsideWorkspace(resolved))) {
        continue;
      }
      if (entry.isDirectory()) {
        results.push(...(await this.collectRuleEntriesRecursive(resolved)));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      results.push({
        path: resolved,
        rawContent: await readFile(resolved, "utf8"),
      });
    }

    return results;
  }

  private async collectWorkspaceSkillPaths(
    root: string,
    sourceRoot: string,
    results: Array<{ path: string; sourceRoot: string }>,
  ): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      const resolved = join(root, entry.name);
      if (!(await this.pathExistsInsideWorkspace(resolved))) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
          await this.collectWorkspaceSkillPaths(resolved, sourceRoot, results);
        }
        continue;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        results.push({
          path: resolved,
          sourceRoot,
        });
      }
    }
  }

  private resolveWorkspaceSkillSourceRoot(candidatePath: string): string | null {
    const resolvedCandidate = resolve(candidatePath);
    for (const directory of WORKSPACE_SKILL_DIRECTORIES) {
      const sourceRoot = resolve(this.root, directory);
      if (isPathInside(sourceRoot, resolvedCandidate)) {
        return sourceRoot;
      }
    }
    return null;
  }

  private async buildInstructionFile(
    candidate: string,
    scopeDirectory: string,
    targetPath: string,
    maxChars: number,
  ): Promise<{ name: string; content: string; truncated: boolean } | null> {
    const prepared = await prepareInstructionContent(candidate, scopeDirectory, targetPath, this.root);
    if (!prepared) {
      return null;
    }
    const truncatedContent = trimInstructionContent(prepared.content, maxChars);
    return {
      name: basename(candidate),
      content: truncatedContent.content,
      truncated: truncatedContent.truncated,
    };
  }

  private async buildWorkspaceSkillFile(
    candidatePath: string,
    name: string,
    metadata: WorkspaceSkillFrontmatter,
    sourceRoot: string,
    query: string,
    sessionId: string | null,
    maxChars: number,
  ): Promise<WorkspaceSkillFile | null> {
    const primaryPrepared = await prepareInstructionContent(candidatePath, dirname(candidatePath), candidatePath, this.root);
    if (!primaryPrepared) {
      return null;
    }
    const primaryPath = relative(this.root, candidatePath) || candidatePath;
    const skillDirectory = dirname(candidatePath);
    const externalDirectories = await this.resolveWorkspaceSkillExternalDirectories(skillDirectory, metadata.externalDirs, sessionId);
    if (metadata.externalDirs.length > 0 && externalDirectories.length !== metadata.externalDirs.length) {
      return null;
    }
    const supportingPaths = await this.collectWorkspaceSkillSupportPaths(candidatePath, sourceRoot, query, externalDirectories);
    const sections = [
      `Skill (${name})\n${applyWorkspaceSkillTemplateVariables(primaryPrepared.content, skillDirectory, sessionId)}`,
    ];

    for (const supportingPath of supportingPaths) {
      const prepared = await prepareInstructionContent(supportingPath, dirname(supportingPath), supportingPath, this.root);
      if (!prepared) {
        continue;
      }
      const relativeSupportingPath =
        relative(skillDirectory, supportingPath).replace(/\\/g, "/") || basename(supportingPath);
      sections.push(`Support (${relativeSupportingPath})\n${applyWorkspaceSkillTemplateVariables(prepared.content, skillDirectory, sessionId)}`);
    }

    const truncatedContent = trimInstructionContent(sections.join("\n\n"), maxChars);
    const relativeSupportingPaths = await Promise.all(
      supportingPaths.map(async (entry) => (await relativeInsideWorkspace(this.root, entry)) ?? (relative(this.root, entry) || entry)),
    );

    return {
      path: primaryPath,
      name,
      description: metadata.description,
      tags: metadata.tags,
      relatedSkills: metadata.relatedSkills,
      content: truncatedContent.content,
      truncated: truncatedContent.truncated,
      supportingPaths: relativeSupportingPaths,
    };
  }

  private async collectWorkspaceSkillSupportPaths(
    candidatePath: string,
    sourceRoot: string,
    query: string,
    externalDirectories: readonly string[] = [],
  ): Promise<string[]> {
    const collected = new Set<string>();
    const supportPaths: string[] = [];
    const skillDirectory = dirname(candidatePath);
    let currentDirectory = dirname(skillDirectory);

    while (isPathInside(sourceRoot, currentDirectory)) {
      const descriptionPath = join(currentDirectory, "DESCRIPTION.md");
      if ((await this.pathExistsInsideWorkspace(descriptionPath)) && !collected.has(descriptionPath)) {
        collected.add(descriptionPath);
        supportPaths.push(descriptionPath);
      }
      if (resolve(currentDirectory) === resolve(sourceRoot)) {
        break;
      }
      const parentDirectory = dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        break;
      }
      currentDirectory = parentDirectory;
    }

    if (!query) {
      return supportPaths;
    }

    const referencesDirectory = join(skillDirectory, "references");
    if (await this.pathExistsInsideWorkspace(referencesDirectory)) {
      const referenceMatches = await this.collectWorkspaceSkillReferenceMatches(referencesDirectory, query);
      for (const entry of referenceMatches.slice(0, 2)) {
        if (!collected.has(entry.path)) {
          collected.add(entry.path);
          supportPaths.push(entry.path);
        }
      }
    }

    for (const externalDirectory of externalDirectories) {
      const externalMatches = await this.collectWorkspaceSkillReferenceMatches(externalDirectory, query);
      for (const entry of externalMatches.slice(0, 2)) {
        if (!collected.has(entry.path)) {
          collected.add(entry.path);
          supportPaths.push(entry.path);
        }
      }
    }

    return supportPaths;
  }

  private async resolveWorkspaceSkillExternalDirectories(
    skillDirectory: string,
    rawDirectories: readonly string[],
    sessionId: string | null,
  ): Promise<string[]> {
    const directories: string[] = [];
    const seen = new Set<string>();
    const workspaceRoot = await resolveWorkspaceBoundaryPath(this.root);
    for (const rawDirectory of rawDirectories) {
      const expanded = applyWorkspaceSkillTemplateVariables(rawDirectory, skillDirectory, sessionId);
      if (expanded.includes("${")) {
        continue;
      }
      const resolved = expanded.startsWith("/") || isDriveQualified(expanded) ? resolve(expanded) : resolve(skillDirectory, expanded);
      const canonical = await resolveWorkspaceBoundaryPath(resolved);
      if (!isPathInside(workspaceRoot, canonical)) {
        continue;
      }
      try {
        const directoryStat = await stat(canonical);
        if (!directoryStat.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }
      const key = canonical.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        directories.push(canonical);
      }
    }
    return directories;
  }

  private async collectWorkspaceSkillReferenceMatches(
    root: string,
    query: string,
  ): Promise<Array<{ path: string; score: number }>> {
    const entries = await readdir(root, { withFileTypes: true });
    const matches: Array<{ path: string; score: number }> = [];

    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      const resolved = join(root, entry.name);
      if (entry.isDirectory()) {
        matches.push(...(await this.collectWorkspaceSkillReferenceMatches(resolved, query)));
        continue;
      }
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".md") {
        continue;
      }
      const rawContent = (await readFile(resolved, "utf8")).trim();
      if (!rawContent) {
        continue;
      }
      const score = scoreWorkspaceSkillMatch(basename(entry.name, extname(entry.name)), rawContent, query);
      if (score > 0) {
        matches.push({ path: resolved, score });
      }
    }

    matches.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.path.localeCompare(right.path);
    });
    return matches;
  }

  private async runProcess(
    command: string,
    args: string[],
    options: {
      readonly cwd?: string;
      readonly timeoutMs?: number;
    } = {},
  ): Promise<CommandExecutionResult> {
    const startedAt = Date.now();
    const cwd = options.cwd ? resolve(options.cwd) : this.root;

    return new Promise<CommandExecutionResult>((resolvePromise) => {
      let child;
      try {
        child = spawn(command, args, {
          cwd,
          env: buildWorkspaceCommandEnv(),
          shell: false,
          windowsHide: true,
        });
      } catch (error) {
        resolvePromise({
          ok: false,
          command: `${command} ${args.join(" ")}`.trim(),
          cwd,
          exitCode: -1,
          stdout: "",
          stderr: String(error),
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer =
        options.timeoutMs && options.timeoutMs > 0
          ? setTimeout(() => {
              if (settled) {
                return;
              }
              settled = true;
              child.kill();
              resolvePromise({
                ok: false,
                command: `${command} ${args.join(" ")}`.trim(),
                cwd,
                exitCode: -1,
                stdout,
                stderr: `${stderr}\nCommand timed out after ${options.timeoutMs}ms`.trim(),
                durationMs: Date.now() - startedAt,
              });
            }, options.timeoutMs)
          : null;

        child.stdout?.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stdout?.on("error", () => {});

        child.stderr?.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.stderr?.on("error", () => {});

      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolvePromise({
          ok: false,
          command: `${command} ${args.join(" ")}`.trim(),
          cwd,
          exitCode: -1,
          stdout,
          stderr: `${stderr}\n${String(error)}`.trim(),
          durationMs: Date.now() - startedAt,
        });
      });

      child.on("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
        }
        resolvePromise({
          ok: (code ?? 1) === 0,
          command: `${command} ${args.join(" ")}`.trim(),
          cwd,
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}

function extractGitStatusPath(line: string): string {
  const normalized = line.replace(/\r?\n/g, "");
  const withArrow = normalized.includes(" -> ") ? normalized.split(" -> ").at(-1) : normalized.slice(3);
  return (withArrow ?? "").trim();
}

function normalizeLineBoundary(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value ?? fallback));
}

function buildTransactionalPatchContent(operation: TransactionalPatchOperation, current: string): string {
  if (operation.type === "write") {
    return operation.content;
  }

  if (operation.type === "replace") {
    if (!operation.oldText) {
      throw new Error(`apply_transactional_patch replace requires non-empty oldText for ${operation.path}`);
    }
    if (!current.includes(operation.oldText)) {
      throw new Error(`Could not find target text in ${operation.path}`);
    }
    return current.replace(operation.oldText, operation.newText);
  }

  const lines = current.split(/\r?\n/);
  if (!Number.isFinite(operation.startLine) || !Number.isFinite(operation.endLine)) {
    throw new Error(`apply_transactional_patch range requires finite startLine and endLine for ${operation.path}`);
  }
  const startIndex = Math.max(0, Math.trunc(operation.startLine) - 1);
  const endIndexExclusive = Math.max(startIndex, Math.trunc(operation.endLine));
  if (startIndex >= lines.length) {
    throw new Error(`Start line ${operation.startLine} is outside ${operation.path}`);
  }
  const replacementLines = operation.newText.replace(/\r\n/g, "\n").split("\n");
  return [...lines.slice(0, startIndex), ...replacementLines, ...lines.slice(endIndexExclusive)].join("\n");
}

async function restoreTransactionalPatchWrites(
  written: readonly {
    readonly resolved: string;
    readonly existed: boolean;
    readonly previous: string;
  }[],
): Promise<void> {
  for (const entry of [...written].reverse()) {
    if (entry.existed) {
      await writeFile(entry.resolved, entry.previous, "utf8");
    } else {
      await rm(entry.resolved, { force: true });
    }
  }
}

function trimForPreview(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...[truncated]`;
}

function trimForSearchPreview(value: string, maxChars = 240): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function trimInstructionContent(value: string, maxChars: number): { content: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return {
      content: value,
      truncated: false,
    };
  }

  const suffix = "\n...[truncated]";
  if (maxChars <= suffix.length) {
    return {
      content: value.slice(0, maxChars),
      truncated: true,
    };
  }
  const sliceLength = Math.max(0, maxChars - suffix.length);
  return {
    content: `${value.slice(0, sliceLength)}${suffix}`,
    truncated: true,
  };
}

function buildMemorySearchPreview(
  rawContent: string,
  normalizedQuery: string,
  maxChars: number,
): { content: string; matchCount: number } | null {
  const compactContent = rawContent.replace(/\s+/g, " ").trim();
  if (!normalizedQuery) {
    return {
      content: trimForSearchPreview(compactContent, maxChars),
      matchCount: 1,
    };
  }

  const haystack = compactContent.toLowerCase();
  const matchIndex = haystack.indexOf(normalizedQuery);
  if (matchIndex < 0) {
    return null;
  }

  const preview = sliceSearchPreview(compactContent, matchIndex, normalizedQuery.length, maxChars);
  return {
    content: preview,
    matchCount: countSubstringMatches(haystack, normalizedQuery),
  };
}

function sliceSearchPreview(value: string, index: number, matchLength: number, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const contextRadius = Math.max(0, Math.floor((maxChars - matchLength) / 2));
  const start = Math.max(0, index - contextRadius);
  const end = Math.min(value.length, index + matchLength + contextRadius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < value.length ? "..." : "";
  return `${prefix}${value.slice(start, end).trim()}${suffix}`;
}

function countSubstringMatches(haystack: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while (cursor >= 0 && cursor < haystack.length) {
    const next = haystack.indexOf(needle, cursor);
    if (next < 0) {
      break;
    }
    count += 1;
    cursor = next + needle.length;
  }
  return count;
}

function parseWorkspaceSkillFrontmatter(rawContent: string): WorkspaceSkillFrontmatter {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return {
      name: null,
      description: null,
      tags: [],
      relatedSkills: [],
      disabled: false,
      platforms: [],
      os: [],
      externalDirs: [],
    };
  }

  const frontmatter = match[1] ?? "";
  const metadata = parseWorkspaceSkillMetadataObject(frontmatter);
  return {
    name: readFrontmatterScalar(frontmatter, "name"),
    description: readFrontmatterScalar(frontmatter, "description"),
    tags: readFrontmatterArray(frontmatter, "tags"),
    relatedSkills: readFrontmatterArray(frontmatter, "related_skills"),
    disabled: readFrontmatterBoolean(frontmatter, "disabled") || readMetadataBoolean(metadata, new Set(["disabled"])),
    platforms: uniqueStrings([
      ...readFrontmatterStringList(frontmatter, "platform"),
      ...readFrontmatterStringList(frontmatter, "platforms"),
      ...readMetadataStringList(metadata, new Set(["platform", "platforms"])),
    ]),
    os: uniqueStrings([
      ...readFrontmatterStringList(frontmatter, "os"),
      ...readMetadataStringList(metadata, new Set(["os"])),
    ]),
    externalDirs: uniqueStrings([
      ...readFrontmatterStringList(frontmatter, "external_dirs"),
      ...readFrontmatterStringList(frontmatter, "externalDirs"),
      ...readFrontmatterNestedStringList(frontmatter, "external", "dirs"),
      ...readMetadataExternalDirectories(metadata),
    ]),
  };
}

async function readFilePrefix(path: string, maxChars: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.max(1, maxChars));
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

function isWorkspaceSkillApplicable(metadata: WorkspaceSkillFrontmatter): boolean {
  if (metadata.disabled) {
    return false;
  }
  return matchesWorkspaceSkillPlatform(metadata.platforms) && matchesWorkspaceSkillPlatform(metadata.os);
}

function matchesWorkspaceSkillPlatform(platforms: readonly string[]): boolean {
  if (platforms.length === 0) {
    return true;
  }
  const currentPlatform = process.platform;
  return platforms.some((platform) => {
    const normalized = platform.trim().toLowerCase();
    const mapped =
      normalized === "macos" || normalized === "mac"
        ? "darwin"
        : normalized === "windows" || normalized === "win"
          ? "win32"
          : normalized;
    return currentPlatform === mapped || currentPlatform.startsWith(mapped);
  });
}

function normalizeWorkspaceSkillSessionId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return sanitizePathSegment(trimmed);
}

function applyWorkspaceSkillTemplateVariables(content: string, skillDirectory: string, sessionId: string | null): string {
  if (!content) {
    return content;
  }
  const resolvedSkillDirectory = resolve(skillDirectory);
  return content.replace(/\$\{(SKILL_DIR|HERMES_SKILL_DIR|SESSION_ID|HERMES_SESSION_ID)\}/g, (match, token: string) => {
    if (token === "SKILL_DIR" || token === "HERMES_SKILL_DIR") {
      return resolvedSkillDirectory;
    }
    return sessionId ?? match;
  });
}

function readFrontmatterStringList(frontmatter: string, key: string): string[] {
  const values = readFrontmatterArray(frontmatter, key);
  const scalar = readFrontmatterScalar(frontmatter, key);
  if (scalar && !scalar.startsWith("{") && !scalar.startsWith("[")) {
    values.push(scalar);
  }
  return values;
}

function readFrontmatterBoolean(frontmatter: string, key: string): boolean {
  const value = readFrontmatterScalar(frontmatter, key)?.toLowerCase();
  return value === "true" || value === "yes" || value === "1";
}

function readFrontmatterNestedStringList(frontmatter: string, parentKey: string, childKey: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const parentMatch = line.match(new RegExp(`^(\\s*)${escapeRegExp(parentKey)}:\\s*$`));
    if (!parentMatch) {
      continue;
    }

    const baseIndent = parentMatch[1]?.length ?? 0;
    const blockLines: string[] = [];
    for (let offset = index + 1; offset < lines.length; offset += 1) {
      const nextLine = lines[offset] ?? "";
      if (!nextLine.trim()) {
        blockLines.push(nextLine);
        continue;
      }
      const nextIndent = nextLine.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (nextIndent <= baseIndent) {
        break;
      }
      blockLines.push(nextLine);
    }

    return readFrontmatterStringList(blockLines.join("\n"), childKey);
  }
  return [];
}

function parseWorkspaceSkillMetadataObject(frontmatter: string): unknown {
  const match = frontmatter.match(/^\s*metadata:\s*(\{[\s\S]*\})\s*$/m);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1] ?? "{}") as unknown;
  } catch {
    return null;
  }
}

function readMetadataBoolean(value: unknown, keys: ReadonlySet<string>): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeFrontmatterKey(key);
    if (keys.has(normalizedKey) && typeof child === "boolean") {
      return child;
    }
    if (readMetadataBoolean(child, keys)) {
      return true;
    }
  }
  return false;
}

function readMetadataStringList(value: unknown, keys: ReadonlySet<string>): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const results: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeFrontmatterKey(key);
    if (keys.has(normalizedKey)) {
      results.push(...normalizeMetadataStringList(child));
    }
    results.push(...readMetadataStringList(child, keys));
  }
  return results;
}

function readMetadataExternalDirectories(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const results: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeFrontmatterKey(key);
    if (normalizedKey === "externaldirs" || normalizedKey === "external_dirs") {
      results.push(...normalizeMetadataStringList(child));
    }
    if (normalizedKey === "external" || normalizedKey === "skills") {
      results.push(...readMetadataStringList(child, new Set(["dirs", "externaldirs", "external_dirs"])));
    }
    results.push(...readMetadataExternalDirectories(child));
  }
  return results;
}

function normalizeMetadataStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    return normalized ? [normalized] : [];
  }
  return [];
}

function normalizeFrontmatterKey(value: string): string {
  return value.trim().toLowerCase().replace(/[-]/g, "_");
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (normalized && !seen.has(key)) {
      seen.add(key);
      results.push(normalized);
    }
  }
  return results;
}

function readFrontmatterScalar(frontmatter: string, key: string): string | null {
  const match = frontmatter.match(new RegExp(`^\\s*${escapeRegExp(key)}:\\s*(.+?)\\s*$`, "m"));
  if (!match) {
    return null;
  }
  const value = cleanFrontmatterScalar(match[1] ?? "");
  return value.length > 0 ? value : null;
}

function readFrontmatterArray(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = line.match(new RegExp(`^(\\s*)${escapeRegExp(key)}:\\s*(.*?)\\s*$`));
    if (!match) {
      continue;
    }

    const baseIndent = match[1]?.length ?? 0;
    const inlineValue = (match[2] ?? "").trim();
    if (inlineValue.startsWith("[")) {
      return parseFrontmatterInlineArray(inlineValue);
    }

    const values: string[] = [];
    for (let offset = index + 1; offset < lines.length; offset += 1) {
      const nextLine = lines[offset] ?? "";
      const trimmed = nextLine.trim();
      if (!trimmed) {
        continue;
      }

      const nextIndent = nextLine.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (nextIndent <= baseIndent) {
        break;
      }

      const itemMatch = trimmed.match(/^-\s+(.+?)\s*$/);
      if (!itemMatch) {
        continue;
      }

      const value = cleanFrontmatterScalar(itemMatch[1] ?? "");
      if (value.length > 0) {
        values.push(value);
      }
    }
    return values;
  }

  return [];
}

function parseFrontmatterInlineArray(value: string): string[] {
  const normalized = value.trim();
  if (!normalized.startsWith("[") || !normalized.endsWith("]")) {
    return [];
  }
  return normalized
    .slice(1, -1)
    .split(",")
    .map((entry) => cleanFrontmatterScalar(entry))
    .filter((entry) => entry.length > 0);
}

function cleanFrontmatterScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function scoreWorkspaceSkillMatch(
  name: string,
  content: string,
  query: string,
  metadata?: WorkspaceSkillFrontmatter,
): number {
  if (!query) {
    return 1;
  }

  const normalizedName = name.toLowerCase();
  const metadataHaystack = [
    metadata?.description ?? "",
    metadata?.tags.join(" ") ?? "",
    metadata?.relatedSkills.join(" ") ?? "",
  ]
    .join("\n")
    .toLowerCase();
  const haystack = `${normalizedName}\n${content.toLowerCase()}\n${metadataHaystack}`;
  let score = 0;

  if (normalizedName === query) {
    score += 20;
  } else if (normalizedName.includes(query)) {
    score += 12;
  }

  if (haystack.includes(query)) {
    score += 6;
  }

  const tokens = Array.from(
    new Set(query.split(/[^a-z0-9]+/i).map((token) => token.trim()).filter((token) => token.length >= 3)),
  );
  for (const token of tokens) {
    if (normalizedName.includes(token)) {
      score += 4;
    } else if (haystack.includes(token)) {
      score += 2;
    }
  }

  return score;
}

function sanitizeLearnedSkillSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `learned-skill-${randomUUID().slice(0, 8)}`;
}

function formatMaterializedLearnedSkill(input: MaterializedLearnedSkillInput): string {
  const description = trimInstructionContent(input.problemPattern, 120).content.replace(/\r?\n/g, " ");
  const tags = Array.from(new Set(input.tags.map((entry) => entry.trim()).filter(Boolean)));
  const changedFiles = Array.from(new Set(input.changedFiles.map((entry) => entry.trim()).filter(Boolean)));
  const triggerSignals = Array.from(new Set(input.triggerSignals.map((entry) => entry.trim()).filter(Boolean)));
  const procedureSteps = Array.from(new Set(input.procedureSteps.map((entry) => entry.trim()).filter(Boolean)));
  const lines = [
    "---",
    `name: ${sanitizeLearnedSkillSlug(input.title)}`,
    `description: "${escapeYamlDoubleQuotedValue(description || input.title)}"`,
    "metadata:",
    "  hermes:",
    `    tags: [${tags.map((entry) => escapeYamlInlineScalar(entry)).join(", ")}]`,
    "---",
    "",
    `# ${input.title}`,
    "",
    "Repository-materialized learned procedure. Keep it aligned with real verification outcomes.",
    "",
    "## When to use",
    `- Pattern: ${input.problemPattern}`,
    triggerSignals.length > 0 ? `- Trigger signals: ${triggerSignals.join(", ")}` : null,
    changedFiles.length > 0 ? `- Prior changed files: ${changedFiles.join(", ")}` : null,
    `- Revision count: ${input.revisionCount}`,
    "",
    "## Procedure",
    ...(procedureSteps.length > 0 ? procedureSteps.map((entry, index) => `${index + 1}. ${entry}`) : ["1. Follow the recorded guidance and capture fresh verification evidence."]),
    "",
    "## Guidance",
    input.guidance,
    "",
    "## Verification Evidence",
    input.verificationSummary || "No structured verification summary was recorded.",
    "",
  ].filter((entry): entry is string => entry !== null);
  return lines.join("\n");
}

function escapeYamlDoubleQuotedValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeYamlInlineScalar(value: string): string {
  return `"${escapeYamlDoubleQuotedValue(value)}"`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listInstructionDirectories(root: string, targetDirectory: string): string[] {
  const relativePath = relative(root, targetDirectory);
  if (!relativePath || relativePath === ".") {
    return [root];
  }

  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  const directories = [root];
  let currentDirectory = root;
  for (const segment of segments) {
    currentDirectory = join(currentDirectory, segment);
    directories.push(currentDirectory);
  }
  return directories;
}

function listWorkspaceMemoryNotePaths(anchorDate: Date): string[] {
  const today = formatMemoryDate(anchorDate);
  const previous = new Date(anchorDate);
  previous.setDate(previous.getDate() - 1);
  const yesterday = formatMemoryDate(previous);
  return Array.from(new Set([today, yesterday])).map((date) => join("memory", `${date}.md`));
}

function resolveWorkspaceMemoryPath(kind: WorkspaceMemoryFileKind, anchorDate: Date): string {
  if (kind === "memory") {
    return "MEMORY.md";
  }
  if (kind === "user") {
    return "USER.md";
  }
  return join("memory", `${formatMemoryDate(anchorDate)}.md`);
}

function formatMemoryDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function prepareInstructionContent(
  candidatePath: string,
  scopeDirectory: string,
  targetPath: string,
  workspaceRoot?: string,
): Promise<{ content: string } | null> {
  const canonicalWorkspaceRoot = workspaceRoot ? await resolveWorkspaceBoundaryPath(workspaceRoot) : undefined;
  const trustedExternalRoots = await Promise.all(
    listTrustedInstructionIncludeRoots(candidatePath).map((root) => resolveWorkspaceBoundaryPath(root)),
  );
  return loadInstructionContent(candidatePath, scopeDirectory, targetPath, {
    workspaceRoot: canonicalWorkspaceRoot,
    depth: 0,
    processedPaths: new Set<string>(),
    trustedExternalRoots,
  });
}

async function loadInstructionContent(
  candidatePath: string,
  scopeDirectory: string,
  targetPath: string,
  state: {
    readonly workspaceRoot?: string;
    readonly depth: number;
    readonly processedPaths: Set<string>;
    readonly trustedExternalRoots: readonly string[];
  },
): Promise<{ content: string } | null> {
  if (state.depth >= DEFAULT_MAX_WORKSPACE_INSTRUCTION_INCLUDE_DEPTH) {
    return null;
  }

  const allowedRoots = [state.workspaceRoot, ...state.trustedExternalRoots].filter((value): value is string => Boolean(value));
  const canonicalCandidate = await resolveInstructionCandidatePath(candidatePath, allowedRoots);
  if (!canonicalCandidate) {
    return null;
  }

  const normalizedCandidate = normalizeInstructionIncludePathKey(canonicalCandidate);
  if (state.processedPaths.has(normalizedCandidate)) {
    return null;
  }
  state.processedPaths.add(normalizedCandidate);

  let rawContent: string;
  try {
    rawContent = await readFile(canonicalCandidate, "utf8");
  } catch {
    return null;
  }

  const prepared = stripInstructionFrontmatter(rawContent, canonicalCandidate, scopeDirectory, targetPath);
  const includePaths = extractInstructionIncludePaths(
    prepared.content,
    canonicalCandidate,
    state.workspaceRoot,
    state.trustedExternalRoots,
  );
  const sections: string[] = [];

  for (const includePath of includePaths) {
    const included = await loadInstructionContent(includePath, scopeDirectory, targetPath, {
      workspaceRoot: state.workspaceRoot,
      depth: state.depth + 1,
      processedPaths: state.processedPaths,
      trustedExternalRoots: state.trustedExternalRoots,
    });
    if (!included) {
      continue;
    }
    sections.push(
      `Included from ${formatInstructionIncludeLabel(includePath, state.workspaceRoot, state.trustedExternalRoots)}:\n${included.content}`,
    );
  }

  const content = sanitizeInstructionContent(prepared.content, canonicalCandidate, scopeDirectory).trim();
  if (!content) {
    return sections.length > 0 ? { content: sections.join("\n\n") } : null;
  }
  sections.push(content);
  return { content: sections.join("\n\n") };
}

function sanitizeInstructionContent(rawContent: string, candidatePath: string, scopeDirectory: string): string {
  const findings: string[] = [];

  for (const invisibleChar of INSTRUCTION_INVISIBLE_CHARS) {
    if (rawContent.includes(invisibleChar)) {
      findings.push(`invisible unicode U+${invisibleChar.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }

  for (const [pattern, findingId] of INSTRUCTION_THREAT_PATTERNS) {
    if (pattern.test(rawContent)) {
      findings.push(findingId);
    }
  }

  if (findings.length === 0) {
    return rawContent;
  }

  const displayPath = relative(scopeDirectory, candidatePath).replace(/\\/g, "/") || basename(candidatePath);
  return `[BLOCKED: ${displayPath} contained potential prompt injection (${findings.join(", ")}). Content not loaded.]`;
}

function stripInstructionFrontmatter(
  rawContent: string,
  candidatePath: string,
  scopeDirectory: string,
  targetPath: string,
): { content: string } {
  if (!rawContent.startsWith("---")) {
    return { content: rawContent };
  }

  const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontmatterMatch) {
    return { content: rawContent };
  }

  const frontmatter = frontmatterMatch[1] ?? "";
  const paths = extractInstructionRulePaths(frontmatter);
  if (paths.length > 0 && !matchesInstructionPaths(paths, candidatePath, scopeDirectory, targetPath)) {
    return { content: "" };
  }

  return {
    content: rawContent.slice(frontmatterMatch[0].length),
  };
}

function extractInstructionRulePaths(frontmatter: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  const results: string[] = [];
  let collectingList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (collectingList) {
        break;
      }
      continue;
    }

    if (collectingList) {
      const listMatch = line.match(/^-\s+(.+)$/);
      if (!listMatch) {
        collectingList = false;
      } else {
        results.push(stripQuotedValue(listMatch[1] ?? ""));
        continue;
      }
    }

    const inlineMatch = line.match(/^paths\s*:\s*(.+)$/i);
    if (inlineMatch) {
      const value = stripQuotedValue(inlineMatch[1] ?? "");
      if (value) {
        results.push(value);
      }
      continue;
    }

    if (/^paths\s*:\s*$/i.test(line)) {
      collectingList = true;
    }
  }

  return results.filter(Boolean);
}

function matchesInstructionRule(
  rawContent: string,
  candidatePath: string,
  scopeDirectory: string,
  targetPath: string,
): boolean {
  const stripped = stripInstructionFrontmatter(rawContent, candidatePath, scopeDirectory, targetPath);
  return stripped.content.trim().length > 0;
}

function matchesInstructionPaths(
  paths: string[],
  candidatePath: string,
  scopeDirectory: string,
  targetPath: string,
): boolean {
  const relativeTarget = relative(scopeDirectory, targetPath).replace(/\\/g, "/");
  if (!relativeTarget || relativeTarget.startsWith("..") || isDriveQualified(relativeTarget)) {
    return false;
  }

  return paths.some((pattern) => {
    const normalizedPattern = pattern.replace(/\\/g, "/").replace(/^\.?\//, "");
    return globMatches(relativeTarget, normalizedPattern);
  });
}

function globMatches(value: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return false;
  }

  let regexSource = "^";
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const current = normalizedPattern[index] ?? "";
    const next = normalizedPattern[index + 1] ?? "";
    if (current === "*" && next === "*") {
      regexSource += ".*";
      index += 1;
      continue;
    }
    if (current === "*") {
      regexSource += "[^/]*";
      continue;
    }
    if (current === "?") {
      regexSource += ".";
      continue;
    }
    regexSource += escapeLiteralForRegExp(current);
  }
  regexSource += "$";
  const regex = new RegExp(regexSource);
  return regex.test(value);
}

function stripQuotedValue(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function escapeLiteralForRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function extractInstructionIncludePaths(
  rawContent: string,
  candidatePath: string,
  workspaceRoot?: string,
  trustedExternalRoots: readonly string[] = [],
): string[] {
  const scrubbedContent = rawContent
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/`[^`\n]*`/g, " ");
  const includePattern = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
  const results: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null = includePattern.exec(scrubbedContent);

  while (match) {
    const resolvedPath = resolveInstructionIncludePath(
      match[1] ?? "",
      candidatePath,
      workspaceRoot,
      trustedExternalRoots,
    );
    if (resolvedPath) {
      const key = normalizeInstructionIncludePathKey(resolvedPath);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(resolvedPath);
      }
    }
    match = includePattern.exec(scrubbedContent);
  }

  return results;
}

function resolveInstructionIncludePath(
  rawPath: string,
  candidatePath: string,
  workspaceRoot?: string,
  trustedExternalRoots: readonly string[] = [],
): string | null {
  const hashIndex = rawPath.indexOf("#");
  const withoutFragment = hashIndex >= 0 ? rawPath.slice(0, hashIndex) : rawPath;
  const normalizedPath = withoutFragment.replace(/\\ /g, " ").trim();
  if (!normalizedPath) {
    return null;
  }

  let resolvedPath: string;
  if (normalizedPath.startsWith("~/")) {
    const homeRelativePath = normalizedPath.slice(2).replace(/\\/g, "/");
    const trustedClaudeRoot = trustedExternalRoots.find((root) => basename(root).toLowerCase() === ".claude");
    if (trustedClaudeRoot && homeRelativePath.toLowerCase().startsWith(".claude/")) {
      resolvedPath = resolve(trustedClaudeRoot, homeRelativePath.slice(".claude/".length));
    } else {
      const homeDirectory = process.env.USERPROFILE ?? process.env.HOME;
      if (!homeDirectory) {
        return null;
      }
      resolvedPath = resolve(homeDirectory, normalizedPath.slice(2));
    }
  } else if (normalizedPath.startsWith("/") || isDriveQualified(normalizedPath)) {
    resolvedPath = resolve(normalizedPath);
  } else {
    resolvedPath = resolve(dirname(candidatePath), normalizedPath);
  }

  if (workspaceRoot && !isPathInside(workspaceRoot, resolvedPath)) {
    const allowedExternalRoot = trustedExternalRoots.find((root) => isPathInside(root, resolvedPath));
    if (!allowedExternalRoot) {
      return null;
    }
  }
  return resolvedPath;
}

function listTrustedInstructionIncludeRoots(candidatePath: string): string[] {
  if (basename(candidatePath).toLowerCase() !== "claude.local.md") {
    return [];
  }

  const userClaudeRoot = resolveUserClaudeInstructionRoot();
  return userClaudeRoot ? [userClaudeRoot] : [];
}

function resolveUserClaudeInstructionRoot(): string | null {
  const homeDirectory = process.env.USERPROFILE ?? process.env.HOME;
  if (!homeDirectory) {
    return null;
  }
  return resolve(homeDirectory, ".claude");
}

function formatInstructionIncludeLabel(
  candidatePath: string,
  workspaceRoot?: string,
  trustedExternalRoots: readonly string[] = [],
): string {
  if (workspaceRoot && isPathInside(workspaceRoot, candidatePath)) {
    return relative(workspaceRoot, candidatePath).replace(/\\/g, "/") || basename(candidatePath);
  }
  const trustedExternalRoot = trustedExternalRoots.find((root) => isPathInside(root, candidatePath));
  if (trustedExternalRoot) {
    const suffix = relative(trustedExternalRoot, candidatePath).replace(/\\/g, "/");
    return suffix ? `~/.claude/${suffix}` : "~/.claude";
  }
  return basename(candidatePath);
}

function normalizeInstructionIncludePathKey(value: string): string {
  return resolve(value).toLowerCase();
}

async function resolveInstructionCandidatePath(
  candidatePath: string,
  allowedRoots: readonly string[],
): Promise<string | null> {
  const canonicalCandidate = await resolveWorkspaceBoundaryPath(candidatePath);
  for (const root of allowedRoots) {
    if (isPathInside(await resolveWorkspaceBoundaryPath(root), canonicalCandidate)) {
      return canonicalCandidate;
    }
  }
  return null;
}

function shouldIncludeInSandboxCopy(sourcePath: string, root: string): boolean {
  const relativePath = relative(root, sourcePath);
  if (!relativePath || relativePath === ".") {
    return true;
  }

  const [firstSegment] = relativePath.split(/[\\/]/);
  if (firstSegment && EXCLUDED_DIRECTORIES.has(firstSegment)) {
    return false;
  }

  return true;
}

async function shouldIncludeInWorkspaceCheckpointCopy(sourcePath: string, root: string, artifactsRoot: string): Promise<boolean> {
  if (isPathInside(artifactsRoot, sourcePath)) {
    return false;
  }
  if (!shouldIncludeInSandboxCopy(sourcePath, root)) {
    return false;
  }
  const [realRoot, realSource] = await Promise.all([
    resolveWorkspaceCheckpointBoundaryPath(root),
    resolveWorkspaceCheckpointBoundaryPath(sourcePath),
  ]);
  if (!realRoot || !realSource) {
    return false;
  }
  return isPathInside(realRoot, realSource);
}

async function collectCheckpointPreservedExternalTopLevelEntries(root: string, artifactsRoot: string): Promise<string[]> {
  const realRoot = await resolveWorkspaceCheckpointBoundaryPath(root);
  if (!realRoot) {
    return [];
  }
  let entries: Array<{ readonly name: string }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const preserved: string[] = [];
  for (const entry of entries) {
    const sourcePath = join(root, entry.name);
    if (isPathInside(artifactsRoot, sourcePath) || !shouldIncludeInSandboxCopy(sourcePath, root)) {
      continue;
    }
    const realSource = await resolveWorkspaceCheckpointBoundaryPath(sourcePath);
    if (realSource && !isPathInside(realRoot, realSource)) {
      preserved.push(entry.name);
    }
  }
  return preserved.sort();
}

async function isExternalCheckpointLinkEntry(sourcePath: string, root: string): Promise<boolean> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(sourcePath);
  } catch {
    return false;
  }
  if (!stats.isSymbolicLink()) {
    return false;
  }
  const [realRoot, realSource] = await Promise.all([
    resolveWorkspaceCheckpointBoundaryPath(root),
    resolveWorkspaceCheckpointBoundaryPath(sourcePath),
  ]);
  return !realRoot || !realSource || !isPathInside(realRoot, realSource);
}

function parseGitGrepLine(line: string): { path: string; lineNumber: number; lineText: string } | null {
  if (!line.trim()) {
    return null;
  }

  const match = /^(.*?):(\d+):(.*)$/.exec(line);
  if (!match) {
    return null;
  }

  return {
    path: match[1] ?? "",
    lineNumber: Number(match[2] ?? "0"),
    lineText: match[3] ?? "",
  };
}

function buildWorkspaceKey(targetPath: string): string {
  const normalized = resolve(targetPath);
  const base = sanitizePathSegment(basename(normalized) || "workspace") || "workspace";
  const digest = createHash("sha1").update(normalized).digest("hex").slice(0, 10);
  return `${base}-${digest}`;
}

function isPathInside(parent: string, candidate: string): boolean {
  const relativePath = relative(resolve(parent), resolve(candidate));
  if (!relativePath) {
    return true;
  }
  return !relativePath.startsWith("..") && !isDriveQualified(relativePath);
}

function isManagedExecutionChild(managedRoot: string, candidate: string): boolean {
  const relativePath = relative(resolve(managedRoot), resolve(candidate));
  return Boolean(relativePath) && !relativePath.startsWith("..") && !isDriveQualified(relativePath);
}

function isDriveQualified(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value);
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}
