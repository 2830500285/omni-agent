import type { ChannelRouteRecord, ChannelRouteStatus, RouteAdapterType } from "@omni-agent/session-store";

import { getDefaultChannelPlugin, listDefaultChannelPlugins, type ChannelPlugin } from "./channel-plugin.js";

const pairingDefaultChannelTypes = new Set([
  "canvas",
  "dingtalk",
  "discord",
  "feishu",
  "matrix",
  "media",
  "mobile-node",
  "signal",
  "slack",
  "teams",
  "telegram",
  "voice",
  "whatsapp",
]);

export interface ChannelCapabilityDescriptor {
  readonly channelType: string;
  readonly supportsInbound: boolean;
  readonly supportsOutbound: boolean;
  readonly supportsDm: boolean;
  readonly supportsThreads: boolean;
  readonly supportsFiles: boolean;
  readonly supportsVoice: boolean;
  readonly supportsMarkdown: boolean;
  readonly supportsMentions: boolean;
  readonly supportsPairing: boolean;
  readonly requiresSignatureVerification: boolean;
  readonly rateLimitProfile: "enterprise" | "local" | "public";
}

export interface ChannelProviderManifest {
  readonly channelType: string;
  readonly displayName: string;
  readonly supportsInbound: boolean;
  readonly supportsOutbound: boolean;
  readonly auth: {
    readonly requiredSecrets: readonly string[];
    readonly supportsSecretRefs: boolean;
  };
  readonly security: {
    readonly requiresSignatureVerification: boolean;
    readonly defaultDmPolicy: "open" | "pairing";
  };
  readonly outbound: {
    readonly nativeSender: boolean;
    readonly adapterConfig: readonly string[];
  };
  readonly setupNotes: readonly string[];
  readonly plugin?: {
    readonly id: string;
    readonly version: string;
    readonly agentTools: readonly string[];
  };
}

const CHANNEL_CAPABILITIES: readonly ChannelCapabilityDescriptor[] = [
  defineChannel("telegram", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsMarkdown: true }),
  defineChannel("slack", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsThreads: true, supportsFiles: true, supportsMarkdown: true, supportsMentions: true, rateLimitProfile: "enterprise" }),
  defineChannel("discord", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsThreads: true, supportsFiles: true, supportsMarkdown: true, supportsMentions: true }),
  defineChannel("feishu", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsThreads: true, supportsFiles: true, supportsMarkdown: true, supportsMentions: true, requiresSignatureVerification: true, rateLimitProfile: "enterprise" }),
  defineChannel("dingtalk", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsMarkdown: true, supportsMentions: true, requiresSignatureVerification: true, rateLimitProfile: "enterprise" }),
  defineChannel("teams", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsThreads: true, supportsFiles: true, supportsMarkdown: true, supportsMentions: true, requiresSignatureVerification: true, rateLimitProfile: "enterprise" }),
  defineChannel("whatsapp", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsFiles: true, supportsVoice: true, requiresSignatureVerification: true }),
  defineChannel("signal", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsFiles: true, supportsVoice: true, requiresSignatureVerification: true }),
  defineChannel("matrix", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsThreads: true, supportsFiles: true, supportsMarkdown: true, supportsMentions: true, requiresSignatureVerification: true }),
  defineChannel("voice", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsVoice: true, requiresSignatureVerification: true, rateLimitProfile: "local" }),
  defineChannel("canvas", { supportsInbound: true, supportsOutbound: true, supportsMarkdown: true, requiresSignatureVerification: true, rateLimitProfile: "local" }),
  defineChannel("mobile-node", { supportsInbound: true, supportsOutbound: true, supportsDm: true, supportsFiles: true, supportsVoice: true, requiresSignatureVerification: true, rateLimitProfile: "local" }),
  defineChannel("media", { supportsInbound: true, supportsOutbound: true, supportsFiles: true, supportsVoice: true, requiresSignatureVerification: true, rateLimitProfile: "local" }),
];

const CHANNEL_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  "mobile-node": "Mobile Node",
  canvas: "Canvas",
  dingtalk: "DingTalk",
  discord: "Discord",
  feishu: "Feishu",
  matrix: "Matrix",
  media: "Media",
  signal: "Signal",
  slack: "Slack",
  teams: "Microsoft Teams",
  telegram: "Telegram",
  voice: "Voice",
  whatsapp: "WhatsApp",
};

