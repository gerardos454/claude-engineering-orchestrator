import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const sdkRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const coreRoot = join(sdkRoot, "..", "core");

async function pack(packageRoot: string, destination: string): Promise<string> {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "npm_execpath must be available while npm runs package tests");
  const { stdout } = await execFile(process.execPath, [
    npmCli,
    "pack",
    "--json",
    "--pack-destination",
    destination,
  ], {
    cwd: packageRoot,
  });
  return stdout;
}

function packagedFiles(tarball: Buffer): Map<string, Buffer> {
  const archive = gunzipSync(tarball);
  const files = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const name = archive.subarray(offset, offset + 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break;
    const sizeText = archive.subarray(offset + 124, offset + 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const contentsOffset = offset + 512;
    files.set(name, archive.subarray(contentsOffset, contentsOffset + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return files;
}

async function packedFiles(packageRoot: string, prefix: string): Promise<Map<string, Buffer>> {
  const destination = await mkdtemp(join(tmpdir(), prefix));
  try {
    const stdout = await pack(packageRoot, destination);
    const [{ filename }] = JSON.parse(stdout) as Array<{ filename: string }>;
    return packagedFiles(await readFile(join(destination, filename)));
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}

test("packed SDK ships runtime, declarations, public schema, metadata, and license", async () => {
  // Break caught: SDK consumers must receive every public runtime and legal artifact from a clean pack.
  const files = await packedFiles(sdkRoot, "pack-sdk-tarball-with-spaces ");
  const packageJson = JSON.parse(files.get("package/package.json")?.toString("utf8") ?? "null") as {
    engines?: { node?: string };
    scripts?: { prepack?: string };
  };
  assert.deepEqual(
    [
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/dist/pack.schema.json",
      "package/package.json",
      "package/LICENSE",
    ].filter((path) => !files.has(path)),
    [],
  );
  assert.equal(packageJson.engines?.node, ">=24");
  assert.equal(packageJson.scripts?.prepack, "npm run build");
});

test("packed core ships runtime, declarations, metadata, and license", async () => {
  // Break caught: the public core package boundary must be publish-ready rather than relying on workspace output.
  const files = await packedFiles(coreRoot, "core-tarball-with-spaces ");
  const packageJson = JSON.parse(files.get("package/package.json")?.toString("utf8") ?? "null") as {
    private?: boolean;
    engines?: { node?: string };
    scripts?: { prepack?: string };
  };
  assert.deepEqual(
    [
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/package.json",
      "package/LICENSE",
    ].filter((path) => !files.has(path)),
    [],
  );
  assert.notEqual(packageJson.private, true);
  assert.equal(packageJson.engines?.node, ">=24");
  assert.equal(packageJson.scripts?.prepack, "npm run build");
});
