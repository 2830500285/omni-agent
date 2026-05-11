import { randomUUID } from "node:crypto";

import { getAgentRoleContract } from "@omni-agent/context";
import type { ExecutionContext, TaskContract } from "@omni-agent/context";
import type { ToolSpec } from "@omni-agent/tools";

export type BuiltInModelProtocol = "anthropic" | "openai" | "responses";
export type ModelProtocol = BuiltInModelProtocol | (string & {});
export type BuiltInModelProfileProvider = "bai";

export interface ModelProfile {
  readonly id: string;
  readonly name: string;
  readonly protocol: ModelProtocol;
  readonly providerExtensionId?: string;
  readonly baseUrl: string;
  readonly apiPath?: string;
  readonly apiKeyEnv: string;
  readonly credentials?: readonly ModelCredentialEntry[];
  readonly credentialStrategy?: ModelCredentialStrategy;
  readonly model: string;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly maxInputTokens?: number;
  readonly costHint?: ModelCostHint;
  readonly headers?: Record<string, string>;
  readonly requestBody?: Record<string, unknown>;
}

export type ModelCostHint = "low" | "medium" | "high" | number;
export type ModelCredentialStrategy = "round-robin" | "least-used";

export interface ModelCredentialEntry {
  readonly id?: string;
  readonly apiKeyEnv?: string;
  readonly apiKey?: string;
}

export interface ModelProfileSelectionIssue {
  readonly level: "error" | "warning";
  readonly message: string;
}

export interface ModelProfileSelectionReport {
  readonly profiles: ModelProfile[];
  readonly source: "default" | "json";
  readonly issues: ModelProfileSelectionIssue[];
}

export interface ModelProfileDiagnostic {
  readonly id: string;
  readonly name: string;
  readonly protocol: ModelProtocol;
  readonly providerExtensionId: string | null;
  readonly providerExtensionConfigured: boolean;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiPath: string | null;
  readonly apiKeyEnv: string;
  readonly apiKeyConfigured: boolean;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly requestBodyKeys: readonly string[];
  readonly credentialPool: ModelCredentialPoolDiagnostic;
  readonly issues: readonly ModelProfileSelectionIssue[];
}

export interface ModelCredentialPoolDiagnostic {
  readonly strategy: ModelCredentialStrategy;
  readonly credentialCount: number;
  readonly configuredCount: number;
  readonly healthyCount: number;
  readonly cooldownCount: number;
  readonly leasedCount: number;
  readonly entries: readonly ModelCredentialDiagnostic[];
}

export interface ModelCredentialDiagnostic {
  readonly id: string;
  readonly source: "env" | "inline";
  readonly apiKeyEnv: string | null;
  readonly configured: boolean;
  readonly redacted: string;
  readonly leaseCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly cooldownUntil: string | null;
}

export interface ModelProfileDiagnosticsReport {
  readonly source: "default" | "json";
  readonly profileCount: number;
  readonly configuredKeyCount: number;
  readonly toolCapableCount: number;
  readonly streamingCapableCount: number;
  readonly profiles: readonly ModelProfileDiagnostic[];
  readonly issues: readonly ModelProfileSelectionIssue[];
}

export interface ToolObservation {
  readonly toolName: string;
  readonly ok: boolean;
  readonly summary: string;
  readonly details?: string;
}

export interface ModelToolCall {
  readonly id: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
}

export interface ModelTurnInput {
  readonly context: ExecutionContext;
  readonly taskContract: TaskContract;
  readonly availableTools: ToolSpec[];
  readonly toolResults: ToolObservation[];
}

export interface ModelTurnUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly reasoningTokens?: number;
}

export interface ModelTokenPricing {
  readonly model: string;
  readonly source: "anthropic-official" | "openai-official";
  readonly inputUsdPerMillion: number;
  readonly cachedInputUsdPerMillion?: number;
  readonly cacheWriteUsdPerMillion?: number;
  readonly outputUsdPerMillion: number;
}

export interface ModelUsageCostEstimate {
  readonly status: "estimated" | "unknown";
  readonly model: string;
  readonly source?: ModelTokenPricing["source"];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly estimatedCostUsd: number | null;
  readonly summary: string;
}

export interface ModelProviderInfo {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly protocol: ModelProtocol | "mock";
}

export interface ModelRateLimitBucket {
  readonly limit?: number;
  readonly remaining?: number;
  readonly reset?: string;
}

export interface ModelRateLimitInfo {
  readonly requests?: ModelRateLimitBucket;
  readonly tokens?: ModelRateLimitBucket;
}

export interface ModelTurnMetadata {
  readonly rateLimit?: ModelRateLimitInfo;
}

export type ModelErrorKind =
  | "auth_failed"
  | "context_overflow"
  | "malformed_tool_call"
  | "network_error"
  | "rate_limit"
  | "server_error"
  | "timeout"
  | "unknown";

export interface ModelProfileHealth {
  readonly profileId: string;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastSucceededAt: string | null;
  readonly lastFailedAt: string | null;
  readonly lastError: string | null;
  readonly lastErrorKind: ModelErrorKind | null;
  readonly cooldownUntil: string | null;
}

export interface ModelRouterAttempt {
  readonly profileId: string;
  readonly profileName: string;
  readonly attempt: number;
  readonly outcome: "success" | "failed" | "skipped_cooldown";
  readonly errorKind?: ModelErrorKind;
  readonly error?: string;
  readonly cooldownUntil?: string | null;
  readonly willRetry?: boolean;
}

export interface ModelRouteDiagnostic {
  readonly profileId: string;
  readonly profileName: string;
  readonly eligible: boolean;
  readonly selectedOrder: number | null;
  readonly decisionReason: string;
  readonly requiresTools: boolean;
  readonly supportsTools: boolean;
  readonly estimatedInputTokens: number;
  readonly maxInputTokens: number | null;
  readonly costRank: number;
  readonly health: Pick<ModelProfileHealth, "successCount" | "failureCount" | "lastErrorKind" | "cooldownUntil">;
}

export interface ModelRouterOptions {
  readonly allowlist?: readonly string[];
  readonly roleProfileOverrides?: Readonly<Record<string, string>>;
  readonly cooldownMs?: number;
  readonly retryBudget?: number;
  readonly retryableErrorKinds?: readonly ModelErrorKind[];
  readonly clients?: readonly ModelClient[];
  readonly providerRegistry?: ModelProviderExtensionRegistry;
}

export interface ModelTurnResult {
  readonly assistantText: string;
  readonly toolCalls: ModelToolCall[];
  readonly usage?: ModelTurnUsage;
  readonly metadata?: ModelTurnMetadata;
  readonly provider?: ModelProviderInfo;
  readonly raw: unknown;
}

export interface ModelProviderExtensionDescriptor {
  readonly id: string;
  readonly name: string;
  readonly protocols?: readonly string[];
  createModelClient(profile: ModelProfile): ModelClient;
}

export interface ModelProfileTemplateOptions {
  readonly id?: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  readonly model?: string;
  readonly supportsTools?: boolean;
  readonly supportsStreaming?: boolean;
}

interface ChatCompletionContentPart {
  readonly text?: string;
  readonly type?: string;
}

