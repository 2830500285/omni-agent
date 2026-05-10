type WorkflowToolResult = {
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
  readonly warnings?: string[];
  readonly presentation?: {
    readonly title?: string;
    readonly kind?: "read" | "edit" | "execute" | "search" | "fetch" | "other";
    readonly content?: readonly [{ readonly type: "text"; readonly text: string }];
  };
};

type WorkflowToolContext = {
  readonly abortSignal?: AbortSignal;
};

type WorkflowToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputHint: string;
  readonly riskHint: string;
  execute(context: WorkflowToolContext, args: Record<string, unknown>): Promise<WorkflowToolResult>;
};

type WorkflowToolRegistry = {
  register(definition: WorkflowToolDefinition): void;
};

type WorkflowCategoryId =
  | "personal_efficiency"
  | "content_creation"
  | "development_workflow"
  | "intelligent_automation";

type WorkflowMode = "dry_run" | "live";

type WorkflowRisk = "read_only" | "local_write" | "external_write" | "always_on";

type WorkflowDefinition = {
  readonly id: string;
  readonly categoryId: WorkflowCategoryId;
  readonly categoryTitle: string;
  readonly title: string;
  readonly summary: string;
  readonly primaryUseCases: readonly string[];
  readonly nativeTools: readonly string[];
  readonly workspaceSkills: readonly string[];
  readonly requiredConnectors: readonly string[];
  readonly optionalConnectors: readonly string[];
  readonly requiredSecrets: readonly string[];
  readonly outputArtifacts: readonly string[];
  readonly risk: WorkflowRisk;
  readonly liveActionPolicy: string;
};

type WorkflowStep = {
  readonly id: string;
  readonly title: string;
  readonly tool: string;
  readonly purpose: string;
  readonly approvalRequired: boolean;
};

type ConnectorStatus = {
  readonly name: string;
  readonly configured: boolean;
  readonly requiredSecrets: readonly string[];
  readonly missingSecrets: readonly string[];
};

const CATEGORY_TITLES: Record<WorkflowCategoryId, string> = {
  personal_efficiency: "Personal Efficiency Assistant",
  content_creation: "Content Creation Assistant",
  development_workflow: "Development Workflow",
  intelligent_automation: "Intelligent Automation",
};

