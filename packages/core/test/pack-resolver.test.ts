import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PackResolutionError, resolvePacks } from "../src/index.js";

interface PackFixture {
  id: string;
  version: string;
  dependencies?: Record<string, string>;
  directory?: string;
}

const agent = `id: builder
role: builder
activates_when:
  files: []
  task_signals: [resolver-fixture]
produces: [patch]
reviewed_by: []
requires:
  tools: [node]
  capabilities: [backend]
risk:
  forbidden: [production-deploy]
`;

const caretCases = [
  { range: "^1.2.3", version: "1.2.3", accepts: true },
  { range: "^1.2.3", version: "1.9.0", accepts: true },
  { range: "^1.2.3", version: "1.2.2", accepts: false },
  { range: "^1.2.3", version: "2.0.0", accepts: false },
  { range: "^0.2.3", version: "0.2.3", accepts: true },
  { range: "^0.2.3", version: "0.2.4", accepts: true },
  { range: "^0.2.3", version: "0.2.2", accepts: false },
  { range: "^0.2.3", version: "0.3.0", accepts: false },
  { range: "^0.0.3", version: "0.0.3", accepts: true },
  { range: "^0.0.3", version: "0.0.2", accepts: false },
  { range: "^0.0.3", version: "0.0.4", accepts: false },
  { range: "^9007199254740993.2.3", version: "9007199254740993.2.3", accepts: true },
] as const;

async function createPack(root: string, fixture: PackFixture): Promise<string> {
  const packRoot = join(root, fixture.directory ?? fixture.id);
  await mkdir(packRoot, { recursive: true });
  const dependencies = fixture.dependencies
    ? `dependencies:\n${Object.entries(fixture.dependencies).map(([id, range]) => `  ${id}: ${range}`).join("\n")}\n`
    : "";
  await writeFile(
    join(packRoot, "pack.yaml"),
    `id: ${fixture.id}
version: ${fixture.version}
license: MIT
core: 1.0.0
capabilities: [backend]
${dependencies}agents: [agent.yaml]
`,
  );
  await writeFile(join(packRoot, "agent.yaml"), agent);
  return packRoot;
}

async function withFixtures(
  setup: (registryRoot: string, outsideRoot: string) => Promise<void>,
  run: (registryRoot: string, outsideRoot: string) => Promise<void>,
): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), "pack-resolver-"));
  const registryRoot = join(sandbox, "registry");
  const outsideRoot = join(sandbox, "outside");
  await mkdir(registryRoot);
  await mkdir(outsideRoot);
  try {
    await setup(registryRoot, outsideRoot);
    await run(registryRoot, outsideRoot);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

test("returns dependencies before dependents and pins exact versions", async () => {
  // Break caught: visiting a dependent before its dependency would produce an invalid execution order.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, { id: "example.testing", version: "1.2.0" });
      await createPack(registryRoot, {
        id: "example.api",
        version: "1.0.0",
        dependencies: { "example.testing": "^1.2.0" },
      });
    },
    async (registryRoot) => {
      const api = join(registryRoot, "example.api");
      const testing = join(registryRoot, "example.testing");
      const result = await resolvePacks([api], new Map([["example.testing", testing]]), registryRoot);

      assert.deepEqual(result.ordered.map((pack) => pack.id), ["example.testing", "example.api"]);
      assert.deepEqual(result.lock, {
        format: 1,
        packs: [
          { id: "example.testing", version: "1.2.0", source: "local" },
          { id: "example.api", version: "1.0.0", source: "local" },
        ],
      });
    },
  );
});

test("rejects a registry path outside the configured root", async () => {
  // Break caught: accepting a registry-controlled path would allow a pack outside the trusted root.
  await withFixtures(
    async (registryRoot, outsideRoot) => {
      await createPack(registryRoot, {
        id: "example.api",
        version: "1.0.0",
        dependencies: { "example.testing": "1.2.0" },
      });
      await createPack(outsideRoot, { id: "example.testing", version: "1.2.0" });
    },
    async (registryRoot, outsideRoot) => {
      await assert.rejects(
        resolvePacks(
          [join(registryRoot, "example.api")],
          new Map([["example.testing", join(outsideRoot, "example.testing")]]),
          registryRoot,
        ),
        (error: unknown) => error instanceof PackResolutionError && error.code === "PATH_ESCAPE",
      );
    },
  );
});

test("rejects a missing dependency", async () => {
  // Break caught: treating an unregistered dependency as optional hides incomplete pack graphs.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, {
        id: "example.api",
        version: "1.0.0",
        dependencies: { "example.missing": "1.0.0" },
      });
    },
    async (registryRoot) => {
      await assert.rejects(
        resolvePacks([join(registryRoot, "example.api")], new Map(), registryRoot),
        (error: unknown) => error instanceof PackResolutionError && error.code === "MISSING_DEPENDENCY",
      );
    },
  );
});

