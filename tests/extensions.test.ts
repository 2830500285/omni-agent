import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildMcpGovernanceReport,
  createExtensionRuntimeTools,
  inspectExtensionPackageContracts,
  loadExtensionRegistry,
  mergeMcpServerManifest,
  McpRuntimePool,
  mergeExtensionRegistries,
  validateExtensionPackageJson,
  validateMcpServerManifest,
} from "../packages/extensions/src/index.ts";
import { ToolRegistry } from "../packages/tools/src/index.ts";
import { LocalWorkspaceService } from "../packages/workspace/src/index.ts";

test("extension registry loads command-backed tools from local manifests", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-plugin-workspace-"));

  try {
    writeFileSync(
      join(pluginRoot, "node-version.json"),
      JSON.stringify(
        {
          id: "node-version",
          name: "Node Version",
          capability: "tool",
          description: "Expose node --version as a tool.",
          tools: [
            {
              name: "node_version",
              description: "Print Node.js version.",
              inputHint: "{}",
              riskHint: "read-only",
              command: "node --version",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });

    const descriptors = registry.list();
    assert.equal(descriptors.some((entry) => entry.id === "mcp-placeholder"), false);
    const loaded = descriptors.find((entry) => entry.id === "node-version");
    assert.ok(loaded);
    assert.deepEqual(loaded?.toolNames, ["node_version"]);
    assert.equal(loaded?.promptHookCount, 0);

    const tools = new ToolRegistry();
    tools.registerMany(registry.listToolDefinitions());

    const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));
    const result = await tools.execute(
      "node_version",
      {
        workspace,
        executionDomain: "workspace",
      },
      {},
    );

    assert.equal(result.ok, true);
    assert.match(String((result.data as { stdout?: string }).stdout ?? ""), /^v\d+\./);
  } finally {
    await removeTempDir(pluginRoot);
    await removeTempDir(workspaceRoot);
  }
});

