import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  listNativeImplementationPlans,
  summarizeNativeImplementationCoverage,
  validateNativeParityClaims,
} from "@omni-agent/reference-native";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(root, "docs", "reference-native-implementation.generated.json");
const plans = listNativeImplementationPlans();
const report = {
  generatedAt: new Date().toISOString(),
  claim:
    "Reference capabilities are mapped to omni-agent native implementation surfaces; parityStatus distinguishes facade, contract-tested, live-tested, and product-equivalent claims.",
  coverage: summarizeNativeImplementationCoverage(plans),
  parityValidation: validateNativeParityClaims(plans, { strict: process.argv.includes("--strict") }),
  implementations: plans,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Wrote ${plans.length} native implementation plan(s) to ${outputPath}`);

if (!report.parityValidation.ok) {
  console.error(`Reference parity validation failed with ${report.parityValidation.issueCount} issue(s).`);
  process.exitCode = 1;
}
