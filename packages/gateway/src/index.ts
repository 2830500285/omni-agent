import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { AutomationScheduler } from "@omni-agent/automation";
import {
  controlLiveSubagent,
  describeEffectiveToolPolicy,
  isSubagentLiveControllable,
  listBuiltinMemoryProviders,
  type AgentRuntimeEvent,
  type RuntimeToolPolicy,
  type ToolPolicyRule,
} from "@omni-agent/core-runtime";
import {
  getAgentCapabilityProfile,
  listAgentCapabilityProfiles,
  listBuiltinContextEngines,
  type AgentCapabilityProfile,
} from "@omni-agent/context";
import { createDefaultExtensionRegistry, createExtensionRuntimeTools, loadExtensionRegistry, mergeExtensionRegistries } from "@omni-agent/extensions";
import {
  SqliteSessionStore,
  type AuthProfileHealthStatus,
  type AutomationRecord,
  type AutomationScheduleKind,
  type AutomationTriggerEvent,
  type ChannelRouteRecord,
  type InboundMessageRecord,
  type OutboundDeliveryRecord,
  type PersistedSubagentJobRecord,
  type RoutePairingRecord,
} from "@omni-agent/session-store";
import { ToolRegistry, registerBuiltInTools } from "@omni-agent/tools";
import { LocalWorkspaceService, type WorkspaceMemoryFileKind } from "@omni-agent/workspace";
import { hasModelProfileApiKey, loadModelProfilesFromEnv } from "@omni-agent/model-client";

import { createDefaultRouteAdapterRegistry, type RouteAdapterRegistry } from "./adapters.js";
import {
  buildAcpManifest,
  buildAcpPromptResponse,
  buildAcpRunRequest,
  createAcpSession,
  listAcpSessions,
  loadAcpSession,
  normalizeAcpCwd,
  normalizeAcpCreateSessionRequest,
  normalizeAcpListSessionsRequest,
  normalizeAcpLoadSessionRequest,
  normalizeAcpPromptPayload,
  presentAcpSession,
  presentGatewayEventWithAcpProjection,
  projectRuntimeEventToAcpEvent,
  type AcpPromptPayload,
  type AcpSessionPresentation,
} from "./acp-bridge.js";
import { getDefaultChannelPlugin, listDefaultChannelPlugins, type ChannelPlugin } from "./channel-plugin.js";
import { GatewayControlPlane, type GatewayNodeRecord } from "./control-plane.js";
import { GatewayEventBus } from "./event-bus.js";
import { GatewayJobStore, type GatewayJobRecord } from "./jobs.js";
import {
  prepareRouteDefinition,
  getChannelCapability,
  getChannelProviderManifest,
  listChannelCapabilities,
  listChannelProviderManifests,
  resolveRouteSenderPolicy as resolveRouteSenderPolicyFromConfig,
  RouteConfigurationError,
  shouldDefaultRouteToPairing,
} from "./routes.js";
import {
  buildRunRequestFromAutomation,
  cleanupRunExecution,
  executeGatewayRunRequest,
  getRunDetails,
  normalizeRunRequest,
  type GatewayMode,
  type GatewayRuntimeDefaults,
  type NormalizedGatewayRunRequest,
} from "./runner.js";

export type { GatewayMode, GatewayRuntimeDefaults, GatewayRunRequest } from "./runner.js";
export {
  buildPlatformOutboundPayload,
  normalizeOutboundMessage,
  type OutboundAttachment,
  type OutboundMessage,
  type PlatformOutboundPayloadKind,
} from "./messages.js";
export {
  getChannelCapability,
  getChannelProviderManifest,
  listChannelCapabilities,
  listChannelProviderManifests,
  prepareRouteDefinition,
  RouteConfigurationError,
  shouldDefaultRouteToPairing,
} from "./routes.js";
export {
  buildChannelPluginContractReport,
  getDefaultChannelPlugin,
  listDefaultChannelPlugins,
  redactChannelPluginConfig,
  validateChannelPluginContract,
  type ChannelPlugin,
  type ChannelPluginContractIssue,
  type ChannelPluginContractReport,
} from "./channel-plugin.js";

export interface StartGatewayServerOptions extends GatewayRuntimeDefaults {
  readonly host?: string;
  readonly port?: number;
  readonly accessToken?: string;
}

export interface GatewayServerHandle {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

interface GatewayRuntimeContext {
  readonly options: StartGatewayServerOptions;
  readonly eventBus: GatewayEventBus;
  readonly jobStore: GatewayJobStore;
  readonly adapterRegistry: RouteAdapterRegistry;
  readonly scheduler: AutomationScheduler;
  readonly acpActiveJobs: Map<string, string>;
  readonly acpJobCancellations: Map<string, AsyncJobCancellation>;
  readonly acpJobExecutions: Map<string, Promise<void>>;
}

interface GatewayRequestContext extends GatewayRuntimeContext {
  readonly server: HttpServer;
  readonly controlPlane: GatewayControlPlane;
}

interface AsyncJobCallbacks {
  readonly cancellation?: AsyncJobCancellation;
  readonly onCompleted?: (result: { runId?: string; threadId?: string }) => void | Promise<void>;
  readonly onFailed?: (error: string) => void | Promise<void>;
  readonly onCancelled?: (reason: string) => void | Promise<void>;
}

interface AsyncJobCancellation {
  readonly signal: AbortSignal;
  readonly cancelled: Promise<never>;
  cancel(reason: string): void;
}

class AsyncJobCancelledError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AsyncJobCancelledError";
  }
}

export async function startGatewayServer(
  options: StartGatewayServerOptions = {},
): Promise<GatewayServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4040;
  const eventBus = new GatewayEventBus();
  const jobStore = new GatewayJobStore();
  const adapterRegistry = createDefaultRouteAdapterRegistry();
  const acpActiveJobs = new Map<string, string>();
  const acpJobCancellations = new Map<string, AsyncJobCancellation>();
  const acpJobExecutions = new Map<string, Promise<void>>();
  const schedulerStore = new SqliteSessionStore(options.storageRoot);
  schedulerStore.initialize();
  let scheduler!: AutomationScheduler;
  const runtimeContext = {
    options,
    eventBus,
    jobStore,
    adapterRegistry,
    acpActiveJobs,
    acpJobCancellations,
    acpJobExecutions,
    get scheduler() {
      return scheduler;
    },
  } as GatewayRuntimeContext;
  scheduler = new AutomationScheduler(schedulerStore, {
    onAutomationRun: async (automation, trigger) =>
      runAutomationNow(automation, options, eventBus, adapterRegistry, trigger),
    eventHandler: async (event) => {
      eventBus.publish({
        type: event.type,
        at: event.at,
        data: event,
      });
    },
  });
  scheduler.start();
  let controlPlane: GatewayControlPlane;
  const server = createServer((request, response) => {
    void handleRequest(
      {
        ...runtimeContext,
        server,
        controlPlane,
      },
      request,
      response,
    );
  });
  controlPlane = new GatewayControlPlane({
    server,
    eventBus,
    accessToken: options.accessToken,
    onRunRequest: async (payload) => enqueueControlPlaneRun(runtimeContext, payload),
    onRouteDelivery: async (payload) => dispatchControlPlaneDelivery(runtimeContext, payload),
    onDeliveryRetry: async (payload) => retryControlPlaneDelivery(runtimeContext, payload),
    onSubagentControl: async (payload) => dispatchControlPlaneSubagentControl(runtimeContext, payload),
    onInboundMessage: async (payload) => acceptControlPlaneInboundMessage(runtimeContext, payload),
  });

  const telegramOffsets = new Map<string, number>();
  const slackOffsets = new Map<string, string>();
  const discordOffsets = new Map<string, string>();
  const deliveryRetryTimer = setInterval(() => {
    void retryPendingDeliveries({
      storageRoot: options.storageRoot,
      eventBus,
      adapterRegistry,
    });
  }, 3_000);
  const routePollingTimer = setInterval(() => {
    void pollTelegramRoutes({
      context: runtimeContext,
      offsets: telegramOffsets,
    });
    void pollSlackRoutes({
      context: runtimeContext,
      offsets: slackOffsets,
    });
    void pollDiscordRoutes({
      context: runtimeContext,
      offsets: discordOffsets,
    });
  }, 2_500);
  deliveryRetryTimer.unref?.();
  routePollingTimer.unref?.();

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Gateway server failed to resolve a TCP address.");
  }

  return {
    host,
    port: address.port,
    url: `http://${host}:${address.port}`,
    close: async () => {
      scheduler.stop();
      clearInterval(deliveryRetryTimer);
      clearInterval(routePollingTimer);
      for (const cancellation of acpJobCancellations.values()) {
        cancellation.cancel("Gateway server is closing.");
      }
      await Promise.race([
        Promise.allSettled([...acpJobExecutions.values()]),
        new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000)),
      ]);
      await controlPlane.close();
      schedulerStore.close();
      const closeServer = new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolvePromise();
        });
      });
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await closeServer;
    },
  };
}

