import type { ChannelRouteRecord, OutboundDeliveryRecord, RouteAdapterType } from "@omni-agent/session-store";

import { buildPlatformOutboundPayload, normalizeOutboundMessage } from "./messages.js";

export interface ChannelPlugin {
  readonly id: RouteAdapterType;
  readonly meta: {
    readonly name: string;
    readonly providerGroup: "consumer" | "enterprise" | "local" | "public";
    readonly version: string;
  };
  readonly capabilities: {
    readonly inbound: boolean;
    readonly outbound: boolean;
    readonly dm: boolean;
    readonly threads: boolean;
    readonly files: boolean;
    readonly voice: boolean;
    readonly markdown: boolean;
    readonly mentions: boolean;
    readonly streaming: boolean;
  };
  readonly configSchema: {
    readonly requiredSecrets: readonly string[];
    readonly outboundFields: readonly string[];
    readonly authModes: readonly ChannelPluginAuthMode[];
  };
  readonly setup: {
    readonly notes: readonly string[];
  };
  readonly security: {
    readonly requiresSignatureVerification: boolean;
    readonly defaultDmPolicy: "open" | "pairing";
    readonly supportsSecretRefs: boolean;
  };
  readonly inbound: {
    readonly endpointHint: string;
    readonly signatureHeader?: string;
  };
  readonly outbound?: {
    readonly nativeSender: boolean;
    send(request: ChannelPluginSendRequest): Promise<ChannelPluginSendResult>;
  };
  readonly lifecycle: ChannelPluginLifecycle;
  readonly status: {
    inspect(route: ChannelRouteRecord): ChannelPluginRouteStatus;
  };
  readonly bindings: {
    readonly routeAdapterType: RouteAdapterType;
    readonly deliveryEvents: readonly string[];
    readonly threadKeyFields: readonly string[];
  };
  readonly agentTools: readonly string[];
}

export interface ChannelPluginAuthMode {
  readonly id: string;
  readonly requiredSecrets: readonly string[];
}

export interface ChannelPluginSendRequest {
  readonly route: ChannelRouteRecord;
  readonly delivery: OutboundDeliveryRecord;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ChannelPluginSendResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
}

export type ChannelPluginLifecycleAction =
  | "install"
  | "configure"
  | "pair"
  | "receive"
  | "send"
  | "ack"
  | "retry"
  | "health"
  | "shutdown";

export interface ChannelPluginLifecycleRequest {
  readonly route?: ChannelRouteRecord;
  readonly delivery?: OutboundDeliveryRecord;
  readonly inboundMessage?: {
    readonly channelMessageId?: string | null;
    readonly sender?: string | null;
    readonly text?: string;
    readonly metadata?: Record<string, unknown>;
  };
  readonly metadata?: Record<string, unknown>;
}

export interface ChannelPluginLifecycleResult {
  readonly ok: boolean;
  readonly action: ChannelPluginLifecycleAction;
  readonly summary: string;
  readonly data?: unknown;
}

export interface ChannelPluginLifecycle {
  install(request?: ChannelPluginLifecycleRequest): Promise<ChannelPluginLifecycleResult>;
  configure(request?: ChannelPluginLifecycleRequest): Promise<ChannelPluginLifecycleResult>;
  pair(request?: ChannelPluginLifecycleRequest): Promise<ChannelPluginLifecycleResult>;
  receive(request?: ChannelPluginLifecycleRequest): Promise<ChannelPluginLifecycleResult>;
  send(request: ChannelPluginSendRequest): Promise<ChannelPluginSendResult>;
  ack(request?: ChannelPluginLifecycleRequest): Promise<ChannelPluginLifecycleResult>;
  retry(request?: ChannelPluginLifecycleRequest): Promise<ChannelPluginLifecycleResult>;
  health(request?: ChannelPluginLifecycleRequest): Promise<ChannelPluginLifecycleResult>;
  shutdown(request?: ChannelPluginLifecycleRequest): Promise<ChannelPluginLifecycleResult>;
}

export interface ChannelPluginRouteStatus {
  readonly configured: boolean;
  readonly authHealth: "configured" | "missing";
  readonly activeAuthMode: string | null;
  readonly missingSecrets: readonly string[];
  readonly requiredSecrets: readonly string[];
}

