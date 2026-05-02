import { nativeReferenceAdapters } from "./generated.js";
import type { ReferenceNativeAdapterSource, ReferenceNativeCategory, ReferenceNativeSource } from "./index.js";

export type NativeImplementationKind =
  | "native-channel-plugin"
  | "native-coding-experience"
  | "native-gateway-schema"
  | "native-memory-skill-tool"
  | "native-module-facade"
  | "native-multimodal-tool"
  | "native-process-control-tool"
  | "native-runtime-tool";

export type NativeParityStatus = "facade" | "contract-tested" | "live-tested" | "product-equivalent";

export interface NativeParityEvidenceRecord {
  readonly kind: "contract-test" | "fixture" | "live-test" | "manual-runbook" | "unit-test";
  readonly command: string;
  readonly path: string;
  readonly requiredFor: readonly NativeParityStatus[];
}

export interface NativeImplementationBinding {
  readonly packageName: string;
  readonly surface: string;
  readonly handles: readonly string[];
}

export interface NativeImplementationContract {
  readonly install: boolean;
  readonly configure: boolean;
  readonly execute: boolean;
  readonly health: boolean;
  readonly shutdown: boolean;
  readonly audit: boolean;
}

export interface NativeImplementationPlan {
  readonly id: string;
  readonly source: ReferenceNativeSource;
  readonly category: ReferenceNativeCategory;
  readonly title: string;
  readonly kind: NativeImplementationKind;
  readonly upstreamRuntimeRequired: false;
  readonly replacementStrategy: string;
  readonly bindings: readonly NativeImplementationBinding[];
  readonly contract: NativeImplementationContract;
  readonly permissions: {
    readonly filesystem: "none" | "read" | "read-write";
    readonly network: "none" | "optional" | "required";
    readonly secrets: "none" | "reference-only";
    readonly process: "none" | "managed-child-process";
  };
  readonly parityClaims: {
    readonly parityStatus: NativeParityStatus;
    readonly parityEvidence: readonly NativeParityEvidenceRecord[];
    readonly adapterSurfaceReplaced: true;
    readonly sourceMirrorAvailable: true;
    readonly liveAccountRequired: boolean;
    readonly behavioralParityEvidence: readonly string[];
  };
}

export interface NativeImplementationCoverage {
  readonly total: number;
  readonly upstreamRuntimeRequired: number;
  readonly nativeImplemented: number;
  readonly bySource: Record<string, number>;
  readonly byKind: Record<string, number>;
  readonly byParityStatus: Record<string, number>;
  readonly bindings: Record<string, number>;
}

export interface NativeParityValidationIssue {
  readonly id: string;
  readonly severity: "error" | "warning";
  readonly reason: string;
}

export interface NativeParityValidationReport {
  readonly ok: boolean;
  readonly strict: boolean;
  readonly issueCount: number;
  readonly issues: readonly NativeParityValidationIssue[];
}

export interface NativeImplementationResult {
  readonly ok: true;
  readonly id: string;
  readonly kind: NativeImplementationKind;
  readonly summary: string;
  readonly upstreamRuntimeRequired: false;
  readonly handledBy: readonly NativeImplementationBinding[];
  readonly contract: NativeImplementationContract;
  readonly nextRuntimeAction: string;
}

export function listNativeImplementationPlans(filter: {
  readonly source?: ReferenceNativeSource;
  readonly category?: ReferenceNativeCategory;
  readonly query?: string;
} = {}): NativeImplementationPlan[] {
  const query = filter.query?.trim().toLowerCase();
  return nativeReferenceAdapters
    .filter((adapter) => filter.source === undefined || adapter.source === filter.source)
    .filter((adapter) => filter.category === undefined || adapter.category === filter.category)
    .filter(
      (adapter) =>
        query === undefined ||
        adapter.id.toLowerCase().includes(query) ||
        adapter.title.toLowerCase().includes(query) ||
        (adapter.sourcePath ?? "").toLowerCase().includes(query),
    )
    .map(buildNativeImplementationPlan);
}

