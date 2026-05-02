import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import process from "node:process";

import {
  classifyToolCall,
  describeApprovalClass,
  JsonFileApprovalGrantStore,
  resolveApprovalDecision,
  type ApprovalGrantStore,
  type ApprovalPolicy,
  type ToolRiskAssessment,
} from "@omni-agent/approvals";
import { AgentRuntime, type AgentRuntimeEvent, type ApprovalHandlerResult } from "@omni-agent/core-runtime";
import { summarizeThread, type VerificationMode } from "@omni-agent/context";
import {
  createExtensionRuntimeTools,
  inspectExtensionPackageContracts,
  loadExtensionRegistry,
  resolvePluginDirectories,
} from "@omni-agent/extensions";
import {
  buildBenchmarkQualityReport,
  normalizeEvalSuiteDefinition,
  runEvalSuite,
  type EvalObservedRun,
  type EvalSuiteDefinition,
  type EvalSuiteResult,
} from "@omni-agent/evals";
import {
  prepareRouteDefinition,
  RouteConfigurationError,
  shouldDefaultRouteToPairing,
  startGatewayServer,
  type GatewayMode,
} from "@omni-agent/gateway";
import {
  AnthropicMessagesModelClient,
  FailoverModelClient,
  MockModelClient,
  OpenAiCompatibleModelClient,
  buildModelProfileDiagnostics,
  estimateModelUsageCost,
  hasModelProfileApiKey,
  inspectModelProfilesFromJson,
  inspectModelProfilesFromEnv,
  loadModelProfilesFromJson,
  loadModelProfilesFromEnv,
  selectModelProfiles,
  type ModelProtocol,
  type ModelProfile,
  type ModelClient,
} from "@omni-agent/model-client";
import { redactSensitiveText, redactSensitiveValue } from "@omni-agent/safety";
import {
  computeAutomationNextRunAt,
  SqliteSessionStore,
  type AutomationScheduleKind,
  type ArtifactRecord,
  type ChannelRouteRecord,
  type RouteAdapterType,
  type RunMetricsRecord,
  type ToolEventRecord,
  type GlobalUsageSummary,
  type PersistedSubagentJobRecord,
  type WorkspaceUsageSummary,
  type ThreadUsageSummary,
} from "@omni-agent/session-store";
import { ToolRegistry, registerBuiltInTools } from "@omni-agent/tools";
import {
  LocalWorkspaceService,
  listExecutionBackends,
  type ExecutionDomain,
  type WorkspaceCheckpointRecord,
  type WorkspaceMemoryFileKind,
  type WorkspaceSkillFile,
  type WorkspaceSkillIndexEntry,
  type WorkspaceSnapshot,
} from "@omni-agent/workspace";

type CliMode = GatewayMode;
type MemoryPersistenceBackend = "both" | "file" | "store";
type MemorySearchBackend = "both" | "file" | "store";
type RunOutputFormat = "text" | "json" | "stream-json";
type CliCommandName =
  | "chat"
  | "onboard"
  | "setup"
  | "config"
  | "models"
  | "evals"
  | "doctor"
  | "run"
  | "memory-save"
  | "memory-search"
  | "skills"
  | "automation-create"
  | "automation-run"
  | "automation-pause"
  | "automation-resume"
  | "automations"
  | "threads"
  | "runs"
  | "usage"
  | "show-thread"
  | "compact-thread"
  | "show-run"
  | "cleanup-run"
  | "workspaces"
  | "insights"
  | "routes"
  | "route-create"
  | "pairings"
  | "pairing-approve"
  | "deliveries"
  | "extensions"
  | "serve"
  | "daemon-start"
  | "daemon-stop"
  | "daemon-status";

interface RuntimeCliOptions {
  readonly mode: CliMode;
  readonly modelProfileId?: string;
  readonly approvalPolicy: ApprovalPolicy;
  readonly executionDomain: ExecutionDomain;
  readonly verificationMode: VerificationMode;
  readonly verificationCommands: string[];
  readonly autoApproveRisky: boolean;
  readonly maxIterations: number;
}

interface BaseCliOptions {
  readonly command: CliCommandName;
  readonly cwd: string;
  readonly storageRoot?: string;
  readonly pluginDirs: string[];
}

interface RunCliOptions extends BaseCliOptions, RuntimeCliOptions {
  readonly command: "run";
  readonly task: string;
  readonly threadTitle?: string;
  readonly threadId?: string;
  readonly continueLatest: boolean;
  readonly outputFormat: RunOutputFormat;
}

interface ChatCliOptions extends BaseCliOptions, RuntimeCliOptions {
  readonly command: "chat";
  readonly threadTitle?: string;
  readonly threadId?: string;
  readonly continueLatest: boolean;
  readonly historyLimit: number;
}

interface ModelsCliOptions extends BaseCliOptions {
  readonly command: "models";
}

interface EvalsCliOptions extends BaseCliOptions, RuntimeCliOptions {
  readonly command: "evals";
  readonly manifestPath: string;
  readonly outputPath?: string;
}

interface SetupCliOptions extends BaseCliOptions {
  readonly command: "onboard" | "setup";
  readonly defaultWorkspace?: string;
  readonly gatewayToken?: string;
  readonly profileId?: string;
  readonly profileName?: string;
  readonly profileProtocol?: ModelProtocol;
  readonly profileBaseUrl?: string;
  readonly profileApiKeyEnv?: string;
  readonly profileModel?: string;
  readonly supportsTools?: boolean;
  readonly supportsStreaming?: boolean;
  readonly force: boolean;
}

interface ConfigCliOptions extends BaseCliOptions {
  readonly command: "config";
}

interface DoctorCliOptions extends BaseCliOptions {
  readonly command: "doctor";
  readonly mode: CliMode;
  readonly strict: boolean;
  readonly fix: boolean;
}

interface MemorySaveCliOptions extends BaseCliOptions {
  readonly command: "memory-save";
  readonly content: string;
  readonly scope: "thread" | "workspace";
  readonly threadId?: string;
  readonly tags: string[];
  readonly backend: MemoryPersistenceBackend;
  readonly fileKind?: WorkspaceMemoryFileKind;
}

interface MemorySearchCliOptions extends BaseCliOptions {
  readonly command: "memory-search";
  readonly query?: string;
  readonly scope?: "thread" | "workspace";
  readonly threadId?: string;
  readonly limit: number;
  readonly backend: MemorySearchBackend;
}

interface SkillsCliOptions extends BaseCliOptions {
  readonly command: "skills";
  readonly query?: string;
  readonly limit: number;
  readonly reviewQueue: boolean;
}

interface AutomationsCliOptions extends BaseCliOptions {
  readonly command: "automations";
}

interface AutomationCreateCliOptions extends BaseCliOptions, RuntimeCliOptions {
  readonly command: "automation-create";
  readonly title: string;
  readonly task: string;
  readonly threadId?: string;
  readonly threadTitle?: string;
  readonly scheduleKind: AutomationScheduleKind;
  readonly intervalSeconds?: number;
  readonly scheduleExpression?: string;
  readonly timezone?: string;
  readonly status: "active" | "paused";
}

interface AutomationRunCliOptions extends BaseCliOptions {
  readonly command: "automation-run";
  readonly automationId: string;
}

interface AutomationStatusCliOptions extends BaseCliOptions {
  readonly command: "automation-pause" | "automation-resume";
  readonly automationId: string;
}

interface ThreadsCliOptions extends BaseCliOptions {
  readonly command: "threads";
}

interface RunsCliOptions extends BaseCliOptions {
  readonly command: "runs";
  readonly threadId: string;
  readonly limit: number;
}

interface UsageCliOptions extends BaseCliOptions {
  readonly command: "usage";
  readonly threadId?: string;
}

interface InsightsCliOptions extends BaseCliOptions {
  readonly command: "insights";
  readonly workspaceId?: string;
}

interface ShowThreadCliOptions extends BaseCliOptions {
  readonly command: "show-thread";
  readonly threadId: string;
  readonly limit: number;
}

interface CompactThreadCliOptions extends BaseCliOptions {
  readonly command: "compact-thread";
  readonly threadId: string;
  readonly keepMessages: number;
}

interface ShowRunCliOptions extends BaseCliOptions {
  readonly command: "show-run";
  readonly runId: string;
}

interface CleanupRunCliOptions extends BaseCliOptions {
  readonly command: "cleanup-run";
  readonly runId: string;
}

interface WorkspacesCliOptions extends BaseCliOptions {
  readonly command: "workspaces";
}

interface RoutesCliOptions extends BaseCliOptions {
  readonly command: "routes";
}

interface PairingsCliOptions extends BaseCliOptions {
  readonly command: "pairings";
  readonly routeId?: string;
  readonly status?: "approved" | "pending" | "rejected";
  readonly limit: number;
}

interface PairingApproveCliOptions extends BaseCliOptions {
  readonly command: "pairing-approve";
  readonly code: string;
}

interface RouteCreateCliOptions extends BaseCliOptions {
  readonly command: "route-create";
  readonly title?: string;
  readonly threadId?: string;
  readonly channelType: string;
  readonly channelKey: string;
  readonly adapterType: RouteAdapterType;
  readonly adapterConfig: Record<string, unknown>;
  readonly inboundSecret?: string;
  readonly status: "active" | "paused";
}

interface DeliveriesCliOptions extends BaseCliOptions {
  readonly command: "deliveries";
  readonly routeId?: string;
  readonly status?: "delivered" | "failed" | "queued" | "sending";
  readonly limit: number;
}

interface ExtensionsCliOptions extends BaseCliOptions {
  readonly command: "extensions";
}

interface ServeCliOptions extends BaseCliOptions, RuntimeCliOptions {
  readonly command: "serve";
  readonly host: string;
  readonly port: number;
  readonly gatewayToken?: string;
}

interface DaemonStartCliOptions extends BaseCliOptions, RuntimeCliOptions {
  readonly command: "daemon-start";
  readonly host: string;
  readonly port: number;
  readonly gatewayToken?: string;
}

interface DaemonControlCliOptions extends BaseCliOptions {
  readonly command: "daemon-stop" | "daemon-status";
}

type CliOptions =
  | ChatCliOptions
  | SetupCliOptions
  | ConfigCliOptions
  | ModelsCliOptions
  | EvalsCliOptions
  | DoctorCliOptions
  | RunCliOptions
  | MemorySaveCliOptions
  | MemorySearchCliOptions
  | SkillsCliOptions
  | AutomationsCliOptions
  | AutomationCreateCliOptions
  | AutomationRunCliOptions
  | AutomationStatusCliOptions
  | ThreadsCliOptions
  | RunsCliOptions
  | UsageCliOptions
  | InsightsCliOptions
  | ShowThreadCliOptions
  | CompactThreadCliOptions
  | ShowRunCliOptions
  | CleanupRunCliOptions
  | WorkspacesCliOptions
  | RoutesCliOptions
  | PairingsCliOptions
  | PairingApproveCliOptions
  | RouteCreateCliOptions
  | DeliveriesCliOptions
  | ExtensionsCliOptions
  | ServeCliOptions
  | DaemonStartCliOptions
  | DaemonControlCliOptions;

interface GatewayDaemonState {
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly cwd: string;
  readonly logPath: string;
  readonly startedAt: string;
  readonly tokenConfigured: boolean;
}

interface OmniAgentConfig {
  readonly defaultWorkspace?: string;
  readonly gatewayToken?: string;
  readonly modelProfiles?: ModelProfile[];
  readonly updatedAt?: string;
}

class SetupConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SetupConfigurationError";
  }
}

interface WorkspaceBootstrapTemplate {
  readonly filename: string;
  readonly content: string;
}

interface WorkspaceBootstrapResult {
  readonly path: string;
  readonly status: "created" | "updated" | "skipped";
}

const WORKSPACE_BOOTSTRAP_TEMPLATES: readonly WorkspaceBootstrapTemplate[] = [
  {
    filename: "AGENTS.md",
    content: `# AGENTS.md

Workspace operating guide for omni-agent.

## Startup

The runtime may already preload \`AGENTS.md\`, \`SOUL.md\`, \`TOOLS.md\`, \`MEMORY.md\`, \`USER.md\`, and recent daily memory files.
Prefer that provided context before rereading files manually.

## Memory

- \`MEMORY.md\`: curated long-term memory
- \`USER.md\`: stable user preferences and constraints
- \`memory/YYYY-MM-DD.md\`: daily notes and session logs

Write durable facts to files instead of relying on session memory.

## Working Rules

- Match existing repository conventions.
- Ask before destructive or external actions.
- Keep secrets and private data inside the workspace unless the user says otherwise.
`,
  },
  {
    filename: "SOUL.md",
    content: `# SOUL.md

## Core Truths

- Be genuinely helpful and direct.
- Be resourceful before asking.
- Earn trust through careful, competent changes.

## Tone

Concise by default. Thorough when it matters. Avoid filler.

## Boundaries

- Private data stays private.
- Ask before external or irreversible actions.
- If you substantially change this file, tell the user.
`,
  },
  {
    filename: "TOOLS.md",
    content: `# TOOLS.md

Local notes for environment-specific details.

## Put things here

- SSH aliases
- internal service URLs
- device or camera names
- preferred voices
- workspace-specific commands

Keep shared tool behavior in skills or code. Keep local specifics here.
`,
  },
  {
    filename: "MEMORY.md",
    content: `# MEMORY.md

Curated long-term memory for this workspace.

## Stable Facts

- Add lasting project facts here.

## Decisions

- Record decisions worth carrying across sessions.

## Lessons

- Capture mistakes and follow-up guidance.
`,
  },
  {
    filename: "USER.md",
    content: `# USER.md

Stable user preferences for this workspace.

## Communication

- Preferred level of detail:
- Preferred language:
- When to ask before acting:

## Tooling

- Preferred package manager:
- Preferred test/build commands:

## Constraints

- Security, deployment, or style constraints:
`,
  },
];

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  switch (options.command) {
    case "chat":
      process.exitCode = await runChatCommand(options);
      return;
    case "onboard":
    case "setup":
      runSetupCommand(options);
      return;
    case "config":
      printConfigCommand(options);
      return;
    case "models":
      printModels(options);
      return;
    case "evals":
      process.exitCode = await runEvalCommand(options);
      return;
    case "doctor":
      process.exitCode = await runDoctorCommand(options);
      return;
      case "run":
        process.exitCode = await runTaskCommand(options);
        return;
      case "memory-save":
        await saveMemory(options);
        return;
      case "memory-search":
        await searchMemories(options);
        return;
    case "skills":
      await printLearnedSkills(options);
      return;
    case "automations":
      printAutomations(options);
      return;
    case "automation-create":
      createAutomation(options);
      return;
    case "automation-run":
      process.exitCode = await runAutomation(options);
      return;
    case "automation-pause":
    case "automation-resume":
      updateAutomationStatus(options);
      return;
    case "threads":
      printThreads(options);
      return;
    case "runs":
      printRuns(options);
      return;
    case "usage":
      printUsageSummaryCommand(options);
      return;
    case "insights":
      printInsightsSummaryCommand(options);
      return;
    case "show-thread":
      printThreadMessages(options);
      return;
    case "compact-thread":
      compactThreadCommand(options);
      return;
    case "show-run":
      printRunDetails(options);
      return;
    case "cleanup-run":
      await cleanupRun(options);
      return;
    case "workspaces":
      printWorkspaces(options);
      return;
    case "routes":
      printRoutes(options);
      return;
    case "pairings":
      printPairings(options);
      return;
    case "pairing-approve":
      approvePairing(options);
      return;
    case "route-create":
      createRouteCommand(options);
      return;
    case "deliveries":
      printDeliveries(options);
      return;
    case "extensions":
      await printExtensions(options);
      return;
    case "serve":
      await runServerCommand(options);
      return;
    case "daemon-start":
      await startDaemonCommand(options);
      return;
    case "daemon-stop":
      stopDaemonCommand(options);
      return;
    case "daemon-status":
      printDaemonStatus(options);
      return;
    default:
      throw new Error(`Unknown command: ${(options as BaseCliOptions).command}`);
  }
}

async function runTaskCommand(options: RunCliOptions): Promise<number> {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  const output = createRunOutputWriter(options.outputFormat);
  try {
    const { runtime, close } = await createRuntimeHost(
      {
        ...options,
        eventHandler: output.handleEvent,
        structuredOutput: options.outputFormat !== "text",
      },
      sessionStore,
    );
    try {
      const summary = await runtime.runTask({
        objective: options.task,
        threadTitle: options.threadTitle,
        threadId: options.threadId,
        continueLatest: options.continueLatest,
        verificationCommands: options.verificationCommands,
        maxIterations: options.maxIterations,
      });

      output.writeSummary(summary);
      return summary.run.status === "failed" ? 1 : 0;
    } finally {
      await close();
    }
  } finally {
    sessionStore.close();
  }
}

async function runEvalCommand(options: EvalsCliOptions): Promise<number> {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    const manifestPath = resolve(options.manifestPath);
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")) as EvalSuiteDefinition;
    const suite = normalizeEvalSuiteDefinition(parsed, {
      baseDir: dirname(manifestPath),
      defaultWorkspaceCwd: options.cwd,
    });
    const result = await runEvalSuite(suite, async ({ scenario, step, threadId }) => {
      const runtimeOptions = {
        ...options,
        cwd: scenario.workspaceCwd,
      };
      const { runtime, close } = await createRuntimeHost(runtimeOptions, sessionStore);
      try {
        const summary = await runtime.runTask({
          objective: step.objective,
          threadTitle: scenario.threadTitle ?? scenario.title,
          threadId,
          continueLatest: false,
          successCriteria: step.successCriteria,
          constraints: step.constraints,
          verificationCommands: step.verificationCommands ?? options.verificationCommands,
          maxIterations: step.maxIterations ?? options.maxIterations,
        });
        return {
          observedRun: mapRunSummaryToEvalObservedRun(summary),
          threadId: summary.thread.id,
        };
      } finally {
        await close();
      }
    });

    if (options.outputPath) {
      const outputPath = resolve(options.outputPath);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }

    printEvalSuiteSummary(result);
    if (result.qualityThresholds) {
      return buildBenchmarkQualityReport(result, result.qualityThresholds).passed ? 0 : 1;
    }
    return result.metrics.completedCount === result.metrics.scenarioCount ? 0 : 1;
  } finally {
    sessionStore.close();
  }
}

async function runChatCommand(options: ChatCliOptions): Promise<number> {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const lineIterator = interactive ? null : readline[Symbol.asyncIterator]();

  let exitCode = 0;
  let threadId = options.threadId;
  let threadTitle = options.threadTitle;
  let continueLatest = options.continueLatest;
  let mode = options.mode;
  let modelProfileId = options.modelProfileId;
  let executionDomain = options.executionDomain;
  let verificationMode = options.verificationMode;
  let verificationCommands = [...options.verificationCommands];
  let maxIterations = options.maxIterations;
  const approvalGrants = new JsonFileApprovalGrantStore(
    join(resolveStorageRoot(options.storageRoot), "approval-grants.json"),
  );
  const chatCommands = createDefaultChatCommandRegistry();

  try {
    sessionStore.initialize();
    await registerWorkspaceSkillSlashCommands(chatCommands, options, sessionStore);
    printChatBanner(options);

    while (true) {
      const rawInput = interactive
        ? await readline.question("omni-agent> ")
        : await readPipedChatLine(lineIterator);
      if (rawInput === null) {
        break;
      }

      const input = rawInput.trim();
      if (!input) {
        continue;
      }

      if (input.startsWith("/")) {
        const commandResult = await handleChatSlashCommand(
          chatCommands,
          {
            options,
            sessionStore,
            approvalGrants,
            threadId,
            threadTitle,
            continueLatest,
            mode,
            modelProfileId,
            executionDomain,
            verificationMode,
            verificationCommands,
            maxIterations,
          },
          input,
        );
        if (commandResult.exit) {
          return exitCode;
        }
        if (commandResult.exitCode !== undefined) {
          exitCode = commandResult.exitCode;
        }
        threadId = commandResult.threadId;
        threadTitle = commandResult.threadTitle;
        continueLatest = commandResult.continueLatest;
        mode = commandResult.mode;
        modelProfileId = commandResult.modelProfileId;
        executionDomain = commandResult.executionDomain;
        verificationMode = commandResult.verificationMode;
        verificationCommands = commandResult.verificationCommands;
        maxIterations = commandResult.maxIterations;
        continue;
      }

      const taskResult = await executeChatTask(
        {
          options,
          sessionStore,
          approvalGrants,
          threadId,
          threadTitle,
          continueLatest,
          mode,
          modelProfileId,
          executionDomain,
          verificationMode,
          verificationCommands,
          maxIterations,
        },
        input,
      );
      threadId = taskResult.threadId;
      threadTitle = taskResult.threadTitle;
      continueLatest = taskResult.continueLatest;
      if (taskResult.exitCode !== undefined) {
        exitCode = taskResult.exitCode;
      }
    }

    return exitCode;
  } finally {
    readline.close();
    sessionStore.close();
  }
}

async function readPipedChatLine(
  iterator: AsyncIterator<string> | null,
): Promise<string | null> {
  if (!iterator) {
    return null;
  }

  const next = await iterator.next();
  return next.done ? null : next.value;
}

function printChatBanner(options: ChatCliOptions): void {
  const profiles = loadConfiguredModelProfiles(options.storageRoot);
  const lines = [
    "",
    "Omni Agent Chat",
    "===============",
    `Workspace: ${options.cwd}`,
    `Mode:      ${options.mode}`,
    `Model:     ${describeModelSelection(options.mode, options.modelProfileId, profiles)}`,
    `Domain:    ${options.executionDomain}`,
    `Verify:    ${options.verificationMode}${options.verificationCommands.length > 0 ? ` (${options.verificationCommands.join(" | ")})` : ""}`,
    `Turns:     ${options.maxIterations}`,
    `History:   ${options.historyLimit}`,
    "",
    "Type a task to run it in the active thread.",
    "Use /help for chat commands.",
  ];
  console.log(lines.join("\n"));
}

function printChatHelp(registry: ChatCommandRegistry = createDefaultChatCommandRegistry()): void {
  const lines = [
    "",
    "Chat Commands",
    "=============",
    ...registry.list().flatMap((entry) => entry.helpLines),
  ];
  console.log(lines.join("\n"));
}

function printChatStatus(state: ChatSessionState): void {
  const profiles = loadConfiguredModelProfiles(state.options.storageRoot);
  const messageCount = state.threadId ? state.sessionStore.countThreadMessages(state.threadId) : 0;
  const usage = state.threadId ? state.sessionStore.summarizeThreadUsage(state.threadId) : null;
  const lines = [
    "",
    "Chat Status",
    "===========",
    `Workspace: ${state.options.cwd}`,
    `Mode:      ${state.mode}`,
    `Model:     ${describeModelSelection(state.mode, state.modelProfileId, profiles)}`,
    `Domain:    ${state.executionDomain}`,
    `Verify:    ${state.verificationMode}`,
    `Commands:  ${state.verificationCommands.join(" | ") || "default runtime verification"}`,
    `Turns:     ${state.maxIterations}`,
    `Messages:  ${messageCount}`,
    `Thread:    ${state.threadTitle ?? "not started yet"}`,
    `Thread ID: ${state.threadId ?? "n/a"}${state.continueLatest ? " (continue latest on first turn)" : ""}`,
    `Usage:     ${usage ? formatTokenSummary(usage.inputTokens, usage.outputTokens, usage.totalTokens) : "n/a"}`,
  ];
  console.log(lines.join("\n"));
}

