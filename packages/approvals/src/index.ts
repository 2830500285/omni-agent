import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ApprovalPolicy = "never" | "on-request" | "on-failure" | "manual";
export type RiskTier = 0 | 1 | 2 | 3;
export type ApprovalDecision = "allow" | "prompt" | "deny";
export type ApprovalGrantScope = "once" | "session" | "always";
export type ApprovalClass =
  | "readonly_scoped"
  | "readonly_search"
  | "mutating"
  | "exec_capable"
  | "control_plane"
  | "interactive"
  | "other";

export interface OperationDescriptor {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly riskHint?: string;
}

export interface ToolRiskAssessment {
  readonly toolName: string;
  readonly approvalClass: ApprovalClass;
  readonly riskTier: RiskTier;
  readonly mutating: boolean;
  readonly reason: string;
  readonly commandRiskKind?: CommandRiskAssessment["kind"];
  readonly commandRiskRuleId?: string;
  readonly commandRiskReasons?: readonly string[];
  readonly commandPrefix?: string | null;
}

export interface ApprovalGrantRequest {
  readonly assessment: ToolRiskAssessment;
  readonly args: Record<string, unknown>;
  readonly workspaceId?: string | null;
  readonly threadId?: string | null;
}

export interface ApprovalGrantRecord {
  readonly id: string;
  readonly key: string;
  readonly scope: ApprovalGrantScope;
  readonly toolName: string;
  readonly approvalClass: ApprovalClass;
  readonly riskTier: RiskTier;
  readonly commandPrefix: string | null;
  readonly commandRiskRuleId: string | null;
  readonly createdAt: string;
  readonly useCount: number;
}

export interface ApprovalGrantStore {
  findGrant(request: ApprovalGrantRequest): ApprovalGrantRecord | null;
  addGrant(scope: ApprovalGrantScope, request: ApprovalGrantRequest): ApprovalGrantRecord;
  consumeGrant(grantId: string): void;
  listGrants(): readonly ApprovalGrantRecord[];
}

import { analyzeCommandRisk, type CommandRiskAssessment } from "./command-policy.js";

export { analyzeCommandRisk, type CommandRiskAssessment, type CommandRiskKind } from "./command-policy.js";

let approvalGrantCounter = 0;

export class InMemoryApprovalGrantStore implements ApprovalGrantStore {
  private readonly grants = new Map<string, ApprovalGrantRecord>();

  public findGrant(request: ApprovalGrantRequest): ApprovalGrantRecord | null {
    const key = createApprovalGrantKey(request);
    const candidates = [...this.grants.values()]
      .filter((grant) => grant.key === key)
      .sort((left, right) => approvalGrantScopeRank(left.scope) - approvalGrantScopeRank(right.scope));
    return candidates[0] ?? null;
  }

  public addGrant(scope: ApprovalGrantScope, request: ApprovalGrantRequest): ApprovalGrantRecord {
    const key = createApprovalGrantKey(request);
    const existing = [...this.grants.values()].find((grant) => grant.key === key && grant.scope === scope);
    if (existing) {
      return existing;
    }
    const record: ApprovalGrantRecord = {
      id: `approval-grant-${Date.now().toString(36)}-${(approvalGrantCounter += 1).toString(36)}`,
      key,
      scope,
      toolName: request.assessment.toolName,
      approvalClass: request.assessment.approvalClass,
      riskTier: request.assessment.riskTier,
      commandPrefix: request.assessment.commandPrefix ?? null,
      commandRiskRuleId: request.assessment.commandRiskRuleId ?? null,
      createdAt: new Date().toISOString(),
      useCount: 0,
    };
    this.grants.set(record.id, record);
    return record;
  }

  public consumeGrant(grantId: string): void {
    const grant = this.grants.get(grantId);
    if (!grant) {
      return;
    }
    if (grant.scope === "once") {
      this.grants.delete(grantId);
      return;
    }
    this.grants.set(grantId, {
      ...grant,
      useCount: grant.useCount + 1,
    });
  }

  public listGrants(): readonly ApprovalGrantRecord[] {
    return [...this.grants.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }
}

export class JsonFileApprovalGrantStore implements ApprovalGrantStore {
  private readonly sessionGrants = new InMemoryApprovalGrantStore();

  public constructor(private readonly filePath: string) {}

  public findGrant(request: ApprovalGrantRequest): ApprovalGrantRecord | null {
    return this.sessionGrants.findGrant(request) ?? this.readPersistentGrants().find((grant) => grant.key === createApprovalGrantKey(request)) ?? null;
  }

