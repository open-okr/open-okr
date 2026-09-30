/**
 * The FileScanner port (REQUIREMENTS §4 "an optional scan hook", P2-T05,
 * completeness review M-24).
 *
 * **Optional, and off unless an operator names a scanner.** Postgres is the
 * only service the product requires, so an instance with no scanner stores
 * files exactly as it always has. With one, a file waits in `scanning` until
 * the verdict arrives and is quarantined if the scanner names a signature.
 *
 * **Three verdicts and one exception.** Clean, found and refused are answers
 * about the file, and the caller records each. A scanner it cannot reach is not
 * an answer: the driver throws `ScannerUnavailableError`, and the outbox relay
 * that runs the scan tries again later instead of deciding anything.
 */

export type ScanVerdict =
  | { readonly verdict: "clean" }
  /** The scanner matched a signature. `signature` is its own name for it. */
  | { readonly verdict: "found"; readonly signature: string }
  /**
   * The scanner answered and would not scan this file, for example because it
   * is larger than the scanner's own stream limit. Retrying gets the same
   * answer, so it is a verdict rather than an outage.
   */
  | { readonly verdict: "refused"; readonly reason: string };

export interface FileScanner {
  /** Throws `ScannerUnavailableError` when the scanner cannot be reached. */
  scan(body: Buffer): Promise<ScanVerdict>;
}

export class ScannerUnavailableError extends Error {
  override readonly name = "ScannerUnavailableError";
}
