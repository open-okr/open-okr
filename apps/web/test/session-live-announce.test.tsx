// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../hooks/use-session-live", () => ({ useSessionLive: () => {} }));

import { SessionLive } from "../app/session/[id]/session-live";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const stages = [
  { key: "a", title: "Look at the numbers" },
  { key: "b", title: "Discuss what dropped" },
  { key: "c", title: "Commit" },
  { key: "d", title: "Close" },
];

function view(stageKey: string | null) {
  return (
    <TranslationsProvider locale="en">
      <SessionLive sessionId="s1" stageKey={stageKey} stages={stages} />
    </TranslationsProvider>
  );
}

describe("SessionLive stage announcement", () => {
  it("is silent on first render and names the new stage after a change", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(view("a")));
    const region = host.querySelector('[role="status"]');
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("");

    await act(async () => root.render(view("a")));
    expect(region?.textContent).toBe("");

    await act(async () => root.render(view("b")));
    expect(region?.textContent).toBe("Step 2 of 4: Discuss what dropped");
    await act(async () => root.unmount());
  });
});
