import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadPack, type CapabilityPack } from "@engineer/pack-sdk";

export interface LockedPack {
  id: string;
  version: string;
  source: "local";
}

export interface PackLock {
  format: 1;
  packs: LockedPack[];
}

export interface ResolvedPackSet {
  ordered: CapabilityPack[];
  lock: PackLock;
}

export class PackResolutionError extends Error {
  constructor(
    public readonly code: "MISSING_DEPENDENCY" | "VERSION_MISMATCH" | "CYCLE" | "PATH_ESCAPE",
    message: string,
  ) {
    super(message);
    this.name = "PackResolutionError";
  }
}

type Version = readonly [bigint, bigint, bigint];

function escapesRoot(root: string, candidate: string): boolean {
  const candidateRelativePath = relative(root, candidate);
  return candidateRelativePath === ".." || candidateRelativePath.startsWith(`..${sep}`) || isAbsolute(candidateRelativePath);
}

function parseVersion(version: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return undefined;
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) return undefined;
  return [BigInt(major), BigInt(minor), BigInt(patch)];
}

function compareVersions(left: Version, right: Version): number {
  const [leftMajor, leftMinor, leftPatch] = left;
  const [rightMajor, rightMinor, rightPatch] = right;
  if (leftMajor !== rightMajor) return leftMajor < rightMajor ? -1 : 1;
  if (leftMinor !== rightMinor) return leftMinor < rightMinor ? -1 : 1;
  if (leftPatch !== rightPatch) return leftPatch < rightPatch ? -1 : 1;
  return 0;
}

function satisfies(range: string, version: string): boolean {
  if (range === version) return true;
  if (!range.startsWith("^")) return false;

  const lowerBound = parseVersion(range.slice(1));
  const candidate = parseVersion(version);
  if (!lowerBound || !candidate || compareVersions(candidate, lowerBound) < 0) return false;

  const [major, minor, patch] = lowerBound;
  const upperBound: Version = major > 0n
    ? [major + 1n, 0n, 0n]
    : minor > 0n
      ? [0n, minor + 1n, 0n]
      : [0n, 0n, patch + 1n];
  return compareVersions(candidate, upperBound) < 0;
}

async function registryPackPath(path: string, registryRoot: string, canonicalRegistryRoot: string): Promise<string> {
  if (!isAbsolute(path) || escapesRoot(registryRoot, path)) {
    throw new PackResolutionError("PATH_ESCAPE", `registry path ${path} is outside the configured root`);
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(path);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : "could not resolve registry path";
    throw new PackResolutionError("PATH_ESCAPE", `registry path ${path} is not safe: ${reason}`);
  }
  if (escapesRoot(canonicalRegistryRoot, canonicalPath)) {
    throw new PackResolutionError("PATH_ESCAPE", `registry path ${path} escapes the configured root`);
  }
  return canonicalPath;
}

export async function resolvePacks(
  entryRoots: readonly string[],
  registry: ReadonlyMap<string, string>,
  registryRoot: string,
): Promise<ResolvedPackSet> {
  const canonicalRegistryRoot = await realpath(registryRoot);
  const lexicalRegistryRoot = resolve(registryRoot);
  const ordered: CapabilityPack[] = [];
  const completed = new Set<string>();
  const active = new Set<string>();
  const selected = new Map<string, CapabilityPack>();

  function select(pack: CapabilityPack): CapabilityPack {
    const existing = selected.get(pack.id);
    if (!existing) {
      selected.set(pack.id, pack);
      return pack;
    }
    if (existing.root !== pack.root || existing.version !== pack.version) {
      throw new PackResolutionError(
        "VERSION_MISMATCH",
        `pack ${pack.id} conflicts with the selected root or version`,
      );
    }
    return existing;
  }

  async function visit(incomingPack: CapabilityPack): Promise<void> {
    const pack = select(incomingPack);
    if (completed.has(pack.id)) return;
    if (active.has(pack.id)) {
      throw new PackResolutionError("CYCLE", `dependency cycle includes ${pack.id}`);
    }

    active.add(pack.id);
    try {
      for (const [dependencyId, range] of Object.entries(pack.dependencies).sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      ))) {
        const dependencyPath = registry.get(dependencyId);
        if (dependencyPath === undefined) {
          throw new PackResolutionError("MISSING_DEPENDENCY", `${pack.id} requires ${dependencyId}`);
        }
        const incomingDependency = await loadPack(
          await registryPackPath(dependencyPath, lexicalRegistryRoot, canonicalRegistryRoot),
        );
        if (incomingDependency.id !== dependencyId) {
          throw new PackResolutionError("MISSING_DEPENDENCY", `registry entry ${dependencyId} contains ${incomingDependency.id}`);
        }
        const dependency = select(incomingDependency);
        if (!satisfies(range, dependency.version)) {
          throw new PackResolutionError(
            "VERSION_MISMATCH",
            `${pack.id} requires ${dependencyId}@${range}, but found ${dependency.version}`,
          );
        }
        await visit(dependency);
      }
      completed.add(pack.id);
      ordered.push(pack);
    } finally {
      active.delete(pack.id);
    }
  }

  for (const entryRoot of entryRoots) {
    await visit(await loadPack(entryRoot));
  }

  return {
    ordered,
    lock: {
      format: 1,
      packs: ordered.map(({ id, version }) => ({ id, version, source: "local" })),
    },
  };
}
