import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SettingsSaveBar } from "../src/forms/settings-save-bar.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * The shared save bar (docs/design/settings-page-layout.md §C): its five
 * states, and the two places it sits.
 */

function bar(props: Partial<Parameters<typeof SettingsSaveBar>[0]> = {}) {
  return render(
    <TranslationsProvider locale="en">
      <form id="f" />
      <SettingsSaveBar
        mode="sticky"
        formId="f"
        unsaved={[]}
        saved={null}
        error={null}
        pending={false}
        data-testid="bar"
        {...props}
      />
    </TranslationsProvider>,
  );
}

describe("SettingsSaveBar", () => {
  test("says nothing changed when it is idle", () => {
    bar();
    expect(screen.getByText("No changes.")).not.toBeNull();
  });

  test("uses the idle hint it is given", () => {
    bar({ idleHint: "Nothing to save." });
    expect(screen.getByText("Nothing to save.")).not.toBeNull();
    expect(screen.queryByText("No changes.")).toBeNull();
  });

  test("lists what is unsaved and lets Discard be pressed", () => {
    bar({ unsaved: ["Timezone", "Language"] });
    expect(
      screen.getByText("Not saved yet: Timezone, Language"),
    ).not.toBeNull();
    expect(screen.queryByText("No changes.")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  test("keeps Discard off when nothing is unsaved, and Save on", () => {
    bar();
    expect(
      (screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Save changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  test("turns both buttons off and says Saving while it is sent", () => {
    bar({ unsaved: ["Timezone"], pending: true });
    expect(
      (screen.getByRole("button", { name: "Discard" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const save = screen.getByRole("button", { name: /Saving/ });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  test("shows the saved line as a status", () => {
    bar({ saved: "Saved." });
    expect(screen.getByText("Saved.").getAttribute("role")).toBe("status");
  });

  test("shows a refusal as an alert", () => {
    bar({ error: "Nothing was saved." });
    expect(screen.getByRole("alert").textContent).toBe("Nothing was saved.");
  });

  test("acts on the form it names", () => {
    bar({ unsaved: ["Timezone"] });
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save.getAttribute("form")).toBe("f");
    expect(save.getAttribute("type")).toBe("submit");
    expect(save.getAttribute("name")).toBe("intent");
    expect(save.getAttribute("value")).toBe("save");
    const discard = screen.getByRole("button", { name: "Discard" });
    expect(discard.getAttribute("form")).toBe("f");
    expect(discard.getAttribute("type")).toBe("reset");
  });

  test("sticks to the window as the page's bar and marks unsaved with the brand line", () => {
    bar({ unsaved: ["Colour"] });
    const root = screen.getByTestId("bar");
    expect(root.className).toContain("sticky");
    expect(root.className).toContain("border-brand-line");
  });

  test("sits in its card as a footer without sticking", () => {
    bar({ mode: "footer", unsaved: ["Colour"] });
    const root = screen.getByTestId("bar");
    expect(root.className).not.toContain("sticky");
    expect(root.className).toContain("border-t");
  });
});
