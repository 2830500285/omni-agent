import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ToolRegistry, registerBuiltInTools } from "../packages/tools/src/index.ts";
import { LocalWorkspaceService } from "../packages/workspace/src/index.ts";

const demoTronOwner = "TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf";
const demoTronSpender = "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7";

if (process.env.OMNI_LIVE_TRON_TESTS !== "1") {
  test("live TRON Genesis tool tests are opt-in", { skip: "Set OMNI_LIVE_TRON_TESTS=1 to run TRON read-only live checks." }, () => {});
} else {
  test("Genesis TRON live tools query account and TRC20 allowance through read-only endpoints", async () => {
    await withLiveToolContext(async (toolRegistry, context) => {
      const owner = process.env.OMNI_LIVE_TRON_ADDRESS?.trim() || demoTronOwner;
      const spender = process.env.OMNI_LIVE_TRON_SPENDER?.trim() || demoTronSpender;
      const timeoutMs = Number(process.env.OMNI_LIVE_TRON_TIMEOUT_MS ?? 15_000);

      const account = await toolRegistry.execute("web3_tron_account_snapshot", context, {
        mode: "live",
        address: owner,
        baseUrl: process.env.OMNI_LIVE_TRONSCAN_BASE_URL?.trim() || undefined,
        apiKeyEnv: process.env.OMNI_LIVE_TRONSCAN_API_KEY_ENV?.trim() || "TRONSCAN_API_KEY",
        includeTokens: process.env.OMNI_LIVE_TRON_INCLUDE_TOKENS === "0" ? false : true,
        timeoutMs,
      });
      assert.equal(account.ok, true, account.summary);
      const accountData = account.data as {
        chain?: string;
        address?: string;
        mode?: string;
        nativeSymbol?: string;
        source?: string;
      };
      assert.equal(accountData.chain, "tron");
      assert.equal(accountData.address, owner);
      assert.equal(accountData.mode, "live");
      assert.equal(accountData.nativeSymbol, "TRX");
      assert.ok(accountData.source?.startsWith("http"));

      const allowance = await toolRegistry.execute("web3_trc20_allowance", context, {
        mode: "live",
        token: "USDT",
        owner,
        spender,
        fullNodeUrl: process.env.OMNI_LIVE_TRON_FULL_NODE_URL?.trim() || undefined,
        apiKey: process.env.OMNI_LIVE_TRON_API_KEY?.trim() || undefined,
        timeoutMs,
      });
      assert.equal(allowance.ok, true, allowance.summary);
      const allowanceData = allowance.data as {
        chain?: string;
        mode?: string;
        tokenSymbol?: string;
        owner?: string;
        spender?: string;
        source?: string;
        allowanceRaw?: string;
      };
      assert.equal(allowanceData.chain, "tron");
      assert.equal(allowanceData.mode, "live");
      assert.equal(allowanceData.tokenSymbol, "USDT");
      assert.equal(allowanceData.owner, owner);
      assert.equal(allowanceData.spender, spender);
      assert.ok(allowanceData.source?.startsWith("http"));
      assert.match(allowanceData.allowanceRaw ?? "", /^\d+$/);
    });
  });
}

if (process.env.OMNI_LIVE_BAI_TESTS !== "1") {
  test("live B.AI Genesis tool tests are opt-in", { skip: "Set OMNI_LIVE_BAI_TESTS=1 to run B.AI tool live checks." }, () => {});
} else {
  test("Genesis B.AI live tool completes a small OpenAI-compatible chat request", async () => {
    assertRequiredEnv(["OMNI_LIVE_BAI_API_KEY"]);

    await withLiveToolContext(async (toolRegistry, context) => {
      const result = await toolRegistry.execute("bai_chat_completion", context, {
        mode: "live",
        apiKeyEnv: "OMNI_LIVE_BAI_API_KEY",
        baseUrl: process.env.OMNI_LIVE_BAI_BASE_URL?.trim() || undefined,
        model: process.env.OMNI_LIVE_BAI_MODEL?.trim() || "gpt-5.2",
        prompt: "Reply with the single word ok.",
        maxTokens: Number(process.env.OMNI_LIVE_BAI_MAX_TOKENS ?? 8),
        temperature: 0,
        timeoutMs: Number(process.env.OMNI_LIVE_BAI_TIMEOUT_MS ?? 30_000),
      });
      assert.equal(result.ok, true, sanitizeError(result.summary, [process.env.OMNI_LIVE_BAI_API_KEY]));
      const data = result.data as {
        provider?: string;
        mode?: string;
        status?: string;
        model?: string;
        content?: string;
      };
      assert.equal(data.provider, "b.ai");
      assert.equal(data.mode, "live");
      assert.equal(data.status, "completed");
      assert.ok(data.model);
      assert.ok(data.content?.trim());
      assert.doesNotMatch(JSON.stringify(result), new RegExp(escapeRegExp(process.env.OMNI_LIVE_BAI_API_KEY ?? "")));
    });
  });
}

async function withLiveToolContext(
  run: (
    toolRegistry: ToolRegistry,
    context: {
      readonly workspace: LocalWorkspaceService;
      readonly executionDomain: "workspace";
    },
  ) => Promise<void>,
): Promise<void> {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-tools-live-workspace-"));
  const storeRoot = mkdtempSync(join(tmpdir(), "omni-agent-tools-live-store-"));

  try {
    writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ name: "fixture" }, null, 2), "utf8");
    const toolRegistry = new ToolRegistry();
    registerBuiltInTools(toolRegistry);
    await run(toolRegistry, {
      workspace: new LocalWorkspaceService(workspaceRoot, join(storeRoot, "artifacts", "workspace")),
      executionDomain: "workspace",
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(storeRoot, { recursive: true, force: true });
  }
}

function assertRequiredEnv(names: readonly string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim());
  assert.deepEqual(missing, [], `Missing required live test environment variables: ${missing.join(", ")}`);
}

function sanitizeError(message: string, secrets: readonly (string | undefined)[]): string {
  let sanitized = message;
  for (const secret of secrets) {
    const trimmed = secret?.trim();
    if (trimmed) {
      sanitized = sanitized.split(trimmed).join("[redacted]");
    }
  }
  return sanitized.replace(/Bearer\s+[^\s"'{}]+/gi, "Bearer [redacted]");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
