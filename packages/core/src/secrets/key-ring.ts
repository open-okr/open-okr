/**
 * Envelope encryption for instance secrets (TECHNICAL-PLAN §8.2).
 *
 * Two levels, and the reason for both is rotation:
 *
 *   secret  --sealed by-->  a fresh data key  --wrapped by-->  the root key
 *
 * The root key comes from the environment and never touches the database. Each
 * secret gets its own data key, which is stored beside the ciphertext, wrapped.
 * Rotating the root key therefore re-wraps data keys only: a few hundred bytes
 * per secret, no plaintext ever handled, and nothing to undo if it fails
 * halfway. Encrypting every secret directly under the root key would make
 * rotation a full re-encryption of every credential in the instance.
 *
 * AES-256-GCM at both levels. GCM authenticates as well as encrypts, so a
 * ciphertext altered in the database fails to open rather than decrypting to
 * something else.
 *
 * Nothing here logs, and no error carries key material or plaintext. Errors are
 * read by operators from process output, which is exactly where a secret must
 * never appear.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/** AES-256: 32-byte keys. */
const KEY_BYTES = 32;
/** GCM's standard nonce length. Never reused under one key. */
const NONCE_BYTES = 12;
/** GCM's authentication tag. */
const TAG_BYTES = 16;
/** Half a SHA-256, hex. Long enough to name a key, useless for recovering it. */
const FINGERPRINT_CHARS = 16;

export class KeyRingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyRingError";
  }
}

/** A secret at rest. Every field is safe to store; none is safe to log. */
export interface SealedSecret {
  /** The secret, encrypted under its own data key. Base64. */
  readonly ciphertext: string;
  /** That data key, encrypted under the root key. Base64. */
  readonly dataKey: string;
  /** Fingerprint of the root key that wrapped `dataKey`. Not the key. */
  readonly keyId: string;
}

/** The keys an instance can decrypt with, and the one it encrypts with. */
export interface KeyRing {
  readonly current: { readonly id: string; readonly key: Buffer };
  /** Retired keys, kept so secrets sealed before a rotation still open. */
  readonly previous: ReadonlyMap<string, Buffer>;
}

export interface KeyRingSource {
  readonly current: string;
  readonly previous?: readonly string[];
}

/** A new root key, base64, for an environment variable or the wizard. */
export function newRootKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

/**
 * Names a root key without disclosing it.
 *
 * Sealed secrets carry this so rotation knows which key wrapped them, and so an
 * operator holding several keys can tell which one an instance wants. It is a
 * hash, so it cannot be turned back into the key.
 */
export function rootKeyFingerprint(rootKey: string): string {
  return createHash("sha256")
    .update(decodeKey(rootKey, "root key"))
    .digest("hex")
    .slice(0, FINGERPRINT_CHARS);
}

function decodeKey(value: string, label: string): Buffer {
  // Node's base64 decoder is lenient: it skips characters it does not
  // recognise rather than failing. Round-tripping catches the difference
  // between real base64 and a typo that happens to contain some.
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value.trim()) {
    throw new KeyRingError(`The ${label} is not valid base64.`);
  }
  if (decoded.length !== KEY_BYTES) {
    throw new KeyRingError(
      `The ${label} must be ${KEY_BYTES} bytes, base64 encoded. ` +
        `This one decodes to ${decoded.length}. Generate one with: openssl rand -base64 32`,
    );
  }
  return decoded;
}

/** Builds a ring from raw base64 keys, validating every one. */
export function parseKeyRing(source: KeyRingSource): KeyRing {
  const current = decodeKey(source.current, "root key");
  const previous = new Map<string, Buffer>();

  for (const value of source.previous ?? []) {
    const key = decodeKey(value, "retired root key");
    previous.set(rootKeyFingerprint(value), key);
  }

  return {
    current: { id: rootKeyFingerprint(source.current), key: current },
    previous,
  };
}

function seal(key: Buffer, plaintext: Buffer): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // nonce | tag | body, so opening needs no extra fields.
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
}

function open(key: Buffer, sealed: Buffer, label: string): Buffer {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) {
    throw new KeyRingError(`The ${label} is truncated and cannot be opened.`);
  }
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const tag = sealed.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const body = sealed.subarray(NONCE_BYTES + TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // The original carries no useful detail and risks echoing input, so it is
    // deliberately dropped rather than wrapped.
    throw new KeyRingError(
      `The ${label} failed its authentication check. It was altered after it was written, or the wrong key was used.`,
    );
  }
}

/** Seals a secret: a fresh data key, wrapped by the ring's current root key. */
export function encryptSecret(ring: KeyRing, plaintext: string): SealedSecret {
  const dataKey = randomBytes(KEY_BYTES);
  const ciphertext = seal(dataKey, Buffer.from(plaintext, "utf8"));
  const wrapped = seal(ring.current.key, dataKey);

  return {
    ciphertext: ciphertext.toString("base64"),
    dataKey: wrapped.toString("base64"),
    keyId: ring.current.id,
  };
}

function rootKeyFor(ring: KeyRing, keyId: string): Buffer {
  if (ring.current.id === keyId) {
    return ring.current.key;
  }
  const retired = ring.previous.get(keyId);
  if (retired) {
    return retired;
  }
  throw new KeyRingError(
    `This secret was sealed by root key ${keyId}, which this instance does not hold. ` +
      "Add it to OPENOKR_PREVIOUS_ENCRYPTION_KEYS to read secrets written before the last rotation.",
  );
}

/** Opens a secret. Throws rather than returning a partial result. */
export function decryptSecret(ring: KeyRing, sealed: SealedSecret): string {
  const rootKey = rootKeyFor(ring, sealed.keyId);
  const dataKey = open(
    rootKey,
    Buffer.from(sealed.dataKey, "base64"),
    "wrapped data key",
  );
  return open(
    dataKey,
    Buffer.from(sealed.ciphertext, "base64"),
    "secret",
  ).toString("utf8");
}

/**
 * Moves a secret onto the ring's current root key.
 *
 * This is the whole of key rotation. It unwraps the data key with whichever
 * root key sealed it and wraps it again with the current one. The secret's own
 * ciphertext is copied across untouched, so rotation never decrypts a secret
 * and a half-finished rotation leaves every secret readable.
 */
export function rewrapSecret(
  ring: KeyRing,
  sealed: SealedSecret,
): SealedSecret {
  if (sealed.keyId === ring.current.id) {
    return sealed;
  }

  const dataKey = open(
    rootKeyFor(ring, sealed.keyId),
    Buffer.from(sealed.dataKey, "base64"),
    "wrapped data key",
  );

  return {
    ciphertext: sealed.ciphertext,
    dataKey: seal(ring.current.key, dataKey).toString("base64"),
    keyId: ring.current.id,
  };
}
