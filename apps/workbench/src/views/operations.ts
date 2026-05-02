import type { OperatorState } from "../state.js";

export interface OperatorAction {
  readonly label: string;
  readonly method: "POST";
  readonly path: string;
  readonly body?: Record<string, unknown>;
}

export function failedDeliveryRetryActions(operatorState: OperatorState | null): OperatorAction[] {
  const deliveries = operatorState?.operations?.deliveries ?? [];
  return deliveries
    .filter((delivery) => delivery.status === "failed" && typeof delivery.id === "string")
    .map((delivery) => ({
      label: `Retry delivery ${delivery.id}`,
      method: "POST",
      path: `/deliveries/${encodeURIComponent(String(delivery.id))}/retry`,
      body: {},
    }));
}

export function subagentControlActions(operatorState: OperatorState | null): OperatorAction[] {
  const subagents = operatorState?.operations?.subagents ?? [];
  return subagents
    .filter((subagent) => ["queued", "running", "paused"].includes(String(subagent.status ?? "")))
    .flatMap((subagent) => {
      const id = String(subagent.id ?? "");
      if (!id) {
        return [];
      }
      return ["pause", "resume", "cancel"].map((action) => ({
        label: `${action} subagent ${id}`,
        method: "POST" as const,
        path: `/subagents/${encodeURIComponent(id)}/${action}`,
        body: {},
      }));
    });
}
