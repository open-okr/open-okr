import { z } from "zod";

/**
 * The environment contract for every OpenOKR process: the web app, the outbox
 * relay, the importers and the command line.
 *
 * Two rules govern this file:
 *
 * 1. Everything that can have a working default has one. `DATABASE_URL` is the
 *    single exception, because there is no sane default for someone else's
 *    database.
 * 2. Errors name the variable and never repeat its value, because these
 *    variables hold credentials and boot errors end up in logs.
 */

/** Treats a blank or whitespace-only variable as absent, which is how shells and
 * container runtimes usually deliver "unset". */
const required = (schema: z.ZodType<string>) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema,
  );

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema,
  );

/**
 * The development stand-in for `BETTER_AUTH_SECRET`. Deliberately obvious:
 * it names itself in logs and error messages, and production refuses to boot
 * with it. Generating a random secret at boot instead would silently log
 * everyone out on restart and hide the misconfiguration rather than surface
 * it (TECHNICAL-PLAN §8.2, "startup refusal of placeholder secrets").
 */
export const DEVELOPMENT_AUTH_SECRET = "openokr-insecure-development-secret";

/**
 * Falls back to a value that changes on every process start when
 * `APP_BUILD_ID` is unset, which makes "restart" a legitimate (if coarse)
 * stand-in for "new deployment" (P2-T10's stale-tab reload, UIUX-PLAN.md
 * §3: "a version mismatch after a deployment triggers one reload").
 * Computed once at module load, not per call, so every request this
 * process ever serves embeds the same id until it actually restarts.
 */
const PROCESS_BUILD_ID = crypto.randomUUID();

/** Secrets that must never reach production, whatever their source. */
const PLACEHOLDER_SECRETS = new Set([DEVELOPMENT_AUTH_SECRET]);

const envSchema = z.object({
  /** The sole database connection. Postgres only: the schema, row-level security
   * policies and the `pgvector` extension are all Postgres-specific. */
  DATABASE_URL: required(
    z
      .string()
      .refine(
        (value) => /^postgres(ql)?:\/\//.test(value),
        "must be a postgres:// or postgresql:// connection string",
      ),
  ),

  /** Optional owner-role connection for migrations. When unset, migrations
   * run over DATABASE_URL, which suits single-role local setups. Production
   * separates the two so the application role never owns the tables. */
  DATABASE_ADMIN_URL: optional(
    z
      .string()
      .refine(
        (value) => /^postgres(ql)?:\/\//.test(value),
        "must be a postgres:// or postgresql:// connection string",
      )
      .optional(),
  ),

  /** Signs session cookies and tokens. Development gets the placeholder below
   * so a fresh checkout runs; production refuses it (see `assertProduction`),
   * because a shared known secret is the same as no secret at all. The
   * first-run wizard generates a real one. */
  BETTER_AUTH_SECRET: optional(
    z.string().min(16).default(DEVELOPMENT_AUTH_SECRET),
  ),

  /** The instance's public origin, used to build callback and passkey origins. */
  BETTER_AUTH_URL: optional(z.string().url().default("http://localhost:3000")),

  NODE_ENV: optional(
    z.enum(["development", "test", "production"]).default("development"),
  ),

  LOG_LEVEL: optional(
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),

  PORT: optional(z.coerce.number().int().positive().max(65535).default(3000)),

  /** Names a deployment for the stale-tab reload (P2-T10). Set this to the
   * release identifier (a git SHA, a build number) in any environment
   * that deploys more than one process instance per release — the
   * per-process fallback default only distinguishes "restarted", not "the
   * same release on a different instance". */
  APP_BUILD_ID: optional(z.string().min(1).default(PROCESS_BUILD_ID)),

  /** Whether this process drains the outbox (P5-T01a). On by default, because
   * a deployment that drains nothing sends no invitation email and publishes
   * no live event, and that was the state of every deployment until now
   * (PLAN.md §12 R10). Concurrent relays are safe: rows are claimed with
   * `FOR UPDATE SKIP LOCKED` under a lease. Set `off` on serving replicas
   * when you want one dedicated drainer instead of all of them polling. */
  OPENOKR_RELAY: optional(z.enum(["on", "off"]).default("on")),

  /** Where the local-disk storage driver keeps files (P5-T15). Relative to the
   * working directory, and `storage` is what the compose file already mounts a
   * named volume at, so a container keeps its files across an upgrade with
   * nothing set. An S3-compatible driver behind the same port is an
   * alternative, never a requirement. */
  OPENOKR_STORAGE_ROOT: optional(z.string().min(1).default("storage")),
});

export type Env = z.infer<typeof envSchema>;

/** Thrown when the environment is invalid. Carries the offending variable names
 * so a caller can act on them without parsing the message. */
export class EnvironmentError extends Error {
  readonly variables: readonly string[];

  constructor(variables: readonly string[], message: string) {
    super(message);
    this.name = "EnvironmentError";
    this.variables = variables;
  }
}

/**
 * Refuses to boot production with a development placeholder in place. This is
 * the difference between a secret and a well-known string, so it fails loudly
 * at startup rather than quietly signing sessions anyone can forge.
 */
function assertProductionSecrets(env: Env): void {
  if (env.NODE_ENV !== "production") {
    return;
  }
  if (PLACEHOLDER_SECRETS.has(env.BETTER_AUTH_SECRET)) {
    throw new EnvironmentError(
      ["BETTER_AUTH_SECRET"],
      [
        "Invalid environment. 1 variable to fix:",
        "  BETTER_AUTH_SECRET: is still the development placeholder, which is public knowledge",
        "",
        "Generate one with:  openssl rand -base64 32",
        "",
      ].join("\n"),
    );
  }
}

/**
 * Validates an environment record. Throws `EnvironmentError` listing every bad
 * variable at once, so a misconfigured deployment is fixed in one pass rather
 * than one boot at a time.
 */
export function parseEnv(
  source: NodeJS.ProcessEnv | Record<string, unknown>,
): Env {
  const result = envSchema.safeParse(source);

  if (result.success) {
    assertProductionSecrets(result.data);
    return result.data;
  }

  const problems = result.error.issues.map((issue) => {
    const variable = issue.path.join(".") || "(unknown variable)";
    const reason =
      issue.code === "invalid_type" && issue.input === undefined
        ? "is missing"
        : issue.message;
    return { variable, line: `  ${variable}: ${reason}` };
  });

  const message = [
    `Invalid environment. ${problems.length} variable${problems.length === 1 ? "" : "s"} to fix:`,
    ...problems.map((problem) => problem.line),
    "",
    "See .env.example for the full list with defaults.",
  ].join("\n");

  throw new EnvironmentError(
    problems.map((problem) => problem.variable),
    message,
  );
}

let cached: Env | undefined;

/**
 * Validates `process.env` once per process and caches the result. Call this at
 * boot so a bad environment fails immediately rather than at the first query.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  cached ??= parseEnv(source);
  return cached;
}

/** Test seam. Never call this from application code. */
export function resetEnvCache(): void {
  cached = undefined;
}
