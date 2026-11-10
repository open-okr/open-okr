/**
 * What an error is, before anybody reports it (docs/design/error-reporting.md,
 * plan 0.7.0 E1).
 *
 * Three questions, answered here and nowhere else: was it expected (D1), what
 * may a report say about it (D4, D5), and which other errors is it the same
 * as (D8). The reporter in `report.ts` asks them in that order and stops at
 * the first answer that says "nothing to report".
 *
 * **Names, never `instanceof`.** Next.js bundles the boot hook apart from the
 * route code, so one class can exist twice in one process and an
 * `instanceof` against the wrong copy answers false. `recorder.ts` found the
 * same split the hard way. Every class below sets its own `name`, and the
 * adapter classes cannot be imported from here at all, because core sits
 * above `packages/adapters`.
 */
import { createHash } from "node:crypto";

/** Where an error was caught (D3). A fixed set, so the metric label stays bounded. */
export const ERROR_SOURCES = [
  "request",
  "action",
  "relay",
  "dead_letter",
  "job",
  "agent",
  "process",
  "browser",
] as const;

export type ErrorSource = (typeof ERROR_SOURCES)[number];

/**
 * The refusals (D1). Each is the product answering somebody, not failing:
 * the existing metrics already count them by outcome, and a tracker full of
 * them hides the one real failure.
 */
const EXPECTED_CLASSES: ReadonlySet<string> = new Set([
  // The access model and the Operation pipeline: forbidden, not found,
  // conflict. `ImageRefusedError` is one of them with a reason attached.
  "OperationError",
  "ImageRefusedError",
  // Input refused at the boundary.
  "ZodError",
  "RichTextValidationError",
  "ValidationFailedError",
  "SSOConnectionRejected",
  // Limits an operator set.
  "AdmissionError",
  "QuotaExceededError",
  // The outbound guard and the AI egress rules saying no, and no provider.
  "OutboundRefusedError",
  "AIEgressRefusedError",
  "AIUnavailableError",
  // A request the caller walked away from. Next drops these itself.
  "AbortError",
  "ResponseAborted",
]);

/**
 * Next's own control flow (`notFound()`, `redirect()`, a dynamic bailout).
 * Thrown on purpose and caught by Next; the digest is how Next itself tells
 * them apart.
 */
const NEXT_CONTROL_FLOW = [
  "NEXT_REDIRECT",
  "NEXT_NOT_FOUND",
  "NEXT_HTTP_ERROR_FALLBACK",
  "DYNAMIC_SERVER_USAGE",
  "BAILOUT_TO_CLIENT_SIDE_RENDERING",
  "NEXT_PRERENDER_INTERRUPTED",
  "HANGING_PROMISE_REJECTION",
];

/**
 * React's word for a socket the browser closed mid-render, which
 * `apps/web/lib/abandoned-responses.ts` already keeps out of the log.
 */
const ABANDONED_RESPONSE = "The destination stream closed early.";

/**
 * Messages that name code rather than data (D5). A `TypeError` says
 * "Cannot read properties of undefined (reading 'id')", which is the most
 * useful line of the report. `SyntaxError` is not here on purpose:
 * `JSON.parse` quotes its input.
 */
const SAFE_MESSAGE_CLASSES: ReadonlySet<string> = new Set([
  "TypeError",
  "RangeError",
  "ReferenceError",
]);

/** A message longer than this is cut. A stack trace is not a message. */
const MESSAGE_LIMIT = 500;
/** At most this many frames per report (the browser route's limit too, D17). */
export const FRAME_LIMIT = 50;
const NAME_LIMIT = 200;

type Loose = Record<string, unknown>;

const asObject = (value: unknown): Loose | null =>
  typeof value === "object" && value !== null ? (value as Loose) : null;

/** A Postgres error from `pg`: a five-character SQLSTATE and a severity. */
function postgresErrorIn(error: unknown): Loose | null {
  let current = asObject(error);
  // Drizzle wraps the driver's error in its own and puts the SQL and the
  // parameters in the message, so the cause chain is where the code lives.
  for (let depth = 0; current && depth < 4; depth++) {
    if (
      typeof current.code === "string" &&
      /^[0-9A-Z]{5}$/.test(current.code) &&
      "severity" in current
    ) {
      return current;
    }
    current = asObject(current.cause);
  }
  return null;
}

