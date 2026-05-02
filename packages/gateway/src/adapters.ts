import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ChannelRouteRecord, OutboundDeliveryRecord, RouteAdapterType } from "@omni-agent/session-store";

import { listDefaultChannelPlugins, type ChannelPlugin } from "./channel-plugin.js";
import { buildPlatformOutboundPayload, normalizeOutboundMessage } from "./messages.js";

export interface RouteAdapterSendRequest {
  readonly route: ChannelRouteRecord;
  readonly delivery: OutboundDeliveryRecord;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}

export interface RouteAdapterSendResult {
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
}

export interface RouteAdapter {
  readonly type: RouteAdapterType;
  send(request: RouteAdapterSendRequest): Promise<RouteAdapterSendResult>;
}

export class RouteAdapterRegistry {
  private readonly adapters = new Map<RouteAdapterType, RouteAdapter>();

  public register(adapter: RouteAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  public list(): RouteAdapterType[] {
    return Array.from(this.adapters.keys()).sort();
  }

  public async send(request: RouteAdapterSendRequest): Promise<RouteAdapterSendResult> {
    const adapter = this.adapters.get(request.route.adapterType);
    if (!adapter) {
      return {
        ok: false,
        summary: `No adapter is registered for route adapter type "${request.route.adapterType}".`,
      };
    }
    return adapter.send(request);
  }
}

export function createDefaultRouteAdapterRegistry(): RouteAdapterRegistry {
  const registry = new RouteAdapterRegistry();
  for (const plugin of listDefaultChannelPlugins()) {
    registry.register(createChannelPluginRouteAdapter(plugin));
  }
  registry.register(createCanvasRouteAdapter());
  registry.register(createConsoleRouteAdapter());
  registry.register(createDingTalkRouteAdapter());
  registry.register(createDiscordRouteAdapter());
  registry.register(createFeishuRouteAdapter());
  registry.register(createFilesystemRouteAdapter());
  registry.register(createMatrixRouteAdapter());
  registry.register(createMediaRouteAdapter());
  registry.register(createMobileNodeRouteAdapter());
  registry.register(createSlackRouteAdapter());
  registry.register(createSignalRouteAdapter());
  registry.register(createTeamsRouteAdapter());
  registry.register(createWebhookRouteAdapter());
  registry.register(createTelegramRouteAdapter());
  registry.register(createVoiceRouteAdapter());
  registry.register(createWhatsAppRouteAdapter());
  return registry;
}

function createChannelPluginRouteAdapter(plugin: ChannelPlugin): RouteAdapter {
  return {
    type: plugin.bindings.routeAdapterType,
    async send(request): Promise<RouteAdapterSendResult> {
      if (!plugin.outbound) {
        return {
          ok: false,
          summary: `Channel plugin ${plugin.id} does not support outbound delivery.`,
        };
      }
      return plugin.outbound.send(request);
    },
  };
}

function createConsoleRouteAdapter(): RouteAdapter {
  return {
    type: "console",
    async send(request): Promise<RouteAdapterSendResult> {
      console.log(
        `[Omni Route ${request.route.title}] ${request.content}`,
      );
      return {
        ok: true,
        summary: `Delivered response to console route ${request.route.title}.`,
      };
    },
  };
}

function createFilesystemRouteAdapter(): RouteAdapter {
  return {
    type: "filesystem",
    async send(request): Promise<RouteAdapterSendResult> {
      const outboxDir = typeof request.route.adapterConfig.outboxDir === "string"
        ? request.route.adapterConfig.outboxDir
        : null;
      if (!outboxDir) {
        return {
          ok: false,
          summary: `Filesystem route ${request.route.title} is missing adapterConfig.outboxDir.`,
        };
      }

      const resolvedDir = resolve(outboxDir);
      await mkdir(resolvedDir, { recursive: true });
      const outputPath = join(resolvedDir, `${request.delivery.id}.json`);
      await writeFile(
        outputPath,
        JSON.stringify(
          {
            route: {
              id: request.route.id,
              title: request.route.title,
              channelType: request.route.channelType,
              channelKey: request.route.channelKey,
            },
            delivery: {
              id: request.delivery.id,
              runId: request.delivery.runId,
              createdAt: request.delivery.createdAt,
            },
            content: request.content,
            metadata: request.metadata ?? {},
          },
          null,
          2,
        ),
        "utf8",
      );
      const retentionMaxFiles = normalizeTranscriptRetentionMaxFiles(request.route.adapterConfig.transcriptRetentionMaxFiles);
      if (retentionMaxFiles !== null) {
        await pruneFilesystemTranscripts(resolvedDir, retentionMaxFiles);
      }
      return {
        ok: true,
        summary: `Delivered response to filesystem outbox ${outputPath}.`,
        data: {
          directory: resolvedDir,
          path: outputPath,
          ...(retentionMaxFiles !== null ? { retention: { maxFiles: retentionMaxFiles } } : {}),
        },
      };
    },
  };
}

function normalizeTranscriptRetentionMaxFiles(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

async function pruneFilesystemTranscripts(directory: string, maxFiles: number): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        const path = join(directory, entry.name);
        const fileStat = await stat(path);
        return { name: entry.name, path, mtimeMs: fileStat.mtimeMs };
      }),
  );
  const removable = files
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name))
    .slice(0, Math.max(0, files.length - maxFiles));
  await Promise.all(removable.map((entry) => unlink(entry.path).catch(() => undefined)));
}

