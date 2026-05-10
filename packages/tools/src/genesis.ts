import { createHash, randomUUID } from "node:crypto";

type GenesisToolResult = {
  readonly ok: boolean;
  readonly summary: string;
  readonly data?: unknown;
  readonly warnings?: string[];
  readonly presentation?: {
    readonly title?: string;
    readonly kind?: "read" | "edit" | "execute" | "search" | "fetch" | "other";
    readonly content?: readonly [{ readonly type: "text"; readonly text: string }];
  };
};

type GenesisToolContext = {
  readonly abortSignal?: AbortSignal;
};

type GenesisToolDefinition = {
  readonly name: string;
  readonly description: string;
  readonly inputHint: string;
  readonly riskHint: string;
  execute(context: GenesisToolContext, args: Record<string, unknown>): Promise<GenesisToolResult>;
};

type GenesisToolRegistry = {
  register(definition: GenesisToolDefinition): void;
};

type MarketSnapshot = {
  readonly venue: "htx";
  readonly symbol: string;
  readonly mode: GenesisAdapterMode;
  readonly price: number;
  readonly bid?: number;
  readonly ask?: number;
  readonly source: string;
  readonly observedAt: string;
};

type AccountSnapshot = {
  readonly venue: "htx";
  readonly mode: GenesisAdapterMode;
  readonly balances: readonly AssetBalance[];
  readonly source: string;
  readonly observedAt: string;
};

type AssetBalance = {
  readonly asset: string;
  readonly available: number;
  readonly locked?: number;
};

type WalletSnapshot = {
  readonly chain: string;
  readonly address: string;
  readonly mode: GenesisAdapterMode;
  readonly nativeBalance: string;
  readonly nativeSymbol: string;
  readonly tokenBalances: readonly AssetBalance[];
  readonly source: string;
  readonly observedAt: string;
};

type TronAccountSnapshot = {
  readonly chain: "tron";
  readonly address: string;
  readonly mode: GenesisAdapterMode;
  readonly nativeBalance: string;
  readonly nativeSymbol: "TRX";
  readonly tokenBalances: readonly AssetBalance[];
  readonly source: string;
  readonly observedAt: string;
  readonly resources?: {
    readonly bandwidth?: number;
    readonly energy?: number;
  };
};

type Trc20AllowanceSnapshot = {
  readonly chain: "tron";
  readonly mode: GenesisAdapterMode;
  readonly tokenSymbol: string;
  readonly tokenAddress: string;
  readonly owner: string;
  readonly spender: string;
  readonly decimals: number;
  readonly allowance: string;
  readonly allowanceRaw: string;
  readonly isUnlimited: boolean;
  readonly source: string;
  readonly observedAt: string;
};

type TronTokenDefinition = {
  readonly symbol: string;
  readonly address: string;
  readonly decimals: number;
};

type GenesisAdapterMode = "mock" | "live";
type BaiChatMessage = {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
};

const DEFAULT_HTX_MARKET_BASE_URL = "https://api.huobi.pro";
const DEFAULT_BAI_BASE_URL = "https://api.b.ai";
const DEFAULT_BAI_CHAT_MODEL = "gpt-5.2";
const DEFAULT_TRONSCAN_BASE_URL = "https://ts.bankofai.io";
const DEFAULT_TRONSCAN_API_BASE_URL = "https://apilist.tronscanapi.com";
const DEFAULT_TRON_FULL_NODE_URL = "https://hptg.bankofai.io";
const DEFAULT_ALLOWED_SYMBOLS = ["btcusdt", "ethusdt", "htxusdt", "trxusdt"];
const DEFAULT_MAX_ORDER_USDT = 100;
const DEFAULT_MAX_TRANSFER_AMOUNT = 1_000;
const TRON_BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DEFAULT_TRON_ADDRESS = "TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf";
const DEFAULT_TRON_TOKENS: Record<string, TronTokenDefinition> = {
  USDT: {
    symbol: "USDT",
    address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    decimals: 6,
  },
  USDD: {
    symbol: "USDD",
    address: "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn",
    decimals: 18,
  },
  HTX: {
    symbol: "HTX",
    address: "TXWkP3jLBqRGojUih1ShzNyDaN5Csnebok",
    decimals: 18,
  },
};