interface NativeToolCallPayload {
  readonly id?: string;
  readonly index?: number;
  readonly type?: string;
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

interface ParsedAssistantEnvelope {
  readonly assistantText: string;
  readonly toolCalls: ModelToolCall[];
}

const REASONING_TAG_NAMES = [
  "think",
  "thinking",
  "reasoning",
  "thought",
  "REASONING_SCRATCHPAD",
] as const;

interface ChatCompletionMessagePayload {
  readonly content?: string | ChatCompletionContentPart[];
  readonly tool_calls?: NativeToolCallPayload[];
}

interface ChatCompletionChoicePayload {
  readonly message?: ChatCompletionMessagePayload;
  readonly delta?: ChatCompletionMessagePayload;
}

interface ChatCompletionsPayload {
  readonly choices?: ChatCompletionChoicePayload[];
  readonly usage?: Record<string, unknown>;
}

interface OpenAiResponsesContentPartPayload {
  readonly type?: string;
  readonly text?: string;
}

interface OpenAiResponsesOutputItemPayload {
  readonly id?: string;
  readonly call_id?: string;
  readonly type?: string;
  readonly role?: string;
  readonly name?: string;
  readonly arguments?: string;
  readonly content?: OpenAiResponsesContentPartPayload[];
}

interface OpenAiResponsesPayload {
  readonly output?: OpenAiResponsesOutputItemPayload[];
  readonly output_text?: string;
  readonly usage?: Record<string, unknown>;
}

interface AnthropicContentBlockPayload {
  readonly type?: string;
  readonly id?: string;
  readonly name?: string;
  readonly text?: string;
  readonly input?: Record<string, unknown>;
}

interface AnthropicMessagePayload {
  readonly id?: string;
  readonly type?: string;
  readonly role?: string;
  readonly content?: AnthropicContentBlockPayload[];
  readonly stop_reason?: string | null;
  readonly usage?: Record<string, unknown>;
}

const ANTHROPIC_OUTPUT_LIMITS: Record<string, number> = {
  "claude-opus-4-7": 128_000,
  "claude-opus-4-6": 128_000,
  "claude-sonnet-4-6": 64_000,
  "claude-opus-4-5": 64_000,
  "claude-sonnet-4-5": 64_000,
  "claude-haiku-4-5": 64_000,
  "claude-opus-4": 32_000,
  "claude-sonnet-4": 64_000,
  "claude-3-7-sonnet": 128_000,
  "claude-3-5-sonnet": 8_192,
  "claude-3-5-haiku": 8_192,
  "claude-3-opus": 4_096,
  "claude-3-sonnet": 4_096,
  "claude-3-haiku": 4_096,
  minimax: 131_072,
};
const DEFAULT_ANTHROPIC_MAX_TOKENS = 128_000;
const ANTHROPIC_COMMON_BETAS = [
  "interleaved-thinking-2025-05-14",
  "fine-grained-tool-streaming-2025-05-14",
];
const ANTHROPIC_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";
const ANTHROPIC_OAUTH_ONLY_BETAS = ["claude-code-20250219", "oauth-2025-04-20"];
const CLAUDE_CODE_VERSION_FALLBACK = "2.1.74";
const BAI_API_KEY_ENV_CANDIDATES = ["BAI_API_KEY", "B_AI_API_KEY", "OMNI_AGENT_BAI_API_KEY"] as const;

export function isBuiltInModelProfileProvider(value: string | undefined): value is BuiltInModelProfileProvider {
  return resolveBuiltInModelProfileProvider(value) !== null;
}

export function resolveBuiltInModelProfileProvider(value: unknown): BuiltInModelProfileProvider | null {
  return normalizeModelProfileProvider(value);
}

export function createModelProfileForProvider(
  provider: BuiltInModelProfileProvider,
  options: ModelProfileTemplateOptions = {},
): ModelProfile {
  if (provider === "bai") {
    const apiKeyEnv = options.apiKeyEnv?.trim() || BAI_API_KEY_ENV_CANDIDATES[0];
    const credentialEnvs = Array.from(new Set([apiKeyEnv, ...BAI_API_KEY_ENV_CANDIDATES]));
    return {
      id: options.id?.trim() || "bai",
      name: options.name?.trim() || "B.AI",
      protocol: "openai",
      baseUrl: options.baseUrl?.trim() || "https://api.b.ai/v1",
      apiKeyEnv,
      credentials: credentialEnvs.map((envName) => ({ id: envName, apiKeyEnv: envName })),
      model: options.model?.trim() || "gpt-5.2",
      supportsTools: options.supportsTools ?? true,
      supportsStreaming: options.supportsStreaming ?? true,
    };
  }

  const exhaustive: never = provider;
  throw new Error(`Unsupported model profile provider template: ${exhaustive}`);
}

const MODEL_PRICING_SNAPSHOT: readonly ModelTokenPricing[] = [
  { model: "gpt-5.2", source: "openai-official", inputUsdPerMillion: 1.75, cachedInputUsdPerMillion: 0.175, outputUsdPerMillion: 14 },
  { model: "gpt-5.1", source: "openai-official", inputUsdPerMillion: 1.25, cachedInputUsdPerMillion: 0.125, outputUsdPerMillion: 10 },
  { model: "gpt-5", source: "openai-official", inputUsdPerMillion: 1.25, cachedInputUsdPerMillion: 0.125, outputUsdPerMillion: 10 },
  { model: "gpt-5-mini", source: "openai-official", inputUsdPerMillion: 0.25, cachedInputUsdPerMillion: 0.025, outputUsdPerMillion: 2 },
  { model: "gpt-5-nano", source: "openai-official", inputUsdPerMillion: 0.05, cachedInputUsdPerMillion: 0.005, outputUsdPerMillion: 0.4 },
  { model: "gpt-4.1", source: "openai-official", inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 8 },
  { model: "gpt-4.1-mini", source: "openai-official", inputUsdPerMillion: 0.4, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 1.6 },
  { model: "gpt-4.1-nano", source: "openai-official", inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.025, outputUsdPerMillion: 0.4 },
  { model: "gpt-4o", source: "openai-official", inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  { model: "gpt-4o-mini", source: "openai-official", inputUsdPerMillion: 0.15, cachedInputUsdPerMillion: 0.075, outputUsdPerMillion: 0.6 },
  { model: "claude-opus-4.5", source: "anthropic-official", inputUsdPerMillion: 5, cacheWriteUsdPerMillion: 6.25, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 25 },
  { model: "claude-sonnet-4.5", source: "anthropic-official", inputUsdPerMillion: 3, cacheWriteUsdPerMillion: 3.75, cachedInputUsdPerMillion: 0.3, outputUsdPerMillion: 15 },
  { model: "claude-haiku-4.5", source: "anthropic-official", inputUsdPerMillion: 1, cacheWriteUsdPerMillion: 1.25, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 5 },
];

export interface ModelClient {
  generateTurn(input: ModelTurnInput): Promise<ModelTurnResult>;
}

export class ModelProviderExtensionRegistry {
  private readonly descriptorsById = new Map<string, ModelProviderExtensionDescriptor>();
  private readonly descriptorsByProtocol = new Map<string, ModelProviderExtensionDescriptor>();

  public register(descriptor: ModelProviderExtensionDescriptor): void {
    const id = normalizeProviderExtensionId(descriptor.id);
    if (!id) {
      throw new Error("Model provider extension id is required.");
    }
    const normalized = {
      ...descriptor,
      id,
    };
    this.descriptorsById.set(id, normalized);
    for (const protocol of descriptor.protocols ?? []) {
      const normalizedProtocol = normalizeProviderProtocol(protocol);
      if (normalizedProtocol) {
        this.descriptorsByProtocol.set(normalizedProtocol, normalized);
      }
    }
  }

  public resolve(profile: ModelProfile): ModelProviderExtensionDescriptor | null {
    const providerExtensionId = normalizeProviderExtensionId(profile.providerExtensionId);
    if (providerExtensionId) {
      return this.descriptorsById.get(providerExtensionId) ?? null;
    }
    if (isBuiltInModelProtocol(profile.protocol)) {
      return null;
    }
    return this.descriptorsByProtocol.get(normalizeProviderProtocol(profile.protocol)) ?? null;
  }

  public has(profile: ModelProfile): boolean {
    return this.resolve(profile) !== null;
  }
}

export const defaultModelProviderExtensionRegistry = new ModelProviderExtensionRegistry();

export class ModelRequestError extends Error {
  public constructor(
    message: string,
    readonly statusCode?: number,
    readonly profileId?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ModelRequestError";
  }
}

interface MutableModelProfileHealth {
  readonly profileId: string;
  successCount: number;
  failureCount: number;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastError: string | null;
  lastErrorKind: ModelErrorKind | null;
  cooldownUntil: string | null;
}

export function classifyModelError(error: unknown): ModelErrorKind {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const statusCode = error instanceof ModelRequestError ? error.statusCode : undefined;

  if (statusCode === 401 || statusCode === 403 || /missing api key|unauthorized|forbidden|invalid api key|auth/.test(message)) {
    return "auth_failed";
  }
  if (statusCode === 429 || /rate limit|too many requests|quota/.test(message)) {
    return "rate_limit";
  }
  if (statusCode === 408 || /timeout|timed out|aborted/.test(message)) {
    return "timeout";
  }
  if (statusCode === 400 && /context|token|maximum context|too long/.test(message)) {
    return "context_overflow";
  }
  if (statusCode === 413 || /context length|maximum context|too many tokens|request too large/.test(message)) {
    return "context_overflow";
  }
  if (error instanceof SyntaxError || /malformed tool|invalid tool call|tool arguments|json/.test(message)) {
    return "malformed_tool_call";
  }
  if (statusCode !== undefined && statusCode >= 500) {
    return "server_error";
  }
  if (/fetch failed|network|econnreset|enotfound|econnrefused/.test(message)) {
    return "network_error";
  }
  return "unknown";
}

export class MockModelClient implements ModelClient {
  public async generateTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    const objective = input.taskContract.objective;
    if (/release-local subagent orchestration/i.test(objective)) {
      const spawnedJobs = input.toolResults.filter((result) => result.toolName === "spawn_subagent" && result.ok);
      const listedJobs = input.toolResults.some((result) => result.toolName === "list_subagents" && result.ok);
      if (spawnedJobs.length === 0) {
        return {
          assistantText: "Spawning release-local child jobs with shared target paths and explicit budgets.",
          toolCalls: [
            {
              id: randomUUID(),
              toolName: "spawn_subagent",
              args: {
                objective: "Inspect the shared parser file for release-local subagent evidence.",
                threadTitle: "Release local subagent A",
                role: "verifier",
                mode: "background",
                authority: "leaf",
                outcomeVisibility: "context",
                executionDomain: "workspace",
                targetPaths: ["src/shared.ts"],
                timeoutMs: 45_000,
                maxIterations: 1,
                maxRetries: 0,
                maxConcurrentChildren: 1,
              },
            },
            {
              id: randomUUID(),
              toolName: "spawn_subagent",
              args: {
                objective: "Inspect the same parser file to exercise lease and queue observability.",
                threadTitle: "Release local subagent B",
                role: "reviewer",
                mode: "background",
                authority: "leaf",
                outcomeVisibility: "context",
                executionDomain: "workspace",
                targetPaths: ["src/shared.ts"],
                timeoutMs: 45_000,
                maxIterations: 1,
                maxRetries: 0,
                maxConcurrentChildren: 1,
              },
            },
            {
              id: randomUUID(),
              toolName: "spawn_subagent",
              args: {
                objective: "Inspect independent release-local subagent artifact state.",
                threadTitle: "Release local subagent C",
                role: "explorer",
                mode: "background",
                authority: "leaf",
                outcomeVisibility: "context",
                executionDomain: "workspace",
                targetPaths: ["docs/subagent.md"],
                timeoutMs: 45_000,
                maxIterations: 1,
                maxRetries: 0,
                maxConcurrentChildren: 1,
              },
            },
          ],
          provider: createMockProviderInfo(),
          raw: { mode: "mock", stage: "subagent-spawn" },
        };
      }
      if (!listedJobs) {
        return {
          assistantText: "Listing release-local subagent topology after spawn.",
          toolCalls: [{ id: randomUUID(), toolName: "list_subagents", args: {} }],
          provider: createMockProviderInfo(),
          raw: { mode: "mock", stage: "subagent-list" },
        };
      }
      const evidence = input.toolResults
        .map((result) => `- ${result.toolName}: ${result.ok ? "ok" : "failed"} (${result.summary})`)
        .join("\n");
      return {
        assistantText: [
          "release-local subagent orchestration verified",
          "subagent topology persisted",
          "subagent budgets and target paths observable",
          "subagent progress events recorded",
          "",
          evidence,
        ].join("\n"),
        toolCalls: [],
        provider: createMockProviderInfo(),
        raw: { mode: "mock", stage: "subagent-complete" },
      };
    }
    if (/runtime mutation checkpoint/i.test(objective) && /rollback/i.test(objective)) {
      const checkpointResult = input.toolResults.find((result) => result.toolName === "create_checkpoint" && result.ok);
      const rollbackResult = input.toolResults.find((result) => result.toolName === "rollback_checkpoint" && result.ok);
      if (!checkpointResult) {
        return {
          assistantText: "Creating a mock release-local rollback checkpoint.",
          toolCalls: [
            {
              id: randomUUID(),
              toolName: "create_checkpoint",
              args: { name: "release-local-rollback" },
            },
          ],
          provider: createMockProviderInfo(),
          raw: { mode: "mock", stage: "rollback-checkpoint" },
        };
      }
      if (!rollbackResult) {
        return {
          assistantText: "Rolling back the mock release-local checkpoint.",
          toolCalls: [
            {
              id: randomUUID(),
              toolName: "rollback_checkpoint",
              args: { checkpointId: extractMockCheckpointId(checkpointResult.summary) },
            },
          ],
          provider: createMockProviderInfo(),
          raw: { mode: "mock", stage: "rollback-restore" },
        };
      }
    }

    if (/HTX|Web3|B\.AI|TRON|Genesis/i.test(objective)) {
      if (input.availableTools.length > 0) {
        const nextGenesisToolCalls = buildMockGenesisToolCalls(
          objective,
          input.toolResults,
        );
        if (nextGenesisToolCalls.length > 0) {
          return {
            assistantText: "Collecting Genesis HTX, Web3, TRON, and B.AI evidence before planning.",
            toolCalls: nextGenesisToolCalls,
            provider: createMockProviderInfo(),
            raw: { mode: "mock", stage: "genesis-tools" },
          };
        }
      }
      const evidence = input.toolResults
        .map((result) => `- ${result.toolName}: ${result.ok ? "ok" : "blocked"} (${result.summary})`)
        .join("\n");
      return {
        assistantText: [
          buildMockGenesisDecision(objective),
          "Live execution remains disabled.",
          "No Web3 signing or broadcast was attempted.",
          "Tool evidence:",
          evidence,
        ].join("\n"),
        toolCalls: [],
        provider: createMockProviderInfo(),
        raw: { mode: "mock", stage: "genesis-complete" },
      };
    }

    if (input.toolResults.length === 0) {
      return {
        assistantText: "Inspecting the workspace before proposing a change.",
        toolCalls: [
          { id: randomUUID(), toolName: "workspace_info", args: {} },
          { id: randomUUID(), toolName: "git_status", args: {} },
        ],
        provider: createMockProviderInfo(),
        raw: { mode: "mock", stage: "inspect" },
      };
    }

    const evidence = input.toolResults
      .map((result) =>
        [`- ${result.toolName}: ${result.ok ? "ok" : "failed"} (${result.summary})`, result.details].filter(Boolean).join(
          "\n",
        ),
      )
      .join("\n");

    return {
      assistantText: [
        `Objective: ${input.taskContract.objective}`,
        "",
        "Scaffold runtime completed an inspection cycle.",
        "Tool evidence:",
        evidence,
        "",
        "Next implementation step is to let the live model choose file and command tools for actual code changes.",
      ].join("\n"),
      toolCalls: [],
      provider: createMockProviderInfo(),
      raw: { mode: "mock", stage: "complete" },
    };
  }
}

function buildMockGenesisToolCalls(objective: string, toolResults: readonly ToolObservation[]): ModelToolCall[] {
  const existingToolNames = new Set(toolResults.map((result) => result.toolName));
  const hasTool = (toolName: string) => existingToolNames.has(toolName);
  const hasSuccessfulTool = (toolName: string) => toolResults.some((result) => result.toolName === toolName && result.ok);
  const tronOwner = "TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf";
  const tronSpender = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7";

  if (/oversized|max order cap|250 USDT/i.test(objective)) {
    if (hasTool("htx_order_preview") && hasTool("genesis_finance_plan")) {
      return [];
    }
    return [
      {
        id: randomUUID(),
        toolName: "htx_order_preview",
        args: { symbol: "btcusdt", side: "buy", quoteAmountUsdt: 250, maxOrderUsdt: 100 },
      },
      {
        id: randomUUID(),
        toolName: "genesis_finance_plan",
        args: { intent: objective, symbol: "btcusdt", amountUsdt: 250, maxOrderUsdt: 100 },
      },
    ];
  }
  if (/missing approval|approved=true/i.test(objective)) {
    if (hasTool("htx_paper_order")) {
      return [];
    }
    return [
      { id: randomUUID(), toolName: "genesis_finance_plan", args: { intent: objective, symbol: "btcusdt", amountUsdt: 25 } },
      { id: randomUUID(), toolName: "htx_order_preview", args: { symbol: "btcusdt", side: "buy", quoteAmountUsdt: 25 } },
      { id: randomUUID(), toolName: "htx_paper_order", args: { symbol: "btcusdt", side: "buy", quoteAmountUsdt: 25 } },
    ];
  }
  if (/missing TRON address|address is required/i.test(objective)) {
    if (hasTool("web3_tron_account_snapshot")) {
      return [];
    }
    return [
      { id: randomUUID(), toolName: "web3_tron_account_snapshot", args: { mode: "live" } },
    ];
  }
  if (/B\.AI key missing|missing B\.AI API key|missing BAI API key/i.test(objective)) {
    if (hasTool("bai_chat_completion")) {
      return [];
    }
    return [
      {
        id: randomUUID(),
        toolName: "bai_chat_completion",
        args: {
          mode: "live",
          apiKeyEnv: "OMNI_AGENT_MISSING_BAI_KEY_FOR_EVAL",
          prompt: "Summarize Genesis approval risk without echoing secrets.",
        },
      },
    ];
  }
  if (/live endpoint timeout|timeout fallback|fallback after timeout/i.test(objective)) {
    if (!hasTool("htx_market_data")) {
      return [
        {
          id: randomUUID(),
          toolName: "htx_market_data",
          args: { symbol: "BTC/USDT", mode: "live", baseUrl: "http://10.255.255.1", timeoutMs: 1 },
        },
      ];
    }
    if (!hasSuccessfulTool("htx_market_data")) {
      return [
        {
          id: randomUUID(),
          toolName: "htx_market_data",
          args: { symbol: "BTC/USDT", mode: "mock" },
        },
      ];
    }
    return [];
  }
  if (/TRON Preview Risk Gate|TRON wallet|TRC20 allowance/i.test(objective)) {
    if (!hasTool("web3_tron_account_snapshot")) {
      return [
        { id: randomUUID(), toolName: "web3_tron_account_snapshot", args: { address: tronOwner } },
        {
          id: randomUUID(),
          toolName: "web3_trc20_allowance",
          args: { token: "USDT", owner: tronOwner, spender: tronSpender, allowance: "25" },
        },
        {
          id: randomUUID(),
          toolName: "web3_revoke_approval_preview",
          args: { token: "USDT", owner: tronOwner, spender: tronSpender, currentAllowance: 25 },
        },
        {
          id: randomUUID(),
          toolName: "web3_transfer_preview",
          args: { token: "USDT", from: tronOwner, to: tronSpender, amount: "10", maxAmount: 100 },
        },
      ];
    }
    if (!hasTool("web3_transaction_simulation")) {
      return [
        {
          id: randomUUID(),
          toolName: "web3_transaction_simulation",
          args: {
            action: "transfer_preview",
            preview: { chain: "tron", action: "transfer_preview", allowed: true, amount: "10", maxAmount: 100 },
            riskReport: { riskLevel: "low", findings: [] },
            allowance: 25,
          },
        },
      ];
    }
    return [];
  }
  if (!hasTool("htx_market_data")) {
    return [
      { id: randomUUID(), toolName: "htx_market_data", args: { symbol: "BTC/USDT" } },
      {
        id: randomUUID(),
        toolName: "htx_account_snapshot",
        args: { accountFixture: { balances: [{ asset: "USDT", available: 125, locked: 0 }] } },
      },
      { id: randomUUID(), toolName: "web3_wallet_snapshot", args: { address: "0x1111111111111111111111111111111111111111" } },
      {
        id: randomUUID(),
        toolName: "web3_contract_risk",
        args: {
          tokenSymbol: "USDT",
          contractAddress: "0x2222222222222222222222222222222222222222",
          spender: "0x3333333333333333333333333333333333333333",
          spenderAllowlist: ["0x3333333333333333333333333333333333333333"],
          allowance: 25,
          simulated: true,
        },
      },
      { id: randomUUID(), toolName: "web3_tron_account_snapshot", args: { address: tronOwner } },
    ];
  }
  if (!hasTool("web3_transaction_simulation")) {
    return [
      {
        id: randomUUID(),
        toolName: "web3_trc20_allowance",
        args: { token: "USDT", owner: tronOwner, spender: tronSpender, allowance: "25" },
      },
      {
        id: randomUUID(),
        toolName: "web3_revoke_approval_preview",
        args: { token: "USDT", owner: tronOwner, spender: tronSpender, currentAllowance: 25 },
      },
      {
        id: randomUUID(),
        toolName: "web3_transfer_preview",
        args: { token: "USDT", from: tronOwner, to: tronSpender, amount: "10", maxAmount: 100 },
      },
      {
        id: randomUUID(),
        toolName: "web3_transaction_simulation",
        args: {
          action: "transfer_preview",
          preview: { chain: "tron", action: "transfer_preview", allowed: true, amount: "10", maxAmount: 100 },
          riskReport: { riskLevel: "low", findings: [] },
          allowance: 25,
        },
      },
      { id: randomUUID(), toolName: "bai_capability_probe", args: {} },
      { id: randomUUID(), toolName: "bai_chat_completion", args: { prompt: "Summarize Genesis approval risk." } },
    ];
  }
  if (!hasTool("htx_paper_order")) {
    return [
      { id: randomUUID(), toolName: "genesis_finance_plan", args: { intent: objective, symbol: "btcusdt", amountUsdt: 25 } },
      { id: randomUUID(), toolName: "htx_order_preview", args: { symbol: "btcusdt", side: "buy", quoteAmountUsdt: 25 } },
      { id: randomUUID(), toolName: "htx_paper_order", args: { symbol: "btcusdt", side: "buy", quoteAmountUsdt: 25, approved: true } },
    ];
  }
  return [];
}

function buildMockGenesisDecision(objective: string): string {
  if (/oversized|max order cap|250 USDT/i.test(objective)) {
    return "Genesis decision: blocked by maxOrderUsdt guardrail.";
  }
  if (/missing approval|approved=true/i.test(objective)) {
    return "Genesis decision: blocked because htx_paper_order requires approved=true; no live order was attempted.";
  }
  if (/missing TRON address|address is required/i.test(objective)) {
    return "Genesis decision: blocked because required TRON address is required.";
  }
  if (/B\.AI key missing|missing B\.AI API key|missing BAI API key/i.test(objective)) {
    return "Genesis decision: blocked because missing B.AI API key prevents live provider execution.";
  }
  if (/live endpoint timeout|timeout fallback|fallback after timeout/i.test(objective)) {
    return "Genesis decision: live endpoint timeout fallback used mock HTX evidence; no execution attempted.";
  }
  return "Genesis decision: paper-only action requires approval.";
}

function extractMockCheckpointId(summary: string): string {
  const match = summary.match(/\bcheckpoint\s+([^\s(]+)/i);
  return match?.[1] ?? "release-local-rollback";
}

export class OpenAiCompatibleModelClient implements ModelClient {
  public constructor(private readonly profile: ModelProfile) {}

  public async generateTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    const apiKey = resolveProfileApiKey(this.profile);
    if (!apiKey) {
      throw new ModelRequestError(
        formatMissingApiKeyMessage(this.profile),
        undefined,
        this.profile.id,
      );
    }

    const toolMode = this.profile.supportsTools && input.availableTools.length > 0 ? "native" : "json";
    const requestBody = buildRequestBody(this.profile, input, toolMode);
    let response: Response;
    try {
      response = await fetch(resolveModelRequestUrl(this.profile), {
        method: "POST",
        headers: buildRequestHeaders(this.profile, apiKey),
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      throw new ModelRequestError(
        error instanceof Error ? error.message : String(error),
        undefined,
        this.profile.id,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new ModelRequestError(
        `Model request failed (${response.status}): ${body}`,
        response.status,
        this.profile.id,
        parseProviderRetryAfterMs(response.headers),
      );
    }

    const parsed = isEventStreamResponse(response)
      ? await parseStreamingChatCompletionsResponse(response)
      : {
          payload: (await response.json()) as ChatCompletionsPayload,
          raw: null,
        };

    const payload = parsed.payload;
    const message = payload.choices?.[0]?.message;
    const nativeToolCalls = normalizeNativeToolCalls(message?.tool_calls);
    const rawText = extractTextFromMessage(message?.content);
    const sanitizedText = sanitizeAssistantText(rawText);
    const raw = parsed.raw ?? payload;
    const observability = buildResponseObservability(response.headers, normalizeOpenAiUsage(payload.usage));

    if (nativeToolCalls.length > 0) {
      return {
        assistantText: sanitizedText,
        toolCalls: nativeToolCalls,
        ...observability,
        provider: createProviderInfo(this.profile),
        raw,
      };
    }

    const envelope = parseAssistantEnvelope(rawText);
    if (envelope.toolCalls.length > 0) {
      return {
        assistantText: envelope.assistantText,
        toolCalls: envelope.toolCalls,
        ...observability,
        provider: createProviderInfo(this.profile),
        raw,
      };
    }

    if (toolMode === "native") {
      return {
        assistantText: sanitizedText,
        toolCalls: [],
        ...observability,
        provider: createProviderInfo(this.profile),
        raw,
      };
    }

    return {
      assistantText: envelope.assistantText,
      toolCalls: envelope.toolCalls,
      ...observability,
      provider: createProviderInfo(this.profile),
      raw,
    };
  }
}

export class OpenAiResponsesModelClient implements ModelClient {
  public constructor(private readonly profile: ModelProfile) {}

  public async generateTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    const apiKey = resolveProfileApiKey(this.profile);
    if (!apiKey) {
      throw new ModelRequestError(
        formatMissingApiKeyMessage(this.profile),
        undefined,
        this.profile.id,
      );
    }

    const toolMode = this.profile.supportsTools && input.availableTools.length > 0 ? "native" : "json";
    const requestBody = buildResponsesRequestBody(this.profile, input, toolMode);
    let response: Response;
    try {
      response = await fetch(resolveModelRequestUrl(this.profile), {
        method: "POST",
        headers: buildRequestHeaders(this.profile, apiKey),
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      throw new ModelRequestError(
        error instanceof Error ? error.message : String(error),
        undefined,
        this.profile.id,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new ModelRequestError(
        `Model request failed (${response.status}): ${body}`,
        response.status,
        this.profile.id,
        parseProviderRetryAfterMs(response.headers),
      );
    }
    const parsed = isEventStreamResponse(response)
      ? await parseOpenAiResponsesStreamingResponse(response)
      : {
          payload: (await response.json()) as OpenAiResponsesPayload,
          raw: null,
        };
    const payload = parsed.payload;
    const normalized = normalizeOpenAiResponsesPayload(payload);
    const sanitizedText = sanitizeAssistantText(normalized.assistantText);
    const raw = parsed.raw ?? payload;
    const observability = buildResponseObservability(response.headers, normalizeResponsesUsage(payload.usage));
    if (normalized.toolCalls.length > 0) {
      return {
        assistantText: sanitizedText,
        toolCalls: normalized.toolCalls,
        ...observability,
        provider: createProviderInfo(this.profile),
        raw,
      };
    }

    const envelope = parseAssistantEnvelope(normalized.assistantText);
    if (envelope.toolCalls.length > 0) {
      return {
        assistantText: envelope.assistantText,
        toolCalls: envelope.toolCalls,
        ...observability,
        provider: createProviderInfo(this.profile),
        raw,
      };
    }

    if (toolMode === "native") {
      return {
        assistantText: sanitizedText,
        toolCalls: [],
        ...observability,
        provider: createProviderInfo(this.profile),
        raw,
      };
    }

    return {
      assistantText: envelope.assistantText,
      toolCalls: envelope.toolCalls,
      ...observability,
      provider: createProviderInfo(this.profile),
      raw,
    };
  }
}

export class AnthropicMessagesModelClient implements ModelClient {
  public constructor(private readonly profile: ModelProfile) {}

  public async generateTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    const apiKey = resolveProfileApiKey(this.profile);
    if (!apiKey) {
      throw new ModelRequestError(
        formatMissingApiKeyMessage(this.profile),
        undefined,
        this.profile.id,
      );
    }

    const toolMode = this.profile.supportsTools && input.availableTools.length > 0 ? "native" : "json";
    const requestBody = buildAnthropicRequestBody(this.profile, input, toolMode);

    let response: Response;
    try {
      response = await fetch(resolveModelRequestUrl(this.profile), {
        method: "POST",
        headers: buildRequestHeaders(this.profile, apiKey),
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      throw new ModelRequestError(
        error instanceof Error ? error.message : String(error),
        undefined,
        this.profile.id,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw new ModelRequestError(
        `Model request failed (${response.status}): ${body}`,
        response.status,
        this.profile.id,
        parseProviderRetryAfterMs(response.headers),
      );
    }

    const parsed = isEventStreamResponse(response)
      ? await parseAnthropicStreamingResponse(response)
      : {
          payload: (await response.json()) as AnthropicMessagePayload,
          raw: null,
        };

    const normalized = normalizeAnthropicMessage(parsed.payload);
    const sanitizedText = sanitizeAssistantText(normalized.assistantText);
    const raw = parsed.raw ?? parsed.payload;
    const observability = buildResponseObservability(response.headers, normalizeAnthropicUsage(parsed.payload.usage));

    if (normalized.toolCalls.length > 0) {
      return {
        assistantText: sanitizedText,
        toolCalls: normalized.toolCalls,
        ...observability,
        provider: createProviderInfo(this.profile),
        raw,
      };
    }

    const envelope = parseAssistantEnvelope(normalized.assistantText);
    if (envelope.toolCalls.length > 0) {
      return {
        assistantText: envelope.assistantText,
        toolCalls: envelope.toolCalls,
        ...observability,
        provider: createProviderInfo(this.profile),
        raw,
      };
    }

    if (toolMode === "native") {
      return {
        assistantText: sanitizedText,
        toolCalls: [],
        ...observability,
        provider: createProviderInfo(this.profile),
        raw,
      };
    }

    return {
      assistantText: envelope.assistantText,
      toolCalls: envelope.toolCalls,
      ...observability,
      provider: createProviderInfo(this.profile),
      raw,
    };
  }
}

export class FailoverModelClient implements ModelClient {
  private readonly router: ModelRouter;

  public constructor(private readonly profiles: ModelProfile[]) {
    this.router = new ModelRouter(profiles);
  }

  public async generateTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    return this.router.generateTurn(input);
  }
}

interface MutableCredentialHealth {
  readonly id: string;
  readonly source: "env" | "inline";
  readonly apiKeyEnv: string | null;
  leaseCount: number;
  successCount: number;
  failureCount: number;
  cooldownUntil: string | null;
  lastError: string | null;
  lastErrorKind: ModelErrorKind | null;
}

export class CredentialPoolModelClient implements ModelClient {
  private readonly credentials: RequiredCredentialEntry[];
  private readonly health = new Map<string, MutableCredentialHealth>();
  private nextCredentialIndex = 0;

  public constructor(
    private readonly profile: ModelProfile,
    private readonly createClient: (profile: ModelProfile) => ModelClient = createSingleProfileModelClient,
  ) {
    this.credentials = normalizeCredentialEntries(profile);
    for (const credential of this.credentials) {
      this.health.set(credential.id, {
        id: credential.id,
        source: credential.apiKeyEnv ? "env" : "inline",
        apiKeyEnv: credential.apiKeyEnv ?? null,
        leaseCount: 0,
        successCount: 0,
        failureCount: 0,
        cooldownUntil: null,
        lastError: null,
        lastErrorKind: null,
      });
    }
  }

  public getCredentialHealth(): ModelCredentialPoolDiagnostic {
    return buildCredentialPoolDiagnostic(this.profile, Array.from(this.health.values()));
  }

  public async generateTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    const attempts: Array<{
      readonly credentialId: string;
      readonly outcome: "success" | "failed" | "skipped_cooldown";
      readonly errorKind?: ModelErrorKind;
      readonly error?: string;
      readonly cooldownUntil?: string | null;
    }> = [];
    const errors: string[] = [];
    const visited = new Set<string>();

    for (let remaining = 0; remaining < this.credentials.length; remaining += 1) {
      const credential = this.selectCredential(visited);
      visited.add(credential.id);
      const health = this.health.get(credential.id);
      const now = Date.now();
      if (health?.cooldownUntil && Date.parse(health.cooldownUntil) > now) {
        attempts.push({
          credentialId: credential.id,
          outcome: "skipped_cooldown",
          errorKind: health.lastErrorKind ?? undefined,
          error: health.lastError ?? undefined,
          cooldownUntil: health.cooldownUntil,
        });
        continue;
      }

      if (health) {
        health.leaseCount += 1;
      }

      const leasedProfile = createCredentialProfile(this.profile, credential);
      try {
        const result = await this.createClient(leasedProfile).generateTurn(input);
        if (health) {
          health.successCount += 1;
          health.cooldownUntil = null;
        }
        attempts.push({ credentialId: credential.id, outcome: "success" });
        return {
          ...result,
          raw: {
            profileId: this.profile.id,
            credentialPool: {
              attempts,
              health: this.getCredentialHealth(),
            },
            result: sanitizeModelRaw(result.raw, this.profile),
          },
        };
      } catch (error) {
        const kind = classifyModelError(error);
        const message = redactModelProfileSecrets(error instanceof Error ? error.message : String(error), this.profile);
        const retryAfterMs = error instanceof ModelRequestError ? error.retryAfterMs : undefined;
        const cooldownUntil = this.recordCredentialFailure(credential.id, kind, message, retryAfterMs);
        attempts.push({
          credentialId: credential.id,
          outcome: "failed",
          errorKind: kind,
          error: message,
          cooldownUntil,
        });
        errors.push(`${credential.id} [${kind}]: ${message}`);
      }
    }

    throw new Error(`All model credentials failed for profile ${this.profile.id}. ${errors.join(" | ")}`);
  }

  private selectCredential(visited: ReadonlySet<string>): RequiredCredentialEntry {
    const candidates = this.credentials.filter((credential) => !visited.has(credential.id));
    const strategy = this.profile.credentialStrategy ?? "round-robin";
    if (strategy === "least-used") {
      return [...candidates].sort((left, right) => {
        const leftHealth = this.health.get(left.id);
        const rightHealth = this.health.get(right.id);
        return (leftHealth?.leaseCount ?? 0) - (rightHealth?.leaseCount ?? 0);
      })[0]!;
    }

    let credential = candidates[0]!;
    for (let offset = 0; offset < this.credentials.length; offset += 1) {
      const candidate = this.credentials[(this.nextCredentialIndex + offset) % this.credentials.length]!;
      if (!visited.has(candidate.id)) {
        credential = candidate;
        this.nextCredentialIndex = (this.nextCredentialIndex + offset + 1) % this.credentials.length;
        break;
      }
    }
    return credential;
  }

  private recordCredentialFailure(
    credentialId: string,
    kind: ModelErrorKind,
    message: string,
    retryAfterMs?: number,
  ): string | null {
    const health = this.health.get(credentialId);
    if (!health) {
      return null;
    }
    const cooldownMs = retryAfterMs ?? resolveModelCooldownMs(kind, undefined);
    const cooldownUntil = cooldownMs > 0 ? new Date(Date.now() + cooldownMs).toISOString() : null;
    health.failureCount += 1;
    health.lastError = message;
    health.lastErrorKind = kind;
    health.cooldownUntil = cooldownUntil;
    return cooldownUntil;
  }
}

export class ModelRouter implements ModelClient {
  private readonly clients: ModelClient[];
  private readonly health = new Map<string, MutableModelProfileHealth>();
  private lastAttempts: ModelRouterAttempt[] = [];
  private lastRouteDiagnostics: ModelRouteDiagnostic[] = [];

  public constructor(
    private readonly profiles: readonly ModelProfile[],
    private readonly options: ModelRouterOptions = {},
  ) {
    const providerRegistry = options.providerRegistry ?? defaultModelProviderExtensionRegistry;
    this.clients = options.clients ? [...options.clients] : profiles.map((profile) => createProfileModelClient(profile, providerRegistry));
    if (this.clients.length !== profiles.length) {
      throw new Error("ModelRouter clients length must match profiles length.");
    }
    for (const profile of profiles) {
      this.health.set(profile.id, {
        profileId: profile.id,
        successCount: 0,
        failureCount: 0,
        lastSucceededAt: null,
        lastFailedAt: null,
        lastError: null,
        lastErrorKind: null,
        cooldownUntil: null,
      });
    }
  }

  public getHealth(): ModelProfileHealth[] {
    return Array.from(this.health.values()).map((entry) => ({ ...entry }));
  }

  public getLastAttempts(): ModelRouterAttempt[] {
    return [...this.lastAttempts];
  }

  public getLastRouteDiagnostics(): ModelRouteDiagnostic[] {
    return [...this.lastRouteDiagnostics];
  }

  public async generateTurn(input: ModelTurnInput): Promise<ModelTurnResult> {
    const attempts: ModelRouterAttempt[] = [];
    const failures: string[] = [];
    const now = Date.now();
    const retryBudget = Math.max(0, Math.trunc(this.options.retryBudget ?? 0));
    const retryableKinds = new Set<ModelErrorKind>(
      this.options.retryableErrorKinds ?? ["network_error", "server_error", "timeout"],
    );
    const routePlan = this.buildRoute(input);
    this.lastRouteDiagnostics = routePlan.diagnostics;

    for (const route of routePlan.routes) {
      const health = this.health.get(route.profile.id);
      if (health?.cooldownUntil && Date.parse(health.cooldownUntil) > now) {
        attempts.push({
          profileId: route.profile.id,
          profileName: route.profile.name,
          attempt: 1,
          outcome: "skipped_cooldown",
          errorKind: health.lastErrorKind ?? undefined,
          error: health.lastError ?? undefined,
          cooldownUntil: health.cooldownUntil,
        });
        continue;
      }

      for (let attempt = 1; attempt <= retryBudget + 1; attempt += 1) {
        try {
          const result = await route.client.generateTurn(input);
          this.recordSuccess(route.profile.id);
          attempts.push({
            profileId: route.profile.id,
            profileName: route.profile.name,
            attempt,
            outcome: "success",
          });
          this.lastAttempts = attempts;
          return {
            ...result,
            provider: result.provider ?? createProviderInfo(route.profile),
            raw: {
              profileId: route.profile.id,
              profileName: route.profile.name,
              modelRouter: {
                attempts,
                health: this.getHealth(),
                routeDiagnostics: routePlan.diagnostics,
              },
              result: sanitizeModelRaw(result.raw, route.profile),
            },
          };
        } catch (error) {
          const kind = classifyModelError(error);
          const message = redactModelProfileSecrets(error instanceof Error ? error.message : String(error), route.profile);
          const willRetry = attempt <= retryBudget && retryableKinds.has(kind);
          const retryAfterMs = error instanceof ModelRequestError ? error.retryAfterMs : undefined;
          const cooldownUntil = willRetry ? null : this.recordFailure(route.profile.id, kind, message, retryAfterMs);
          attempts.push({
            profileId: route.profile.id,
            profileName: route.profile.name,
            attempt,
            outcome: "failed",
            errorKind: kind,
            error: message,
            cooldownUntil,
            ...(willRetry ? { willRetry } : {}),
          });
          failures.push(`${route.profile.id}#${attempt} [${kind}]: ${message}`);
          if (!willRetry) {
            break;
          }
        }
      }
    }

    this.lastAttempts = attempts;
    throw new Error(`All model profiles failed. ${failures.join(" | ")}`);
  }

  private buildRoute(input: ModelTurnInput): {
    readonly routes: Array<{ readonly profile: ModelProfile; readonly client: ModelClient }>;
    readonly diagnostics: ModelRouteDiagnostic[];
  } {
    const allowlist = new Set((this.options.allowlist ?? []).map((entry) => entry.trim()).filter(Boolean));
    const roleOverride = this.options.roleProfileOverrides?.[input.taskContract.agentRole ?? "primary"];
    const normalizedRoleOverride = roleOverride?.toLowerCase();
    const requiresTools = input.availableTools.length > 0;
    const estimatedInputTokens = estimateModelInputTokens(input);
    const candidates = this.profiles.map((profile, index) => {
      const health = this.health.get(profile.id);
      const maxInputTokens = profile.maxInputTokens ?? null;
      const allowlisted =
        allowlist.size === 0 ||
        allowlist.has(profile.id) ||
        allowlist.has(profile.name) ||
        allowlist.has(profile.model);
      const hasToolMismatch = requiresTools && !profile.supportsTools;
      const hasContextMismatch = typeof maxInputTokens === "number" && estimatedInputTokens > maxInputTokens;
      const cooldownUntil = health?.cooldownUntil ?? null;
      const coolingDown = cooldownUntil !== null && Date.parse(cooldownUntil) > Date.now();
      const routeEligible = allowlisted && !hasToolMismatch && !hasContextMismatch;
      const eligible = routeEligible && !coolingDown;
      const reasons = [
        allowlisted ? "allowlist matched" : "excluded by allowlist",
        requiresTools
          ? profile.supportsTools
            ? "supports required tools"
            : "excluded because tools are required"
          : "tools not required",
        typeof maxInputTokens === "number"
          ? estimatedInputTokens <= maxInputTokens
            ? `context fits ${estimatedInputTokens}/${maxInputTokens}`
            : `excluded because context exceeds ${estimatedInputTokens}/${maxInputTokens}`
          : `no context budget; estimated ${estimatedInputTokens}`,
        cooldownUntil ? `cooldown until ${cooldownUntil}` : "not cooling down",
        `cost ${normalizeModelCostHint(profile.costHint)}`,
      ];
      return {
        profile,
        client: this.clients[index]!,
        index,
        eligible,
        routeEligible,
        roleRank: normalizedRoleOverride && matchesModelProfile(profile, normalizedRoleOverride) ? 0 : 1,
        costRank: normalizeModelCostRank(profile.costHint),
        decisionReason: reasons.join("; "),
        health,
        maxInputTokens,
      };
    });
    const routes = candidates
      .filter((entry) => entry.routeEligible)
      .sort((left, right) => left.roleRank - right.roleRank || left.costRank - right.costRank || left.index - right.index);
    const selectableRoutes = routes.filter((entry) => entry.eligible);
    const selectedOrderByProfileId = new Map(selectableRoutes.map((entry, index) => [entry.profile.id, index + 1]));
    const diagnostics = candidates.map((entry) => ({
      profileId: entry.profile.id,
      profileName: entry.profile.name,
      eligible: entry.eligible,
      selectedOrder: selectedOrderByProfileId.get(entry.profile.id) ?? null,
      decisionReason: entry.decisionReason,
      requiresTools,
      supportsTools: entry.profile.supportsTools,
      estimatedInputTokens,
      maxInputTokens: entry.maxInputTokens,
      costRank: entry.costRank,
      health: {
        successCount: entry.health?.successCount ?? 0,
        failureCount: entry.health?.failureCount ?? 0,
        lastErrorKind: entry.health?.lastErrorKind ?? null,
        cooldownUntil: entry.health?.cooldownUntil ?? null,
      },
    }));

    return {
      routes: routes.map((entry) => ({ profile: entry.profile, client: entry.client })),
      diagnostics,
    };
  }

  private recordSuccess(profileId: string): void {
    const current = this.health.get(profileId);
    if (!current) {
      return;
    }
    this.health.set(profileId, {
      ...current,
      successCount: current.successCount + 1,
      lastSucceededAt: new Date().toISOString(),
      cooldownUntil: null,
    });
  }

  private recordFailure(profileId: string, kind: ModelErrorKind, message: string, retryAfterMs?: number): string | null {
    const current = this.health.get(profileId);
    if (!current) {
      return null;
    }
    const cooldownMs = retryAfterMs ?? resolveModelCooldownMs(kind, this.options.cooldownMs);
    const cooldownUntil = cooldownMs > 0 ? new Date(Date.now() + cooldownMs).toISOString() : null;
    this.health.set(profileId, {
      profileId,
      successCount: current.successCount,
      failureCount: current.failureCount + 1,
      lastSucceededAt: current.lastSucceededAt,
      lastFailedAt: new Date().toISOString(),
      lastError: message,
      lastErrorKind: kind,
      cooldownUntil,
    });
    return cooldownUntil;
  }
}

export function loadModelProfileFromEnv(): ModelProfile {
  const headers = parseObjectEnv(process.env.OMNI_AGENT_MODEL_HEADERS_JSON);
  const requestBody = parseObjectEnv(process.env.OMNI_AGENT_MODEL_BODY_JSON);
  const credentials = parseCredentialEnv(process.env.OMNI_AGENT_MODEL_CREDENTIALS_JSON);
  const protocol = normalizeModelProtocol(process.env.OMNI_AGENT_MODEL_PROTOCOL);
  const profileName =
    protocol === "anthropic"
      ? "default-anthropic-messages"
      : protocol === "responses"
        ? "default-openai-responses"
        : "default-openai-compatible";
  return {
    id: profileName,
    name: profileName,
    protocol,
    baseUrl: process.env.OMNI_AGENT_BASE_URL ?? "https://api.openai.com/v1",
    apiPath: normalizeApiPath(process.env.OMNI_AGENT_MODEL_API_PATH),
    apiKeyEnv: process.env.OMNI_AGENT_API_KEY_ENV ?? "OMNI_AGENT_API_KEY",
    model: process.env.OMNI_AGENT_MODEL ?? "gpt-4.1-mini",
    supportsTools: process.env.OMNI_AGENT_SUPPORTS_TOOLS !== "false",
    supportsStreaming: process.env.OMNI_AGENT_SUPPORTS_STREAMING === "true",
    ...(normalizePositiveInteger(process.env.OMNI_AGENT_MODEL_MAX_INPUT_TOKENS)
      ? { maxInputTokens: normalizePositiveInteger(process.env.OMNI_AGENT_MODEL_MAX_INPUT_TOKENS) }
      : {}),
    ...(normalizeModelCostHint(process.env.OMNI_AGENT_MODEL_COST_HINT) !== "medium"
      ? { costHint: normalizeModelCostHint(process.env.OMNI_AGENT_MODEL_COST_HINT) }
      : {}),
    ...(Object.keys(headers).length > 0 ? { headers: toStringRecord(headers) } : {}),
    ...(Object.keys(requestBody).length > 0 ? { requestBody } : {}),
    ...(credentials.length > 0 ? { credentials } : {}),
    ...(normalizeProviderExtensionId(process.env.OMNI_AGENT_MODEL_PROVIDER_EXTENSION_ID)
      ? { providerExtensionId: normalizeProviderExtensionId(process.env.OMNI_AGENT_MODEL_PROVIDER_EXTENSION_ID) }
      : {}),
    ...(normalizeCredentialStrategy(process.env.OMNI_AGENT_CREDENTIAL_STRATEGY)
      ? { credentialStrategy: normalizeCredentialStrategy(process.env.OMNI_AGENT_CREDENTIAL_STRATEGY) }
      : {}),
  };
}

export function loadModelProfilesFromEnv(): ModelProfile[] {
  return inspectModelProfilesFromEnv().profiles;
}

export function inspectModelProfilesFromEnv(): ModelProfileSelectionReport {
  return inspectModelProfilesFromJson(process.env.OMNI_AGENT_MODEL_PROFILES_JSON);
}

export function loadModelProfilesFromJson(rawProfilesJson?: string | null): ModelProfile[] {
  return inspectModelProfilesFromJson(rawProfilesJson).profiles;
}

export function inspectModelProfilesFromJson(rawProfilesJson?: string | null): ModelProfileSelectionReport {
  const rawProfiles = rawProfilesJson?.trim();
  if (!rawProfiles) {
    return {
      profiles: [loadModelProfileFromEnv()],
      source: "default",
      issues: [],
    };
  }

  try {
    const parsed = JSON.parse(rawProfiles) as unknown;
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const issues: ModelProfileSelectionIssue[] = [];
    const profiles = entries
      .map((entry, index) => {
        const profile = normalizeModelProfile(entry, index);
        if (profile) {
          return profile;
        }
        issues.push({
          level: "warning",
          message: `Ignored invalid model profile at index ${index}. Expected baseUrl, model, and apiKeyEnv or credentials.`,
        });
        return null;
      })
      .filter((entry): entry is ModelProfile => entry !== null);
    if (profiles.length > 0) {
      return {
        profiles,
        source: "json",
        issues,
      };
    }
    return {
      profiles: [loadModelProfileFromEnv()],
      source: "default",
      issues: [
        ...issues,
        {
          level: "error",
          message: "OMNI_AGENT_MODEL_PROFILES_JSON did not contain any valid profiles. Falling back to the default profile.",
        },
      ],
    };
  } catch (error) {
    return {
      profiles: [loadModelProfileFromEnv()],
      source: "default",
      issues: [
        {
          level: "error",
          message: `OMNI_AGENT_MODEL_PROFILES_JSON is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

export function selectModelProfiles(
  profiles: readonly ModelProfile[],
  selector?: string,
): ModelProfile[] {
  if (!selector) {
    return [...profiles];
  }

  const normalizedSelector = selector.trim().toLowerCase();
  if (!normalizedSelector || normalizedSelector === "auto") {
    return [...profiles];
  }

  const selected = profiles.find((profile) => matchesModelProfile(profile, normalizedSelector));
  if (!selected) {
    const available = profiles.map((profile) => profile.id).join(", ") || "none";
    throw new Error(`Unknown model profile "${selector}". Available profiles: ${available}`);
  }

  return [selected];
}

export function listModelPricingSnapshot(): readonly ModelTokenPricing[] {
  return MODEL_PRICING_SNAPSHOT.map((entry) => ({ ...entry }));
}

export function estimateModelUsageCost(
  model: string,
  usage: ModelTurnUsage,
  pricingOverrides: readonly ModelTokenPricing[] = [],
): ModelUsageCostEstimate {
  const normalizedModel = normalizeModelPricingKey(model);
  const pricing = resolveModelPricing(model, pricingOverrides);
  const inputTokens = normalizeUsageTokenCount(usage.inputTokens);
  const outputTokens = normalizeUsageTokenCount(usage.outputTokens);
  const cachedInputTokens = normalizeUsageTokenCount(usage.cachedInputTokens ?? usage.cacheReadInputTokens);
  const cacheCreationInputTokens = normalizeUsageTokenCount(usage.cacheCreationInputTokens);
  if (!pricing) {
    return {
      status: "unknown",
      model: normalizedModel || model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      estimatedCostUsd: null,
      summary: `No pricing snapshot is configured for model ${model}.`,
    };
  }
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens - cacheCreationInputTokens);
  const inputCost = (billableInputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const cachedInputCost = (cachedInputTokens / 1_000_000) *
    (pricing.cachedInputUsdPerMillion ?? pricing.inputUsdPerMillion);
  const cacheCreationCost = (cacheCreationInputTokens / 1_000_000) *
    (pricing.cacheWriteUsdPerMillion ?? pricing.inputUsdPerMillion);
  const outputCost = (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  const estimatedCostUsd = inputCost + cachedInputCost + cacheCreationCost + outputCost;
  return {
    status: "estimated",
    model: pricing.model,
    source: pricing.source,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    estimatedCostUsd,
    summary: `${pricing.model} estimated from ${pricing.source}.`,
  };
}

export function resolveModelPricing(
  model: string,
  pricingOverrides: readonly ModelTokenPricing[] = [],
): ModelTokenPricing | null {
  const normalizedModel = normalizeModelPricingKey(model);
  if (!normalizedModel) {
    return null;
  }
  const matches = [...pricingOverrides, ...MODEL_PRICING_SNAPSHOT].filter((entry) => {
    const entryKey = normalizeModelPricingKey(entry.model);
    return normalizedModel === entryKey || normalizedModel.startsWith(`${entryKey}-`);
  });
  return matches.sort((left, right) =>
    normalizeModelPricingKey(right.model).length - normalizeModelPricingKey(left.model).length,
  )[0] ?? null;
}

interface RequiredCredentialEntry {
  readonly id: string;
  readonly apiKeyEnv?: string;
  readonly apiKey?: string;
}

function normalizeCredentialEntries(profile: ModelProfile): RequiredCredentialEntry[] {
  const entries = (profile.credentials ?? [])
    .map((credential, index) => {
      const apiKeyEnv = credential.apiKeyEnv?.trim();
      const apiKey = credential.apiKey?.trim();
      if (!apiKeyEnv && !apiKey) {
        return null;
      }
      return {
        id: credential.id?.trim() || apiKeyEnv || `credential-${index + 1}`,
        ...(apiKeyEnv ? { apiKeyEnv } : {}),
        ...(apiKey ? { apiKey } : {}),
      };
    })
    .filter((entry): entry is RequiredCredentialEntry => entry !== null);

  if (entries.length > 0) {
    return entries;
  }

  return [
    {
      id: profile.apiKeyEnv,
      apiKeyEnv: profile.apiKeyEnv,
    },
  ];
}

function createCredentialProfile(profile: ModelProfile, credential: RequiredCredentialEntry): ModelProfile {
  return {
    ...profile,
    apiKeyEnv: credential.apiKeyEnv ?? profile.apiKeyEnv,
    credentials: [credential],
  };
}

function resolveProfileApiKey(profile: ModelProfile): string | null {
  const credential = normalizeCredentialEntries(profile)[0];
  if (credential?.apiKey) {
    return credential.apiKey;
  }
  const raw = process.env[credential?.apiKeyEnv ?? profile.apiKeyEnv];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

function buildCredentialPoolDiagnostic(
  profile: ModelProfile,
  runtimeHealth: readonly MutableCredentialHealth[] = [],
): ModelCredentialPoolDiagnostic {
  const healthById = new Map(runtimeHealth.map((entry) => [entry.id, entry]));
  const entries = normalizeCredentialEntries(profile).map((credential) => {
    const health = healthById.get(credential.id);
    const configured = credential.apiKey ? credential.apiKey.trim().length > 0 : hasEnvApiKey(credential.apiKeyEnv);
    const cooldownUntil = health?.cooldownUntil ?? null;
    return {
      id: credential.id,
      source: credential.apiKeyEnv ? "env" as const : "inline" as const,
      apiKeyEnv: credential.apiKeyEnv ?? null,
      configured,
      redacted: configured ? "[configured]" : "[missing]",
      leaseCount: health?.leaseCount ?? 0,
      successCount: health?.successCount ?? 0,
      failureCount: health?.failureCount ?? 0,
      cooldownUntil,
    };
  });
  return {
    strategy: profile.credentialStrategy ?? "round-robin",
    credentialCount: entries.length,
    configuredCount: entries.filter((entry) => entry.configured).length,
    healthyCount: entries.filter((entry) => entry.configured && !entry.cooldownUntil).length,
    cooldownCount: entries.filter((entry) => entry.cooldownUntil).length,
    leasedCount: entries.filter((entry) => entry.leaseCount > 0).length,
    entries,
  };
}

function hasEnvApiKey(apiKeyEnv: string | undefined): boolean {
  if (!apiKeyEnv) {
    return false;
  }
  const raw = process.env[apiKeyEnv];
  return typeof raw === "string" && raw.trim().length > 0;
}

function formatMissingApiKeyMessage(profile: ModelProfile): string {
  const credentialNames = normalizeCredentialEntries(profile)
    .map((credential) => credential.apiKeyEnv)
    .filter((value): value is string => Boolean(value));
  if (credentialNames.length > 0) {
    return `Missing API key in environment variable ${credentialNames.join(", ")} for model profile ${profile.id}`;
  }
  return `Missing API key for model profile ${profile.id}`;
}

export function hasModelProfileApiKey(profile: ModelProfile): boolean {
  return resolveProfileApiKey(profile) !== null;
}

export function buildModelProfileDiagnostics(
  report: ModelProfileSelectionReport = inspectModelProfilesFromEnv(),
  providerRegistry: ModelProviderExtensionRegistry = defaultModelProviderExtensionRegistry,
): ModelProfileDiagnosticsReport {
  const profileDiagnostics = report.profiles.map((profile) => {
    const issues: ModelProfileSelectionIssue[] = [];
    const credentialPool = buildCredentialPoolDiagnostic(profile);
    if (credentialPool.configuredCount === 0) {
      const credentialNames = credentialPool.entries
        .map((entry) => entry.apiKeyEnv ?? entry.id)
        .join(", ");
      issues.push({
        level: "warning",
        message: `No configured credential for model profile ${profile.id}${credentialNames ? ` (${credentialNames})` : ""}.`,
      });
    }
    if (!profile.supportsTools) {
      issues.push({
        level: "warning",
        message: "Profile does not advertise tool-call support.",
      });
    }
    return {
      id: profile.id,
      name: profile.name,
      protocol: profile.protocol,
      providerExtensionId: profile.providerExtensionId ?? null,
      providerExtensionConfigured: providerRegistry.has(profile),
      model: profile.model,
      baseUrl: redactDiagnosticBaseUrl(profile.baseUrl),
      apiPath: profile.apiPath ?? null,
      apiKeyEnv: profile.apiKeyEnv,
      apiKeyConfigured: hasModelProfileApiKey(profile),
      supportsTools: profile.supportsTools,
      supportsStreaming: profile.supportsStreaming,
      headers: redactHeaderRecord(profile.headers ?? {}),
      requestBodyKeys: Object.keys(profile.requestBody ?? {}).sort(),
      credentialPool,
      issues,
    };
  });
  return {
    source: report.source,
    profileCount: profileDiagnostics.length,
    configuredKeyCount: profileDiagnostics.filter((profile) => profile.apiKeyConfigured).length,
    toolCapableCount: profileDiagnostics.filter((profile) => profile.supportsTools).length,
    streamingCapableCount: profileDiagnostics.filter((profile) => profile.supportsStreaming).length,
    profiles: profileDiagnostics,
    issues: report.issues,
  };
}

function resolveModelRequestUrl(profile: ModelProfile): string {
  const normalizedPath =
    normalizeApiPath(profile.apiPath) ??
    (profile.protocol === "anthropic" ? "v1/messages" : profile.protocol === "responses" ? "responses" : "chat/completions");
  const normalizedBase = profile.baseUrl.endsWith("/") ? profile.baseUrl : `${profile.baseUrl}/`;
  return new URL(normalizedPath, normalizedBase).toString();
}

function buildRequestHeaders(profile: ModelProfile, apiKey: string): Record<string, string> {
  if (profile.protocol === "anthropic") {
    const headers = normalizeHeaderRecord(profile.headers);
    upsertHeader(headers, "Content-Type", "application/json");
    upsertHeader(headers, "anthropic-version", "2023-06-01");

    const anthropicBetaHeader = buildAnthropicBetaHeader(profile.baseUrl, apiKey);
    if (anthropicBetaHeader && !hasHeader(headers, "anthropic-beta")) {
      upsertHeader(headers, "anthropic-beta", anthropicBetaHeader);
    }

    if (requiresBearerAuthForAnthropicEndpoint(profile.baseUrl)) {
      deleteHeader(headers, "x-api-key");
      upsertHeader(headers, "Authorization", `Bearer ${apiKey}`);
    } else if (isDirectAnthropicEndpoint(profile.baseUrl) && isAnthropicOauthToken(apiKey)) {
      deleteHeader(headers, "x-api-key");
      upsertHeader(headers, "Authorization", `Bearer ${apiKey}`);
      if (!hasHeader(headers, "user-agent")) {
        upsertHeader(headers, "user-agent", `claude-cli/${CLAUDE_CODE_VERSION_FALLBACK} (external, cli)`);
      }
      if (!hasHeader(headers, "x-app")) {
        upsertHeader(headers, "x-app", "cli");
      }
    } else {
      deleteHeader(headers, "Authorization");
      upsertHeader(headers, "x-api-key", apiKey);
    }

    return headers;
  }

  return {
    ...normalizeHeaderRecord(profile.headers),
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function normalizeModelProfile(entry: unknown, index: number): ModelProfile | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const record = entry as Record<string, unknown>;
  const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";
  const apiKeyEnv = typeof record.apiKeyEnv === "string" ? record.apiKeyEnv.trim() : "";
  const model = typeof record.model === "string" ? record.model.trim() : "";
  const credentials = normalizeCredentialConfig(record.credentials);
  if (!baseUrl || (!apiKeyEnv && credentials.length === 0) || !model) {
    return null;
  }

  const id = typeof record.id === "string" && record.id.trim().length > 0
    ? record.id.trim()
    : `profile-${index + 1}`;
  const name = typeof record.name === "string" && record.name.trim().length > 0
    ? record.name.trim()
    : id;
  const headers = toStringRecord(normalizeObjectRecord(record.headers));
  const requestBody = normalizeObjectRecord(record.requestBody);
  const credentialStrategy = normalizeCredentialStrategy(record.credentialStrategy);
  return {
    id,
    name,
    protocol: normalizeModelProtocol(record.protocol),
    ...(normalizeProviderExtensionId(record.providerExtensionId)
      ? { providerExtensionId: normalizeProviderExtensionId(record.providerExtensionId) }
      : {}),
    baseUrl,
    apiPath: normalizeApiPath(typeof record.apiPath === "string" ? record.apiPath : undefined),
    apiKeyEnv: apiKeyEnv || credentials[0]?.apiKeyEnv || "OMNI_AGENT_API_KEY",
    model,
    supportsTools: record.supportsTools !== false,
    supportsStreaming: record.supportsStreaming === true,
    ...(normalizePositiveInteger(record.maxInputTokens) ? { maxInputTokens: normalizePositiveInteger(record.maxInputTokens) } : {}),
    ...(normalizeModelCostHint(record.costHint) !== "medium" ? { costHint: normalizeModelCostHint(record.costHint) } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(Object.keys(requestBody).length > 0 ? { requestBody } : {}),
    ...(credentials.length > 0 ? { credentials } : {}),
    ...(credentialStrategy ? { credentialStrategy } : {}),
  };
}

function matchesModelProfile(profile: ModelProfile, normalizedSelector: string): boolean {
  return (
    profile.id.toLowerCase() === normalizedSelector ||
    profile.name.toLowerCase() === normalizedSelector ||
    profile.model.toLowerCase() === normalizedSelector
  );
}

function buildPromptEnvelope(input: ModelTurnInput): string {
  const roleContract = getAgentRoleContract(input.taskContract.agentRole ?? "primary");
  return JSON.stringify(
    {
      objective: input.taskContract.objective,
      agentRole: input.taskContract.agentRole ?? "primary",
      roleContract: {
        responseKind: roleContract.responseKind,
        canEditFiles: roleContract.canEditFiles,
        maxToolCallsPerTurn: roleContract.maxToolCallsPerTurn,
        responseInstructions: roleContract.responseInstructions,
      },
      successCriteria: input.taskContract.successCriteria,
      constraints: input.taskContract.constraints,
      context: {
        repoSummary: input.context.repoSummary,
        threadSummary: input.context.threadSummary,
        workspaceSnapshot: input.context.workspaceSnapshot,
      },
      availableTools: input.availableTools,
      toolResults: input.toolResults,
    },
    null,
    2,
  );
}

function buildRequestBody(
  profile: ModelProfile,
  input: ModelTurnInput,
  toolMode: "native" | "json",
): Record<string, unknown> {
  const requestBodyOverrides = normalizeObjectRecord(profile.requestBody);
  const roleContract = getAgentRoleContract(input.taskContract.agentRole ?? "primary");
  const baseMessages = [
    {
      role: "system",
      content: input.context.systemPrompt,
    },
  ];

  if (toolMode === "native") {
    return {
      temperature: 0.1,
      ...requestBodyOverrides,
      model: profile.model,
      messages: [
        ...baseMessages,
        {
          role: "system",
          content: [
            "You are a coding agent runtime.",
            "Use available tools when additional repository evidence is needed.",
            `Use at most ${roleContract.maxToolCallsPerTurn} tool calls per turn.`,
            "Prefer read-only inspection before edits.",
            "Use list_directory and read_file for workspace inspection; avoid shelling out to ls or dir for simple directory listings.",
            "Do not put command flags such as /b or -la in the cwd field; cwd must be a workspace directory path.",
            "Prefer search_text to locate code before reading large files.",
            "Prefer edit_file for exact small replacements; use replace_file_range only for narrow, verified line ranges.",
            "Use append_file to build long documents in sections instead of trying to emit an oversized write_file call.",
            "Keep each write_file or append_file content payload small, preferably under 2000 characters; continue over multiple turns for long artifacts.",
            "Generated scripts must be cross-platform: prefer Node fs/path APIs over shelling out to rm, mv, cp, sed, grep, zip, or Unix-only commands.",
            "Generated or edited source code should stay ASCII unless the existing file already uses non-ASCII content for a clear reason.",
            "When inspecting Office files, treat .docx/.pptx/.xlsx as ZIP containers; on Windows copy them to a temporary .zip before Expand-Archive.",
            "When the objective requires repository changes, apply them with tools; do not return a prose-only patch suggestion.",
            "Use read_file line ranges for large files when possible.",
            "Follow the role-specific response contract in the prompt envelope.",
            "After verification passes, immediately stop tool use and finish with the verification result.",
            "When the task is complete, stop calling tools and provide a concise summary with changed files and verification notes.",
          ].join("\n"),
        },
        {
          role: "user",
          content: buildPromptEnvelope(input),
        },
      ],
      tools: buildOpenAiTools(input.availableTools),
      tool_choice: "auto",
      ...(profile.supportsStreaming ? { stream: true } : {}),
    };
  }

  return {
    temperature: 0.1,
    ...requestBodyOverrides,
    model: profile.model,
    messages: [
      ...baseMessages,
      {
        role: "system",
        content: [
          "You are a coding agent runtime.",
          "Respond with JSON only.",
          'JSON shape: {"assistantText": string, "toolCalls": [{"toolName": string, "args": object}]}',
          "Only request tools that exist in the tool list.",
          `Use at most ${roleContract.maxToolCallsPerTurn} tool calls per turn.`,
          "Prefer read-only inspection before edits.",
          "Use list_directory and read_file for workspace inspection; avoid shelling out to ls or dir for simple directory listings.",
          "Do not put command flags such as /b or -la in the cwd field; cwd must be a workspace directory path.",
          "Prefer search_text to locate code before reading large files.",
          "Prefer edit_file for exact small replacements; use replace_file_range only for narrow, verified line ranges.",
          "Use append_file to build long documents in sections instead of trying to emit an oversized write_file call.",
          "Keep each write_file or append_file content payload small, preferably under 2000 characters; continue over multiple turns for long artifacts.",
          "Generated scripts must be cross-platform: prefer Node fs/path APIs over shelling out to rm, mv, cp, sed, grep, zip, or Unix-only commands.",
          "Generated or edited source code should stay ASCII unless the existing file already uses non-ASCII content for a clear reason.",
          "When inspecting Office files, treat .docx/.pptx/.xlsx as ZIP containers; on Windows copy them to a temporary .zip before Expand-Archive.",
          "When the objective requires repository changes, apply them with tools; do not return a prose-only patch suggestion.",
          "Use read_file line ranges for large files when possible.",
          "Follow the role-specific response contract in the prompt envelope.",
          "After verification passes, immediately stop tool use and finish with the verification result.",
          "If enough evidence exists, return no toolCalls and provide a concise assistantText summary with changed files and verification notes.",
        ].join("\n"),
      },
      {
        role: "user",
        content: buildPromptEnvelope(input),
      },
    ],
    ...(profile.supportsStreaming ? { stream: true } : {}),
  };
}

function buildResponsesRequestBody(
  profile: ModelProfile,
  input: ModelTurnInput,
  toolMode: "native" | "json",
): Record<string, unknown> {
  const requestBodyOverrides = normalizeObjectRecord(profile.requestBody);
  const roleContract = getAgentRoleContract(input.taskContract.agentRole ?? "primary");
  const instructions = [
    input.context.systemPrompt,
    [
      "You are a coding agent runtime.",
      toolMode === "native" ? "Use available tools when additional repository evidence is needed." : "Respond with JSON only.",
      toolMode === "native"
        ? null
        : 'JSON shape: {"assistantText": string, "toolCalls": [{"toolName": string, "args": object}]}',
      `Use at most ${roleContract.maxToolCallsPerTurn} tool calls per turn.`,
      "Prefer read-only inspection before edits.",
      "Use list_directory and read_file for workspace inspection; avoid shelling out to ls or dir for simple directory listings.",
      "Prefer search_text to locate code before reading large files.",
      "Prefer edit_file for exact small replacements; use replace_file_range only for narrow, verified line ranges.",
      "When the objective requires repository changes, apply them with tools; do not return a prose-only patch suggestion.",
      "Follow the role-specific response contract in the prompt envelope.",
      "After verification passes, immediately stop tool use and finish with the verification result.",
      "When the task is complete, stop calling tools and provide a concise summary with changed files and verification notes.",
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join("\n"),
  ].join("\n\n");

  return {
    temperature: 0.1,
    ...requestBodyOverrides,
    model: profile.model,
    instructions,
    input: [
      {
        role: "user",
        content: buildPromptEnvelope(input),
      },
    ],
    ...(toolMode === "native"
      ? {
          tools: buildOpenAiResponsesTools(input.availableTools),
          tool_choice: "auto",
        }
      : {}),
    ...(profile.supportsStreaming ? { stream: true } : {}),
  };
}

function buildAnthropicRequestBody(
  profile: ModelProfile,
  input: ModelTurnInput,
  toolMode: "native" | "json",
): Record<string, unknown> {
  const requestBodyOverrides = normalizeObjectRecord(profile.requestBody);
  const roleContract = getAgentRoleContract(input.taskContract.agentRole ?? "primary");
  const hasExplicitMaxTokens = Object.prototype.hasOwnProperty.call(requestBodyOverrides, "max_tokens");
  const maxTokens = hasExplicitMaxTokens
    ? resolveAnthropicMaxTokens(requestBodyOverrides.max_tokens, profile.model)
    : resolveAnthropicMaxTokens(undefined, profile.model);
  const { max_tokens: _ignoredMaxTokens, ...restRequestBodyOverrides } = requestBodyOverrides;
  const systemSections = [input.context.systemPrompt];

  if (toolMode === "native") {
    systemSections.push(
      [
        "You are a coding agent runtime.",
        "Use available tools when additional repository evidence is needed.",
        `Use at most ${roleContract.maxToolCallsPerTurn} tool calls per turn.`,
        "Prefer read-only inspection before edits.",
        "Use list_directory and read_file for workspace inspection; avoid shelling out to ls or dir for simple directory listings.",
        "Do not put command flags such as /b or -la in the cwd field; cwd must be a workspace directory path.",
        "Prefer search_text to locate code before reading large files.",
        "Prefer edit_file for exact small replacements; use replace_file_range only for narrow, verified line ranges.",
        "Use append_file to build long documents in sections instead of trying to emit an oversized write_file call.",
        "Keep each write_file or append_file content payload small, preferably under 2000 characters; continue over multiple turns for long artifacts.",
        "Generated scripts must be cross-platform: prefer Node fs/path APIs over shelling out to rm, mv, cp, sed, grep, zip, or Unix-only commands.",
        "Generated or edited source code should stay ASCII unless the existing file already uses non-ASCII content for a clear reason.",
        "When inspecting Office files, treat .docx/.pptx/.xlsx as ZIP containers; on Windows copy them to a temporary .zip before Expand-Archive.",
        "When the objective requires repository changes, apply them with tools; do not return a prose-only patch suggestion.",
        "Use read_file line ranges for large files when possible.",
        "Follow the role-specific response contract in the prompt envelope.",
        "After verification passes, immediately stop tool use and finish with the verification result.",
        "When the task is complete, stop calling tools and provide a concise summary with changed files and verification notes.",
      ].join("\n"),
    );
  } else {
    systemSections.push(
      [
        "You are a coding agent runtime.",
        "Respond with JSON only.",
        'JSON shape: {"assistantText": string, "toolCalls": [{"toolName": string, "args": object}]}',
        "Only request tools that exist in the tool list.",
        `Use at most ${roleContract.maxToolCallsPerTurn} tool calls per turn.`,
        "Prefer read-only inspection before edits.",
        "Use list_directory and read_file for workspace inspection; avoid shelling out to ls or dir for simple directory listings.",
        "Do not put command flags such as /b or -la in the cwd field; cwd must be a workspace directory path.",
        "Prefer search_text to locate code before reading large files.",
        "Prefer edit_file for exact small replacements; use replace_file_range only for narrow, verified line ranges.",
        "Use append_file to build long documents in sections instead of trying to emit an oversized write_file call.",
        "Keep each write_file or append_file content payload small, preferably under 2000 characters; continue over multiple turns for long artifacts.",
        "Generated scripts must be cross-platform: prefer Node fs/path APIs over shelling out to rm, mv, cp, sed, grep, zip, or Unix-only commands.",
        "Generated or edited source code should stay ASCII unless the existing file already uses non-ASCII content for a clear reason.",
        "When inspecting Office files, treat .docx/.pptx/.xlsx as ZIP containers; on Windows copy them to a temporary .zip before Expand-Archive.",
        "When the objective requires repository changes, apply them with tools; do not return a prose-only patch suggestion.",
        "Use read_file line ranges for large files when possible.",
        "Follow the role-specific response contract in the prompt envelope.",
        "After verification passes, immediately stop tool use and finish with the verification result.",
        "If enough evidence exists, return no toolCalls and provide a concise assistantText summary with changed files and verification notes.",
      ].join("\n"),
    );
  }

  return {
    max_tokens: maxTokens,
    temperature: 0.1,
    ...restRequestBodyOverrides,
    model: profile.model,
    system: systemSections.join("\n\n"),
    messages: [
      {
        role: "user",
        content: buildPromptEnvelope(input),
      },
    ],
    ...(toolMode === "native"
      ? {
          tools: buildAnthropicTools(input.availableTools),
          tool_choice: { type: "auto" },
        }
      : {}),
    ...(profile.supportsStreaming ? { stream: true } : {}),
  };
}

function extractTextFromMessage(content: string | ChatCompletionContentPart[] | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => item.text ?? "").join("\n");
  }

  return "";
}

function normalizeOpenAiResponsesPayload(payload: OpenAiResponsesPayload): ParsedAssistantEnvelope {
  const textParts: string[] = [];
  const toolCalls: ModelToolCall[] = [];

  for (const item of payload.output ?? []) {
    if (item.type === "function_call" && item.name) {
      toolCalls.push({
        id: item.call_id ?? item.id ?? randomUUID(),
        toolName: item.name,
        args: parseFunctionArguments(item.arguments),
      });
      continue;
    }
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if ((part.type === "output_text" || part.type === "text" || !part.type) && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
    }
  }

  if (textParts.length === 0 && typeof payload.output_text === "string") {
    textParts.push(payload.output_text);
  }
  return {
    assistantText: textParts.join("\n"),
    toolCalls,
  };
}

async function parseOpenAiResponsesStreamingResponse(response: Response): Promise<{
  readonly payload: OpenAiResponsesPayload;
  readonly raw: {
    readonly streaming: true;
    readonly protocol: "responses";
    readonly events: unknown[];
  };
}> {
  const body = response.body;
  if (!body) {
    return {
      payload: {},
      raw: {
        streaming: true,
        protocol: "responses",
        events: [],
      },
    };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: unknown[] = [];
  const textParts: string[] = [];
  const toolCalls = new Map<string, { id: string; toolName: string; argsParts: string[]; doneArguments?: string; generatedId?: boolean }>();
  const outputIndexToToolKey = new Map<number, string>();
  let completedPayload: OpenAiResponsesPayload | undefined;
  let usage: Record<string, unknown> | undefined;
  let buffer = "";

  const getEventIndex = (record: Record<string, unknown>): number | null => {
    const value = record.output_index;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const upsertToolCall = (
    record: Record<string, unknown>,
    item: Record<string, unknown>,
  ): { id: string; toolName: string; argsParts: string[]; doneArguments?: string; generatedId?: boolean } => {
    const outputIndex = getEventIndex(record);
    const itemId = typeof item.id === "string" ? item.id : typeof record.item_id === "string" ? record.item_id : null;
    const callId = typeof item.call_id === "string" ? item.call_id : typeof record.call_id === "string" ? record.call_id : null;
    const key = itemId ?? (outputIndex !== null ? outputIndexToToolKey.get(outputIndex) : undefined) ?? callId ?? `tool:${toolCalls.size}`;
    const current = toolCalls.get(key) ?? {
      id: callId ?? itemId ?? randomUUID(),
      toolName: "",
      argsParts: [],
      generatedId: !callId && !itemId,
    };

    if (callId) {
      current.id = callId;
      current.generatedId = false;
    } else if (itemId && current.generatedId) {
      current.id = itemId;
      current.generatedId = false;
    }
    if (typeof item.name === "string" && item.name.length > 0) {
      current.toolName = item.name;
    } else if (typeof record.name === "string" && record.name.length > 0) {
      current.toolName = record.name;
    }
    if (typeof item.arguments === "string" && item.arguments.length > 0) {
      current.doneArguments = item.arguments;
    }

    toolCalls.set(key, current);
    if (outputIndex !== null) {
      outputIndexToToolKey.set(outputIndex, key);
    }
    return current;
  };

  const flushEvent = (rawEvent: string): void => {
    const parsed = parseSseEvent(rawEvent);
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    events.push(parsed);
    const record = parsed as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";
    const usagePayload = normalizeObjectRecord(record.usage);
    if (Object.keys(usagePayload).length > 0) {
      usage = usagePayload;
    }

    const responsePayload = normalizeObjectRecord(record.response);
    if (Object.keys(responsePayload).length > 0) {
      completedPayload = responsePayload as OpenAiResponsesPayload;
      const responseUsage = normalizeObjectRecord(responsePayload.usage);
      if (Object.keys(responseUsage).length > 0) {
        usage = responseUsage;
      }
    }

    if (type === "response.output_text.delta" && typeof record.delta === "string") {
      textParts.push(record.delta);
      return;
    }
    if (type === "response.output_text.done" && textParts.length === 0 && typeof record.text === "string") {
      textParts.push(record.text);
      return;
    }

    if (type === "response.output_item.added" || type === "response.output_item.done") {
      const item = normalizeObjectRecord(record.item);
      if (item.type === "function_call") {
        upsertToolCall(record, item);
      } else if (textParts.length === 0 && Array.isArray(item.content)) {
        for (const part of item.content) {
          const contentPart = normalizeObjectRecord(part);
          if ((contentPart.type === "output_text" || contentPart.type === "text" || !contentPart.type) && typeof contentPart.text === "string") {
            textParts.push(contentPart.text);
          }
        }
      }
      return;
    }

    if (type === "response.function_call_arguments.delta" && typeof record.delta === "string") {
      upsertToolCall(record, {}).argsParts.push(record.delta);
      return;
    }
    if (type === "response.function_call_arguments.done") {
      const current = upsertToolCall(record, {});
      if (typeof record.arguments === "string") {
        current.doneArguments = record.arguments;
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      flushEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    flushEvent(buffer);
  }

  const output: OpenAiResponsesOutputItemPayload[] = [
    ...(textParts.length > 0
      ? [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: textParts.join(""),
              },
            ],
          },
        ]
      : []),
    ...Array.from(toolCalls.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([, entry]) => ({
        type: "function_call",
        call_id: entry.id,
        name: entry.toolName,
        arguments: entry.doneArguments ?? entry.argsParts.join(""),
      })),
  ];

  return {
    payload: {
      ...(output.length > 0 ? { output } : { output: completedPayload?.output ?? [] }),
      ...(textParts.length > 0
        ? { output_text: textParts.join("") }
        : typeof completedPayload?.output_text === "string"
          ? { output_text: completedPayload.output_text }
          : {}),
      ...(usage ? { usage } : completedPayload?.usage ? { usage: completedPayload.usage } : {}),
    },
    raw: {
      streaming: true,
      protocol: "responses",
      events,
    },
  };
}

async function parseStreamingChatCompletionsResponse(response: Response): Promise<{
  readonly payload: ChatCompletionsPayload;
  readonly raw: {
    readonly streaming: true;
    readonly chunks: unknown[];
  };
}> {
  const body = response.body;
  if (!body) {
    return {
      payload: { choices: [] },
      raw: {
        streaming: true,
        chunks: [],
      },
    };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: unknown[] = [];
  const textParts: string[] = [];
  const toolCalls = new Map<number, { id: string; toolName: string; argsParts: string[] }>();
  let usage: Record<string, unknown> | undefined;
  let buffer = "";

  const flushEvent = (rawEvent: string): void => {
    const parsed = parseSseEvent(rawEvent);
    if (!parsed) {
      return;
    }
    chunks.push(parsed);
    const usagePayload = normalizeObjectRecord((parsed as ChatCompletionsPayload).usage);
    if (Object.keys(usagePayload).length > 0) {
      usage = usagePayload;
    }
    const choice = (parsed as ChatCompletionsPayload).choices?.[0];
    const message = choice?.delta ?? choice?.message;
    if (!message) {
      return;
    }

    const text = extractTextFromMessage(message.content);
    if (text) {
      textParts.push(text);
    }

    for (const entry of message.tool_calls ?? []) {
      const index = typeof entry.index === "number" && Number.isFinite(entry.index) ? entry.index : toolCalls.size;
      const current = toolCalls.get(index) ?? {
        id: entry.id ?? randomUUID(),
        toolName: "",
        argsParts: [],
      };
      if (entry.id) {
        current.id = entry.id;
      }
      if (entry.function?.name) {
        current.toolName = entry.function.name;
      }
      if (typeof entry.function?.arguments === "string" && entry.function.arguments.length > 0) {
        current.argsParts.push(entry.function.arguments);
      }
      toolCalls.set(index, current);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      flushEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    flushEvent(buffer);
  }

  const normalizedToolCalls = Array.from(toolCalls.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, entry]) => ({
      id: entry.id,
      type: "function",
      function: {
        name: entry.toolName,
        arguments: entry.argsParts.join(""),
      },
    }));

  return {
    payload: {
      choices: [
        {
          message: {
            content: textParts.join(""),
            tool_calls: normalizedToolCalls,
          },
        },
      ],
      ...(usage ? { usage } : {}),
    },
    raw: {
      streaming: true,
      chunks,
    },
  };
}

function parseSseEvent(rawEvent: string): unknown | null {
  const dataLines = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join("\n").trim();
  if (!rawData || rawData === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(rawData) as unknown;
  } catch {
    return null;
  }
}

function isEventStreamResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("text/event-stream");
}

function normalizeAnthropicMessage(payload: AnthropicMessagePayload): {
  readonly assistantText: string;
  readonly toolCalls: ModelToolCall[];
} {
  const textParts: string[] = [];
  const toolCalls: ModelToolCall[] = [];

  for (const block of payload.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
      continue;
    }
    if (block.type === "tool_use" && block.name) {
      toolCalls.push({
        id: block.id ?? randomUUID(),
        toolName: block.name,
        args: normalizeObjectRecord(block.input),
      });
    }
  }

  return {
    assistantText: textParts.join(""),
    toolCalls,
  };
}

function sanitizeAssistantText(rawText: string): string {
  let cleaned = stripReasoningBlocks(rawText);
  cleaned = stripLeakedToolMarkup(cleaned);
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function stripReasoningBlocks(rawText: string): string {
  let cleaned = rawText;
  for (const tag of REASONING_TAG_NAMES) {
    cleaned = cleaned.replace(
      new RegExp(`(?:(?<=^)|(?<=[\\n\\r]))[ \\t]*<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>\\s*`, "gi"),
      "",
    );
    cleaned = cleaned.replace(
      new RegExp(`(?:(?<=^)|(?<=[\\n\\r]))[ \\t]*<${tag}\\b[^>]*>[\\s\\S]*$`, "gi"),
      "",
    );
    cleaned = cleaned.replace(new RegExp(`<\\/${tag}>\\s*`, "gi"), "");
  }
  return cleaned;
}

function stripLeakedToolMarkup(rawText: string): string {
  let cleaned = rawText;
  for (const tag of ["tool_call", "tool_calls", "tool_result", "function_call", "function_calls"]) {
    cleaned = cleaned.replace(
      new RegExp(`(?:(?<=^)|(?<=[\\n\\r.!?:]))[ \\t]*<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>\\s*`, "gi"),
      "",
    );
    cleaned = cleaned.replace(
      new RegExp(`(?:(?<=^)|(?<=[\\n\\r.!?:]))[ \\t]*<${tag}\\b[^>]*>[\\s\\S]*$`, "gi"),
      "",
    );
  }
  cleaned = cleaned.replace(
    /(?:(?<=^)|(?<=[\n\r.!?:]))[ \t]*<function\b[^>]*\bname\s*=\s*["'][^"']+["'][^>]*>[\s\S]*?<\/function>\s*/gi,
    "",
  );
  cleaned = cleaned.replace(
    /(?:(?<=^)|(?<=[\n\r.!?:]))[ \t]*<function\b[^>]*\bname\s*=\s*["'][^"']+["'][^>]*>[\s\S]*$/gi,
    "",
  );
  cleaned = cleaned.replace(/<\/(?:tool_call|tool_calls|tool_result|function_call|function_calls|function)>\s*/gi, "");
  return cleaned;
}

async function parseAnthropicStreamingResponse(response: Response): Promise<{
  readonly payload: AnthropicMessagePayload;
  readonly raw: {
    readonly streaming: true;
    readonly protocol: "anthropic";
    readonly events: unknown[];
  };
}> {
  const body = response.body;
  if (!body) {
    return {
      payload: { content: [] },
      raw: {
        streaming: true,
        protocol: "anthropic",
        events: [],
      },
    };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: unknown[] = [];
  const textParts: string[] = [];
  const toolCalls = new Map<number, { id: string; toolName: string; argsParts: string[] }>();
  let usage: Record<string, unknown> | undefined;
  let buffer = "";

  const flushEvent = (rawEvent: string): void => {
    const parsed = parseSseEvent(rawEvent);
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    events.push(parsed);
    const record = parsed as Record<string, unknown>;
    const usagePayload = normalizeObjectRecord(record.usage);
    if (Object.keys(usagePayload).length > 0) {
      usage = usagePayload;
    }
    const type = typeof record.type === "string" ? record.type : "";
    const index = typeof record.index === "number" && Number.isFinite(record.index) ? record.index : 0;

    if (type === "content_block_start") {
      const block = normalizeObjectRecord(record.content_block);
      if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
        textParts.push(block.text);
      }
      if (block.type === "tool_use" && typeof block.name === "string") {
        toolCalls.set(index, {
          id: typeof block.id === "string" ? block.id : randomUUID(),
          toolName: block.name,
          argsParts: block.input ? [JSON.stringify(normalizeObjectRecord(block.input))] : [],
        });
      }
      const messagePayload = normalizeObjectRecord(record.message);
      const messageUsage = normalizeObjectRecord(messagePayload.usage);
      if (Object.keys(messageUsage).length > 0) {
        usage = messageUsage;
      }
      return;
    }

    if (type === "content_block_delta") {
      const delta = normalizeObjectRecord(record.delta);
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        textParts.push(delta.text);
      }
      if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const current = toolCalls.get(index) ?? {
          id: randomUUID(),
          toolName: "",
          argsParts: [],
        };
        current.argsParts.push(delta.partial_json);
        toolCalls.set(index, current);
      }
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      flushEvent(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    flushEvent(buffer);
  }

  return {
    payload: {
      content: [
        ...textParts.map((text) => ({ type: "text", text })),
        ...Array.from(toolCalls.entries())
          .sort((left, right) => left[0] - right[0])
          .map(([, entry]) => ({
            type: "tool_use",
            id: entry.id,
            name: entry.toolName,
            input: parseFunctionArguments(entry.argsParts.join("")),
          })),
      ],
      ...(usage ? { usage } : {}),
    },
    raw: {
      streaming: true,
      protocol: "anthropic",
      events,
    },
  };
}

function parseAssistantEnvelope(rawText: string): ParsedAssistantEnvelope {
  const stripped = stripJsonCodeFence(rawText);
  if (stripped) {
    try {
      const parsed = JSON.parse(stripped) as unknown;
      return normalizeAssistantEnvelope(parsed, rawText);
    } catch {
      return extractEmbeddedToolCalls(rawText);
    }
  }
  return {
    assistantText: sanitizeAssistantText(rawText),
    toolCalls: [],
  };
}

function stripJsonCodeFence(rawText: string): string {
  return rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeAssistantEnvelope(raw: unknown, fallbackAssistantText: string): ParsedAssistantEnvelope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      assistantText: fallbackAssistantText.trim(),
      toolCalls: [],
    };
  }

  const record = raw as Record<string, unknown>;
  const assistantText =
    typeof record.assistantText === "string"
      ? record.assistantText
      : typeof record.assistant_text === "string"
        ? record.assistant_text
        : fallbackAssistantText;
  const explicitToolCalls = normalizeToolCalls(record.toolCalls ?? record.tool_calls ?? record.calls);
  const recoveredToolCall =
    explicitToolCalls.length === 0
      ? normalizeSingleToolCallCandidate(raw)
      : null;

  return {
    assistantText: sanitizeAssistantText(assistantText),
    toolCalls: explicitToolCalls.length > 0 ? explicitToolCalls : recoveredToolCall ? [recoveredToolCall] : [],
  };
}

function extractEmbeddedToolCalls(rawText: string): ParsedAssistantEnvelope {
  let assistantText = rawText;
  const toolCalls: ModelToolCall[] = [];

  const collectMultiCallBlocks = (pattern: RegExp): void => {
    assistantText = assistantText.replace(pattern, (_match, body: string) => {
      toolCalls.push(...parseEmbeddedToolCallList(body));
      return "";
    });
  };

  const collectSingleCallBlocks = (pattern: RegExp): void => {
    assistantText = assistantText.replace(pattern, (_match, body: string) => {
      const toolCall = parseEmbeddedSingleToolCall(body);
      if (toolCall) {
        toolCalls.push(toolCall);
      }
      return "";
    });
  };

  collectMultiCallBlocks(/<tool_calls\b[^>]*>([\s\S]*?)<\/tool_calls>/gi);
  collectMultiCallBlocks(/<function_calls\b[^>]*>([\s\S]*?)<\/function_calls>/gi);
  collectSingleCallBlocks(/<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi);
  collectSingleCallBlocks(/<function_call\b[^>]*>([\s\S]*?)<\/function_call>/gi);

  const embeddedJsonEnvelope = extractEmbeddedJsonEnvelope(assistantText);
  if (embeddedJsonEnvelope) {
    toolCalls.push(...embeddedJsonEnvelope.toolCalls);
    assistantText =
      assistantText.slice(0, embeddedJsonEnvelope.start) + assistantText.slice(embeddedJsonEnvelope.end);
  }

  assistantText = assistantText.replace(
    /(?:(?<=^)|(?<=[\n\r.!?:]))[ \t]*<function\b([^>]*)>([\s\S]*?)<\/function>/gi,
    (_match, attributes: string, body: string) => {
      const toolName = extractXmlAttribute(attributes, "name");
      if (!toolName) {
        return _match;
      }
      const parsedBody = parseEmbeddedJsonValue(body);
      const toolCall = normalizeSingleToolCallCandidate(parsedBody ?? stripJsonCodeFence(body), toolName);
      if (toolCall) {
        toolCalls.push(toolCall);
        return "";
      }
      return _match;
    },
  );
  assistantText = assistantText.replace(
    /(?:(?<=^)|(?<=[\n\r.!?:]))[ \t]*<tool_calls\b[^>]*>([\s\S]*)$/i,
    (_match, body: string) => {
      toolCalls.push(...parseEmbeddedToolCallList(body));
      return "";
    },
  );
  assistantText = assistantText.replace(
    /(?:(?<=^)|(?<=[\n\r.!?:]))[ \t]*<function_calls\b[^>]*>([\s\S]*)$/i,
    (_match, body: string) => {
      toolCalls.push(...parseEmbeddedToolCallList(body));
      return "";
    },
  );
  assistantText = assistantText.replace(
    /(?:(?<=^)|(?<=[\n\r.!?:]))[ \t]*<tool_call\b[^>]*>([\s\S]*)$/i,
    (_match, body: string) => {
      const toolCall = parseEmbeddedSingleToolCall(body);
      if (toolCall) {
        toolCalls.push(toolCall);
      }
      return "";
    },
  );
  assistantText = assistantText.replace(
    /(?:(?<=^)|(?<=[\n\r.!?:]))[ \t]*<function_call\b[^>]*>([\s\S]*)$/i,
    (_match, body: string) => {
      const toolCall = parseEmbeddedSingleToolCall(body);
      if (toolCall) {
        toolCalls.push(toolCall);
      }
      return "";
    },
  );
  assistantText = assistantText.replace(
    /(?:(?<=^)|(?<=[\n\r.!?:]))[ \t]*<function\b([^>]*)>([\s\S]*)$/i,
    (_match, attributes: string, body: string) => {
      const toolName = extractXmlAttribute(attributes, "name");
      if (!toolName) {
        return "";
      }
      const parsedBody = parseEmbeddedJsonValue(body);
      const toolCall = normalizeSingleToolCallCandidate(parsedBody ?? stripJsonCodeFence(body), toolName);
      if (toolCall) {
        toolCalls.push(toolCall);
      }
      return "";
    },
  );
  assistantText = assistantText.replace(/<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi, "");
  assistantText = assistantText.replace(/<\/(?:tool_call|tool_calls|tool_result|function_call|function_calls|function)>\s*/gi, "");

  return {
    assistantText: sanitizeAssistantText(assistantText),
    toolCalls,
  };
}

function extractEmbeddedJsonEnvelope(
  rawText: string,
): { readonly start: number; readonly end: number; readonly toolCalls: ModelToolCall[] } | null {
  const anchors = ['"toolCalls"', '"tool_calls"', '"calls"', '"toolName"', '"function"'];
  let best:
    | { readonly start: number; readonly end: number; readonly toolCalls: ModelToolCall[] }
    | null = null;

  for (const anchor of anchors) {
    let searchFrom = 0;
    while (searchFrom < rawText.length) {
      const anchorIndex = rawText.indexOf(anchor, searchFrom);
      if (anchorIndex === -1) {
        break;
      }
      searchFrom = anchorIndex + anchor.length;

      const objectStart = findJsonObjectStart(rawText, anchorIndex);
      if (objectStart === -1) {
        continue;
      }
      const objectEnd = findJsonObjectEnd(rawText, objectStart);
      if (objectEnd === -1) {
        continue;
      }

      const parsed = parseEmbeddedJsonValue(rawText.slice(objectStart, objectEnd));
      const envelope = normalizeAssistantEnvelope(parsed, "");
      const toolCalls = envelope.toolCalls.length > 0 ? envelope.toolCalls : parseEmbeddedToolCallList(rawText.slice(objectStart, objectEnd));
      if (toolCalls.length === 0) {
        continue;
      }

      if (!best || objectEnd - objectStart > best.end - best.start) {
        best = {
          start: objectStart,
          end: objectEnd,
          toolCalls,
        };
      }
    }
  }

  return best;
}

function findJsonObjectStart(rawText: string, fromIndex: number): number {
  return rawText.lastIndexOf("{", fromIndex);
}

function findJsonObjectEnd(rawText: string, objectStart: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = objectStart; index < rawText.length; index += 1) {
    const char = rawText[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return -1;
}

function parseEmbeddedToolCallList(raw: string): ModelToolCall[] {
  const parsed = parseEmbeddedJsonValue(raw);
  if (Array.isArray(parsed)) {
    return normalizeToolCalls(parsed);
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const nested = normalizeToolCalls(record.toolCalls ?? record.tool_calls ?? record.calls);
    if (nested.length > 0) {
      return nested;
    }
    const single = normalizeSingleToolCallCandidate(parsed);
    return single ? [single] : [];
  }
  return [];
}

function parseEmbeddedSingleToolCall(raw: string): ModelToolCall | null {
  const parsed = parseEmbeddedJsonValue(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return normalizeSingleToolCallCandidate(parsed);
  }
  return null;
}

function parseEmbeddedJsonValue(raw: string): unknown | null {
  const stripped = stripJsonCodeFence(raw);
  if (!stripped) {
    return null;
  }
  try {
    return JSON.parse(stripped) as unknown;
  } catch {
    return null;
  }
}

function extractXmlAttribute(rawAttributes: string, attributeName: string): string | null {
  const match = new RegExp(`\\b${attributeName}\\s*=\\s*["']([^"']+)["']`, "i").exec(rawAttributes);
  return match?.[1]?.trim() || null;
}

function normalizeToolCalls(raw: unknown): ModelToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => normalizeSingleToolCallCandidate(entry))
    .filter((entry): entry is ModelToolCall => entry !== null);
}

function normalizeNativeToolCalls(raw: NativeToolCallPayload[] | undefined): ModelToolCall[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      const toolName = entry.function?.name;
      if (!toolName) {
        return null;
      }

      const args = parseFunctionArguments(entry.function?.arguments);
      return {
        id: entry.id ?? randomUUID(),
        toolName,
        args,
      };
    })
    .filter((entry): entry is ModelToolCall => entry !== null);
}

function normalizeSingleToolCallCandidate(raw: unknown, fallbackToolName?: string): ModelToolCall | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const functionRecord = normalizeObjectRecord(record.function);
  const toolName =
    typeof record.toolName === "string"
      ? record.toolName
      : typeof record.tool_name === "string"
        ? record.tool_name
      : typeof record.name === "string"
        ? record.name
        : typeof functionRecord.name === "string"
          ? functionRecord.name
          : fallbackToolName ?? null;

  if (!toolName) {
    return null;
  }

  let args: Record<string, unknown> = {};
  if (record.args && typeof record.args === "object" && !Array.isArray(record.args)) {
    args = record.args as Record<string, unknown>;
  } else if (record.input && typeof record.input === "object" && !Array.isArray(record.input)) {
    args = record.input as Record<string, unknown>;
  } else if (record.arguments && typeof record.arguments === "object" && !Array.isArray(record.arguments)) {
    args = record.arguments as Record<string, unknown>;
  } else if (typeof record.arguments === "string") {
    args = parseFunctionArguments(record.arguments);
  } else if (typeof functionRecord.arguments === "string") {
    args = parseFunctionArguments(functionRecord.arguments);
  } else if (functionRecord.arguments && typeof functionRecord.arguments === "object" && !Array.isArray(functionRecord.arguments)) {
    args = functionRecord.arguments as Record<string, unknown>;
  } else if (fallbackToolName) {
    args = normalizeObjectRecord(raw);
  }

  return {
    id: typeof record.id === "string" ? record.id : randomUUID(),
    toolName,
    args,
  };
}

function parseFunctionArguments(raw: string | undefined): Record<string, unknown> {
  const repaired = repairFunctionArguments(raw);
  if (!repaired) {
    return {};
  }

  const parsed = tryParseJsonObject(repaired);
  return parsed ?? {};
}

function repairFunctionArguments(raw: string | undefined): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed || trimmed === "None" || trimmed === "null" || trimmed === "undefined") {
    return null;
  }

  const direct = tryParseJsonObject(trimmed);
  if (direct) {
    return JSON.stringify(direct);
  }

  const literalFixed = replaceLooseJsonBarewords(trimmed);
  const literalParsed = tryParseJsonObject(literalFixed);
  if (literalParsed) {
    return JSON.stringify(literalParsed);
  }

  const escaped = escapeInvalidJsonStringControlChars(literalFixed);
  const escapedParsed = tryParseJsonObject(escaped);
  if (escapedParsed) {
    return JSON.stringify(escapedParsed);
  }

  const repaired = repairMalformedJson(escaped);
  const repairedParsed = tryParseJsonObject(repaired);
  if (repairedParsed) {
    return JSON.stringify(repairedParsed);
  }

  return null;
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function replaceLooseJsonBarewords(raw: string): string {
  let result = "";
  let inString = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? "";
    if (character === "\"" && !isEscapedJsonCharacter(raw, index)) {
      inString = !inString;
      result += character;
      continue;
    }

    if (!inString && /[A-Za-z]/.test(character)) {
      let end = index + 1;
      while (end < raw.length && /[A-Za-z]/.test(raw[end] ?? "")) {
        end += 1;
      }
      const token = raw.slice(index, end);
      if (token === "None") {
        result += "null";
      } else if (token === "True") {
        result += "true";
      } else if (token === "False") {
        result += "false";
      } else {
        result += token;
      }
      index = end - 1;
      continue;
    }

    result += character;
  }

  return result;
}

function escapeInvalidJsonStringControlChars(raw: string): string {
  let result = "";
  let inString = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? "";
    if (character === "\"" && !isEscapedJsonCharacter(raw, index)) {
      inString = !inString;
      result += character;
      continue;
    }

    if (inString) {
      if (character === "\n") {
        result += "\\n";
        continue;
      }
      if (character === "\r") {
        result += "\\r";
        continue;
      }
      if (character === "\t") {
        result += "\\t";
        continue;
      }
      if (character && character < " ") {
        result += `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
        continue;
      }
    }

    result += character;
  }

  return result;
}

function repairMalformedJson(raw: string): string {
  let repaired = raw.replace(/,\s*([}\]])/g, "$1");
  const { openCurly, openSquare, extraClosingCurly, extraClosingSquare } = countJsonDelimiters(repaired);

  if (extraClosingCurly > 0 || extraClosingSquare > 0) {
    repaired = trimTrailingClosers(repaired, "}", extraClosingCurly);
    repaired = trimTrailingClosers(repaired, "]", extraClosingSquare);
  }

  if (openCurly > 0) {
    repaired += "}".repeat(openCurly);
  }
  if (openSquare > 0) {
    repaired += "]".repeat(openSquare);
  }

  return repaired.replace(/,\s*([}\]])/g, "$1");
}

function countJsonDelimiters(raw: string): {
  readonly openCurly: number;
  readonly openSquare: number;
  readonly extraClosingCurly: number;
  readonly extraClosingSquare: number;
} {
  let inString = false;
  let openCurly = 0;
  let openSquare = 0;
  let extraClosingCurly = 0;
  let extraClosingSquare = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index] ?? "";
    if (character === "\"" && !isEscapedJsonCharacter(raw, index)) {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (character === "{") {
      openCurly += 1;
    } else if (character === "}") {
      if (openCurly > 0) {
        openCurly -= 1;
      } else {
        extraClosingCurly += 1;
      }
    } else if (character === "[") {
      openSquare += 1;
    } else if (character === "]") {
      if (openSquare > 0) {
        openSquare -= 1;
      } else {
        extraClosingSquare += 1;
      }
    }
  }

  return {
    openCurly,
    openSquare,
    extraClosingCurly,
    extraClosingSquare,
  };
}

function trimTrailingClosers(raw: string, closer: "}" | "]", count: number): string {
  let repaired = raw;
  let remaining = count;
  while (remaining > 0 && repaired.trimEnd().endsWith(closer)) {
    repaired = repaired.trimEnd().slice(0, -1);
    remaining -= 1;
  }
  return repaired;
}

function isEscapedJsonCharacter(raw: string, index: number): boolean {
  let backslashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && raw[cursor] === "\\"; cursor -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function parseObjectEnv(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    return normalizeObjectRecord(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

function parseCredentialEnv(raw: string | undefined): ModelCredentialEntry[] {
  if (!raw) {
    return [];
  }

  try {
    return normalizeCredentialConfig(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

function normalizeHeaderRecord(value: Record<string, string> | undefined): Record<string, string> {
  return value ? { ...value } : {};
}

function redactHeaderRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /authorization|api-key|x-api-key|token|secret/i.test(key) ? "[configured]" : entry,
    ]),
  );
}

function redactDiagnosticBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) {
      url.username = "[redacted]";
    }
    if (url.password) {
      url.password = "[redacted]";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveUrlParam(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return decodeURIComponent(url.toString());
  } catch {
    return value
      .replace(/([?&](?:api[_-]?key|apikey|secret|token|password|authorization|credential)=)[^&]+/gi, "$1[redacted]")
      .replace(/\/\/([^/@:]+):([^/@]+)@/g, "//[redacted]:[redacted]@");
  }
}

function isSensitiveUrlParam(key: string): boolean {
  return /api[_-]?key|apikey|secret|token|password|authorization|credential/i.test(key);
}

function sanitizeModelRaw(value: unknown, profile: ModelProfile): unknown {
  if (typeof value === "string") {
    return redactModelProfileSecrets(value, profile);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeModelRaw(entry, profile));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      sanitizeModelRaw(entry, profile),
    ]),
  );
}

