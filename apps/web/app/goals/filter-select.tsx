"use client";

import { useRouter } from "next/navigation";
import { FILTER_PLACEHOLDER } from "./placeholders.ts";

/**
 * A filter with more options than fit as chips: a champion, a space
 * (P9-T07a-b, docs/design/p9-t00-okr-writing.md §3).
 *
 * Choosing one is a navigation, so the filter is in the address like every
 * other control on this toolbar and a link to the filtered list is a link to
 * the same list. The two addresses come from the server page as strings,
 * because a function prop does not survive the boundary into a client
 * component (the cycle picker says how that was found).
 */
export function FilterSelect({
  label,
  value,
  options,
  anyLabel,
  hrefTemplate,
  anyHref,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly options: readonly { readonly id: string; readonly name: string }[];
  readonly anyLabel: string;
  /** The page's own address with this filter set to `FILTER_PLACEHOLDER`. */
  readonly hrefTemplate: string;
  /** The page's own address without this filter. */
  readonly anyHref: string;
}) {
  const router = useRouter();
  return (
    <label className="flex min-w-0 items-center gap-1 rounded-control bg-raised p-0.5 pl-2">
      <span className="flex-none text-[10px] font-bold uppercase tracking-wider text-ink-3">
        {label}
      </span>
      <select
        aria-label={label}
        value={value ?? ""}
        onChange={(event) =>
          router.push(
            event.target.value === ""
              ? anyHref
              : hrefTemplate.replace(
                  FILTER_PLACEHOLDER,
                  encodeURIComponent(event.target.value),
                ),
          )
        }
        className="h-7 max-w-44 truncate rounded-control border border-line bg-surface px-2 text-xs text-ink-2"
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
