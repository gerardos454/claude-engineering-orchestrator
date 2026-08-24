import assert from "node:assert/strict";
import test from "node:test";
import { npmBuildInvocation, runWorkspaceBuilds } from "../scripts/build-workspaces.mjs";

test("builds the SDK before every dependent workspace", () => {
  // Break caught: a clean checkout cannot type-resolve SDK declarations if a dependent builds first.
  const built = [];
  runWorkspaceBuilds((workspace) => built.push(workspace));

  assert.deepEqual(built, [
    "@engineer/pack-sdk",
    "@engineer/core",
    "@engineer/cli",
  ]);
});

test("builds exactly an explicitly requested workspace sequence", () => {
  // Break caught: a package lifecycle must not expand its requested build scope or reorder dependencies.
  const built = [];
  runWorkspaceBuilds(
    (workspace) => built.push(workspace),
    ["@engineer/pack-sdk", "@engineer/core"],
  );

  assert.deepEqual(built, ["@engineer/pack-sdk", "@engineer/core"]);
});

test("stops the workspace build at the first failure", () => {
  // Break caught: continuing after the SDK fails can publish stale dependent build output.
  const built = [];

  assert.throws(
    () => runWorkspaceBuilds((workspace) => {
      built.push(workspace);
      if (workspace === "@engineer/pack-sdk") throw new Error("sdk build failed");
    }),
    /sdk build failed/,
  );
  assert.deepEqual(built, ["@engineer/pack-sdk"]);
});

test("invokes npm through Node without shell interpolation", () => {
  // Break caught: npm paths containing spaces must remain one process argument on every platform.
  assert.deepEqual(
    npmBuildInvocation("@engineer/pack-sdk", { npm_execpath: "C:\\tool path\\npm-cli.js" }),
    {
      command: process.execPath,
      args: [
        "C:\\tool path\\npm-cli.js",
        "run",
        "build",
        "--workspace",
        "@engineer/pack-sdk",
      ],
    },
  );
});