export function registerGenesisTools(registry: GenesisToolRegistry): void {
  registry.register({
    name: "htx_market_data",
    description: "Read HTX market data for an allowed trading symbol using mock data by default or the public HTX market API in live mode.",
    inputHint: "{ symbol: string, mode?: 'mock'|'live', baseUrl?: string, timeoutMs?: number }",
    riskHint: "network read-only financial market data",
    async execute(context, args) {
      const symbol = normalizeSymbol(args.symbol, "btcusdt");
      const mode = normalizeMode(args.mode);
      const snapshot = mode === "live"
        ? await fetchHtxMarketSnapshot(context, args, symbol)
        : buildMockMarketSnapshot(symbol);
      return {
        ok: true,
        summary: `Read HTX ${snapshot.symbol.toUpperCase()} market snapshot from ${snapshot.source}.`,
        data: snapshot,
        presentation: buildTextPresentation(
          "HTX market snapshot",
          `symbol: ${snapshot.symbol}\nprice: ${snapshot.price}\nsource: ${snapshot.source}\nmode: ${snapshot.mode}`,
        ),
      };
    },
  });

  registry.register({
    name: "htx_account_snapshot",
    description: "Read a safe HTX account snapshot from an explicit fixture or a preconfigured read-only gateway endpoint.",
    inputHint: "{ mode?: 'mock'|'live', accountFixture?: object, endpoint?: string, tokenEnv?: string, timeoutMs?: number }",
    riskHint: "network read-only financial account data",
    async execute(context, args) {
      const mode = normalizeMode(args.mode);
      const snapshot = mode === "live"
        ? await fetchHtxAccountSnapshot(context, args)
        : buildMockAccountSnapshot(args.accountFixture);
      return {
        ok: true,
        summary: `Read HTX account snapshot with ${snapshot.balances.length} balance entrie(s) from ${snapshot.source}.`,
        data: snapshot,
        presentation: buildTextPresentation(
          "HTX account snapshot",
          snapshot.balances.map((entry) => `${entry.asset}: available=${entry.available} locked=${entry.locked ?? 0}`).join("\n"),
        ),
      };
    },
  });

  registry.register({
    name: "htx_order_preview",
    description: "Create a guarded HTX order preview with symbol allowlist, quote-size cap, and explicit approval requirement.",
    inputHint: "{ symbol: string, side: 'buy'|'sell', quoteAmountUsdt?: number, quantity?: number, price?: number, maxOrderUsdt?: number, allowedSymbols?: string[] }",
    riskHint: "financial order preview only; does not place orders",
    async execute(_context, args) {
      const preview = buildHtxOrderPreview(args);
      return {
        ok: preview.allowed,
        summary: preview.allowed
          ? `Prepared HTX ${preview.side} preview for ${preview.symbol.toUpperCase()}; approval required before any execution.`
          : `Rejected HTX order preview for ${preview.symbol.toUpperCase()}: ${preview.rejectionReasons.join("; ")}`,
        data: preview,
        warnings: preview.allowed ? ["Preview only. No live order was placed."] : preview.rejectionReasons,
        presentation: buildTextPresentation(
          "HTX order preview",
          `symbol: ${preview.symbol}\nside: ${preview.side}\nquoteAmountUsdt: ${preview.quoteAmountUsdt}\napprovalRequired: ${preview.approvalRequired}\nallowed: ${preview.allowed}`,
        ),
      };
    },
  });

  registry.register({
    name: "htx_paper_order",
    description: "Execute a paper-only HTX order from an approved preview; live order placement is intentionally unsupported.",
    inputHint: "{ symbol: string, side: 'buy'|'sell', quoteAmountUsdt?: number, quantity?: number, price?: number, approved: boolean, maxOrderUsdt?: number, allowedSymbols?: string[] }",
    riskHint: "paper trading state only; never places live orders",
    async execute(_context, args) {
      if (!normalizeBoolean(args.approved)) {
        return {
          ok: false,
          summary: "Paper order blocked because approved=true was not supplied.",
          data: {
            blocked: true,
            reason: "missing_approval",
            requiredApproval: true,
          },
        };
      }
      const preview = buildHtxOrderPreview(args);
      if (!preview.allowed) {
        return {
          ok: false,
          summary: `Paper order blocked: ${preview.rejectionReasons.join("; ")}`,
          data: {
            blocked: true,
            preview,
          },
          warnings: preview.rejectionReasons,
        };
      }
      const record = {
        id: `paper-${randomUUID()}`,
        venue: "htx",
        symbol: preview.symbol,
        side: preview.side,
        quoteAmountUsdt: preview.quoteAmountUsdt,
        quantity: preview.quantity,
        price: preview.price,
        status: "filled_paper",
        liveOrderPlaced: false,
        approved: true,
        executedAt: new Date().toISOString(),
      };
      return {
        ok: true,
        summary: `Recorded paper HTX ${record.side} order ${record.id}; no live order was placed.`,
        data: record,
        warnings: ["Paper execution only. Wire a dedicated signed HTX adapter before enabling live placement."],
      };
    },
  });

  registry.register({
    name: "web3_wallet_snapshot",
    description: "Read a Web3 wallet snapshot from mock data or an EVM JSON-RPC endpoint for native balance only.",
    inputHint: "{ chain?: 'evm', address: string, mode?: 'mock'|'live', rpcUrl?: string, tokenBalances?: object[], timeoutMs?: number }",
    riskHint: "network read-only wallet data",
    async execute(context, args) {
      const mode = normalizeMode(args.mode);
      const address = normalizeAddress(args.address);
      const snapshot = mode === "live"
        ? await fetchEvmWalletSnapshot(context, args, address)
        : buildMockWalletSnapshot(args, address);
      return {
        ok: true,
        summary: `Read ${snapshot.chain} wallet snapshot for ${snapshot.address} from ${snapshot.source}.`,
        data: snapshot,
        presentation: buildTextPresentation(
          "Web3 wallet snapshot",
          `chain: ${snapshot.chain}\naddress: ${snapshot.address}\nnativeBalance: ${snapshot.nativeBalance} ${snapshot.nativeSymbol}\nsource: ${snapshot.source}`,
        ),
      };
    },
  });

  registry.register({
    name: "web3_contract_risk",
    description: "Score a token, spender, or contract interaction using allowlists, allowance size, and basic address-shape checks.",
    inputHint: "{ chain?: string, contractAddress?: string, tokenSymbol?: string, spender?: string, allowance?: string|number, spenderAllowlist?: string[], simulated?: boolean }",
    riskHint: "read-only Web3 risk analysis",
    async execute(_context, args) {
      const report = buildWeb3RiskReport(args);
      return {
        ok: report.riskLevel !== "blocked",
        summary: `Web3 risk report for ${report.tokenSymbol ?? report.contractAddress ?? "interaction"}: ${report.riskLevel}.`,
        data: report,
        warnings: report.findings,
      };
    },
  });

  registry.register({
    name: "web3_tron_account_snapshot",
    description: "Read a TRON account snapshot from mock data or a TronScan-compatible read-only endpoint.",
    inputHint: "{ address: string, mode?: 'mock'|'live', baseUrl?: string, apiKeyEnv?: string, includeTokens?: boolean, timeoutMs?: number, accountFixture?: object }",
    riskHint: "network read-only TRON account data",
    async execute(context, args) {
      const mode = normalizeMode(args.mode);
      const address = normalizeTronAddress(args.address);
      const snapshot = mode === "live"
        ? await fetchTronAccountSnapshot(context, args, address)
        : buildMockTronAccountSnapshot(args, address);
      return {
        ok: true,
        summary: `Read TRON account snapshot for ${snapshot.address} from ${snapshot.source}.`,
        data: snapshot,
        presentation: buildTextPresentation(
          "TRON account snapshot",
          `address: ${snapshot.address}\nnativeBalance: ${snapshot.nativeBalance} TRX\ntokenBalances: ${snapshot.tokenBalances.length}\nsource: ${snapshot.source}`,
        ),
      };
    },
  });

  registry.register({
    name: "web3_trc20_allowance",
    description: "Read a TRC20 allowance from mock data or a TRON full-node triggerconstantcontract call.",
    inputHint: "{ token: string, owner: string, spender: string, mode?: 'mock'|'live', fullNodeUrl?: string, decimals?: number, tokenSymbol?: string, allowance?: string|number, allowanceRaw?: string, timeoutMs?: number }",
    riskHint: "network read-only TRC20 allowance data",
    async execute(context, args) {
      const mode = normalizeMode(args.mode);
      const allowance = mode === "live"
        ? await fetchTrc20Allowance(context, args)
        : buildMockTrc20Allowance(args);
      return {
        ok: true,
        summary: `Read ${allowance.tokenSymbol} allowance from ${allowance.owner} to ${allowance.spender}: ${allowance.allowance}.`,
        data: allowance,
        presentation: buildTextPresentation(
          "TRC20 allowance",
          `token: ${allowance.tokenSymbol}\nowner: ${allowance.owner}\nspender: ${allowance.spender}\nallowance: ${allowance.allowance}\nsource: ${allowance.source}`,
        ),
      };
    },
  });

  registry.register({
    name: "web3_revoke_approval_preview",
    description: "Preview a safe approval revocation call without signing or broadcasting a transaction.",
    inputHint: "{ chain?: 'tron'|'evm', token: string, owner?: string, spender: string, tokenSymbol?: string, currentAllowance?: string|number, spenderAllowlist?: string[], approved?: boolean }",
    riskHint: "TRC20/EVM revoke approval preview only; does not sign or broadcast",
    async execute(_context, args) {
      const preview = buildRevokeApprovalPreview(args);
      return {
        ok: preview.allowed,
        summary: preview.allowed
          ? `Prepared ${preview.chain} revoke approval preview for ${preview.tokenSymbol}; explicit approval still required.`
          : `Rejected revoke approval preview: ${preview.rejectionReasons.join("; ")}`,
        data: preview,
        warnings: preview.allowed ? ["Preview only. No transaction was signed or broadcast."] : preview.rejectionReasons,
      };
    },
  });

  registry.register({
    name: "web3_transfer_preview",
    description: "Preview a guarded TRON or EVM transfer without signing or broadcasting a transaction.",
    inputHint: "{ chain?: 'tron'|'evm', asset?: string, token?: string, from?: string, to: string, amount: string|number, decimals?: number, maxAmount?: number, recipientAllowlist?: string[] }",
    riskHint: "Web3 transfer preview only; does not sign or broadcast",
    async execute(_context, args) {
      const preview = buildTransferPreview(args);
      return {
        ok: preview.allowed,
        summary: preview.allowed
          ? `Prepared ${preview.chain} ${preview.asset} transfer preview for ${preview.amount}; approval required before execution.`
          : `Rejected transfer preview: ${preview.rejectionReasons.join("; ")}`,
        data: preview,
        warnings: preview.allowed ? ["Preview only. No transaction was signed or broadcast."] : preview.rejectionReasons,
      };
    },
  });

  registry.register({
    name: "web3_transaction_simulation",
    description: "Simulate a Web3 preview locally and return a deterministic risk decision without signing or broadcasting.",
    inputHint: "{ action: string, chain?: string, preview?: object, riskReport?: object, balance?: string|number, allowance?: string|number, maxAmount?: number }",
    riskHint: "local transaction simulation and risk summary only",
    async execute(_context, args) {
      const simulation = buildWeb3TransactionSimulation(args);
      return {
        ok: simulation.decision !== "blocked",
        summary: `Web3 transaction simulation decision=${simulation.decision}; riskLevel=${simulation.riskLevel}.`,
        data: simulation,
        warnings: simulation.findings,
      };
    },
  });

  registry.register({
    name: "bai_capability_probe",
    description: "Probe B.AI compatibility through mock metadata or the OpenAI-compatible B.AI /v1/models endpoint.",
    inputHint: "{ mode?: 'mock'|'live', baseUrl?: string, path?: string, apiKeyEnv?: string, timeoutMs?: number }",
    riskHint: "network read-only model provider probe",
    async execute(context, args) {
      const mode = normalizeMode(args.mode);
      const probe = mode === "live"
        ? await fetchBaiProbe(context, args)
        : buildMockBaiProbe();
      return {
        ok: true,
        summary: `B.AI probe completed in ${probe.mode} mode with provider status ${probe.status}.`,
        data: probe,
        presentation: buildTextPresentation(
          "B.AI capability probe",
          `status: ${probe.status}\nmode: ${probe.mode}\nopenAiCompatible: ${probe.openAiCompatible}\nsource: ${probe.source}`,
        ),
      };
    },
  });

  registry.register({
    name: "bai_chat_completion",
    description: "Call B.AI's OpenAI-compatible /v1/chat/completions endpoint for a model response without storing API keys.",
    inputHint: "{ mode?: 'mock'|'live', prompt?: string, messages?: [{ role: 'system'|'user'|'assistant', content: string }], model?: string, baseUrl?: string, apiKeyEnv?: string, temperature?: number, maxTokens?: number, stream?: boolean, timeoutMs?: number }",
    riskHint: "network model inference; sends supplied prompt/messages to B.AI",
    async execute(context, args) {
      const mode = normalizeMode(args.mode);
      const completion = mode === "live"
        ? await fetchBaiChatCompletion(context, args)
        : buildMockBaiChatCompletion(args);
      return {
        ok: completion.status === "completed",
        summary: completion.status === "completed"
          ? `B.AI chat completion returned ${completion.content.length} character(s) with model ${completion.model}.`
          : `B.AI chat completion did not run: ${completion.reason}.`,
        data: completion,
        warnings: completion.status === "completed" ? [] : [completion.reason],
        presentation: buildTextPresentation(
          "B.AI chat completion",
          `status: ${completion.status}\nmode: ${completion.mode}\nmodel: ${completion.model}\nsource: ${completion.source}\ncontent: ${completion.content}`,
        ),
      };
    },
  });

  registry.register({
    name: "genesis_finance_plan",
    description: "Compose HTX, Web3, and B.AI observations into a Genesis competition finance-agent plan with risk gates and approval state.",
    inputHint: "{ intent: string, symbol?: string, amountUsdt?: number, market?: object, account?: object, wallet?: object, riskReport?: object, maxOrderUsdt?: number }",
    riskHint: "read-only financial planning; does not execute trades",
    async execute(_context, args) {
      const plan = buildGenesisFinancePlan(args);
      return {
        ok: plan.decision !== "blocked",
        summary: `Genesis finance plan decision=${plan.decision}; approvalRequired=${plan.approvalRequired}.`,
        data: plan,
        warnings: plan.riskFindings,
        presentation: buildTextPresentation(
          "Genesis finance plan",
          [
            `intent: ${plan.intent}`,
            `decision: ${plan.decision}`,
            `riskLevel: ${plan.riskLevel}`,
            `approvalRequired: ${plan.approvalRequired}`,
            `nextAction: ${plan.nextAction}`,
          ].join("\n"),
        ),
      };
    },
  });
}

