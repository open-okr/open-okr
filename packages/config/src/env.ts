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

  NODE_ENV: optional(
    z.enum(["development", "test", "production"]).default("development"),
  ),

  LOG_LEVEL: optional(
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),

  PORT: optional(z.coerce.number().int().positive().max(65535).default(3000)),
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
 * Validates an environment record. Throws `EnvironmentError` listing every bad
 * variable at once, so a misconfigured deployment is fixed in one pass rather
 * than one boot at a time.
 */
export function parseEnv(
  source: NodeJS.ProcessEnv | Record<string, unknown>,
): Env {
  const result = envSchema.safeParse(source);

  if (result.success) {
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
