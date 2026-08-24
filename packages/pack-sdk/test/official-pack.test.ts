import test from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const officialPackRoot = join(here, "..", "..", "..", "packs", "official");

const reviewerByBuilder = new Map([
  ["software-architect", "software-architect-auditor"],
  ["backend-engineer", "backend-auditor"],
  ["frontend-engineer", "frontend-auditor"],
  ["ui-ux-engineer", "ui-ux-auditor"],
  ["database-engineer", "database-auditor"],
  ["security-engineer", "security-auditor"],
  ["devops-engineer", "devops-auditor"],
  ["qa-engineer", "qa-auditor"],
]);

const expectedAgentRoles = new Map([
  ["software-architect", "builder"],
  ["software-architect-auditor", "auditor"],
  ["backend-engineer", "builder"],
  ["backend-auditor", "auditor"],
  ["frontend-engineer", "builder"],
  ["frontend-auditor", "auditor"],
  ["ui-ux-engineer", "builder"],
  ["ui-ux-auditor", "auditor"],
  ["database-engineer", "builder"],
  ["database-auditor", "auditor"],
  ["security-engineer", "builder"],
  ["security-auditor", "auditor"],
  ["devops-engineer", "builder"],
  ["devops-auditor", "auditor"],
  ["qa-engineer", "builder"],
  ["qa-auditor", "auditor"],
  ["principal-engineering-auditor", "auditor"],
]);

const architectureActivation = {
  files: ["composer.json", "package.json", "pubspec.yaml", "terraform/**/*.tf", "docs/adr/**"],
  task_signals: ["architecture", "contracts", "cross-cutting", "migration", "scaling"],
};
const backendActivation = {
  files: ["composer.json", "artisan", "routes/**/*.php", "app/**/*.php"],
  task_signals: ["api", "backend", "queue", "integration", "tenant-scoping"],
};
const frontendActivation = {
  files: ["package.json", "tailwind.config.*", "resources/**/*.blade.php", "resources/**/*.{js,ts,jsx,tsx}"],
  task_signals: ["web-ui", "frontend", "responsive", "accessibility", "client-state"],
};
const uiUxActivation = {
  files: ["tailwind.config.*", "resources/**/*.blade.php", "lib/**/*.dart"],
  task_signals: ["ui", "ux", "accessibility", "product-flow", "design-system"],
};
const databaseActivation = {
  files: ["database/migrations/**/*.php", "database/schema/**", "**/*.sql"],
  task_signals: ["database", "schema", "migration", "query-performance", "data-integrity"],
};
const securityActivation = {
  files: ["composer.json", "package.json", "app/Policies/**/*.php", "config/auth.php", "routes/**/*"],
  task_signals: ["authentication", "authorization", "tenant-isolation", "secrets", "security"],
};
const devopsActivation = {
  files: [".github/workflows/**", "Dockerfile*", "docker-compose*.yml", "terraform/**/*.tf", "infra/**"],
  task_signals: ["aws", "ci-cd", "deployment", "observability", "reliability"],
};
const qaActivation = {
  files: ["phpunit.xml*", "tests/**", "package.json", "pubspec.yaml"],
  task_signals: ["test", "regression", "quality", "edge-case", "validation"],
};
const principalActivation = {
  files: [],
  task_signals: ["final-review", "production-readiness", "release-readiness", "principal-review"],
};

const expectedActivationByAgent = new Map([
  ["software-architect", architectureActivation],
  ["software-architect-auditor", architectureActivation],
  ["backend-engineer", backendActivation],
  ["backend-auditor", backendActivation],
  ["frontend-engineer", frontendActivation],
  ["frontend-auditor", frontendActivation],
  ["ui-ux-engineer", uiUxActivation],
  ["ui-ux-auditor", uiUxActivation],
  ["database-engineer", databaseActivation],
  ["database-auditor", databaseActivation],
  ["security-engineer", securityActivation],
  ["security-auditor", securityActivation],
  ["devops-engineer", devopsActivation],
  ["devops-auditor", devopsActivation],
  ["qa-engineer", qaActivation],
  ["qa-auditor", qaActivation],
  ["principal-engineering-auditor", principalActivation],
]);

test("official pack preserves the complete normalized team inventory", async () => {
  // Break caught: every preserved specialist, including the principal gate, must ship exactly once with its role.
  const pack = await loadPack(officialPackRoot);
  const builders = pack.agents.filter((agent) => agent.role === "builder");
  const auditors = pack.agents.filter((agent) => agent.role === "auditor");

  assert.equal(pack.id, "official.engineering-team");
  assert.equal(pack.version, "0.1.0");
  assert.equal(pack.license, "MIT");
  assert.equal(pack.core, "^0.1.0");
  assert.deepEqual(pack.capabilities, ["orchestration"]);
  assert.equal(pack.agents.length, 17);
  assert.deepEqual(
    new Map(pack.agents.map((agent) => [agent.id, agent.role])),
    expectedAgentRoles,
  );
  assert.equal(builders.length, 8);
  assert.equal(auditors.length, 9);
  assert.deepEqual(
    new Map(builders.map((builder) => [builder.id, builder.reviewed_by[0]])),
    reviewerByBuilder,
  );
  assert.deepEqual(
    new Map(pack.agents.map((agent) => [agent.id, agent.activates_when])),
    expectedActivationByAgent,
  );
  for (const agent of pack.agents) {
    assert.deepEqual(agent.requires.capabilities, ["orchestration"]);
  }
});

test("official pack declares the principal auditor as the terminal read-only gate", async () => {
  // Break caught: domain auditors must resolve to a real, independent, non-editing final reviewer.
  const pack = await loadPack(officialPackRoot);
  const principal = pack.agents.find((agent) => agent.id === "principal-engineering-auditor");
  assert.deepEqual(principal, {
    id: "principal-engineering-auditor",
    role: "auditor",
    activates_when: principalActivation,
    produces: ["findings", "verdict", "production-readiness"],
    reviewed_by: [],
    requires: {
      tools: ["Read", "Grep", "Glob", "Bash"],
      capabilities: ["orchestration"],
    },
    risk: { forbidden: ["file-modification", "self-approval"] },
  });

  for (const auditor of pack.agents.filter((agent) =>
    agent.role === "auditor" && agent.id !== "principal-engineering-auditor"
  )) {
    assert.deepEqual(auditor.reviewed_by, ["principal-engineering-auditor"]);
  }
});
