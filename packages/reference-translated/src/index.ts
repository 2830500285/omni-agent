import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TranslatedReferenceSource = "claudecode" | "hermes" | "openclaw";

export interface TranslatedReferenceFileEntry {
  readonly source: TranslatedReferenceSource;
  readonly projectRoot: string;
  readonly relativePath: string;
  readonly generatedPath: string;
  readonly kind: "binary" | "text";
  readonly lineCount: number;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface TranslatedReferenceManifest {
  readonly generatedAt: string;
  readonly generator: string;
  readonly excludedDirectories: readonly string[];
  readonly summary: {
    readonly fileCount: number;
    readonly textFileCount: number;
    readonly binaryFileCount: number;
    readonly lineCount: number;
    readonly byteLength: number;
    readonly bySource: Record<string, { readonly fileCount: number; readonly lineCount: number; readonly byteLength: number }>;
  };
  readonly files: readonly TranslatedReferenceFileEntry[];
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultManifestPath = resolve(packageRoot, "generated", "manifest.json");

export async function loadTranslatedReferenceManifest(path = defaultManifestPath): Promise<TranslatedReferenceManifest> {
  return JSON.parse(await readFile(path, "utf8")) as TranslatedReferenceManifest;
}

export async function findTranslatedReferenceFile(
  input: { readonly source?: TranslatedReferenceSource; readonly relativePath?: string; readonly sha256?: string },
  path = defaultManifestPath,
): Promise<TranslatedReferenceFileEntry | null> {
  const manifest = await loadTranslatedReferenceManifest(path);
  return (
    manifest.files.find(
      (entry) =>
        (input.source === undefined || entry.source === input.source) &&
        (input.relativePath === undefined || entry.relativePath === input.relativePath) &&
        (input.sha256 === undefined || entry.sha256 === input.sha256),
    ) ?? null
  );
}
