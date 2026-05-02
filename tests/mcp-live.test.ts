import assert from "node:assert/strict";
import test from "node:test";

if (process.env.OMNI_LIVE_MCP_TESTS !== "1") {
  test("live MCP tests are opt-in", { skip: "Set OMNI_LIVE_MCP_TESTS=1 to run live MCP checks." }, () => {});
} else {
  test("live MCP matrix has required server configuration", () => {
    assertRequiredEnv(["OMNI_LIVE_MCP_SERVER_ID", "OMNI_LIVE_MCP_COMMAND"]);
  });
}

function assertRequiredEnv(names: readonly string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim());
  assert.deepEqual(missing, []);
}
