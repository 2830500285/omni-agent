import assert from "node:assert/strict";
import test from "node:test";

import {
  AnthropicMessagesModelClient,
  CredentialPoolModelClient,
  FailoverModelClient,
  MockModelClient,
  ModelRequestError,
  ModelProviderExtensionRegistry,
  ModelRouter,
  OpenAiCompatibleModelClient,
  OpenAiResponsesModelClient,
  buildModelProfileDiagnostics,
  classifyModelError,
  createModelProfileForProvider,
  estimateModelUsageCost,
  hasModelProfileApiKey,
  inspectModelProfilesFromEnv,
  loadModelProfileFromEnv,
  loadModelProfilesFromEnv,
  resolveBuiltInModelProfileProvider,
  type ModelClient,
  type ModelProfile,
  selectModelProfiles,
  type ModelTurnInput,
  type ModelTurnResult,
} from "../packages/model-client/src/index.ts";

test("openai-compatible client parses native tool calls", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    return new Response(
      JSON.stringify({
        usage: {
          prompt_tokens: 128,
          completion_tokens: 24,
          total_tokens: 152,
        },
        choices: [
          {
            message: {
              content: "Inspecting the target file.",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({
                      path: "src/index.ts",
                      startLine: 1,
                      endLine: 40,
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new OpenAiCompatibleModelClient({
      id: "test",
      name: "test",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-4.1-mini",
      supportsTools: true,
      supportsStreaming: false,
    });

    const result = await client.generateTurn(createTurnInput());
    assert.match(result.assistantText, /Inspecting\s+the target file\./);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.toolName, "read_file");
    assert.equal(result.provider?.id, "test");
    assert.deepEqual(result.usage, {
      inputTokens: 128,
      outputTokens: 24,
      totalTokens: 152,
    });
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 1,
      endLine: 40,
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai responses client parses function calls and request shape", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  let requestedUrl = "";
  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Inspecting through Responses.",
              },
            ],
          },
          {
            type: "function_call",
            call_id: "call_1",
            name: "read_file",
            arguments: JSON.stringify({
              path: "src/index.ts",
              startLine: 1,
              endLine: 20,
            }),
          },
        ],
        usage: {
          input_tokens: 90,
          output_tokens: 18,
          total_tokens: 108,
          input_tokens_details: {
            cached_tokens: 40,
          },
          output_tokens_details: {
            reasoning_tokens: 6,
          },
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit-requests": "500",
          "x-ratelimit-remaining-requests": "499",
          "x-ratelimit-reset-requests": "12ms",
          "x-ratelimit-limit-tokens": "100000",
          "x-ratelimit-remaining-tokens": "99000",
          "x-ratelimit-reset-tokens": "1s",
        },
      },
    );
  };

  try {
    const client = new OpenAiResponsesModelClient({
      id: "responses-test",
      name: "responses-test",
      protocol: "responses",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-5.4-codex",
      supportsTools: true,
      supportsStreaming: false,
    });

    const result = await client.generateTurn(createTurnInput());
    assert.match(requestedUrl, /\/responses$/);
    assert.equal(requestBody.model, "gpt-5.4-codex");
    assert.match(String(requestBody.instructions ?? ""), /coding agent runtime/i);
    assert.equal(Array.isArray(requestBody.input), true);
    assert.equal((requestBody.tools as Array<Record<string, unknown>>)[0]?.type, "function");
    assert.equal((requestBody.tools as Array<Record<string, unknown>>)[0]?.name, "read_file");
    assert.equal(result.assistantText, "Inspecting through Responses.");
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.id, "call_1");
    assert.equal(result.toolCalls[0]?.toolName, "read_file");
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 1,
      endLine: 20,
    });
    assert.deepEqual(result.usage, {
      inputTokens: 90,
      outputTokens: 18,
      totalTokens: 108,
      cachedInputTokens: 40,
      reasoningTokens: 6,
    });
    assert.deepEqual(result.metadata?.rateLimit, {
      requests: {
        limit: 500,
        remaining: 499,
        reset: "12ms",
      },
      tokens: {
        limit: 100000,
        remaining: 99000,
        reset: "1s",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai responses client streams output text, function arguments, and usage", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return createStreamingResponse([
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "Inspecting ",
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        delta: "through Responses.",
      },
      {
        type: "response.output_item.added",
        output_index: 1,
        item: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "read_file",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        item_id: "fc_1",
        delta: "{\"path\":\"src/index.ts\",",
      },
      {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        item_id: "fc_1",
        delta: "\"startLine\":1,\"endLine\":20}",
      },
      {
        type: "response.function_call_arguments.done",
        output_index: 1,
        item_id: "fc_1",
        arguments: "{\"path\":\"src/index.ts\",\"startLine\":1,\"endLine\":20}",
      },
      {
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 90,
            output_tokens: 18,
            total_tokens: 108,
          },
        },
      },
    ]);
  };

  try {
    const client = new OpenAiResponsesModelClient({
      id: "responses-streaming",
      name: "responses-streaming",
      protocol: "responses",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-5.4-codex",
      supportsTools: true,
      supportsStreaming: true,
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(requestBody.stream, true);
    assert.equal(result.assistantText, "Inspecting through Responses.");
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.id, "call_1");
    assert.equal(result.toolCalls[0]?.toolName, "read_file");
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 1,
      endLine: 20,
    });
    assert.deepEqual(result.usage, {
      inputTokens: 90,
      outputTokens: 18,
      totalTokens: 108,
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai-compatible client streams tool calls and forwards request overrides", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  let requestedUrl = "";
  let requestHeaders = new Headers();
  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    requestedUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return createStreamingResponse([
      {
        choices: [
          {
            delta: {
              content: "Inspecting ",
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              content: "the target file.",
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: "{\"path\":\"src/index.ts\",",
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: "\"startLine\":1,\"endLine\":40}",
                  },
                },
              ],
            },
          },
        ],
      },
    ]);
  };

  try {
    const client = new OpenAiCompatibleModelClient({
      id: "streaming",
      name: "streaming",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiPath: "providers/openai/chat/completions",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-4.1-mini",
      supportsTools: true,
      supportsStreaming: true,
      headers: {
        "x-provider": "compat",
      },
      requestBody: {
        temperature: 0.25,
        max_tokens: 256,
      },
    });

    const result = await client.generateTurn(createTurnInput());
    assert.match(requestedUrl, /providers\/openai\/chat\/completions$/);
    assert.equal(requestHeaders.get("authorization"), "Bearer test-key");
    assert.equal(requestHeaders.get("x-provider"), "compat");
    assert.equal(requestBody.stream, true);
    assert.equal(requestBody.temperature, 0.25);
    assert.equal(requestBody.max_tokens, 256);
    const userEnvelope = String((requestBody.messages as Array<Record<string, unknown>>)[2]?.content ?? "");
    assert.match(userEnvelope, /"agentRole":\s*"primary"/);
    assert.match(userEnvelope, /"responseKind":\s*"general"/);
    assert.equal(result.assistantText, "Inspecting the target file.");
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.toolName, "read_file");
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 1,
      endLine: 40,
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai-compatible client uses role-specific tool budgets and response contracts", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Planning complete.",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new OpenAiCompatibleModelClient({
      id: "planner-test",
      name: "planner-test",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-4.1-mini",
      supportsTools: true,
      supportsStreaming: false,
    });

    await client.generateTurn(createTurnInput("planner"));
    const systemInstruction = String((requestBody.messages as Array<Record<string, unknown>>)[1]?.content ?? "");
    const userEnvelope = String((requestBody.messages as Array<Record<string, unknown>>)[2]?.content ?? "");
    assert.match(systemInstruction, /Use at most 2 tool calls per turn\./);
    assert.match(systemInstruction, /role-specific response contract/i);
    assert.match(systemInstruction, /list_directory and read_file/i);
    assert.match(systemInstruction, /cwd field/i);
    assert.match(systemInstruction, /cross-platform/i);
    assert.match(systemInstruction, /source code should stay ASCII/i);
    assert.match(systemInstruction, /After verification passes, immediately stop tool use/i);
    assert.match(systemInstruction, /temporary \.zip before Expand-Archive/i);
    assert.match(userEnvelope, /"agentRole":\s*"planner"/);
    assert.match(userEnvelope, /"responseKind":\s*"plan"/);
    assert.match(userEnvelope, /"maxToolCallsPerTurn":\s*2/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai-compatible client recognizes supervisor as an orchestrating role", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Supervisor planning complete.",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new OpenAiCompatibleModelClient({
      id: "supervisor-test",
      name: "supervisor-test",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-4.1-mini",
      supportsTools: true,
      supportsStreaming: false,
    });

    await client.generateTurn(createTurnInput("supervisor"));
    const systemInstruction = String((requestBody.messages as Array<Record<string, unknown>>)[1]?.content ?? "");
    const userEnvelope = String((requestBody.messages as Array<Record<string, unknown>>)[2]?.content ?? "");
    assert.match(systemInstruction, /Use at most 4 tool calls per turn\./);
    assert.match(userEnvelope, /"agentRole":\s*"supervisor"/);
    assert.match(userEnvelope, /"responseKind":\s*"plan"/);
    assert.match(userEnvelope, /"canEditFiles":\s*false/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai-compatible client repairs malformed native tool call arguments", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Inspecting the target file.",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "read_file",
                    arguments: "{\"path\":\"src/index.ts\",\"startLine\":1,\"encoding\":None,}",
                  },
                },
              ],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new OpenAiCompatibleModelClient({
      id: "repair-openai",
      name: "repair-openai",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-4.1-mini",
      supportsTools: true,
      supportsStreaming: false,
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(result.toolCalls.length, 1);
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 1,
      encoding: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai-compatible client recovers embedded XML-style tool calls from text content", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                "Inspecting the target file.",
                '<tool_call>{"toolName":"read_file","args":{"path":"src/index.ts","startLine":1,"endLine":40}}</tool_call>',
              ].join("\n"),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new OpenAiCompatibleModelClient({
      id: "embedded-tool-call-openai",
      name: "embedded-tool-call-openai",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-4.1-mini",
      supportsTools: true,
      supportsStreaming: false,
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.toolName, "read_file");
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 1,
      endLine: 40,
    });
    assert.equal(result.assistantText, "Inspecting the target file.");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai-compatible client recovers embedded JSON tool-call envelopes from text content", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                "我将直接修改文件。",
                JSON.stringify(
                  {
                    assistantText: "追加生成脚本。",
                    toolCalls: [
                      {
                        toolName: "append_file",
                        args: {
                          path: "deliverables/code/solve.mjs",
                          content: "writeChart('chart07.svg', '<svg>{}</svg>');\n",
                        },
                      },
                    ],
                  },
                  null,
                  2,
                ),
              ].join("\n"),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new OpenAiCompatibleModelClient({
      id: "embedded-json-envelope-openai",
      name: "embedded-json-envelope-openai",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-4.1-mini",
      supportsTools: true,
      supportsStreaming: false,
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.toolName, "append_file");
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "deliverables/code/solve.mjs",
      content: "writeChart('chart07.svg', '<svg>{}</svg>');\n",
    });
    assert.equal(result.assistantText, "我将直接修改文件。");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai-compatible client strips leaked reasoning blocks from text content", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "<think>check the repository first</think>\nFinal answer for the user.",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new OpenAiCompatibleModelClient({
      id: "reasoning-strip-openai",
      name: "reasoning-strip-openai",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-4.1-mini",
      supportsTools: true,
      supportsStreaming: false,
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.assistantText, "Final answer for the user.");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("openai-compatible client recovers truncated XML-style tool calls from text content", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OMNI_AGENT_API_KEY;
  process.env.OMNI_AGENT_API_KEY = "test-key";

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.openai.com")) {
      return originalFetch(input, init);
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                "Inspecting the target file.",
                '<tool_call>{"toolName":"read_file","args":{"path":"src/index.ts","startLine":5,"endLine":12}}',
              ].join("\n"),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new OpenAiCompatibleModelClient({
      id: "embedded-truncated-tool-call-openai",
      name: "embedded-truncated-tool-call-openai",
      protocol: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "OMNI_AGENT_API_KEY",
      model: "gpt-4.1-mini",
      supportsTools: true,
      supportsStreaming: false,
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.toolName, "read_file");
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 5,
      endLine: 12,
    });
    assert.equal(result.assistantText, "Inspecting the target file.");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OMNI_AGENT_API_KEY = originalApiKey;
  }
});