async function handleRequest(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: "Missing request URL." });
      return;
    }

    const method = request.method ?? "GET";
    const url = new URL(request.url, resolveBaseUrl(context.server));
    const path = trimTrailingSlash(url.pathname);

    if (
      context.options.accessToken &&
      path !== "/health" &&
      path !== "/app" &&
      !(method === "POST" && path === "/inbox/messages") &&
      !(method === "POST" && /^\/inbox\/enterprise\/(feishu|dingtalk|teams)$/.test(path)) &&
      !(method === "POST" && /^\/inbox\/consumer\/(whatsapp|signal|matrix|voice|canvas|mobile-node|media)$/.test(path)) &&
      !(method === "POST" && /^\/mobile-node\/[^/]+\/events$/.test(path)) &&
      !hasGatewayAuthorization(request, context.options.accessToken)
    ) {
      sendJson(response, 401, { error: "Unauthorized gateway request." });
      return;
    }

    if (method === "GET" && path === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "omni-agent-gateway",
        now: new Date().toISOString(),
      });
      return;
    }

    if (method === "GET" && path === "/app") {
      sendHtml(response, 200, loadWorkbenchHtml(Boolean(context.options.accessToken)));
      return;
    }

    if (method === "GET" && path === "/events") {
      openEventStream(context.eventBus, response, request);
      return;
    }

    if (method === "GET" && path === "/events/history") {
      const events = context.eventBus.list(parsePositiveNumber(url.searchParams.get("limit"), 50));
      sendJson(response, 200, {
        events: events.map((event) => presentGatewayEventWithAcpProjection(event)),
        acpEvents: events.map((event) => presentGatewayEventWithAcpProjection(event).acp).filter(Boolean),
      });
      return;
    }

    if (method === "GET" && path === "/operator-state") {
      await handleOperatorState(context, url, response);
      return;
    }

    if (method === "GET" && path === "/extensions") {
      const registry = await loadExtensionRegistry({
        cwd: context.options.cwd,
        pluginDirs: context.options.pluginDirs,
      });
      try {
        sendJson(response, 200, {
          extensions: registry.list(),
        });
      } finally {
        await registry.dispose();
      }
      return;
    }

    if (method === "GET" && path === "/context-engines") {
      const registry = await loadExtensionRegistry({
        cwd: context.options.cwd,
        pluginDirs: context.options.pluginDirs,
      });
      try {
        sendJson(response, 200, {
          contextEngines: [...listBuiltinContextEngines(), ...registry.listContextEngines()],
        });
      } finally {
        await registry.dispose();
      }
      return;
    }

    if (method === "GET" && path === "/memory-providers") {
      const cwd = context.options.cwd ?? process.cwd();
      const registry = await loadExtensionRegistry({
        cwd,
        pluginDirs: context.options.pluginDirs,
      });
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const workspace = sessionStore.getWorkspaceByCwd(cwd);
        const healthLogs = workspace
          ? sessionStore
              .listAuditLogs({ workspaceId: workspace.id, limit: 100 })
              .filter((entry) => entry.targetType === "memory_provider")
          : [];
        const latestHealthByProvider = new Map<string, (typeof healthLogs)[number]>();
        for (const entry of healthLogs) {
          if (entry.targetId && !latestHealthByProvider.has(entry.targetId)) {
            latestHealthByProvider.set(entry.targetId, entry);
          }
        }
        sendJson(response, 200, {
          memoryProviders: [...listBuiltinMemoryProviders(), ...registry.listMemoryProviders()].map((provider) => {
            const latestHealth = latestHealthByProvider.get(provider.id);
            return {
              ...provider,
              health: latestHealth
                ? latestHealth.action === "memory_provider.lifecycle.failure" ? "error" : "ok"
                : "unknown",
              lastLifecyclePhase: typeof latestHealth?.metadata.phase === "string" ? latestHealth.metadata.phase : null,
              lastLifecycleAt: latestHealth?.createdAt ?? null,
              lastError: typeof latestHealth?.metadata.lastError === "string" ? latestHealth.metadata.lastError : null,
            };
          }),
        });
      } finally {
        await registry.dispose();
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && path === "/extensions/resources") {
      const registry = await loadExtensionRegistry({
        cwd: context.options.cwd,
        pluginDirs: context.options.pluginDirs,
      });
      try {
        sendJson(response, 200, {
          resources: registry.listResources(),
        });
      } finally {
        await registry.dispose();
      }
      return;
    }

    if (method === "GET" && path === "/mcp/status") {
      const registry = await loadExtensionRegistry({
        cwd: context.options.cwd,
        pluginDirs: context.options.pluginDirs,
      });
      try {
        const mcpExtensions = registry.list().filter((extension) => extension.capability === "mcp");
        sendJson(response, 200, {
          servers: mcpExtensions,
          resources: registry
            .listResources()
            .filter((resource) => mcpExtensions.some((extension) => extension.id === resource.extensionId)),
          prompts: registry
            .listPromptTemplates()
            .filter((prompt) => mcpExtensions.some((extension) => extension.id === prompt.extensionId)),
          tools: registry
            .listToolDefinitions()
            .map((tool) => tool.name)
            .filter((name) => name.startsWith("mcp__")),
          runtimes: registry.listMcpRuntimeHealth(),
        });
      } finally {
        await registry.dispose();
      }
      return;
    }

    if (method === "GET" && /^\/extensions\/resources\/[^/]+\/[^/]+$/.test(path)) {
      const [, , , extensionIdRaw, resourceIdRaw] = path.split("/");
      const registry = await loadExtensionRegistry({
        cwd: context.options.cwd,
        pluginDirs: context.options.pluginDirs,
      });
      const resource = await registry.readResource(
        decodeURIComponent(extensionIdRaw ?? ""),
        decodeURIComponent(resourceIdRaw ?? ""),
      );
      try {
        if (!resource) {
          sendJson(response, 404, { error: "Extension resource was not found." });
          return;
        }
        sendJson(response, 200, { resource });
      } finally {
        await registry.dispose();
      }
      return;
    }

    if (method === "GET" && path === "/extensions/prompts") {
      const registry = await loadExtensionRegistry({
        cwd: context.options.cwd,
        pluginDirs: context.options.pluginDirs,
      });
      try {
        sendJson(response, 200, {
          prompts: registry.listPromptTemplates(),
        });
      } finally {
        await registry.dispose();
      }
      return;
    }

    if (method === "POST" && path === "/extensions/prompts/render") {
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const registry = await loadExtensionRegistry({
        cwd: context.options.cwd,
        pluginDirs: context.options.pluginDirs,
      });
      const extensionId = typeof body.extensionId === "string" ? body.extensionId.trim() : "";
      const promptName = typeof body.promptName === "string" ? body.promptName.trim() : "";
      if (!extensionId || !promptName) {
        await registry.dispose();
        sendJson(response, 400, { error: "extensions/prompts/render requires extensionId and promptName." });
        return;
      }
      const args = normalizePromptArguments(body.args);
      try {
        const rendered = await registry.renderPromptTemplate(extensionId, promptName, args);
        if (!rendered) {
          sendJson(response, 404, { error: "Extension prompt template was not found." });
          return;
        }
        sendJson(response, 200, { prompt: rendered });
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await registry.dispose();
      }
      return;
    }

    if (method === "GET" && path === "/acp/manifest") {
      sendJson(response, 200, { manifest: buildAcpManifest() });
      return;
    }

    if (method === "GET" && path === "/acp/events/history") {
      const events = context.eventBus.list(parsePositiveNumber(url.searchParams.get("limit"), 50));
      sendJson(response, 200, {
        events: events.map((event) => presentGatewayEventWithAcpProjection(event).acp).filter(Boolean),
      });
      return;
    }

    if (method === "GET" && path === "/acp/sessions") {
      await handleListAcpSessions(context, url, response);
      return;
    }

    if (method === "POST" && path === "/acp/sessions") {
      await handleCreateAcpSession(context, request, response);
      return;
    }

    if (method === "GET" && /^\/acp\/sessions\/[^/]+$/.test(path)) {
      const sessionId = decodeURIComponent(path.split("/")[3] ?? "");
      await handleLoadAcpSession(context, sessionId, response);
      return;
    }

    if (method === "POST" && /^\/acp\/sessions\/[^/]+\/fork$/.test(path)) {
      const sessionId = decodeURIComponent(path.split("/")[3] ?? "");
      await handleForkAcpSession(context, sessionId, request, response);
      return;
    }

    if (method === "POST" && /^\/acp\/sessions\/[^/]+\/prompt$/.test(path)) {
      const sessionId = decodeURIComponent(path.split("/")[3] ?? "");
      await handleAcpPrompt(context, sessionId, request, response);
      return;
    }

    if (method === "POST" && /^\/acp\/sessions\/[^/]+\/cancel$/.test(path)) {
      const sessionId = decodeURIComponent(path.split("/")[3] ?? "");
      await handleCancelAcpSession(context, sessionId, response);
      return;
    }

    if (method === "GET" && path === "/workspaces") {
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        sendJson(response, 200, {
          workspaces: sessionStore.listWorkspaces(),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && path === "/agent-profiles") {
      sendJson(response, 200, { profiles: listAgentCapabilityProfiles() });
      return;
    }

    if (method === "GET" && path === "/channel-capabilities") {
      sendJson(response, 200, { channels: listChannelCapabilities() });
      return;
    }

    if (method === "GET" && path === "/channel-providers") {
      sendJson(response, 200, { providers: listChannelProviderManifests() });
      return;
    }

    if (method === "GET" && path === "/channel-plugins") {
      await handleListChannelPlugins(context, url, response);
      return;
    }

    if (method === "GET" && /^\/channel-plugins\/[^/]+\/status$/.test(path)) {
      const channelType = decodeURIComponent(path.split("/")[2] ?? "");
      await handleChannelPluginStatus(context, url, response, channelType);
      return;
    }

    if (method === "GET" && /^\/channel-providers\/[^/]+$/.test(path)) {
      const channelType = decodeURIComponent(path.split("/")[2] ?? "");
      sendJson(response, 200, { provider: getChannelProviderManifest(channelType) });
      return;
    }

    if (method === "GET" && path === "/mobile-node/manifest") {
      sendJson(response, 200, buildMobileNodeManifest());
      return;
    }

    if (method === "POST" && path === "/mobile-node/register") {
      await handleMobileNodeRegistration(context, request, response);
      return;
    }

    if (method === "GET" && /^\/agent-profiles\/[^/]+\/evaluations$/.test(path)) {
      const profileId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        sendJson(response, 200, {
          profileId,
          evaluations: sessionStore.listProfileEvaluations({
            profileId,
            workspaceId: url.searchParams.get("workspaceId"),
            agentId: url.searchParams.get("agentId"),
            limit: parsePositiveNumber(url.searchParams.get("limit"), 20),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && /^\/agent-profiles\/[^/]+\/evaluations$/.test(path)) {
      const profileId = decodeURIComponent(path.split("/")[2] ?? "");
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const evaluation = sessionStore.createProfileEvaluation({
          profileId,
          workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : null,
          agentId: typeof body.agentId === "string" ? body.agentId : null,
          suiteTitle: typeof body.suiteTitle === "string" ? body.suiteTitle : "Capability scorecard",
          categories: Array.isArray(body.categories) ? body.categories.map((entry) => String(entry)) : undefined,
          metrics:
            body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics)
              ? (body.metrics as Record<string, unknown>)
              : undefined,
          scores:
            body.scores && typeof body.scores === "object" && !Array.isArray(body.scores)
              ? (body.scores as Record<string, unknown>)
              : undefined,
          passed: body.passed !== false,
          summary: typeof body.summary === "string" ? body.summary : "",
        });
        context.eventBus.publish({
          type: "profile.evaluated",
          at: new Date().toISOString(),
          data: evaluation,
        });
        sendJson(response, 201, { evaluation });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && path === "/agents") {
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        sendJson(response, 200, {
          agents: sessionStore.listAgents({
            workspaceId: url.searchParams.get("workspaceId") ?? undefined,
            statuses: parseAgentStatusFilter(url.searchParams.getAll("status")),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && path === "/agents") {
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
      if (!name || !cwd) {
        sendJson(response, 400, { error: "The agents endpoint requires non-empty name and cwd." });
        return;
      }
      const capabilityProfile = resolveAgentCapabilityProfileRequest(body.capabilityProfileId);
      if (capabilityProfile === false) {
        sendJson(response, 400, { error: `Unknown agent capability profile: ${String(body.capabilityProfileId)}` });
        return;
      }
      const requestedMemoryProviderIds = normalizeStringArrayBody(body.memoryProviderIds);
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.createAgent({
          name,
          cwd,
          status: body.status === "paused" ? "paused" : "active",
          agentType: typeof body.agentType === "string" ? body.agentType : capabilityProfile?.agentType,
          defaultRole: normalizeAgentDefaultRole(body.defaultRole) ?? capabilityProfile?.defaultRole ?? null,
          mode:
            body.mode === "bound" || body.mode === "shared" || body.mode === "locked_down"
              ? body.mode
              : capabilityProfile?.mode ?? "default",
          stateRoot: typeof body.stateRoot === "string" ? body.stateRoot : undefined,
          defaultModelProfileId: typeof body.defaultModelProfileId === "string" ? body.defaultModelProfileId : null,
          contextEngineId: typeof body.contextEngineId === "string" ? body.contextEngineId : capabilityProfile?.contextEngineId ?? null,
          memoryProviderIds: requestedMemoryProviderIds ?? (capabilityProfile ? [...capabilityProfile.memoryProviderIds] : undefined),
          instruction: typeof body.instruction === "string" ? body.instruction : null,
          authProfileId: typeof body.authProfileId === "string" ? body.authProfileId : null,
          metadata: buildAgentMetadataForCapabilityProfile(
            body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
              ? (body.metadata as Record<string, unknown>)
              : undefined,
            capabilityProfile,
          ),
        });
        sendJson(response, 201, { agent });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, { agent });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "PATCH" && /^\/agents\/[^/]+$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const capabilityProfile = Object.prototype.hasOwnProperty.call(body, "capabilityProfileId")
        ? resolveAgentCapabilityProfileRequest(body.capabilityProfileId)
        : undefined;
      if (capabilityProfile === false) {
        sendJson(response, 400, { error: `Unknown agent capability profile: ${String(body.capabilityProfileId)}` });
        return;
      }
      const requestedMemoryProviderIds =
        body.memoryProviderIds === null
          ? []
          : Array.isArray(body.memoryProviderIds)
            ? normalizeStringArrayBody(body.memoryProviderIds)
            : undefined;
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const current = sessionStore.getAgent(agentId);
        if (!current) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        const agent = sessionStore.updateAgent({
          agentId,
          name: typeof body.name === "string" ? body.name : undefined,
          cwd: typeof body.cwd === "string" ? body.cwd : undefined,
          status: body.status === "paused" || body.status === "active" ? body.status : undefined,
          agentType: typeof body.agentType === "string" ? body.agentType : capabilityProfile ? capabilityProfile.agentType : undefined,
          defaultRole:
            body.defaultRole === null
              ? null
              : normalizeAgentDefaultRole(body.defaultRole) ?? (capabilityProfile ? capabilityProfile.defaultRole : undefined),
          mode:
            body.mode === "default" || body.mode === "bound" || body.mode === "shared" || body.mode === "locked_down"
              ? body.mode
              : capabilityProfile ? capabilityProfile.mode : undefined,
          stateRoot: typeof body.stateRoot === "string" ? body.stateRoot : undefined,
          defaultModelProfileId:
            body.defaultModelProfileId === null
              ? null
              : typeof body.defaultModelProfileId === "string"
                ? body.defaultModelProfileId
                : undefined,
          contextEngineId:
            body.contextEngineId === null
              ? null
              : typeof body.contextEngineId === "string"
                ? body.contextEngineId
                : capabilityProfile ? capabilityProfile.contextEngineId : undefined,
          memoryProviderIds: requestedMemoryProviderIds ?? (capabilityProfile ? [...capabilityProfile.memoryProviderIds] : undefined),
          instruction:
            body.instruction === null
              ? null
              : typeof body.instruction === "string"
                ? body.instruction
                : undefined,
          authProfileId:
            body.authProfileId === null
              ? null
              : typeof body.authProfileId === "string"
                ? body.authProfileId
                : undefined,
          metadata: buildAgentMetadataUpdateForCapabilityProfile(current.metadata, body, capabilityProfile),
        });
        sendJson(response, 200, { agent });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/runs$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          agent,
          runs: sessionStore.listAgentRuns(agentId, parsePositiveNumber(url.searchParams.get("limit"), 20)),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/threads$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          agent,
          threads: sessionStore.listAgentThreads(agentId, parsePositiveNumber(url.searchParams.get("limit"), 20)),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/effective-tools$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const role = normalizeAgentDefaultRole(url.searchParams.get("role")) ?? undefined;
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      let registry: Awaited<ReturnType<typeof loadExtensionRegistry>> | null = null;
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        registry = await loadExtensionRegistry({
          cwd: agent.cwd,
          pluginDirs: context.options.pluginDirs,
        });
        const mergedRegistry = mergeExtensionRegistries(createDefaultExtensionRegistry(), registry);
        const toolRegistry = new ToolRegistry();
        registerBuiltInTools(toolRegistry);
        toolRegistry.registerMany(mergedRegistry.listToolDefinitions());
        toolRegistry.registerMany(createExtensionRuntimeTools(mergedRegistry));
        const capabilityProfile = getAgentCapabilityProfile(readAgentCapabilityProfileId(agent.metadata));
        const effective = describeEffectiveToolPolicy({
          toolRegistry,
          extensionRegistry: mergedRegistry,
          runtimePolicy: mergeRuntimeToolPolicies(
            capabilityProfile?.toolPolicy as RuntimeToolPolicy | undefined,
            context.options.toolPolicy,
          ),
          policyContext: {
            ...(context.options.toolPolicyContext ?? {}),
            agentId: agent.id,
            authProfileId: agent.authProfileId ?? undefined,
            profileId: agent.defaultModelProfileId ?? context.options.toolPolicyContext?.profileId,
          },
          role: role ?? agent.defaultRole ?? undefined,
        });
        sendJson(response, 200, {
          agent,
          authProfileState: agent.authProfileId ? sessionStore.getAuthProfileState(agent.authProfileId) : null,
          capabilityProfile,
          contextEngine:
            agent.contextEngineId
              ? [...listBuiltinContextEngines(), ...mergedRegistry.listContextEngines()].find(
                  (entry) => entry.id === agent.contextEngineId,
                ) ?? null
              : null,
          memoryProviders: agent.memoryProviderIds.length > 0
            ? [...listBuiltinMemoryProviders(), ...mergedRegistry.listMemoryProviders()].filter((entry) =>
                agent.memoryProviderIds.includes(entry.id),
              )
            : [],
          effectiveTools: effective,
        });
      } finally {
        await registry?.dispose();
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && path === "/auth-profiles") {
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        sendJson(response, 200, {
          authProfiles: sessionStore.listAuthProfileStates({
            statuses: parseAuthProfileStatusFilter(url.searchParams.getAll("status")),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/auth-profiles\/[^/]+$/.test(path)) {
      const authProfileId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const authProfile = sessionStore.getAuthProfileState(authProfileId);
        if (!authProfile) {
          sendJson(response, 404, { error: `Auth profile ${authProfileId} was not found.` });
          return;
        }
        sendJson(response, 200, { authProfile });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && /^\/auth-profiles\/[^/]+\/reset$/.test(path)) {
      const authProfileId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        sendJson(response, 200, {
          authProfile: sessionStore.resetAuthProfileState(authProfileId),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && /^\/auth-profiles\/[^/]+\/success$/.test(path)) {
      const authProfileId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        sendJson(response, 200, {
          authProfile: sessionStore.recordAuthProfileSuccess(authProfileId),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && /^\/auth-profiles\/[^/]+\/failure$/.test(path)) {
      const authProfileId = decodeURIComponent(path.split("/")[2] ?? "");
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        sendJson(response, 200, {
          authProfile: sessionStore.recordAuthProfileFailure({
            authProfileId,
            error: typeof body.error === "string" ? body.error : null,
            cooldownUntil: typeof body.cooldownUntil === "string" ? body.cooldownUntil : null,
            disable: body.disable === true,
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/routes$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          agent,
          routes: sessionStore.listRoutes({
            workspaceId: agent.workspaceId ?? undefined,
            agentId,
          }).map((route) => presentRoute(route)),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/sessions\/search$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          agent,
          results: sessionStore.searchAgentSessions({
            agentId,
            query: url.searchParams.get("query") ?? "",
            limit: parsePositiveNumber(url.searchParams.get("limit"), 10),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/automations$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          agent,
          workspace: agent.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) : null,
          automations: sessionStore.listAutomations({
            workspaceId: agent.workspaceId ?? undefined,
            agentId,
            status: normalizeAutomationStatusQuery(url.searchParams.get("status")),
            deliveryState: normalizeAutomationDeliveryStateQuery(url.searchParams.get("deliveryState")),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/subagents$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        const subagents = sessionStore.listAgentSubagentJobs(agentId, parsePositiveNumber(url.searchParams.get("limit"), 100));
        sendJson(response, 200, {
          agent,
          subagents,
          topology: buildSubagentTopology(subagents),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/memories$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          agent,
          memories: sessionStore.listAgentMemories({
            agentId,
            query: url.searchParams.get("query") ?? "",
            limit: parsePositiveNumber(url.searchParams.get("limit"), 20),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/profile-facts$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          agent,
          profileFacts: sessionStore.listAgentProfileFacts({
            agentId,
            query: url.searchParams.get("query") ?? "",
            limit: parsePositiveNumber(url.searchParams.get("limit"), 20),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/skills$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          agent,
          skills: sessionStore.listAgentLearnedSkills({
            agentId,
            sourceType: normalizeLearnedSkillSourceTypeQuery(url.searchParams.get("sourceType")),
            query: url.searchParams.get("query") ?? "",
            limit: parsePositiveNumber(url.searchParams.get("limit"), 20),
            includeDisabled: parseBooleanQueryParam(url.searchParams.get("includeDisabled")),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/agents\/[^/]+\/insights$/.test(path)) {
      const agentId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const agent = sessionStore.getAgent(agentId);
        if (!agent) {
          sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          agent,
          workspace: agent.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) : null,
          agentSummary: sessionStore.summarizeAgentUsage(agentId),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && path === "/leases") {
      const cwd = url.searchParams.get("cwd");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const workspace = cwd ? sessionStore.getWorkspaceByCwd(cwd) : null;
        sendJson(response, 200, {
          workspace,
          leases: sessionStore.listFileLeases({
            workspaceId: url.searchParams.get("workspaceId") ?? workspace?.id ?? undefined,
            ownerJobId: url.searchParams.get("ownerJobId") ?? undefined,
            statuses: parseLeaseStatusFilter(url.searchParams.getAll("status")),
            limit: parsePositiveNumber(url.searchParams.get("limit"), 200),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && path === "/threads") {
      const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const workspace = sessionStore.getWorkspaceByCwd(cwd);
        sendJson(response, 200, {
          workspace,
          threads: workspace ? sessionStore.listThreads(workspace.id) : [],
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && path === "/insights") {
      const workspaceId = url.searchParams.get("workspaceId");
      const workspaceCwd = url.searchParams.get("cwd");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const workspace =
          workspaceId !== null
            ? sessionStore.getWorkspace(workspaceId)
            : workspaceCwd
              ? sessionStore.getWorkspaceByCwd(workspaceCwd)
              : null;
        const workspaceSummary = workspace ? sessionStore.summarizeWorkspaceUsage(workspace.id) : null;
        sendJson(response, 200, {
          workspaceSummary,
          globalSummary: sessionStore.summarizeGlobalUsage(),
          workspace,
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/threads\/[^/]+$/.test(path)) {
      const threadId = decodeURIComponent(path.split("/")[2] ?? "");
      const limit = parsePositiveNumber(url.searchParams.get("limit"), 50);
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const thread = sessionStore.getThread(threadId);
        if (!thread) {
          sendJson(response, 404, { error: `Thread ${threadId} was not found.` });
          return;
        }

        sendJson(response, 200, {
          thread,
          messages: sessionStore.listThreadMessages(threadId, limit),
          usageSummary: sessionStore.summarizeThreadUsage(threadId),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && path === "/runs") {
      const threadId = url.searchParams.get("threadId");
      if (!threadId) {
        sendJson(response, 400, { error: "The runs endpoint requires ?threadId=<id>." });
        return;
      }

      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        sendJson(response, 200, {
          threadId,
          runs: sessionStore.listRuns(threadId, parsePositiveNumber(url.searchParams.get("limit"), 20)),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && path === "/subagents") {
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const subagents = sessionStore.listSubagentJobs({
          workspaceId: url.searchParams.get("workspaceId") ?? undefined,
          threadId: url.searchParams.get("threadId") ?? undefined,
          runId: url.searchParams.get("runId") ?? undefined,
          parentThreadId: url.searchParams.get("parentThreadId") ?? undefined,
          parentRunId: url.searchParams.get("parentRunId") ?? undefined,
          rootJobId: url.searchParams.get("rootJobId") ?? undefined,
          statuses: parseSubagentStatusFilter(url.searchParams.getAll("status")),
          limit: parsePositiveNumber(url.searchParams.get("limit"), 100),
        });
        sendJson(response, 200, {
          subagents,
          topology: buildSubagentTopology(subagents),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/subagents\/[^/]+$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const subagent = sessionStore.getSubagentJob(jobId);
        if (!subagent) {
          sendJson(response, 404, { error: `Subagent ${jobId} was not found.` });
          return;
        }
        sendJson(response, 200, { subagent });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "GET" && /^\/subagents\/[^/]+\/leases$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const subagent = sessionStore.getSubagentJob(jobId);
        if (!subagent) {
          sendJson(response, 404, { error: `Subagent ${jobId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          subagent,
          leases: sessionStore.listFileLeases({
            ownerJobId: jobId,
            statuses: parseLeaseStatusFilter(url.searchParams.getAll("status")),
            limit: parsePositiveNumber(url.searchParams.get("limit"), 200),
          }),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && /^\/subagents\/[^/]+\/claim$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const subagent = sessionStore.getSubagentJob(jobId);
        if (!subagent) {
          sendJson(response, 404, { error: `Subagent ${jobId} was not found.` });
          return;
        }
        if (isSubagentLiveControllable(jobId)) {
          sendJson(response, 409, { error: `Subagent ${jobId} is still attached to a live controller.` });
          return;
        }
        const claimed = claimDetachedThreadBoundSubagent(sessionStore, subagent);
        sendJson(response, 200, { subagent: claimed });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && /^\/subagents\/[^/]+\/continue$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const subagent = sessionStore.getSubagentJob(jobId);
        if (!subagent) {
          sendJson(response, 404, { error: `Subagent ${jobId} was not found.` });
          return;
        }
        if (subagent.sessionMode !== "thread" || !subagent.threadId) {
          sendJson(response, 409, {
            error: `Subagent ${jobId} is not a thread-bound session and cannot be continued.`,
          });
          return;
        }

        const runRequest = buildThreadBoundSubagentRunRequest(context, sessionStore, subagent, body);

        const result = await executeGatewayRunRequest(runRequest, {
          eventHandler: async (event) => {
            publishRuntimeEvent(context.eventBus, event);
          },
          modelProfiles: context.options.modelProfiles,
        });
        sendJson(response, 200, {
          subagent,
          result,
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && /^\/subagents\/[^/]+\/reattach$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const current = sessionStore.getSubagentJob(jobId);
        if (!current) {
          sendJson(response, 404, { error: `Subagent ${jobId} was not found.` });
          return;
        }
        if (isSubagentLiveControllable(jobId)) {
          sendJson(response, 409, { error: `Subagent ${jobId} is still attached to a live controller.` });
          return;
        }
        const claimed = claimDetachedThreadBoundSubagent(sessionStore, current);
        const runningSubagent = patchPersistedSubagentJob(sessionStore, claimed, {
          status: "running",
          startedAt: claimed.startedAt ?? new Date().toISOString(),
          blockedReason: undefined,
          blockedByJobIds: undefined,
          blockedPaths: undefined,
          error: undefined,
          completion: undefined,
        });
        const runRequest = buildThreadBoundSubagentRunRequest(context, sessionStore, runningSubagent, body);
        try {
          const result = await executeGatewayRunRequest(runRequest, {
            eventHandler: async (event) => {
              publishRuntimeEvent(context.eventBus, event);
            },
            modelProfiles: context.options.modelProfiles,
          });
          const summary = (result.summary ?? {}) as {
            thread?: { id?: string };
            run?: { id?: string; status?: string; verificationStatus?: string | null };
            changedFiles?: string[];
            finalResponse?: string;
          };
          const updated = patchPersistedSubagentJob(sessionStore, runningSubagent, {
            status: mapRunStatusToPersistedSubagentStatus(summary.run?.status),
            attempts: runningSubagent.attempts + 1,
            threadId: summary.thread?.id ?? runningSubagent.threadId,
            runId: summary.run?.id,
            finalResponse: summary.finalResponse ?? "",
            completedAt: new Date().toISOString(),
            messages: [],
            completion: {
              status: mapRunStatusToPersistedSubagentStatus(summary.run?.status),
              verificationStatus: summary.run?.verificationStatus ?? "not-run",
              changedFiles: Array.isArray(summary.changedFiles) ? summary.changedFiles : [],
              finalResponse: summary.finalResponse ?? "",
              error:
                mapRunStatusToPersistedSubagentStatus(summary.run?.status) === "failed"
                  ? summary.finalResponse ?? "Detached subagent reattachment failed."
                  : undefined,
            },
          });
          sendJson(response, 200, {
            subagent: updated,
            result,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const failed = patchPersistedSubagentJob(sessionStore, runningSubagent, {
            status: "failed",
            attempts: runningSubagent.attempts + 1,
            error: message,
            completedAt: new Date().toISOString(),
            completion: {
              status: "failed",
              verificationStatus: "not-run",
              changedFiles: [],
              finalResponse: "",
              error: message,
            },
          });
          sendJson(response, 500, {
            error: message,
            subagent: failed,
          });
        }
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && /^\/subagents\/[^/]+\/pause$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleLiveSubagentAction(response, context.options.storageRoot, jobId, "pause");
      return;
    }

    if (method === "POST" && /^\/subagents\/[^/]+\/resume$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleLiveSubagentAction(response, context.options.storageRoot, jobId, "resume");
      return;
    }

    if (method === "POST" && /^\/subagents\/[^/]+\/interrupt$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleLiveSubagentAction(response, context.options.storageRoot, jobId, "interrupt");
      return;
    }

    if (method === "POST" && /^\/subagents\/[^/]+\/cancel$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleLiveSubagentAction(response, context.options.storageRoot, jobId, "cancel");
      return;
    }

    if (method === "POST" && /^\/subagents\/[^/]+\/message$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!message) {
        sendJson(response, 400, { error: "The subagent message endpoint requires a non-empty message." });
        return;
      }
      await handleLiveSubagentAction(response, context.options.storageRoot, jobId, "message", message);
      return;
    }

    if (method === "GET" && /^\/runs\/[^/]+$/.test(path)) {
      const runId = decodeURIComponent(path.split("/")[2] ?? "");
      const details = getRunDetails(runId, context.options.storageRoot);
      if (!details) {
        sendJson(response, 404, { error: `Run ${runId} was not found.` });
        return;
      }
      sendJson(response, 200, details);
      return;
    }

    if (method === "POST" && path === "/runs") {
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const runRequest = normalizeRunRequest(body, context.options);
      const asyncMode = body.async === true;

      if (asyncMode) {
        const job = context.jobStore.create(body, { kind: "run" });
        context.eventBus.publish({
          type: "job.queued",
          at: new Date().toISOString(),
          data: job,
        });
        void executeAsyncJob(context, job, runRequest);
        sendJson(response, 202, { accepted: true, job });
        return;
      }

      const result = await executeGatewayRunRequest(runRequest, {
        eventHandler: async (event) => {
          publishRuntimeEvent(context.eventBus, event);
        },
        modelProfiles: context.options.modelProfiles,
      });
      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && path === "/parallel-runs") {
      const body = (await readJsonBody(request)) as Record<string, unknown>;
      const runs = Array.isArray(body.runs) ? body.runs : [];
      if (runs.length === 0) {
        sendJson(response, 400, { error: "parallel-runs requires a non-empty runs array." });
        return;
      }

      const batchId = randomUUID();
      const jobs = runs.map((entry) => {
        const requestBody = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
        const requestWithDefaults = { ...requestBody, async: true };
        const job = context.jobStore.create(requestWithDefaults, { batchId, kind: "parallel-run" });
        context.eventBus.publish({
          type: "job.queued",
          at: new Date().toISOString(),
          data: job,
        });
        const normalized = normalizeRunRequest(requestWithDefaults, context.options);
        void executeAsyncJob(context, job, normalized);
        return job;
      });

      context.eventBus.publish({
        type: "parallel.queued",
        at: new Date().toISOString(),
        data: { batchId, count: jobs.length },
      });
      sendJson(response, 202, { accepted: true, batchId, jobs });
      return;
    }

    if (method === "GET" && /^\/parallel-runs\/[^/]+$/.test(path)) {
      const batchId = decodeURIComponent(path.split("/")[2] ?? "");
      sendJson(response, 200, {
        batchId,
        jobs: context.jobStore.listByBatchId(batchId),
      });
      return;
    }

    if (method === "POST" && /^\/runs\/[^/]+\/cleanup$/.test(path)) {
      const runId = decodeURIComponent(path.split("/")[2] ?? "");
      const result = await cleanupRunExecution(runId, context.options.storageRoot);
      if (!result) {
        sendJson(response, 404, { error: `Run ${runId} was not found.` });
        return;
      }
      sendJson(response, 200, result);
      return;
    }

    if (method === "GET" && /^\/jobs\/[^/]+$/.test(path)) {
      const jobId = decodeURIComponent(path.split("/")[2] ?? "");
      const job = context.jobStore.get(jobId);
      if (!job) {
        sendJson(response, 404, { error: `Job ${jobId} was not found.` });
        return;
      }
      sendJson(response, 200, { job });
      return;
    }

    if (method === "GET" && path === "/jobs") {
      const batchId = url.searchParams.get("batchId");
      sendJson(response, 200, {
        jobs: batchId ? context.jobStore.listByBatchId(batchId) : context.jobStore.listAll(),
      });
      return;
    }

    if (method === "GET" && path === "/memories") {
      await handleListMemories(context, url, response);
      return;
    }

    if (method === "POST" && path === "/memories") {
      await handleCreateMemory(context, request, response);
      return;
    }

    if (method === "GET" && path === "/profile-facts") {
      await handleListProfileFacts(context, url, response);
      return;
    }

    if (method === "POST" && path === "/profile-facts") {
      await handleCreateProfileFact(context, request, response);
      return;
    }

    if (method === "GET" && path === "/skills") {
      await handleListLearnedSkills(context, url, response);
      return;
    }

    if (method === "GET" && path === "/skills/maintenance") {
      await handleLearnedSkillMaintenance(context, url, response);
      return;
    }

    if (method === "POST" && path === "/skills/maintenance/apply") {
      await handleApplyLearnedSkillMaintenance(context, request, response);
      return;
    }

    if (method === "GET" && /^\/skills\/[^/]+$/.test(path)) {
      const skillId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleGetLearnedSkill(context, skillId, response);
      return;
    }

    if (method === "POST" && /^\/skills\/[^/]+\/disable$/.test(path)) {
      const skillId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleUpdateLearnedSkillLifecycle(context, request, response, skillId, "disable");
      return;
    }

    if (method === "POST" && /^\/skills\/[^/]+\/restore$/.test(path)) {
      const skillId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleUpdateLearnedSkillLifecycle(context, request, response, skillId, "restore");
      return;
    }

    if (method === "POST" && /^\/skills\/[^/]+\/reverify$/.test(path)) {
      const skillId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleUpdateLearnedSkillLifecycle(context, request, response, skillId, "reverify");
      return;
    }

    if (method === "POST" && /^\/skills\/[^/]+\/promote$/.test(path)) {
      const skillId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleUpdateLearnedSkillLifecycle(context, request, response, skillId, "promote");
      return;
    }

    if (method === "DELETE" && /^\/skills\/[^/]+$/.test(path)) {
      const skillId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleDeleteLearnedSkill(context, skillId, response);
      return;
    }

    if (method === "GET" && path === "/automations") {
      await handleListAutomations(context, url, response);
      return;
    }

    if (method === "POST" && path === "/automations") {
      await handleCreateAutomation(context, request, response);
      return;
    }

    if (method === "GET" && /^\/automations\/[^/]+$/.test(path)) {
      const automationId = decodeURIComponent(path.split("/")[2] ?? "");
      const sessionStore = new SqliteSessionStore(context.options.storageRoot);
      try {
        sessionStore.initialize();
        const automation = sessionStore.getAutomation(automationId);
        if (!automation) {
          sendJson(response, 404, { error: `Automation ${automationId} was not found.` });
          return;
        }
        sendJson(response, 200, {
          automation,
          agent: automation.agentId ? sessionStore.getAgent(automation.agentId) : null,
          workspace: sessionStore.getWorkspace(automation.workspaceId),
        });
      } finally {
        sessionStore.close();
      }
      return;
    }

    if (method === "POST" && /^\/automations\/[^/]+\/run$/.test(path)) {
      const automationId = decodeURIComponent(path.split("/")[2] ?? "");
      const result = await runAutomationById(automationId, context.options, context.eventBus, context.adapterRegistry);
      if (!result) {
        sendJson(response, 404, { error: `Automation ${automationId} was not found.` });
        return;
      }
      sendJson(response, 200, result);
      return;
    }

    if (method === "POST" && /^\/automations\/[^/]+\/pause$/.test(path)) {
      const automationId = decodeURIComponent(path.split("/")[2] ?? "");
      const updated = updateAutomationStatus(automationId, "paused", context.options.storageRoot);
      if (!updated) {
        sendJson(response, 404, { error: `Automation ${automationId} was not found.` });
        return;
      }
      sendJson(response, 200, { automation: updated });
      return;
    }

    if (method === "POST" && /^\/automations\/[^/]+\/resume$/.test(path)) {
      const automationId = decodeURIComponent(path.split("/")[2] ?? "");
      const updated = updateAutomationStatus(automationId, "active", context.options.storageRoot);
      if (!updated) {
        sendJson(response, 404, { error: `Automation ${automationId} was not found.` });
        return;
      }
      sendJson(response, 200, { automation: updated });
      return;
    }

    if (method === "POST" && /^\/automations\/[^/]+\/reset$/.test(path)) {
      const automationId = decodeURIComponent(path.split("/")[2] ?? "");
      const updated = resetAutomationState(automationId, context.options.storageRoot);
      if (!updated) {
        sendJson(response, 404, { error: `Automation ${automationId} was not found.` });
        return;
      }
      context.eventBus.publish({
        type: "automation.reset",
        at: new Date().toISOString(),
        data: updated,
      });
      sendJson(response, 200, { automation: updated });
      return;
    }

    if (method === "DELETE" && /^\/automations\/[^/]+$/.test(path)) {
      const automationId = decodeURIComponent(path.split("/")[2] ?? "");
      const deleted = deleteAutomation(automationId, context.options.storageRoot);
      sendJson(response, deleted ? 200 : 404, deleted ? { deleted: true } : { error: `Automation ${automationId} was not found.` });
      return;
    }

    if (method === "GET" && path === "/routes") {
      await handleListRoutes(context, url, response);
      return;
    }

    if (method === "POST" && path === "/routes") {
      await handleCreateRoute(context, request, response);
      return;
    }

    if (method === "GET" && path === "/deliveries") {
      await handleListDeliveries(context, url, response);
      return;
    }

    if (method === "POST" && /^\/deliveries\/[^/]+\/retry$/.test(path)) {
      const deliveryId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleRetryDelivery(context, deliveryId, response);
      return;
    }

    if (method === "GET" && path === "/pairings") {
      await handleListPairings(context, url, response);
      return;
    }

    if (method === "POST" && path === "/pairings/approve") {
      await handleApprovePairing(context, request, response);
      return;
    }

    if (method === "GET" && path === "/nodes") {
      sendJson(response, 200, {
        nodes: context.controlPlane.listNodes(),
      });
      return;
    }

    if (method === "POST" && /^\/routes\/[^/]+\/deliver$/.test(path)) {
      const routeId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleManualRouteDelivery(context, routeId, request, response);
      return;
    }

    if (method === "GET" && path === "/inbox/messages") {
      await handleListInboundMessages(context, url, response);
      return;
    }

    if (method === "POST" && path === "/inbox/messages") {
      await handleCreateInboundMessage(context, request, response);
      return;
    }

    if (method === "POST" && /^\/inbox\/enterprise\/(feishu|dingtalk|teams)$/.test(path)) {
      const channelType = path.split("/")[3] ?? "";
      await handleProviderInboundWebhook(context, request, response, channelType, "enterprise");
      return;
    }

    if (method === "POST" && /^\/inbox\/consumer\/(whatsapp|signal|matrix|voice|canvas|mobile-node|media)$/.test(path)) {
      const channelType = path.split("/")[3] ?? "";
      await handleProviderInboundWebhook(context, request, response, channelType, "consumer");
      return;
    }

    if (method === "POST" && /^\/mobile-node\/[^/]+\/events$/.test(path)) {
      const deviceId = decodeURIComponent(path.split("/")[2] ?? "");
      await handleMobileNodeDeviceEvent(context, request, response, deviceId);
      return;
    }

    if (method === "GET" && path === "/audit-logs") {
      await handleListAuditLogs(context, url, response);
      return;
    }
    sendJson(response, 404, { error: `Unsupported route: ${method} ${path}` });
  } catch (error) {
    sendJson(response, error instanceof RouteConfigurationError ? 400 : 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleLiveSubagentAction(
  response: ServerResponse,
  storageRoot: string | undefined,
  jobId: string,
  action: "cancel" | "interrupt" | "message" | "pause" | "resume",
  message?: string,
): Promise<void> {
  try {
    const subagent = await controlSubagentForGateway(storageRoot, jobId, action, message);
    sendJson(response, 200, { subagent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, /was not found/i.test(message) ? 404 : 409, { error: message });
  }
}

async function handleListAcpSessions(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const request = normalizeAcpListSessionsRequest(url.searchParams, context.options);
    const sessions = listAcpSessions({
      store: sessionStore,
      request,
      activeJobs: context.acpActiveJobs,
    });
    sendJson(response, 200, {
      sessions: sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleCreateAcpSession(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const session = createAcpSession({
      store: sessionStore,
      request: normalizeAcpCreateSessionRequest(body, context.options),
      activeJobs: context.acpActiveJobs,
    });
    sendJson(response, 201, {
      session,
      manifest: buildAcpManifest(),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleLoadAcpSession(
  context: GatewayRequestContext,
  sessionId: string,
  response: ServerResponse,
): Promise<void> {
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const session = loadAcpSession({
      store: sessionStore,
      request: normalizeAcpLoadSessionRequest({ sessionId }),
      activeJobs: context.acpActiveJobs,
    });
    if (!session) {
      sendJson(response, 404, { error: "ACP session was not found." });
      return;
    }
    sendJson(response, 200, {
      session,
      messages: sessionStore.listThreadMessages(session.id, 50),
      runs: sessionStore.listRuns(session.id, 20),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleForkAcpSession(
  context: GatewayRequestContext,
  sessionId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const sourceThread = sessionStore.getThread(sessionId);
    if (!sourceThread) {
      sendJson(response, 404, { error: "ACP session was not found." });
      return;
    }
    const sourceWorkspace = sessionStore.getWorkspace(sourceThread.workspaceId);
    if (!sourceWorkspace) {
      sendJson(response, 404, { error: "ACP session workspace was not found." });
      return;
    }
    const cwd = normalizeAcpCwd(body.cwd, { ...context.options, cwd: sourceWorkspace.cwd });
    const workspace = sessionStore.upsertWorkspace(cwd);
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : `${sourceThread.title} fork`;
    const forkedThread = sessionStore.createThread(workspace.id, title);
    for (const message of sessionStore.listAllThreadMessages(sourceThread.id)) {
      sessionStore.appendMessage({
        threadId: forkedThread.id,
        runId: null,
        role: message.role,
        text: message.text,
      });
    }
    sendJson(response, 201, {
      session: presentAcpSession(workspace, forkedThread, null),
      sourceSessionId: sourceThread.id,
      copiedMessageCount: sessionStore.countThreadMessages(forkedThread.id),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleAcpPrompt(
  context: GatewayRequestContext,
  sessionId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  let payload: AcpPromptPayload;
  try {
    payload = normalizeAcpPromptPayload(body);
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    return;
  }

  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  let session: AcpSessionPresentation | null = null;
  try {
    sessionStore.initialize();
    session = resolveAcpSession(sessionStore, sessionId);
  } finally {
    sessionStore.close();
  }
  if (!session) {
    sendJson(response, 404, { error: "ACP session was not found." });
    return;
  }

  const runRequest = buildAcpRunRequest({
    session,
    payload,
    body,
    defaults: context.options,
  });

  if (payload.async) {
    const job = context.jobStore.create(
      {
        ...body,
        task: payload.text,
        threadId: session.id,
        cwd: runRequest.cwd,
      },
      { kind: "acp-prompt" },
    );
    context.acpActiveJobs.set(session.id, job.id);
    context.eventBus.publish({
      type: "job.queued",
      at: new Date().toISOString(),
      data: job,
    });
    const cancellation = createAsyncJobCancellation();
    context.acpJobCancellations.set(job.id, cancellation);
    const execution = new Promise<void>((resolveExecution) => {
      setImmediate(() => {
        void executeAsyncJob(context, job, runRequest, {
        cancellation,
        onCompleted: async () => {
          clearAcpActiveJob(context, session.id, job.id);
        },
        onFailed: async () => {
          clearAcpActiveJob(context, session.id, job.id);
        },
        onCancelled: async () => {
          clearAcpActiveJob(context, session.id, job.id);
        },
        }).finally(resolveExecution);
      });
    });
    context.acpJobExecutions.set(job.id, execution);
    execution.finally(() => {
      context.acpJobExecutions.delete(job.id);
    });
    sendJson(response, 202, { accepted: true, session, job });
    return;
  }

  const result = await executeGatewayRunRequest(runRequest, {
    eventHandler: async (event) => {
      publishRuntimeEvent(context.eventBus, event);
    },
    modelProfiles: context.options.modelProfiles,
  });
  sendJson(response, 200, buildAcpPromptResponse({ session, result }));
}

async function handleCancelAcpSession(
  context: GatewayRequestContext,
  sessionId: string,
  response: ServerResponse,
): Promise<void> {
  const activeJobId = context.acpActiveJobs.get(sessionId) ?? null;
  if (!activeJobId) {
    sendJson(response, 200, {
      cancelled: false,
      sessionId,
      reason: "No active ACP prompt job is tracked by this gateway process.",
    });
    return;
  }
  const job = context.jobStore.get(activeJobId);
  if (!job) {
    clearAcpActiveJob(context, sessionId, activeJobId);
    sendJson(response, 404, {
      cancelled: false,
      sessionId,
      activeJobId,
      reason: `Active ACP prompt job ${activeJobId} was not found.`,
    });
    return;
  }
  if (job.status === "cancelled" || job.status === "completed" || job.status === "failed") {
    clearAcpActiveJob(context, sessionId, activeJobId);
    sendJson(response, 200, {
      cancelled: job.status === "cancelled",
      sessionId,
      activeJobId,
      job,
      reason: `Active ACP prompt job is already ${job.status}.`,
    });
    return;
  }
  const cancellation = context.acpJobCancellations.get(activeJobId);
  if (!cancellation) {
    sendJson(response, 200, {
      cancelled: false,
      sessionId,
      activeJobId,
      job,
      reason: "The active ACP prompt job is not cancellable in this gateway process.",
    });
    return;
  }
  const reason = "ACP session cancellation requested.";
  cancellation.cancel(reason);
  const updated = context.jobStore.update(activeJobId, {
    status: "cancelled",
    error: reason,
  });
  context.eventBus.publish({
    type: "job.cancelled",
    at: new Date().toISOString(),
    data: updated,
  });
  clearAcpActiveJob(context, sessionId, activeJobId);
  sendJson(response, 200, {
    cancelled: true,
    sessionId,
    activeJobId,
    job: updated,
    reason,
  });
}

function clearAcpActiveJob(
  context: GatewayRuntimeContext,
  sessionId: string,
  jobId: string,
): void {
  if (context.acpActiveJobs.get(sessionId) === jobId) {
    context.acpActiveJobs.delete(sessionId);
  }
}

function resolveAcpSession(
  sessionStore: SqliteSessionStore,
  sessionId: string,
): AcpSessionPresentation | null {
  const thread = sessionStore.getThread(sessionId);
  if (!thread) {
    return null;
  }
  const workspace = sessionStore.getWorkspace(thread.workspaceId);
  if (!workspace) {
    return null;
  }
  return presentAcpSession(workspace, thread, null);
}

async function controlSubagentForGateway(
  storageRoot: string | undefined,
  jobId: string,
  action: "cancel" | "interrupt" | "message" | "pause" | "resume",
  message?: string,
): Promise<PersistedSubagentJobRecord | unknown> {
  try {
    return await controlLiveSubagent({ jobId, action, message });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (/not available for live control/i.test(errorMessage)) {
      const sessionStore = new SqliteSessionStore(storageRoot);
      try {
        sessionStore.initialize();
        const subagent = sessionStore.getSubagentJob(jobId);
        if (!subagent) {
          throw new Error(`Subagent ${jobId} was not found.`);
        }
        return controlDetachedSubagent(sessionStore, subagent, action, message);
      } finally {
        sessionStore.close();
      }
    }
    throw error;
  }
}

function buildThreadBoundSubagentRunRequest(
  context: GatewayRequestContext,
  sessionStore: SqliteSessionStore,
  subagent: PersistedSubagentJobRecord,
  body: Record<string, unknown>,
): NormalizedGatewayRunRequest {
  const workspace = sessionStore.getWorkspace(subagent.workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${subagent.workspaceId} for subagent ${subagent.id} was not found.`);
  }

  const parentRun = sessionStore.getRun(subagent.parentRunId);
  const parentAgent = parentRun?.agentId ? sessionStore.getAgent(parentRun.agentId) : null;
  const nestedToolPolicyContext =
    body.toolPolicyContext && typeof body.toolPolicyContext === "object" && !Array.isArray(body.toolPolicyContext)
      ? ({ ...(body.toolPolicyContext as Record<string, unknown>) })
      : {};
  if (parentAgent && nestedToolPolicyContext.agentId === undefined) {
    nestedToolPolicyContext.agentId = parentAgent.id;
  }

  return normalizeRunRequest(
    {
      ...body,
      task: composeDetachedSubagentTask(subagent, typeof body.task === "string" ? body.task : subagent.objective),
      cwd: workspace.cwd,
      threadId: subagent.threadId,
      continueLatest: false,
      executionDomain: subagent.executionDomain,
      modelProfileId:
        typeof body.modelProfileId === "string" && body.modelProfileId.trim().length > 0
          ? body.modelProfileId
          : parentAgent?.defaultModelProfileId ?? undefined,
      toolPolicyContext: nestedToolPolicyContext,
    },
    context.options,
  );
}

function composeDetachedSubagentTask(subagent: PersistedSubagentJobRecord, task: string): string {
  const trimmedTask = task.trim() || subagent.objective;
  const pendingMessages = subagent.messages
    .map((entry) => entry.content.trim())
    .filter((entry) => entry.length > 0);
  if (pendingMessages.length === 0) {
    return trimmedTask;
  }
  return [trimmedTask, "Pending operator instructions:", ...pendingMessages.map((entry) => `- ${entry}`)].join("\n");
}

function controlDetachedSubagent(
  sessionStore: SqliteSessionStore,
  subagent: PersistedSubagentJobRecord,
  action: "cancel" | "interrupt" | "message" | "pause" | "resume",
  message?: string,
): PersistedSubagentJobRecord {
  switch (action) {
    case "message": {
      ensureDetachedThreadBoundSubagent(subagent, "receive new operator messages");
      if (isTerminalPersistedSubagentStatus(subagent.status)) {
        throw new Error(`Subagent ${subagent.id} is already ${subagent.status} and cannot receive new instructions.`);
      }
      const trimmedMessage = message?.trim() ?? "";
      if (!trimmedMessage) {
        throw new Error("The subagent message endpoint requires a non-empty message.");
      }
      return patchPersistedSubagentJob(sessionStore, subagent, {
        messages: [
          ...subagent.messages,
          {
            id: randomUUID(),
            author: "parent",
            content: trimmedMessage,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    }
    case "pause": {
      ensureDetachedThreadBoundSubagent(subagent, "pause while detached");
      if (isTerminalPersistedSubagentStatus(subagent.status) || subagent.status === "paused") {
        return subagent;
      }
      if (subagent.status !== "queued" && subagent.status !== "running") {
        throw new Error(`Subagent ${subagent.id} is ${subagent.status} and cannot be paused while detached.`);
      }
      return patchPersistedSubagentJob(sessionStore, subagent, {
        status: "paused",
        pausedFromStatus: subagent.status,
      });
    }
    case "resume": {
      ensureDetachedThreadBoundSubagent(subagent, "resume while detached");
      if (subagent.status !== "paused") {
        return subagent;
      }
      return patchPersistedSubagentJob(sessionStore, subagent, {
        status: "queued",
        pausedFromStatus: undefined,
      });
    }
    case "cancel":
    case "interrupt": {
      if (isTerminalPersistedSubagentStatus(subagent.status)) {
        return subagent;
      }
      sessionStore.releaseFileLeasesForJob(subagent.id);
      const reason = action === "cancel" ? "Cancelled while detached from a live controller." : "Interrupted while detached from a live controller.";
      return patchPersistedSubagentJob(sessionStore, subagent, {
        status: action === "cancel" ? "cancelled" : "interrupted",
        blockedReason: undefined,
        blockedByJobIds: undefined,
        blockedPaths: undefined,
        queuePosition: undefined,
        pausedFromStatus: undefined,
        error: reason,
        completedAt: new Date().toISOString(),
        completion: {
          status: action === "cancel" ? "cancelled" : "interrupted",
          verificationStatus: "not-run",
          changedFiles: [],
          finalResponse: "",
          error: reason,
        },
      });
    }
  }
}

function claimDetachedThreadBoundSubagent(
  sessionStore: SqliteSessionStore,
  subagent: PersistedSubagentJobRecord,
): PersistedSubagentJobRecord {
  ensureDetachedThreadBoundSubagent(subagent, "be claimed for reattachment");
  if (isTerminalPersistedSubagentStatus(subagent.status)) {
    throw new Error(`Subagent ${subagent.id} is already ${subagent.status}; use /continue for post-completion follow-up.`);
  }
  return patchPersistedSubagentJob(sessionStore, subagent, {
    status: "queued",
    queuedAt: new Date().toISOString(),
    completedAt: undefined,
    blockedReason: undefined,
    blockedByJobIds: undefined,
    blockedPaths: undefined,
    pausedFromStatus: undefined,
    error: undefined,
    completion: undefined,
  });
}

function ensureDetachedThreadBoundSubagent(subagent: PersistedSubagentJobRecord, action: string): void {
  if (subagent.sessionMode !== "thread" || !subagent.threadId) {
    throw new Error(`Subagent ${subagent.id} is not a thread-bound session and cannot ${action}.`);
  }
}

function isTerminalPersistedSubagentStatus(status: PersistedSubagentJobRecord["status"]): boolean {
  return status === "cancelled" || status === "completed" || status === "failed" || status === "interrupted" || status === "timed_out";
}

function mapRunStatusToPersistedSubagentStatus(
  status: string | null | undefined,
): PersistedSubagentJobRecord["status"] {
  if (status === "failed") {
    return "failed";
  }
  if (status === "interrupted") {
    return "interrupted";
  }
  return "completed";
}

function patchPersistedSubagentJob(
  sessionStore: SqliteSessionStore,
  subagent: PersistedSubagentJobRecord,
  patch: Partial<PersistedSubagentJobRecord>,
): PersistedSubagentJobRecord {
  return sessionStore.upsertSubagentJob({
    ...subagent,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

async function handleListMemories(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const agentId = url.searchParams.get("agentId") ?? undefined;
  const query = url.searchParams.get("query") ?? "";
  const scope = url.searchParams.get("scope");
  const threadId = url.searchParams.get("threadId");
  const limit = parsePositiveNumber(url.searchParams.get("limit"), 20);
  const backend = normalizeMemorySearchBackend(url.searchParams.get("backend"));
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const agent = agentId ? sessionStore.getAgent(agentId) : null;
    if (agentId && !agent) {
      sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
      return;
    }
    const workspace = agent?.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) : sessionStore.getWorkspaceByCwd(cwd);
    const effectiveCwd = agent?.cwd ?? cwd;
    const normalizedScope = scope === "thread" || scope === "workspace" ? scope : undefined;
    const warnings: string[] = [];
    const storeMemories = backend === "file" || !workspace
      ? []
      : sessionStore.searchMemories({
          workspaceId: workspace.id,
          agentId,
          threadId: threadId ?? null,
          scope: normalizedScope,
          query,
          limit,
        }).map((entry) => ({
          ...entry,
          source: "store" as const,
        }));
    if (backend !== "file" && !workspace) {
      warnings.push("Memory store unavailable for this cwd; returning file-backed memory results only.");
    }
    const remainingLimit = Math.max(0, limit - storeMemories.length);
    const workspaceService = new LocalWorkspaceService(
      effectiveCwd,
      join(resolveGatewayStorageRoot(context.options.storageRoot), "artifacts", "gateway-memory-search"),
    );
    const fileMemories = backend === "store" || remainingLimit === 0
      ? []
      : (await workspaceService.searchMemoryFiles({
          query,
          kinds: selectWorkspaceMemoryKinds(normalizedScope),
          limit: remainingLimit,
        })).map((entry) => ({
          id: `file:${entry.path}`,
          workspaceId: workspace?.id ?? "workspace-file-memory",
          agentId: agentId ?? null,
          threadId: entry.kind === "daily" ? threadId ?? null : null,
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
    const memories = [...storeMemories, ...fileMemories];
    sendJson(response, 200, {
      workspace,
      memories,
      warnings,
    });
  } finally {
    sessionStore.close();
  }
}

async function handleCreateMemory(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const cwd = String(body.cwd ?? context.options.cwd ?? process.cwd());
  const agentId = typeof body.agentId === "string" && body.agentId.trim().length > 0 ? body.agentId.trim() : null;
  const content = String(body.content ?? "").trim();
  if (!content) {
    sendJson(response, 400, { error: "Memory content cannot be empty." });
    return;
  }

  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const agent = agentId ? sessionStore.getAgent(agentId) : null;
    if (agentId && !agent) {
      sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
      return;
    }
    if (agentId && !agent) {
      sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
      return;
    }
    const effectiveCwd = agent?.cwd ?? cwd;
    const workspace = agent?.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) ?? sessionStore.upsertWorkspace(effectiveCwd) : sessionStore.upsertWorkspace(effectiveCwd);
    const scope = body.scope === "thread" ? "thread" : "workspace";
    const tags = Array.isArray(body.tags) ? body.tags.map((entry) => String(entry)) : [];
    const backend = normalizeMemoryPersistenceBackend(body.backend);
    const fileKind = normalizeWorkspaceMemoryFileKind(body.fileKind, scope);
    const toolRegistry = new ToolRegistry();
    registerBuiltInTools(toolRegistry);
    const workspaceService = new LocalWorkspaceService(
      effectiveCwd,
      join(resolveGatewayStorageRoot(context.options.storageRoot), "artifacts", "gateway-memory-save"),
    );
    const result = await toolRegistry.execute(
      "save_memory",
      {
        workspace: workspaceService,
        executionDomain: "workspace",
        sessionStore,
        workspaceId: workspace.id,
        agentId: agent?.id ?? undefined,
        threadId: typeof body.threadId === "string" ? body.threadId : undefined,
      },
      {
        content,
        scope,
        tags,
        backend,
        fileKind,
      },
    );
    const payload = (result.data ?? {}) as {
      backend?: string;
      fileKind?: string | null;
      storeRecord?: unknown;
      fileRecord?: unknown;
    };
    const memory = payload.storeRecord ?? buildGatewayFileBackedMemoryRecord({
      cwd: effectiveCwd,
      agentId: agent?.id ?? null,
      content,
      scope,
      threadId: typeof body.threadId === "string" ? body.threadId : null,
      tags,
      fileKind,
      fileRecord: payload.fileRecord,
    });
    context.eventBus.publish({
      type: "memory.saved",
      at: new Date().toISOString(),
      data: {
        memory,
        backend: payload.backend ?? backend,
        fileKind: payload.fileKind ?? fileKind,
        storeRecord: payload.storeRecord ?? null,
        fileRecord: payload.fileRecord ?? null,
      },
    });
    sendJson(response, 200, {
      memory,
      backend: payload.backend ?? backend,
      fileKind: payload.fileKind ?? fileKind,
      storeRecord: payload.storeRecord ?? null,
      fileRecord: payload.fileRecord ?? null,
    });
  } finally {
    sessionStore.close();
  }
}

async function handleListProfileFacts(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const agentId = url.searchParams.get("agentId") ?? undefined;
  const query = url.searchParams.get("query") ?? "";
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const agent = agentId ? sessionStore.getAgent(agentId) : null;
    if (agentId && !agent) {
      sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
      return;
    }
    const workspace = agent?.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) : sessionStore.getWorkspaceByCwd(cwd);
    if (!workspace) {
      sendJson(response, 200, { workspace: null, profileFacts: [] });
      return;
    }
    sendJson(response, 200, {
      workspace,
      profileFacts: sessionStore.searchProfileFacts({
        workspaceId: workspace.id,
        agentId,
        query,
        limit: parsePositiveNumber(url.searchParams.get("limit"), 20),
      }),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleCreateProfileFact(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const cwd = String(body.cwd ?? context.options.cwd ?? process.cwd());
  const agentId = typeof body.agentId === "string" && body.agentId.trim().length > 0 ? body.agentId.trim() : null;
  const content = String(body.content ?? "").trim();
  if (!content) {
    sendJson(response, 400, { error: "Profile fact content cannot be empty." });
    return;
  }

  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const agent = agentId ? sessionStore.getAgent(agentId) : null;
    if (agentId && !agent) {
      sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
      return;
    }
    const effectiveCwd = agent?.cwd ?? cwd;
    const workspace = agent?.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) ?? sessionStore.upsertWorkspace(effectiveCwd) : sessionStore.upsertWorkspace(effectiveCwd);
    const tags = Array.isArray(body.tags) ? body.tags.map((entry) => String(entry)) : [];
    const toolRegistry = new ToolRegistry();
    registerBuiltInTools(toolRegistry);
    const workspaceService = new LocalWorkspaceService(
      effectiveCwd,
      join(resolveGatewayStorageRoot(context.options.storageRoot), "artifacts", "gateway-profile-fact-save"),
    );
    const result = await toolRegistry.execute(
      "save_profile_fact",
      {
        workspace: workspaceService,
        executionDomain: "workspace",
        sessionStore,
        workspaceId: workspace.id,
        agentId: agent?.id ?? undefined,
        runId: typeof body.runId === "string" ? body.runId : undefined,
      },
      {
        content,
        tags,
      },
    );
    const profileFact = (result.data ?? null) as Record<string, unknown> | null;
    context.eventBus.publish({
      type: "profile_fact.saved",
      at: new Date().toISOString(),
      data: profileFact,
    });
    sendJson(response, 200, {
      workspace,
      profileFact,
    });
  } finally {
    sessionStore.close();
  }
}

async function handleListLearnedSkills(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const agentId = url.searchParams.get("agentId") ?? undefined;
  const workspaceId = url.searchParams.get("workspaceId");
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const agent = agentId ? sessionStore.getAgent(agentId) : null;
    const workspace = agent?.workspaceId
      ? sessionStore.getWorkspace(agent.workspaceId)
      : workspaceId
        ? sessionStore.getWorkspace(workspaceId)
        : sessionStore.getWorkspaceByCwd(cwd);
    if (!workspace) {
      sendJson(response, 200, { workspace: null, skills: [] });
      return;
    }

    const query = url.searchParams.get("query") ?? "";
    const skills = sessionStore.searchLearnedSkills({
      workspaceId: workspace.id,
      agentId,
      sourceType: normalizeLearnedSkillSourceTypeQuery(url.searchParams.get("sourceType")),
      query,
      limit: parsePositiveNumber(url.searchParams.get("limit"), 20),
      includeDisabled: parseBooleanQueryParam(url.searchParams.get("includeDisabled")),
    });
    sendJson(response, 200, {
      workspace,
      skills,
    });
  } finally {
    sessionStore.close();
  }
}

async function handleGetLearnedSkill(
  context: GatewayRequestContext,
  skillId: string,
  response: ServerResponse,
): Promise<void> {
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const skill = sessionStore.getLearnedSkill(skillId);
    if (!skill) {
      sendJson(response, 404, { error: `Learned skill ${skillId} was not found.` });
      return;
    }

    sendJson(response, 200, {
      workspace: sessionStore.getWorkspace(skill.workspaceId),
      skill,
    });
  } finally {
    sessionStore.close();
  }
}

async function handleLearnedSkillMaintenance(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const agentId = url.searchParams.get("agentId") ?? undefined;
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = agentId
      ? sessionStore.getAgent(agentId)?.workspaceId
        ? sessionStore.getWorkspace(sessionStore.getAgent(agentId)?.workspaceId ?? "")
        : null
      : sessionStore.getWorkspaceByCwd(cwd);
    if (!workspace) {
      sendJson(response, 200, {
        workspace: null,
        report: null,
      });
      return;
    }
    sendJson(response, 200, {
      workspace,
      report: sessionStore.evaluateLearnedSkillMaintenance({
        workspaceId: workspace.id,
        agentId,
        limit: parsePositiveNumber(url.searchParams.get("limit"), 20),
      }),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleApplyLearnedSkillMaintenance(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const cwd = typeof body.cwd === "string" ? body.cwd : context.options.cwd ?? process.cwd();
  const agentId = typeof body.agentId === "string" && body.agentId.trim().length > 0 ? body.agentId.trim() : null;
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const agent = agentId ? sessionStore.getAgent(agentId) : null;
    if (agentId && !agent) {
      sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
      return;
    }
    const workspace = agent?.workspaceId
      ? sessionStore.getWorkspace(agent.workspaceId)
      : sessionStore.getWorkspaceByCwd(cwd);
    if (!workspace) {
      sendJson(response, 404, { error: "Workspace was not found for learned-skill maintenance." });
      return;
    }
    const application = sessionStore.applyLearnedSkillMaintenance({
      workspaceId: workspace.id,
      agentId,
      limit: parsePositiveNumber(body.limit, 20),
      promoteStable: body.promoteStable !== false,
      materializePathForSkill: (skill) =>
        typeof body.materializedSkillRoot === "string" && body.materializedSkillRoot.trim()
          ? join(body.materializedSkillRoot.trim(), `${sanitizeFileStem(skill.title)}.md`)
          : undefined,
    });
    context.eventBus.publish({
      type: "skills.maintenance.applied",
      at: application.appliedAt,
      data: {
        workspace,
        application,
      },
    });
    sendJson(response, 200, { workspace, application });
  } finally {
    sessionStore.close();
  }
}

async function handleUpdateLearnedSkillLifecycle(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
  skillId: string,
  action: "disable" | "restore" | "reverify" | "promote",
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const current = sessionStore.getLearnedSkill(skillId);
    if (!current) {
      sendJson(response, 404, { error: `Learned skill ${skillId} was not found.` });
      return;
    }

    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    const verificationSummary = typeof body.verificationSummary === "string" ? body.verificationSummary.trim() : "";
    let materializedSkillPath =
      typeof body.materializedSkillPath === "string" ? body.materializedSkillPath.trim() : undefined;
    const target = body.target === "workspace" || body.target === "personal" ? body.target : null;
    if (action === "promote" && target === "workspace" && body.materialize !== false && !materializedSkillPath) {
      const workspace = sessionStore.getWorkspace(current.workspaceId);
      if (!workspace) {
        sendJson(response, 404, { error: `Workspace ${current.workspaceId} was not found.` });
        return;
      }
      const workspaceService = new LocalWorkspaceService(
        workspace.cwd,
        join(resolveGatewayStorageRoot(context.options.storageRoot), "artifacts", "gateway-skill-materialize"),
      );
      const materialized = await workspaceService.materializeLearnedSkill({
        title: current.title,
        problemPattern: current.problemPattern,
        guidance: current.guidance,
        triggerSignals: current.triggerSignals,
        procedureSteps: current.procedureSteps,
        verificationSummary: verificationSummary || current.verificationSummary,
        tags: current.tags,
        changedFiles: current.changedFiles,
        revisionCount: current.revisionCount,
      });
      materializedSkillPath = materialized.path;
    }
    const updated =
      action === "disable"
        ? sessionStore.updateLearnedSkillLifecycle({
            skillId,
            lifecycleState: "disabled",
            lifecycleReason: reason || "Disabled by operator.",
            materializedSkillPath,
          })
        : action === "restore"
          ? sessionStore.updateLearnedSkillLifecycle({
              skillId,
              lifecycleState: "active",
              lifecycleReason: reason || null,
              materializedSkillPath,
              verificationSummary: verificationSummary || current.verificationSummary,
            })
          : action === "reverify"
            ? sessionStore.updateLearnedSkillLifecycle({
                skillId,
                lifecycleState: "needs_reverify",
                lifecycleReason: reason || "Queued for operator re-verification.",
                materializedSkillPath,
                verificationStatus: "needs_reverify",
                verificationSummary: verificationSummary || "Queued for operator re-verification.",
              })
            : target
              ? sessionStore.promoteLearnedSkill({
                  skillId,
                  target,
                  reason: reason || null,
                  materializedSkillPath,
                })
              : null;
    if (!updated) {
      sendJson(response, 400, { error: "Skill promotion requires target=workspace or target=personal." });
      return;
    }
    context.eventBus.publish({
      type: "skill.updated",
      at: new Date().toISOString(),
      data: {
        action,
        skill: updated,
      },
    });
    sendJson(response, 200, { skill: updated });
  } finally {
    sessionStore.close();
  }
}

function normalizeLearnedSkillSourceTypeQuery(
  value: string | null,
): "bundled" | "workspace" | "personal" | "learned" | "third_party" | undefined {
  const normalized = (value ?? "").trim();
  switch (normalized) {
    case "bundled":
    case "workspace":
    case "personal":
    case "learned":
    case "third_party":
      return normalized as "bundled" | "workspace" | "personal" | "learned" | "third_party";
    default:
      return undefined;
  }
}

function normalizeAutomationStatusQuery(value: string | null): "active" | "paused" | undefined {
  switch ((value ?? "").trim().toLowerCase()) {
    case "active":
    case "paused":
      return (value ?? "").trim().toLowerCase() as "active" | "paused";
    default:
      return undefined;
  }
}

function normalizeAutomationDeliveryStateQuery(
  value: string | null,
): "cooldown" | "dead_letter" | "idle" | "running" | undefined {
  switch ((value ?? "").trim().toLowerCase()) {
    case "cooldown":
    case "dead_letter":
    case "idle":
    case "running":
      return (value ?? "").trim().toLowerCase() as "cooldown" | "dead_letter" | "idle" | "running";
    default:
      return undefined;
  }
}

function normalizeAutomationScheduleKindQuery(value: string | null): AutomationScheduleKind | undefined {
  switch (value) {
    case "event":
    case "heartbeat":
    case "interval":
    case "maintenance":
    case "manual":
      return value;
    default:
      return undefined;
  }
}

async function handleDeleteLearnedSkill(
  context: GatewayRequestContext,
  skillId: string,
  response: ServerResponse,
): Promise<void> {
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const deleted = sessionStore.deleteLearnedSkill(skillId);
    if (!deleted) {
      sendJson(response, 404, { error: `Learned skill ${skillId} was not found.` });
      return;
    }
    context.eventBus.publish({
      type: "skill.deleted",
      at: new Date().toISOString(),
      data: {
        skill: deleted,
      },
    });
    sendJson(response, 200, { deleted: true, skill: deleted });
  } finally {
    sessionStore.close();
  }
}

async function handleListAutomations(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const agentId = url.searchParams.get("agentId") ?? undefined;
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const agent = agentId ? sessionStore.getAgent(agentId) : null;
    if (agentId && !agent) {
      sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
      return;
    }
    const workspace = agent?.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) : sessionStore.getWorkspaceByCwd(cwd);
    const automations = sessionStore.listAutomations({
      workspaceId: workspace?.id,
      agentId,
      scheduleKind: normalizeAutomationScheduleKindQuery(url.searchParams.get("scheduleKind")),
      status: normalizeAutomationStatusQuery(url.searchParams.get("status")),
      deliveryState: normalizeAutomationDeliveryStateQuery(url.searchParams.get("deliveryState")),
    });
    sendJson(response, 200, {
      agent,
      workspace,
      automations,
    });
  } finally {
    sessionStore.close();
  }
}

async function handleCreateAutomation(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const cwd = String(body.cwd ?? context.options.cwd ?? process.cwd());
  const agentId = typeof body.agentId === "string" && body.agentId.trim().length > 0 ? body.agentId.trim() : null;
  const title = String(body.title ?? "").trim();
  const task = String(body.task ?? "").trim();
  const scheduleKind =
    body.scheduleKind === "manual" ||
    body.scheduleKind === "event" ||
    body.scheduleKind === "heartbeat" ||
    body.scheduleKind === "maintenance"
      ? body.scheduleKind
      : "interval";
  const deliveryMode = body.deliveryMode === "relay" ? "relay" : "run";
  if (!title || !task) {
    sendJson(response, 400, { error: "Automation requires non-empty title and task." });
    return;
  }
  if (deliveryMode === "relay" && scheduleKind !== "event") {
    sendJson(response, 400, { error: "Relay automations must use scheduleKind=event." });
    return;
  }

  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const agent = agentId ? sessionStore.getAgent(agentId) : null;
    if (agentId && !agent) {
      sendJson(response, 404, { error: `Agent ${agentId} was not found.` });
      return;
    }
    const effectiveCwd = agent?.cwd ?? cwd;
    const workspace =
      agent?.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) ?? sessionStore.upsertWorkspace(effectiveCwd) : sessionStore.upsertWorkspace(effectiveCwd);
      const automation = sessionStore.createAutomation({
        workspaceId: workspace.id,
        agentId: agent?.id ?? null,
        threadId: typeof body.threadId === "string" ? body.threadId : null,
        title,
      threadTitle: typeof body.threadTitle === "string" ? body.threadTitle : null,
      task,
      mode: body.mode === "openai" ? "openai" : context.options.mode ?? "mock",
      executionDomain:
        body.executionDomain === "worktree" || body.executionDomain === "sandbox" || body.executionDomain === "workspace"
          ? body.executionDomain
          : context.options.executionDomain ?? "workspace",
      verificationMode: body.verificationMode === "best-effort" ? "best-effort" : context.options.verificationMode ?? "required",
      verificationCommands: Array.isArray(body.verificationCommands)
        ? body.verificationCommands.map((entry) => String(entry))
        : context.options.verificationCommands ?? [],
      autoApproveRisky: Boolean(body.autoApproveRisky ?? context.options.autoApproveRisky ?? false),
        maxIterations: parsePositiveNumber(body.maxIterations, context.options.maxIterations ?? 8),
        scheduleKind,
        intervalSeconds:
          scheduleKind === "manual" || scheduleKind === "event"
            ? null
            : parsePositiveNumber(body.intervalSeconds, 300),
        heartbeatWindowSeconds:
          scheduleKind === "heartbeat" ? parsePositiveNumber(body.heartbeatWindowSeconds, 300) : null,
        triggerEventTypes: Array.isArray(body.triggerEventTypes)
          ? body.triggerEventTypes.map((entry) => String(entry))
          : undefined,
        triggerRouteId: typeof body.triggerRouteId === "string" ? body.triggerRouteId : null,
        triggerChannelType: typeof body.triggerChannelType === "string" ? body.triggerChannelType : null,
        triggerChannelKey: typeof body.triggerChannelKey === "string" ? body.triggerChannelKey : null,
        triggerSenders: Array.isArray(body.triggerSenders)
          ? body.triggerSenders.map((entry) => String(entry))
          : undefined,
        triggerTextPattern: typeof body.triggerTextPattern === "string" ? body.triggerTextPattern : null,
        deliveryMode,
        relayTemplate: typeof body.relayTemplate === "string" ? body.relayTemplate : null,
        retryDelaySeconds:
          scheduleKind === "manual" || scheduleKind === "event"
            ? null
            : parsePositiveNumber(body.retryDelaySeconds, 30),
        maxConsecutiveFailures: parsePositiveNumber(body.maxConsecutiveFailures, 3),
        status: body.status === "paused" ? "paused" : "active",
      });
    context.eventBus.publish({
      type: "automation.created",
      at: new Date().toISOString(),
      data: automation,
    });
    sendJson(response, 200, { automation });
  } finally {
    sessionStore.close();
  }
}

async function handleListRoutes(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const agentId = url.searchParams.get("agentId") ?? undefined;
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const agent = agentId ? sessionStore.getAgent(agentId) : null;
    const workspace = agent?.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) : sessionStore.getWorkspaceByCwd(cwd);
    const routes = sessionStore.listRoutes({ workspaceId: workspace?.id, agentId });
    sendJson(response, 200, { workspace, routes: routes.map((route) => presentRoute(route)) });
  } finally {
    sessionStore.close();
  }
}

async function handleCreateRoute(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;

  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const route = createRouteRecord(sessionStore, body, context.options.cwd ?? process.cwd());
    context.eventBus.publish({
      type: "route.created",
      at: new Date().toISOString(),
      data: presentRoute(route),
    });
    sendJson(response, 200, { route: presentRoute(route) });
  } finally {
    sessionStore.close();
  }
}

async function handleListChannelPlugins(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    const routes = sessionStore.listRoutes({ workspaceId: workspace?.id });
    const deliveries = sessionStore.listOutboundDeliveries({ workspaceId: workspace?.id, limit: 200 });
    const inboundMessages = sessionStore.listInboundMessages({ workspaceId: workspace?.id, limit: 200 });
    sendJson(response, 200, {
      workspace,
      plugins: listDefaultChannelPlugins().map((plugin) =>
        presentChannelPlugin(plugin, routes, deliveries, inboundMessages),
      ),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleChannelPluginStatus(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
  channelType: string,
): Promise<void> {
  const plugin = getDefaultChannelPlugin(channelType);
  if (!plugin) {
    sendJson(response, 404, { error: `Channel plugin ${channelType} was not found.` });
    return;
  }
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    const routes = sessionStore.listRoutes({ workspaceId: workspace?.id }).filter((route) => route.channelType === plugin.id);
    const deliveries = sessionStore.listOutboundDeliveries({ workspaceId: workspace?.id, limit: 200 });
    const inboundMessages = sessionStore.listInboundMessages({ workspaceId: workspace?.id, limit: 200 });
    sendJson(response, 200, {
      workspace,
      plugin: presentChannelPlugin(plugin, routes, deliveries, inboundMessages),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleOperatorState(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const eventLimit = parsePositiveNumber(url.searchParams.get("eventLimit"), 50);
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  const registry = await loadExtensionRegistry({
    cwd,
    pluginDirs: context.options.pluginDirs,
  });
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    const workspaceId = workspace?.id;
    const routes = sessionStore.listRoutes({ workspaceId });
    const deliveries = sessionStore.listOutboundDeliveries({ workspaceId, limit: 100 });
    const inboundMessages = sessionStore.listInboundMessages({ workspaceId, limit: 100 });
    const threads = workspaceId ? sessionStore.listThreads(workspaceId).slice(0, 50) : [];
    const runs = threads.flatMap((thread) => sessionStore.listRuns(thread.id, 10)).slice(0, 100);
    const subagents = sessionStore.listSubagentJobs({ workspaceId, limit: 100 });
    const subagentTopology = buildSubagentTopology(subagents);
    const modelProfiles = context.options.modelProfiles ?? loadModelProfilesFromEnv();

    sendJson(response, 200, {
      workspace,
      generatedAt: new Date().toISOString(),
      operations: {
        jobs: context.jobStore.listAll().slice(0, 100),
        threads,
        runs,
        subagents,
        subagentTopology,
        events: context.eventBus.list(eventLimit).map((event) => presentGatewayEventWithAcpProjection(event)),
        deliveries: deliveries.map((delivery) => presentOutboundDelivery(delivery)),
        routes: routes.map((route) => presentRoute(route)),
        nodes: context.controlPlane.listNodes(),
      },
      diagnostics: {
        gateway: {
          ok: true,
          mode: context.options.mode ?? "mock",
          authMode: context.options.accessToken ? "token_required" : "open",
          executionDomain: context.options.executionDomain ?? "workspace",
          verificationMode: context.options.verificationMode ?? "best-effort",
        },
        workspacePath: inspectWorkspacePath(cwd),
        modelProfiles: modelProfiles.map((profile) => ({
          id: profile.id,
          protocol: profile.protocol,
          model: profile.model,
          apiKeyEnv: profile.apiKeyEnv,
          apiKeyStatus: hasModelProfileApiKey(profile) ? "configured" : "missing",
          baseUrl: profile.baseUrl ? "configured" : null,
          health: hasModelProfileApiKey(profile) ? "ready" : "missing_key",
          unavailableReason: hasModelProfileApiKey(profile) ? null : `Missing API key in ${profile.apiKeyEnv}`,
        })),
        authProfiles: sessionStore.listAuthProfileStates(),
        contextEngines: [...listBuiltinContextEngines(), ...registry.listContextEngines()].map((engine) => ({
          ...engine,
          health: "available",
        })),
        memoryProviders: [...listBuiltinMemoryProviders(), ...registry.listMemoryProviders()].map((provider) => ({
          ...provider,
          health: "available",
        })),
        extensions: registry.list().map((extension) => ({
          ...extension,
          health: "loaded",
        })),
        mcp: {
          resources: registry.listResources(),
          prompts: registry.listPromptTemplates(),
          tools: registry.listToolDefinitions().map((tool) => tool.name),
          runtimes: registry.listMcpRuntimeHealth(),
        },
        channelPlugins: listDefaultChannelPlugins().map((plugin) =>
          presentChannelPlugin(plugin, routes, deliveries, inboundMessages),
        ),
      },
      controls: {
        websocketMessages: ["run.start", "route.deliver", "delivery.retry", "subagent.control", "inbox.accept"],
        http: {
          approvePairing: "POST /pairings/approve",
          retryDelivery: "POST /deliveries/{deliveryId}/retry",
          pauseSubagent: "POST /subagents/{jobId}/pause",
          resumeSubagent: "POST /subagents/{jobId}/resume",
          interruptSubagent: "POST /subagents/{jobId}/interrupt",
          cancelSubagent: "POST /subagents/{jobId}/cancel",
          messageSubagent: "POST /subagents/{jobId}/message",
          rerunDetachedSubagent: "POST /subagents/{jobId}/reattach",
          runProfileEvaluation: "POST /agent-profiles/{profileId}/evaluations",
          switchAgentModelProfile: "PATCH /agents/{agentId}",
          cleanupExecution: "POST /runs/{runId}/cleanup",
        },
      },
    });
  } finally {
    await registry.dispose();
    sessionStore.close();
  }
}

function inspectWorkspacePath(cwd: string): Record<string, unknown> {
  const resolved = resolve(cwd);
  const exists = existsSync(resolved);
  const readable = exists && canAccessPath(resolved, fsConstants.R_OK);
  const writable = exists && canAccessPath(resolved, fsConstants.W_OK);
  return {
    cwd,
    resolved,
    exists,
    readable,
    writable,
    health: !exists ? "missing" : readable && writable ? "ready" : readable ? "read_only" : "blocked",
  };
}

function canAccessPath(path: string, mode: number): boolean {
  try {
    accessSync(path, mode);
    return true;
  } catch {
    return false;
  }
}

function buildMobileNodeManifest(): Record<string, unknown> {
  return {
    protocol: "omni.mobile-node.v1",
    channelType: "mobile-node",
    register: {
      method: "POST",
      path: "/mobile-node/register",
      requiredFields: ["deviceId", "endpointUrl"],
      optionalFields: ["serviceToken", "inboundSecret", "title", "cwd", "agentId"],
    },
    inboundEvents: {
      method: "POST",
      pathTemplate: "/mobile-node/{deviceId}/events",
      requiredHeaders: ["x-omni-route-secret when route.inboundSecret is configured"],
      supportedTypes: ["text", "notification_action", "file", "voice", "device_state"],
    },
    outboundEnvelope: {
      type: "omni.mobile.delivery.v1",
      fields: ["deviceId", "route", "delivery", "notification", "content", "metadata"],
    },
    pairing: {
      defaultPolicy: "pairing",
      approvalPath: "/pairings/approve",
    },
  };
}

async function handleMobileNodeRegistration(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  const endpointUrl = typeof body.endpointUrl === "string" ? body.endpointUrl.trim() : "";
  if (!deviceId || !endpointUrl) {
    sendJson(response, 400, { error: "Mobile node registration requires deviceId and endpointUrl." });
    return;
  }

  const adapterConfig: Record<string, unknown> = {
    endpointUrl,
    deviceId,
    dmPolicy: body.dmPolicy === "open" ? "open" : "pairing",
  };
  if (typeof body.serviceToken === "string" && body.serviceToken.trim().length > 0) {
    adapterConfig.serviceToken = body.serviceToken.trim();
  }
  if (Array.isArray(body.allowFrom)) {
    adapterConfig.allowFrom = body.allowFrom;
  }

  const routeBody: Record<string, unknown> = {
    ...body,
    title: typeof body.title === "string" && body.title.trim().length > 0 ? body.title : `Mobile ${deviceId}`,
    channelType: "mobile-node",
    channelKey: deviceId,
    adapterType: "mobile-node",
    adapterConfig,
    inboundSecret: typeof body.inboundSecret === "string" ? body.inboundSecret : null,
  };
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const route = createRouteRecord(sessionStore, routeBody, context.options.cwd ?? process.cwd());
    context.eventBus.publish({
      type: "mobile-node.registered",
      at: new Date().toISOString(),
      data: presentRoute(route),
    });
    sendJson(response, 201, {
      protocol: "omni.mobile-node.v1",
      route: presentRoute(route),
      inboundUrl: `/mobile-node/${encodeURIComponent(deviceId)}/events`,
    });
  } finally {
    sessionStore.close();
  }
}

async function handleListDeliveries(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    const routeId = url.searchParams.get("routeId") ?? undefined;
    const status = normalizeDeliveryStatus(url.searchParams.get("status"));
    const deliveries = sessionStore.listOutboundDeliveries({
      workspaceId: workspace?.id,
      routeId,
      status: status ?? undefined,
      limit: parsePositiveNumber(url.searchParams.get("limit"), 50),
    });
    const routesById = new Map(
      sessionStore
        .listRoutes({ workspaceId: workspace?.id })
        .map((route) => [route.id, route]),
    );
    sendJson(response, 200, {
      workspace,
      deliveries: deliveries.map((delivery) => presentOutboundDelivery(delivery, routesById.get(delivery.routeId))),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleRetryDelivery(
  context: GatewayRuntimeContext,
  deliveryId: string,
  response: ServerResponse,
): Promise<void> {
  try {
    const result = await retryDeliveryById(context, deliveryId);
    sendJson(response, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, /was not found/i.test(message) ? 404 : 409, { error: message });
  }
}

async function handleManualRouteDelivery(
  context: GatewayRequestContext,
  routeId: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const content = String(body.content ?? "").trim();
  if (!content) {
    sendJson(response, 400, { error: "Manual route delivery requires non-empty content." });
    return;
  }

  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const route = sessionStore.getRoute(routeId);
    if (!route) {
      sendJson(response, 404, { error: `Route ${routeId} was not found.` });
      return;
    }

    const delivery = await createAndSendDelivery(context, sessionStore, route, {
      content,
      metadata: { manual: true, requestedAt: new Date().toISOString() },
    });
    sendJson(response, 200, { route: presentRoute(route), delivery: presentOutboundDelivery(delivery, route) });
  } finally {
    sessionStore.close();
  }
}

async function handleListPairings(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    const routeId = url.searchParams.get("routeId") ?? undefined;
    const status = normalizePairingStatus(url.searchParams.get("status"));
    const pairings = sessionStore.listRoutePairings({
      workspaceId: workspace?.id,
      routeId,
      status: status ?? undefined,
      limit: parsePositiveNumber(url.searchParams.get("limit"), 50),
    });
    sendJson(response, 200, { workspace, pairings });
  } finally {
    sessionStore.close();
  }
}

async function handleApprovePairing(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    sendJson(response, 400, { error: "Pairing approval requires a non-empty code." });
    return;
  }

  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const pairing = sessionStore.getRoutePairingByCode(code);
    if (!pairing) {
      sendJson(response, 404, { error: `Pairing code ${code} was not found.` });
      return;
    }
    const route = sessionStore.getRoute(pairing.routeId);
    if (!route) {
      sendJson(response, 404, { error: `Route ${pairing.routeId} was not found.` });
      return;
    }

    const updatedRoute = allowRouteSender(sessionStore, route, pairing.sender);
    const approvedPairing = sessionStore.updateRoutePairing({
      pairingId: pairing.id,
      status: "approved",
      approvedAt: new Date().toISOString(),
    });
    context.eventBus.publish({
      type: "pairing.approved",
      at: new Date().toISOString(),
      data: {
        pairing: approvedPairing,
        route: presentRoute(updatedRoute),
      },
    });
    sendJson(response, 200, {
      pairing: approvedPairing,
      route: presentRoute(updatedRoute),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleListInboundMessages(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    const routeId = url.searchParams.get("routeId") ?? undefined;
    const status = normalizeInboundStatus(url.searchParams.get("status"));
    const messages = sessionStore.listInboundMessages({
      workspaceId: workspace?.id,
      routeId,
      status: status ?? undefined,
      limit: parsePositiveNumber(url.searchParams.get("limit"), 50),
    });
    const routesById = new Map(
      sessionStore
        .listRoutes({ workspaceId: workspace?.id })
        .map((route) => [route.id, route]),
    );
    sendJson(response, 200, {
      workspace,
      messages: messages.map((message) => presentInboundMessage(message, routesById.get(message.routeId))),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleListAuditLogs(
  context: GatewayRequestContext,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const cwd = url.searchParams.get("cwd") ?? context.options.cwd ?? process.cwd();
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspaceByCwd(cwd);
    const agentId = url.searchParams.get("agentId") ?? undefined;
    sendJson(response, 200, {
      workspace,
      auditLogs: sessionStore.listAuditLogs({
        workspaceId: url.searchParams.get("workspaceId") ?? workspace?.id ?? null,
        agentId,
        action: url.searchParams.get("action"),
        limit: parsePositiveNumber(url.searchParams.get("limit"), 50),
      }),
    });
  } finally {
    sessionStore.close();
  }
}

async function handleCreateInboundMessage(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  const asyncMode = body.async !== false;
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  let route: ChannelRouteRecord | null = null;
  let inboundMessage: InboundMessageRecord | null = null;

  try {
    sessionStore.initialize();
    route = resolveRouteForInboundMessage(sessionStore, body, context.options.cwd ?? process.cwd());
    if (!route) {
      sendJson(response, 404, { error: "No route found for the provided channelType/channelKey or routeId." });
      return;
    }

    const text = String(body.text ?? "").trim();
    if (!text) {
      sendJson(response, 400, { error: "Inbound message requires non-empty text." });
      return;
    }

    inboundMessage = sessionStore.createInboundMessage({
      routeId: route.id,
      workspaceId: route.workspaceId,
      threadId: route.threadId,
      channelType: route.channelType,
      channelKey: route.channelKey,
      channelMessageId: typeof body.channelMessageId === "string" ? body.channelMessageId : null,
      sender: typeof body.sender === "string" ? body.sender : null,
      text,
      metadata: normalizeMetadataPayload(body.metadata),
      status: "queued",
    });
  } finally {
    sessionStore.close();
  }

  if (!route || !inboundMessage) {
    return;
  }

  if (context.options.accessToken && !isAuthorizedForRoute(request, route, context.options.accessToken, body)) {
    const store = new SqliteSessionStore(context.options.storageRoot);
    try {
      store.initialize();
      store.updateInboundMessage({
        messageId: inboundMessage.id,
        status: "failed",
      });
    } finally {
      store.close();
    }
    sendJson(response, 401, { error: "Unauthorized inbound route request." });
    return;
  }

  const senderPolicy = await enforceRouteSenderPolicy(context, route, inboundMessage, body);
  if (!senderPolicy.authorized) {
    sendJson(response, 403, {
      error: "Inbound sender is not approved for this route.",
      pairing: senderPolicy.pairing,
      route: presentRoute(route),
    });
    return;
  }

  writeInboundTranscript(route, inboundMessage);
  context.eventBus.publish({
    type: "inbox.received",
    at: new Date().toISOString(),
    data: inboundMessage,
  });
  await dispatchTriggeredInboundAutomations(context, route, inboundMessage);
  const dispatched = await dispatchInboundRouteMessage(context, route, inboundMessage, body, asyncMode);
  if (dispatched.job) {
    sendJson(response, 202, { accepted: true, inboundMessage: presentInboundMessage(inboundMessage, route), job: dispatched.job });
    return;
  }
  sendJson(response, 200, { inboundMessage: presentInboundMessage(inboundMessage, route), result: dispatched.result });
}

async function handleProviderInboundWebhook(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
  channelType: string,
  providerGroup: "consumer" | "enterprise",
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  await handleProviderInboundBody(context, body, response, channelType, providerGroup, request.headers);
}

async function handleMobileNodeDeviceEvent(
  context: GatewayRequestContext,
  request: IncomingMessage,
  response: ServerResponse,
  deviceId: string,
): Promise<void> {
  const body = (await readJsonBody(request)) as Record<string, unknown>;
  await handleProviderInboundBody(
    context,
    {
      ...body,
      channelType: "mobile-node",
      channelKey: typeof body.channelKey === "string" && body.channelKey.trim().length > 0 ? body.channelKey : deviceId,
      deviceId,
      sender: typeof body.sender === "string" && body.sender.trim().length > 0 ? body.sender : deviceId,
    },
    response,
    "mobile-node",
    "consumer",
    request.headers,
  );
}

async function handleProviderInboundBody(
  context: GatewayRequestContext,
  body: Record<string, unknown>,
  response: ServerResponse,
  channelType: string,
  providerGroup: "consumer" | "enterprise",
  requestHeaders: IncomingMessage["headers"],
): Promise<void> {
  const normalized = normalizeEnterpriseInboundPayload(channelType, body);
  const asyncMode = body.async !== false;
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  let route: ChannelRouteRecord | null = null;
  let inboundMessage: InboundMessageRecord | null = null;

  try {
    sessionStore.initialize();
    route = resolveRouteForInboundMessage(
      sessionStore,
      {
        ...body,
        routeId: normalized.routeId ?? body.routeId,
        channelType,
        channelKey: normalized.channelKey,
      },
      context.options.cwd ?? process.cwd(),
    );
    if (!route) {
      sendJson(response, 404, { error: `No ${channelType} route found for the inbound webhook.` });
      return;
    }
    const signature = requestHeaders["x-omni-route-secret"] ?? body.signature ?? body.sign;
    const signatureVerified = !route.inboundSecret || String(signature ?? "") === route.inboundSecret;
    const security = analyzeInboundSecurity(normalized.text, signatureVerified, getChannelCapability(channelType));
    if (!signatureVerified) {
      sessionStore.addAuditLog({
        workspaceId: route.workspaceId,
        agentId: route.agentId,
        actorType: channelType,
        actorId: normalized.sender,
        action: "inbound.signature_rejected",
        targetType: "route",
        targetId: route.id,
        riskLevel: "high",
        summary: `${channelType} inbound signature verification failed.`,
        metadata: { channelType, channelMessageId: normalized.channelMessageId, security },
      });
      sendJson(response, 401, { error: "Inbound webhook signature verification failed.", security });
      return;
    }
    inboundMessage = sessionStore.createInboundMessage({
      routeId: route.id,
      workspaceId: route.workspaceId,
      threadId: route.threadId,
      channelType: route.channelType,
      channelKey: route.channelKey,
      channelMessageId: normalized.channelMessageId,
      sender: normalized.sender,
      text: normalized.text,
      metadata: {
        ...normalized.metadata,
        provider: channelType,
        providerGroup,
        signatureVerified,
        security,
      },
      status: "queued",
    });
    sessionStore.addAuditLog({
      workspaceId: route.workspaceId,
      agentId: route.agentId,
      actorType: channelType,
      actorId: normalized.sender,
      action: "inbound.accepted",
      targetType: "inbound_message",
      targetId: inboundMessage.id,
      riskLevel: security.riskLevel,
      summary: `${channelType} inbound message accepted for route ${route.title}.`,
      metadata: { channelType, channelMessageId: normalized.channelMessageId, security },
    });
  } finally {
    sessionStore.close();
  }

  if (!route || !inboundMessage) {
    return;
  }

  const senderPolicy = await enforceRouteSenderPolicy(context, route, inboundMessage, body);
  if (!senderPolicy.authorized) {
    sendJson(response, 403, {
      error: "Inbound sender is not approved for this route.",
      pairing: senderPolicy.pairing,
      route: presentRoute(route),
    });
    return;
  }

  context.eventBus.publish({
    type: providerGroup === "enterprise" ? "inbox.enterprise.received" : "inbox.consumer.received",
    at: new Date().toISOString(),
    data: inboundMessage,
  });
  await dispatchTriggeredInboundAutomations(context, route, inboundMessage);
  const dispatched = await dispatchInboundRouteMessage(context, route, inboundMessage, body, asyncMode);
  if (dispatched.job) {
    sendJson(response, 202, { accepted: true, inboundMessage, job: dispatched.job });
    return;
  }
  sendJson(response, 200, { inboundMessage, result: dispatched.result });
}

async function dispatchInboundRouteMessage(
  context: GatewayRuntimeContext,
  route: ChannelRouteRecord,
  inboundMessage: InboundMessageRecord,
  body: Record<string, unknown>,
  asyncMode: boolean,
): Promise<{ job?: GatewayJobRecord; result?: Record<string, unknown> }> {
  const runRequest = buildInboundRunRequest(route, inboundMessage, body, context.options);
  if (asyncMode) {
    const job = context.jobStore.create(body, {
      kind: "inbox-message",
      routeId: route.id,
      inboundMessageId: inboundMessage.id,
    });
    context.eventBus.publish({
      type: "job.queued",
      at: new Date().toISOString(),
      data: job,
    });
    void executeAsyncJob(context, job, runRequest, {
      onCompleted: async ({ runId, threadId }) => {
        const store = new SqliteSessionStore(context.options.storageRoot);
        try {
          store.initialize();
          const runDetails = runId ? getRunDetails(runId, context.options.storageRoot) : null;
          store.updateInboundMessage({
            messageId: inboundMessage.id,
            threadId: threadId ?? route.threadId,
            status: "processed",
            runId: runId ?? null,
          });
          if (threadId) {
            store.updateRoute({ routeId: route.id, threadId });
          }
          const finalResponse = extractFinalResponse(runDetails);
            if (finalResponse) {
              await createAndSendDelivery(context, store, route, {
                threadId: threadId ?? route.threadId,
                runId: runId ?? null,
                content: finalResponse,
                metadata: buildInboundDeliveryMetadata(inboundMessage, "inbox"),
              });
            }
        } finally {
          store.close();
        }
        context.eventBus.publish({
          type: "inbox.processed",
          at: new Date().toISOString(),
          data: { inboundMessageId: inboundMessage.id, runId, threadId },
        });
      },
      onFailed: async (error) => {
        const store = new SqliteSessionStore(context.options.storageRoot);
        try {
          store.initialize();
          store.updateInboundMessage({
            messageId: inboundMessage.id,
            status: "failed",
          });
        } finally {
          store.close();
        }
        context.eventBus.publish({
          type: "inbox.failed",
          at: new Date().toISOString(),
          data: { inboundMessageId: inboundMessage.id, error },
        });
      },
    });
    return { job };
  }

  const result = await executeGatewayRunRequest(runRequest, {
    eventHandler: async (event) => {
      publishRuntimeEvent(context.eventBus, event);
    },
    modelProfiles: context.options.modelProfiles,
  });
  const summary = result.summary as { run?: { id?: string; threadId?: string } };
  const finalResponse = extractFinalResponse(result);
  const store = new SqliteSessionStore(context.options.storageRoot);
  try {
    store.initialize();
    store.updateInboundMessage({
      messageId: inboundMessage.id,
      status: "processed",
      runId: summary.run?.id ?? null,
      threadId: summary.run?.threadId ?? route.threadId,
    });
    if (summary.run?.threadId) {
      store.updateRoute({ routeId: route.id, threadId: summary.run.threadId });
    }
      if (finalResponse) {
        await createAndSendDelivery(context, store, route, {
          threadId: summary.run?.threadId ?? route.threadId,
          runId: summary.run?.id ?? null,
          content: finalResponse,
          metadata: buildInboundDeliveryMetadata(inboundMessage, "inbox"),
        });
      }
  } finally {
    store.close();
  }
  context.eventBus.publish({
    type: "inbox.processed",
    at: new Date().toISOString(),
    data: { inboundMessageId: inboundMessage.id, runId: summary.run?.id, threadId: summary.run?.threadId },
  });
  return { result };
}

async function executeAsyncJob(
  context: GatewayRuntimeContext,
  job: GatewayJobRecord,
  runRequest: NormalizedGatewayRunRequest,
  callbacks: AsyncJobCallbacks = {},
): Promise<void> {
  const initialJob = context.jobStore.get(job.id);
  if (callbacks.cancellation?.signal.aborted || initialJob?.status === "cancelled") {
    const reason = initialJob?.error ?? (callbacks.cancellation ? getCancellationReason(callbacks.cancellation.signal) : "Async gateway job was cancelled.");
    if (initialJob?.status !== "cancelled") {
      const updated = context.jobStore.update(job.id, { status: "cancelled", error: reason });
      context.eventBus.publish({
        type: "job.cancelled",
        at: new Date().toISOString(),
        data: updated,
      });
    }
    await callbacks.onCancelled?.(reason);
    return;
  }
  context.jobStore.update(job.id, { status: "running" });
  context.eventBus.publish({
    type: "job.started",
    at: new Date().toISOString(),
    data: context.jobStore.get(job.id),
  });
  let run: Promise<Record<string, unknown>> | null = null;
  try {
    run = executeGatewayRunRequest(runRequest, {
      eventHandler: async (event) => {
        publishRuntimeEvent(context.eventBus, event);
      },
      modelProfiles: context.options.modelProfiles,
      abortSignal: callbacks.cancellation?.signal,
    });
    const result = await (callbacks.cancellation ? Promise.race([run, callbacks.cancellation.cancelled]) : run);
    if (context.jobStore.get(job.id)?.status === "cancelled") {
      return;
    }
    const summary = result.summary as { run?: { id?: string; threadId?: string } };
    const updated = context.jobStore.update(job.id, {
      status: "completed",
      runId: summary.run?.id,
      threadId: summary.run?.threadId,
    });
    context.eventBus.publish({
      type: "job.completed",
      at: new Date().toISOString(),
      data: updated,
    });
    await callbacks.onCompleted?.({
      runId: summary.run?.id,
      threadId: summary.run?.threadId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof AsyncJobCancelledError || callbacks.cancellation?.signal.aborted) {
      if (context.jobStore.get(job.id)?.status !== "cancelled") {
        const updated = context.jobStore.update(job.id, {
          status: "cancelled",
          error: message,
        });
        context.eventBus.publish({
          type: "job.cancelled",
          at: new Date().toISOString(),
          data: updated,
        });
      }
      await callbacks.onCancelled?.(message);
      await run?.catch(() => undefined);
      return;
    }
    if (context.jobStore.get(job.id)?.status === "cancelled") {
      await callbacks.onCancelled?.(message);
      await run?.catch(() => undefined);
      return;
    }
    const updated = context.jobStore.update(job.id, {
      status: "failed",
      error: message,
    });
    context.eventBus.publish({
      type: "job.failed",
      at: new Date().toISOString(),
      data: updated,
    });
    await callbacks.onFailed?.(message);
  } finally {
    context.acpJobCancellations.delete(job.id);
  }
}

function createAsyncJobCancellation(): AsyncJobCancellation {
  const abortController = new AbortController();
  let rejectCancelled!: (error: AsyncJobCancelledError) => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCancelled = reject;
  });
  void cancelled.catch(() => undefined);
  return {
    signal: abortController.signal,
    cancelled,
    cancel(reason: string): void {
      if (abortController.signal.aborted) {
        return;
      }
      const error = new AsyncJobCancelledError(reason);
      abortController.abort(error);
      rejectCancelled(error);
    },
  };
}

function getCancellationReason(signal: AbortSignal): string {
  const reason = signal.reason;
  if (reason instanceof Error) {
    return reason.message;
  }
  return typeof reason === "string" && reason.trim().length > 0 ? reason : "Async gateway job was cancelled.";
}

async function dispatchTriggeredInboundAutomations(
  context: GatewayRuntimeContext,
  route: ChannelRouteRecord,
  inboundMessage: InboundMessageRecord,
): Promise<void> {
  await context.scheduler.dispatchEvent(buildInboundAutomationTrigger(route, inboundMessage));
}

function buildInboundAutomationTrigger(
  route: ChannelRouteRecord,
  inboundMessage: InboundMessageRecord,
): AutomationTriggerEvent {
  return {
    eventType: "inbox.received",
    workspaceId: route.workspaceId,
    routeId: route.id,
    channelType: route.channelType,
    channelKey: route.channelKey,
    sender: inboundMessage.sender,
    text: inboundMessage.text,
  };
}

async function runAutomationNow(
  automation: AutomationRecord,
  options: StartGatewayServerOptions,
  eventBus: GatewayEventBus,
  adapterRegistry: RouteAdapterRegistry,
  trigger?: AutomationTriggerEvent,
): Promise<{ runId?: string | null; summary?: string }> {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const workspace = sessionStore.getWorkspace(automation.workspaceId);
    if (!workspace) {
      throw new Error(`Automation ${automation.id} references a missing workspace.`);
    }

    if (automation.scheduleKind === "maintenance") {
      const application = sessionStore.applyLearnedSkillMaintenance({
        workspaceId: workspace.id,
        agentId: automation.agentId,
        limit: automation.maxIterations,
      });
      eventBus.publish({
        type: "skills.maintenance.applied",
        at: application.appliedAt,
        data: {
          automationId: automation.id,
          workspace,
          application,
        },
      });
      return {
        runId: null,
        summary: `Applied self-learning maintenance: promoted=${application.promotedSkills.length}, reverify=${application.reverifySkills.length}, disabled=${application.disabledSkills.length}.`,
      };
    }

    if (automation.deliveryMode === "relay") {
      await deliverRelayAutomation({
        automation,
        trigger,
        sessionStore,
        eventBus,
        adapterRegistry,
      });
      return {
        runId: null,
        summary: automation.title,
      };
    }
    const triggerRoute = trigger?.routeId ? sessionStore.getRoute(trigger.routeId) : null;

    const result = await executeGatewayRunRequest(
      buildRunRequestFromAutomation(
        automation,
        workspace.cwd,
        options.storageRoot,
        options.pluginDirs ?? [],
        {
          task: buildAutomationPrompt(automation, trigger),
          threadId: automation.threadId ?? triggerRoute?.threadId ?? undefined,
          threadTitle: trigger ? renderAutomationTemplate(automation.threadTitle ?? automation.title, automation, trigger) : undefined,
          toolPolicyContext: trigger
            ? {
                routeId: trigger.routeId ?? undefined,
                channelType: trigger.channelType ?? undefined,
                channelKey: trigger.channelKey ?? undefined,
              }
            : undefined,
        },
      ),
      {
        eventHandler: async (event) => {
          publishRuntimeEvent(eventBus, event);
        },
        modelProfiles: options.modelProfiles,
      },
    );
    const summary = result.summary as { run?: { id?: string } };
    return {
      runId: summary.run?.id ?? null,
      summary: automation.title,
    };
  } finally {
    sessionStore.close();
  }
}

async function deliverRelayAutomation(input: {
  readonly automation: AutomationRecord;
  readonly trigger?: AutomationTriggerEvent;
  readonly sessionStore: SqliteSessionStore;
  readonly eventBus: GatewayEventBus;
  readonly adapterRegistry: RouteAdapterRegistry;
}): Promise<void> {
  const routeId = input.trigger?.routeId ?? input.automation.triggerRouteId;
  if (!routeId) {
    throw new Error(`Relay automation ${input.automation.id} requires a route-bound trigger.`);
  }
  const route = input.sessionStore.getRoute(routeId);
  if (!route) {
    throw new Error(`Relay automation ${input.automation.id} references a missing route ${routeId}.`);
  }
  const content = renderAutomationTemplate(
    input.automation.relayTemplate ?? input.automation.task,
    input.automation,
    input.trigger,
  );
  await createAndSendDelivery(
    {
      adapterRegistry: input.adapterRegistry,
      eventBus: input.eventBus,
    },
    input.sessionStore,
    route,
    {
      threadId: route.threadId,
      runId: null,
      content,
      metadata: input.trigger ? { automationId: input.automation.id, eventType: input.trigger.eventType } : { automationId: input.automation.id },
    },
  );
}

function buildAutomationPrompt(
  automation: AutomationRecord,
  trigger?: AutomationTriggerEvent,
): string {
  const renderedTask = renderAutomationTemplate(automation.task, automation, trigger);
  if (!trigger) {
    return renderedTask;
  }
  return [
    renderedTask,
    "",
    "Automation trigger context:",
    `- eventType: ${trigger.eventType}`,
    `- routeId: ${trigger.routeId ?? "n/a"}`,
    `- channel: ${trigger.channelType ?? "n/a"}:${trigger.channelKey ?? "n/a"}`,
    `- sender: ${trigger.sender ?? "n/a"}`,
    "Message:",
    trigger.text ?? "",
  ]
    .filter((entry) => entry.length > 0)
    .join("\n");
}

function renderAutomationTemplate(
  template: string,
  automation: AutomationRecord,
  trigger?: AutomationTriggerEvent,
): string {
  const replacements: Record<string, string> = {
    automationId: automation.id,
    automationTitle: automation.title,
    eventType: trigger?.eventType ?? "",
    routeId: trigger?.routeId ?? "",
    channelType: trigger?.channelType ?? "",
    channelKey: trigger?.channelKey ?? "",
    sender: trigger?.sender ?? "",
    message: normalizeEventTextForAutomation(trigger?.text),
  };
  let rendered = template;
  for (const [key, value] of Object.entries(replacements)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

function normalizeEventTextForAutomation(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

async function runAutomationById(
  automationId: string,
  options: StartGatewayServerOptions,
  eventBus: GatewayEventBus,
  adapterRegistry: RouteAdapterRegistry,
): Promise<Record<string, unknown> | null> {
  const sessionStore = new SqliteSessionStore(options.storageRoot);
  try {
    sessionStore.initialize();
    const automation = sessionStore.getAutomation(automationId);
    if (!automation) {
      return null;
    }
    const result = await runAutomationNow(automation, options, eventBus, adapterRegistry);
    return {
      automation,
      result,
    };
  } finally {
    sessionStore.close();
  }
}

async function createAndSendDelivery(
  context: Pick<GatewayRuntimeContext, "adapterRegistry" | "eventBus">,
  sessionStore: SqliteSessionStore,
  route: ChannelRouteRecord,
  input: {
    readonly threadId?: string | null;
    readonly runId?: string | null;
    readonly content: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<OutboundDeliveryRecord> {
  const delivery = sessionStore.createOutboundDelivery({
    routeId: route.id,
    workspaceId: route.workspaceId,
    threadId: input.threadId ?? route.threadId,
    runId: input.runId ?? null,
    channelType: route.channelType,
    channelKey: route.channelKey,
    adapterType: route.adapterType,
    payload: input.content,
    status: "queued",
  });

  context.eventBus.publish({
    type: "delivery.queued",
    at: new Date().toISOString(),
    data: delivery,
  });

  return attemptDelivery(context, sessionStore, route, delivery, input.metadata);
}

async function attemptDelivery(
  context: Pick<GatewayRuntimeContext, "adapterRegistry" | "eventBus">,
  sessionStore: SqliteSessionStore,
  route: ChannelRouteRecord,
  delivery: OutboundDeliveryRecord,
  metadata?: Record<string, unknown>,
): Promise<OutboundDeliveryRecord> {
  let current = sessionStore.updateOutboundDelivery({
    deliveryId: delivery.id,
    status: "sending",
    attemptCount: delivery.attemptCount + 1,
    lastAttemptAt: new Date().toISOString(),
  });

  try {
    const result = await context.adapterRegistry.send({
      route,
      delivery: current,
      content: current.payload,
      metadata,
    });

    current = sessionStore.updateOutboundDelivery({
      deliveryId: current.id,
      status: result.ok ? "delivered" : "failed",
      responseSummary: result.summary,
      deliveredAt: result.ok ? new Date().toISOString() : null,
    });

    context.eventBus.publish({
      type: result.ok ? "delivery.delivered" : "delivery.failed",
      at: new Date().toISOString(),
      data: {
        ...current,
        adapterResult: result,
      },
    });

    return current;
  } catch (error) {
    current = sessionStore.updateOutboundDelivery({
      deliveryId: current.id,
      status: "failed",
      responseSummary: error instanceof Error ? error.message : String(error),
      deliveredAt: null,
    });
    context.eventBus.publish({
      type: "delivery.failed",
      at: new Date().toISOString(),
      data: current,
    });
    return current;
  }
}

async function retryPendingDeliveries(input: {
  readonly storageRoot?: string;
  readonly eventBus: GatewayEventBus;
  readonly adapterRegistry: RouteAdapterRegistry;
}): Promise<void> {
  const sessionStore = new SqliteSessionStore(input.storageRoot);
  try {
    sessionStore.initialize();
    const deliveries = sessionStore.listOutboundDeliveries({
      status: "failed",
      limit: 100,
    });

    for (const delivery of deliveries) {
      const route = sessionStore.getRoute(delivery.routeId);
      if (!route || route.status !== "active") {
        continue;
      }
      const retryPolicy = resolveRouteRetryPolicy(route);
      if (!retryPolicy.enabled || delivery.attemptCount >= retryPolicy.maxAttempts) {
        continue;
      }
      if (delivery.lastAttemptAt) {
        const elapsed = Date.now() - new Date(delivery.lastAttemptAt).getTime();
        if (elapsed < retryPolicy.delayMs) {
          continue;
        }
      }
      await attemptDelivery(
        {
          adapterRegistry: input.adapterRegistry,
          eventBus: input.eventBus,
        },
        sessionStore,
        route,
        delivery,
      );
    }
  } finally {
    sessionStore.close();
  }
}

async function retryDeliveryById(
  context: Pick<GatewayRuntimeContext, "adapterRegistry" | "eventBus" | "options">,
  deliveryId: string,
): Promise<{ readonly route: Record<string, unknown>; readonly delivery: Record<string, unknown> }> {
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const delivery = sessionStore.getOutboundDelivery(deliveryId);
    if (!delivery) {
      throw new Error(`Outbound delivery ${deliveryId} was not found.`);
    }
    const route = sessionStore.getRoute(delivery.routeId);
    if (!route) {
      throw new Error(`Route ${delivery.routeId} for delivery ${deliveryId} was not found.`);
    }
    if (route.status !== "active") {
      throw new Error(`Route ${route.id} is ${route.status} and cannot retry delivery ${deliveryId}.`);
    }
    const retried = await attemptDelivery(
      {
        adapterRegistry: context.adapterRegistry,
        eventBus: context.eventBus,
      },
      sessionStore,
      route,
      delivery,
      { manualRetry: true, requestedAt: new Date().toISOString() },
    );
    return {
      route: presentRoute(route),
      delivery: presentOutboundDelivery(retried, route),
    };
  } finally {
    sessionStore.close();
  }
}

async function ingestPolledRouteMessage(input: {
  readonly context: GatewayRuntimeContext;
  readonly sessionStore: SqliteSessionStore;
  readonly route: ChannelRouteRecord;
  readonly channelMessageId: string;
  readonly sender: string | null;
  readonly text: string;
  readonly metadata?: Record<string, unknown>;
}): Promise<void> {
  if (input.sessionStore.findInboundMessageByChannelMessage(input.route.id, input.channelMessageId)) {
    return;
  }
  const workspace = input.sessionStore.getWorkspace(input.route.workspaceId);
  if (!workspace) {
    return;
  }

  const metadata = normalizeMetadataPayload(input.metadata);
  const inboundMessage = input.sessionStore.createInboundMessage({
    routeId: input.route.id,
    workspaceId: input.route.workspaceId,
    threadId: input.route.threadId,
    channelType: input.route.channelType,
    channelKey: input.route.channelKey,
    channelMessageId: input.channelMessageId,
    sender: input.sender,
    text: input.text,
    metadata,
    status: "queued",
  });
  const payload: Record<string, unknown> = {
    cwd: workspace.cwd,
    sender: input.sender,
    text: input.text,
    channelMessageId: input.channelMessageId,
    metadata,
    async: true,
  };
  const senderPolicy = await enforceRouteSenderPolicy(
    input.context,
    input.route,
    inboundMessage,
    payload,
  );
  if (!senderPolicy.authorized) {
    return;
  }
  input.context.eventBus.publish({
    type: "inbox.received",
    at: new Date().toISOString(),
    data: inboundMessage,
  });
  await dispatchTriggeredInboundAutomations(input.context, input.route, inboundMessage);
  await dispatchInboundRouteMessage(
    input.context,
    input.route,
    inboundMessage,
    payload,
    true,
  );
}

async function pollTelegramRoutes(input: {
  readonly context: GatewayRuntimeContext;
  readonly offsets: Map<string, number>;
}): Promise<void> {
  const sessionStore = new SqliteSessionStore(input.context.options.storageRoot);
  try {
    sessionStore.initialize();
    const routes = sessionStore
      .listRoutes()
      .filter((route) => route.status === "active" && route.adapterType === "telegram" && route.channelType === "telegram");
    const routeGroups = groupTelegramRoutes(routes);

    for (const group of routeGroups) {
      const offsetKey = `${group.baseUrl}|${group.botToken}`;
      const updates = await fetchTelegramUpdates(group.baseUrl, group.botToken, input.offsets.get(offsetKey));
        if (updates.length === 0) {
          continue;
        }

        input.offsets.set(offsetKey, Math.max(...updates.map((update) => update.updateId)) + 1);
        for (const update of updates) {
          const message = update.message;
          if (!message?.text) {
            continue;
          }
          const chatId = String(message.chatId);
          const route = group.routes.find((entry) => String(entry.channelKey) === chatId);
          if (!route) {
            continue;
          }
          await ingestPolledRouteMessage({
            context: input.context,
            sessionStore,
            route,
            channelMessageId: String(message.messageId),
            sender: message.sender,
            text: message.text,
            metadata: {
              replyToMessageId: String(message.messageId),
            },
          });
        }
      }
    } catch {
      // Keep polling best-effort; route-specific failures are surfaced through delivery and inbox state.
    } finally {
      sessionStore.close();
    }
  }

async function pollSlackRoutes(input: {
  readonly context: GatewayRuntimeContext;
  readonly offsets: Map<string, string>;
}): Promise<void> {
  const sessionStore = new SqliteSessionStore(input.context.options.storageRoot);
  try {
    sessionStore.initialize();
    const routes = sessionStore
      .listRoutes()
      .filter((route) => route.status === "active" && route.adapterType === "slack" && route.channelType === "slack");

    for (const route of routes) {
      const botToken = typeof route.adapterConfig.botToken === "string" ? route.adapterConfig.botToken : "";
      if (!botToken) {
        continue;
      }
      const baseUrl = typeof route.adapterConfig.baseUrl === "string"
        ? route.adapterConfig.baseUrl
        : "https://slack.com/api";
      const channelId = String(route.adapterConfig.channelId ?? route.channelKey ?? "").trim();
      if (!channelId) {
        continue;
      }

      const messages = await fetchSlackMessages({
        baseUrl,
        botToken,
        channelId,
        oldest: input.offsets.get(route.id),
        botUserId: typeof route.adapterConfig.botUserId === "string" ? route.adapterConfig.botUserId : null,
      });
      if (messages.length === 0) {
        continue;
      }

      input.offsets.set(route.id, messages[messages.length - 1]?.ts ?? input.offsets.get(route.id) ?? "");
      for (const message of messages) {
        await ingestPolledRouteMessage({
          context: input.context,
          sessionStore,
          route,
          channelMessageId: message.ts,
          sender: message.sender,
          text: message.text,
          metadata: {
            threadTs: message.threadTs ?? message.ts,
          },
        });
      }
    }
  } catch {
    // Keep polling best-effort; route-specific failures are surfaced through delivery and inbox state.
  } finally {
    sessionStore.close();
  }
}

async function pollDiscordRoutes(input: {
  readonly context: GatewayRuntimeContext;
  readonly offsets: Map<string, string>;
}): Promise<void> {
  const sessionStore = new SqliteSessionStore(input.context.options.storageRoot);
  try {
    sessionStore.initialize();
    const routes = sessionStore
      .listRoutes()
      .filter((route) => route.status === "active" && route.adapterType === "discord" && route.channelType === "discord");

    for (const route of routes) {
      const botToken = typeof route.adapterConfig.botToken === "string" ? route.adapterConfig.botToken : "";
      if (!botToken) {
        continue;
      }
      const baseUrl = typeof route.adapterConfig.baseUrl === "string"
        ? route.adapterConfig.baseUrl
        : "https://discord.com/api/v10";
      const channelId = String(route.adapterConfig.channelId ?? route.channelKey ?? "").trim();
      if (!channelId) {
        continue;
      }

      const messages = await fetchDiscordMessages({
        baseUrl,
        botToken,
        channelId,
        after: input.offsets.get(route.id),
      });
      if (messages.length === 0) {
        continue;
      }

      input.offsets.set(route.id, messages[messages.length - 1]?.id ?? input.offsets.get(route.id) ?? "");
      for (const message of messages) {
        await ingestPolledRouteMessage({
          context: input.context,
          sessionStore,
          route,
          channelMessageId: message.id,
          sender: message.sender,
          text: message.text,
          metadata: {
            replyToMessageId: message.id,
          },
        });
      }
    }
  } catch {
    // Keep polling best-effort; route-specific failures are surfaced through delivery and inbox state.
  } finally {
    sessionStore.close();
  }
}

async function enqueueControlPlaneRun(
  context: GatewayRuntimeContext,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body = normalizeRouteConfig(payload.request);
  const asyncMode = payload.async !== false;
  const runRequest = normalizeRunRequest(body, context.options);

  if (!asyncMode) {
    const result = await executeGatewayRunRequest(runRequest, {
      eventHandler: async (event) => {
        publishRuntimeEvent(context.eventBus, event);
      },
      modelProfiles: context.options.modelProfiles,
    });
    return { result };
  }

  const requestBody = {
    ...body,
    async: true,
  };
  const job = context.jobStore.create(requestBody, {
    kind: "control-plane-run",
  });
  context.eventBus.publish({
    type: "job.queued",
    at: new Date().toISOString(),
    data: job,
  });
  void executeAsyncJob(context, job, normalizeRunRequest(requestBody, context.options));
  return { accepted: true, job };
}

async function dispatchControlPlaneDelivery(
  context: GatewayRuntimeContext,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const routeId = typeof payload.routeId === "string" ? payload.routeId : "";
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  if (!routeId || !content) {
    throw new Error("route.deliver requires payload.routeId and payload.content.");
  }

  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const route = sessionStore.getRoute(routeId);
    if (!route) {
      throw new Error(`Route ${routeId} was not found.`);
    }
    const delivery = await createAndSendDelivery(context, sessionStore, route, {
      threadId: route.threadId,
      content,
      metadata: {
        source: "control-plane",
      },
    });
    return {
      route: presentRoute(route),
      delivery,
    };
  } finally {
    sessionStore.close();
  }
}

async function retryControlPlaneDelivery(
  context: GatewayRuntimeContext,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const deliveryId = typeof payload.deliveryId === "string" ? payload.deliveryId.trim() : "";
  if (!deliveryId) {
    throw new Error("delivery.retry requires payload.deliveryId.");
  }
  return retryDeliveryById(context, deliveryId);
}

async function dispatchControlPlaneSubagentControl(
  context: GatewayRuntimeContext,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const jobId = typeof payload.jobId === "string" ? payload.jobId.trim() : "";
  const action = normalizeSubagentControlAction(payload.action);
  if (!jobId || !action) {
    throw new Error("subagent.control requires payload.jobId and a supported payload.action.");
  }
  const message = typeof payload.message === "string" ? payload.message : undefined;
  const subagent = await controlSubagentForGateway(context.options.storageRoot, jobId, action, message);
  return { subagent };
}

async function acceptControlPlaneInboundMessage(
  context: GatewayRuntimeContext,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    const route = resolveRouteForInboundMessage(sessionStore, payload, context.options.cwd ?? process.cwd());
    if (!route) {
      throw new Error("No route found for the provided channelType/channelKey or routeId.");
    }

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      throw new Error("Inbound message requires non-empty text.");
    }

    const channelMessageId = typeof payload.channelMessageId === "string" ? payload.channelMessageId : null;
    if (channelMessageId) {
      const existing = sessionStore.findInboundMessageByChannelMessage(route.id, channelMessageId);
      if (existing) {
        return {
          route: presentRoute(route),
          inboundMessage: existing,
          duplicate: true,
        };
      }
    }

      const inboundMessage = sessionStore.createInboundMessage({
        routeId: route.id,
        workspaceId: route.workspaceId,
        threadId: route.threadId,
        channelType: route.channelType,
        channelKey: route.channelKey,
        channelMessageId,
        sender: typeof payload.sender === "string" ? payload.sender : null,
        text,
        metadata: normalizeMetadataPayload(payload.metadata),
        status: "queued",
      });
    const senderPolicy = await enforceRouteSenderPolicy(context, route, inboundMessage, payload);
    if (!senderPolicy.authorized) {
      return {
        route: presentRoute(route),
        inboundMessage,
        pairing: senderPolicy.pairing,
        blocked: true,
      };
    }
    context.eventBus.publish({
      type: "inbox.received",
      at: new Date().toISOString(),
      data: inboundMessage,
    });
    await dispatchTriggeredInboundAutomations(context, route, inboundMessage);
    const dispatched = await dispatchInboundRouteMessage(context, route, inboundMessage, payload, payload.async !== false);
    return {
      route: presentRoute(route),
      inboundMessage,
      ...dispatched,
    };
  } finally {
    sessionStore.close();
  }
}

async function enforceRouteSenderPolicy(
  context: GatewayRuntimeContext,
  route: ChannelRouteRecord,
  inboundMessage: InboundMessageRecord,
  payload: Record<string, unknown>,
): Promise<{ authorized: true } | { authorized: false; pairing: RoutePairingRecord | null }> {
  const sender = typeof payload.sender === "string" ? payload.sender.trim() : inboundMessage.sender?.trim() ?? "";
  const policy = resolveRouteSenderPolicyFromConfig(route);
  if (policy.mode !== "pairing") {
    return { authorized: true };
  }

  if (!sender) {
    return { authorized: true };
  }

  if (policy.allowFrom.includes(sender)) {
    return { authorized: true };
  }

  const sessionStore = new SqliteSessionStore(context.options.storageRoot);
  try {
    sessionStore.initialize();
    sessionStore.updateInboundMessage({
      messageId: inboundMessage.id,
      status: "failed",
    });
    const pairing = sessionStore.createOrRefreshRoutePairing({
      routeId: route.id,
      workspaceId: route.workspaceId,
      sender,
      channelType: route.channelType,
      channelKey: route.channelKey,
      code: generatePairingCode(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });
    context.eventBus.publish({
      type: "pairing.requested",
      at: new Date().toISOString(),
      data: pairing,
    });
    await createAndSendDelivery(context, sessionStore, route, {
      threadId: route.threadId,
      content: buildPairingChallengeMessage(route, sender, pairing.code),
      metadata: {
        ...buildInboundDeliveryMetadata(inboundMessage, "pairing"),
        pairingId: pairing.id,
        sender,
      },
    });
    return {
      authorized: false,
      pairing,
    };
  } finally {
    sessionStore.close();
  }
}

function allowRouteSender(
  sessionStore: SqliteSessionStore,
  route: ChannelRouteRecord,
  sender: string,
): ChannelRouteRecord {
  const policy = resolveRouteSenderPolicyFromConfig(route);
  if (policy.allowFrom.includes(sender)) {
    return route;
  }
  return sessionStore.updateRoute({
    routeId: route.id,
    adapterConfig: {
      ...route.adapterConfig,
      allowFrom: [...policy.allowFrom, sender],
    },
  });
}

function generatePairingCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function buildPairingChallengeMessage(route: ChannelRouteRecord, sender: string, code: string): string {
  return [
    `Pairing required for ${route.title}.`,
    `Sender: ${sender}`,
    `Approval code: ${code}`,
    "Approve this sender with POST /pairings/approve or the CLI pairing-approve command.",
  ].join("\n");
}

function normalizeMetadataPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function normalizeEnterpriseInboundPayload(
  channelType: string,
  body: Record<string, unknown>,
): {
  readonly routeId: string | null;
  readonly channelKey: string;
  readonly channelMessageId: string | null;
  readonly sender: string | null;
  readonly text: string;
  readonly metadata: Record<string, unknown>;
} {
  const event = body.event && typeof body.event === "object" && !Array.isArray(body.event)
    ? (body.event as Record<string, unknown>)
    : {};
  const message = event.message && typeof event.message === "object" && !Array.isArray(event.message)
    ? (event.message as Record<string, unknown>)
    : {};
  const conversation = body.conversation && typeof body.conversation === "object" && !Array.isArray(body.conversation)
    ? (body.conversation as Record<string, unknown>)
    : {};
  const text =
    firstNonEmptyString(
      body.text,
      body.content,
      message.text,
      message.content,
      event.text,
      conversation.text,
    ) ?? "";
  if (!text.trim()) {
    throw new Error(`${channelType} inbound webhook requires non-empty text content.`);
  }
  return {
    routeId: firstNonEmptyString(body.routeId) ?? null,
    channelKey:
      firstNonEmptyString(
        body.channelKey,
        body.deviceId,
        body.chatId,
        body.open_chat_id,
        body.conversationId,
        event.chat_id,
        event.conversation_id,
        message.chat_id,
        conversation.id,
      ) ?? channelType,
    channelMessageId:
      firstNonEmptyString(body.channelMessageId, body.messageId, body.msgId, event.message_id, message.message_id) ??
      null,
    sender:
      firstNonEmptyString(
        body.sender,
        body.senderId,
        body.deviceId,
        body.open_id,
        event.sender_id,
        event.sender,
        message.sender_id,
        conversation.from,
      ) ?? null,
    text: text.trim(),
    metadata: {
      rawProvider: channelType,
      rawEventType: firstNonEmptyString(body.type, body.eventType, event.type) ?? null,
      rawPayloadKeys: Object.keys(body).sort(),
    },
  };
}

function analyzeInboundSecurity(
  text: string,
  signatureVerified: boolean,
  channel: ReturnType<typeof getChannelCapability>,
): { readonly riskLevel: "high" | "low" | "medium"; readonly flags: string[]; readonly signatureVerified: boolean } {
  const flags: string[] = [];
  if (channel.requiresSignatureVerification && !signatureVerified) {
    flags.push("signature_unverified");
  }
  if (/ignore (all )?(previous|prior) instructions/i.test(text) || /system prompt/i.test(text)) {
    flags.push("prompt_injection_language");
  }
  if (/https?:\/\/(127\.0\.0\.1|localhost|169\.254\.169\.254)/i.test(text)) {
    flags.push("ssrf_target");
  }
  if (/(api[_-]?key|token|password|secret)/i.test(text) && /(send|exfiltrate|print|show)/i.test(text)) {
    flags.push("credential_exfiltration_request");
  }
  return {
    riskLevel: flags.includes("signature_unverified") || flags.includes("credential_exfiltration_request")
      ? "high"
      : flags.length > 0
        ? "medium"
        : "low",
    flags,
    signatureVerified,
  };
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (value !== null && value !== undefined && typeof value !== "object") {
      const normalized = String(value).trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

function buildInboundDeliveryMetadata(
  inboundMessage: InboundMessageRecord,
  source: "inbox" | "pairing",
): Record<string, unknown> {
  const metadata = normalizeMetadataPayload(inboundMessage.metadata);
  const replyMetadata: Record<string, unknown> = {};
  if (typeof metadata.threadTs === "string" && metadata.threadTs.trim().length > 0) {
    replyMetadata.threadTs = metadata.threadTs.trim();
  }
  if (typeof metadata.replyToMessageId === "string" && metadata.replyToMessageId.trim().length > 0) {
    replyMetadata.replyToMessageId = metadata.replyToMessageId.trim();
  }
  if (
    (typeof metadata.replyToMessageId === "number" && Number.isFinite(metadata.replyToMessageId)) ||
    typeof metadata.replyToMessageId === "bigint"
  ) {
    replyMetadata.replyToMessageId = String(metadata.replyToMessageId);
  }
  return {
    ...replyMetadata,
    source,
    inboundMessageId: inboundMessage.id,
  };
}

function buildPlatformHint(route: ChannelRouteRecord): string | null {
  if (route.channelType === "slack") {
    return "Slack supports mrkdwn formatting and threaded replies. Keep responses compact and channel-friendly.";
  }
  if (route.channelType === "discord") {
    return "Discord supports markdown, code fences, and direct replies to a specific message. Prefer concise summaries.";
  }
  if (route.channelType === "telegram") {
    const parseMode =
      typeof route.adapterConfig.parseMode === "string" && route.adapterConfig.parseMode.trim().length > 0
        ? route.adapterConfig.parseMode.trim()
        : "plain text";
    return `Telegram formatting should stay conservative unless parse mode ${parseMode} is clearly appropriate.`;
  }
  return null;
}

function updateAutomationStatus(
  automationId: string,
  status: "active" | "paused",
  storageRoot?: string,
): AutomationRecord | null {
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    const automation = sessionStore.getAutomation(automationId);
    if (!automation) {
      return null;
    }
    const usesIntervalClock = automation.scheduleKind === "interval" || automation.scheduleKind === "heartbeat";
    return sessionStore.updateAutomationState({
      automationId,
      status,
      deliveryState: status === "paused" ? "idle" : automation.deliveryState === "dead_letter" ? "idle" : automation.deliveryState,
      consecutiveFailures: automation.consecutiveFailures,
      nextRunAt:
        status === "active" && usesIntervalClock && automation.intervalSeconds
          ? new Date(Date.now() + automation.intervalSeconds * 1000).toISOString()
          : null,
      cooldownUntil: status === "paused" ? null : automation.cooldownUntil,
    });
  } finally {
    sessionStore.close();
  }
}

function resetAutomationState(automationId: string, storageRoot?: string): AutomationRecord | null {
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    const automation = sessionStore.getAutomation(automationId);
    if (!automation) {
      return null;
    }
    const usesIntervalClock = automation.scheduleKind === "interval" || automation.scheduleKind === "heartbeat";
    return sessionStore.updateAutomationState({
      automationId,
      deliveryState: "idle",
      failureCount: 0,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastError: null,
      cooldownUntil: null,
      deadLetteredAt: null,
      nextRunAt:
        automation.status === "active" && usesIntervalClock && automation.intervalSeconds
          ? new Date(Date.now() + automation.intervalSeconds * 1000).toISOString()
          : null,
    });
  } finally {
    sessionStore.close();
  }
}

function deleteAutomation(automationId: string, storageRoot?: string): boolean {
  const sessionStore = new SqliteSessionStore(storageRoot);
  try {
    sessionStore.initialize();
    return sessionStore.deleteAutomation(automationId);
  } finally {
    sessionStore.close();
  }
}

function buildInboundRunRequest(
  route: ChannelRouteRecord,
  inboundMessage: InboundMessageRecord,
  body: Record<string, unknown>,
  defaults: GatewayRuntimeDefaults,
): NormalizedGatewayRunRequest {
  const cwd = String(body.cwd ?? defaults.cwd ?? process.cwd());
  const sender = inboundMessage.sender ?? "unknown sender";
    const prompt =
      typeof body.task === "string" && body.task.trim().length > 0
        ? body.task.trim()
        : [
            `Handle the inbound ${route.channelType} message for route ${route.title}.`,
            `Sender: ${sender}`,
            `Channel key: ${route.channelKey}`,
            buildPlatformHint(route),
            "Message:",
            inboundMessage.text,
          ].join("\n");

  return normalizeRunRequest(
    {
      ...body,
      agentId: typeof body.agentId === "string" && body.agentId.trim().length > 0 ? body.agentId.trim() : route.agentId ?? undefined,
      routeId: route.id,
      channelType: route.channelType,
      channelKey: route.channelKey,
      channelId:
        typeof route.adapterConfig.channelId === "string" && route.adapterConfig.channelId.trim().length > 0
          ? route.adapterConfig.channelId.trim()
          : undefined,
      task: prompt,
      cwd,
      threadTitle: typeof body.threadTitle === "string" ? body.threadTitle : route.title,
      threadId: route.threadId ?? undefined,
      continueLatest: route.threadId ? false : true,
    },
    defaults,
  );
}

function resolveRouteForInboundMessage(
  sessionStore: SqliteSessionStore,
  body: Record<string, unknown>,
  defaultCwd: string,
): ChannelRouteRecord | null {
  const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
  if (routeId) {
    return sessionStore.getRoute(routeId);
  }

  const channelType = typeof body.channelType === "string" ? body.channelType.trim() : "";
  const channelKey = typeof body.channelKey === "string" ? body.channelKey.trim() : "";
  if (!channelType || !channelKey) {
    return null;
  }

  const existing = sessionStore.findRouteByChannel(channelType, channelKey);
  if (existing) {
    return existing;
  }

  return createRouteRecord(sessionStore, body, defaultCwd);
}

function createRouteRecord(
  sessionStore: SqliteSessionStore,
  body: Record<string, unknown>,
  defaultCwd: string,
): ChannelRouteRecord {
  const agentId = typeof body.agentId === "string" && body.agentId.trim().length > 0 ? body.agentId.trim() : null;
  const preparedRoute = prepareRouteDefinition({
    threadId: typeof body.threadId === "string" ? body.threadId : null,
    title: typeof body.title === "string" ? body.title : null,
    channelType: String(body.channelType ?? ""),
    channelKey: String(body.channelKey ?? ""),
    adapterType: body.adapterType,
    adapterConfig: body.adapterConfig,
    inboundSecret: typeof body.inboundSecret === "string" ? body.inboundSecret : null,
    status: body.status,
  });
  const agent = agentId ? sessionStore.getAgent(agentId) : null;
  if (agentId && !agent) {
    throw new Error(`Agent ${agentId} was not found.`);
  }
  const cwd = agent?.cwd ?? (typeof body.cwd === "string" && body.cwd.trim().length > 0 ? body.cwd : defaultCwd);
  const workspace =
    agent?.workspaceId ? sessionStore.getWorkspace(agent.workspaceId) ?? sessionStore.upsertWorkspace(cwd) : sessionStore.upsertWorkspace(cwd);
  return sessionStore.createRoute({
    workspaceId: workspace.id,
    agentId: agent?.id ?? null,
    threadId: preparedRoute.threadId,
    title: preparedRoute.title,
    channelType: preparedRoute.channelType,
    channelKey: preparedRoute.channelKey,
    adapterType: preparedRoute.adapterType,
    adapterConfig: preparedRoute.adapterConfig,
    inboundSecret: preparedRoute.inboundSecret,
    status: preparedRoute.status,
  });
}

function publishRuntimeEvent(eventBus: GatewayEventBus, event: AgentRuntimeEvent): void {
  const acp = projectRuntimeEventToAcpEvent(event);
  eventBus.publish({
    type: event.type,
    at: event.at,
    data: acp ? { ...event, acp } : event,
  });
}

function openEventStream(eventBus: GatewayEventBus, response: ServerResponse, request: IncomingMessage): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ ok: true, now: new Date().toISOString() })}\n\n`);
  const unsubscribe = eventBus.subscribe((event) => {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(presentGatewayEventWithAcpProjection(event))}\n\n`);
  });
  request.on("close", () => {
    unsubscribe();
    response.end();
  });
}

function resolveBaseUrl(server: HttpServer): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    return "http://127.0.0.1";
  }
  return `http://127.0.0.1:${address.port}`;
}

function resolveGatewayStorageRoot(storageRoot?: string): string {
  return resolve(storageRoot ?? join(homedir(), ".omni-agent"));
}

function trimTrailingSlash(value: string): string {
  if (value.length > 1 && value.endsWith("/")) {
    return value.slice(0, -1);
  }
  return value;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    if (chunks.reduce((sum, entry) => sum + entry.length, 0) > 1_000_000) {
      throw new Error("Request body exceeds the 1MB limit.");
    }
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) {
    return {};
  }
  return JSON.parse(body);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body, "utf8"),
  });
  response.end(body);
}

function sendHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html, "utf8"),
  });
  response.end(html);
}

function parsePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function sanitizeFileStem(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "learned-skill";
}

function parseSubagentStatusFilter(value: readonly string[]): Array<
  "cancelled" | "completed" | "failed" | "interrupted" | "paused" | "queued" | "running" | "timed_out"
> {
  return Array.from(
    new Set(
      value
        .flatMap((entry) => entry.split(","))
        .map((entry) => entry.trim())
        .filter(
          (
            entry,
          ): entry is "cancelled" | "completed" | "failed" | "interrupted" | "paused" | "queued" | "running" | "timed_out" =>
            entry === "cancelled" ||
            entry === "completed" ||
            entry === "failed" ||
            entry === "interrupted" ||
            entry === "paused" ||
            entry === "queued" ||
            entry === "running" ||
            entry === "timed_out",
        ),
    ),
  );
}

function parseAgentStatusFilter(value: readonly string[]): Array<"active" | "paused"> {
  return Array.from(
    new Set(
      value
        .flatMap((entry) => entry.split(","))
        .map((entry) => entry.trim())
        .filter((entry): entry is "active" | "paused" => entry === "active" || entry === "paused"),
    ),
  );
}

function parseAuthProfileStatusFilter(value: readonly string[]): AuthProfileHealthStatus[] {
  return Array.from(
    new Set(
      value
        .flatMap((entry) => entry.split(","))
        .map((entry) => entry.trim())
        .filter((entry): entry is AuthProfileHealthStatus =>
          entry === "healthy" || entry === "cooldown" || entry === "disabled"),
    ),
  );
}

function normalizeAgentDefaultRole(value: unknown):
  | "primary"
  | "planner"
  | "researcher"
  | "reviewer"
  | "verifier"
  | "worker"
  | "executor"
  | "supervisor"
  | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  switch (normalized) {
    case "primary":
    case "planner":
    case "researcher":
    case "reviewer":
    case "verifier":
    case "worker":
    case "executor":
    case "supervisor":
      return normalized as
        | "primary"
        | "planner"
        | "researcher"
        | "reviewer"
        | "verifier"
        | "worker"
        | "executor"
        | "supervisor";
    default:
      return null;
  }
}

function resolveAgentCapabilityProfileRequest(value: unknown): AgentCapabilityProfile | null | false {
  if (value === undefined || value === null) {
    return null;
  }
  const profileId = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!profileId) {
    return null;
  }
  return getAgentCapabilityProfile(profileId) ?? false;
}

function buildAgentMetadataForCapabilityProfile(
  metadata: Record<string, unknown> | undefined,
  profile: AgentCapabilityProfile | null,
): Record<string, unknown> | undefined {
  if (!profile) {
    return metadata;
  }
  return {
    ...(metadata ?? {}),
    capabilityProfileId: profile.id,
    capabilityProfileLabel: profile.label,
    capabilityProfile: {
      id: profile.id,
      label: profile.label,
      alignedProjects: [...profile.alignedProjects],
      recommendedPlaybookIds: [...profile.recommendedPlaybookIds],
    },
  };
}

function buildAgentMetadataUpdateForCapabilityProfile(
  currentMetadata: Readonly<Record<string, unknown>>,
  body: Record<string, unknown>,
  profileDirective: AgentCapabilityProfile | null | undefined,
): Record<string, unknown> | undefined {
  const hasMetadata = Object.prototype.hasOwnProperty.call(body, "metadata");
  if (!hasMetadata && profileDirective === undefined) {
    return undefined;
  }
  const base =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? { ...(body.metadata as Record<string, unknown>) }
      : body.metadata === null
        ? {}
        : { ...currentMetadata };
  if (profileDirective === undefined) {
    return base;
  }
  if (profileDirective === null) {
    delete base.capabilityProfileId;
    delete base.capabilityProfileLabel;
    delete base.capabilityProfile;
    return base;
  }
  return buildAgentMetadataForCapabilityProfile(base, profileDirective) ?? base;
}

function readAgentCapabilityProfileId(metadata: Readonly<Record<string, unknown>> | null | undefined): string | null {
  if (!metadata) {
    return null;
  }
  const direct = metadata.capabilityProfileId;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  const nested = metadata.capabilityProfile;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedId = (nested as Record<string, unknown>).id;
    return typeof nestedId === "string" && nestedId.trim() ? nestedId.trim() : null;
  }
  return null;
}

function mergeRuntimeToolPolicies(
  base: RuntimeToolPolicy | undefined,
  overlay: RuntimeToolPolicy | undefined,
): RuntimeToolPolicy | undefined {
  if (!base && !overlay) {
    return undefined;
  }
  return {
    ...(base ?? {}),
    ...(overlay ?? {}),
    global: mergeOptionalToolPolicyRules(base?.global, overlay?.global),
    runtime: mergeOptionalToolPolicyRules(base?.runtime, overlay?.runtime),
    authProfiles: mergeToolPolicyRuleMap(base?.authProfiles, overlay?.authProfiles),
    executionDomains: mergeToolPolicyRuleMap(base?.executionDomains, overlay?.executionDomains),
    providers: mergeToolPolicyRuleMap(base?.providers, overlay?.providers),
    profiles: mergeToolPolicyRuleMap(base?.profiles, overlay?.profiles),
    sessions: mergeToolPolicyRuleMap(base?.sessions, overlay?.sessions),
    routes: mergeToolPolicyRuleMap(base?.routes, overlay?.routes),
    channels: mergeToolPolicyRuleMap(base?.channels, overlay?.channels),
    agents: mergeToolPolicyRuleMap(base?.agents, overlay?.agents),
    roles: mergeToolPolicyRuleMap(base?.roles, overlay?.roles),
    subagents: mergeToolPolicyRuleMap(base?.subagents, overlay?.subagents),
  };
}

function mergeToolPolicyRuleMap<TKey extends string>(
  base: Readonly<Partial<Record<TKey, ToolPolicyRule>>> | undefined,
  overlay: Readonly<Partial<Record<TKey, ToolPolicyRule>>> | undefined,
): Record<TKey, ToolPolicyRule> | undefined {
  if (!base && !overlay) {
    return undefined;
  }
  const merged = {} as Record<TKey, ToolPolicyRule>;
  for (const key of Object.keys(base ?? {}) as TKey[]) {
    const rule = base?.[key];
    if (rule) {
      merged[key] = rule;
    }
  }
  for (const key of Object.keys(overlay ?? {}) as TKey[]) {
    merged[key] = mergeToolPolicyRules(base?.[key], overlay?.[key]);
  }
  return merged;
}

function mergeToolPolicyRules(
  base: ToolPolicyRule | undefined,
  overlay: ToolPolicyRule | undefined,
): ToolPolicyRule {
  const allowTools = mergeStringArrayValues(base?.allowTools, overlay?.allowTools);
  const denyTools = mergeStringArrayValues(base?.denyTools, overlay?.denyTools);
  const merged: { allowTools?: readonly string[]; denyTools?: readonly string[] } = {};
  if (allowTools) {
    merged.allowTools = allowTools;
  }
  if (denyTools) {
    merged.denyTools = denyTools;
  }
  return merged;
}

function mergeOptionalToolPolicyRules(
  base: ToolPolicyRule | undefined,
  overlay: ToolPolicyRule | undefined,
): ToolPolicyRule | undefined {
  if (!base && !overlay) {
    return undefined;
  }
  return mergeToolPolicyRules(base, overlay);
}

function mergeStringArrayValues(
  first: readonly string[] | undefined,
  second: readonly string[] | undefined,
): string[] | undefined {
  const merged = Array.from(new Set([...(first ?? []), ...(second ?? [])].map((entry) => entry.trim()).filter(Boolean)));
  return merged.length > 0 ? merged : undefined;
}

function normalizeStringArrayBody(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = Array.from(new Set(value.map((entry) => String(entry).trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : [];
}

function parseLeaseStatusFilter(value: readonly string[]): Array<"active" | "released"> {
  return Array.from(
    new Set(
      value
        .flatMap((entry) => entry.split(","))
        .map((entry) => entry.trim())
        .filter((entry): entry is "active" | "released" => entry === "active" || entry === "released"),
    ),
  );
}

function parseBooleanQueryParam(value: string | null): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

function normalizeMemorySearchBackend(value: string | null): "both" | "file" | "store" {
  if (value === "both" || value === "file" || value === "store") {
    return value;
  }
  return "both";
}

function normalizeMemoryPersistenceBackend(value: unknown): "both" | "file" | "store" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "both" || normalized === "file" || normalized === "store") {
    return normalized;
  }
  return "store";
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

function buildGatewayFileBackedMemoryRecord(input: {
  readonly cwd: string;
  readonly agentId: string | null;
  readonly content: string;
  readonly scope: "thread" | "workspace";
  readonly threadId: string | null;
  readonly tags: string[];
  readonly fileKind: WorkspaceMemoryFileKind;
  readonly fileRecord: unknown;
}): {
  readonly id: string;
  readonly workspaceId: string;
  readonly agentId: string | null;
  readonly threadId: string | null;
  readonly scope: "thread" | "workspace";
  readonly content: string;
  readonly tags: string[];
  readonly createdAt: null;
  readonly updatedAt: null;
  readonly source: "file";
  readonly path: string;
  readonly kind: WorkspaceMemoryFileKind;
} {
  const fileRecord = input.fileRecord && typeof input.fileRecord === "object" && !Array.isArray(input.fileRecord)
    ? (input.fileRecord as { path?: string })
    : {};
  const path = typeof fileRecord.path === "string"
    ? fileRecord.path
    : input.fileKind === "memory"
      ? "MEMORY.md"
      : input.fileKind === "user"
        ? "USER.md"
        : join("memory", `${new Date().toISOString().slice(0, 10)}.md`);
  return {
    id: `file:${path}`,
    workspaceId: input.cwd,
    agentId: input.agentId,
    threadId: input.scope === "thread" ? input.threadId : null,
    scope: input.scope,
    content: input.content,
    tags: ["file-backed", input.fileKind, ...input.tags],
    createdAt: null,
    updatedAt: null,
    source: "file",
    path,
    kind: input.fileKind,
  };
}

function normalizeInboundStatus(value: string | null): "failed" | "processed" | "processing" | "queued" | null {
  return value === "failed" || value === "processed" || value === "processing" || value === "queued" ? value : null;
}

function normalizeDeliveryStatus(
  value: string | null,
): "acknowledged" | "dead_letter" | "delivered" | "failed" | "queued" | "retrying" | "sending" | "sent" | null {
  switch (value) {
    case "acknowledged":
    case "dead_letter":
    case "delivered":
    case "failed":
    case "queued":
    case "retrying":
    case "sending":
    case "sent":
      return value;
    default:
      return null;
  }
}

function normalizeSubagentControlAction(value: unknown): "cancel" | "interrupt" | "message" | "pause" | "resume" | null {
  return value === "cancel" || value === "interrupt" || value === "message" || value === "pause" || value === "resume"
    ? value
    : null;
}

function normalizePairingStatus(value: string | null): "approved" | "pending" | "rejected" | null {
  return value === "approved" || value === "pending" || value === "rejected" ? value : null;
}

function normalizeAdapterType(value: unknown): "console" | "discord" | "filesystem" | "slack" | "telegram" | "webhook" {
  return value === "discord" || value === "filesystem" || value === "slack" || value === "telegram" || value === "webhook"
    ? value
    : "console";
}

function normalizeRouteConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizePromptArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function resolveRouteRetryPolicy(route: ChannelRouteRecord): {
  readonly enabled: boolean;
  readonly maxAttempts: number;
  readonly delayMs: number;
} {
  const retry = route.adapterConfig.retry;
  const retryConfig =
    retry && typeof retry === "object" && !Array.isArray(retry) ? (retry as Record<string, unknown>) : {};
  const enabled = route.adapterType !== "console" && retryConfig.enabled !== false;
  const maxAttempts = parsePositiveNumber(retryConfig.maxAttempts, 3);
  const delayMs = parsePositiveNumber(retryConfig.delayMs, 5_000);
  return { enabled, maxAttempts, delayMs };
}

function groupTelegramRoutes(routes: ChannelRouteRecord[]): Array<{
  readonly baseUrl: string;
  readonly botToken: string;
  readonly routes: ChannelRouteRecord[];
}> {
  const groups = new Map<string, { baseUrl: string; botToken: string; routes: ChannelRouteRecord[] }>();
  for (const route of routes) {
    const botToken = typeof route.adapterConfig.botToken === "string" ? route.adapterConfig.botToken : "";
    if (!botToken) {
      continue;
    }
    const baseUrl = typeof route.adapterConfig.baseUrl === "string"
      ? route.adapterConfig.baseUrl
      : "https://api.telegram.org";
    const key = `${baseUrl}|${botToken}`;
    const existing = groups.get(key);
    if (existing) {
      existing.routes.push(route);
      continue;
    }
    groups.set(key, {
      baseUrl,
      botToken,
      routes: [route],
    });
  }
  return Array.from(groups.values());
}

async function fetchTelegramUpdates(
  baseUrl: string,
  botToken: string,
  offset: number | undefined,
): Promise<Array<{
  readonly updateId: number;
  readonly message?: {
    readonly messageId: number;
    readonly chatId: string | number;
    readonly text: string;
    readonly sender: string | null;
  };
}>> {
  const url = buildTelegramApiUrl(baseUrl, botToken, "getUpdates");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      offset,
      timeout: 0,
      allowed_updates: ["message"],
    }),
  });
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json()) as {
    ok?: boolean;
    result?: Array<{
      update_id?: number;
      message?: {
        message_id?: number;
        text?: string;
        chat?: { id?: string | number };
        from?: { username?: string; first_name?: string; last_name?: string };
      };
    }>;
  };
  if (!payload.ok || !Array.isArray(payload.result)) {
    return [];
  }
  return payload.result
      .map((entry) => ({
        updateId: Number(entry.update_id ?? 0),
        message:
          entry.message?.text && entry.message.chat?.id !== undefined && entry.message.message_id !== undefined
            ? {
              messageId: Number(entry.message.message_id),
              chatId: entry.message.chat.id,
              text: entry.message.text,
              sender: [
                entry.message.from?.username,
                entry.message.from?.first_name,
                entry.message.from?.last_name,
              ]
                .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
                .join(" ")
                || null,
            }
          : undefined,
      }))
      .filter((entry) => Number.isFinite(entry.updateId) && entry.updateId > 0);
}

async function fetchSlackMessages(input: {
  readonly baseUrl: string;
  readonly botToken: string;
  readonly channelId: string;
  readonly oldest?: string;
  readonly botUserId?: string | null;
}): Promise<Array<{
  readonly ts: string;
  readonly text: string;
  readonly sender: string | null;
  readonly threadTs: string | null;
}>> {
  const url = new URL(buildApiUrl(input.baseUrl, "conversations.history"));
  url.searchParams.set("channel", input.channelId);
  url.searchParams.set("limit", "20");
  if (input.oldest) {
    url.searchParams.set("oldest", input.oldest);
    url.searchParams.set("inclusive", "false");
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${input.botToken}`,
    },
  });
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    messages?: Array<{
      ts?: string;
      text?: string;
      user?: string;
      username?: string;
      bot_id?: string;
      subtype?: string;
      thread_ts?: string;
    }>;
  };
  if (!payload.ok || !Array.isArray(payload.messages)) {
    return [];
  }

  return payload.messages
    .filter((message) => typeof message.ts === "string" && typeof message.text === "string" && message.text.trim().length > 0)
    .filter((message) => !message.bot_id && !message.subtype)
    .filter((message) => !input.botUserId || message.user !== input.botUserId)
    .map((message) => ({
      ts: message.ts as string,
      text: (message.text as string).trim(),
      sender:
        typeof message.user === "string" && message.user.trim().length > 0
          ? message.user.trim()
          : typeof message.username === "string" && message.username.trim().length > 0
            ? message.username.trim()
            : null,
      threadTs: typeof message.thread_ts === "string" ? message.thread_ts : null,
    }))
    .sort((left, right) => compareSlackTimestamps(left.ts, right.ts));
}

async function fetchDiscordMessages(input: {
  readonly baseUrl: string;
  readonly botToken: string;
  readonly channelId: string;
  readonly after?: string;
}): Promise<Array<{
  readonly id: string;
  readonly text: string;
  readonly sender: string | null;
}>> {
  const url = new URL(buildApiUrl(input.baseUrl, `channels/${input.channelId}/messages`));
  url.searchParams.set("limit", "25");
  if (input.after) {
    url.searchParams.set("after", input.after);
  }

  const response = await fetch(url, {
    headers: {
      authorization: `Bot ${input.botToken}`,
    },
  });
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as Array<{
    id?: string;
    content?: string;
    author?: { username?: string; global_name?: string; bot?: boolean };
    type?: number;
  }>;
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .filter((message) => typeof message.id === "string" && typeof message.content === "string" && message.content.trim().length > 0)
    .filter((message) => !message.author?.bot)
    .map((message) => ({
      id: message.id as string,
      text: (message.content as string).trim(),
      sender:
        typeof message.author?.global_name === "string" && message.author.global_name.trim().length > 0
          ? message.author.global_name.trim()
          : typeof message.author?.username === "string" && message.author.username.trim().length > 0
            ? message.author.username.trim()
            : null,
    }))
    .sort((left, right) => compareSnowflakes(left.id, right.id));
}

function buildTelegramApiUrl(baseUrl: string, botToken: string, method: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(`bot${botToken}/${method}`, normalized).toString();
}

function buildApiUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalized).toString();
}

function compareSlackTimestamps(left: string, right: string): number {
  const leftValue = Number(left);
  const rightValue = Number(right);
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue !== rightValue) {
    return leftValue - rightValue;
  }
  return left.localeCompare(right);
}

function compareSnowflakes(left: string, right: string): number {
  try {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    if (leftValue === rightValue) {
      return 0;
    }
    return leftValue < rightValue ? -1 : 1;
  } catch {
    return left.localeCompare(right);
  }
}

interface SubagentTopologyNode {
  readonly id: string;
  readonly parentJobId: string | null;
  readonly rootJobId: string;
  readonly status: PersistedSubagentJobRecord["status"];
  readonly role: string | null;
  readonly authority: PersistedSubagentJobRecord["authority"];
  readonly mode: PersistedSubagentJobRecord["mode"];
  readonly outcomeVisibility: PersistedSubagentJobRecord["outcomeVisibility"];
  readonly depth: number;
  readonly childCount: number;
  readonly durationMs: number | null;
  readonly blockedReason: string | null;
}

interface SubagentTopologyEdge {
  readonly from: string;
  readonly to: string;
}

function buildSubagentTopology(jobs: readonly PersistedSubagentJobRecord[]): Record<string, unknown> {
  const jobsById = new Map(jobs.map((job) => [job.id, job] as const));
  const childCounts = new Map<string, number>();
  const statusCounts: Record<string, number> = {};
  const roots: string[] = [];
  const edges: SubagentTopologyEdge[] = [];
  let maxDepth = 0;

  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1;
    maxDepth = Math.max(maxDepth, job.depth);
    if (job.parentJobId && jobsById.has(job.parentJobId)) {
      edges.push({ from: job.parentJobId, to: job.id });
      childCounts.set(job.parentJobId, (childCounts.get(job.parentJobId) ?? 0) + 1);
    } else {
      roots.push(job.id);
    }
  }

  const nodes: SubagentTopologyNode[] = [...jobs]
    .sort((left, right) => left.depth - right.depth || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .map((job) => ({
      id: job.id,
      parentJobId: job.parentJobId ?? null,
      rootJobId: job.rootJobId,
      status: job.status,
      role: job.role ?? null,
      authority: job.authority,
      mode: job.mode,
      outcomeVisibility: job.outcomeVisibility,
      depth: job.depth,
      childCount: childCounts.get(job.id) ?? 0,
      durationMs: computePersistedSubagentDurationMs(job),
      blockedReason: job.blockedReason ?? null,
    }));

  return {
    roots: roots.sort(),
    nodes,
    edges: edges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)),
    statusCounts,
    maxDepth,
  };
}

function computePersistedSubagentDurationMs(job: PersistedSubagentJobRecord): number | null {
  const started = Date.parse(job.startedAt ?? job.queuedAt ?? job.createdAt);
  const ended = Date.parse(job.completedAt ?? job.updatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return null;
  }
  return Math.max(0, ended - started);
}

function presentRoute(route: ChannelRouteRecord): Record<string, unknown> {
  const senderPolicy = resolveRouteSenderPolicyFromConfig(route);
  const channelPlugin = getDefaultChannelPlugin(route.channelType);
  const pluginStatus = channelPlugin?.status.inspect(route) ?? null;
  const target = describeRouteTarget(route);
  return {
    id: route.id,
    workspaceId: route.workspaceId,
    agentId: route.agentId,
    threadId: route.threadId,
    title: route.title,
    channelType: route.channelType,
    channelKey: route.channelKey,
    adapterType: route.adapterType,
    adapterConfig: sanitizeAdapterConfig(route.adapterConfig),
    target,
    targetSummary: target.summary,
    targetDirectory: target.directory,
    transcriptDirectory: target.transcriptDirectory,
    provider: getChannelProviderManifest(route.channelType),
    capability: getChannelCapability(route.channelType),
    plugin: channelPlugin
      ? {
          id: channelPlugin.id,
          configured: pluginStatus?.configured ?? false,
          authHealth: pluginStatus?.authHealth ?? "missing",
          activeAuthMode: pluginStatus?.activeAuthMode ?? null,
          missingSecrets: pluginStatus?.missingSecrets ?? [],
          agentTools: channelPlugin.agentTools,
        }
      : null,
    dmPolicy: senderPolicy.mode,
    allowFromCount: senderPolicy.allowFrom.length,
    hasInboundSecret: route.inboundSecret !== null,
    status: route.status,
    createdAt: route.createdAt,
    updatedAt: route.updatedAt,
  };
}

function presentOutboundDelivery(
  delivery: OutboundDeliveryRecord,
  route?: ChannelRouteRecord | null,
): Record<string, unknown> {
  const transcript = route ? presentDeliveryTranscript(delivery, route) : null;
  return {
    ...delivery,
    payload: redactGatewayPresentationText(delivery.payload),
    responseSummary:
      typeof delivery.responseSummary === "string" ? redactGatewayPresentationText(delivery.responseSummary) : null,
    ...(transcript ? { transcript } : {}),
  };
}

function presentInboundMessage(
  message: InboundMessageRecord,
  route?: ChannelRouteRecord | null,
): Record<string, unknown> {
  const transcript = route ? presentInboundTranscript(message, route) : null;
  return {
    ...message,
    ...(transcript ? { transcript } : {}),
  };
}

function presentDeliveryTranscript(delivery: OutboundDeliveryRecord, route: ChannelRouteRecord): Record<string, unknown> | null {
  if (route.adapterType !== "filesystem") {
    return null;
  }
  const target = describeRouteTarget(route);
  if (!target.directory) {
    return {
      kind: "filesystem",
      path: null,
      exists: false,
      retention: target.retention ?? null,
    };
  }
  const path = join(target.directory, `${delivery.id}.json`);
  return {
    kind: "filesystem",
    path,
    exists: existsSync(path),
    retention: target.retention ?? null,
  };
}

function presentInboundTranscript(message: InboundMessageRecord, route: ChannelRouteRecord): Record<string, unknown> | null {
  if (route.adapterType !== "filesystem") {
    return null;
  }
  const target = describeRouteTarget(route);
  if (!target.directory) {
    return {
      kind: "filesystem",
      path: null,
      exists: false,
      retention: target.retention ?? null,
    };
  }
  const path = join(target.directory, `${message.id}.inbound.json`);
  return {
    kind: "filesystem",
    path,
    exists: existsSync(path),
    retention: target.retention ?? null,
  };
}

function writeInboundTranscript(route: ChannelRouteRecord, message: InboundMessageRecord): void {
  if (route.adapterType !== "filesystem") {
    return;
  }
  const target = describeRouteTarget(route);
  if (!target.directory) {
    return;
  }
  mkdirSync(target.directory, { recursive: true });
  const path = join(target.directory, `${message.id}.inbound.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        direction: "inbound",
        route: {
          id: route.id,
          title: route.title,
          channelType: route.channelType,
          channelKey: route.channelKey,
        },
        message: {
          id: message.id,
          channelMessageId: message.channelMessageId,
          sender: message.sender,
          status: message.status,
          runId: message.runId,
          createdAt: message.createdAt,
        },
        text: redactGatewayPresentationText(message.text),
        metadata: redactGatewayPresentationText(JSON.stringify(message.metadata ?? {})),
      },
      null,
      2,
    ),
    "utf8",
  );
  if (target.retention?.maxFiles) {
    pruneFilesystemTranscriptsSync(target.directory, target.retention.maxFiles);
  }
}

function describeRouteTarget(route: ChannelRouteRecord): {
  readonly kind: string;
  readonly summary: string;
  readonly directory: string | null;
  readonly transcriptDirectory: string | null;
  readonly filePattern: string | null;
  readonly retention?: { readonly maxFiles: number };
} {
  if (route.adapterType === "filesystem") {
    const outboxDir = typeof route.adapterConfig.outboxDir === "string"
      ? route.adapterConfig.outboxDir.trim()
      : "";
    const directory = outboxDir ? resolve(outboxDir) : null;
    const retentionMaxFiles = normalizeRouteTranscriptRetentionMaxFiles(route.adapterConfig.transcriptRetentionMaxFiles);
    return {
      kind: "filesystem",
      summary: directory
        ? `Filesystem outbox directory: ${directory}`
        : "Filesystem outbox directory is not configured.",
      directory,
      transcriptDirectory: directory,
      filePattern: directory ? join(directory, "{deliveryId}.json") : null,
      ...(retentionMaxFiles !== null ? { retention: { maxFiles: retentionMaxFiles } } : {}),
    };
  }

  return {
    kind: route.adapterType,
    summary: `${route.adapterType} route target for ${route.channelType}:${route.channelKey}`,
    directory: null,
    transcriptDirectory: null,
    filePattern: null,
  };
}

function normalizeRouteTranscriptRetentionMaxFiles(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function pruneFilesystemTranscriptsSync(directory: string, maxFiles: number): void {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const path = join(directory, entry.name);
      return { name: entry.name, path, mtimeMs: statSync(path).mtimeMs };
    });
  const removable = files
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))
    .slice(0, Math.max(0, files.length - maxFiles));
  for (const entry of removable) {
    try {
      unlinkSync(entry.path);
    } catch {
      // Best-effort parity with outbound transcript pruning.
    }
  }
}

function presentChannelPlugin(
  plugin: ChannelPlugin,
  routes: readonly ChannelRouteRecord[],
  deliveries: readonly OutboundDeliveryRecord[],
  inboundMessages: readonly InboundMessageRecord[],
): Record<string, unknown> {
  const pluginRoutes = routes.filter((route) => route.channelType === plugin.id);
  const routeIds = new Set(pluginRoutes.map((route) => route.id));
  const pluginDeliveries = deliveries.filter((delivery) => routeIds.has(delivery.routeId));
  const pluginInbound = inboundMessages.filter((message) => routeIds.has(message.routeId));
  const routeStatuses = pluginRoutes.map((route) => plugin.status.inspect(route));
  const missingSecrets = Array.from(new Set(routeStatuses.flatMap((status) => status.missingSecrets)));
  const deliveryFailures = pluginDeliveries.filter((delivery) => delivery.status === "failed").length;
  return {
    id: plugin.id,
    meta: plugin.meta,
    capabilities: plugin.capabilities,
    configSchema: plugin.configSchema,
    setup: plugin.setup,
    security: plugin.security,
    inbound: plugin.inbound,
    outbound: plugin.outbound
      ? {
          nativeSender: plugin.outbound.nativeSender,
        }
      : null,
    lifecycle: {
      actions: Object.keys(plugin.lifecycle),
    },
    bindings: plugin.bindings,
    agentTools: plugin.agentTools,
    status: {
      configured: pluginRoutes.length > 0 && routeStatuses.some((entry) => entry.configured),
      authHealth: pluginRoutes.length === 0 ? "missing" : missingSecrets.length === 0 ? "configured" : "missing",
      routeCount: pluginRoutes.length,
      lastInbound: pluginInbound[0]?.createdAt ?? null,
      lastOutbound: pluginDeliveries[0]?.createdAt ?? null,
      deliveryFailures,
      requiredSecrets: plugin.configSchema.requiredSecrets,
      activeAuthModes: Array.from(new Set(routeStatuses.map((status) => status.activeAuthMode).filter(Boolean))),
      missingSecrets,
    },
  };
}

function sanitizeAdapterConfig(adapterConfig: Record<string, unknown>): Record<string, unknown> {
  return sanitizeAdapterConfigValue(adapterConfig, []) as Record<string, unknown>;
}

function redactGatewayPresentationText(value: string): string {
  return value
    .replace(
      /((?:[?&]|\b)(?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|sig|signature|token|password|authorization|credential|x-amz-signature|awsaccesskeyid)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(Bearer|Bot)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "$1 [redacted]")
    .replace(/\b(?:xox[baprs]-|gh[pousr]_|sk-)[A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function sanitizeAdapterConfigValue(value: unknown, path: readonly string[]): unknown {
  const key = path[path.length - 1] ?? "";
  if (isSecretLikeAdapterConfigKey(key) && value !== undefined && value !== null && String(value).length > 0) {
    return {
      secretRef: `route.adapterConfig.${path.join(".")}`,
      configured: true,
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeAdapterConfigValue(entry, [...path, String(index)]));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    sanitized[entryKey] = sanitizeAdapterConfigValue(entryValue, [...path, entryKey]);
  }
  return sanitized;
}

function isSecretLikeAdapterConfigKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  const compact = normalized.replace(/[-_]/g, "");
  if (!normalized) {
    return false;
  }
  return (
    normalized === "url" ||
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
    normalized.includes("webhook")
  );
}

function hasGatewayAuthorization(request: IncomingMessage, accessToken: string): boolean {
  const header = request.headers.authorization;
  if (typeof header === "string" && header === `Bearer ${accessToken}`) {
    return true;
  }

  if (request.url) {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.searchParams.get("token") === accessToken) {
      return true;
    }
  }

  return false;
}

function isAuthorizedForRoute(
  request: IncomingMessage,
  route: ChannelRouteRecord,
  accessToken: string,
  body: Record<string, unknown>,
): boolean {
  if (hasGatewayAuthorization(request, accessToken)) {
    return true;
  }

  if (!route.inboundSecret) {
    return false;
  }

  const headerSecret = request.headers["x-omni-route-secret"];
  const secretFromHeader = Array.isArray(headerSecret) ? headerSecret[0] : headerSecret;
  const secretFromBody = typeof body.routeSecret === "string" ? body.routeSecret : null;
  return secretFromHeader === route.inboundSecret || secretFromBody === route.inboundSecret;
}

function extractFinalResponse(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const summary = (payload as { summary?: unknown }).summary;
  if (summary && typeof summary === "object") {
    const nested = summary as { finalResponse?: unknown };
    if (typeof nested.finalResponse === "string" && nested.finalResponse.trim().length > 0) {
      return nested.finalResponse;
    }
  }

  const run = (payload as { run?: unknown }).run;
  if (run && typeof run === "object") {
    const nested = run as { finalResponse?: unknown };
    if (typeof nested.finalResponse === "string" && nested.finalResponse.trim().length > 0) {
      return nested.finalResponse;
    }
  }

  return null;
}

function renderWorkbenchHtml(requiresToken: boolean): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Omni Agent Workbench</title>
    <style>
      :root { color-scheme: dark; --bg:#0f141b; --panel:#18212c; --line:#314052; --text:#edf2f7; --muted:#8da2b8; --accent:#7dd3fc; }
      * { box-sizing: border-box; }
      body { margin:0; font:14px/1.45 "Segoe UI",sans-serif; background:linear-gradient(180deg,#0f141b 0%,#0b1016 100%); color:var(--text); }
      header { padding:24px 28px 18px; border-bottom:1px solid var(--line); }
      h1 { margin:0 0 6px; font-size:28px; }
      p { margin:0; color:var(--muted); }
      .toolbar { display:flex; gap:10px; align-items:center; margin-top:14px; flex-wrap:wrap; }
      .toolbar input, .toolbar textarea, .toolbar select { min-width:280px; padding:8px 10px; border-radius:10px; border:1px solid var(--line); background:#111923; color:var(--text); }
      .toolbar textarea { min-height:84px; resize:vertical; width:min(560px, 100%); }
      .toolbar button { padding:8px 12px; border-radius:10px; border:1px solid var(--line); background:#101821; color:var(--text); cursor:pointer; }
      .toolbar button:hover { border-color:var(--accent); color:var(--accent); }
      main { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:16px; padding:20px; }
      section { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px; min-height:220px; }
      h2 { margin:0 0 10px; font-size:16px; }
      ul { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:10px; }
      li { padding:10px; border-radius:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); }
      .inline-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }
      code, small { color:var(--muted); }
      .badge { display:inline-block; padding:2px 8px; border-radius:999px; background:rgba(125,211,252,0.12); color:var(--accent); font-size:12px; }
      pre { margin:0; white-space:pre-wrap; word-break:break-word; }
    </style>
  </head>
  <body>
    <header>
      <h1>Omni Agent Workbench</h1>
      <p>Live view of workspaces, threads, runs, routes, inbox traffic, extensions, memories, automations, jobs, and runtime events.</p>
      <div class="toolbar">
        <input id="token-input" type="password" placeholder="${requiresToken ? "Gateway token required for authenticated API calls" : "Optional gateway token"}" />
        <button id="save-token" type="button">Save token</button>
        <small id="token-status">${requiresToken ? "This gateway requires a token." : "Token not required for this gateway."}</small>
      </div>
      <div class="toolbar">
        <select id="workspace-select">
          <option value="">Select workspace</option>
        </select>
        <select id="agent-select">
          <option value="">No agent override</option>
        </select>
        <textarea id="run-task-input" placeholder="Queue a new repository task from the workbench"></textarea>
        <select id="run-mode-input">
          <option value="mock">mock</option>
          <option value="openai">openai</option>
        </select>
        <select id="run-domain-input">
          <option value="workspace">workspace</option>
          <option value="worktree">worktree</option>
          <option value="sandbox">sandbox</option>
        </select>
        <button id="queue-run" type="button">Queue Run</button>
        <small id="run-status">No run queued from the workbench yet.</small>
      </div>
      <div class="toolbar">
        <input id="agent-name-input" type="text" placeholder="New agent name" />
        <input id="agent-cwd-input" type="text" placeholder="Optional agent cwd (defaults to selected workspace)" />
        <select id="agent-profile-input">
          <option value="">No capability profile</option>
        </select>
        <select id="agent-role-input">
          <option value="primary">primary</option>
          <option value="planner">planner</option>
          <option value="researcher">researcher</option>
          <option value="reviewer">reviewer</option>
          <option value="verifier">verifier</option>
          <option value="worker">worker</option>
          <option value="executor">executor</option>
          <option value="supervisor">supervisor</option>
        </select>
        <select id="agent-mode-input">
          <option value="default">default</option>
          <option value="bound">bound</option>
          <option value="shared">shared</option>
          <option value="locked_down">locked_down</option>
        </select>
        <button id="create-agent" type="button">Create Agent</button>
        <small id="agent-status">No agent selected.</small>
      </div>
    </header>
    <main>
      <section><h2>Insights</h2><ul id="insights"></ul></section>
      <section><h2>Workspaces</h2><ul id="workspaces"></ul></section>
      <section><h2>Agents</h2><ul id="agents"></ul></section>
      <section><h2>Agent Profiles</h2><ul id="agent-profiles"></ul></section>
      <section><h2>Agent Detail</h2><ul id="agent-detail"></ul></section>
      <section><h2>Effective Tools</h2><ul id="effective-tools"></ul></section>
      <section><h2>Auth Profiles</h2><ul id="auth-profiles"></ul></section>
      <section><h2>Context Engines</h2><ul id="context-engines"></ul></section>
      <section><h2>Memory Providers</h2><ul id="memory-providers"></ul></section>
      <section><h2>Threads</h2><ul id="threads"></ul></section>
      <section><h2>Runs</h2><ul id="runs"></ul></section>
      <section><h2>Run Detail</h2><ul id="run-detail"></ul></section>
      <section><h2>Routes</h2><ul id="routes"></ul></section>
      <section><h2>Pairings</h2><ul id="pairings"></ul></section>
      <section><h2>Nodes</h2><ul id="nodes"></ul></section>
      <section><h2>Channel Plugins</h2><ul id="channel-plugins"></ul></section>
      <section><h2>Deliveries</h2><ul id="deliveries"></ul></section>
      <section><h2>Inbox</h2><ul id="inbox"></ul></section>
      <section><h2>Memories</h2><ul id="memories"></ul></section>
      <section><h2>Skill Maintenance</h2><ul id="skill-maintenance"></ul></section>
      <section><h2>Skills</h2><ul id="skills"></ul></section>
      <section><h2>Extensions</h2><ul id="extensions"></ul></section>
      <section><h2>Resources</h2><ul id="resources"></ul></section>
      <section><h2>Prompt Templates</h2><ul id="prompts"></ul></section>
      <section><h2>Automations</h2><ul id="automations"></ul></section>
      <section><h2>Jobs</h2><ul id="jobs"></ul></section>
      <section style="grid-column:1 / -1"><h2>Events</h2><ul id="events"></ul></section>
    </main>
    <script>
      const render = (id, entries, toHtml) => {
        const list = document.getElementById(id);
        list.innerHTML = "";
        if (!entries.length) {
          list.innerHTML = "<li><small>No data yet.</small></li>";
          return;
        }
        for (const entry of entries) {
          const item = document.createElement("li");
          item.innerHTML = toHtml(entry);
          list.appendChild(item);
        }
      };
      const renderDuration = (durationMs) => {
        if (durationMs === null || durationMs === undefined || durationMs < 0) {
          return "n/a";
        }
        if (durationMs < 1000) {
          return durationMs + "ms";
        }
        const seconds = durationMs / 1000;
        if (seconds < 60) {
          return seconds.toFixed(1) + "s";
        }
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return minutes + "m " + remainingSeconds.toFixed(1) + "s";
      };
      const escapeHtml = (value) =>
        String(value ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const renderUsageCard = (scope, summary) => {
        if (!summary) {
          return "<small>Summary unavailable.</small>";
        }
        const profiles = summary.modelProfiles?.length ? summary.modelProfiles.join(", ") : "none";
        return (
          "<strong>" + scope + "</strong><br><small>" +
          "Threads: " + summary.threadCount +
          " Runs: " + summary.runCount +
          "</small><br><small>" +
          "Window: " + (summary.firstStartedAt || "n/a") + " -> " + (summary.lastCompletedAt || "n/a") +
          "</small><br><small>Tokens: in=" + (summary.inputTokens ?? "n/a") +
          " out=" + (summary.outputTokens ?? "n/a") +
          " total=" + (summary.totalTokens ?? "n/a") +
          "</small><br><small>Turns: " + (summary.turnCount || 0) +
          " Tool calls: " + (summary.toolCallCount || 0) +
          "</small><br><small>Duration: " + renderDuration(summary.totalDurationMs) + "</small><br><small>Profiles: " + profiles + "</small>"
        );
      };

      const state = {
        workspaces: [],
        agentProfiles: [],
        selectedWorkspaceCwd: "",
        selectedAgentId: "",
        selectedThreadId: "",
        selectedRunId: "",
      };
      const tokenInput = document.getElementById("token-input");
      const tokenStatus = document.getElementById("token-status");
      const workspaceSelect = document.getElementById("workspace-select");
      const agentSelect = document.getElementById("agent-select");
      const agentNameInput = document.getElementById("agent-name-input");
      const agentCwdInput = document.getElementById("agent-cwd-input");
      const agentProfileInput = document.getElementById("agent-profile-input");
      const agentRoleInput = document.getElementById("agent-role-input");
      const agentModeInput = document.getElementById("agent-mode-input");
      const agentStatus = document.getElementById("agent-status");
      const runTaskInput = document.getElementById("run-task-input");
      const runModeInput = document.getElementById("run-mode-input");
      const runDomainInput = document.getElementById("run-domain-input");
      const runStatus = document.getElementById("run-status");
      const query = new URLSearchParams(window.location.search);
      const queryToken = query.get("token");
      if (queryToken) {
        localStorage.setItem("omni-agent.gatewayToken", queryToken);
      }
      tokenInput.value = localStorage.getItem("omni-agent.gatewayToken") || "";

      const getGatewayToken = () => tokenInput.value.trim() || localStorage.getItem("omni-agent.gatewayToken") || "";
      const updateTokenStatus = (message) => {
        tokenStatus.textContent = message;
      };
      const buildHeaders = () => {
        const token = getGatewayToken();
        return token ? { Authorization: "Bearer " + token } : {};
      };
      const authFetch = async (url, init = {}) => {
        const headers = { ...(init.headers || {}), ...buildHeaders() };
        const response = await fetch(url, { ...init, headers });
        if (response.status === 401) {
          updateTokenStatus("Unauthorized. Save a valid gateway token.");
          throw new Error("Unauthorized gateway request");
        }
        return response;
      };

      document.getElementById("save-token").addEventListener("click", () => {
        const token = tokenInput.value.trim();
        if (token) {
          localStorage.setItem("omni-agent.gatewayToken", token);
          updateTokenStatus("Gateway token saved locally.");
        } else {
          localStorage.removeItem("omni-agent.gatewayToken");
          updateTokenStatus("Gateway token cleared.");
        }
      });

      workspaceSelect.addEventListener("change", () => {
        state.selectedWorkspaceCwd = workspaceSelect.value;
        state.selectedAgentId = "";
        state.selectedThreadId = "";
        state.selectedRunId = "";
        refresh().catch((error) => updateTokenStatus("Workspace refresh failed: " + String(error)));
      });

      agentSelect.addEventListener("change", () => {
        state.selectedAgentId = agentSelect.value;
        state.selectedThreadId = "";
        state.selectedRunId = "";
        refresh().catch((error) => updateTokenStatus("Agent refresh failed: " + String(error)));
      });

      document.getElementById("queue-run").addEventListener("click", async () => {
        const cwd = state.selectedWorkspaceCwd || state.workspaces[0]?.cwd;
        const agentId = state.selectedAgentId || "";
        const task = runTaskInput.value.trim();
        if (!cwd) {
          runStatus.textContent = "No workspace is registered yet.";
          return;
        }
        if (!task) {
          runStatus.textContent = "Enter a task before queuing a run.";
          return;
        }
        runStatus.textContent = "Queueing run...";
        try {
          const response = await authFetch("/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cwd,
              task,
              agentId: agentId || undefined,
              mode: runModeInput.value,
              executionDomain: runDomainInput.value,
              async: true,
            }),
          });
          const payload = await response.json();
          runStatus.textContent = payload.job?.id
            ? "Queued job " + payload.job.id + (agentId ? " for agent " + agentId + "." : ".")
            : "Run queued.";
          runTaskInput.value = "";
          refresh().catch(() => {});
        } catch (error) {
          runStatus.textContent = "Queue failed: " + String(error);
        }
      });

      document.getElementById("create-agent").addEventListener("click", async () => {
        const selectedWorkspace = state.workspaces.find((entry) => entry.cwd === state.selectedWorkspaceCwd) || state.workspaces[0];
        const name = agentNameInput.value.trim();
        const cwd = agentCwdInput.value.trim() || selectedWorkspace?.cwd || "";
        if (!name) {
          agentStatus.textContent = "Enter an agent name before creating it.";
          return;
        }
        if (!cwd) {
          agentStatus.textContent = "Select a workspace or provide an agent cwd first.";
          return;
        }
        agentStatus.textContent = "Creating agent...";
        try {
          const response = await authFetch("/agents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              cwd,
              capabilityProfileId: agentProfileInput.value || undefined,
              defaultRole: agentRoleInput.value,
              mode: agentModeInput.value,
            }),
          });
          const payload = await response.json();
          const createdAgent = payload.agent;
          state.selectedWorkspaceCwd = cwd;
          state.selectedAgentId = createdAgent?.id || "";
          state.selectedThreadId = "";
          state.selectedRunId = "";
          agentNameInput.value = "";
          agentCwdInput.value = "";
          agentStatus.textContent = createdAgent?.id
            ? "Created agent " + createdAgent.name + " (" + createdAgent.id + ")."
            : "Agent created.";
          refresh().catch(() => {});
        } catch (error) {
          agentStatus.textContent = "Agent creation failed: " + String(error);
        }
      });

      document.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }

        if (target.matches("[data-agent-id]")) {
          const agentId = target.getAttribute("data-agent-id");
          if (!agentId) {
            return;
          }
          state.selectedAgentId = agentId;
          state.selectedThreadId = "";
          state.selectedRunId = "";
          refresh().catch((error) => updateTokenStatus("Agent selection failed: " + String(error)));
          return;
        }

        if (target.matches("[data-agent-toggle-status]")) {
          const agentId = target.getAttribute("data-agent-toggle-status");
          const nextStatus = target.getAttribute("data-next-status");
          if (!agentId || !nextStatus) {
            return;
          }
          target.setAttribute("disabled", "disabled");
          try {
            await authFetch("/agents/" + encodeURIComponent(agentId), {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: nextStatus }),
            });
            agentStatus.textContent = "Updated agent " + agentId + " to " + nextStatus + ".";
            refresh().catch(() => {});
          } catch (error) {
            agentStatus.textContent = "Agent status update failed: " + String(error);
          } finally {
            target.removeAttribute("disabled");
          }
          return;
        }

        if (target.matches("[data-auth-profile-action]")) {
          const authProfileId = target.getAttribute("data-auth-profile-id");
          const action = target.getAttribute("data-auth-profile-action");
          if (!authProfileId || !action) {
            return;
          }
          target.setAttribute("disabled", "disabled");
          try {
            await authFetch("/auth-profiles/" + encodeURIComponent(authProfileId) + "/" + action, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: action === "success" ? JSON.stringify({}) : undefined,
            });
            updateTokenStatus("Auth profile " + authProfileId + " action " + action + " completed.");
            refresh().catch(() => {});
          } catch (error) {
            updateTokenStatus("Auth profile action failed: " + String(error));
          } finally {
            target.removeAttribute("disabled");
          }
          return;
        }

        if (target.matches("[data-skill-promote]")) {
          const skillId = target.getAttribute("data-skill-promote");
          if (!skillId) {
            return;
          }
          target.setAttribute("disabled", "disabled");
          try {
            await authFetch("/skills/" + encodeURIComponent(skillId) + "/promote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                target: "workspace",
                reason: "Promoted from the workbench after operator review.",
              }),
            });
            updateTokenStatus("Promoted learned skill " + skillId + " into workspace skills.");
            refresh().catch(() => {});
          } catch (error) {
            updateTokenStatus("Skill promotion failed: " + String(error));
          } finally {
            target.removeAttribute("disabled");
          }
          return;
        }

        if (target.matches("[data-thread-id]")) {
          const threadId = target.getAttribute("data-thread-id");
          if (!threadId) {
            return;
          }
          state.selectedThreadId = threadId;
          state.selectedRunId = "";
          refresh().catch((error) => updateTokenStatus("Thread refresh failed: " + String(error)));
          return;
        }

        if (target.matches("[data-run-id]")) {
          const runId = target.getAttribute("data-run-id");
          if (!runId) {
            return;
          }
          state.selectedRunId = runId;
          refresh().catch((error) => updateTokenStatus("Run refresh failed: " + String(error)));
          return;
        }

        if (!target.matches("[data-pairing-code]")) {
          return;
        }
        const code = target.getAttribute("data-pairing-code");
        if (!code) {
          return;
        }
        target.setAttribute("disabled", "disabled");
        try {
          await authFetch("/pairings/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          });
          updateTokenStatus("Approved pairing " + code + ".");
          refresh().catch(() => {});
        } catch (error) {
          updateTokenStatus("Pairing approval failed: " + String(error));
        } finally {
          target.removeAttribute("disabled");
        }
      });

      async function refresh() {
        const workspacesPayload = await authFetch("/workspaces").then((response) => response.json());
        state.workspaces = workspacesPayload.workspaces ?? [];
        if (!state.selectedWorkspaceCwd || !state.workspaces.some((entry) => entry.cwd === state.selectedWorkspaceCwd)) {
          state.selectedWorkspaceCwd = state.workspaces[0]?.cwd ?? "";
          state.selectedAgentId = "";
          state.selectedThreadId = "";
          state.selectedRunId = "";
        }
        workspaceSelect.innerHTML = "";
        for (const workspace of state.workspaces) {
          const option = document.createElement("option");
          option.value = workspace.cwd;
          option.textContent = workspace.name + "  " + workspace.cwd;
          workspaceSelect.appendChild(option);
        }
        workspaceSelect.value = state.selectedWorkspaceCwd;
        render("workspaces", state.workspaces, (entry) =>
          "<strong>" + entry.name + "</strong> " +
          (entry.cwd === state.selectedWorkspaceCwd ? "<span class='badge'>active</span>" : "") +
          "<br><small>" + entry.cwd + "</small>"
        );

        const profilesPayload = await authFetch("/agent-profiles").then((response) => response.json());
        state.agentProfiles = profilesPayload.profiles ?? [];
        const previousProfile = agentProfileInput.value;
        agentProfileInput.innerHTML = "<option value=''>No capability profile</option>";
        for (const profile of state.agentProfiles) {
          const option = document.createElement("option");
          option.value = profile.id;
          option.textContent = profile.label + "  " + profile.defaultRole + "  " + profile.contextEngineId;
          agentProfileInput.appendChild(option);
        }
        agentProfileInput.value = state.agentProfiles.some((entry) => entry.id === previousProfile) ? previousProfile : "";
        render("agent-profiles", state.agentProfiles, (entry) =>
          "<strong>" + entry.label + "</strong> <span class='badge'>" + entry.defaultRole + "</span>" +
          "<br><small>" + entry.id + " / " + entry.description + "</small>" +
          "<br><small>context=" + entry.contextEngineId + " / memory=" + (entry.memoryProviderIds || []).join(", ") + "</small>" +
          "<br><small>aligned=" + (entry.alignedProjects || []).join(", ") + "</small>"
        );

        const cwd = state.selectedWorkspaceCwd;
        const selectedWorkspace = state.workspaces.find((entry) => entry.cwd === cwd) || null;
        const agentsPayload = await authFetch("/agents").then((response) => response.json());
        const allAgents = agentsPayload.agents ?? [];
        const workspaceAgents = selectedWorkspace
          ? allAgents.filter((entry) => entry.workspaceId === selectedWorkspace.id || entry.cwd === selectedWorkspace.cwd)
          : allAgents;
        if (!state.selectedAgentId || !workspaceAgents.some((entry) => entry.id === state.selectedAgentId)) {
          state.selectedAgentId = "";
        }
        agentSelect.innerHTML = "<option value=''>No agent override</option>";
        for (const agent of workspaceAgents) {
          const option = document.createElement("option");
          option.value = agent.id;
          option.textContent = agent.name + "  " + agent.defaultRole + "  " + agent.status;
          agentSelect.appendChild(option);
        }
        agentSelect.value = state.selectedAgentId;
        agentStatus.textContent = state.selectedAgentId
          ? "Selected agent " + state.selectedAgentId + "."
          : workspaceAgents.length > 0
            ? "Workspace has " + workspaceAgents.length + " agent(s)."
            : "No agent selected.";
        render("agents", workspaceAgents, (entry) =>
          "<strong>" + entry.name + "</strong> " +
          (entry.id === state.selectedAgentId ? "<span class='badge'>active</span>" : "<span class='badge'>" + entry.status + "</span>") +
          "<br><small>role=" + (entry.defaultRole || "none") + " / mode=" + entry.mode + "</small>" +
          "<br><small>" + entry.cwd + "</small>" +
          "<div class='inline-actions'>" +
          "<button type='button' data-agent-id='" + entry.id + "'>Select</button>" +
          "<button type='button' data-agent-toggle-status='" + entry.id + "' data-next-status='" + (entry.status === "active" ? "paused" : "active") + "'>" +
          (entry.status === "active" ? "Pause" : "Resume") +
          "</button>" +
          "</div>"
        );

        const selectedAgent = workspaceAgents.find((entry) => entry.id === state.selectedAgentId) || null;
        const [contextEnginesPayload, memoryProvidersPayload, authProfilesPayload, insightsPayload, routesPayload, pairingsPayload, nodesPayload, channelPluginsPayload, deliveriesPayload, extensionsPayload, resourcesPayload, promptsPayload, automationsPayload, jobsPayload] = await Promise.all([
          authFetch("/context-engines").then((response) => response.json()),
          authFetch("/memory-providers").then((response) => response.json()),
          authFetch("/auth-profiles").then((response) => response.json()),
          authFetch("/insights" + (cwd ? "?cwd=" + encodeURIComponent(cwd) : "")).then((response) => response.json()),
          authFetch(selectedAgent ? "/agents/" + encodeURIComponent(selectedAgent.id) + "/routes" : "/routes" + (cwd ? "?cwd=" + encodeURIComponent(cwd) : "")).then((response) => response.json()),
          authFetch("/pairings" + (cwd ? "?cwd=" + encodeURIComponent(cwd) : "")).then((response) => response.json()),
          authFetch("/nodes").then((response) => response.json()),
          authFetch("/channel-plugins" + (cwd ? "?cwd=" + encodeURIComponent(cwd) : "")).then((response) => response.json()),
          authFetch("/deliveries" + (cwd ? "?cwd=" + encodeURIComponent(cwd) : "")).then((response) => response.json()),
          authFetch("/extensions").then((response) => response.json()),
          authFetch("/extensions/resources").then((response) => response.json()),
          authFetch("/extensions/prompts").then((response) => response.json()),
          authFetch(selectedAgent ? "/agents/" + encodeURIComponent(selectedAgent.id) + "/automations" : "/automations" + (cwd ? "?cwd=" + encodeURIComponent(cwd) : "")).then((response) => response.json()),
          authFetch("/jobs").then((response) => response.json()),
        ]);

        const insightsEntries = [];
        if (insightsPayload?.globalSummary) {
          insightsEntries.push({ label: "Global", summary: insightsPayload.globalSummary });
        }
        if (insightsPayload?.workspaceSummary) {
          insightsEntries.push({
            label: "Workspace (" + (insightsPayload.workspace?.name || state.selectedWorkspaceCwd || "selected") + ")",
            summary: insightsPayload.workspaceSummary,
          });
        }
        if (selectedAgent) {
          const agentInsightsPayload = await authFetch("/agents/" + encodeURIComponent(selectedAgent.id) + "/insights").then((response) => response.json());
          if (agentInsightsPayload?.agentSummary) {
            insightsEntries.push({
              label: "Agent (" + selectedAgent.name + ")",
              summary: agentInsightsPayload.agentSummary,
            });
          }
        }
        render("insights", insightsEntries, (entry) => renderUsageCard(entry.label, entry.summary));

        render("context-engines", contextEnginesPayload.contextEngines ?? [], (entry) =>
          "<strong>" + entry.label + "</strong><br><small>" + entry.id + " / " + entry.description + "</small>"
        );
        render("memory-providers", memoryProvidersPayload.memoryProviders ?? [], (entry) =>
          "<strong>" + entry.label + "</strong> <span class='badge'>" + (entry.health || "unknown") + "</span>" +
          "<br><small>" + entry.id + " / " + entry.description + "</small>" +
          "<br><small>lastPhase=" + (entry.lastLifecyclePhase || "n/a") + " / at=" + (entry.lastLifecycleAt || "n/a") + "</small>" +
          (entry.lastError ? "<br><small>" + entry.lastError + "</small>" : "")
        );
        render("auth-profiles", authProfilesPayload.authProfiles ?? [], (entry) =>
          "<strong>" + entry.authProfileId + "</strong> <span class='badge'>" + entry.status + "</span>" +
          "<br><small>successes=" + (entry.successCount ?? 0) + " / failures=" + (entry.failureCount ?? 0) + " / consecutive=" + (entry.consecutiveFailures ?? 0) + "</small>" +
          "<br><small>lastSuccess=" + (entry.lastSuccessAt || "n/a") + " / lastFailure=" + (entry.lastFailureAt || "n/a") + "</small>" +
          "<br><small>cooldownUntil=" + (entry.cooldownUntil || "n/a") + "</small>" +
          (entry.lastError ? "<br><small>" + entry.lastError + "</small>" : "") +
          "<div class='inline-actions'>" +
          "<button type='button' data-auth-profile-id='" + entry.authProfileId + "' data-auth-profile-action='success'>Mark success</button>" +
          "<button type='button' data-auth-profile-id='" + entry.authProfileId + "' data-auth-profile-action='reset'>Reset</button>" +
          "</div>"
        );

        let effectiveToolsPayload = null;
        if (selectedAgent) {
          effectiveToolsPayload = await authFetch("/agents/" + encodeURIComponent(selectedAgent.id) + "/effective-tools").then((response) => response.json());
        }
        render("agent-detail", selectedAgent ? [selectedAgent] : [], (entry) =>
          "<strong>" + entry.name + "</strong> <span class='badge'>" + entry.status + "</span>" +
          "<br><small>id=" + entry.id + "</small>" +
          "<br><small>role=" + (entry.defaultRole || "none") + " / mode=" + entry.mode + " / type=" + entry.agentType + "</small>" +
          "<br><small>cwd=" + entry.cwd + "</small>" +
          "<br><small>capabilityProfile=" + (effectiveToolsPayload?.capabilityProfile?.id || entry.metadata?.capabilityProfileId || "none") + "</small>" +
          "<br><small>contextEngine=" + (effectiveToolsPayload?.contextEngine?.id || entry.contextEngineId || "default") + "</small>" +
          "<br><small>memoryProviders=" + ((effectiveToolsPayload?.memoryProviders ?? []).map((provider) => provider.id).join(", ") || "none") + "</small>" +
          "<br><small>authProfile=" + (entry.authProfileId || "none") + " / authStatus=" + (effectiveToolsPayload?.authProfileState?.status || "n/a") + "</small>" +
          (entry.instruction ? "<br><br><small>" + entry.instruction + "</small>" : "")
        );
        render("effective-tools", effectiveToolsPayload?.effectiveTools?.toolNames?.length ? [effectiveToolsPayload.effectiveTools] : [], (entry) =>
          "<strong>" + entry.toolNames.length + " effective tool(s)</strong>" +
          "<br><small>" + entry.toolNames.join(", ") + "</small>" +
          (Array.isArray(entry.trace) && entry.trace.length > 0 ? "<br><br><pre>" + entry.trace.join("\n") + "</pre>" : "")
        );

        render("routes", routesPayload.routes ?? [], (entry) =>
          "<strong>" + entry.title + "</strong> <span class='badge'>" + entry.status + "</span><br><small>" + entry.channelType + ":" + entry.channelKey + " via " + entry.adapterType + " / dmPolicy=" + (entry.dmPolicy || "open") + "</small>"
          + (entry.targetSummary ? "<br><small>" + escapeHtml(entry.targetSummary) + "</small>" : "")
        );
        render("pairings", pairingsPayload.pairings ?? [], (entry) =>
          "<strong>" + entry.sender + "</strong> <span class='badge'>" + entry.status + "</span><br><small>" + entry.channelType + ":" + entry.channelKey + " / code=" + entry.code + "</small>" +
          (entry.status === "pending" ? "<div class='inline-actions'><button type='button' data-pairing-code='" + entry.code + "'>Approve</button></div>" : "")
        );
        render("nodes", nodesPayload.nodes ?? [], (entry) =>
          "<strong>" + entry.name + "</strong> <span class='badge'>" + entry.status + "</span><br><small>" + (entry.capabilities?.join(", ") || "no capabilities") + "</small>"
        );
        render("channel-plugins", channelPluginsPayload.plugins ?? [], (entry) =>
          "<strong>" + entry.meta.name + "</strong> <span class='badge'>" + (entry.status?.authHealth || "missing") + "</span><br><small>routes=" + (entry.status?.routeCount ?? 0) + " / failures=" + (entry.status?.deliveryFailures ?? 0) + " / auth=" + ((entry.status?.activeAuthModes || []).join(", ") || "none") + "</small>" +
          "<br><small>in=" + (entry.status?.lastInbound || "never") + " / out=" + (entry.status?.lastOutbound || "never") + "</small>" +
          "<br><small>required=" + ((entry.status?.requiredSecrets || []).join(", ") || "none") + " / missing=" + ((entry.status?.missingSecrets || []).join(", ") || "none") + "</small>" +
          "<br><small>tools=" + ((entry.agentTools || []).join(", ") || "none") + "</small>"
        );
        render("deliveries", deliveriesPayload.deliveries ?? [], (entry) =>
          "<strong>" + entry.channelType + ":" + entry.channelKey + "</strong> <span class='badge'>" + entry.status + "</span><br><small>attempts=" + (entry.attemptCount ?? 0) + " / " + entry.responseSummary + "</small>"
        );
        render("extensions", extensionsPayload.extensions ?? [], (entry) =>
          "<strong>" + entry.name + "</strong> <span class='badge'>" + entry.capability + "</span><br><small>tools=" + (entry.toolNames?.length ?? 0) + " / resources=" + (entry.resourceCount ?? 0) + " / prompts=" + (entry.promptTemplateCount ?? 0) + "</small>"
        );
        render("resources", resourcesPayload.resources ?? [], (entry) =>
          "<strong>" + entry.extensionId + "/" + entry.id + "</strong><br><small>" + entry.mimeType + " / " + entry.description + "</small>"
        );
        render("prompts", promptsPayload.prompts ?? [], (entry) =>
          "<strong>" + entry.extensionId + "/" + entry.name + "</strong><br><small>" + entry.description + " / args=" + (entry.arguments?.length ?? 0) + "</small>"
        );
        render("automations", automationsPayload.automations ?? [], (entry) =>
          "<strong>" + entry.title + "</strong> <span class='badge'>" + entry.status + "</span><br><small>" + entry.scheduleKind + (entry.intervalSeconds ? " / " + entry.intervalSeconds + "s" : "") + "</small>"
        );
        render("jobs", jobsPayload.jobs ?? [], (entry) =>
          "<strong>" + (entry.kind || "job") + "</strong> <span class='badge'>" + entry.status + "</span><br><small>" + entry.id + "</small>"
        );

        if (!cwd) {
          render("threads", [], () => "");
          render("runs", [], () => "");
          render("run-detail", [], () => "");
          render("inbox", [], () => "");
          render("memories", [], () => "");
          render("skill-maintenance", [], () => "");
          render("skills", [], () => "");
          return;
        }

        const [threadsPayload, memoriesPayload, inboxPayload, skillsPayload, skillMaintenancePayload] = await Promise.all([
          authFetch(selectedAgent ? "/agents/" + encodeURIComponent(selectedAgent.id) + "/threads" : "/threads?cwd=" + encodeURIComponent(cwd)).then((response) => response.json()),
          authFetch(selectedAgent ? "/agents/" + encodeURIComponent(selectedAgent.id) + "/memories?limit=20" : "/memories?cwd=" + encodeURIComponent(cwd)).then((response) => response.json()),
          authFetch("/inbox/messages?cwd=" + encodeURIComponent(cwd)).then((response) => response.json()),
          authFetch(selectedAgent ? "/agents/" + encodeURIComponent(selectedAgent.id) + "/skills?limit=20" : "/skills?cwd=" + encodeURIComponent(cwd)).then((response) => response.json()),
          authFetch("/skills/maintenance?" + (selectedAgent ? "agentId=" + encodeURIComponent(selectedAgent.id) : "cwd=" + encodeURIComponent(cwd))).then((response) => response.json()),
        ]);
        const threads = threadsPayload.threads ?? [];
        if (!state.selectedThreadId || !threads.some((entry) => entry.id === state.selectedThreadId)) {
          state.selectedThreadId = threads[0]?.id ?? "";
          state.selectedRunId = "";
        }
        render("threads", threads, (entry) =>
          "<strong>" + entry.title + "</strong> " +
          (entry.id === state.selectedThreadId ? "<span class='badge'>active</span>" : "") +
          "<br><small>" + entry.id + "</small>" +
          "<div class='inline-actions'><button type='button' data-thread-id='" + entry.id + "'>Open runs</button></div>"
        );

        let runs = [];
        if (state.selectedThreadId) {
          const runsPayload = await authFetch("/runs?threadId=" + encodeURIComponent(state.selectedThreadId)).then((response) => response.json());
          runs = runsPayload.runs ?? [];
        } else if (selectedAgent) {
          const runsPayload = await authFetch("/agents/" + encodeURIComponent(selectedAgent.id) + "/runs").then((response) => response.json());
          runs = runsPayload.runs ?? [];
        }
        if (!state.selectedRunId || !runs.some((entry) => entry.id === state.selectedRunId)) {
          state.selectedRunId = runs[0]?.id ?? "";
        }
        render("runs", runs, (entry) =>
          "<strong>" + (entry.objective || entry.id) + "</strong> " +
          (entry.id === state.selectedRunId ? "<span class='badge'>active</span>" : "<span class='badge'>" + entry.status + "</span>") +
          "<br><small>" + entry.id + "</small>" +
          "<div class='inline-actions'><button type='button' data-run-id='" + entry.id + "'>Inspect run</button></div>"
        );

        let runDetailPayload = null;
        if (state.selectedRunId) {
          runDetailPayload = await authFetch("/runs/" + encodeURIComponent(state.selectedRunId)).then((response) => response.json());
        }
        render("run-detail", runDetailPayload ? [runDetailPayload] : [], (payload) => {
          const review = payload.review || {};
          const recovery = payload.recovery || {};
          const timeline = Array.isArray(payload.timeline) ? payload.timeline.slice(-8) : [];
          return (
            "<strong>" + escapeHtml(payload.run?.objective || payload.run?.id || "Run detail") + "</strong> " +
            "<span class='badge'>" + escapeHtml(payload.run?.status || "unknown") + "</span>" +
            (review.status ? " <span class='badge'>" + escapeHtml(review.status) + "</span>" : "") +
            "<br><small>thread=" + escapeHtml(payload.run?.threadId || "n/a") + "</small>" +
            "<br><small>verification=" + escapeHtml(payload.run?.verificationStatus || "n/a") + "</small>" +
            (payload.run?.finalResponse ? "<br><br><small>" + escapeHtml(payload.run.finalResponse) + "</small>" : "") +
            "<br><br><strong>Review</strong>" +
            "<br><small>toolFailures=" + (review.toolFailures?.length ?? 0) +
            " blockedApprovals=" + (review.blockedApprovals?.length ?? 0) +
            " diffArtifacts=" + (review.diffArtifacts?.length ?? 0) + "</small>" +
            (timeline.length > 0
              ? "<br><br><strong>Timeline</strong>" + timeline.map((entry) =>
                  "<br><small>" + escapeHtml(entry.at) + " " + escapeHtml(entry.kind) +
                  " " + escapeHtml(entry.status || "") + ": " + escapeHtml(entry.label) +
                  " - " + escapeHtml(entry.summary) + "</small>"
                ).join("")
              : "") +
            (recovery.continueCommand
              ? "<br><br><strong>Recovery</strong><br><small>" + escapeHtml(recovery.task || "") +
                "</small><br><small>" + escapeHtml(recovery.continueCommand) + "</small>" +
                (recovery.cleanupCommand ? "<br><small>" + escapeHtml(recovery.cleanupCommand) + "</small>" : "")
              : "")
          );
        });
        render("memories", memoriesPayload.memories ?? [], (entry) =>
          "<strong>" + entry.scope + "</strong><br><small>" + entry.content + "</small>" +
          (entry.agentId ? "<br><small>agent=" + entry.agentId + "</small>" : "")
        );
        const maintenanceReport = skillMaintenancePayload.report || {};
        const maintenanceEntries = [
          { label: "Promote", entries: maintenanceReport.promotionCandidates || [] },
          { label: "Reverify", entries: maintenanceReport.reverifyCandidates || [] },
          { label: "Disable", entries: maintenanceReport.disableCandidates || [] },
          { label: "Stable", entries: maintenanceReport.stableSkills || [] },
        ].filter((entry) => entry.entries.length > 0);
        render("skill-maintenance", maintenanceEntries, (entry) =>
          "<strong>" + entry.label + "</strong> <span class='badge'>" + entry.entries.length + "</span>" +
          "<br><small>" + entry.entries.map((skill) => skill.title + " q=" + skill.qualityScore + " rev=" + skill.revisionCount).join("; ") + "</small>"
        );
        render("skills", skillsPayload.skills ?? [], (entry) =>
          "<strong>" + entry.title + "</strong> <span class='badge'>" + (entry.sourceType || "learned") + "</span> <span class='badge'>uses " + (entry.useCount ?? 0) + "</span>" +
          "<br><small>" + entry.problemPattern + "</small><br><small>" + entry.guidance + "</small>" +
          (entry.materializedSkillPath ? "<br><small>skill_file=" + entry.materializedSkillPath + "</small>" : "") +
          (entry.sourceType === "learned"
            ? "<div class='inline-actions'><button type='button' data-skill-promote='" + entry.id + "'>Promote</button></div>"
            : "")
        );
        render("inbox", inboxPayload.messages ?? [], (entry) =>
          "<strong>" + entry.channelType + "</strong> <span class='badge'>" + entry.status + "</span><br><small>" + entry.text + "</small>"
        );
      }

      const events = document.getElementById("events");
      const pushEvent = (type, payload) => {
        const item = document.createElement("li");
        item.innerHTML = "<strong>" + type + "</strong><br><pre>" + JSON.stringify(payload, null, 2) + "</pre>";
        events.prepend(item);
        while (events.children.length > 30) {
          events.removeChild(events.lastChild);
        }
      };

      const tokenForEvents = getGatewayToken();
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = wsProtocol + "//" + window.location.host + "/ws" + (tokenForEvents ? "?token=" + encodeURIComponent(tokenForEvents) : "");
      const socket = new WebSocket(wsUrl);
      socket.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "gateway.event" && payload.event) {
            pushEvent(payload.event.type || "gateway.event", payload.event);
            return;
          }
          pushEvent(payload.type || "message", payload);
        } catch {}
      });
      socket.addEventListener("close", () => {
        pushEvent("control-plane.closed", { message: "WebSocket control plane closed." });
      });

      refresh().catch((error) => pushEvent("refresh.error", { message: String(error) }));
      setInterval(() => refresh().catch(() => {}), 5000);
    </script>
  </body>
</html>`;
}

function loadWorkbenchHtml(requiresToken: boolean): string {
  const candidates = [
    join(process.cwd(), "apps", "workbench", "index.html"),
    join(process.cwd(), "omni-agent", "apps", "workbench", "index.html"),
    join(resolveGatewayStorageRoot(undefined), "workbench", "index.html"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    const html = readFileSync(candidate, "utf8");
    return html.replace(/__OMNI_REQUIRES_TOKEN__/g, requiresToken ? "true" : "false");
  }
  return renderWorkbenchHtml(requiresToken);
}