export interface ChannelPluginRegistry {
  get(id: string): ChannelPlugin | null;
  list(): ChannelPlugin[];
}

export interface ChannelPluginContractIssue {
  readonly pluginId: string;
  readonly severity: "error" | "warning";
  readonly reason: string;
}

export interface ChannelPluginContractReport {
  readonly generatedAt: string;
  readonly pluginCount: number;
  readonly ok: boolean;
  readonly issues: readonly ChannelPluginContractIssue[];
}

export function createDefaultChannelPluginRegistry(): ChannelPluginRegistry {
  const plugins = new Map<string, ChannelPlugin>();
  for (const plugin of listDefaultChannelPlugins()) {
    plugins.set(plugin.id, plugin);
  }
  return {
    get(id) {
      return plugins.get(id.trim().toLowerCase()) ?? null;
    },
    list() {
      return Array.from(plugins.values()).sort((left, right) => left.id.localeCompare(right.id));
    },
  };
}

export function listDefaultChannelPlugins(): ChannelPlugin[] {
  const deepPlugins = [createFeishuChannelPlugin(), createSlackChannelPlugin(), createTelegramChannelPlugin()];
  const deepPluginIds = new Set(deepPlugins.map((plugin) => plugin.id));
  return [
    ...deepPlugins,
    ...GENERIC_CHANNEL_PLUGIN_DEFINITIONS
      .filter((definition) => !deepPluginIds.has(definition.id))
      .map(createGenericChannelPlugin),
  ].sort((left, right) => left.id.localeCompare(right.id));
}

export function getDefaultChannelPlugin(channelType: string): ChannelPlugin | null {
  const normalized = channelType.trim().toLowerCase();
  return listDefaultChannelPlugins().find((plugin) => plugin.id === normalized) ?? null;
}