test("rejects incompatible exact and caret dependency versions", async () => {
  // Break caught: resolving versions outside a declared exact or caret range violates the pack contract.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, { id: "example.testing", version: "2.0.0" });
      await createPack(registryRoot, {
        id: "example.exact",
        version: "1.0.0",
        dependencies: { "example.testing": "1.2.0" },
      });
      await createPack(registryRoot, {
        id: "example.caret",
        version: "1.0.0",
        dependencies: { "example.testing": "^1.2.0" },
      });
    },
    async (registryRoot) => {
      const registry = new Map([["example.testing", join(registryRoot, "example.testing")]]);
      for (const id of ["example.exact", "example.caret"]) {
        await assert.rejects(
          resolvePacks([join(registryRoot, id)], registry, registryRoot),
          (error: unknown) => error instanceof PackResolutionError && error.code === "VERSION_MISMATCH",
        );
      }
    },
  );
});

test("rejects cycles", async () => {
  // Break caught: recursive dependencies must not recurse forever or produce a partial lock.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, {
        id: "example.a",
        version: "1.0.0",
        dependencies: { "example.b": "1.0.0" },
      });
      await createPack(registryRoot, {
        id: "example.b",
        version: "1.0.0",
        dependencies: { "example.a": "1.0.0" },
      });
    },
    async (registryRoot) => {
      await assert.rejects(
        resolvePacks(
          [join(registryRoot, "example.a")],
          new Map([["example.b", join(registryRoot, "example.b")], ["example.a", join(registryRoot, "example.a")]]),
          registryRoot,
        ),
        (error: unknown) => error instanceof PackResolutionError && error.code === "CYCLE",
      );
    },
  );
});

test("uses lexical dependency order independent of registry insertion order", async () => {
  // Break caught: map iteration order must not change the reproducible lock order.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, { id: "example.alpha", version: "1.0.0" });
      await createPack(registryRoot, { id: "example.zeta", version: "1.0.0" });
      await createPack(registryRoot, {
        id: "example.api",
        version: "1.0.0",
        dependencies: { "example.zeta": "1.0.0", "example.alpha": "1.0.0" },
      });
    },
    async (registryRoot) => {
      const alpha = join(registryRoot, "example.alpha");
      const zeta = join(registryRoot, "example.zeta");
      const api = join(registryRoot, "example.api");
      const first = await resolvePacks([api], new Map([["example.zeta", zeta], ["example.alpha", alpha]]), registryRoot);
      const second = await resolvePacks([api], new Map([["example.alpha", alpha], ["example.zeta", zeta]]), registryRoot);
      assert.deepEqual(first.lock, second.lock);
      assert.deepEqual(first.ordered.map((pack) => pack.id), ["example.alpha", "example.zeta", "example.api"]);
    },
  );
});

test("deduplicates repeated entry roots", async () => {
  // Break caught: repeating the same entry must not execute or lock a pack twice.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, { id: "example.api", version: "1.0.0" });
    },
    async (registryRoot) => {
      const api = join(registryRoot, "example.api");
      const result = await resolvePacks([api, api], new Map(), registryRoot);
      assert.deepEqual(result.ordered.map((pack) => pack.id), ["example.api"]);
      assert.deepEqual(result.lock.packs, [{ id: "example.api", version: "1.0.0", source: "local" }]);
    },
  );
});

test("rejects duplicate pack IDs from distinct canonical roots", async () => {
  // Break caught: deduplicating by ID alone makes the chosen pack depend on entry-root order.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, { id: "example.shared", version: "1.0.0", directory: "shared-a" });
      await createPack(registryRoot, { id: "example.shared", version: "1.0.0", directory: "shared-b" });
    },
    async (registryRoot) => {
      await assert.rejects(
        resolvePacks(
          [join(registryRoot, "shared-a"), join(registryRoot, "shared-b")],
          new Map(),
          registryRoot,
        ),
        (error: unknown) => error instanceof PackResolutionError && error.code === "VERSION_MISMATCH",
      );
    },
  );
});

test("rejects a registry version that conflicts with an earlier entry root", async () => {
  // Break caught: a dependency must not validate against a registry pack that differs from the selected entry pack.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, { id: "example.shared", version: "1.0.0", directory: "entry-shared" });
      await createPack(registryRoot, { id: "example.shared", version: "1.2.0", directory: "registry-shared" });
      await createPack(registryRoot, {
        id: "example.consumer",
        version: "1.0.0",
        dependencies: { "example.shared": "^1.0.0" },
      });
    },
    async (registryRoot) => {
      await assert.rejects(
        resolvePacks(
          [join(registryRoot, "entry-shared"), join(registryRoot, "example.consumer")],
          new Map([["example.shared", join(registryRoot, "registry-shared")]]),
          registryRoot,
        ),
        (error: unknown) => error instanceof PackResolutionError && error.code === "VERSION_MISMATCH",
      );
    },
  );
});