function printChatSessionDetails(state: ChatSessionState): void {
  if (!state.threadId) {
    console.log("No active thread yet.");
    return;
  }

  const thread = state.sessionStore.getThread(state.threadId);
  if (!thread) {
    console.log(`Thread ${state.threadId} was not found.`);
    return;
  }

  const summary = state.sessionStore.getThreadSummary(thread.id);
  const usage = state.sessionStore.summarizeThreadUsage(thread.id);
  const lines = [
    "",
    "Session Details",
    "===============",
    `Thread:         ${thread.title}`,
    `Thread ID:      ${thread.id}`,
    `Updated:        ${thread.updatedAt}`,
    `Message Count:  ${state.sessionStore.countThreadMessages(thread.id)}`,
    `Stored Summary: ${summary?.summary ?? "none"}`,
    ...(usage ? ["Usage:", ...formatThreadUsageSummary(usage).map((line) => `  ${line}`)] : []),
  ];
  console.log(lines.join("\n"));
}

function printChatTurnSummary(summary: Awaited<ReturnType<AgentRuntime["runTask"]>>): void {
  const lines = [
    "",
    `assistant> ${summary.finalResponse}`,
    "",
    `Run:       ${summary.run.id} (${summary.run.status})`,
    `Thread:    ${summary.thread.title} (${summary.thread.id})${summary.resumedThread ? " [resumed]" : ""}`,
    `Verify:    ${summary.verification.status} (${summary.verification.summary})`,
    `Changed:   ${summary.changedFiles.join(", ") || "none"}`,
    `Artifacts: ${summary.artifacts.length}`,
    ...(summary.runMetrics ? formatRunMetricsSummary(summary.runMetrics, "Metrics:   ") : []),
  ];

  if (summary.diffSummary?.stat) {
    lines.push("Diff:", summary.diffSummary.stat);
  }

  console.log(lines.join("\n"));
}

function formatRunMetricsSummary(metrics: RunMetricsRecord, firstLabel = "Usage:"): string[] {
  return [
    `${firstLabel} ${formatTokenSummary(metrics.inputTokens, metrics.outputTokens, metrics.totalTokens)}`,
    `Turns:     ${metrics.turnCount}  Tool calls: ${metrics.toolCallCount}  Success: ${metrics.toolSuccessCount}  Failed: ${metrics.toolFailureCount}  Blocked: ${metrics.blockedApprovalCount}`,
    `Profiles:  ${metrics.modelProfiles.join(", ") || "none"}`,
    `Duration:  ${formatDuration(metrics.durationMs)}${metrics.completedAt ? `  Completed: ${metrics.completedAt}` : ""}`,
  ];
}

function formatThreadUsageSummary(summary: ThreadUsageSummary): string[] {
  return [
    `Runs: ${summary.runCount}`,
    `Tokens: ${formatTokenSummary(summary.inputTokens, summary.outputTokens, summary.totalTokens)}`,
    `Turns: ${summary.turnCount}  Tool calls: ${summary.toolCallCount}  Success: ${summary.toolSuccessCount}  Failed: ${summary.toolFailureCount}  Blocked: ${summary.blockedApprovalCount}`,
    `Profiles: ${summary.modelProfiles.join(", ") || "none"}`,
    `Duration: ${formatDuration(summary.totalDurationMs)}`,
    `Window: ${summary.firstStartedAt ?? "n/a"} -> ${summary.lastCompletedAt ?? "n/a"}`,
  ];
}

function formatUsageCostEstimate(summary: ThreadUsageSummary | WorkspaceUsageSummary | GlobalUsageSummary): string[] {
  if (summary.modelProfiles.length !== 1) {
    return [`Estimated cost: unknown (requires exactly one model profile, saw ${summary.modelProfiles.length}).`];
  }
  const inputTokens = summary.inputTokens ?? 0;
  const outputTokens = summary.outputTokens ?? 0;
  const estimate = estimateModelUsageCost(summary.modelProfiles[0]!, {
    inputTokens,
    outputTokens,
    totalTokens: summary.totalTokens ?? inputTokens + outputTokens,
  });
  if (estimate.status === "unknown" || estimate.estimatedCostUsd === null) {
    return [`Estimated cost: unknown (${estimate.summary})`];
  }
  return [`Estimated cost: $${formatUsd(estimate.estimatedCostUsd)} (${estimate.model}, ${estimate.source})`];
}

function formatUsd(value: number): string {
  return value < 0.01 ? value.toFixed(6) : value.toFixed(4);
}

function formatWorkspaceUsageSummary(summary: WorkspaceUsageSummary): string[] {
  return [
    `Workspace: ${summary.workspaceName} (${summary.workspaceId})`,
    ...formatUsageSummaryBody(summary),
  ];
}

function formatGlobalUsageSummary(summary: GlobalUsageSummary): string[] {
  return [
    `Workspaces: ${summary.workspaceCount}`,
    `Threads: ${summary.threadCount}`,
    ...formatUsageSummaryBody(summary),
  ];
}

function formatUsageSummaryBody(summary: {
  readonly runCount: number;
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolSuccessCount: number;
  readonly toolFailureCount: number;
  readonly blockedApprovalCount: number;
  readonly modelProfiles: string[];
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly totalDurationMs: number | null;
  readonly firstStartedAt: string | null;
  readonly lastCompletedAt: string | null;
}): string[] {
  return [
    `Runs: ${summary.runCount}`,
    `Tokens: ${formatTokenSummary(summary.inputTokens, summary.outputTokens, summary.totalTokens)}`,
    `Turns: ${summary.turnCount}  Tool calls: ${summary.toolCallCount}  Success: ${summary.toolSuccessCount}  Failed: ${summary.toolFailureCount}  Blocked: ${summary.blockedApprovalCount}`,
    `Profiles: ${summary.modelProfiles.join(", ") || "none"}`,
    `Duration: ${formatDuration(summary.totalDurationMs)}`,
    `Window: ${summary.firstStartedAt ?? "n/a"} -> ${summary.lastCompletedAt ?? "n/a"}`,
  ];
}

function formatTokenSummary(
  inputTokens: number | null,
  outputTokens: number | null,
  totalTokens: number | null,
): string {
  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return "not reported";
  }
  return [
    `in=${inputTokens ?? "n/a"}`,
    `out=${outputTokens ?? "n/a"}`,
    `total=${totalTokens ?? "n/a"}`,
  ].join("  ");
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs)) {
    return "n/a";
  }
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }
  const seconds = durationMs / 1_000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds - minutes * 60;
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
}

function resolveMostRecentThreadForWorkspace(
  sessionStore: SqliteSessionStore,
  cwd: string,
): ReturnType<SqliteSessionStore["getThread"]> {
  const workspace = sessionStore.getWorkspaceByCwd(cwd);
  if (!workspace) {
    return null;
  }
  return sessionStore.findRecentThread(workspace.id);
}

async function createChatWorkspaceInspector(state: ChatSessionState): Promise<LocalWorkspaceService> {
  const storageRoot = resolveStorageRoot(state.options.storageRoot);
  const workspace = new LocalWorkspaceService(state.options.cwd, join(storageRoot, "artifacts", "chat-inspector"));
  await workspace.ensureReady();
  return workspace;
}

async function executeChatWorkspaceTool(
  state: ChatSessionState,
  toolName: "create_checkpoint" | "list_checkpoints" | "rollback_checkpoint",
  args: Record<string, unknown>,
): Promise<unknown> {
  const workspace = await createChatWorkspaceInspector(state);
  const registry = new ToolRegistry();
  registerBuiltInTools(registry);
  const assessment = classifyToolCall({
    toolName,
    args,
    riskHint: registry.getSpec(toolName)?.riskHint,
  });
  const decision = resolveApprovalDecision(state.options.approvalPolicy, assessment);
  if (decision === "deny" || (decision === "prompt" && !state.options.autoApproveRisky)) {
    throw new Error(
      `Blocked ${toolName} due to approval policy (${decision}). Class=${assessment.approvalClass}; tier=${assessment.riskTier}; reason=${assessment.reason}`,
    );
  }
  const result = await registry.execute(
    toolName,
    {
      workspace,
      executionDomain: state.executionDomain,
      sessionStore: state.sessionStore,
    },
    args,
  );
  if (!result.ok) {
    throw new Error(result.summary);
  }
  return result.data;
}

function formatCheckpointFields(checkpoint: WorkspaceCheckpointRecord): string[] {
  return [
    `id: ${checkpoint.id}`,
    `label: ${checkpoint.name}`,
    `createdAt: ${checkpoint.createdAt}`,
  ];
}

function printCheckpointRecord(heading: string, checkpoint: WorkspaceCheckpointRecord): void {
  console.log(["", heading, "=".repeat(heading.length), ...formatCheckpointFields(checkpoint)].join("\n"));
}

async function printChatCheckpoints(state: ChatSessionState): Promise<void> {
  const checkpoints = await executeChatWorkspaceTool(state, "list_checkpoints", {}) as WorkspaceCheckpointRecord[];
  if (checkpoints.length === 0) {
    console.log("No checkpoints found.");
    return;
  }
  const lines = ["", "Checkpoints", "==========="];
  for (const checkpoint of checkpoints) {
    lines.push("", ...formatCheckpointFields(checkpoint));
  }
  console.log(lines.join("\n"));
}

async function createChatCheckpoint(state: ChatSessionState, label: string): Promise<void> {
  if (!label) {
    console.log("Usage: /checkpoint <label>");
    return;
  }
  const checkpoint = await executeChatWorkspaceTool(state, "create_checkpoint", { name: label }) as WorkspaceCheckpointRecord;
  printCheckpointRecord("Checkpoint Created", checkpoint);
}

async function rollbackChatCheckpoint(state: ChatSessionState, checkpointId: string): Promise<void> {
  if (!checkpointId) {
    console.log("Usage: /rollback <id>");
    return;
  }
  const checkpoint = await executeChatWorkspaceTool(
    state,
    "rollback_checkpoint",
    { checkpointId },
  ) as WorkspaceCheckpointRecord;
  printCheckpointRecord("Checkpoint Rolled Back", checkpoint);
}

async function printChatDiff(state: ChatSessionState): Promise<void> {
  const workspace = await createChatWorkspaceInspector(state);
  const diffSummary = await workspace.getGitDiffSummary();
  if (!diffSummary) {
    console.log("No git diff is available for the current workspace.");
    return;
  }

  const lines = [
    "",
    "Workspace Diff",
    "==============",
    `Changed files: ${diffSummary.changedFiles.join(", ") || "none"}`,
    "",
    "Diff Stat:",
    diffSummary.stat || "no diff stat available",
  ];
  if (diffSummary.patchPreview.trim()) {
    lines.push("", "Patch Preview:", diffSummary.patchPreview);
  }
  console.log(lines.join("\n"));
}

async function printChatReview(state: ChatSessionState): Promise<void> {
  const workspace = await createChatWorkspaceInspector(state);
  const diffSummary = await workspace.getGitDiffSummary();
  const latestRun = state.threadId ? state.sessionStore.listRuns(state.threadId, 1).at(0) ?? null : null;
  const latestMetrics = latestRun ? state.sessionStore.getRunMetrics(latestRun.id) : null;
  const latestToolEvents = latestRun ? state.sessionStore.listRunToolEvents(latestRun.id) : [];
  const findings: string[] = [];

  if (!diffSummary || diffSummary.changedFiles.length === 0) {
    findings.push("No working tree diff is available to review.");
  }
  if (latestRun?.status === "failed") {
    findings.push(`Latest run ${latestRun.id} failed and should be inspected before trusting the result.`);
  }
  if (latestRun?.verificationStatus === "failed") {
    findings.push("Latest run verification failed.");
  }
  if (latestRun?.verificationStatus === "skipped" && diffSummary?.changedFiles.length) {
    findings.push("The current workspace has changes, but the latest run ended without verification.");
  }
  if (latestToolEvents.some((event) => event.status === "failed")) {
    findings.push(`${latestToolEvents.filter((event) => event.status === "failed").length} tool failure(s) were recorded in the latest run.`);
  }
  if (latestToolEvents.some((event) => event.status === "blocked")) {
    findings.push(`${latestToolEvents.filter((event) => event.status === "blocked").length} tool call(s) were blocked by approval policy in the latest run.`);
  }

  const lines = [
    "",
    "Review Findings",
    "===============",
    ...(findings.length > 0
      ? findings.map((finding, index) => `${index + 1}. ${finding}`)
      : ["No immediate issues detected from the current diff and latest run metadata."]),
  ];

  if (diffSummary) {
    lines.push("", `Changed files: ${diffSummary.changedFiles.join(", ") || "none"}`);
    if (diffSummary.stat.trim()) {
      lines.push("Diff stat:", diffSummary.stat);
    }
  }
  if (latestRun) {
    lines.push("", `Latest run: ${latestRun.id} (${latestRun.status})`);
    lines.push(`Verification: ${latestRun.verificationStatus ?? "n/a"}`);
  }
  if (latestMetrics) {
    lines.push(...["", ...formatRunMetricsSummary(latestMetrics, "Usage:")]);
  }

  console.log(lines.join("\n"));
}

async function printChatHealth(state: ChatSessionState): Promise<void> {
  await runDoctorCommand({
    command: "doctor",
    cwd: state.options.cwd,
    storageRoot: state.options.storageRoot,
    pluginDirs: state.options.pluginDirs,
    mode: state.mode,
    strict: false,
    fix: false,
  });
}

