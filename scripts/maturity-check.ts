import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCapabilityMaturityReport,
  normalizeCapabilityScorecardDefinition,
  normalizeEvalSuiteDefinition,
  type CapabilityMaturityStatus,
  type CapabilityScorecardDefinition,
  type EvalSuiteDefinition,
} from "../packages/evals/src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scorecardPath = resolve(repoRoot, "examples/evals/capability-scorecard.json");
const benchmarkSuitePath = resolve(repoRoot, "examples/evals/suite.json");
const claimsDocumentPath = resolve(repoRoot, "docs/capability-backed-claims.md");
const improveDocumentPath = resolve(repoRoot, "IMPROVE.MD");

const scorecardDefinition = JSON.parse(readFileSync(scorecardPath, "utf8")) as CapabilityScorecardDefinition;
const benchmarkSuiteDefinition = JSON.parse(readFileSync(benchmarkSuitePath, "utf8")) as EvalSuiteDefinition;

const scorecard = normalizeCapabilityScorecardDefinition(scorecardDefinition, {
  baseDir: dirname(scorecardPath),
  defaultWorkspaceCwd: repoRoot,
});
const benchmarkSuite = normalizeEvalSuiteDefinition(benchmarkSuiteDefinition, {
  baseDir: dirname(benchmarkSuitePath),
  defaultWorkspaceCwd: repoRoot,
});

const benchmarkScenarioIds = new Set(benchmarkSuite.scenarios.map((scenario) => scenario.id));
const evalScenarioIds = new Set([...benchmarkSuite.scenarios, ...scorecard.scenarios].map((scenario) => scenario.id));
const statusRank: Readonly<Record<CapabilityMaturityStatus, number>> = {
  missing: 0,
  scaffolded: 1,
  usable: 2,
  mature: 3,
};
const report = buildCapabilityMaturityReport(scorecard, {
  passingScenarioIds: benchmarkScenarioIds,
  requirePassingScenariosForMature: true,
  requireMatureBenchmarkScenarios: true,
});
const claimEvidence = validateCapabilityBackedClaims();
const errorIssues = report.issues.filter((issue) => issue.severity === "error");
const claimErrorIssues = claimEvidence.issues.filter((issue) => issue.severity === "error");
const improveCapabilityMap = validateImproveCapabilityMap();
const improveErrorIssues = improveCapabilityMap.issues.filter((issue) => issue.severity === "error");

console.log(
  JSON.stringify(
    {
      scorecard: scorecardPath,
      benchmarkSuite: benchmarkSuitePath,
      claimsDocument: claimsDocumentPath,
      improveDocument: improveDocumentPath,
      capabilityMaturity: report,
      claimEvidence,
      improveCapabilityMap,
    },
    null,
    2,
  ),
);

if (errorIssues.length > 0 || claimErrorIssues.length > 0 || improveErrorIssues.length > 0) {
  process.exitCode = 1;
}

interface CapabilityBackedClaim {
  readonly claimId: string;
  readonly capabilityId: string;
  readonly claim: string;
  readonly minimumStatus: "usable" | "mature";
  readonly requiredScenarioIds: readonly string[];
  readonly riskIfNotMature: string;
}

interface CapabilityBackedClaimIssue {
  readonly claimId: string;
  readonly capabilityId?: string;
  readonly severity: "error" | "risk";
  readonly reason: string;
}

interface ImproveCapabilityMapping {
  readonly sectionId: string;
  readonly title: string;
  readonly capabilityIds: readonly string[];
}

interface ImproveCapabilityMapIssue {
  readonly sectionId: string;
  readonly capabilityId?: string;
  readonly severity: "error";
  readonly reason: string;
}

function validateImproveCapabilityMap(): {
  readonly sectionCount: number;
  readonly mappedSectionCount: number;
  readonly mappings: readonly ImproveCapabilityMapping[];
  readonly issues: readonly ImproveCapabilityMapIssue[];
} {
  const mappings = parseImproveCapabilityMappings(improveDocumentPath);
  const issues: ImproveCapabilityMapIssue[] = [];
  const capabilitiesById = new Set(scorecard.capabilities.map((capability) => capability.id));

  if (mappings.length === 0) {
    issues.push({
      sectionId: "IMPROVE.MD",
      severity: "error",
      reason: "IMPROVE.MD must include at least one Pn.n section with capability mappings.",
    });
  }

  for (const mapping of mappings) {
    if (mapping.capabilityIds.length === 0) {
      issues.push({
        sectionId: mapping.sectionId,
        severity: "error",
        reason: "IMPROVE.MD section must include a capability mapping line.",
      });
      continue;
    }
    for (const capabilityId of mapping.capabilityIds) {
      if (!capabilitiesById.has(capabilityId)) {
        issues.push({
          sectionId: mapping.sectionId,
          capabilityId,
          severity: "error",
          reason: "IMPROVE.MD section references a capability id that is not present in the scorecard.",
        });
      }
    }
  }

  return {
    sectionCount: mappings.length,
    mappedSectionCount: mappings.filter((mapping) => mapping.capabilityIds.length > 0).length,
    mappings,
    issues,
  };
}