function createSlackRouteAdapter(): RouteAdapter {
  return {
    type: "slack",
    async send(request): Promise<RouteAdapterSendResult> {
      const webhookUrl = typeof request.route.adapterConfig.webhookUrl === "string"
        ? request.route.adapterConfig.webhookUrl
        : null;
      if (webhookUrl) {
        return sendWebhookStyleMessage(
          webhookUrl,
          buildPlatformOutboundPayload("slack", normalizeOutboundMessage(request.content, request.metadata)),
          "Slack webhook",
        );
      }

      const botToken = typeof request.route.adapterConfig.botToken === "string"
        ? request.route.adapterConfig.botToken
        : null;
      if (!botToken) {
        return {
          ok: false,
          summary: `Slack route ${request.route.title} requires adapterConfig.webhookUrl or adapterConfig.botToken.`,
        };
      }

      const baseUrl = typeof request.route.adapterConfig.baseUrl === "string"
        ? request.route.adapterConfig.baseUrl
        : "https://slack.com/api";
      const channelId = String(request.route.adapterConfig.channelId ?? request.route.channelKey ?? "").trim();
      if (!channelId) {
        return {
          ok: false,
          summary: `Slack route ${request.route.title} is missing a channel id.`,
        };
      }

      const outboundMessage = normalizeOutboundMessage(request.content, request.metadata);
      const payload: Record<string, unknown> = {
        ...buildPlatformOutboundPayload("slack", outboundMessage),
        channel: channelId,
      };
      const threadTs = outboundMessage.threadId ?? (typeof request.route.adapterConfig.threadTs === "string"
        ? request.route.adapterConfig.threadTs
        : null);
      if (threadTs) {
        payload.thread_ts = threadTs;
      }

      const response = await fetch(buildApiUrl(baseUrl, "chat.postMessage"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify(payload),
      });

      const parsed = await readResponsePayload(response);
      const slackOk =
        parsed.json && typeof parsed.json === "object" && !Array.isArray(parsed.json)
          ? Boolean((parsed.json as Record<string, unknown>).ok)
          : response.ok;
      const errorMessage =
        parsed.json && typeof parsed.json === "object" && !Array.isArray(parsed.json)
          ? String((parsed.json as Record<string, unknown>).error ?? "")
          : "";
      return {
        ok: response.ok && slackOk,
        summary:
          response.ok && slackOk
            ? `Delivered response to Slack channel ${channelId}.`
            : `Slack delivery to channel ${channelId} failed${errorMessage ? `: ${errorMessage}` : ` with ${response.status}`}.`,
        data: {
          status: response.status,
          body: parsed.text,
          json: parsed.json,
        },
      };
    },
  };
}

