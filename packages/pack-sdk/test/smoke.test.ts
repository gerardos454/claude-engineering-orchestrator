import test from "node:test";
import assert from "node:assert/strict";
import { sdkVersion } from "../src/index.js";

test("exports a stable SDK version", () => {
  assert.equal(sdkVersion, "0.1.0");
});
