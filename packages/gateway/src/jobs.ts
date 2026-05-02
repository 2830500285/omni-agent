import { randomUUID } from "node:crypto";

export type GatewayJobStatus = "cancelled" | "completed" | "failed" | "queued" | "running";

export interface GatewayJobRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: GatewayJobStatus;
  readonly kind?: string;
  readonly batchId?: string;
  readonly routeId?: string;
  readonly inboundMessageId?: string;
  readonly request: Record<string, unknown>;
  readonly runId?: string;
  readonly threadId?: string;
  readonly error?: string;
}

export class GatewayJobStore {
  private readonly jobs = new Map<string, GatewayJobRecord>();

  public create(
    request: Record<string, unknown>,
    metadata: Partial<Pick<GatewayJobRecord, "batchId" | "inboundMessageId" | "kind" | "routeId">> = {},
  ): GatewayJobRecord {
    const now = new Date().toISOString();
    const record: GatewayJobRecord = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "queued",
      kind: metadata.kind,
      batchId: metadata.batchId,
      routeId: metadata.routeId,
      inboundMessageId: metadata.inboundMessageId,
      request,
    };
    this.jobs.set(record.id, record);
    return record;
  }

  public get(jobId: string): GatewayJobRecord | null {
    return this.jobs.get(jobId) ?? null;
  }

  public update(jobId: string, patch: Partial<Omit<GatewayJobRecord, "id" | "createdAt" | "request">>): GatewayJobRecord {
    const current = this.jobs.get(jobId);
    if (!current) {
      throw new Error(`Job ${jobId} was not found.`);
    }
    const updated: GatewayJobRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(jobId, updated);
    return updated;
  }

  public listByBatchId(batchId: string): GatewayJobRecord[] {
    return Array.from(this.jobs.values())
      .filter((job) => job.batchId === batchId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public listAll(): GatewayJobRecord[] {
    return Array.from(this.jobs.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}
