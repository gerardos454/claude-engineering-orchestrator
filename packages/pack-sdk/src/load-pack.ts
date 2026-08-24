import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { PackValidationError } from "./errors.js";
import type { CapabilityPack, PackAgent, PackDiagnostic, RawPackManifest } from "./types.js";

type PackSchema = { $defs: { agent: object } };

const schemaFile = new URL("./pack.schema.json", import.meta.url);
const sourceSchemaFile = new URL("../../../schemas/pack.schema.json", import.meta.url);
const driveRelativePath = /^[A-Za-z]:/;

async function readSchema(): Promise<PackSchema> {
  try {
    return JSON.parse(await readFile(fileURLToPath(schemaFile), "utf8")) as PackSchema;
  } catch (error: unknown) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
    return JSON.parse(await readFile(fileURLToPath(sourceSchemaFile), "utf8")) as PackSchema;
  }
}

function schemaDiagnostics(path: string, errors: ErrorObject[] | null | undefined): PackDiagnostic[] {
  return (errors ?? []).map((error) => ({
    code: "SCHEMA_INVALID",
    path: `${path}${error.instancePath}`,
    message: error.message ?? "does not satisfy the pack contract",
  }));
}

async function parseYaml(path: string): Promise<unknown> {
  try {
    return YAML.parse(await readFile(path, "utf8"));
  } catch (error: unknown) {
    throw new PackValidationError([
      {
        code: "SCHEMA_INVALID",
        path,
        message: error instanceof Error ? error.message : "could not read YAML",
      },
    ]);
  }
}

function pathEscapes(root: string, candidate: string): boolean {
  const relativeCandidate = relative(root, candidate);
  return relativeCandidate === ".." || relativeCandidate.startsWith(`..${sep}`) || isAbsolute(relativeCandidate);
}

function pathEscapesLexically(path: string): boolean {
  return isAbsolute(path) || path.startsWith("..") || driveRelativePath.test(path);
}

function manifestAgentPaths(document: unknown): string[] {
  if (typeof document !== "object" || document === null || !("agents" in document)) {
    return [];
  }
  const { agents } = document as { agents: unknown };
  return Array.isArray(agents) ? agents.filter((agent): agent is string => typeof agent === "string") : [];
}

function pathEscapeDiagnostic(path: string): PackDiagnostic {
  return {
    code: "PATH_ESCAPE",
    path,
    message: "agent descriptor must stay within the pack root",
  };
}

function validateOrThrow<T>(document: unknown, validate: ValidateFunction, path: string): T {
  if (validate(document)) {
    return document as T;
  }
  throw new PackValidationError(schemaDiagnostics(path, validate.errors));
}

export async function loadPack(packRoot: string): Promise<CapabilityPack> {
  const root = await realpath(packRoot);
  const schema = await readSchema();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validateManifest = ajv.compile(schema);
  const validateAgent = ajv.compile(schema.$defs.agent);

  const manifestInputPath = resolve(root, "pack.yaml");
  const manifestPath = await realpath(manifestInputPath);
  if (pathEscapes(root, manifestPath)) {
    throw new PackValidationError([
      {
        code: "PATH_ESCAPE",
        path: "pack.yaml",
        message: "manifest must stay within the pack root",
      },
    ]);
  }
  const manifestDocument = await parseYaml(manifestPath);
  const lexicalEscapes = manifestAgentPaths(manifestDocument)
    .filter(pathEscapesLexically)
    .map(pathEscapeDiagnostic);
  if (lexicalEscapes.length > 0) {
    throw new PackValidationError(lexicalEscapes);
  }
  const manifest = validateOrThrow<RawPackManifest>(
    manifestDocument,
    validateManifest,
    manifestPath,
  );

  const agents: PackAgent[] = [];
  const diagnostics: PackDiagnostic[] = [];
  const seenAgentIds = new Set<string>();

  for (const agentPath of manifest.agents) {
    if (pathEscapesLexically(agentPath)) {
      diagnostics.push(pathEscapeDiagnostic(agentPath));
      continue;
    }

    const resolvedPath = resolve(root, agentPath);
    let descriptorPath: string;
    try {
      descriptorPath = await realpath(resolvedPath);
    } catch (error: unknown) {
      diagnostics.push({
        code: "SCHEMA_INVALID",
        path: agentPath,
        message: error instanceof Error ? error.message : "could not read agent descriptor",
      });
      continue;
    }

    if (pathEscapes(root, descriptorPath)) {
      diagnostics.push(pathEscapeDiagnostic(agentPath));
      continue;
    }

    const document = await parseYaml(descriptorPath);
    if (!validateAgent(document)) {
      diagnostics.push(...schemaDiagnostics(agentPath, validateAgent.errors));
      continue;
    }

    const agent = document as PackAgent;
    if (agent.reviewed_by.includes(agent.id)) {
      diagnostics.push({
        code: "SELF_REVIEW",
        path: agentPath,
        message: `agent ${agent.id} cannot review itself`,
      });
    }
    if (seenAgentIds.has(agent.id)) {
      diagnostics.push({
        code: "DUPLICATE_AGENT",
        path: agentPath,
        message: `agent ID ${agent.id} is duplicated`,
      });
    }
    seenAgentIds.add(agent.id);
    agents.push(agent);
  }

  if (diagnostics.length > 0) {
    throw new PackValidationError(diagnostics);
  }

  return {
    id: manifest.id,
    version: manifest.version,
    license: manifest.license,
    core: manifest.core,
    capabilities: manifest.capabilities,
    dependencies: manifest.dependencies ?? {},
    agents,
    root,
  };
}
