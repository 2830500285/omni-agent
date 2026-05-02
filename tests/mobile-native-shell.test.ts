import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const appDir = join(process.cwd(), "apps", "mobile-native");

test("mobile native shell exposes installable PWA assets and mobile-node protocol calls", () => {
  const manifestPath = join(appDir, "manifest.webmanifest");
  const indexPath = join(appDir, "index.html");
  const appPath = join(appDir, "src", "app.js");
  const serviceWorkerPath = join(appDir, "sw.js");

  assert.equal(existsSync(manifestPath), true);
  assert.equal(existsSync(indexPath), true);
  assert.equal(existsSync(appPath), true);
  assert.equal(existsSync(serviceWorkerPath), true);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  assert.equal(manifest.name, "Omni Agent Mobile Node");
  assert.equal(manifest.display, "standalone");

  const index = readFileSync(indexPath, "utf8");
  assert.match(index, /manifest\.webmanifest/);
  assert.match(index, /src\/app\.js/);

  const app = readFileSync(appPath, "utf8");
  assert.match(app, /\/mobile-node\/register/);
  assert.match(app, /\/mobile-node\/\$\{encodeURIComponent\(settings\.deviceId\)\}\/events/);
  assert.match(app, /authorization: `Bearer \$\{settings\.secret\}`/);
});
