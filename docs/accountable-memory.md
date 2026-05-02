# Accountable Memory

The runtime keeps memory accountability metadata in memory tags so the existing
session-store schema can remain stable. `MemoryRecord.scope` remains the
authoritative scope field, while tags carry the provider-owned accountability
fields that explain where a memory came from and how much trust it should get.

## Tag Contract

Built-in provider writes include these tag prefixes:

- `source:<value>` identifies the producer, such as `automatic`, `run-summary`,
  `pre-compress`, `delegation`, or `verified-learning`.
- `scope:<thread|workspace>` mirrors the record scope for recall pipelines that
  only receive flattened provider output.
- `confidence:<low|medium|high>` communicates how strongly the runtime should
  trust the memory.
- `expiry:<session|project|none>` communicates the intended retention horizon.
- `review:<unreviewed|verified|needs-reverify>` communicates whether a human or
  verification loop has confirmed the memory.

Automatic turn memories default to `source:automatic`, `confidence:medium`,
`expiry:session`, and `review:unreviewed`. Verified learning memories default to
`confidence:high`, `expiry:project`, and `review:verified`.

## Provider API

`packages/core-runtime/src/memory-provider.ts` exports
`AccountableMemoryMetadata` and `buildAccountableMemoryTags(...)`. Providers
that persist memories through `sessionStore.addMemory(...)` should use that
helper rather than hand-building accountability tags.

`AutomaticMemoryEntry.accountability` can override source, confidence, expiry,
and review state for runtime-generated memories. Scope still comes from
`AutomaticMemoryEntry.scope` to avoid mismatches between storage and tags.

## Review Semantics

Use `review:unreviewed` for model-derived observations that have not been
checked. Use `review:verified` only when the runtime has concrete verification
evidence. Use `review:needs-reverify` when a run ended without passing
verification or a provider cannot prove the memory still applies.

