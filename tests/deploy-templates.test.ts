import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const deployDir = join(process.cwd(), "deploy");

test("production deployment templates expose gateway health, storage, and secret configuration", () => {
  const composePath = join(deployDir, "docker-compose.production.yml");
  const dockerfilePath = join(deployDir, "Dockerfile");
  const envExamplePath = join(deployDir, "env.example");
  const kubernetesPath = join(deployDir, "kubernetes", "omni-agent.yaml");
  const renderPath = join(deployDir, "render.yaml");
  const securityDocPath = join(process.cwd(), "docs", "security.md");
  const releaseChecklistPath = join(process.cwd(), "docs", "release-checklist.md");

  assert.equal(existsSync(composePath), true);
  assert.equal(existsSync(dockerfilePath), true);
  assert.equal(existsSync(envExamplePath), true);
  assert.equal(existsSync(kubernetesPath), true);
  assert.equal(existsSync(renderPath), true);
  assert.equal(existsSync(securityDocPath), true);
  assert.equal(existsSync(releaseChecklistPath), true);

  const compose = readFileSync(composePath, "utf8");
  assert.match(compose, /dockerfile: deploy\/Dockerfile/);
  assert.match(compose, /OMNI_AGENT_GATEWAY_ACCESS_TOKEN/);
  assert.match(compose, /OMNI_AGENT_STORE_PATH/);
  assert.match(compose, /\/health/);
  assert.match(compose, /OMNI_AGENT_MODAL_ENDPOINT/);
  assert.match(compose, /OMNI_AGENT_E2B_ENDPOINT/);

  const kubernetes = readFileSync(kubernetesPath, "utf8");
  assert.match(kubernetes, /kind: Secret/);
  assert.match(kubernetes, /kind: PersistentVolumeClaim/);
  assert.match(kubernetes, /readinessProbe/);
  assert.match(kubernetes, /path: \/health/);

  const render = readFileSync(renderPath, "utf8");
  assert.match(render, /healthCheckPath: \/health/);
  assert.match(render, /OMNI_AGENT_GATEWAY_ACCESS_TOKEN/);

  const dockerfile = readFileSync(dockerfilePath, "utf8");
  assert.match(dockerfile, /npm run build/);
  assert.match(dockerfile, /dist\/omni-agent\.js/);

  const envExample = readFileSync(envExamplePath, "utf8");
  assert.match(envExample, /OMNI_AGENT_EXECUTION_BACKEND/);
  assert.match(envExample, /OPENAI_API_KEY/);
  assert.match(envExample, /SLACK_BOT_TOKEN/);

  const securityDoc = readFileSync(securityDocPath, "utf8");
  assert.match(securityDoc, /MCP Trust Boundary/);
  assert.match(securityDoc, /Channel Secret Model/);
  assert.match(securityDoc, /ACP bridge endpoints/);
  assert.match(securityDoc, /OpenAI Responses profiles/);
  assert.match(securityDoc, /Memory provider hooks/);
  assert.match(securityDoc, /Inline context references/);
  assert.match(securityDoc, /Skill platform gates/);
  assert.match(securityDoc, /Checkpoint and rollback state/);
  assert.match(securityDoc, /Transactional patch application/);
  assert.match(securityDoc, /MCP OAuth and allowlists/);
  assert.match(securityDoc, /Credential pools/);
  assert.match(securityDoc, /Tool lifecycle hooks/);
  assert.match(securityDoc, /Deployment Security Review/);

  const releaseChecklist = readFileSync(releaseChecklistPath, "utf8");
  assert.match(releaseChecklist, /npm run eval:smoke/);
  assert.match(releaseChecklist, /capability-scorecard\.json/);
  assert.match(releaseChecklist, /tests\/release-check\.test\.ts/);
  assert.match(releaseChecklist, /tests\/maturity-artifacts\.test\.ts/);
  assert.match(releaseChecklist, /acp-cancel-and-event-projection/);
  assert.match(releaseChecklist, /responses-streaming-adapter/);
  assert.match(releaseChecklist, /memory-lifecycle/);
  assert.match(releaseChecklist, /inline-context-references/);
  assert.match(releaseChecklist, /skill-platform-gates/);
  assert.match(releaseChecklist, /workspace-checkpoints/);
  assert.match(releaseChecklist, /transactional patch/);
  assert.match(releaseChecklist, /MCP OAuth\/allowlist/);
  assert.match(releaseChecklist, /credential-pool-rotation/);
  assert.match(releaseChecklist, /tool-lifecycle-hooks/);
});
