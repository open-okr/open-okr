import { OperationError } from "@openokr/core";

/**
 * The sentence a refused save is shown with, or null when it was not refused
 * but failed (guided-inputs §5, F5).
 *
 * A refusal is an `OperationError`, or a schema's own sentence for the first
 * thing it would not take: "A lifecycle change needs a reason." A zod error's
 * `message` is the JSON of every issue, which is what a form that showed it
 * whole put on the screen. Recognised by its shape rather than its class,
 * because the schema that threw it lives in another package's copy of zod.
 *
 * Anything else, a database that went away, is not the person's to fix, and
 * the caller throws it on to the error page that says so.
 */
export function refusalOf(error: unknown): string | null {
  if (error instanceof OperationError) {
    return error.message;
  }
  if (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    const first = error.issues[0] as { readonly message?: unknown } | undefined;
    return typeof first?.message === "string" ? first.message : null;
  }
  return null;
}
