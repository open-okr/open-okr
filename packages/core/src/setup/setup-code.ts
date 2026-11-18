/**
 * The setup code that claims a new instance (docs/design/setup-code.md,
 * plan 0.9.0 G1).
 *
 * A new hostname is public within minutes, because every certificate request
 * lands in a public log. Without a proof, whoever reached `/setup` first
 * became the owner. The proof is a code only somebody who can read the
 * deployment's secrets, or the server's storage, can know.
 *
 * Two sources, one compare (D5):
 *
 *   - `OPENOKR_SETUP_CODE` in the environment, which `./openokr up` and the
 *     Helm chart generate (D1)
 *   - a code the server makes at first boot when there is none, of which only
 *     an HMAC is stored, and the code itself goes to a file (D2, D3)
 *
 * **Nothing here logs a code** (D4), and nothing here is a rate limit: the
 * sign-up route already has one, shared by every replica (D9).
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { systemSettings, withInstanceAdmin } from "@openokr/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { SETUP_CODE_HASH } from "../secrets/instance-registry.ts";
import { readSetting } from "../secrets/instance-settings.ts";
import { readSetupState } from "./state.ts";

/** The header a sign-up request carries the code in (D7). */
export const SETUP_CODE_HEADER = "x-openokr-setup-code";

/**
 * No 0, O, 1, I or L, because the code is read off a terminal and typed by a
 * person (D6). Thirty-one characters, twelve places: about 59 bits.
 */
export const SETUP_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const SETUP_CODE_LENGTH = 12;

/** The file a generated code is written to, relative to the storage root. */
export const SETUP_CODE_FILE = "setup-code";

/** Upper case, with spaces and dashes removed (D6). */
export function normaliseSetupCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** Three groups of four, the form a person reads and types (D6). */
export function formatSetupCode(normalised: string): string {
  return normalised.match(/.{1,4}/g)?.join("-") ?? normalised;
}

/**
 * A new code, in its display form. `randomInt` is uniform over the range, so
 * no character is likelier than another.
 */
export function generateSetupCode(): string {
  let code = "";
  for (let i = 0; i < SETUP_CODE_LENGTH; i += 1) {
    code += SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)];
  }
  return formatSetupCode(code);
}

/**
 * HMAC-SHA256 of the normalised code, keyed with the auth secret (D5). A
 * stored hash that also needs the server's secret cannot be brute-forced
 * offline from a copy of the database.
 */
export function hashSetupCode(secret: string, code: string): string {
  return createHmac("sha256", secret)
    .update(`setup-code:${normaliseSetupCode(code)}`)
    .digest("hex");
}

/** Timing-safe on equal-length hex digests, false on any other length. */
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** True when `presented` is the code `expectedHash` was made from. */
export function setupCodeMatches(
  secret: string,
  presented: string,
  expectedHash: string,
): boolean {
  return sameDigest(hashSetupCode(secret, presented), expectedHash);
}

export type SetupCodeVerdict = "ok" | "required" | "wrong";

/**
 * Judges the code a sign-up request carried.
 *
 * With `OPENOKR_SETUP_CODE` set, it alone decides: an operator who changes it
 * because the old one leaked (Q2) must not leave a generated one valid
 * beside it. Otherwise the stored hash decides. With neither in force there
 * is nothing the request could prove, so it is refused as missing: the boot
 * step makes a code before the first request is served, and a missing one
 * means that step failed.
 */
export async function checkSetupCode(
  pool: Pool,
  secret: string,
  presented: string | null | undefined,
  environmentCode?: string,
): Promise<SetupCodeVerdict> {
  const normalised = normaliseSetupCode(presented ?? "");
  if (normalised === "") {
    return "required";
  }

  let expected: string | undefined;
  if (environmentCode && normaliseSetupCode(environmentCode) !== "") {
    expected = hashSetupCode(secret, environmentCode);
  } else {
    const stored = await readSetting(pool, SETUP_CODE_HASH);
    expected = typeof stored === "string" && stored !== "" ? stored : undefined;
  }
  if (!expected) {
    return "required";
  }
  return setupCodeMatches(secret, normalised, expected) ? "ok" : "wrong";
}

/**
 * Where the generated code is written. The local root whatever the storage
 * driver, because the root exists in every container (D3). Absolute, so the
 * wizard can name a path the operator can read.
 */
export function setupCodePath(root?: string): string {
  const base = root ?? (process.env.OPENOKR_STORAGE_ROOT || "storage");
  return resolve(join(base, SETUP_CODE_FILE));
}

export interface PrepareSetupCodeInput {
  readonly secret: string;
  /** The normalised `OPENOKR_SETUP_CODE`, when the deployment set one. */
  readonly environmentCode?: string;
  /** Overrides the storage root. Tests only. */
  readonly storageRoot?: string;
}

export type PrepareSetupCodeResult =
  /** Claimed already, or an account exists: nothing to make. */
  | { readonly outcome: "not-needed" }
  /** The deployment's own code is in force. */
  | { readonly outcome: "environment" }
  /** This process made the code and wrote it to `path`. */
  | { readonly outcome: "made"; readonly path: string }
  /** A code was made earlier or by another process. */
  | { readonly outcome: "exists"; readonly path: string };

/**
 * Makes a setup code when the instance is unclaimed and has none (D2).
 *
 * The insert is `on conflict do nothing` and only the process whose insert
 * won writes the file, so a web and a worker process booting together cannot
 * leave a file that does not match the stored hash. The file is written after
 * the row, so the window in which a row has no file is the winner's own.
 *
 * Unclaimed is the hook's own test: setup unfinished and no account. A
 * claimed instance upgraded to this release is never given a code.
 */
export async function prepareSetupCode(
  pool: Pool,
  input: PrepareSetupCodeInput,
): Promise<PrepareSetupCodeResult> {
  const state = await readSetupState(pool);
  if (state.configured || state.hasUser) {
    return { outcome: "not-needed" };
  }

  const path = setupCodePath(input.storageRoot);

  if (input.environmentCode && input.environmentCode !== "") {
    // The deployment's code decides alone (see `checkSetupCode`), so a
    // generated one left from an earlier boot must go with its file.
    await clearSetupCode(pool, input.storageRoot);
    return { outcome: "environment" };
  }

  const code = generateSetupCode();
  const won = await withInstanceAdmin(drizzle(pool), async (tx) => {
    // openokr:allow-mutation: instance settings are not workspace data, the
    // same reason `writeSettings` gives. The hash is the whole row.
    const inserted = await tx
      .insert(systemSettings)
      .values({
        key: SETUP_CODE_HASH,
        value: hashSetupCode(input.secret, code),
        source: "operator",
      })
      .onConflictDoNothing()
      .returning({ key: systemSettings.key });
    return inserted.length > 0;
  });

  if (!won) {
    return { outcome: "exists", path };
  }

  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${code}\n`, { mode: 0o600 });
  // `mode` is ignored when the file already exists, so set it again.
  await chmod(path, 0o600);
  return { outcome: "made", path };
}

/**
 * Removes the stored hash and the file (D10). Called when setup finishes, and
 * when the deployment's own code replaces a generated one. Absent is fine.
 */
export async function clearSetupCode(
  pool: Pool,
  storageRoot?: string,
): Promise<void> {
  await withInstanceAdmin(drizzle(pool), async (tx) => {
    // openokr:allow-mutation: see `prepareSetupCode`.
    await tx
      .delete(systemSettings)
      .where(eq(systemSettings.key, SETUP_CODE_HASH));
  });
  await rm(setupCodePath(storageRoot), { force: true });
}
