export type OutboundAttachmentType = "file" | "image" | "audio" | "video";

export interface OutboundAttachment {
  readonly type: OutboundAttachmentType;
  readonly url?: string;
  readonly name?: string;
  readonly mimeType?: string;
  readonly text?: string;
}

export interface OutboundMessage {
  readonly text: string;
  readonly markdown: boolean;
  readonly threadId: string | null;
  readonly replyToMessageId: string | null;
  readonly attachments: readonly OutboundAttachment[];
  readonly metadata: Record<string, unknown>;
}

export type PlatformOutboundPayloadKind =
  | "dingtalk"
  | "discord"
  | "feishu"
  | "matrix"
  | "slack"
  | "teams"
  | "telegram"
  | "whatsapp";

export function normalizeOutboundMessage(content: string, metadata?: Record<string, unknown>): OutboundMessage {
  const metadataRecord = normalizeRecord(metadata);
  const configured = normalizeRecord(metadataRecord.outboundMessage);
  const text = normalizeString(configured.text) ?? content;
  const markdown = normalizeBoolean(configured.markdown) ?? normalizeBoolean(metadataRecord.markdown) ?? false;
  const threadId =
    normalizeString(configured.threadId) ??
    normalizeString(metadataRecord.threadId) ??
    normalizeString(metadataRecord.threadTs) ??
    null;
  const replyToMessageId =
    normalizeString(configured.replyToMessageId) ?? normalizeString(metadataRecord.replyToMessageId) ?? null;
  return {
    text,
    markdown,
    threadId,
    replyToMessageId,
    attachments: normalizeAttachments(configured.attachments),
    metadata: metadataRecord,
  };
}

export function buildPlatformOutboundPayload(
  platform: PlatformOutboundPayloadKind,
  message: OutboundMessage,
): Record<string, unknown> {
  switch (platform) {
    case "slack":
      return buildSlackPayload(message);
    case "discord":
      return buildDiscordPayload(message);
    case "telegram":
      return buildTelegramPayload(message);
    case "whatsapp":
      return buildWhatsAppPayload(message);
    case "teams":
      return buildTeamsPayload(message);
    case "feishu":
      return {
        msg_type: "text",
        content: JSON.stringify({ text: message.text }),
      };
    case "dingtalk":
      return {
        msgKey: "sampleText",
        msgParam: JSON.stringify({ content: message.text }),
        msgtype: "text",
        text: { content: message.text },
      };
    case "matrix":
      return message.markdown
        ? {
            msgtype: "m.text",
            body: message.text,
            format: "org.matrix.custom.html",
            formatted_body: message.text,
          }
        : {
            msgtype: "m.text",
            body: message.text,
          };
  }
}

function buildSlackPayload(message: OutboundMessage): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    text: message.text,
  };
  if (message.threadId) {
    payload.thread_ts = message.threadId;
  }
  if (message.markdown) {
    payload.blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: message.text,
        },
      },
    ];
  }
  if (message.attachments.length > 0) {
    payload.attachments = message.attachments.map((attachment) => ({
      fallback: attachment.name ?? attachment.url ?? attachment.text ?? message.text,
      title: attachment.name,
      title_link: attachment.url,
      text: attachment.text,
    }));
  }
  return payload;
}

function buildDiscordPayload(message: OutboundMessage): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    content: message.text,
  };
  if (message.replyToMessageId) {
    payload.message_reference = { message_id: message.replyToMessageId };
  }
  if (message.attachments.length > 0) {
    payload.embeds = message.attachments.map((attachment) => ({
      title: attachment.name ?? attachment.text,
      description: attachment.text,
      url: attachment.url,
      image: attachment.type === "image" && attachment.url ? { url: attachment.url } : undefined,
    }));
  }
  return payload;
}

function buildTelegramPayload(message: OutboundMessage): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    text: message.text,
  };
  if (message.markdown) {
    payload.parse_mode = "Markdown";
  }
  if (message.replyToMessageId) {
    payload.reply_to_message_id = message.replyToMessageId;
  }
  return payload;
}

function buildWhatsAppPayload(message: OutboundMessage): Record<string, unknown> {
  const media = message.attachments.find((attachment) => Boolean(attachment.url));
  const base: Record<string, unknown> = {
    messaging_product: "whatsapp",
  };
  if (!media?.url) {
    return {
      ...base,
      type: "text",
      text: {
        body: message.text,
        preview_url: true,
      },
    };
  }

  const whatsappMediaType = media.type === "file" ? "document" : media.type;
  return {
    ...base,
    type: whatsappMediaType,
    [whatsappMediaType]: {
      link: media.url,
      caption: message.text,
      filename: media.name,
    },
  };
}

function buildTeamsPayload(message: OutboundMessage): Record<string, unknown> {
  return {
    body: {
      contentType: message.markdown ? "html" : "text",
      content: message.text,
    },
    attachments: message.attachments.map((attachment) => ({
      contentType: attachment.mimeType ?? "application/vnd.microsoft.card.hero",
      contentUrl: attachment.url,
      name: attachment.name,
    })),
  };
}

function normalizeAttachments(value: unknown): OutboundAttachment[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry): OutboundAttachment | null => {
      const record = normalizeRecord(entry);
      const type = normalizeAttachmentType(record.type);
      if (!type) {
        return null;
      }
      return {
        type,
        url: normalizeString(record.url) ?? undefined,
        name: normalizeString(record.name) ?? undefined,
        mimeType: normalizeString(record.mimeType) ?? undefined,
        text: normalizeString(record.text) ?? undefined,
      };
    })
    .filter((entry): entry is OutboundAttachment => entry !== null);
}

function normalizeAttachmentType(value: unknown): OutboundAttachmentType | null {
  if (value === "file" || value === "image" || value === "audio" || value === "video") {
    return value;
  }
  return null;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
