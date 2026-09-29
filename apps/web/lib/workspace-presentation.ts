import { callAction, deriveBrandPalette } from "@openokr/core";
import type { TerminologyOverrides } from "@openokr/method";
import { renamedTerms } from "@openokr/ui";
import { cache } from "react";
import { getPool } from "./pool";
import { readRhythmForRequest } from "./rhythm";
import { requireWorkspace } from "./workspace";

/**
 * How this workspace presents itself: its words for the method's terms and its
 * brand colour (completeness review M-14).
 *
 * Both were saved on S-36 and read by nothing. They are resolved here, once per
 * request, and the root layout hands them to every screen: the terms to the
 * catalogue, the colour to the brand tokens.
 *
 * **Neither ever throws**, for the same reason `resolveLocale` does not: the
 * root layout wraps the signed-out screens too, which have no workspace to ask.
 * There the answer is the product's own words and the product's own colour.
 */

/** The terms this workspace renamed. Empty when it renamed none. */
export const workspaceTerms = cache(async (): Promise<TerminologyOverrides> => {
  try {
    const read = await readRhythmForRequest();
    return renamedTerms(read.terminology);
  } catch {
    return {};
  }
});

/** The brand colour the workspace chose, or null for the product's own. */
const workspaceBrandColour = cache(async (): Promise<string | null> => {
  try {
    const { session, workspace } = await requireWorkspace();
    // The member read rather than the admin one: every member's screens are
    // drawn in this colour, and `settings.readWorkspaceSettings` is `full`.
    const read = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human" as const, userId: session.user.id },
      },
      "settings.readForMember",
      {},
    );
    return read.settings.branding?.primaryColor ?? null;
  } catch {
    return null;
  }
});

/**
 * The style sheet that puts the workspace's colour into the brand tokens, or
 * null to leave `tokens.css` as it is.
 *
 * **Selectors one step more specific than `tokens.css`**, so they win whatever
 * order the two style sheets arrive in: `:root:root` beats the light `:root`
 * block, and `:root:root[data-theme=dark]` beats the dark one. Every token set
 * for light is set again for dark, or the light value would outrank the dark
 * default on a dark screen.
 *
 * The attribute value is unquoted on purpose. React escapes the text of a
 * `<style>` element, and a quote would reach the browser as `&quot;`.
 *
 * Null too for a colour the palette refuses, a status hue stored before the
 * schema refused one, which leaves the product's colour in force exactly as
 * the branding card says.
 */
export function brandStyleSheet(colour: string | null): string | null {
  if (colour === null) {
    return null;
  }
  const palette = deriveBrandPalette(colour);
  if (palette === null) {
    return null;
  }
  const declarations = (tokens: Readonly<Record<string, string>>) =>
    Object.entries(tokens)
      .map(([token, value]) => `${token}:${value};`)
      .join("");
  return (
    `:root:root{${declarations(palette.light)}}` +
    `:root:root[data-theme=dark]{${declarations(palette.dark)}}`
  );
}

/** The workspace's brand style sheet for this request, or null. */
export async function workspaceBrandStyleSheet(): Promise<string | null> {
  return brandStyleSheet(await workspaceBrandColour());
}
