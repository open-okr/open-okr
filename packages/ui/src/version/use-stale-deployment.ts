"use client";

/**
 * The stale-deployment reload (UIUX-PLAN.md §3: "A version mismatch after a
 * deployment triggers one reload with a clear message"; P2-T10 item 9's
 * acceptance line: "reloads once... a reload loop is the failure mode.").
 *
 * The embedded build id is whatever the currently-loaded page shipped with
 * (baked in at render time from `APP_BUILD_ID` — see
 * `packages/config/src/env.ts`); the live id comes from polling an
 * authenticated endpoint (`apps/web/app/api/app-version`), never the
 * public `/api/health`, which deliberately says nothing that could help an
 * unauthenticated caller fingerprint the deployment.
 */
import { useEffect, useRef, useState } from "react";

const RELOAD_STORAGE_KEY = "openokr:reloaded-for-build";
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Pure: true only the first time a given `liveBuildId` is seen as
 * different from what the page loaded with. Once `alreadyReloadedFor`
 * records that id, a repeat mismatch (e.g. the reload itself fetched a
 * cached, still-stale response) reports stale without reloading again —
 * the structural guard against a reload loop. */
export function shouldReload(
  embeddedBuildId: string,
  liveBuildId: string,
  alreadyReloadedFor: string | null,
): boolean {
  return liveBuildId !== embeddedBuildId && liveBuildId !== alreadyReloadedFor;
}

export interface UseStaleDeploymentOptions {
  readonly embeddedBuildId: string;
  readonly fetchLiveBuildId: () => Promise<string>;
  readonly pollIntervalMs?: number;
  /** Injectable for tests; defaults to `location.reload()`. */
  readonly reload?: () => void;
  readonly storage?: Pick<Storage, "getItem" | "setItem">;
}

export interface StaleDeploymentState {
  readonly stale: boolean;
}

export function useStaleDeployment({
  embeddedBuildId,
  fetchLiveBuildId,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  reload = () => window.location.reload(),
  storage,
}: UseStaleDeploymentOptions): StaleDeploymentState {
  const [stale, setStale] = useState(false);
  const reloadedRef = useRef(false);

  useEffect(() => {
    const store = storage ?? window.sessionStorage;

    const check = async () => {
      if (reloadedRef.current) {
        return;
      }
      let liveBuildId: string;
      try {
        liveBuildId = await fetchLiveBuildId();
      } catch {
        // A network blip is not a deployment; say nothing rather than
        // guessing staleness from a failed request.
        return;
      }
      const alreadyReloadedFor = store.getItem(RELOAD_STORAGE_KEY);
      if (!shouldReload(embeddedBuildId, liveBuildId, alreadyReloadedFor)) {
        return;
      }
      setStale(true);
      store.setItem(RELOAD_STORAGE_KEY, liveBuildId);
      reloadedRef.current = true;
      reload();
    };

    void check();
    const interval = window.setInterval(check, pollIntervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [embeddedBuildId, fetchLiveBuildId, pollIntervalMs, reload, storage]);

  return { stale };
}
