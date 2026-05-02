import assert from "node:assert/strict";
import test from "node:test";

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