test("anthropic messages client parses tool_use responses", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "anthropic-test-key";

  let requestedUrl = "";
  let requestHeaders = new Headers();
  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.anthropic.com")) {
      return originalFetch(input, init);
    }
    requestedUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        usage: {
          input_tokens: 96,
          output_tokens: 22,
        },
        content: [
          {
            type: "text",
            text: "Inspecting the target file.",
          },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: {
              path: "src/index.ts",
              startLine: 1,
              endLine: 40,
            },
          },
        ],
        stop_reason: "tool_use",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new AnthropicMessagesModelClient({
      id: "anthropic",
      name: "anthropic",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-5",
      supportsTools: true,
      supportsStreaming: false,
      requestBody: {
        max_tokens: 4_096,
      },
    });

    const result = await client.generateTurn(createTurnInput());
    assert.match(requestedUrl, /\/v1\/messages$/);
    assert.equal(requestHeaders.get("x-api-key"), "anthropic-test-key");
    assert.equal(requestHeaders.get("anthropic-version"), "2023-06-01");
    assert.equal(requestBody.model, "claude-sonnet-4-5");
    assert.equal(requestBody.max_tokens, 4_096);
    assert.deepEqual(requestBody.tool_choice, { type: "auto" });
    assert.match(String(requestBody.system), /cross-platform/i);
    assert.match(String(requestBody.system), /temporary \.zip before Expand-Archive/i);
    assert.equal(result.assistantText, "Inspecting the target file.");
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.toolName, "read_file");
    assert.equal(result.provider?.id, "anthropic");
    assert.deepEqual(result.usage, {
      inputTokens: 96,
      outputTokens: 22,
      totalTokens: 118,
    });
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 1,
      endLine: 40,
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

