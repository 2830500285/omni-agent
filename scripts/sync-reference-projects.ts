import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

type ReferenceSource = "claudecode" | "hermes" | "openclaw";

interface ReferenceProject {
  readonly source: ReferenceSource;
  readonly label: string;
  readonly sourcePath: string;
  readonly targetPath: string;
}

interface SyncReport {
  readonly source: ReferenceSource;
  readonly label: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly files: number;
  readonly bytes: number;
}

const WORKSPACE_ROOT = process.cwd();
const REFERENCE_ROOT = join(WORKSPACE_ROOT, "vendor", "reference");
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "release",
  "target",
  "win-unpacked",
]);

const PROJECTS: readonly ReferenceProject[] = [
  {
    source: "hermes",
    label: "hermes-agent-main",
    sourcePath: resolve(WORKSPACE_ROOT, "..", "hermes-agent-main"),
    targetPath: join(REFERENCE_ROOT, "hermes-agent-main"),
  },
  {
    source: "openclaw",
    label: "openclaw-main",
    sourcePath: resolve(WORKSPACE_ROOT, "..", "openclaw-main"),
    targetPath: join(REFERENCE_ROOT, "openclaw-main"),
  },
  {
    source: "claudecode",
    label: "claudecode-source",
    sourcePath: resolve(WORKSPACE_ROOT, "..", "claudecode-source"),
    targetPath: join(REFERENCE_ROOT, "claudecode-source"),
  },
];

async function main(): Promise<void> {
  await assertInsideWorkspace(REFERENCE_ROOT);
  await mkdir(REFERENCE_ROOT, { recursive: true });
  const reports: SyncReport[] = [];
  for (const project of PROJECTS) {
    if (!(await isDirectory(project.sourcePath))) {
      throw new Error(`Reference source does not exist: ${project.sourcePath}`);
    }
    await assertInsideWorkspace(project.targetPath);
    await rm(project.targetPath, { recursive: true, force: true });
    await mkdir(dirname(project.targetPath), { recursive: true });
    await cp(project.sourcePath, project.targetPath, {
      recursive: true,
      force: true,
      filter: (sourcePath) => !hasExcludedSegment(sourcePath, project.sourcePath),
    });
    reports.push({
      source: project.source,
      label: project.label,
      sourcePath: project.sourcePath,
      targetPath: project.targetPath,
      ...(await collectFileStats(project.targetPath)),
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    root: REFERENCE_ROOT,
    excludedSegments: [...EXCLUDED_SEGMENTS].sort(),
    projects: reports,
  };
  await writeFile(join(REFERENCE_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const report of reports) {
    console.log(`${report.label}: ${report.files} files, ${(report.bytes / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log(`manifest: ${join(REFERENCE_ROOT, "manifest.json")}`);
}

async function collectFileStats(root: string): Promise<{ readonly files: number; readonly bytes: number }> {
  let files = 0;
  let bytes = 0;
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile()) {
        const entryStats = await stat(entryPath);
        files += 1;
        bytes += entryStats.size;
      }
    }
  }
  await visit(root);
  return { files, bytes };
}

function hasExcludedSegment(path: string, sourceRoot: string): boolean {
  const relativePath = relative(sourceRoot, path);
  if (!relativePath) {
    return false;
  }
  return relativePath.split(/[\\/]/).some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function assertInsideWorkspace(path: string): Promise<void> {
  const relativePath = relative(WORKSPACE_ROOT, resolve(path));
  if (relativePath.startsWith("..") || relativePath === "" || resolve(path) === resolve(WORKSPACE_ROOT)) {
    throw new Error(`Refusing to sync outside workspace reference root: ${path}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