test("extension registry loads explicit tool policy metadata without silently widening access", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-policy-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-policy-workspace-"));

  try {
    writeFileSync(
      join(pluginRoot, "policy-extension.json"),
      JSON.stringify(
        {
          id: "policy-extension",
          name: "Policy Extension",
          capability: "tool",
          description: "Ship a governed extension tool.",
          tools: [
            {
              name: "governed_tool",
              description: "Run a governed extension command.",
              inputHint: "{}",
              riskHint: "read-only",
              command: "node --version",
            },
          ],
          toolPolicies: [
            {
              toolName: "governed_tool",
              allowInSubagents: true,
              allowedRoles: ["researcher"],
              allowedAuthorities: ["leaf"],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });
    const policy = registry.getToolPolicy("governed_tool");
    assert.ok(policy);
    assert.equal(policy?.extensionId, "policy-extension");
    assert.equal(policy?.allowInSubagents, true);
    assert.deepEqual(policy?.allowedRoles, ["researcher"]);
    assert.deepEqual(policy?.allowedAuthorities, ["leaf"]);
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("extension package contract validation reports plugin API compatibility metadata", async () => {
  const valid = validateExtensionPackageJson(
    {
      name: "@example/omni-plugin",
      version: "1.2.3",
      omniAgent: {
        compat: { pluginApi: "1.x" },
        build: { omniAgentVersion: "0.1.0" },
      },
    },
    "package.json",
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.pluginApi, "1.x");
  assert.equal(valid.pluginApiCompatible, true);
  assert.equal(valid.currentPluginApi, "1.0.0");
  assert.equal(valid.omniAgentVersion, "0.1.0");
  assert.deepEqual(valid.issues, []);

  const comparatorRange = validateExtensionPackageJson(
    {
      name: "@example/range-plugin",
      version: "1.2.3",
      omniAgent: {
        compat: { pluginApi: ">=1.0.0 <2.0.0" },
        build: { omniAgentVersion: "0.1.0" },
      },
    },
    "range/package.json",
  );
  assert.equal(comparatorRange.ok, true);
  assert.equal(comparatorRange.pluginApiCompatible, true);

  const incompatible = validateExtensionPackageJson(
    {
      name: "@example/future-plugin",
      version: "1.2.3",
      omniAgent: {
        compat: { pluginApi: "2.x" },
        build: { omniAgentVersion: "0.1.0" },
      },
    },
    "future/package.json",
  );
  assert.equal(incompatible.ok, false);
  assert.equal(incompatible.pluginApiCompatible, false);
  assert.ok(incompatible.issues.some((issue) => /does not include current plugin API 1\.0\.0/.test(issue.reason)));

  const invalidRange = validateExtensionPackageJson(
    {
      name: "@example/bad-range-plugin",
      version: "1.2.3",
      omniAgent: {
        compat: { pluginApi: "not-a-range" },
        build: { omniAgentVersion: "0.1.0" },
      },
    },
    "bad-range/package.json",
  );
  assert.equal(invalidRange.ok, false);
  assert.equal(invalidRange.pluginApiCompatible, null);
  assert.ok(invalidRange.issues.some((issue) => /Invalid omniAgent\.compat\.pluginApi range/.test(issue.reason)));

  const invalid = validateExtensionPackageJson({ name: "@example/legacy-plugin" }, "legacy/package.json");
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some((issue) => /pluginApi/i.test(issue.reason)));
  assert.ok(invalid.issues.some((issue) => /omniAgentVersion/i.test(issue.reason)));
});

test("extension package contract inspection scans plugin directories without blocking legacy manifests", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-package-contract-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-package-contract-workspace-"));

  try {
    writeFileSync(
      join(pluginRoot, "package.json"),
      JSON.stringify(
        {
          name: "@example/contract-plugin",
          version: "0.0.1",
          omniAgent: {
            compat: { pluginApi: "1.x" },
            build: { omniAgentVersion: "0.1.0" },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(
      join(pluginRoot, "contract-extension.json"),
      JSON.stringify(
        {
          id: "contract-extension",
          name: "Contract Extension",
          capability: "tool",
          description: "Loads alongside package contract metadata.",
          tools: [
            {
              name: "contract_tool",
              description: "Print Node.js version.",
              command: "node --version",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const reports = await inspectExtensionPackageContracts({ pluginDirs: [pluginRoot], cwd: workspaceRoot });
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.ok, true);
    assert.equal(reports[0]?.packageName, "@example/contract-plugin");

    const registry = await loadExtensionRegistry({ pluginDirs: [pluginRoot], cwd: workspaceRoot });
    try {
      assert.ok(registry.list().some((extension) => extension.id === "contract-extension"));
      const tools = new ToolRegistry();
      tools.registerMany(createExtensionRuntimeTools(registry));
      const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));
      const toolResult = await tools.execute(
        "extension_package_contract",
        {
          workspace,
          executionDomain: "workspace",
        },
        {},
      );
      assert.equal(toolResult.ok, true);
      assert.equal((toolResult.data as { issueCount?: number }).issueCount, 0);
      assert.equal(((toolResult.data as { reports?: unknown[] }).reports ?? []).length, 1);
    } finally {
      await registry.dispose();
    }
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("MCP governance merges layered server configs and flags unsafe remote or secret settings", () => {
  const merged = mergeMcpServerManifest(
    {
      transport: "http",
      url: "https://mcp.example.com/base",
      headers: { Authorization: "Bearer ${MCP_TOKEN}" },
      timeoutMs: 1000,
    },
    {
      transport: "http",
      url: "https://mcp.example.com/override",
      headers: { "x-client": "omni-agent" },
    },
  );
  assert.deepEqual(merged, {
    transport: "http",
    url: "https://mcp.example.com/override",
    headers: { Authorization: "Bearer ${MCP_TOKEN}", "x-client": "omni-agent" },
    timeoutMs: 1000,
  });

  const report = buildMcpGovernanceReport(
    [
      {
        source: "workspace",
        servers: {
          local: { transport: "stdio", command: "node", args: ["server.mjs"], env: { API_TOKEN: "inline-secret" } },
          remote: { transport: "sse", url: "http://mcp.example.com/sse" },
        },
      },
      {
        source: "user",
        servers: {
          remote: { transport: "sse", url: "https://mcp.example.com/sse", headers: { Authorization: "Bearer ${MCP_TOKEN}" } },
        },
      },
    ],
    { allowedRemoteHosts: ["mcp.example.com"] },
  );
  assert.equal(report.ok, true);
  assert.equal(report.serverCount, 2);
  assert.equal((report.mergedServers.remote as { url?: string }).url, "https://mcp.example.com/sse");
  assert.ok(report.issues.some((issue) => issue.serverId === "local" && /inline secret/i.test(issue.reason)));
  assert.deepEqual(validateMcpServerManifest("denied", { transport: "http", url: "https://bad.example/mcp" }, "test", {
    allowedRemoteHosts: ["mcp.example.com"],
  }).map((issue) => issue.severity), ["error", "warning"]);
});

test("MCP OAuth manifests report auth_required without connecting when token is missing", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-auth-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-auth-workspace-"));
  const tokenEnv = "OMNI_AGENT_TEST_MISSING_MCP_TOKEN";
  let server: ReturnType<typeof createServer> | null = null;
  let calls = 0;

  try {
    delete process.env[tokenEnv];
    server = createServer((_request, response) => {
      calls += 1;
      response.writeHead(500);
      response.end("should not connect");
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => {
        server!.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address for auth-required MCP test server.");
    }

    writeFileSync(
      join(pluginRoot, "auth-required-mcp.json"),
      JSON.stringify(
        {
          id: "auth-required-mcp",
          name: "Auth Required MCP",
          capability: "mcp",
          description: "Requires an OAuth token before connecting.",
          mcp: {
            transport: "http",
            url: `http://127.0.0.1:${address.port}/mcp`,
            auth: {
              type: "oauth",
              tokenEnv,
              scopes: ["tools.read"],
            },
            timeoutMs: 2_000,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const registry = await loadExtensionRegistry({ pluginDirs: [pluginRoot], cwd: workspaceRoot });
    try {
      const loaded = registry.list().find((entry) => entry.id === "auth-required-mcp");
      assert.equal(loaded?.capability, "mcp");
      assert.deepEqual(loaded?.toolNames, []);
      assert.equal(calls, 0);
      const health = registry.listMcpRuntimeHealth().find((entry) => entry.extensionId === "auth-required-mcp");
      assert.equal(health?.status, "auth_required");
      assert.match(health?.lastError ?? "", /auth_required/);
      assert.equal(health?.auth?.type, "oauth");
      assert.equal(health?.auth?.tokenEnv, tokenEnv);
      assert.equal(health?.auth?.configured, false);
      assert.equal(health?.auth?.token, undefined);
    } finally {
      await registry.dispose();
    }
  } finally {
    delete process.env[tokenEnv];
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("MCP OAuth diagnostics redact configured tokens and allowlists filter tools and resources", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-auth-allowlist-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-auth-allowlist-workspace-"));
  const tokenEnv = "OMNI_AGENT_TEST_CONFIGURED_MCP_TOKEN";
  const token = "test-oauth-token-secret";
  let server: ReturnType<typeof createServer> | null = null;

  try {
    process.env[tokenEnv] = token;
    server = createServer(async (request, response) => {
      assert.equal(request.headers.authorization, `Bearer ${token}`);
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown>; uri?: string };
      };
      const send = (payload: Record<string, unknown>) => {
        response.writeHead(200, {
          "Content-Type": "application/json",
          "MCP-Session-Id": "auth-allowlist-session",
        });
        response.end(JSON.stringify(payload));
      };

      switch (body.method) {
        case "initialize":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {}, resources: {} },
              serverInfo: { name: "auth-allowlist-mcp", version: "1.0.0" },
            },
          });
          return;
        case "tools/list":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                { name: "allowed_echo", description: "Allowed tool.", inputSchema: { type: "object" } },
                { name: "blocked_echo", description: "Blocked tool.", inputSchema: { type: "object" } },
              ],
            },
          });
          return;
        case "resources/list":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              resources: [
                { uri: "memory://allowed", name: "Allowed Guide", description: "Allowed resource.", mimeType: "text/plain" },
                { uri: "memory://blocked", name: "Blocked Guide", description: "Blocked resource.", mimeType: "text/plain" },
              ],
            },
          });
          return;
        case "tools/call":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: `Allowed saw: ${String(body.params?.arguments?.message ?? "")}` }],
              structuredContent: { echoed: body.params?.arguments?.message ?? "" },
              isError: false,
            },
          });
          return;
        case "resources/read":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              contents: [{ uri: body.params?.uri, mimeType: "text/plain", text: "Allowed resource content." }],
            },
          });
          return;
        case "prompts/list":
        case "notifications/initialized":
        case "shutdown":
        case "exit":
          send({ jsonrpc: "2.0", id: body.id, result: {} });
          return;
        default:
          send({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `Unknown method: ${String(body.method ?? "")}` } });
      }
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => {
        server!.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address for auth allowlist MCP test server.");
    }

    writeFileSync(
      join(pluginRoot, "auth-allowlist-mcp.json"),
      JSON.stringify(
        {
          id: "auth-allowlist-mcp",
          name: "Auth Allowlist MCP",
          capability: "mcp",
          description: "Requires OAuth and filters exposed MCP surfaces.",
          mcp: {
            transport: "http",
            url: `http://127.0.0.1:${address.port}/mcp`,
            auth: {
              type: "oauth",
              tokenEnv,
              scopes: ["tools.call"],
            },
            allowlist: {
              tools: ["allowed_echo"],
              resources: ["Allowed Guide"],
            },
            timeoutMs: 2_000,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const registry = await loadExtensionRegistry({ pluginDirs: [pluginRoot], cwd: workspaceRoot });
    try {
      const loaded = registry.list().find((entry) => entry.id === "auth-allowlist-mcp");
      assert.deepEqual(loaded?.toolNames, ["mcp__auth-allowlist-mcp__allowed_echo"]);
      assert.equal(loaded?.resourceCount, 1);
      assert.ok(registry.listResources().some((entry) => entry.id === "memory://allowed"));
      assert.ok(!registry.listResources().some((entry) => entry.id === "memory://blocked"));

      const health = registry.listMcpRuntimeHealth().find((entry) => entry.extensionId === "auth-allowlist-mcp");
      assert.equal(health?.auth?.configured, true);
      assert.equal(health?.auth?.token, "[REDACTED]");
      assert.equal(JSON.stringify(health).includes(token), false);

      const tools = new ToolRegistry();
      tools.registerMany(registry.listToolDefinitions());
      const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));
      const result = await tools.execute(
        "mcp__auth-allowlist-mcp__allowed_echo",
        { workspace, executionDomain: "workspace" },
        { message: "hello" },
      );
      assert.equal(result.ok, true);
      assert.match(result.summary, /Allowed saw: hello/);

      const resource = await registry.readResource("auth-allowlist-mcp", "memory://allowed");
      assert.equal(resource?.content, "Allowed resource content.");
    } finally {
      await registry.dispose();
    }
  } finally {
    delete process.env[tokenEnv];
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

async function removeTempDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code !== "EPERM" && code !== "EBUSY") {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

test("extension registry loads module-backed prompt hooks", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-module-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-module-workspace-"));

  try {
    writeFileSync(
      join(pluginRoot, "instructions.mjs"),
      [
        "export default {",
        "  id: 'instructions',",
        "  name: 'Instructions',",
        "  description: 'Provide extra prompt guidance.',",
        "  capability: 'prompt-hook',",
        "  resources: [",
        "    {",
        "      id: 'module-guide',",
        "      description: 'Module-backed guide.',",
        "      content: 'Always inspect the parser before editing.'",
        "    }",
        "  ],",
        "  promptTemplates: [",
        "    {",
        "      name: 'review_target',",
        "      description: 'Render a focused review prompt.',",
        "      arguments: [{ name: 'target', required: true }, { name: 'style', defaultValue: 'concise' }],",
        "      render: ({ target, style }) => `Review ${target} in a ${style} way.`",
        "    }",
        "  ],",
        "  promptHooks: [",
        "    ({ objective }) => `Prefer concise edits for: ${objective}`",
        "  ]",
        "};",
      ].join("\n"),
      "utf8",
    );

    const registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });

    const loaded = registry.list().find((entry) => entry.id === "instructions");
    assert.ok(loaded);
    assert.equal(loaded?.resourceCount, 1);
    assert.equal(loaded?.promptTemplateCount, 1);
    assert.equal(loaded?.promptHookCount, 1);

    const instructions = await registry.buildPromptInstructions({
      cwd: workspaceRoot,
      objective: "Refactor the parser",
      workspaceId: "workspace-1",
      threadId: "thread-1",
    });
    assert.equal(instructions.length, 1);
    assert.match(instructions[0] ?? "", /\[instructions\] Prefer concise edits/);

    const resources = registry.listResources();
    assert.ok(resources.some((entry) => entry.extensionId === "instructions" && entry.id === "module-guide"));
    const resource = await registry.readResource("instructions", "module-guide");
    assert.equal(resource?.content, "Always inspect the parser before editing.");

    const prompts = registry.listPromptTemplates();
    assert.ok(prompts.some((entry) => entry.extensionId === "instructions" && entry.name === "review_target"));
    const renderedPrompt = await registry.renderPromptTemplate("instructions", "review_target", {
      target: "src/parser.ts",
    });
    assert.equal(renderedPrompt?.content, "Review src/parser.ts in a concise way.");
  } finally {
    await removeTempDir(pluginRoot);
    await removeTempDir(workspaceRoot);
  }
});

test("extension registry loads module and manifest tool lifecycle hooks", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-tool-hooks-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-tool-hooks-workspace-"));

  try {
    writeFileSync(
      join(pluginRoot, "module-hooks.mjs"),
      [
        "export default {",
        "  id: 'module-hooks',",
        "  name: 'Module Hooks',",
        "  description: 'Audits tool lifecycle events.',",
        "  capability: 'tool',",
        "  toolHooks: {",
        "    pre: [({ toolName, status }) => `pre:${toolName}:${status}`],",
        "    post: [({ toolName, status, summary }) => `post:${toolName}:${status}:${summary}`],",
        "    stop: [({ toolName, status }) => ({ block: true, summary: `stop ignored for ${toolName}:${status}` })]",
        "  }",
        "};",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(pluginRoot, "manifest-hooks.json"),
      JSON.stringify(
        {
          id: "manifest-hooks",
          name: "Manifest Hooks",
          description: "Audits manifest-backed tool lifecycle events.",
          capability: "tool",
          toolHooks: {
            pre: [{ toolName: "audited_tool", message: "manifest {{phase}} {{toolName}} {{status}}" }],
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });

    const moduleDescriptor = registry.list().find((entry) => entry.id === "module-hooks");
    const manifestDescriptor = registry.list().find((entry) => entry.id === "manifest-hooks");
    assert.equal(moduleDescriptor?.toolHookCount, 3);
    assert.equal(manifestDescriptor?.toolHookCount, 1);

    const pre = await registry.runToolLifecycleHooks({
      cwd: workspaceRoot,
      workspaceId: "workspace-1",
      threadId: "thread-1",
      runId: "run-1",
      phase: "pre",
      toolName: "audited_tool",
      args: {},
      status: "started",
    });
    assert.deepEqual(pre.diagnostics.map((entry) => entry.message).sort(), [
      "manifest pre audited_tool started",
      "pre:audited_tool:started",
    ].sort());
    assert.equal(pre.blocked, null);

    const post = await registry.runToolLifecycleHooks({
      cwd: workspaceRoot,
      workspaceId: "workspace-1",
      threadId: "thread-1",
      runId: "run-1",
      phase: "post",
      toolName: "audited_tool",
      args: {},
      status: "ok",
      summary: "tool completed",
    });
    assert.deepEqual(post.diagnostics.map((entry) => entry.message), [
      "post:audited_tool:ok:tool completed",
    ]);

    const stop = await registry.runToolLifecycleHooks({
      cwd: workspaceRoot,
      workspaceId: "workspace-1",
      threadId: "thread-1",
      runId: "run-1",
      phase: "stop",
      toolName: "audited_tool",
      args: {},
      status: "blocked",
    });
    assert.equal(stop.blocked, null);
  } finally {
    await removeTempDir(pluginRoot);
    await removeTempDir(workspaceRoot);
  }
});

test("extension registry loads manifest-backed resources and prompt templates", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-resource-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-resource-workspace-"));

  try {
    writeFileSync(join(pluginRoot, "checklist.md"), "Run tests before applying large edits.\n", "utf8");
    writeFileSync(
      join(pluginRoot, "playbook.json"),
      JSON.stringify(
        {
          id: "playbook",
          name: "Playbook",
          capability: "mcp",
          description: "Ship reusable guidance assets.",
          resources: [
            {
              id: "inline-guide",
              description: "Inline guidance for planning.",
              content: "Always restate the verification plan.",
            },
            {
              id: "checklist",
              description: "Checklist loaded from disk.",
              filePath: "checklist.md",
              mimeType: "text/markdown; charset=utf-8",
            },
          ],
          prompts: [
            {
              name: "review_target",
              description: "Render a reusable review prompt.",
              arguments: [
                { name: "target", required: true },
                { name: "style", defaultValue: "structured" },
              ],
              template: "Review {{target}} using a {{style}} checklist.",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });

    const loaded = registry.list().find((entry) => entry.id === "playbook");
    assert.ok(loaded);
    assert.equal(loaded?.resourceCount, 2);
    assert.equal(loaded?.promptTemplateCount, 1);

    const inlineGuide = await registry.readResource("playbook", "inline-guide");
    assert.equal(inlineGuide?.content, "Always restate the verification plan.");
    const checklist = await registry.readResource("playbook", "checklist");
    assert.match(checklist?.content ?? "", /Run tests before applying large edits/);

    const renderedPrompt = await registry.renderPromptTemplate("playbook", "review_target", {
      target: "README.md",
    });
    assert.equal(renderedPrompt?.content, "Review README.md using a structured checklist.");

    const tools = new ToolRegistry();
    tools.registerMany(createExtensionRuntimeTools(registry));
    const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));

    const listedResources = await tools.execute(
      "list_extension_resources",
      {
        workspace,
        executionDomain: "workspace",
      },
      {},
    );
    assert.equal(listedResources.ok, true);
    assert.ok(Array.isArray(listedResources.data));

    const readResource = await tools.execute(
      "read_extension_resource",
      {
        workspace,
        executionDomain: "workspace",
      },
      {
        extensionId: "playbook",
        resourceId: "checklist",
      },
    );
    assert.equal(readResource.ok, true);
    assert.match(String((readResource.data as { content?: string }).content ?? ""), /Run tests before applying large edits/);

    const listedMcpResources = await tools.execute(
      "list_mcp_resources",
      {
        workspace,
        executionDomain: "workspace",
      },
      {
        server: "playbook",
      },
    );
    assert.equal(listedMcpResources.ok, true);
    const mcpResources = listedMcpResources.data as Array<{ server?: string; uri?: string }>;
    assert.ok(mcpResources.some((entry) => entry.server === "playbook" && entry.uri === "checklist"));

    const readMcpResource = await tools.execute(
      "read_mcp_resource",
      {
        workspace,
        executionDomain: "workspace",
      },
      {
        server: "playbook",
        uri: "inline-guide",
      },
    );
    assert.equal(readMcpResource.ok, true);
    const mcpResource = readMcpResource.data as { server?: string; uri?: string; content?: string };
    assert.equal(mcpResource.server, "playbook");
    assert.equal(mcpResource.uri, "inline-guide");
    assert.match(mcpResource.content ?? "", /Always restate the verification plan\./);
    assert.match(mcpResource.content ?? "", /^\[MCP resource: playbook inline-guide\]/);

    const renderedToolPrompt = await tools.execute(
      "render_extension_prompt",
      {
        workspace,
        executionDomain: "workspace",
      },
      {
        extensionId: "playbook",
        promptName: "review_target",
        args: {
          target: "src/main.ts",
          style: "careful",
        },
      },
    );
    assert.equal(renderedToolPrompt.ok, true);
    assert.equal(
      (renderedToolPrompt.data as { content?: string }).content,
      "Review src/main.ts using a careful checklist.",
    );
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("extension registry loads stdio bridge tools from local manifests", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-bridge-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-bridge-workspace-"));

  try {
    writeFileSync(
      join(pluginRoot, "echo-bridge.mjs"),
      [
        "const chunks = [];",
        "for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));",
        "const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
        "process.stdout.write(JSON.stringify({",
        "  ok: true,",
        "  summary: `bridge handled ${payload.toolName}` ,",
        "  data: { echo: payload.args.message, workspaceRoot: payload.context.workspaceRoot }",
        "}));",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(pluginRoot, "echo-bridge.json"),
      JSON.stringify(
        {
          id: "echo-bridge",
          name: "Echo Bridge",
          capability: "bridge",
          description: "Expose an external stdio bridge as a tool.",
          bridge: {
            transport: "stdio",
            command: "node",
            args: ["echo-bridge.mjs"],
            timeoutMs: 5_000,
          },
          tools: [
            {
              name: "bridge_echo",
              description: "Echo a payload through the bridge.",
              inputHint: "{ message: string }",
              riskHint: "read-only",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });

    const loaded = registry.list().find((entry) => entry.id === "echo-bridge");
    assert.ok(loaded);
    assert.equal(loaded?.capability, "bridge");
    assert.deepEqual(loaded?.toolNames, ["bridge_echo"]);

    const tools = new ToolRegistry();
    tools.registerMany(registry.listToolDefinitions());

    const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));
    const result = await tools.execute(
      "bridge_echo",
      {
        workspace,
        executionDomain: "workspace",
        workspaceId: "workspace-1",
        threadId: "thread-1",
        runId: "run-1",
      },
      { message: "hello bridge" },
    );

    assert.equal(result.ok, true);
    assert.equal((result.data as { echo?: string }).echo, "hello bridge");
    assert.equal((result.data as { workspaceRoot?: string }).workspaceRoot, workspaceRoot);
  } finally {
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("extension registry loads HTTP bridge tools from local manifests", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-http-bridge-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-http-bridge-workspace-"));
  const requests: Array<Record<string, unknown>> = [];
  let server: ReturnType<typeof createServer> | null = null;
  let bridgeUrl = "";

  try {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      const payload = JSON.stringify({
        ok: true,
        summary: "http bridge handled bridge_http_echo",
        data: {
          echo: "hello http bridge",
          accepted: true,
        },
      });
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload, "utf8"),
      });
      response.end(payload);
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => {
        server!.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address for HTTP bridge.");
    }
    bridgeUrl = `http://127.0.0.1:${address.port}/bridge`;

    writeFileSync(
      join(pluginRoot, "http-bridge.json"),
      JSON.stringify(
        {
          id: "http-bridge",
          name: "HTTP Bridge",
          capability: "bridge",
          description: "Expose an HTTP bridge as a tool.",
          bridge: {
            transport: "http",
            url: bridgeUrl,
            headers: {
              "x-bridge-name": "omni-test",
            },
            timeoutMs: 5_000,
          },
          tools: [
            {
              name: "bridge_http_echo",
              description: "Echo a payload through the HTTP bridge.",
              inputHint: "{ message: string }",
              riskHint: "read-only",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });

    const loaded = registry.list().find((entry) => entry.id === "http-bridge");
    assert.ok(loaded);
    assert.equal(loaded?.capability, "bridge");

    const tools = new ToolRegistry();
    tools.registerMany(registry.listToolDefinitions());

    const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));
    const result = await tools.execute(
      "bridge_http_echo",
      {
        workspace,
        executionDomain: "workspace",
        workspaceId: "workspace-1",
        threadId: "thread-1",
        runId: "run-1",
      },
      { message: "hello http bridge" },
    );

    assert.equal(result.ok, true);
    assert.equal((result.data as { accepted?: boolean }).accepted, true);
    assert.equal(requests.length, 1);
    assert.equal((requests[0]?.args as { message?: string } | undefined)?.message, "hello http bridge");
    assert.equal(
      (requests[0]?.context as { workspaceRoot?: string } | undefined)?.workspaceRoot,
      workspaceRoot,
    );
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    rmSync(pluginRoot, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("extension registry loads real MCP stdio tools, resources, and prompts", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-workspace-"));
  const statsPath = join(workspaceRoot, "mcp-stats.json");
  let registry: Awaited<ReturnType<typeof loadExtensionRegistry>> | null = null;

  try {
    writeFileSync(statsPath, JSON.stringify({ initialize: 0, shutdown: 0, exit: 0 }, null, 2), "utf8");
    writeFileSync(
      join(pluginRoot, "mcp-server.mjs"),
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "import readline from 'node:readline';",
        "const statsPath = process.env.MCP_STATS_PATH;",
        "const updateStats = (key) => {",
        "  if (!statsPath) return;",
        "  const stats = JSON.parse(readFileSync(statsPath, 'utf8'));",
        "  stats[key] = (stats[key] ?? 0) + 1;",
        "  writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf8');",
        "};",
        "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
        "const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');",
        "rl.on('line', (line) => {",
        "  const message = JSON.parse(line);",
        "  if (!message.method || message.method === 'notifications/initialized') return;",
        "  switch (message.method) {",
        "    case 'initialize':",
        "      updateStats('initialize');",
        "      send(message.id, { protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'fixture-mcp', version: '1.0.0' } });",
        "      break;",
        "    case 'shutdown':",
        "      updateStats('shutdown');",
        "      send(message.id, {});",
        "      break;",
        "    case 'exit':",
        "      updateStats('exit');",
        "      process.exit(0);",
        "      break;",
        "    case 'tools/list':",
        "      send(message.id, { tools: [{ name: 'mcp_echo', description: 'Echo through MCP.', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] });",
        "      break;",
        "    case 'tools/call':",
        "      send(message.id, { content: [{ type: 'text', text: 'MCP saw: ' + (message.params?.arguments?.message ?? '') }], structuredContent: { echoed: message.params?.arguments?.message ?? '' }, isError: false });",
        "      break;",
        "    case 'resources/list':",
        "      send(message.id, { resources: [",
        "        { uri: 'memory://guide', name: 'Guide', description: 'MCP guide.', mimeType: 'text/plain' },",
        "        { uri: 'memory://flaky', name: 'Flaky', description: 'MCP resource that fails once.', mimeType: 'text/plain' }",
        "      ] });",
        "      break;",
        "    case 'resources/read':",
        "      if (message.params?.uri === 'memory://flaky') {",
        "        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'flaky resource read failed' } }) + '\\n');",
        "        break;",
        "      }",
        "      send(message.id, { contents: [{ uri: 'memory://guide', mimeType: 'text/plain', text: 'Read the MCP guide first.' }] });",
        "      break;",
        "    case 'prompts/list':",
        "      send(message.id, { prompts: [{ name: 'mcp_review', description: 'Review prompt from MCP.', arguments: [{ name: 'target', required: true }] }] });",
        "      break;",
        "    case 'prompts/get':",
        "      send(message.id, { messages: [{ role: 'user', content: { type: 'text', text: 'Review ' + (message.params?.arguments?.target ?? 'unknown') + ' carefully.' } }] });",
        "      break;",
        "    default:",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unknown method: ' + message.method } }) + '\\n');",
        "  }",
        "});",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(pluginRoot, "fixture-mcp.json"),
      JSON.stringify(
        {
          id: "fixture-mcp",
          name: "Fixture MCP",
          capability: "mcp",
          description: "Load a real MCP server over stdio.",
          mcp: {
            transport: "stdio",
            command: "node",
            args: ["mcp-server.mjs"],
            env: {
              MCP_STATS_PATH: statsPath,
            },
            timeoutMs: 5_000,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });

    const loaded = registry.list().find((entry) => entry.id === "fixture-mcp");
    assert.ok(loaded);
    assert.equal(loaded?.capability, "mcp");
    assert.deepEqual(loaded?.toolNames, ["mcp__fixture-mcp__mcp_echo"]);
    assert.equal(loaded?.resourceCount, 2);
    assert.equal(loaded?.promptTemplateCount, 1);

    const resource = await registry.readResource("fixture-mcp", "memory://guide");
    assert.equal(resource?.content, "Read the MCP guide first.");

    const renderedPrompt = await registry.renderPromptTemplate("fixture-mcp", "mcp_review", {
      target: "src/runtime.ts",
    });
    assert.equal(renderedPrompt?.content, "[user] Review src/runtime.ts carefully.");
    assert.equal(renderedPrompt?.messages[0]?.text, "Review src/runtime.ts carefully.");

    const tools = new ToolRegistry();
    tools.registerMany(registry.listToolDefinitions());
    tools.registerMany(createExtensionRuntimeTools(registry));

    const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));
    const toolResult = await tools.execute(
      "mcp__fixture-mcp__mcp_echo",
      {
        workspace,
        executionDomain: "workspace",
      },
      { message: "hello mcp" },
    );
    assert.equal(toolResult.ok, true);
    assert.match(toolResult.summary, /MCP saw: hello mcp/);
    assert.equal(
      (toolResult.data as { structuredContent?: { echoed?: string } }).structuredContent?.echoed,
      "hello mcp",
    );
    const toolMcpDiagnostics = (toolResult.data as { mcp?: { server?: string; tool?: string; health?: { status?: string; lastDurationMs?: number } } }).mcp;
    assert.equal(toolMcpDiagnostics?.server, "fixture-mcp");
    assert.equal(toolMcpDiagnostics?.tool, "mcp_echo");
    assert.equal(toolMcpDiagnostics?.health?.status, "healthy");
    assert.equal(typeof toolMcpDiagnostics?.health?.lastDurationMs, "number");
    const health = registry.listMcpRuntimeHealth().find((entry) => entry.extensionId === "fixture-mcp");
    assert.ok(health);
    assert.equal(health?.status, "healthy");
    assert.equal(health?.transport, "stdio");
    assert.equal(health?.lastMethod, "tools/call");
    assert.equal(health?.failureCount, 0);
    assert.ok((health?.requestCount ?? 0) >= 6);

    const failedRead = await tools.execute(
      "read_mcp_resource",
      {
        workspace,
        executionDomain: "workspace",
      },
      {
        server: "fixture-mcp",
        uri: "memory://flaky",
      },
    );
    assert.equal(failedRead.ok, false);
    const failedReadData = failedRead.data as {
      diagnostics?: { stage?: string; error?: string };
      health?: { status?: string; consecutiveFailureCount?: number; lastError?: string };
    };
    assert.equal(failedReadData.diagnostics?.stage, "resources/read");
    assert.match(failedReadData.diagnostics?.error ?? "", /flaky resource read failed/);
    assert.equal(failedReadData.health?.status, "failed");
    assert.equal(failedReadData.health?.consecutiveFailureCount, 1);
    assert.match(failedReadData.health?.lastError ?? "", /flaky resource read failed/);

    const recoveredRead = await tools.execute(
      "read_mcp_resource",
      {
        workspace,
        executionDomain: "workspace",
      },
      {
        server: "fixture-mcp",
        uri: "memory://guide",
      },
    );
    assert.equal(recoveredRead.ok, true);
    const recoveredReadData = recoveredRead.data as {
      health?: { status?: string; recoveryCount?: number; consecutiveFailureCount?: number };
    };
    assert.equal(recoveredReadData.health?.status, "healthy");
    assert.equal(recoveredReadData.health?.consecutiveFailureCount, 0);
    assert.ok((recoveredReadData.health?.recoveryCount ?? 0) >= 1);

    const listedMcpResources = await tools.execute(
      "list_mcp_resources",
      {
        workspace,
        executionDomain: "workspace",
      },
      {
        server: "fixture-mcp",
      },
    );
    assert.equal(listedMcpResources.ok, true);
    const listedMcpResourceData = listedMcpResources.data as Array<{ uri?: string; health?: { status?: string; recoveryCount?: number } }>;
    const listedGuide = listedMcpResourceData.find((entry) => entry.uri === "memory://guide");
    assert.equal(listedGuide?.health?.status, "healthy");
    assert.ok((listedGuide?.health?.recoveryCount ?? 0) >= 1);

    const statsBeforeDispose = JSON.parse(readFileSync(statsPath, "utf8")) as Record<string, number>;
    assert.equal(statsBeforeDispose.initialize, 1);
    assert.equal(statsBeforeDispose.shutdown, 0);
    await registry.dispose();
    registry = null;
    const statsAfterDispose = JSON.parse(readFileSync(statsPath, "utf8")) as Record<string, number>;
    assert.equal(statsAfterDispose.initialize, 1);
    assert.equal(statsAfterDispose.shutdown, 1);
    assert.ok(statsAfterDispose.exit === 0 || statsAfterDispose.exit === 1);
  } finally {
    await registry?.dispose();
    await removeTempDir(pluginRoot);
    await removeTempDir(workspaceRoot);
  }
});

test("extension registry loads real MCP HTTP tools, resources, and prompts", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-http-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-http-workspace-"));
  let server: ReturnType<typeof createServer> | null = null;
  let serverUrl = "";
  const calls: string[] = [];
  const sessionIds: string[] = [];
  let registry: Awaited<ReturnType<typeof loadExtensionRegistry>> | null = null;

  try {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      if (typeof body.method === "string") {
        calls.push(body.method);
      }
      const sessionIdHeader = request.headers["mcp-session-id"];
      if (typeof sessionIdHeader === "string" && sessionIdHeader.trim().length > 0) {
        sessionIds.push(sessionIdHeader.trim());
      }

      const send = (payload: Record<string, unknown>) => {
        const text = JSON.stringify(payload);
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(text, "utf8"),
          "MCP-Session-Id": "session-1",
        });
        response.end(text);
      };

      switch (body.method) {
        case "initialize":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {}, resources: {}, prompts: {} },
              serverInfo: { name: "fixture-http-mcp", version: "1.0.0" },
            },
          });
          return;
        case "notifications/initialized":
          send({ jsonrpc: "2.0", result: {} });
          return;
        case "tools/list":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "http_mcp_echo",
                  description: "Echo through HTTP MCP.",
                  inputSchema: { type: "object", properties: { message: { type: "string" } } },
                },
              ],
            },
          });
          return;
        case "tools/call":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: `HTTP MCP saw: ${String(body.params?.arguments?.message ?? "")}` }],
              structuredContent: { echoed: body.params?.arguments?.message ?? "" },
              isError: false,
            },
          });
          return;
        case "resources/list":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              resources: [
                {
                  uri: "memory://http-guide",
                  name: "HTTP Guide",
                  description: "HTTP MCP guide.",
                  mimeType: "text/plain",
                },
              ],
            },
          });
          return;
        case "resources/read":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              contents: [{ uri: "memory://http-guide", mimeType: "text/plain", text: "Read the HTTP MCP guide." }],
            },
          });
          return;
        case "prompts/list":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              prompts: [
                {
                  name: "http_mcp_prompt",
                  description: "Prompt from HTTP MCP.",
                  arguments: [{ name: "target", required: true }],
                },
              ],
            },
          });
          return;
        case "prompts/get":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              messages: [
                {
                  role: "user",
                  content: { type: "text", text: `Check ${String(body.params?.arguments?.target ?? "")} over HTTP MCP.` },
                },
              ],
            },
          });
          return;
        case "shutdown":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {},
          });
          return;
        case "exit":
          send({
            jsonrpc: "2.0",
            result: {},
          });
          return;
        default:
          send({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: `Unknown method: ${String(body.method ?? "")}` },
          });
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server?.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address for HTTP MCP test server.");
    }
    serverUrl = `http://127.0.0.1:${address.port}/mcp`;

    writeFileSync(
      join(pluginRoot, "fixture-http-mcp.json"),
      JSON.stringify(
        {
          id: "fixture-http-mcp",
          name: "Fixture HTTP MCP",
          capability: "mcp",
          description: "Load a real MCP server over HTTP.",
          mcp: {
            transport: "http",
            url: serverUrl,
            timeoutMs: 5_000,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });

    const loaded = registry.list().find((entry) => entry.id === "fixture-http-mcp");
    assert.ok(loaded);
    assert.deepEqual(loaded?.toolNames, ["mcp__fixture-http-mcp__http_mcp_echo"]);
    assert.equal(loaded?.resourceCount, 1);
    assert.equal(loaded?.promptTemplateCount, 1);

    const resource = await registry.readResource("fixture-http-mcp", "memory://http-guide");
    assert.equal(resource?.content, "Read the HTTP MCP guide.");

    const renderedPrompt = await registry.renderPromptTemplate("fixture-http-mcp", "http_mcp_prompt", {
      target: "src/gateway.ts",
    });
    assert.equal(renderedPrompt?.content, "[user] Check src/gateway.ts over HTTP MCP.");

    const tools = new ToolRegistry();
    tools.registerMany(registry.listToolDefinitions());
    const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));
    const toolResult = await tools.execute(
      "mcp__fixture-http-mcp__http_mcp_echo",
      {
        workspace,
        executionDomain: "workspace",
      },
      { message: "hello http mcp" },
    );
    assert.equal(toolResult.ok, true);
    assert.match(toolResult.summary, /HTTP MCP saw: hello http mcp/);
    assert.equal(calls.filter((entry) => entry === "initialize").length, 1);
    assert.ok(calls.includes("tools/list"));
    assert.ok(calls.includes("tools/call"));
    assert.deepEqual(Array.from(new Set(sessionIds)), ["session-1"]);
    const health = registry.listMcpRuntimeHealth().find((entry) => entry.extensionId === "fixture-http-mcp");
    assert.ok(health);
    assert.equal(health?.status, "healthy");
    assert.equal(health?.transport, "http");
    assert.equal(health?.lastMethod, "tools/call");
    assert.equal(health?.failureCount, 0);
    assert.ok((health?.requestCount ?? 0) >= 6);
    await registry.dispose();
    registry = null;
    assert.ok(calls.includes("shutdown"));
    assert.ok(calls.includes("exit") || calls.includes("shutdown"));
  } finally {
    await registry?.dispose();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    await removeTempDir(pluginRoot);
    await removeTempDir(workspaceRoot);
  }
});

