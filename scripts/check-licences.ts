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
import { isLicenceAllowed } from "../packages/config/src/licence-policy.ts";

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
  // MIT No Attribution: MIT without the attribution clause, so it grants
  // strictly more than MIT, which is already here. Added with nodemailer in
  // P1-T09, approved 2026-08-06.
  "MIT-0",
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
  // Licence fields are SPDX expressions, not always bare identifiers:
  // "MIT OR CC0-1.0" lets us choose, "MIT AND CC-BY-4.0" binds us to both.
  if (isLicenceAllowed(licence, ALLOWED)) {
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
