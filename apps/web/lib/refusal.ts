import { OperationError } from "@openokr/core";
import type { MessageValues } from "@openokr/ui";

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

/** The translator a server action already holds from `getTranslations`. */
type Translate = (key: string, values?: MessageValues) => string;

/** One refused field, as a Zod issue carries it. Read by shape, as above. */
interface Issue {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly path?: unknown;
  readonly origin?: unknown;
  readonly format?: unknown;
  readonly maximum?: unknown;
  readonly minimum?: unknown;
}

/**
 * Zod's own wording, which names the schema rather than the person's input
 * ("Too big: expected string to have <=500 characters"). A schema that wrote
 * its own sentence keeps it; these are the ones the catalogue says better.
 */
const ZOD_DEFAULT = /^(Too big|Too small|Invalid)\b/;

function issueMessage(issue: Issue, t: Translate | undefined): string | null {
  const own = typeof issue.message === "string" ? issue.message : null;
  if (!t || own === null || !ZOD_DEFAULT.test(own)) {
    return own;
  }
  if (issue.code === "too_big" && issue.origin === "string") {
    return t("fields.tooLong", { max: Number(issue.maximum) });
  }
  if (
    issue.code === "too_small" &&
    issue.origin === "string" &&
    Number(issue.minimum) === 1
  ) {
    return t("fields.required");
  }
  if (issue.code === "too_big" && issue.origin === "number") {
    return t("fields.atMost", { max: Number(issue.maximum) });
  }
  if (issue.code === "too_small" && issue.origin === "number") {
    return t("fields.atLeast", { min: Number(issue.minimum) });
  }
  if (issue.code === "invalid_format" && issue.format === "email") {
    return t("fields.email.invalid");
  }
  if (issue.code === "invalid_format" && issue.format === "url") {
    return t("fields.url.invalid");
  }
  return own;
}

/**
 * A refused save as its sentence and the fields it names (guided-inputs §4.2,
 * plan U1), or null when it was not refused but failed.
 *
 * `fields` maps an input path (`reason`, `keyResults.0.title`) to the message
 * the form shows under that field, so the person sees what to change where
 * they would change it. A schema refusal names every field it refused, the
 * first message for each; an `OperationError` names the one field it is about,
 * when it is about one. `message` is the sentence for the whole form, which a
 * form shows only when no field it draws took the message.
 *
 * Given the translator, Zod's own wording for a common refusal (too long,
 * required, not an address) comes from the catalogue in the reader's
 * language; a sentence a schema wrote itself is kept as written.
 */
export function refusalFields(
  error: unknown,
  t?: Translate,
): {
  readonly message: string;
  readonly fields: Readonly<Record<string, string>>;
} | null {
  if (error instanceof OperationError) {
    return {
      message: error.message,
      fields: error.field === undefined ? {} : { [error.field]: error.message },
    };
  }
  if (
    error instanceof Error &&
    error.name === "ZodError" &&
    "issues" in error &&
    Array.isArray(error.issues)
  ) {
    const fields: Record<string, string> = {};
    let message: string | null = null;
    for (const raw of error.issues as readonly Issue[]) {
      const text = issueMessage(raw, t);
      if (text === null) {
        continue;
      }
      message ??= text;
      const path = Array.isArray(raw.path) ? raw.path.join(".") : "";
      if (path !== "" && fields[path] === undefined) {
        fields[path] = text;
      }
    }
    return message === null ? null : { message, fields };
  }
  return null;
}

/**
 * The message a form shows above its fields: the sentence, unless a field it
 * draws already shows it, so nothing is said twice.
 */
function formLevelMessage(
  refusal: {
    readonly message: string;
    readonly fields: Readonly<Record<string, string>>;
  },
  drawn: readonly string[],
): string | null {
  const shown = drawn.some((field) => refusal.fields[field] !== undefined);
  return shown ? null : refusal.message;
}

/**
 * What a server action returns for a refused save (guided-inputs §4.2): each
 * named field's message for the form to show under that field, and the
 * sentence for the whole form only when none of `drawn`, the fields this form
 * shows, took it. Null when the error was not a refusal, which the caller
 * throws on to the error page.
 */
export function refusedState(
  error: unknown,
  t: Translate,
  drawn: readonly string[],
): {
  readonly error?: string;
  readonly fields?: Readonly<Record<string, string>>;
} | null {
  const refusal = refusalFields(error, t);
  if (refusal === null) {
    return null;
  }
  const fields = Object.fromEntries(
    Object.entries(refusal.fields).filter(([field]) => drawn.includes(field)),
  );
  const message = formLevelMessage(refusal, drawn);
  return {
    ...(message === null ? {} : { error: message }),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
}

/**
 * What a form wrapped in `RefusedFields` gets back for a refused save
 * (guided-inputs §4.2, plan U1b): every field the refusal names, which the
 * kit fields inside show under themselves and the provider says under the
 * form when no field claims one, and the sentence only when it names none.
 * Null when the error was not a refusal.
 */
export function refusedByField(
  error: unknown,
  t: Translate,
): {
  readonly error: string | null;
  readonly fields?: Readonly<Record<string, string>>;
} | null {
  const refusal = refusalFields(error, t);
  if (refusal === null) {
    return null;
  }
  return Object.keys(refusal.fields).length === 0
    ? { error: refusal.message }
    : { error: null, fields: refusal.fields };
}
