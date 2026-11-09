import { type Comparable, OperationError, sameField } from "@openokr/core";
import { READ_FIELD } from "./read-field.ts";

/**
 * An edit screen's half of optimistic concurrency
 * (docs/design/optimistic-concurrency.md V3 and V4, plan 0.7.0 D3).
 *
 * A form is drawn with the values it read, in one hidden `read` field. On
 * save it sends only the fields the person changed, each with the value it
 * read, so the server compares exactly those. A field somebody else moved
 * since comes back as a `Conflict`, which the screen shows with keep mine
 * and take theirs.
 */

/** A refused save, as a screen shows it. Plain data, so it crosses to the browser. */
export interface Conflict {
  /** The fields that moved, as they are stored now. */
  readonly current: Readonly<Record<string, Comparable>>;
  /** Who changed the subject last, from its activity. */
  readonly changedBy: string | null;
  /** What this person sent for the same fields, so they can see what they keep. */
  readonly mine: Readonly<Record<string, Comparable>>;
}

/**
 * What the form read, from its hidden field, or null when it carries none.
 * A value that is not an object of plain values is treated as none, which
 * writes as before rather than refusing a save over a malformed field.
 */
export function readFromForm(
  formData: FormData,
): Readonly<Record<string, Comparable>> | null {
  const raw = formData.get(READ_FIELD);
  if (typeof raw !== "string" || raw === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, Comparable>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The fields of `next` that differ from what was read, and the read for
 * exactly those. Without a read, everything in `next` is sent as before
 * and no read goes with it.
 */
export function onlyChanged<T extends Record<string, Comparable | undefined>>(
  next: T,
  read: Readonly<Record<string, Comparable>> | null,
): {
  readonly set: Partial<T>;
  readonly read:
    | { [K in keyof T]?: Exclude<T[K], undefined> | null }
    | undefined;
} {
  if (read === null) {
    return { set: next, read: undefined };
  }
  const set: Partial<T> = {};
  const sent: Record<string, Comparable> = {};
  for (const key of Object.keys(next) as (keyof T & string)[]) {
    const value = next[key];
    if (value === undefined) {
      continue;
    }
    const before = read[key] ?? null;
    if (!sameField(before, value)) {
      set[key] = value;
      sent[key] = before;
    }
  }
  // Typed as the field it was read for: the page drew the form from the same
  // field, and the action takes a read value loosely and compares it with
  // what is stored, so a value of another shape is a conflict, not a crash.
  return { set, read: sent as { [K in keyof T]?: Exclude<T[K], undefined> } };
}

/**
 * The conflict a refused save carries, or null when it was refused for
 * another reason or failed. `mine` is what was sent, for the fields that
 * moved.
 */
export function conflictOf(
  error: unknown,
  sent: Readonly<Record<string, unknown>> = {},
): Conflict | null {
  if (!(error instanceof OperationError) || error.code !== "conflict") {
    return null;
  }
  // `conflict` also answers a name already taken, which carries no stored
  // values and is a refusal like any other.
  const details = (error.details ?? {}) as {
    readonly current?: Readonly<Record<string, Comparable>>;
    readonly changedBy?: string | null;
  };
  const current = details.current;
  if (current === undefined || current === null) {
    return null;
  }
  return {
    current,
    changedBy: details.changedBy ?? null,
    mine: Object.fromEntries(
      Object.keys(current).map((key) => [
        key,
        (sent[key] ?? null) as Comparable,
      ]),
    ),
  };
}
