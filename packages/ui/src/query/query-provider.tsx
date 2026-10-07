"use client";

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
/**
 * The persisted client cache (P2-T10 item 9, first half — the second half
 * is `use-stale-deployment.ts`). TanStack Query is the locked stack's own
 * data layer (CLAUDE.md); this only adds the persistence and the
 * build-id `buster`, which is the library's own documented mechanism for
 * "invalidate the persisted cache when this string changes" — a stale
 * tab's local cache from a previous deployment is discarded on load
 * rather than served, without this module needing to know why the string
 * changed.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { type ReactNode, useState } from "react";

/**
 * Whether a query may be written to the browser's storage.
 *
 * **A query that marks itself `meta: { persist: false }` is kept in memory
 * only** (P9-T06c). An OKR tree is a workspace's own plans with names in
 * them, and local storage outlives a sign-out on a shared machine; the server
 * render hands a fresh copy to every page anyway, so persisting it would buy
 * nothing a reader could see. Everything else keeps the library's default,
 * which persists a query once it has succeeded.
 */
function persistable(query: {
  readonly state: { readonly status: string };
  readonly meta?: Record<string, unknown> | undefined;
}): boolean {
  return query.state.status === "success" && query.meta?.persist !== false;
}

export {
  QueryClient,
  QueryClientProvider,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

export interface QueryProviderProps {
  readonly children: ReactNode;
  readonly buildId: string;
}

export function QueryProvider({ children, buildId }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
          },
        },
      }),
  );

  if (typeof window === "undefined") {
    // No storage to persist to during server rendering; the plain
    // provider behaves identically for that one render.
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  const persister = createSyncStoragePersister({
    storage: window.localStorage,
  });

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        buster: buildId,
        dehydrateOptions: { shouldDehydrateQuery: persistable },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
