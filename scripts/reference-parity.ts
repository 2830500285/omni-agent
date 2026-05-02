import { listNativeImplementationPlans, summarizeNativeImplementationCoverage, validateNativeParityClaims } from "@omni-agent/reference-native";

const sourceArg = readOption("--source");
const strict = process.argv.includes("--strict");
const plans = listNativeImplementationPlans({
  source: sourceArg === "claudecode" || sourceArg === "hermes" || sourceArg === "openclaw" ? sourceArg : undefined,
});
const validation = validateNativeParityClaims(plans, { strict });

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: sourceArg ?? "all",
  coverage: summarizeNativeImplementationCoverage(plans),
  validation,
}, null, 2));

if (!validation.ok) {
  process.exitCode = 1;
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1]?.trim() || undefined;
}