export function buildChannelPluginContractReport(plugins: readonly ChannelPlugin[] = listDefaultChannelPlugins()): ChannelPluginContractReport {
  const issues = plugins.flatMap((plugin) => validateChannelPluginContract(plugin));
  return {
    generatedAt: new Date().toISOString(),
    pluginCount: plugins.length,
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

export function validateChannelPluginContract(plugin: ChannelPlugin): ChannelPluginContractIssue[] {
  const issues: ChannelPluginContractIssue[] = [];
  const requiredLifecycleActions: readonly ChannelPluginLifecycleAction[] = [
    "install",
    "configure",
    "pair",
    "receive",
    "send",
    "ack",
    "retry",
    "health",
    "shutdown",
  ];
  const addIssue = (severity: ChannelPluginContractIssue["severity"], reason: string): void => {
    issues.push({ pluginId: plugin.id, severity, reason });
  };

  if (!plugin.meta.name.trim()) {
    addIssue("error", "Channel plugin must expose a display name.");
  }
  if (!plugin.meta.version.trim()) {
    addIssue("error", "Channel plugin must expose a version.");
  }
  if (plugin.bindings.routeAdapterType !== plugin.id) {
    addIssue("error", "Channel plugin binding routeAdapterType must match the plugin id.");
  }
  if (plugin.capabilities.outbound && !plugin.outbound?.send) {
    addIssue("error", "Outbound-capable channel plugins must expose an outbound sender.");
  }
  if (plugin.capabilities.inbound && !plugin.inbound.endpointHint.trim()) {
    addIssue("error", "Inbound-capable channel plugins must document an endpoint hint.");
  }
  if (!plugin.security.supportsSecretRefs) {
    addIssue("warning", "Channel plugin should support secret references for production configuration.");
  }
  if (plugin.security.requiresSignatureVerification && !plugin.inbound.signatureHeader) {
    addIssue("error", "Signature-verifying channel plugins must name the signature header.");
  }
  if (plugin.configSchema.authModes.length === 0) {
    addIssue("error", "Channel plugin must expose at least one auth mode.");
  }
  for (const mode of plugin.configSchema.authModes) {
    if (!mode.id.trim()) {
      addIssue("error", "Channel plugin auth modes must have stable ids.");
    }
    for (const secret of mode.requiredSecrets) {
      if (!plugin.configSchema.requiredSecrets.includes(secret)) {
        addIssue("error", `Auth mode ${mode.id} references unknown secret field ${secret}.`);
      }
    }
  }
  for (const action of requiredLifecycleActions) {
    if (typeof plugin.lifecycle[action] !== "function") {
      addIssue("error", `Channel plugin is missing lifecycle action ${action}.`);
    }
  }
  for (const event of ["route.delivery.queued", "route.delivery.sent", "route.delivery.failed", "route.delivery.dead_letter"]) {
    if (!plugin.bindings.deliveryEvents.includes(event)) {
      addIssue("error", `Channel plugin delivery bindings must include ${event}.`);
    }
  }

  return issues;
}

export function redactChannelPluginConfig(
  plugin: ChannelPlugin,
  adapterConfig: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const secretFields = new Set([
    ...plugin.configSchema.requiredSecrets,
    ...plugin.configSchema.authModes.flatMap((mode) => mode.requiredSecrets),
  ]);
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(adapterConfig)) {
    const lowerKey = key.toLowerCase();
    const shouldRedact =
      secretFields.has(key) || lowerKey.includes("secret") || lowerKey.includes("token") || lowerKey.includes("webhookurl");
    output[key] = shouldRedact && hasConfiguredValue(value) ? "[configured]" : value;
  }
  return output;
}

function createSlackChannelPlugin(): ChannelPlugin {
  return definePlugin({
    id: "slack",
    name: "Slack",
    providerGroup: "enterprise",
    capabilities: {
      inbound: true,
      outbound: true,
      dm: true,
      threads: true,
      files: true,
      voice: false,
      markdown: true,
      mentions: true,
      streaming: false,
    },
    requiredSecrets: ["inboundSecret", "webhookUrl", "botToken"],
    outboundFields: ["webhookUrl", "botToken", "channelId", "threadTs"],
    authModes: [
      { id: "webhook", requiredSecrets: ["webhookUrl"] },
      { id: "bot-token", requiredSecrets: ["botToken"] },
    ],
    endpointHint: "POST generic inbound messages to /inbox/messages.",
    threadKeyFields: ["threadTs", "threadId"],
    send: sendSlackMessage,
  });
}

function createTelegramChannelPlugin(): ChannelPlugin {
  return definePlugin({
    id: "telegram",
    name: "Telegram",
    providerGroup: "public",
    capabilities: {
      inbound: true,
      outbound: true,
      dm: true,
      threads: false,
      files: false,
      voice: false,
      markdown: true,
      mentions: false,
      streaming: false,
    },
    requiredSecrets: ["inboundSecret", "botToken"],
    outboundFields: ["botToken", "chatId", "parseMode"],
    authModes: [{ id: "bot-token", requiredSecrets: ["botToken"] }],
    endpointHint: "POST generic inbound messages to /inbox/messages.",
    threadKeyFields: [],
    send: sendTelegramMessage,
  });
}

function createFeishuChannelPlugin(): ChannelPlugin {
  return definePlugin({
    id: "feishu",
    name: "Feishu",
    providerGroup: "enterprise",
    capabilities: {
      inbound: true,
      outbound: true,
      dm: true,
      threads: true,
      files: true,
      voice: false,
      markdown: true,
      mentions: true,
      streaming: false,
    },
    requiredSecrets: ["inboundSecret", "webhookUrl", "tenantAccessToken"],
    outboundFields: ["webhookUrl", "tenantAccessToken", "receiveId", "receiveIdType"],
    authModes: [
      { id: "webhook", requiredSecrets: ["webhookUrl"] },
      { id: "tenant-access-token", requiredSecrets: ["tenantAccessToken"] },
    ],
    endpointHint: "POST normalized webhooks to /inbox/enterprise/feishu.",
    requiresSignatureVerification: true,
    threadKeyFields: ["receiveId", "chatId"],
    send: sendFeishuMessage,
  });
}

interface GenericChannelPluginDefinition {
  readonly id: RouteAdapterType;
  readonly name: string;
  readonly providerGroup: "consumer" | "enterprise" | "local" | "public";
  readonly capabilities: ChannelPlugin["capabilities"];
  readonly requiredSecrets: readonly string[];
  readonly outboundFields: readonly string[];
  readonly endpointHint: string;
  readonly requiresSignatureVerification?: boolean;
  readonly threadKeyFields: readonly string[];
}

const GENERIC_CHANNEL_PLUGIN_DEFINITIONS: readonly GenericChannelPluginDefinition[] = [
  genericDefinition("canvas", "Canvas", "local", ["inboundSecret", "endpointUrl"], ["endpointUrl", "serviceToken"], {
    inbound: true,
    outbound: true,
    markdown: true,
    signature: true,
  }),
  genericDefinition("dingtalk", "DingTalk", "enterprise", ["inboundSecret", "webhookUrl", "accessToken", "robotCode"], ["webhookUrl", "accessToken", "robotCode", "userIds", "openConversationId"], {
    inbound: true,
    outbound: true,
    dm: true,
    markdown: true,
    mentions: true,
    signature: true,
  }),
  genericDefinition("discord", "Discord", "public", ["inboundSecret", "webhookUrl", "botToken"], ["webhookUrl", "botToken", "channelId"], {
    inbound: true,
    outbound: true,
    dm: true,
    threads: true,
    files: true,
    markdown: true,
    mentions: true,
    threadKeyFields: ["threadId", "channelId"],
  }),
  genericDefinition("filesystem", "Filesystem", "local", ["outboxDir"], ["outboxDir"], {
    inbound: false,
    outbound: true,
    markdown: true,
  }),
  genericDefinition("matrix", "Matrix", "consumer", ["inboundSecret", "accessToken", "homeserverUrl"], ["homeserverUrl", "accessToken", "roomId"], {
    inbound: true,
    outbound: true,
    dm: true,
    threads: true,
    files: true,
    markdown: true,
    mentions: true,
    signature: true,
    threadKeyFields: ["roomId", "eventId"],
  }),
  genericDefinition("media", "Media", "local", ["inboundSecret", "endpointUrl"], ["endpointUrl", "serviceToken"], {
    inbound: true,
    outbound: true,
    files: true,
    voice: true,
    signature: true,
  }),
  genericDefinition("mobile-node", "Mobile Node", "local", ["inboundSecret", "endpointUrl", "deviceId", "serviceToken"], ["endpointUrl", "deviceId", "serviceToken"], {
    inbound: true,
    outbound: true,
    dm: true,
    files: true,
    voice: true,
    signature: true,
    threadKeyFields: ["deviceId"],
  }),
  genericDefinition("signal", "Signal", "consumer", ["inboundSecret", "serviceToken"], ["baseUrl", "serviceToken", "recipient"], {
    inbound: true,
    outbound: true,
    dm: true,
    files: true,
    voice: true,
    signature: true,
  }),
  genericDefinition("teams", "Microsoft Teams", "enterprise", ["inboundSecret", "webhookUrl", "graphAccessToken"], ["webhookUrl", "graphAccessToken", "chatId", "teamId", "channelId"], {
    inbound: true,
    outbound: true,
    dm: true,
    threads: true,
    files: true,
    markdown: true,
    mentions: true,
    signature: true,
    threadKeyFields: ["chatId", "channelId"],
  }),
  genericDefinition("voice", "Voice", "local", ["inboundSecret", "endpointUrl"], ["endpointUrl", "serviceToken"], {
    inbound: true,
    outbound: true,
    dm: true,
    voice: true,
    signature: true,
  }),
  genericDefinition("whatsapp", "WhatsApp", "consumer", ["inboundSecret", "verifyToken", "accessToken"], ["accessToken", "phoneNumberId", "to"], {
    inbound: true,
    outbound: true,
    dm: true,
    files: true,
    voice: true,
    signature: true,
  }),
];

function createGenericChannelPlugin(definition: GenericChannelPluginDefinition): ChannelPlugin {
  return definePlugin({
    id: definition.id,
    name: definition.name,
    providerGroup: definition.providerGroup,
    capabilities: definition.capabilities,
    requiredSecrets: definition.requiredSecrets,
    outboundFields: definition.outboundFields,
    endpointHint: definition.endpointHint,
    requiresSignatureVerification: definition.requiresSignatureVerification,
    threadKeyFields: definition.threadKeyFields,
    send: sendGenericChannelMessage,
  });
}

function genericDefinition(
  id: RouteAdapterType,
  name: string,
  providerGroup: "consumer" | "enterprise" | "local" | "public",
  requiredSecrets: readonly string[],
  outboundFields: readonly string[],
  options: {
    readonly inbound: boolean;
    readonly outbound: boolean;
    readonly dm?: boolean;
    readonly threads?: boolean;
    readonly files?: boolean;
    readonly voice?: boolean;
    readonly markdown?: boolean;
    readonly mentions?: boolean;
    readonly streaming?: boolean;
    readonly signature?: boolean;
    readonly threadKeyFields?: readonly string[];
  },
): GenericChannelPluginDefinition {
  return {
    id,
    name,
    providerGroup,
    capabilities: {
      inbound: options.inbound,
      outbound: options.outbound,
      dm: options.dm === true,
      threads: options.threads === true,
      files: options.files === true,
      voice: options.voice === true,
      markdown: options.markdown === true,
      mentions: options.mentions === true,
      streaming: options.streaming === true,
    },
    requiredSecrets,
    outboundFields,
    endpointHint: options.inbound ? buildGenericEndpointHint(id, providerGroup) : "Outbound-only local channel.",
    requiresSignatureVerification: options.signature,
    threadKeyFields: options.threadKeyFields ?? [],
  };
}

function definePlugin(input: {
  readonly id: RouteAdapterType;
  readonly name: string;
  readonly providerGroup: "consumer" | "enterprise" | "local" | "public";
  readonly capabilities: ChannelPlugin["capabilities"];
  readonly requiredSecrets: readonly string[];
  readonly outboundFields: readonly string[];
  readonly authModes?: readonly ChannelPluginAuthMode[];
  readonly endpointHint: string;
  readonly requiresSignatureVerification?: boolean;
  readonly threadKeyFields: readonly string[];
  readonly send: (request: ChannelPluginSendRequest) => Promise<ChannelPluginSendResult>;
}): ChannelPlugin {
  const authModes = normalizeAuthModes(input.authModes, input.requiredSecrets);
  const lifecycle = createDefaultChannelPluginLifecycle(input.id, input.send);
  return {
    id: input.id,
    meta: {
      name: input.name,
      providerGroup: input.providerGroup,
      version: "1.0.0",
    },
    capabilities: input.capabilities,
    configSchema: {
      requiredSecrets: input.requiredSecrets,
      outboundFields: input.outboundFields,
      authModes,
    },
    setup: {
      notes: [
        input.endpointHint,
        `Set adapterType to ${input.id} for plugin-managed outbound delivery.`,
      ],
    },
    security: {
      requiresSignatureVerification: input.requiresSignatureVerification === true,
      defaultDmPolicy: "pairing",
      supportsSecretRefs: true,
    },
    inbound: {
      endpointHint: input.endpointHint,
      signatureHeader: input.requiresSignatureVerification ? "x-omni-route-secret" : undefined,
    },
    outbound: {
      nativeSender: true,
      send: lifecycle.send,
    },
    lifecycle,
    status: {
      inspect(route) {
        const status = inspectRouteAuthModes(authModes, route.adapterConfig);
        return {
          configured: status.configured,
          authHealth: status.configured ? "configured" : "missing",
          activeAuthMode: status.activeAuthMode,
          missingSecrets: status.missingSecrets,
          requiredSecrets: input.requiredSecrets,
        };
      },
    },
    bindings: {
      routeAdapterType: input.id,
      deliveryEvents: [
        "route.delivery.queued",
        "route.delivery.sending",
        "route.delivery.sent",
        "route.delivery.acknowledged",
        "route.delivery.failed",
        "route.delivery.retrying",
        "route.delivery.dead_letter",
      ],
      threadKeyFields: input.threadKeyFields,
    },
    agentTools: [`channel_${input.id}_send`],
  };
}

function createDefaultChannelPluginLifecycle(
  pluginId: RouteAdapterType,
  send: (request: ChannelPluginSendRequest) => Promise<ChannelPluginSendResult>,
): ChannelPluginLifecycle {
  const lifecycleResult = (
    action: Exclude<ChannelPluginLifecycleAction, "send">,
    summary: string,
    data?: unknown,
  ): Promise<ChannelPluginLifecycleResult> =>
    Promise.resolve({
      ok: true,
      action,
      summary,
      ...(data === undefined ? {} : { data }),
    });

  return {
    install: (request) =>
      lifecycleResult("install", `Channel plugin ${pluginId} install contract is ready.`, {
        routeId: request?.route?.id ?? null,
      }),
    configure: (request) =>
      lifecycleResult("configure", `Channel plugin ${pluginId} configuration contract is ready.`, {
        routeId: request?.route?.id ?? null,
      }),
    pair: (request) =>
      lifecycleResult("pair", `Channel plugin ${pluginId} pairing contract is ready.`, {
        routeId: request?.route?.id ?? null,
        sender: request?.inboundMessage?.sender ?? null,
      }),
    receive: (request) =>
      lifecycleResult("receive", `Channel plugin ${pluginId} receive contract accepted inbound message.`, {
        channelMessageId: request?.inboundMessage?.channelMessageId ?? null,
        sender: request?.inboundMessage?.sender ?? null,
      }),
    send,
    ack: (request) =>
      lifecycleResult("ack", `Channel plugin ${pluginId} acknowledgement contract accepted delivery state.`, {
        deliveryId: request?.delivery?.id ?? null,
      }),
    retry: (request) =>
      lifecycleResult("retry", `Channel plugin ${pluginId} retry contract accepted delivery state.`, {
        deliveryId: request?.delivery?.id ?? null,
      }),
    health: (request) =>
      lifecycleResult("health", `Channel plugin ${pluginId} health contract is available.`, {
        routeId: request?.route?.id ?? null,
      }),
    shutdown: (request) =>
      lifecycleResult("shutdown", `Channel plugin ${pluginId} shutdown contract completed.`, {
        routeId: request?.route?.id ?? null,
      }),
  };
}

function normalizeAuthModes(
  authModes: readonly ChannelPluginAuthMode[] | undefined,
  requiredSecrets: readonly string[],
): readonly ChannelPluginAuthMode[] {
  if (authModes && authModes.length > 0) {
    return authModes.map((mode) => ({
      id: mode.id,
      requiredSecrets: mode.requiredSecrets.filter((field) => field !== "inboundSecret"),
    }));
  }
  return [
    {
      id: "default",
      requiredSecrets: requiredSecrets.filter((field) => field !== "inboundSecret"),
    },
  ];
}

function inspectRouteAuthModes(
  authModes: readonly ChannelPluginAuthMode[],
  adapterConfig: Record<string, unknown>,
): { readonly configured: boolean; readonly activeAuthMode: string | null; readonly missingSecrets: readonly string[] } {
  let bestMissingSecrets: readonly string[] = [];
  let bestMissingCount = Number.POSITIVE_INFINITY;
  for (const mode of authModes) {
    const missingSecrets = mode.requiredSecrets.filter((field) => !hasConfiguredValue(adapterConfig[field]));
    if (missingSecrets.length === 0) {
      return {
        configured: true,
        activeAuthMode: mode.id,
        missingSecrets: [],
      };
    }
    if (missingSecrets.length < bestMissingCount) {
      bestMissingSecrets = missingSecrets;
      bestMissingCount = missingSecrets.length;
    }
  }
  return {
    configured: false,
    activeAuthMode: null,
    missingSecrets: bestMissingSecrets,
  };
}

async function sendSlackMessage(request: ChannelPluginSendRequest): Promise<ChannelPluginSendResult> {
  const webhookUrl = optionalString(request.route.adapterConfig.webhookUrl);
  if (webhookUrl) {
    return sendWebhookJson(
      webhookUrl,
      buildPlatformOutboundPayload("slack", normalizeOutboundMessage(request.content, request.metadata)),
      "Slack plugin webhook",
    );
  }
  const botToken = optionalString(request.route.adapterConfig.botToken);
  if (!botToken) {
    return { ok: false, summary: `Slack route ${request.route.title} requires adapterConfig.webhookUrl or adapterConfig.botToken.` };
  }
  const baseUrl = optionalString(request.route.adapterConfig.baseUrl) ?? "https://slack.com/api";
  const channelId = String(request.route.adapterConfig.channelId ?? request.route.channelKey ?? "").trim();
  if (!channelId) {
    return { ok: false, summary: `Slack route ${request.route.title} is missing a channel id.` };
  }
  const outboundMessage = normalizeOutboundMessage(request.content, request.metadata);
  const payload: Record<string, unknown> = {
    ...buildPlatformOutboundPayload("slack", outboundMessage),
    channel: channelId,
  };
  const threadTs = outboundMessage.threadId ?? optionalString(request.route.adapterConfig.threadTs);
  if (threadTs) {
    payload.thread_ts = threadTs;
  }
  const response = await fetch(buildApiUrl(baseUrl, "chat.postMessage"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${botToken}` },
    body: JSON.stringify(payload),
  });
  const parsed = await readResponsePayload(response);
  const slackOk = parsed.json && typeof parsed.json === "object" && !Array.isArray(parsed.json)
    ? Boolean((parsed.json as Record<string, unknown>).ok)
    : response.ok;
  const errorMessage = parsed.json && typeof parsed.json === "object" && !Array.isArray(parsed.json)
    ? String((parsed.json as Record<string, unknown>).error ?? "")
    : "";
  return {
    ok: response.ok && slackOk,
    summary:
      response.ok && slackOk
        ? `Delivered response to Slack channel ${channelId}.`
        : `Slack delivery to channel ${channelId} failed${errorMessage ? `: ${errorMessage}` : ` with ${response.status}`}.`,
    data: { status: response.status, body: parsed.text, json: parsed.json },
  };
}

async function sendTelegramMessage(request: ChannelPluginSendRequest): Promise<ChannelPluginSendResult> {
  const botToken = optionalString(request.route.adapterConfig.botToken);
  if (!botToken) {
    return { ok: false, summary: `Telegram route ${request.route.title} is missing adapterConfig.botToken.` };
  }
  const baseUrl = optionalString(request.route.adapterConfig.baseUrl) ?? "https://api.telegram.org";
  const chatId = String(request.route.adapterConfig.chatId ?? request.route.channelKey ?? "").trim();
  if (!chatId) {
    return { ok: false, summary: `Telegram route ${request.route.title} is missing a chat id.` };
  }
  const payload = buildPlatformOutboundPayload("telegram", normalizeOutboundMessage(request.content, request.metadata));
  const response = await fetch(buildTelegramApiUrl(baseUrl, botToken, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...payload,
      chat_id: chatId,
      parse_mode: optionalString(request.route.adapterConfig.parseMode) ?? payload.parse_mode,
    }),
  });
  const parsed = await readResponsePayload(response);
  return {
    ok: response.ok,
    summary: response.ok
      ? `Delivered response to Telegram chat ${chatId}.`
      : `Telegram delivery to chat ${chatId} failed with ${response.status}.`,
    data: { status: response.status, body: parsed.text, json: parsed.json },
  };
}

async function sendFeishuMessage(request: ChannelPluginSendRequest): Promise<ChannelPluginSendResult> {
  const webhookUrl = optionalString(request.route.adapterConfig.webhookUrl);
  if (webhookUrl) {
    return sendWebhookJson(
      webhookUrl,
      {
        msg_type: "text",
        content: { text: normalizeOutboundMessage(request.content, request.metadata).text },
      },
      "Feishu plugin webhook",
    );
  }
  const tenantAccessToken = optionalString(request.route.adapterConfig.tenantAccessToken);
  if (!tenantAccessToken) {
    return { ok: false, summary: `Feishu route ${request.route.title} requires adapterConfig.webhookUrl or adapterConfig.tenantAccessToken.` };
  }
  const receiveId = String(request.route.adapterConfig.receiveId ?? request.route.channelKey ?? "").trim();
  if (!receiveId) {
    return { ok: false, summary: `Feishu route ${request.route.title} is missing a receive id.` };
  }
  const baseUrl = optionalString(request.route.adapterConfig.baseUrl) ?? "https://open.feishu.cn";
  const receiveIdType = optionalString(request.route.adapterConfig.receiveIdType) ?? "chat_id";
  const url = new URL(buildApiUrl(baseUrl, "open-apis/im/v1/messages"));
  url.searchParams.set("receive_id_type", receiveIdType);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${tenantAccessToken}` },
    body: JSON.stringify({
      receive_id: receiveId,
      ...buildPlatformOutboundPayload("feishu", normalizeOutboundMessage(request.content, request.metadata)),
    }),
  });
  const parsed = await readResponsePayload(response);
  const feishuOk = parsed.json && typeof parsed.json === "object" && !Array.isArray(parsed.json)
    ? Number((parsed.json as Record<string, unknown>).code ?? 0) === 0
    : response.ok;
  return {
    ok: response.ok && feishuOk,
    summary:
      response.ok && feishuOk
        ? `Delivered response to Feishu receive id ${receiveId}.`
        : `Feishu native delivery to ${receiveId} failed with ${response.status}.`,
    data: { status: response.status, body: parsed.text, json: parsed.json },
  };
}

