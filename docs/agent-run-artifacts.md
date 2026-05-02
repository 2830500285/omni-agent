# Agent Run Artifacts

An agent run can be persisted as a first-class artifact with `SqliteSessionStore.addAgentRunArtifact`.
This keeps the existing session-store API intact while giving callers a stable JSON payload they can archive, inspect, or attach to run reports.

## Artifact Shape

The store writes an `agent-run` artifact under the normal run artifact directory and records it in `listRunArtifacts(runId)`.
The JSON payload uses `schemaVersion: 1` and includes:

- `taskContract`: objective, execution domain, roots, success criteria, and constraints.
- `toolTrace`: tool call id, tool name, risk tier, status, summary, output preview, stored output reference, presentation, and timestamp.
- `approvals`: lightweight approval decisions supplied by the caller.
- `diff`: changed files plus optional summary, patch text, or patch artifact path.
- `verification`: status, commands, and summary.
- `summary`: final response plus optional notes and next steps.

Sensitive values are passed through the same redaction path used by other session-store artifacts.

## Usage

```ts
const artifact = store.addAgentRunArtifact({
  runId,
  taskContract: {
    successCriteria: ["targeted tests pass"],
    constraints: ["only touch requested files"],
  },
  approvals: [
    {
      toolName: "run_command",
      decision: "allow",
      riskTier: 1,
      approvalClass: "exec_capable",
      summary: "Allowed targeted verification.",
    },
  ],
  diff: {
    changedFiles: ["src/parser.ts"],
    summary: "Adjusted parser behavior.",
  },
  verification: {
    commands: ["npm test -- tests/parser.test.ts"],
    summary: "Targeted tests passed.",
  },
});
```

If `toolTrace` is omitted, the store snapshots the run's existing `tool_events`.
If task, verification, or summary fields are omitted, the store derives the objective, execution domain, roots, verification status, and final response from the persisted run record.
