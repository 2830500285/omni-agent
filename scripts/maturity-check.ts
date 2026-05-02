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

console.log(
  JSON.stringify(
    {
      scorecard: scorecardPath,
      benchmarkSuite: benchmarkSuitePath,
      claimsDocument: claimsDocumentPath,
      capabilityMaturity: report,
      claimEvidence,
    },
    null,
    2,
  ),
);

if (errorIssues.length > 0 || claimErrorIssues.length > 0) {
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