function createWebhookRouteAdapter(): RouteAdapter {
  return {
    type: "webhook",
    async send(request): Promise<RouteAdapterSendResult> {
      const url = typeof request.route.adapterConfig.url === "string"
        ? request.route.adapterConfig.url
        : null;
      if (!url) {
        return {
          ok: false,
          summary: `Webhook route ${request.route.title} is missing adapterConfig.url.`,
        };
      }

      const method = typeof request.route.adapterConfig.method === "string"
        ? request.route.adapterConfig.method.toUpperCase()
        : "POST";
      const configuredHeaders = request.route.adapterConfig.headers;
      const headers =
        configuredHeaders && typeof configuredHeaders === "object" && !Array.isArray(configuredHeaders)
          ? Object.fromEntries(
              Object.entries(configuredHeaders as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
            )
          : {};

      const response = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          route: {
            id: request.route.id,
            title: request.route.title,
            channelType: request.route.channelType,
            channelKey: request.route.channelKey,
          },
          delivery: {
            id: request.delivery.id,
            runId: request.delivery.runId,
            createdAt: request.delivery.createdAt,
          },
          content: request.content,
          metadata: request.metadata ?? {},
        }),
      });

      const responseText = await response.text();
      return {
        ok: response.ok,
        summary: response.ok
          ? `Delivered response to webhook ${url} (${response.status}).`
          : `Webhook delivery to ${url} failed with ${response.status}.`,
        data: {
          status: response.status,
          body: responseText,
        },
      };
    },
  };
}

function createDiscordRouteAdapter(): RouteAdapter {
  return {
    type: "discord",
    async send(request): Promise<RouteAdapterSendResult> {
      const webhookUrl = typeof request.route.adapterConfig.webhookUrl === "string"
        ? request.route.adapterConfig.webhookUrl
        : null;
      if (webhookUrl) {
        return sendWebhookStyleMessage(
          webhookUrl,
          buildPlatformOutboundPayload("discord", normalizeOutboundMessage(request.content, request.metadata)),
          "Discord webhook",
        );
      }

      const botToken = typeof request.route.adapterConfig.botToken === "string"
        ? request.route.adapterConfig.botToken
        : null;
      if (!botToken) {
        return {
          ok: false,
          summary: `Discord route ${request.route.title} requires adapterConfig.webhookUrl or adapterConfig.botToken.`,
        };
      }

      const baseUrl = typeof request.route.adapterConfig.baseUrl === "string"
        ? request.route.adapterConfig.baseUrl
        : "https://discord.com/api/v10";
      const channelId = String(request.route.adapterConfig.channelId ?? request.route.channelKey ?? "").trim();
      if (!channelId) {
        return {
          ok: false,
          summary: `Discord route ${request.route.title} is missing a channel id.`,
        };
      }

      const payload = buildPlatformOutboundPayload("discord", normalizeOutboundMessage(request.content, request.metadata));

      const response = await fetch(buildApiUrl(baseUrl, `channels/${channelId}/messages`), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify(payload),
      });

      const parsed = await readResponsePayload(response);
      return {
        ok: response.ok,
        summary: response.ok
          ? `Delivered response to Discord channel ${channelId}.`
          : `Discord delivery to channel ${channelId} failed with ${response.status}.`,
        data: {
          status: response.status,
          body: parsed.text,
          json: parsed.json,
        },
      };
    },
  };
}

