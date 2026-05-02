import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(root, "..");
const outfile = resolve(projectRoot, "dist", "omni-agent.js");

await mkdir(resolve(projectRoot, "dist"), { recursive: true });

await build({
  absWorkingDir: projectRoot,
  bundle: true,
  entryPoints: ["apps/cli/src/index.ts"],
  format: "esm",
  outfile,
  platform: "node",
  sourcemap: true,
  target: "node24",
  tsconfig: resolve(projectRoot, "tsconfig.base.json"),
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __omniCreateRequire } from "node:module";',
      "const require = __omniCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});

console.log(`Built ${outfile}`);
