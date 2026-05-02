import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type SourceId = "claudecode" | "hermes" | "openclaw";

interface SourceRoot {
  readonly source: SourceId;
  readonly root: string;
}

interface ManifestEntry {
  readonly source: SourceId;
  readonly projectRoot: string;
  readonly relativePath: string;
  readonly generatedPath: string;
  readonly kind: "binary" | "text";
  readonly lineCount: number;
  readonly byteLength: number;
  readonly sha256: string;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = resolve(projectRoot, "vendor", "reference");
const outputRoot = resolve(projectRoot, "packages", "reference-translated", "generated");
const excludedDirectories = [
  ".git",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "release",
  "target",
  "win-unpacked",
];
const excludedDirectorySet = new Set(excludedDirectories);
const sourceRoots: readonly SourceRoot[] = [
  { source: "hermes", root: resolve(referenceRoot, "hermes-agent-main") },
  { source: "openclaw", root: resolve(referenceRoot, "openclaw-main") },
  { source: "claudecode", root: resolve(referenceRoot, "claudecode-source") },
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const entries: ManifestEntry[] = [];
for (const sourceRoot of sourceRoots) {
  const files = await walkFiles(sourceRoot.root);
  for (const absolutePath of files) {
    const content = await readFile(absolutePath);
    const relativePath = normalizePath(relative(sourceRoot.root, absolutePath));
    const sha256 = createHash("sha256").update(content).digest("hex");
    const kind = isProbablyText(content) ? "text" : "binary";
    const safeName = buildGeneratedFileName(relativePath, sha256);
    const generatedPath = normalizePath(join(sourceRoot.source, safeName));
    const generatedAbsolutePath = resolve(outputRoot, generatedPath);
    await mkdir(dirname(generatedAbsolutePath), { recursive: true });
    const lineCount = kind === "text" ? countLines(content) : 0;
    await writeFile(
      generatedAbsolutePath,
      kind === "text"
        ? buildTextModule({ sourceRoot, relativePath, content, sha256, lineCount })
        : buildBinaryModule({ sourceRoot, relativePath, content, sha256 }),
      "utf8",
    );
    entries.push({
      source: sourceRoot.source,
      projectRoot: normalizePath(relative(projectRoot, sourceRoot.root)),
      relativePath,
      generatedPath,
      kind,
      lineCount,
      byteLength: content.byteLength,
      sha256,
    });
  }
}

entries.sort((left, right) => `${left.source}:${left.relativePath}`.localeCompare(`${right.source}:${right.relativePath}`));
const manifest = {
  generatedAt: new Date().toISOString(),
  generator: "scripts/translate-reference-source-lines.ts",
  excludedDirectories,
  summary: {
    fileCount: entries.length,
    textFileCount: entries.filter((entry) => entry.kind === "text").length,
    binaryFileCount: entries.filter((entry) => entry.kind === "binary").length,
    lineCount: entries.reduce((sum, entry) => sum + entry.lineCount, 0),
    byteLength: entries.reduce((sum, entry) => sum + entry.byteLength, 0),
    bySource: buildSourceSummary(entries),
  },
  files: entries,
};
await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(
  `Translated ${manifest.summary.fileCount} reference file(s), ${manifest.summary.lineCount} text line(s), ${manifest.summary.byteLength} byte(s) into ${outputRoot}`,
);

async function walkFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(current: string): Promise<void> {
    const currentStat = await stat(current);
    if (currentStat.isDirectory()) {
      if (excludedDirectorySet.has(basename(current))) {
        return;
      }
      const children = await readdir(current);
      await Promise.all(children.map((child) => visit(join(current, child))));
      return;
    }
    if (currentStat.isFile()) {
      output.push(current);
    }
  }
  await visit(root);
  return output.sort((left, right) => left.localeCompare(right));
}

function buildTextModule(input: {
  readonly sourceRoot: SourceRoot;
  readonly relativePath: string;
  readonly content: Buffer;
  readonly sha256: string;
  readonly lineCount: number;
}): string {
  const text = input.content.toString("utf8");
  const lines = splitLines(text);
  return [
    "// Generated literal TypeScript translation. Do not edit by hand.",
    `export const source = ${JSON.stringify(input.sourceRoot.source)} as const;`,
    `export const relativePath = ${JSON.stringify(input.relativePath)} as const;`,
    `export const kind = "text" as const;`,
    `export const byteLength = ${input.content.byteLength} as const;`,
    `export const lineCount = ${input.lineCount} as const;`,
    `export const sha256 = ${JSON.stringify(input.sha256)} as const;`,
    "export const lines = ",
    `${JSON.stringify(lines, null, 2)} as const;`,
    "export const translatedFile = { source, relativePath, kind, byteLength, lineCount, sha256, lines } as const;",
    "",
  ].join("\n");
}

function buildBinaryModule(input: {
  readonly sourceRoot: SourceRoot;
  readonly relativePath: string;
  readonly content: Buffer;
  readonly sha256: string;
}): string {
  return [
    "// Generated binary TypeScript translation. Do not edit by hand.",
    `export const source = ${JSON.stringify(input.sourceRoot.source)} as const;`,
    `export const relativePath = ${JSON.stringify(input.relativePath)} as const;`,
    `export const kind = "binary" as const;`,
    `export const byteLength = ${input.content.byteLength} as const;`,
    `export const lineCount = 0 as const;`,
    `export const sha256 = ${JSON.stringify(input.sha256)} as const;`,
    `export const base64 = ${JSON.stringify(input.content.toString("base64"))} as const;`,
    "export const translatedFile = { source, relativePath, kind, byteLength, lineCount, sha256, base64 } as const;",
    "",
  ].join("\n");
}

function isProbablyText(content: Buffer): boolean {
  if (content.length === 0) {
    return true;
  }
  const sample = content.subarray(0, Math.min(content.length, 8192));
  if (sample.includes(0)) {
    return false;
  }
  const replacementText = sample.toString("utf8");
  const replacementCount = [...replacementText].filter((char) => char === "\uFFFD").length;
  return replacementCount / Math.max(1, replacementText.length) < 0.01;
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const withoutTrailingTerminator = text.replace(/(?:\r\n|\n|\r)$/, "");
  return withoutTrailingTerminator.length === 0 ? [""] : withoutTrailingTerminator.split(/\r\n|\n|\r/);
}

function countLines(content: Buffer): number {
  return splitLines(content.toString("utf8")).length;
}

function buildGeneratedFileName(path: string, sha256: string): string {
  const safeBase = path
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .slice(-4)
    .join("__")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 160);
  return `${sha256.slice(0, 16)}__${safeBase || "root"}.ts`;
}

function buildSourceSummary(entries: readonly ManifestEntry[]): Record<string, { readonly fileCount: number; readonly lineCount: number; readonly byteLength: number }> {
  const summary: Record<string, { fileCount: number; lineCount: number; byteLength: number }> = {};
  for (const entry of entries) {
    const current = summary[entry.source] ?? { fileCount: 0, lineCount: 0, byteLength: 0 };
    current.fileCount += 1;
    current.lineCount += entry.lineCount;
    current.byteLength += entry.byteLength;
    summary[entry.source] = current;
  }
  return summary;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