async function sendGenericChannelMessage(request: ChannelPluginSendRequest): Promise<ChannelPluginSendResult> {
  const webhookUrl = optionalString(request.route.adapterConfig.webhookUrl);
  if (webhookUrl) {
    return sendWebhookJson(
      webhookUrl,
      buildGenericOutboundPayload(request.route.channelType, normalizeOutboundMessage(request.content, request.metadata)),
      `${request.route.channelType} plugin webhook`,
    );
  }
  const endpointUrl = optionalString(request.route.adapterConfig.endpointUrl);
  if (endpointUrl) {
    return sendWebhookJson(
      endpointUrl,
      {
        routeId: request.route.id,
        channelType: request.route.channelType,
        channelKey: request.route.channelKey,
        deliveryId: request.delivery.id,
        message: normalizeOutboundMessage(request.content, request.metadata),
      },
      `${request.route.channelType} plugin endpoint`,
    );
  }
  return {
    ok: false,
    summary: `${request.route.channelType} route ${request.route.title} requires a configured webhookUrl, endpointUrl, or provider-specific credential before outbound delivery.`,
    data: {
      requiredFields: Object.keys(request.route.adapterConfig).sort(),
    },
  };
}

function buildGenericOutboundPayload(channelType: string, message: ReturnType<typeof normalizeOutboundMessage>): Record<string, unknown> {
  switch (channelType) {
    case "dingtalk":
    case "discord":
    case "feishu":
    case "matrix":
    case "slack":
    case "teams":
    case "telegram":
    case "whatsapp":
      return buildPlatformOutboundPayload(channelType, message);
    default:
      return {
        text: message.text,
        markdown: message.markdown,
        threadId: message.threadId,
        replyToMessageId: message.replyToMessageId,
        attachments: message.attachments,
        metadata: message.metadata,
      };
  }
}

function buildGenericEndpointHint(id: RouteAdapterType, providerGroup: "consumer" | "enterprise" | "local" | "public"): string {
  if (providerGroup === "enterprise") {
    return `POST normalized webhooks to /inbox/enterprise/${id}.`;
  }
  if (providerGroup === "consumer" || providerGroup === "local") {
    return `POST normalized webhooks to /inbox/consumer/${id}.`;
  }
  return "POST generic inbound messages to /inbox/messages.";
}

async function sendWebhookJson(
  url: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<ChannelPluginSendResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const parsed = await readResponsePayload(response);
  return {
    ok: response.ok,
    summary: response.ok ? `Delivered response via ${label}.` : `${label} delivery failed with ${response.status}.`,
    data: { status: response.status, body: parsed.text, json: parsed.json },
  };
}

function hasConfiguredValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function buildApiUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalized).toString();
}

function buildTelegramApiUrl(baseUrl: string, botToken: string, method: string): string {
  return buildApiUrl(baseUrl, `bot${botToken}/${method}`);
}

async function readResponsePayload(response: Response): Promise<{ text: string; json: unknown | null }> {
  const text = await response.text();
  if (!text.trim()) {
    return { text, json: null };
  }
  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    return { text, json: null };
  }
}
