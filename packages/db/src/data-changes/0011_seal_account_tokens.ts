/**
 * Seals the identity-provider tokens already stored in plain text
 * (completeness review L-11).
 *
 * Better Auth kept the access token, refresh token and ID token an OIDC
 * provider issued on the `accounts` row, as issued. The application now seals
 * each one on the way in (`packages/core/src/auth/account-token-sealing.ts`)
 * and opens it on the way out, and a value it finds in plain text it reads as
 * it always did. This seals the ones written before that, so nobody has to
 * wait for every person to sign in again before a dump stops carrying them.
 *
 * | Value in a token column | This script |
 * |---|---|
 * | Null, or empty (what the SAML path stores) | Left alone. Nothing to protect |
 * | Starts `openokr-sealed:v1:` | Left alone. Already sealed |
 * | Anything else | Sealed under the current root key |
 *
 * **The seal is written out here rather than imported from `packages/core`**,
 * for the reason 0006 gives: `packages/db` cannot depend on `packages/core`,
 * and a data change runs against its own moment rather than whatever the
 * application later becomes. It is the envelope `key-ring.ts` writes, byte for
 * byte: a fresh data key seals the token with AES-256-GCM, the root key seals
 * the data key, and the root key's fingerprint names it. The application's
 * own test opens what this script sealed, through the same reader a sign-in
 * uses, so the two cannot drift apart unnoticed.
 *
 * **It needs `OPENOKR_ENCRYPTION_KEY`, and only when there is something to
 * seal.** An instance nobody has signed into through OIDC completes with no
 * key at all. One that has refuses loudly rather than skip, because a
 * finished ledger row would say the tokens are sealed when they are not.
 *
 * Batched by a keyset on `accounts.id`. Idempotent by predicate, since a
 * sealed value is never selected again. Each row is written only while its
 * tokens are still the ones read: a sign-in in between has already sealed
 * fresh ones, and those must not be replaced with the old ones.
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import {
  type DataChangeBatchResult,
  type DataChangeClient,
  DataChangeError,
  type DataChangeScript,
} from "../data-change.ts";

const BATCH_SIZE = 200;
const PREFIX = "openokr-sealed:v1:";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const FINGERPRINT_CHARS = 16;

const COLUMNS = ["access_token", "refresh_token", "id_token"] as const;
type Column = (typeof COLUMNS)[number];

interface Candidate {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  id_token: string | null;
  /** `DataChangeClient.query` rows are open records. */
  [column: string]: unknown;
}

/** nonce | tag | body, the layout `key-ring.ts` opens. */
const sealWith = (key: Buffer, plaintext: Buffer): Buffer => {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]);
};

interface RootKey {
  readonly key: Buffer;
  readonly id: string;
}

/**
 * The root key, validated the way `key-ring.ts` validates it. The error never
 * carries the value.
 */
const readRootKey = (value: string | undefined): RootKey => {
  if (!value) {
    throw new DataChangeError(
      "0011_seal_account_tokens found identity-provider tokens stored in " +
        "plain text and has no key to seal them with. Set " +
        "OPENOKR_ENCRYPTION_KEY to the instance's root key and run it again.",
    );
  }
  const key = Buffer.from(value, "base64");
  if (key.toString("base64") !== value.trim() || key.length !== KEY_BYTES) {
    throw new DataChangeError(
      "OPENOKR_ENCRYPTION_KEY is not a base64 encoded 32-byte key, so " +
        "0011_seal_account_tokens cannot seal with it.",
    );
  }
  return {
    key,
    id: createHash("sha256")
      .update(key)
      .digest("hex")
      .slice(0, FINGERPRINT_CHARS),
  };
};

const seal = (root: RootKey, token: string): string => {
  const dataKey = randomBytes(KEY_BYTES);
  const ciphertext = sealWith(dataKey, Buffer.from(token, "utf8"));
  const wrapped = sealWith(root.key, dataKey);
  return `${PREFIX}${root.id}:${wrapped.toString("base64")}:${ciphertext.toString("base64")}`;
};

const needsSealing = (value: string | null): value is string =>
  value !== null && value !== "" && !value.startsWith(PREFIX);

/**
 * The script, given the root key it seals under.
 *
 * `pnpm db:change` passes `OPENOKR_ENCRYPTION_KEY` from the environment. The
 * key is read only when a batch finds a token to seal.
 */
export function sealAccountTokens(
  rootKey: string | undefined,
): DataChangeScript {
  let root: RootKey | undefined;

  return {
    name: "0011_seal_account_tokens",
    summary:
      "Seals the identity-provider tokens on accounts that were stored in plain text, under the instance's root key.",
    expects: [
      { table: "accounts", column: "id", dataType: "text" },
      { table: "accounts", column: "access_token", dataType: "text" },
      { table: "accounts", column: "refresh_token", dataType: "text" },
      { table: "accounts", column: "id_token", dataType: "text" },
    ],
    async runBatch(
      client: DataChangeClient,
      cursor: string | null,
    ): Promise<DataChangeBatchResult> {
      const plain = (column: Column) =>
        `(${column} <> '' and ${column} not like '${PREFIX}%')`;
      const { rows } = await client.query<Candidate>(
        `select id, access_token, refresh_token, id_token
           from accounts
          where (${COLUMNS.map(plain).join(" or ")})
            and ($1::text is null or id > $1::text)
          order by id
          limit $2`,
        [cursor, BATCH_SIZE],
      );

      let changed = 0;
      for (const row of rows) {
        root ??= readRootKey(rootKey);
        const key = root;
        const next = COLUMNS.map((column) => {
          const value = row[column];
          return needsSealing(value) ? seal(key, value) : value;
        });
        // Written only while all three are still what was read.
        const { rows: updated } = await client.query<{ id: string }>(
          `update accounts
              set access_token = $2, refresh_token = $3, id_token = $4
            where id = $1
              and access_token is not distinct from $5
              and refresh_token is not distinct from $6
              and id_token is not distinct from $7
          returning id`,
          [row.id, ...next, row.access_token, row.refresh_token, row.id_token],
        );
        changed += updated.length;
      }

      const last = rows.at(-1);
      return {
        done: rows.length < BATCH_SIZE,
        ...(last ? { cursor: last.id } : {}),
        rowsChanged: changed,
      };
    },
  };
}
