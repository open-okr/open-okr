"use client";

import type { Membership } from "@openokr/core";

/**
 * The one client-interactive fragment of the workspace switcher: submitting
 * the surrounding form on change needs an event handler, which a Server
 * Component's own JSX cannot carry (`workspace-switcher.tsx` stays a
 * server component everywhere else). Without JavaScript this still works
 * as a plain `<select>` inside a form — the `<noscript>` submit button next
 * to it is the fallback for that case.
 */
export function WorkspaceSelect({
  memberships,
  activeWorkspaceId,
}: {
  readonly memberships: readonly Membership[];
  readonly activeWorkspaceId: string;
}) {
  return (
    <select
      id="workspaceId"
      name="workspaceId"
      defaultValue={activeWorkspaceId}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      className="-ml-0.5 w-full rounded-md border-none bg-transparent text-xs text-ink-4 outline-none"
    >
      {memberships.map((membership) => (
        <option key={membership.workspaceId} value={membership.workspaceId}>
          {membership.name}
        </option>
      ))}
    </select>
  );
}
