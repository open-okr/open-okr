/**
 * The probes behind the wizard's connection tests (P1-T09).
 *
 * Kept apart from the framework so the framework stays testable without a
 * database or a mail server.
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
 * Chat channels, which a deployment never needs (completeness review H-24).
 *
 * This said "Not in this build. Arrives in Phase 5" from P1-T09 onwards,
 * long after Slack, Teams, WhatsApp and Telegram all shipped: the first thing
 * every self-hoster read told them half the product was missing. Channels are
 * connected per workspace, after setup, so at this point nothing is connected
 * and nothing needs to be. Optional is the true answer, and it is not a tick:
 * nothing was tested.
 */
export function channelsProbe(): ConnectionProbe {
  return {
    port: "channel",
    async run() {
      return {
        outcome: "optional" as const,
        detail:
          "Connected per workspace after setup, in Admin > Channels: Slack, Microsoft Teams, WhatsApp and Telegram. Email and the browser cover everything without one.",
      };
    },
  };
}

export interface AIProbeOptions {
  /** The provider the deployment names for every workspace, or "" for none. */
  readonly provider: string;
  /** Whether that provider has what it needs to be called. */
  readonly configured: boolean;
}

/**
 * The AI provider, which a deployment never needs either (H-24).
 *
 * Said "Not in this build. Arrives in Phase 6", while six providers had
 * shipped in Phase 2. A deployment-wide provider is reported by name and not
 * called: a paid request to prove a key works is not something a setup page
 * should spend, and "configured" is exactly what is known. With none, the
 * answer is that every feature works without one, which is the product's own
 * rule.
 */
export function aiProbe(options: AIProbeOptions): ConnectionProbe {
  return {
    port: "ai",
    async run() {
      if (options.provider !== "" && options.configured) {
        return {
          outcome: "optional" as const,
          detail: `${options.provider} is configured for every workspace. It is first called when somebody uses an assist, and each workspace can choose its own in Admin > AI.`,
        };
      }
      return {
        outcome: "optional" as const,
        detail:
          "Off. Every feature works without one, and the Coach and the Champion run in their deterministic form. Add Anthropic, OpenAI, Google, OpenRouter, a local Ollama or any OpenAI-compatible endpoint in Admin > AI.",
      };
    },
  };
}