const WORKFLOWS: readonly WorkflowDefinition[] = [
  {
    id: "remote_dialogue",
    categoryId: "personal_efficiency",
    categoryTitle: CATEGORY_TITLES.personal_efficiency,
    title: "Telegram and Discord remote dialogue",
    summary: "Receive remote messages through configured channel routes, route them into agent runs, and send approved replies back.",
    primaryUseCases: ["Telegram remote control", "Discord DM support", "message-to-run handoff"],
    nativeTools: ["search_tools", "list_automations", "create_automation"],
    workspaceSkills: [],
    requiredConnectors: ["telegram", "discord"],
    optionalConnectors: ["slack", "teams", "feishu"],
    requiredSecrets: ["TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN"],
    outputArtifacts: ["inbound_message", "agent_response", "delivery_record"],
    risk: "external_write",
    liveActionPolicy: "Outbound messages require a configured route, sender allowlist, and explicit approval for sensitive content.",
  },
  {
    id: "apple_notes_reminders",
    categoryId: "personal_efficiency",
    categoryTitle: CATEGORY_TITLES.personal_efficiency,
    title: "Apple notes and reminders management",
    summary: "Create a safe handoff plan for Apple Notes and Reminders through Shortcuts, local files, or an external bridge.",
    primaryUseCases: ["capture note", "create reminder", "summarize reminders"],
    nativeTools: ["write_file", "append_file", "create_automation"],
    workspaceSkills: [],
    requiredConnectors: ["apple_shortcuts_bridge"],
    optionalConnectors: ["icloud_export"],
    requiredSecrets: ["APPLE_SHORTCUTS_WEBHOOK_URL"],
    outputArtifacts: ["note_handoff", "reminder_handoff", "sync_report"],
    risk: "external_write",
    liveActionPolicy: "Apple writes stay disabled unless a user-owned bridge endpoint is configured and the exact write is approved.",
  },
  {
    id: "file_document_organizer",
    categoryId: "personal_efficiency",
    categoryTitle: CATEGORY_TITLES.personal_efficiency,
    title: "Automatic file and document organization",
    summary: "Scan workspace files, classify documents, propose moves, and apply only approved workspace-scoped edits.",
    primaryUseCases: ["deduplicate files", "classify documents", "organize folders"],
    nativeTools: ["list_directory", "search_files", "read_file", "apply_transactional_patch"],
    workspaceSkills: [],
    requiredConnectors: [],
    optionalConnectors: ["local_filesystem"],
    requiredSecrets: [],
    outputArtifacts: ["inventory", "classification", "move_plan", "applied_patch"],
    risk: "local_write",
    liveActionPolicy: "File moves require a dry-run inventory first and an approval-gated transactional patch.",
  },
  {
    id: "daily_digest",
    categoryId: "personal_efficiency",
    categoryTitle: CATEGORY_TITLES.personal_efficiency,
    title: "Scheduled daily digest",
    summary: "Schedule a daily run that summarizes recent messages, work items, automations, and selected workspace state.",
    primaryUseCases: ["daily briefing", "end-of-day summary", "status digest"],
    nativeTools: ["search_sessions", "search_memory", "list_automations", "create_automation"],
    workspaceSkills: [],
    requiredConnectors: [],
    optionalConnectors: ["telegram", "discord", "email"],
    requiredSecrets: [],
    outputArtifacts: ["daily_digest", "source_evidence", "delivery_record"],
    risk: "always_on",
    liveActionPolicy: "Autonomous delivery requires an active automation and outbound channel approval policy.",
  },
  {
    id: "office_document_processing",
    categoryId: "content_creation",
    categoryTitle: CATEGORY_TITLES.content_creation,
    title: "PDF, Word, Excel, and PPT document processing",
    summary: "Read, transform, summarize, and generate document artifacts using workspace files and document-oriented skills.",
    primaryUseCases: ["PDF summary", "Word rewrite", "spreadsheet analysis", "PPT outline"],
    nativeTools: ["read_file", "write_file", "append_file", "search_files"],
    workspaceSkills: ["pdf", "documents", "spreadsheets", "presentations"],
    requiredConnectors: [],
    optionalConnectors: ["local_filesystem"],
    requiredSecrets: [],
    outputArtifacts: ["document_inventory", "extracted_text", "generated_document", "verification_report"],
    risk: "local_write",
    liveActionPolicy: "Generated files are workspace writes and must preserve source evidence plus verification notes.",
  },
  {
    id: "rich_article_generation",
    categoryId: "content_creation",
    categoryTitle: CATEGORY_TITLES.content_creation,
    title: "AI-generated rich articles",
    summary: "Create structured articles with brief, outline, draft, revision notes, and optional image or citation requirements.",
    primaryUseCases: ["blog post", "long-form article", "campaign copy"],
    nativeTools: ["web_search", "web_fetch", "write_file", "append_file"],
    workspaceSkills: ["blog-writer", "copywriting", "seo-content-writer"],
    requiredConnectors: [],
    optionalConnectors: ["imagegen"],
    requiredSecrets: [],
    outputArtifacts: ["brief", "outline", "draft", "revision_log"],
    risk: "local_write",
    liveActionPolicy: "Publishing remains separate from drafting and requires platform-specific approval.",
  },
  {
    id: "multi_platform_social_publish",
    categoryId: "content_creation",
    categoryTitle: CATEGORY_TITLES.content_creation,
    title: "Multi-platform social publishing",
    summary: "Prepare platform-specific posts and route approved publishing jobs to configured social connectors.",
    primaryUseCases: ["X post", "LinkedIn post", "Discord announcement", "Telegram channel post"],
    nativeTools: ["write_file", "create_automation"],
    workspaceSkills: ["social-content", "social-media-scheduler"],
    requiredConnectors: ["social_publish"],
    optionalConnectors: ["telegram", "discord", "linkedin", "x"],
    requiredSecrets: ["SOCIAL_PUBLISH_API_KEY"],
    outputArtifacts: ["post_variants", "approval_record", "publish_handoff", "delivery_record"],
    risk: "external_write",
    liveActionPolicy: "Every live post requires human approval of final copy and a configured platform credential.",
  },
  {
    id: "content_calendar",
    categoryId: "content_creation",
    categoryTitle: CATEGORY_TITLES.content_creation,
    title: "Automatic content calendar management",
    summary: "Maintain a content queue, schedule future drafts, and create recurring production reminders.",
    primaryUseCases: ["editorial calendar", "campaign schedule", "recurring content tasks"],
    nativeTools: ["write_file", "append_file", "create_automation", "list_automations"],
    workspaceSkills: ["content-strategy", "social-media-scheduler"],
    requiredConnectors: [],
    optionalConnectors: ["calendar", "notion"],
    requiredSecrets: [],
    outputArtifacts: ["calendar_plan", "content_queue", "automation_records"],
    risk: "local_write",
    liveActionPolicy: "Calendar updates are local by default; external calendar sync needs connector configuration and approval.",
  },
  {
    id: "github_project_management",
    categoryId: "development_workflow",
    categoryTitle: CATEGORY_TITLES.development_workflow,
    title: "GitHub project automation",
    summary: "Inspect repositories, prepare issue or PR actions, and run GitHub workflows through explicit operator approval.",
    primaryUseCases: ["issue triage", "PR summary", "release checklist", "project board update"],
    nativeTools: ["git_status", "git_diff", "run_command", "create_automation"],
    workspaceSkills: ["github:github", "gh-address-comments", "gh-fix-ci"],
    requiredConnectors: ["github"],
    optionalConnectors: [],
    requiredSecrets: ["GITHUB_TOKEN"],
    outputArtifacts: ["repo_snapshot", "triage_plan", "github_handoff", "verification_log"],
    risk: "external_write",
    liveActionPolicy: "Mutating GitHub actions require auth, scoped command review, and a visible action summary.",
  },
  {
    id: "code_review_docs",
    categoryId: "development_workflow",
    categoryTitle: CATEGORY_TITLES.development_workflow,
    title: "Code review and documentation generation",
    summary: "Review code changes, generate docs, and verify outputs through tests or static checks.",
    primaryUseCases: ["code review", "README update", "API docs", "changelog"],
    nativeTools: ["git_diff", "read_file", "write_file", "run_verification"],
    workspaceSkills: ["Code", "git-essentials"],
    requiredConnectors: [],
    optionalConnectors: ["github"],
    requiredSecrets: [],
    outputArtifacts: ["review_findings", "documentation_patch", "verification_evidence"],
    risk: "local_write",
    liveActionPolicy: "Docs can be written locally; publishing or PR comments require separate GitHub approval.",
  },
  {
    id: "browser_automation_testing",
    categoryId: "development_workflow",
    categoryTitle: CATEGORY_TITLES.development_workflow,
    title: "Browser automation testing",
    summary: "Open pages, run browser steps, capture snapshots/screenshots, and report UI regressions.",
    primaryUseCases: ["smoke test", "form flow", "visual check", "browser regression"],
    nativeTools: ["browser_open", "browser_snapshot", "browser_click", "browser_type", "browser_screenshot", "browser_run"],
    workspaceSkills: ["playwright", "browser-use:browser"],
    requiredConnectors: [],
    optionalConnectors: ["local_browser"],
    requiredSecrets: [],
    outputArtifacts: ["browser_trace", "screenshot", "regression_report"],
    risk: "external_write",
    liveActionPolicy: "Browser tests can click external systems, so form submissions and account actions require approval.",
  },
  {
    id: "backup_monitoring",
    categoryId: "development_workflow",
    categoryTitle: CATEGORY_TITLES.development_workflow,
    title: "Scheduled backup and monitoring",
    summary: "Create recurring backup, health-check, or repository monitoring jobs with verification evidence.",
    primaryUseCases: ["nightly backup", "CI monitor", "artifact retention", "health check"],
    nativeTools: ["create_automation", "list_automations", "run_verification", "git_status"],
    workspaceSkills: ["automation-workflows"],
    requiredConnectors: [],
    optionalConnectors: ["github", "storage"],
    requiredSecrets: [],
    outputArtifacts: ["automation_record", "backup_manifest", "health_report"],
    risk: "always_on",
    liveActionPolicy: "Backups and monitors require explicit schedule, retention target, and failure notification policy.",
  },
  {
    id: "data_collection_monitoring",
    categoryId: "intelligent_automation",
    categoryTitle: CATEGORY_TITLES.intelligent_automation,
    title: "Scheduled data collection and monitoring",
    summary: "Run recurring data collection, persist evidence, and compare new observations against thresholds.",
    primaryUseCases: ["price monitor", "website monitor", "dataset watcher", "API polling"],
    nativeTools: ["web_search", "web_fetch", "create_automation", "save_memory"],
    workspaceSkills: ["Market Research", "automation-workflows"],
    requiredConnectors: [],
    optionalConnectors: ["http_api", "database"],
    requiredSecrets: [],
    outputArtifacts: ["collection_snapshot", "threshold_report", "memory_record"],
    risk: "always_on",
    liveActionPolicy: "Collection frequency, retention, and target domains must be explicit before activation.",
  },
  {
    id: "anomaly_alerts",
    categoryId: "intelligent_automation",
    categoryTitle: CATEGORY_TITLES.intelligent_automation,
    title: "Automatic anomaly alerts",
    summary: "Compare fresh observations against rules, classify severity, and send approved alerts through configured channels.",
    primaryUseCases: ["metric anomaly", "website change", "security finding", "market move"],
    nativeTools: ["web_fetch", "scan_secrets", "create_automation"],
    workspaceSkills: ["security-auditor", "automation-workflows"],
    requiredConnectors: ["alert_channel"],
    optionalConnectors: ["telegram", "discord", "slack", "email"],
    requiredSecrets: ["ALERT_WEBHOOK_URL"],
    outputArtifacts: ["anomaly_report", "alert_payload", "delivery_record"],
    risk: "external_write",
    liveActionPolicy: "Alerts require severity rules, dedupe windows, and a configured outbound channel.",
  },
  {
    id: "message_sync_forwarding",
    categoryId: "intelligent_automation",
    categoryTitle: CATEGORY_TITLES.intelligent_automation,
    title: "Cross-platform message sync and forwarding",
    summary: "Normalize inbound messages, apply routing rules, and forward approved messages across configured channels.",
    primaryUseCases: ["Telegram to Discord", "Discord to Slack", "support inbox mirror"],
    nativeTools: ["create_automation", "search_sessions", "save_memory"],
    workspaceSkills: [],
    requiredConnectors: ["source_channel", "destination_channel"],
    optionalConnectors: ["telegram", "discord", "slack", "teams", "feishu"],
    requiredSecrets: ["SOURCE_CHANNEL_TOKEN", "DESTINATION_CHANNEL_TOKEN"],
    outputArtifacts: ["routing_rule", "normalized_message", "forward_delivery_record"],
    risk: "external_write",
    liveActionPolicy: "Forwarding requires source allowlists, loop prevention, and destination approval rules.",
  },
  {
    id: "always_on_operations",
    categoryId: "intelligent_automation",
    categoryTitle: CATEGORY_TITLES.intelligent_automation,
    title: "24x7 unattended operation",
    summary: "Expose a guarded always-on operating model with health checks, automation records, recovery policy, and audit artifacts.",
    primaryUseCases: ["daemon mode", "self-healing monitor", "queue worker", "long-running assistant"],
    nativeTools: ["process_start", "process_list", "process_logs", "process_stop", "list_automations"],
    workspaceSkills: ["automation-workflows"],
    requiredConnectors: [],
    optionalConnectors: ["supervisor", "systemd", "windows_task_scheduler"],
    requiredSecrets: [],
    outputArtifacts: ["service_manifest", "health_report", "audit_log", "recovery_plan"],
    risk: "always_on",
    liveActionPolicy: "Unattended mode requires bounded permissions, restart limits, logs, and explicit stop controls.",
  },
];

