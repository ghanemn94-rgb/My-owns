// Session gate (ADR-0005): GET /api/v1/me decides whether the user is signed in, provides the CSRF token and the
// permission hints, and sets the UI language from the persisted preference.
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ApiError, claimSessionEnd, getSessionPhase, subscribeSessionPhase } from "../api/client.ts";
import { useMeQuery } from "../api/queries.ts";
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

/** The sign-in URL after a session ended while the app was open (the page shows auth.errors.session_expired). */
export function sessionEndedLoginPath(returnTo: string): string {
  return `/login?returnTo=${encodeURIComponent(returnTo)}&error=session_expired`;
}

const subscribeEnded = subscribeSessionPhase;
const isEnded = () => getSessionPhase() === "ended";

export function RequireSession({ children }: { children: ReactNode }) {
  // F-DG2-480: the session-end rule lives in the API client (any 401 `unauthenticated` while the session was active,
  // from any request including GET /me). Only "ended" re-renders this component; signing out here is handled by the
  // shell itself.
  const ended = useSyncExternalStore(subscribeEnded, isEnded, isEnded);
  const me = useMeQuery({ enabled: !ended });
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const preferred = me.data?.user.preferredLocale;
  const redirected = useRef(false);
  const here = `${location.pathname}${location.search}`;

  // The session ended: clear the cached identity and every session-scoped query (once per session end), then go to
  // the sign-in page once. A dialog that got the 401 unmounts with the page. No /me is re-probed here (the query is
  // disabled), so nothing can bounce the user back, and the sign-in page probes /me once, fresh.
  useEffect(() => {
    if (!ended || redirected.current) return;
    redirected.current = true;
    if (claimSessionEnd()) {
      void queryClient.cancelQueries();
      queryClient.removeQueries();
    }
    void navigate(sessionEndedLoginPath(here), { replace: true });
  }, [ended, here, navigate, queryClient]);

  // The persisted preference wins after sign-in (REQ-S15-007); it also becomes the pre-sign-in hint.
  useEffect(() => {
    if (preferred && preferred !== i18n.language) void i18n.changeLanguage(preferred);
    if (preferred) rememberLocale(preferred);
  }, [preferred, i18n]);

  // Never render the signed-in shell (stale name, navigation, sign-out) for a session that has ended.
  if (ended) return null;
  if (me.isPending) return <LoadingState />;
  if (me.isError) {
    // No session in this tab yet (a 401 while active would have ended it above): plain redirect, no message.
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to={`/login?returnTo=${encodeURIComponent(here)}`} replace />;
    }
    if (!me.data) {
      return (
        <main className="page page--centered" id="main">
          <ErrorState error={me.error} onRetry={() => void me.refetch()} />
        </main>
      );
    }
  }
  return <MeContext.Provider value={me.data ?? null}>{children}</MeContext.Provider>;
}
