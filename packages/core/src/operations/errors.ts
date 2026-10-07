/**
 * A refusal, as opposed to something going wrong.
 *
 * Its own module rather than living in operation.ts: the access-aware getter
 * in packages/core/src/access/reads.ts throws it too, and operation.ts calls
 * into that module for the binding walk, so the error class needed a home
 * neither side has to import the other for.
 */
export class OperationError extends Error {
  readonly code: "forbidden" | "not_found" | "conflict";
  /**
   * What a `conflict` found instead of what the caller read (P9-T06a): the
   * values now stored, and who changed them last. Absent for the other two,
   * which say everything they can in their sentence.
   */
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: "forbidden" | "not_found" | "conflict",
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "OperationError";
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}