function redactModelProfileSecrets(raw: string, profile: ModelProfile): string {
  let redacted = raw;
  for (const secret of collectModelProfileSecrets(profile)) {
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

function collectModelProfileSecrets(profile: ModelProfile): string[] {
  const values = new Set<string>();
  for (const credential of normalizeCredentialEntries(profile)) {
    if (credential.apiKey) {
      values.add(credential.apiKey);
    }
    const envValue = credential.apiKeyEnv ? process.env[credential.apiKeyEnv] : undefined;
    if (envValue?.trim()) {
      values.add(envValue);
    }
  }
  for (const [key, value] of Object.entries(profile.headers ?? {})) {
    if (/authorization|api-key|x-api-key|token|secret/i.test(key) && value.trim()) {
      values.add(value);
    }
  }
  collectStringLeaves(profile.requestBody ?? {}, values);
  return Array.from(values).filter((entry) => entry.length >= 4);
}

function collectStringLeaves(value: unknown, output: Set<string>): void {
  if (typeof value === "string" && value.trim()) {
    output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringLeaves(entry, output);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStringLeaves(entry, output);
    }
  }
}

function normalizeObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function createProviderInfo(profile: ModelProfile): ModelProviderInfo {
  return {
    id: profile.id,
    name: profile.name,
    model: profile.model,
    protocol: profile.protocol,
  };
}

function resolveModelCooldownMs(kind: ModelErrorKind, overrideMs: number | undefined): number {
  if (overrideMs !== undefined) {
    return Math.max(0, Math.trunc(overrideMs));
  }
  switch (kind) {
    case "auth_failed":
      return 300_000;
    case "rate_limit":
      return 60_000;
    case "server_error":
    case "timeout":
    case "network_error":
      return 30_000;
    case "context_overflow":
    case "malformed_tool_call":
    case "unknown":
      return 0;
  }
}

function parseProviderRetryAfterMs(headers: Headers): number | undefined {
  const retryAfter = readHeader(headers, "retry-after");
  if (!retryAfter) {
    return undefined;
  }
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const timestamp = Date.parse(retryAfter);
  if (Number.isFinite(timestamp)) {
    return Math.max(0, timestamp - Date.now());
  }
  return undefined;
}

function createMockProviderInfo(): ModelProviderInfo {
  return {
    id: "mock",
    name: "mock",
    model: "mock",
    protocol: "mock",
  };
}

function normalizeOpenAiUsage(raw: unknown): ModelTurnUsage | undefined {
  const record = normalizeObjectRecord(raw);
  const promptDetails = normalizeObjectRecord(record.prompt_tokens_details);
  const completionDetails = normalizeObjectRecord(record.completion_tokens_details);
  const inputTokens = normalizeTokenCount(record.prompt_tokens);
  const outputTokens = normalizeTokenCount(record.completion_tokens);
  const totalTokens = normalizeTokenCount(record.total_tokens);
  return buildUsageRecord(inputTokens, outputTokens, totalTokens, {
    cachedInputTokens: normalizeTokenCount(promptDetails.cached_tokens),
    reasoningTokens: normalizeTokenCount(completionDetails.reasoning_tokens),
  });
}

function normalizeResponsesUsage(raw: unknown): ModelTurnUsage | undefined {
  const record = normalizeObjectRecord(raw);
  const inputDetails = normalizeObjectRecord(record.input_tokens_details);
  const outputDetails = normalizeObjectRecord(record.output_tokens_details);
  const inputTokens = normalizeTokenCount(record.input_tokens);
  const outputTokens = normalizeTokenCount(record.output_tokens);
  const totalTokens = normalizeTokenCount(record.total_tokens);
  return buildUsageRecord(inputTokens, outputTokens, totalTokens, {
    cachedInputTokens: normalizeTokenCount(inputDetails.cached_tokens),
    reasoningTokens: normalizeTokenCount(outputDetails.reasoning_tokens),
  });
}

function normalizeAnthropicUsage(raw: unknown): ModelTurnUsage | undefined {
  const record = normalizeObjectRecord(raw);
  const cacheCreationInputTokens = normalizeTokenCount(record.cache_creation_input_tokens);
  const cacheReadInputTokens = normalizeTokenCount(record.cache_read_input_tokens);
  const inputTokens =
    normalizeTokenCount(record.input_tokens) ??
    cacheCreationInputTokens ??
    cacheReadInputTokens;
  const outputTokens = normalizeTokenCount(record.output_tokens);
  const totalTokens = normalizeTokenCount(record.total_tokens);
  return buildUsageRecord(inputTokens, outputTokens, totalTokens, {
    cachedInputTokens: cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    reasoningTokens: normalizeTokenCount(record.reasoning_tokens) ?? normalizeTokenCount(record.thinking_tokens),
  });
}

function buildUsageRecord(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  totalTokens: number | undefined,
  details: Omit<ModelTurnUsage, "inputTokens" | "outputTokens" | "totalTokens"> = {},
): ModelTurnUsage | undefined {
  const normalizedTotal =
    totalTokens ?? (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined);
  const hasDetails = Object.values(details).some((value) => value !== undefined);
  if (inputTokens === undefined && outputTokens === undefined && normalizedTotal === undefined && !hasDetails) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(normalizedTotal !== undefined ? { totalTokens: normalizedTotal } : {}),
    ...(details.cachedInputTokens !== undefined ? { cachedInputTokens: details.cachedInputTokens } : {}),
    ...(details.cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens: details.cacheCreationInputTokens } : {}),
    ...(details.cacheReadInputTokens !== undefined ? { cacheReadInputTokens: details.cacheReadInputTokens } : {}),
    ...(details.reasoningTokens !== undefined ? { reasoningTokens: details.reasoningTokens } : {}),
  };
}

