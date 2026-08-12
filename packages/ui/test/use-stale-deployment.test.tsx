import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  shouldReload,
  useStaleDeployment,
} from "../src/version/use-stale-deployment.ts";

describe("shouldReload", () => {
  test("no mismatch, no reload", () => {
    expect(shouldReload("build-1", "build-1", null)).toBe(false);
  });

  test("a fresh mismatch reloads", () => {
    expect(shouldReload("build-1", "build-2", null)).toBe(true);
  });

  test("a mismatch already reloaded for does not reload again — the loop guard", () => {
    expect(shouldReload("build-1", "build-2", "build-2")).toBe(false);
  });
});

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("useStaleDeployment: a version mismatch triggers exactly one reload", () => {
  test("a matching build id never reloads", async () => {
    const reload = vi.fn();
    const fetchLiveBuildId = vi.fn().mockResolvedValue("build-1");
    renderHook(() =>
      useStaleDeployment({
        embeddedBuildId: "build-1",
        fetchLiveBuildId,
        reload,
        storage: memoryStorage(),
      }),
    );
    await waitFor(() => expect(fetchLiveBuildId).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });

  test("a mismatched build id reloads exactly once, even if the check runs again", async () => {
    const reload = vi.fn();
    const fetchLiveBuildId = vi.fn().mockResolvedValue("build-2");
    const storage = memoryStorage();
    const { result } = renderHook(() =>
      useStaleDeployment({
        embeddedBuildId: "build-1",
        fetchLiveBuildId,
        reload,
        storage,
        pollIntervalMs: 60_000,
      }),
    );
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(result.current.stale).toBe(true);

    // A second check (e.g. the tab regaining focus before the reload actually
    // navigates away) must not call reload a second time.
    await fetchLiveBuildId();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("a failed fetch is not treated as a version mismatch", async () => {
    const reload = vi.fn();
    const fetchLiveBuildId = vi
      .fn()
      .mockRejectedValue(new Error("network blip"));
    renderHook(() =>
      useStaleDeployment({
        embeddedBuildId: "build-1",
        fetchLiveBuildId,
        reload,
        storage: memoryStorage(),
      }),
    );
    await waitFor(() => expect(fetchLiveBuildId).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });
});
