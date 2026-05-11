# Omni Agent Genesis

Omni Agent Genesis is the competition-facing HTX/Web3/B.AI track profile for Omni Agent.

The project should be presented as a verification-native AI finance execution agent, not as an autonomous trading bot. Its core claim is that every financial action is backed by traceable evidence: HTX market/account reads, Web3 wallet/risk reads, B.AI provider readiness, a guarded plan, an approval gate, and a paper-only execution record.

## Track Positioning

- Primary track: Genesis, because the demo combines AI Agent runtime, HTX resources, Web3 state, and B.AI readiness.
- Fallback track: AI, with the project description explicitly stating AI + Web3 / Genesis bonus alignment.
- Demo name: Omni Agent Genesis.
- Demo sentence: A verifiable AI finance agent for HTX + Web3 + B.AI that plans, checks risk, asks for approval, and records replayable evidence before any execution.

## Adapter Surface

The first implementation is deliberately thin and safe:

- `htx_market_data`: reads public HTX market data in mock or live mode.
- `htx_account_snapshot`: reads a fixture or a preconfigured read-only account gateway.
- `htx_order_preview`: validates symbol allowlists and max quote size; never places orders.
- `htx_paper_order`: records paper-only execution and requires `approved=true`.
- `web3_wallet_snapshot`: reads mock wallet state or EVM native balance through JSON-RPC.
- `web3_contract_risk`: flags unallowlisted spenders, odd address shapes, large allowances, and missing simulation.
- `web3_tron_account_snapshot`: reads TRON account and token balances through mock data or a TronScan-compatible endpoint.
- `web3_trc20_allowance`: reads TRC20 allowance through mock data or TRON `triggerconstantcontract`.
- `web3_revoke_approval_preview`: previews `approve(spender,0)` without signing or broadcasting.
- `web3_transfer_preview`: previews TRX/TRC20 transfer intent with amount caps and recipient allowlists.
- `web3_transaction_simulation`: compatibility tool name that produces a local risk summary for a Web3 preview; it sets `localRiskSummary=true` and `networkSimulation=false` and does not perform full-node or contract-state simulation.
- `bai_capability_probe`: probes mock B.AI readiness or the live OpenAI-compatible B.AI endpoint.
- `bai_chat_completion`: calls B.AI `/v1/chat/completions` in live mode when `BAI_API_KEY`, `B_AI_API_KEY`, or `OMNI_AGENT_BAI_API_KEY` is configured.
- `genesis_finance_plan`: composes the evidence into a guarded action plan.

## Safety Defaults

Live trading and live chain writes are not enabled. The demo supports mock data, read-only public data, read-only gateway data, EVM native balance reads, TRON account/allowance reads, Web3 transaction previews, local risk summaries, and paper execution.

Financial write actions must stay behind these gates:

- max quote amount defaults to `100` USDT;
- symbols default to `btcusdt`, `ethusdt`, `htxusdt`, and `trxusdt`;
- order previews always set `approvalRequired=true`;
- paper execution rejects missing approval;
- Web3 previews always set `approvalRequired=true`, `signed=false`, and `broadcast=false`;
- live order placement, arbitrary contract calls, wallet signing, and transaction broadcasting are intentionally unsupported.

## Environment Variables

Optional live or semi-live configuration:

```bash
OMNI_AGENT_HTX_BASE_URL=https://api.huobi.pro
OMNI_AGENT_HTX_ALLOWED_SYMBOLS=btcusdt,ethusdt,htxusdt,trxusdt
OMNI_AGENT_HTX_MAX_ORDER_USDT=100
OMNI_AGENT_HTX_ACCOUNT_ENDPOINT=https://internal-readonly-gateway.example/htx/account
OMNI_AGENT_HTX_ACCOUNT_TOKEN=...
OMNI_AGENT_WEB3_RPC_URL=https://example-evm-rpc
OMNI_AGENT_TRONSCAN_BASE_URL=https://ts.bankofai.io
TRONSCAN_API_KEY=
OMNI_AGENT_TRON_FULL_NODE_URL=https://hptg.bankofai.io
TRONGRID_API_KEY=
OMNI_AGENT_BAI_BASE_URL=https://api.b.ai
OMNI_AGENT_BAI_MODEL=gpt-5.2
BAI_API_KEY=...
```

`OMNI_AGENT_HTX_ACCOUNT_ENDPOINT` should be a read-only gateway. Do not put private trading keys directly into the demo adapter.
`OMNI_AGENT_TRONSCAN_BASE_URL` and `OMNI_AGENT_TRON_FULL_NODE_URL` can point at BofAI/TRON-compatible read-only endpoints; keep signer keys and wallet seed phrases out of the process.
Do not commit B.AI keys. Keep them in the shell environment, CI secret store, or deployment secret manager.

## Demo Flow

1. Read HTX market data for the target symbol.
2. Read a safe HTX account snapshot.
3. Read wallet state, TRON account state, TRC20 allowance, and Web3 contract risk.
4. Generate revoke/transfer previews and run a local Web3 risk summary.
5. Probe B.AI readiness and optionally request a live B.AI model summary through `bai_chat_completion`.
6. Build a Genesis finance plan.
7. Generate an HTX order preview.
8. After explicit approval, record a paper HTX order.
9. Show the run trace and eval result as evidence.

## Verification

```bash
node ./scripts/run-tests.mjs tests/tools.test.ts tests/approvals.test.ts
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode synthetic --no-save
npm run eval:benchmark -- --manifest examples/evals/htx-genesis.json --mode runtime --no-save
npm run maturity:check
```
