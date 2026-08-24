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

test("official pack preserves the existing team inventory", async () => {
  const pack = await loadPack(officialPackRoot);
  const builders = pack.agents.filter((agent) => agent.role === "builder");
  const auditors = pack.agents.filter((agent) => agent.role === "auditor");

  assert.equal(pack.id, "official.engineering-team");
  assert.equal(pack.version, "0.1.0");
  assert.equal(pack.license, "MIT");
  assert.equal(pack.core, "^0.1.0");
  assert.deepEqual(
    new Set(pack.capabilities),
    new Set([
      "orchestration",
      "principal-review",
      "architecture",
      "backend",
      "frontend",
      "ui-ux",
      "database",
      "security",
      "devops",
      "qa",
    ]),
  );
  assert.equal(builders.length, 8);
  assert.equal(auditors.length, 8);
  assert.deepEqual(
    new Map(builders.map((builder) => [builder.id, builder.reviewed_by[0]])),
    reviewerByBuilder,
  );
  assert.deepEqual(
    new Set(builders.flatMap((builder) => builder.reviewed_by)),
    new Set(auditors.map((auditor) => auditor.id)),
  );
});

test("official pack retains independent principal review as a cross-cutting gate", async () => {
  const pack = await loadPack(officialPackRoot);
  const principalReviewedDomains = new Set(["architecture", "security"]);

  for (const agent of pack.agents) {
    if (agent.role === "auditor") {
      assert.deepEqual(agent.reviewed_by, ["principal-engineering-auditor"]);
    }

    if (agent.requires.capabilities.some((capability) => principalReviewedDomains.has(capability))) {
      assert.ok(agent.requires.capabilities.includes("principal-review"));
    }
  }
});
