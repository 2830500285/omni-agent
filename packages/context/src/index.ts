import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { ExecutionDomain, WorkspaceInstructionFile, WorkspaceSnapshot } from "@omni-agent/workspace";

import {
  summarizeThread,
  type StructuredThreadHandoff,
  type ThreadMessage,
  mergeThreadHandoffSummaries,
  parseStructuredThreadHandoff,
  createThreadSummarySnapshot,
  compactToolObservationsForModel,
  type ToolObservationLike,
  type ThreadSummarySnapshot,
} from "./thread-compressor.js";

export {
  summarizeThread,
  mergeThreadHandoffSummaries,
  parseStructuredThreadHandoff,
  createThreadSummarySnapshot,
  compactToolObservationsForModel,
};
export type {
  StructuredThreadHandoff,
  ThreadMessage,
  ToolObservationLike,
  ThreadSummarySnapshot,
};

export type VerificationMode = "required" | "best-effort";
export type AgentRole =
  | "primary"
  | "planner"
  | "researcher"
  | "reviewer"
  | "verifier"
  | "worker"
  | "executor"
  | "supervisor";
export type AgentRoleResponseKind = "general" | "plan" | "findings" | "review" | "verdict";
export type TaskPhase = "understanding" | "acting" | "verifying" | "repairing" | "blocked" | "done";
export type TaskVerificationStatus = "passed" | "failed" | "skipped" | "not-run";

export interface AgentRoleContract {
  readonly role: AgentRole;
  readonly defaultAuthority: "leaf" | "orchestrator";
  readonly canEditFiles: boolean;
  readonly maxToolCallsPerTurn: number;
  readonly responseKind: AgentRoleResponseKind;
  readonly guidance: string[];
  readonly responseInstructions: string[];
  readonly defaultAllowedTools?: readonly string[];
}

export interface AgentPlaybook {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly recommendedRoles: readonly AgentRole[];
  readonly triggerSignals: readonly string[];
  readonly guidance: readonly string[];
  readonly procedure: readonly string[];
}

export interface AgentCapabilityProfileToolPolicyRule {
  readonly allowTools?: readonly string[];
  readonly denyTools?: readonly string[];
}

export interface AgentCapabilityProfileToolPolicy {
  readonly global?: AgentCapabilityProfileToolPolicyRule;
  readonly runtime?: AgentCapabilityProfileToolPolicyRule;
  readonly roles?: Partial<Record<AgentRole, AgentCapabilityProfileToolPolicyRule>>;
}

export interface AgentCapabilityProfile {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly agentType: string;
  readonly defaultRole: AgentRole;
  readonly mode: "default" | "bound" | "shared" | "locked_down";
  readonly contextEngineId: "default" | "compact" | "delegation";
  readonly memoryProviderIds: readonly string[];
  readonly verificationMode: VerificationMode;
  readonly maxIterations: number;
  readonly defaultInstructions: readonly string[];
  readonly toolPolicy?: AgentCapabilityProfileToolPolicy;
  readonly recommendedEvalCategories?: readonly string[];
  readonly recommendedPlaybookIds: readonly string[];
  readonly alignedProjects: readonly string[];
}

export interface TaskContract {
  readonly objective: string;
  readonly agentRole?: AgentRole;
  readonly workspaceId: string;
  readonly threadId: string;
  readonly cwd: string;
  readonly successCriteria: string[];
  readonly constraints: string[];
  readonly verificationMode: VerificationMode;
  readonly preferredExecutionDomain: ExecutionDomain;
}

export interface ExecutionContext {
  readonly taskContract: TaskContract;
  readonly workspaceSnapshot: WorkspaceSnapshot;
  readonly workspaceInstructions: WorkspaceInstructionFile[];
  readonly taskState: TaskState;
  readonly taskSceneSummary: string;
  readonly threadSummary: string;
  readonly repoSummary: string;
  readonly systemPrompt: string;
  readonly promptSections: string[];
}

export interface TaskVerificationSnapshot {
  readonly status: TaskVerificationStatus;
  readonly summary: string;
}

export interface TaskState {
  readonly phase: TaskPhase;
  readonly currentGoal: string;
  readonly completedSubgoals: string[];
  readonly pendingSubgoals: string[];
  readonly recentFailureReason?: string | null;
  readonly latestVerification: TaskVerificationSnapshot;
}

export interface ContextEngineStatus {
  readonly engineId: string;
  readonly maintenanceCycles: number;
  readonly compactionCount: number;
  readonly deferredCompaction: boolean;
  readonly estimatedPromptTokens: number;
  readonly promptBudgetTokens: number;
  readonly recentSubagentOutcomeCount: number;
}

export interface ContextEngineDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly ownsCompaction: boolean;
  readonly ownsBudgetPolicy: boolean;
  readonly supportsSubagentHooks: boolean;
  readonly defaultPromptBudgetTokens: number;
  readonly defaultSubagentNoteLimit: number;
  readonly defaultExtraInstructionLimit: number;
  readonly statusSchema: readonly string[];
}

export interface ContextEngineConfig {
  readonly engineId?: string;
  readonly promptBudgetTokens?: number;
  readonly subagentNoteLimit?: number;
  readonly extraInstructionLimit?: number;
}

export interface ContextEngineState {
  readonly taskContract: TaskContract;
  readonly workspaceSnapshot: WorkspaceSnapshot;
  readonly threadMessages: ThreadMessage[];
  readonly previousThreadSummary?: string | null;
  readonly workspaceInstructions: WorkspaceInstructionFile[];
  readonly extraInstructions: string[];
  readonly subagentOutcomeNotes: string[];
  readonly subagentOutcomeArchiveSummary?: string | null;
  readonly phaseHistory: TaskPhase[];
  readonly taskState: TaskState;
  readonly engineStatus: ContextEngineStatus;
}

export interface ContextEngineUpdate {
  readonly workspaceSnapshot?: WorkspaceSnapshot;
  readonly workspaceInstructions?: WorkspaceInstructionFile[];
  readonly extraInstructions?: string[];
  readonly taskState?: TaskState;
}

export interface ContextEngineSubagentSpawnInput {
  readonly objective: string;
  readonly role?: string | null;
  readonly depth: number;
  readonly maxDepth: number;
  readonly parentJobId?: string | null;
  readonly rootJobId?: string | null;
}

export interface ContextEngineSubagentOutcomeInput {
  readonly objective: string;
  readonly role?: string | null;
  readonly status: string;
  readonly verificationStatus?: string | null;
  readonly changedFiles?: readonly string[];
  readonly finalResponse?: string | null;
  readonly error?: string | null;
}

export interface ContextEngine {
  bootstrap(input: {
    readonly taskContract: TaskContract;
    readonly workspaceSnapshot: WorkspaceSnapshot;
    readonly threadMessages: ThreadMessage[];
    readonly previousThreadSummary?: string | null;
    readonly workspaceInstructions?: WorkspaceInstructionFile[];
    readonly extraInstructions?: string[];
    readonly taskState?: TaskState;
  }): ExecutionContext;
  ingest(update?: ContextEngineUpdate): ExecutionContext;
  afterTurn(update?: ContextEngineUpdate): ExecutionContext;
  compact(update?: ContextEngineUpdate): ExecutionContext;
  maintain(update?: ContextEngineUpdate): ExecutionContext;
  prepareSubagentSpawn(input: ContextEngineSubagentSpawnInput): string[];
  onSubagentEnded(input: ContextEngineSubagentOutcomeInput): ExecutionContext;
  render(): ExecutionContext;
  getState(): Readonly<ContextEngineState>;
  getStatus(): Readonly<ContextEngineStatus>;
}

export interface ContextEngineBootstrapInput {
  readonly taskContract: TaskContract;
  readonly workspaceSnapshot: WorkspaceSnapshot;
  readonly threadMessages: ThreadMessage[];
  readonly previousThreadSummary?: string | null;
  readonly workspaceInstructions?: WorkspaceInstructionFile[];
  readonly extraInstructions?: string[];
  readonly taskState?: TaskState;
  readonly config?: ContextEngineConfig;
}

export type ContextEngineFactory = (input: ContextEngineBootstrapInput) => ContextEngine;

