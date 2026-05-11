import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

test("local channel webhook fixture completes send and status roundtrip", async () => {
  const deliveries: Array<{ id: string; body: unknown }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      if (request.method === "POST" && request.url === "/send") {
        const id = `delivery-${deliveries.length + 1}`;
        deliveries.push({ id, body });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, id, status: "queued" }));
        return;
      }
      if (request.method === "GET" && request.url?.startsWith("/status/")) {
        const id = decodeURIComponent(request.url.slice("/status/".length));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, id, status: deliveries.some((entry) => entry.id === id) ? "delivered" : "missing" }));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false }));
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address && "port" in address);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const sendResponse = await fetch(`${baseUrl}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "sandbox", text: "hello" }),
    });
    assert.equal(sendResponse.ok, true);
    const send = await sendResponse.json() as { id?: string; status?: string };
    assert.equal(send.status, "queued");
    assert.match(send.id ?? "", /^delivery-/);

    const statusResponse = await fetch(`${baseUrl}/status/${encodeURIComponent(send.id ?? "")}`);
    assert.equal(statusResponse.ok, true);
    const status = await statusResponse.json() as { status?: string };
    assert.equal(status.status, "delivered");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

if (process.env.OMNI_LIVE_CHANNEL_TESTS !== "1") {
  test("live channel tests are opt-in", { skip: "Set OMNI_LIVE_CHANNEL_TESTS=1 to run live channel checks." }, () => {});
} else {
  test("live channel matrix has required credentials", () => {
    assertRequiredEnv([
      "OMNI_LIVE_SLACK_BOT_TOKEN",
      "OMNI_LIVE_SLACK_CHANNEL_ID",
      "OMNI_LIVE_TELEGRAM_BOT_TOKEN",
      "OMNI_LIVE_TELEGRAM_CHAT_ID",
      "OMNI_LIVE_FEISHU_TENANT_ACCESS_TOKEN",
      "OMNI_LIVE_FEISHU_RECEIVE_ID",
    ]);
  });
}

function assertRequiredEnv(names: readonly string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim());
  assert.deepEqual(missing, []);
}