test("anthropic messages client repairs malformed streaming tool arguments", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "anthropic-test-key";

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.anthropic.com")) {
      return originalFetch(input, init);
    }
    return createStreamingResponse([
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "text",
          text: "Inspecting ",
        },
        message: {
          usage: {
            input_tokens: 96,
            output_tokens: 22,
          },
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "text_delta",
          text: "the target file.",
        },
      },
      {
        type: "content_block_start",
        index: 1,
        content_block: {
          type: "tool_use",
          id: "toolu_1",
          name: "read_file",
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: "{\"path\":\"src/index.ts\",\"startLine\":1,",
        },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: {
          type: "input_json_delta",
          partial_json: "\"encoding\":None,}",
        },
      },
    ]);
  };

  try {
    const client = new AnthropicMessagesModelClient({
      id: "anthropic-streaming-repair",
      name: "anthropic-streaming-repair",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-5",
      supportsTools: true,
      supportsStreaming: true,
      requestBody: {
        max_tokens: 4_096,
      },
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(result.assistantText, "Inspecting the target file.");
    assert.equal(result.toolCalls.length, 1);
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 1,
      encoding: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

test("anthropic messages client exposes cache usage and rate-limit headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "anthropic-test-key";

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.anthropic.com")) {
      return originalFetch(input, init);
    }
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        usage: {
          input_tokens: 96,
          cache_creation_input_tokens: 30,
          cache_read_input_tokens: 12,
          output_tokens: 22,
          reasoning_tokens: 8,
        },
        content: [
          {
            type: "text",
            text: "Cache-aware response.",
          },
        ],
        stop_reason: "end_turn",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-requests-limit": "1000",
          "x-ratelimit-requests-remaining": "998",
          "x-ratelimit-requests-reset": "2026-05-01T10:00:00Z",
          "x-ratelimit-tokens-limit": "200000",
          "x-ratelimit-tokens-remaining": "199000",
        },
      },
    );
  };

  try {
    const client = new AnthropicMessagesModelClient({
      id: "anthropic-observability",
      name: "anthropic-observability",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-5",
      supportsTools: true,
      supportsStreaming: false,
      requestBody: {
        max_tokens: 4_096,
      },
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(result.assistantText, "Cache-aware response.");
    assert.deepEqual(result.usage, {
      inputTokens: 96,
      outputTokens: 22,
      totalTokens: 118,
      cachedInputTokens: 12,
      cacheCreationInputTokens: 30,
      cacheReadInputTokens: 12,
      reasoningTokens: 8,
    });
    assert.deepEqual(result.metadata?.rateLimit, {
      requests: {
        limit: 1000,
        remaining: 998,
        reset: "2026-05-01T10:00:00Z",
      },
      tokens: {
        limit: 200000,
        remaining: 199000,
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

test("anthropic messages client recovers embedded function tags from text content", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "anthropic-test-key";

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.anthropic.com")) {
      return originalFetch(input, init);
    }
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        usage: {
          input_tokens: 96,
          output_tokens: 22,
        },
        content: [
          {
            type: "text",
            text: [
              "Inspecting the target file.",
              '<function name="read_file">{"path":"src/index.ts","startLine":1,"endLine":40}</function>',
            ].join("\n"),
          },
        ],
        stop_reason: "end_turn",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new AnthropicMessagesModelClient({
      id: "embedded-tool-call-anthropic",
      name: "embedded-tool-call-anthropic",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-5",
      supportsTools: true,
      supportsStreaming: false,
      requestBody: {
        max_tokens: 4_096,
      },
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.toolName, "read_file");
    assert.deepEqual(result.toolCalls[0]?.args, {
      path: "src/index.ts",
      startLine: 1,
      endLine: 40,
    });
    assert.equal(result.assistantText, "Inspecting the target file.");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

test("anthropic messages client uses bearer auth for MiniMax-compatible endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "minimax-test-key";

  let requestHeaders = new Headers();
  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (_input, init) => {
    if (!String(_input).includes("api.minimax.io/anthropic")) {
      return originalFetch(_input, init);
    }
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Inspected the third-party endpoint.",
          },
        ],
        stop_reason: "end_turn",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new AnthropicMessagesModelClient({
      id: "minimax",
      name: "minimax",
      protocol: "anthropic",
      baseUrl: "https://api.minimax.io/anthropic/v1",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "minimax-m1",
      supportsTools: true,
      supportsStreaming: false,
      requestBody: {
        max_tokens: 0,
      },
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(requestHeaders.get("authorization"), "Bearer minimax-test-key");
    assert.equal(requestHeaders.get("x-api-key"), null);
    assert.match(requestHeaders.get("anthropic-beta") ?? "", /interleaved-thinking/);
    assert.doesNotMatch(requestHeaders.get("anthropic-beta") ?? "", /fine-grained-tool-streaming/);
    assert.equal(requestBody.max_tokens, 131_072);
    assert.equal(result.assistantText, "Inspected the third-party endpoint.");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

test("anthropic messages client uses bearer auth and Claude Code headers for OAuth-style tokens", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-ant-oat-test-token";

  let requestHeaders = new Headers();
  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("api.anthropic.com")) {
      return originalFetch(input, init);
    }
    requestHeaders = new Headers(init?.headers);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Authenticated with OAuth-style token.",
          },
        ],
        stop_reason: "end_turn",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new AnthropicMessagesModelClient({
      id: "anthropic-oauth",
      name: "anthropic-oauth",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-5",
      supportsTools: true,
      supportsStreaming: false,
    });

    const result = await client.generateTurn(createTurnInput());
    assert.equal(requestHeaders.get("authorization"), "Bearer sk-ant-oat-test-token");
    assert.equal(requestHeaders.get("x-api-key"), null);
    assert.match(requestHeaders.get("anthropic-beta") ?? "", /claude-code-20250219/);
    assert.match(requestHeaders.get("anthropic-beta") ?? "", /oauth-2025-04-20/);
    assert.match(requestHeaders.get("user-agent") ?? "", /^claude-cli\/2\.1\.74 \(external, cli\)$/i);
    assert.equal(requestHeaders.get("x-app"), "cli");
    assert.equal(requestBody.max_tokens, 64_000);
    assert.equal(result.assistantText, "Authenticated with OAuth-style token.");
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

test("anthropic messages client resolves max_tokens overrides safely", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "anthropic-test-key";

  const requestBodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    if (!String(_input).includes("api.anthropic.com")) {
      return originalFetch(_input, init);
    }
    requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Resolved max tokens.",
          },
        ],
        stop_reason: "end_turn",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const fallbackClient = new AnthropicMessagesModelClient({
      id: "fallback-max-tokens",
      name: "fallback-max-tokens",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-5",
      supportsTools: true,
      supportsStreaming: false,
      requestBody: {
        max_tokens: -1,
      },
    });
    await fallbackClient.generateTurn(createTurnInput());

    const explicitClient = new AnthropicMessagesModelClient({
      id: "explicit-max-tokens",
      name: "explicit-max-tokens",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      model: "claude-sonnet-4-5",
      supportsTools: true,
      supportsStreaming: false,
      requestBody: {
        max_tokens: 1024.9,
      },
    });
    await explicitClient.generateTurn(createTurnInput());

    assert.equal(requestBodies[0]?.max_tokens, 64_000);
    assert.equal(requestBodies[1]?.max_tokens, 1024);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

test("failover model client retries the next profile after an upstream failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalPrimaryKey = process.env.PRIMARY_API_KEY;
  const originalSecondaryKey = process.env.SECONDARY_API_KEY;
  process.env.PRIMARY_API_KEY = "primary-key";
  process.env.SECONDARY_API_KEY = "secondary-key";

  const requestedUrls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("primary.example.com") && !url.includes("secondary.example.com")) {
      return originalFetch(input, init);
    }
    requestedUrls.push(url);
    if (url.includes("primary.example.com")) {
      return new Response("upstream overloaded", { status: 503 });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Fallback profile handled the turn.",
              tool_calls: [],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const client = new FailoverModelClient([
      {
        id: "primary",
        name: "primary",
        protocol: "openai",
        baseUrl: "https://primary.example.com/v1",
        apiKeyEnv: "PRIMARY_API_KEY",
        model: "m-primary",
        supportsTools: true,
        supportsStreaming: false,
      },
      {
        id: "secondary",
        name: "secondary",
        protocol: "openai",
        baseUrl: "https://secondary.example.com/v1",
        apiKeyEnv: "SECONDARY_API_KEY",
        model: "m-secondary",
        supportsTools: true,
        supportsStreaming: false,
      },
    ]);

    const result = await client.generateTurn(createTurnInput());
    assert.equal(result.assistantText, "Fallback profile handled the turn.");
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0] ?? "", /primary\.example\.com/);
    assert.match(requestedUrls[1] ?? "", /secondary\.example\.com/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.PRIMARY_API_KEY = originalPrimaryKey;
    process.env.SECONDARY_API_KEY = originalSecondaryKey;
  }
});

test("model error classifier maps provider failures to operational causes", () => {
  assert.equal(classifyModelError(new ModelRequestError("bad key", 401, "p1")), "auth_failed");
  assert.equal(classifyModelError(new ModelRequestError("too many requests", 429, "p1")), "rate_limit");
  assert.equal(classifyModelError(new ModelRequestError("context length exceeded", 413, "p1")), "context_overflow");
  assert.equal(classifyModelError(new ModelRequestError("server exploded", 503, "p1")), "server_error");
  assert.equal(classifyModelError(new SyntaxError("invalid json")), "malformed_tool_call");
});

test("model router records cooldown health and skips cooled profiles", async () => {
  const profiles = [
    {
      id: "primary",
      name: "Primary",
      protocol: "openai",
      baseUrl: "https://primary.example.com/v1",
      apiKeyEnv: "PRIMARY_API_KEY",
      model: "m-primary",
      supportsTools: true,
      supportsStreaming: false,
    },
    {
      id: "secondary",
      name: "Secondary",
      protocol: "openai",
      baseUrl: "https://secondary.example.com/v1",
      apiKeyEnv: "SECONDARY_API_KEY",
      model: "m-secondary",
      supportsTools: true,
      supportsStreaming: false,
    },
  ] as const;

  let primaryCalls = 0;
  const clients: ModelClient[] = [
    {
      async generateTurn(): Promise<ModelTurnResult> {
        primaryCalls += 1;
        throw new ModelRequestError("Model request failed (429): rate limited", 429, "primary");
      },
    },
    {
      async generateTurn(): Promise<ModelTurnResult> {
        return {
          assistantText: "Secondary handled the turn.",
          toolCalls: [],
          provider: {
            id: "secondary",
            name: "Secondary",
            model: "m-secondary",
            protocol: "openai",
          },
          raw: { ok: true },
        };
      },
    },
  ];

  const router = new ModelRouter(profiles, { clients, cooldownMs: 60_000 });
  const first = await router.generateTurn(createTurnInput());
  assert.equal(first.assistantText, "Secondary handled the turn.");
  assert.equal(primaryCalls, 1);
  assert.equal(router.getHealth().find((entry) => entry.profileId === "primary")?.lastErrorKind, "rate_limit");
  assert.ok(router.getHealth().find((entry) => entry.profileId === "primary")?.cooldownUntil);
  assert.ok(router.getHealth().find((entry) => entry.profileId === "primary")?.lastFailedAt);
  assert.equal(router.getHealth().find((entry) => entry.profileId === "secondary")?.successCount, 1);
  assert.ok(router.getHealth().find((entry) => entry.profileId === "secondary")?.lastSucceededAt);

  const second = await router.generateTurn(createTurnInput());
  assert.equal(second.assistantText, "Secondary handled the turn.");
  assert.equal(primaryCalls, 1);
  assert.equal(router.getLastAttempts()[0]?.outcome, "skipped_cooldown");
  const secondRaw = second.raw as {
    modelRouter?: {
      routeDiagnostics?: Array<{ profileId: string; eligible: boolean; selectedOrder: number | null; decisionReason: string }>;
    };
  };
  const primaryDiagnostic = secondRaw.modelRouter?.routeDiagnostics?.find((entry) => entry.profileId === "primary");
  const secondaryDiagnostic = secondRaw.modelRouter?.routeDiagnostics?.find((entry) => entry.profileId === "secondary");
  assert.equal(primaryDiagnostic?.eligible, false);
  assert.equal(primaryDiagnostic?.selectedOrder, null);
  assert.match(primaryDiagnostic?.decisionReason ?? "", /cooldown until/i);
  assert.equal(secondaryDiagnostic?.eligible, true);
  assert.equal(secondaryDiagnostic?.selectedOrder, 1);
});

test("model router honors provider Retry-After cooldown before fallback", async () => {
  const profiles = [
    {
      id: "primary",
      name: "Primary",
      protocol: "openai",
      baseUrl: "https://primary.example.com/v1",
      apiKeyEnv: "PRIMARY_API_KEY",
      model: "m-primary",
      supportsTools: true,
      supportsStreaming: false,
    },
    {
      id: "secondary",
      name: "Secondary",
      protocol: "openai",
      baseUrl: "https://secondary.example.com/v1",
      apiKeyEnv: "SECONDARY_API_KEY",
      model: "m-secondary",
      supportsTools: true,
      supportsStreaming: false,
    },
  ] as const;

  let primaryCalls = 0;
  const clients: ModelClient[] = [
    {
      async generateTurn(): Promise<ModelTurnResult> {
        primaryCalls += 1;
        throw new ModelRequestError("Model request failed (429): rate limited", 429, "primary", 2_000);
      },
    },
    {
      async generateTurn(): Promise<ModelTurnResult> {
        return {
          assistantText: "Secondary handled retry-after.",
          toolCalls: [],
          provider: {
            id: "secondary",
            name: "Secondary",
            model: "m-secondary",
            protocol: "openai",
          },
          raw: { ok: true },
        };
      },
    },
  ];

  const before = Date.now();
  const router = new ModelRouter(profiles, { clients, cooldownMs: 60_000 });
  const first = await router.generateTurn(createTurnInput());
  assert.equal(first.assistantText, "Secondary handled retry-after.");
  assert.equal(primaryCalls, 1);

  const primaryHealth = router.getHealth().find((entry) => entry.profileId === "primary");
  assert.equal(primaryHealth?.lastErrorKind, "rate_limit");
  assert.ok(primaryHealth?.cooldownUntil);
  const cooldownMs = Date.parse(primaryHealth.cooldownUntil) - before;
  assert.ok(cooldownMs >= 1_500 && cooldownMs <= 3_500);

  const second = await router.generateTurn(createTurnInput());
  assert.equal(second.assistantText, "Secondary handled retry-after.");
  assert.equal(primaryCalls, 1);
  assert.equal(router.getLastAttempts()[0]?.outcome, "skipped_cooldown");
});

test("model router retries transient failures within the configured retry budget", async () => {
  const profiles = [
    {
      id: "primary",
      name: "Primary",
      protocol: "openai",
      baseUrl: "https://primary.example.com/v1",
      apiKeyEnv: "PRIMARY_API_KEY",
      model: "m-primary",
      supportsTools: true,
      supportsStreaming: false,
    },
    {
      id: "secondary",
      name: "Secondary",
      protocol: "openai",
      baseUrl: "https://secondary.example.com/v1",
      apiKeyEnv: "SECONDARY_API_KEY",
      model: "m-secondary",
      supportsTools: true,
      supportsStreaming: false,
    },
  ] as const;

  let primaryCalls = 0;
  let secondaryCalls = 0;
  const clients: ModelClient[] = [
    {
      async generateTurn(): Promise<ModelTurnResult> {
        primaryCalls += 1;
        if (primaryCalls === 1) {
          throw new ModelRequestError("Model request failed (503): overloaded", 503, "primary");
        }
        return {
          assistantText: "Primary recovered on retry.",
          toolCalls: [],
          provider: {
            id: "primary",
            name: "Primary",
            model: "m-primary",
            protocol: "openai",
          },
          raw: { retried: true },
        };
      },
    },
    {
      async generateTurn(): Promise<ModelTurnResult> {
        secondaryCalls += 1;
        return {
          assistantText: "Secondary should not be needed.",
          toolCalls: [],
          provider: {
            id: "secondary",
            name: "Secondary",
            model: "m-secondary",
            protocol: "openai",
          },
          raw: { ok: true },
        };
      },
    },
  ];

  const router = new ModelRouter(profiles, { clients, retryBudget: 1, cooldownMs: 60_000 });
  const result = await router.generateTurn(createTurnInput());

  assert.equal(result.assistantText, "Primary recovered on retry.");
  assert.equal(primaryCalls, 2);
  assert.equal(secondaryCalls, 0);
  assert.equal(router.getHealth().find((entry) => entry.profileId === "primary")?.successCount, 1);
  assert.equal(router.getHealth().find((entry) => entry.profileId === "primary")?.failureCount, 0);
  assert.deepEqual(
    router.getLastAttempts().map((entry) => [entry.profileId, entry.attempt, entry.outcome, entry.willRetry ?? false]),
    [
      ["primary", 1, "failed", true],
      ["primary", 2, "success", false],
    ],
  );
});

test("model router applies role-specific profile preference before fallback order", async () => {
  const profiles = [
    {
      id: "primary",
      name: "Primary",
      protocol: "openai",
      baseUrl: "https://primary.example.com/v1",
      apiKeyEnv: "PRIMARY_API_KEY",
      model: "m-primary",
      supportsTools: true,
      supportsStreaming: false,
    },
    {
      id: "planner-model",
      name: "Planner",
      protocol: "openai",
      baseUrl: "https://planner.example.com/v1",
      apiKeyEnv: "PLANNER_API_KEY",
      model: "m-planner",
      supportsTools: true,
      supportsStreaming: false,
    },
  ] as const;
  const callOrder: string[] = [];
  const clients: ModelClient[] = profiles.map((profile) => ({
    async generateTurn(): Promise<ModelTurnResult> {
      callOrder.push(profile.id);
      return {
        assistantText: `${profile.id} handled the turn.`,
        toolCalls: [],
        provider: {
          id: profile.id,
          name: profile.name,
          model: profile.model,
          protocol: profile.protocol,
        },
        raw: { profileId: profile.id },
      };
    },
  }));

  const router = new ModelRouter(profiles, {
    clients,
    roleProfileOverrides: {
      planner: "planner-model",
    },
  });
  const result = await router.generateTurn(createTurnInput("planner"));
  assert.equal(result.provider?.id, "planner-model");
  assert.deepEqual(callOrder, ["planner-model"]);
});

test("model router filters non-tool profiles for tool-requiring turns and explains the route", async () => {
  const profiles = [
    {
      id: "cheap-json",
      name: "Cheap Json",
      protocol: "openai",
      baseUrl: "https://cheap.example.com/v1",
      apiKeyEnv: "CHEAP_API_KEY",
      model: "m-cheap",
      supportsTools: false,
      supportsStreaming: false,
      costHint: "low",
    },
    {
      id: "tool-capable",
      name: "Tool Capable",
      protocol: "openai",
      baseUrl: "https://tool.example.com/v1",
      apiKeyEnv: "TOOL_API_KEY",
      model: "m-tool",
      supportsTools: true,
      supportsStreaming: false,
      costHint: "high",
    },
  ] as const;
  const callOrder: string[] = [];
  const clients: ModelClient[] = profiles.map((profile) => ({
    async generateTurn(): Promise<ModelTurnResult> {
      callOrder.push(profile.id);
      return {
        assistantText: `${profile.id} handled the turn.`,
        toolCalls: [],
        provider: {
          id: profile.id,
          name: profile.name,
          model: profile.model,
          protocol: profile.protocol,
        },
        raw: { profileId: profile.id },
      };
    },
  }));

  const result = await new ModelRouter(profiles, { clients }).generateTurn(createTurnInput());
  const raw = result.raw as {
    modelRouter?: {
      routeDiagnostics?: Array<{ profileId: string; eligible: boolean; decisionReason: string; selectedOrder: number | null }>;
    };
  };
  const cheapDiagnostic = raw.modelRouter?.routeDiagnostics?.find((entry) => entry.profileId === "cheap-json");
  const toolDiagnostic = raw.modelRouter?.routeDiagnostics?.find((entry) => entry.profileId === "tool-capable");

  assert.equal(result.provider?.id, "tool-capable");
  assert.deepEqual(callOrder, ["tool-capable"]);
  assert.equal(cheapDiagnostic?.eligible, false);
  assert.match(cheapDiagnostic?.decisionReason ?? "", /tools are required/);
  assert.equal(toolDiagnostic?.selectedOrder, 1);
  assert.match(toolDiagnostic?.decisionReason ?? "", /supports required tools/);
});

test("model router applies context budget filtering and cost sorting", async () => {
  const profiles = [
    {
      id: "too-small",
      name: "Too Small",
      protocol: "openai",
      baseUrl: "https://small.example.com/v1",
      apiKeyEnv: "SMALL_API_KEY",
      model: "m-small",
      supportsTools: true,
      supportsStreaming: false,
      maxInputTokens: 1,
      costHint: "low",
    },
    {
      id: "expensive-large",
      name: "Expensive Large",
      protocol: "openai",
      baseUrl: "https://expensive.example.com/v1",
      apiKeyEnv: "EXPENSIVE_API_KEY",
      model: "m-expensive",
      supportsTools: true,
      supportsStreaming: false,
      maxInputTokens: 10_000,
      costHint: "high",
    },
    {
      id: "cheap-large",
      name: "Cheap Large",
      protocol: "openai",
      baseUrl: "https://cheap-large.example.com/v1",
      apiKeyEnv: "CHEAP_LARGE_API_KEY",
      model: "m-cheap-large",
      supportsTools: true,
      supportsStreaming: false,
      maxInputTokens: 10_000,
      costHint: "low",
    },
  ] as const;
  const callOrder: string[] = [];
  const clients: ModelClient[] = profiles.map((profile) => ({
    async generateTurn(): Promise<ModelTurnResult> {
      callOrder.push(profile.id);
      return {
        assistantText: `${profile.id} handled the turn.`,
        toolCalls: [],
        provider: {
          id: profile.id,
          name: profile.name,
          model: profile.model,
          protocol: profile.protocol,
        },
        raw: { profileId: profile.id },
      };
    },
  }));

  const result = await new ModelRouter(profiles, { clients }).generateTurn(createTurnInput());
  const raw = result.raw as {
    modelRouter?: {
      routeDiagnostics?: Array<{ profileId: string; eligible: boolean; decisionReason: string; selectedOrder: number | null }>;
    };
  };
  const smallDiagnostic = raw.modelRouter?.routeDiagnostics?.find((entry) => entry.profileId === "too-small");

  assert.equal(result.provider?.id, "cheap-large");
  assert.deepEqual(callOrder, ["cheap-large"]);
  assert.equal(smallDiagnostic?.eligible, false);
  assert.match(smallDiagnostic?.decisionReason ?? "", /context exceeds/);
  assert.deepEqual(
    raw.modelRouter?.routeDiagnostics
      ?.filter((entry) => entry.eligible)
      .map((entry) => [entry.profileId, entry.selectedOrder]),
    [
      ["expensive-large", 2],
      ["cheap-large", 1],
    ],
  );
});

test("model usage cost estimator handles cached tokens and unknown models", () => {
  const openAiEstimate = estimateModelUsageCost("gpt-4.1-mini-2025-04-14", {
    inputTokens: 1_000_000,
    cachedInputTokens: 200_000,
    outputTokens: 500_000,
  });
  assert.equal(openAiEstimate.status, "estimated");
  assert.equal(openAiEstimate.model, "gpt-4.1-mini");
  assert.equal(openAiEstimate.source, "openai-official");
  assert.equal(openAiEstimate.estimatedCostUsd, 1.1400000000000001);

  const anthropicEstimate = estimateModelUsageCost("claude-sonnet-4.5", {
    inputTokens: 1_000_000,
    cacheCreationInputTokens: 100_000,
    cacheReadInputTokens: 200_000,
    outputTokens: 100_000,
  });
  assert.equal(anthropicEstimate.status, "estimated");
  assert.equal(anthropicEstimate.source, "anthropic-official");
  assert.equal(anthropicEstimate.estimatedCostUsd, 4.035);

  const unknownEstimate = estimateModelUsageCost("local-model", {
    inputTokens: 100,
    outputTokens: 50,
  });
  assert.equal(unknownEstimate.status, "unknown");
  assert.equal(unknownEstimate.estimatedCostUsd, null);
});

test("model router creates provider extension clients by id or protocol", async () => {
  const registry = new ModelProviderExtensionRegistry();
  const calls: string[] = [];
  registry.register({
    id: "fake-provider",
    name: "Fake Provider",
    protocols: ["fake"],
    createModelClient(profile): ModelClient {
      return {
        async generateTurn(): Promise<ModelTurnResult> {
          calls.push(`${profile.id}:${profile.protocol}`);
          return {
            assistantText: `${profile.id} handled by fake provider.`,
            toolCalls: [],
            provider: {
              id: profile.id,
              name: profile.name,
              model: profile.model,
              protocol: profile.protocol,
            },
            raw: { providerExtensionId: profile.providerExtensionId ?? null },
          };
        },
      };
    },
  });

  const profiles = [
    {
      id: "by-id",
      name: "By Id",
      protocol: "openai",
      providerExtensionId: "fake-provider",
      baseUrl: "https://fake.example.com/v1",
      apiKeyEnv: "FAKE_API_KEY",
      model: "fake-by-id",
      supportsTools: true,
      supportsStreaming: false,
    },
    {
      id: "by-protocol",
      name: "By Protocol",
      protocol: "fake",
      baseUrl: "https://fake.example.com/v1",
      apiKeyEnv: "FAKE_API_KEY",
      model: "fake-by-protocol",
      supportsTools: true,
      supportsStreaming: false,
    },
  ] as const;

  const idRouter = new ModelRouter([profiles[0]], { providerRegistry: registry });
  const protocolRouter = new ModelRouter([profiles[1]], { providerRegistry: registry });

  assert.equal((await idRouter.generateTurn(createTurnInput())).assistantText, "by-id handled by fake provider.");
  assert.equal((await protocolRouter.generateTurn(createTurnInput())).assistantText, "by-protocol handled by fake provider.");
  assert.deepEqual(calls, ["by-id:openai", "by-protocol:fake"]);
});

test("unknown provider extension fails explicitly", () => {
  assert.throws(
    () =>
      new ModelRouter([
        {
          id: "unknown",
          name: "Unknown",
          protocol: "openai",
          providerExtensionId: "missing-provider",
          baseUrl: "https://unknown.example.com/v1",
          apiKeyEnv: "UNKNOWN_API_KEY",
          model: "m-unknown",
          supportsTools: true,
          supportsStreaming: false,
        },
      ]),
    /Unknown model provider extension "missing-provider" for profile unknown/,
  );
});

test("provider extension diagnostics and routing preserve profile selection fields", async () => {
  const registry = new ModelProviderExtensionRegistry();
  registry.register({
    id: "fake-provider",
    name: "Fake Provider",
    protocols: ["fake"],
    createModelClient(profile): ModelClient {
      return {
        async generateTurn(): Promise<ModelTurnResult> {
          return {
            assistantText: `${profile.id} selected.`,
            toolCalls: [],
            provider: {
              id: profile.id,
              name: profile.name,
              model: profile.model,
              protocol: profile.protocol,
            },
            raw: { profileId: profile.id },
          };
        },
      };
    },
  });
  const profiles = [
    {
      id: "first",
      name: "First",
      protocol: "fake",
      baseUrl: "https://fake.example.com/v1",
      apiKeyEnv: "FAKE_API_KEY",
      model: "fake-first",
      supportsTools: true,
      supportsStreaming: false,
    },
    {
      id: "second",
      name: "Second",
      protocol: "fake",
      baseUrl: "https://fake.example.com/v1",
      apiKeyEnv: "FAKE_API_KEY",
      model: "fake-second",
      supportsTools: true,
      supportsStreaming: false,
    },
  ] as const;

  assert.equal(selectModelProfiles(profiles, "first")[0]?.id, "first");
  assert.equal(selectModelProfiles(profiles, "Second")[0]?.id, "second");
  assert.equal(selectModelProfiles(profiles, "fake-second")[0]?.id, "second");

  const router = new ModelRouter(profiles, {
    allowlist: ["Second"],
    providerRegistry: registry,
  });
  const result = await router.generateTurn(createTurnInput());
  const diagnostics = buildModelProfileDiagnostics({ source: "json", issues: [], profiles }, registry);

  assert.equal(result.provider?.id, "second");
  assert.equal(diagnostics.profiles[0]?.providerExtensionId, null);
  assert.equal(diagnostics.profiles[0]?.providerExtensionConfigured, true);
});

test("provider extension raw and router errors redact profile secrets", async () => {
  const originalKey = process.env.FAKE_SECRET_KEY;
  process.env.FAKE_SECRET_KEY = "fake-secret-value";
  const registry = new ModelProviderExtensionRegistry();
  registry.register({
    id: "fake-provider",
    name: "Fake Provider",
    protocols: ["fake"],
    createModelClient(profile): ModelClient {
      return {
        async generateTurn(): Promise<ModelTurnResult> {
          if (profile.id === "failing") {
            throw new Error("failed with fake-secret-value and body-secret");
          }
          return {
            assistantText: "fake success",
            toolCalls: [],
            provider: {
              id: profile.id,
              name: profile.name,
              model: profile.model,
              protocol: profile.protocol,
            },
            raw: {
              envSecret: "fake-secret-value",
              bodySecret: "body-secret",
            },
          };
        },
      };
    },
  });

  try {
    const profile = {
      id: "safe",
      name: "Safe",
      protocol: "fake",
      baseUrl: "https://fake.example.com/v1",
      apiKeyEnv: "FAKE_SECRET_KEY",
      model: "fake-safe",
      supportsTools: true,
      supportsStreaming: false,
      requestBody: {
        token: "body-secret",
      },
    } as const;
    const result = await new ModelRouter([profile], { providerRegistry: registry }).generateTurn(createTurnInput());
    const raw = JSON.stringify(result.raw);
    assert.equal(raw.includes("fake-secret-value"), false);
    assert.equal(raw.includes("body-secret"), false);

    await assert.rejects(
      () =>
        new ModelRouter([{ ...profile, id: "failing", name: "Failing" }], {
          providerRegistry: registry,
          cooldownMs: 0,
        }).generateTurn(createTurnInput()),
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /All model profiles failed/);
        assert.equal(message.includes("fake-secret-value"), false);
        assert.equal(message.includes("body-secret"), false);
        return true;
      },
    );
  } finally {
    if (originalKey === undefined) {
      delete process.env.FAKE_SECRET_KEY;
    } else {
      process.env.FAKE_SECRET_KEY = originalKey;
    }
  }
});

test("credential pool redacts successful raw payloads from leased clients", async () => {
  const originalEnvKey = process.env.POOL_SUCCESS_REDACT_API_KEY;
  process.env.POOL_SUCCESS_REDACT_API_KEY = "pool-success-env-secret";
  const secrets = [
    "pool-success-env-secret",
    "pool-success-inline-secret",
    "Bearer pool-success-header-secret",
    "pool-success-body-token",
  ];
  const profile: ModelProfile = {
    id: "pooled-success-redact",
    name: "Pooled Success Redact",
    protocol: "openai",
    baseUrl: "https://pooled-success.example.com/v1",
    apiKeyEnv: "POOL_SUCCESS_REDACT_API_KEY",
    credentials: [
      { id: "env", apiKeyEnv: "POOL_SUCCESS_REDACT_API_KEY" },
      { id: "inline", apiKey: "pool-success-inline-secret" },
    ],
    model: "m-pooled-success",
    supportsTools: true,
    supportsStreaming: false,
    headers: {
      Authorization: "Bearer pool-success-header-secret",
    },
    requestBody: {
      token: "pool-success-body-token",
    },
  };
  const client = new CredentialPoolModelClient(profile, () => ({
    async generateTurn(): Promise<ModelTurnResult> {
      return {
        assistantText: "Pooled success.",
        toolCalls: [],
        provider: {
          id: profile.id,
          name: profile.name,
          model: profile.model,
          protocol: profile.protocol,
        },
        raw: {
          apiKey: "pool-success-env-secret",
          inlineApiKey: "pool-success-inline-secret",
          headers: {
            Authorization: "Bearer pool-success-header-secret",
          },
          requestBody: {
            token: "pool-success-body-token",
          },
        },
      };
    },
  }));

  try {
    const result = await client.generateTurn(createTurnInput());
    const raw = JSON.stringify(result.raw);
    assert.match(raw, /\[redacted\]/);
    for (const secret of secrets) {
      assert.equal(raw.includes(secret), false);
    }
  } finally {
    if (originalEnvKey === undefined) {
      delete process.env.POOL_SUCCESS_REDACT_API_KEY;
    } else {
      process.env.POOL_SUCCESS_REDACT_API_KEY = originalEnvKey;
    }
  }
});

test("model credential pool rotates credentials through generateTurn", async () => {
  const originalFetch = globalThis.fetch;
  const originalFirstKey = process.env.POOL_FIRST_API_KEY;
  process.env.POOL_FIRST_API_KEY = "first-secret";

  const authorizations: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("pool.example.com")) {
      return originalFetch(input, init);
    }
    authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Credential handled the turn.",
              tool_calls: [],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const router = new ModelRouter([
      {
        id: "pooled",
        name: "Pooled",
        protocol: "openai",
        baseUrl: "https://pool.example.com/v1",
        apiKeyEnv: "POOL_FIRST_API_KEY",
        credentials: [
          { id: "first", apiKeyEnv: "POOL_FIRST_API_KEY" },
          { id: "second", apiKey: "second-secret" },
        ],
        model: "m-pooled",
        supportsTools: true,
        supportsStreaming: false,
      },
    ]);

    await router.generateTurn(createTurnInput());
    const second = await router.generateTurn(createTurnInput());

    assert.deepEqual(authorizations, ["Bearer first-secret", "Bearer second-secret"]);
    assert.equal(JSON.stringify(second.raw).includes("first-secret"), false);
    assert.equal(JSON.stringify(second.raw).includes("second-secret"), false);
    assert.match(JSON.stringify(second.raw), /"credentialId":"second"/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFirstKey === undefined) {
      delete process.env.POOL_FIRST_API_KEY;
    } else {
      process.env.POOL_FIRST_API_KEY = originalFirstKey;
    }
  }
});

