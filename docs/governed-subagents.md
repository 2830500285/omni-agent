# Governed Subagent Runtime

Governed subagents are ordinary `spawn_subagent`, `delegate_task`, `run_swarm`,
`wait_subagent`, `wait_any_subagent`, and `subagents` control-plane calls with
explicit authority, ownership, budget, scope, and verification metadata. The
runtime still reuses the existing local subagent controller; the governance
contract is intentionally a thin tool-surface layer.

## Spawn Contract

Use either the existing top-level fields or the compact `governance` object.
Top-level fields win when both are present.

```json
{
  "objective": "verify parser changes",
  "role": "verifier",
  "mode": "background",
  "governance": {
    "authority": "leaf",
    "ownerAgentId": "worker-3",
    "auditLabel": "parser-release-check",
    "budget": {
      "maxIterations": 3,
      "timeoutMs": 120000,
      "maxRetries": 1
    },
    "maxDepth": 2,
    "maxConcurrentChildren": 1,
    "allowedTools": ["read_file", "run_verification"],
    "targetPaths": ["packages/tools/src/index.ts", "tests/tools.test.ts"],
    "returnedArtifactKinds": ["verification"],
    "verificationCommands": ["node ./scripts/run-tests.mjs tests/tools.test.ts"]
  }
}
```

## Governance Fields

- `authority`: `leaf` cannot recursively orchestrate broad child work; `orchestrator`
  is reserved for coordinator jobs.
- `ownerAgentId`: names the worker or parent agent accountable for the child job.
  If omitted, the tool layer uses the current context `agentId` when available.
- `auditLabel`: human-readable audit tag for release gates, incident review, or
  delegation traces.
- `budget`: per-job iteration, timeout, and retry limits.
- `maxDepth` and `maxConcurrentChildren`: topology controls for recursive work.
- `allowedTools`: tool allowlist resolved by the runtime policy layer.
- `targetPaths`: write-scope ownership boundary; write tools enforce these paths
  for active subagent jobs.
- `returnedArtifactKinds`: explicit channel for what a parent may collect.
- `verificationCommands`: expected checks for the child job to run or report.

## Audit View

Subagent observation results include a `governance` object:

```json
{
  "governance": {
    "authority": "leaf",
    "ownership": {
      "ownerAgentId": "worker-3",
      "auditLabel": "parser-release-check",
      "parentJobId": "job-parent",
      "rootJobId": "job-root",
      "threadId": "thread-1",
      "runId": "run-1"
    },
    "budget": {
      "maxIterations": 3,
      "timeoutMs": 120000,
      "maxRetries": 1,
      "maxDepth": 2,
      "maxConcurrentChildren": 1
    },
    "controls": {
      "executionDomain": "sandbox",
      "allowedTools": ["read_file", "run_verification"],
      "targetPaths": ["packages/tools/src/index.ts"],
      "returnedArtifactKinds": ["verification"],
      "toolPolicyTrace": ["role verifier allowed read_file"]
    },
    "verification": {
      "commands": ["node ./scripts/run-tests.mjs tests/tools.test.ts"],
      "status": "not-run",
      "artifactKinds": ["verification"]
    }
  }
}
```

`run_swarm` applies the same contract per task. `wait_subagent`,
`wait_any_subagent`, `collect_subagent_artifacts`, `subagents summary`, and
`subagents topology` surface the same audit view from the stored job record and
available run/artifact state.
