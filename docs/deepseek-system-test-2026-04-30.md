# DeepSeek System Test - 2026-04-30

## Scope

This test used omni-agent itself to run a realistic business bugfix task against a fixture workspace. The assistant did not manually solve the fixture during the tested runs.

Fixture workspace:

- `.tmp/deepseek-system-test`

Task:

- Inspect failing order settlement tests.
- Fix `src/settlement.mjs`.
- Preserve tests.
- Run `npm test`.

Model profiles:

- `deepseek-v4-flash`
- `deepseek-v4-pro`

Provider configuration:

- Protocol: OpenAI-compatible
- Base URL: `https://api.deepseek.com/v1`
- API key source: `DEEPSEEK_API_KEY`

## Baseline

The fixture initially failed:

- `npm test`
- Result: 1 passing test, 1 failing test
- Main failure: inventory reservation and settlement ledger/invoice logic did not satisfy the business rules.

## Run 1: deepseek-v4-flash

Run ID: `04393fc4-9324-48a6-b245-0f0e5b389450`

Result:

- Status: `failed`
- Changed files: `src\settlement.mjs`
- Verification: `failed`
- Usage: input `217675`, output `4529`, total `222204`
- Turns: `9`
- Tool calls: `17`
- Successful tool calls: `14`
- Failed tool calls: `4`

Observed behavior:

- The model inspected package, source, and tests.
- It ran verification and edited the implementation.
- It corrupted the source file by leaving duplicate code after a broad range replacement.
- Independent verification correctly detected the syntax error and returned `FAIL`.

Assessment:

- DeepSeek model integration worked.
- Tool execution worked.
- Verification and independent verification worked.
- Single-run task completion failed.
- The failure mode suggests stronger edit guards are needed for broad `replace_file_range` operations.

## Run 2: deepseek-v4-pro

Run ID: `902f546d-1eab-4ce7-a1db-4cde17bd505d`

Result:

- Status: `failed`
- Changed files: `src\settlement.mjs`
- Verification: `failed`
- Usage: input `216216`, output `9171`, total `225387`
- Turns: `9`
- Tool calls: `15`
- Successful tool calls: `12`
- Failed tool calls: `5`

Observed behavior:

- The model inspected source and tests.
- It identified and partially fixed inventory reservation release.
- It did not complete invoice `paidAmount` / `creditBalance` and `customer_credit` ledger logic before the run ended.

Assessment:

- DeepSeek Pro performed better than Flash on code preservation.
- Single-run task completion still failed because iteration budget was exhausted before all failing assertions were fixed.

## Run 3: deepseek-v4-pro continuation

Run ID: `14ac39c7-3b05-4d8d-a7b8-5eaac19f9479`

Result:

- Status: `completed_with_warnings`
- Changed files: `src\settlement.mjs`
- Verification: `passed`
- Usage: input `279422`, output `3588`, total `283010`
- Turns: `11`
- Tool calls: `19`
- Successful tool calls: `16`
- Failed tool calls: `3`

Observed behavior:

- The system continued from the failed partial state.
- It fixed invoice `paidAmount`, `creditBalance`, and overpayment `customer_credit` ledger behavior.
- `npm test` passed.
- Independent verification passed.

Assessment:

- The system can complete the task with DeepSeek when given a continuation run.
- The single-run completion loop is not robust enough for this difficulty level.

## System Findings

1. DeepSeek provider integration is functional with the provided profile shape.
2. The system can drive real tools, edit files, and run verification through DeepSeek.
3. `deepseek-v4-flash` is risky for broad code edits in this runtime because it corrupted source structure.
4. `deepseek-v4-pro` is usable but needs more iterations or better automatic recovery for complex bugfixes.
5. Failed verification artifacts are stored outside the workspace root; when the model tried to read one through `read_file`, workspace path protection blocked it. This is correct for security, but the runtime should expose artifact reads through a dedicated safe tool or inline the relevant failure excerpt.
6. Runs with earlier failed tool calls can finish as `completed_with_warnings` even after final verification passes. This is accurate but should be made more explicit in operator output.

## Recommended Fixes

1. Add a safe artifact read tool for run-owned verification artifacts.
2. Add syntax or parse validation after broad file replacements when the file extension is known.
3. Automatically extend the iteration budget after a failed verification if the model made progress and no approval is blocked.
4. Prefer `edit_file` or smaller range replacements over broad `replace_file_range` for single-file source rewrites.
5. Add a DeepSeek live eval scenario to capture this behavior in repeatable regression testing.