function buildResponseObservability(
  headers: Headers,
  usage: ModelTurnUsage | undefined,
): Pick<ModelTurnResult, "usage" | "metadata"> {
  const rateLimit = normalizeRateLimitHeaders(headers);
  return {
    ...(usage ? { usage } : {}),
    ...(rateLimit ? { metadata: { rateLimit } } : {}),
  };
}

function normalizeRateLimitHeaders(headers: Headers): ModelRateLimitInfo | undefined {
  const requests = normalizeRateLimitBucket(headers, "requests");
  const tokens = normalizeRateLimitBucket(headers, "tokens");
  if (!requests && !tokens) {
    return undefined;
  }
  return {
    ...(requests ? { requests } : {}),
    ...(tokens ? { tokens } : {}),
  };
}

function normalizeRateLimitBucket(headers: Headers, bucket: "requests" | "tokens"): ModelRateLimitBucket | undefined {
  const limit = normalizeHeaderNumber(readRateLimitHeader(headers, "limit", bucket));
  const remaining = normalizeHeaderNumber(readRateLimitHeader(headers, "remaining", bucket));
  const reset = readRateLimitHeader(headers, "reset", bucket);
  if (limit === undefined && remaining === undefined && reset === undefined) {
    return undefined;
  }
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(remaining !== undefined ? { remaining } : {}),
    ...(reset !== undefined ? { reset } : {}),
  };
}

