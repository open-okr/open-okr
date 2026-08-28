#!/usr/bin/env node
/**
 * The `okr` entry point (P5-T07c-a).
 *
 * Everything it does is in `run`. This turns a process into a function call and
 * back, which is the only thing a bin should do: a test that has to spawn a
 * process to check a flag refusal is a test nobody runs.
 */
import { run } from "../run.ts";

const result = await run(process.argv.slice(2));
if (result.out !== "") {
  process.stdout.write(`${result.out}\n`);
}
if (result.err !== "") {
  process.stderr.write(`${result.err}\n`);
}
process.exit(result.code);
