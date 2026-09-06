/**
 * A delivery failure that retrying cannot fix (P5-T01a).
 *
 * **Declared twice on purpose, here and in `packages/adapters/src/relay.ts`.**
 * `packages/core` may not import `packages/adapters`, and the relay may not
 * import core, so one shared class is not available to both. The relay matches
 * on `error.name` rather than `instanceof`, which is what lets each package own
 * its own declaration and still agree.
 *
 * That is a real trade and it is worth naming: matching on a string means a
 * third package could throw an error with the same name and get the same
 * treatment. The alternative is a dependency edge the architecture gate would
 * refuse, or a fourth package holding one error class. Two declarations and a
 * shared name is the smallest thing that works, and `check:boundaries` is what
 * keeps the edge from being added later by accident.
 *
 * Throw it when the row can never succeed: a topic nothing handles, a payload
 * missing what the handler needs, a row naming an entity that has been deleted.
 * Anything that might work on the next attempt should just throw normally.
 */
export class PermanentDispatchError extends Error {
  override readonly name = "PermanentDispatchError";
}
