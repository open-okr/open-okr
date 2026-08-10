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

const toneClass: Record<AvatarTone, string> = {
  a1: "bg-[#6366f1]",
  a2: "bg-[#0ea5e9]",
  a3: "bg-[#14b8a6]",
  a4: "bg-[#f59e0b]",
  a5: "bg-[#ec4899]",
  a6: "bg-[#8b5cf6]",
  a7: "bg-[#64748b]",
  a8: "bg-[#10b981]",
  bot: "bg-gradient-to-br from-[#6366f1] via-brand to-[#7c3aed]",
  bot2: "bg-gradient-to-br from-[#0ea5e9] to-[#14b8a6]",
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
        "shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]",
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
