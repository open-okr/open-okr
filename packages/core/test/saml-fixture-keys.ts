import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Throwaway signing pairs for the SAML suite (P8-T07c-a).
 *
 * **Generated per run rather than committed, because `.gitignore` refuses
 * `*.pem` and it is right to.** The first version of the suite wrote two pairs
 * into `test/fixtures/saml/` and passed locally; continuous integration could
 * not find them, because they had never been committed and nobody had noticed
 * they were ignored. Forcing them in would put a file called `idp-key.pem`
 * into an open-source repository, which teaches the wrong habit whatever the
 * key is worth, and invites every secret scanner to say so.
 *
 * **It fails rather than skipping when `openssl` is absent.** The importer
 * suites skip themselves without a MySQL and say why, and that is right for an
 * importer. This suite is the one that proves a forged assertion is refused,
 * and a security suite that quietly skips is how a green build comes to prove
 * nothing. If this cannot run, the run should say so.
 */

interface SigningPair {
  readonly certificate: string;
  readonly privateKey: string;
}

export interface SigningPairs {
  /** The pair the workspace configures and trusts. */
  readonly trusted: SigningPair;
  /** A second, valid pair the workspace has never heard of. */
  readonly stranger: SigningPair;
  /** Removes the temporary directory. Call from `afterAll`. */
  readonly cleanUp: () => void;
}

function openssl(args: readonly string[], cwd: string): void {
  try {
    execFileSync("openssl", [...args], { cwd, stdio: "pipe" });
  } catch (error) {
    throw new Error(
      "The SAML suite needs `openssl` on the path to generate its fixture " +
        "certificates. It is not skipped when openssl is missing, because " +
        "this is the suite that proves a forged assertion is refused, and a " +
        "security suite that skips itself is indistinguishable from one that " +
        `passes. Original error: ${(error as Error).message}`,
    );
  }
}

/** Generates both pairs into a temporary directory. */
export function generateSigningPairs(): SigningPairs {
  const dir = mkdtempSync(join(tmpdir(), "openokr-saml-"));

  const make = (name: string, subject: string): SigningPair => {
    openssl(
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-keyout",
        `${name}-key.pem`,
        "-out",
        `${name}-cert.pem`,
        "-days",
        "2",
        "-nodes",
        "-subj",
        subject,
      ],
      dir,
    );
    return {
      certificate: readFileSync(join(dir, `${name}-cert.pem`), "utf8"),
      privateKey: readFileSync(join(dir, `${name}-key.pem`), "utf8"),
    };
  };

  // Two days, because a fixture certificate has no reason to outlive the run
  // that made it and a long-lived one in a temporary directory is a thing
  // somebody will eventually find and wonder about.
  return {
    trusted: make("idp", "/CN=fixture-idp.example"),
    stranger: make("stranger", "/CN=stranger-idp.example"),
    cleanUp: () => rmSync(dir, { recursive: true, force: true }),
  };
}
