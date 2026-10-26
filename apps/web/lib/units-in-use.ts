/**
 * The units a set of key results already uses, most used first, for
 * `UnitInput` to offer before the common ones (guided-inputs §4.8). Read from
 * the goals the screen already holds, so offering them costs no request.
 */
export function unitsInUse(
  goals: readonly {
    readonly keyResults: readonly { readonly unit: string | null }[];
  }[],
): readonly string[] {
  const counts = new Map<string, number>();
  for (const goal of goals) {
    for (const keyResult of goal.keyResults) {
      const unit = keyResult.unit?.trim();
      if (unit) {
        counts.set(unit, (counts.get(unit) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([unit]) => unit);
}