async function printChatTools(state: ChatSessionState, query: string): Promise<void> {
  const toolRegistry = new ToolRegistry();
  registerBuiltInTools(toolRegistry);
  const builtInToolNames = new Set(toolRegistry.listSpecs().map((spec) => spec.name));
  const extensionRegistry = await loadExtensionRegistry({
    cwd: state.options.cwd,
    pluginDirs: state.options.pluginDirs,
  });

  try {
    toolRegistry.registerMany(extensionRegistry.listToolDefinitions());
    const extensionRuntimeTools = createExtensionRuntimeTools(extensionRegistry);
    toolRegistry.registerMany(extensionRuntimeTools);

    const extensionToolSources = new Map<string, string>();
    for (const extension of extensionRegistry.list()) {
      for (const toolName of extension.toolNames) {
        extensionToolSources.set(toolName, `${extension.capability}:${extension.id}`);
      }
    }
    for (const tool of extensionRuntimeTools) {
      extensionToolSources.set(tool.name, tool.name.includes("mcp") ? "mcp-runtime" : "extension-runtime");
    }

    const [rawQuery, rawLimit] = query.split(/\s+--limit\s+/i);
    const normalizedQuery = (rawQuery ?? "").trim().toLowerCase();
    const limit = parsePositiveNumber(rawLimit ?? "", 30);
    const specs = toolRegistry
      .listSpecs()
      .filter((spec) => {
        if (!normalizedQuery) {
          return true;
        }
        return [spec.name, spec.description, spec.inputHint, spec.riskHint].some((field) =>
          field.toLowerCase().includes(normalizedQuery),
        );
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, limit);

    const lines = [
      "",
      "Available Tools",
      "===============",
      `Policy: ${state.options.approvalPolicy}`,
      `Showing: ${specs.length}${normalizedQuery ? ` for "${normalizedQuery}"` : ""}`,
    ];
    for (const spec of specs) {
      const assessment = classifyToolCall({
        toolName: spec.name,
        args: {},
        riskHint: spec.riskHint,
      });
      const source = builtInToolNames.has(spec.name)
        ? "built-in"
        : extensionToolSources.get(spec.name) ?? (spec.name.startsWith("mcp__") ? "mcp" : "extension");
      lines.push(
        `${spec.name}  [${source}]  ${assessment.approvalClass}/tier-${assessment.riskTier}`,
        `  risk: ${spec.riskHint}`,
        `  ${spec.description}`,
      );
    }
    if (specs.length === 0) {
      lines.push("No matching tools.");
    }
    console.log(lines.join("\n"));
  } finally {
    await extensionRegistry.dispose();
  }
}

function printChatApprovals(state: ChatSessionState): void {
  const thread = resolveActiveOrRecentThread(state);
  const latestRun = thread ? state.sessionStore.listRuns(thread.id, 1).at(0) ?? null : null;
  const events = latestRun ? state.sessionStore.listRunToolEvents(latestRun.id) : [];
  const blockedEvents = events.filter((event) => event.status === "blocked");
  const grants = state.approvalGrants.listGrants();
  const lines = [
    "",
    "Approval State",
    "==============",
    `Policy: ${state.options.approvalPolicy}`,
    `Remembered grants: ${grants.length}`,
    `Thread: ${thread ? `${thread.title} (${thread.id})` : "none"}`,
    `Latest run: ${latestRun ? `${latestRun.id} (${latestRun.status})` : "none"}`,
    `Blocked in latest run: ${blockedEvents.length}`,
  ];
  for (const grant of grants.slice(-8)) {
    lines.push(`- grant ${grant.scope} ${grant.toolName} tier=${grant.riskTier} uses=${grant.useCount}`);
  }
  for (const event of blockedEvents.slice(-8)) {
    lines.push(`- ${event.toolName} tier=${event.riskTier}: ${event.summary}`);
  }
  if (blockedEvents.length === 0) {
    lines.push("No blocked tool calls recorded for the latest run.");
  }
  console.log(lines.join("\n"));
}

function printChatEvents(state: ChatSessionState, limit: number): void {
  const thread = resolveActiveOrRecentThread(state);
  const latestRun = thread ? state.sessionStore.listRuns(thread.id, 1).at(0) ?? null : null;
  const allEvents = latestRun ? state.sessionStore.listRunToolEvents(latestRun.id) : [];
  const events = allEvents.slice(-limit);
  const counts = formatCounts(
    allEvents.reduce<Record<string, number>>((accumulator, event) => {
      accumulator[event.status] = (accumulator[event.status] ?? 0) + 1;
      return accumulator;
    }, {}),
  );
  const lines = [
    "",
    "Event Stream",
    "============",
    `Thread: ${thread ? `${thread.title} (${thread.id})` : "none"}`,
    `Latest run: ${latestRun ? `${latestRun.id} (${latestRun.status}/${latestRun.verificationStatus ?? "verification-n/a"})` : "none"}`,
    `Events: ${events.length} shown  Counts: ${counts}`,
  ];
  for (const event of events) {
    const call = event.toolCallId ? ` call=${event.toolCallId}` : "";
    const presentation = formatToolEventPresentation(event);
    lines.push(
      `- ${event.createdAt} ${event.toolName} [tier ${event.riskTier}] ${event.status}: ${event.summary}${call}${presentation}`,
    );
  }
  if (!latestRun) {
    lines.push("No run has been recorded for this session or workspace.");
  } else if (events.length === 0) {
    lines.push("No tool events recorded for the latest run.");
  }
  console.log(lines.join("\n"));
}

function printChatContext(state: ChatSessionState): void {
  const thread = resolveActiveOrRecentThread(state);
  if (!thread) {
    console.log("No active or recent thread yet.");
    return;
  }
  const summary = state.sessionStore.getThreadSummary(thread.id);
  const latestRun = state.sessionStore.listRuns(thread.id, 1).at(0) ?? null;
  const latestMetrics = latestRun ? state.sessionStore.getRunMetrics(latestRun.id) : null;
  const handoffKeys = summary?.handoff ? Object.keys(summary.handoff) : [];
  const contextStatus = latestMetrics?.contextEngineStatus
    ? JSON.stringify(latestMetrics.contextEngineStatus)
    : "not reported";
  const lines = [
    "",
    "Context State",
    "=============",
    `Thread: ${thread.title} (${thread.id})`,
    `Messages: ${state.sessionStore.countThreadMessages(thread.id)}`,
    `Stored summary version: ${summary?.summaryVersion ?? "none"}`,
    `Summary hash: ${summary?.summaryHash ?? "none"}`,
    `Handoff keys: ${handoffKeys.join(", ") || "none"}`,
    `Latest run: ${latestRun ? `${latestRun.id} (${latestRun.status})` : "none"}`,
    `Context engine: ${latestMetrics?.contextEngineId ?? "none"}`,
    `Context status: ${trimForConsole(contextStatus, 600)}`,
    "",
    "Stored Summary:",
    summary?.summary ?? "none",
  ];
  console.log(lines.join("\n"));
}

function printChatSessions(state: ChatSessionState, limit = 20): void {
  const workspace = state.sessionStore.getWorkspaceByCwd(state.options.cwd);
  if (!workspace) {
    console.log("No sessions recorded for the current workspace.");
    return;
  }
  const resolvedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  const threads = state.sessionStore.listThreads(workspace.id).slice(0, resolvedLimit);
  const lines = [
    "",
    "Sessions",
    "========",
    `Showing: ${threads.length}/${resolvedLimit}`,
  ];
  for (const thread of threads) {
    const latestRun = state.sessionStore.listRuns(thread.id, 1).at(0) ?? null;
    const active = thread.id === state.threadId ? " *active*" : "";
    lines.push(
      `${thread.id}${active}`,
      `  title: ${thread.title}`,
      `  updated: ${thread.updatedAt}`,
      `  latestRun: ${latestRun ? `${latestRun.status}/${latestRun.verificationStatus ?? "verification-n/a"}` : "none"}`,
    );
  }
  if (threads.length === 0) {
    lines.push("(none)");
  }
  lines.push("", "Use /resume <thread-id> to continue a session.");
  console.log(lines.join("\n"));
}

function printChatSubagents(state: ChatSessionState, limit: number): void {
  const thread = resolveActiveOrRecentThread(state);
  const latestRun = thread ? state.sessionStore.listRuns(thread.id, 1).at(0) ?? null : null;
  const workspace = state.sessionStore.getWorkspaceByCwd(state.options.cwd);
  const subagents = latestRun
    ? state.sessionStore.listSubagentJobs({ parentRunId: latestRun.id, limit })
    : workspace
      ? state.sessionStore.listSubagentJobs({ workspaceId: workspace.id, limit })
      : [];
  const topology = summarizeSubagentTopology(subagents);
  const lines = [
    "",
    "Subagents",
    "=========",
    `Thread: ${thread ? `${thread.title} (${thread.id})` : "none"}`,
    `Latest run: ${latestRun ? `${latestRun.id} (${latestRun.status})` : "none"}`,
    `Jobs: ${subagents.length}  roots=${topology.roots}  maxDepth=${topology.maxDepth}`,
    `Statuses: ${formatCounts(topology.statusCounts)}`,
  ];

  for (const job of subagents) {
    const recentEvents = (job.progressEvents ?? []).slice(-3);
    const targets = job.targetPaths?.length ? job.targetPaths.join(", ") : "workspace default";
    const tools = job.allowedTools?.length ? trimForConsole(job.allowedTools.join(", "), 220) : "inherited";
    lines.push(
      "",
      `${job.id}  ${job.status}  ${job.role ?? "default"}  ${formatSubagentDuration(job)}`,
      `  objective: ${trimForConsole(job.objective, 180)}`,
      `  tree: root=${job.rootJobId} parent=${job.parentJobId ?? "none"} depth=${job.depth}/${job.maxDepth} children=${job.childJobIds.length}`,
      `  authority: ${job.authority}  mode=${job.mode}  visibility=${job.outcomeVisibility}  domain=${job.executionDomain}`,
      `  budget: iterations=${job.budget.maxIterations} timeout=${formatDuration(job.budget.timeoutMs)} retries=${job.budget.maxRetries} attempts=${job.attempts}`,
      `  tools: ${tools}`,
      `  writeTargets: ${targets}`,
    );
    if (job.blockedReason) {
      lines.push(`  blocked: ${job.blockedReason}`);
    }
    if (job.error) {
      lines.push(`  error: ${trimForConsole(job.error, 220)}`);
    }
    if (job.completion) {
      lines.push(
        `  completion: ${job.completion.status}/${job.completion.verificationStatus} changed=${job.completion.changedFiles.length}`,
      );
      if (job.completion.structuredResult) {
        lines.push(
          `  result: ${job.completion.structuredResult.kind}/${job.completion.structuredResult.status}`,
        );
      }
    }
    for (const event of recentEvents) {
      lines.push(`  event: ${event.at} ${event.status}/${event.reason} ${trimForConsole(event.summary, 160)}`);
    }
  }
  if (subagents.length === 0) {
    lines.push("No subagent jobs recorded for the active run or workspace.");
  }
  console.log(lines.join("\n"));
}

async function printChatMcp(state: ChatSessionState): Promise<void> {
  const registry = await loadExtensionRegistry({
    cwd: state.options.cwd,
    pluginDirs: state.options.pluginDirs,
  });
  try {
    const mcpExtensions = registry.list().filter((extension) => extension.capability === "mcp");
    const mcpResources = registry.listResources().filter((resource) =>
      mcpExtensions.some((extension) => extension.id === resource.extensionId),
    );
    const runtimeHealth = registry.listMcpRuntimeHealth();
    const lines = [
      "",
      "MCP Status",
      "==========",
      `Plugin dirs: ${registry.listPluginDirectories().join(", ") || "none"}`,
      `Servers: ${mcpExtensions.length}`,
      `Resources: ${mcpResources.length}`,
      `Runtime health: ${runtimeHealth.length}`,
    ];
    for (const extension of mcpExtensions) {
      const extensionHealth = runtimeHealth.filter((entry) => entry.extensionId === extension.id);
      lines.push(
        `${extension.id}  ${extension.name}`,
        `  source: ${extension.sourcePath ?? "built-in"}`,
        `  tools: ${extension.toolNames.join(", ") || "none"}`,
        `  resources: ${extension.resourceCount}`,
      );
      for (const health of extensionHealth) {
        lines.push(
          `  runtime: ${health.status} ${health.transport}:${health.label} requests=${health.requestCount} failures=${health.failureCount}`,
          `  last: ${health.lastMethod ?? "none"}${health.lastError ? ` error=${trimForConsole(health.lastError, 120)}` : ""}`,
        );
      }
    }
    if (mcpExtensions.length === 0) {
      lines.push("No MCP extensions configured.");
    }
    console.log(lines.join("\n"));
  } finally {
    await registry.dispose();
  }
}

function printChatCost(state: ChatSessionState): void {
  const thread = resolveActiveOrRecentThread(state);
  const usage = thread ? state.sessionStore.summarizeThreadUsage(thread.id) : null;
  const lines = [
    "",
    "Cost and Usage",
    "==============",
    `Mode: ${state.mode}`,
    `Model: ${state.modelProfileId ?? "auto"}`,
  ];
  if (usage) {
    lines.push(...formatThreadUsageSummary(usage));
    lines.push(...formatUsageCostEstimate(usage));
  } else {
    lines.push("No token usage recorded yet.");
    lines.push("Estimated cost: unknown (no token usage).");
  }
  console.log(lines.join("\n"));
}

function resolveActiveOrRecentThread(state: ChatSessionState): ReturnType<SqliteSessionStore["getThread"]> {
  if (state.threadId) {
    const activeThread = state.sessionStore.getThread(state.threadId);
    if (activeThread) {
      return activeThread;
    }
  }
  return resolveMostRecentThreadForWorkspace(state.sessionStore, state.options.cwd);
}

function trimForConsole(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 14))}... [truncated]`;
}

function formatArtifactPathForCli(artifact: Pick<ArtifactRecord, "id" | "path">): string {
  const fileName = basename(artifact.path);
  const safeName = /api[_-]?key|apikey|secret|token|password|authorization|credential/i.test(fileName)
    ? "[redacted-artifact]"
    : redactSensitiveText(fileName);
  return `artifact:${artifact.id}/${safeName}`;
}

function redactAdapterConfigForCli(adapterConfig: Record<string, unknown>): Record<string, unknown> {
  return redactAdapterConfigValueForCli(adapterConfig, []) as Record<string, unknown>;
}

function redactAdapterConfigValueForCli(value: unknown, path: readonly string[]): unknown {
  const key = path[path.length - 1] ?? "";
  if (isSecretLikeAdapterConfigKeyForCli(key) && value !== undefined && value !== null && String(value).length > 0) {
    return {
      secretRef: `route.adapterConfig.${path.join(".")}`,
      configured: true,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactAdapterConfigValueForCli(entry, [...path, String(index)]));
  }
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactSensitiveText(value) : value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactAdapterConfigValueForCli(entryValue, [...path, entryKey]),
    ]),
  );
}

function isSecretLikeAdapterConfigKeyForCli(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  const compact = normalized.replace(/[-_]/g, "");
  return Boolean(
    normalized &&
      (normalized === "url" ||
        compact === "baseurl" ||
        compact === "endpointurl" ||
        compact === "homeserverurl" ||
        compact === "signedurl" ||
        compact === "presignedurl" ||
        normalized.includes("token") ||
        normalized.includes("secret") ||
        normalized.includes("password") ||
        normalized.includes("authorization") ||
        normalized.includes("apikey") ||
        normalized.includes("api_key") ||
        normalized.includes("api-key") ||
        normalized.includes("x-api-key") ||
        normalized.includes("webhook")),
  );
}

function formatSubagentDuration(job: PersistedSubagentJobRecord): string {
  const started = Date.parse(job.startedAt ?? job.queuedAt ?? job.createdAt);
  const ended = Date.parse(job.completedAt ?? job.updatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return "duration=n/a";
  }
  return `duration=${formatDuration(Math.max(0, ended - started))}`;
}

function summarizeSubagentTopology(jobs: readonly PersistedSubagentJobRecord[]): {
  readonly roots: number;
  readonly maxDepth: number;
  readonly statusCounts: Record<string, number>;
} {
  const ids = new Set(jobs.map((job) => job.id));
  const statusCounts: Record<string, number> = {};
  let roots = 0;
  let maxDepth = 0;
  for (const job of jobs) {
    if (!job.parentJobId || !ids.has(job.parentJobId)) {
      roots += 1;
    }
    maxDepth = Math.max(maxDepth, job.depth);
    statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1;
  }
  return { roots, maxDepth, statusCounts };
}

function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries.map(([key, value]) => `${key}=${value}`).join(", ") : "none";
}

interface ChatSessionState {
  readonly options: ChatCliOptions;
  readonly sessionStore: SqliteSessionStore;
  readonly approvalGrants: ApprovalGrantStore;
  readonly threadId?: string;
  readonly threadTitle?: string;
  readonly continueLatest: boolean;
  readonly mode: CliMode;
  readonly modelProfileId?: string;
  readonly executionDomain: ExecutionDomain;
  readonly verificationMode: VerificationMode;
  readonly verificationCommands: string[];
  readonly maxIterations: number;
}

interface ChatSessionUpdate {
  readonly exit: boolean;
  readonly exitCode?: number;
  readonly threadId?: string;
  readonly threadTitle?: string;
  readonly continueLatest: boolean;
  readonly mode: CliMode;
  readonly modelProfileId?: string;
  readonly executionDomain: ExecutionDomain;
  readonly verificationMode: VerificationMode;
  readonly verificationCommands: string[];
  readonly maxIterations: number;
}

async function executeChatTask(state: ChatSessionState, objective: string): Promise<ChatSessionUpdate> {
  const { runtime, close } = await createRuntimeHost(
    {
      ...state.options,
      mode: state.mode,
      modelProfileId: state.modelProfileId,
      executionDomain: state.executionDomain,
      verificationMode: state.verificationMode,
      verificationCommands: state.verificationCommands,
      maxIterations: state.maxIterations,
      approvalGrants: state.approvalGrants,
    },
    state.sessionStore,
  );
  try {
    const summary = await runtime.runTask({
      objective,
      threadTitle: state.threadTitle,
      threadId: state.threadId,
      continueLatest: state.threadId ? false : state.continueLatest,
      verificationCommands: state.verificationCommands,
      maxIterations: state.maxIterations,
    });
    printChatTurnSummary(summary);
    return {
      ...state,
      exit: false,
      exitCode: summary.run.status === "failed" ? 1 : 0,
      threadId: summary.thread.id,
      threadTitle: summary.thread.title,
      continueLatest: false,
    };
  } finally {
    await close();
  }
}

interface ChatCommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly helpLines: readonly string[];
  readonly source?: "built-in" | "workspace-skill";
  readonly execute: (context: ChatCommandContext) => Promise<ChatSessionUpdate> | ChatSessionUpdate;
}

interface ChatCommandContext {
  readonly state: ChatSessionState;
  readonly command: string;
  readonly argumentText: string;
  readonly registry: ChatCommandRegistry;
}

class ChatCommandRegistry {
  private readonly definitions: ChatCommandDefinition[] = [];
  private readonly lookup = new Map<string, ChatCommandDefinition>();

  register(definition: ChatCommandDefinition): void {
    const names = [definition.name, ...(definition.aliases ?? [])];
    for (const name of names) {
      const normalized = normalizeChatCommandName(name);
      const existing = this.lookup.get(normalized);
      if (existing) {
        throw new Error(`Duplicate chat command registration for ${name}: ${existing.name} and ${definition.name}.`);
      }
      this.lookup.set(normalized, definition);
    }
    this.definitions.push(definition);
  }

  resolve(command: string): ChatCommandDefinition | undefined {
    return this.lookup.get(normalizeChatCommandName(command));
  }

  list(): readonly ChatCommandDefinition[] {
    return this.definitions;
  }
}

async function registerWorkspaceSkillSlashCommands(
  registry: ChatCommandRegistry,
  options: ChatCliOptions,
  sessionStore: SqliteSessionStore,
): Promise<void> {
  const workspaceService = new LocalWorkspaceService(
    options.cwd,
    join(sessionStore.artifactsRoot, "chat-skill-slash"),
  );
  const skills = await workspaceService.listSkillFileIndex({ maxFiles: 128 });
  for (const skill of skills) {
    const slug = slugifyChatSkillName(skill.name) || slugifyChatSkillName(basename(dirname(skill.path)));
    if (!slug) {
      continue;
    }
    const commandName = `/${slug}`;
    if (registry.resolve(commandName)) {
      continue;
    }
    registry.register(createWorkspaceSkillChatCommand(commandName, skill));
  }
}

function createWorkspaceSkillChatCommand(commandName: string, skill: WorkspaceSkillIndexEntry): ChatCommandDefinition {
  const description = skill.description ? ` - ${skill.description}` : "";
  return {
    name: commandName,
    source: "workspace-skill",
    helpLines: [`${commandName.padEnd(30)} Workspace skill: ${skill.name}${description}`],
    execute: async ({ state, argumentText }) => {
      const loadedSkill = await loadWorkspaceSkillForSlash(state, skill);
      if (!loadedSkill) {
        console.log(`Workspace skill ${skill.name} is no longer available.`);
        return { ...state, exit: false };
      }
      return executeChatTask(state, buildWorkspaceSkillSlashObjective(loadedSkill, argumentText));
    },
  };
}

async function loadWorkspaceSkillForSlash(
  state: ChatSessionState,
  skill: WorkspaceSkillIndexEntry,
): Promise<WorkspaceSkillFile | null> {
  const workspaceService = new LocalWorkspaceService(
    state.options.cwd,
    join(state.sessionStore.artifactsRoot, "chat-skill-slash"),
  );
  try {
    return await workspaceService.loadSkillFile(skill.path, {
      maxChars: 16_000,
    });
  } catch {
    return null;
  }
}

function slugifyChatSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildWorkspaceSkillSlashObjective(skill: WorkspaceSkillFile, argumentText: string): string {
  return [
    "Workspace skill slash command invoked.",
    "",
    `Skill: ${skill.name}`,
    `Path: ${skill.path}`,
    skill.description ? `Description: ${skill.description}` : null,
    skill.supportingPaths.length > 0 ? `Supporting paths: ${skill.supportingPaths.join(", ")}` : "Supporting paths: none",
    skill.truncated ? "Skill content was truncated to the CLI skill budget." : null,
    "",
    "User arguments:",
    argumentText || "(none)",
    "",
    "Use the following skill instructions for this turn:",
    skill.content,
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join("\n");
}

function normalizeChatCommandName(command: string): string {
  return command.trim().toLowerCase();
}

function createDefaultChatCommandRegistry(): ChatCommandRegistry {
  const registry = new ChatCommandRegistry();
  for (const definition of createDefaultChatCommandDefinitions()) {
    registry.register(definition);
  }
  return registry;
}

function createDefaultChatCommandDefinitions(): ChatCommandDefinition[] {
  return [
    {
      name: "/help",
      helpLines: ["/help                         Show this help"],
      execute: ({ state, registry }) => {
        printChatHelp(registry);
        return { ...state, exit: false };
      },
    },
    {
      name: "/status",
      helpLines: ["/status                       Show the current chat session state"],
      execute: ({ state }) => {
        printChatStatus(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/session",
      helpLines: ["/session                      Show active thread details and stored summary"],
      execute: ({ state }) => {
        printChatSessionDetails(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/context",
      helpLines: ["/context                      Show active context summary and compaction state"],
      execute: ({ state }) => {
        printChatContext(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/usage",
      helpLines: ["/usage                        Show aggregated usage and run metrics for the active thread"],
      execute: ({ state }) => {
        if (!state.threadId) {
          console.log("No active thread yet.");
          return { ...state, exit: false };
        }
        const usage = state.sessionStore.summarizeThreadUsage(state.threadId);
        if (!usage) {
          console.log("No run metrics recorded yet.");
          return { ...state, exit: false };
        }
        console.log(["", "Session Usage", "=============", ...formatThreadUsageSummary(usage)].join("\n"));
        return { ...state, exit: false };
      },
    },
    {
      name: "/cost",
      helpLines: ["/cost                         Show token usage and cost-estimation status"],
      execute: ({ state }) => {
        printChatCost(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/insights",
      helpLines: ["/insights                     Show global and workspace usage summaries"],
      execute: ({ state }) => {
        const workspace = state.sessionStore.getWorkspaceByCwd(state.options.cwd);
        const workspaceSummary = workspace ? state.sessionStore.summarizeWorkspaceUsage(workspace.id) : null;
        const globalSummary = state.sessionStore.summarizeGlobalUsage();
        const lines = [
          "",
          "Usage Insights",
          "==============",
          ...formatGlobalUsageSummary(globalSummary),
        ];
        if (workspaceSummary) {
          lines.push("", ...formatWorkspaceUsageSummary(workspaceSummary));
        } else {
          lines.push("", "No workspace usage found for the current workspace.");
        }
        console.log(lines.join("\n"));
        return { ...state, exit: false };
      },
    },
    {
      name: "/health",
      helpLines: ["/health                       Run the same workspace health checks as doctor"],
      execute: async ({ state }) => {
        await printChatHealth(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/tools",
      helpLines: ["/tools [query]                Show available tools, source, approval class, and risk"],
      execute: async ({ state, argumentText }) => {
        await printChatTools(state, argumentText);
        return { ...state, exit: false };
      },
    },
    {
      name: "/approvals",
      helpLines: ["/approvals                    Show approval policy and recent blocked tool calls"],
      execute: ({ state }) => {
        printChatApprovals(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/mcp",
      helpLines: ["/mcp                          Show MCP extension, tool, and resource status"],
      execute: async ({ state }) => {
        await printChatMcp(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/events",
      helpLines: ["/events [limit]               Show recent tool events for the latest run"],
      execute: ({ state, argumentText }) => {
        printChatEvents(state, parsePositiveNumber(argumentText, 20));
        return { ...state, exit: false };
      },
    },
    {
      name: "/subagents",
      helpLines: ["/subagents [limit]            Show subagent status, authority, budget, and recent events"],
      execute: ({ state, argumentText }) => {
        printChatSubagents(state, parsePositiveNumber(argumentText, 20));
        return { ...state, exit: false };
      },
    },
    {
      name: "/checkpoints",
      helpLines: ["/checkpoints                  List managed workspace rollback checkpoints"],
      execute: async ({ state }) => {
        await printChatCheckpoints(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/checkpoint",
      helpLines: ["/checkpoint <label>           Create a managed workspace rollback checkpoint"],
      execute: async ({ state, argumentText }) => {
        await createChatCheckpoint(state, argumentText);
        return { ...state, exit: false };
      },
    },
    {
      name: "/rollback",
      helpLines: ["/rollback <id>                Roll back to a managed workspace checkpoint"],
      execute: async ({ state, argumentText }) => {
        await rollbackChatCheckpoint(state, argumentText);
        return { ...state, exit: false };
      },
    },
    {
      name: "/new",
      aliases: ["/reset"],
      helpLines: ["/new | /reset                 Start a fresh thread context"],
      execute: ({ state }) => {
        console.log("Started a fresh thread context. The next message will create a new thread.");
        return {
          ...state,
          exit: false,
          threadId: undefined,
          threadTitle: undefined,
          continueLatest: false,
        };
      },
    },
    {
      name: "/threads",
      aliases: ["/sessions"],
      helpLines: ["/threads | /sessions [limit]  List stored threads for this workspace"],
      execute: ({ state, argumentText }) => {
        printChatSessions(state, parsePositiveNumber(argumentText, 20));
        return { ...state, exit: false };
      },
    },
    {
      name: "/history",
      helpLines: ["/history [limit]              Show message history for the active thread"],
      execute: ({ state, argumentText }) => {
        if (!state.threadId) {
          console.log("No active thread yet.");
        } else {
          printThreadMessages({
            command: "show-thread",
            cwd: state.options.cwd,
            storageRoot: state.options.storageRoot,
            pluginDirs: state.options.pluginDirs,
            threadId: state.threadId,
            limit: parsePositiveNumber(argumentText || String(state.options.historyLimit), state.options.historyLimit),
          });
        }
        return { ...state, exit: false };
      },
    },
    {
      name: "/compact",
      helpLines: ["/compact [keep-messages]      Compact older thread history into the stored summary"],
      execute: ({ state, argumentText }) => {
        if (!state.threadId) {
          console.log("No active thread yet.");
          return { ...state, exit: false };
        }

        const keepMessages = parsePositiveNumber(argumentText, 8);
        const result = compactThreadHistory(state.sessionStore, state.threadId, keepMessages);
        console.log(
          `Compacted thread ${result.threadTitle} (${result.threadId}): pruned ${result.prunedMessages} message(s), retained ${result.retainedMessages} recent message(s).`,
        );
        if (result.summary) {
          console.log(`Stored Summary: ${result.summary}`);
        }
        return { ...state, exit: false };
      },
    },
    {
      name: "/diff",
      helpLines: ["/diff                         Show the current workspace git diff summary"],
      execute: async ({ state }) => {
        await printChatDiff(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/review",
      helpLines: ["/review                       Review the current diff and latest run metadata"],
      execute: async ({ state }) => {
        await printChatReview(state);
        return { ...state, exit: false };
      },
    },
    {
      name: "/resume",
      helpLines: ["/resume <thread-id>           Resume a specific stored thread"],
      execute: ({ state, argumentText }) => {
        if (!argumentText) {
          console.log("Usage: /resume <thread-id>");
          return { ...state, exit: false };
        }
        const thread = state.sessionStore.getThread(argumentText);
        if (!thread) {
          console.log(`Thread ${argumentText} was not found.`);
          return { ...state, exit: false };
        }
        console.log(`Resumed thread ${thread.title} (${thread.id}).`);
        return {
          ...state,
          exit: false,
          threadId: thread.id,
          threadTitle: thread.title,
          continueLatest: false,
        };
      },
    },
    {
      name: "/model",
      helpLines: ["/model [profile-id|auto]      Show or switch the active OpenAI profile selection"],
      execute: ({ state, argumentText }) => {
        const profiles = loadConfiguredModelProfiles(state.options.storageRoot);
        if (!argumentText) {
          printModelSelection(state.mode, state.modelProfileId, profiles);
          return { ...state, exit: false };
        }
        if (argumentText === "auto") {
          console.log("Model selection reset to automatic failover.");
          return {
            ...state,
            exit: false,
            modelProfileId: undefined,
          };
        }
        try {
          const selectedProfiles = selectModelProfiles(profiles, argumentText);
          const selected = selectedProfiles[0];
          console.log(`Model profile set to ${selected?.id ?? argumentText}.`);
          return {
            ...state,
            exit: false,
            modelProfileId: selected?.id ?? argumentText,
          };
        } catch (error) {
          console.log(error instanceof Error ? error.message : String(error));
          return { ...state, exit: false };
        }
      },
    },
    {
      name: "/mode",
      helpLines: ["/mode <mock|openai>           Switch runtime mode"],
      execute: ({ state, argumentText }) => {
        if (argumentText !== "mock" && argumentText !== "openai") {
          console.log("Usage: /mode <mock|openai>");
          return { ...state, exit: false };
        }
        console.log(`Runtime mode set to ${argumentText}.`);
        return {
          ...state,
          exit: false,
          mode: argumentText,
        };
      },
    },
    {
      name: "/domain",
      helpLines: [
        "/domain <workspace|worktree|sandbox>",
        "                              Switch execution domain",
      ],
      execute: ({ state, argumentText }) => {
        if (argumentText !== "workspace" && argumentText !== "worktree" && argumentText !== "sandbox") {
          console.log("Usage: /domain <workspace|worktree|sandbox>");
          return { ...state, exit: false };
        }
        console.log(`Execution domain set to ${argumentText}.`);
        return {
          ...state,
          exit: false,
          executionDomain: argumentText,
        };
      },
    },
    {
      name: "/verify",
      helpLines: ["/verify [command]             List or append verification commands"],
      execute: ({ state, argumentText }) => {
        if (!argumentText) {
          console.log(
            state.verificationCommands.length > 0
              ? `Verification commands: ${state.verificationCommands.join(" | ")}`
              : "No custom verification commands configured.",
          );
          return { ...state, exit: false };
        }
        const next = [...state.verificationCommands, argumentText];
        console.log(`Added verification command: ${argumentText}`);
        return {
          ...state,
          exit: false,
          verificationCommands: next,
        };
      },
    },
    {
      name: "/verify-clear",
      helpLines: ["/verify-clear                 Clear custom verification commands"],
      execute: ({ state }) => {
        console.log("Cleared custom verification commands.");
        return {
          ...state,
          exit: false,
          verificationCommands: [],
        };
      },
    },
    {
      name: "/verification-mode",
      helpLines: [
        "/verification-mode <required|best-effort>",
        "                              Switch verification policy",
      ],
      execute: ({ state, argumentText }) => {
        if (argumentText !== "required" && argumentText !== "best-effort") {
          console.log("Usage: /verification-mode <required|best-effort>");
          return { ...state, exit: false };
        }
        console.log(`Verification mode set to ${argumentText}.`);
        return {
          ...state,
          exit: false,
          verificationMode: argumentText,
        };
      },
    },
    {
      name: "/iterations",
      helpLines: ["/iterations <n>               Update max runtime turns per task"],
      execute: ({ state, argumentText }) => {
        const parsed = parsePositiveNumber(argumentText, state.maxIterations);
        console.log(`Max iterations set to ${parsed}.`);
        return {
          ...state,
          exit: false,
          maxIterations: parsed,
        };
      },
    },
    {
      name: "/exit",
      aliases: ["/quit"],
      helpLines: ["/exit | /quit                 Leave chat mode"],
      execute: ({ state }) => {
        console.log("Exiting chat.");
        return { ...state, exit: true };
      },
    },
  ];
}

async function handleChatSlashCommand(registry: ChatCommandRegistry, state: ChatSessionState, input: string): Promise<ChatSessionUpdate> {
  const [command = "", ...rest] = input.trim().split(/\s+/);
  const argumentText = rest.join(" ").trim();
  const definition = registry.resolve(command);
  if (definition) {
    return definition.execute({ state, command, argumentText, registry });
  }
  console.log(`Unknown chat command: ${command}. Use /help for available commands.`);
  return { ...state, exit: false };
}

async function saveMemory(options: MemorySaveCliOptions): Promise<void> {
  const storageRoot = resolveStorageRoot(options.storageRoot);
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.upsertWorkspace(options.cwd);
    const toolRegistry = new ToolRegistry();
    registerBuiltInTools(toolRegistry);
    const workspaceService = new LocalWorkspaceService(options.cwd, join(storageRoot, "artifacts", "memory-save-cli"));
    const result = await toolRegistry.execute(
      "save_memory",
      {
        workspace: workspaceService,
        executionDomain: "workspace",
        sessionStore,
        workspaceId: workspace.id,
        threadId: options.scope === "thread" ? options.threadId : undefined,
      },
      {
        content: options.content,
        scope: options.scope,
        tags: options.tags,
        backend: options.backend,
        fileKind: options.fileKind,
      },
    );
    console.log(result.summary);
  } finally {
    sessionStore.close();
  }
}

function runSetupCommand(options: SetupCliOptions): void {
  const storageRoot = resolveStorageRoot(options.storageRoot);
  validateSetupProfileOptions(options);
  const existingConfig = readOmniAgentConfig(storageRoot);
  const workspaceRoot = resolve(options.defaultWorkspace ?? existingConfig.defaultWorkspace ?? options.cwd);
  const requestedGatewayToken = normalizeOptionalText(options.gatewayToken);
  const existingGatewayToken = normalizeOptionalText(existingConfig.gatewayToken);
  const generatedGatewayToken = !requestedGatewayToken && !existingGatewayToken;
  const profiles = options.profileModel && options.profileBaseUrl && options.profileApiKeyEnv
    ? upsertConfiguredProfile(existingConfig.modelProfiles ?? [], {
        id: options.profileId ?? "primary",
        name: options.profileName ?? options.profileId ?? "primary",
        protocol: options.profileProtocol ?? "openai",
        baseUrl: options.profileBaseUrl,
        apiKeyEnv: options.profileApiKeyEnv,
        model: options.profileModel,
        supportsTools: options.supportsTools ?? true,
        supportsStreaming: options.supportsStreaming ?? true,
      })
    : existingConfig.modelProfiles && existingConfig.modelProfiles.length > 0
      ? existingConfig.modelProfiles
      : inspectModelProfilesFromEnv().profiles;

  const nextConfig: OmniAgentConfig = {
    defaultWorkspace: workspaceRoot,
    gatewayToken: requestedGatewayToken ?? existingGatewayToken ?? generateGatewayToken(),
    modelProfiles: profiles,
    updatedAt: new Date().toISOString(),
  };

  writeOmniAgentConfig(storageRoot, nextConfig);
  mkdirSync(workspaceRoot, { recursive: true });
  const bootstrapResults = bootstrapWorkspaceFiles(workspaceRoot, options.force);
  const created = bootstrapResults.filter((result) => result.status === "created");
  const updated = bootstrapResults.filter((result) => result.status === "updated");
  const skipped = bootstrapResults.filter((result) => result.status === "skipped");
  const heading = options.command === "onboard" ? "Omni Agent Onboard" : "Omni Agent Setup";

  const lines = [
    "",
    heading,
    "=".repeat(heading.length),
    `Config: ${resolveConfigPath(storageRoot)}`,
    `Default workspace: ${nextConfig.defaultWorkspace ?? "not set"}`,
    `Gateway token: ${generatedGatewayToken ? "generated" : nextConfig.gatewayToken ? "configured" : "not set"}`,
    `Profiles: ${(nextConfig.modelProfiles ?? []).map((profile) => `${profile.id}:${profile.protocol}:${profile.model}`).join(" | ") || "none"}`,
  ];

  if (created.length > 0) {
    lines.push("", "Created:");
    lines.push(...created.map((result) => `- ${relativeBootstrapPath(workspaceRoot, result.path)}`));
  }

  if (updated.length > 0) {
    lines.push("", "Updated:");
    lines.push(...updated.map((result) => `- ${relativeBootstrapPath(workspaceRoot, result.path)}`));
  }

  if (skipped.length > 0) {
    lines.push("", "Kept existing:");
    lines.push(...skipped.map((result) => `- ${relativeBootstrapPath(workspaceRoot, result.path)}`));
  }

  lines.push("", "Setup checks:");
  lines.push(...collectSetupChecks(storageRoot, workspaceRoot, generatedGatewayToken).flatMap((check) => renderDoctorCheck(check)));
  lines.push(
    "",
    "Next steps:",
    `- Run npm run dev -- config --storage-root "${storageRoot}" to inspect persisted defaults.`,
    `- Run npm run dev -- models --cwd "${workspaceRoot}" --storage-root "${storageRoot}" to inspect model profiles.`,
    `- Run npm run dev -- doctor --cwd "${workspaceRoot}" --storage-root "${storageRoot}" to verify workspace health.`,
    `- Run npm run dev -- serve --cwd "${workspaceRoot}" --storage-root "${storageRoot}" --port 4040 to start the gateway with the persisted auth token.`,
    `- Run npm run dev -- chat --cwd "${workspaceRoot}" --storage-root "${storageRoot}" to start an interactive session.`,
  );

  if (!options.force) {
    lines.push("- Re-run with --force to refresh starter workspace files.");
  }

  console.log(lines.join("\n"));
}

function collectSetupChecks(storageRoot: string, workspaceRoot: string, generatedGatewayToken: boolean): DoctorCheck[] {
  return [
    diagnoseSetupConfig(storageRoot, workspaceRoot),
    diagnoseSetupWorkspace(workspaceRoot),
    diagnoseSetupGatewayAuth(storageRoot, generatedGatewayToken),
    diagnoseSetupModels(storageRoot),
  ];
}

function diagnoseSetupConfig(storageRoot: string, workspaceRoot: string): DoctorCheck {
  const configPath = resolveConfigPath(storageRoot);
  const config = readOmniAgentConfig(storageRoot);
  const matchesWorkspace = normalizeOptionalText(config.defaultWorkspace) === workspaceRoot;
  return {
    name: "Config",
    status: existsSync(configPath) && matchesWorkspace ? "ok" : "warn",
    details: [
      `path=${configPath}`,
      `workspace=${config.defaultWorkspace ?? "not set"}`,
      `updatedAt=${config.updatedAt ?? "unknown"}`,
    ].join("; "),
    advice:
      existsSync(configPath) && matchesWorkspace
        ? undefined
        : ['Re-run setup to persist config.json with the intended default workspace.'],
  };
}

function diagnoseSetupWorkspace(workspaceRoot: string): DoctorCheck {
  const bootstrapCount = WORKSPACE_BOOTSTRAP_TEMPLATES.filter((template) => existsSync(join(workspaceRoot, template.filename))).length;
  const hasMemoryDir = existsSync(join(workspaceRoot, "memory"));
  const ready = bootstrapCount === WORKSPACE_BOOTSTRAP_TEMPLATES.length && hasMemoryDir;
  return {
    name: "Workspace bootstrap",
    status: ready ? "ok" : "warn",
    details: `path=${workspaceRoot}; starterFiles=${bootstrapCount}/${WORKSPACE_BOOTSTRAP_TEMPLATES.length}; memoryDir=${hasMemoryDir ? "yes" : "no"}`,
    advice: ready ? undefined : ["Re-run setup with --force if the starter workspace files are missing or stale."],
  };
}

function diagnoseSetupGatewayAuth(storageRoot: string, generatedGatewayToken: boolean): DoctorCheck {
  const gatewayToken = loadConfiguredGatewayToken(storageRoot);
  return {
    name: "Gateway auth",
    status: gatewayToken ? "ok" : "warn",
    details: gatewayToken
      ? `${generatedGatewayToken ? "generated" : "configured"} bearer token will be reused by serve and daemon commands.`
      : "no gateway token configured.",
    advice: gatewayToken ? undefined : ["Pass --gateway-token <token> during setup to lock down gateway APIs by default."],
  };
}

function diagnoseSetupModels(storageRoot: string): DoctorCheck {
  const report = inspectConfiguredModelProfiles(storageRoot);
  const configuredProfiles = report.profiles.filter((profile) => hasModelProfileApiKey(profile));
  const missingProfiles = report.profiles.filter((profile) => !hasModelProfileApiKey(profile));
  const advice = new Set<string>();
  let status: DoctorCheckStatus = "ok";

  if (report.profiles.length === 0) {
    status = "warn";
    advice.add("Re-run setup with --base-url, --api-key-env, and --model to persist a primary remote model profile.");
  }

  if (report.issues.length > 0 || missingProfiles.length > 0) {
    status = "warn";
  }

  if (missingProfiles.length > 0) {
    advice.add(`Export ${Array.from(new Set(missingProfiles.map((profile) => profile.apiKeyEnv))).join(", ")} before using --mode openai.`);
  }

  return {
    name: "Models",
    status,
    details: [
      `source=${report.source}`,
      `profiles=${report.profiles.map((profile) => `${profile.id}:${profile.protocol}:${profile.model}`).join(" | ") || "none"}`,
      `keys=${configuredProfiles.length}/${report.profiles.length}`,
      report.issues.map((issue) => issue.message).join(" | ") || null,
    ].filter(Boolean).join("; "),
    advice: advice.size > 0 ? Array.from(advice) : undefined,
  };
}

function validateSetupProfileOptions(options: SetupCliOptions): void {
  if (!hasAnySetupProfileOption(options)) {
    return;
  }

  if (options.profileBaseUrl && options.profileApiKeyEnv && options.profileModel) {
    return;
  }

  throw new SetupConfigurationError(
    "Setup profile creation requires --base-url, --api-key-env, and --model whenever any profile setup flags are provided.",
  );
}

function hasAnySetupProfileOption(options: SetupCliOptions): boolean {
  return (
    options.profileId !== undefined ||
    options.profileName !== undefined ||
    options.profileProtocol !== undefined ||
    options.profileBaseUrl !== undefined ||
    options.profileApiKeyEnv !== undefined ||
    options.profileModel !== undefined ||
    options.supportsTools !== undefined ||
    options.supportsStreaming !== undefined
  );
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function generateGatewayToken(): string {
  return randomUUID();
}

function printConfigCommand(options: ConfigCliOptions): void {
  const storageRoot = resolveStorageRoot(options.storageRoot);
  const config = readOmniAgentConfig(storageRoot);
  const report = inspectConfiguredModelProfiles(storageRoot);
  const lines = [
    "",
    "Omni Agent Config",
    "=================",
    `Config: ${resolveConfigPath(storageRoot)}`,
    `Default workspace: ${config.defaultWorkspace ?? "not set"}`,
    `Gateway token: ${config.gatewayToken ? "configured" : "not set"}`,
    `Model source: ${report.source}`,
    `Profiles: ${report.profiles.map((profile) => `${profile.id}:${profile.protocol}:${profile.model}`).join(" | ") || "none"}`,
    `Issues: ${report.issues.map((issue) => issue.message).join(" | ") || "none"}`,
  ];
  console.log(lines.join("\n"));
}

function inspectConfiguredModelProfiles(storageRoot?: string): ReturnType<typeof inspectModelProfilesFromEnv> {
  const config = readOmniAgentConfig(resolveStorageRoot(storageRoot));
  if (config.modelProfiles && config.modelProfiles.length > 0) {
    return inspectModelProfilesFromJson(JSON.stringify(config.modelProfiles));
  }
  return inspectModelProfilesFromEnv();
}

function loadConfiguredModelProfiles(storageRoot?: string): ModelProfile[] {
  return inspectConfiguredModelProfiles(storageRoot).profiles;
}

function loadConfiguredGatewayToken(storageRoot?: string): string | undefined {
  const config = readOmniAgentConfig(resolveStorageRoot(storageRoot));
  return config.gatewayToken?.trim() || undefined;
}

function resolveDefaultWorkspaceFromConfig(storageRoot?: string): string | undefined {
  const config = readOmniAgentConfig(resolveStorageRoot(storageRoot));
  return config.defaultWorkspace?.trim() || undefined;
}

function readOmniAgentConfig(storageRoot: string): OmniAgentConfig {
  const configPath = resolveConfigPath(storageRoot);
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    return {
      defaultWorkspace: typeof record.defaultWorkspace === "string" ? record.defaultWorkspace : undefined,
      gatewayToken: typeof record.gatewayToken === "string" ? record.gatewayToken : undefined,
      modelProfiles: Array.isArray(record.modelProfiles)
        ? loadModelProfilesFromJson(JSON.stringify(record.modelProfiles))
        : undefined,
      updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
    };
  } catch {
    return {};
  }
}

function writeOmniAgentConfig(storageRoot: string, config: OmniAgentConfig): void {
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(resolveConfigPath(storageRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function bootstrapWorkspaceFiles(
  workspaceRoot: string,
  force: boolean,
): WorkspaceBootstrapResult[] {
  mkdirSync(join(workspaceRoot, "memory"), { recursive: true });
  return WORKSPACE_BOOTSTRAP_TEMPLATES.map((template) => writeWorkspaceBootstrapFile(workspaceRoot, template, force));
}

function writeWorkspaceBootstrapFile(
  workspaceRoot: string,
  template: WorkspaceBootstrapTemplate,
  force: boolean,
): WorkspaceBootstrapResult {
  const filePath = join(workspaceRoot, template.filename);
  const existed = existsSync(filePath);
  if (existed && !force) {
    return {
      path: filePath,
      status: "skipped",
    };
  }

  writeFileSync(filePath, template.content, "utf8");
  return {
    path: filePath,
    status: existed ? "updated" : "created",
  };
}

function relativeBootstrapPath(workspaceRoot: string, filePath: string): string {
  const nextPath = relative(workspaceRoot, filePath);
  return nextPath || filePath;
}

function resolveConfigPath(storageRoot: string): string {
  return join(storageRoot, "config.json");
}

function upsertConfiguredProfile(
  profiles: readonly ModelProfile[],
  nextProfile: ModelProfile,
): ModelProfile[] {
  const filtered = profiles.filter((profile) => profile.id !== nextProfile.id);
  return [...filtered, nextProfile];
}

async function searchMemories(options: MemorySearchCliOptions): Promise<void> {
  const storageRoot = resolveStorageRoot(options.storageRoot);
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(options.cwd);
    if (!workspace && options.backend === "store") {
      console.log(`No stored workspace found for ${options.cwd}`);
      return;
    }
    const toolRegistry = new ToolRegistry();
    registerBuiltInTools(toolRegistry);
    const workspaceService = new LocalWorkspaceService(options.cwd, join(storageRoot, "artifacts", "memory-search-cli"));
    const result = await toolRegistry.execute(
      "search_memory",
      {
        workspace: workspaceService,
        executionDomain: "workspace",
        sessionStore: workspace ? sessionStore : undefined,
        workspaceId: workspace?.id,
        threadId: options.threadId,
      },
      {
        query: options.query,
        scope: options.scope,
        limit: options.limit,
        backend: options.backend,
      },
    );
    const memories = Array.isArray(result.data) ? result.data : [];
    const lines = [
      "",
      `Memories for ${options.cwd}`,
      "=======================",
      ...(result.warnings ?? []).map((warning) => `warning: ${warning}`),
      ...memories.map((memory) => formatMemorySearchLine(memory)),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function formatMemorySearchLine(entry: unknown): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return String(entry);
  }
  const record = entry as {
    id?: string;
    source?: string;
    scope?: string;
    content?: string;
    tags?: string[];
    path?: string;
    kind?: string;
    matchCount?: number;
  };
  const label = record.source === "file"
    ? `${record.id ?? "file"}  [${record.scope ?? "workspace"}/file:${record.kind ?? "memory"}]`
    : `${record.id ?? "memory"}  [${record.scope ?? "workspace"}]`;
  const content = String(record.content ?? "").replace(/\s+/g, " ").trim();
  const extras = [
    record.path ? `path=${record.path}` : null,
    typeof record.matchCount === "number" ? `matches=${record.matchCount}` : null,
    Array.isArray(record.tags) && record.tags.length > 0 ? `#${record.tags.join(" #")}` : null,
  ].filter((value): value is string => Boolean(value));
  return [label, content, ...extras].filter(Boolean).join("  ");
}

