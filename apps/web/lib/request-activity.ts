/**
 * Counts the requests a person is waiting on, for the shell's activity bar
 * (UIUX-PLAN.md §4, "Acting").
 *
 * **Why `fetch`.** A save, a create, an edit, a delete and the refresh after
 * any of them all reach the server through `fetch`, with a header Next sets:
 * `next-action` on a server action, `rsc` on a server-component request. So
 * counting those is the one place that sees every click, including ones not
 * written yet, the way jQuery's `ajaxStart` did. Without it a slow save and a
 * button that was never pressed looked the same.
 *
 * **What does not count.** A prefetch, because nobody clicked anything, and
 * every plain `fetch`: the live feed and the badges hold long requests open
 * on purpose, and a bar that never went away would teach people to ignore it.
 *
 * The header names are Next's, not a public API; a test pins them to the
 * installed version so an upgrade that renames one fails the build.
 */

const COUNTED = ["next-action", "rsc"] as const;
const PREFETCH = ["next-router-prefetch", "next-router-segment-prefetch"];

function headerNames(headers: HeadersInit | undefined): Set<string> {
  const names = new Set<string>();
  if (!headers) {
    return names;
  }
  if (headers instanceof Headers) {
    for (const name of headers.keys()) {
      names.add(name.toLowerCase());
    }
  } else if (Array.isArray(headers)) {
    for (const [name] of headers) {
      names.add(name.toLowerCase());
    }
  } else {
    for (const name of Object.keys(headers)) {
      names.add(name.toLowerCase());
    }
  }
  return names;
}

/** Whether a request is one a person is waiting on. */
export function isAppRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): boolean {
  const names = headerNames(init?.headers);
  if (input instanceof Request) {
    for (const name of headerNames(input.headers)) {
      names.add(name);
    }
  }
  if (PREFETCH.some((name) => names.has(name))) {
    return false;
  }
  return COUNTED.some((name) => names.has(name));
}

export interface RequestActivity {
  /** How many counted requests are in flight. */
  count(): number;
  /** Called whenever the count changes. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** A `fetch` that counts the requests that matter and passes on the rest. */
  wrap(base: typeof fetch): typeof fetch;
}

export function createRequestActivity(): RequestActivity {
  let inFlight = 0;
  const listeners = new Set<() => void>();
  const change = (delta: number) => {
    inFlight += delta;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    count: () => inFlight,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    wrap(base) {
      return ((input: RequestInfo | URL, init?: RequestInit) => {
        if (!isAppRequest(input, init)) {
          return base(input, init);
        }
        change(1);
        return base(input, init).finally(() => change(-1));
      }) as typeof fetch;
    },
  };
}
