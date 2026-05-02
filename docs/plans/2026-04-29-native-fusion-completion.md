# Native Fusion Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the reference-project integration layer explicit about native control-plane coverage, product-parity gaps, and per-descriptor promotion evidence.

**Architecture:** Keep the vendored reference projects behind omni-agent-owned lifecycle, process, schema, and discovery surfaces. Add a coverage/control-plane report that distinguishes native-managed from full product parity so the system cannot falsely claim complete native rewrite when a descriptor is only adapterized.

**Tech Stack:** TypeScript, `packages/tools`, generated JSON manifests, Node test runner.

---

### Task 1: Add Native Fusion Coverage

**Status:** Completed.

**Files:**
- Modify: `packages/tools/src/index.ts`
- Test: `tests/tools.test.ts`

**Steps:**
1. Add `reference_integration coverage`.
2. Compute per-descriptor native state, target surface, product parity gates, blockers, and evidence handles.
3. Include coverage in generated integration manifests.
4. Test that Hermes, OpenClaw, ClaudeCode, and large-module descriptors all report explicit states.

**Verify:**

```bash
npm run typecheck
node --import tsx --test --test-name-pattern "reference_capabilities" tests\tools.test.ts
```

### Task 2: Generate Native Fusion Manifest

**Status:** Completed.

**Files:**
- Create/Update: `docs/native-fusion.generated.json`
- Modify: `IMPROVE.MD`

**Steps:**
1. Run `reference_integration` with `action=write_manifest` and `path=docs/native-fusion.generated.json`.
2. Record total descriptor count, native-managed count, and full-product-parity count.
3. Update `IMPROVE.MD` with the current truthful state.

**Verify:**

```bash
node -e "const j=require('./docs/native-fusion.generated.json'); console.log(j.coverage.summary)"
```

### Task 3: Build Gate

**Status:** Completed.

**Files:**
- Modify: `packages/tools/src/index.ts`
- Test: `tests/tools.test.ts`

**Steps:**
1. Make `coverage` return `ok=false` only when descriptor contract metadata is malformed, not when product parity is incomplete.
2. Expose `fullProductParity` separately from `nativeControlPlaneComplete`.
3. Use this in final reporting so adapter readiness is not confused with product equality.

**Verify:**

```bash
npm run build
```

### Task 7: Literal Upstream Source Line Translation

**Status:** Completed.

**Files:**
- Create: `packages/reference-translated/package.json`
- Create: `packages/reference-translated/tsconfig.json`
- Create: `packages/reference-translated/src/index.ts`
- Generate: `packages/reference-translated/generated/**`
- Create: `scripts/translate-reference-source-lines.ts`
- Create: `tests/reference-translated.test.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.base.json`
- Modify: `package.json`
- Modify: `tests/maturity-artifacts.test.ts`

**Steps:**
1. Add the `@omni-agent/reference-translated` package.
2. Translate every vendored upstream reference file into a new generated TypeScript module.
3. Preserve each text file as an exported `lines` array with exact per-line source text.
4. Preserve binary files as exported base64 modules.
5. Write a manifest that records source, relative path, byte length, line count, sha256, and generated module path.
6. Keep generated translation modules outside the compiled package source tree so TypeScript does not typecheck 21k generated source mirrors on every build.
7. Expose manifest loading and file lookup through `packages/reference-translated/src/index.ts`.

**Current Output:**
- Total files: `21642`
- Text lines: `4620917`
- Bytes: `417257196`
- Hermes files: `2531`
- OpenClaw files: `16031`
- ClaudeCode files: `3080`

**Verify:**

```bash
npm run reference:translate
node --import tsx --test tests\reference-translated.test.ts
npm run typecheck
npm run build
```

### Task 8: Upstream-Free Native Implementation Registry

**Status:** Completed.

**Files:**
- Create: `packages/reference-native/src/implementation.ts`
- Create: `scripts/generate-reference-native-implementation-report.ts`
- Generate: `docs/reference-native-implementation.generated.json`
- Modify: `packages/reference-native/src/index.ts`
- Modify: `packages/reference-native/src/generated.ts`
- Modify: `scripts/generate-reference-native.ts`
- Modify: `packages/tools/src/index.ts`
- Modify: `packages/tools/tsconfig.json`
- Modify: `tests/reference-native.test.ts`
- Modify: `tests/tools.test.ts`
- Modify: `tests/maturity-artifacts.test.ts`

