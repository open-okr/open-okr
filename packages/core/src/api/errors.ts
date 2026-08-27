/**
 * The typed error enumeration for the public surfaces (§14, P5-T07a).
 *
 * **A closed list, so a client can branch on it.** §14 asks for "a typed
 * enumeration", which means a caller writes `if (code === "insufficient_scope")`
 * rather than matching on prose. The message is for a person reading a log; the
 * code is for the program.
 *
 * **Forbidden has already collapsed by the time it gets here.** §14 says
 * forbidden collapses to not-found for invisible resources, and that happens in
 * `can()` and the access getter, not in this transport: a resource the reader
 * cannot see raises `not_found` inside core, so this layer never has the
 * information to leak. What reaches here as `forbidden` is the other case, a
 * resource the reader can see at a level below what the action needs, and
 * flattening that to not-found would be a lie in the opposite direction.
 *
 * **Nothing unexpected is described.** An error this module does not recognise
 * becomes `internal` with a fixed sentence. A stack trace, a driver message or a
 * constraint name in a response body is a map of the schema.
 */
import { ZodError } from "zod";
import { OperationError } from "../operations/errors.ts";

export const API_ERROR_CODES = [
  /** No token, or not one that resolves. */
  "unauthenticated",
  /** A resolving token whose scopes do not cover this action. */
  "insufficient_scope",
  /** Visible, but at a level below what the action requires. */
  "forbidden",
  "not_found",
  /** No action of that name on this surface. */
  "unknown_action",
  /** A read reached by POST, or a write by GET. */
  "method_not_allowed",
  /** The action's own schema refused the input. `fields` says where. */
  "invalid_input",
  /** A parameter this action does not declare. Named, so a typo is findable. */
  "unsupported_parameter",
  "rate_limited",
  "internal",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const STATUS: Readonly<Record<ApiErrorCode, number>> = {
  unauthenticated: 401,
  insufficient_scope: 403,
  forbidden: 403,
  not_found: 404,
  unknown_action: 404,
  method_not_allowed: 405,
  invalid_input: 422,
  unsupported_parameter: 400,
  rate_limited: 429,
  internal: 500,
};

export interface ApiError {
  readonly code: ApiErrorCode;
  readonly message: string;
  /** Field paths to messages, for `invalid_input` only. */
  readonly fields?: Readonly<Record<string, string>>;
}

export function statusFor(code: ApiErrorCode): number {
  return STATUS[code];
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  fields?: Readonly<Record<string, string>>,
): ApiError {
  return fields ? { code, message, fields } : { code, message };
}

/**
 * Turns whatever an action threw into one of the codes above.
 *
 * The two recognised shapes are the two the product raises deliberately: a Zod
 * refusal from the boundary and an `OperationError` from `can()` or the access
 * getter. Everything else is a fault rather than a refusal, and is reported as
 * one without describing itself.
 */
export function errorFor(thrown: unknown): ApiError {
  if (thrown instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of thrown.issues) {
      const path = issue.path.join(".");
      // The first message per field. A list of four complaints about one field
      // is longer without being clearer.
      if (!fields[path === "" ? "(root)" : path]) {
        fields[path === "" ? "(root)" : path] = issue.message;
      }
    }
    return apiError("invalid_input", "That input is not valid.", fields);
  }
  if (thrown instanceof OperationError) {
    return apiError(thrown.code, thrown.message);
  }
  return apiError("internal", "Something went wrong handling that request.");
}