const DEFAULT_REPO_LIST_LIMIT = 8;
const DEFAULT_REPO_LIST_MAX_CHARS = 260;
const DEFAULT_REPO_LIST_MAX_CHARS_PER_ITEM = 72;
const DEFAULT_WORKSPACE_INSTRUCTION_LIMIT = 6;
const DEFAULT_WORKSPACE_INSTRUCTION_MAX_CHARS = 2_800;
const DEFAULT_WORKSPACE_INSTRUCTION_MAX_CHARS_PER_FILE = 850;
const DEFAULT_EXTRA_INSTRUCTION_LIMIT = 6;
const DEFAULT_EXTRA_INSTRUCTION_MAX_CHARS = 1_700;
const DEFAULT_EXTRA_INSTRUCTION_MAX_CHARS_PER_SECTION = 600;
const DEFAULT_TASK_SCENE_MAX_CHARS = 1_500;
const DEFAULT_TASK_SUBGOAL_LIMIT = 5;
const DEFAULT_ATTACHED_CONTEXT_REF_LIMIT = 8;
const DEFAULT_ATTACHED_CONTEXT_TOTAL_MAX_CHARS = 4_500;
const DEFAULT_ATTACHED_CONTEXT_FILE_MAX_CHARS = 1_200;
const DEFAULT_ATTACHED_CONTEXT_FILE_READ_BYTES = 24_000;
const DEFAULT_ATTACHED_CONTEXT_FOLDER_MAX_CHARS = 1_200;
const DEFAULT_ATTACHED_CONTEXT_FOLDER_ENTRY_LIMIT = 40;
const DEFAULT_ATTACHED_CONTEXT_FOLDER_DEPTH = 2;
const DEFAULT_ATTACHED_CONTEXT_DIFF_MAX_CHARS = 1_600;
const DEFAULT_CONTEXT_ENGINE_SUBAGENT_NOTE_LIMIT = 4;
const DEFAULT_CONTEXT_ENGINE_HANDOFF_SECTION_MAX_CHARS = 720;
const DEFAULT_CONTEXT_ENGINE_SUBAGENT_NOTE_MAX_CHARS = 260;
const DEFAULT_CONTEXT_ENGINE_PROMPT_BUDGET_TOKENS = 2_000;
const COMPACT_CONTEXT_ENGINE_PROMPT_BUDGET_TOKENS = 1_400;
const DELEGATION_CONTEXT_ENGINE_PROMPT_BUDGET_TOKENS = 2_600;
const READ_ONLY_ROLE_TOOL_ALLOWLIST = [
  "apply_skills",
  "ask_user",
  "collect_subagent_artifacts",
  "git_status",
  "list_tasks",
  "list_directory",
  "lsp_diagnostics",
  "notebook_read",
  "process_list",
  "process_read",
  "read_file",
  "read_plan",
  "run_verification",
  "search_agent_playbooks",
  "search_agent_roles",
  "search_files",
  "search_workspace_skills",
  "search_learned_skills",
  "search_memory",
  "search_profile",
  "search_sessions",
  "search_text",
  "search_tools",
  "select_skills",
  "skills_list",
  "tool_search",
  "workspace_info",
] as const;
const PLANNER_ROLE_TOOL_ALLOWLIST = [
  ...READ_ONLY_ROLE_TOOL_ALLOWLIST,
  "cancel_subagent",
  "delegate_task",
  "list_subagents",
  "message_subagent",
  "run_swarm",
  "spawn_subagent",
  "subagents",
  "wait_any_subagent",
  "wait_subagent",
] as const;
const EXECUTION_ROLE_TOOL_ALLOWLIST = [
  "apply_skills",
  "ask_user",
  "git_diff",
  "git_status",
  "list_directory",
  "list_tasks",
  "lsp_diagnostics",
  "notebook_read",
  "notebook_replace_cell",
  "process_list",
  "process_read",
  "process_start",
  "process_stop",
  "python_execute",
  "read_file",
  "read_plan",
  "replace_file_range",
  "run_command",
  "run_verification",
  "search_agent_playbooks",
  "search_agent_roles",
  "search_files",
  "search_workspace_skills",
  "search_learned_skills",
  "search_memory",
  "search_profile",
  "search_sessions",
  "search_text",
  "search_tools",
  "select_skills",
  "skills_list",
  "tool_search",
  "workspace_info",
  "write_file",
] as const;
const AGENT_CAPABILITY_PROFILES: readonly AgentCapabilityProfile[] = [
  {
    id: "claude-coding-operator",
    label: "Claude-style Coding Operator",
    description:
      "Deep coding agent profile for surgical implementation, workspace awareness, verification, and repair loops.",
    agentType: "coding-operator",
    defaultRole: "executor",
    mode: "bound",
    contextEngineId: "compact",
    memoryProviderIds: ["builtin-sqlite-memory-provider", "hybrid-memory-provider"],
    verificationMode: "required",
    maxIterations: 12,
    defaultInstructions: [
      "Operate as a thick coding agent: inspect the repository before editing, state assumptions when ambiguity changes implementation risk, and keep changes surgical.",
      "Prefer the smallest code path that satisfies the task, remove only dead code introduced by this change, and preserve unrelated user edits.",
      "After mutating files, run the most relevant verification command available and repair regressions before finalizing.",
    ],
    toolPolicy: {
      roles: {
        executor: { allowTools: EXECUTION_ROLE_TOOL_ALLOWLIST },
        worker: { allowTools: EXECUTION_ROLE_TOOL_ALLOWLIST },
        reviewer: { allowTools: READ_ONLY_ROLE_TOOL_ALLOWLIST },
        verifier: { allowTools: READ_ONLY_ROLE_TOOL_ALLOWLIST },
      },
    },
    recommendedEvalCategories: ["coding_fix", "verification_repair"],
    recommendedPlaybookIds: ["code-change", "bug-fix", "review"],
    alignedProjects: ["claudecode-source"],
  },
  {
    id: "hermes-self-improver",
    label: "Hermes-style Self Improver",
    description:
      "Self-improving agent profile that couples task execution with memory capture, learned-skill promotion, and post-run reflection.",
    agentType: "self-improving-agent",
    defaultRole: "supervisor",
    mode: "shared",
    contextEngineId: "delegation",
    memoryProviderIds: ["builtin-sqlite-memory-provider", "hybrid-memory-provider"],
    verificationMode: "best-effort",
    maxIterations: 12,
    defaultInstructions: [
      "Treat each task as an opportunity to improve the agent: search prior memory and skills first, then capture durable lessons after meaningful work.",
      "Promote repeatable patterns into learned skills when they are specific, reusable, and verified by the current task; repeated verified patterns should become workspace skills.",
      "Separate durable knowledge from transient observations; avoid storing secrets or low-value noise.",
    ],
    toolPolicy: {
      roles: {
        supervisor: { allowTools: PLANNER_ROLE_TOOL_ALLOWLIST },
        researcher: { allowTools: READ_ONLY_ROLE_TOOL_ALLOWLIST },
        worker: { allowTools: EXECUTION_ROLE_TOOL_ALLOWLIST },
        executor: { allowTools: EXECUTION_ROLE_TOOL_ALLOWLIST },
      },
    },
    recommendedEvalCategories: ["memory_recall", "multi_agent_investigation"],
    recommendedPlaybookIds: ["memory-capture", "skill-extraction", "delegation"],
    alignedProjects: ["hermes-agent-main"],
  },
  {
    id: "openclaw-gateway-operator",
    label: "OpenClaw-style Gateway Operator",
    description:
      "Operational assistant profile for routed inboxes, channel pairing, automations, auth profiles, and agent-scoped work queues.",
    agentType: "gateway-operator",
    defaultRole: "supervisor",
    mode: "bound",
    contextEngineId: "delegation",
    memoryProviderIds: ["builtin-sqlite-memory-provider", "hybrid-memory-provider"],
    verificationMode: "best-effort",
    maxIterations: 10,
    defaultInstructions: [
      "Handle external routed requests as agent-scoped work: preserve sender/channel context, obey pairing and auth state, and keep delivery semantics explicit.",
      "Prefer resumable automations and observable routes over one-off hidden state.",
      "When a channel action fails, record enough context for retry, cooldown, or operator handoff.",
    ],
    toolPolicy: {
      roles: {
        supervisor: { allowTools: PLANNER_ROLE_TOOL_ALLOWLIST },
        executor: { allowTools: EXECUTION_ROLE_TOOL_ALLOWLIST },
        worker: { allowTools: EXECUTION_ROLE_TOOL_ALLOWLIST },
      },
    },
    recommendedEvalCategories: ["route_handling", "multi_agent_investigation"],
    recommendedPlaybookIds: ["route-triage", "automation-maintenance", "delegation"],
    alignedProjects: ["openclaw-main"],
  },
  {
    id: "review-verifier",
    label: "Strict Review Verifier",
    description:
      "Read-only verifier profile for review findings, regression checks, and independent acceptance gates.",
    agentType: "review-verifier",
    defaultRole: "verifier",
    mode: "locked_down",
    contextEngineId: "compact",
    memoryProviderIds: ["builtin-sqlite-memory-provider"],
    verificationMode: "required",
    maxIterations: 6,
    defaultInstructions: [
      "Stay read-only unless explicitly asked to patch; findings must cite concrete files, commands, or observed behavior.",
      "Prioritize correctness, security, data loss, and behavioral regressions over style preferences.",
      "If verification cannot run, state the exact blocker and residual risk.",
    ],
    toolPolicy: {
      global: { allowTools: READ_ONLY_ROLE_TOOL_ALLOWLIST },
      roles: {
        reviewer: { allowTools: READ_ONLY_ROLE_TOOL_ALLOWLIST },
        verifier: { allowTools: READ_ONLY_ROLE_TOOL_ALLOWLIST },
      },
    },
    recommendedEvalCategories: ["verification_repair", "single_agent_bugfix"],
    recommendedPlaybookIds: ["review", "verification"],
    alignedProjects: ["claudecode-source", "hermes-agent-main"],
  },
  {
    id: "research-analyst",
    label: "Evidence Research Analyst",
    description:
      "Read-mostly research profile for repository discovery, source-grounded comparisons, and structured evidence reports.",
    agentType: "research-analyst",
    defaultRole: "researcher",
    mode: "shared",
    contextEngineId: "compact",
    memoryProviderIds: ["builtin-sqlite-memory-provider", "hybrid-memory-provider"],
    verificationMode: "best-effort",
    maxIterations: 8,
    defaultInstructions: [
      "Collect evidence before conclusions; distinguish observed facts from inference.",
      "Keep outputs source-grounded and call out unknowns instead of overclaiming.",
      "Capture reusable findings into memory when they will improve future tasks in this workspace.",
    ],
    toolPolicy: {
      global: { allowTools: READ_ONLY_ROLE_TOOL_ALLOWLIST },
      roles: {
        researcher: { allowTools: READ_ONLY_ROLE_TOOL_ALLOWLIST },
      },
    },
    recommendedEvalCategories: ["memory_recall", "long_context_modification"],
    recommendedPlaybookIds: ["research", "comparison"],
    alignedProjects: ["claudecode-source", "hermes-agent-main", "openclaw-main"],
  },
] as const;
const AGENT_ROLE_CONTRACTS: Record<AgentRole, AgentRoleContract> = {
  primary: {
    role: "primary",
    defaultAuthority: "leaf",
    canEditFiles: true,
    maxToolCallsPerTurn: 3,
    responseKind: "general",
    guidance: [],
    responseInstructions: [
      "Use ordinary execution summaries when the task is complete.",
      "If the task is blocked or ambiguous, ask for clarification instead of guessing.",
    ],
  },
  planner: {
    role: "planner",
    defaultAuthority: "orchestrator",
    canEditFiles: false,
    maxToolCallsPerTurn: 2,
    responseKind: "plan",
    guidance: [
      "Break the task into the smallest useful steps before taking action.",
      "Delegate only when the decomposition materially improves quality or speed.",
      "Inspect the available roles, tools, and playbooks before proposing delegation so the plan matches real runtime capability.",
    ],
    responseInstructions: [
      "Return a structured plan.",
      "Start the final response with 'PLAN_STATUS: READY' or 'PLAN_STATUS: BLOCKED'.",
      "Include a 'SUMMARY:' line that states the intended execution strategy.",
      "Include a 'STEPS:' section with flat bullet points.",
      "If delegation is warranted, include the intended role, scope, and verification expectation for each delegated step.",
    ],
    defaultAllowedTools: PLANNER_ROLE_TOOL_ALLOWLIST,
  },
  supervisor: {
    role: "supervisor",
    defaultAuthority: "orchestrator",
    canEditFiles: false,
    maxToolCallsPerTurn: 4,
    responseKind: "plan",
    guidance: [
      "Coordinate work across subagents, keep the plan coherent, and only delegate when orchestration improves the result.",
      "Prefer explicit ownership, bounded scopes, and verification checkpoints over broad or overlapping delegation.",
    ],
    responseInstructions: [
      "Return a structured dispatch decision.",
      "Start the final response with 'PLAN_STATUS: READY' or 'PLAN_STATUS: BLOCKED'.",
      "Include 'SUMMARY:' and 'STEPS:' sections.",
      "For each child task, state the role, the expected deliverable, and the verification or evidence the parent should wait for.",
    ],
    defaultAllowedTools: PLANNER_ROLE_TOOL_ALLOWLIST,
  },
  researcher: {
    role: "researcher",
    defaultAuthority: "leaf",
    canEditFiles: false,
    maxToolCallsPerTurn: 4,
    responseKind: "findings",
    guidance: [
      "Prefer repository inspection, evidence gathering, and concise handoff notes over making edits.",
      "Cite concrete files, symbols, commands, or outputs instead of general impressions.",
    ],
    responseInstructions: [
      "Return structured findings.",
      "Start the final response with 'FINDINGS_STATUS: READY' or 'FINDINGS_STATUS: BLOCKED'.",
      "Include 'FINDINGS:' and 'EVIDENCE:' sections.",
      "Keep evidence tightly scoped to the findings that matter for the parent task.",
    ],
    defaultAllowedTools: READ_ONLY_ROLE_TOOL_ALLOWLIST,
  },
  reviewer: {
    role: "reviewer",
    defaultAuthority: "leaf",
    canEditFiles: false,
    maxToolCallsPerTurn: 3,
    responseKind: "review",
    guidance: [
      "Review critically, highlight concrete risks, and avoid speculative edits unless they are explicitly requested.",
      "Treat missing evidence or unverified behavior as a review risk, not as a harmless omission.",
    ],
    responseInstructions: [
      "Return a structured review.",
      "Start the final response with 'REVIEW_STATUS: PASS', 'REVIEW_STATUS: ISSUES_FOUND', or 'REVIEW_STATUS: NEEDS_INPUT'.",
      "Include 'SUMMARY:' and 'FINDINGS:' sections.",
      "List the highest-severity findings first and tie each finding to concrete evidence.",
    ],
    defaultAllowedTools: READ_ONLY_ROLE_TOOL_ALLOWLIST,
  },
  verifier: {
    role: "verifier",
    defaultAuthority: "leaf",
    canEditFiles: false,
    maxToolCallsPerTurn: 3,
    responseKind: "verdict",
    guidance: [
      "Act as an independent verifier and do not modify files.",
      "Inspect the current state, run verification when possible, and return a structured verdict.",
      "If reproduction or verification evidence is missing, fail closed instead of inferring success.",
    ],
    responseInstructions: [
      "Start the final response with 'VERDICT: PASS', 'VERDICT: FAIL', or 'VERDICT: NEEDS_MORE_WORK'.",
      "Include a 'RATIONALE:' line with concrete evidence.",
      "Name the command, artifact, or observation that justifies the verdict.",
    ],
    defaultAllowedTools: READ_ONLY_ROLE_TOOL_ALLOWLIST,
  },
    worker: {
      role: "worker",
      defaultAuthority: "leaf",
      canEditFiles: true,
      maxToolCallsPerTurn: 4,
    responseKind: "general",
    guidance: [
      "Stay tightly scoped to the assigned subtask and return only the evidence needed by the parent agent.",
      "Prefer the smallest verified change set that satisfies the assigned objective.",
    ],
      responseInstructions: [
        "Return a concise execution summary focused on the assigned subtask.",
        "Include the changed files and fresh verification evidence when files were modified.",
      ],
      defaultAllowedTools: EXECUTION_ROLE_TOOL_ALLOWLIST,
    },
    executor: {
      role: "executor",
      defaultAuthority: "leaf",
      canEditFiles: true,
    maxToolCallsPerTurn: 4,
    responseKind: "general",
    guidance: [
      "Execute the assigned task directly, keep the scope narrow, and return the evidence needed by the parent agent.",
      "When the task is risky or ambiguous, stop early with a concrete blocker instead of widening scope.",
    ],
      responseInstructions: [
        "Return a concise execution summary focused on the assigned subtask.",
        "Include the changed files and fresh verification evidence when files were modified.",
      ],
      defaultAllowedTools: EXECUTION_ROLE_TOOL_ALLOWLIST,
    },
};

