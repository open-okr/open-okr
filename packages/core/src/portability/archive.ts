/**
 * The archive format (TECHNICAL-PLAN §7.3, P6-T05a).
 *
 * **A stream of records, gzipped, then sealed, behind one plaintext header
 * line.** Written out:
 *
 * ```
 * {"format":"openokr-archive","version":1,...}\n
 * <sealed bytes>
 * ```
 *
 * The header is JSON and plaintext because the receiving instance needs three
 * things before it can decrypt: which format this is, the data key wrapped
 * under a root key, and a digest it can check before spending time on a file
 * that is truncated. Nothing in the header is a secret. The data key is
 * useless without a root key the reader must already hold.
 *
 * **Compress, then encrypt.** The other order is a mistake: sealed bytes are
 * indistinguishable from random and do not compress, so gzip after AES buys
 * nothing and costs a pass.
 *
 * **Records rather than a container.** There is no tar and no zip in Node's
 * standard library, and CLAUDE.md requires asking before a new runtime
 * dependency. Newline-delimited JSON needs neither: one record per line, the
 * manifest first so a reader knows what is coming, an `end` record last so a
 * truncated file is detectable even after the digest passes. A blob's bytes
 * are base64 on their own line, which inflates them by a third before gzip
 * takes most of it back.
 *
 * **Built in memory, with a ceiling that refuses rather than dies.** A
 * streaming writer is the right long-term shape: gzip into a cipher into a
 * file. It needs its own framing, because AES-GCM's authentication tag arrives
 * after the last byte and cannot go in a header written first. Until then this
 * assembles the archive and refuses one over `MAX_ARCHIVE_BYTES`, naming the
 * figure, which is a refusal somebody can act on rather than a process that
 * runs out of memory holding somebody's workspace.
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  type KeyRing,
  openBytes,
  type SealedBytes,
  sealBytes,
} from "../secrets/key-ring.ts";

export const ARCHIVE_FORMAT = "openokr-archive";

/**
 * The format version, and what changing it means.
 *
 * An import refuses a version it does not know rather than guessing. Bumping
 * this is a decision to break older readers, so it goes with a note here
 * saying what moved.
 */
export const ARCHIVE_VERSION = 1;

/**
 * 512 MiB of assembled archive.
 *
 * Not a product setting: it is what this implementation can hold, and the
 * workspace byte quota (§4.14, 5 GiB by default) is deliberately larger. An
 * export over this refuses by name, which is the honest answer until the
 * streaming writer lands.
 */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveError";
  }
}

/** What the archive says about itself, before any row. */
export interface ArchiveManifest {
  readonly format: typeof ARCHIVE_FORMAT;
  readonly version: number;
  /** When it was written. */
  readonly createdAt: string;
  /** The newest applied migration, so an import can refuse a newer archive. */
  readonly schemaVersion: string;
  /** Which instance wrote it, as a fingerprint. Never a secret or a hostname. */
  readonly instance: string;
  readonly workspace: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
  };
  /** Rows per table, counted before the first one was written. */
  readonly counts: Readonly<Record<string, number>>;
  /** How many blobs, and how many bytes they hold. */
  readonly blobs: { readonly count: number; readonly bytes: number };
  /** The tables this archive carries, in the order they appear. */
  readonly tables: readonly string[];
  /** Columns an import writes in a second pass. */
  readonly deferredColumns: readonly string[];
}

export type ArchiveRecord =
  | { readonly r: "manifest"; readonly manifest: ArchiveManifest }
  | {
      readonly r: "row";
      readonly t: string;
      readonly d: Record<string, unknown>;
    }
  | { readonly r: "blob"; readonly id: string; readonly b: string }
  | { readonly r: "end"; readonly rows: number; readonly blobs: number };

/** The plaintext line in front of the sealed body. */
interface ArchiveHeader {
  readonly format: typeof ARCHIVE_FORMAT;
  readonly version: number;
  readonly cipher: "aes-256-gcm";
  /** The data key, wrapped under the writing instance's root key. Base64. */
  readonly dataKey: string;
  readonly keyId: string;
  /** SHA-256 of the sealed bytes, hex. Checked before decrypting. */
  readonly digest: string;
  readonly bytes: number;
}

/** One record as a line, so the writer and the reader share one encoding. */
const encodeRecord = (record: ArchiveRecord): string =>
  `${JSON.stringify(record)}\n`;

export interface WriteArchiveResult {
  readonly bytes: Buffer;
  readonly header: ArchiveHeader;
  /** SHA-256 of the whole file, hex, which is what a person is given to check. */
  readonly digest: string;
}

/**
 * Seals a run of records into an archive.
 *
 * The records arrive already ordered: the manifest, then rows in the policy
 * list's order, then blobs, then `end`. This does not reorder them, because
 * the order is the load order and the caller is the only thing that knows it.
 */
