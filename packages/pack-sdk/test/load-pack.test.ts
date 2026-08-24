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
produces: [patch, test-results]
reviewed_by: [quality-auditor]
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
