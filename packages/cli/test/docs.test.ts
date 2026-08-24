import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const guidePath = join(repositoryRoot, "docs", "capability-packs.md");

function documentedCommands(markdown: string): string[] {
  return Array.from(markdown.matchAll(/^```bash\s*\n([\s\S]*?)^```/gm))
    .flatMap(([, block]) => block.split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.startsWith("npm ") || line.startsWith("node packages/cli"));
}

test("capability-pack guide commands use concrete local paths", async () => {
  // Break caught: published commands must remain runnable from a clean clone.
  assert.ok(existsSync(guidePath), "docs/capability-packs.md must exist");
  const commands = documentedCommands(await readFile(guidePath, "utf8"));

  assert.ok(commands.length > 0, "guide must include npm or CLI commands in bash fences");
  for (const command of commands) {
    assert.doesNotMatch(
      command,
      /<[^>]+>|\{[A-Z][A-Z0-9_ -]*\}|\[[A-Z][A-Z0-9_ -]*\]|(?:YOUR|REPLACE)_[A-Z0-9_]+/,
      `command contains a placeholder token: ${command}`,
    );

    if (!command.startsWith("node packages/cli")) continue;
    const parts = command.split(/\s+/);
    const validationPath = parts[parts.indexOf("validate") + 1];
    assert.ok(validationPath, `validation command needs a pack path: ${command}`);
    const cliSource = parts[1]!.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
    assert.ok(existsSync(join(repositoryRoot, cliSource)), `CLI source is missing: ${cliSource}`);
    assert.ok(existsSync(join(repositoryRoot, validationPath)), `pack path is missing: ${validationPath}`);
  }
});
