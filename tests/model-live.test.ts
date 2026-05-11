import assert from "node:assert/strict";
import test from "node:test";

import { OpenAiCompatibleModelClient, type ModelProfile, type ModelTurnInput } from "../packages/model-client/src/index.ts";

if (process.env.OMNI_LIVE_MODEL_TESTS !== "1") {
  test("live model tests are opt-in", { skip: "Set OMNI_LIVE_MODEL_TESTS=1 to run live model checks." }, () => {});
} else {
  test("live model matrix completes a small OpenAI-compatible request", async () => {
    assertRequiredEnv(["OMNI_LIVE_MODEL_PROVIDER", "OMNI_LIVE_MODEL", "OMNI_LIVE_MODEL_API_KEY"]);

    const profile: ModelProfile = {
      id: "live-model",
      name: process.env.OMNI_LIVE_MODEL_PROVIDER?.trim() ?? "live model",
      protocol: "openai",
      baseUrl: process.env.OMNI_LIVE_MODEL_BASE_URL?.trim() || "https://api.openai.com/v1",
      apiPath: process.env.OMNI_LIVE_MODEL_API_PATH?.trim() || undefined,
      apiKeyEnv: "OMNI_LIVE_MODEL_API_KEY",
      model: process.env.OMNI_LIVE_MODEL?.trim() ?? "",
      supportsTools: false,
      supportsStreaming: false,
      requestBody: {
        max_tokens: Number(process.env.OMNI_LIVE_MODEL_MAX_TOKENS ?? 8),
      },
    };

    try {
      const result = await new OpenAiCompatibleModelClient(profile).generateTurn(createSmallTurnInput());
      assert.equal(result.provider?.id, "live-model");
      assert.equal(result.provider?.model, profile.model);
      assert.ok(result.assistantText.trim().length > 0 || result.toolCalls.length > 0);
    } catch (error) {
      throw new Error(`Live model request failed: ${sanitizeError(error, [process.env.OMNI_LIVE_MODEL_API_KEY])}`);
    }
  });
}

if (process.env.OMNI_LIVE_BAI_TESTS !== "1") {
  test("live B.AI tests are opt-in", { skip: "Set OMNI_LIVE_BAI_TESTS=1 to run B.AI live checks." }, () => {});
} else {
  test("B.AI chat completions endpoint completes a small request", async () => {
    assertRequiredEnv(["OMNI_LIVE_BAI_MODEL", "OMNI_LIVE_BAI_API_KEY"]);

    const baseUrl = process.env.OMNI_LIVE_BAI_BASE_URL?.trim() || "https://api.b.ai/v1";
    const url = new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
    const apiKey = process.env.OMNI_LIVE_BAI_API_KEY?.trim() ?? "";

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OMNI_LIVE_BAI_MODEL?.trim(),
          messages: [{ role: "user", content: "Reply with the single word ok." }],
          max_tokens: Number(process.env.OMNI_LIVE_BAI_MAX_TOKENS ?? 8),
          temperature: 0,
        }),
      });
    } catch (error) {
      throw new Error(`B.AI request failed before response: ${sanitizeError(error, [apiKey])}`);
    }

    const body = await response.text();
    if (!response.ok) {
      throw new Error(`B.AI request failed (${response.status}): ${sanitizeError(body, [apiKey])}`);
    }

    const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> };
    assert.ok(parsed.choices?.[0]?.message?.content?.trim());
  });
}

function assertRequiredEnv(names: readonly string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim());
  assert.deepEqual(missing, [], `Missing required live test environment variables: ${missing.join(", ")}`);
}

function createSmallTurnInput(): ModelTurnInput {
  const taskContract = {
    objective: "Return a short live connectivity confirmation.",
    agentRole: "primary" as const,
    workspaceId: "live-workspace",
    threadId: "live-thread",
    cwd: "E:/repo",
    successCriteria: ["Return a short response"],
    constraints: ["Do not request tools"],
    verificationMode: "optional" as const,
    preferredExecutionDomain: "workspace" as const,
  };
  return {
    context: {
      taskContract,
      workspaceSnapshot: {
        cwd: "E:/repo",
        repoRoot: "E:/repo",
        repoName: "repo",
        branch: "main",
        dirty: false,
        isGitRepo: true,
        gitStatusLines: [],
        changedFiles: [],
        detectedFiles: [],
        packageManager: null,
        packageScripts: [],
      },
      threadSummary: "No prior history.",
      repoSummary: "Connectivity smoke test.",
      systemPrompt: "You are a concise connectivity test responder.",
      promptSections: ["You are a concise connectivity test responder."],
    },
    taskContract,
    availableTools: [],
    toolResults: [],
  };
}

function sanitizeError(error: unknown, secrets: readonly (string | undefined)[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) {
    const trimmed = secret?.trim();
    if (trimmed) {
      message = message.split(trimmed).join("[redacted]");
    }
  }
  return message.replace(/Bearer\s+[^\s"'{}]+/gi, "Bearer [redacted]");
}
