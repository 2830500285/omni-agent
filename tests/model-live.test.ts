import assert from "node:assert/strict";
import test from "node:test";

if (process.env.OMNI_LIVE_MODEL_TESTS !== "1") {
  test("live model tests are opt-in", { skip: "Set OMNI_LIVE_MODEL_TESTS=1 to run live model checks." }, () => {});
} else {
  test("live model matrix has required provider credentials", () => {
    assertRequiredEnv(["OMNI_LIVE_MODEL_PROVIDER", "OMNI_LIVE_MODEL", "OMNI_LIVE_MODEL_API_KEY"]);
  });
}

function assertRequiredEnv(names: readonly string[]): void {
  const missing = names.filter((name) => !process.env[name]?.trim());
  assert.deepEqual(missing, []);
}