test("model credential pool cools only the failed credential and keeps the profile healthy", async () => {
  const originalFetch = globalThis.fetch;
  const originalFirstKey = process.env.POOL_COOLDOWN_FIRST_API_KEY;
  const originalSecondKey = process.env.POOL_COOLDOWN_SECOND_API_KEY;
  process.env.POOL_COOLDOWN_FIRST_API_KEY = "cooldown-first-secret";
  process.env.POOL_COOLDOWN_SECOND_API_KEY = "cooldown-second-secret";

  const authorizations: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("cooldown.example.com")) {
      return originalFetch(input, init);
    }
    const authorization = new Headers(init?.headers).get("authorization") ?? "";
    authorizations.push(authorization);
    if (authorization === "Bearer cooldown-first-secret") {
      return new Response("rate limited", { status: 429, headers: { "Retry-After": "2" } });
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Second credential handled the turn.",
              tool_calls: [],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const router = new ModelRouter([
      {
        id: "pooled-cooldown",
        name: "Pooled Cooldown",
        protocol: "openai",
        baseUrl: "https://cooldown.example.com/v1",
        apiKeyEnv: "POOL_COOLDOWN_FIRST_API_KEY",
        credentials: [
          { id: "first", apiKeyEnv: "POOL_COOLDOWN_FIRST_API_KEY" },
          { id: "second", apiKeyEnv: "POOL_COOLDOWN_SECOND_API_KEY" },
        ],
        model: "m-pooled",
        supportsTools: true,
        supportsStreaming: false,
      },
    ]);

    const before = Date.now();
    const first = await router.generateTurn(createTurnInput());
    assert.equal(first.assistantText, "Second credential handled the turn.");
    assert.deepEqual(authorizations, ["Bearer cooldown-first-secret", "Bearer cooldown-second-secret"]);
    assert.equal(router.getHealth()[0]?.successCount, 1);
    assert.equal(router.getHealth()[0]?.cooldownUntil, null);

    const firstRaw = first.raw as {
      result?: {
        credentialPool?: {
          health?: {
            entries?: Array<{ id: string; cooldownUntil: string | null; failureCount: number; successCount: number }>;
          };
        };
      };
    };
    const entries = firstRaw.result?.credentialPool?.health?.entries ?? [];
    const firstCooldownUntil = entries.find((entry) => entry.id === "first")?.cooldownUntil;
    assert.ok(firstCooldownUntil);
    const cooldownMs = Date.parse(firstCooldownUntil) - before;
    assert.ok(cooldownMs >= 1_500 && cooldownMs <= 3_500);
    assert.equal(entries.find((entry) => entry.id === "first")?.failureCount, 1);
    assert.equal(entries.find((entry) => entry.id === "second")?.successCount, 1);

    authorizations.length = 0;
    const second = await router.generateTurn(createTurnInput());
    assert.equal(second.assistantText, "Second credential handled the turn.");
    assert.deepEqual(authorizations, ["Bearer cooldown-second-secret"]);
    assert.equal(JSON.stringify(second.raw).includes("cooldown-first-secret"), false);
    assert.equal(JSON.stringify(second.raw).includes("cooldown-second-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalFirstKey === undefined) {
      delete process.env.POOL_COOLDOWN_FIRST_API_KEY;
    } else {
      process.env.POOL_COOLDOWN_FIRST_API_KEY = originalFirstKey;
    }
    if (originalSecondKey === undefined) {
      delete process.env.POOL_COOLDOWN_SECOND_API_KEY;
    } else {
      process.env.POOL_COOLDOWN_SECOND_API_KEY = originalSecondKey;
    }
  }
});

