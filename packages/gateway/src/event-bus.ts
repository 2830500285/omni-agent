import { randomUUID } from "node:crypto";
import { basename } from "node:path";

export interface GatewayEvent {
  readonly id: string;
  readonly type: string;
  readonly at: string;
  readonly data?: unknown;
}

type Listener = (event: GatewayEvent) => void;

export class GatewayEventBus {
  private readonly listeners = new Map<string, Listener>();
  private readonly history: GatewayEvent[] = [];

  public constructor(private readonly historyLimit = 250) {}

  public publish(input: Omit<GatewayEvent, "id"> & { id?: string }): GatewayEvent {
    const event: GatewayEvent = {
      id: input.id ?? randomUUID(),
      type: input.type,
      at: input.at,
      data: redactGatewayEventValue(input.data),
    };
    this.history.push(event);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }
    for (const listener of this.listeners.values()) {
      listener(event);
    }
    return event;
  }

  public subscribe(listener: Listener): () => void {
    const id = randomUUID();
    this.listeners.set(id, listener);
    return () => {
      this.listeners.delete(id);
    };
  }

  public list(limit = 50): GatewayEvent[] {
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 50;
    return this.history.slice(-normalizedLimit);
  }
}

function redactGatewayEventValue(value: unknown): unknown {
  return redactGatewayEventValueWithKey(value);
}

function redactGatewayEventValueWithKey(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    if (isArtifactPathGatewayEventKey(key)) {
      return formatGatewayArtifactPathForDisplay(value);
    }
    return redactGatewayEventText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactGatewayEventValueWithKey(entry, key));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      isSecretLikeGatewayEventKey(key) ? "[redacted]" : redactGatewayEventValueWithKey(entry, key),
    ]),
  );
}

function redactGatewayEventText(value: string): string {
  return value
    .replace(
      /((?:[?&]|\b)(?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|secret|sig|signature|token|password|authorization|credential|x-amz-signature|awsaccesskeyid)=)[^&\s]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(Bearer|Bot)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "$1 [redacted]")
    .replace(/\b(?:xox[baprs]-|gh[pousr]_|sk-)[A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function isSecretLikeGatewayEventKey(key: string): boolean {
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

function isArtifactPathGatewayEventKey(key: string): boolean {
  return /^artifactpaths?$/i.test(key);
}

function formatGatewayArtifactPathForDisplay(value: string): string {
  const fileName = basename(value.replace(/\\/g, "/")).trim();
  const safeName = fileName && !isSecretLikeGatewayEventKey(fileName) ? redactGatewayEventText(fileName) : "[redacted-artifact]";
  return `artifact-path:${safeName}`;
}