/** Drizzle's query wrapper. Its message is the SQL and every parameter. */
const isDrizzleQueryError = (error: Loose): boolean =>
  typeof error.query === "string" && "params" in error;

/**
 * The class a report names.
 *
 * `name` first, because every class in this product sets it and it survives
 * minification. The constructor's name second, for a library class that
 * leaves `name` as plain `Error`.
 */
function classNameOf(error: unknown): string {
  const object = asObject(error);
  if (!object) {
    return typeof error === "string" ? "string" : "non-error";
  }
  if (postgresErrorIn(object) === object) {
    // `pg` names every server error "error", which says nothing.
    return "DatabaseError";
  }
  if (isDrizzleQueryError(object)) {
    return "DrizzleQueryError";
  }
  const name = typeof object.name === "string" ? object.name : "";
  if (name !== "" && name !== "Error") {
    return name.slice(0, NAME_LIMIT);
  }
  const constructorName = (object.constructor as { name?: unknown } | undefined)
    ?.name;
  if (
    typeof constructorName === "string" &&
    constructorName !== "" &&
    constructorName !== "Object"
  ) {
    return constructorName.slice(0, NAME_LIMIT);
  }
  return name === "" ? "Error" : name;
}

export interface Classification {
  /** True for a refusal or Next's control flow: nothing to report. */
  readonly expected: boolean;
  readonly className: string;
}

/**
 * Whether an error is worth reporting (D1).
 *
 * **A dead letter is always reported**, whatever the class: it is work the
 * product decided to do and then gave up on, and nothing else will mention
 * it. The class still decides what the report may say.
 */
export function classifyError(
  error: unknown,
  source?: ErrorSource,
): Classification {
  const className = classNameOf(error);
  if (source === "dead_letter") {
    return { expected: false, className };
  }
  if (EXPECTED_CLASSES.has(className)) {
    return { expected: true, className };
  }
  const object = asObject(error);
  if (object) {
    const digest = typeof object.digest === "string" ? object.digest : "";
    if (NEXT_CONTROL_FLOW.some((prefix) => digest.startsWith(prefix))) {
      return { expected: true, className };
    }
    if (object.message === ABANDONED_RESPONSE) {
      return { expected: true, className };
    }
  }
  return { expected: false, className };
}

/**
 * Whether a class says its own messages are safe to send (D5).
 *
 * A class opts in with `readonly safeMessage = true`. Only for messages built
 * from code, never from what somebody typed or a provider answered.
 */
function declaresSafeMessage(error: Loose): boolean {
  if (error.safeMessage === true) {
    return true;
  }
  const errorClass = error.constructor as { safeMessage?: unknown } | undefined;
  return errorClass?.safeMessage === true;
}

/**
 * What a report may say instead of the message (D5, D6).
 *
 * **Withheld unless the class is known to be safe**, and the reason is
 * sharper than privacy: a tracker's reader may be an AI agent, and text a
 * tenant typed must never reach it, or a customer could plant instructions
 * for the operator's agent in a goal title. An allow-list, so a new error
 * that quotes its input is withheld without anybody remembering to.
 */
function safeMessageOf(error: unknown, className: string): string {
  const object = asObject(error);
  const postgres = postgresErrorIn(error);
  if (postgres) {
    // The code and the constraint name only. The message and the detail
    // quote the row, and a unique violation's detail is often an address.
    const code = postgres.code as string;
    const constraint =
      typeof postgres.constraint === "string" ? postgres.constraint : null;
    return constraint
      ? `${className} (SQLSTATE ${code}, constraint ${constraint})`
      : `${className} (SQLSTATE ${code})`;
  }
  const message = typeof object?.message === "string" ? object.message : null;
  if (
    message !== null &&
    object !== null &&
    (SAFE_MESSAGE_CLASSES.has(className) || declaresSafeMessage(object))
  ) {
    return message.length > MESSAGE_LIMIT
      ? `${message.slice(0, MESSAGE_LIMIT)}…`
      : message;
  }
  return `${className} (message withheld)`;
}