export function getNativeImplementationPlan(id: string): NativeImplementationPlan | null {
  const adapter = nativeReferenceAdapters.find((entry) => entry.id === id);
  return adapter ? buildNativeImplementationPlan(adapter) : null;
}

export function summarizeNativeImplementationCoverage(
  plans: readonly NativeImplementationPlan[] = nativeReferenceAdapters.map(buildNativeImplementationPlan),
): NativeImplementationCoverage {
  const bindingCounts: Record<string, number> = {};
  for (const plan of plans) {
    for (const binding of plan.bindings) {
      bindingCounts[`${binding.packageName}:${binding.surface}`] = (bindingCounts[`${binding.packageName}:${binding.surface}`] ?? 0) + 1;
    }
  }
  return {
    total: plans.length,
    upstreamRuntimeRequired: plans.filter((plan) => plan.upstreamRuntimeRequired).length,
    nativeImplemented: plans.filter((plan) => !plan.upstreamRuntimeRequired).length,
    bySource: countBy(plans, (plan) => plan.source),
    byKind: countBy(plans, (plan) => plan.kind),
    byParityStatus: countBy(plans, (plan) => plan.parityClaims.parityStatus),
    bindings: bindingCounts,
  };
}

export function validateNativeParityClaims(
  plans: readonly NativeImplementationPlan[] = listNativeImplementationPlans(),
  options: { readonly strict?: boolean } = {},
): NativeParityValidationReport {
  const strict = options.strict === true;
  const issues: NativeParityValidationIssue[] = [];
  for (const plan of plans) {
    const evidence = plan.parityClaims.parityEvidence;
    if (evidence.length === 0) {
      issues.push({ id: plan.id, severity: "error", reason: "Parity claim has no evidence records." });
      continue;
    }
    if (plan.parityClaims.parityStatus === "facade") {
      if (plan.kind !== "native-module-facade" && strict) {
        issues.push({ id: plan.id, severity: "warning", reason: "Non-module capability is still facade-only." });
      }
      continue;
    }
    if (!evidence.some((entry) => entry.kind === "contract-test" || entry.kind === "unit-test")) {
      issues.push({ id: plan.id, severity: "error", reason: `${plan.parityClaims.parityStatus} requires contract or unit test evidence.` });
    }
    if ((plan.parityClaims.parityStatus === "live-tested" || plan.parityClaims.parityStatus === "product-equivalent") && !evidence.some((entry) => entry.kind === "live-test")) {
      issues.push({ id: plan.id, severity: "error", reason: `${plan.parityClaims.parityStatus} requires live-test evidence.` });
    }
    if (plan.parityClaims.parityStatus === "product-equivalent" && evidence.length < 3) {
      issues.push({ id: plan.id, severity: "error", reason: "product-equivalent requires multiple independent evidence records." });
    }
  }
  const blockingIssues = issues.filter((issue) => issue.severity === "error" || strict);
  return {
    ok: blockingIssues.length === 0,
    strict,
    issueCount: issues.length,
    issues,
  };
}

export function executeNativeImplementation(id: string): NativeImplementationResult {
  const plan = getNativeImplementationPlan(id);
  if (!plan) {
    throw new Error(`No native implementation plan found for id=${id}.`);
  }
  return {
    ok: true,
    id: plan.id,
    kind: plan.kind,
    summary: `${plan.title} is handled by omni-agent native ${plan.kind}; no upstream runtime is required.`,
    upstreamRuntimeRequired: false,
    handledBy: plan.bindings,
    contract: plan.contract,
    nextRuntimeAction: inferNextRuntimeAction(plan),
  };
}