function readRateLimitHeader(headers: Headers, metric: "limit" | "remaining" | "reset", bucket: "requests" | "tokens"): string | undefined {
  return (
    readHeader(headers, `x-ratelimit-${metric}-${bucket}`) ??
    readHeader(headers, `x-ratelimit-${bucket}-${metric}`) ??
    readHeader(headers, `anthropic-ratelimit-${bucket}-${metric}`)
  );
}

function readHeader(headers: Headers, name: string): string | undefined {
  const value = headers.get(name);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeHeaderNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.trunc(parsed);
  return normalized >= 0 ? normalized : undefined;
}

function normalizeTokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : undefined;
}

function toStringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === "string" && entry.trim().length > 0)
      .map(([key, entry]) => [key, String(entry)]),
  );
}

function normalizeApiPath(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^\/+/, "");
}

function resolveAnthropicMaxTokens(requested: unknown, model: string): number {
  return resolvePositiveAnthropicMaxTokens(requested) ?? getAnthropicMaxOutput(model);
}

function resolvePositiveAnthropicMaxTokens(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const floored = Math.trunc(value);
  return floored > 0 ? floored : null;
}

function getAnthropicMaxOutput(model: string): number {
  const normalizedModel = model.toLowerCase().replace(/\./g, "-");
  let bestKey = "";
  let bestValue = DEFAULT_ANTHROPIC_MAX_TOKENS;
  for (const [key, value] of Object.entries(ANTHROPIC_OUTPUT_LIMITS)) {
    if (normalizedModel.includes(key) && key.length > bestKey.length) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestValue;
}

function normalizeModelPricingKey(model: string): string {
  return model.trim().toLowerCase().replace(/[._:\s]+/g, "-");
}

function normalizeUsageTokenCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.trunc(parsed);
}

