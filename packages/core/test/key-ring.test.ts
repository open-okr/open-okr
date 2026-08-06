import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  KeyRingError,
  newRootKey,
  parseKeyRing,
  rewrapSecret,
  rootKeyFingerprint,
} from "../src/secrets/key-ring.ts";

/**
 * Envelope encryption for instance secrets (TECHNICAL-PLAN §8.2).
 *
 * The wizard stores SMTP credentials, and a hard rule says provider keys and
 * channel credentials are envelope-encrypted and never logged. Envelope means
 * two levels: a fresh data key encrypts the secret, and a root key from the
 * environment encrypts the data key. Rotation re-wraps data keys only, so
 * rotating never rewrites, re-encrypts or even reads the secrets themselves.
 */

const ROOT = newRootKey();

describe("the root key", () => {
  it("is generated at a usable length and encoded for an environment variable", () => {
    // 32 bytes, base64. Anything shorter is not a 256-bit key.
    expect(Buffer.from(ROOT, "base64")).toHaveLength(32);
  });

  it("is different every time, so two instances never share one", () => {
    expect(newRootKey()).not.toBe(newRootKey());
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => parseKeyRing({ current: "dG9vLXNob3J0" })).toThrow(
      KeyRingError,
    );
  });

  it("refuses a key that is not base64 at all", () => {
    expect(() => parseKeyRing({ current: "not base64 !!" })).toThrow(
      KeyRingError,
    );
  });

  it("identifies itself by fingerprint, never by value", () => {
    const fingerprint = rootKeyFingerprint(ROOT);
    // Short, stable, and not reversible: it names a key in logs and in the
    // ciphertext envelope without disclosing it.
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint).toBe(rootKeyFingerprint(ROOT));
    expect(fingerprint).not.toContain(ROOT.slice(0, 8));
  });
});

describe("encrypting a secret", () => {
  it("round-trips", () => {
    const ring = parseKeyRing({ current: ROOT });
    const sealed = encryptSecret(ring, "hunter2");
    expect(decryptSecret(ring, sealed)).toBe("hunter2");
  });

  it("round-trips an empty string, which is a real value and not absence", () => {
    const ring = parseKeyRing({ current: ROOT });
    expect(decryptSecret(ring, encryptSecret(ring, ""))).toBe("");
  });

  it("round-trips characters outside Latin-1", () => {
    const ring = parseKeyRing({ current: ROOT });
    const secret = "pásswörd-日本語-🔐";
    expect(decryptSecret(ring, encryptSecret(ring, secret))).toBe(secret);
  });

  it("never contains the plaintext", () => {
    const ring = parseKeyRing({ current: ROOT });
    const sealed = encryptSecret(ring, "hunter2");
    expect(JSON.stringify(sealed)).not.toContain("hunter2");
  });

  it("never contains the root key", () => {
    const ring = parseKeyRing({ current: ROOT });
    const sealed = encryptSecret(ring, "hunter2");
    expect(JSON.stringify(sealed)).not.toContain(ROOT);
  });

  it("produces different ciphertext for the same plaintext each time", () => {
    // A fresh data key and nonce per secret. Identical ciphertext for
    // identical input would leak which settings share a value.
    const ring = parseKeyRing({ current: ROOT });
    const first = encryptSecret(ring, "same");
    const second = encryptSecret(ring, "same");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.dataKey).not.toBe(second.dataKey);
  });

  it("records which root key sealed it, so rotation knows what to re-wrap", () => {
    const ring = parseKeyRing({ current: ROOT });
    expect(encryptSecret(ring, "x").keyId).toBe(rootKeyFingerprint(ROOT));
  });
});

/** Flips one byte of a base64 blob, standing in for corruption at rest. */
const flipByte = (encoded: string, index: number): string => {
  const bytes = Buffer.from(encoded, "base64");
  const at = index < 0 ? bytes.length + index : index;
  bytes.writeUInt8(bytes.readUInt8(at) ^ 0xff, at);
  return bytes.toString("base64");
};