const AGENT_PLAYBOOKS: readonly AgentPlaybook[] = [
  {
    id: "plan-decompose-dispatch",
    name: "Decompose And Dispatch",
    description: "Break a task into bounded steps, map each step to a role, and define explicit verification expectations.",
    recommendedRoles: ["planner", "supervisor", "primary"],
    triggerSignals: ["plan", "delegate", "delegation", "subagent", "swarm", "parallel", "compare", "comparison", "coordinate", "verification"],
    guidance: [
      "Do not delegate until the task has been decomposed into bounded units with clear owners.",
      "Prefer explicit verification expectations for every child task so the parent can judge completion quickly.",
    ],
    procedure: [
      "Summarize the objective and the success condition in one sentence.",
      "Split the task into the smallest steps that materially reduce ambiguity or parallelize work.",
      "Assign each step a role, expected deliverable, and verification expectation.",
      "Keep child scopes disjoint unless the parent explicitly wants competing approaches.",
    ],
  },
  {
    id: "evidence-first-verification",
    name: "Evidence-First Verification",
    description: "Require fresh evidence before declaring a fix or review result complete.",
    recommendedRoles: ["verifier", "reviewer", "worker", "executor", "primary"],
    triggerSignals: ["verify", "verification", "validated", "test", "regression", "review", "bug", "fix", "patch"],
    guidance: [
      "Fail closed when evidence is missing, stale, or unrelated to the changed behavior.",
      "Prefer direct commands, diffs, and observed outputs over narrative claims.",
    ],
    procedure: [
      "Reproduce or inspect the relevant state before changing the verdict.",
      "Run the narrowest meaningful verification command or inspection step.",
      "Record the command, artifact, or observation that supports the conclusion.",
      "Report PASS only when the evidence matches the requested behavior.",
    ],
  },
  {
    id: "repo-research-handoff",
    name: "Repository Research Handoff",
    description: "Gather evidence from the repository and hand it off in a compact, citation-heavy format.",
    recommendedRoles: ["researcher", "reviewer", "planner", "primary"],
    triggerSignals: ["analyze", "inspect", "compare", "comparison", "research", "audit", "architecture", "understand"],
    guidance: [
      "Evidence should stay close to the files, symbols, commands, or outputs that support the claim.",
      "Do not turn repository inspection into open-ended exploration without a handoff goal.",
    ],
    procedure: [
      "Identify the files, directories, or symbols most likely to contain the answer.",
      "Inspect only the relevant slices needed to support the claim.",
      "Summarize findings in claim-then-evidence order with concrete paths or commands.",
      "Call out uncertainty explicitly when the evidence is incomplete.",
    ],
  },
  {
    id: "focused-execution-loop",
    name: "Focused Execution Loop",
    description: "Make the smallest useful change, verify it, and report the resulting evidence back to the parent.",
    recommendedRoles: ["worker", "executor", "primary"],
    triggerSignals: ["implement", "edit", "change", "repair", "refactor", "update"],
    guidance: [
      "Prefer narrow edits and short verification loops over large speculative patches.",
      "Do not claim success before re-reading the changed surface and re-running verification.",
    ],
    procedure: [
      "Read the target files or commands before editing.",
      "Apply the smallest change that satisfies the scoped objective.",
      "Re-run the narrowest relevant verification command or inspection step.",
      "Return the changed files and the fresh verification evidence.",
    ],
  },
] as const;

