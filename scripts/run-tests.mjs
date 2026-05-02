import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import process from "node:process";

const workspaceRoot = process.cwd();
const testsRoot = resolve(workspaceRoot, "tests");
const tsconfigPath = resolve(workspaceRoot, "tsconfig.base.json");

const requestedPaths = process.argv.slice(2)
  .map((entry) => resolve(workspaceRoot, entry));

const testFiles = requestedPaths.length > 0
  ? requestedPaths
  : collectTestFiles(testsRoot);

if (testFiles.length === 0) {
  console.error("No test files matched.");
  process.exit(1);
}

console.log(`Running ${testFiles.length} test file(s).`);

for (const testFile of testFiles) {
  console.log(`\n==> ${relative(workspaceRoot, testFile)}`);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", "--test-concurrency=1", testFile],
    {
      cwd: workspaceRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: tsconfigPath,
        TSX_DISABLE_CACHE: "1",
      },
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function collectTestFiles(root) {
  const files = [];
  visit(root, files);
  return files.sort((left, right) => left.localeCompare(right));
}

function visit(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
}
