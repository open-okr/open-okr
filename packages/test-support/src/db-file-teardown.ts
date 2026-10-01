import { afterAll } from "vitest";
import { closeWorkerDb } from "./db-harness.ts";

/**
 * A Vitest setup file: every test file drops its worker database when it ends
 * (completeness review L-03).
 *
 * `close()` drops the clone, but only 178 of the files that use one called it,
 * so the rest still left theirs for the next run's sweep, and a whole run held
 * hundreds at once. Registered here, every file does it without having to
 * remember. `afterAll` hooks run last-registered first, so a file's own
 * `wb.close()` still runs before this, and this finds nothing left to close.
 */
afterAll(closeWorkerDb);