const CHANNEL_PROVIDER_SECRETS: Record<string, readonly string[]> = {
  canvas: ["inboundSecret", "endpointUrl"],
  dingtalk: ["inboundSecret", "webhookUrl", "accessToken", "robotCode"],
  discord: ["inboundSecret", "webhookUrl", "botToken"],
  feishu: ["inboundSecret", "webhookUrl", "tenantAccessToken"],
  matrix: ["inboundSecret", "accessToken", "homeserverUrl"],
  media: ["inboundSecret", "endpointUrl"],
  "mobile-node": ["inboundSecret", "endpointUrl", "deviceId", "serviceToken"],
  signal: ["inboundSecret", "serviceToken"],
  slack: ["inboundSecret", "webhookUrl", "botToken"],
  teams: ["inboundSecret", "webhookUrl", "graphAccessToken"],
  telegram: ["inboundSecret", "botToken"],
  voice: ["inboundSecret", "endpointUrl"],
  whatsapp: ["inboundSecret", "verifyToken", "accessToken"],
};

const CHANNEL_OUTBOUND_CONFIG: Record<string, readonly string[]> = {
  canvas: ["endpointUrl", "serviceToken"],
  dingtalk: ["webhookUrl", "accessToken", "robotCode", "userIds", "openConversationId"],
  discord: ["webhookUrl", "botToken", "channelId"],
  feishu: ["webhookUrl", "tenantAccessToken", "receiveId", "receiveIdType"],
  matrix: ["homeserverUrl", "accessToken", "roomId"],
  media: ["endpointUrl", "serviceToken"],
  "mobile-node": ["endpointUrl", "deviceId", "serviceToken"],
  signal: ["baseUrl", "serviceToken", "recipient"],
  slack: ["webhookUrl", "botToken", "channelId", "threadTs"],
  teams: ["webhookUrl", "graphAccessToken", "chatId", "teamId", "channelId"],
  telegram: ["botToken", "chatId", "parseMode"],
  voice: ["endpointUrl", "serviceToken"],
  whatsapp: ["accessToken", "phoneNumberId", "to"],
};

export function listChannelCapabilities(): ChannelCapabilityDescriptor[] {
  const pluginIds = new Set<string>(listDefaultChannelPlugins().map((plugin) => plugin.id));
  return [
    ...listDefaultChannelPlugins().map((plugin) => buildChannelCapabilityFromPlugin(plugin)),
    ...CHANNEL_CAPABILITIES.filter((entry) => !pluginIds.has(entry.channelType)).map((entry) => ({ ...entry })),
  ].sort((left, right) => left.channelType.localeCompare(right.channelType));
}

export function getChannelCapability(channelType: string): ChannelCapabilityDescriptor {
  const normalized = channelType.trim().toLowerCase();
  const plugin = getDefaultChannelPlugin(normalized);
  if (plugin) {
    return buildChannelCapabilityFromPlugin(plugin);
  }
  return CHANNEL_CAPABILITIES.find((entry) => entry.channelType === normalized) ?? defineChannel(normalized, {});
}

export function listChannelProviderManifests(): ChannelProviderManifest[] {
  const pluginIds = new Set<string>(listDefaultChannelPlugins().map((plugin) => plugin.id));
  return [
    ...listDefaultChannelPlugins().map((plugin) => buildChannelProviderManifestFromPlugin(plugin)),
    ...CHANNEL_CAPABILITIES.filter((entry) => !pluginIds.has(entry.channelType)).map((entry) => buildChannelProviderManifest(entry)),
  ].sort((left, right) => left.channelType.localeCompare(right.channelType));
}

export function getChannelProviderManifest(channelType: string): ChannelProviderManifest {
  const plugin = getDefaultChannelPlugin(channelType);
  if (plugin) {
    return buildChannelProviderManifestFromPlugin(plugin);
  }
  return buildChannelProviderManifest(getChannelCapability(channelType));
}

export interface PrepareRouteDefinitionInput {
  readonly threadId?: string | null;
  readonly title?: string | null;
  readonly channelType: string;
  readonly channelKey: string;
  readonly adapterType?: unknown;
  readonly adapterConfig?: unknown;
  readonly inboundSecret?: string | null;
  readonly status?: unknown;
}

