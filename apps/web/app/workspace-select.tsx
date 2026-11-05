"use client";

import type { Membership } from "@openokr/core";
import { SelectInput, Spinner } from "@openokr/ui";
import { useFormStatus } from "react-dom";

/**
 * The one client-interactive fragment of the workspace switcher: submitting
 * the surrounding form on change needs an event handler, which a Server
 * Component's own JSX cannot carry (`workspace-switcher.tsx` stays a
 * server component everywhere else). Without JavaScript this still works
 * as a plain `<select>` inside a form — the `<noscript>` submit button next
 * to it is the fallback for that case.
 */
export function WorkspaceSelect({
  label,
  memberships,
  activeWorkspaceId,
}: {
  /** What the dropdown is, said to a screen reader: the row shows the name. */
  readonly label: string;
  readonly memberships: readonly Membership[];
  readonly activeWorkspaceId: string;
}) {
  // The form is read when it is submitted, so locking the select while the
  // switch is sent loses nothing.
  const { pending } = useFormStatus();
  return (
    <span className="flex items-center gap-1.5">
      <SelectInput
        id="workspaceId"
        label={label}
        hideLabel
        name="workspaceId"
        defaultValue={activeWorkspaceId}
        disabled={pending}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="min-w-0 flex-1"
        inputClassName="-ml-0.5 h-auto w-full rounded-md border-none bg-transparent px-0 text-xs text-ink-4 focus:ring-0"
      >
        {memberships.map((membership) => (
          <option key={membership.workspaceId} value={membership.workspaceId}>
            {membership.name}
          </option>
        ))}
      </SelectInput>
      {pending ? <Spinner /> : null}
    </span>
  );
}