const BUILTIN_CONTEXT_ENGINE_DESCRIPTORS = {
  default: {
    id: "default",
    label: "Default",
    description: "Balanced context assembly for general coding runs.",
    ownsCompaction: false,
    ownsBudgetPolicy: false,
    supportsSubagentHooks: true,
    defaultPromptBudgetTokens: DEFAULT_CONTEXT_ENGINE_PROMPT_BUDGET_TOKENS,
    defaultSubagentNoteLimit: DEFAULT_CONTEXT_ENGINE_SUBAGENT_NOTE_LIMIT,
    defaultExtraInstructionLimit: DEFAULT_EXTRA_INSTRUCTION_LIMIT,
    statusSchema: [
      "engineId",
      "maintenanceCycles",
      "compactionCount",
      "deferredCompaction",
      "estimatedPromptTokens",
      "promptBudgetTokens",
      "recentSubagentOutcomeCount",
    ],
  },
  compact: {
    id: "compact",
    label: "Compact",
    description: "Aggressively compacts prompt context when the budget is under pressure.",
    ownsCompaction: true,
    ownsBudgetPolicy: true,
    supportsSubagentHooks: true,
    defaultPromptBudgetTokens: COMPACT_CONTEXT_ENGINE_PROMPT_BUDGET_TOKENS,
    defaultSubagentNoteLimit: 2,
    defaultExtraInstructionLimit: 4,
    statusSchema: [
      "engineId",
      "maintenanceCycles",
      "compactionCount",
      "deferredCompaction",
      "estimatedPromptTokens",
      "promptBudgetTokens",
      "recentSubagentOutcomeCount",
    ],
  },
  delegation: {
    id: "delegation",
    label: "Delegation",
    description: "Keeps richer sibling-outcome and handoff context for orchestration-heavy runs.",
    ownsCompaction: false,
    ownsBudgetPolicy: false,
    supportsSubagentHooks: true,
    defaultPromptBudgetTokens: DELEGATION_CONTEXT_ENGINE_PROMPT_BUDGET_TOKENS,
    defaultSubagentNoteLimit: 6,
    defaultExtraInstructionLimit: 8,
    statusSchema: [
      "engineId",
      "maintenanceCycles",
      "compactionCount",
      "deferredCompaction",
      "estimatedPromptTokens",
      "promptBudgetTokens",
      "recentSubagentOutcomeCount",
    ],
  },
} satisfies Record<string, ContextEngineDescriptor>;

interface ResolvedContextEngineConfig {
  readonly descriptor: ContextEngineDescriptor;
  readonly promptBudgetTokens: number;
  readonly subagentNoteLimit: number;
  readonly extraInstructionLimit: number;
  readonly autoCompactWhenOverBudget: boolean;
}

export function normalizeAgentRole(value: string | null | undefined): AgentRole {
  switch ((value ?? "").trim().toLowerCase()) {
    case "planner":
    case "supervisor":
    case "researcher":
    case "reviewer":
    case "verifier":
    case "worker":
    case "executor":
      return value!.trim().toLowerCase() as AgentRole;
    default:
      return "primary";
  }
}

export function getAgentRoleContract(role: AgentRole): AgentRoleContract {
  return AGENT_ROLE_CONTRACTS[role] ?? AGENT_ROLE_CONTRACTS.primary;
}

export function listAgentRoleContracts(): AgentRoleContract[] {
  return Object.values(AGENT_ROLE_CONTRACTS).map((contract) => ({
    ...contract,
    guidance: [...contract.guidance],
    responseInstructions: [...contract.responseInstructions],
    defaultAllowedTools: contract.defaultAllowedTools ? [...contract.defaultAllowedTools] : undefined,
  }));
}

export function listAgentPlaybooks(): AgentPlaybook[] {
  return AGENT_PLAYBOOKS.map((playbook) => ({
    ...playbook,
    recommendedRoles: [...playbook.recommendedRoles],
    triggerSignals: [...playbook.triggerSignals],
    guidance: [...playbook.guidance],
    procedure: [...playbook.procedure],
  }));
}

export function listAgentCapabilityProfiles(): AgentCapabilityProfile[] {
  return AGENT_CAPABILITY_PROFILES.map((profile) => cloneAgentCapabilityProfile(profile));
}

export function getAgentCapabilityProfile(profileId?: string | null): AgentCapabilityProfile | null {
  const normalized = profileId?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const profile = AGENT_CAPABILITY_PROFILES.find((entry) => entry.id === normalized);
  return profile ? cloneAgentCapabilityProfile(profile) : null;
}

export function findRelevantAgentPlaybooks(input: {
  readonly query?: string | null;
  readonly role?: AgentRole | string | null;
  readonly limit?: number;
}): AgentPlaybook[] {
  const normalizedQuery = (input.query ?? "").trim().toLowerCase();
  const normalizedRole = normalizeAgentRole(input.role);
  const limit = clampAgentPlaybookLimit(input.limit);
  const scored = AGENT_PLAYBOOKS.map((playbook) => ({
    playbook,
    score: scoreAgentPlaybook(playbook, normalizedQuery, normalizedRole),
  }))
    .filter((entry) => normalizedQuery.length === 0 || entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.playbook.name.localeCompare(right.playbook.name);
    })
    .slice(0, limit);
  if (scored.length > 0) {
    return scored.map((entry) => ({
      ...entry.playbook,
      recommendedRoles: [...entry.playbook.recommendedRoles],
      triggerSignals: [...entry.playbook.triggerSignals],
      guidance: [...entry.playbook.guidance],
      procedure: [...entry.playbook.procedure],
    }));
  }
  return listAgentPlaybooks().slice(0, limit);
}

function cloneAgentCapabilityProfile(profile: AgentCapabilityProfile): AgentCapabilityProfile {
  return {
    ...profile,
    memoryProviderIds: [...profile.memoryProviderIds],
    defaultInstructions: [...profile.defaultInstructions],
    recommendedEvalCategories: profile.recommendedEvalCategories
      ? [...profile.recommendedEvalCategories]
      : undefined,
    recommendedPlaybookIds: [...profile.recommendedPlaybookIds],
    alignedProjects: [...profile.alignedProjects],
    toolPolicy: profile.toolPolicy
      ? {
          global: cloneCapabilityToolPolicyRule(profile.toolPolicy.global),
          runtime: cloneCapabilityToolPolicyRule(profile.toolPolicy.runtime),
          roles: cloneCapabilityRoleToolPolicy(profile.toolPolicy.roles),
        }
      : undefined,
  };
}

function cloneCapabilityToolPolicyRule(
  rule: AgentCapabilityProfileToolPolicyRule | undefined,
): AgentCapabilityProfileToolPolicyRule | undefined {
  if (!rule) {
    return undefined;
  }
  return {
    allowTools: rule.allowTools ? [...rule.allowTools] : undefined,
    denyTools: rule.denyTools ? [...rule.denyTools] : undefined,
  };
}

function cloneCapabilityRoleToolPolicy(
  roles: Partial<Record<AgentRole, AgentCapabilityProfileToolPolicyRule>> | undefined,
): Partial<Record<AgentRole, AgentCapabilityProfileToolPolicyRule>> | undefined {
  if (!roles) {
    return undefined;
  }
  const cloned: Partial<Record<AgentRole, AgentCapabilityProfileToolPolicyRule>> = {};
  for (const [role, rule] of Object.entries(roles) as Array<[AgentRole, AgentCapabilityProfileToolPolicyRule]>) {
    cloned[role] = cloneCapabilityToolPolicyRule(rule);
  }
  return cloned;
}

class DefaultContextEngine implements ContextEngine {
  private state!: ContextEngineState;
  private readonly config: ResolvedContextEngineConfig;

  public constructor(input: ContextEngineBootstrapInput) {
    this.config = resolveContextEngineConfig(input.config);
    this.bootstrap(input);
  }

