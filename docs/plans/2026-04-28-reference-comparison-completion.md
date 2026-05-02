# Reference Comparison Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the remaining agent-capability gaps found by re-comparing `omni-agent` with `claudecode-source`, `hermes-agent-main`, and `openclaw-main`.

**Architecture:** Keep the platform local-first and testable. Add real command routing for remote-like execution backends, generic consumer-channel inbound receivers, typed provider manifests, and secret-reference handling without building full mobile/voice products.

**Tech Stack:** TypeScript, Node.js, built-in test runner, local SQLite session store, gateway HTTP API, workspace command runner.

---

### Task 1: Rewrite IMPROVE.MD As Active Scope

**Files:**
- Modify: `IMPROVE.MD`

**Steps:**
- Summarize the new comparison.
- List only agent-capability gaps that can be completed in this pass.
- Mark success criteria for tests and build.

### Task 2: Execution Backends

**Files:**
- Modify: `packages/workspace/src/index.ts`
- Modify: `tests/workspace.test.ts`

**Steps:**
- Add SSH command wrapping when `OMNI_AGENT_EXECUTION_BACKEND=ssh`.
- Add managed cloud HTTP execution when `OMNI_AGENT_EXECUTION_BACKEND=managed-cloud`.
- Return explainable failure when required env vars are missing.
- Test descriptors and missing-config behavior without requiring real SSH/cloud credentials.

### Task 3: Consumer Inbound Channels

**Files:**
- Modify: `packages/gateway/src/index.ts`
- Modify: `packages/gateway/src/routes.ts`
- Modify: `tests/gateway.test.ts`

**Steps:**
- Add generic inbound endpoints for WhatsApp, Signal, Matrix, voice, canvas, mobile-node, and media.
- Reuse enterprise normalization, signature checks, pairing policy, dispatch, and audit logging.
- Test accepted/rejected inbound behavior and channel descriptors.

### Task 4: Secret References And Provider Manifests

**Files:**
- Modify: `packages/gateway/src/routes.ts`
- Modify: `packages/gateway/src/index.ts`
- Modify: `tests/gateway.test.ts`

**Steps:**
- Add channel provider manifests describing inbound/outbound/auth/security requirements.
- Add config sanitizer that replaces secret-looking adapter config values with `secretRef`.
- Expose manifests through gateway API and route presentations.
- Test that route responses do not leak configured webhook/token secrets.

### Task 5: Verify

**Commands:**
- `npm run typecheck`
- `npm test`
- `npm run build`

**Expected:** all pass.
