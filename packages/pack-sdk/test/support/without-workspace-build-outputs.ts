import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export interface WorkspaceOutputFileOps {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  mkdtemp(prefix: string): Promise<string>;
  rename(source: string, destination: string): Promise<void>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
}

interface WorkspaceOutputState {
  source: string;
  backup: string;
  state: "untouched" | "backup-failed" | "confirmed-absent" | "moved" | "restored";
}

const nodeFileOps: WorkspaceOutputFileOps = { mkdir, mkdtemp, rename, rm };

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function withoutWorkspaceBuildOutputs<T>({
  packageRoots,
  holdingParent,
  run,
  fileOps = nodeFileOps,
}: {
  packageRoots: string[];
  holdingParent: string;
  run: () => Promise<T>;
  fileOps?: WorkspaceOutputFileOps;
}): Promise<T> {
  await fileOps.mkdir(holdingParent, { recursive: true });
  const holdingRoot = await fileOps.mkdtemp(join(holdingParent, "package-distribution-with-spaces "));
  const outputs: WorkspaceOutputState[] = packageRoots.map((packageRoot, index) => ({
    source: join(packageRoot, "dist"),
    backup: join(holdingRoot, `dist-${index}`),
    state: "untouched",
  }));
  const errors: unknown[] = [];
  let result: T | undefined;
  let runStarted = false;

  for (const output of outputs) {
    try {
      await fileOps.rename(output.source, output.backup);
      output.state = "moved";
    } catch (error) {
      if (isMissing(error)) {
        output.state = "confirmed-absent";
      } else {
        output.state = "backup-failed";
        errors.push(error);
        break;
      }
    }
  }

  if (errors.length === 0) {
    runStarted = true;
    try {
      result = await run();
    } catch (error) {
      errors.push(error);
    }
  }

  let holdingRootIsSafeToRemove = true;
  for (const output of outputs) {
    if (output.state === "untouched" || output.state === "backup-failed") continue;
    if (output.state === "confirmed-absent" && !runStarted) continue;

    let generatedOutputRemoved = false;
    try {
      await fileOps.rm(output.source, { recursive: true, force: true });
      generatedOutputRemoved = true;
    } catch (error) {
      errors.push(error);
    }

    if (output.state !== "moved") continue;
    if (!generatedOutputRemoved) {
      holdingRootIsSafeToRemove = false;
      continue;
    }
    try {
      await fileOps.rename(output.backup, output.source);
      output.state = "restored";
    } catch (error) {
      holdingRootIsSafeToRemove = false;
      errors.push(error);
    }
  }

  if (holdingRootIsSafeToRemove) {
    try {
      await fileOps.rm(holdingRoot, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, "workspace build-output isolation failed");
  }
  return result as T;
}