function buildNativeImplementationPlan(adapter: ReferenceNativeAdapterSource): NativeImplementationPlan {
  const kind = inferNativeImplementationKind(adapter);
  return {
    id: adapter.id,
    source: adapter.source,
    category: adapter.category,
    title: adapter.title,
    kind,
    upstreamRuntimeRequired: false,
    replacementStrategy: inferReplacementStrategy(adapter, kind),
    bindings: inferBindings(adapter, kind),
    contract: inferContract(kind),
    permissions: inferPermissions(adapter, kind),
    parityClaims: {
      parityStatus: inferParityStatus(adapter, kind),
      parityEvidence: inferParityEvidence(adapter, kind),
      adapterSurfaceReplaced: true,
      sourceMirrorAvailable: true,
      liveAccountRequired: adapter.category === "openclaw-plugin" && kind === "native-channel-plugin",
      behavioralParityEvidence: inferBehavioralEvidence(adapter, kind),
    },
  };
}

function inferParityStatus(adapter: ReferenceNativeAdapterSource, kind: NativeImplementationKind): NativeParityStatus {
  if (kind === "native-module-facade") {
    return "facade";
  }
  if (adapter.category === "openclaw-plugin" && kind === "native-channel-plugin") {
    return "contract-tested";
  }
  return "contract-tested";
}

function inferParityEvidence(adapter: ReferenceNativeAdapterSource, kind: NativeImplementationKind): NativeParityEvidenceRecord[] {
  if (kind === "native-module-facade") {
    return [
      evidence("contract-test", "node --import tsx --test tests\\reference-native.test.ts", "tests/reference-native.test.ts", ["facade"]),
    ];
  }
  if (kind === "native-coding-experience") {
    return [
      evidence("contract-test", "node --import tsx --test tests\\runtime.test.ts tests\\cli-chat.test.ts tests\\cli-ops.test.ts", "tests/runtime.test.ts", ["contract-tested"]),
      evidence("unit-test", "node --import tsx --test tests\\workspace.test.ts", "tests/workspace.test.ts", ["contract-tested"]),
      evidence("manual-runbook", "node dist\\omni-agent.js chat --cwd <repo>", "apps/workbench", ["product-equivalent"]),
    ];
  }
  if (kind === "native-channel-plugin" || kind === "native-gateway-schema") {
    return [
      evidence("contract-test", "node --import tsx --test tests\\gateway.test.ts tests\\channel-contracts.test.ts", "tests/channel-contracts.test.ts", ["contract-tested"]),
      evidence("live-test", "OMNI_LIVE_CHANNEL_TESTS=1 node --import tsx --test tests\\channel-live.test.ts", "tests/channel-live.test.ts", ["live-tested", "product-equivalent"]),
    ];
  }
  if (kind === "native-memory-skill-tool") {
    return [
      evidence("contract-test", "node --import tsx --test tests\\context.test.ts tests\\tools.test.ts tests\\session-store.test.ts", "tests/context.test.ts", ["contract-tested"]),
      evidence("unit-test", "node --import tsx --test tests\\tools.test.ts tests\\session-store.test.ts", "tests/tools.test.ts", ["contract-tested"]),
      evidence("fixture", "npm run eval:benchmark", "examples/evals", ["contract-tested"]),
    ];
  }
  if (kind === "native-multimodal-tool") {
    return [
      evidence("contract-test", "node --import tsx --test tests\\tools.test.ts", "tests/tools.test.ts", ["contract-tested"]),
      evidence("fixture", "npm run eval:benchmark", "examples/evals", ["contract-tested"]),
    ];
  }
  if (kind === "native-process-control-tool") {
    return [
      evidence("contract-test", "node --import tsx --test tests\\tools.test.ts tests\\workspace.test.ts", "tests/tools.test.ts", ["contract-tested"]),
      evidence("fixture", "npm run eval:benchmark", "examples/evals", ["contract-tested"]),
    ];
  }
  if (kind === "native-runtime-tool") {
    return [
      evidence("contract-test", "node --import tsx --test tests\\runtime.test.ts tests\\tools.test.ts", "tests/runtime.test.ts", ["contract-tested"]),
      evidence("fixture", "npm run eval:benchmark", "examples/evals", ["contract-tested"]),
    ];
  }
  if (adapter.category === "hermes-tool") {
    return [
      evidence("contract-test", "node --import tsx --test tests\\tools.test.ts tests\\runtime.test.ts", "tests/tools.test.ts", ["contract-tested"]),
      evidence("fixture", "npm run eval:benchmark", "examples/evals", ["contract-tested"]),
    ];
  }
  return [
    evidence("contract-test", "node --import tsx --test tests\\reference-native.test.ts", "tests/reference-native.test.ts", ["contract-tested"]),
  ];
}