  public bootstrap(input: ContextEngineBootstrapInput): ExecutionContext {
    this.state = {
      taskContract: input.taskContract,
      workspaceSnapshot: input.workspaceSnapshot,
      threadMessages: [...input.threadMessages],
      previousThreadSummary: input.previousThreadSummary ?? null,
      workspaceInstructions: [...(input.workspaceInstructions ?? [])],
      extraInstructions: normalizeContextEngineExtraInstructions(input.extraInstructions ?? []),
      subagentOutcomeNotes: [],
      subagentOutcomeArchiveSummary: null,
      phaseHistory: [input.taskState?.phase ?? "understanding"],
      taskState: input.taskState ?? createDefaultTaskState(input.taskContract),
      engineStatus: {
        engineId: this.config.descriptor.id,
        maintenanceCycles: 0,
        compactionCount: 0,
        deferredCompaction: false,
        estimatedPromptTokens: 0,
        promptBudgetTokens: this.config.promptBudgetTokens,
        recentSubagentOutcomeCount: 0,
      },
    };
    return this.renderWithPolicy();
  }

  public ingest(update: ContextEngineUpdate = {}): ExecutionContext {
    this.applyUpdate(update);
    return this.renderWithPolicy();
  }

  public afterTurn(update: ContextEngineUpdate = {}): ExecutionContext {
    this.applyUpdate(update);
    this.maintainState();
    return this.renderWithPolicy();
  }

  public compact(update: ContextEngineUpdate = {}): ExecutionContext {
    this.applyUpdate(update);
    this.maintainState(true);
    return this.renderWithPolicy();
  }

  public maintain(update: ContextEngineUpdate = {}): ExecutionContext {
    this.applyUpdate(update);
    this.maintainState();
    return this.renderWithPolicy();
  }

  public prepareSubagentSpawn(input: ContextEngineSubagentSpawnInput): string[] {
    const rendered = this.render();
    const sections = [
      [
        "Parent task handoff:",
        `- Parent role: ${this.state.taskContract.agentRole ?? "primary"}`,
        `- Parent objective: ${trimPreview(this.state.taskContract.objective, 220)}`,
        `- Parent success criteria: ${this.state.taskContract.successCriteria.join("; ") || "Deliver a verified code change."}`,
        `- Parent constraints: ${this.state.taskContract.constraints.join("; ") || "No additional constraints."}`,
      ].join("\n"),
      `Parent task scene:\n${rendered.taskSceneSummary}`,
      `Parent thread summary:\n${rendered.threadSummary}`,
      this.state.subagentOutcomeArchiveSummary
        ? `Archived sibling outcomes:\n- ${this.state.subagentOutcomeArchiveSummary}`
        : null,
      this.state.subagentOutcomeNotes.length > 0
        ? `Recent sibling outcomes:\n${this.state.subagentOutcomeNotes.map((entry) => `- ${entry}`).join("\n")}`
        : null,
      [
        "Assigned subagent scope:",
        `- Objective: ${trimPreview(input.objective, 220)}`,
        `- Role: ${input.role?.trim() || "worker"}`,
        `- Depth: ${input.depth}/${input.maxDepth}`,
        `- Parent job: ${input.parentJobId ?? "root"}`,
        `- Root job: ${input.rootJobId ?? "self"}`,
      ].join("\n"),
    ].filter((section): section is string => Boolean(section));

    return sections.map(
      (section) => trimMultilinePreview(section, DEFAULT_CONTEXT_ENGINE_HANDOFF_SECTION_MAX_CHARS).content,
    );
  }

  public onSubagentEnded(input: ContextEngineSubagentOutcomeInput): ExecutionContext {
    const note = formatContextEngineSubagentOutcomeNote(input);
    if (note) {
      this.recordSubagentOutcomeNote(note);
    }
    return this.renderWithPolicy();
  }

  public render(): ExecutionContext {
    const rendered = buildExecutionContext({
      taskContract: this.state.taskContract,
      workspaceSnapshot: this.state.workspaceSnapshot,
      threadMessages: this.state.threadMessages,
      previousThreadSummary: this.state.previousThreadSummary ?? null,
      workspaceInstructions: this.state.workspaceInstructions,
      extraInstructions: this.composeExtraInstructions(),
      taskState: this.state.taskState,
    });
    const estimatedPromptTokens = estimatePromptTokens(rendered.systemPrompt);
    this.state = {
      ...this.state,
      engineStatus: {
        ...this.state.engineStatus,
        estimatedPromptTokens,
        deferredCompaction: estimatedPromptTokens > this.state.engineStatus.promptBudgetTokens,
      },
    };
    return rendered;
  }

  public getState(): Readonly<ContextEngineState> {
    return this.state;
  }

  public getStatus(): Readonly<ContextEngineStatus> {
    return this.state.engineStatus;
  }

  private applyUpdate(update: ContextEngineUpdate): void {
    const nextTaskState = update.taskState ?? this.state.taskState;
    const phaseHistory =
      nextTaskState.phase === this.state.taskState.phase
        ? this.state.phaseHistory
        : compactContextEnginePhaseHistory([...this.state.phaseHistory, nextTaskState.phase]);
    this.state = {
      ...this.state,
      workspaceSnapshot: update.workspaceSnapshot ?? this.state.workspaceSnapshot,
      workspaceInstructions: update.workspaceInstructions
        ? [...update.workspaceInstructions]
        : this.state.workspaceInstructions,
      extraInstructions: update.extraInstructions
        ? normalizeContextEngineExtraInstructions(update.extraInstructions)
        : this.state.extraInstructions,
      taskState: nextTaskState,
      phaseHistory,
    };
  }

  private composeExtraInstructions(): string[] {
    const sections = [...this.state.extraInstructions];
    if (this.state.phaseHistory.length > 1) {
      sections.unshift(`Phase history: ${this.state.phaseHistory.join(" -> ")}`);
    }
    if (this.state.subagentOutcomeArchiveSummary) {
      sections.unshift(`Archived subagent outcomes:\n- ${this.state.subagentOutcomeArchiveSummary}`);
    }
    if (this.state.subagentOutcomeNotes.length > 0) {
      sections.unshift(
        `Recent subagent outcomes:\n${this.state.subagentOutcomeNotes.map((entry) => `- ${entry}`).join("\n")}`,
      );
    }
    return sections;
  }

  private maintainState(compact = false): void {
    const archived = compactContextEngineArchiveSummary(
      this.state.subagentOutcomeArchiveSummary ?? null,
      this.state.subagentOutcomeNotes,
      compact ? Math.max(1, this.config.subagentNoteLimit - 1) : this.config.subagentNoteLimit,
    );
    this.state = {
      ...this.state,
      phaseHistory: compactContextEnginePhaseHistory(this.state.phaseHistory),
      subagentOutcomeNotes: archived.recentNotes,
      subagentOutcomeArchiveSummary: archived.archiveSummary,
      engineStatus: {
        ...this.state.engineStatus,
        maintenanceCycles: this.state.engineStatus.maintenanceCycles + 1,
        compactionCount: this.state.engineStatus.compactionCount + (compact ? 1 : 0),
        recentSubagentOutcomeCount: archived.recentNotes.length,
      },
    };
  }

  private recordSubagentOutcomeNote(note: string): void {
    const archived = compactContextEngineArchiveSummary(
      this.state.subagentOutcomeArchiveSummary ?? null,
      [...this.state.subagentOutcomeNotes, note],
      this.config.subagentNoteLimit,
    );
    this.state = {
      ...this.state,
      subagentOutcomeNotes: archived.recentNotes,
      subagentOutcomeArchiveSummary: archived.archiveSummary,
      engineStatus: {
        ...this.state.engineStatus,
        recentSubagentOutcomeCount: archived.recentNotes.length,
      },
    };
  }

  private renderWithPolicy(): ExecutionContext {
    let rendered = this.render();
    if (this.config.autoCompactWhenOverBudget && this.state.engineStatus.deferredCompaction) {
      this.maintainState(true);
      rendered = this.render();
    }
    return rendered;
  }
}

export function createContextEngine(
  input: ContextEngineBootstrapInput,
  factory?: ContextEngineFactory,
): ContextEngine {
  return factory ? factory(input) : resolveBuiltinContextEngineFactory(input.config?.engineId)(input);
}

export function listBuiltinContextEngines(): ContextEngineDescriptor[] {
  return Object.values(BUILTIN_CONTEXT_ENGINE_DESCRIPTORS).map((entry) => ({ ...entry }));
}

export function getBuiltinContextEngineDescriptor(engineId?: string | null): ContextEngineDescriptor {
  const normalized = engineId?.trim().toLowerCase();
  if (normalized === "compact") {
    return { ...BUILTIN_CONTEXT_ENGINE_DESCRIPTORS.compact };
  }
  if (normalized === "delegation") {
    return { ...BUILTIN_CONTEXT_ENGINE_DESCRIPTORS.delegation };
  }
  return { ...BUILTIN_CONTEXT_ENGINE_DESCRIPTORS.default };
}

function clampAgentPlaybookLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 4;
  }
  return Math.min(8, Math.max(1, Math.trunc(value ?? 4)));
}

