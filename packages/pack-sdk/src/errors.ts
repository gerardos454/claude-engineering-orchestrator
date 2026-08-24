import type { PackDiagnostic } from "./types.js";

export class PackValidationError extends Error {
  constructor(public readonly diagnostics: PackDiagnostic[]) {
    super(diagnostics.map((item) => `${item.path}: ${item.message}`).join("\n"));
    this.name = "PackValidationError";
  }
}
