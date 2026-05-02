export interface MobileNodeClientOptions {
  readonly gatewayUrl: string;
  readonly deviceId: string;
  readonly endpointUrl: string;
  readonly serviceToken?: string;
  readonly inboundSecret?: string;
  readonly gatewayToken?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface MobileNodeRegistration {
  readonly protocol: string;
  readonly route: {
    readonly id: string;
    readonly channelType: string;
    readonly channelKey: string;
    readonly dmPolicy?: string;
  };
  readonly inboundUrl: string;
}

export interface MobileNodeEvent {
  readonly text: string;
  readonly channelMessageId?: string;
  readonly type?: "device_state" | "file" | "notification_action" | "text" | "voice";
  readonly metadata?: Record<string, unknown>;
  readonly async?: boolean;
}

export interface MobileDeliveryEnvelope {
  readonly type: "omni.mobile.delivery.v1";
  readonly deviceId: string;
  readonly route: {
    readonly id: string;
    readonly title: string;
    readonly channelType: "mobile-node";
    readonly channelKey: string;
  };
  readonly delivery: {
    readonly id: string;
    readonly runId: string | null;
    readonly createdAt: string;
  };
  readonly notification: {
    readonly title: string;
    readonly body: string;
  };
  readonly content: string;
  readonly metadata: Record<string, unknown>;
}

export interface MobileNodeClient {
  readonly options: MobileNodeClientOptions;
  getManifest(): Promise<Record<string, unknown>>;
  register(extra?: Record<string, unknown>): Promise<MobileNodeRegistration>;
  sendEvent(event: MobileNodeEvent): Promise<Record<string, unknown>>;
  parseDeliveryEnvelope(value: unknown): MobileDeliveryEnvelope;
}

export function createMobileNodeClient(options: MobileNodeClientOptions): MobileNodeClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeGatewayUrl(options.gatewayUrl);

  async function request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const headers = new Headers(init.headers);
    if (options.gatewayToken) {
      headers.set("authorization", `Bearer ${options.gatewayToken}`);
    }
    const response = await fetchImpl(new URL(path, baseUrl), {
      ...init,
      headers,
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : `Mobile node request failed with ${response.status}.`);
    }
    return payload;
  }

  return {
    options,
    getManifest() {
      return request("/mobile-node/manifest");
    },
    async register(extra = {}) {
      const payload = await request("/mobile-node/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...extra,
          deviceId: options.deviceId,
          endpointUrl: options.endpointUrl,
          serviceToken: options.serviceToken,
          inboundSecret: options.inboundSecret,
        }),
      });
      return normalizeRegistration(payload);
    },
    sendEvent(event) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options.inboundSecret) {
        headers["x-omni-route-secret"] = options.inboundSecret;
      }
      return request(`/mobile-node/${encodeURIComponent(options.deviceId)}/events`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...event,
          sender: options.deviceId,
        }),
      });
    },
    parseDeliveryEnvelope: parseMobileDeliveryEnvelope,
  };
}

export function parseMobileDeliveryEnvelope(value: unknown): MobileDeliveryEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Mobile delivery envelope must be an object.");
  }
  const envelope = value as Record<string, unknown>;
  if (envelope.type !== "omni.mobile.delivery.v1") {
    throw new Error("Unsupported mobile delivery envelope type.");
  }
  const deviceId = requireString(envelope.deviceId, "deviceId");
  const content = requireString(envelope.content, "content");
  const route = requireObject(envelope.route, "route");
  const delivery = requireObject(envelope.delivery, "delivery");
  const notification = requireObject(envelope.notification, "notification");
  return {
    type: "omni.mobile.delivery.v1",
    deviceId,
    route: {
      id: requireString(route.id, "route.id"),
      title: requireString(route.title, "route.title"),
      channelType: "mobile-node",
      channelKey: requireString(route.channelKey, "route.channelKey"),
    },
    delivery: {
      id: requireString(delivery.id, "delivery.id"),
      runId: typeof delivery.runId === "string" ? delivery.runId : null,
      createdAt: requireString(delivery.createdAt, "delivery.createdAt"),
    },
    notification: {
      title: requireString(notification.title, "notification.title"),
      body: requireString(notification.body, "notification.body"),
    },
    content,
    metadata: requireOptionalObject(envelope.metadata),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  const parsed = JSON.parse(text) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function normalizeGatewayUrl(value: string): URL {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function normalizeRegistration(value: Record<string, unknown>): MobileNodeRegistration {
  const route = requireObject(value.route, "route");
  return {
    protocol: requireString(value.protocol, "protocol"),
    route: {
      id: requireString(route.id, "route.id"),
      channelType: requireString(route.channelType, "route.channelType"),
      channelKey: requireString(route.channelKey, "route.channelKey"),
      dmPolicy: typeof route.dmPolicy === "string" ? route.dmPolicy : undefined,
    },
    inboundUrl: requireString(value.inboundUrl, "inboundUrl"),
  };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireOptionalObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}
