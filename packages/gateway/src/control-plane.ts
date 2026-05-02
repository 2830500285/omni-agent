import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import { basename } from "node:path";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { GatewayEvent, GatewayEventBus } from "./event-bus.js";

export interface GatewayNodeRecord {
  readonly id: string;
  readonly name: string;
  readonly capabilities: string[];
  readonly metadata: Record<string, unknown>;
  readonly transport: "websocket";
  readonly status: "connected" | "disconnected";
  readonly connectionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastSeenAt: string;
}

interface GatewayControlClientState {
  readonly id: string;
  readonly socket: WebSocket;
  subscriptions: Set<string>;
  nodeId: string | null;
}

const SUPPORTED_CONTROL_PLANE_MESSAGE_TYPES = [
  "subscribe",
  "ping",
  "node.register",
  "node.heartbeat",
  "nodes.list",
  "run.start",
  "route.deliver",
  "delivery.retry",
  "subagent.control",
  "inbox.accept",
] as const;

type GatewayControlPlaneMessageType = (typeof SUPPORTED_CONTROL_PLANE_MESSAGE_TYPES)[number];

const SUPPORTED_CONTROL_PLANE_SUBSCRIPTIONS = new Set([
  "all",
  "events",
  "jobs",
  "runs",
  "subagents",
  "automations",
  "deliveries",
  "inbox",
  "routes",
  "nodes",
]);

export interface GatewayControlPlaneHandlers {
  readonly onInboundMessage?: (payload: Record<string, unknown>) => Promise<unknown>;
  readonly onRouteDelivery?: (payload: Record<string, unknown>) => Promise<unknown>;
  readonly onDeliveryRetry?: (payload: Record<string, unknown>) => Promise<unknown>;
  readonly onRunRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
  readonly onSubagentControl?: (payload: Record<string, unknown>) => Promise<unknown>;
}

export interface GatewayControlPlaneOptions extends GatewayControlPlaneHandlers {
  readonly accessToken?: string;
  readonly eventBus: GatewayEventBus;
  readonly server: HttpServer;
}

export class GatewayControlPlane {
  private readonly clients = new Map<string, GatewayControlClientState>();
  private readonly nodes = new Map<string, GatewayNodeRecord>();
  private readonly websocketServer = new WebSocketServer({ noServer: true });
  private readonly unsubscribe: () => void;

  public constructor(private readonly options: GatewayControlPlaneOptions) {
    this.unsubscribe = options.eventBus.subscribe((event) => {
      this.broadcastEvent(event);
    });

    this.options.server.on("upgrade", this.handleUpgrade);
    this.websocketServer.on("connection", (socket: WebSocket) => {
      this.handleConnection(socket);
    });
  }

