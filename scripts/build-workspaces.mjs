import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const buildOrder = [
  "@engineer/pack-sdk",
  "@engineer/core",
  "@engineer/cli",
];

export function npmBuildInvocation(workspace, env = process.env) {
  const npmCli = env.npm_execpath;
  if (!npmCli) {
    throw new Error("npm_execpath is required; run the build through npm");
  }
  return {
    command: process.execPath,
    args: [npmCli, "run", "build", "--workspace", workspace],
  };
}

function buildWorkspace(workspace) {
  const invocation = npmBuildInvocation(workspace);
  const result = spawnSync(invocation.command, invocation.args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`workspace build failed: ${workspace}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

export function runWorkspaceBuilds(run = buildWorkspace) {
  for (const workspace of buildOrder) run(workspace);
}

const entrypoint = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entrypoint === fileURLToPath(import.meta.url)) {
  try {
    runWorkspaceBuilds();
  } catch (error) {
    if (!(error instanceof Error) || !("exitCode" in error)) console.error(error);
    process.exitCode = error instanceof Error && "exitCode" in error
      ? Number(error.exitCode)
      : 1;
  }
}