export interface PreparedRouteDefinition {
  readonly threadId: string | null;
  readonly title: string;
  readonly channelType: string;
  readonly channelKey: string;
  readonly adapterType: RouteAdapterType;
  readonly adapterConfig: Record<string, unknown>;
  readonly inboundSecret: string | null;
  readonly status: ChannelRouteStatus;
}

export class RouteConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RouteConfigurationError";
  }
}

export function prepareRouteDefinition(input: PrepareRouteDefinitionInput): PreparedRouteDefinition {
  const channelType = String(input.channelType ?? "").trim();
  const channelKey = String(input.channelKey ?? "").trim();
  if (!channelType || !channelKey) {
    throw new RouteConfigurationError("Route requires non-empty channelType and channelKey.");
  }

  const defaultTitle = `${channelType}:${channelKey}`;
  const requestedTitle = typeof input.title === "string" ? input.title.trim() : "";
  const title = requestedTitle || defaultTitle;
  const adapterType = normalizeRouteAdapterType(input.adapterType);
  const adapterConfig = normalizeRouteAdapterConfig(input.adapterConfig);
  const normalizedAdapterConfig = applyRouteDefaults(channelType, adapterConfig);
  validateRouteAdapterConfig(adapterType, normalizedAdapterConfig);

  return {
    threadId: typeof input.threadId === "string" && input.threadId.trim().length > 0 ? input.threadId.trim() : null,
    title,
    channelType,
    channelKey,
    adapterType,
    adapterConfig: normalizedAdapterConfig,
    inboundSecret:
      typeof input.inboundSecret === "string" && input.inboundSecret.trim().length > 0 ? input.inboundSecret.trim() : null,
    status: input.status === "paused" ? "paused" : "active",
  };
}

export function resolveRouteSenderPolicy(route: Pick<ChannelRouteRecord, "adapterConfig">): {
  readonly mode: "open" | "pairing";
  readonly allowFrom: string[];
} {
  const mode = route.adapterConfig.dmPolicy === "pairing" ? "pairing" : "open";
  const allowFrom = Array.isArray(route.adapterConfig.allowFrom)
    ? route.adapterConfig.allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
    : [];
  return {
    mode,
    allowFrom: Array.from(new Set(allowFrom)),
  };
}

export function shouldDefaultRouteToPairing(channelType: string): boolean {
  return pairingDefaultChannelTypes.has(channelType);
}

function defineChannel(
  channelType: string,
  overrides: Partial<Omit<ChannelCapabilityDescriptor, "channelType">>,
): ChannelCapabilityDescriptor {
  return {
    channelType,
    supportsInbound: false,
    supportsOutbound: false,
    supportsDm: false,
    supportsThreads: false,
    supportsFiles: false,
    supportsVoice: false,
    supportsMarkdown: false,
    supportsMentions: false,
    supportsPairing: pairingDefaultChannelTypes.has(channelType),
    requiresSignatureVerification: false,
    rateLimitProfile: "public",
    ...overrides,
  };
}

function buildChannelProviderManifest(capability: ChannelCapabilityDescriptor): ChannelProviderManifest {
  return {
    channelType: capability.channelType,
    displayName: CHANNEL_PROVIDER_DISPLAY_NAMES[capability.channelType] ?? capability.channelType,
    supportsInbound: capability.supportsInbound,
    supportsOutbound: capability.supportsOutbound,
    auth: {
      requiredSecrets: CHANNEL_PROVIDER_SECRETS[capability.channelType] ?? ["inboundSecret"],
      supportsSecretRefs: true,
    },
    security: {
      requiresSignatureVerification: capability.requiresSignatureVerification,
      defaultDmPolicy: shouldDefaultRouteToPairing(capability.channelType) ? "pairing" : "open",
    },
    outbound: {
      nativeSender:
        capability.supportsOutbound &&
        capability.channelType !== "canvas" &&
        capability.channelType !== "media" &&
        capability.channelType !== "voice",
      adapterConfig: CHANNEL_OUTBOUND_CONFIG[capability.channelType] ?? [],
    },
    setupNotes: buildProviderSetupNotes(capability),
  };
}

