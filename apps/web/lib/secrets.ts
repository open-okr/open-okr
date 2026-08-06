import { type KeyRing, newRootKey, parseKeyRing } from "@openokr/core";

/**
 * The process-wide key ring (P1-T09).
 *
 * `OPENOKR_ENCRYPTION_KEY` is the root key. In production it is required: an
 * instance that starts without one cannot read the credentials it stored, and
 * would happily write new ones under a key that vanishes at the next restart.
 * That is worse than not starting.
 *
 * Development gets a generated key so a fresh checkout runs. It changes on
 * every restart, so anything sealed with it becomes unreadable, which is the
 * right trade for a machine that has no real credentials on it. Anyone who
 * wants stable local secrets sets the variable.
 */
const globals = globalThis as typeof globalThis & {
  openokrKeyRing?: KeyRing;
};

class MissingEncryptionKeyError extends Error {
  constructor() {
    super(
      "OPENOKR_ENCRYPTION_KEY is not set. Stored credentials cannot be read " +
        "or written without it. Generate one with: openssl rand -base64 32",
    );
    this.name = "MissingEncryptionKeyError";
  }
}

export function getKeyRing(): KeyRing {
  if (globals.openokrKeyRing) {
    return globals.openokrKeyRing;
  }

  const current = process.env.OPENOKR_ENCRYPTION_KEY;

  if (!current) {
    if (process.env.NODE_ENV === "production") {
      throw new MissingEncryptionKeyError();
    }
    // Announced, because a secret that silently changes on restart is
    // confusing to debug if you did not expect it.
    process.stdout.write(
      "openokr: no OPENOKR_ENCRYPTION_KEY set. Using a key generated for this " +
        "process; anything sealed with it will not survive a restart.\n",
    );
    globals.openokrKeyRing = parseKeyRing({ current: newRootKey() });
    return globals.openokrKeyRing;
  }

  const previous = (process.env.OPENOKR_PREVIOUS_ENCRYPTION_KEYS ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key !== "");

  globals.openokrKeyRing = parseKeyRing({ current, previous });
  return globals.openokrKeyRing;
}
