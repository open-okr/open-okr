import { callAction, cyclesOpenForWork } from "@openokr/core";

/**
 * The key results a person may tie work to (plan 0.8.0 I1, Akmal's answer to
 * I1-Q1): those of open objectives in every cycle being planned or running,
 * quarterly and annual, that the reader can see.
 *
 * One rule for every picker that offers a key result: "Key result it moves"
 * on the Board and on "Add an initiative", the initiative's own link picker
 * and the objective page. Each used to offer the current quarter only, so an
 * initiative could not serve an annual key result, nor next quarter's while
 * it was being planned. A closing or closed cycle is not offered: its numbers
 * are being reviewed or are final, and new work does not move them.
 *
 * Visibility is `goals.list`'s own, which is already access-filtered, so a
 * picker never names an objective its reader cannot open.
 */
export interface LinkableKeyResult {
  readonly id: string;
  readonly title: string;
  readonly goalTitle: string;
  readonly cycleName: string;
}

type Context = Parameters<typeof callAction>[0];

/**
 * The order and the filter are core's (`cyclesOpenForWork`), because the
 * copilot offers the same key results to propose work behind (plan 0.8.1 A1)
 * and the two must not disagree.
 */
export async function linkableKeyResults(
  context: Context,
): Promise<LinkableKeyResult[]> {
  const cycles = cyclesOpenForWork(
    await callAction(context, "cycles.list", {}),
  );
  const lists = await Promise.all(
    cycles.map((cycle) =>
      callAction(context, "goals.list", {
        cycleId: cycle.id,
        includeClosed: false,
      }),
    ),
  );
  return cycles.flatMap((cycle, index) =>
    (lists[index]?.goals ?? []).flatMap((goal) =>
      goal.keyResults.map((keyResult) => ({
        id: keyResult.id,
        title: keyResult.title,
        goalTitle: goal.title,
        cycleName: cycle.name,
      })),
    ),
  );
}

/** As a picker's option: the key result, with its objective and cycle under it. */
export function keyResultOption(keyResult: LinkableKeyResult): {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
} {
  return {
    id: keyResult.id,
    label: keyResult.title,
    detail: `${keyResult.goalTitle} · ${keyResult.cycleName}`,
  };
}
