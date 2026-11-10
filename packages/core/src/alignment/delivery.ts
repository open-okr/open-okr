/**
 * Whether the key result a dependency names has delivered (plan 0.7.0 O5,
 * design `key-result-dependencies.md` K6 to K8).
 *
 * **Computed at every read and never stored.** A key result's `progress_pct`
 * is recomputed in the same transaction as the write that moves it
 * (`okr-core-domain.md` §7), so a state read from it cannot disagree with the
 * progress bar beside it. A stored "delivered" flag would be a second copy of
 * the same fact, and it would drift the first time a maintain key result left
 * its band.
 *
 * **Delivery settles nothing** (K10). Publish gate 4, the silo check and the
 * alignment score read the register as they did before; METHOD.md §5.4 names
 * three ways to settle a dependency and delivered is not one of them.
 */
import { z } from "zod";

const DEPENDENCY_DELIVERY_STATES = [
  "delivered",
  "pending",
  "stopped",
  "hidden",
] as const;
export type DependencyDeliveryState =
  (typeof DEPENDENCY_DELIVERY_STATES)[number];

/**
 * The providing key result on a register entry, the same in all three reads
 * that carry one (K9): the S-14 rail, the S-10 register and the S-23 log.
 * Null when the entry names none. `hidden` carries the id and nothing else.
 */
export const providingKeyResultOutput = z
  .object({
    id: z.uuid(),
    title: z.string().nullable(),
    goalId: z.uuid().nullable(),
    goalTitle: z.string().nullable(),
    progressPct: z.number().nullable(),
    state: z.enum(DEPENDENCY_DELIVERY_STATES),
  })
  .nullable();

/**
 * 100% is not a threshold anybody tunes. It is what METHOD.md §2.10 means by
 * done for every kind: a milestone done and a baseline recorded read exactly
 * 100, a metric at its target reads 100 or more, and a maintain reads 100
 * while inside its band.
 */
const DONE_PCT = 100;

/** What the read knows about the providing key result. */
export interface ProvidingKeyResultFacts {
  /** The reader can view the goal that owns it. */
  readonly visible: boolean;
  /** §3.1's progress, as the writing transaction left it. */
  readonly progressPct: number;
  /** The key result, or the goal that owns it, is deleted. */
  readonly deleted: boolean;
  /** The goal that owns it is closed. */
  readonly goalClosed: boolean;
}

/**
 * K7's states. Null when no key result is named.
 *
 * - `hidden` first, whatever else is true: the state would tell a reader
 *   whether a goal they cannot open reached its target (K8).
 * - `stopped` when the key result is gone, even at 100%: a deleted key result
 *   promises nothing any more.
 * - `delivered` at 100%, closed or not.
 * - `stopped` when its goal closed short, because the delivery is not coming.
 * - `pending` otherwise. A maintain key result can go back here, which is
 *   what it promised.
 */
export function dependencyDelivery(
  provider: ProvidingKeyResultFacts,
): DependencyDeliveryState;
export function dependencyDelivery(
  provider: ProvidingKeyResultFacts | null,
): DependencyDeliveryState | null;
export function dependencyDelivery(
  provider: ProvidingKeyResultFacts | null,
): DependencyDeliveryState | null {
  if (provider === null) {
    return null;
  }
  if (!provider.visible) {
    return "hidden";
  }
  if (provider.deleted) {
    return "stopped";
  }
  if (provider.progressPct >= DONE_PCT) {
    return "delivered";
  }
  return provider.goalClosed ? "stopped" : "pending";
}
