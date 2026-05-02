import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEvalProgramReadinessReport,
  normalizeEvalSuiteDefinition,
  type EvalSuiteDefinition,
} from "../packages/evals/src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requestedManifest = readOption("--manifest");
const suitePath = requestedManifest ? resolve(repoRoot, requestedManifest) : resolve(repoRoot, "examples/evals/suite.json");
const suiteDefinition = JSON.parse(readFileSync(suitePath, "utf8")) as EvalSuiteDefinition;
const suite = normalizeEvalSuiteDefinition(suiteDefinition, {
  baseDir: dirname(suitePath),
  defaultWorkspaceCwd: repoRoot,
});
const report = buildEvalProgramReadinessReport(suite);

console.log(
  JSON.stringify(
    {
      suite: suitePath,
      supportedDecision: suite.program?.supportedDecision ?? null,
      evalUnit: suite.program?.evalUnit ?? null,
      readiness: report,
    },
    null,
    2,
  ),
);

if (!report.ready) {
  process.exitCode = 1;
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1]?.trim() || undefined;
}