function buildAnthropicBetaHeader(baseUrl: string, apiKey?: string): string | undefined {
  const betas = requiresBearerAuthForAnthropicEndpoint(baseUrl)
    ? ANTHROPIC_COMMON_BETAS.filter((entry) => entry !== ANTHROPIC_TOOL_STREAMING_BETA)
    : isDirectAnthropicEndpoint(baseUrl) && isAnthropicOauthToken(apiKey ?? "")
      ? [...ANTHROPIC_COMMON_BETAS, ...ANTHROPIC_OAUTH_ONLY_BETAS]
      : ANTHROPIC_COMMON_BETAS;
  return betas.length > 0 ? betas.join(",") : undefined;
}

function requiresBearerAuthForAnthropicEndpoint(baseUrl: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.startsWith("https://api.minimax.io/anthropic") || normalized.startsWith("https://api.minimaxi.com/anthropic");
}

function isDirectAnthropicEndpoint(baseUrl: string): boolean {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.includes("anthropic.com");
}

function isAnthropicOauthToken(apiKey: string): boolean {
  if (!apiKey) {
    return false;
  }
  if (apiKey.startsWith("sk-ant-api")) {
    return false;
  }
  return apiKey.startsWith("sk-ant-") || apiKey.startsWith("eyJ") || apiKey.startsWith("cc-");
}

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const normalizedName = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === normalizedName);
}

