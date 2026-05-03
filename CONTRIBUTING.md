# Contributing to Omni Agent

Thanks for taking the time to improve Omni Agent.

Omni Agent is a beta, verification-native local coding-agent runtime. The project is useful when changes are practical, testable, and honest about what has actually been verified. Contributions should make the runtime easier to run, easier to evaluate, safer to extend, or clearer to understand.

## What Helps

Good contributions usually fall into one of these areas:

- Bug reports with a clear reproduction, expected behavior, actual behavior, and environment details.
- Small runtime fixes that make CLI runs, tool execution, workspace handling, approvals, memory, gateway behavior, or model profiles more reliable.
- Eval fixtures that improve coverage and clearly separate synthetic, mock-runtime, and real-model evidence.
- Documentation and tutorial improvements that help a new developer understand the system without hiding important limits.
- Provider compatibility fixes for OpenAI-compatible endpoints, Anthropic-style clients, local model endpoints, or other model profiles.
- Security improvements around file access, command execution, approval boundaries, secret handling, and trace redaction.

## What Does Not Help

Please avoid contributions that make the project look more mature than the evidence supports:

- Do not describe synthetic benchmark results as real model capability.
- Do not add benchmark claims unless the executor mode, model profile, trace, cost, duration, and failure reasons are recorded.
- Do not submit large rewrites that are not tied to a concrete failure or missing capability.
- Do not add speculative abstractions for future features that are not implemented.
- Do not commit secrets, local logs, runtime traces with private data, generated build output, or machine-specific files.

## Development Setup

Use a recent Node.js runtime and install dependencies from the repository root:

```bash
npm install
```

Run the main verification commands before opening a pull request:

```bash
npm run typecheck
npm test
```

For focused work, run the smallest relevant test set first:

```bash
node ./scripts/run-tests.mjs tests/gateway.test.ts
node ./scripts/run-tests.mjs tests/evals.test.ts
node ./scripts/run-tests.mjs tests/model-client.test.ts
```

Use the broader suite before claiming a cross-cutting runtime change is complete.

## Eval Evidence

Omni Agent treats eval results as evidence, not marketing copy. When adding or changing eval behavior, label the executor path clearly:

- `synthetic`: scripted or fixture-backed execution. This proves the harness, manifest, and judging logic are wired correctly.
- `mock`: real runtime path with mocked model or tool behavior. This proves integration flow, not full model capability.
- `real-model`: actual model execution through a named provider and model profile. This is the only mode that can support claims about model performance.

For real-model evals, include enough information for someone else to inspect the run:

- model provider and model name
- executor mode
- task suite or fixture version
- trace location or summary
- cost and duration when available
- pass/fail result
- failure reason for each failed task

If the run is not reproducible, say so directly.

## Pull Request Checklist

Before submitting a pull request, check that:

- The change has a clear purpose.
- The diff is limited to the requested behavior.
- Tests or verification commands are listed in the PR description.
- Documentation is updated when behavior, commands, configuration, or eval claims change.
- No secrets, private traces, local runtime artifacts, or generated build output are included.
- New public claims are backed by deterministic tests, mock-runtime evidence, or real-model evidence as appropriate.

## Reporting Security Issues

If a vulnerability involves secrets, command execution, workspace escape, prompt injection, unsafe approvals, or private traces, do not publish exploit details in a public issue. Use the repository security reporting flow when available, or contact the maintainer through GitHub.