function parseImproveCapabilityMappings(filePath: string): ImproveCapabilityMapping[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const mappings: ImproveCapabilityMapping[] = [];
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  let current: { sectionId: string; title: string; capabilityIds: string[] } | null = null;

  for (const line of lines) {
    const heading = line.match(/^###\s+(P\d+\.\d+)\s+(.+)$/);
    if (heading) {
      if (current) {
        mappings.push(current);
      }
      current = {
        sectionId: heading[1]!,
        title: heading[2]!,
        capabilityIds: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }
    if (/^(能力映射|Capability ids)[:：]/.test(line.trim())) {
      current.capabilityIds = Array.from(line.matchAll(/`([^`]+)`/g), (match) => match[1]!).filter(Boolean);
    }
  }

  if (current) {
    mappings.push(current);
  }
  return mappings;
}

function validateCapabilityBackedClaims(): {
  readonly claimCount: number;
  readonly claims: readonly CapabilityBackedClaim[];
  readonly risks: readonly CapabilityBackedClaimIssue[];
  readonly issues: readonly CapabilityBackedClaimIssue[];
} {
  const claims = parseCapabilityBackedClaims(claimsDocumentPath);
  const issues: CapabilityBackedClaimIssue[] = [];
  const capabilitiesById = new Map(scorecard.capabilities.map((capability) => [capability.id, capability]));

  if (claims.length === 0) {
    issues.push({
      claimId: "capability-backed-claims",
      severity: "error",
      reason: "Capability claim document must register at least one claim.",
    });
  }

  for (const claim of claims) {
    const capability = capabilitiesById.get(claim.capabilityId);
    if (!capability) {
      issues.push({
        claimId: claim.claimId,
        capabilityId: claim.capabilityId,
        severity: "error",
        reason: "Claim references a capability that is not present in the scorecard.",
      });
      continue;
    }

    if (statusRank[capability.status] < statusRank[claim.minimumStatus]) {
      issues.push({
        claimId: claim.claimId,
        capabilityId: claim.capabilityId,
        severity: "error",
        reason: `Claim requires ${claim.minimumStatus} evidence, but scorecard status is ${capability.status}.`,
      });
    }

    if (capability.evidenceFiles.length === 0 || capability.requiredTests.length === 0) {
      issues.push({
        claimId: claim.claimId,
        capabilityId: claim.capabilityId,
        severity: "error",
        reason: "Claimed capabilities must cite implementation evidence files and required tests in the scorecard.",
      });
    }

    const scorecardScenarioIds = new Set([...capability.scenarioIds, ...capability.matureBenchmarkScenarioIds]);
    for (const scenarioId of claim.requiredScenarioIds) {
      if (!scorecardScenarioIds.has(scenarioId)) {
        issues.push({
          claimId: claim.claimId,
          capabilityId: claim.capabilityId,
          severity: "error",
          reason: `Claim requires scenario ${scenarioId}, but the capability does not cite it.`,
        });
      }
      if (!evalScenarioIds.has(scenarioId)) {
        issues.push({
          claimId: claim.claimId,
          capabilityId: claim.capabilityId,
          severity: "error",
          reason: `Claim requires scenario ${scenarioId}, but no eval suite contains it.`,
        });
      }
    }

    if (claim.minimumStatus === "mature") {
      if (
        capability.matureEvidenceFiles.length === 0 ||
        capability.liveOrContractTests.length === 0 ||
        capability.matureBenchmarkScenarioIds.length === 0 ||
        !capability.operationalRunbook ||
        capability.failureRecoveryTests.length === 0
      ) {
        issues.push({
          claimId: claim.claimId,
          capabilityId: claim.capabilityId,
          severity: "error",
          reason: "Mature claims must include mature evidence files, live or contract tests, benchmark scenarios, runbook, and failure recovery tests.",
        });
      }
    }

    if (capability.status !== "mature") {
      if (!claim.riskIfNotMature || /^none$/i.test(claim.riskIfNotMature)) {
        issues.push({
          claimId: claim.claimId,
          capabilityId: claim.capabilityId,
          severity: "error",
          reason: "Non-mature claims must document a risk instead of reading like mature capability.",
        });
      } else {
        issues.push({
          claimId: claim.claimId,
          capabilityId: claim.capabilityId,
          severity: "risk",
          reason: claim.riskIfNotMature,
        });
      }
    }
  }

  return {
    claimCount: claims.length,
    claims,
    risks: issues.filter((issue) => issue.severity === "risk"),
    issues,
  };
}

function parseCapabilityBackedClaims(filePath: string): CapabilityBackedClaim[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const claims: CapabilityBackedClaim[] = [];
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    normalizeTableCells(line).join("|") === "claim id|capability id|claim|minimum status|required scenario ids|risk if not mature",
  );
  if (headerIndex === -1) {
    return claims;
  }

  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.trim().startsWith("|")) {
      break;
    }
    const cells = splitTableCells(line);
    if (cells.length !== 6) {
      continue;
    }
    const [claimId, capabilityId, claim, minimumStatusText, scenarioText, riskIfNotMature] = cells;
    const minimumStatus = parseClaimMinimumStatus(minimumStatusText);
    if (!minimumStatus) {
      continue;
    }
    claims.push({
      claimId,
      capabilityId,
      claim,
      minimumStatus,
      requiredScenarioIds: scenarioText.split(",").map((entry) => entry.trim()).filter(Boolean),
      riskIfNotMature,
    });
  }

  return claims;
}

function parseClaimMinimumStatus(status: string): CapabilityBackedClaim["minimumStatus"] | null {
  if (status === "usable" || status === "mature") {
    return status;
  }
  return null;
}

function normalizeTableCells(line: string): string[] {
  return splitTableCells(line).map((cell) => cell.toLowerCase());
}

function splitTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
