# Trading Safety

Omni Agent does not enable real trading by default. Genesis is a guarded paper-execution profile until a live adapter is explicitly reviewed, configured, and tested.

## Live Spot Preconditions

A live HTX spot adapter must not run unless all of these conditions are true:

- `OMNI_AGENT_ENABLE_LIVE_HTX_SPOT=1` is set for the process.
- The HTX API key has read and spot-trade scope only.
- Withdrawal, margin, loan, leverage, derivatives, futures, and contract scopes are disabled.
- The symbol is in an explicit allowlist.
- The quote amount is under a per-order cap.
- The tool creates an order preview, risk report, approval record, and run artifact before placement.
- A human approval decision is present for the exact symbol, side, amount, and account.
- The adapter records order id, status query result, failure reason when present, and replay evidence after placement.

## Forbidden Defaults

These actions remain unsupported in the Genesis demo:

- withdrawal;
- leverage or contract trading;
- arbitrary contract calls;
- wallet signing;
- transaction broadcast;
- default use of a real exchange key;
- live execution without a prior preview and approval artifact.

## Required Evidence

Every live-capable future adapter should preserve:

- model plan and risk summary;
- HTX market and read-only account evidence;
- Web3 wallet, TRON account, allowance, and local risk summary evidence;
- approval request and approval decision;
- order preview payload;
- post-order status payload;
- redacted configuration showing that live spot was explicitly enabled.
