export const sdkVersion = "0.1.0" as const;

export { PackValidationError } from "./errors.js";
export { loadPack } from "./load-pack.js";
export type {
  AgentActivationSignals,
  AgentRole,
  CapabilityPack,
  PackAgent,
  PackDiagnostic,
  RawPackManifest,
} from "./types.js";
