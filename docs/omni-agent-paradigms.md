# Omni Agent Paradigms

Omni Agent is intended to be more than a feature checklist for tools, memory,
MCP, subagents, and gateways. Its differentiator is that those pieces are
organized around evidence, authority, and durable run records.

## Verification-Native Runtime

An agent run should not be treated as complete because the assistant wrote a
confident final answer. Completion should be tied to a task contract,
verification plan, observed tool evidence, and a final report that explains what
passed, what failed, and what remains unproven.

Implementation note: see `docs/verification-native-runtime.md`.

## Capability-Backed Claims

README claims and release notes should map to scorecard entries, benchmark
scenarios, tests, or operational runbooks. A capability without evidence is a
risk, not a shipped feature.

Implementation note: see `docs/capability-backed-claims.md`.

## Governed Subagents

Subagents should behave like controlled workers. Each delegated job needs
authority, budget, ownership, and completion evidence instead of unrestricted
parallel chat.

Implementation note: see `docs/governed-subagents.md`.

## Accountable Memory

Memory should carry provenance and scope. Durable memories need enough metadata
to explain why they were written, where they apply, and when they should be
reviewed or ignored.

Implementation note: see `docs/accountable-memory.md`.

## Agent Runs As Artifacts

Every meaningful run should leave a durable artifact that can be inspected after
the conversation: task contract, tool trace, approvals, changed files,
verification evidence, and summary.

Implementation note: see `docs/agent-run-artifacts.md`.
