/**
 * The class of one row in the avatar menu. In a module of its own, with no
 * `"use client"`: `avatar-menu.tsx` is a client module, and a string imported
 * from one into a server component arrives as a client reference, not as the
 * string, so the sign-out button (drawn on the server) was left with no class
 * at all.
 */
export const menuRowClass =
  "block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-ink-2 data-highlighted:bg-raised hover:bg-raised";