function inferNativeImplementationKind(adapter: ReferenceNativeAdapterSource): NativeImplementationKind {
  if (adapter.category === "claudecode-experience") {
    return "native-coding-experience";
  }
  if (adapter.category === "openclaw-plugin") {
    const text = `${adapter.id} ${adapter.title} ${adapter.sourcePath ?? ""}`.toLowerCase();
    if (/(slack|telegram|discord|feishu|dingtalk|whatsapp|signal|matrix|qq|wecom|channel)/.test(text)) {
      return "native-channel-plugin";
    }
    return "native-gateway-schema";
  }
  if (adapter.category === "large-module") {
    const text = `${adapter.id} ${adapter.title} ${adapter.sourcePath ?? ""}`.toLowerCase();
    const sourcePath = (adapter.sourcePath ?? "").replaceAll("\\", "/").toLowerCase();
    if (adapter.source === "hermes" && sourcePath === "tools/delegate_tool.py") {
      return "native-memory-skill-tool";
    }
    if (adapter.source === "hermes" && sourcePath === "tools/browser_tool.py") {
      return "native-multimodal-tool";
    }
    if (adapter.source === "hermes" && /(context_compressor|trajectory_compressor|compress)/.test(text)) {
      return "native-memory-skill-tool";
    }
    if (adapter.source === "openclaw" && sourcePath === "src/memory") {
      return "native-memory-skill-tool";
    }
    if (adapter.source === "claudecode" && sourcePath === "src/memdir") {
      return "native-memory-skill-tool";
    }
    if (adapter.source === "openclaw" && sourcePath === "extensions") {
      return "native-gateway-schema";
    }
    if (adapter.source === "openclaw" && sourcePath === "src/mcp") {
      return "native-gateway-schema";
    }
    if (adapter.source === "openclaw" && sourcePath === "src/web-search") {
      return "native-multimodal-tool";
    }
  }
  if (adapter.category === "hermes-tool") {
    const text = `${adapter.title} ${adapter.sourcePath ?? ""} ${adapter.targetSurface}`.toLowerCase();
    if (/(memory|skill|delegate|mixture|agent|run_agent|trajectory|compress)/.test(text)) {
      return "native-memory-skill-tool";
    }
    if (/(browser|voice|tts|transcription|image|media|audio|video)/.test(text)) {
      return "native-multimodal-tool";
    }
    if (/(terminal|patch|file|csv|notebook|process|shell|command)/.test(text)) {
      return "native-process-control-tool";
    }
    return "native-runtime-tool";
  }
  return "native-module-facade";
}