describe("tampering", () => {
  it("refuses ciphertext altered after sealing", () => {
    const ring = parseKeyRing({ current: ROOT });
    const sealed = encryptSecret(ring, "hunter2");
    expect(() =>
      decryptSecret(ring, {
        ...sealed,
        ciphertext: flipByte(sealed.ciphertext, -1),
      }),
    ).toThrow(KeyRingError);
  });

  it("refuses a data key altered after sealing", () => {
    const ring = parseKeyRing({ current: ROOT });
    const sealed = encryptSecret(ring, "hunter2");
    expect(() =>
      decryptSecret(ring, { ...sealed, dataKey: flipByte(sealed.dataKey, 0) }),
    ).toThrow(KeyRingError);
  });

  it("refuses a secret sealed by a key the ring does not hold", () => {
    const sealed = encryptSecret(parseKeyRing({ current: newRootKey() }), "x");
    const other = parseKeyRing({ current: ROOT });
    expect(() => decryptSecret(other, sealed)).toThrow(KeyRingError);
  });

  it("names the missing key by fingerprint so an operator can find it", () => {
    const stranger = newRootKey();
    const sealed = encryptSecret(parseKeyRing({ current: stranger }), "x");
    const ring = parseKeyRing({ current: ROOT });
    expect(() => decryptSecret(ring, sealed)).toThrow(
      new RegExp(rootKeyFingerprint(stranger)),
    );
  });
});

describe("rotation", () => {
  it("reads a secret sealed by a retired key that is still on the ring", () => {
    // The whole point of a ring: rotating the root key must not make every
    // stored secret unreadable the moment the new key is installed.
    const previous = ROOT;
    const current = newRootKey();
    const sealedBefore = encryptSecret(
      parseKeyRing({ current: previous }),
      "s",
    );

    const ring = parseKeyRing({ current, previous: [previous] });
    expect(decryptSecret(ring, sealedBefore)).toBe("s");
  });

  it("re-wraps to the current key without touching the ciphertext", () => {
    const previous = ROOT;
    const current = newRootKey();
    const before = encryptSecret(parseKeyRing({ current: previous }), "s");
    const ring = parseKeyRing({ current, previous: [previous] });

    const after = rewrapSecret(ring, before);

    // The data key is re-wrapped; the secret's own ciphertext is untouched.
    // That is what makes rotation cheap and non-destructive.
    expect(after.ciphertext).toBe(before.ciphertext);
    expect(after.dataKey).not.toBe(before.dataKey);
    expect(after.keyId).toBe(rootKeyFingerprint(current));
    expect(decryptSecret(ring, after)).toBe("s");
  });

  it("leaves a secret already on the current key alone", () => {
    const ring = parseKeyRing({ current: ROOT });
    const sealed = encryptSecret(ring, "s");
    expect(rewrapSecret(ring, sealed)).toEqual(sealed);
  });

  it("cannot be read by the retired key once it has been re-wrapped", () => {
    const previous = ROOT;
    const current = newRootKey();
    const before = encryptSecret(parseKeyRing({ current: previous }), "s");
    const after = rewrapSecret(
      parseKeyRing({ current, previous: [previous] }),
      before,
    );

    const retiredOnly = parseKeyRing({ current: previous });
    expect(() => decryptSecret(retiredOnly, after)).toThrow(KeyRingError);
  });
});

describe("what an error may say", () => {
  it("never puts key material in the message", () => {
    const ring = parseKeyRing({ current: ROOT });
    const sealed = encryptSecret(ring, "hunter2");
    const failure = (() => {
      try {
        decryptSecret(parseKeyRing({ current: newRootKey() }), {
          ...sealed,
          keyId: rootKeyFingerprint(ROOT),
        });
        return "";
      } catch (error) {
        return String(error);
      }
    })();

    expect(failure).not.toContain(ROOT);
    expect(failure).not.toContain("hunter2");
    expect(failure).not.toContain(sealed.dataKey);
  });
});