function scoreAgentPlaybook(playbook: AgentPlaybook, query: string, role: AgentRole): number {
  let score = 0;
  if (playbook.recommendedRoles.includes(role)) {
    score += 6;
  }
  score += scoreRoleSpecificPlaybookAffinity(playbook.id, role);
  if (!query) {
    return score;
  }
  const haystacks = [
    playbook.id,
    playbook.name,
    playbook.description,
    ...playbook.triggerSignals,
    ...playbook.guidance,
    ...playbook.procedure,
    ...playbook.recommendedRoles,
  ].map((entry) => entry.toLowerCase());
  for (const token of tokenizeSearchQuery(query)) {
    for (const haystack of haystacks) {
      if (haystack === token) {
        score += 8;
      } else if (haystack.startsWith(token) || token.startsWith(haystack)) {
        score += 5;
      } else if (haystack.includes(token) || token.includes(haystack)) {
        score += 3;
      }
    }
  }
  return score;
}

function tokenizeSearchQuery(value: string): string[] {
  return Array.from(new Set(value.split(/[^a-z0-9]+/i).map((entry) => entry.trim().toLowerCase()).filter(Boolean)));
}

function scoreRoleSpecificPlaybookAffinity(playbookId: string, role: AgentRole): number {
  if ((role === "planner" || role === "supervisor") && playbookId === "plan-decompose-dispatch") {
    return 10;
  }
  if ((role === "verifier" || role === "reviewer") && playbookId === "evidence-first-verification") {
    return 10;
  }
  if (role === "researcher" && playbookId === "repo-research-handoff") {
    return 10;
  }
  if ((role === "worker" || role === "executor") && playbookId === "focused-execution-loop") {
    return 10;
  }
  return 0;
}

export function resolveBuiltinContextEngineFactory(engineId?: string | null): ContextEngineFactory {
  const descriptor = getBuiltinContextEngineDescriptor(engineId);
  return (input) =>
    new DefaultContextEngine({
      ...input,
      config: {
        ...input.config,
        engineId: descriptor.id,
      },
    });
}

export function buildExecutionContext(input: {
  readonly taskContract: TaskContract;
  readonly workspaceSnapshot: WorkspaceSnapshot;
  readonly threadMessages: ThreadMessage[];
  readonly taskState?: TaskState;
  readonly previousThreadSummary?: string | null;
  readonly workspaceInstructions?: WorkspaceInstructionFile[];
  readonly extraInstructions?: string[];
}): ExecutionContext {
  const role = normalizeAgentRole(input.taskContract.agentRole ?? "primary");
  const taskState = compactTaskState(input.taskState ?? createDefaultTaskState(input.taskContract));
  const taskSceneSummary = formatTaskScene(taskState);
  const threadSummary = summarizeThread(input.threadMessages, {
    previousSummary: input.previousThreadSummary ?? null,
  });
  const snapshot = input.workspaceSnapshot;
  const workspaceInstructions = sliceWorkspaceInstructionsForRole(input.workspaceInstructions ?? [], role);
  const repoSummary = [
    `cwd: ${snapshot.cwd}`,
    `repo: ${snapshot.repoName}`,
    `branch: ${snapshot.branch ?? "n/a"}`,
    `dirty: ${snapshot.dirty ? "yes" : "no"}`,
    `changed files: ${summarizeList(snapshot.changedFiles)}`,
    `signals: ${summarizeList(snapshot.detectedFiles)}`,
    `package manager: ${snapshot.packageManager}`,
    `scripts: ${summarizeList(snapshot.packageScripts)}`,
  ].join("\n");

  const promptSections = [
    "You are a local-first coding agent focused on repository execution.",
    "Prefer the smallest safe action that advances the task.",
    "If you change code, produce verification evidence before claiming success.",
    `Agent role: ${role}`,
    `Objective: ${input.taskContract.objective}`,
    `Success criteria: ${input.taskContract.successCriteria.join("; ") || "Deliver a verified code change."}`,
    `Constraints: ${input.taskContract.constraints.join("; ") || "No additional constraints."}`,
    `Preferred execution domain: ${input.taskContract.preferredExecutionDomain}`,
    `Task scene:\n${taskSceneSummary}`,
    `Thread summary:\n${threadSummary}`,
    `Workspace summary:\n${repoSummary}`,
  ];
  const workspaceInstructionSections = summarizeWorkspaceInstructions(workspaceInstructions);
  const extraInstructions = input.extraInstructions ?? [];
  const compactedExtraInstructions = summarizeExtraInstructions(sliceExtraInstructionsForRole(extraInstructions, role));
  const attachedContextSection = buildAttachedContextSection({
    taskContract: input.taskContract,
    workspaceSnapshot: snapshot,
    extraInstructions,
  });

  if (attachedContextSection) {
    promptSections.push(attachedContextSection);
  }

  if (workspaceInstructionSections.length > 0) {
    promptSections.push(
      [
        "Workspace instruction files (treat these as repository-specific constraints that override default behavior when relevant):",
        ...workspaceInstructionSections,
      ].join("\n\n"),
    );
  }

  if (compactedExtraInstructions.length > 0) {
    promptSections.push(`Extra instructions:\n${compactedExtraInstructions.join("\n\n")}`);
  }

  const roleGuidance = buildRoleGuidance(role);
  if (roleGuidance) {
    promptSections.push(`Role guidance:\n${roleGuidance}`);
  }

  const roleResponseContract = buildRoleResponseContract(role);
  if (roleResponseContract) {
    promptSections.push(`Role response contract:\n${roleResponseContract}`);
  }

  return {
    taskContract: input.taskContract,
    workspaceSnapshot: snapshot,
    workspaceInstructions,
    taskState,
    taskSceneSummary,
    threadSummary,
    repoSummary,
    systemPrompt: promptSections.join("\n\n"),
    promptSections,
  };
}

type InlineContextRefKind = "file" | "folder" | "diff" | "staged";

interface InlineContextRef {
  readonly kind: InlineContextRefKind;
  readonly target?: string;
}

function buildAttachedContextSection(input: {
  readonly taskContract: TaskContract;
  readonly workspaceSnapshot: WorkspaceSnapshot;
  readonly extraInstructions: readonly string[];
}): string | null {
  const refs = extractInlineContextRefs([input.taskContract.objective, ...input.extraInstructions]);
  if (refs.length === 0) {
    return null;
  }

  const workspaceRoot = resolveWorkspaceRoot(input.workspaceSnapshot, input.taskContract);
  const selectedRefs = refs.slice(0, DEFAULT_ATTACHED_CONTEXT_REF_LIMIT);
  const entries = selectedRefs.map((ref, index) => renderAttachedContextRef(ref, index + 1, workspaceRoot));
  if (refs.length > selectedRefs.length) {
    entries.push(`Additional inline context refs compacted: ${refs.length - selectedRefs.length} omitted.`);
  }

  const section = [
    "Attached Context:",
    "Inline @file/@folder/@diff/@staged refs resolved from the objective and extra instructions. Treat missing or truncated entries as incomplete context.",
    ...entries,
  ].join("\n\n");
  return trimMultilinePreview(section, DEFAULT_ATTACHED_CONTEXT_TOTAL_MAX_CHARS).content;
}

function extractInlineContextRefs(sources: readonly string[]): InlineContextRef[] {
  const refs: InlineContextRef[] = [];
  const seen = new Set<string>();
  const addRef = (ref: InlineContextRef) => {
    const target = ref.target ? cleanInlineContextTarget(ref.target) : undefined;
    if ((ref.kind === "file" || ref.kind === "folder") && !target) {
      return;
    }
    const normalized: InlineContextRef = target ? { kind: ref.kind, target } : { kind: ref.kind };
    const key = `${normalized.kind}:${normalized.target ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(normalized);
    }
  };

  for (const source of sources) {
    for (const match of source.matchAll(/@(file|folder)(?:\(([^)\r\n]+)\)|:([^\s,;\])}]+)|=([^\s,;\])}]+)|\s+([^\s,;\])}]+))/gi)) {
      addRef({
        kind: match[1]?.toLowerCase() as "file" | "folder",
        target: match[2] ?? match[3] ?? match[4] ?? match[5],
      });
    }
    for (const match of source.matchAll(/@(diff|staged)\b/gi)) {
      addRef({ kind: match[1]?.toLowerCase() as "diff" | "staged" });
    }
  }

  return refs;
}

function cleanInlineContextTarget(value: string): string {
  return value.trim().replace(/^["'`<]+/, "").replace(/[>"'`.,;!?]+$/g, "");
}

function renderAttachedContextRef(ref: InlineContextRef, index: number, workspaceRoot: string | null): string {
  if (!workspaceRoot) {
    return `[${index}] @${ref.kind}${ref.target ? ` ${ref.target}` : ""}\n[unavailable: workspace root could not be resolved]`;
  }
  if (ref.kind === "diff" || ref.kind === "staged") {
    return renderAttachedGitDiff(ref.kind, index, workspaceRoot);
  }
  const resolved = resolveWorkspaceRelativePath(workspaceRoot, ref.target ?? "");
  if (!resolved.ok) {
    return `[${index}] @${ref.kind} ${ref.target ?? ""}\n[skipped: ${resolved.error}]`;
  }
  if (ref.kind === "file") {
    return renderAttachedFile(index, resolved.absolutePath, resolved.relativePath);
  }
  return renderAttachedFolder(index, resolved.absolutePath, resolved.relativePath);
}

function resolveWorkspaceRoot(snapshot: WorkspaceSnapshot, taskContract: TaskContract): string | null {
  const candidates = [snapshot.repoRoot, snapshot.cwd, taskContract.cwd]
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    try {
      const absolutePath = resolve(candidate);
      if (existsSync(absolutePath) && statSync(absolutePath).isDirectory()) {
        return realpathSync(absolutePath);
      }
    } catch {
      continue;
    }
  }
  return null;
}

