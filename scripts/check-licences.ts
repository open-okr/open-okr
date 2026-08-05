#!/usr/bin/env node
/**
 * The dependency licence gate.
 *
 * OpenOKR ships under AGPL-3.0. A dependency under an incompatible licence
 * cannot be distributed with it, so this fails the build rather than letting the
 * problem reach a release. Licence changes are a human decision: when this gate
 * fires, ask, do not add to the allow list on your own.
 *
 * Reads `pnpm licenses list --json`, so it needs no extra dependency.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Permissive and weak-copyleft licences that can ship inside an AGPL work. */
const ALLOWED = new Set([
  "0BSD",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "Artistic-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC-BY-4.0",
  "CC0-1.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MPL-2.0",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
]);

/** Packages cleared by a human despite an unrecognised licence field. Each needs
 * a reason. Keep this list short and audited. */
const EXCEPTIONS = new Map<string, string>();

interface PnpmLicensePackage {
  name: string;
  versions: string[];
}

type PnpmLicensesOutput = Record<string, PnpmLicensePackage[]>;

const { stdout } = await run("pnpm", ["licenses", "list", "--json", "--prod"], {
  maxBuffer: 32 * 1024 * 1024,
});

const byLicence = JSON.parse(stdout) as PnpmLicensesOutput;
const violations: string[] = [];

for (const [licence, packages] of Object.entries(byLicence)) {
  if (ALLOWED.has(licence)) {
    continue;
  }

  for (const pkg of packages) {
    if (EXCEPTIONS.has(pkg.name)) {
      continue;
    }
    violations.push(`  ${pkg.name}@${pkg.versions.join(", ")} is ${licence}`);
  }
}

if (violations.length > 0) {
  process.stderr.write(
    [
      `Licence gate failed. ${violations.length} dependency licence(s) are not on the allow list:`,
      ...violations,
      "",
      "AGPL-3.0 cannot distribute every licence. Ask a human before changing this list.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

process.stdout.write(
  `Licence gate passed. ${Object.keys(byLicence).length} distinct licence(s), all allowed.\n`,
);
