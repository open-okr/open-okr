/**
 * What a browser may send about one of its errors (docs/design/
 * error-reporting.md D17, plan 0.7.0 E3).
 *
 * Validated here, at the boundary, with the same Zod every action's input
 * goes through. The message and the stack are text a page held, so they are
 * untrusted: the message is withheld afterwards unless its class is on the
 * allow-list, and the stack is parsed into frames and never kept as written.
 */
import { z } from "zod";
import { classifyError, type DescribedError, parseStack } from "./classify.ts";

/** The body's ceiling, in bytes (D17). */
export const BROWSER_ERROR_BODY_LIMIT = 16 * 1024;
/** Reports one signed-in person may send a minute (D17). */
export const BROWSER_ERRORS_PER_MINUTE = 10;

const BrowserErrorBody = z
  .object({
    /** How the page caught it: a global listener, or an error boundary. */
    kind: z.enum(["error", "rejection", "boundary"]),
    name: z.string().max(100),
    message: z.string().max(2_000),
    stack: z.string().max(14_000),
    digest: z
      .string()
      .regex(/^[A-Za-z0-9_;:.-]{1,64}$/)
      .optional(),
    /** The route pattern the page worked out, `/goals/[id]`. */
    route: z
      .string()
      .regex(/^\/[A-Za-z0-9_.~/[\]()@-]{0,199}$/)
      .optional(),
  })
  .strict();

export type BrowserError = z.infer<typeof BrowserErrorBody>;

/** The body, or null when it is not one. */
export function parseBrowserError(json: unknown): BrowserError | null {
  const parsed = BrowserErrorBody.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** A class name, a function name and a file, each shaped like code: no spaces. */
const CLASS_NAME = /^[A-Za-z_$][A-Za-z0-9_$.]{0,99}$/;
const FUNCTION_NAME = /^(new )?[A-Za-z0-9_$.<>[\]/]{1,100}$/;
const FILE = /^[A-Za-z0-9_\-./~%[\]()@+:]{1,200}$/;

/** Whether the browser's error is a refusal or Next's control flow (D1). */
export function isExpectedBrowserError(body: BrowserError): boolean {
  return classifyError(
    { name: body.name, message: body.message, digest: body.digest },
    "browser",
  ).expected;
}

/**
 * What a report may say about a browser's error.
 *
 * **Stricter than a server error, because every word of it is the page's
 * claim.** A signed-in member can send this route anything, so a class of
 * `TypeError` proves nothing about who wrote the message: every browser
 * message is withheld, and the class, each function name and each file must
 * have the shape of code, with no spaces. That is D6: nobody can type
 * instructions into the tracker for whoever, or whatever, reads it.
 */
export function describeBrowserError(body: BrowserError): DescribedError {
  const className = CLASS_NAME.test(body.name) ? body.name : "Error";
  return {
    className,
    message: `${className} (message withheld)`,
    frames: parseStack(body.stack).map((frame) => {
      const file = FILE.test(frame.file) ? frame.file : "<unknown>";
      return {
        ...frame,
        file,
        function: FUNCTION_NAME.test(frame.function)
          ? frame.function
          : "<anonymous>",
        inApp: frame.inApp && file !== "<unknown>",
      };
    }),
    sqlState: null,
    constraint: null,
  };
}