function deleteHeader(headers: Record<string, string>, name: string): void {
  const normalizedName = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === normalizedName) {
      delete headers[key];
    }
  }
}

function upsertHeader(headers: Record<string, string>, name: string, value: string): void {
  deleteHeader(headers, name);
  headers[name] = value;
}

function normalizeModelProtocol(value: unknown): ModelProtocol {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, "-");
  if (normalized === "anthropic") {
    return "anthropic";
  }
  if (normalized === "responses" || normalized === "openai-responses" || normalized === "codex") {
    return "responses";
  }
  if (!normalized || normalized === "openai" || normalized === "openai-compatible" || normalized === "chat-completions") {
    return "openai";
  }
  return normalized;
}

function isBuiltInModelProtocol(protocol: ModelProtocol): protocol is BuiltInModelProtocol {
  return protocol === "anthropic" || protocol === "openai" || protocol === "responses";
}

function normalizeModelProfileProvider(value: unknown): BuiltInModelProfileProvider | null {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, "-");
  return normalized === "bai" || normalized === "b-ai" || normalized === "b.ai" ? "bai" : null;
}

function normalizeProviderExtensionId(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeProviderProtocol(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, "-");
}

function normalizeCredentialStrategy(value: unknown): ModelCredentialStrategy | undefined {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, "-");
  if (normalized === "least-used") {
    return "least-used";
  }
  if (normalized === "round-robin") {
    return "round-robin";
  }
  return undefined;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined;
}

