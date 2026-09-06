/**
 * The probes behind the wizard's connection tests (P1-T09).
 *
 * Kept apart from the framework so the framework stays testable without a
 * database or a mail server, and so adding the channel and AI probes in
 * Phase 5 and Phase 6 is one file each.
 */
import type { Pool } from "pg";
import type { ConnectionProbe } from "./connection-tests.ts";

/**
 * Proves the database answers, and that migrations have run.
 *
 * Checking for a known table as well as connectivity is deliberate. A wizard
 * that connects to an empty database and reports success sends the operator on
 * to a step that fails with a missing relation, which reads as a product fault
 * rather than a setup one.
 */
export function databaseProbe(pool: Pool): ConnectionProbe {
  return {
    port: "database",
    async run() {
      const version = await pool.query<{ server: string }>(
        "select version() as server",
      );
      const migrated = await pool.query<{ present: boolean }>(
        "select to_regclass('public.workspaces') is not null as present",
      );

      if (migrated.rows[0]?.present !== true) {
        return {
          outcome: "failed" as const,
          detail:
            "Connected, but the schema is missing. Migrations have not run against this database.",
        };
      }

      // The first two words: "PostgreSQL 17.2". The rest is build detail an
      // operator does not need in a wizard.
      const server = (version.rows[0]?.server ?? "PostgreSQL")
        .split(" ")
        .slice(0, 2)
        .join(" ");

      return { outcome: "ok" as const, detail: `Connected to ${server}.` };
    },
  };
}

export interface MailProbeOptions {
  /** False when the transport is 'console', which needs no server. */
  readonly configured: boolean;
  /** Opens a connection and completes the handshake. Sends nothing. */
  readonly verify?: () => Promise<
    { ok: true } | { ok: false; message: string }
  >;
  readonly host?: string;
}

/**
 * Proves the mail server accepts a connection, without sending anything.
 *
 * The console transport reports `ok` rather than `unavailable`: it is a real,
 * working default, not a missing driver. An instance with no SMTP server is
 * correctly configured, and the wizard should say so plainly rather than
 * showing a warning for the state most fresh installs are in.
 */
export function mailProbe(options: MailProbeOptions): ConnectionProbe {
  return {
    port: "mail",
    async run() {
      if (!options.configured) {
        return {
          outcome: "ok" as const,
          detail:
            "No mail server configured. Mail is written to the log and delivery stays in the in-app inbox.",
        };
      }
      if (!options.verify) {
        return {
          outcome: "unavailable" as const,
          detail: "This build has no SMTP driver.",
        };
      }

      const result = await options.verify();
      return result.ok
        ? {
            outcome: "ok" as const,
            detail: `Connected to ${options.host ?? "the mail server"}.`,
          }
        : { outcome: "failed" as const, detail: result.message };
    },
  };
}

export interface StorageProbeOptions {
  /**
   * What the operator is looking at: "local disk at storage", or the bucket
   * and the service. Never a credential; it goes on a screen and in a log.
   */
  readonly describe: () => string;
  /**
   * Writes a probe object and removes it again.
   *
   * A write rather than a read, because a read proves nothing an operator
   * cares about: the failures worth catching here are an unwritable directory,
   * a bucket that does not exist and a key pair that cannot put. All three
   * would otherwise surface as a broken upload later, which reads as a product
   * fault rather than a setup one.
   */
  readonly verify: () => Promise<void>;
}

/**
 * Proves files can actually be stored (P6-G05).
 *
 * Local disk reports `ok` rather than `unavailable` for the same reason the
 * console mail transport does: it is a real, working default and the state
 * most fresh installs are in, not a missing driver.
 */
export function storageProbe(options: StorageProbeOptions): ConnectionProbe {
  return {
    port: "storage",
    async run() {
      const where = options.describe();
      try {
        await options.verify();
        return {
          outcome: "ok" as const,
          detail: `Wrote and removed a test file: ${where}.`,
        };
      } catch (error) {
        return {
          outcome: "failed" as const,
          // The driver's own message, which for S3 names the bucket or the
          // permission. Credentials never reach it: the SDK reports the
          // operation, not the key.
          detail: `Could not write to ${where}. ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    },
  };
}

/**
 * A port with no driver in this build.
 *
 * Channels land in Phase 5 and the AI providers in Phase 6. Until then the
 * wizard says so, rather than showing a tick for something it never tested.
 * The tasks that add those drivers replace this with a real probe.
 */
export function notInThisBuild(
  port: string,
  arrivesIn: string,
): ConnectionProbe {
  return {
    port,
    async run() {
      return {
        outcome: "unavailable" as const,
        detail: `Not in this build. Arrives in ${arrivesIn}.`,
      };
    },
  };
}