function printModels(options: ModelsCliOptions): void {
  const report = inspectConfiguredModelProfiles(options.storageRoot);
  const diagnostics = buildModelProfileDiagnostics(report);
  const lines = [
    "",
    "Configured model profiles",
    "=========================",
    `Source: ${report.source}`,
    `Workspace: ${options.cwd}`,
    `Issues: ${report.issues.map((issue) => issue.message).join(" | ") || "none"}`,
    "",
    "Profiles:",
    ...diagnostics.profiles.map(
      (profile) =>
        `${profile.id}  protocol=${profile.protocol}  ${profile.model}  ${profile.baseUrl}  tools=${profile.supportsTools ? "yes" : "no"}  streaming=${profile.supportsStreaming ? "yes" : "no"}  apiKey=${profile.apiKeyConfigured ? "configured" : `missing:${profile.apiKeyEnv}`}  headers=${Object.keys(profile.headers).join(",") || "none"}  bodyKeys=${profile.requestBodyKeys.join(",") || "none"}`,
    ),
    "",
    `Matrix: profiles=${diagnostics.profileCount} keys=${diagnostics.configuredKeyCount}/${diagnostics.profileCount} tools=${diagnostics.toolCapableCount}/${diagnostics.profileCount} streaming=${diagnostics.streamingCapableCount}/${diagnostics.profileCount}`,
  ];
  console.log(lines.join("\n"));
}

function printModelSelection(
  mode: CliMode,
  modelProfileId: string | undefined,
  profiles: readonly ModelProfile[],
): void {
  const lines = [
    "",
    "Model Selection",
    "===============",
    `Mode:      ${mode}`,
    `Selected:  ${describeModelSelection(mode, modelProfileId, profiles)}`,
  ];

  if (mode === "openai") {
    lines.push("", "Available profiles:");
    for (const profile of profiles) {
      lines.push(
        `- ${profile.id}  protocol=${profile.protocol}  ${profile.model}  apiKey=${hasModelProfileApiKey(profile) ? "configured" : `missing:${profile.apiKeyEnv}`}`,
      );
    }
  }

  console.log(lines.join("\n"));
}

function describeModelSelection(
  mode: CliMode,
  modelProfileId: string | undefined,
  profiles: readonly ModelProfile[],
): string {
  if (mode !== "openai") {
    return "mock runtime";
  }

  if (profiles.length === 0) {
    return "no configured profiles";
  }

  if (!modelProfileId) {
    if (profiles.length === 1) {
      const profile = profiles[0];
      return `${profile?.id ?? "unknown"} (${profile?.model ?? "unknown"})`;
    }
    return `auto failover (${profiles.map((profile) => profile.id).join(" -> ")})`;
  }

  try {
    const selected = selectModelProfiles(profiles, modelProfileId)[0];
    return `${selected?.id ?? modelProfileId} (${selected?.model ?? "unknown"})`;
  } catch {
    return `${modelProfileId} (invalid selection)`;
  }
}

type DoctorCheckStatus = "ok" | "warn" | "error";

interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorCheckStatus;
  readonly details: string;
  readonly advice?: string[];
}

interface DoctorFixResult {
  readonly description: string;
}

interface WorkspaceDoctorResult {
  readonly check: DoctorCheck;
  readonly snapshot?: WorkspaceSnapshot;
}

async function runDoctorCommand(options: DoctorCliOptions): Promise<number> {
  const storageRoot = resolveStorageRoot(options.storageRoot);
  const appliedFixes = options.fix ? applyDoctorFixes(options.cwd, storageRoot) : [];
  const workspace = await diagnoseWorkspace(options.cwd, storageRoot);
  const checks = [
    diagnoseNode(),
    workspace.check,
    await diagnoseMemoryFiles(options.cwd, storageRoot),
    await diagnoseInstructionFiles(options.cwd, storageRoot),
    await diagnoseSkillFiles(options.cwd, storageRoot),
    diagnoseStorage(storageRoot),
    diagnoseGit(workspace.snapshot),
    diagnoseModel(options.mode, storageRoot),
    diagnoseGatewayDaemon(storageRoot),
    diagnoseExecutionBackends(),
    diagnoseRoutes(storageRoot, options.cwd),
    diagnoseAutomations(storageRoot, options.cwd),
    await diagnoseExtensions(options),
  ];
  const warningCount = checks.filter((check) => check.status === "warn").length;
  const errorCount = checks.filter((check) => check.status === "error").length;
  const okCount = checks.length - warningCount - errorCount;
  const actionItems = collectDoctorActionItems(checks);
  const strictFail = options.strict && warningCount > 0;

  console.log([
    "",
    "Omni Agent Doctor",
    "=================",
    `Workspace: ${options.cwd}`,
    `Mode:      ${options.mode}`,
    "",
    ...(options.fix && appliedFixes.length > 0
      ? ["Applied fixes:", ...appliedFixes.map((fix) => `- ${fix.description}`), ""]
      : []),
    ...checks.flatMap((check) => renderDoctorCheck(check)),
    ...actionItems,
    "",
    `Summary: ${okCount} ok, ${warningCount} warning(s), ${errorCount} error(s)`,
    ...(options.strict && warningCount > 0 ? ["Strict mode enabled: warnings are treated as errors."] : []),
  ].join("\n"));

  return errorCount > 0 || strictFail ? 1 : 0;
}

function collectDoctorActionItems(checks: readonly DoctorCheck[]): string[] {
  const actionItems = new Set<string>();
  for (const check of checks) {
    if (check.status === "ok" || !check.advice || check.advice.length === 0) {
      continue;
    }
    for (const advice of check.advice) {
      actionItems.add(advice);
    }
  }

  if (actionItems.size === 0) {
    return [];
  }

  return ["", "Action items:", ...Array.from(actionItems).map((item) => `- ${item}`)];
}

function applyDoctorFixes(cwd: string, storageRoot: string): DoctorFixResult[] {
  return [
    ...ensureDoctorGatewayToken(storageRoot),
    ...ensureDoctorWorkspaceBootstrap(cwd),
    ...cleanupStaleDoctorDaemon(storageRoot),
    ...migrateDoctorRoutesToPairing(storageRoot, cwd),
  ];
}

function ensureDoctorGatewayToken(storageRoot: string): DoctorFixResult[] {
  const existingConfig = readOmniAgentConfig(storageRoot);
  if (normalizeOptionalText(existingConfig.gatewayToken)) {
    return [];
  }

  writeOmniAgentConfig(storageRoot, {
    ...existingConfig,
    gatewayToken: generateGatewayToken(),
    updatedAt: new Date().toISOString(),
  });
  return [
    {
      description: `Generated gateway bearer token in ${resolveConfigPath(storageRoot)}.`,
    },
  ];
}

function ensureDoctorWorkspaceBootstrap(cwd: string): DoctorFixResult[] {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return [];
  }

  const hadMemoryDir = existsSync(join(cwd, "memory"));
  const results = bootstrapWorkspaceFiles(cwd, false).filter((result) => result.status === "created");
  const createdPaths = results.map((result) => relativeBootstrapPath(cwd, result.path));
  if (!hadMemoryDir && !createdPaths.includes("memory")) {
    createdPaths.unshift("memory");
  }

  if (createdPaths.length === 0) {
    return [];
  }

  return [
    {
      description: `Created missing workspace starter files: ${createdPaths.join(", ")}.`,
    },
  ];
}