test("extension registry accepts MCP SSE transport and parses event-stream responses", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-sse-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-sse-workspace-"));
  let server: ReturnType<typeof createServer> | null = null;
  let serverUrl = "";
  let registry: Awaited<ReturnType<typeof loadExtensionRegistry>> | null = null;

  try {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
      };
      const send = (payload: Record<string, unknown>) => {
        const text = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Content-Length": Buffer.byteLength(text, "utf8"),
          "MCP-Session-Id": "sse-session-1",
        });
        response.end(text);
      };

      switch (body.method) {
        case "initialize":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              protocolVersion: "2025-06-18",
              capabilities: { tools: {} },
              serverInfo: { name: "fixture-sse-mcp", version: "1.0.0" },
            },
          });
          return;
        case "tools/list":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              tools: [
                {
                  name: "sse_echo",
                  description: "Echo through SSE MCP.",
                  inputSchema: { type: "object", properties: { message: { type: "string" } } },
                },
              ],
            },
          });
          return;
        case "tools/call":
          send({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [{ type: "text", text: `SSE MCP saw: ${String(body.params?.arguments?.message ?? "")}` }],
              structuredContent: { echoed: body.params?.arguments?.message ?? "" },
              isError: false,
            },
          });
          return;
        case "resources/list":
        case "prompts/list":
        case "notifications/initialized":
        case "shutdown":
        case "exit":
          send({ jsonrpc: "2.0", id: body.id, result: {} });
          return;
        default:
          send({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `Unknown method: ${String(body.method ?? "")}` } });
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server?.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP address for SSE MCP test server.");
    }
    serverUrl = `http://127.0.0.1:${address.port}/mcp`;

    writeFileSync(
      join(pluginRoot, "fixture-sse-mcp.json"),
      JSON.stringify(
        {
          id: "fixture-sse-mcp",
          name: "Fixture SSE MCP",
          capability: "mcp",
          description: "Load a real MCP server over SSE.",
          mcp: {
            transport: "sse",
            url: serverUrl,
            timeoutMs: 5_000,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    registry = await loadExtensionRegistry({ pluginDirs: [pluginRoot], cwd: workspaceRoot });
    assert.deepEqual(registry.list().find((entry) => entry.id === "fixture-sse-mcp")?.toolNames, [
      "mcp__fixture-sse-mcp__sse_echo",
    ]);

    const tools = new ToolRegistry();
    tools.registerMany(registry.listToolDefinitions());
    const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));
    const toolResult = await tools.execute(
      "mcp__fixture-sse-mcp__sse_echo",
      { workspace, executionDomain: "workspace" },
      { message: "hello sse mcp" },
    );
    assert.equal(toolResult.ok, true);
    assert.match(toolResult.summary, /SSE MCP saw: hello sse mcp/);
    const health = registry.listMcpRuntimeHealth().find((entry) => entry.extensionId === "fixture-sse-mcp");
    assert.equal(health?.transport, "sse");
    assert.equal(health?.status, "healthy");
  } finally {
    await registry?.dispose();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
    await removeTempDir(pluginRoot);
    await removeTempDir(workspaceRoot);
  }
});

