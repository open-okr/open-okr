import { CATALOGUES, translate } from "@openokr/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving the general admin card (S-36).
 *
 * **A mistyped timezone or domain sent the administrator to the error page.**
 * The save caught `OperationError` and threw everything else on, and both
 * values fail the action's input schema, which is not an `OperationError`. A
 * refusal it did catch returned nothing, so it said nothing either. These pin
 * that each refusal comes back as a sentence naming what was wrong, and that
 * nothing is written when it does.
 *
 * The real timezone check and domain schema are used, so the test agrees with
 * what the action itself would refuse.
 */

const callAction = vi.fn();

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../lib/auth", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1" },
  }),
}));

const { OperationError } = await import("@openokr/core");
const { submitGeneral } = await import("../app/admin/general/actions.ts");
const { NOTHING_SAVED } = await import("../app/admin/general/general-state.ts");

function card(fields: Record<string, string>): FormData {
  const form = new FormData();
  form.set("intent", "save");
  form.set("timezone", "Asia/Kuala_Lumpur");
  form.set("language", "en");
  form.set("trustedEmailDomains", "");
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }
  return form;
}

const en = (key: string, values?: Record<string, string>) =>
  translate(CATALOGUES.en, key, values);

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({});
});

describe("the general card's save", () => {
  it("writes what was typed and says so", async () => {
    const state = await submitGeneral(
      NOTHING_SAVED,
      card({
        trustedEmailDomains: "northwind.example, mail.northwind.example",
        requireSecondFactor: "on",
      }),
    );

    expect(state).toEqual({
      error: null,
      saved: en("admin.general.generalSettingsForm.saved"),
    });
    expect(callAction).toHaveBeenCalledWith(
      expect.anything(),
      "settings.updateWorkspaceGeneral",
      {
        timezone: "Asia/Kuala_Lumpur",
        language: "en",
        trustedEmailDomains: ["northwind.example", "mail.northwind.example"],
        requireSecondFactor: true,
      },
    );
  });

  it("refuses a timezone the server does not know, naming it", async () => {
    const state = await submitGeneral(
      NOTHING_SAVED,
      card({ timezone: "Mars/Olympus_Mons" }),
    );

    expect(callAction).not.toHaveBeenCalled();
    expect(state).toEqual({
      error: en("admin.general.generalSettingsForm.unknownTimezone", {
        timezone: "Mars/Olympus_Mons",
      }),
      saved: null,
    });
  });

  it("refuses an entry that is not a domain, naming the one", async () => {
    const state = await submitGeneral(
      NOTHING_SAVED,
      card({ trustedEmailDomains: "northwind.example, priya@northwind" }),
    );

    expect(callAction).not.toHaveBeenCalled();
    expect(state).toEqual({
      error: en("admin.general.generalSettingsForm.notADomain", {
        domain: "priya@northwind",
      }),
      saved: null,
    });
  });

  it("says why the action refused, rather than saying nothing", async () => {
    callAction.mockRejectedValue(
      new OperationError("forbidden", "Only an administrator can do this."),
    );

    const state = await submitGeneral(NOTHING_SAVED, card({}));

    expect(state).toEqual({
      error: "Only an administrator can do this.",
      saved: null,
    });
  });

  it("resets the card from the reset button", async () => {
    const form = new FormData();
    form.set("intent", "reset");

    const state = await submitGeneral(NOTHING_SAVED, form);

    expect(callAction).toHaveBeenCalledWith(
      expect.anything(),
      "settings.resetWorkspaceSettings",
      { card: "general" },
    );
    expect(state.saved).toBe(
      en("admin.general.generalSettingsForm.returnedToDefaults"),
    );
  });
});