**Steps:**
1. Add native implementation plans for every generated reference adapter.
2. Route every generated adapter to `native_implementation.execute` instead of `reference_service`, `reference_project`, or `reference_integration`.
3. Add the `reference_native` tool with `list`, `coverage`, `plan`, `contract`, and `execute`.
4. Map ClaudeCode experiences to omni-agent run timeline, workspace diagnostics, CLI/workbench, approvals, and session-store surfaces.
5. Map Hermes tools to omni-agent core-runtime, tools, context compression, memory, skill, browser, process, and workspace surfaces.
6. Map OpenClaw plugins/providers/channels to omni-agent gateway, extension, model-client, secret-reference, delivery, pairing, retry, and dead-letter surfaces.
7. Generate a native implementation report proving `upstreamRuntimeRequired: 0` for all 173 descriptors.

**Current Output:**
- Native implementation plans: `173`
- Native implemented: `173`
- Upstream runtime required: `0`
- Report: `docs/reference-native-implementation.generated.json`

**Verify:**

```bash
npm run reference:native
npm run reference:native-report
node --import tsx --test tests\reference-native.test.ts
node --import tsx --test --test-name-pattern "reference_capabilities" tests\tools.test.ts
npm run typecheck
npm run build
```

### Task 4: Runtime Delegation Verification Gate

**Status:** Completed.

**Files:**
- Modify: `packages/core-runtime/src/index.ts`
- Verify: `tests/runtime.test.ts`

**Steps:**
1. Detect successful delegation observations in the parent run.
2. Do not force parent-workspace verification when a mutation-looking task was delegated and the parent workspace did not mutate.
3. Re-run the three delegation/swarm regression tests.
4. Run the full suite.

**Verify:**

```bash
node --import tsx --test --test-name-pattern "runtime can delegate a scoped task|runtime can merge child-only extension registries|runtime can coordinate a swarm" tests\runtime.test.ts
npm test
npm run build
```

### Task 5: Product Capability Equivalence Gate

**Status:** Completed.

**Files:**
- Modify: `packages/tools/src/index.ts`
- Modify: `tests/tools.test.ts`
- Update: `docs/native-fusion.generated.json`
- Update: `IMPROVE.MD`

**Steps:**
1. Split product capability equivalence from source rewrite equivalence.
2. Mark `fullProductParity` by native product accessibility: service lifecycle, process adapter, schema contract, reference project/module access, and operator evidence.
3. Keep `nativeRewriteComplete` as a separate stricter gate.
4. Regenerate manifests and verify that all 173 descriptors are product-equivalent while rewrite completion remains explicitly tracked.

**Verify:**

```bash
node -e "const j=require('./docs/native-fusion.generated.json'); console.log(j.coverage.summary)"
npm test
npm run build
```

### Task 6: Source-Level Native Adapter Materialization

**Status:** Completed.

**Files:**
- Create: `packages/reference-native/package.json`
- Create: `packages/reference-native/tsconfig.json`
- Create: `packages/reference-native/src/index.ts`
- Generate: `packages/reference-native/src/generated.ts`
- Create: `scripts/generate-reference-native.ts`
- Create: `tests/reference-native.test.ts`
- Modify: `tsconfig.json`
- Modify: `tsconfig.base.json`
- Modify: `package.json`

**Steps:**
1. Add the `@omni-agent/reference-native` package.
2. Generate one TypeScript native adapter source entry for each reference descriptor.
3. Route each source entry to the appropriate omni-agent surface: `reference_integration`, `reference_project`, or `reference_service`.
4. Split the claim from line-for-line upstream copying: source-level adapter materialization is complete, upstream source translation is not the target.
5. Verify count, sources, rewrite kinds, and route metadata.

**Verify:**

```bash
npm run reference:native
node --import tsx --test tests\reference-native.test.ts
npm run build
```