function createFeishuRouteAdapter(): RouteAdapter {
  return {
    type: "feishu",
    async send(request): Promise<RouteAdapterSendResult> {
      const webhookUrl = typeof request.route.adapterConfig.webhookUrl === "string"
        ? request.route.adapterConfig.webhookUrl
        : null;
      if (!webhookUrl) {
        return sendFeishuNativeMessage(request);
      }
      return sendWebhookStyleMessage(
        webhookUrl,
        {
          msg_type: "text",
          content: {
            text: normalizeOutboundMessage(request.content, request.metadata).text,
          },
        },
        "Feishu webhook",
      );
    },
  };
}

async function sendFeishuNativeMessage(request: RouteAdapterSendRequest): Promise<RouteAdapterSendResult> {
  const tenantAccessToken = typeof request.route.adapterConfig.tenantAccessToken === "string"
    ? request.route.adapterConfig.tenantAccessToken
    : null;
  if (!tenantAccessToken) {
    return {
      ok: false,
      summary: `Feishu route ${request.route.title} requires adapterConfig.webhookUrl or adapterConfig.tenantAccessToken.`,
    };
  }
  const receiveId = String(request.route.adapterConfig.receiveId ?? request.route.channelKey ?? "").trim();
  if (!receiveId) {
    return {
      ok: false,
      summary: `Feishu route ${request.route.title} is missing a receive id.`,
    };
  }
  const baseUrl = typeof request.route.adapterConfig.baseUrl === "string"
    ? request.route.adapterConfig.baseUrl
    : "https://open.feishu.cn";
  const receiveIdType = typeof request.route.adapterConfig.receiveIdType === "string"
    ? request.route.adapterConfig.receiveIdType
    : "chat_id";
  const url = new URL(buildApiUrl(baseUrl, "open-apis/im/v1/messages"));
  url.searchParams.set("receive_id_type", receiveIdType);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${tenantAccessToken}`,
    },
    body: JSON.stringify({
      receive_id: receiveId,
      ...buildPlatformOutboundPayload("feishu", normalizeOutboundMessage(request.content, request.metadata)),
    }),
  });
  const parsed = await readResponsePayload(response);
  const feishuOk =
    parsed.json && typeof parsed.json === "object" && !Array.isArray(parsed.json)
      ? Number((parsed.json as Record<string, unknown>).code ?? 0) === 0
      : response.ok;
  return {
    ok: response.ok && feishuOk,
    summary:
      response.ok && feishuOk
        ? `Delivered response to Feishu receive id ${receiveId}.`
        : `Feishu native delivery to ${receiveId} failed with ${response.status}.`,
    data: {
      status: response.status,
      body: parsed.text,
      json: parsed.json,
    },
  };
}

function createDingTalkRouteAdapter(): RouteAdapter {
  return {
    type: "dingtalk",
    async send(request): Promise<RouteAdapterSendResult> {
      const webhookUrl = typeof request.route.adapterConfig.webhookUrl === "string"
        ? request.route.adapterConfig.webhookUrl
        : null;
      if (!webhookUrl) {
        return sendDingTalkNativeMessage(request);
      }
      return sendWebhookStyleMessage(
        webhookUrl,
        buildPlatformOutboundPayload("dingtalk", normalizeOutboundMessage(request.content, request.metadata)),
        "DingTalk webhook",
      );
    },
  };
}

async function sendDingTalkNativeMessage(request: RouteAdapterSendRequest): Promise<RouteAdapterSendResult> {
  const accessToken = typeof request.route.adapterConfig.accessToken === "string"
    ? request.route.adapterConfig.accessToken
    : null;
  const robotCode = typeof request.route.adapterConfig.robotCode === "string"
    ? request.route.adapterConfig.robotCode
    : null;
  if (!accessToken || !robotCode) {
    return {
      ok: false,
      summary: `DingTalk route ${request.route.title} requires adapterConfig.webhookUrl or adapterConfig.accessToken plus adapterConfig.robotCode.`,
    };
  }
  const userIds = normalizeStringList(request.route.adapterConfig.userIds);
  const openConversationId = typeof request.route.adapterConfig.openConversationId === "string"
    ? request.route.adapterConfig.openConversationId.trim()
    : "";
  if (userIds.length === 0 && !openConversationId) {
    return {
      ok: false,
      summary: `DingTalk route ${request.route.title} requires adapterConfig.userIds or adapterConfig.openConversationId.`,
    };
  }
  const baseUrl = typeof request.route.adapterConfig.baseUrl === "string"
    ? request.route.adapterConfig.baseUrl
    : "https://api.dingtalk.com";
  const endpointPath = openConversationId
    ? "v1.0/robot/groupMessages/send"
    : "v1.0/robot/oToMessages/batchSend";
  const payload: Record<string, unknown> = {
    ...buildPlatformOutboundPayload("dingtalk", normalizeOutboundMessage(request.content, request.metadata)),
    robotCode,
  };
  if (openConversationId) {
    payload.openConversationId = openConversationId;
  } else {
    payload.userIds = userIds;
  }
  const response = await fetch(buildApiUrl(baseUrl, endpointPath), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-acs-dingtalk-access-token": accessToken,
    },
    body: JSON.stringify(payload),
  });
  const parsed = await readResponsePayload(response);
  return {
    ok: response.ok,
    summary: response.ok
      ? `Delivered response through DingTalk robot ${robotCode}.`
      : `DingTalk native delivery failed with ${response.status}.`,
    data: {
      status: response.status,
      body: parsed.text,
      json: parsed.json,
    },
  };
}

function createTeamsRouteAdapter(): RouteAdapter {
  return {
    type: "teams",
    async send(request): Promise<RouteAdapterSendResult> {
      const webhookUrl = typeof request.route.adapterConfig.webhookUrl === "string"
        ? request.route.adapterConfig.webhookUrl
        : null;
      if (!webhookUrl) {
        return sendTeamsGraphMessage(request);
      }
      return sendWebhookStyleMessage(
        webhookUrl,
        {
          text: normalizeOutboundMessage(request.content, request.metadata).text,
        },
        "Teams webhook",
      );
    },
  };
}

async function sendTeamsGraphMessage(request: RouteAdapterSendRequest): Promise<RouteAdapterSendResult> {
  const graphAccessToken = typeof request.route.adapterConfig.graphAccessToken === "string"
    ? request.route.adapterConfig.graphAccessToken
    : null;
  if (!graphAccessToken) {
    return {
      ok: false,
      summary: `Teams route ${request.route.title} requires adapterConfig.webhookUrl or adapterConfig.graphAccessToken.`,
    };
  }
  const chatId = typeof request.route.adapterConfig.chatId === "string" ? request.route.adapterConfig.chatId.trim() : "";
  const teamId = typeof request.route.adapterConfig.teamId === "string" ? request.route.adapterConfig.teamId.trim() : "";
  const channelId = String(request.route.adapterConfig.channelId ?? request.route.channelKey ?? "").trim();
  if (!chatId && (!teamId || !channelId)) {
    return {
      ok: false,
      summary: `Teams route ${request.route.title} requires adapterConfig.chatId or adapterConfig.teamId plus channelId.`,
    };
  }
  const baseUrl = typeof request.route.adapterConfig.baseUrl === "string"
    ? request.route.adapterConfig.baseUrl
    : "https://graph.microsoft.com/v1.0";
  const path = chatId
    ? `chats/${encodeURIComponent(chatId)}/messages`
    : `teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`;
  const response = await fetch(buildApiUrl(baseUrl, path), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${graphAccessToken}`,
    },
    body: JSON.stringify(buildPlatformOutboundPayload("teams", normalizeOutboundMessage(request.content, request.metadata))),
  });
  const parsed = await readResponsePayload(response);
  return {
    ok: response.ok,
    summary: response.ok
      ? `Delivered response through Microsoft Graph ${chatId ? `chat ${chatId}` : `channel ${channelId}`}.`
      : `Teams Graph delivery failed with ${response.status}.`,
    data: {
      status: response.status,
      body: parsed.text,
      json: parsed.json,
    },
  };
}

