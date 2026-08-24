import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPack, PackValidationError } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const validAgent = `id: laravel-builder
role: builder
activates_when:
  files: [composer.json]
  task_signals: [api, queue]
produces: [patch, test-results]
reviewed_by: []
requires:
  tools: [phpunit]
  capabilities: [backend]
risk:
  forbidden: [direct-production-deploy]
`;

async function withPack(
  manifest: string,
  agent = validAgent,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "pack-sdk-"));
  try {
    await writeFile(join(root, "pack.yaml"), manifest);
    await writeFile(join(root, "agent.yaml"), agent);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const validManifest = `id: example.laravel
version: 1.2.3
license: MIT
core: 1.0.0
capabilities: [backend]
agents: [agent.yaml]
`;

test("loads and normalizes a valid pack", async () => {
  const pack = await loadPack(join(here, "fixtures", "valid"));
  assert.equal(pack.id, "example.laravel");
  assert.deepEqual(pack.agents[0]?.activates_when, {
    files: ["composer.json", "artisan"],
    task_signals: ["api", "queue"],
  });
  assert.deepEqual(pack.agents[0]?.produces, ["patch", "test-results"]);
  assert.deepEqual(pack.dependencies, {});
});

test("rejects a builder that reviews itself", async () => {
  await assert.rejects(
    loadPack(join(here, "fixtures", "self-approving")),
    (error: unknown) =>
      error instanceof PackValidationError &&
      error.diagnostics.some((item) => item.code === "SELF_REVIEW"),
  );
});

test("rejects malformed YAML", async () => {
  await withPack("id: [unterminated\n", validAgent, async (root) => {
    await assert.rejects(
      loadPack(root),
      (error: unknown) =>
        error instanceof PackValidationError &&
        error.diagnostics.some((item) => item.code === "SCHEMA_INVALID"),
    );
  });
});

test("reports a missing manifest as schema-invalid", async () => {
  const root = await mkdtemp(join(tmpdir(), "pack-sdk-missing-manifest-"));
  try {
    await assert.rejects(
      loadPack(root),
      (error: unknown) =>
        error instanceof PackValidationError &&
        error.diagnostics.some((item) => item.code === "SCHEMA_INVALID"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a dangling manifest symlink as schema-invalid", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pack-sdk-dangling-manifest-"));
  try {
    try {
      await symlink(join(root, "missing-pack.yaml"), join(root, "pack.yaml"), "file");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") {
        t.skip("creating file symlinks requires Windows developer mode or elevated privileges");
        return;
      }
      throw error;
    }
    await assert.rejects(
      loadPack(root),
      (error: unknown) =>
        error instanceof PackValidationError &&
        error.diagnostics.some((item) => item.code === "SCHEMA_INVALID"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects manifest properties outside the public contract", async () => {
  await withPack(`${validManifest}unexpected: value\n`, validAgent, async (root) => {
    await assert.rejects(
      loadPack(root),
      (error: unknown) =>
        error instanceof PackValidationError &&
        error.diagnostics.some((item) => item.code === "SCHEMA_INVALID"),
    );
  });
});

test("rejects an invalid semantic version", async () => {
  await withPack(validManifest.replace("1.2.3", "1.2"), validAgent, async (root) => {
    await assert.rejects(
      loadPack(root),
      (error: unknown) =>
        error instanceof PackValidationError &&
        error.diagnostics.some((item) => item.code === "SCHEMA_INVALID"),
    );
  });
});

test("rejects duplicate agent IDs", async () => {
  await withPack(
    validManifest.replace("[agent.yaml]", "[agent.yaml, second.yaml]"),
    validAgent,
    async (root) => {
      await writeFile(join(root, "second.yaml"), validAgent);
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) => item.code === "DUPLICATE_AGENT"),
      );
    },
  );
});

test("rejects agent descriptors missing required fields", async () => {
  await withPack(
    validManifest,
    validAgent.replace("risk:\n  forbidden: [direct-production-deploy]\n", ""),
    async (root) => {
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) => item.code === "SCHEMA_INVALID"),
      );
    },
  );
});