test("extension registries can share an MCP runtime pool without duplicate initialization", async () => {
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-shared-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-mcp-shared-workspace-"));
  const statsPath = join(workspaceRoot, "mcp-shared-stats.json");
  const runtimePool = new McpRuntimePool();
  let parentRegistry: Awaited<ReturnType<typeof loadExtensionRegistry>> | null = null;
  let childRegistry: Awaited<ReturnType<typeof loadExtensionRegistry>> | null = null;

  try {
    writeFileSync(statsPath, JSON.stringify({ initialize: 0, shutdown: 0, exit: 0 }, null, 2), "utf8");
    writeFileSync(
      join(pluginRoot, "mcp-server.mjs"),
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "import readline from 'node:readline';",
        "const statsPath = process.env.MCP_STATS_PATH;",
        "const updateStats = (key) => {",
        "  if (!statsPath) return;",
        "  const stats = JSON.parse(readFileSync(statsPath, 'utf8'));",
        "  stats[key] = (stats[key] ?? 0) + 1;",
        "  writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf8');",
        "};",
        "const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });",
        "const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');",
        "rl.on('line', (line) => {",
        "  const message = JSON.parse(line);",
        "  if (!message.method || message.method === 'notifications/initialized') return;",
        "  switch (message.method) {",
        "    case 'initialize':",
        "      updateStats('initialize');",
        "      send(message.id, { protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'shared-fixture-mcp', version: '1.0.0' } });",
        "      break;",
        "    case 'shutdown':",
        "      updateStats('shutdown');",
        "      send(message.id, {});",
        "      break;",
        "    case 'exit':",
        "      updateStats('exit');",
        "      process.exit(0);",
        "      break;",
        "    case 'tools/list':",
        "      send(message.id, { tools: [{ name: 'shared_mcp_echo', description: 'Echo through shared MCP.', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] });",
        "      break;",
        "    case 'tools/call':",
        "      send(message.id, { content: [{ type: 'text', text: 'Shared MCP saw: ' + (message.params?.arguments?.message ?? '') }], structuredContent: { echoed: message.params?.arguments?.message ?? '' }, isError: false });",
        "      break;",
        "    case 'resources/list':",
        "      send(message.id, { resources: [{ uri: 'memory://shared-guide', name: 'Shared Guide', description: 'Shared MCP guide.', mimeType: 'text/plain' }] });",
        "      break;",
        "    case 'resources/read':",
        "      send(message.id, { contents: [{ uri: 'memory://shared-guide', mimeType: 'text/plain', text: 'Read the shared MCP guide.' }] });",
        "      break;",
        "    default:",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unknown method: ' + message.method } }) + '\\n');",
        "  }",
        "});",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(pluginRoot, "shared-fixture-mcp.json"),
      JSON.stringify(
        {
          id: "shared-fixture-mcp",
          name: "Shared Fixture MCP",
          capability: "mcp",
          description: "Shared MCP runtime pool fixture.",
          mcp: {
            transport: "stdio",
            command: "node",
            args: ["mcp-server.mjs"],
            env: {
              MCP_STATS_PATH: statsPath,
            },
            timeoutMs: 5_000,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    parentRegistry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
      mcpRuntimePool: runtimePool,
    });
    childRegistry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
      mcpRuntimePool: runtimePool,
    });

    const workspace = new LocalWorkspaceService(workspaceRoot, join(workspaceRoot, ".artifacts"));
    const parentTools = new ToolRegistry();
    parentTools.registerMany(parentRegistry.listToolDefinitions());
    parentTools.registerMany(createExtensionRuntimeTools(parentRegistry));
    const childTools = new ToolRegistry();
    childTools.registerMany(childRegistry.listToolDefinitions());
    childTools.registerMany(createExtensionRuntimeTools(childRegistry));

    const parentResult = await parentTools.execute(
      "mcp__shared-fixture-mcp__shared_mcp_echo",
      {
        workspace,
        executionDomain: "workspace",
      },
      { message: "hello from parent" },
    );
    assert.equal(parentResult.ok, true);

    const childRead = await childTools.execute(
      "read_mcp_resource",
      {
        workspace,
        executionDomain: "workspace",
      },
      {
        server: "shared-fixture-mcp",
        uri: "memory://shared-guide",
      },
    );
    assert.equal(childRead.ok, true);
    assert.match((childRead.data as { content?: string }).content ?? "", /Read the shared MCP guide\./);

    const statsBeforeDispose = JSON.parse(readFileSync(statsPath, "utf8")) as Record<string, number>;
    assert.equal(statsBeforeDispose.initialize, 1);
    assert.equal(statsBeforeDispose.shutdown, 0);

    await parentRegistry.dispose();
    await childRegistry.dispose();
    parentRegistry = null;
    childRegistry = null;

    const statsAfterRegistryDispose = JSON.parse(readFileSync(statsPath, "utf8")) as Record<string, number>;
    assert.equal(statsAfterRegistryDispose.initialize, 1);
    assert.equal(statsAfterRegistryDispose.shutdown, 0);

    await runtimePool.dispose();

    const statsAfterPoolDispose = JSON.parse(readFileSync(statsPath, "utf8")) as Record<string, number>;
    assert.equal(statsAfterPoolDispose.initialize, 1);
    assert.equal(statsAfterPoolDispose.shutdown, 1);
    assert.ok(statsAfterPoolDispose.exit === 0 || statsAfterPoolDispose.exit === 1);
  } finally {
    await parentRegistry?.dispose();
    await childRegistry?.dispose();
    await runtimePool.dispose();
    await removeTempDir(pluginRoot);
    await removeTempDir(workspaceRoot);
  }
});

