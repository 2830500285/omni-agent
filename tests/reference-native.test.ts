import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  executeNativeImplementation,
  getNativeImplementationPlan,
  getNativeReferenceAdapter,
  hasReferenceSourceInventoryEntry,
  nativeReferenceAdapters,
  summarizeNativeImplementationCoverage,
  summarizeNativeReferenceAdapters,
  validateNativeParityClaims,
} from "../packages/reference-native/src/index.ts";

const sourceRoots = {
  claudecode: resolve("vendor/reference/claudecode-source"),
  hermes: resolve("vendor/reference/hermes-agent-main"),
  openclaw: resolve("vendor/reference/openclaw-main"),
} as const;

test("generated native reference adapters materialize every reference descriptor as source", () => {
  const summary = summarizeNativeReferenceAdapters();

  assert.equal(summary.adapterCount, 173);
  assert.equal(summary.productParityCount, 0);
  assert.equal(summary.sourceRewriteCompleteCount, summary.adapterCount);
  assert.equal(summary.bySource.claudecode, 14);
  assert.equal(summary.bySource.hermes, 39);
  assert.equal(summary.bySource.openclaw, 120);
  assert.ok(summary.byRewriteKind["native-process-tool-source"] >= 1);
  assert.ok(summary.byRewriteKind["native-schema-source"] >= 1);
  assert.equal(nativeReferenceAdapters.filter((adapter) => adapter.sourcePath === null).length, 0);
  for (const adapter of nativeReferenceAdapters) {
    const sourcePath = adapter.sourcePath;
    assert.ok(sourcePath, `missing source path for ${adapter.id}`);
    assert.ok(
      resolveReferencePath(adapter.source, adapter.id, sourcePath) ||
        hasReferenceSourceInventoryEntry({
          source: adapter.source,
          id: adapter.id,
          sourcePath,
        }),
      `missing source path for ${adapter.id}: ${sourcePath}`,
    );
  }

  const hermesTool = nativeReferenceAdapters.find((adapter) => adapter.category === "hermes-tool");
  assert.ok(hermesTool);
  assert.equal(hermesTool.route.tool, "native_implementation");
  assert.equal(hermesTool.route.action, "execute");
  assert.equal(getNativeReferenceAdapter(hermesTool.id)?.id, hermesTool.id);
});

test("native reference implementation plans do not require upstream runtimes", () => {
  const coverage = summarizeNativeImplementationCoverage();

  assert.equal(coverage.total, 173);
  assert.equal(coverage.nativeImplemented, 173);
  assert.equal(coverage.upstreamRuntimeRequired, 0);
  assert.ok(coverage.byParityStatus["contract-tested"] > 0);
  assert.ok(coverage.byParityStatus.facade > 0);
  assert.ok(coverage.byKind["native-coding-experience"] >= 1);
  assert.ok(coverage.byKind["native-memory-skill-tool"] >= 1);
  assert.ok(coverage.byKind["native-channel-plugin"] >= 1);

  const claudecode = nativeReferenceAdapters.find((adapter) => adapter.source === "claudecode");
  assert.ok(claudecode);
  const plan = getNativeImplementationPlan(claudecode.id);
  assert.ok(plan);
  assert.equal(plan.upstreamRuntimeRequired, false);
  assert.equal(plan.parityClaims.adapterSurfaceReplaced, true);
  assert.ok(plan.bindings.some((binding) => binding.packageName === "@omni-agent/core-runtime"));

  const result = executeNativeImplementation(claudecode.id);
  assert.equal(result.ok, true);
  assert.equal(result.upstreamRuntimeRequired, false);
  assert.match(result.summary, /no upstream runtime is required/);
});

test("native reference parity claims distinguish facade coverage from tested product claims", () => {
  const plans = nativeReferenceAdapters.map((adapter) => getNativeImplementationPlan(adapter.id)).filter((plan) => plan !== null);
  const validation = validateNativeParityClaims();

  assert.equal(validation.ok, true);
  assert.equal(validation.issueCount, 0);
  assert.equal(plans.length, 173);
  assert.ok(plans.some((plan) => plan?.parityClaims.parityStatus === "facade"));
  assert.ok(plans.some((plan) => plan?.parityClaims.parityStatus === "contract-tested"));
  assert.equal(plans.some((plan) => plan?.parityClaims.parityStatus === "product-equivalent"), false);

  const channelPlan = plans.find((plan) => plan?.kind === "native-channel-plugin");
  assert.ok(channelPlan);
  assert.ok(channelPlan.parityClaims.parityEvidence.some((entry) => entry.kind === "live-test"));
  assert.equal(channelPlan.parityClaims.liveAccountRequired, true);
});