  public addGrant(scope: ApprovalGrantScope, request: ApprovalGrantRequest): ApprovalGrantRecord {
    if (scope !== "always") {
      return this.sessionGrants.addGrant(scope, request);
    }
    const key = createApprovalGrantKey(request);
    const persistent = this.readPersistentGrants();
    const existing = persistent.find((grant) => grant.key === key && grant.scope === "always");
    if (existing) {
      return existing;
    }
    const record: ApprovalGrantRecord = {
      id: `approval-grant-${Date.now().toString(36)}-${(approvalGrantCounter += 1).toString(36)}`,
      key,
      scope,
      toolName: request.assessment.toolName,
      approvalClass: request.assessment.approvalClass,
      riskTier: request.assessment.riskTier,
      commandPrefix: request.assessment.commandPrefix ?? null,
      commandRiskRuleId: request.assessment.commandRiskRuleId ?? null,
      createdAt: new Date().toISOString(),
      useCount: 0,
    };
    this.writePersistentGrants([...persistent, record]);
    return record;
  }

  public consumeGrant(grantId: string): void {
    this.sessionGrants.consumeGrant(grantId);
    const persistent = this.readPersistentGrants();
    const index = persistent.findIndex((grant) => grant.id === grantId);
    if (index < 0) {
      return;
    }
    const grant = persistent[index]!;
    persistent[index] = {
      ...grant,
      useCount: grant.useCount + 1,
    };
    this.writePersistentGrants(persistent);
  }

  public listGrants(): readonly ApprovalGrantRecord[] {
    return [...this.sessionGrants.listGrants(), ...this.readPersistentGrants()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private readPersistentGrants(): ApprovalGrantRecord[] {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as { grants?: unknown };
      if (!Array.isArray(parsed.grants)) {
        return [];
      }
      return parsed.grants.filter(isApprovalGrantRecord);
    } catch {
      return [];
    }
  }

  private writePersistentGrants(grants: readonly ApprovalGrantRecord[]): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify({ grants }, null, 2), "utf8");
  }
}

function isApprovalGrantRecord(value: unknown): value is ApprovalGrantRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ApprovalGrantRecord>;
  return typeof record.id === "string" &&
    typeof record.key === "string" &&
    (record.scope === "always" || record.scope === "session" || record.scope === "once") &&
    typeof record.toolName === "string" &&
    typeof record.approvalClass === "string" &&
    typeof record.riskTier === "number" &&
    typeof record.createdAt === "string" &&
    typeof record.useCount === "number";
}

export function createApprovalGrantKey(request: ApprovalGrantRequest): string {
  const { assessment } = request;
  return stableStringify({
    toolName: assessment.toolName,
    approvalClass: assessment.approvalClass,
    riskTier: assessment.riskTier,
      commandPrefix: assessment.commandPrefix ?? null,
      commandRiskRuleId: assessment.commandRiskRuleId ?? null,
      workspaceId: request.workspaceId ?? null,
      threadId: request.threadId ?? null,
      args: request.args,
    });
}