test("rejects a duplicate ID with a hidden dependency graph", async () => {
  // Break caught: accepting a second root with the same ID can silently retain dependencies absent from the registry pack.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, { id: "example.hidden", version: "1.0.0" });
      await createPack(registryRoot, {
        id: "example.shared",
        version: "1.0.0",
        directory: "entry-shared",
        dependencies: { "example.hidden": "1.0.0" },
      });
      await createPack(registryRoot, { id: "example.shared", version: "1.0.0", directory: "registry-shared" });
      await createPack(registryRoot, {
        id: "example.consumer",
        version: "1.0.0",
        dependencies: { "example.shared": "1.0.0" },
      });
    },
    async (registryRoot) => {
      await assert.rejects(
        resolvePacks(
          [join(registryRoot, "entry-shared"), join(registryRoot, "example.consumer")],
          new Map([
            ["example.hidden", join(registryRoot, "example.hidden")],
            ["example.shared", join(registryRoot, "registry-shared")],
          ]),
          registryRoot,
        ),
        (error: unknown) => error instanceof PackResolutionError && error.code === "VERSION_MISMATCH",
      );
    },
  );
});

test("reports a mismatched registry manifest as a missing dependency before selection conflicts", async () => {
  // Break caught: a registry key must be validated before a pre-selected wrong manifest can change the error code.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, { id: "example.selected", version: "1.0.0", directory: "entry-selected" });
      await createPack(registryRoot, { id: "example.selected", version: "1.0.0", directory: "registry-selected" });
      await createPack(registryRoot, {
        id: "example.consumer",
        version: "1.0.0",
        dependencies: { "example.requested": "1.0.0" },
      });
    },
    async (registryRoot) => {
      await assert.rejects(
        resolvePacks(
          [join(registryRoot, "entry-selected"), join(registryRoot, "example.consumer")],
          new Map([["example.requested", join(registryRoot, "registry-selected")]]),
          registryRoot,
        ),
        (error: unknown) => error instanceof PackResolutionError && error.code === "MISSING_DEPENDENCY",
      );
    },
  );
});

test("checks every dependency range against the selected pack", async () => {
  // Break caught: an already selected canonical pack must still be checked against each dependent's range.
  await withFixtures(
    async (registryRoot) => {
      await createPack(registryRoot, { id: "example.shared", version: "1.0.0" });
      await createPack(registryRoot, {
        id: "example.consumer",
        version: "1.0.0",
        dependencies: { "example.shared": "^2.0.0" },
      });
    },
    async (registryRoot) => {
      await assert.rejects(
        resolvePacks(
          [join(registryRoot, "example.shared"), join(registryRoot, "example.consumer")],
          new Map([["example.shared", join(registryRoot, "example.shared")]]),
          registryRoot,
        ),
        (error: unknown) => (
          error instanceof PackResolutionError
          && error.code === "VERSION_MISMATCH"
          && error.message.includes("example.consumer requires example.shared@^2.0.0")
        ),
      );
    },
  );
});

test("evaluates caret range boundaries without losing numeric precision", async () => {
  // Break caught: numeric coercion rounds schema-valid version components above Number.MAX_SAFE_INTEGER.
  await withFixtures(
    async (registryRoot) => {
      for (const [index, item] of caretCases.entries()) {
        const dependencyId = `example.dependency-${index}`;
        await createPack(registryRoot, { id: dependencyId, version: item.version });
        await createPack(registryRoot, {
          id: `example.consumer-${index}`,
          version: "1.0.0",
          dependencies: { [dependencyId]: item.range },
        });
      }
    },
    async (registryRoot) => {
      for (const [index, item] of caretCases.entries()) {
        const dependencyId = `example.dependency-${index}`;
        const outcome = resolvePacks(
          [join(registryRoot, `example.consumer-${index}`)],
          new Map([[dependencyId, join(registryRoot, dependencyId)]]),
          registryRoot,
        );
        if (item.accepts) {
          await outcome;
        } else {
          await assert.rejects(
            outcome,
            (error: unknown) => error instanceof PackResolutionError && error.code === "VERSION_MISMATCH",
          );
        }
      }
    },
  );
});

test("rejects a registry symlink that escapes the configured root", async (t) => {
  // Break caught: lexical containment alone must not trust symlinks that resolve outside the registry.
  await withFixtures(
    async (registryRoot, outsideRoot) => {
      await createPack(registryRoot, {
        id: "example.api",
        version: "1.0.0",
        dependencies: { "example.testing": "1.2.0" },
      });
      const outsidePack = await createPack(outsideRoot, { id: "example.testing", version: "1.2.0" });
      try {
        await symlink(outsidePack, join(registryRoot, "linked-testing"), "junction");
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && error.code === "EPERM") {
          t.skip("creating directory symlinks requires Windows developer mode or elevated privileges");
          return;
        }
        throw error;
      }
    },
    async (registryRoot) => {
      await assert.rejects(
        resolvePacks(
          [join(registryRoot, "example.api")],
          new Map([["example.testing", join(registryRoot, "linked-testing")]]),
          registryRoot,
        ),
        (error: unknown) => error instanceof PackResolutionError && error.code === "PATH_ESCAPE",
      );
    },
  );
});
