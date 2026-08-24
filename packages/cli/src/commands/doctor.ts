import { access, constants } from "node:fs/promises";
import type { CliEnvironment, CliIo, OutputFormat } from "../main.js";

const ENVIRONMENT_EXIT_CODE = 4;
const MINIMUM_NODE_MAJOR = 24;

interface DoctorCheck {
  ok: boolean;
  version?: string;
  required?: string;
  path?: string;
}

function parseMajorVersion(version: string): number | undefined {
  const match = /^(\d+)/.exec(version);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
}

function renderText(checks: Record<"node" | "cwd", DoctorCheck>): string {
  const node = checks.node;
  const cwd = checks.cwd;
  return [
    `Node ${node.version ?? "unknown"}: ${node.ok ? "ok" : `requires ${node.required}`}`,
    `Working directory ${cwd.path ?? "unknown"}: ${cwd.ok ? "ok" : "unreadable"}`,
  ].join("\n");
}

export async function diagnoseEnvironment(
  format: OutputFormat,
  io: CliIo,
  env: CliEnvironment,
): Promise<number> {
  const nodeMajor = parseMajorVersion(env.nodeVersion);
  const node: DoctorCheck = {
    ok: nodeMajor !== undefined && nodeMajor >= MINIMUM_NODE_MAJOR,
    version: env.nodeVersion,
    required: `>=${MINIMUM_NODE_MAJOR}`,
  };

  let cwdReadable = true;
  try {
    await access(env.cwd, constants.R_OK);
  } catch {
    cwdReadable = false;
  }
  const cwd: DoctorCheck = { ok: cwdReadable, path: env.cwd };
  const checks = { node, cwd };
  const ok = node.ok && cwd.ok;
  const output = format === "json" ? JSON.stringify({ ok, checks }) : renderText(checks);
  io[ok ? "stdout" : "stderr"](output);
  return ok ? 0 : ENVIRONMENT_EXIT_CODE;
}