test("credential pool redacts profile secrets from failure attempts and aggregate errors", async () => {
  const originalFirstKey = process.env.POOL_REDACT_FIRST_API_KEY;
  process.env.POOL_REDACT_FIRST_API_KEY = "pool-redact-first-secret";

  const secrets = [
    "pool-redact-first-secret",
    "pool-redact-second-secret",
    "Bearer pool-redact-header-secret",
    "pool-redact-token-secret",
  ];
  const profile: ModelProfile = {
    id: "pooled-redact",
    name: "Pooled Redact",
    protocol: "openai",
    baseUrl: "https://redact.example.com/v1",
    apiKeyEnv: "POOL_REDACT_FIRST_API_KEY",
    credentials: [
      { id: "first", apiKeyEnv: "POOL_REDACT_FIRST_API_KEY" },
      { id: "second", apiKey: "pool-redact-second-secret" },
    ],
    model: "m-pooled",
    supportsTools: true,
    supportsStreaming: false,
    headers: {
      Authorization: "Bearer pool-redact-header-secret",
    },
    requestBody: {
      token: "pool-redact-token-secret",
    },
  };
  const createClient =
    (failingCredentials: ReadonlySet<string>): ((leasedProfile: ModelProfile) => ModelClient) =>
    (leasedProfile) => ({
      async generateTurn(): Promise<ModelTurnResult> {
        const credentialId = leasedProfile.credentials?.[0]?.id ?? "unknown";
        if (failingCredentials.has(credentialId)) {
          throw new Error(
            [
              "auth failed",
              `apiKey=${process.env.POOL_REDACT_FIRST_API_KEY}`,
              "inline=pool-redact-second-secret",
              "Authorization=Bearer pool-redact-header-secret",
              "token=pool-redact-token-secret",
            ].join(" "),
          );
        }
        return {
          assistantText: "Credential handled the turn.",
          toolCalls: [],
          raw: {
            credentialId,
          },
        };
      },
    });

  try {
    const pool = new CredentialPoolModelClient(profile, createClient(new Set(["first"])));
    const first = await pool.generateTurn(createTurnInput());
    const firstRaw = first.raw as {
      credentialPool?: {
        attempts?: Array<{ readonly credentialId: string; readonly outcome: string; readonly error?: string }>;
      };
    };
    const failedAttempt = firstRaw.credentialPool?.attempts?.find((entry) => entry.outcome === "failed");
    const firstText = JSON.stringify(first.raw);

    assert.equal(failedAttempt?.credentialId, "first");
    assert.match(failedAttempt?.error ?? "", /\[redacted\]/);
    for (const secret of secrets) {
      assert.equal(firstText.includes(secret), false);
    }

    const second = await pool.generateTurn(createTurnInput());
    const secondRaw = second.raw as {
      credentialPool?: {
        attempts?: Array<{ readonly credentialId: string; readonly outcome: string; readonly error?: string }>;
      };
    };
    const skippedAttempt = secondRaw.credentialPool?.attempts?.find((entry) => entry.outcome === "skipped_cooldown");
    const secondText = JSON.stringify(second.raw);

    assert.equal(skippedAttempt?.credentialId, "first");
    assert.match(skippedAttempt?.error ?? "", /\[redacted\]/);
    for (const secret of secrets) {
      assert.equal(secondText.includes(secret), false);
    }

    const failingPool = new CredentialPoolModelClient(profile, createClient(new Set(["first", "second"])));
    await assert.rejects(
      () => failingPool.generateTurn(createTurnInput()),
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /All model credentials failed/);
        assert.match(message, /\[redacted\]/);
        for (const secret of secrets) {
          assert.equal(message.includes(secret), false);
        }
        return true;
      },
    );
  } finally {
    if (originalFirstKey === undefined) {
      delete process.env.POOL_REDACT_FIRST_API_KEY;
    } else {
      process.env.POOL_REDACT_FIRST_API_KEY = originalFirstKey;
    }
  }
});

