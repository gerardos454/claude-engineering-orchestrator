import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const guidePath = join(repositoryRoot, "docs", "capability-packs.md");
const requiredCommands = new Set([
  "npm ci",
  "npm run typecheck",
  "npm test",
  "npm run build",
  "node packages/cli/dist/bin.js pack validate packs/official",
  "node packages/cli/dist/bin.js pack validate packs/official --json",
]);

interface CommandCatalog {
  repositoryRoot: string;
  rootScripts: ReadonlySet<string>;
  workspaceScripts: ReadonlyMap<string, ReadonlySet<string>>;
  pathExists(path: string): boolean;
}

function documentedCommands(markdown: string): string[] {
  return Array.from(markdown.matchAll(/^```bash\s*\n([\s\S]*?)^```/gm))
    .flatMap(([, block]) => block.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.startsWith("npm ") || line.startsWith("node packages/cli"));
}

function staysWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !pathFromRoot.startsWith("../");
}

function commandError(command: string, catalog: CommandCatalog): string | undefined {
  if (/<[^>]+>|\{[A-Z][A-Z0-9_ -]*\}|\[[A-Z][A-Z0-9_ -]*\]|(?:YOUR|REPLACE)_[A-Z0-9_]+/.test(command)) {
    return `contains a placeholder token: ${command}`;
  }

  if (command === "npm ci") return undefined;
  if (command === "npm test") {
    return catalog.rootScripts.has("test") ? undefined : "references missing root script: npm test";
  }

  const rootRun = /^npm run (\S+)$/.exec(command);
  if (rootRun) {
    return catalog.rootScripts.has(rootRun[1]!) ? undefined : `references missing root script: ${command}`;
  }

  const workspaceRun = /^npm --workspace (\S+) (?:run )?(\S+)$/.exec(command);
  if (workspaceRun) {
    const workspace = catalog.workspaceScripts.get(workspaceRun[1]!);
    if (!workspace) return `references missing workspace: ${command}`;
    return workspace.has(workspaceRun[2]!) ? undefined : `references missing workspace script: ${command}`;
  }

  const parts = command.split(/\s+/);
  if (parts[0] !== "node" || parts[1] !== "packages/cli/dist/bin.js") {
    return `uses unsupported command grammar: ${command}`;
  }
  const cliSource = join(catalog.repositoryRoot, "packages/cli/src/bin.ts");
  if (!catalog.pathExists(cliSource)) return "CLI source entrypoint is missing";

  if ((parts.length === 3 || parts.length === 4) && parts[2] === "doctor" && (parts.length === 3 || parts[3] === "--json")) {
    return undefined;
  }
  if ((parts.length === 5 || parts.length === 6) && parts[2] === "pack" && parts[3] === "validate" && (parts.length === 5 || parts[5] === "--json")) {
    const packPath = parts[4]!;
    const resolvedPackPath = resolve(catalog.repositoryRoot, packPath);
    if (!staysWithin(catalog.repositoryRoot, resolvedPackPath)) return `references path outside repository: ${command}`;
    return catalog.pathExists(resolvedPackPath) ? undefined : `references missing local pack path: ${command}`;
  }
  return `uses unsupported CLI grammar: ${command}`;
}

function documentationErrors(commands: readonly string[], catalog: CommandCatalog): string[] {
  const errors = commands.flatMap((command) => {
    const error = commandError(command, catalog);
    return error === undefined ? [] : [error];
  });
  const actual = new Set(commands);
  for (const required of requiredCommands) {
    if (!actual.has(required)) errors.push(`missing required command: ${required}`);
  }
  for (const command of actual) {
    if (!requiredCommands.has(command)) errors.push(`unexpected documented command: ${command}`);
  }
  return errors;
}

async function currentCatalog(): Promise<CommandCatalog> {
  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
  const workspaceScripts = new Map<string, ReadonlySet<string>>();
  for (const entry of readdirSync(join(repositoryRoot, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = join(repositoryRoot, "packages", entry.name, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    const workspacePackage = JSON.parse(await readFile(packageJsonPath, "utf8")) as { name: string; scripts?: Record<string, string> };
    workspaceScripts.set(workspacePackage.name, new Set(Object.keys(workspacePackage.scripts ?? {})));
  }
  return {
    repositoryRoot,
    rootScripts: new Set(Object.keys(rootPackage.scripts)),
    workspaceScripts,
    pathExists: existsSync,
  };
}

test("capability-pack guide commands are the complete executable quick start", async () => {
  // Break caught: removing a release-gate command or publishing a stale path makes a clean-clone guide incomplete.
  assert.ok(existsSync(guidePath), "docs/capability-packs.md must exist");
  const commands = documentedCommands(await readFile(guidePath, "utf8"));
  assert.deepEqual(documentationErrors(commands, await currentCatalog()), []);
});

test("documentation command validator rejects guide mutations", () => {
  // Break caught: invalid grammar, missing scripts, workspace drift, and escaped paths must not pass a text-only smoke test.
  const fixtureRoot = resolve("documentation-command-fixture");
  const catalog: CommandCatalog = {
    repositoryRoot: fixtureRoot,
    rootScripts: new Set(["build", "test", "typecheck"]),
    workspaceScripts: new Map([["@engineer/cli", new Set(["test"])]]),
    pathExists: (path) => path === join(fixtureRoot, "packages/cli/src/bin.ts") || path === join(fixtureRoot, "packs/official"),
  };
  const replace = (from: string, to: string) => Array.from(requiredCommands, (command) => command === from ? to : command);
  const cases = [
    { name: "required command removed", commands: Array.from(requiredCommands).filter((command) => command !== "npm run build"), expected: "missing required command: npm run build" },
    { name: "missing root script", commands: replace("npm test", "npm run release"), expected: "references missing root script: npm run release" },
    { name: "missing workspace", commands: replace("npm test", "npm --workspace @engineer/missing test"), expected: "references missing workspace: npm --workspace @engineer/missing test" },
    { name: "unsupported CLI grammar", commands: replace("node packages/cli/dist/bin.js pack validate packs/official", "node packages/cli/dist/bin.js pack packs/official"), expected: "uses unsupported CLI grammar: node packages/cli/dist/bin.js pack packs/official" },
    { name: "repository escape", commands: replace("node packages/cli/dist/bin.js pack validate packs/official", "node packages/cli/dist/bin.js pack validate ../outside"), expected: "references path outside repository: node packages/cli/dist/bin.js pack validate ../outside" },
    { name: "placeholder", commands: replace("npm test", "npm run YOUR_SCRIPT"), expected: "contains a placeholder token: npm run YOUR_SCRIPT" },
  ];

  for (const mutation of cases) {
    const errors = documentationErrors(mutation.commands, catalog);
    assert.ok(errors.includes(mutation.expected), `${mutation.name}: ${errors.join("; ")}`);
  }
  assert.equal(commandError("node packages/cli/dist/bin.js doctor --json", catalog), undefined);
});
