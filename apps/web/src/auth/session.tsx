// Session gate (ADR-0005): GET /api/v1/me decides whether the user is signed in, provides the CSRF token and the
// permission hints, and sets the UI language from the persisted preference.
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router";
import { ApiError, onUnauthenticated } from "../api/client.ts";
import { keys, useMeQuery } from "../api/queries.ts";
import type { Me } from "../api/types.ts";
import { ErrorState, LoadingState } from "../components/States.tsx";
import { rememberLocale } from "../i18n/index.ts";

const MeContext = createContext<Me | null>(null);

/** The signed-in principal; only valid below <RequireSession>. */
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe() used outside <RequireSession>");
  return me;
}

/** The principal if a session exists (for components shared by the sign-in page and the shell). */
export function useOptionalMe(): Me | null {
  return useContext(MeContext);
}

export function RequireSession({ children }: { children: ReactNode }) {
  const me = useMeQuery();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const preferred = me.data?.user.preferredLocale;

  // Any 401 from another request means the session ended: re-probe /me, which then redirects to sign-in.
  useEffect(() => onUnauthenticated(() => void queryClient.invalidateQueries({ queryKey: keys.me })), [queryClient]);

  // The persisted preference wins after sign-in (REQ-S15-007); it also becomes the pre-sign-in hint.
  useEffect(() => {
    if (preferred && preferred !== i18n.language) void i18n.changeLanguage(preferred);
    if (preferred) rememberLocale(preferred);
  }, [preferred, i18n]);

  if (me.isPending) return <LoadingState />;
  if (me.isError && (!me.data || (me.error instanceof ApiError && me.error.status === 401))) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      const returnTo = `${location.pathname}${location.search}`;
      const expired = me.data !== undefined;
      return (
        <Navigate
          to={`/login?returnTo=${encodeURIComponent(returnTo)}${expired ? "&error=session_expired" : ""}`}
          replace
        />
      );
    }
    return (
      <main className="page page--centered" id="main">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </main>
    );
  }
  return <MeContext.Provider value={me.data ?? null}>{children}</MeContext.Provider>;
}
