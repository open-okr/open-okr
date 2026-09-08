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
    expect(profile).toContain("<AppearanceControl />");
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

  test("the action does not repaint the page it just changed", () => {
    // The browser has already applied it. Revalidating would re-render every
    // page to arrive at what the reader is already looking at.
    expect(action).not.toContain("revalidatePath(");
  });
});
