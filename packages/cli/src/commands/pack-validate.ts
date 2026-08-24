import { PackValidationError, loadPack, type PackDiagnostic } from "@engineer/pack-sdk";
import { resolve } from "node:path";
import type { CliIo, OutputFormat } from "../main.js";

const VALIDATION_EXIT_CODE = 3;

function print(io: CliIo, format: OutputFormat, stream: "stdout" | "stderr", value: unknown): void {
  io[stream](format === "json" ? JSON.stringify(value) : String(value));
}

function formatDiagnostics(diagnostics: PackDiagnostic[]): string {
  return diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.path}: ${diagnostic.message}`).join("\n");
}

export async function validatePack(
  packPath: string,
  format: OutputFormat,
  io: CliIo,
  cwd: string,
): Promise<number> {
  const packRoot = resolve(cwd, packPath);
  try {
    const pack = await loadPack(packRoot);
    const summary = {
      id: pack.id,
      version: pack.version,
      agents: pack.agents.length,
    };
    print(
      io,
      format,
      "stdout",
      format === "json"
        ? { ok: true, pack: summary }
        : `Pack ${summary.id}@${summary.version} validated (${summary.agents} agent${summary.agents === 1 ? "" : "s"})`,
    );
    return 0;
  } catch (error: unknown) {
    const diagnostics: PackDiagnostic[] = error instanceof PackValidationError
      ? error.diagnostics
      : [{
          code: "SCHEMA_INVALID",
          path: packRoot,
          message: error instanceof Error ? error.message : "could not load pack",
        }];
    print(
      io,
      format,
      "stderr",
      format === "json" ? { ok: false, diagnostics } : formatDiagnostics(diagnostics),
    );
    return VALIDATION_EXIT_CODE;
  }
}
