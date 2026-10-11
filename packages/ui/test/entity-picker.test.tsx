import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import {
  type EntityOption,
  EntityPicker,
} from "../src/fields/entity-picker.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * Picking a person, a space, a goal or a KPI (docs/design/guided-inputs.md
 * §4.10): a list that can be searched, rather than a native select of every
 * member in the workspace.
 */

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">
      <form>{children}</form>
    </TranslationsProvider>,
  );
}

const posted = (container: HTMLElement, name: string) =>
  new FormData(container.querySelector("form") as HTMLFormElement).get(name);

const PEOPLE: readonly EntityOption[] = [
  { id: "m-1", label: "Priya Raman", detail: "Head of Growth", avatar: true },
  { id: "m-2", label: "Daniel Okafor", detail: "Engineer", avatar: true },
  { id: "m-3", label: "Mei Tan", detail: null, avatar: true },
  { id: "a-1", label: "OKR Coach", badge: "Agent", avatar: true },
];

/** Five hundred members, as §7's acceptance criterion has it. */
const MANY: readonly EntityOption[] = Array.from({ length: 500 }, (_, i) => ({
  id: `m-${i}`,
  label: `Member ${String(i).padStart(3, "0")}`,
  avatar: true,
}));

describe("an entity picker", () => {
  test("is labelled, shows the stored choice by name, and posts its id", () => {
    const { container } = inEnglish(
      <EntityPicker
        label="Champion"
        name="championId"
        options={PEOPLE}
        defaultValue="m-2"
      />,
    );
    const box = screen.getByLabelText("Champion") as HTMLInputElement;
    expect(box.value).toBe("Daniel Okafor");
    expect(posted(container, "championId")).toBe("m-2");
  });

  test("finds a member by what is typed, with their title, and the keyboard alone chooses one", async () => {
    const user = userEvent.setup();
    const chose = vi.fn();
    const { container } = inEnglish(
      <EntityPicker
        label="Champion"
        name="championId"
        options={PEOPLE}
        onValueChange={chose}
      />,
    );
    await user.type(screen.getByLabelText("Champion"), "pri");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("Priya Raman");
    expect(options[0]?.textContent).toContain("Head of Growth");

    await user.keyboard("{ArrowDown}{Enter}");
    expect(chose).toHaveBeenLastCalledWith("m-1");
    expect(posted(container, "championId")).toBe("m-1");
  });

  test("says an agent is one", async () => {
    const user = userEvent.setup();
    inEnglish(<EntityPicker label="Who" options={PEOPLE} />);
    await user.type(screen.getByLabelText("Who"), "coach");
    const [option] = await screen.findAllByRole("option");
    expect(option?.textContent).toContain("Agent");
  });

  test("keeps showing a stored choice that is no longer in the list", () => {
    const { container } = inEnglish(
      <EntityPicker
        label="Champion"
        name="championId"
        options={PEOPLE}
        defaultValue="gone"
        current={{ id: "gone", label: "Ben Ross" }}
      />,
    );
    expect((screen.getByLabelText("Champion") as HTMLInputElement).value).toBe(
      "Ben Ross",
    );
    expect(posted(container, "championId")).toBe("gone");
  });

  test("offers nobody only where it is told the contract allows it", async () => {
    const user = userEvent.setup();
    const chose = vi.fn();
    const { container, unmount } = inEnglish(
      <EntityPicker
        label="Owner"
        name="ownerId"
        options={PEOPLE}
        defaultValue="m-1"
        noneLabel="Nobody"
        onValueChange={chose}
      />,
    );
    await user.click(screen.getByLabelText("Owner"));
    await user.click(await screen.findByRole("option", { name: "Nobody" }));
    expect(chose).toHaveBeenLastCalledWith(null);
    expect(posted(container, "ownerId")).toBe("");
    unmount();

    inEnglish(<EntityPicker label="Champion" options={PEOPLE} />);
    await user.click(screen.getByLabelText("Champion"));
    await screen.findAllByRole("option");
    expect(screen.queryByRole("option", { name: "Nobody" })).toBeNull();
  });

  test("above two hundred, asks the server as the person types", async () => {
    const user = userEvent.setup();
    const search = vi.fn(async (text: string) =>
      text.toLowerCase().startsWith("pri")
        ? [{ id: "m-1", label: "Priya Raman", detail: "Head of Growth" }]
        : [],
    );
    inEnglish(<EntityPicker label="Champion" options={MANY} search={search} />);
    await user.type(screen.getByLabelText("Champion"), "pri");
    await waitFor(() => expect(search).toHaveBeenLastCalledWith("pri"));
    const options = await screen.findAllByRole("option");
    expect(options.map((one) => one.textContent)).toEqual([
      expect.stringContaining("Priya Raman"),
    ]);
    expect(options[0]?.textContent).toContain("Head of Growth");
  });

  test("keeps a press on itself or its list from reaching what holds it", async () => {
    // A diagram card opens its drawer on a press, which took the focus a
    // picker on the card needed.
    const user = userEvent.setup();
    const pressed = vi.fn();
    const chose = vi.fn();
    inEnglish(
      // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for a card that opens on a press
      // biome-ignore lint/a11y/useKeyWithClickEvents: as above
      <div onClick={pressed}>
        <EntityPicker label="Move" options={PEOPLE} onValueChange={chose} />
      </div>,
    );
    await user.click(screen.getByLabelText("Move"));
    await user.click(await screen.findByRole("option", { name: /Mei Tan/ }));
    expect(chose).toHaveBeenLastCalledWith("m-3");
    expect(pressed).not.toHaveBeenCalled();
  });

  test("in a table cell is named by its label alone", () => {
    inEnglish(
      <EntityPicker
        label="Champion of Grow revenue"
        hideLabel
        options={PEOPLE}
        defaultValue="m-1"
      />,
    );
    const box = screen.getByLabelText("Champion of Grow revenue");
    expect(box.getAttribute("aria-label")).toBe("Champion of Grow revenue");
  });

  test("goes back to its first choice when the form resets", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <EntityPicker
        label="Champion"
        name="championId"
        options={PEOPLE}
        defaultValue="m-2"
      />,
    );
    await user.click(screen.getByLabelText("Champion"));
    await user.click(await screen.findByRole("option", { name: /Mei Tan/ }));
    expect(posted(container, "championId")).toBe("m-3");
    act(() => (container.querySelector("form") as HTMLFormElement).reset());
    await waitFor(() => expect(posted(container, "championId")).toBe("m-2"));
  });
});