function cleanupStaleDoctorDaemon(storageRoot: string): DoctorFixResult[] {
  const paths = getGatewayDaemonPaths(storageRoot);
  const state = readGatewayDaemonState(paths.statePath);
  if (!state || isProcessRunning(state.pid)) {
    return [];
  }

  cleanupGatewayDaemonState(paths);
  return [
    {
      description: `Removed stale gateway daemon state for PID ${state.pid}.`,
    },
  ];
}

function migrateDoctorRoutesToPairing(storageRoot: string, cwd: string): DoctorFixResult[] {
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    if (!workspace) {
      return [];
    }

    const updatedRoutes = sessionStore
      .listRoutes({ workspaceId: workspace.id })
      .filter((route) => shouldDefaultRouteToPairing(route.channelType) && !hasExplicitDmPolicy(route.adapterConfig));

    for (const route of updatedRoutes) {
      const adapterConfig =
        route.adapterConfig && typeof route.adapterConfig === "object" && !Array.isArray(route.adapterConfig)
          ? { ...route.adapterConfig, dmPolicy: "pairing" }
          : { dmPolicy: "pairing" };
      sessionStore.updateRoute({
        routeId: route.id,
        adapterConfig,
      });
    }

    if (updatedRoutes.length === 0) {
      return [];
    }

    return [
      {
        description: `Set dmPolicy=pairing on ${updatedRoutes.length} legacy external route(s): ${updatedRoutes.map((route) => route.title).join(", ")}.`,
      },
    ];
  } finally {
    sessionStore.close();
  }
}

function diagnoseNode(): DoctorCheck {
  return {
    name: "Node",
    status: "ok",
    details: process.version,
  };
}

async function diagnoseWorkspace(cwd: string, storageRoot: string): Promise<WorkspaceDoctorResult> {
  if (!existsSync(cwd)) {
    return {
      check: {
        name: "Workspace",
        status: "error",
        details: `Path does not exist: ${cwd}`,
        advice: ['Pass --cwd <path> that points at an existing workspace, or run onboard/setup first.'],
      },
    };
  }

  if (!statSync(cwd).isDirectory()) {
    return {
      check: {
        name: "Workspace",
        status: "error",
        details: `Path is not a directory: ${cwd}`,
        advice: ["Pass --cwd <path> to a directory instead of a file."],
      },
    };
  }

  const workspace = new LocalWorkspaceService(cwd, join(storageRoot, "artifacts", "doctor-workspace"));
  try {
    const snapshot = await workspace.inspect();
    return {
      check: {
        name: "Workspace",
        status: "ok",
        details: [
          `repo=${snapshot.isGitRepo ? snapshot.repoName : "none"}`,
          `branch=${snapshot.branch ?? "n/a"}`,
          `dirty=${snapshot.dirty ? "yes" : "no"}`,
          `packageManager=${snapshot.packageManager}`,
          `scripts=${snapshot.packageScripts.length}`,
        ].join("; "),
      },
      snapshot,
    };
  } catch (error) {
    return {
      check: {
        name: "Workspace",
        status: "error",
        details: `Inspection failed: ${error instanceof Error ? error.message : String(error)}`,
        advice: ["Fix the workspace inspection failure, then rerun `omni-agent doctor`."],
      },
    };
  }
}

async function diagnoseMemoryFiles(cwd: string, storageRoot: string): Promise<DoctorCheck> {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return {
      name: "Memory",
      status: "ok",
      details: "workspace unavailable; skipped file-backed memory scan.",
    };
  }

  const workspace = new LocalWorkspaceService(cwd, join(storageRoot, "artifacts", "doctor-memory"));
  const files = await workspace.loadMemoryFiles();
  if (files.length === 0) {
    return {
      name: "Memory",
      status: "ok",
      details: "no workspace memory files detected.",
    };
  }

  return {
    name: "Memory",
    status: "ok",
    details: files.map((file) => `${file.path}${file.truncated ? " [truncated]" : ""}`).join(", "),
  };
}

async function diagnoseInstructionFiles(cwd: string, storageRoot: string): Promise<DoctorCheck> {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return {
      name: "Instructions",
      status: "ok",
      details: "workspace unavailable; skipped instruction file scan.",
    };
  }

  const workspace = new LocalWorkspaceService(cwd, join(storageRoot, "artifacts", "doctor-instructions"));
  const files = await workspace.loadInstructionFiles();
  return buildWorkspaceFileDoctorCheck({
    name: "Instructions",
    emptyDetails: "no workspace instruction files detected.",
    suspiciousAdvice: "Review blocked instruction files for prompt-injection content or invisible characters.",
    files: files.map((file) => ({
      path: file.path,
      truncated: file.truncated,
      blocked: file.content.includes("[BLOCKED:"),
    })),
  });
}

async function diagnoseSkillFiles(cwd: string, storageRoot: string): Promise<DoctorCheck> {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    return {
      name: "Skills",
      status: "ok",
      details: "workspace unavailable; skipped skill file scan.",
    };
  }

  const workspace = new LocalWorkspaceService(cwd, join(storageRoot, "artifacts", "doctor-skills"));
  const files = await workspace.loadSkillFiles();
  return buildWorkspaceFileDoctorCheck({
    name: "Skills",
    emptyDetails: "no workspace skill files detected.",
    suspiciousAdvice: "Review blocked skill files for prompt-injection content or hidden control text.",
    files: files.map((file) => ({
      path: file.path,
      truncated: file.truncated,
      blocked: file.content.includes("[BLOCKED:"),
    })),
  });
}

function buildWorkspaceFileDoctorCheck(input: {
  readonly name: string;
  readonly emptyDetails: string;
  readonly suspiciousAdvice: string;
  readonly files: Array<{
    readonly path: string;
    readonly truncated: boolean;
    readonly blocked: boolean;
  }>;
}): DoctorCheck {
  if (input.files.length === 0) {
    return {
      name: input.name,
      status: "ok",
      details: input.emptyDetails,
    };
  }

  const blockedCount = input.files.filter((file) => file.blocked).length;
  return {
    name: input.name,
    status: blockedCount > 0 ? "warn" : "ok",
    details: input.files
      .map(
        (file) =>
          `${file.path}${file.truncated ? " [truncated]" : ""}${file.blocked ? " [blocked]" : ""}`,
      )
      .join(", "),
    advice: blockedCount > 0 ? [input.suspiciousAdvice] : undefined,
  };
}

function diagnoseStorage(storageRoot: string): DoctorCheck {
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    return {
      name: "Storage",
      status: "ok",
      details: `root=${sessionStore.rootDir}; db=${sessionStore.databasePath}`,
    };
  } catch (error) {
      return {
        name: "Storage",
        status: "error",
        details: error instanceof Error ? error.message : String(error),
        advice: ["Ensure --storage-root points to a writable directory, then rerun `omni-agent doctor`."],
      };
  } finally {
    sessionStore.close();
  }
}

function diagnoseGit(snapshot?: WorkspaceSnapshot): DoctorCheck {
  const result = spawnSync("git", ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const version = result.stdout.trim();

  if (result.error || result.status !== 0 || !version) {
    return {
      name: "Git",
      status: "warn",
      details: "git is not available; worktree workflows will be disabled.",
      advice: ["Install Git and confirm it is available on PATH if you need worktree or repository-aware flows."],
    };
  }

  if (!snapshot) {
    return {
      name: "Git",
      status: "warn",
      details: `${version}; workspace inspection did not complete.`,
      advice: ["Fix the workspace diagnostic failure first, then rerun `omni-agent doctor` for repository checks."],
    };
  }

  if (!snapshot.isGitRepo) {
    return {
      name: "Git",
      status: "warn",
      details: `${version}; workspace is not a git repository.`,
      advice: ["Initialize a Git repository for this workspace if you want branch-aware runs and worktree isolation."],
    };
  }

  return {
    name: "Git",
    status: "ok",
    details: `${version}; branch=${snapshot.branch ?? "detached"}; dirty=${snapshot.dirty ? "yes" : "no"}`,
  };
}

function diagnoseModel(mode: CliMode, storageRoot?: string): DoctorCheck {
  if (mode !== "openai") {
    return {
      name: "Models",
      status: "ok",
      details: "mock mode does not require remote credentials.",
    };
  }

  const report = inspectConfiguredModelProfiles(storageRoot);
  const configuredProfileCount = report.profiles.filter((profile) => hasModelProfileApiKey(profile)).length;
  const missingProfiles = report.profiles.filter((profile) => !hasModelProfileApiKey(profile));
  const issueSummary = report.issues.map((issue) => issue.message).join(" | ");
  const profileSummary = report.profiles
    .map((profile) =>
      `${profile.id}:${profile.protocol}:${profile.model}:${hasModelProfileApiKey(profile) ? "key ok" : `missing ${profile.apiKeyEnv}`}`)
    .join(" | ");
  const advice = new Set<string>();

  let status: DoctorCheckStatus = "ok";
  if (report.issues.some((issue) => issue.level === "error") || configuredProfileCount === 0) {
    status = "error";
  } else if (report.issues.length > 0 || missingProfiles.length > 0) {
    status = "warn";
  }

  if (report.profiles.length === 0) {
    advice.add("Run `npm run dev -- setup --profile-id primary --protocol openai --base-url <url> --api-key-env <ENV_NAME> --model <model>` to persist a remote model profile.");
  }

  if (missingProfiles.length > 0) {
    advice.add(`Export ${Array.from(new Set(missingProfiles.map((profile) => profile.apiKeyEnv))).join(", ")} before using --mode openai.`);
  }

  if (report.issues.length > 0) {
    advice.add("Run `npm run dev -- config` or `npm run dev -- models` to inspect the active profile source and resolve malformed entries.");
  }

  return {
    name: "Models",
    status,
    details: [
      `Source: ${report.source}`,
      `Profiles: ${profileSummary || "none"}`,
      issueSummary || null,
    ].filter(Boolean).join("; "),
    advice: advice.size > 0 ? Array.from(advice) : undefined,
  };
}

function diagnoseGatewayDaemon(storageRoot: string): DoctorCheck {
  const state = readGatewayDaemonState(getGatewayDaemonPaths(storageRoot).statePath);
  if (!state) {
    return {
      name: "Daemon",
      status: "ok",
      details: "gateway daemon is not configured.",
    };
  }

  const running = isProcessRunning(state.pid);
  return {
    name: "Daemon",
    status: running ? "ok" : "warn",
    details: `${state.url}; pid=${state.pid}; token=${state.tokenConfigured ? "configured" : "none"}; ${running ? "running" : "stale"}`,
    advice: running ? undefined : ["Run `npm run dev -- daemon-stop` and `npm run dev -- daemon-start` to refresh the stale gateway daemon state."],
  };
}

function diagnoseExecutionBackends(): DoctorCheck {
  const backends = listExecutionBackends();
  const selectedBackend = process.env.OMNI_AGENT_EXECUTION_BACKEND?.trim() || "local";
  const selected = backends.find((backend) => backend.id === selectedBackend);
  const missingSelected = selected && selected.status === "missing_config";
  return {
    name: "Execution backends",
    status: missingSelected ? "warn" : "ok",
    details: backends
      .map((backend) => `${backend.id}:${backend.status}${backend.id === selectedBackend ? ":selected" : ""}`)
      .join("; "),
    advice: missingSelected
      ? [`Set ${selected.requiredEnv.join(", ")} or switch OMNI_AGENT_EXECUTION_BACKEND back to local.`]
      : undefined,
  };
}

function diagnoseRoutes(storageRoot: string, cwd: string): DoctorCheck {
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    if (!workspace) {
      return {
        name: "Routes",
        status: "ok",
        details: "no routes configured for this workspace yet.",
      };
    }

    const routes = sessionStore.listRoutes({ workspaceId: workspace.id });
    const issues = routes.flatMap((route) => collectRouteDoctorIssues(route));
    const errorIssues = issues.filter((issue) => issue.severity === "error");
    const warningIssues = issues.filter((issue) => issue.severity === "warn");
    const status: DoctorCheckStatus =
      errorIssues.length > 0
        ? "error"
        : warningIssues.length > 0
          ? "warn"
          : "ok";
    return {
      name: "Routes",
      status,
      details: [
        `count=${routes.length}`,
        `warnings=${warningIssues.length}`,
        `errors=${errorIssues.length}`,
        issues.length > 0
          ? `issues=${issues.map((issue) => `${issue.routeTitle} (${issue.message})`).join(", ")}`
          : null,
      ].filter(Boolean).join("; "),
      advice: buildRouteDoctorAdvice(issues),
    };
  } finally {
    sessionStore.close();
  }
}

function diagnoseAutomations(storageRoot: string, cwd: string): DoctorCheck {
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    if (!workspace) {
      return {
        name: "Automations",
        status: "ok",
        details: "no automations configured for this workspace yet.",
      };
    }

    const automations = sessionStore.listAutomations({ workspaceId: workspace.id });
    const activeCount = automations.filter((entry) => entry.status === "active").length;
    return {
      name: "Automations",
      status: "ok",
      details: `count=${automations.length}; active=${activeCount}`,
    };
  } finally {
    sessionStore.close();
  }
}

async function diagnoseExtensions(options: DoctorCliOptions): Promise<DoctorCheck> {
  const pluginDirs = resolvePluginDirectories({
    cwd: options.cwd,
    pluginDirs: options.pluginDirs,
  });
  const missingDirs = pluginDirs.filter((directory) => !existsSync(directory));

  try {
    const registry = await loadExtensionRegistry({
      cwd: options.cwd,
      pluginDirs: options.pluginDirs,
    });
    const packageReports = await inspectExtensionPackageContracts({
      cwd: options.cwd,
      pluginDirs: options.pluginDirs,
    });
    const extensions = registry.list();
    const customCount = extensions.filter((extension) => Boolean(extension.sourcePath)).length;
    const builtInCount = extensions.length - customCount;
    const packageIssues = packageReports.flatMap((report) => [...report.issues]);
    const packageErrorCount = packageIssues.filter((issue) => issue.severity === "error").length;
    const packageWarningCount = packageIssues.filter((issue) => issue.severity === "warning").length;
    const status: DoctorCheckStatus =
      packageErrorCount > 0 ? "error" : missingDirs.length > 0 || packageWarningCount > 0 ? "warn" : "ok";
    return {
      name: "Extensions",
      status,
      details: [
        `custom=${customCount}`,
        `builtIn=${builtInCount}`,
        `pluginDirs=${pluginDirs.length}`,
        packageReports.length > 0 ? `packageContracts=${packageReports.filter((report) => report.ok).length}/${packageReports.length}` : null,
        packageIssues.length > 0 ? `packageIssues=${packageIssues.length}` : null,
        missingDirs.length > 0 ? `missing=${missingDirs.join(", ")}` : null,
      ].filter(Boolean).join("; "),
      advice: [
        ...(missingDirs.length > 0 ? ["Create the missing plugin directories or remove the stale --plugin-dir entries."] : []),
        ...packageIssues.map((issue) => `${issue.sourcePath}: ${issue.reason}`),
      ],
    };
  } catch (error) {
    return {
      name: "Extensions",
      status: "error",
      details: error instanceof Error ? error.message : String(error),
      advice: ["Fix the extension manifest or module load error, then rerun `omni-agent doctor`."],
    };
  }
}

function formatDoctorStatus(status: DoctorCheckStatus): string {
  if (status === "ok") {
    return "[ok]";
  }
  if (status === "warn") {
    return "[warn]";
  }
  return "[error]";
}

function renderDoctorCheck(check: DoctorCheck): string[] {
  return [
    `${formatDoctorStatus(check.status)} ${check.name}: ${check.details}`,
    ...(check.advice ?? []).map((entry) => `  fix: ${entry}`),
  ];
}

interface RouteDoctorIssue {
  readonly routeId: string;
  readonly routeTitle: string;
  readonly severity: Exclude<DoctorCheckStatus, "ok">;
  readonly message: string;
}

function collectRouteDoctorIssues(route: ChannelRouteRecord): RouteDoctorIssue[] {
  const issues: RouteDoctorIssue[] = [];
  const adapterConfig =
    route.adapterConfig && typeof route.adapterConfig === "object" && !Array.isArray(route.adapterConfig)
      ? route.adapterConfig
      : {};
  const dmPolicy = typeof adapterConfig.dmPolicy === "string" ? adapterConfig.dmPolicy : undefined;

  if (dmPolicy === "open") {
    issues.push(createRouteDoctorIssue(route, "warn", "dmPolicy=open allows unpaired inbound DMs"));
  }

  if (route.adapterType === "webhook" && !route.inboundSecret) {
    issues.push(createRouteDoctorIssue(route, "warn", "missing inbound secret for webhook ingress"));
  }

  switch (route.adapterType) {
    case "slack":
      if (!hasNonEmptyString(adapterConfig.webhookUrl) && !hasNonEmptyString(adapterConfig.botToken)) {
        issues.push(createRouteDoctorIssue(route, "error", "missing Slack webhook URL or bot token"));
      }
      break;
    case "discord":
      if (!hasNonEmptyString(adapterConfig.webhookUrl) && !hasNonEmptyString(adapterConfig.botToken)) {
        issues.push(createRouteDoctorIssue(route, "error", "missing Discord webhook URL or bot token"));
      }
      break;
    case "telegram":
      if (!hasNonEmptyString(adapterConfig.botToken)) {
        issues.push(createRouteDoctorIssue(route, "error", "missing Telegram bot token"));
      }
      break;
    case "filesystem":
      if (!hasNonEmptyString(adapterConfig.outboxDir)) {
        issues.push(createRouteDoctorIssue(route, "error", "missing filesystem outboxDir"));
      }
      break;
    case "webhook":
      if (!hasNonEmptyString(adapterConfig.url)) {
        issues.push(createRouteDoctorIssue(route, "error", "missing outbound webhook URL"));
      }
      break;
    default:
      break;
  }

  return issues;
}

function hasExplicitDmPolicy(adapterConfig: unknown): boolean {
  if (!adapterConfig || typeof adapterConfig !== "object" || Array.isArray(adapterConfig)) {
    return false;
  }
  return hasNonEmptyString((adapterConfig as Record<string, unknown>).dmPolicy);
}

function createRouteDoctorIssue(
  route: ChannelRouteRecord,
  severity: Exclude<DoctorCheckStatus, "ok">,
  message: string,
): RouteDoctorIssue {
  return {
    routeId: route.id,
    routeTitle: route.title,
    severity,
    message,
  };
}