function createTelegramRouteAdapter(): RouteAdapter {
  return {
    type: "telegram",
    async send(request): Promise<RouteAdapterSendResult> {
      const botToken = typeof request.route.adapterConfig.botToken === "string"
        ? request.route.adapterConfig.botToken
        : null;
      if (!botToken) {
        return {
          ok: false,
          summary: `Telegram route ${request.route.title} is missing adapterConfig.botToken.`,
        };
      }

      const baseUrl = typeof request.route.adapterConfig.baseUrl === "string"
        ? request.route.adapterConfig.baseUrl
        : "https://api.telegram.org";
      const chatId = String(request.route.adapterConfig.chatId ?? request.route.channelKey ?? "").trim();
      if (!chatId) {
        return {
          ok: false,
          summary: `Telegram route ${request.route.title} is missing a chat id.`,
        };
      }

      const url = buildTelegramApiUrl(baseUrl, botToken, "sendMessage");
      const payload = buildPlatformOutboundPayload("telegram", normalizeOutboundMessage(request.content, request.metadata));
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          chat_id: chatId,
          parse_mode:
            typeof request.route.adapterConfig.parseMode === "string"
              ? request.route.adapterConfig.parseMode
              : payload.parse_mode,
        }),
      });

      const responseText = await response.text();
      return {
        ok: response.ok,
        summary: response.ok
          ? `Delivered response to Telegram chat ${chatId}.`
          : `Telegram delivery to chat ${chatId} failed with ${response.status}.`,
        data: {
          status: response.status,
          body: responseText,
        },
      };
    },
  };
}

