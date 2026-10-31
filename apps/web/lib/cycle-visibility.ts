/**
 * Whether the sidebar draws Cycle and the shell draws the phase strip
 * (navigation-five-areas.md, OKRGoal UX review N3).
 *
 * The review asked for the method to stay intact for the people who run it and
 * out of the daily path of everybody else. Those people are the workspace's
 * administrators and the coordinators and managers of its spaces: the roles
 * that run a space's weekly session and the cycle around it (METHOD.md §2.5).
 * Visibility only: `/cycle` still opens at view for anybody who goes there.
 */
export function seesCycle(reader: {
  readonly administers: boolean;
  readonly spaceRoles: readonly (string | null)[];
}): boolean {
  return (
    reader.administers ||
    reader.spaceRoles.some(
      (role) => role === "coordinator" || role === "manager",
    )
  );
}
