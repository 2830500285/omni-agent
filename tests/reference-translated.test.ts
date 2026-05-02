import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { findTranslatedReferenceFile, loadTranslatedReferenceManifest } from "../packages/reference-translated/src/index.ts";

test("literal TypeScript translations cover every vendored reference source file", async () => {
  const manifest = await loadTranslatedReferenceManifest();

  assert.equal(manifest.summary.fileCount, manifest.files.length);
  assert.equal(manifest.summary.fileCount, 21642);
  assert.ok(manifest.summary.lineCount > 1_000_000);
  assert.ok(manifest.summary.byteLength > 400_000_000);
  assert.equal(manifest.summary.bySource.hermes.fileCount, 2531);
  assert.equal(manifest.summary.bySource.openclaw.fileCount, 16031);
  assert.equal(manifest.summary.bySource.claudecode.fileCount, 3080);

  const sample = await findTranslatedReferenceFile({ source: "hermes", relativePath: "run_agent.py" });
  assert.ok(sample);
  assert.equal(sample.kind, "text");
  assert.ok(existsSync(`packages/reference-translated/generated/${sample.generatedPath}`));

  const generated = readFileSync(`packages/reference-translated/generated/${sample.generatedPath}`, "utf8");
  assert.match(generated, /export const lines =/);
  assert.match(generated, /run_agent/);
});