function createWhatsAppRouteAdapter(): RouteAdapter {
  return {
    type: "whatsapp",
    async send(request): Promise<RouteAdapterSendResult> {
      const accessToken = typeof request.route.adapterConfig.accessToken === "string"
        ? request.route.adapterConfig.accessToken
        : null;
      const phoneNumberId = typeof request.route.adapterConfig.phoneNumberId === "string"
        ? request.route.adapterConfig.phoneNumberId
        : null;
      if (!accessToken || !phoneNumberId) {
        return {
          ok: false,
          summary: `WhatsApp route ${request.route.title} requires adapterConfig.accessToken and adapterConfig.phoneNumberId.`,
        };
      }

      const baseUrl = typeof request.route.adapterConfig.baseUrl === "string"
        ? request.route.adapterConfig.baseUrl
        : "https://graph.facebook.com/v20.0";
      const recipient = String(request.route.adapterConfig.to ?? request.route.channelKey ?? "").trim();
      if (!recipient) {
        return {
          ok: false,
          summary: `WhatsApp route ${request.route.title} is missing a recipient.`,
        };
      }

      const response = await fetch(buildApiUrl(baseUrl, `${phoneNumberId}/messages`), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          ...buildPlatformOutboundPayload("whatsapp", normalizeOutboundMessage(request.content, request.metadata)),
          to: recipient,
        }),
      });

      const parsed = await readResponsePayload(response);
      return {
        ok: response.ok,
        summary: response.ok
          ? `Delivered response to WhatsApp recipient ${recipient}.`
          : `WhatsApp delivery to recipient ${recipient} failed with ${response.status}.`,
        data: {
          status: response.status,
          body: parsed.text,
          json: parsed.json,
        },
      };
    },
  };
}