test("native reference maps compression and memory modules to tested omni-agent primitives", () => {
  const contextCompressor = getNativeImplementationPlan("hermes:hermes-agent-main:module:agent/context_compressor.py");
  const trajectoryCompressor = getNativeImplementationPlan("hermes:hermes-agent-main:module:trajectory_compressor.py");
  const openclawMemory = getNativeImplementationPlan("openclaw:openclaw-main:module:src/memory");
  const claudeMemdir = getNativeImplementationPlan("claudecode:claude-code-main:module:src/memdir");
  const clawMemdir = getNativeImplementationPlan("claudecode:claw-code-main:module:src/memdir");

  for (const plan of [contextCompressor, trajectoryCompressor, openclawMemory, claudeMemdir, clawMemdir]) {
    assert.ok(plan);
    assert.equal(plan.kind, "native-memory-skill-tool");
    assert.equal(plan.parityClaims.parityStatus, "contract-tested");
    assert.ok(plan.bindings.some((binding) => binding.packageName === "@omni-agent/context" && binding.surface === "compression"));
    assert.ok(plan.bindings.some((binding) => binding.packageName === "@omni-agent/session-store" && binding.surface === "memory-skill-store"));
  }

  assert.ok(contextCompressor.parityClaims.parityEvidence.some((entry) => entry.path === "tests/context.test.ts"));
  assert.ok(openclawMemory.parityClaims.parityEvidence.some((entry) => entry.path === "tests/tools.test.ts"));
});

test("native reference maps delegation, browser, and extension modules to concrete primitives", () => {
  const delegateModule = getNativeImplementationPlan("hermes:hermes-agent-main:module:tools/delegate_tool.py");
  const browserModule = getNativeImplementationPlan("hermes:hermes-agent-main:module:tools/browser_tool.py");
  const openclawExtensions = getNativeImplementationPlan("openclaw:openclaw-main:module:extensions");
  const openclawMcp = getNativeImplementationPlan("openclaw:openclaw-main:module:src/mcp");
  const openclawWebSearch = getNativeImplementationPlan("openclaw:openclaw-main:module:src/web-search");

  assert.ok(delegateModule);
  assert.equal(delegateModule.kind, "native-memory-skill-tool");
  assert.equal(delegateModule.parityClaims.parityStatus, "contract-tested");
  assert.ok(delegateModule.bindings.some((binding) => binding.packageName === "@omni-agent/tools" && binding.handles.includes("run_swarm")));

  assert.ok(browserModule);
  assert.equal(browserModule.kind, "native-multimodal-tool");
  assert.equal(browserModule.parityClaims.parityStatus, "contract-tested");
  assert.ok(browserModule.bindings.some((binding) => binding.packageName === "@omni-agent/tools" && binding.handles.includes("browser_run")));

  assert.ok(openclawExtensions);
  assert.equal(openclawExtensions.kind, "native-gateway-schema");
  assert.equal(openclawExtensions.parityClaims.parityStatus, "contract-tested");
  assert.ok(openclawExtensions.bindings.some((binding) => binding.packageName === "@omni-agent/extensions" && binding.surface === "plugin-manifest"));

  assert.ok(openclawMcp);
  assert.equal(openclawMcp.kind, "native-gateway-schema");
  assert.equal(openclawMcp.parityClaims.parityStatus, "contract-tested");
  assert.ok(openclawMcp.bindings.some((binding) => binding.packageName === "@omni-agent/extensions" && binding.handles.includes("tools")));
  assert.ok(openclawMcp.parityClaims.behavioralParityEvidence.includes("tests/gateway.test.ts"));

  assert.ok(openclawWebSearch);
  assert.equal(openclawWebSearch.kind, "native-multimodal-tool");
  assert.equal(openclawWebSearch.parityClaims.parityStatus, "contract-tested");
  assert.ok(openclawWebSearch.bindings.some((binding) => binding.packageName === "@omni-agent/tools" && binding.handles.includes("browser_fetch")));
  assert.ok(openclawWebSearch.parityClaims.behavioralParityEvidence.includes("tests/tools.test.ts"));
});

function resolveReferencePath(source: keyof typeof sourceRoots, id: string, sourcePath: string | null): string | null {
  if (!sourcePath) {
    return null;
  }
  const normalizedPath = sourcePath.replaceAll("\\", "/");
  const projectSegment = id.split(":")[1];
  const candidates = [
    resolve(sourceRoots[source], normalizedPath),
    projectSegment ? resolve(sourceRoots[source], projectSegment, normalizedPath) : null,
  ].filter((candidate): candidate is string => candidate !== null);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
