"use client";

/**
 * Asking before typing is thrown away (P8-G11).
 *
 * **Nothing in this product warned about unsaved edits before this.** A grep
 * for `beforeunload`, `unsaved` and `dirty` across `apps/web` returned one
 * comment and no implementation, so 123 edited thresholds on `/admin/rhythm`
 * left with a click on the sidebar and said nothing on the way out.
 *
 * **Two exits, two mechanisms, and only one of them is the obvious one.**
 * `beforeunload` covers a reload, a closed tab and a link off the instance.
 * It does not fire on an App Router navigation, which is how somebody
 * actually leaves a settings screen: they click the sidebar, and Next changes
 * the page without the document ever unloading. Next exposes no navigation
 * guard, so the second mechanism catches the click on the way down, before
 * the router's own listener sees it.
 *
 * **One provider rather than one listener per form.** A screen can hold
 * several independently saved forms, and each installing its own capture
 * listener would ask the same question once per dirty form. The provider
 * holds the set of forms currently reporting unsaved work and asks once.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface UnsavedChangesValue {
  /** Adds or removes one form from the set of those holding unsaved work. */
  report(id: string, dirty: boolean): void;
}

const UnsavedChangesContext = createContext<UnsavedChangesValue | null>(null);

/**
 * The wording of the question.
 *
 * A parameter rather than a constant because this package holds no catalogue
 * of its own, and the shell passes the translated string in. Browsers ignore
 * whatever a page puts in `beforeunload` and show their own sentence, so this
 * is the text of the in-app confirm only.
 */
const FALLBACK_MESSAGE =
  "You have changes that have not been saved. Leave this page and lose them?";

export function UnsavedChangesProvider({
  message,
  children,
}: {
  readonly message?: string;
  readonly children: ReactNode;
}) {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const report = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((current) => {
      if (dirty === current.has(id)) {
        // Already in the state being reported. Returning the same set keeps
        // this a no-op rather than a new reference, which would re-render
        // every consumer on every keystroke.
        return current;
      }
      const next = new Set(current);
      if (dirty) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  // Read inside the listeners rather than closed over, so the listeners are
  // installed once and still see the current answer.
  const anyDirty = useRef(false);
  anyDirty.current = dirtyIds.size > 0;

  useEffect(() => {
    const ask = message ?? FALLBACK_MESSAGE;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!anyDirty.current) {
        return;
      }
      // Every current browser ignores a custom string here and shows its own
      // wording. `preventDefault` is what actually asks the question.
      event.preventDefault();
      event.returnValue = "";
    };

    const onClick = (event: MouseEvent) => {
      if (!anyDirty.current || event.defaultPrevented || event.button !== 0) {
        return;
      }
      // A modified click opens a new tab or window, so this page is not going
      // anywhere and there is nothing to lose.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      if (anchor.target !== "" && anchor.target !== "_self") {
        return;
      }
      if (anchor.hasAttribute("download")) {
        return;
      }
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) {
        return;
      }
      let destination: URL;
      try {
        destination = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // Another origin unloads the document, so `beforeunload` asks instead
      // and asking twice is worse than asking once.
      if (destination.origin !== window.location.origin) {
        return;
      }
      // A link to where we already are changes nothing.
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      ) {
        return;
      }
      if (!window.confirm(ask)) {
        event.preventDefault();
        // Capture phase, so this runs before the router's own handler. Both
        // halves are needed: `preventDefault` stops the browser following the
        // href, `stopPropagation` stops Next navigating anyway.
        event.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [message]);

  const value = useMemo<UnsavedChangesValue>(() => ({ report }), [report]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

/**
 * Reports one form's unsaved state for as long as it is mounted.
 *
 * **Silent without a provider, on purpose.** A form rendered in a test, in
 * the component gallery or in any tree that has not mounted the provider
 * still works; it just does not guard. Throwing instead would make the
 * provider a requirement of rendering a form, which is a worse trade than a
 * guard that is absent where nobody installed it.
 */
export function useUnsavedGuard(id: string, dirty: boolean): void {
  const context = useContext(UnsavedChangesContext);
  const report = context?.report;

  useEffect(() => {
    if (!report) {
      return;
    }
    report(id, dirty);
    // Unmounting while dirty must clear the entry, or navigating away after
    // answering "yes" leaves a form that no longer exists still asking.
    return () => report(id, false);
  }, [report, id, dirty]);
}
