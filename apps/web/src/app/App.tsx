// Application root: server-state cache, i18n instance and router.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { i18n as I18n } from "i18next";
import { useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { RouterProvider } from "react-router";
import { registerSessionReset, type SessionResetReason } from "../api/client.ts";
import { keys, shouldRetry } from "../api/queries.ts";
import { createAppRouter } from "./router.tsx";

/**
 * F-DG2-500: clears the session-scoped server-state cache. Called by the API client on a session end and on an identity
 * change, whatever page is mounted (see registerSessionReset). In-flight requests are cancelled first so that an answer
 * fetched under the previous session cannot land in the cache afterwards.
 *  - "ended": every query, the cached identity (GET /me) included;
 *  - "identity-changed": every query except GET /me, whose new answer (the new identity) is being stored right now.
 * Mutations in flight are dropped from the mutation cache too (their result belongs to the previous session).
 */
export function resetSessionCache(queryClient: QueryClient, reason: SessionResetReason): void {
  const filters =
    reason === "ended" ? {} : { predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== keys.me[0] };
  void queryClient.cancelQueries(filters);
  queryClient.removeQueries(filters);
  queryClient.getMutationCache().clear();
}

export function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: 15_000, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
  // Wired once per client, at creation: clearing never depends on a component being mounted.
  registerSessionReset((reason) => resetSessionCache(queryClient, reason));
  return queryClient;
}

export function AppProviders({
  i18n,
  queryClient,
  children,
}: {
  i18n: I18n;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

export function App({ i18n }: { i18n: I18n }) {
  // Created once per mount (StrictMode may render twice).
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(createAppRouter);
  return (
    <AppProviders i18n={i18n} queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
