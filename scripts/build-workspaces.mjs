import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = resolve(dirname(scriptPath), "..");
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
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: workspaceRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`workspace build failed: ${workspace}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

export function runWorkspaceBuilds(run = buildWorkspace, workspaces = buildOrder) {
  for (const workspace of workspaces) run(workspace);
}

const entrypoint = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entrypoint === scriptPath) {
  const requestedWorkspaces = process.argv.slice(2);
  try {
    runWorkspaceBuilds(
      buildWorkspace,
      requestedWorkspaces.length === 0 ? buildOrder : requestedWorkspaces,
    );
  } catch (error) {
    if (!(error instanceof Error) || !("exitCode" in error)) console.error(error);
    process.exitCode = error instanceof Error && "exitCode" in error
      ? Number(error.exitCode)
      : 1;
  }
}
