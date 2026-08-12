/**
 * A refusal, as opposed to something going wrong.
 *
 * Its own module rather than living in operation.ts: the access-aware getter
 * in packages/core/src/access/reads.ts throws it too, and operation.ts calls
 * into that module for the binding walk, so the error class needed a home
 * neither side has to import the other for.
 */
export class OperationError extends Error {
  readonly code: "forbidden" | "not_found";

  constructor(code: "forbidden" | "not_found", message: string) {
    super(message);
    this.name = "OperationError";
    this.code = code;
  }
}