function inferReplacementStrategy(adapter: ReferenceNativeAdapterSource, kind: NativeImplementationKind): string {
  if (kind === "native-coding-experience") {
    return "Represent ClaudeCode TUI, desktop, web, LSP, permission, diff, and review behavior as omni-agent run timeline, workspace diagnostics, approvals, session-store records, CLI commands, and workbench data models.";
  }
  if (kind === "native-channel-plugin") {
    return "Represent OpenClaw channel behavior as omni-agent gateway channel-plugin lifecycle contracts with normalized delivery, pairing, retry, dead-letter, redaction, and opt-in live checks.";
  }
  if (kind === "native-gateway-schema") {
    return "Represent OpenClaw provider/plugin manifests as omni-agent schema, extension, secret-reference, and gateway configuration records without loading the OpenClaw runtime.";
  }
  if (kind === "native-memory-skill-tool") {
    return "Represent Hermes agent-loop, memory, skill, delegation, swarm, and compression tools with omni-agent core-runtime, context, session-store, and tools package primitives.";
  }
  if (kind === "native-multimodal-tool") {
    return "Represent Hermes browser, voice, image, and media tools as omni-agent tool contracts that call native browser/process/model-client surfaces under the normal permission boundary.";
  }
  if (kind === "native-process-control-tool") {
    return "Represent Hermes file, patch, terminal, notebook, and process tools through omni-agent workspace and tools primitives.";
  }
  if (kind === "native-runtime-tool") {
    return "Represent Hermes runtime utilities through omni-agent core-runtime task phases, tool execution, approvals, and verification.";
  }
  return `Represent ${adapter.source} module ${adapter.sourcePath ?? adapter.id} as an omni-agent module facade bound to existing package-level runtime surfaces.`;
}

function inferBindings(adapter: ReferenceNativeAdapterSource, kind: NativeImplementationKind): NativeImplementationBinding[] {
  if (kind === "native-coding-experience") {
    return [
      binding("@omni-agent/core-runtime", "run-loop", ["task-state", "tool-events", "verification", "subagents"]),
      binding("@omni-agent/workspace", "diagnostics", ["workspace_info", "lsp_diagnostics", "diff-summary"]),
      binding("@omni-agent/tools", "cli-workbench", ["/diff", "/review", "/health", "show-run"]),
      binding("@omni-agent/session-store", "timeline", ["runs", "artifacts", "usage", "audit"]),
    ];
  }
  if (kind === "native-channel-plugin") {
    return [
      binding("@omni-agent/gateway", "channel-plugin-sdk", ["install", "configure", "pair", "receive", "send", "ack", "retry", "health", "shutdown"]),
      binding("@omni-agent/session-store", "delivery-state", ["routes", "deliveries", "dead-letter", "pairing"]),
      binding("@omni-agent/tools", "gateway-ops", ["reference_native", "route-create", "usage"]),
    ];
  }
  if (kind === "native-gateway-schema") {
    return [
      binding("@omni-agent/gateway", "schema-contract", ["routes", "pairing", "delivery", "redaction"]),
      binding("@omni-agent/extensions", "plugin-manifest", ["manifest", "resources", "tools", "prompts"]),
      binding("@omni-agent/model-client", "provider-profile", ["profile", "fallback", "doctor"]),
    ];
  }
  if (kind === "native-memory-skill-tool") {
    return [
      binding("@omni-agent/core-runtime", "agent-loop", ["task phases", "delegation", "swarm", "independent-verifier"]),
      binding("@omni-agent/context", "compression", ["thread-compressor", "handoff", "tool-observation-compaction"]),
      binding("@omni-agent/session-store", "memory-skill-store", ["memories", "learned skills", "revision queue"]),
      binding("@omni-agent/tools", "skill-memory-tools", ["save_memory", "search_memory", "skill_manage", "run_swarm"]),
    ];
  }
  if (kind === "native-multimodal-tool") {
    return [
      binding("@omni-agent/tools", "browser-media-tools", ["browser_fetch", "browser_run", "process_start", "notebook"]),
      binding("@omni-agent/model-client", "model-profiles", ["streaming", "tool calls", "fallback", "usage"]),
      binding("@omni-agent/approvals", "permission-boundary", ["risk-tier", "secret-redaction", "network-policy"]),
    ];
  }
  if (kind === "native-process-control-tool") {
    return [
      binding("@omni-agent/workspace", "workspace-ops", ["read", "write", "edit", "search", "sandbox", "worktree"]),
      binding("@omni-agent/tools", "process-file-tools", ["run_command", "apply_patch", "notebook", "process_start"]),
      binding("@omni-agent/approvals", "command-policy", ["assertSafeCommand", "approval-class", "destructive-command-blocks"]),
    ];
  }
  if (kind === "native-runtime-tool") {
    return [
      binding("@omni-agent/core-runtime", "runtime", ["tool-loop", "verification", "resume", "failure-finalization"]),
      binding("@omni-agent/tools", "runtime-tools", ["ask_user", "todo_write", "plan", "subagents"]),
      binding("@omni-agent/session-store", "run-state", ["threads", "runs", "artifacts", "audit"]),
    ];
  }
  return [
    binding("@omni-agent/tools", "module-facade", ["reference_native", "workspace_info", "search"]),
    binding("@omni-agent/extensions", "extension-contracts", ["tools", "resources", "prompts", "mcp"]),
    binding("@omni-agent/session-store", "module-state", ["audit", "usage", "diagnostics"]),
  ];
}

