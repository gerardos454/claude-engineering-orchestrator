import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/main.js";

const here = dirname(fileURLToPath(import.meta.url));
const invalidPack = join(here, "../../pack-sdk/test/fixtures/self-approving");
const validPack = join(here, "../../pack-sdk/test/fixtures/valid");

async function runCli(args: string[], env = { nodeVersion: "24.0.0", cwd: process.cwd() }) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCode = await main(args, {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  }, env);
  return { exitCode, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

test("pack validate emits machine-readable diagnostics", async () => {
  // Break caught: validation failures must retain structured diagnostics for automation.
  const result = await runCli(["pack", "validate", invalidPack, "--json"]);
  assert.equal(result.exitCode, 3);
  assert.deepEqual(JSON.parse(result.stderr), {
    ok: false,
    diagnostics: [{
      code: "SELF_REVIEW",
      path: "agents/self-reviewer.yaml",
      message: "agent self-reviewer cannot review itself",
    }],
  });
});

test("pack validate prints a text summary for a valid pack", async () => {
  // Break caught: successful validation must expose the loaded pack identity and agent count to people.
  const result = await runCli(["pack", "validate", validPack]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "Pack example.laravel@1.2.3 validated (1 agent)");
  assert.equal(result.stderr, "");
});

test("doctor succeeds on a supported Node version", async () => {
  // Break caught: doctor must recognize the documented minimum Node runtime.
  const result = await runCli(["doctor", "--json"]);
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).checks.node.ok, true);
});

test("doctor reports an unsupported Node version as an environment failure", async () => {
  // Break caught: a runtime below Node 24 must not be reported as usable.
  const result = await runCli(["doctor", "--json"], { nodeVersion: "23.9.0", cwd: process.cwd() });
  assert.equal(result.exitCode, 4);
  assert.deepEqual(JSON.parse(result.stderr).checks.node, { ok: false, version: "23.9.0", required: ">=24" });
});

test("unknown input returns a usage failure", async () => {
  // Break caught: unrecognized commands must not silently succeed.
  const result = await runCli(["pack"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /Usage: engineer/);
});
