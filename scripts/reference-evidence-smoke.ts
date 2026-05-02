import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

import { nativeReferenceAdapters, validateNativeParityClaims } from "@omni-agent/reference-native";
import { redactSensitiveValue } from "@omni-agent/safety";

type Source = "claudecode" | "hermes" | "openclaw";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = resolve(repoRoot, "vendor/reference");
const sourceRoots: Record<Source, string> = {
  claudecode: resolve(referenceRoot, "claudecode-source"),
  hermes: resolve(referenceRoot, "hermes-agent-main"),
  openclaw: resolve(referenceRoot, "openclaw-main"),
};
const failures: string[] = [];
const checks: string[] = [];
const python = resolvePythonCommand();

assertNativeAdapterSourcePaths();
assertReferenceParityClaims();
assertClaudeCodeEntrypoints();
compileHermesTools();
assertOpenClawPluginManifests();

const report = {
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  checkCount: checks.length,
  adapterCount: nativeReferenceAdapters.length,
  checks,
  failures,
};

console.log(JSON.stringify(redactSensitiveValue(report), null, 2));
if (failures.length > 0) {
  process.exit(1);
}

function assertNativeAdapterSourcePaths(): void {
  if (nativeReferenceAdapters.length < 100) {
    failures.push(`Expected at least 100 native reference adapters, saw ${nativeReferenceAdapters.length}.`);
  }
  for (const adapter of nativeReferenceAdapters) {
    if (!adapter.sourcePath) {
      failures.push(`${adapter.id} is missing sourcePath.`);
      continue;
    }
    if (!resolveReferencePath(adapter.source, adapter.id, adapter.sourcePath)) {
      failures.push(`${adapter.id} sourcePath does not exist in vendored reference projects: ${adapter.sourcePath}`);
    }
  }
  checks.push("all native adapter source paths resolve to vendored reference files or directories");
}

function assertReferenceParityClaims(): void {
  const validation = validateNativeParityClaims(undefined, { strict: true });
  if (!validation.ok) {
    failures.push(`Native parity validation failed with ${validation.issueCount} issue(s).`);
  }
  checks.push("native parity claims pass strict validation before evidence smoke");
}

function assertClaudeCodeEntrypoints(): void {
  for (const sourcePath of ["desktop-builder/main.mjs", "src/entrypoints/cli.tsx", "app/server.ts", "src/services/lsp"]) {
    const resolved = resolveReferencePath("claudecode", "claudecode:claude-code-main:evidence-smoke", sourcePath);
    if (!resolved) {
      failures.push(`ClaudeCode evidence path is missing: ${sourcePath}`);
      continue;
    }
    const stats = statSync(resolved);
    if (stats.isFile() && stats.size === 0) {
      failures.push(`ClaudeCode evidence file is empty: ${sourcePath}`);
    }
  }
  checks.push("ClaudeCode desktop, TUI, web, and LSP source paths exist");
}

function compileHermesTools(): void {
  const toolPaths = ["tools/browser_tool.py", "tools/delegate_tool.py", "tools/mcp_tool.py"];
  const absoluteToolPaths = toolPaths.map((toolPath) => resolve(sourceRoots.hermes, toolPath));
  for (const toolPath of absoluteToolPaths) {
    if (!existsSync(toolPath)) {
      failures.push(`Hermes tool is missing: ${formatReportPath(toolPath)}`);
    }
  }
  if (absoluteToolPaths.some((toolPath) => !existsSync(toolPath))) {
    return;
  }
  if (!python) {
    failures.push("No Python interpreter found for Hermes py_compile. Set PYTHON or install python3/python/py -3.");
    return;
  }
  const pycacheRoot = resolve(repoRoot, ".artifacts/python-cache");
  mkdirSync(pycacheRoot, { recursive: true });
  const result = spawnSync(python.command, [...python.args, "-m", "py_compile", ...absoluteToolPaths], {
    cwd: sourceRoots.hermes,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPYCACHEPREFIX: pycacheRoot,
    },
  });
  if (result.status !== 0) {
    failures.push(`Hermes py_compile failed: ${normalizeReportText((result.stderr || result.stdout || "").trim())}`);
  }
  checks.push("Hermes browser, delegate, and MCP tools pass Python syntax compilation");
}

function resolvePythonCommand(): { readonly command: string; readonly args: readonly string[] } | null {
  const candidates: Array<{ readonly command: string; readonly args: readonly string[] }> = [];
  if (process.env.PYTHON?.trim()) {
    candidates.push({ command: process.env.PYTHON.trim(), args: [] });
  }
  candidates.push({ command: "python3", args: [] });
  candidates.push({ command: "python", args: [] });
  if (process.platform === "win32") {
    candidates.push({ command: "py", args: ["-3"] });
  }
  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      return candidate;
    }
  }
  return null;
}

function assertOpenClawPluginManifests(): void {
  const manifests = findFiles(resolve(sourceRoots.openclaw, "extensions"), "openclaw.plugin.json", 12);
  if (manifests.length < 10) {
    failures.push(`Expected at least 10 OpenClaw plugin manifests, saw ${manifests.length}.`);
  }
  for (const manifestPath of manifests.slice(0, 12)) {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      id?: string;
      name?: string;
      capabilities?: unknown;
      channels?: unknown;
      configSchema?: unknown;
      routes?: unknown;
      tools?: unknown;
    };
    if (!parsed.id && !parsed.name) {
      failures.push(`OpenClaw plugin manifest lacks id/name: ${formatReportPath(manifestPath)}`);
    }
    if (!parsed.channels && !parsed.tools && !parsed.routes && !parsed.capabilities && !parsed.configSchema) {
      failures.push(`OpenClaw plugin manifest lacks channels/tools/routes/capabilities/configSchema: ${formatReportPath(manifestPath)}`);
    }
  }
  checks.push("OpenClaw plugin manifests parse and expose identity plus channel/tool/schema metadata");
}

function formatReportPath(absolutePath: string): string {
  return relative(repoRoot, absolutePath).replaceAll("\\", "/");
}

function normalizeReportText(value: string): string {
  let normalized = value;
  const roots = [...Object.values(sourceRoots), referenceRoot, repoRoot].sort((left, right) => right.length - left.length);
  for (const root of roots) {
    const replacement = formatReportPath(root) || ".";
    normalized = normalized.split(root).join(replacement);
    normalized = normalized.split(root.replaceAll("\\", "/")).join(replacement);
  }
  return normalized.replaceAll("\\", "/");
}

function resolveReferencePath(source: Source, id: string, sourcePath: string): string | null {
  const root = sourceRoots[source];
  const normalizedPath = sourcePath.replaceAll("\\", "/");
  const projectSegment = id.split(":")[1];
  const candidates = [
    resolve(root, normalizedPath),
    projectSegment ? resolve(root, projectSegment, normalizedPath) : null,
  ].filter((candidate): candidate is string => candidate !== null);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function findFiles(root: string, fileName: string, limit: number): string[] {
  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0 && results.length < limit) {
    const current = stack.pop();
    if (!current || !existsSync(current)) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
      } else if (entry.isFile() && entry.name === fileName) {
        results.push(absolutePath);
      }
      if (results.length >= limit) {
        break;
      }
    }
  }
  return results;
}