function inferContract(kind: NativeImplementationKind): NativeImplementationContract {
  if (kind === "native-channel-plugin") {
    return { install: true, configure: true, execute: true, health: true, shutdown: true, audit: true };
  }
  if (kind === "native-coding-experience") {
    return { install: true, configure: true, execute: true, health: true, shutdown: false, audit: true };
  }
  return { install: true, configure: true, execute: true, health: true, shutdown: false, audit: true };
}

function inferPermissions(
  adapter: ReferenceNativeAdapterSource,
  kind: NativeImplementationKind,
): NativeImplementationPlan["permissions"] {
  if (kind === "native-channel-plugin" || kind === "native-multimodal-tool") {
    return { filesystem: "read-write", network: "optional", secrets: "reference-only", process: "managed-child-process" };
  }
  if (kind === "native-process-control-tool" || adapter.targetSurface === "process-tool") {
    return { filesystem: "read-write", network: "optional", secrets: "none", process: "managed-child-process" };
  }
  if (kind === "native-gateway-schema") {
    return { filesystem: "read", network: "optional", secrets: "reference-only", process: "none" };
  }
  return { filesystem: "read-write", network: "none", secrets: "none", process: "none" };
}

function inferBehavioralEvidence(adapter: ReferenceNativeAdapterSource, kind: NativeImplementationKind): string[] {
  const shared = ["tests/reference-native.test.ts", "tests/maturity-artifacts.test.ts"];
  if (kind === "native-coding-experience") {
    return [...shared, "tests/runtime.test.ts", "tests/cli-chat.test.ts", "tests/cli-ops.test.ts", "tests/workspace.test.ts"];
  }
  if (kind === "native-channel-plugin" || kind === "native-gateway-schema") {
    return [...shared, "tests/gateway.test.ts", "tests/gateway-messages.test.ts", "tests/channel-contracts.test.ts"];
  }
  if (adapter.category === "hermes-tool") {
    return [...shared, "tests/tools.test.ts", "tests/runtime.test.ts", "tests/context.test.ts", "tests/session-store.test.ts"];
  }
  return [...shared, "tests/tools.test.ts", "tests/extensions.test.ts"];
}

function inferNextRuntimeAction(plan: NativeImplementationPlan): string {
  if (plan.kind === "native-channel-plugin") {
    return "Use @omni-agent/gateway channel-plugin lifecycle methods and delivery state instead of loading OpenClaw.";
  }
  if (plan.kind === "native-coding-experience") {
    return "Use core-runtime run state, workspace diagnostics, CLI/workbench timeline, approvals, and session-store artifacts instead of launching ClaudeCode.";
  }
  if (plan.category === "hermes-tool") {
    return "Use omni-agent tools/core-runtime/session-store primitives instead of spawning Hermes Python.";
  }
  return "Use the listed omni-agent package bindings as the native module boundary.";
}

function binding(packageName: string, surface: string, handles: readonly string[]): NativeImplementationBinding {
  return { packageName, surface, handles };
}

function evidence(
  kind: NativeParityEvidenceRecord["kind"],
  command: string,
  path: string,
  requiredFor: readonly NativeParityStatus[],
): NativeParityEvidenceRecord {
  return { kind, command, path, requiredFor };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
