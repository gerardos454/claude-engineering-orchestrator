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
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function pack(destination: string): Promise<string> {
  if (process.platform === "win32") {
    const command = `${npmCommand} pack --json --pack-destination=${destination}`;
    const { stdout } = await execFile(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
      cwd: packageRoot,
    });
    return stdout;
  }
  const { stdout } = await execFile(npmCommand, ["pack", "--json", "--pack-destination", destination], {
    cwd: packageRoot,
  });
  return stdout;
}

function packagedPaths(tarball: Buffer): string[] {
  const archive = gunzipSync(tarball);
  const paths: string[] = [];
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const name = archive.subarray(offset, offset + 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break;
    const sizeText = archive.subarray(offset + 124, offset + 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    paths.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  return paths;
}

test("packed SDK ships its runtime entrypoint and schema", async () => {
  const destination = await mkdtemp(join(tmpdir(), "pack-sdk-tarball-"));
  try {
    const stdout = await pack(destination);
    const [{ filename }] = JSON.parse(stdout) as Array<{ filename: string }>;
    const paths = packagedPaths(await readFile(join(destination, filename)));
    assert.ok(paths.includes("package/dist/index.js"));
    assert.ok(paths.includes("package/dist/pack.schema.json"));
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
