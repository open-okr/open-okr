import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { IdentifierInput } from "../src/fields/identifier-input.tsx";
import { UrlInput } from "../src/fields/url-input.tsx";
import { CATALOGUES, translate } from "../src/i18n/catalogue.ts";
import { TranslationsProvider } from "../src/i18n/use-translations.tsx";

/**
 * Web addresses and identifiers (docs/design/guided-inputs.md §4.11): each
 * checked with the rule the server refuses it by, marked when the person
 * leaves the field, and held as the control's own validity so a form is not
 * sent with one wrong.
 */

const en = (key: string) => translate(CATALOGUES.en, key);

function inEnglish(children: ReactNode) {
  return render(
    <TranslationsProvider locale="en">
      <form>{children}</form>
    </TranslationsProvider>,
  );
}

describe("a web address field", () => {
  it("takes a whole http or https address, without the space a paste brings", async () => {
    const user = userEvent.setup();
    inEnglish(<UrlInput label="Base URL" name="baseUrl" />);
    const control = screen.getByLabelText("Base URL") as HTMLInputElement;

    await user.type(control, " http://localhost:11434/v1 ");
    await user.tab();

    expect(control.value).toBe("http://localhost:11434/v1");
    expect(control.validity.valid).toBe(true);
    expect(control.getAttribute("type")).toBe("url");
    expect(control.getAttribute("spellcheck")).toBe("false");
  });

  it("marks what is not an address when the person leaves it", async () => {
    const user = userEvent.setup();
    inEnglish(<UrlInput label="Base URL" name="baseUrl" />);
    const control = screen.getByLabelText("Base URL") as HTMLInputElement;

    await user.type(control, "localhost:11434");
    expect(screen.queryByText(en("fields.url.invalid"))).toBeNull();
    await user.tab();

    expect(await screen.findByText(en("fields.url.invalid"))).not.toBeNull();
    expect(control.validity.valid).toBe(false);
  });

  it("takes only https where the server does", async () => {
    const user = userEvent.setup();
    inEnglish(<UrlInput label="Token URL" name="tokenUrl" secure />);
    const control = screen.getByLabelText("Token URL") as HTMLInputElement;

    await user.type(control, "http://idp.example/token");
    await user.tab();
    expect(await screen.findByText(en("fields.url.notSecure"))).not.toBeNull();

    await user.clear(control);
    await user.type(control, "https://idp.example/token");
    expect(control.validity.valid).toBe(true);

    // Plain http that never leaves this machine is taken, as the server does.
    await user.clear(control);
    await user.type(control, "http://localhost:8080/token");
    expect(control.validity.valid).toBe(true);
  });

  it("leaves an empty optional field alone", async () => {
    const user = userEvent.setup();
    inEnglish(<UrlInput label="Discovery URL" name="discoveryUrl" secure />);
    const control = screen.getByLabelText("Discovery URL") as HTMLInputElement;
    await user.click(control);
    await user.tab();
    expect(control.validity.valid).toBe(true);
  });
});

describe("an identifier field", () => {
  it("is monospace, unspellchecked and capped at the server's length", () => {
    inEnglish(<IdentifierInput label="Slack channel" name="slackChannel" />);
    const control = screen.getByLabelText("Slack channel") as HTMLInputElement;
    expect(control.className).toContain("font-mono");
    expect(control.getAttribute("spellcheck")).toBe("false");
    expect(control.getAttribute("autocapitalize")).toBe("none");
    expect(control.maxLength).toBe(200);
  });

  it("marks an id with a space in it, and trims one at either end", async () => {
    const user = userEvent.setup();
    inEnglish(<IdentifierInput label="Slack channel" name="slackChannel" />);
    const control = screen.getByLabelText("Slack channel") as HTMLInputElement;

    await user.type(control, " C0123ABCD ");
    await user.tab();
    expect(control.value).toBe("C0123ABCD");
    expect(control.validity.valid).toBe(true);

    await user.clear(control);
    await user.type(control, "team updates");
    await user.tab();
    expect(
      await screen.findByText(en("fields.identifier.oneWord")),
    ).not.toBeNull();
    expect(control.validity.valid).toBe(false);
  });

  it("lowers capitals as they are typed for a slug, and marks anything else", async () => {
    const user = userEvent.setup();
    inEnglish(
      <IdentifierInput label="Provider ID" name="providerId" rule="slug" />,
    );
    const control = screen.getByLabelText("Provider ID") as HTMLInputElement;

    await user.type(control, "Acme-SSO");
    expect(control.value).toBe("acme-sso");
    expect(control.validity.valid).toBe(true);

    await user.type(control, "_2");
    await user.tab();
    expect(control.value).toBe("acme-sso_2");
    expect(
      await screen.findByText(en("fields.identifier.slug")),
    ).not.toBeNull();
    expect(control.validity.valid).toBe(false);
  });
});
