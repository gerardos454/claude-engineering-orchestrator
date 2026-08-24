import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import {
  withoutWorkspaceBuildOutputs,
  type WorkspaceOutputFileOps,
} from "./support/without-workspace-build-outputs.js";

const holdingParent = join("repo", ".engineer", "runs");
const holdingRoot = join(holdingParent, "package-distribution-unique");
const packageRoots = [join("repo", "packages", "pack-sdk"), join("repo", "packages", "core")];

function errorWithCode(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

test("a backup failure never deletes an untouched build output", async () => {
  // Break caught: failure to move dist must not make finally delete the original directory.
  const removed: string[] = [];
  let ran = false;
  const fileOps: WorkspaceOutputFileOps = {
    mkdir: async () => undefined,
    mkdtemp: async () => holdingRoot,
    rename: async () => {
      throw errorWithCode("backup denied", "EACCES");
    },
    rm: async (path) => {
      removed.push(path);
    },
  };

  await assert.rejects(
    withoutWorkspaceBuildOutputs({
      packageRoots,
      holdingParent,
      fileOps,
      run: async () => {
        ran = true;
      },
    }),
    (error) => error instanceof AggregateError && error.errors.some(
      (cause) => cause instanceof Error && cause.message === "backup denied",
    ),
  );

  assert.equal(ran, false);
  assert.equal(removed.includes(join(packageRoots[0], "dist")), false);
  assert.equal(removed.includes(join(packageRoots[1], "dist")), false);
  assert.deepEqual(removed, [holdingRoot]);
});

test("a restore failure does not prevent later outputs from being restored", async () => {
  // Break caught: one failed restore must not strand every later package backup.
  const renameCalls: Array<[string, string]> = [];
  const removed: string[] = [];
  const sdkSource = join(packageRoots[0], "dist");
  const coreSource = join(packageRoots[1], "dist");
  const sdkBackup = join(holdingRoot, "dist-0");
  const coreBackup = join(holdingRoot, "dist-1");
  const fileOps: WorkspaceOutputFileOps = {
    mkdir: async () => undefined,
    mkdtemp: async () => holdingRoot,
    rename: async (source, destination) => {
      renameCalls.push([source, destination]);
      if (source === sdkBackup) throw errorWithCode("sdk restore failed", "EACCES");
    },
    rm: async (path) => {
      removed.push(path);
    },
  };

  await assert.rejects(
    withoutWorkspaceBuildOutputs({
      packageRoots,
      holdingParent,
      fileOps,
      run: async () => undefined,
    }),
    (error) => error instanceof AggregateError && error.errors.some(
      (cause) => cause instanceof Error && cause.message === "sdk restore failed",
    ),
  );

  assert.deepEqual(renameCalls, [
    [sdkSource, sdkBackup],
    [coreSource, coreBackup],
    [sdkBackup, sdkSource],
    [coreBackup, coreSource],
  ]);
  assert.deepEqual(removed, [sdkSource, coreSource]);
  assert.equal(removed.includes(holdingRoot), false);
});
