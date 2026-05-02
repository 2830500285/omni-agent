import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChannelPluginContractReport,
  createDefaultChannelPluginRegistry,
  listDefaultChannelPlugins,
  redactChannelPluginConfig,
  validateChannelPluginContract,
} from "../packages/gateway/src/channel-plugin.ts";
import type { ChannelRouteRecord, OutboundDeliveryRecord, RouteAdapterType } from "../packages/session-store/src/index.ts";

const lifecycleActions = ["install", "configure", "pair", "receive", "ack", "retry", "health", "shutdown"] as const;

test("default channel plugins expose the OpenClaw-style lifecycle contract", async () => {
  const plugins = listDefaultChannelPlugins();
  assert.deepEqual(
    plugins.map((plugin) => plugin.id).sort(),
    ["canvas", "dingtalk", "discord", "feishu", "filesystem", "matrix", "media", "mobile-node", "signal", "slack", "teams", "telegram", "voice", "whatsapp"],
  );

  for (const plugin of plugins) {
    const route = createRoute(plugin.id);
    const delivery = createDelivery(plugin.id);
    assert.equal(plugin.bindings.routeAdapterType, plugin.id);
    assert.ok(plugin.bindings.deliveryEvents.includes("route.delivery.dead_letter"));
    assert.ok(plugin.agentTools.includes(`channel_${plugin.id}_send`));
    assert.equal(plugin.security.defaultDmPolicy, "pairing");

    for (const action of lifecycleActions) {
      const result = await plugin.lifecycle[action]({
        route,
        delivery,
        inboundMessage: {
          channelMessageId: "message-1",
          sender: "operator",
          text: "status",
        },
      });
      assert.equal(result.ok, true);
      assert.equal(result.action, action);
      assert.match(result.summary, new RegExp(plugin.id));
    }

    const status = plugin.status.inspect(route);
    assert.equal(status.configured, false);
    assert.equal(status.authHealth, "missing");
    if (plugin.capabilities.inbound) {
      assert.ok(status.requiredSecrets.includes("inboundSecret"));
    }

    const sendResult = await plugin.lifecycle.send({
      route,
      delivery,
      content: "hello",
    });
    assert.equal(sendResult.ok, false);
    assert.match(sendResult.summary, /missing|requires/i);
  }
});

test("default channel plugins pass SDK contract validation and redact secrets", () => {
  const plugins = listDefaultChannelPlugins();
  const report = buildChannelPluginContractReport(plugins);
  assert.equal(report.ok, true);
  assert.equal(report.pluginCount, 14);
  assert.deepEqual(report.issues, []);

  const slack = plugins.find((plugin) => plugin.id === "slack");
  assert.ok(slack);
  assert.deepEqual(validateChannelPluginContract(slack), []);
  assert.deepEqual(
    redactChannelPluginConfig(slack, {
      webhookUrl: "https://hooks.slack.example/secret",
      botToken: "xoxb-secret",
      channelId: "C123",
      displayName: "triage",
    }),
    {
      webhookUrl: "[configured]",
      botToken: "[configured]",
      channelId: "C123",
      displayName: "triage",
    },
  );
});

test("default channel plugin registry normalizes ids", () => {
  const registry = createDefaultChannelPluginRegistry();
  assert.equal(registry.get(" SLACK ")?.id, "slack");
  assert.equal(registry.get("telegram")?.meta.providerGroup, "public");
  assert.equal(registry.get("unknown"), null);
  assert.deepEqual(
    registry.list().map((plugin) => plugin.id),
    ["canvas", "dingtalk", "discord", "feishu", "filesystem", "matrix", "media", "mobile-node", "signal", "slack", "teams", "telegram", "voice", "whatsapp"],
  );
});

function createRoute(adapterType: RouteAdapterType): ChannelRouteRecord {
  const now = "2026-04-29T00:00:00.000Z";
  return {
    id: `${adapterType}-route`,
    workspaceId: "workspace-1",
    agentId: "agent-1",
    threadId: "thread-1",
    title: `${adapterType} route`,
    channelType: adapterType,
    channelKey: `${adapterType}-channel`,
    adapterType,
    adapterConfig: {},
    inboundSecret: "secret-ref",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function createDelivery(adapterType: RouteAdapterType): OutboundDeliveryRecord {
  const now = "2026-04-29T00:00:00.000Z";
  return {
    id: `${adapterType}-delivery`,
    routeId: `${adapterType}-route`,
    workspaceId: "workspace-1",
    threadId: "thread-1",
    runId: "run-1",
    channelType: adapterType,
    channelKey: `${adapterType}-channel`,
    adapterType,
    payload: "hello",
    status: "queued",
    responseSummary: null,
    attemptCount: 0,
    lastAttemptAt: null,
    deliveredAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