export function registerOmniWorkflowTools(registry: WorkflowToolRegistry): void {
  registry.register({
    name: "omni_workflow_catalog",
    description: "List the four assistant workflow categories and the 16 product capabilities they cover.",
    inputHint: "{ category?: string, query?: string, includeDetails?: boolean }",
    riskHint: "read-only workflow capability catalog",
    async execute(_context, args) {
      const workflows = filterWorkflows(args);
      const includeDetails = normalizeBoolean(args.includeDetails);
      const payload = {
        categories: buildCategorySummaries(workflows, includeDetails),
        workflowCount: workflows.length,
        totalWorkflowCount: WORKFLOWS.length,
      };
      return {
        ok: true,
        summary: `Listed ${workflows.length} omni workflow capability/capabilities across ${payload.categories.length} category/categories.`,
        data: payload,
        presentation: buildTextPresentation("Omni workflow catalog", formatCatalog(workflows)),
      };
    },
  });

  registry.register({
    name: "omni_connector_probe",
    description: "Check whether connector environment variables required by one or more omni workflows are configured without exposing secret values.",
    inputHint: "{ workflowId?: string, connector?: string, category?: string }",
    riskHint: "read-only connector configuration probe",
    async execute(_context, args) {
      const workflows = filterWorkflows(args);
      const connectorFilter = normalizeString(args.connector)?.toLowerCase();
      const statuses = buildConnectorStatuses(workflows).filter((entry) =>
        connectorFilter ? entry.name.toLowerCase().includes(connectorFilter) : true,
      );
      const configuredCount = statuses.filter((entry) => entry.configured).length;
      return {
        ok: true,
        summary: `Checked ${statuses.length} connector(s); ${configuredCount} configured.`,
        data: {
          connectors: statuses,
          configuredCount,
          missingCount: statuses.length - configuredCount,
        },
        presentation: buildTextPresentation(
          "Omni connector probe",
          statuses.map((entry) => `${entry.name}: ${entry.configured ? "configured" : `missing ${entry.missingSecrets.join(", ") || "secrets"}`}`).join("\n"),
        ),
      };
    },
  });

  registry.register({
    name: "omni_workflow_plan",
    description: "Build a concrete, approval-aware execution plan for one of the personal, content, development, or automation capabilities.",
    inputHint: "{ workflowId?: string, intent?: string, category?: string, mode?: 'dry_run'|'live', schedule?: string }",
    riskHint: "read-only workflow planning",
    async execute(_context, args) {
      const workflow = resolveWorkflow(args);
      const mode = normalizeMode(args.mode);
      const connectorStatuses = buildConnectorStatuses([workflow]);
      const missingSecrets = connectorStatuses.flatMap((entry) => entry.missingSecrets);
      const plan = buildWorkflowPlan(workflow, args, mode, connectorStatuses, missingSecrets);
      return {
        ok: true,
        summary: `Prepared ${mode} plan for ${workflow.title}.`,
        data: plan,
        warnings: plan.warnings,
        presentation: buildTextPresentation("Omni workflow plan", formatWorkflowPlan(plan)),
      };
    },
  });

  registry.register({
    name: "omni_workflow_dry_run",
    description: "Produce a replayable dry-run artifact for an omni workflow without calling external services or mutating accounts.",
    inputHint: "{ workflowId?: string, intent?: string, category?: string, approved?: boolean, mode?: 'dry_run'|'live', evidence?: object }",
    riskHint: "read-only dry-run execution artifact",
    async execute(_context, args) {
      const workflow = resolveWorkflow(args);
      const requestedMode = normalizeMode(args.mode);
      const approved = normalizeBoolean(args.approved);
      const connectorStatuses = buildConnectorStatuses([workflow]);
      const missingSecrets = connectorStatuses.flatMap((entry) => entry.missingSecrets);
      const plan = buildWorkflowPlan(workflow, args, requestedMode, connectorStatuses, missingSecrets);
      const liveBlockedReasons = buildLiveBlockedReasons(workflow, requestedMode, approved, missingSecrets);
      const artifact = {
        id: `omni-workflow-${workflow.id}-${new Date().toISOString()}`,
        workflowId: workflow.id,
        title: workflow.title,
        requestedMode,
        executedMode: "dry_run" as const,
        externalCallsMade: false,
        workspaceMutationsMade: false,
        approved,
        liveBlocked: liveBlockedReasons.length > 0,
        liveBlockedReasons,
        plan,
        evidence: isRecord(args.evidence) ? redactRecord(args.evidence) : {},
        createdAt: new Date().toISOString(),
      };
      return {
        ok: true,
        summary: liveBlockedReasons.length > 0
          ? `Dry-ran ${workflow.title}; live execution blocked: ${liveBlockedReasons.join("; ")}.`
          : `Dry-ran ${workflow.title}; no external calls or workspace mutations were made.`,
        data: artifact,
        warnings: liveBlockedReasons,
        presentation: buildTextPresentation(
          "Omni workflow dry run",
          `workflow: ${workflow.id}\nrequestedMode: ${requestedMode}\nexecutedMode: dry_run\nexternalCallsMade: false\nliveBlocked: ${liveBlockedReasons.length > 0}`,
        ),
      };
    },
  });
}