test("single apiKeyEnv profiles keep the existing request and key-health behavior", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.SINGLE_API_KEY;
  process.env.SINGLE_API_KEY = "single-secret";

  let authorization = "";
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("single.example.com")) {
      return originalFetch(input, init);
    }
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Single key handled the turn.",
              tool_calls: [],
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    const profile = {
      id: "single",
      name: "Single",
      protocol: "openai" as const,
      baseUrl: "https://single.example.com/v1",
      apiKeyEnv: "SINGLE_API_KEY",
      model: "m-single",
      supportsTools: true,
      supportsStreaming: false,
    };
    const client = new OpenAiCompatibleModelClient(profile);
    const result = await client.generateTurn(createTurnInput());
    const diagnostics = buildModelProfileDiagnostics({
      source: "json",
      issues: [],
      profiles: [profile],
    });

    assert.equal(result.assistantText, "Single key handled the turn.");
    assert.equal(authorization, "Bearer single-secret");
    assert.equal(hasModelProfileApiKey(profile), true);
    assert.equal(diagnostics.configuredKeyCount, 1);
    assert.equal(diagnostics.profiles[0]?.credentialPool.credentialCount, 1);
    assert.equal(diagnostics.profiles[0]?.credentialPool.entries[0]?.apiKeyEnv, "SINGLE_API_KEY");
    assert.equal(JSON.stringify(diagnostics).includes("single-secret"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.SINGLE_API_KEY;
    } else {
      process.env.SINGLE_API_KEY = originalApiKey;
    }
  }
});

