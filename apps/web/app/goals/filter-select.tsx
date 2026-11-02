"use client";

import { type EntityOption, EntityPicker } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { searchMembers } from "../../lib/member-search.ts";
import { FILTER_PLACEHOLDER } from "./placeholders.ts";

/**
 * A filter with more options than fit as chips: a champion, a space
 * (P9-T07a-b, docs/design/okr-writing.md §3), found by typing
 * (guided-inputs §4.10).
 *
 * Choosing one is a navigation, so the filter is in the address like every
 * other control on this toolbar and a link to the filtered list is a link to
 * the same list. The two addresses come from the server page as strings,
 * because a function prop does not survive the boundary into a client
 * component (the cycle picker says how that was found). For the same reason
 * `people` says whether to search the directory, rather than passing the
 * search itself.
 */
export function FilterSelect({
  label,
  value,
  options,
  anyLabel,
  hrefTemplate,
  anyHref,
  people,
  bare,
}: {
  readonly label: string;
  readonly value: string | null;
  readonly options: readonly EntityOption[];
  readonly anyLabel: string;
  /** The page's own address with this filter set to `FILTER_PLACEHOLDER`. */
  readonly hrefTemplate: string;
  /** The page's own address without this filter. */
  readonly anyHref: string;
  /** The options are people, so a long list asks the directory. */
  readonly people?: boolean;
  /**
   * Only the picker, named by its label, for the filter panel, whose own
   * column already says "Champion" or "Space".
   */
  readonly bare?: boolean;
}) {
  const router = useRouter();
  const picker = (
    <EntityPicker
      label={label}
      hideLabel
      value={value}
      options={options}
      noneLabel={anyLabel}
      {...(people
        ? {
            search: (text: string) => searchMembers(text, ["human", "guest"]),
          }
        : {})}
      onValueChange={(next) =>
        router.push(
          next === null
            ? anyHref
            : hrefTemplate.replace(
                FILTER_PLACEHOLDER,
                encodeURIComponent(next),
              ),
        )
      }
      inputClassName={bare ? "h-7.5 w-full text-[12.5px]" : "h-7 w-44 text-xs"}
    />
  );
  if (bare) {
    // As wide as its field, so the chevron sits at the field's end.
    return <div className="w-52 max-w-full">{picker}</div>;
  }
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-control bg-raised p-0.5 pl-2">
      <span
        aria-hidden="true"
        className="flex-none text-xs font-semibold text-ink-3"
      >
        {label}
      </span>
      {picker}
    </div>
  );
}