test("extension registries can merge child overlays and dispose module hooks", async () => {
  const parentPluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-parent-plugin-"));
  const childPluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-child-plugin-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-extension-merge-workspace-"));
  const disposeMarkerPath = join(childPluginRoot, "disposed.txt");

  try {
    writeFileSync(
      join(parentPluginRoot, "parent-extension.mjs"),
      [
        "export default {",
        "  id: 'parent-extension',",
        "  name: 'Parent Extension',",
        "  description: 'Parent runtime tools.',",
        "  capability: 'tool',",
        "  tools: [",
        "    {",
        "      name: 'parent_tool',",
        "      description: 'Parent tool.',",
        "      inputHint: '{}',",
        "      riskHint: 'read-only',",
        "      async execute() {",
        "        return { ok: true, summary: 'parent tool ran' };",
        "      }",
        "    }",
        "  ]",
        "};",
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      join(childPluginRoot, "child-extension.mjs"),
      [
        "import { writeFileSync } from 'node:fs';",
        `const disposeMarkerPath = ${JSON.stringify(disposeMarkerPath)};`,
        "export default {",
        "  id: 'child-extension',",
        "  name: 'Child Extension',",
        "  description: 'Child runtime tools.',",
        "  capability: 'tool',",
        "  tools: [",
        "    {",
        "      name: 'child_tool',",
        "      description: 'Child tool.',",
        "      inputHint: '{}',",
        "      riskHint: 'read-only',",
        "      async execute() {",
        "        return { ok: true, summary: 'child tool ran' };",
        "      }",
        "    }",
        "  ],",
        "  dispose() {",
        "    writeFileSync(disposeMarkerPath, 'disposed', 'utf8');",
        "  }",
        "};",
      ].join("\n"),
      "utf8",
    );

    const parentRegistry = await loadExtensionRegistry({
      pluginDirs: [parentPluginRoot],
      cwd: workspaceRoot,
    });
    const childRegistry = await loadExtensionRegistry({
      pluginDirs: [childPluginRoot],
      cwd: workspaceRoot,
    });
    const mergedRegistry = mergeExtensionRegistries(parentRegistry, childRegistry);

    assert.ok(parentRegistry.list().some((entry) => entry.id === "parent-extension"));
    assert.ok(!parentRegistry.list().some((entry) => entry.id === "child-extension"));
    assert.ok(mergedRegistry.list().some((entry) => entry.id === "parent-extension"));
    assert.ok(mergedRegistry.list().some((entry) => entry.id === "child-extension"));
    assert.deepEqual(mergedRegistry.listPluginDirectories(), [childPluginRoot, parentPluginRoot].sort());

    await childRegistry.dispose();
    assert.equal(readFileSync(disposeMarkerPath, "utf8"), "disposed");
  } finally {
    await removeTempDir(parentPluginRoot);
    await removeTempDir(childPluginRoot);
    await removeTempDir(workspaceRoot);
  }
});

test("extension registry exposes module-backed context engines and memory providers", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "omni-agent-extension-capabilities-workspace-"));
  const pluginRoot = mkdtempSync(join(tmpdir(), "omni-agent-extension-capabilities-plugins-"));

  try {
    writeFileSync(
      join(pluginRoot, "capabilities.mjs"),
      [
        "export default {",
        "  id: 'capability-pack',",
        "  name: 'Capability Pack',",
        "  description: 'Registers extra context engines and memory providers.',",
        "  contextEngines: [",
        "    {",
        "      descriptor: {",
        "        id: 'focused-review',",
        "        label: 'Focused Review',",
        "        description: 'A narrow review-oriented context engine.',",
        "        ownsCompaction: true,",
        "        ownsBudgetPolicy: true,",
        "        supportsSubagentHooks: true,",
        "        defaultPromptBudgetTokens: 900,",
        "        defaultSubagentNoteLimit: 2,",
        "        defaultExtraInstructionLimit: 3,",
        "        statusSchema: ['engineId', 'maintenanceCycles']",
        "      },",
        "      create(input) {",
        "        const state = {",
        "          taskContract: input.taskContract,",
        "          workspaceSnapshot: input.workspaceSnapshot,",
        "          workspaceInstructions: input.workspaceInstructions ?? [],",
        "          taskState: input.taskState,",
        "          taskSceneSummary: 'Focused review scene',",
        "          threadSummary: 'Focused review thread',",
        "          repoSummary: 'Focused review repo',",
        "          systemPrompt: 'Focused review prompt',",
        "          promptSections: ['Focused review prompt']",
        "        };",
        "        return {",
        "          bootstrap() { return state; },",
        "          ingest() { return state; },",
        "          afterTurn() { return state; },",
        "          compact() { return state; },",
        "          maintain() { return state; },",
        "          prepareSubagentSpawn() { return ['focused-review-handoff']; },",
        "          onSubagentEnded() { return state; },",
        "          render() { return state; },",
        "          getState() { return {",
        "            taskContract: input.taskContract,",
        "            workspaceSnapshot: input.workspaceSnapshot,",
        "            threadMessages: input.threadMessages,",
        "            previousThreadSummary: input.previousThreadSummary ?? null,",
        "            workspaceInstructions: input.workspaceInstructions ?? [],",
        "            extraInstructions: input.extraInstructions ?? [],",
        "            subagentOutcomeNotes: [],",
        "            subagentOutcomeArchiveSummary: null,",
        "            phaseHistory: ['understanding'],",
        "            taskState: input.taskState ?? {",
        "              phase: 'understanding',",
        "              currentGoal: 'Focused review',",
        "              completedSubgoals: [],",
        "              pendingSubgoals: [],",
        "              recentFailureReason: null,",
        "              latestVerification: { status: 'not-run', summary: 'pending' }",
        "            },",
        "            engineStatus: {",
        "              engineId: 'focused-review',",
        "              maintenanceCycles: 0,",
        "              compactionCount: 0,",
        "              deferredCompaction: false,",
        "              estimatedPromptTokens: 10,",
        "              promptBudgetTokens: 900,",
        "              recentSubagentOutcomeCount: 0",
        "            }",
        "          }; },",
        "          getStatus() { return {",
        "            engineId: 'focused-review',",
        "            maintenanceCycles: 0,",
        "            compactionCount: 0,",
        "            deferredCompaction: false,",
        "            estimatedPromptTokens: 10,",
        "            promptBudgetTokens: 900,",
        "            recentSubagentOutcomeCount: 0",
        "          }; }",
        "        };",
        "      }",
        "    }",
        "  ],",
        "  memoryProviders: [",
        "    {",
        "      id: 'ephemeral-memory',",
        "      label: 'Ephemeral Memory',",
        "      description: 'A lightweight extension memory provider.',",
        "      create() {",
        "        return {",
        "          id: 'ephemeral-memory',",
        "          async onTurnStart() {",
        "            return { sessionMemories: [], workspaceMemories: [], profileFacts: [], learnedSkills: [], workspaceMemoryFiles: [], relatedSessions: [] };",
        "          }",
        "        };",
        "      }",
        "    }",
        "  ]",
        "};",
      ].join("\n"),
      "utf8",
    );

    const registry = await loadExtensionRegistry({
      pluginDirs: [pluginRoot],
      cwd: workspaceRoot,
    });
    try {
      assert.ok(registry.list().some((entry) => entry.id === "capability-pack"));
      assert.equal(registry.listContextEngines().at(0)?.id, "focused-review");
      assert.equal(registry.listContextEngines().at(0)?.extensionId, "capability-pack");
      assert.ok(registry.getContextEngineFactory("focused-review"));
      assert.equal(registry.listMemoryProviders().at(0)?.id, "ephemeral-memory");
      assert.equal(registry.listMemoryProviders().at(0)?.extensionId, "capability-pack");
      const providers = registry.createMemoryProviders(["ephemeral-memory"]);
      assert.equal(providers.length, 1);
      assert.equal(providers[0]?.id, "ephemeral-memory");
    } finally {
      await registry.dispose();
    }
  } finally {
    await removeTempDir(pluginRoot);
    await removeTempDir(workspaceRoot);
  }
});