async function fetchHtxMarketSnapshot(
  context: GenesisToolContext,
  args: Record<string, unknown>,
  symbol: string,
): Promise<MarketSnapshot> {
  const baseUrl = normalizeUrl(args.baseUrl) ?? normalizeUrl(process.env.OMNI_AGENT_HTX_BASE_URL) ?? DEFAULT_HTX_MARKET_BASE_URL;
  const timeoutMs = normalizePositiveInteger(args.timeoutMs, 10_000);
  const url = new URL("/market/detail/merged", baseUrl);
  url.searchParams.set("symbol", symbol);
  const response = await fetchWithTimeout(url, { signal: context.abortSignal, timeoutMs });
  const payload = await response.json() as Record<string, unknown>;
  const tick = isRecord(payload.tick) ? payload.tick : {};
  const price = normalizeNumber(tick.close ?? tick.last ?? tick.price);
  if (!response.ok || price === undefined) {
    throw new Error(`HTX market fetch failed for ${symbol}: status=${response.status}`);
  }
  return {
    venue: "htx",
    symbol,
    mode: "live",
    price,
    bid: normalizeNestedTickerNumber(tick.bid),
    ask: normalizeNestedTickerNumber(tick.ask),
    source: url.origin,
    observedAt: new Date(normalizeNumber(payload.ts) ?? Date.now()).toISOString(),
  };
}

async function fetchHtxAccountSnapshot(
  context: GenesisToolContext,
  args: Record<string, unknown>,
): Promise<AccountSnapshot> {
  const endpoint = normalizeUrl(args.endpoint) ?? normalizeUrl(process.env.OMNI_AGENT_HTX_ACCOUNT_ENDPOINT);
  if (!endpoint) {
    return buildMockAccountSnapshot(args.accountFixture, "mock-account-fixture:no-readonly-gateway-configured");
  }
  const tokenEnv = normalizeString(args.tokenEnv) ?? "OMNI_AGENT_HTX_ACCOUNT_TOKEN";
  const token = process.env[tokenEnv];
  const headers: Record<string, string> = {
    "user-agent": "omni-agent/0.1",
    accept: "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetchWithTimeout(new URL(endpoint), {
    signal: context.abortSignal,
    timeoutMs: normalizePositiveInteger(args.timeoutMs, 10_000),
    headers,
  });
  if (!response.ok) {
    throw new Error(`HTX account gateway fetch failed: status=${response.status}`);
  }
  const payload = await response.json();
  return {
    venue: "htx",
    mode: "live",
    balances: normalizeBalances(isRecord(payload) ? payload.balances : undefined),
    source: endpoint,
    observedAt: new Date().toISOString(),
  };
}