  public listNodes(): GatewayNodeRecord[] {
    return Array.from(this.nodes.values()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public getNode(nodeId: string): GatewayNodeRecord | null {
    return this.nodes.get(nodeId) ?? null;
  }

  public async close(): Promise<void> {
    this.unsubscribe();
    this.options.server.off("upgrade", this.handleUpgrade);
    for (const client of this.clients.values()) {
      try {
        client.socket.close();
      } catch {
        // Ignore teardown races while the gateway is shutting down.
      }
    }
    await new Promise<void>((resolvePromise) => {
      this.websocketServer.close(() => {
        resolvePromise();
      });
    });
  }

  private readonly handleUpgrade = (request: IncomingMessage, socket: import("node:net").Socket, head: Buffer): void => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/ws") {
      return;
    }

    if (this.options.accessToken && !isAuthorizedWebSocketRequest(request, this.options.accessToken)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    this.websocketServer.handleUpgrade(request, socket, head, (websocket: WebSocket) => {
      this.websocketServer.emit("connection", websocket, request);
    });
  };

  private handleConnection(socket: WebSocket): void {
    const client: GatewayControlClientState = {
      id: randomUUID(),
      socket,
      subscriptions: new Set(["events"]),
      nodeId: null,
    };
    this.clients.set(client.id, client);

    this.send(client.socket, {
      type: "hello",
      at: new Date().toISOString(),
      clientId: client.id,
      subscriptions: Array.from(client.subscriptions),
      recentEvents: this.options.eventBus.list(15),
      supportedMessages: [...SUPPORTED_CONTROL_PLANE_MESSAGE_TYPES],
    });

    socket.on("message", (payload: RawData) => {
      void this.handleMessage(client, payload.toString());
    });
    socket.on("close", () => {
      this.handleDisconnect(client);
    });
    socket.on("error", () => {
      this.handleDisconnect(client);
    });
  }

  private handleDisconnect(client: GatewayControlClientState): void {
    if (!this.clients.delete(client.id)) {
      return;
    }

    if (!client.nodeId) {
      return;
    }

    const current = this.nodes.get(client.nodeId);
    if (!current) {
      return;
    }

    const updated: GatewayNodeRecord = {
      ...current,
      connectionId: null,
      status: "disconnected",
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    this.nodes.set(updated.id, updated);
    this.options.eventBus.publish({
      type: "node.disconnected",
      at: updated.updatedAt,
      data: updated,
    });
  }

  private async handleMessage(client: GatewayControlClientState, rawPayload: string): Promise<void> {
    let message: Record<string, unknown>;
    let type: GatewayControlPlaneMessageType | null = null;
    let requestId: string | undefined;
    try {
      ({ message, requestId, type } = parseControlPlaneMessage(rawPayload));
    } catch (error) {
      this.send(client.socket, {
        type: "error",
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    try {
      switch (type) {
        case "subscribe": {
          const subscriptions = normalizeSubscriptions(message.channels);
          client.subscriptions = subscriptions.length > 0 ? new Set(subscriptions) : new Set(["events"]);
          this.send(client.socket, {
            type: "subscribed",
            at: new Date().toISOString(),
            requestId,
            subscriptions: Array.from(client.subscriptions),
            replay: message.replay === true ? this.options.eventBus.list(normalizePositiveNumber(message.limit, 20)) : [],
          });
          return;
        }
        case "ping":
          this.send(client.socket, {
            type: "pong",
            at: new Date().toISOString(),
            requestId,
          });
          return;
        case "nodes.list":
          this.send(client.socket, {
            type: "nodes.list",
            at: new Date().toISOString(),
            requestId,
            nodes: this.listNodes(),
          });
          return;
        case "node.register": {
          const node = this.registerNode(client, message);
          this.send(client.socket, {
            type: "node.registered",
            at: new Date().toISOString(),
            requestId,
            node,
          });
          return;
        }
        case "node.heartbeat": {
          const node = this.heartbeatNode(client, message);
          this.send(client.socket, {
            type: "node.heartbeat",
            at: new Date().toISOString(),
            requestId,
            node,
          });
          return;
        }
        case "run.start":
          await this.executeHandler(
            client.socket,
            requestId,
            "run",
            this.options.onRunRequest,
            normalizeObject(message.payload, "run.start payload"),
          );
          return;
        case "route.deliver":
          await this.executeHandler(
            client.socket,
            requestId,
            "route.delivery",
            this.options.onRouteDelivery,
            normalizeObject(message.payload, "route.deliver payload"),
          );
          return;
        case "delivery.retry":
          await this.executeHandler(
            client.socket,
            requestId,
            "delivery.retry",
            this.options.onDeliveryRetry,
            normalizeObject(message.payload, "delivery.retry payload"),
          );
          return;
        case "subagent.control":
          await this.executeHandler(
            client.socket,
            requestId,
            "subagent.control",
            this.options.onSubagentControl,
            normalizeObject(message.payload, "subagent.control payload"),
          );
          return;
        case "inbox.accept":
          await this.executeHandler(
            client.socket,
            requestId,
            "inbox.accepted",
            this.options.onInboundMessage,
            normalizeObject(message.payload, "inbox.accept payload"),
          );
          return;
        default:
          throw new Error(`Unsupported control-plane message type "${type}".`);
      }
    } catch (error) {
      this.send(client.socket, {
        type: "error",
        at: new Date().toISOString(),
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private registerNode(client: GatewayControlClientState, message: Record<string, unknown>): GatewayNodeRecord {
    const payload = normalizeObject(message.payload, "node.register payload");
    const nodeId = typeof payload.nodeId === "string" && payload.nodeId.trim().length > 0
      ? payload.nodeId.trim()
      : randomUUID();
    const name = typeof payload.name === "string" && payload.name.trim().length > 0
      ? payload.name.trim()
      : `node-${nodeId.slice(0, 8)}`;
    const now = new Date().toISOString();
    const current = this.nodes.get(nodeId);
    this.assertNodeOwnershipAvailable(current, client, nodeId);
    const node: GatewayNodeRecord = {
      id: nodeId,
      name,
      capabilities: normalizeStringArray(payload.capabilities),
      metadata: redactControlPlaneValue(normalizeObject(payload.metadata)) as Record<string, unknown>,
      transport: "websocket",
      status: "connected",
      connectionId: client.id,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      lastSeenAt: now,
    };
    this.nodes.set(node.id, node);
    this.rebindClientNode(client, node.id, now);
    this.options.eventBus.publish({
      type: current ? "node.updated" : "node.connected",
      at: now,
      data: node,
    });
    return node;
  }

  private heartbeatNode(client: GatewayControlClientState, message: Record<string, unknown>): GatewayNodeRecord {
    const payload = message.payload === undefined ? {} : normalizeObject(message.payload, "node.heartbeat payload");
    const requestedNodeId = typeof payload.nodeId === "string" && payload.nodeId.trim().length > 0
      ? payload.nodeId.trim()
      : client.nodeId;
    if (!requestedNodeId) {
      throw new Error("node.heartbeat requires a prior node.register message or payload.nodeId.");
    }
    const current = this.nodes.get(requestedNodeId);
    if (!current) {
      throw new Error(`Node ${requestedNodeId} is not registered.`);
    }
    this.assertNodeOwnershipAvailable(current, client, requestedNodeId);
    const updated: GatewayNodeRecord = {
      ...current,
      connectionId: client.id,
      status: "connected",
      metadata: Object.keys(normalizeObject(payload.metadata)).length > 0
        ? {
            ...current.metadata,
            ...(redactControlPlaneValue(normalizeObject(payload.metadata)) as Record<string, unknown>),
          }
        : current.metadata,
      updatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    this.nodes.set(updated.id, updated);
    this.rebindClientNode(client, updated.id, updated.updatedAt);
    this.options.eventBus.publish({
      type: "node.updated",
      at: updated.updatedAt,
      data: updated,
    });
    return updated;
  }

  private assertNodeOwnershipAvailable(
    current: GatewayNodeRecord | undefined,
    client: GatewayControlClientState,
    nodeId: string,
  ): void {
    if (!current) {
      return;
    }
    if (current.connectionId && current.connectionId !== client.id && current.status === "connected") {
      throw new Error(`Node ${nodeId} is already attached to another control-plane connection.`);
    }
  }

  private rebindClientNode(client: GatewayControlClientState, nextNodeId: string, at: string): void {
    if (client.nodeId && client.nodeId !== nextNodeId) {
      const previous = this.nodes.get(client.nodeId);
      if (previous && previous.connectionId === client.id && previous.status === "connected") {
        const disconnected: GatewayNodeRecord = {
          ...previous,
          connectionId: null,
          status: "disconnected",
          updatedAt: at,
          lastSeenAt: at,
        };
        this.nodes.set(disconnected.id, disconnected);
        this.options.eventBus.publish({
          type: "node.disconnected",
          at,
          data: disconnected,
        });
      }
    }
    client.nodeId = nextNodeId;
  }

  private async executeHandler(
    socket: WebSocket,
    requestId: string | undefined,
    responseType: string,
    handler: GatewayControlPlaneHandlers[keyof GatewayControlPlaneHandlers],
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!handler) {
      throw new Error(`Control-plane action "${responseType}" is not enabled on this gateway.`);
    }
    const result = await handler(payload);
    this.send(socket, {
      type: responseType,
      at: new Date().toISOString(),
      requestId,
      result,
    });
  }

  private broadcastEvent(event: GatewayEvent): void {
    const channel = resolveEventChannel(event.type);
    for (const client of this.clients.values()) {
      if (
        !client.subscriptions.has("all") &&
        !client.subscriptions.has("events") &&
        !client.subscriptions.has(channel)
      ) {
        continue;
      }
      this.send(client.socket, {
        type: "gateway.event",
        at: new Date().toISOString(),
        event,
      });
    }
  }

  private send(socket: WebSocket, payload: Record<string, unknown>): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(payload));
  }
}

function isAuthorizedWebSocketRequest(request: IncomingMessage, accessToken: string): boolean {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization === `Bearer ${accessToken}`) {
    return true;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  return url.searchParams.get("token") === accessToken;
}

function normalizeObject(value: unknown, errorLabel?: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (errorLabel) {
      throw new Error(`${errorLabel} must be a JSON object.`);
    }
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => String(entry).trim())
    .filter(Boolean);
}

function normalizeSubscriptions(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("subscribe channels must be an array of strings.");
  }
  const subscriptions = Array.from(new Set(normalizeStringArray(value).map((entry) => entry.toLowerCase())));
  const invalid = subscriptions.find((entry) => !SUPPORTED_CONTROL_PLANE_SUBSCRIPTIONS.has(entry));
  if (invalid) {
    throw new Error(`Unsupported control-plane subscription channel "${invalid}".`);
  }
  return subscriptions;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function resolveEventChannel(eventType: string): string {
  if (eventType.startsWith("job.")) {
    return "jobs";
  }
  if (eventType.startsWith("run.") || eventType.startsWith("parallel.")) {
    return "runs";
  }
  if (eventType.startsWith("subagent.")) {
    return "subagents";
  }
  if (eventType.startsWith("automation.")) {
    return "automations";
  }
  if (eventType.startsWith("delivery.")) {
    return "deliveries";
  }
  if (eventType.startsWith("inbox.")) {
    return "inbox";
  }
  if (eventType.startsWith("route.")) {
    return "routes";
  }
  if (eventType.startsWith("node.")) {
    return "nodes";
  }
  return "events";
}

function redactControlPlaneValue(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (isArtifactPathControlPlaneKey(key)) {
      return formatControlPlaneArtifactPathForDisplay(value);
    }
    if (isSecretLikeControlPlaneKey(key)) {
      return "[redacted]";
    }
    return redactControlPlaneText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactControlPlaneValue(entry, key));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactControlPlaneValue(entryValue, entryKey),
    ]),
  );
}

function redactControlPlaneText(value: string): string {
  return value
    .replace(
      /((?:[?&]|\b)(?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|sig|signature|token|password|authorization|credential|webhook|x-amz-signature|awsaccesskeyid)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(Bearer|Bot)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "$1 [redacted]")
    .replace(/\b(?:xox[baprs]-|gh[pousr]_|sk-)[A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function isSecretLikeControlPlaneKey(key: string): boolean {
  const compact = key.trim().toLowerCase().replace(/[-_]/g, "");
  return (
    /authorization|api[_-]?key|apikey|secret|token|password|credential|webhook/i.test(key) ||
    compact === "baseurl" ||
    compact === "endpointurl" ||
    compact === "homeserverurl" ||
    compact === "signedurl" ||
    compact === "presignedurl"
  );
}

function isArtifactPathControlPlaneKey(key: string): boolean {
  return /^artifactpaths?$/i.test(key);
}

function formatControlPlaneArtifactPathForDisplay(value: string): string {
  const fileName = basename(value.replace(/\\/g, "/")).trim();
  const safeName = fileName && !isSecretLikeControlPlaneKey(fileName) ? redactControlPlaneText(fileName) : "[redacted-artifact]";
  return `artifact-path:${safeName}`;
}

function parseControlPlaneMessage(rawPayload: string): {
  readonly message: Record<string, unknown>;
  readonly requestId?: string;
  readonly type: GatewayControlPlaneMessageType;
} {
  const parsed = JSON.parse(rawPayload) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Control-plane messages must be JSON objects.");
  }
  const message = parsed as Record<string, unknown>;
  const requestIdValue = message.requestId;
  if (requestIdValue !== undefined && (typeof requestIdValue !== "string" || requestIdValue.trim().length === 0)) {
    throw new Error("Control-plane requestId must be a non-empty string when provided.");
  }
  const typeValue = message.type;
  if (typeof typeValue !== "string" || !SUPPORTED_CONTROL_PLANE_MESSAGE_TYPES.includes(typeValue as GatewayControlPlaneMessageType)) {
    throw new Error(`Unsupported control-plane message type "${typeof typeValue === "string" ? typeValue : ""}".`);
  }
  return {
    message,
    requestId: typeof requestIdValue === "string" ? requestIdValue.trim() : undefined,
    type: typeValue as GatewayControlPlaneMessageType,
  };
}
