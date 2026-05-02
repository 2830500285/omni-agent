# Capability-Backed Agent Claims

This file is the public claim registry for agent capability statements. A row is allowed to make a capability claim only when it maps to `examples/evals/capability-scorecard.json`, an eval scenario in the scorecard or `examples/evals/suite.json`, and the maturity validation in `npm run maturity:check`.

Rules:

- `minimum status` is the strongest status this document claims for the capability.
- `usable` claims must have scorecard evidence files, required tests, benchmark scenario coverage, and an explicit risk.
- `mature` claims must also have mature evidence files, live or contract tests, a mature benchmark scenario, an operational runbook, and failure recovery tests.
- Claims without scorecard or benchmark evidence fail `npm run maturity:check`; supported but non-mature claims are reported as `risk`.

| Claim ID | Capability ID | Claim | Minimum Status | Required Scenario IDs | Risk If Not Mature |
| --- | --- | --- | --- | --- | --- |
| local-coding-runtime-usable | coding-runtime | Omni Agent has a usable local coding runtime for repository edits, verification, and repair loops. | usable | coding-bugfix-baseline, verification-repair-baseline | Terminal recovery and replayable tool presentation remain thinner than Claude Code until mature evidence passes. |
| eval-benchmark-gates-usable | benchmark-quality | Omni Agent has usable eval and benchmark quality gates for release decisions. | usable | benchmark-quality-gate | Most benchmark runs still use synthetic executor output, so historical regression evidence is not yet mature. |
| workspace-checkpoints-mature | workspace-checkpoints | Workspace checkpoints are mature for managed rollback boundaries and release-gated recovery evidence. | mature | compat.workspace_checkpoints | None |
| runtime-mutation-rollback-mature | runtime-mutation-checkpoint-rollback | Runtime mutation checkpoint rollback is mature for opt-in rollback after final verification failure. | mature | compat.runtime_mutation_checkpoint_rollback | None |
| tool-lifecycle-hooks-mature | tool-lifecycle-hooks | Tool lifecycle hooks are mature for observing tool execution and failure recovery paths. | mature | compat.tool_lifecycle_hooks | None |
