import { TranslationsProvider } from "@openokr/ui";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The instance's name on the screens a visitor sees first (completeness
 * review M-33), with `OPENOKR_INSTANCE_NAME` set on the server.
 *
 * The demo deployment set the variable to "OpenOKR demo" and every page still
 * said "OpenOKR": the tab title was a literal in the root layout and the
 * sign-in heading a literal in the catalogue. The end-to-end wizard spec
 * walks the same path in a browser; this proves it without one, and without
 * a database, because the name has to survive a database that does not
 * answer.
 */

// A pool that refuses everything: the reader must fall back to the
// environment rather than fail the page.
vi.mock("../lib/pool", () => ({
  getPool: () => ({
    query: () => Promise.reject(new Error("connection refused")),
    connect: () => Promise.reject(new Error("connection refused")),
  }),
}));
// The Next.js compiler supplies these three, and a unit test has none.
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-sans" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../lib/auth-client", () => ({ authClient: {} }));
vi.mock("../app/setup/account/actions", () => ({ finishSetup: vi.fn() }));

const { generateMetadata } = await import("../app/layout");
const { InstanceNameProvider } = await import("../lib/instance-name-context");
const { default: SignInPage } = await import("../app/(auth)/sign-in/page");
const { SetupAccountForm } = await import(
  "../app/setup/account/setup-account-form"
);

const original = process.env.OPENOKR_INSTANCE_NAME;

beforeEach(() => {
  process.env.OPENOKR_INSTANCE_NAME = "OKR Goal";
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.OPENOKR_INSTANCE_NAME;
  } else {
    process.env.OPENOKR_INSTANCE_NAME = original;
  }
});

/** A client component as the root layout wraps it. */
const rendered = (name: string, child: ReactNode) =>
  renderToString(
    createElement(
      TranslationsProvider,
      { locale: "en" } as ComponentProps<typeof TranslationsProvider>,
      createElement(
        InstanceNameProvider,
        { name } as ComponentProps<typeof InstanceNameProvider>,
        child,
      ),
    ),
  );

describe("the tab title", () => {
  it("is the instance's name when the deployment sets one", async () => {
    expect((await generateMetadata()).title).toBe("OKR Goal");
  });

  it("is OpenOKR when nothing names the instance", async () => {
    delete process.env.OPENOKR_INSTANCE_NAME;
    expect((await generateMetadata()).title).toBe("OpenOKR");
  });
});

describe("the sign-in heading", () => {
  it("names the instance the layout hands down", () => {
    const html = rendered("OKR Goal", createElement(SignInPage));
    expect(html).toContain("Sign in to OKR Goal");
    expect(html).not.toContain("OpenOKR");
  });
});

describe("the wizard's name field", () => {
  it("is pre-filled with the name the instance already has", () => {
    // Before this it was the literal "OpenOKR", so clicking through the
    // wizard stored "OpenOKR" over the operator's variable.
    const html = rendered("OKR Goal", createElement(SetupAccountForm));
    expect(html).toMatch(/name="instanceName"[^>]*value="OKR Goal"/);
  });
});

describe("the root layout", () => {
  it("hands every client component the resolved name", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      fileURLToPath(new URL("../app/layout.tsx", import.meta.url)),
      "utf8",
    );
    // Read once through the one reader, and provided around the children.
    expect(source).toContain("await getInstanceName()");
    expect(source).toContain("<InstanceNameProvider name={instanceName}>");
  });
});
