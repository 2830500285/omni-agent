export interface WorkbenchState {
  health: unknown;
  workspaces: unknown[];
  agents: unknown[];
  profiles: unknown[];
  routes: unknown[];
  channels: unknown[];
  providers: unknown[];
  channelPlugins: unknown[];
  operatorState: OperatorState | null;
  runs: unknown[];
  threads: unknown[];
  skills: unknown[];
  memories: unknown[];
  authProfiles: unknown[];
  contextEngines: unknown[];
  memoryProviders: unknown[];
  automations: unknown[];
  auditLogs: unknown[];
  events: unknown[];
  evaluations: unknown[];
  selectedAgentId: string;
  selectedEvaluationId: string;
  activeView: string;
}

export interface OperatorState {
  readonly workspace?: unknown;
  readonly generatedAt?: string;
  readonly operations?: {
    readonly jobs?: Array<Record<string, unknown>>;
    readonly threads?: Array<Record<string, unknown>>;
    readonly runs?: Array<Record<string, unknown>>;
    readonly subagents?: Array<Record<string, unknown>>;
    readonly events?: Array<Record<string, unknown>>;
    readonly deliveries?: Array<Record<string, unknown>>;
    readonly routes?: Array<Record<string, unknown>>;
    readonly nodes?: Array<Record<string, unknown>>;
  };
  readonly diagnostics?: Record<string, unknown>;
  readonly controls?: Record<string, unknown>;
}

export function createInitialWorkbenchState(): WorkbenchState {
  return {
    health: null,
    workspaces: [],
    agents: [],
    profiles: [],
    routes: [],
    channels: [],
    providers: [],
    channelPlugins: [],
    operatorState: null,
    runs: [],
    threads: [],
    skills: [],
    memories: [],
    authProfiles: [],
    contextEngines: [],
    memoryProviders: [],
    automations: [],
    auditLogs: [],
    events: [],
    evaluations: [],
    selectedAgentId: "",
    selectedEvaluationId: "",
    activeView: "chat",
  };
}