function approvalGrantScopeRank(scope: ApprovalGrantScope): number {
  switch (scope) {
    case "once":
      return 0;
    case "session":
      return 1;
    default:
      return 2;
  }
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return '"__undefined__"';
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function describeDangerousCommand(command: string): string | null {
  const assessment = analyzeCommandRisk(command);
  return assessment.riskTier >= 3 ? `rule=${assessment.ruleId}; ${assessment.reasons.join(" ")}` : null;
}

export function assertSafeCommand(command: string): void {
  const reason = describeDangerousCommand(command);
  if (!reason) {
    return;
  }
  throw new Error(`Blocked dangerous command: ${reason}`);
}

function buildAssessment(
  toolName: string,
  approvalClass: ApprovalClass,
  riskTier: RiskTier,
  mutating: boolean,
  reason: string,
  commandRisk?: CommandRiskAssessment,
): ToolRiskAssessment {
  return {
    toolName,
    approvalClass,
    riskTier,
    mutating,
    reason,
    commandRiskKind: commandRisk?.kind,
    commandRiskRuleId: commandRisk?.ruleId,
    commandRiskReasons: commandRisk?.reasons,
    commandPrefix: commandRisk?.prefix,
  };
}

export function describeApprovalClass(approvalClass: ApprovalClass): string {
  switch (approvalClass) {
    case "readonly_scoped":
      return "workspace-scoped read";
    case "readonly_search":
      return "external read/search";
    case "mutating":
      return "workspace mutation";
    case "exec_capable":
      return "command or automation execution";
    case "control_plane":
      return "control-plane orchestration";
    case "interactive":
      return "interactive user handoff";
    default:
      return "unclassified operation";
  }
}

export function classifyToolCall(operation: OperationDescriptor): ToolRiskAssessment {
  const { toolName, args } = operation;
  const normalizedRiskHint = String(operation.riskHint ?? "").toLowerCase();

  switch (toolName) {
    case "workspace_info":
    case "git_status":
    case "git_diff":
    case "list_directory":
    case "read_file":
    case "scan_secrets":
    case "read_plan":
    case "list_tasks":
    case "lsp_diagnostics":
    case "notebook_read":
    case "process_list":
    case "process_read":
    case "search_memory":
    case "search_profile":
    case "search_files":
    case "search_learned_skills":
    case "search_sessions":
    case "search_text":
    case "list_automations":
    case "list_extension_resources":
    case "read_extension_resource":
    case "render_extension_prompt":
      return buildAssessment(toolName, "readonly_scoped", 0, false, "Read-only inspection tool.");
    case "web3_contract_risk":
    case "web3_revoke_approval_preview":
    case "web3_transfer_preview":
    case "web3_transaction_simulation":
    case "genesis_finance_plan":
    case "htx_order_preview":
      return buildAssessment(
        toolName,
        "readonly_scoped",
        1,
        false,
        "Financial planning or risk preview only; no external trade or chain write is executed.",
      );
    case "omni_workflow_plan":
    case "omni_workflow_dry_run":
      return buildAssessment(
        toolName,
        "readonly_scoped",
        1,
        false,
        "Planning or dry-run preview only; no external write is executed.",
      );
    case "web_search":
    case "browser_search":
    case "web_fetch":
    case "browser_fetch":
    case "htx_market_data":
    case "htx_account_snapshot":
    case "web3_wallet_snapshot":
    case "web3_tron_account_snapshot":
    case "web3_trc20_allowance":
    case "bai_capability_probe":
    case "bai_chat_completion":
    case "omni_workflow_catalog":
    case "omni_connector_probe":
      return buildAssessment(
        toolName,
        "readonly_search",
        1,
        false,
        "Network read-only fetch or model inference outside the local workspace.",
      );
    case "ask_user":
      return buildAssessment(
        toolName,
        "interactive",
        0,
        false,
        "Pauses execution to request direct user clarification.",
      );
    case "update_plan":
    case "create_task":
    case "update_task":
    case "delete_task":
    case "write_file":
    case "edit_file":
    case "replace_file_range":
    case "notebook_replace_cell":
    case "save_profile_fact":
      return buildAssessment(toolName, "mutating", 1, true, "Workspace-scoped edit or state mutation tool.");
    case "save_memory": {
      const backend = String(args.backend ?? "").trim().toLowerCase();
      const writesWorkspaceFile = backend === "file" || backend === "both";
      return buildAssessment(
        toolName,
        "mutating",
        1,
        writesWorkspaceFile,
        writesWorkspaceFile
          ? "Persists memory into workspace files for future runs."
          : "Persists memory for future runs without editing workspace files.",
      );
    }
    case "htx_paper_order":
      return buildAssessment(
        toolName,
        "mutating",
        1,
        true,
        "Records paper-trading state only; live order placement remains unsupported.",
      );
    case "python_execute":
    case "run_verification":
    case "run_command":
    case "process_start": {
      const commandAssessment = analyzeExecutionToolCommand(toolName, args);

      return buildAssessment(
        toolName,
        "exec_capable",
        commandAssessment.riskTier,
        commandAssessment.mutating,
        formatCommandAssessmentReason(commandAssessment),
        commandAssessment,
      );
    }
    case "browser_open":
    case "browser_snapshot":
    case "browser_close":
      return buildAssessment(toolName, "exec_capable", 1, false, "Browser automation can access external systems.");
    case "browser_click":
    case "browser_type":
    case "browser_run":
      return buildAssessment(toolName, "exec_capable", 2, true, "Browser automation can act on external systems.");
    case "spawn_subagent":
    case "run_swarm":
    case "cancel_subagent":
    case "process_stop":
    case "wait_subagent":
    case "list_subagents":
    case "create_sandbox":
    case "create_checkpoint":
    case "list_checkpoints":
    case "create_automation":
    case "update_automation_status":
    case "create_worktree":
      return buildAssessment(
        toolName,
        "control_plane",
        toolName === "wait_subagent" || toolName === "list_subagents" || toolName === "list_checkpoints" ? 1 : 2,
        toolName !== "wait_subagent" && toolName !== "list_subagents" && toolName !== "list_checkpoints",
        toolName === "create_sandbox"
          ? "Creates an isolated sandbox workspace copy."
          : toolName === "create_checkpoint"
            ? "Creates a managed workspace rollback checkpoint."
            : toolName === "list_checkpoints"
              ? "Lists managed workspace rollback checkpoints."
          : toolName === "create_worktree"
            ? "Creates isolated git worktree state."
            : toolName === "create_automation" || toolName === "update_automation_status"
              ? "Changes reusable automation orchestration state."
              : "Controls delegated execution or orchestration state.",
      );
    case "cleanup_sandbox":
    case "cleanup_worktree":
    case "rollback_checkpoint":
      return buildAssessment(
        toolName,
        "control_plane",
        3,
        true,
        toolName === "cleanup_sandbox"
          ? "Deletes an isolated sandbox workspace copy."
          : toolName === "cleanup_worktree"
            ? "Deletes an isolated git worktree."
            : "Restores a managed workspace checkpoint and removes files created after it.",
      );
    default:
      if (normalizedRiskHint.includes("network") && (normalizedRiskHint.includes("read-only") || normalizedRiskHint.includes("read only"))) {
        return buildAssessment(toolName, "readonly_search", 1, false, "Tool risk derived from a network read-only risk hint.");
      }
      if (normalizedRiskHint.includes("read-only") || normalizedRiskHint.includes("read only")) {
        return buildAssessment(toolName, "readonly_scoped", 0, false, "Tool risk derived from a read-only risk hint.");
      }
      if (
        normalizedRiskHint.includes("verification") ||
        normalizedRiskHint.includes("browser automation") ||
        normalizedRiskHint.includes("command") ||
        normalizedRiskHint.includes("shell") ||
        normalizedRiskHint.includes("exec")
      ) {
        return buildAssessment(toolName, "exec_capable", 1, false, "Tool risk derived from an execution-oriented risk hint.");
      }
      if (normalizedRiskHint.includes("write") || normalizedRiskHint.includes("mutat") || normalizedRiskHint.includes("delete")) {
        return buildAssessment(toolName, "mutating", 2, true, "Tool risk derived from a mutating risk hint.");
      }
      if (normalizedRiskHint.includes("control")) {
        return buildAssessment(toolName, "control_plane", 2, true, "Tool risk derived from a control-plane risk hint.");
      }
      return buildAssessment(toolName, "other", 2, true, "Unknown tool defaults to medium risk.");
  }
}

function analyzeExecutionToolCommand(toolName: string, args: Record<string, unknown>): CommandRiskAssessment {
  if (toolName === "run_verification") {
    const commands = Array.isArray(args.commands) ? args.commands.map((entry) => String(entry)) : [];
    if (commands.length === 0) {
      return {
        kind: "readonly",
        riskTier: 1,
        mutating: false,
        prefix: "verification",
        ruleId: "verification.empty",
        reasons: ["Verification request has no commands yet and does not mutate state."],
      };
    }
    const assessments = commands.map((command) => analyzeCommandRisk(command, { verification: true }));
    return assessments.reduce((highest, current) => (current.riskTier > highest.riskTier ? current : highest));
  }

  if (toolName === "python_execute") {
    const code = String(args.code ?? "");
    const syntheticCommand = args.command ? String(args.command) : `python -c ${JSON.stringify(code)}`;
    return analyzeCommandRisk(syntheticCommand);
  }

  return analyzeCommandRisk(String(args.command ?? ""));
}

function formatCommandAssessmentReason(assessment: CommandRiskAssessment): string {
  const prefix = assessment.prefix ? ` prefix=${assessment.prefix};` : "";
  return `Command risk=${assessment.kind}; rule=${assessment.ruleId};${prefix} ${assessment.reasons.join(" ")}`.trim();
}

export function resolveApprovalDecision(
  policy: ApprovalPolicy,
  assessment: ToolRiskAssessment,
): ApprovalDecision {
  if (assessment.approvalClass === "interactive") {
    return "allow";
  }

  if (policy === "manual") {
    return assessment.approvalClass === "readonly_scoped" ? "allow" : "prompt";
  }

  if (policy === "never") {
    return assessment.approvalClass === "readonly_scoped" || assessment.approvalClass === "readonly_search"
      ? "allow"
      : "deny";
  }

  if (policy === "on-failure") {
    if (assessment.approvalClass === "exec_capable") {
      return assessment.riskTier <= 1 ? "allow" : "prompt";
    }
    if (assessment.approvalClass === "other") {
      return assessment.riskTier >= 2 ? "prompt" : "allow";
    }
    return assessment.riskTier >= 3 ? "prompt" : "allow";
  }

  return assessment.approvalClass === "readonly_scoped" ||
    assessment.approvalClass === "readonly_search" ||
    assessment.approvalClass === "mutating" ||
    (assessment.approvalClass === "control_plane" && assessment.riskTier < 3) ||
    (assessment.approvalClass === "exec_capable" && assessment.riskTier <= 1)
    ? "allow"
    : "prompt";
}

export function describeApprovalRequirement(
  policy: ApprovalPolicy,
  assessment: ToolRiskAssessment,
): string {
  const decision = resolveApprovalDecision(policy, assessment);
  return `${assessment.toolName} => ${decision} (${assessment.approvalClass}, tier ${assessment.riskTier}): ${assessment.reason}`;
}