function buildChannelCapabilityFromPlugin(plugin: ChannelPlugin): ChannelCapabilityDescriptor {
  return {
    channelType: plugin.id,
    supportsInbound: plugin.capabilities.inbound,
    supportsOutbound: plugin.capabilities.outbound,
    supportsDm: plugin.capabilities.dm,
    supportsThreads: plugin.capabilities.threads,
    supportsFiles: plugin.capabilities.files,
    supportsVoice: plugin.capabilities.voice,
    supportsMarkdown: plugin.capabilities.markdown,
    supportsMentions: plugin.capabilities.mentions,
    supportsPairing: plugin.security.defaultDmPolicy === "pairing",
    requiresSignatureVerification: plugin.security.requiresSignatureVerification,
    rateLimitProfile: plugin.meta.providerGroup === "enterprise" ? "enterprise" : "public",
  };
}

function buildChannelProviderManifestFromPlugin(plugin: ChannelPlugin): ChannelProviderManifest {
  return {
    channelType: plugin.id,
    displayName: plugin.meta.name,
    supportsInbound: plugin.capabilities.inbound,
    supportsOutbound: plugin.capabilities.outbound,
    auth: {
      requiredSecrets: plugin.configSchema.requiredSecrets,
      supportsSecretRefs: plugin.security.supportsSecretRefs,
    },
    security: {
      requiresSignatureVerification: plugin.security.requiresSignatureVerification,
      defaultDmPolicy: plugin.security.defaultDmPolicy,
    },
    outbound: {
      nativeSender: plugin.outbound?.nativeSender === true,
      adapterConfig: plugin.configSchema.outboundFields,
    },
    setupNotes: plugin.setup.notes,
    plugin: {
      id: plugin.id,
      version: plugin.meta.version,
      agentTools: plugin.agentTools,
    },
  };
}

function buildProviderSetupNotes(capability: ChannelCapabilityDescriptor): string[] {
  const notes = [buildInboundSetupNote(capability.channelType)];
  if (capability.requiresSignatureVerification) {
    notes.push("Set route.inboundSecret and send it with x-omni-route-secret or a signature field.");
  }
  if (capability.supportsOutbound) {
    notes.push(`Set adapterType to ${capability.channelType} for native outbound delivery when provider credentials are configured.`);
  }
  return notes;
}

function buildInboundSetupNote(channelType: string): string {
  if (channelType === "feishu" || channelType === "dingtalk" || channelType === "teams") {
    return `POST normalized webhooks to /inbox/enterprise/${channelType}.`;
  }
  if (
    channelType === "whatsapp" ||
    channelType === "signal" ||
    channelType === "matrix" ||
    channelType === "voice" ||
    channelType === "canvas" ||
    channelType === "mobile-node" ||
    channelType === "media"
  ) {
    return `POST normalized webhooks to /inbox/consumer/${channelType}.`;
  }
  return "POST generic inbound messages to /inbox/messages.";
}

function normalizeRouteAdapterType(value: unknown): RouteAdapterType {
  return value === "canvas" ||
    value === "dingtalk" ||
    value === "discord" ||
    value === "feishu" ||
    value === "filesystem" ||
    value === "matrix" ||
    value === "media" ||
    value === "mobile-node" ||
    value === "slack" ||
    value === "signal" ||
    value === "teams" ||
    value === "telegram" ||
    value === "voice" ||
    value === "whatsapp" ||
    value === "webhook"
    ? value
    : "console";
}

function normalizeRouteAdapterConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function applyRouteDefaults(channelType: string, adapterConfig: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...adapterConfig };
  const dmPolicy = typeof normalized.dmPolicy === "string" ? normalized.dmPolicy.trim().toLowerCase() : undefined;
  if (dmPolicy === undefined || dmPolicy.length === 0) {
    if (shouldDefaultRouteToPairing(channelType)) {
      normalized.dmPolicy = "pairing";
    }
  } else if (dmPolicy === "open" || dmPolicy === "pairing") {
    normalized.dmPolicy = dmPolicy;
  } else {
    throw new RouteConfigurationError('Routes only support adapterConfig.dmPolicy of "open" or "pairing".');
  }

  if (Array.isArray(normalized.allowFrom)) {
    const allowFrom = normalized.allowFrom
      .map((entry) => String(entry).trim())
      .filter(Boolean);
    if (allowFrom.length > 0) {
      normalized.allowFrom = Array.from(new Set(allowFrom));
    } else {
      delete normalized.allowFrom;
    }
  }

  return normalized;
}