function buildRouteDoctorAdvice(issues: readonly RouteDoctorIssue[]): string[] | undefined {
  if (issues.length === 0) {
    return undefined;
  }

  const advice = new Set<string>();
  for (const issue of issues) {
    if (issue.message.includes("bot token")) {
      advice.add("Add the required bot token or switch the route to a webhook-backed adapter.");
    }
    if (issue.message.includes("webhook URL")) {
      advice.add("Add the required webhook URL or provide a bot token-backed adapter configuration.");
    }
    if (issue.message.includes("outboxDir")) {
      advice.add("Set adapterConfig.outboxDir so filesystem deliveries have a writable destination.");
    }
    if (issue.message.includes("inbound secret")) {
      advice.add("Set an inbound secret for webhook routes before exposing them to untrusted senders.");
    }
    if (issue.message.includes("dmPolicy=open")) {
      advice.add("Prefer dmPolicy=pairing unless the route is intentionally public.");
    }
  }
  return Array.from(advice);
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

async function printLearnedSkills(options: SkillsCliOptions): Promise<void> {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(options.cwd);
    const learnedSkills = workspace
      ? sessionStore.searchLearnedSkills({
          workspaceId: workspace.id,
          query: options.query ?? "",
          limit: options.limit,
        })
      : [];
    const reviewQueue =
      workspace && options.reviewQueue
        ? sessionStore.evaluateLearnedSkillMaintenance({
            workspaceId: workspace.id,
            limit: options.limit,
          })
        : null;
    const workspaceService = new LocalWorkspaceService(
      options.cwd,
      join(resolveStorageRoot(options.storageRoot), "artifacts", "skills-cli"),
    );
    const workspaceSkills = await workspaceService.loadSkillFiles({
      query: options.query ?? "",
      maxFiles: options.limit,
    });
    const lines = [
      "",
      `Skills for ${options.cwd}`,
      "===============================",
      "Learned skills:",
      ...(learnedSkills.length > 0
        ? learnedSkills.map(
        (skill) =>
          `${skill.id}  uses=${skill.useCount}  ${skill.title}\n  pattern: ${skill.problemPattern}\n  guidance: ${skill.guidance}${skill.changedFiles.length > 0 ? `\n  files: ${skill.changedFiles.join(", ")}` : ""}`,
          )
        : ["(none)"]),
      "",
      "Workspace skill files:",
      ...(workspaceSkills.length > 0
        ? workspaceSkills.map(
            (skill) =>
              `${skill.name}  ${skill.path}${skill.truncated ? "  [truncated]" : ""}\n  description: ${skill.description ?? "n/a"}\n  tags: ${skill.tags.join(", ") || "none"}\n  related: ${skill.relatedSkills.join(", ") || "none"}\n  support: ${skill.supportingPaths.join(", ") || "none"}\n  preview: ${summarizeWorkspaceSkillPreview(skill.content)}`,
          )
        : ["(none)"]),
    ];
    if (reviewQueue) {
      lines.push(
        "",
        "Skill review queue:",
        `- promote: ${reviewQueue.promotionCandidates.length}`,
        ...reviewQueue.promotionCandidates.map(formatSkillQueueEntry),
        `- reverify: ${reviewQueue.reverifyCandidates.length}`,
        ...reviewQueue.reverifyCandidates.map(formatSkillQueueEntry),
        `- disable: ${reviewQueue.disableCandidates.length}`,
        ...reviewQueue.disableCandidates.map(formatSkillQueueEntry),
        `- stable: ${reviewQueue.stableSkills.length}`,
      );
    }
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function formatSkillQueueEntry(skill: {
  readonly id: string;
  readonly title: string;
  readonly lifecycleState: string;
  readonly verificationStatus: string;
  readonly qualityScore: number;
  readonly revisionCount: number;
  readonly useCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lifecycleReason: string | null;
}): string {
  return `  ${skill.id}  ${skill.title}  state=${skill.lifecycleState}  verified=${skill.verificationStatus}  quality=${skill.qualityScore}  revisions=${skill.revisionCount}  uses=${skill.useCount}  success=${skill.successCount}  failure=${skill.failureCount}${skill.lifecycleReason ? `  reason=${skill.lifecycleReason}` : ""}`;
}

function summarizeWorkspaceSkillPreview(content: string): string {
  const preview = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .join(" ")
    .slice(0, 180)
    .trim();
  return preview.length > 0 ? preview : "(no preview)";
}

function printAutomations(options: AutomationsCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(options.cwd);
    const automations = sessionStore.listAutomations({
      workspaceId: workspace?.id,
    });
    const lines = [
      "",
      `Automations for ${options.cwd}`,
      "===========================",
      ...automations.map(
        (automation) =>
          `${automation.id}  ${automation.status}  ${automation.scheduleKind}${automation.intervalSeconds ? `/${automation.intervalSeconds}s` : automation.scheduleExpression ? `/${automation.scheduleExpression}` : ""}  ${automation.title}`,
      ),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function createAutomation(options: AutomationCreateCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.upsertWorkspace(options.cwd);
    const automation = sessionStore.createAutomation({
      workspaceId: workspace.id,
      threadId: options.threadId ?? null,
      title: options.title,
      threadTitle: options.threadTitle,
      task: options.task,
      mode: options.mode,
      executionDomain: options.executionDomain,
      verificationMode: options.verificationMode,
      verificationCommands: options.verificationCommands,
      autoApproveRisky: options.autoApproveRisky,
      maxIterations: options.maxIterations,
      scheduleKind: options.scheduleKind,
      intervalSeconds: options.scheduleKind === "interval" ? options.intervalSeconds ?? 300 : null,
      scheduleExpression: options.scheduleExpression,
      timezone: options.timezone,
      status: options.status,
    });
    console.log(`Created automation ${automation.id} (${automation.title})`);
  } finally {
    sessionStore.close();
  }
}

async function runAutomation(options: AutomationRunCliOptions): Promise<number> {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const automation = sessionStore.getAutomation(options.automationId);
    if (!automation) {
      throw new Error(`Automation ${options.automationId} was not found.`);
    }
    const workspace = sessionStore.getWorkspace(automation.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${automation.workspaceId} was not found for automation ${automation.id}.`);
    }

    const runtimeOptions: RunCliOptions = {
      command: "run",
      cwd: workspace.cwd,
      storageRoot: options.storageRoot,
      pluginDirs: options.pluginDirs,
      task: automation.task,
      threadTitle: automation.threadTitle ?? automation.title,
      threadId: automation.threadId ?? undefined,
      continueLatest: !automation.threadId,
      mode: automation.mode as CliMode,
      approvalPolicy: "on-request",
      executionDomain: automation.executionDomain as ExecutionDomain,
      verificationMode: automation.verificationMode as VerificationMode,
      verificationCommands: automation.verificationCommands,
      autoApproveRisky: automation.autoApproveRisky,
      maxIterations: automation.maxIterations,
      outputFormat: "text",
    };

    const { runtime, close } = await createRuntimeHost(runtimeOptions, sessionStore);
    const summary = await (async () => {
      try {
        return await runtime.runTask({
          objective: automation.task,
          threadTitle: automation.threadTitle ?? automation.title,
          threadId: automation.threadId ?? undefined,
          continueLatest: !automation.threadId,
          verificationCommands: automation.verificationCommands,
          maxIterations: automation.maxIterations,
        });
      } finally {
        await close();
      }
    })();
    if (automation.scheduleKind !== "at") {
      sessionStore.updateAutomationState({
        automationId: automation.id,
        lastRunAt: new Date().toISOString(),
        lastRunId: summary.run.id,
        nextRunAt: computeAutomationNextRunAt(automation, new Date().toISOString()),
      });
    } else {
      sessionStore.updateAutomationState({
        automationId: automation.id,
        lastRunAt: new Date().toISOString(),
        lastRunId: summary.run.id,
        nextRunAt: null,
      });
    }
    printRunSummary(summary);
    return summary.run.status === "failed" ? 1 : 0;
  } finally {
    sessionStore.close();
  }
}

function updateAutomationStatus(options: AutomationStatusCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const automation = sessionStore.getAutomation(options.automationId);
    if (!automation) {
      throw new Error(`Automation ${options.automationId} was not found.`);
    }
    const status = options.command === "automation-pause" ? "paused" : "active";
    const nextRunAt = status === "active" && automation.scheduleKind !== "at"
      ? computeAutomationNextRunAt(automation, new Date().toISOString())
      : automation.scheduleKind === "at" && !automation.lastRunAt
        ? automation.nextRunAt
        : null;
    const updated = sessionStore.updateAutomationState({
      automationId: automation.id,
      status,
      nextRunAt,
    });
    console.log(`Automation ${updated.id} is now ${updated.status}`);
  } finally {
    sessionStore.close();
  }
}

function printThreads(options: ThreadsCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const workspace = sessionStore.getWorkspaceByCwd(options.cwd);
    if (!workspace) {
      console.log(`No stored workspace found for ${options.cwd}`);
      return;
    }

    const threads = sessionStore.listThreads(workspace.id);
    const lines = [
      "",
      `Threads for ${workspace.cwd}`,
      "========================",
      ...threads.map((thread) => `${thread.id}  ${thread.updatedAt}  ${thread.title}`),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function printRuns(options: RunsCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const thread = sessionStore.getThread(options.threadId);
    if (!thread) {
      throw new Error(`Thread ${options.threadId} was not found.`);
    }

    const runs = sessionStore.listRuns(options.threadId, options.limit);
    const lines = [
      "",
      `Runs for thread ${thread.title}`,
      "==============================",
      ...runs.map(
        (run) =>
          `${run.id}  ${run.createdAt}  ${run.status}  ${run.executionDomain}${run.executionCleanedAt ? " (cleaned)" : ""}  ${run.objective}`,
      ),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function printUsageSummaryCommand(options: UsageCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const thread =
      options.threadId !== undefined
        ? sessionStore.getThread(options.threadId)
        : resolveMostRecentThreadForWorkspace(sessionStore, options.cwd);
    if (!thread) {
      console.log(`No stored thread found for ${options.threadId ? `thread ${options.threadId}` : options.cwd}.`);
      return;
    }

    const usage = sessionStore.summarizeThreadUsage(thread.id);
    const lines = [
      "",
      `Usage for thread ${thread.title}`,
      "==============================",
      `Thread ID: ${thread.id}`,
      ...(usage ? formatThreadUsageSummary(usage) : ["No run metrics recorded yet."]),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function printInsightsSummaryCommand(options: InsightsCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

  const workspace = resolveWorkspaceIdForInsights(sessionStore, options.workspaceId, options.cwd);
  const globalSummary = sessionStore.summarizeGlobalUsage();
  const workspaceSummary = workspace ? sessionStore.summarizeWorkspaceUsage(workspace.id) : null;
  const lines = [
      "",
      "Usage Insights",
      "==============",
      `Scope: ${workspace ? `workspace (${workspace.name})` : "global only (no workspace selected)"}`,
      "",
      "Global",
      ...formatGlobalUsageSummary(globalSummary),
    ];
  if (options.workspaceId !== undefined && workspace === null) {
    lines.push("", `Workspace ID not found: ${options.workspaceId}`);
    lines.push("Run /insights without --workspace-id to use the current workspace.");
  }
  if (workspaceSummary) {
    lines.push("", "Workspace", ...formatWorkspaceUsageSummary(workspaceSummary));
  }
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function resolveWorkspaceIdForInsights(
  sessionStore: SqliteSessionStore,
  workspaceId: string | undefined,
  cwd: string,
): ReturnType<SqliteSessionStore["getWorkspace"]> {
  if (workspaceId) {
    return sessionStore.getWorkspace(workspaceId);
  }
  return sessionStore.getWorkspaceByCwd(cwd);
}

function printThreadMessages(options: ShowThreadCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const thread = sessionStore.getThread(options.threadId);
    if (!thread) {
      throw new Error(`Thread ${options.threadId} was not found.`);
    }

    const messages = sessionStore.listThreadMessages(options.threadId, options.limit);
    const summary = sessionStore.getThreadSummary(options.threadId);
    const usage = sessionStore.summarizeThreadUsage(options.threadId);
    const lines = [
      "",
      `Thread ${thread.title}`,
      "====================",
      `ID: ${thread.id}`,
      `Updated: ${thread.updatedAt}`,
      `Messages: ${sessionStore.countThreadMessages(thread.id)}`,
      `Stored Summary: ${summary?.summary ?? "none"}`,
      ...(usage ? ["Usage:", ...formatThreadUsageSummary(usage).map((line) => `  ${line}`)] : []),
      "",
      ...messages.map((message) => `[${message.createdAt}] ${message.role}\n${message.text}\n`),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

const compactThreadCommand = (options: CompactThreadCliOptions): void => {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const result = compactThreadHistory(sessionStore, options.threadId, options.keepMessages);
    const lines = [
      "",
      "Thread Compacted",
      "================",
      `Thread: ${result.threadTitle} (${result.threadId})`,
      `Retained Messages: ${result.retainedMessages}`,
      `Pruned Messages: ${result.prunedMessages}`,
      `Stored Summary: ${result.summary}`,
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
};

function compactThreadHistory(
  sessionStore: SqliteSessionStore,
  threadId: string,
  keepMessages: number,
): {
  readonly threadId: string;
  readonly threadTitle: string;
  readonly retainedMessages: number;
  readonly prunedMessages: number;
  readonly summary: string;
} {
  const thread = sessionStore.getThread(threadId);
  if (!thread) {
    throw new Error(`Thread ${threadId} was not found.`);
  }

  const allMessages = sessionStore.listAllThreadMessages(threadId);
  if (allMessages.length === 0) {
    throw new Error(`Thread ${threadId} has no messages to compact.`);
  }

  const normalizedKeepMessages = Math.max(1, Math.trunc(keepMessages));
  const retained = allMessages.slice(-normalizedKeepMessages);
  const priorSummary = sessionStore.getThreadSummary(threadId);
  const summary = summarizeThread(
    allMessages.map((message) => ({
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
    })),
    {
      limit: allMessages.length,
      maxChars: 4_000,
      maxCharsPerMessage: 240,
      previousSummary: priorSummary?.summary ?? null,
      previousSummaryMaxChars: 1_200,
    },
  );
  const latestRun = sessionStore.listRuns(threadId, 1)[0];

  sessionStore.upsertThreadSummary({
    threadId,
    workspaceId: thread.workspaceId,
    lastRunId: latestRun?.id ?? priorSummary?.lastRunId ?? null,
    summary,
  });

  const retainedIds = retained.map((message) => message.id);
  const prunedMessages =
    retainedIds.length < allMessages.length ? sessionStore.pruneThreadMessages(threadId, retainedIds) : 0;

  return {
    threadId,
    threadTitle: thread.title,
    retainedMessages: retained.length,
    prunedMessages,
    summary,
  };
}

function printRunDetails(options: ShowRunCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const run = sessionStore.getRun(options.runId);
    if (!run) {
      throw new Error(`Run ${options.runId} was not found.`);
    }

    const toolEvents = sessionStore.listRunToolEvents(options.runId);
    const artifacts = sessionStore.listRunArtifacts(options.runId);
    const runMetrics = sessionStore.getRunMetrics(options.runId);
    const diffArtifacts = artifacts.filter((artifact) => artifact.kind.startsWith("git-diff"));
    const lines = [
      "",
      `Run ${run.id}`,
      "====================",
      `Thread ID: ${run.threadId}`,
      `Status: ${run.status}`,
      `Domain: ${run.executionDomain}`,
      `Created: ${run.createdAt}`,
      `Updated: ${run.updatedAt}`,
      `Source Root: ${run.sourceRoot ?? "n/a"}`,
      `Execution Root: ${run.executionRoot ?? "n/a"}`,
      `Worktree: ${run.worktreePath ?? "n/a"}`,
      `Worktree Branch: ${run.worktreeBranch ?? "n/a"}`,
      `Sandbox: ${run.sandboxPath ?? "n/a"}`,
      `Cleaned: ${run.executionCleanedAt ?? "no"}`,
      `Verification: ${run.verificationStatus ?? "n/a"}`,
      ...(runMetrics ? formatRunMetricsSummary(runMetrics) : []),
      "",
      "Objective:",
      redactSensitiveText(run.objective),
      "",
      "Timeline:",
      `- ${run.createdAt} run started: ${redactSensitiveText(run.objective)}`,
      ...toolEvents.map(
        (event) =>
          `- ${event.createdAt} tool ${event.toolName} [tier ${event.riskTier}] ${event.status}: ${redactSensitiveText(event.summary)}${
            event.toolCallId ? ` call=${event.toolCallId}` : ""
          }${formatToolEventPresentation(event)}`,
      ),
      ...artifacts.map((artifact) => `- ${artifact.createdAt} artifact ${artifact.kind}: ${redactSensitiveText(artifact.summary)}`),
      ...(runMetrics?.completedAt ? [`- ${runMetrics.completedAt} run metrics completed: ${runMetrics.durationMs ?? "n/a"}ms`] : []),
      `- ${run.updatedAt} run status: ${run.status}`,
      "",
      "Review Checklist:",
      `- Status: ${run.status}`,
      `- Verification: ${run.verificationStatus ?? "n/a"}`,
      `- Tool failures: ${runMetrics?.toolFailureCount ?? toolEvents.filter((event) => event.status !== "ok").length}`,
      `- Blocked approvals: ${runMetrics?.blockedApprovalCount ?? toolEvents.filter((event) => event.status === "blocked").length}`,
      `- Diff artifacts: ${diffArtifacts.length > 0 ? diffArtifacts.map(formatArtifactPathForCli).join(", ") : "none captured"}`,
      "",
      "Recovery:",
      `- Continue: npm run dev -- run --cwd ${quoteCliValue(run.sourceRoot ?? options.cwd)} --thread-id ${run.threadId} --task ${quoteCliValue(
        buildRunRecoveryTask(run.status, run.verificationStatus, run.id),
      )}`,
      run.worktreePath || run.sandboxPath
        ? run.executionCleanedAt
          ? `- Execution cleanup: already cleaned at ${run.executionCleanedAt}`
          : `- Cleanup: npm run dev -- cleanup-run --run-id ${run.id}`
        : "- Execution cleanup: not needed for direct workspace runs",
    ];

    if (toolEvents.length > 0) {
      lines.push("", "Tool Events:");
      for (const event of toolEvents) {
        const storedOutput = event.storedOutputRef ? ` storedOutputRef=${event.storedOutputRef}` : "";
        const call = event.toolCallId ? ` call=${event.toolCallId}` : "";
        lines.push(
          `- ${event.createdAt} ${event.toolName} [tier ${event.riskTier}] ${event.status}: ${redactSensitiveText(event.summary)}${call}${storedOutput}${formatToolEventPresentation(event)}`,
        );
      }
      lines.push(
        "",
        "Trajectory Replay:",
        JSON.stringify(
          toolEvents.map((event) => ({
            at: event.createdAt,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: event.status,
            riskTier: event.riskTier,
            summary: redactSensitiveText(event.summary),
            outputPreview: event.outputPreview,
            outputTruncated: event.outputTruncated,
            storedOutputRef: event.storedOutputRef,
            presentation: event.presentation,
          })),
          null,
          2,
        ),
      );
    }

    if (artifacts.length > 0) {
      lines.push("", "Artifacts:");
      for (const artifact of artifacts) {
        lines.push(`- ${artifact.kind}: ${formatArtifactPathForCli(artifact)}`);
      }
    }

    if (run.finalResponse) {
      lines.push("", "Final Response:", redactSensitiveText(run.finalResponse));
    }

    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
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

async function cleanupRun(options: CleanupRunCliOptions): Promise<void> {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const run = sessionStore.getRun(options.runId);
    if (!run) {
      throw new Error(`Run ${options.runId} was not found.`);
    }

    if (run.executionCleanedAt) {
      console.log(`Run ${run.id} execution root was already cleaned at ${run.executionCleanedAt}`);
      return;
    }

    if (!run.sourceRoot && !run.executionRoot) {
      console.log(`Run ${run.id} has no persisted execution root.`);
      return;
    }

    const workspace = new LocalWorkspaceService(run.sourceRoot ?? run.executionRoot ?? options.cwd);
    if (run.worktreePath) {
      await workspace.cleanupWorktree(run.worktreePath);
    } else if (run.sandboxPath) {
      await workspace.cleanupSandbox(run.sandboxPath);
    } else if (run.executionRoot && run.executionRoot !== run.sourceRoot) {
      console.log(`Run ${run.id} uses an unmanaged execution root: ${run.executionRoot}`);
      return;
    } else {
      console.log(`Run ${run.id} executed directly in the workspace; nothing to clean.`);
      return;
    }

    const updated = sessionStore.markRunExecutionCleaned(run.id);
    console.log(`Cleaned execution root for run ${updated.id} at ${updated.executionCleanedAt}`);
  } finally {
    sessionStore.close();
  }
}

function printWorkspaces(options: WorkspacesCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const workspaces = sessionStore.listWorkspaces();
    const lines = [
      "",
      "Known workspaces",
      "================",
      ...workspaces.map((workspace) => `${workspace.id}  ${workspace.updatedAt}  ${workspace.cwd}`),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function printRoutes(options: RoutesCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const workspace = sessionStore.getWorkspaceByCwd(options.cwd);
    if (!workspace) {
      console.log(`No stored workspace found for ${options.cwd}`);
      return;
    }

    const routes = sessionStore.listRoutes({ workspaceId: workspace.id });
    const lines = [
      "",
      `Routes for ${workspace.cwd}`,
      "========================",
      ...routes.map(
        (route) =>
          `${route.id}  ${route.status}  ${route.channelType}:${route.channelKey}  adapter=${route.adapterType}  dmPolicy=${String(route.adapterConfig.dmPolicy ?? "open")}  allowFrom=${Array.isArray(route.adapterConfig.allowFrom) ? route.adapterConfig.allowFrom.length : 0}  title=${route.title}${route.inboundSecret ? "  inbound-secret=yes" : ""}`,
      ),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function printPairings(options: PairingsCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const workspace = sessionStore.getWorkspaceByCwd(options.cwd);
    if (!workspace) {
      console.log(`No stored workspace found for ${options.cwd}`);
      return;
    }

    const pairings = sessionStore.listRoutePairings({
      workspaceId: workspace.id,
      routeId: options.routeId,
      status: options.status,
      limit: options.limit,
    });
    const lines = [
      "",
      `Pairings for ${workspace.cwd}`,
      "===========================",
      ...pairings.map(
        (pairing) =>
          `${pairing.id}  ${pairing.status}  ${pairing.channelType}:${pairing.channelKey}  sender=${pairing.sender}  code=${pairing.code}`,
      ),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

function approvePairing(options: PairingApproveCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const pairing = sessionStore.getRoutePairingByCode(options.code);
    if (!pairing) {
      throw new Error(`Pairing code ${options.code} was not found.`);
    }
    const route = sessionStore.getRoute(pairing.routeId);
    if (!route) {
      throw new Error(`Route ${pairing.routeId} was not found.`);
    }
    const updatedRoute = addAllowedSenderToRoute(sessionStore, route, pairing.sender);
    const approved = sessionStore.updateRoutePairing({
      pairingId: pairing.id,
      status: "approved",
      approvedAt: new Date().toISOString(),
    });
    console.log(`Approved pairing ${approved.code} for sender ${approved.sender}`);
    console.log(`Route ${updatedRoute.id} allowFrom updated.`);
  } finally {
    sessionStore.close();
  }
}

function addAllowedSenderToRoute(
  sessionStore: SqliteSessionStore,
  route: ChannelRouteRecord,
  sender: string,
) {
  const allowFrom = Array.isArray(route.adapterConfig.allowFrom)
    ? route.adapterConfig.allowFrom.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  if (allowFrom.includes(sender)) {
    return route;
  }
  return sessionStore.updateRoute({
    routeId: route.id,
    adapterConfig: {
      ...route.adapterConfig,
      allowFrom: [...allowFrom, sender],
    },
  });
}

function createRouteCommand(options: RouteCreateCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.upsertWorkspace(options.cwd);
    const preparedRoute = prepareRouteDefinition({
      threadId: options.threadId ?? null,
      title: options.title ?? null,
      channelType: options.channelType,
      channelKey: options.channelKey,
      adapterType: options.adapterType,
      adapterConfig: options.adapterConfig,
      inboundSecret: options.inboundSecret ?? null,
      status: options.status,
    });
    const route = sessionStore.createRoute({
      workspaceId: workspace.id,
      threadId: preparedRoute.threadId,
      title: preparedRoute.title,
      channelType: preparedRoute.channelType,
      channelKey: preparedRoute.channelKey,
      adapterType: preparedRoute.adapterType,
      adapterConfig: preparedRoute.adapterConfig,
      inboundSecret: preparedRoute.inboundSecret,
      status: preparedRoute.status,
    });
    console.log(`Created route ${route.id}`);
    console.log(`Channel: ${route.channelType}:${route.channelKey}`);
    console.log(`Adapter: ${route.adapterType}`);
    if (Object.keys(route.adapterConfig).length > 0) {
      console.log(`Adapter config: ${JSON.stringify(redactAdapterConfigForCli(route.adapterConfig))}`);
    }
    console.log(`Inbound secret: ${route.inboundSecret ? "configured" : "none"}`);
  } finally {
    sessionStore.close();
  }
}

function printDeliveries(options: DeliveriesCliOptions): void {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();

    const workspace = sessionStore.getWorkspaceByCwd(options.cwd);
    if (!workspace) {
      console.log(`No stored workspace found for ${options.cwd}`);
      return;
    }

    const deliveries = sessionStore.listOutboundDeliveries({
      workspaceId: workspace.id,
      routeId: options.routeId,
      status: options.status,
      limit: options.limit,
    });
    const lines = [
      "",
      `Deliveries for ${workspace.cwd}`,
      "=============================",
      ...deliveries.map(
        (delivery) =>
          `${delivery.id}  ${delivery.status}  attempts=${delivery.attemptCount}  ${delivery.channelType}:${delivery.channelKey}  ${delivery.responseSummary ?? "no response summary"}`,
      ),
    ];
    console.log(lines.join("\n"));
  } finally {
    sessionStore.close();
  }
}

async function printExtensions(options: ExtensionsCliOptions): Promise<void> {
  const registry = await loadExtensionRegistry({
    cwd: options.cwd,
    pluginDirs: options.pluginDirs,
  });
  const packageReports = await inspectExtensionPackageContracts({
    cwd: options.cwd,
    pluginDirs: options.pluginDirs,
  });
  const lines = [
    "",
    `Extensions for ${options.cwd}`,
    "========================",
    `Plugin dirs: ${registry.listPluginDirectories().join(", ") || "none"}`,
    `Package contracts: ${packageReports.length > 0 ? `${packageReports.filter((report) => report.ok).length}/${packageReports.length} ok` : "none"}`,
    "",
  ];

  for (const extension of registry.list()) {
    lines.push(`${extension.id}  [${extension.capability}]  ${extension.name}`);
    lines.push(`  ${extension.description}`);
    lines.push(`  Source: ${extension.sourcePath ?? "built-in"}`);
    lines.push(`  Tools: ${extension.toolNames.join(", ") || "none"}`);
    lines.push(
      `  Resources: ${extension.resourceCount}  Prompt Templates: ${extension.promptTemplateCount}  Prompt Hooks: ${extension.promptHookCount}`,
    );
    lines.push("");
  }

  for (const report of packageReports) {
    lines.push(
      `Package: ${report.sourcePath}`,
      `  name=${report.packageName ?? "n/a"} version=${report.packageVersion ?? "n/a"} pluginApi=${report.pluginApi ?? "missing"} hostPluginApi=${report.currentPluginApi} compatible=${report.pluginApiCompatible ?? "unknown"} omniAgentVersion=${report.omniAgentVersion ?? "missing"}`,
    );
    for (const issue of report.issues) {
      lines.push(`  [${issue.severity}] ${issue.reason}`);
    }
    lines.push("");
  }

  console.log(lines.join("\n"));
  await registry.dispose();
}

async function runServerCommand(options: ServeCliOptions): Promise<void> {
  const storageRoot = resolveStorageRoot(options.storageRoot);
  const server = await startGatewayServer({
    host: options.host,
    port: options.port,
    accessToken: options.gatewayToken ?? loadConfiguredGatewayToken(storageRoot),
    cwd: options.cwd,
    storageRoot,
    pluginDirs: options.pluginDirs,
    mode: options.mode,
    modelProfiles: loadConfiguredModelProfiles(storageRoot),
    approvalPolicy: options.approvalPolicy,
    executionDomain: options.executionDomain,
    verificationMode: options.verificationMode,
    verificationCommands: options.verificationCommands,
    autoApproveRisky: options.autoApproveRisky,
    maxIterations: options.maxIterations,
  });

  console.log(`Omni Agent gateway listening on ${server.url}`);
  console.log("Press Ctrl+C to stop.");

  await waitForShutdown(server.close);
}

async function startDaemonCommand(options: DaemonStartCliOptions): Promise<void> {
  const storageRoot = resolveStorageRoot(options.storageRoot);
  const paths = getGatewayDaemonPaths(storageRoot);
  const gatewayToken = options.gatewayToken ?? loadConfiguredGatewayToken(storageRoot);
  mkdirSync(paths.root, { recursive: true });

  const existing = readGatewayDaemonState(paths.statePath);
  if (existing && isProcessRunning(existing.pid)) {
    console.log(`Gateway daemon is already running on ${existing.url} (PID ${existing.pid}).`);
    console.log(`Log: ${existing.logPath}`);
    return;
  }

  if (existing) {
    cleanupGatewayDaemonState(paths);
  }

  const entryScript = resolve(process.argv[1] ?? join(process.cwd(), "dist", "omni-agent.js"));
  const spawnArgs = [
    ...process.execArgv,
    entryScript,
    "serve",
    "--cwd",
    options.cwd,
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--storage-root",
    storageRoot,
    "--mode",
    options.mode,
    "--approval-policy",
    options.approvalPolicy,
    "--execution-domain",
    options.executionDomain,
    "--verification-mode",
    options.verificationMode,
    "--max-iterations",
    String(options.maxIterations),
  ];

  for (const command of options.verificationCommands) {
    spawnArgs.push("--verify", command);
  }
  for (const pluginDir of options.pluginDirs) {
    spawnArgs.push("--plugin-dir", pluginDir);
  }
  if (options.autoApproveRisky) {
    spawnArgs.push("--auto-approve-risky");
  }
  if (gatewayToken) {
    spawnArgs.push("--gateway-token", gatewayToken);
  }

  const logFd = openSync(paths.logPath, "a");
  const child = spawn(process.execPath, spawnArgs, {
    cwd: options.cwd,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();

  if (!child.pid) {
    throw new Error("Failed to start the gateway daemon.");
  }

  const state: GatewayDaemonState = {
    pid: child.pid,
    host: options.host,
    port: options.port,
    url: `http://${options.host}:${options.port}`,
    cwd: options.cwd,
    logPath: paths.logPath,
    startedAt: new Date().toISOString(),
    tokenConfigured: Boolean(gatewayToken),
  };
  writeFileSync(paths.pidPath, String(state.pid), "utf8");
  writeFileSync(paths.statePath, JSON.stringify(state, null, 2), "utf8");

  await waitForGatewayReady(state.url);
  console.log(`Started gateway daemon on ${state.url} (PID ${state.pid}).`);
  console.log(`Log: ${state.logPath}`);
}

function stopDaemonCommand(options: DaemonControlCliOptions): void {
  const storageRoot = resolveStorageRoot(options.storageRoot);
  const paths = getGatewayDaemonPaths(storageRoot);
  const state = readGatewayDaemonState(paths.statePath);
  if (!state) {
    console.log("No gateway daemon state file was found.");
    return;
  }

  if (!isProcessRunning(state.pid)) {
    cleanupGatewayDaemonState(paths);
    console.log(`Removed stale daemon state for PID ${state.pid}.`);
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(state.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    process.kill(state.pid, "SIGTERM");
  }

  cleanupGatewayDaemonState(paths);
  console.log(`Stopped gateway daemon ${state.pid}.`);
}

function printDaemonStatus(options: DaemonControlCliOptions): void {
  const storageRoot = resolveStorageRoot(options.storageRoot);
  const paths = getGatewayDaemonPaths(storageRoot);
  const state = readGatewayDaemonState(paths.statePath);
  if (!state) {
    console.log("Gateway daemon is not configured.");
    return;
  }

  const running = isProcessRunning(state.pid);
  console.log(`Status: ${running ? "running" : "stale"}`);
  console.log(`PID: ${state.pid}`);
  console.log(`URL: ${state.url}`);
  console.log(`CWD: ${state.cwd}`);
  console.log(`Started: ${state.startedAt}`);
  console.log(`Log: ${state.logPath}`);
  console.log(`Token: ${state.tokenConfigured ? "configured" : "none"}`);
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const command = detectCommand(argv);
  const commandlessArgs =
    command !== "run" && argv[0] === command ? argv.slice(1) : argv;

  const values = new Map<string, string[]>();
  const flags = new Set<string>();

  for (let index = 0; index < commandlessArgs.length; index += 1) {
    const token = commandlessArgs[index];
    if (!token || !token.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = token.split("=", 2);
    if (inlineValue !== undefined) {
      appendValue(values, key, inlineValue);
      continue;
    }

    if (commandlessArgs[index + 1] && !commandlessArgs[index + 1]?.startsWith("--")) {
      appendValue(values, key, commandlessArgs[index + 1] ?? "");
      index += 1;
      continue;
    }

    flags.add(key);
  }

  const storageRoot = lastValue(values, "--storage-root");
  const configuredWorkspace = resolveDefaultWorkspaceFromConfig(storageRoot);
  const cwd = resolve(lastValue(values, "--cwd") ?? configuredWorkspace ?? process.cwd());
  const pluginDirs = flattenValues(values, "--plugin-dir")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (command === "onboard" || command === "setup") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      defaultWorkspace: lastValue(values, "--default-workspace"),
      gatewayToken: lastValue(values, "--gateway-token"),
      profileId: lastValue(values, "--profile-id"),
      profileName: lastValue(values, "--profile-name"),
      profileProtocol:
        lastValue(values, "--protocol") === "anthropic" || lastValue(values, "--protocol") === "openai"
          ? (lastValue(values, "--protocol") as ModelProtocol)
          : undefined,
      profileBaseUrl: lastValue(values, "--base-url"),
      profileApiKeyEnv: lastValue(values, "--api-key-env"),
      profileModel: lastValue(values, "--model"),
      supportsTools: parseOptionalBooleanFlag(values, flags, "--supports-tools"),
      supportsStreaming: parseOptionalBooleanFlag(values, flags, "--supports-streaming"),
      force: flags.has("--force"),
    };
  }

  if (command === "config") {
    return { command, cwd, storageRoot, pluginDirs };
  }

  if (command === "threads") {
    return { command, cwd, storageRoot, pluginDirs };
  }

  if (command === "models") {
    return { command, cwd, storageRoot, pluginDirs };
  }

  if (command === "evals") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      manifestPath: requiredValue(values, "--manifest", "The evals command requires --manifest."),
      outputPath: lastValue(values, "--output"),
      ...parseRuntimeOptions(values, flags),
    };
  }

  if (command === "doctor") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      mode: (lastValue(values, "--mode") as CliMode | undefined) ?? "mock",
      strict: flags.has("--strict"),
      fix: flags.has("--fix"),
    };
  }

  if (command === "memory-save") {
    const content = requiredValue(values, "--content", "The memory-save command requires --content.");
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      content,
      scope: lastValue(values, "--scope") === "thread" ? "thread" : "workspace",
      threadId: lastValue(values, "--thread-id"),
      tags: flattenValues(values, "--tag")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
      backend: parseMemoryPersistenceBackend(lastValue(values, "--backend")),
      fileKind: parseWorkspaceMemoryFileKind(lastValue(values, "--file-kind")),
    };
  }

  if (command === "memory-search") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      query: lastValue(values, "--query"),
      scope:
        lastValue(values, "--scope") === "thread" || lastValue(values, "--scope") === "workspace"
            ? (lastValue(values, "--scope") as "thread" | "workspace")
            : undefined,
        threadId: lastValue(values, "--thread-id"),
        limit: parsePositiveNumber(lastValue(values, "--limit"), 20),
        backend: parseMemorySearchBackend(lastValue(values, "--backend")),
      };
    }

  if (command === "automations") {
    return { command, cwd, storageRoot, pluginDirs };
  }

  const runtimeOptions = parseRuntimeOptions(values, flags);
  if (command === "chat") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      threadTitle: lastValue(values, "--thread-title"),
      threadId: lastValue(values, "--thread-id"),
      continueLatest: flags.has("--continue-latest"),
      historyLimit: parsePositiveNumber(lastValue(values, "--history-limit"), 8),
      ...runtimeOptions,
    };
  }
  if (command === "automation-create") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      title: requiredValue(values, "--title", "The automation-create command requires --title."),
      task: requiredValue(values, "--task", "The automation-create command requires --task."),
      threadId: lastValue(values, "--thread-id"),
      threadTitle: lastValue(values, "--thread-title"),
      scheduleKind: parseAutomationScheduleKind(
        lastValue(values, "--schedule") ?? (lastValue(values, "--at") ? "at" : lastValue(values, "--cron") ? "cron" : undefined),
      ),
      intervalSeconds: parsePositiveNumber(lastValue(values, "--interval-seconds"), 300),
      scheduleExpression: lastValue(values, "--schedule-expression") ?? lastValue(values, "--at") ?? lastValue(values, "--cron"),
      timezone: lastValue(values, "--timezone"),
      status: flags.has("--paused") ? "paused" : "active",
      ...runtimeOptions,
    };
  }

  if (command === "automation-run" || command === "automation-pause" || command === "automation-resume") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      automationId: requiredValue(values, "--automation-id", `The ${command} command requires --automation-id.`),
    };
  }

  if (command === "runs") {
    const threadId = requiredValue(values, "--thread-id", "The runs command requires --thread-id.");
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      threadId,
      limit: parsePositiveNumber(lastValue(values, "--limit"), 20),
    };
  }

  if (command === "usage") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      threadId: lastValue(values, "--thread-id"),
    };
  }

  if (command === "insights") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      workspaceId: lastValue(values, "--workspace-id"),
    };
  }

  if (command === "show-thread") {
    const threadId = requiredValue(values, "--thread-id", "The show-thread command requires --thread-id.");
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      threadId,
      limit: parsePositiveNumber(lastValue(values, "--limit"), 50),
    };
  }

  if (command === "compact-thread") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      threadId: requiredValue(values, "--thread-id", "The compact-thread command requires --thread-id."),
      keepMessages: parsePositiveNumber(lastValue(values, "--keep-messages"), 8),
    };
  }

  if (command === "show-run") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      runId: requiredValue(values, "--run-id", "The show-run command requires --run-id."),
    };
  }

  if (command === "cleanup-run") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      runId: requiredValue(values, "--run-id", "The cleanup-run command requires --run-id."),
    };
  }

  if (command === "workspaces") {
    return { command, cwd, storageRoot, pluginDirs };
  }

  if (command === "routes") {
    return { command, cwd, storageRoot, pluginDirs };
  }

  if (command === "skills") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      query: lastValue(values, "--query"),
      limit: parsePositiveNumber(lastValue(values, "--limit"), 20),
      reviewQueue: flags.has("--review-queue"),
    };
  }

  if (command === "pairings") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      routeId: lastValue(values, "--route-id"),
      status: normalizePairingStatus(lastValue(values, "--status")),
      limit: parsePositiveNumber(lastValue(values, "--limit"), 50),
    };
  }

  if (command === "pairing-approve") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      code: requiredValue(values, "--code", "The pairing-approve command requires --code."),
    };
  }

  if (command === "route-create") {
    const adapterType = normalizeRouteAdapterType(lastValue(values, "--adapter-type"));
    const adapterConfig = parseJsonObjectOption(lastValue(values, "--adapter-config"));
    const outboxDir = lastValue(values, "--outbox-dir");
    if (outboxDir) {
      adapterConfig.outboxDir = resolve(outboxDir);
    }
    const webhookUrl = lastValue(values, "--webhook-url");
    if (webhookUrl) {
      adapterConfig.url = webhookUrl;
    }
    const webhookMethod = lastValue(values, "--webhook-method");
    if (webhookMethod) {
      adapterConfig.method = webhookMethod.toUpperCase();
    }
    const dmPolicy = lastValue(values, "--dm-policy");
    if (dmPolicy === "open" || dmPolicy === "pairing") {
      adapterConfig.dmPolicy = dmPolicy;
    }
    const allowFrom = flattenValues(values, "--allow-from")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean);
    if (allowFrom.length > 0) {
      adapterConfig.allowFrom = Array.from(new Set(allowFrom));
    }
    const telegramBotToken = lastValue(values, "--telegram-bot-token");
    if (telegramBotToken) {
      adapterConfig.botToken = telegramBotToken;
    }
    const telegramBaseUrl = lastValue(values, "--telegram-base-url");
    if (telegramBaseUrl) {
      adapterConfig.baseUrl = telegramBaseUrl;
    }
    const telegramChatId = lastValue(values, "--telegram-chat-id");
    if (telegramChatId) {
      adapterConfig.chatId = telegramChatId;
    }
    const telegramParseMode = lastValue(values, "--telegram-parse-mode");
    if (telegramParseMode) {
      adapterConfig.parseMode = telegramParseMode;
    }
    const slackBotToken = lastValue(values, "--slack-bot-token");
    if (slackBotToken) {
      adapterConfig.botToken = slackBotToken;
    }
    const slackBaseUrl = lastValue(values, "--slack-base-url");
    if (slackBaseUrl) {
      adapterConfig.baseUrl = slackBaseUrl;
    }
    const slackChannelId = lastValue(values, "--slack-channel-id");
    if (slackChannelId) {
      adapterConfig.channelId = slackChannelId;
    }
    const slackWebhookUrl = lastValue(values, "--slack-webhook-url");
    if (slackWebhookUrl) {
      adapterConfig.webhookUrl = slackWebhookUrl;
    }
    const discordBotToken = lastValue(values, "--discord-bot-token");
    if (discordBotToken) {
      adapterConfig.botToken = discordBotToken;
    }
    const discordBaseUrl = lastValue(values, "--discord-base-url");
    if (discordBaseUrl) {
      adapterConfig.baseUrl = discordBaseUrl;
    }
    const discordChannelId = lastValue(values, "--discord-channel-id");
    if (discordChannelId) {
      adapterConfig.channelId = discordChannelId;
    }
    const discordWebhookUrl = lastValue(values, "--discord-webhook-url");
    if (discordWebhookUrl) {
      adapterConfig.webhookUrl = discordWebhookUrl;
    }
    const feishuWebhookUrl = lastValue(values, "--feishu-webhook-url");
    if (feishuWebhookUrl) {
      adapterConfig.webhookUrl = feishuWebhookUrl;
    }
    const dingtalkWebhookUrl = lastValue(values, "--dingtalk-webhook-url");
    if (dingtalkWebhookUrl) {
      adapterConfig.webhookUrl = dingtalkWebhookUrl;
    }
    const teamsWebhookUrl = lastValue(values, "--teams-webhook-url");
    if (teamsWebhookUrl) {
      adapterConfig.webhookUrl = teamsWebhookUrl;
    }
    const headers = parseKeyValueEntries(flattenValues(values, "--webhook-header"));
    if (Object.keys(headers).length > 0) {
      adapterConfig.headers = headers;
    }
    const retryMaxAttempts = lastValue(values, "--retry-max-attempts");
    const retryDelayMs = lastValue(values, "--retry-delay-ms");
    if (retryMaxAttempts || retryDelayMs || flags.has("--retry-disabled")) {
      adapterConfig.retry = {
        enabled: !flags.has("--retry-disabled"),
        maxAttempts: parsePositiveNumber(retryMaxAttempts, 3),
        delayMs: parsePositiveNumber(retryDelayMs, 5_000),
      };
    }
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      title: lastValue(values, "--title"),
      threadId: lastValue(values, "--thread-id"),
      channelType: requiredValue(values, "--channel-type", "The route-create command requires --channel-type."),
      channelKey: requiredValue(values, "--channel-key", "The route-create command requires --channel-key."),
      adapterType,
      adapterConfig,
      inboundSecret: lastValue(values, "--inbound-secret"),
      status: flags.has("--paused") ? "paused" : "active",
    };
  }

  if (command === "deliveries") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      routeId: lastValue(values, "--route-id"),
      status: normalizeDeliveryStatus(lastValue(values, "--status")),
      limit: parsePositiveNumber(lastValue(values, "--limit"), 50),
    };
  }

  if (command === "extensions") {
    return { command, cwd, storageRoot, pluginDirs };
  }

  if (command === "serve" || command === "daemon-start") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
      host: lastValue(values, "--host") ?? "127.0.0.1",
      port: parsePositiveNumber(lastValue(values, "--port"), 4040),
      gatewayToken: lastValue(values, "--gateway-token") ?? process.env.OMNI_AGENT_GATEWAY_TOKEN ?? loadConfiguredGatewayToken(storageRoot),
      ...runtimeOptions,
    };
  }

  if (command === "daemon-stop" || command === "daemon-status") {
    return {
      command,
      cwd,
      storageRoot,
      pluginDirs,
    };
  }

  const taskFile = lastValue(values, "--task-file");
  const task =
    taskFile !== undefined
      ? readFileSync(resolve(cwd, taskFile), "utf8").trim()
      : lastValue(values, "--task") ?? collectPositionalTask(commandlessArgs);
  if (!task) {
    throw new Error("A task is required. Use run --task \"...\" or --task-file <path>.");
  }

  return {
    command: "run",
    task,
    cwd,
    storageRoot,
    pluginDirs,
    threadTitle: lastValue(values, "--thread-title"),
    threadId: lastValue(values, "--thread-id"),
    continueLatest: flags.has("--continue-latest"),
    outputFormat: parseRunOutputFormat(lastValue(values, "--output-format")),
    ...runtimeOptions,
  };
}