test("model profiles can be loaded as a failover chain from environment JSON", () => {
  const originalProfiles = process.env.OMNI_AGENT_MODEL_PROFILES_JSON;
  process.env.OMNI_AGENT_MODEL_PROFILES_JSON = JSON.stringify([
    {
      id: "primary",
      name: "Primary",
      protocol: "anthropic",
      baseUrl: "https://primary.example.com/v1",
      apiKeyEnv: "PRIMARY_API_KEY",
      model: "m-primary",
    },
    {
      id: "secondary",
      baseUrl: "https://secondary.example.com/v1",
      apiKeyEnv: "SECONDARY_API_KEY",
      model: "m-secondary",
      supportsTools: false,
    },
  ]);

  try {
    const profiles = loadModelProfilesFromEnv();
    assert.equal(profiles.length, 2);
    assert.equal(profiles[0]?.id, "primary");
    assert.equal(profiles[0]?.protocol, "anthropic");
    assert.equal(profiles[1]?.id, "secondary");
    assert.equal(profiles[1]?.supportsTools, false);
  } finally {
    process.env.OMNI_AGENT_MODEL_PROFILES_JSON = originalProfiles;
  }
});

test("B.AI built-in provider template creates an OpenAI-compatible profile", () => {
  const profile = createModelProfileForProvider("bai");

  assert.equal(resolveBuiltInModelProfileProvider("b.ai"), "bai");
  assert.equal(profile.id, "bai");
  assert.equal(profile.name, "B.AI");
  assert.equal(profile.protocol, "openai");
  assert.equal(profile.baseUrl, "https://api.b.ai/v1");
  assert.equal(profile.apiKeyEnv, "BAI_API_KEY");
  assert.equal(profile.model, "gpt-5.2");
  assert.equal(profile.supportsTools, true);
  assert.equal(profile.supportsStreaming, true);
  assert.deepEqual(
    profile.credentials?.map((credential) => credential.apiKeyEnv),
    ["BAI_API_KEY", "B_AI_API_KEY", "OMNI_AGENT_BAI_API_KEY"],
  );

  const overridden = createModelProfileForProvider("bai", {
    id: "bai-test",
    name: "B.AI Test",
    baseUrl: "https://provider.example/v1",
    apiKeyEnv: "OMNI_LIVE_BAI_API_KEY",
    model: "gpt-5.2-mini",
    supportsTools: false,
  });
  assert.equal(overridden.id, "bai-test");
  assert.equal(overridden.name, "B.AI Test");
  assert.equal(overridden.baseUrl, "https://provider.example/v1");
  assert.equal(overridden.apiKeyEnv, "OMNI_LIVE_BAI_API_KEY");
  assert.equal(overridden.model, "gpt-5.2-mini");
  assert.equal(overridden.supportsTools, false);
  assert.equal(overridden.credentials?.[0]?.apiKeyEnv, "OMNI_LIVE_BAI_API_KEY");
});

test("mock Genesis model covers blocked and fallback risk scenarios", async () => {
  const client = new MockModelClient();

  const missingApprovalObjective = "Block an HTX paper order when approval is missing; require approved=true.";
  const missingApproval = await client.generateTurn(createGenesisTurnInput(missingApprovalObjective));
  assert.deepEqual(
    missingApproval.toolCalls.map((call) => call.toolName),
    ["genesis_finance_plan", "htx_order_preview", "htx_paper_order"],
  );
  assert.equal(missingApproval.toolCalls[2]?.args.approved, undefined);

  const missingApprovalFinal = await client.generateTurn(createGenesisTurnInput(missingApprovalObjective, [
    { toolName: "genesis_finance_plan", ok: true, summary: "Plan produced." },
    { toolName: "htx_order_preview", ok: true, summary: "Preview produced." },
    { toolName: "htx_paper_order", ok: false, summary: "Paper order blocked because approved=true was not supplied." },
  ]));
  assert.match(missingApprovalFinal.assistantText, /approved=true/);
  assert.match(missingApprovalFinal.assistantText, /blocked/);

  const missingTron = await client.generateTurn(
    createGenesisTurnInput("Block a live TRON account snapshot when address is required."),
  );
  assert.equal(missingTron.toolCalls[0]?.toolName, "web3_tron_account_snapshot");
  assert.deepEqual(missingTron.toolCalls[0]?.args, { mode: "live" });

  const missingBai = await client.generateTurn(createGenesisTurnInput("Block B.AI key missing live chat completion."));
  assert.equal(missingBai.toolCalls[0]?.toolName, "bai_chat_completion");
  assert.equal(missingBai.toolCalls[0]?.args.apiKeyEnv, "OMNI_AGENT_MISSING_BAI_KEY_FOR_EVAL");
  assert.doesNotMatch(JSON.stringify(missingBai.toolCalls[0]?.args), /sk-/);

  const timeoutObjective = "Handle a live endpoint timeout fallback for HTX market data.";
  const timeoutFirst = await client.generateTurn(createGenesisTurnInput(timeoutObjective));
  assert.equal(timeoutFirst.toolCalls[0]?.toolName, "htx_market_data");
  assert.equal(timeoutFirst.toolCalls[0]?.args.mode, "live");

  const timeoutFallback = await client.generateTurn(createGenesisTurnInput(timeoutObjective, [
    { toolName: "htx_market_data", ok: false, summary: "The live endpoint timed out." },
  ]));
  assert.equal(timeoutFallback.toolCalls[0]?.toolName, "htx_market_data");
  assert.equal(timeoutFallback.toolCalls[0]?.args.mode, "mock");

  const timeoutFinal = await client.generateTurn(createGenesisTurnInput(timeoutObjective, [
    { toolName: "htx_market_data", ok: false, summary: "The live endpoint timed out." },
    { toolName: "htx_market_data", ok: true, summary: "Read HTX BTCUSDT market snapshot from mock." },
  ]));
  assert.match(timeoutFinal.assistantText, /timeout fallback/);
  assert.match(timeoutFinal.assistantText, /mock HTX evidence/);
});

