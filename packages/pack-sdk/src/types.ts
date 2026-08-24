export type AgentRole = "builder" | "auditor" | "advisor";

export interface AgentActivationSignals {
  files: string[];
  task_signals: string[];
}

export interface RawPackManifest {
  id: string;
  version: string;
  license: string;
  core: string;
  capabilities: string[];
  dependencies?: Record<string, string>;
  agents: string[];
}

export interface PackAgent {
  id: string;
  role: AgentRole;
  activates_when: AgentActivationSignals;
  produces: string[];
  reviewed_by: string[];
  requires: { tools: string[]; capabilities: string[] };
  risk: { forbidden: string[] };
}

export interface CapabilityPack {
  id: string;
  version: string;
  license: string;
  core: string;
  capabilities: string[];
  dependencies: Record<string, string>;
  agents: PackAgent[];
  root: string;
}

export interface PackDiagnostic {
  code: "SCHEMA_INVALID" | "SELF_REVIEW" | "DUPLICATE_AGENT" | "INVALID_REVIEWER" | "PATH_ESCAPE";
  path: string;
  message: string;
}