async function fetchEvmWalletSnapshot(
  context: GenesisToolContext,
  args: Record<string, unknown>,
  address: string,
): Promise<WalletSnapshot> {
  const rpcUrl = normalizeUrl(args.rpcUrl) ?? normalizeUrl(process.env.OMNI_AGENT_WEB3_RPC_URL);
  if (!rpcUrl) {
    return buildMockWalletSnapshot(args, address, "mock-wallet-fixture:no-rpc-configured");
  }
  const response = await fetchWithTimeout(new URL(rpcUrl), {
    signal: context.abortSignal,
    timeoutMs: normalizePositiveInteger(args.timeoutMs, 10_000),
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "omni-agent/0.1",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  if (!response.ok) {
    throw new Error(`EVM RPC balance fetch failed: status=${response.status}`);
  }
  const payload = await response.json() as Record<string, unknown>;
  const hexBalance = typeof payload.result === "string" ? payload.result : "0x0";
  return {
    chain: "evm",
    address,
    mode: "live",
    nativeBalance: formatWeiAsEth(hexBalance),
    nativeSymbol: normalizeString(args.nativeSymbol) ?? "ETH",
    tokenBalances: normalizeBalances(args.tokenBalances),
    source: rpcUrl,
    observedAt: new Date().toISOString(),
  };
}

async function fetchBaiProbe(context: GenesisToolContext, args: Record<string, unknown>) {
  const baseUrl = resolveBaiBaseUrl(args);
  const path = normalizeString(args.path) ?? "/v1/models";
  const url = new URL(path, baseUrl);
  const apiKey = resolveBaiApiKey(args);
  const headers: Record<string, string> = {
    "user-agent": "omni-agent/0.1",
    accept: "application/json",
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const response = await fetchWithTimeout(url, {
    signal: context.abortSignal,
    timeoutMs: normalizePositiveInteger(args.timeoutMs, 10_000),
    headers,
  });
  const text = await response.text();
  return {
    provider: "b.ai",
    mode: "live" as const,
    status: response.ok ? "reachable" : "unhealthy",
    openAiCompatible: path.includes("/v1/models") && response.ok,
    source: url.toString(),
    statusCode: response.status,
    apiKeyConfigured: Boolean(apiKey),
    preview: redactSecretLikeText(text).slice(0, 500),
  };
}

async function fetchBaiChatCompletion(context: GenesisToolContext, args: Record<string, unknown>) {
  const apiKey = resolveBaiApiKey(args);
  const model = normalizeString(args.model) ?? normalizeString(process.env.OMNI_AGENT_BAI_MODEL) ?? DEFAULT_BAI_CHAT_MODEL;
  if (!apiKey) {
    return {
      provider: "b.ai",
      mode: "live" as const,
      status: "blocked" as const,
      reason: "missing B.AI API key; set BAI_API_KEY, B_AI_API_KEY, or OMNI_AGENT_BAI_API_KEY",
      model,
      source: new URL("/v1/chat/completions", resolveBaiBaseUrl(args)).toString(),
      content: "",
      apiKeyConfigured: false,
    };
  }

  const messages = normalizeBaiMessages(args.messages, args.prompt);
  const stream = normalizeBoolean(args.stream);
  const url = new URL("/v1/chat/completions", resolveBaiBaseUrl(args));
  const payload = {
    model,
    messages,
    stream,
    temperature: normalizeNumber(args.temperature) ?? 0.7,
    max_tokens: normalizePositiveInteger(args.maxTokens ?? args.max_tokens, 1_000),
  };
  const response = await fetchWithTimeout(url, {
    signal: context.abortSignal,
    timeoutMs: normalizePositiveInteger(args.timeoutMs, 30_000),
    method: "POST",
    headers: {
      "authorization": `Bearer ${apiKey}`,
      "content-type": "application/json",
      "user-agent": "omni-agent/0.1",
      accept: stream ? "text/event-stream, application/json" : "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    return {
      provider: "b.ai",
      mode: "live" as const,
      status: "failed" as const,
      reason: `B.AI chat completion failed with status ${response.status}`,
      model,
      source: url.toString(),
      statusCode: response.status,
      content: "",
      responsePreview: redactSecretLikeText(text).slice(0, 500),
      apiKeyConfigured: true,
    };
  }
  const parsed = parseBaiChatResponse(text, stream);
  return {
    provider: "b.ai",
    mode: "live" as const,
    status: "completed" as const,
    reason: "",
    model,
    source: url.toString(),
    statusCode: response.status,
    content: parsed.content,
    finishReason: parsed.finishReason,
    usage: parsed.usage,
    streamed: stream,
    apiKeyConfigured: true,
  };
}

function buildMockMarketSnapshot(symbol: string): MarketSnapshot {
  const prices: Record<string, number> = {
    btcusdt: 96000,
    ethusdt: 3200,
    htxusdt: 0.0000012,
    trxusdt: 0.11,
  };
  const price = prices[symbol] ?? 1;
  return {
    venue: "htx",
    symbol,
    mode: "mock",
    price,
    bid: Number((price * 0.999).toFixed(8)),
    ask: Number((price * 1.001).toFixed(8)),
    source: "mock-htx-market",
    observedAt: new Date().toISOString(),
  };
}

function buildMockAccountSnapshot(fixture: unknown, source = "mock-htx-account"): AccountSnapshot {
  const fixtureRecord = isRecord(fixture) ? fixture : parseJsonObject(process.env.OMNI_AGENT_HTX_ACCOUNT_FIXTURE_JSON);
  return {
    venue: "htx",
    mode: "mock",
    balances: normalizeBalances(fixtureRecord?.balances ?? [
      { asset: "USDT", available: 250, locked: 0 },
      { asset: "HTX", available: 5000, locked: 0 },
    ]),
    source,
    observedAt: new Date().toISOString(),
  };
}

function buildMockWalletSnapshot(args: Record<string, unknown>, address: string, source = "mock-web3-wallet"): WalletSnapshot {
  return {
    chain: normalizeString(args.chain) ?? "evm",
    address,
    mode: "mock",
    nativeBalance: normalizeString(args.nativeBalance) ?? "1.250000",
    nativeSymbol: normalizeString(args.nativeSymbol) ?? "ETH",
    tokenBalances: normalizeBalances(args.tokenBalances ?? [
      { asset: "USDT", available: 100, locked: 0 },
      { asset: "HTX", available: 2500, locked: 0 },
    ]),
    source,
    observedAt: new Date().toISOString(),
  };
}

function buildMockBaiProbe() {
  return {
    provider: "b.ai",
    mode: "mock" as const,
    status: "ready",
    openAiCompatible: true,
    source: "mock-bai-provider",
    capabilities: [
      "openai-compatible model profile",
      "agent financial planning adapter",
      "future signed wallet/payment tools",
    ],
  };
}

function buildMockBaiChatCompletion(args: Record<string, unknown>) {
  const messages = normalizeBaiMessages(args.messages, args.prompt);
  const userMessage = [...messages].reverse().find((message) => message.role === "user")?.content ?? "Hello World";
  const model = normalizeString(args.model) ?? DEFAULT_BAI_CHAT_MODEL;
  return {
    provider: "b.ai",
    mode: "mock" as const,
    status: "completed" as const,
    reason: "",
    model,
    source: "mock-bai-chat-provider",
    content: `Mock B.AI response for: ${redactSecretLikeText(userMessage).slice(0, 160)}`,
    finishReason: "stop",
    usage: null,
    streamed: false,
    apiKeyConfigured: false,
  };
}

function resolveBaiBaseUrl(args: Record<string, unknown>): string {
  return normalizeUrl(args.baseUrl) ?? normalizeUrl(process.env.OMNI_AGENT_BAI_BASE_URL) ?? DEFAULT_BAI_BASE_URL;
}

function resolveBaiApiKey(args: Record<string, unknown>): string | undefined {
  const apiKeyEnv = normalizeString(args.apiKeyEnv);
  if (apiKeyEnv) {
    return normalizeString(process.env[apiKeyEnv]);
  }
  return normalizeString(process.env.BAI_API_KEY)
    ?? normalizeString(process.env.B_AI_API_KEY)
    ?? normalizeString(process.env.OMNI_AGENT_BAI_API_KEY);
}

function normalizeBaiMessages(messages: unknown, prompt: unknown): BaiChatMessage[] {
  const normalizedMessages = Array.isArray(messages)
    ? messages
        .filter(isRecord)
        .map((entry) => {
          const role = normalizeBaiRole(entry.role);
          const content = normalizeString(entry.content);
          return role && content ? { role, content } : null;
        })
        .filter((entry): entry is BaiChatMessage => Boolean(entry))
    : [];
  if (normalizedMessages.length > 0) {
    return normalizedMessages;
  }
  return [
    {
      role: "user",
      content: normalizeString(prompt) ?? "Hello World",
    },
  ];
}

function normalizeBaiRole(value: unknown): BaiChatMessage["role"] | undefined {
  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized === "system" || normalized === "user" || normalized === "assistant") {
    return normalized;
  }
  return undefined;
}

function parseBaiChatResponse(text: string, streamed: boolean): {
  readonly content: string;
  readonly finishReason: string | null;
  readonly usage: unknown;
} {
  if (streamed) {
    return parseBaiStreamResponse(text);
  }
  const parsed = parseJsonObject(text);
  if (!parsed) {
    return {
      content: redactSecretLikeText(text).slice(0, 4_000),
      finishReason: null,
      usage: null,
    };
  }
  const choices = Array.isArray(parsed.choices) ? parsed.choices.filter(isRecord) : [];
  const firstChoice = choices[0];
  const message = isRecord(firstChoice?.message) ? firstChoice.message : undefined;
  const content = extractBaiContent(message?.content) ?? extractBaiContent(firstChoice?.text) ?? "";
  return {
    content: redactSecretLikeText(content),
    finishReason: normalizeString(firstChoice?.finish_reason ?? firstChoice?.finishReason) ?? null,
    usage: parsed.usage ?? null,
  };
}

function parseBaiStreamResponse(text: string): {
  readonly content: string;
  readonly finishReason: string | null;
  readonly usage: unknown;
} {
  const chunks: string[] = [];
  let finishReason: string | null = null;
  let usage: unknown = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    const parsed = parseJsonObject(data);
    if (!parsed) {
      continue;
    }
    usage = parsed.usage ?? usage;
    const choices = Array.isArray(parsed.choices) ? parsed.choices.filter(isRecord) : [];
    for (const choice of choices) {
      const delta = isRecord(choice.delta) ? choice.delta : undefined;
      const message = isRecord(choice.message) ? choice.message : undefined;
      const content = extractBaiContent(delta?.content) ?? extractBaiContent(message?.content);
      if (content) {
        chunks.push(content);
      }
      finishReason = normalizeString(choice.finish_reason ?? choice.finishReason) ?? finishReason;
    }
  }
  return {
    content: redactSecretLikeText(chunks.join("")),
    finishReason,
    usage,
  };
}

function extractBaiContent(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts = value
    .filter(isRecord)
    .map((entry) => normalizeString(entry.text ?? entry.content))
    .filter((entry): entry is string => Boolean(entry));
  return parts.length > 0 ? parts.join("") : undefined;
}

function buildHtxOrderPreview(args: Record<string, unknown>) {
  const symbol = normalizeSymbol(args.symbol, "btcusdt");
  const side = normalizeOrderSide(args.side);
  const price = normalizeNumber(args.price) ?? buildMockMarketSnapshot(symbol).price;
  const quantity = normalizeNumber(args.quantity);
  const quoteAmountUsdt = normalizeNumber(args.quoteAmountUsdt) ?? (quantity !== undefined ? Number((quantity * price).toFixed(8)) : 0);
  const maxOrderUsdt = normalizeNumber(args.maxOrderUsdt) ?? normalizeEnvNumber("OMNI_AGENT_HTX_MAX_ORDER_USDT") ?? DEFAULT_MAX_ORDER_USDT;
  const allowedSymbols = normalizeSymbolList(args.allowedSymbols) ?? normalizeSymbolList(process.env.OMNI_AGENT_HTX_ALLOWED_SYMBOLS) ?? DEFAULT_ALLOWED_SYMBOLS;
  const rejectionReasons: string[] = [];
  if (!allowedSymbols.includes(symbol)) {
    rejectionReasons.push(`symbol ${symbol} is not in the allowlist`);
  }
  if (quoteAmountUsdt <= 0) {
    rejectionReasons.push("quoteAmountUsdt must be greater than 0");
  }
  if (quoteAmountUsdt > maxOrderUsdt) {
    rejectionReasons.push(`quoteAmountUsdt ${quoteAmountUsdt} exceeds maxOrderUsdt ${maxOrderUsdt}`);
  }
  return {
    venue: "htx",
    symbol,
    side,
    price,
    quantity: quantity ?? Number((quoteAmountUsdt / price).toFixed(8)),
    quoteAmountUsdt,
    maxOrderUsdt,
    allowedSymbols,
    allowed: rejectionReasons.length === 0,
    rejectionReasons,
    approvalRequired: true,
    liveOrderPlaced: false,
  };
}

function buildWeb3RiskReport(args: Record<string, unknown>) {
  const contractAddress = normalizeString(args.contractAddress);
  const spender = normalizeString(args.spender);
  const tokenSymbol = normalizeString(args.tokenSymbol)?.toUpperCase();
  const allowlist = normalizeAddressList(args.spenderAllowlist);
  const allowance = normalizeNumber(args.allowance);
  const findings: string[] = [];
  if (contractAddress && !isLikelyEvmAddress(contractAddress)) {
    findings.push("contractAddress does not look like an EVM address");
  }
  if (spender && allowlist.length > 0 && !allowlist.includes(spender.toLowerCase())) {
    findings.push("spender is not in the allowlist");
  }
  if (allowance !== undefined && allowance > 1_000_000) {
    findings.push("allowance is unusually large and should be revoked or capped");
  }
  if (!normalizeBoolean(args.simulated)) {
    findings.push("interaction has not been simulated yet");
  }
  const riskLevel = findings.some((entry) => entry.includes("not in the allowlist") || entry.includes("does not look"))
    ? "blocked"
    : findings.length > 0
      ? "review"
      : "low";
  return {
    chain: normalizeString(args.chain) ?? "evm",
    contractAddress: contractAddress ?? null,
    tokenSymbol: tokenSymbol ?? null,
    spender: spender ?? null,
    allowance: allowance ?? null,
    riskLevel,
    findings,
    requiredMitigations: riskLevel === "low"
      ? []
      : ["run transaction simulation", "require explicit approval", "cap allowance or use an allowlisted spender"],
  };
}

async function fetchTronAccountSnapshot(
  context: GenesisToolContext,
  args: Record<string, unknown>,
  address: string,
): Promise<TronAccountSnapshot> {
  if (!isLikelyTronAddress(address)) {
    throw new Error(`Invalid TRON address: ${address}`);
  }
  const apiKey = resolveTronScanApiKey(args);
  const baseUrl = resolveTronScanBaseUrl(args, apiKey);
  const timeoutMs = normalizePositiveInteger(args.timeoutMs, 10_000);
  const headers = buildTronHeaders(apiKey);
  const accountUrl = new URL("/api/accountv2", baseUrl);
  accountUrl.searchParams.set("address", address);
  const accountResponse = await fetchWithTimeout(accountUrl, {
    signal: context.abortSignal,
    timeoutMs,
    headers,
  });
  const accountPayload = await accountResponse.json() as Record<string, unknown>;
  if (!accountResponse.ok) {
    throw new Error(`TRON account fetch failed for ${address}: status=${accountResponse.status}`);
  }

  const includeTokens = args.includeTokens === undefined ? true : normalizeBoolean(args.includeTokens);
  let tokenBalances = normalizeTronTokenBalances(accountPayload);
  if (includeTokens) {
    const tokenUrl = new URL("/api/account/tokens", baseUrl);
    tokenUrl.searchParams.set("address", address);
    tokenUrl.searchParams.set("start", "0");
    tokenUrl.searchParams.set("limit", "20");
    tokenUrl.searchParams.set("show", "0");
    try {
      const tokenResponse = await fetchWithTimeout(tokenUrl, {
        signal: context.abortSignal,
        timeoutMs,
        headers,
      });
      if (tokenResponse.ok) {
        const tokenPayload = await tokenResponse.json() as Record<string, unknown>;
        const fromTokenEndpoint = normalizeTronTokenBalances(tokenPayload);
        if (fromTokenEndpoint.length > 0) {
          tokenBalances = fromTokenEndpoint;
        }
      }
    } catch {
      // Account-level balances remain usable when the optional token endpoint is unavailable.
    }
  }

  return {
    chain: "tron",
    address,
    mode: "live",
    nativeBalance: formatSunAsTrx(accountPayload.balance ?? accountPayload.trxBalance ?? 0),
    nativeSymbol: "TRX",
    tokenBalances,
    source: accountUrl.origin,
    observedAt: new Date().toISOString(),
    resources: {
      bandwidth: normalizeNumber(accountPayload.bandwidth ?? accountPayload.freeNetLimit),
      energy: normalizeNumber(accountPayload.energy ?? accountPayload.energyLimit),
    },
  };
}

function buildMockTronAccountSnapshot(args: Record<string, unknown>, address: string): TronAccountSnapshot {
  const fixture = isRecord(args.accountFixture) ? args.accountFixture : {};
  const fixtureTokenBalances = normalizeBalances(fixture.tokenBalances ?? args.tokenBalances);
  return {
    chain: "tron",
    address,
    mode: "mock",
    nativeBalance: normalizeString(fixture.nativeBalance ?? fixture.trxBalance) ?? "123.456",
    nativeSymbol: "TRX",
    tokenBalances: fixtureTokenBalances.length > 0 ? fixtureTokenBalances : [{ asset: "USDT", available: 100, locked: 0 }],
    source: "mock-tron-account",
    observedAt: new Date(0).toISOString(),
    resources: {
      bandwidth: normalizeNumber(fixture.bandwidth) ?? 1_500,
      energy: normalizeNumber(fixture.energy) ?? 0,
    },
  };
}

async function fetchTrc20Allowance(
  context: GenesisToolContext,
  args: Record<string, unknown>,
): Promise<Trc20AllowanceSnapshot> {
  const owner = normalizeTronAddress(args.owner);
  const spender = normalizeTronAddress(args.spender);
  const token = resolveTronToken(args.token ?? args.tokenAddress ?? args.tokenSymbol, args.decimals);
  if (!isLikelyTronAddress(owner) || !isLikelyTronAddress(spender) || !isLikelyTronAddress(token.address)) {
    throw new Error("TRC20 allowance live mode requires valid TRON owner, spender, and token addresses.");
  }

  const apiKey = normalizeString(args.apiKey) ?? process.env.TRONGRID_API_KEY;
  const baseUrl = normalizeUrl(args.fullNodeUrl)
    ?? normalizeUrl(process.env.OMNI_AGENT_TRON_FULL_NODE_URL)
    ?? (apiKey ? "https://api.trongrid.io" : DEFAULT_TRON_FULL_NODE_URL);
  const url = new URL("/wallet/triggerconstantcontract", baseUrl);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    signal: context.abortSignal,
    timeoutMs: normalizePositiveInteger(args.timeoutMs, 10_000),
    headers: {
      ...buildTronHeaders(apiKey),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      owner_address: owner,
      contract_address: token.address,
      function_selector: "allowance(address,address)",
      parameter: encodeTronAddressParam(owner) + encodeTronAddressParam(spender),
      visible: true,
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || isRecord(payload.result) && payload.result.result === false) {
    throw new Error(`TRC20 allowance fetch failed: status=${response.status}`);
  }
  const rawHex = normalizeString(Array.isArray(payload.constant_result) ? payload.constant_result[0] : undefined) ?? "0";
  return buildTrc20AllowanceSnapshot({
    mode: "live",
    token,
    owner,
    spender,
    raw: parseHexUint(rawHex),
    source: url.origin,
    observedAt: new Date().toISOString(),
  });
}

function buildMockTrc20Allowance(args: Record<string, unknown>): Trc20AllowanceSnapshot {
  const owner = normalizeTronAddress(args.owner);
  const spender = normalizeTronAddress(args.spender);
  const token = resolveTronToken(args.token ?? args.tokenAddress ?? args.tokenSymbol, args.decimals);
  const raw = normalizeString(args.allowanceRaw)
    ? parseDecimalBigInt(args.allowanceRaw)
    : parseTokenAmountRaw(args.allowance ?? 0, token.decimals);
  return buildTrc20AllowanceSnapshot({
    mode: "mock",
    token,
    owner,
    spender,
    raw,
    source: "mock-trc20-allowance",
    observedAt: new Date(0).toISOString(),
  });
}

function buildTrc20AllowanceSnapshot(input: {
  readonly mode: GenesisAdapterMode;
  readonly token: TronTokenDefinition;
  readonly owner: string;
  readonly spender: string;
  readonly raw: bigint;
  readonly source: string;
  readonly observedAt: string;
}): Trc20AllowanceSnapshot {
  return {
    chain: "tron",
    mode: input.mode,
    tokenSymbol: input.token.symbol,
    tokenAddress: input.token.address,
    owner: input.owner,
    spender: input.spender,
    decimals: input.token.decimals,
    allowance: formatTokenAmount(input.raw, input.token.decimals),
    allowanceRaw: input.raw.toString(),
    isUnlimited: input.raw > (1n << 255n),
    source: input.source,
    observedAt: input.observedAt,
  };
}

function buildRevokeApprovalPreview(args: Record<string, unknown>) {
  const chain = normalizeChain(args.chain);
  const token = chain === "tron"
    ? resolveTronToken(args.token ?? args.tokenAddress ?? args.tokenSymbol, args.decimals)
    : resolveEvmLikeToken(args.token ?? args.tokenAddress ?? args.tokenSymbol, args.decimals);
  const owner = chain === "tron" ? normalizeTronAddress(args.owner) : normalizeAddress(args.owner);
  const spender = chain === "tron" ? normalizeTronAddress(args.spender) : normalizeAddress(args.spender);
  const allowlist = normalizeAddressList(args.spenderAllowlist);
  const currentAllowance = normalizeNumber(args.currentAllowance ?? args.allowance) ?? 0;
  const rejectionReasons: string[] = [];
  const findings: string[] = [];
  if (!normalizeString(args.spender)) {
    rejectionReasons.push("spender address is required");
  }
  if (!isValidAddressForChain(chain, spender)) {
    rejectionReasons.push("spender address is invalid");
  }
  if (owner && owner !== "0x0000000000000000000000000000000000000000" && !isValidAddressForChain(chain, owner)) {
    rejectionReasons.push("owner address is invalid");
  }
  if (allowlist.length > 0 && !allowlist.includes(spender.toLowerCase())) {
    findings.push("spender is not in the allowlist; revocation is still previewable but needs operator review");
  }
  if (currentAllowance === 0) {
    findings.push("current allowance is zero; revocation may be unnecessary");
  }
  const encodedParameter = chain === "tron" && isLikelyTronAddress(spender)
    ? `${encodeTronAddressParam(spender)}${encodeUint256Param(0n)}`
    : null;
  return {
    chain,
    action: "revoke_approval",
    tokenSymbol: token.symbol,
    tokenAddress: token.address,
    owner,
    spender,
    currentAllowance,
    contractCall: "approve(spender,0)",
    functionSelector: "approve(address,uint256)",
    encodedParameter,
    amountRaw: "0",
    allowed: rejectionReasons.length === 0,
    rejectionReasons,
    findings,
    approvalRequired: true,
    liveTransactionBuilt: false,
    signed: false,
    broadcast: false,
  };
}

function buildTransferPreview(args: Record<string, unknown>) {
  const chain = normalizeChain(args.chain);
  const assetInput = args.asset ?? args.token ?? args.tokenSymbol;
  const nativeSymbol = chain === "tron" ? "TRX" : "ETH";
  const isNative = normalizeSymbol(assetInput, nativeSymbol).toUpperCase() === nativeSymbol;
  const decimals = normalizePositiveInteger(args.decimals, isNative ? (chain === "tron" ? 6 : 18) : 6);
  const token = isNative
    ? { symbol: nativeSymbol, address: "native", decimals }
    : chain === "tron"
      ? resolveTronToken(assetInput, args.decimals)
      : resolveEvmLikeToken(assetInput, args.decimals);
  const fromInput = normalizeString(args.from);
  const from = fromInput ? chain === "tron" ? normalizeTronAddress(args.from) : normalizeAddress(args.from) : "";
  const to = chain === "tron" ? normalizeTronAddress(args.to) : normalizeAddress(args.to);
  const amountRaw = parseTokenAmountRaw(args.amount ?? 0, token.decimals);
  const amount = formatTokenAmount(amountRaw, token.decimals);
  const maxAmount = normalizeNumber(args.maxAmount) ?? DEFAULT_MAX_TRANSFER_AMOUNT;
  const recipientAllowlist = normalizeAddressList(args.recipientAllowlist);
  const rejectionReasons: string[] = [];
  if (!normalizeString(args.to)) {
    rejectionReasons.push("recipient address is required");
  }
  if (amountRaw <= 0n) {
    rejectionReasons.push("amount must be greater than 0");
  }
  if (Number(amount) > maxAmount) {
    rejectionReasons.push(`amount ${amount} exceeds maxAmount ${maxAmount}`);
  }
  if (!isValidAddressForChain(chain, to)) {
    rejectionReasons.push("recipient address is invalid");
  }
  if (from && !isValidAddressForChain(chain, from)) {
    rejectionReasons.push("sender address is invalid");
  }
  if (from && to && from.toLowerCase() === to.toLowerCase()) {
    rejectionReasons.push("self-transfer is not allowed");
  }
  if (recipientAllowlist.length > 0 && !recipientAllowlist.includes(to.toLowerCase())) {
    rejectionReasons.push("recipient is not in the allowlist");
  }
  const encodedParameter = chain === "tron" && !isNative && isLikelyTronAddress(to)
    ? `${encodeTronAddressParam(to)}${encodeUint256Param(amountRaw)}`
    : null;
  return {
    chain,
    action: "transfer_preview",
    asset: token.symbol,
    tokenAddress: token.address,
    from,
    to,
    amount,
    amountRaw: amountRaw.toString(),
    decimals: token.decimals,
    maxAmount,
    contractCall: isNative ? "native transfer" : "transfer(to,amount)",
    encodedParameter,
    allowed: rejectionReasons.length === 0,
    rejectionReasons,
    approvalRequired: true,
    liveTransactionBuilt: false,
    signed: false,
    broadcast: false,
  };
}

function buildWeb3TransactionSimulation(args: Record<string, unknown>) {
  const preview = isRecord(args.preview) ? args.preview : {};
  const riskReport = isRecord(args.riskReport) ? args.riskReport : {};
  const action = normalizeString(args.action) ?? normalizeString(preview.action) ?? "web3_preview";
  const chain = normalizeString(args.chain) ?? normalizeString(preview.chain) ?? "tron";
  const findings = [
    ...normalizeStringArray(preview.rejectionReasons),
    ...normalizeStringArray(preview.findings),
    ...normalizeStringArray(riskReport.findings),
  ];
  const previewAllowed = preview.allowed === undefined ? true : Boolean(preview.allowed);
  if (!previewAllowed && findings.length === 0) {
    findings.push("preview is not allowed");
  }
  if (riskReport.riskLevel === "blocked") {
    findings.push("risk report is blocked");
  }
  const amount = normalizeNumber(preview.amount ?? args.amount);
  const maxAmount = normalizeNumber(args.maxAmount) ?? normalizeNumber(preview.maxAmount);
  if (amount !== undefined && maxAmount !== undefined && amount > maxAmount) {
    findings.push(`amount ${amount} exceeds maxAmount ${maxAmount}`);
  }
  const allowance = normalizeNumber(args.allowance);
  if (allowance !== undefined && amount !== undefined && allowance < amount && action.includes("transfer")) {
    findings.push("allowance is lower than requested amount");
  }
  const blocked = !previewAllowed
    || riskReport.riskLevel === "blocked"
    || findings.some((entry) => /invalid|exceeds|maxAmount|not in the allowlist|blocked/i.test(entry));
  const riskLevel = blocked ? "blocked" : findings.length > 0 ? "review" : "low";
  return {
    action,
    chain,
    decision: blocked ? "blocked" : "approval_required",
    riskLevel,
    findings,
    approvalRequired: true,
    simulated: true,
    networkSimulation: false,
    signed: false,
    broadcast: false,
    evidenceRequired: [
      "preview artifact",
      "risk report",
      "operator approval",
      "post-execution tx/order verification before any live adapter is enabled",
    ],
  };
}

function buildGenesisFinancePlan(args: Record<string, unknown>) {
  const intent = normalizeString(args.intent) ?? "Evaluate a guarded HTX/Web3 action.";
  const symbol = normalizeSymbol(args.symbol, "btcusdt");
  const amountUsdt = normalizeNumber(args.amountUsdt) ?? 0;
  const maxOrderUsdt = normalizeNumber(args.maxOrderUsdt) ?? normalizeEnvNumber("OMNI_AGENT_HTX_MAX_ORDER_USDT") ?? DEFAULT_MAX_ORDER_USDT;
  const riskReport = isRecord(args.riskReport) ? args.riskReport : {};
  const explicitFindings = Array.isArray(riskReport.findings) ? riskReport.findings.map(String) : [];
  const riskFindings = [
    ...explicitFindings,
    ...(amountUsdt > maxOrderUsdt ? [`amountUsdt ${amountUsdt} exceeds maxOrderUsdt ${maxOrderUsdt}`] : []),
  ];
  const riskLevel = riskReport.riskLevel === "blocked" || amountUsdt > maxOrderUsdt
    ? "blocked"
    : riskFindings.length > 0
      ? "review"
      : "low";
  const decision = riskLevel === "blocked" ? "blocked" : amountUsdt > 0 ? "approval_required" : "observe";
  return {
    project: "Omni Agent Genesis",
    intent,
    symbol,
    amountUsdt,
    maxOrderUsdt,
    decision,
    riskLevel,
    riskFindings,
    approvalRequired: decision === "approval_required",
    nextAction: decision === "blocked"
      ? "Do not execute. Fix risk findings or lower the order size."
      : decision === "approval_required"
        ? "Ask for explicit operator approval, then use htx_paper_order."
        : "Keep observing HTX and Web3 state.",
    evidenceRequired: [
      "HTX market/account snapshot",
      "Web3 wallet/risk snapshot",
      "B.AI capability probe or model profile",
      "approval record before any execution",
      "paper or live execution artifact",
    ],
    liveExecutionEnabled: false,
  };
}

async function fetchWithTimeout(
  url: URL,
  init: RequestInit & { readonly timeoutMs: number; readonly signal?: AbortSignal },
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(init.timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, {
    ...init,
    signal,
  });
}

function buildTextPresentation(title: string, text: string): GenesisToolResult["presentation"] {
  return {
    title,
    kind: "read",
    content: [{ type: "text", text }],
  };
}

function normalizeMode(value: unknown): GenesisAdapterMode {
  return String(value ?? "").trim().toLowerCase() === "live" ? "live" : "mock";
}

function normalizeSymbol(value: unknown, fallback: string): string {
  const normalized = normalizeString(value)?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return normalized && normalized.length <= 24 ? normalized : fallback;
}

function normalizeOrderSide(value: unknown): "buy" | "sell" {
  return String(value ?? "").trim().toLowerCase() === "sell" ? "sell" : "buy";
}

function normalizeAddress(value: unknown): string {
  const normalized = normalizeString(value);
  if (normalized) {
    return normalized;
  }
  return "0x0000000000000000000000000000000000000000";
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function redactSecretLikeText(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-api-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, "Bearer [redacted]");
}

function normalizeUrl(value: unknown): string | undefined {
  const text = normalizeString(value);
  if (!text) {
    return undefined;
  }
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.trunc(parsed);
}

function normalizeNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeEnvNumber(name: string): number | undefined {
  return normalizeNumber(process.env[name]);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeSymbolList(value: unknown): string[] | undefined {
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = Array.from(new Set(entries.map((entry) => normalizeSymbol(entry, "")).filter(Boolean)));
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAddressList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry));
}

function normalizeBalances(value: unknown): AssetBalance[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(isRecord)
    .map((entry) => ({
      asset: normalizeString(entry.asset ?? entry.currency ?? entry.symbol)?.toUpperCase() ?? "UNKNOWN",
      available: normalizeNumber(entry.available ?? entry.free ?? entry.balance) ?? 0,
      locked: normalizeNumber(entry.locked ?? entry.hold ?? entry.frozen),
    }));
}

function normalizeTronAddress(value: unknown): string {
  const normalized = normalizeString(value);
  return normalized ?? DEFAULT_TRON_ADDRESS;
}

function normalizeChain(value: unknown): "tron" | "evm" {
  return String(value ?? "").trim().toLowerCase() === "evm" ? "evm" : "tron";
}

function resolveTronToken(value: unknown, decimalsValue?: unknown): TronTokenDefinition {
  const symbolOrAddress = normalizeString(value)?.toUpperCase() ?? "USDT";
  const decimals = normalizePositiveInteger(decimalsValue, DEFAULT_TRON_TOKENS[symbolOrAddress]?.decimals ?? 6);
  if (DEFAULT_TRON_TOKENS[symbolOrAddress]) {
    return { ...DEFAULT_TRON_TOKENS[symbolOrAddress], decimals };
  }
  const raw = normalizeString(value) ?? DEFAULT_TRON_TOKENS.USDT.address;
  if (isLikelyTronAddress(raw)) {
    return {
      symbol: "TRC20",
      address: raw,
      decimals,
    };
  }
  return {
    symbol: symbolOrAddress,
    address: DEFAULT_TRON_TOKENS.USDT.address,
    decimals,
  };
}

function resolveEvmLikeToken(value: unknown, decimalsValue?: unknown): TronTokenDefinition {
  const raw = normalizeString(value) ?? "USDT";
  return {
    symbol: isLikelyEvmAddress(raw) ? "ERC20" : raw.toUpperCase(),
    address: isLikelyEvmAddress(raw) ? raw : "0x0000000000000000000000000000000000000000",
    decimals: normalizePositiveInteger(decimalsValue, 6),
  };
}

function resolveTronScanApiKey(args: Record<string, unknown>): string | undefined {
  const explicit = normalizeString(args.apiKey);
  if (explicit) {
    return explicit;
  }
  const envName = normalizeString(args.apiKeyEnv) ?? "TRONSCAN_API_KEY";
  return normalizeString(process.env[envName]) ?? normalizeString(process.env.TRONGRID_API_KEY);
}

function resolveTronScanBaseUrl(args: Record<string, unknown>, apiKey?: string): string {
  return normalizeUrl(args.baseUrl)
    ?? normalizeUrl(process.env.OMNI_AGENT_TRONSCAN_BASE_URL)
    ?? (apiKey ? DEFAULT_TRONSCAN_API_BASE_URL : DEFAULT_TRONSCAN_BASE_URL);
}

function buildTronHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "user-agent": "omni-agent/0.1",
    accept: "application/json",
  };
  if (apiKey) {
    headers["TRON-PRO-API-KEY"] = apiKey;
  }
  return headers;
}