/** The SQLSTATE and constraint of a Postgres error, for the report's tags. */
function postgresFieldsOf(error: unknown): {
  readonly sqlState: string | null;
  readonly constraint: string | null;
} {
  const postgres = postgresErrorIn(error);
  if (!postgres) {
    return { sqlState: null, constraint: null };
  }
  return {
    sqlState: postgres.code as string,
    constraint:
      typeof postgres.constraint === "string" ? postgres.constraint : null,
  };
}

/** One stack frame, innermost first (D4). */
export interface ErrorFrame {
  readonly file: string;
  readonly function: string;
  readonly line: number | null;
  readonly column: number | null;
  /** True for our code: not a dependency and not Node's own. */
  readonly inApp: boolean;
}

/** Path markers a scrubbed file keeps from, last match wins for dependencies. */
const ROOT_MARKERS = ["/.next/", "/_next/", "/apps/", "/packages/"];

/**
 * A file path with nothing about the machine in it.
 *
 * A compiled path carries the deployment's directory, and a development one
 * carries a home directory, which is a person's name. A browser frame is a
 * URL, which carries the instance's host and, worse, a query string. What is
 * kept starts where the repository's own layout does.
 */
export function scrubFile(raw: string): string {
  let file = raw.trim();
  if (file === "" || file === "native" || file === "<anonymous>") {
    return file === "" ? "<unknown>" : file;
  }
  if (file.startsWith("node:")) {
    return file.slice(0, NAME_LIMIT);
  }
  // A URL keeps its path only: no host, no query, no fragment.
  const url = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/[^?#]*)?/i.exec(file);
  if (url) {
    file = url[1] ?? "/";
  }
  // Cut at the first `?` or `#` by position: `/[?#].*$/` rescans the rest of
  // the string from every `#` in it, which a long run of them makes slow.
  const query = file.search(/[?#]/);
  if (query >= 0) {
    file = file.slice(0, query);
  }
  file = file.replace(/\\/g, "/");
  const modules = file.lastIndexOf("/node_modules/");
  if (modules >= 0) {
    return file.slice(modules + 1).slice(0, NAME_LIMIT);
  }
  if (file.startsWith("node_modules/")) {
    return file.slice(0, NAME_LIMIT);
  }
  for (const marker of ROOT_MARKERS) {
    const at = file.lastIndexOf(marker);
    if (at >= 0) {
      return file.slice(at + 1).slice(0, NAME_LIMIT);
    }
  }
  for (const marker of ROOT_MARKERS) {
    if (file.startsWith(marker.slice(1))) {
      return file.slice(0, NAME_LIMIT);
    }
  }
  // Anything else keeps its last segment: a file name is code, a directory
  // above it may be somebody's home.
  const last = file.split("/").filter(Boolean).pop();
  return (last ?? "<unknown>").slice(0, NAME_LIMIT);
}

function isInApp(file: string): boolean {
  return !(
    file.includes("node_modules") ||
    file.startsWith("node:") ||
    file.startsWith("internal/") ||
    file === "native" ||
    file === "<anonymous>" ||
    file === "<unknown>"
  );
}

function frameAt(fn: string, location: string): ErrorFrame {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(location);
  const file = scrubFile(match ? (match[1] as string) : location);
  return {
    file,
    function: fn.slice(0, NAME_LIMIT) || "<anonymous>",
    line: match ? Number(match[2]) : null,
    column: match?.[3] ? Number(match[3]) : null,
    inApp: isInApp(file),
  };
}

/**
 * A V8 frame line, `at name (location)` or `at location`, read by position.
 *
 * The same answer as `/^at (?:(.+?) \((.+)\)|(.+))$/`, which backtracks
 * polynomially on a line of repeated `a (` (CodeQL js/polynomial-redos). A
 * stack is library input: a thrown value's text can be anything.
 */
function v8Frame(
  line: string,
): { readonly name?: string; readonly location: string } | null {
  if (!line.startsWith("at ") || line.length === 3) {
    return null;
  }
  const rest = line.slice(3);
  const open = rest.indexOf(" (", 1);
  if (rest.endsWith(")") && open > 0 && open + 2 < rest.length - 1) {
    return { name: rest.slice(0, open), location: rest.slice(open + 2, -1) };
  }
  return { location: rest };
}

/**
 * A Gecko or JavaScriptCore frame line, `name@file:line[:column]`.
 *
 * The same answer as `/^(.*?)@(.+:\d+(?::\d+)?)$/`, read by position for
 * the reason `v8Frame` gives.
 */
function geckoFrame(
  line: string,
): { readonly name: string; readonly location: string } | null {
  const at = line.indexOf("@");
  if (at < 0) {
    return null;
  }
  const location = line.slice(at + 1);
  const colon = location.lastIndexOf(":");
  if (colon < 1 || !/^\d+$/.test(location.slice(colon + 1))) {
    return null;
  }
  return { name: line.slice(0, at), location };
}

/**
 * The frames of a stack, innermost first.
 *
 * Reads both shapes a stack comes in: V8's `at fn (file:1:2)`, which is Node
 * and Chrome, and `fn@file:1:2`, which is Firefox and Safari. The first line
 * of a V8 stack is the message, and it is dropped here rather than scrubbed:
 * the report rebuilds that line from the safe message.
 */
export function parseStack(stack: string | null | undefined): ErrorFrame[] {
  if (!stack) {
    return [];
  }
  const frames: ErrorFrame[] = [];
  for (const raw of stack.split("\n")) {
    if (frames.length >= FRAME_LIMIT) {
      break;
    }
    const line = raw.trim();
    const v8 = v8Frame(line);
    if (v8) {
      if (v8.name !== undefined) {
        // `eval at fn (file:1:2), <anonymous>:1:1` names where the eval ran.
        const location = (
          v8.location.match(/\(([^()]+)\)/)?.[1] ?? v8.location
        ).split(", ")[0] as string;
        frames.push(frameAt(v8.name.replace(/^async /, ""), location));
      } else {
        frames.push(frameAt("<anonymous>", v8.location.replace(/^async /, "")));
      }
      continue;
    }
    const gecko = geckoFrame(line);
    if (gecko) {
      frames.push(frameAt(gecko.name || "<anonymous>", gecko.location));
    }
  }
  return frames;
}

/**
 * What groups one error with its repeats (D8).
 *
 * The source, the class, and the file and function of the top three frames in
 * our code, without line numbers, so a release that moves a line keeps its
 * group. Hash-like runs in a file name are dropped too: a compiled chunk's
 * name changes with every build, and its function names do not.
 */
export function fingerprintOf(
  source: ErrorSource,
  className: string,
  frames: readonly ErrorFrame[],
): string {
  const ours = frames.filter((frame) => frame.inApp).slice(0, 3);
  const parts = [
    source,
    className,
    ...ours.map(
      (frame) =>
        `${frame.file.replace(/[0-9a-f]{8,}|[_-][0-9a-z]{6,}(?=\.)/gi, "")}#${frame.function}`,
    ),
  ];
  return createHash("sha256")
    .update(parts.join("\n"))
    .digest("hex")
    .slice(0, 32);
}

/** Everything a report may carry about the error itself. */
export interface DescribedError {
  readonly className: string;
  readonly message: string;
  readonly frames: readonly ErrorFrame[];
  readonly sqlState: string | null;
  readonly constraint: string | null;
}

/** The safe description of a thrown value: class, message, frames. */
export function describeError(error: unknown): DescribedError {
  const className = classNameOf(error);
  const stack = asObject(error)?.stack;
  return {
    className,
    message: safeMessageOf(error, className),
    frames: parseStack(typeof stack === "string" ? stack : null),
    ...postgresFieldsOf(error),
  };
}

/**
 * The stack as the log line shows it: the safe first line and the scrubbed
 * frames. Never the raw `error.stack`, whose first line is the message.
 */
export function scrubbedStack(described: DescribedError): string {
  return [
    described.message.startsWith(described.className)
      ? described.message
      : `${described.className}: ${described.message}`,
    ...described.frames.map((frame) => {
      const at =
        frame.line === null
          ? frame.file
          : `${frame.file}:${frame.line}${frame.column === null ? "" : `:${frame.column}`}`;
      return `    at ${frame.function} (${at})`;
    }),
  ].join("\n");
}
