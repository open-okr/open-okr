"use client";

import { SelectInput } from "@openokr/ui";
import { useRouter } from "next/navigation";

/**
 * A select whose every option is an address: choosing one navigates.
 *
 * For a row of links that outgrew the line, such as nine space tabs or a
 * year of cycles on the Work Map (usability review O2, O3). Each option
 * carries its own address from the server page, because a function prop does
 * not survive the boundary into a client component.
 */
export function NavSelect({
  label,
  value,
  options,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
    readonly href: string;
  }[];
  readonly testId?: string;
}) {
  const router = useRouter();
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" className="text-xs font-medium text-ink-3">
        {label}
      </span>
      <SelectInput
        label={label}
        hideLabel
        value={value}
        data-testid={testId}
        onChange={(event) => {
          const chosen = options.find(
            (one) => one.value === event.target.value,
          );
          if (chosen) {
            router.push(chosen.href);
          }
        }}
        inputClassName="h-7.5 w-auto min-w-36 text-xs"
      >
        {options.map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
      </SelectInput>
    </div>
  );
}