function filterWorkflows(args: Record<string, unknown>): WorkflowDefinition[] {
  const category = normalizeCategory(args.category);
  const workflowId = normalizeString(args.workflowId ?? args.id)?.toLowerCase();
  const query = normalizeString(args.query ?? args.intent)?.toLowerCase();
  return WORKFLOWS.filter((workflow) => {
    if (workflowId && workflow.id !== workflowId) {
      return false;
    }
    if (category && workflow.categoryId !== category) {
      return false;
    }
    if (!query) {
      return true;
    }
    return workflowMatches(workflow, query);
  });
}

function resolveWorkflow(args: Record<string, unknown>): WorkflowDefinition {
  const workflowId = normalizeString(args.workflowId ?? args.id)?.toLowerCase();
  if (workflowId) {
    const byId = WORKFLOWS.find((workflow) => workflow.id === workflowId);
    if (byId) {
      return byId;
    }
    throw new Error(`Unknown omni workflow id: ${workflowId}`);
  }
  const candidates = filterWorkflows(args);
  if (candidates.length > 0) {
    return candidates[0]!;
  }
  return WORKFLOWS[0]!;
}

function workflowMatches(workflow: WorkflowDefinition, query: string): boolean {
  const fields = [
    workflow.id,
    workflow.categoryId,
    workflow.categoryTitle,
    workflow.title,
    workflow.summary,
    ...workflow.primaryUseCases,
    ...workflow.nativeTools,
    ...workflow.workspaceSkills,
    ...workflow.requiredConnectors,
    ...workflow.optionalConnectors,
  ];
  return fields.some((field) => field.toLowerCase().includes(query));
}

