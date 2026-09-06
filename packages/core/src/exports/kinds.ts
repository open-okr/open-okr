/**
 * What can be exported and in what shape (TECHNICAL-PLAN §4.9, P5-T15).
 *
 * **Three constants and no imports, because four modules need them.** The
 * action's input schema, the list gathering, the worker and the outbox handler
 * table all name the same exportable set, the same two formats and the same
 * topic. Putting them in any one of those four would make the other three
 * import it for a constant, and the action module is the one that would attract
 * the imports: it already sits in the registry's own import cycle, so anything
 * reaching into it for a value widens that cycle for no reason.
 */

/** The lists a person can take away. */
export const EXPORTABLE = ["goals", "initiatives", "tasks", "kpis"] as const;
export type Exportable = (typeof EXPORTABLE)[number];

/** The two files this product writes. */
export const FORMATS = ["csv", "xlsx"] as const;
export type Format = (typeof FORMATS)[number];

/** The topic the relay drains to build a large export. */
export const EXPORT_TOPIC = "export.requested";