test("default model profile loads streaming and provider overrides from env", () => {
  const originalProtocol = process.env.OMNI_AGENT_MODEL_PROTOCOL;
  const originalApiPath = process.env.OMNI_AGENT_MODEL_API_PATH;
  const originalHeaders = process.env.OMNI_AGENT_MODEL_HEADERS_JSON;
  const originalBody = process.env.OMNI_AGENT_MODEL_BODY_JSON;
  const originalSupportsStreaming = process.env.OMNI_AGENT_SUPPORTS_STREAMING;

  process.env.OMNI_AGENT_MODEL_PROTOCOL = "anthropic";
  process.env.OMNI_AGENT_MODEL_API_PATH = "/providers/custom/chat/completions";
  process.env.OMNI_AGENT_MODEL_HEADERS_JSON = JSON.stringify({
    "x-tenant": "demo",
  });
  process.env.OMNI_AGENT_MODEL_BODY_JSON = JSON.stringify({
    max_tokens: 1024,
    reasoning_effort: "low",
  });
  process.env.OMNI_AGENT_SUPPORTS_STREAMING = "true";

  try {
    const profile = loadModelProfileFromEnv();
    assert.equal(profile.protocol, "anthropic");
    assert.equal(profile.apiPath, "providers/custom/chat/completions");
    assert.equal(profile.supportsStreaming, true);
    assert.deepEqual(profile.headers, {
      "x-tenant": "demo",
    });
    assert.deepEqual(profile.requestBody, {
      max_tokens: 1024,
      reasoning_effort: "low",
    });
  } finally {
    process.env.OMNI_AGENT_MODEL_PROTOCOL = originalProtocol;
    process.env.OMNI_AGENT_MODEL_API_PATH = originalApiPath;
    process.env.OMNI_AGENT_MODEL_HEADERS_JSON = originalHeaders;
    process.env.OMNI_AGENT_MODEL_BODY_JSON = originalBody;
    process.env.OMNI_AGENT_SUPPORTS_STREAMING = originalSupportsStreaming;
  }
});

test("model profiles can be selected by id, name, or model", () => {
  const profiles = [
    {
      id: "primary",
      name: "Primary",
      baseUrl: "https://primary.example.com/v1",
      apiKeyEnv: "PRIMARY_API_KEY",
      model: "m-primary",
      supportsTools: true,
      supportsStreaming: false,
    },
    {
      id: "backup",
      name: "Backup",
      protocol: "openai",
      baseUrl: "https://backup.example.com/v1",
      apiKeyEnv: "BACKUP_API_KEY",
      model: "m-backup",
      supportsTools: false,
      supportsStreaming: false,
    },
  ] as const;

  assert.equal(selectModelProfiles(profiles, "primary")[0]?.id, "primary");
  assert.equal(selectModelProfiles(profiles, "backup")[0]?.id, "backup");
  assert.equal(selectModelProfiles(profiles, "Primary")[0]?.id, "primary");
  assert.equal(selectModelProfiles(profiles, "m-backup")[0]?.id, "backup");
  assert.equal(selectModelProfiles(profiles, "auto").length, 2);
  assert.throws(() => selectModelProfiles(profiles, "missing"), /Unknown model profile/);
});

test("model profile inspection reports invalid JSON explicitly", () => {
  const originalProfiles = process.env.OMNI_AGENT_MODEL_PROFILES_JSON;
  process.env.OMNI_AGENT_MODEL_PROFILES_JSON = "{invalid json";

  try {
    const report = inspectModelProfilesFromEnv();
    assert.equal(report.source, "default");
    assert.equal(report.profiles.length, 1);
    assert.equal(report.issues.length, 1);
    assert.equal(report.issues[0]?.level, "error");
    assert.match(report.issues[0]?.message ?? "", /invalid JSON/);
  } finally {
    process.env.OMNI_AGENT_MODEL_PROFILES_JSON = originalProfiles;
  }
});

test("model profile diagnostics summarize key, capability, and redacted header state", () => {
  const originalPrimaryKey = process.env.PRIMARY_API_KEY;
  const originalSecondaryKey = process.env.SECONDARY_API_KEY;
  process.env.PRIMARY_API_KEY = "primary-key";
  delete process.env.SECONDARY_API_KEY;

  try {
    const diagnostics = buildModelProfileDiagnostics({
      source: "json",
      issues: [{ level: "warning", message: "fixture warning" }],
      profiles: [
        {
          id: "primary",
          name: "Primary",
          protocol: "openai",
          baseUrl: "https://user:secret@primary.example.com/v1?api_key=abcdefghijklmnopqrstuvwxyz123456&tenant=demo",
          apiPath: "chat/completions",
          apiKeyEnv: "PRIMARY_API_KEY",
          model: "m-primary",
          supportsTools: true,
          supportsStreaming: true,
          headers: {
            Authorization: "Bearer hidden",
            "x-tenant": "demo",
          },
          requestBody: {
            temperature: 0.1,
          },
        },
        {
          id: "secondary",
          name: "Secondary",
          protocol: "anthropic",
          baseUrl: "https://secondary.example.com",
          apiKeyEnv: "SECONDARY_API_KEY",
          model: "m-secondary",
          supportsTools: false,
          supportsStreaming: false,
        },
      ],
    });

    assert.equal(diagnostics.profileCount, 2);
    assert.equal(diagnostics.configuredKeyCount, 1);
    assert.equal(diagnostics.toolCapableCount, 1);
    assert.equal(diagnostics.streamingCapableCount, 1);
    assert.deepEqual(diagnostics.profiles[0]?.headers, {
      Authorization: "[configured]",
      "x-tenant": "demo",
    });
    assert.equal(
      diagnostics.profiles[0]?.baseUrl,
      "https://[redacted]:[redacted]@primary.example.com/v1?api_key=[redacted]&tenant=demo",
    );
    assert.deepEqual(diagnostics.profiles[0]?.requestBodyKeys, ["temperature"]);
    assert.match(diagnostics.profiles[1]?.issues[0]?.message ?? "", /SECONDARY_API_KEY/);
    assert.match(diagnostics.profiles[1]?.issues[1]?.message ?? "", /tool-call support/);
    const serialized = JSON.stringify(diagnostics);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(serialized.includes("abcdefghijklmnopqrstuvwxyz123456"), false);
  } finally {
    if (originalPrimaryKey === undefined) {
      delete process.env.PRIMARY_API_KEY;
    } else {
      process.env.PRIMARY_API_KEY = originalPrimaryKey;
    }
    if (originalSecondaryKey === undefined) {
      delete process.env.SECONDARY_API_KEY;
    } else {
      process.env.SECONDARY_API_KEY = originalSecondaryKey;
    }
  }
});

function createTurnInput(
  role: "primary" | "planner" | "reviewer" | "researcher" | "supervisor" | "executor" = "primary",
): ModelTurnInput {
  return {
    context: {
      taskContract: {
        objective: "Inspect the file",
        agentRole: role,
        workspaceId: "workspace",
        threadId: "thread",
        cwd: "E:/repo",
        successCriteria: ["Understand the file"],
        constraints: ["Prefer minimal reads"],
        verificationMode: "required",
        preferredExecutionDomain: "workspace",
      },
      workspaceSnapshot: {
        cwd: "E:/repo",
        repoRoot: "E:/repo",
        repoName: "repo",
        branch: "main",
        dirty: false,
        isGitRepo: true,
        gitStatusLines: [],
        changedFiles: [],
        detectedFiles: ["package.json"],
        packageManager: "npm",
        packageScripts: ["build"],
      },
      threadSummary: "No prior thread history.",
      repoSummary: "repo summary",
      systemPrompt: "system prompt",
      promptSections: ["system prompt"],
    },
    taskContract: {
      objective: "Inspect the file",
      agentRole: role,
      workspaceId: "workspace",
      threadId: "thread",
      cwd: "E:/repo",
      successCriteria: ["Understand the file"],
      constraints: ["Prefer minimal reads"],
      verificationMode: "required",
      preferredExecutionDomain: "workspace",
    },
    availableTools: [
      {
        name: "read_file",
        description: "Read a file",
        inputHint: "{ path: string, startLine?: number, endLine?: number }",
        riskHint: "read-only",
      },
    ],
    toolResults: [],
  };
}

function createGenesisTurnInput(objective: string, toolResults: ModelTurnInput["toolResults"] = []): ModelTurnInput {
  const input = createTurnInput();
  const taskContract = {
    ...input.taskContract,
    objective,
  };
  return {
    ...input,
    context: {
      ...input.context,
      taskContract,
    },
    taskContract,
    availableTools: [
      { name: "htx_market_data", description: "Read HTX market data", inputHint: "{}", riskHint: "read-only" },
      { name: "htx_order_preview", description: "Preview HTX order", inputHint: "{}", riskHint: "preview-only" },
      { name: "htx_paper_order", description: "Record paper order", inputHint: "{}", riskHint: "paper-only" },
      { name: "web3_tron_account_snapshot", description: "Read TRON account", inputHint: "{}", riskHint: "read-only" },
      { name: "bai_chat_completion", description: "Call B.AI chat completion", inputHint: "{}", riskHint: "model-call" },
    ],
    toolResults,
  };
}

function createStreamingResponse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );
}