test("requires strict activation signals on every descriptor", async () => {
  // Break caught: planner inputs must not disappear or accept undeclared activation keys.
  const cases = [
    validAgent.replace(/activates_when:\n(?:  .*\n){2}/, ""),
    validAgent.replace("  task_signals: [api, queue]\n", ""),
    validAgent.replace("  task_signals: [api, queue]\n", "  task_signals: [api, queue]\n  unexpected: true\n"),
  ];

  for (const agent of cases) {
    await withPack(validManifest, agent, async (root) => {
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) => item.code === "SCHEMA_INVALID"),
      );
    });
  }
});

test("rejects duplicate activation signals", async () => {
  // Break caught: duplicate planner inputs make routing explanations unstable.
  await withPack(
    validManifest,
    validAgent.replace("files: [composer.json]", "files: [composer.json, composer.json]"),
    async (root) => {
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) => item.code === "SCHEMA_INVALID"),
      );
    },
  );
});

test("rejects a reviewed_by reference that is absent from the pack", async () => {
  // Break caught: a declared review edge must never resolve to no agent.
  await withPack(
    validManifest,
    validAgent.replace("reviewed_by: []", "reviewed_by: [missing-auditor]"),
    async (root) => {
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) =>
            item.code === "INVALID_REVIEWER" &&
            item.path === "agent.yaml" &&
            item.message === "reviewer missing-auditor does not resolve to an agent in this pack"
          ),
      );
    },
  );
});

test("rejects a reviewed_by reference that resolves to a builder", async () => {
  // Break caught: a local review edge must terminate at an independent auditor role.
  const secondBuilder = validAgent
    .replace("id: laravel-builder", "id: second-builder")
    .replace("task_signals: [api, queue]", "task_signals: [worker]");
  await withPack(
    validManifest.replace("[agent.yaml]", "[agent.yaml, second.yaml]"),
    validAgent.replace("reviewed_by: []", "reviewed_by: [second-builder]"),
    async (root) => {
      await writeFile(join(root, "second.yaml"), secondBuilder);
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) =>
            item.code === "INVALID_REVIEWER" &&
            item.path === "agent.yaml" &&
            item.message === "reviewer second-builder must have role auditor"
          ),
      );
    },
  );
});

test("rejects an agent path that escapes the pack root", async () => {
  await withPack(
    validManifest.replace("agent.yaml", "../agent.yaml"),
    validAgent,
    async (root) => {
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) => item.code === "PATH_ESCAPE"),
      );
    },
  );
});

test("rejects an absolute agent descriptor path", async () => {
  await withPack(
    validManifest.replace("agent.yaml", "/agent.yaml"),
    validAgent,
    async (root) => {
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) => item.code === "PATH_ESCAPE"),
      );
    },
  );
});

test("rejects an agent descriptor whose name is not YAML", async () => {
  await withPack(
    validManifest.replace("agent.yaml", "agent.txt"),
    validAgent,
    async (root) => {
      await writeFile(join(root, "agent.txt"), validAgent);
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) => item.code === "SCHEMA_INVALID"),
      );
    },
  );
});

test("rejects a drive-relative agent descriptor before filesystem access", async () => {
  await withPack(
    validManifest.replace("agent.yaml", "D:missing.yaml"),
    validAgent,
    async (root) => {
      await assert.rejects(
        loadPack(root),
        (error: unknown) =>
          error instanceof PackValidationError &&
          error.diagnostics.some((item) => item.code === "PATH_ESCAPE"),
      );
    },
  );
});

test("rejects a manifest symlink that escapes the canonical pack root", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "pack-sdk-manifest-link-"));
  const root = join(sandbox, "pack");
  try {
    await mkdir(root);
    await writeFile(join(root, "agent.yaml"), validAgent);
    const outsideManifest = join(sandbox, "outside-pack.yaml");
    await writeFile(outsideManifest, validManifest);
    try {
      await symlink(outsideManifest, join(root, "pack.yaml"), "file");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") {
        t.skip("creating file symlinks requires Windows developer mode or elevated privileges");
        return;
      }
      throw error;
    }
    await assert.rejects(
      loadPack(root),
      (error: unknown) =>
        error instanceof PackValidationError &&
        error.diagnostics.some((item) => item.code === "PATH_ESCAPE"),
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
