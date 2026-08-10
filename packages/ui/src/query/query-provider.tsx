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
      persistOptions={{ persister, buster: buildId }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
