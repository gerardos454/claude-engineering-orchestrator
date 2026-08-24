import { diagnoseEnvironment } from "./commands/doctor.js";
import { validatePack } from "./commands/pack-validate.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CliEnvironment {
  nodeVersion: string;
  cwd: string;
}

export type OutputFormat = "text" | "json";

const usage = "Usage: engineer pack validate <path> [--json] | engineer doctor [--json]";

function printUsage(io: CliIo, format: OutputFormat): number {
  io.stderr(format === "json" ? JSON.stringify({ ok: false, error: "USAGE", message: usage }) : usage);
  return 2;
}

export async function main(args: string[], io: CliIo, env: CliEnvironment): Promise<number> {
  const format: OutputFormat = args.includes("--json") ? "json" : "text";
  const commandArgs = args.filter((argument) => argument !== "--json");

  if (commandArgs[0] === "pack" && commandArgs[1] === "validate" && commandArgs.length === 3) {
    return validatePack(commandArgs[2]!, format, io, env.cwd);
  }
  if (commandArgs[0] === "doctor" && commandArgs.length === 1) {
    return diagnoseEnvironment(format, io, env);
  }
  return printUsage(io, format);
}
