#!/usr/bin/env node
import { main } from "./main.js";

const exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
}, { nodeVersion: process.versions.node, cwd: process.cwd() });

process.exitCode = exitCode;
