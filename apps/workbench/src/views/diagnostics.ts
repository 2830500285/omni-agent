import type { OperatorState } from "../state.js";

export interface DiagnosticSummary {
  readonly gateway: unknown;
  readonly modelProfiles: unknown[];
  readonly memoryProviders: unknown[];
  readonly extensions: unknown[];
  readonly channelPlugins: unknown[];
}

export function summarizeDiagnostics(operatorState: OperatorState | null): DiagnosticSummary {
  const diagnostics = operatorState?.diagnostics ?? {};
  return {
    gateway: diagnostics.gateway ?? null,
    modelProfiles: asArray(diagnostics.modelProfiles),
    memoryProviders: asArray(diagnostics.memoryProviders),
    extensions: asArray(diagnostics.extensions),
    channelPlugins: asArray(diagnostics.channelPlugins),
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
