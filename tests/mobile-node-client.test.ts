import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createMobileNodeClient, parseMobileDeliveryEnvelope } from "../apps/mobile-node/src/index.ts";

test("mobile node client registers devices, sends events, and parses delivery envelopes", async () => {
  const requests: Array<{ method?: string; path?: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }> = [];
  const server = createServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
      requests.push({ method: request.method, path: request.url, headers: request.headers, body });
      response.writeHead(request.url === "/mobile-node/manifest" ? 200 : request.url === "/mobile-node/register" ? 201 : 202, {
        "content-type": "application/json",
      });
      if (request.url === "/mobile-node/manifest") {
        response.end(JSON.stringify({ protocol: "omni.mobile-node.v1" }));
        return;
      }
      if (request.url === "/mobile-node/register") {
        response.end(JSON.stringify({
          protocol: "omni.mobile-node.v1",
          route: { id: "route-1", channelType: "mobile-node", channelKey: body.deviceId, dmPolicy: "pairing" },
          inboundUrl: `/mobile-node/${body.deviceId}/events`,
        }));
        return;
      }
      response.end(JSON.stringify({ accepted: true }));
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const client = createMobileNodeClient({
      gatewayUrl: `http://127.0.0.1:${address.port}`,
      deviceId: "device-1",
      endpointUrl: "https://device.example/push",
      inboundSecret: "secret-1",
      gatewayToken: "gateway-token",
    });

    const manifest = await client.getManifest();
    assert.equal(manifest.protocol, "omni.mobile-node.v1");
    const registration = await client.register({ title: "Phone" });
    assert.equal(registration.route.channelKey, "device-1");
    await client.sendEvent({ text: "Battery is low", channelMessageId: "event-1", async: true });

    assert.equal(requests[0]?.headers.authorization, "Bearer gateway-token");
    assert.equal(requests[1]?.body.endpointUrl, "https://device.example/push");
    assert.equal(requests[2]?.path, "/mobile-node/device-1/events");
    assert.equal(requests[2]?.headers["x-omni-route-secret"], "secret-1");
    assert.equal(requests[2]?.body.sender, "device-1");

    const envelope = parseMobileDeliveryEnvelope({
      type: "omni.mobile.delivery.v1",
      deviceId: "device-1",
      route: { id: "route-1", title: "Phone", channelType: "mobile-node", channelKey: "device-1" },
      delivery: { id: "delivery-1", runId: null, createdAt: "2026-04-28T00:00:00.000Z" },
      notification: { title: "Phone", body: "Done" },
      content: "Done",
      metadata: { source: "test" },
    });
    assert.equal(envelope.notification.body, "Done");
    assert.equal(envelope.metadata.source, "test");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