function createSignalRouteAdapter(): RouteAdapter {
  return {
    type: "signal",
    async send(request): Promise<RouteAdapterSendResult> {
      const baseUrl = typeof request.route.adapterConfig.baseUrl === "string"
        ? request.route.adapterConfig.baseUrl
        : null;
      if (!baseUrl) {
        return {
          ok: false,
          summary: `Signal route ${request.route.title} requires adapterConfig.baseUrl.`,
        };
      }

      const recipient = String(request.route.adapterConfig.recipient ?? request.route.channelKey ?? "").trim();
      if (!recipient) {
        return {
          ok: false,
          summary: `Signal route ${request.route.title} is missing a recipient.`,
        };
      }

      const endpointPath = typeof request.route.adapterConfig.endpointPath === "string"
        ? request.route.adapterConfig.endpointPath
        : "v2/send";
      const serviceToken = typeof request.route.adapterConfig.serviceToken === "string"
        ? request.route.adapterConfig.serviceToken
        : null;
      const response = await fetch(buildApiUrl(baseUrl, endpointPath), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(serviceToken ? { authorization: `Bearer ${serviceToken}` } : {}),
        },
        body: JSON.stringify({
          message: request.content,
          recipients: [recipient],
        }),
      });

      const parsed = await readResponsePayload(response);
      return {
        ok: response.ok,
        summary: response.ok
          ? `Delivered response to Signal recipient ${recipient}.`
          : `Signal delivery to recipient ${recipient} failed with ${response.status}.`,
        data: {
          status: response.status,
          body: parsed.text,
          json: parsed.json,
        },
      };
    },
  };
}

