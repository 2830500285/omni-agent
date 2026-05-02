import assert from "node:assert/strict";
import test from "node:test";

import { redactSensitiveText, redactSensitiveValue } from "../packages/safety/src/index.ts";

test("redacts common secret values in text", () => {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  const sample = (...parts: string[]): string => parts.join("");
  const text = [
    `api_key=${alpha}123456`,
    `token: ${sample("ghp_", alpha, "1234567890")}`,
    `aws ${sample("AKIA", "1234567890ABCDEF")}`,
    `Authorization: Bearer ${sample("eyJ", "aaaaaaaaaaaaaaaa.eyJbbbbbbbbbbbbbbbb.ccccccccccccccccccc")}`,
    `slack ${sample("xoxb-", "123456789012-", alpha)}`,
    `google ${sample("ya29.", alpha, "123456")}`,
    `npm ${sample("npm_", alpha, "123456")}`,
    `gitlab ${sample("glpat-", alpha, "123456")}`,
    `huggingface ${sample("hf_", alpha, "123456")}`,
    `github fine grained ${sample("github_", "pat_", alpha, "1234567890")}`,
    `github oauth ${sample("gho_", alpha, "1234567890")}`,
    `stripe ${sample("sk_", "live_", alpha, "123456")}`,
    `google api ${sample("AI", "za", alpha, "1234567890")}`,
    `signed https://files.example/download?X-Amz-Signature=${alpha}123456&AWSAccessKeyId=${sample("AKIA", "1234567890ABCDEF")}`,
    `oauth https://callback.example/?access_token=${alpha}123456&client_secret=${alpha}123456`,
  ].join("\n");

  const redacted = redactSensitiveText(text);

  assert.equal(redacted.includes("abcdefghijklmnopqrstuvwxyz123456"), false);
  assert.equal(redacted.includes(sample("ghp_", alpha, "1234567890")), false);
  assert.equal(redacted.includes(sample("AKIA", "1234567890ABCDEF")), false);
  assert.equal(redacted.includes(sample("Bearer ", "eyJ")), false);
  assert.equal(redacted.includes("xoxb-"), false);
  assert.equal(redacted.includes("ya29."), false);
  assert.equal(redacted.includes("npm_"), false);
  assert.equal(redacted.includes("glpat-"), false);
  assert.equal(redacted.includes("hf_"), false);
  assert.equal(redacted.includes(sample("github_", "pat_")), false);
  assert.equal(redacted.includes(sample("gho_")), false);
  assert.equal(redacted.includes(sample("sk_", "live_")), false);
  assert.equal(redacted.includes(sample("AI", "za")), false);
  assert.equal(redacted.includes("X-Amz-Signature=abcdefghijklmnopqrstuvwxyz123456"), false);
  assert.equal(redacted.includes("access_token=abcdefghijklmnopqrstuvwxyz123456"), false);
  assert.equal(redacted.includes("client_secret=abcdefghijklmnopqrstuvwxyz123456"), false);
  assert.match(redacted, /\[redacted\]/);
});

test("redacts sensitive keys and normalizes JSON-unsafe values", () => {
  const input: Record<string, unknown> = {
    token: "plain-token-value-that-should-not-survive",
    nested: {
      value: "password=abcdefghijklmnopqrstuvwxyz123456",
      count: 12n,
      skipped: undefined,
    },
    publicUrl: "https://docs.example/public",
    homepageUrl: "https://example.com",
    baseUrl: "https://provider.example/api",
    endpointUrl: "https://endpoint.example/push",
    homeserverUrl: "https://matrix.example",
    signedUrl: "https://files.example/private?signature=abcdefghijklmnopqrstuvwxyz123456",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
  };
  input.self = input;

  const redacted = redactSensitiveValue(input) as Record<string, unknown>;

  assert.equal(redacted.token, "[redacted]");
  assert.deepEqual(redacted.nested, {
    value: "[redacted]",
    count: "12n",
  });
  assert.equal(redacted.publicUrl, "https://docs.example/public");
  assert.equal(redacted.homepageUrl, "https://example.com");
  assert.equal(redacted.baseUrl, "[redacted]");
  assert.equal(redacted.endpointUrl, "[redacted]");
  assert.equal(redacted.homeserverUrl, "[redacted]");
  assert.equal(redacted.signedUrl, "[redacted]");
  assert.equal(redacted.createdAt, "2026-05-01T00:00:00.000Z");
  assert.equal(redacted.self, "[circular]");
});

test("serializes errors without leaking embedded secrets", () => {
  const token = ["ghp_", "abcdefghijklmnopqrstuvwxyz", "1234567890"].join("");
  const error = new Error("failed with api_key=abcdefghijklmnopqrstuvwxyz123456");
  error.stack = `stack token: ${token}`;

  const redacted = redactSensitiveValue(error) as Record<string, unknown>;

  assert.equal(redacted.name, "Error");
  assert.equal(redacted.message, "failed with [redacted]");
  assert.equal(redacted.stack, "stack token: [redacted]");
});