function resolveWorkspaceRelativePath(
  workspaceRoot: string,
  target: string,
): { readonly ok: true; readonly absolutePath: string; readonly relativePath: string } | { readonly ok: false; readonly error: string } {
  const cleaned = cleanInlineContextTarget(target);
  if (!cleaned) {
    return { ok: false, error: "empty path" };
  }

  const candidate = isAbsolute(cleaned) ? resolve(cleaned) : resolve(workspaceRoot, cleaned);
  if (!isPathInside(workspaceRoot, candidate)) {
    return { ok: false, error: "path is outside workspace root" };
  }
  if (!existsSync(candidate)) {
    return { ok: false, error: "path does not exist" };
  }

  let realCandidate: string;
  try {
    realCandidate = realpathSync(candidate);
  } catch {
    return { ok: false, error: "path could not be resolved" };
  }
  if (!isPathInside(workspaceRoot, realCandidate)) {
    return { ok: false, error: "path resolves outside workspace root" };
  }

  return {
    ok: true,
    absolutePath: realCandidate,
    relativePath: normalizeWorkspaceRelativePath(relative(workspaceRoot, realCandidate)),
  };
}

function renderAttachedFile(index: number, absolutePath: string, relativePath: string): string {
  try {
    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      return `[${index}] @file ${relativePath}\n[skipped: path is not a file]`;
    }
    const preview = readTextFilePreview(absolutePath, DEFAULT_ATTACHED_CONTEXT_FILE_READ_BYTES);
    if (!preview.text) {
      return `[${index}] @file ${relativePath}\n[skipped: binary or empty file]`;
    }
    const trimmed = trimMultilinePreview(preview.text, DEFAULT_ATTACHED_CONTEXT_FILE_MAX_CHARS);
    const truncationNote = preview.truncated || trimmed.truncated ? "\n[truncated to fit attached-context budget]" : "";
    return `[${index}] @file ${relativePath}\n${trimmed.content}${truncationNote}`;
  } catch (error) {
    return `[${index}] @file ${relativePath}\n[unavailable: ${formatInlineContextError(error)}]`;
  }
}

function renderAttachedFolder(index: number, absolutePath: string, relativePath: string): string {
  try {
    if (!statSync(absolutePath).isDirectory()) {
      return `[${index}] @folder ${relativePath}\n[skipped: path is not a folder]`;
    }
    const entries = collectFolderEntries(absolutePath, relativePath);
    const content = entries.length > 0 ? entries.join("\n") : "[empty folder]";
    const trimmed = trimMultilinePreview(content, DEFAULT_ATTACHED_CONTEXT_FOLDER_MAX_CHARS);
    const truncationNote = entries.length >= DEFAULT_ATTACHED_CONTEXT_FOLDER_ENTRY_LIMIT || trimmed.truncated
      ? "\n[truncated to fit attached-context budget]"
      : "";
    return `[${index}] @folder ${relativePath || "."}\n${trimmed.content}${truncationNote}`;
  } catch (error) {
    return `[${index}] @folder ${relativePath || "."}\n[unavailable: ${formatInlineContextError(error)}]`;
  }
}

function renderAttachedGitDiff(kind: "diff" | "staged", index: number, workspaceRoot: string): string {
  const args = kind === "staged" ? ["-C", workspaceRoot, "diff", "--cached"] : ["-C", workspaceRoot, "diff", "--"];
  const label = kind === "staged" ? "@staged" : "@diff";
  try {
    const output = execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 128_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const trimmed = trimMultilinePreview(output || `[no ${kind === "staged" ? "staged" : "unstaged"} diff]`, DEFAULT_ATTACHED_CONTEXT_DIFF_MAX_CHARS);
    const truncationNote = trimmed.truncated ? "\n[truncated to fit attached-context budget]" : "";
    return `[${index}] ${label}\n${trimmed.content}${truncationNote}`;
  } catch (error) {
    return `[${index}] ${label}\n[unavailable: ${formatInlineContextError(error)}]`;
  }
}

function readTextFilePreview(absolutePath: string, maxBytes: number): { readonly text: string; readonly truncated: boolean } {
  const descriptor = openSync(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    const truncated = bytesRead > maxBytes;
    const preview = buffer.subarray(0, Math.min(bytesRead, maxBytes));
    if (preview.includes(0)) {
      return { text: "", truncated: false };
    }
    return {
      text: preview.toString("utf8"),
      truncated,
    };
  } finally {
    closeSync(descriptor);
  }
}

function collectFolderEntries(absolutePath: string, relativePath: string): string[] {
  const entries: string[] = [];
  collectFolderEntriesRecursive(absolutePath, relativePath, DEFAULT_ATTACHED_CONTEXT_FOLDER_DEPTH, entries);
  return entries;
}

