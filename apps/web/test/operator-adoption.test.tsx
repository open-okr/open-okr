// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CATALOGUES, TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AdoptWaiting } from "../app/operator/adopt-waiting";

/**
 * Workspaces waiting to be adopted, on S-45 (Q-9, plan 0.8.1).
 *
 * Turning the cloud flag on after workspaces exist read "0 tenants" until the
 * hourly adopt ran. The count and the adopt are proved against a database in
 * `packages/core/test/operator-adopt.test.ts`, and the screen end to end in
 * `e2e/s45-operator-console.spec.ts`. What is checked here is what the notice
 * says and that its answer survives the page dropping the count to zero.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const draw = async (
  count: number,
  action: () => Promise<{ done?: string; error?: string }>,
) => {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <AdoptWaiting count={count} action={action} />
      </TranslationsProvider>,
    );
  });
};

describe("the notice", () => {
  test("says how many wait and why, and offers Adopt now", async () => {
    await draw(3, async () => ({}));
    const notice = host.querySelector('[data-testid="adoption-waiting"]');
    expect(notice?.textContent).toContain(
      "3 workspaces are not in this list yet. They were made before this instance became a cloud",
    );
    expect(notice?.querySelector('button[type="submit"]')?.textContent).toBe(
      "Adopt now",
    );
  });

  test("draws nothing when nothing waits and nothing was pressed", async () => {
    await draw(0, async () => ({}));
    expect(host.innerHTML).toBe("");
  });

  test("keeps its answer after the page's count drops to zero", async () => {
    const action = vi.fn(async () => ({ done: "Adopted 3 workspaces." }));
    await draw(3, action);
    const form = host.querySelector("form");
    await act(async () => {
      form?.requestSubmit();
    });
    expect(action).toHaveBeenCalledTimes(1);
    // What revalidating the page does: the same slot, now with none waiting.
    await draw(0, action);
    expect(
      host.querySelector('[data-testid="adoption-result"]')?.textContent,
    ).toBe("Adopted 3 workspaces.");
    expect(host.querySelector('[data-testid="adoption-waiting"]')).toBeNull();
  });

  test("shows a refusal in words and keeps the button", async () => {
    await draw(2, async () => ({ error: "No such page." }));
    await act(async () => {
      host.querySelector("form")?.requestSubmit();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "No such page.",
    );
    expect(host.querySelector('button[type="submit"]')).not.toBeNull();
  });
});

describe("the console", () => {
  const list = at("../app/operator/page.tsx");
  const actions = at("../app/operator/workspace-actions.ts");

  test("keeps its empty state for a truly empty instance only", () => {
    expect(list).toContain(
      "countWorkspacesAwaitingAdoption(pool, operator.userId)",
    );
    expect(list).toContain("waiting === 0 ? (");
    expect(list).toContain(
      "<AdoptWaiting count={waiting} action={adoptWaitingWorkspaces} />",
    );
  });

  test("adopts for an operator only, checked before anything else", () => {
    const body = actions.slice(
      actions.indexOf("export async function adoptWaitingWorkspaces"),
    );
    expect(body.indexOf("await requireOperator()")).toBeGreaterThan(-1);
    expect(body.indexOf("await requireOperator()")).toBeLessThan(
      body.indexOf("adoptWorkspacesAsOperator("),
    );
  });

  test("says it in Malay too", () => {
    for (const key of [
      "operator.workspaces.waitingOne",
      "operator.workspaces.waitingOther",
      "operator.workspaces.adoptNow",
      "operator.workspaces.adoptedNone",
      "operator.workspaces.adoptedOne",
      "operator.workspaces.adoptedOther",
    ]) {
      expect(CATALOGUES.ms[key]).toBeTruthy();
      expect(CATALOGUES.ms[key]).not.toBe(CATALOGUES.en[key]);
    }
  });
});