function createMatrixRouteAdapter(): RouteAdapter {
  return {
    type: "matrix",
    async send(request): Promise<RouteAdapterSendResult> {
      const homeserverUrl = typeof request.route.adapterConfig.homeserverUrl === "string"
        ? request.route.adapterConfig.homeserverUrl
        : null;
      const accessToken = typeof request.route.adapterConfig.accessToken === "string"
        ? request.route.adapterConfig.accessToken
        : null;
      if (!homeserverUrl || !accessToken) {
        return {
          ok: false,
          summary: `Matrix route ${request.route.title} requires adapterConfig.homeserverUrl and adapterConfig.accessToken.`,
        };
      }

      const roomId = String(request.route.adapterConfig.roomId ?? request.route.channelKey ?? "").trim();
      if (!roomId) {
        return {
          ok: false,
          summary: `Matrix route ${request.route.title} is missing a room id.`,
        };
      }

      const transactionId = `${request.delivery.id}-${Date.now()}`;
      const url = buildApiUrl(
        homeserverUrl,
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(transactionId)}`,
      );
      const response = await fetch(url, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(buildPlatformOutboundPayload("matrix", normalizeOutboundMessage(request.content, request.metadata))),
      });

      const parsed = await readResponsePayload(response);
      return {
        ok: response.ok,
        summary: response.ok
          ? `Delivered response to Matrix room ${roomId}.`
          : `Matrix delivery to room ${roomId} failed with ${response.status}.`,
        data: {
          status: response.status,
          body: parsed.text,
          json: parsed.json,
        },
      };
    },
  };
}

function createVoiceRouteAdapter(): RouteAdapter {
  return createEndpointRouteAdapter("voice");
}

function createCanvasRouteAdapter(): RouteAdapter {
  return createEndpointRouteAdapter("canvas");
}

function createMobileNodeRouteAdapter(): RouteAdapter {
  return {
    type: "mobile-node",
    async send(request): Promise<RouteAdapterSendResult> {
      const endpointUrl = typeof request.route.adapterConfig.endpointUrl === "string"
        ? request.route.adapterConfig.endpointUrl
        : null;
      if (!endpointUrl) {
        return {
          ok: false,
          summary: `mobile-node route ${request.route.title} requires adapterConfig.endpointUrl.`,
        };
      }

      const deviceId = String(request.route.adapterConfig.deviceId ?? request.route.channelKey ?? "").trim();
      const serviceToken = typeof request.route.adapterConfig.serviceToken === "string"
        ? request.route.adapterConfig.serviceToken
        : null;
      const response = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(serviceToken ? { authorization: `Bearer ${serviceToken}` } : {}),
        },
        body: JSON.stringify({
          type: "omni.mobile.delivery.v1",
          deviceId,
          route: {
            id: request.route.id,
            title: request.route.title,
            channelType: request.route.channelType,
            channelKey: request.route.channelKey,
          },
          delivery: {
            id: request.delivery.id,
            runId: request.delivery.runId,
            createdAt: request.delivery.createdAt,
          },
          notification: {
            title: request.route.title,
            body: request.content,
          },
          content: request.content,
          message: normalizeOutboundMessage(request.content, request.metadata),
          metadata: request.metadata ?? {},
        }),
      });

      const parsed = await readResponsePayload(response);
      return {
        ok: response.ok,
        summary: response.ok
          ? `Delivered response to mobile node ${deviceId || request.route.channelKey}.`
          : `mobile-node endpoint delivery failed with ${response.status}.`,
        data: {
          status: response.status,
          body: parsed.text,
          json: parsed.json,
        },
      };
    },
  };
}

function createMediaRouteAdapter(): RouteAdapter {
  return createEndpointRouteAdapter("media");
}

function createEndpointRouteAdapter(type: "canvas" | "media" | "mobile-node" | "voice"): RouteAdapter {
  return {
    type,
    async send(request): Promise<RouteAdapterSendResult> {
      const endpointUrl = typeof request.route.adapterConfig.endpointUrl === "string"
        ? request.route.adapterConfig.endpointUrl
        : null;
      if (!endpointUrl) {
        return {
          ok: false,
          summary: `${type} route ${request.route.title} requires adapterConfig.endpointUrl.`,
        };
      }

      const serviceToken = typeof request.route.adapterConfig.serviceToken === "string"
        ? request.route.adapterConfig.serviceToken
        : null;
      const response = await fetch(endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(serviceToken ? { authorization: `Bearer ${serviceToken}` } : {}),
        },
        body: JSON.stringify({
          route: {
            id: request.route.id,
            title: request.route.title,
            channelType: request.route.channelType,
            channelKey: request.route.channelKey,
          },
          delivery: {
            id: request.delivery.id,
            runId: request.delivery.runId,
            createdAt: request.delivery.createdAt,
          },
          content: request.content,
          message: normalizeOutboundMessage(request.content, request.metadata),
          metadata: request.metadata ?? {},
        }),
      });

      const parsed = await readResponsePayload(response);
      return {
        ok: response.ok,
        summary: response.ok
          ? `Delivered response to ${type} endpoint.`
          : `${type} endpoint delivery failed with ${response.status}.`,
        data: {
          status: response.status,
          body: parsed.text,
          json: parsed.json,
        },
      };
    },
  };
}

function buildTelegramApiUrl(baseUrl: string, botToken: string, method: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(`bot${botToken}/${method}`, normalized).toString();
}

function buildApiUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalized).toString();
}

async function sendWebhookStyleMessage(
  url: string,
  payload: Record<string, unknown>,
  label: string,
): Promise<RouteAdapterSendResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const parsed = await readResponsePayload(response);
  return {
    ok: response.ok,
    summary: response.ok
      ? `Delivered response via ${label}.`
      : `${label} delivery failed with ${response.status}.`,
    data: {
      status: response.status,
      body: parsed.text,
      json: parsed.json,
    },
  };
}

async function readResponsePayload(response: Response): Promise<{ text: string; json: unknown | null }> {
  const text = await response.text();
  if (!text.trim()) {
    return { text, json: null };
  }
  try {
    return {
      text,
      json: JSON.parse(text) as unknown,
    };
  } catch {
    return {
      text,
      json: null,
    };
  }
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((entry) => String(entry).trim()).filter(Boolean)));
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}
