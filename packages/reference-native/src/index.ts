export type ReferenceNativeSource = "claudecode" | "hermes" | "openclaw";
export type ReferenceNativeCategory = "claudecode-experience" | "hermes-tool" | "large-module" | "openclaw-plugin";
export type ReferenceNativeRewriteKind =
  | "native-lifecycle-source"
  | "native-process-tool-source"
  | "native-schema-source"
  | "native-workbench-source"
  | "native-module-source";
export type ReferenceNativeRouteTool = "native_implementation" | "reference_integration" | "reference_project" | "reference_service";
export type ReferenceNativeRouteAction =
  | "contract"
  | "execute"
  | "invoke"
  | "list"
  | "plan"
  | "protocols"
  | "read_file";

export interface ReferenceNativeAdapterSource {
  readonly id: string;
  readonly source: ReferenceNativeSource;
  readonly category: ReferenceNativeCategory;
  readonly title: string;
  readonly sourcePath: string | null;
  readonly targetSurface: string;
  readonly rewriteKind: ReferenceNativeRewriteKind;
  readonly productParity: boolean;
  readonly sourceRewriteComplete: boolean;
  readonly route: {
    readonly tool: ReferenceNativeRouteTool;
    readonly action: ReferenceNativeRouteAction;
    readonly args: Record<string, unknown>;
  };
  readonly evidence: {
    readonly contractTool: "reference_integration";
    readonly contractAction: "contract";
    readonly planTool: "reference_integration";
    readonly planAction: "plan";
  };
}

export interface ReferenceNativeCoverageSummary {
  readonly adapterCount: number;
  readonly sourceRewriteCompleteCount: number;
  readonly productParityCount: number;
  readonly bySource: Record<string, number>;
  readonly byCategory: Record<string, number>;
  readonly byRewriteKind: Record<string, number>;
}

export { nativeReferenceAdapters } from "./generated.js";
export {
  getReferenceSourceInventoryEntry,
  hasReferenceSourceInventoryEntry,
  normalizeReferenceSourcePath,
  referenceSourceInventory,
  type ReferenceSourceInventoryEntry,
  type ReferenceSourceInventorySource,
} from "./source-inventory.js";
export {
  executeNativeImplementation,
  getNativeImplementationPlan,
  listNativeImplementationPlans,
  summarizeNativeImplementationCoverage,
  validateNativeParityClaims,
  type NativeImplementationBinding,
  type NativeImplementationContract,
  type NativeImplementationCoverage,
  type NativeImplementationKind,
  type NativeImplementationPlan,
  type NativeImplementationResult,
  type NativeParityEvidenceRecord,
  type NativeParityStatus,
  type NativeParityValidationIssue,
  type NativeParityValidationReport,
} from "./implementation.js";

import { nativeReferenceAdapters } from "./generated.js";

export function getNativeReferenceAdapter(id: string): ReferenceNativeAdapterSource | null {
  return nativeReferenceAdapters.find((adapter) => adapter.id === id) ?? null;
}

export function summarizeNativeReferenceAdapters(): ReferenceNativeCoverageSummary {
  return {
    adapterCount: nativeReferenceAdapters.length,
    sourceRewriteCompleteCount: nativeReferenceAdapters.filter((adapter) => adapter.sourceRewriteComplete).length,
    productParityCount: nativeReferenceAdapters.filter((adapter) => adapter.productParity).length,
    bySource: countBy(nativeReferenceAdapters, (adapter) => adapter.source),
    byCategory: countBy(nativeReferenceAdapters, (adapter) => adapter.category),
    byRewriteKind: countBy(nativeReferenceAdapters, (adapter) => adapter.rewriteKind),
  };
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}