export function writeArchive(
  ring: KeyRing,
  records: readonly ArchiveRecord[],
): WriteArchiveResult {
  if (records[0]?.r !== "manifest") {
    throw new ArchiveError("An archive begins with its manifest.");
  }
  if (records[records.length - 1]?.r !== "end") {
    throw new ArchiveError(
      "An archive ends with an end record, so a truncated one can be told from a short one.",
    );
  }

  const body = Buffer.from(records.map(encodeRecord).join(""), "utf8");
  const compressed = gzipSync(body, { level: 9 });
  const sealed = sealBytes(ring, compressed);

  const header: ArchiveHeader = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    cipher: "aes-256-gcm",
    dataKey: sealed.dataKey,
    keyId: sealed.keyId,
    digest: createHash("sha256").update(sealed.ciphertext).digest("hex"),
    bytes: sealed.ciphertext.byteLength,
  };

  const bytes = Buffer.concat([
    Buffer.from(`${JSON.stringify(header)}\n`, "utf8"),
    sealed.ciphertext,
  ]);
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ArchiveError(
      `This archive is ${bytes.byteLength} bytes, over the ${MAX_ARCHIVE_BYTES} byte limit this writer holds in memory. ` +
        "Nothing was written. A streaming writer is the fix; until then, an archive this large has to be taken from a database backup instead.",
    );
  }

  return {
    bytes,
    header,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

export interface ReadArchiveResult {
  readonly header: ArchiveHeader;
  readonly manifest: ArchiveManifest;
  readonly records: readonly ArchiveRecord[];
}

/**
 * Opens an archive, refusing every way it can be wrong before trusting any of
 * it.
 *
 * In order: the header parses, the format and version are ones this knows, the
 * digest matches the sealed bytes, the seal authenticates, the body
 * decompresses, the first record is a manifest and the last is an `end` whose
 * counts match what was actually read. A file that fails any of these is
 * refused by name rather than half-imported.
 */
export function readArchive(ring: KeyRing, bytes: Buffer): ReadArchiveResult {
  const newline = bytes.indexOf(0x0a);
  if (newline === -1) {
    throw new ArchiveError(
      "This file has no header line, so it is not an OpenOKR archive.",
    );
  }

  let header: ArchiveHeader;
  try {
    header = JSON.parse(bytes.subarray(0, newline).toString("utf8"));
  } catch {
    throw new ArchiveError("This archive's header is not readable JSON.");
  }
  if (header.format !== ARCHIVE_FORMAT) {
    throw new ArchiveError(
      `This file says it is "${String(header.format)}" and not an OpenOKR archive.`,
    );
  }
  if (header.version !== ARCHIVE_VERSION) {
    throw new ArchiveError(
      `This archive is format version ${String(header.version)} and this instance reads version ${ARCHIVE_VERSION}. ` +
        "A newer archive needs a newer instance; an older one needs the release that wrote it.",
    );
  }

  const ciphertext = bytes.subarray(newline + 1);
  if (ciphertext.byteLength !== header.bytes) {
    throw new ArchiveError(
      `This archive says it holds ${String(header.bytes)} sealed bytes and holds ${ciphertext.byteLength}. It was truncated or something was appended to it.`,
    );
  }
  const digest = createHash("sha256").update(ciphertext).digest("hex");
  if (digest !== header.digest) {
    throw new ArchiveError(
      "This archive's contents do not match the digest in its header. It was altered or damaged after it was written.",
    );
  }

  const sealed: SealedBytes = {
    ciphertext,
    dataKey: header.dataKey,
    keyId: header.keyId,
  };
  // `openBytes` throws a KeyRingError naming the missing key or the failed
  // authentication check, which is more use than anything this could add.
  const compressed = openBytes(ring, sealed);

  let body: Buffer;
  try {
    body = gunzipSync(compressed);
  } catch {
    throw new ArchiveError(
      "This archive opened but its contents did not decompress, which should be impossible once the seal has authenticated. Treat the file as damaged.",
    );
  }

  const records: ArchiveRecord[] = [];
  for (const [index, line] of body.toString("utf8").split("\n").entries()) {
    if (line === "") {
      continue;
    }
    try {
      records.push(JSON.parse(line) as ArchiveRecord);
    } catch {
      throw new ArchiveError(
        `Record ${index + 1} in this archive is not readable JSON.`,
      );
    }
  }

  const first = records[0];
  if (first?.r !== "manifest") {
    throw new ArchiveError("This archive does not begin with a manifest.");
  }
  const last = records[records.length - 1];
  if (last?.r !== "end") {
    throw new ArchiveError(
      "This archive has no end record, so it was cut short while it was being written.",
    );
  }

  const rows = records.filter((record) => record.r === "row").length;
  const blobs = records.filter((record) => record.r === "blob").length;
  if (rows !== last.rows || blobs !== last.blobs) {
    throw new ArchiveError(
      `This archive says it holds ${last.rows} rows and ${last.blobs} files, and holds ${rows} and ${blobs}.`,
    );
  }

  return { header, manifest: first.manifest, records };
}