function collectFolderEntriesRecursive(
  absolutePath: string,
  relativePath: string,
  depthRemaining: number,
  entries: string[],
): void {
  if (entries.length >= DEFAULT_ATTACHED_CONTEXT_FOLDER_ENTRY_LIMIT) {
    return;
  }
  const dirents = readdirSync(absolutePath, { withFileTypes: true })
    .filter((entry) => !shouldSkipAttachedFolderEntry(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  for (const dirent of dirents) {
    if (entries.length >= DEFAULT_ATTACHED_CONTEXT_FOLDER_ENTRY_LIMIT) {
      return;
    }
    const childRelativePath = normalizeWorkspaceRelativePath(relativePath ? `${relativePath}/${dirent.name}` : dirent.name);
    entries.push(dirent.isDirectory() ? `${childRelativePath}/` : childRelativePath);
    if (dirent.isDirectory() && depthRemaining > 0) {
      collectFolderEntriesRecursive(resolve(absolutePath, dirent.name), childRelativePath, depthRemaining - 1, entries);
    }
  }
}

function shouldSkipAttachedFolderEntry(name: string): boolean {
  return name === ".git" || name === "node_modules" || name === "dist" || name === "coverage" || name === ".next";
}

function normalizeWorkspaceRelativePath(value: string): string {
  return value.replace(/\\/g, "/") || ".";
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function formatInlineContextError(error: unknown): string {
  return error instanceof Error ? trimPreview(error.message, 160) : "unknown error";
}

function createDefaultTaskState(taskContract: TaskContract): TaskState {
  const pendingSubgoals = [
    "Understand the repository state and identify the next safe action.",
    ...(objectiveSuggestsMutation(taskContract.objective) ? ["Apply the smallest repository change that satisfies the objective."] : []),
    ...(taskContract.verificationMode === "required" ? ["Produce verification evidence before claiming success."] : []),
  ];
  return {
    phase: "understanding",
    currentGoal: "Understand the repository and identify the next safe action.",
    completedSubgoals: [],
    pendingSubgoals,
    recentFailureReason: null,
    latestVerification: {
      status: "not-run",
      summary: "No verification result recorded yet.",
    },
  };
}

function buildRoleGuidance(role: AgentRole): string | null {
  const contract = getAgentRoleContract(role);
  return contract.guidance.length > 0 ? contract.guidance.join(" ") : null;
}

function buildRoleResponseContract(role: AgentRole): string | null {
  const contract = getAgentRoleContract(role);
  const sections = [
    `- Response kind: ${contract.responseKind}`,
    `- May edit files: ${contract.canEditFiles ? "yes" : "no"}`,
    `- Max tool calls per turn: ${contract.maxToolCallsPerTurn}`,
    ...contract.responseInstructions.map((entry) => `- ${entry}`),
  ];
  return sections.join("\n");
}

function compactTaskState(taskState: TaskState): TaskState {
  return {
    phase: taskState.phase,
    currentGoal: trimPreview(taskState.currentGoal, 220),
    completedSubgoals: compactSubgoalList(taskState.completedSubgoals),
    pendingSubgoals: compactSubgoalList(taskState.pendingSubgoals),
    recentFailureReason: taskState.recentFailureReason ? trimPreview(taskState.recentFailureReason, 260) : null,
    latestVerification: {
      status: taskState.latestVerification.status,
      summary: trimPreview(taskState.latestVerification.summary, 260),
    },
  };
}

function compactSubgoalList(values: readonly string[]): string[] {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  return unique.slice(0, DEFAULT_TASK_SUBGOAL_LIMIT).map((value) => trimPreview(value, 180));
}

function formatTaskScene(taskState: TaskState): string {
  const sections = [
    `- Phase: ${taskState.phase}`,
    `- Current goal: ${taskState.currentGoal}`,
    `- Completed subgoals: ${formatTaskSceneList(taskState.completedSubgoals, "none yet")}`,
    `- Pending subgoals: ${formatTaskSceneList(taskState.pendingSubgoals, "none")}`,
    `- Recent failure reason: ${taskState.recentFailureReason?.trim() || "none"}`,
    `- Latest verification result: ${taskState.latestVerification.status} - ${taskState.latestVerification.summary}`,
  ];
  return trimPreview(sections.join("\n"), DEFAULT_TASK_SCENE_MAX_CHARS);
}

function formatTaskSceneList(values: readonly string[], emptyLabel: string): string {
  return values.length > 0 ? values.map((value) => `\n  * ${value}`).join("") : emptyLabel;
}

function estimatePromptTokens(value: string): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }
  return Math.ceil(normalized.length / 4);
}

function objectiveSuggestsMutation(objective: string): boolean {
  return /\b(add|build|change|create|edit|fix|implement|modify|refactor|rename|replace|update|write)\b/i.test(objective);
}

function formatWorkspaceInstruction(instruction: WorkspaceInstructionFile, maxContentChars = Number.POSITIVE_INFINITY): string {
  const scopeLabel = instruction.scope === "." ? "workspace root" : instruction.scope;
  const trimmedContent = trimMultilinePreview(instruction.content, maxContentChars);
  const truncationNote = instruction.truncated || trimmedContent.truncated ? "\n[truncated to fit prompt budget]" : "";
  return `From ${instruction.path} (${scopeLabel}):\n${trimmedContent.content}${truncationNote}`;
}

function summarizeWorkspaceInstructions(instructions: readonly WorkspaceInstructionFile[]): string[] {
  if (instructions.length === 0) {
    return [];
  }

  const selected: string[] = [];
  let omittedCount = 0;
  let remainingChars = DEFAULT_WORKSPACE_INSTRUCTION_MAX_CHARS;

  for (let index = instructions.length - 1; index >= 0; index -= 1) {
    if (selected.length >= DEFAULT_WORKSPACE_INSTRUCTION_LIMIT) {
      omittedCount = index + 1;
      break;
    }
    const candidate = formatWorkspaceInstruction(
      instructions[index] as WorkspaceInstructionFile,
      DEFAULT_WORKSPACE_INSTRUCTION_MAX_CHARS_PER_FILE,
    );
    const separatorChars = selected.length === 0 ? 0 : 2;
    if (candidate.length + separatorChars > remainingChars) {
      if (selected.length === 0) {
        selected.unshift(trimMultilinePreview(candidate, remainingChars).content);
        omittedCount = index;
      } else {
        omittedCount = index + 1;
      }
      break;
    }
    selected.unshift(candidate);
    remainingChars -= candidate.length + separatorChars;
  }

  if (omittedCount > 0) {
    selected.unshift(`Earlier workspace instructions compacted: ${omittedCount} lower-priority file(s) omitted.`);
  }
  return selected;
}

function summarizeExtraInstructions(sections: readonly string[]): string[] {
  const normalized = sections
    .map((section) => section.trim())
    .filter(Boolean);
  if (normalized.length === 0) {
    return [];
  }

  const selected: string[] = [];
  let omittedCount = 0;
  let remainingChars = DEFAULT_EXTRA_INSTRUCTION_MAX_CHARS;

  for (let index = 0; index < normalized.length; index += 1) {
    if (selected.length >= DEFAULT_EXTRA_INSTRUCTION_LIMIT) {
      omittedCount = normalized.length - index;
      break;
    }
    const candidate = trimMultilinePreview(
      normalized[index] ?? "",
      DEFAULT_EXTRA_INSTRUCTION_MAX_CHARS_PER_SECTION,
    ).content;
    const separatorChars = selected.length === 0 ? 0 : 2;
    if (candidate.length + separatorChars > remainingChars) {
      if (selected.length === 0) {
        selected.push(trimMultilinePreview(candidate, remainingChars).content);
        omittedCount = normalized.length - index - 1;
      } else {
        omittedCount = normalized.length - index;
      }
      break;
    }
    selected.push(candidate);
    remainingChars -= candidate.length + separatorChars;
  }

  if (omittedCount > 0) {
    selected.push(`Additional extra-instruction sections compacted: ${omittedCount} omitted.`);
  }
  return selected;
}

function sliceWorkspaceInstructionsForRole(
  instructions: readonly WorkspaceInstructionFile[],
  role: AgentRole,
): WorkspaceInstructionFile[] {
  if (role === "primary" || role === "worker" || role === "executor") {
    return [...instructions];
  }
  return instructions.slice(-4);
}

function sliceExtraInstructionsForRole(sections: readonly string[], role: AgentRole): string[] {
  const normalized = sections.map((entry) => entry.trim()).filter(Boolean);
  if (role === "primary" || role === "worker" || role === "executor") {
    return normalized;
  }
  const limit = role === "reviewer" || role === "verifier" ? 4 : 5;
  return normalized.slice(0, limit).map((entry) => trimMultilinePreview(entry, 420).content);
}

function summarizeList(values: readonly string[]): string {
  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);
  if (normalized.length === 0) {
    return "none";
  }

  const selected: string[] = [];
  let omittedCount = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    if (selected.length >= DEFAULT_REPO_LIST_LIMIT) {
      omittedCount = normalized.length - index;
      break;
    }
    const item = trimPreview(normalized[index] ?? "", DEFAULT_REPO_LIST_MAX_CHARS_PER_ITEM);
    const remainingCount = normalized.length - index - 1;
    const suffix = remainingCount > 0 ? `, +${remainingCount} more` : "";
    const candidate = [...selected, item].join(", ");
    if ((candidate + suffix).length > DEFAULT_REPO_LIST_MAX_CHARS) {
      omittedCount = normalized.length - index;
      break;
    }
    selected.push(item);
  }

  if (selected.length === 0) {
    return trimPreview(normalized[0] ?? "", DEFAULT_REPO_LIST_MAX_CHARS);
  }
  if (omittedCount > 0) {
    return `${selected.join(", ")}, +${omittedCount} more`;
  }
  return selected.join(", ");
}

function trimPreview(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  const budget = Math.max(16, maxChars - "...[truncated]".length);
  return `${normalized.slice(0, budget).trimEnd()}...[truncated]`;
}

function trimMultilinePreview(value: string, maxChars: number): { content: string; truncated: boolean } {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (normalized.length <= maxChars) {
    return {
      content: normalized,
      truncated: false,
    };
  }
  const suffix = "\n...[truncated]";
  const budget = Math.max(32, maxChars - suffix.length);
  return {
    content: `${normalized.slice(0, budget).trimEnd()}${suffix}`,
    truncated: true,
  };
}

function normalizeContextEngineExtraInstructions(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean);
}

function compactContextEngineInstructions(values: readonly string[], limit = DEFAULT_EXTRA_INSTRUCTION_LIMIT): string[] {
  const normalized = Array.from(
    new Set(
      values
        .map((value) => trimPreview(value, DEFAULT_CONTEXT_ENGINE_SUBAGENT_NOTE_MAX_CHARS))
        .filter(Boolean),
    ),
  );
  if (normalized.length <= limit) {
    return normalized;
  }
  return normalized.slice(normalized.length - limit);
}

function resolveContextEngineConfig(config?: ContextEngineConfig): ResolvedContextEngineConfig {
  const descriptor = getBuiltinContextEngineDescriptor(config?.engineId);
  return {
    descriptor,
    promptBudgetTokens: Math.max(400, Math.trunc(config?.promptBudgetTokens ?? descriptor.defaultPromptBudgetTokens)),
    subagentNoteLimit: Math.max(1, Math.trunc(config?.subagentNoteLimit ?? descriptor.defaultSubagentNoteLimit)),
    extraInstructionLimit: Math.max(1, Math.trunc(config?.extraInstructionLimit ?? descriptor.defaultExtraInstructionLimit)),
    autoCompactWhenOverBudget: descriptor.id === "compact",
  };
}

function compactContextEnginePhaseHistory(values: readonly TaskPhase[]): TaskPhase[] {
  if (values.length <= 6) {
    return [...values];
  }
  return [...values.slice(values.length - 6)];
}

function compactContextEngineArchiveSummary(
  existingArchiveSummary: string | null,
  values: readonly string[],
  limit: number,
): {
  readonly archiveSummary: string | null;
  readonly recentNotes: string[];
} {
  const recentNotes = compactContextEngineInstructions(values, limit);
  if (values.length <= limit) {
    return {
      archiveSummary: existingArchiveSummary,
      recentNotes,
    };
  }
  const archivedValues = values.slice(0, values.length - recentNotes.length);
  const fragments = [existingArchiveSummary, ...archivedValues]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => trimPreview(entry, 120));
  return {
    archiveSummary: trimPreview(fragments.join(" | "), 240),
    recentNotes,
  };
}

function formatContextEngineSubagentOutcomeNote(input: ContextEngineSubagentOutcomeInput): string | null {
  const fragments = [
    input.role?.trim() ? `${input.role.trim()} subagent` : "Subagent",
    `${input.status} for objective "${trimPreview(input.objective, 120)}"`,
    input.verificationStatus ? `verification=${input.verificationStatus}` : null,
    input.changedFiles && input.changedFiles.length > 0
      ? `changed=${summarizeList(input.changedFiles)}`
      : null,
    input.error?.trim()
      ? `error=${trimPreview(input.error, 120)}`
      : input.finalResponse?.trim()
        ? `response=${trimPreview(input.finalResponse, 120)}`
        : null,
  ].filter((entry): entry is string => Boolean(entry));
  if (fragments.length === 0) {
    return null;
  }
  return trimPreview(fragments.join("; "), DEFAULT_CONTEXT_ENGINE_SUBAGENT_NOTE_MAX_CHARS);
}