function parseRuntimeOptions(
  values: Map<string, string[]>,
  flags: Set<string>,
): RuntimeCliOptions {
  const modelProfileId = lastValue(values, "--model-profile");
  const explicitMode = lastValue(values, "--mode") as CliMode | undefined;
  return {
    mode: explicitMode ?? (modelProfileId ? "openai" : "mock"),
    modelProfileId,
    approvalPolicy: (lastValue(values, "--approval-policy") as ApprovalPolicy | undefined) ?? "on-request",
    executionDomain: (lastValue(values, "--execution-domain") as ExecutionDomain | undefined) ?? "workspace",
    verificationMode: (lastValue(values, "--verification-mode") as VerificationMode | undefined) ?? "required",
    verificationCommands: flattenValues(values, "--verify")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter(Boolean),
    autoApproveRisky: flags.has("--auto-approve-risky"),
    maxIterations: parsePositiveNumber(lastValue(values, "--max-iterations"), 8),
  };
}

function parseRunOutputFormat(value: string | undefined): RunOutputFormat {
  if (!value) {
    return "text";
  }
  if (value === "text" || value === "json" || value === "stream-json") {
    return value;
  }
  throw new Error(`Invalid --output-format ${value}. Expected text, json, or stream-json.`);
}

function detectCommand(argv: string[]): CliCommandName {
  const candidate = argv[0];
  if (
    candidate === "chat" ||
    candidate === "onboard" ||
    candidate === "setup" ||
    candidate === "config" ||
    candidate === "models" ||
    candidate === "evals" ||
    candidate === "doctor" ||
    candidate === "memory-save" ||
    candidate === "memory-search" ||
    candidate === "skills" ||
    candidate === "automations" ||
    candidate === "automation-create" ||
    candidate === "automation-run" ||
    candidate === "automation-pause" ||
    candidate === "automation-resume" ||
    candidate === "threads" ||
    candidate === "runs" ||
    candidate === "usage" ||
    candidate === "insights" ||
    candidate === "show-thread" ||
    candidate === "compact-thread" ||
    candidate === "show-run" ||
    candidate === "cleanup-run" ||
    candidate === "workspaces" ||
    candidate === "routes" ||
    candidate === "pairings" ||
    candidate === "pairing-approve" ||
    candidate === "route-create" ||
    candidate === "deliveries" ||
    candidate === "extensions" ||
    candidate === "serve" ||
    candidate === "daemon-start" ||
    candidate === "daemon-stop" ||
    candidate === "daemon-status"
  ) {
    return candidate;
  }
  return "run";
}

function collectPositionalTask(argv: string[]): string {
  return argv
    .filter((token, index) => !(index === 0 && token === "run"))
    .filter((token) => !token.startsWith("--"))
    .join(" ")
    .trim();
}

function appendValue(values: Map<string, string[]>, key: string, value: string): void {
  const existing = values.get(key) ?? [];
  existing.push(value);
  values.set(key, existing);
}

function lastValue(values: Map<string, string[]>, key: string): string | undefined {
  return values.get(key)?.at(-1);
}

function flattenValues(values: Map<string, string[]>, key: string): string[] {
  return values.get(key) ?? [];
}

function requiredValue(values: Map<string, string[]>, key: string, errorMessage: string): string {
  const value = lastValue(values, key);
  if (!value) {
    throw new Error(errorMessage);
  }
  return value;
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function parseAutomationScheduleKind(value: string | undefined): AutomationScheduleKind {
  switch (value?.trim().toLowerCase()) {
    case "at":
    case "cron":
    case "event":
    case "heartbeat":
    case "maintenance":
    case "manual":
      return value.trim().toLowerCase() as AutomationScheduleKind;
    default:
      return "interval";
  }
}

function parseMemoryPersistenceBackend(value: string | undefined): MemoryPersistenceBackend {
  if (value === "both" || value === "file" || value === "store") {
    return value;
  }
  return "store";
}

function parseMemorySearchBackend(value: string | undefined): MemorySearchBackend {
  if (value === "both" || value === "file" || value === "store") {
    return value;
  }
  return "both";
}

function parseWorkspaceMemoryFileKind(value: string | undefined): WorkspaceMemoryFileKind | undefined {
  if (value === "daily" || value === "memory" || value === "user") {
    return value;
  }
  return undefined;
}

function parseOptionalBooleanFlag(
  values: Map<string, string[]>,
  flags: Set<string>,
  key: string,
): boolean | undefined {
  if (flags.has(key)) {
    return true;
  }
  const value = lastValue(values, key);
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return undefined;
}

function normalizeRouteAdapterType(value: string | undefined): RouteAdapterType {
  return value === "dingtalk" ||
    value === "discord" ||
    value === "feishu" ||
    value === "filesystem" ||
    value === "slack" ||
    value === "teams" ||
    value === "telegram" ||
    value === "webhook"
    ? value
    : "console";
}

function normalizeDeliveryStatus(
  value: string | undefined,
): "delivered" | "failed" | "queued" | "sending" | undefined {
  return value === "delivered" || value === "failed" || value === "queued" || value === "sending"
    ? value
    : undefined;
}

function normalizePairingStatus(
  value: string | undefined,
): "approved" | "pending" | "rejected" | undefined {
  return value === "approved" || value === "pending" || value === "rejected" ? value : undefined;
}

function parseJsonObjectOption(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--adapter-config must be a JSON object.");
  }
  return { ...(parsed as Record<string, unknown>) };
}

