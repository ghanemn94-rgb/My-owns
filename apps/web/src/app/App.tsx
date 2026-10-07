// Application root: server-state cache, i18n instance and router.
import { QueryClient, QueryClientProvider, focusManager, onlineManager, type Query } from "@tanstack/react-query";
import type { i18n as I18n } from "i18next";
import { useEffect, useState, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { RouterProvider } from "react-router";
import { getSessionPhase, registerSessionReset, type SessionResetReason } from "../api/client.ts";
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

const isMeQuery = (q: Query) => q.queryKey[0] === keys.me[0];

/**
 * True when a mounted, enabled observer of `q` considers it stale NOW: TanStack Query's own rule for a focus refetch
 * (an observer's `isStale` result is only recomputed on its next update, so it cannot be used here).
 */
function isDue(q: Query): boolean {
  return q.observers.some((o) => {
    const { enabled, staleTime } = o.options;
    if ((typeof enabled === "function" ? enabled(q) : enabled) === false) return false;
    const time = typeof staleTime === "function" ? staleTime(q) : staleTime;
    return time !== "static" && q.isStaleByTime(time);
  });
}
const pending = new WeakMap<QueryClient, Promise<void>>();

/**
 * F-DG2-530 (X6): the refetch on window refocus and on reconnect, with GET /me FIRST. TanStack Query's own
 * refetchOnWindowFocus/refetchOnReconnect are off (createQueryClient), because they refetch the page queries with the
 * browser's current cookie while GET /me, fresh for 60 s, is not refetched: the header would then show the previous
 * identity above another identity's data. Here:
 *  1. nothing is refetched unless GET /me or an active page query is stale (as TanStack would decide);
 *  2. GET /me is refetched first (deduplicated with a /me already in flight, never cancelled): if it returns another
 *     identity, the API client resets the session state (and the session generation) before anything else renders;
 *  3. only when the session is still active and /me answered, the stale active page queries are refetched, under the
 *     identity the header shows.
 * At most one /me per focus or reconnect event, and concurrent events share one run: there is no /me storm.
 */
export function revalidateSessionFirst(queryClient: QueryClient): Promise<void> {
  const running = pending.get(queryClient);
  if (running) return running;
  const run = (async () => {
    const cache = queryClient.getQueryCache();
    const pages = { predicate: (q: Query) => !isMeQuery(q) && isDue(q) };
    const me = cache.find({ queryKey: keys.me, exact: true });
    const pagesStale = cache.findAll(pages).length > 0;
    if (me?.isActive()) {
      if (!pagesStale && !isDue(me)) return;
      const before = me.state.dataUpdateCount;
      await queryClient.refetchQueries({ queryKey: keys.me, exact: true, type: "active" }, { cancelRefetch: false });
      const after = cache.find({ queryKey: keys.me, exact: true });
      // /me failed (network, 5xx) or the session ended: the identity is not confirmed, so no page data is fetched.
      if (getSessionPhase() !== "active" || !after || after.state.dataUpdateCount === before) return;
    }
    if (pagesStale) await queryClient.refetchQueries(pages, { cancelRefetch: false });
  })().finally(() => pending.delete(queryClient));
  pending.set(queryClient, run);
  return run;
}

/** Wires revalidateSessionFirst to focus and reconnect events; returns the unsubscribe function. */
export function subscribeSessionFirstRefetch(queryClient: QueryClient): () => void {
  const onEvent = (yes: boolean) => {
    if (yes && focusManager.isFocused() && onlineManager.isOnline()) void revalidateSessionFirst(queryClient);
  };
  const offFocus = focusManager.subscribe(onEvent);
  const offOnline = onlineManager.subscribe(onEvent);
  return () => {
    offFocus();
    offOnline();
  };
}

/** The production query defaults (exported so that tests can reproduce them). */
export const QUERY_DEFAULTS = {
  retry: shouldRetry,
  staleTime: 15_000,
  // Focus and reconnect refetches go through revalidateSessionFirst (GET /me first), wired by <AppProviders>.
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const;

export function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: QUERY_DEFAULTS,
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
  useEffect(() => subscribeSessionFirstRefetch(queryClient), [queryClient]);
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
