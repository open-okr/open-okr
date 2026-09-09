import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SETTINGS_REGISTRY } from "@openokr/core";
import { describe, expect, test } from "vitest";

/**
 * Theme and density are reachable, and they follow the member (P6-G23,
 * GAP-AUDIT G-09).
 *
 * **`setTheme` and `setDensity` have existed since P2-T10 and nothing ever
 * called them.** UIUX-PLAN §9 asks every interface task to verify both themes
 * and both densities, and neither state was reachable from the product: the
 * only way into dark mode was to change the operating system.
 *
 * The columns, their defaults and the write are proved against a real database
 * in `packages/core`. What is checked here is that the control exists in both
 * places, writes to both homes, and does not fight itself.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const control = at("../lib/appearance.tsx");
const action = at("../lib/appearance-action.ts");
const shell = at("../lib/app-shell.tsx");
const menu = at("../app/avatar-menu.tsx");
const profile = at("../app/people/[id]/page.tsx");

describe("the appearance control", () => {
  test("calls the provider methods nothing had ever called", () => {
    expect(control).toContain("setTheme(option.value)");
    expect(control).toContain("setDensity(option.value)");
  });

  test("writes to the member as well as to the browser", () => {
    // The provider makes the change immediate and feeds the pre-hydration
    // script; the action is what makes it follow somebody to another machine.
    // Either alone is a different, worse product.
    expect(control).toContain("remember({ theme: option.value })");
    expect(control).toContain("remember({ density: option.value })");
    expect(action).toContain('"people.updateOwnProfile"');
  });

  test("is on both surfaces the task names", () => {
    expect(shell).toContain("<AppearanceControl compact />");
    expect(menu).toContain("{appearance}");
    // The profile passes the stored language in (P6-G22a): unlike the theme
    // there is no provider holding it, because the catalogue is chosen while
    // the page renders on the server.
    expect(profile).toContain("<AppearanceControl language={member.language}");
  });

  test("applies a stored choice once, not on every render", () => {
    // Re-applying it on every render would fight the control: a member who
    // has just switched theme in this tab wrote both, and the stored value is
    // whatever the server last saw.
    expect(control).toContain("applied.current");
    expect(shell).toContain("<AppearanceSync theme={me.theme}");
  });

  test("both settings are in the §4.14 map with a working default", () => {
    // Null is "follow the system", which is what the provider does with no
    // stored value, and not an unanswered question a member has to resolve.
    const declared = SETTINGS_REGISTRY.filter(
      (setting) => setting.key === "theme" || setting.key === "density",
    );
    expect(declared).toHaveLength(2);
    for (const setting of declared) {
      expect(setting.scope).toBe("member");
      expect(setting.home).toBe("workspace_members");
      expect(setting.resolve({})).toBeNull();
      expect(setting.schema.safeParse(null).success).toBe(true);
    }
  });

  test("repaints for the language and for nothing else", () => {
    // **This assertion was `not.toContain("revalidatePath(")` until P6-G22a,
    // and the language is what made it wrong.** A theme is applied by the
    // provider in the browser, so revalidating would re-render every page to
    // arrive at what the reader is already looking at. A language is not like
    // that: the text is rendered on the server, so the screen does not change
    // until the server renders it again.
    expect(action).toContain("if (input.language !== undefined)");
    expect(action).toContain('revalidatePath("/", "layout")');
    // Called once and only inside that branch, which is the half of the
    // original assertion that is still true.
    expect(action.split("revalidatePath(").length - 1).toBe(1);
  });

  test("offer the language, and only where a choice can navigate", () => {
    // P6-G22a. The catalogue has existed since P2-T10 and the root layout
    // pinned `en`, so `TranslationsProvider` took a locale nothing selected.
    expect(control).toContain("const LANGUAGES");
    // The placeholder itself is left out of the needle: Biome refuses a template
    // marker inside a plain string, and the prefix is what identifies the field.
    expect(control).toContain("data-testid={`language-");

    // Not in the compact menu. A theme applies the instant it is clicked; a
    // language comes from the server, so choosing one navigates, and a control
    // that navigates does not belong in a dropdown somebody opened to change
    // something else.
    expect(control).toContain("compact ? null : (");

    // And the language is the one field that has to revalidate, because the
    // text is rendered on the server.
    expect(action).toContain("if (input.language !== undefined)");
    expect(action).toContain('revalidatePath("/", "layout")');
  });

  test("the locale is resolved on the server and never throws", () => {
    // The root layout wraps the signed-out screens, which have no member and
    // often no workspace, so a locale resolved inline there would turn sign-in
    // into an error page.
    const locale = at("../lib/locale.ts");
    expect(locale).toContain("} catch {");
    expect(locale).toContain('return "en"');
    // Member first, then the workspace: the more specific answer wins, and an
    // organisation that set a language meant it for the people in it.
    expect(locale.indexOf("people.readMember")).toBeLessThan(
      locale.indexOf("settings.readWorkspaceSettings"),
    );
    const layout = at("../app/layout.tsx");
    expect(layout).toContain("lang={locale}");
    expect(layout).toContain("<TranslationsProvider locale={locale}>");
  });
});