function normalizeModelCostHint(value: unknown): ModelCostHint {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, "-");
  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : "medium";
}

function normalizeModelCostRank(value: unknown): number {
  const normalized = normalizeModelCostHint(value);
  if (typeof normalized === "number") {
    return normalized;
  }
  if (normalized === "low") {
    return 1;
  }
  if (normalized === "high") {
    return 3;
  }
  return 2;
}

function estimateModelInputTokens(input: ModelTurnInput): number {
  const raw = JSON.stringify({
    objective: input.taskContract.objective,
    agentRole: input.taskContract.agentRole ?? "primary",
    successCriteria: input.taskContract.successCriteria,
    constraints: input.taskContract.constraints,
    context: {
      repoSummary: input.context.repoSummary,
      threadSummary: input.context.threadSummary,
      workspaceSnapshot: input.context.workspaceSnapshot,
    },
    availableTools: input.availableTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputHint: tool.inputHint,
      riskHint: tool.riskHint,
    })),
    toolResults: input.toolResults.map((result) => ({
      toolName: result.toolName,
      ok: result.ok,
      summary: result.summary,
      details: result.details,
    })),
  });
  return Math.max(1, Math.ceil(raw.length / 4));
}

function normalizeCredentialConfig(value: unknown): ModelCredentialEntry[] {
  const entries = Array.isArray(value) ? value : [];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const record = entry as Record<string, unknown>;
      const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined;
      const apiKeyEnv = typeof record.apiKeyEnv === "string" && record.apiKeyEnv.trim()
        ? record.apiKeyEnv.trim()
        : undefined;
      const apiKey = typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined;
      if (!apiKeyEnv && !apiKey) {
        return null;
      }
      return {
        ...(id ? { id } : {}),
        ...(apiKeyEnv ? { apiKeyEnv } : {}),
        ...(apiKey ? { apiKey } : {}),
      };
    })
    .filter((entry): entry is ModelCredentialEntry => entry !== null);
}

function createProfileModelClient(
  profile: ModelProfile,
  providerRegistry: ModelProviderExtensionRegistry = defaultModelProviderExtensionRegistry,
): ModelClient {
  const providerExtension = providerRegistry.resolve(profile);
  if (providerExtension) {
    return providerExtension.createModelClient(profile);
  }
  if (profile.providerExtensionId || !isBuiltInModelProtocol(profile.protocol)) {
    const providerKey = profile.providerExtensionId ?? profile.protocol;
    throw new Error(`Unknown model provider extension "${providerKey}" for profile ${profile.id}.`);
  }
  if (normalizeCredentialEntries(profile).length > 1) {
    return new CredentialPoolModelClient(profile);
  }
  return createSingleProfileModelClient(profile);
}

function createSingleProfileModelClient(profile: ModelProfile): ModelClient {
  if (profile.protocol === "anthropic") {
    return new AnthropicMessagesModelClient(profile);
  }
  if (profile.protocol === "responses") {
    return new OpenAiResponsesModelClient(profile);
  }
  return new OpenAiCompatibleModelClient(profile);
}

function buildOpenAiTools(availableTools: ToolSpec[]): Array<Record<string, unknown>> {
  return availableTools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: `${tool.description} Expected input: ${tool.inputHint}. Risk: ${tool.riskHint}.`,
      parameters: buildToolParameters(tool.inputHint),
    },
  }));
}

function buildOpenAiResponsesTools(availableTools: ToolSpec[]): Array<Record<string, unknown>> {
  return availableTools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: `${tool.description} Expected input: ${tool.inputHint}. Risk: ${tool.riskHint}.`,
    parameters: buildToolParameters(tool.inputHint),
  }));
}

function buildAnthropicTools(availableTools: ToolSpec[]): Array<Record<string, unknown>> {
  return availableTools.map((tool) => ({
    name: tool.name,
    description: `${tool.description} Expected input: ${tool.inputHint}. Risk: ${tool.riskHint}.`,
    input_schema: buildToolParameters(tool.inputHint),
  }));
}

function buildToolParameters(inputHint: string): Record<string, unknown> {
  const trimmed = inputHint.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return {
      type: "object",
      additionalProperties: true,
      description: `Expected shape: ${inputHint}`,
    };
  }

  const body = trimmed.slice(1, -1).trim();
  if (!body) {
    return {
      type: "object",
      properties: {},
      additionalProperties: false,
    };
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const segment of body.split(",")) {
    const match = segment.trim().match(/^([a-zA-Z0-9_]+)(\?)?:\s*(.+)$/);
    if (!match) {
      continue;
    }

    const [, key, optionalMarker, typeHint] = match;
    properties[key] = {
      ...mapTypeHintToSchema(typeHint.trim()),
      description: `${key}: ${typeHint.trim()}`,
    };
    if (!optionalMarker) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
}

function mapTypeHintToSchema(typeHint: string): Record<string, unknown> {
  if (typeHint.includes("string[]")) {
    return {
      type: "array",
      items: {
        type: "string",
      },
    };
  }

  if (typeHint.includes("number")) {
    return {
      type: "number",
    };
  }

  if (typeHint.includes("boolean")) {
    return {
      type: "boolean",
    };
  }

  if (typeHint.includes("object")) {
    return {
      type: "object",
      additionalProperties: true,
    };
  }

  return {
    type: "string",
  };
}