function normalizeTronTokenBalances(payload: Record<string, unknown>): AssetBalance[] {
  const candidates = [
    payload.data,
    payload.tokens,
    payload.trc20token_balances,
    payload.tokenBalances,
  ];
  const entries = candidates.find(Array.isArray);
  if (!Array.isArray(entries)) {
    return [];
  }
  return entries
    .filter(isRecord)
    .map((entry) => {
      const asset = normalizeString(entry.tokenAbbr ?? entry.tokenSymbol ?? entry.symbol ?? entry.name)?.toUpperCase() ?? "TRC20";
      const decimals = normalizePositiveInteger(entry.tokenDecimal ?? entry.decimals, 6);
      const rawBalance = entry.balance ?? entry.quantity ?? entry.amount ?? entry.tokenBalance;
      const rawBalanceText = normalizeString(rawBalance);
      const available = rawBalanceText && /^\d+$/.test(rawBalanceText)
        ? Number(formatTokenAmount(parseDecimalBigInt(rawBalanceText), decimals))
        : normalizeNumber(rawBalance) ?? 0;
      return {
        asset,
        available,
        locked: normalizeNumber(entry.locked ?? entry.frozen),
      };
    });
}

function isValidAddressForChain(chain: "tron" | "evm", address: string): boolean {
  return chain === "tron" ? isLikelyTronAddress(address) : isLikelyEvmAddress(address);
}

