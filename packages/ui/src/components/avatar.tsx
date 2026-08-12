import { Avatar as BaseAvatar } from "@base-ui-components/react/avatar";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.ts";

/**
 * `.av`/`.av.sm`/`.av.lg`/`.a1`-`.a8`/`.av.bot`/`.av.bot2`/`.avstack` from
 * the mockups' style.css. Image loading and the initials fallback come
 * from Base UI's `Avatar` primitive (§2: "all accessibility behaviour...
 * comes from Base UI") rather than a bare `<img onError>`, which is what
 * makes the fallback show correctly during a slow load, not only after a
 * hard failure.
 */

export type AvatarSize = "sm" | "default" | "lg";
export type AvatarTone =
  | "a1"
  | "a2"
  | "a3"
  | "a4"
  | "a5"
  | "a6"
  | "a7"
  | "a8"
  | "bot"
  | "bot2";

const sizeClass: Record<AvatarSize, string> = {
  sm: "size-5 text-[8.5px]",
  default: "size-6 text-[10px]",
  lg: "size-[30px] text-[11.5px]",
};

/**
 * Identity colours, and the one palette in the product that is allowed to
 * be decorative. Two constraints shape it:
 *
 *   - rule 1 reserves red, amber and green for status, so no avatar may be
 *     any of them. The teal and lime the colour system warns about are out
 *     for the same reason: at 20px they read as on-track
 *   - the initials are white, so every fill clears 4.5:1 against white.
 *     #6265f0 and #0b7eb2 are the two that had to be darkened for it
 *
 * That leaves the blue-to-pink arc plus one warm neutral, which is eight
 * distinguishable hues without borrowing a meaning from the status scale.
 */
const toneClass: Record<AvatarTone, string> = {
  a1: "bg-[#6265f0]",
  a2: "bg-[#4338ca]",
  a3: "bg-[#2563eb]",
  a4: "bg-[#0b7eb2]",
  a5: "bg-[#7c3aed]",
  a6: "bg-[#a21caf]",
  a7: "bg-[#db2777]",
  a8: "bg-[#6b6a63]",
  bot: "bg-gradient-to-br from-[#6265f0] via-brand to-[#7c3aed]",
  bot2: "bg-gradient-to-br from-[#2563eb] to-[#a21caf]",
};

/** Deterministic, not random: the same member always resolves to the same
 * colour across renders and page loads (§2's iconography is fixed per
 * entity; a person's own colour should be just as stable). */
export function avatarToneFor(seed: string): AvatarTone {
  const tones: readonly AvatarTone[] = [
    "a1",
    "a2",
    "a3",
    "a4",
    "a5",
    "a6",
    "a7",
    "a8",
  ];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return tones[hash % tones.length] as AvatarTone;
}

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  readonly name: string;
  readonly src?: string | null;
  readonly size?: AvatarSize;
  readonly tone?: AvatarTone;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = "default",
  tone,
  className,
  ...props
}: AvatarProps) {
  return (
    <BaseAvatar.Root
      className={cn(
        "grid place-items-center rounded-full font-bold tracking-wide text-white",
        "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ink)_6%,transparent)]",
        sizeClass[size],
        toneClass[tone ?? avatarToneFor(name)],
        className,
      )}
      {...props}
    >
      {src ? (
        <BaseAvatar.Image
          src={src}
          alt={name}
          className="size-full rounded-full object-cover"
        />
      ) : null}
      <BaseAvatar.Fallback>{initialsOf(name)}</BaseAvatar.Fallback>
    </BaseAvatar.Root>
  );
}

export function AvatarStack({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex [&>*]:-ml-1.5 [&>*]:shadow-[0_0_0_2px_var(--color-surface)] [&>*:first-child]:ml-0">
      {children}
    </div>
  );
}