function buildCategorySummaries(workflows: readonly WorkflowDefinition[], includeDetails: boolean) {
  return (Object.keys(CATEGORY_TITLES) as WorkflowCategoryId[])
    .map((categoryId) => {
      const categoryWorkflows = workflows.filter((workflow) => workflow.categoryId === categoryId);
      return {
        id: categoryId,
        title: CATEGORY_TITLES[categoryId],
        count: categoryWorkflows.length,
        workflows: includeDetails
          ? categoryWorkflows.map((workflow) => summarizeWorkflow(workflow))
          : categoryWorkflows.map((workflow) => ({ id: workflow.id, title: workflow.title })),
      };
    })
    .filter((category) => category.count > 0);
}

function summarizeWorkflow(workflow: WorkflowDefinition) {
  return {
    id: workflow.id,
    title: workflow.title,
    summary: workflow.summary,
    nativeTools: workflow.nativeTools,
    workspaceSkills: workflow.workspaceSkills,
    requiredConnectors: workflow.requiredConnectors,
    requiredSecrets: workflow.requiredSecrets,
    risk: workflow.risk,
    outputArtifacts: workflow.outputArtifacts,
    liveActionPolicy: workflow.liveActionPolicy,
  };
}

function buildConnectorStatuses(workflows: readonly WorkflowDefinition[]): ConnectorStatus[] {
  const requiredSecretsByConnector = new Map<string, Set<string>>();
  for (const workflow of workflows) {
    const connectors = workflow.requiredConnectors.length > 0 ? workflow.requiredConnectors : workflow.optionalConnectors;
    for (const connector of connectors) {
      const existing = requiredSecretsByConnector.get(connector) ?? new Set<string>();
      for (const secret of workflow.requiredSecrets) {
        existing.add(secret);
      }
      requiredSecretsByConnector.set(connector, existing);
    }
  }
  return Array.from(requiredSecretsByConnector.entries())
    .map(([name, secretSet]) => {
      const requiredSecrets = Array.from(secretSet).sort();
      const missingSecrets = requiredSecrets.filter((secret) => !hasConfiguredSecret(secret));
      return {
        name,
        configured: missingSecrets.length === 0,
        requiredSecrets,
        missingSecrets,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildWorkflowPlan(
  workflow: WorkflowDefinition,
  args: Record<string, unknown>,
  mode: WorkflowMode,
  connectorStatuses: readonly ConnectorStatus[],
  missingSecrets: readonly string[],
) {
  const intent = normalizeString(args.intent) ?? workflow.summary;
  const schedule = normalizeString(args.schedule);
  const approvalRequired = workflow.risk === "external_write" || workflow.risk === "always_on" || mode === "live";
  const warnings = [
    ...(mode === "live" && missingSecrets.length > 0 ? [`Missing connector secrets: ${missingSecrets.join(", ")}`] : []),
    ...(mode === "live" ? ["Live mode is a handoff plan only; this tool does not call external services."] : []),
    ...(workflow.risk === "always_on" && !schedule ? ["Always-on workflows should define an explicit schedule or health cadence."] : []),
  ];
  return {
    workflow: summarizeWorkflow(workflow),
    intent,
    mode,
    schedule: schedule ?? null,
    approvalRequired,
    connectorStatuses,
    missingSecrets,
    steps: buildWorkflowSteps(workflow, approvalRequired),
    requiredArtifacts: workflow.outputArtifacts,
    liveActionPolicy: workflow.liveActionPolicy,
    warnings,
  };
}

function buildWorkflowSteps(workflow: WorkflowDefinition, approvalRequired: boolean): WorkflowStep[] {
  const steps: WorkflowStep[] = [
    {
      id: "collect_evidence",
      title: "Collect source evidence",
      tool: workflow.nativeTools[0] ?? "search_tools",
      purpose: "Gather the current files, messages, browser state, API data, or run history needed for the workflow.",
      approvalRequired: false,
    },
    {
      id: "draft_plan",
      title: "Draft plan and risk report",
      tool: "omni_workflow_plan",
      purpose: "Turn the user intent into ordered actions, expected artifacts, and approval boundaries.",
      approvalRequired: false,
    },
    {
      id: "produce_artifact",
      title: "Produce workflow artifact",
      tool: workflow.nativeTools.includes("write_file") ? "write_file" : "omni_workflow_dry_run",
      purpose: "Create the local draft, report, automation record, browser trace, or handoff payload.",
      approvalRequired: workflow.risk === "local_write",
    },
  ];
  if (approvalRequired) {
    steps.push({
      id: "approval_gate",
      title: "Approval gate",
      tool: "approval_policy",
      purpose: workflow.liveActionPolicy,
      approvalRequired: true,
    });
  }
  steps.push({
    id: "verify",
    title: "Verify and record evidence",
    tool: workflow.nativeTools.includes("run_verification") ? "run_verification" : "read_artifact",
    purpose: "Record the final output, source evidence, and any skipped live actions for replay.",
    approvalRequired: false,
  });
  return steps;
}

function buildLiveBlockedReasons(
  workflow: WorkflowDefinition,
  requestedMode: WorkflowMode,
  approved: boolean,
  missingSecrets: readonly string[],
): string[] {
  if (requestedMode !== "live") {
    return [];
  }
  return [
    ...(!approved ? ["approved=true was not supplied"] : []),
    ...(missingSecrets.length > 0 ? [`missing connector secrets: ${missingSecrets.join(", ")}`] : []),
    "omni_workflow_dry_run never performs external writes; use the named connector tool after approval",
    ...(workflow.risk === "always_on" ? ["always-on workflows need a bounded schedule and stop policy"] : []),
  ];
}

function formatCatalog(workflows: readonly WorkflowDefinition[]): string {
  return buildCategorySummaries(workflows, false)
    .map((category) => `${category.title}\n${category.workflows.map((workflow) => `- ${workflow.id}: ${workflow.title}`).join("\n")}`)
    .join("\n\n");
}

function formatWorkflowPlan(plan: ReturnType<typeof buildWorkflowPlan>): string {
  return [
    `workflow: ${plan.workflow.id}`,
    `mode: ${plan.mode}`,
    `approvalRequired: ${plan.approvalRequired}`,
    `missingSecrets: ${plan.missingSecrets.join(", ") || "none"}`,
    "steps:",
    ...plan.steps.map((step) => `- ${step.id}: ${step.tool}${step.approvalRequired ? " (approval)" : ""}`),
  ].join("\n");
}

function buildTextPresentation(title: string, text: string): WorkflowToolResult["presentation"] {
  return {
    title,
    kind: "read",
    content: [{ type: "text", text }],
  };
}

function normalizeCategory(value: unknown): WorkflowCategoryId | undefined {
  const normalized = normalizeString(value)?.toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "personal_efficiency" ||
    normalized === "content_creation" ||
    normalized === "development_workflow" ||
    normalized === "intelligent_automation"
  ) {
    return normalized;
  }
  return undefined;
}

function normalizeMode(value: unknown): WorkflowMode {
  return String(value ?? "").trim().toLowerCase() === "live" ? "live" : "dry_run";
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function hasConfiguredSecret(name: string): boolean {
  return typeof process.env[name] === "string" && process.env[name]!.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function redactRecord(record: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    redacted[key] = /secret|token|key|password/i.test(key) ? "[redacted]" : value;
  }
  return redacted;
}