function formatSunAsTrx(value: unknown): string {
  return formatTokenAmount(parseDecimalBigInt(value), 6);
}

function parseTokenAmountRaw(value: unknown, decimals: number): bigint {
  const text = normalizeString(value) ?? String(normalizeNumber(value) ?? 0);
  const normalized = text.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return 0n;
  }
  const [whole, fraction = ""] = normalized.split(".");
  const scale = 10n ** BigInt(decimals);
  const fractionText = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * scale + BigInt(fractionText || "0");
}

function parseDecimalBigInt(value: unknown): bigint {
  const text = normalizeString(value) ?? String(normalizeNumber(value) ?? 0);
  if (!/^\d+$/.test(text)) {
    return 0n;
  }
  return BigInt(text);
}

function parseHexUint(value: string): bigint {
  const normalized = value.trim().replace(/^0x/u, "");
  if (!/^[a-fA-F0-9]+$/.test(normalized)) {
    return 0n;
  }
  return BigInt(`0x${normalized}`);
}

function formatTokenAmount(raw: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = raw % scale;
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/u, "");
  return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
}

function encodeTronAddressParam(address: string): string {
  const hex = tronAddressToHex(address);
  return hex.slice(2).padStart(64, "0");
}

function encodeUint256Param(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function normalizeNestedTickerNumber(value: unknown): number | undefined {
  if (Array.isArray(value)) {
    return normalizeNumber(value[0]);
  }
  return normalizeNumber(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isLikelyEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isLikelyTronAddress(value: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value);
}

function tronAddressToHex(address: string): string {
  const payload = base58CheckDecode(address);
  if (payload.length !== 21 || payload[0] !== 0x41) {
    throw new Error(`Invalid TRON address payload: ${address}`);
  }
  return Buffer.from(payload).toString("hex");
}

function base58CheckDecode(value: string): Uint8Array {
  const decoded = base58Decode(value);
  if (decoded.length < 5) {
    throw new Error("Base58Check payload is too short.");
  }
  const payload = decoded.slice(0, decoded.length - 4);
  const checksum = decoded.slice(decoded.length - 4);
  const expected = doubleSha256(payload).slice(0, 4);
  if (!Buffer.from(checksum).equals(Buffer.from(expected))) {
    throw new Error("Base58Check checksum mismatch.");
  }
  return payload;
}

function base58Decode(value: string): Uint8Array {
  let result = 0n;
  for (const char of value) {
    const index = TRON_BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    result = result * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (result > 0n) {
    bytes.unshift(Number(result & 0xffn));
    result >>= 8n;
  }
  for (const char of value) {
    if (char !== "1") {
      break;
    }
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function doubleSha256(value: Uint8Array): Uint8Array {
  const first = createHash("sha256").update(value).digest();
  return createHash("sha256").update(first).digest();
}

function formatWeiAsEth(hexWei: string): string {
  try {
    const wei = BigInt(hexWei);
    const whole = wei / 1_000_000_000_000_000_000n;
    const fraction = wei % 1_000_000_000_000_000_000n;
    const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/u, "");
    return fractionText ? `${whole.toString()}.${fractionText}` : whole.toString();
  } catch {
    return "0";
  }
}
