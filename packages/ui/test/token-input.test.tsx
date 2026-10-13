import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { TokenInput } from "../src/fields/token-input.tsx";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * A list of short entries (docs/design/guided-inputs.md §4.11): each entry
 * is a chip, checked and marked where it stands, rather than a comma list in
 * one box that is read only on Save.
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

const domainCheck = (entry: string) =>
  /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(entry) ? null : `${entry} is not a domain`;

describe("a token field", () => {
  test("opens on the saved entries, as chips, and posts them as one list", () => {
    const { container } = inEnglish(
      <TokenInput
        label="Trusted domains"
        name="trustedEmailDomains"
        defaultValue={["northwind.example", "acme.example"]}
      />,
    );
    const chips = screen.getAllByRole("listitem");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      expect.stringContaining("northwind.example"),
      expect.stringContaining("acme.example"),
    ]);
    expect(posted(container, "trustedEmailDomains")).toBe(
      "northwind.example, acme.example",
    );
  });

  test("makes a chip of each entry typed or pasted, by comma, space or line", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const { container } = inEnglish(
      <TokenInput
        label="Trusted domains"
        name="domains"
        normalise={(entry) => entry.toLowerCase()}
        onValueChange={changed}
      />,
    );
    const box = screen.getByLabelText("Trusted domains");
    await user.type(box, "Northwind.example,");
    await user.type(box, "acme.example{Enter}");
    await user.click(box);
    await user.paste("one.example two.example\nthree.example");
    await user.tab();
    expect(posted(container, "domains")).toBe(
      "northwind.example, acme.example, one.example, two.example, three.example",
    );
    expect(changed).toHaveBeenLastCalledWith([
      "northwind.example",
      "acme.example",
      "one.example",
      "two.example",
      "three.example",
    ]);
  });

  test("keeps a phrase whole where spaces do not separate", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <TokenInput label="Your own terms" name="words" separators="commas" />,
    );
    await user.type(
      screen.getByLabelText("Your own terms"),
      "work on, look into{Enter}",
    );
    expect(posted(container, "words")).toBe("work on, look into");
  });

  test("marks a wrong entry where it stands, says why, and holds the save", async () => {
    const user = userEvent.setup();
    inEnglish(
      <TokenInput label="Allowed domains" name="allowed" check={domainCheck} />,
    );
    const box = screen.getByLabelText("Allowed domains") as HTMLInputElement;
    await user.type(box, "acme.example nonsense{Enter}");
    const wrong = screen
      .getAllByRole("listitem")
      .find((chip) => chip.textContent?.includes("nonsense"));
    expect(wrong?.getAttribute("data-invalid")).toBe("true");
    expect(screen.getByText("nonsense is not a domain")).not.toBeNull();
    expect(box.validity.valid).toBe(false);
  });

  test("checks a domain or a host by the server's own rule, named by a server page", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <>
        <TokenInput label="Allowed domains" name="allowed" rule="domain" />
        <TokenInput label="Hosts" name="hosts" rule="host" joiner={"\n"} />
      </>,
    );
    await user.type(
      screen.getByLabelText("Allowed domains"),
      "Acme.Example @acme{Enter}",
    );
    expect(
      screen.getByText(
        "@acme is not a domain. Write it like example.com, without @ or https://.",
      ),
    ).not.toBeNull();
    expect(posted(container, "allowed")).toBe("acme.example, @acme");

    // A pasted address keeps only its host, as the save does.
    await user.type(
      screen.getByLabelText("Hosts"),
      "https://openrouter.ai/api/v1 not_a_host!{Enter}",
    );
    expect(posted(container, "hosts")).toBe("openrouter.ai\nnot_a_host!");
    expect(screen.getByText(/^not_a_host! is not a host\./)).not.toBeNull();
  });

  test("takes a chip back with its own button, or Backspace in an empty box", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <TokenInput
        label="Scopes"
        name="scopes"
        joiner=" "
        defaultValue={["openid", "email", "profile"]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Remove email" }));
    expect(posted(container, "scopes")).toBe("openid profile");
    await user.click(screen.getByLabelText("Scopes"));
    await user.keyboard("{Backspace}");
    expect(posted(container, "scopes")).toBe("openid");
  });

  test("keeps one of each, and goes back to the saved list when the form resets", async () => {
    const user = userEvent.setup();
    const { container } = inEnglish(
      <TokenInput
        label="Hosts"
        name="hosts"
        defaultValue={["api.openai.com"]}
      />,
    );
    await user.type(
      screen.getByLabelText("Hosts"),
      "api.openai.com x.example{Enter}",
    );
    expect(posted(container, "hosts")).toBe("api.openai.com, x.example");
    act(() => (container.querySelector("form") as HTMLFormElement).reset());
    expect(posted(container, "hosts")).toBe("api.openai.com");
  });
});