function validateRouteAdapterConfig(adapterType: RouteAdapterType, adapterConfig: Record<string, unknown>): void {
  if (adapterType === "filesystem" && !hasNonEmptyString(adapterConfig.outboxDir)) {
    throw new RouteConfigurationError("Filesystem routes require adapterConfig.outboxDir.");
  }
  if (
    adapterType === "filesystem" &&
    adapterConfig.transcriptRetentionMaxFiles !== undefined &&
    !isPositiveIntegerLike(adapterConfig.transcriptRetentionMaxFiles)
  ) {
    throw new RouteConfigurationError("Filesystem routes require adapterConfig.transcriptRetentionMaxFiles to be a positive integer when set.");
  }

  if (adapterType === "webhook" && !hasNonEmptyString(adapterConfig.url)) {
    throw new RouteConfigurationError("Webhook routes require adapterConfig.url.");
  }

  if (
    adapterType === "feishu" &&
    !hasNonEmptyString(adapterConfig.webhookUrl) &&
    !hasNonEmptyString(adapterConfig.tenantAccessToken)
  ) {
    throw new RouteConfigurationError("Feishu routes require adapterConfig.webhookUrl or adapterConfig.tenantAccessToken.");
  }

  if (
    adapterType === "dingtalk" &&
    !hasNonEmptyString(adapterConfig.webhookUrl) &&
    (!hasNonEmptyString(adapterConfig.accessToken) || !hasNonEmptyString(adapterConfig.robotCode))
  ) {
    throw new RouteConfigurationError("DingTalk routes require adapterConfig.webhookUrl or adapterConfig.accessToken plus adapterConfig.robotCode.");
  }

  if (
    adapterType === "teams" &&
    !hasNonEmptyString(adapterConfig.webhookUrl) &&
    !hasNonEmptyString(adapterConfig.graphAccessToken)
  ) {
    throw new RouteConfigurationError("Teams routes require adapterConfig.webhookUrl or adapterConfig.graphAccessToken.");
  }

  if (adapterType === "telegram" && !hasNonEmptyString(adapterConfig.botToken)) {
    throw new RouteConfigurationError("Telegram routes require adapterConfig.botToken.");
  }

  if (adapterType === "whatsapp" && !hasNonEmptyString(adapterConfig.accessToken)) {
    throw new RouteConfigurationError("WhatsApp routes require adapterConfig.accessToken.");
  }

  if (adapterType === "whatsapp" && !hasNonEmptyString(adapterConfig.phoneNumberId)) {
    throw new RouteConfigurationError("WhatsApp routes require adapterConfig.phoneNumberId.");
  }

  if (adapterType === "signal" && !hasNonEmptyString(adapterConfig.baseUrl)) {
    throw new RouteConfigurationError("Signal routes require adapterConfig.baseUrl.");
  }

  if (adapterType === "matrix" && !hasNonEmptyString(adapterConfig.homeserverUrl)) {
    throw new RouteConfigurationError("Matrix routes require adapterConfig.homeserverUrl.");
  }

  if (adapterType === "matrix" && !hasNonEmptyString(adapterConfig.accessToken)) {
    throw new RouteConfigurationError("Matrix routes require adapterConfig.accessToken.");
  }

  if (
    (adapterType === "canvas" ||
      adapterType === "media" ||
      adapterType === "mobile-node" ||
      adapterType === "voice") &&
    !hasNonEmptyString(adapterConfig.endpointUrl)
  ) {
    throw new RouteConfigurationError(`${adapterType} routes require adapterConfig.endpointUrl.`);
  }

  if (
    adapterType === "slack" &&
    !hasNonEmptyString(adapterConfig.webhookUrl) &&
    !hasNonEmptyString(adapterConfig.botToken)
  ) {
    throw new RouteConfigurationError("Slack routes require adapterConfig.webhookUrl or adapterConfig.botToken.");
  }

  if (
    adapterType === "discord" &&
    !hasNonEmptyString(adapterConfig.webhookUrl) &&
    !hasNonEmptyString(adapterConfig.botToken)
  ) {
    throw new RouteConfigurationError("Discord routes require adapterConfig.webhookUrl or adapterConfig.botToken.");
  }
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveIntegerLike(value: unknown): boolean {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isInteger(numeric) && numeric > 0;
}