function parseKeyValueEntries(values: string[]): Record<string, string> {
  const entries = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  const output: Record<string, string> = {};
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Expected key=value for webhook header, received "${entry}".`);
    }
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (!key || !value) {
      throw new Error(`Expected key=value for webhook header, received "${entry}".`);
    }
    output[key] = value;
  }
  return output;
}

function printRunSummary(summary: Awaited<ReturnType<AgentRuntime["runTask"]>>): void {
  const lines = [
    "",
    "Omni Agent Run Summary",
    "======================",
    `Workspace: ${summary.workspace.cwd}`,
    `Domain:    ${summary.executionDomain}`,
    `Exec Root: ${summary.executionRoot}`,
    `Thread:    ${summary.thread.title}`,
    `Thread ID: ${summary.thread.id}${summary.resumedThread ? " (resumed)" : " (new)"}`,
    `Run ID:    ${summary.run.id}`,
    `Status:    ${summary.run.status}`,
    `Branch:    ${summary.workspaceSnapshot.branch ?? "n/a"}`,
    `Dirty:     ${summary.workspaceSnapshot.dirty ? "yes" : "no"}`,
    `Changed:   ${summary.changedFiles.join(", ") || "none"}`,
    `Verify:    ${summary.verification.status} (${summary.verification.summary})`,
    ...(summary.runMetrics ? formatRunMetricsSummary(summary.runMetrics, "Usage:     ") : []),
    "",
    "Tool Events:",
    ...summary.toolEvents.map(
      (event) =>
        `- ${event.toolName} [tier ${event.riskTier}] ${event.status}: ${event.summary}${
          event.toolCallId ? ` call=${event.toolCallId}` : ""
        }${formatToolEventPresentation(event)}`,
    ),
  ];

  if (summary.worktreePath) {
    lines.splice(4, 0, `Worktree:  ${summary.worktreePath}`);
  }

  if (summary.worktreeBranch) {
    lines.splice(5, 0, `BranchRef: ${summary.worktreeBranch}`);
  }

  if (summary.sandboxPath) {
    lines.splice(4, 0, `Sandbox:   ${summary.sandboxPath}`);
  }

  if (summary.diffSummary?.stat) {
    lines.push("", "Diff Summary:", summary.diffSummary.stat);
  }

  lines.push("", "Final Response:", summary.finalResponse);

  if (summary.artifacts.length > 0) {
    lines.push("", "Artifacts:");
    for (const artifact of summary.artifacts) {
      lines.push(`- ${artifact.kind}: ${formatArtifactPathForCli(artifact)}`);
    }
  }

  console.log(lines.join("\n"));
}

interface RunOutputWriter {
  readonly handleEvent?: (event: AgentRuntimeEvent) => void;
  readonly writeSummary: (summary: Awaited<ReturnType<AgentRuntime["runTask"]>>) => void;
}

function createRunOutputWriter(format: RunOutputFormat): RunOutputWriter {
  if (format === "text") {
    return {
      writeSummary: printRunSummary,
    };
  }
  if (format === "json") {
    return {
      writeSummary: (summary) => {
        process.stdout.write(`${JSON.stringify(redactCliJsonValue(formatRunSummaryJson(summary)))}\n`);
      },
    };
  }
  return {
    handleEvent: (event) => {
      process.stdout.write(`${JSON.stringify(formatRunEventJson(event))}\n`);
    },
    writeSummary: (summary) => {
      process.stdout.write(`${JSON.stringify({ type: "result", summary: redactCliJsonValue(formatRunSummaryJson(summary)) })}\n`);
    },
  };
}

function formatRunEventJson(event: AgentRuntimeEvent): Record<string, unknown> {
  const payloadValue = redactCliJsonValue(event.payload);
  const payload = isRecord(payloadValue) ? payloadValue : undefined;
  return {
    type: normalizeRunOutputEventType(event.type),
    rawType: event.type,
    at: event.at,
    workspaceId: event.workspaceId,
    threadId: event.threadId,
    runId: event.runId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    status: event.status,
    summary: typeof event.summary === "string" ? redactSensitiveText(event.summary) : event.summary,
    blockKind: payload?.blockKind,
    approvalClass: payload?.approvalClass,
    riskTier: payload?.riskTier,
    decision: payload?.decision,
    questionId: payload?.questionId,
    question: payload?.question,
    presentation: redactCliJsonValue(event.presentation),
    payload: payloadValue,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactCliJsonValue(value: unknown): unknown {
  return redactSensitiveValue(value);
}

function normalizeRunOutputEventType(type: AgentRuntimeEvent["type"]): string {
  switch (type) {
    case "run.started":
      return "run_start";
    case "tool.started":
      return "tool_start";
    case "tool.completed":
      return "tool_result";
    case "tool.failed":
      return "tool_result";
    case "tool.blocked":
      return "tool_blocked";
    case "verification.completed":
      return "verification";
    case "run.completed":
      return "run_end";
    default:
      return type.replace(/\./g, "_");
  }
}

function formatRunSummaryJson(summary: Awaited<ReturnType<AgentRuntime["runTask"]>>): Record<string, unknown> {
  return {
    run: {
      id: summary.run.id,
      status: summary.run.status,
      createdAt: summary.run.createdAt,
      updatedAt: summary.run.updatedAt,
    },
    thread: {
      id: summary.thread.id,
      title: summary.thread.title,
    },
    verification: summary.verification,
    changedFiles: summary.changedFiles,
    toolEvents: summary.toolEvents.map(formatRunToolEventJson),
    blockedApprovals: summary.blockedApprovals.map((entry) => ({ summary: entry })),
    artifacts: summary.artifacts.map((artifact) => ({
      kind: artifact.kind,
      path: formatArtifactPathForCli(artifact),
      summary: artifact.summary,
      createdAt: artifact.createdAt,
    })),
    finalResponse: summary.finalResponse,
    metrics: summary.runMetrics,
    usage: summary.threadUsage,
  };
}

function formatRunToolEventJson(event: ToolEventRecord): Record<string, unknown> {
  return {
    id: event.id,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    status: event.status,
    riskTier: event.riskTier,
    summary: event.summary,
    outputPreview: event.outputPreview,
    outputTruncated: event.outputTruncated,
    storedOutputRef: event.storedOutputRef,
    presentation: event.presentation,
    createdAt: event.createdAt,
  };
}

function formatToolEventPresentation(event: ToolEventRecord): string {
  const presentation = event.presentation;
  if (!presentation) {
    return "";
  }
  const kind = typeof presentation.kind === "string" ? presentation.kind : "";
  const title = typeof presentation.title === "string" ? presentation.title : "";
  const label = [kind, title].filter(Boolean).join(": ");
  return label ? ` presentation=${label}` : "";
}

function mapRunSummaryToEvalObservedRun(summary: Awaited<ReturnType<AgentRuntime["runTask"]>>): EvalObservedRun {
  return {
    runId: summary.run.id,
    threadId: summary.thread.id,
    verificationStatus: summary.verification.status,
    finalResponse: summary.finalResponse,
    changedFiles: summary.changedFiles,
    toolEvents: summary.toolEvents.map((event) => ({
      toolName: event.toolName,
      status: event.status,
    })),
    modelProfiles: summary.runMetrics?.modelProfiles ?? [],
    inputTokens: summary.runMetrics?.inputTokens ?? null,
    outputTokens: summary.runMetrics?.outputTokens ?? null,
    totalTokens: summary.runMetrics?.totalTokens ?? null,
    toolCallCount: summary.runMetrics?.toolCallCount ?? summary.toolEvents.length,
    turnCount: summary.runMetrics?.turnCount ?? 0,
    durationMs: summary.runMetrics?.durationMs ?? null,
  };
}

function printEvalSuiteSummary(result: EvalSuiteResult): void {
  const quality = buildBenchmarkQualityReport(result, result.qualityThresholds);
  const lines = [
    "",
    `Eval Suite: ${result.title}`,
    "===============================",
    `Started:   ${result.startedAt}`,
    `Completed: ${result.completedAt}`,
  ];

  if (result.description) {
    lines.push(`Description: ${result.description}`);
  }

  lines.push("", "Scenarios:");
  for (const scenario of result.scenarioResults) {
    lines.push(
      `- [${scenario.completed ? "pass" : "fail"}] ${scenario.title} (${scenario.category})  steps=${scenario.stepResults.length}  avgTools=${scenario.averageToolCallCount.toFixed(1)}`,
    );
    for (const step of scenario.stepResults) {
      if (step.passed) {
        continue;
      }
      lines.push(`  reason: ${step.reasons.join(" | ")}`);
    }
  }

  lines.push(
    "",
    "Metrics:",
    `- Completion rate: ${formatEvalRate(result.metrics.completedCount, result.metrics.scenarioCount)}`,
    `- First pass rate: ${formatEvalRate(result.metrics.firstPassCount, result.metrics.scenarioCount)}`,
    `- Repair rate after verification failure: ${formatOptionalEvalRate(result.metrics.repairedCount, result.metrics.repairEligibleCount, result.metrics.repairRate)}`,
    `- Average tool calls: ${result.metrics.averageToolCallCount.toFixed(1)}`,
    `- Tool reliability: ${(100 - result.metrics.toolFailureRate * 100).toFixed(1)}%`,
    `- Memory hit rate: ${formatNullableRate(result.metrics.memoryHitRate)}`,
    `- Route delivery success: ${formatNullableRate(result.metrics.routeDeliverySuccessRate)}`,
    `- State retention rate: ${formatOptionalEvalRate(result.metrics.retainedStateCount, result.metrics.longContextScenarioCount, result.metrics.stateRetentionRate)}`,
    "",
    "Quality scorecard:",
    `- Overall score: ${(quality.overallScore * 100).toFixed(1)}% (${quality.passed ? "pass" : "fail"})`,
  );

  for (const dimension of quality.dimensions) {
    lines.push(
      `- ${dimension.label}: ${formatNullableRate(dimension.score)} threshold=${formatNullableRate(dimension.threshold)} status=${dimension.passed === null ? "n/a" : dimension.passed ? "pass" : "fail"}`,
    );
  }

  lines.push("", "Recommendations:");
  for (const recommendation of quality.recommendations) {
    lines.push(`- ${recommendation}`);
  }

  console.log(lines.join("\n"));
}

function formatEvalRate(passed: number, total: number): string {
  if (total <= 0) {
    return "n/a";
  }
  return `${(passed / total * 100).toFixed(1)}% (${passed}/${total})`;
}

function formatOptionalEvalRate(passed: number, total: number, rate: number | null): string {
  if (rate === null || total <= 0) {
    return "n/a";
  }
  return `${(rate * 100).toFixed(1)}% (${passed}/${total})`;
}

function formatNullableRate(rate: number | null): string {
  if (rate === null) {
    return "n/a";
  }
  return `${(rate * 100).toFixed(1)}%`;
}

function printHelp(): void {
  console.log(`
Usage:
  npm run dev -- chat --cwd "E:\\repo"
  npm run dev -- onboard --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\\repo"
  npm run dev -- setup --storage-root "%USERPROFILE%\\.omni-agent" --default-workspace "E:\\repo" --profile-id primary --protocol openai --base-url "https://api.openai.com/v1" --api-key-env OPENAI_API_KEY --model gpt-4.1-mini
  npm run dev -- config
  npm run dev -- models
  npm run dev -- evals --manifest ".\\examples\\evals\\suite.json" --cwd "E:\\repo"
  npm run dev -- doctor --cwd "E:\\repo"
  npm run dev -- doctor --cwd "E:\\repo" --fix
  npm run dev -- run --task "Summarize this repository"
  npm run dev -- memory-save --cwd "E:\\repo" --content "Use pnpm in this repo" --tag build
  npm run dev -- memory-save --cwd "E:\\repo" --content "Track today's findings" --scope thread --backend both --file-kind daily
  npm run dev -- memory-search --cwd "E:\\repo" --query "pnpm"
  npm run dev -- memory-search --cwd "E:\\repo" --query "verification" --backend file
  npm run dev -- skills --cwd "E:\\repo" --query "verification"
  npm run dev -- automations --cwd "E:\\repo"
  npm run dev -- automation-create --cwd "E:\\repo" --title "Nightly build" --task "Run the build and summarize failures" --interval-seconds 3600
  npm run dev -- automation-run --automation-id <id>
  npm run dev -- threads --cwd "E:\\repo"
  npm run dev -- runs --thread-id <id>
  npm run dev -- usage --thread-id <id>
  npm run dev -- insights --cwd "E:\\repo"
  npm run dev -- show-thread --thread-id <id>
  npm run dev -- compact-thread --thread-id <id> --keep-messages 8
  npm run dev -- show-run --run-id <id>
  npm run dev -- cleanup-run --run-id <id>
  npm run dev -- workspaces
  npm run dev -- routes --cwd "E:\\repo"
  npm run dev -- pairings --cwd "E:\\repo"
  npm run dev -- pairing-approve --code ABC123
  npm run dev -- route-create --cwd "E:\\repo" --title "Slack triage" --channel-type slack --channel-key C12345 --adapter-type filesystem --outbox-dir ".\\outbox" --inbound-secret route-secret
  npm run dev -- route-create --cwd "E:\\repo" --title "Telegram triage" --channel-type telegram --channel-key 12345 --adapter-type telegram --telegram-bot-token "<bot-token>" --retry-max-attempts 5 --retry-delay-ms 3000
  npm run dev -- route-create --cwd "E:\\repo" --title "Slack bot" --channel-type slack --channel-key C12345 --adapter-type slack --slack-bot-token "<token>"
  npm run dev -- route-create --cwd "E:\\repo" --title "Discord webhook" --channel-type discord --channel-key "1234567890" --adapter-type discord --discord-webhook-url "https://discord.com/api/webhooks/..."
  npm run dev -- deliveries --cwd "E:\\repo"
  npm run dev -- extensions --plugin-dir ".\\examples\\plugins"
  npm run dev -- serve --cwd "E:\\repo" --port 4040
  npm run dev -- daemon-start --cwd "E:\\repo" --port 4040
  npm run dev -- daemon-status
  npm run dev -- daemon-stop

Run options:
  --task <text>                 Task objective
  --task-file <path>            Read task objective from a UTF-8 text file, resolved from --cwd
  --cwd <path>                  Workspace root (defaults to current directory)
  --default-workspace <path>    Persist a default workspace for future CLI runs
  --force                       Overwrite starter workspace files during setup/onboard
  --manifest <path>             Eval suite JSON manifest for the evals command
  --output <path>               Write eval suite JSON results to a file
  --mode <mock|openai>          Runtime mode (default: mock, or openai when --model-profile is set)
  --model-profile <id>          Pin a specific OpenAI-compatible profile instead of auto failover
  --profile-id <id>             Profile id used by setup
  --profile-name <name>         Friendly profile name used by setup
  --protocol <protocol>         openai | anthropic for setup profile creation
   --base-url <url>              Model provider base URL for setup
   --api-key-env <name>          API key environment variable name for setup
   --model <name>                Model id for setup
   --supports-tools <bool>       Persist setup profile tool-call support
   --supports-streaming <bool>   Persist setup profile streaming support
   --strict                      Treat warnings as errors in doctor diagnostics
  --thread-title <title>        Override thread title
  --thread-id <id>              Resume a specific thread
  --workspace-id <id>           Show workspace-level insights for a specific workspace
  --output-format <format>      run output: text | json | stream-json
  --keep-messages <n>           Retain only the most recent N messages when compacting a thread
  --continue-latest             Resume the most recent thread for this workspace
  --history-limit <n>           Default /history message count in chat mode
  --storage-root <path>         Override default ~/.omni-agent store
  --plugin-dir <path>           Load local extension manifests (repeat or comma-separate)
  --content <text>              Memory content for memory-save
  --query <text>                Memory or skill search query
  --review-queue                Show learned-skill promotion, reverify, and disable queues
  --scope <scope>               workspace | thread
  --tag <tag>                   Memory tag (repeat or comma-separate)
  --backend <mode>              store | file | both (memory-save and memory-search)
  --file-kind <kind>            memory | user | daily (memory-save)
  --automation-id <id>          Target automation id
  --title <text>                Automation title
  --schedule <mode>             interval | manual
  --interval-seconds <n>        Automation interval in seconds
  --paused                      Create automation in paused state
  --channel-type <type>         Route channel type for route-create
  --channel-key <key>           Route channel key for route-create
  --adapter-type <type>         console | filesystem | webhook | telegram | slack | discord | feishu | dingtalk | teams
  --adapter-config <json>       JSON adapter config override
  --dm-policy <mode>            open | pairing
  --allow-from <sender>         Pre-allow sender identity (repeat or comma-separate)
  --outbox-dir <path>           Filesystem adapter outbox directory
  --webhook-url <url>           Webhook adapter target URL
  --webhook-method <method>     Webhook adapter HTTP method
  --webhook-header <k=v>        Webhook adapter header (repeat or comma-separate)
  --telegram-bot-token <token>  Telegram Bot API token
  --telegram-base-url <url>     Override Telegram Bot API base URL
  --telegram-chat-id <id>       Telegram chat id override
  --telegram-parse-mode <mode>  Telegram parse mode (e.g. Markdown)
  --slack-bot-token <token>     Slack bot token for chat.postMessage
  --slack-base-url <url>        Override Slack API base URL
  --slack-channel-id <id>       Slack channel id override
  --slack-webhook-url <url>     Slack incoming webhook URL
  --discord-bot-token <token>   Discord bot token for channel message send
  --discord-base-url <url>      Override Discord API base URL
  --discord-channel-id <id>     Discord channel id override
  --discord-webhook-url <url>   Discord webhook URL
  --feishu-webhook-url <url>    Feishu custom bot webhook URL
  --dingtalk-webhook-url <url>  DingTalk robot webhook URL
  --teams-webhook-url <url>     Microsoft Teams incoming webhook URL
  --retry-max-attempts <n>      Adapter retry cap for failed deliveries
  --retry-delay-ms <n>          Delay before retrying failed deliveries
  --retry-disabled              Disable delivery retries for this route
  --inbound-secret <secret>     Route-specific inbound secret
  --route-id <id>               Filter deliveries by route id
  --code <value>                Pairing code for pairing-approve
  --status <status>             Delivery status filter
  --approval-policy <policy>    never | on-request | on-failure | manual
  --execution-domain <domain>   workspace | worktree | sandbox
                                worktree creates an isolated git worktree for the run
                                sandbox creates an isolated workspace copy for the run
  --verification-mode <mode>    required | best-effort
  --verify <command>            Custom verification command (repeat or comma-separate)
  --max-iterations <n>          Max model/tool turns (default: 8)
  --auto-approve-risky          Auto-approve prompt-tier operations
  --host <host>                 Gateway host for serve (default: 127.0.0.1)
  --port <port>                 Gateway port for serve (default: 4040)
  --gateway-token <token>       Require this bearer token for gateway API access
  --help                        Show this message
`.trim());
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function describeApprovalPromptLead(assessment: ToolRiskAssessment): string {
  switch (assessment.approvalClass) {
    case "readonly_search":
      return "This will read from an external network source.";
    case "mutating":
      return "This will change workspace state.";
    case "exec_capable":
      return "This can execute commands or browser automation.";
    case "control_plane":
      return "This changes orchestration or execution-control state.";
    case "interactive":
      return "This pauses the run for direct user interaction.";
    case "readonly_scoped":
      return "This only inspects workspace-scoped state.";
    default:
      return "This tool has no specialized approval guidance.";
  }
}

async function promptForApproval(assessment: ToolRiskAssessment): Promise<ApprovalHandlerResult> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await readline.question(
      `Approve ${assessment.toolName} (${describeApprovalClass(assessment.approvalClass)}, tier ${assessment.riskTier})? ${describeApprovalPromptLead(assessment)} ${assessment.reason} [y/once/session/always/N] `,
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === "once" || normalized === "o") {
      return "once";
    }
    if (normalized === "session" || normalized === "s") {
      return "session";
    }
    if (normalized === "always" || normalized === "a") {
      return "always";
    }
    return /^y(es)?$/i.test(normalized);
  } finally {
    readline.close();
  }
}

async function createRuntimeHost(
  options: BaseCliOptions & RuntimeCliOptions & {
    readonly approvalGrants?: ApprovalGrantStore;
    readonly eventHandler?: (event: AgentRuntimeEvent) => void | Promise<void>;
    readonly structuredOutput?: boolean;
  },
  sessionStore: SqliteSessionStore,
): Promise<{
  readonly runtime: AgentRuntime;
  readonly close: () => Promise<void>;
}> {
  const workspaceArtifactsRoot = join(
    sessionStore.artifactsRoot,
    sanitizeSegment(basename(resolve(options.cwd)) || "workspace"),
  );
  const workspace = new LocalWorkspaceService(options.cwd, workspaceArtifactsRoot);
  const toolRegistry = new ToolRegistry();
  registerBuiltInTools(toolRegistry);

  const extensionRegistry = await loadExtensionRegistry({
    cwd: options.cwd,
    pluginDirs: options.pluginDirs,
  });
  toolRegistry.registerMany(extensionRegistry.listToolDefinitions());
  toolRegistry.registerMany(createExtensionRuntimeTools(extensionRegistry));

  const modelClient: ModelClient =
    options.mode === "openai"
      ? createOpenAiRuntimeClient(options.modelProfileId, options.storageRoot)
      : new MockModelClient();

  return {
    runtime: new AgentRuntime(
      sessionStore,
      workspace,
      toolRegistry,
      modelClient,
      extensionRegistry,
      {
        approvalPolicy: options.approvalPolicy,
        executionDomain: options.executionDomain,
        verificationMode: options.verificationMode,
        approvalGrants: options.approvalGrants ?? new JsonFileApprovalGrantStore(
          join(resolveStorageRoot(options.storageRoot), "approval-grants.json"),
        ),
        approvalHandler: async ({ assessment }) => {
          if (options.autoApproveRisky) {
            return true;
          }
          if (options.structuredOutput) {
            return false;
          }
          return promptForApproval(assessment);
        },
        eventHandler: options.eventHandler,
      },
    ),
    close: async () => {
      await extensionRegistry.dispose();
    },
  };
}

function createOpenAiRuntimeClient(modelProfileId?: string, storageRoot?: string): ModelClient {
  const profiles = selectModelProfiles(loadConfiguredModelProfiles(storageRoot), modelProfileId);
  if (profiles.length === 1) {
    return profiles[0]?.protocol === "anthropic"
      ? new AnthropicMessagesModelClient(profiles[0])
      : new OpenAiCompatibleModelClient(profiles[0]);
  }
  return new FailoverModelClient(profiles);
}

async function waitForShutdown(close: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    let closed = false;

    const shutdown = async () => {
      if (closed) {
        return;
      }
      closed = true;
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
      try {
        await close();
        resolvePromise();
      } catch (error) {
        reject(error);
      }
    };

    const handleSignal = () => {
      void shutdown();
    };

    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
  });
}

function resolveStorageRoot(storageRoot?: string): string {
  return resolve(storageRoot ?? join(homedir(), ".omni-agent"));
}

function getGatewayDaemonPaths(storageRoot: string): {
  readonly root: string;
  readonly pidPath: string;
  readonly logPath: string;
  readonly statePath: string;
} {
  const root = join(storageRoot, "daemon");
  return {
    root,
    pidPath: join(root, "gateway.pid"),
    logPath: join(root, "gateway.log"),
    statePath: join(root, "gateway.json"),
  };
}

function readGatewayDaemonState(statePath: string): GatewayDaemonState | null {
  if (!existsSync(statePath)) {
    return null;
  }

  return JSON.parse(readFileSync(statePath, "utf8")) as GatewayDaemonState;
}

function cleanupGatewayDaemonState(paths: {
  readonly pidPath: string;
  readonly statePath: string;
}): void {
  rmSync(paths.pidPath, { force: true });
  rmSync(paths.statePath, { force: true });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForGatewayReady(url: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Ignore startup races while the daemon is booting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }

  throw new Error(`Timed out waiting for the gateway daemon at ${url}.`);
}

main().catch((error) => {
  if (error instanceof RouteConfigurationError || error instanceof SetupConfigurationError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  }
  process.exit(1);
});
