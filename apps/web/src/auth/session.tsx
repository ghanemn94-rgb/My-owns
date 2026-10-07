// Session gate (ADR-0005): GET /api/v1/me decides whether the user is signed in, provides the CSRF token and the
// permission hints, and sets the UI language from the persisted preference.
import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
// eslint-disable-next-line no-restricted-imports -- session transition: the redirect after a session END navigates because the generation moved
import { Navigate, useLocation, useNavigate } from "react-router";
import {
  ApiError,
  getSessionPhase,
  isSessionChangedError,
  revalidateSessionIdentity,
  subscribeSessionPhase,
} from "../api/client.ts";
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
  const { i18n } = useTranslation();
  const preferred = me.data?.user.preferredLocale;
  const redirected = useRef(false);
  const here = `${location.pathname}${location.search}`;

  // The session ended: go to the sign-in page once. The API client has already cleared the cached identity and every
  // session-scoped query where the session ended (F-DG2-500: api/client.ts endSession, whatever page is mounted). A
  // dialog that got the 401 unmounts with the page. No /me is re-probed here (the query is disabled), so nothing can
  // bounce the user back, and the sign-in page probes /me once, fresh.
  useEffect(() => {
    if (!ended || redirected.current) return;
    redirected.current = true;
    void navigate(sessionEndedLoginPath(here), { replace: true });
  }, [ended, here, navigate]);

  // F-DG2-570: every in-app navigation to another path confirms the identity (GET /me) before the new page's data is
  // fetched: the API client holds that page's GETs until /me has answered, so the header and the data on screen belong
  // to one identity even when another tab signed someone else in moments ago. A LAYOUT effect, so it starts before the
  // new page's queries subscribe (passive effects). Not on the first render (GET /me is being fetched right then).
  const lastPath = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previous = lastPath.current;
    lastPath.current = location.pathname;
    if (previous !== null && previous !== location.pathname) void revalidateSessionIdentity();
  }, [location.pathname]);

  // The persisted preference wins after sign-in (REQ-S15-007); it also becomes the pre-sign-in hint. It is applied
  // when it is first known and whenever it changes, never merely because the displayed language changed: react-i18next
  // hands out a new `i18n` wrapper on every language change, and re-applying an unchanged preference then reverted a
  // switch whose save was refused (T-DG2-FE11) and briefly flipped back a switch whose save was still in flight.
  const appliedPreferred = useRef<string | null>(null);
  useEffect(() => {
    if (!preferred || appliedPreferred.current === preferred) return;
    appliedPreferred.current = preferred;
    if (preferred !== i18n.language) void i18n.changeLanguage(preferred);
    rememberLocale(preferred);
  }, [preferred, i18n]);

  // F-DG2-530: a GET /me sent before the session generation moved (another /me of this tab brought a new identity
  // meanwhile) answers SessionChangedError instead of data. It is probed again once, under the current generation, so
  // the cached identity is never left behind the one the API client now holds. Bounded: one probe per such failure.
  const meSessionChanged = me.isError && isSessionChangedError(me.error);
  const { refetch: refetchMe } = me;
  useEffect(() => {
    if (meSessionChanged && !ended) void refetchMe();
  }, [meSessionChanged, me.errorUpdatedAt, ended, refetchMe]);

  // Never render the signed-in shell (stale name, navigation, sign-out) for a session that has ended.
  if (ended) return null;
  if (me.isPending) return <LoadingState />;
  if (meSessionChanged && !me.data) return <LoadingState />;
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
  // F-DG2-500: the signed-in tree is keyed by the person (organization and user). Another person remounts it, so no
  // component state of the previous one (a draft form, an open dialog, a typed filter) survives into it. The queries
  // were already removed when GET /me returned the new identity (api/queries.ts fetchMe: any other user OR session).
  // A new session of the SAME person (signed in again in another tab) keeps that person's own unsaved input.
  return (
    <MeContext.Provider value={me.data ?? null}>
      <Fragment key={me.data ? `${me.data.user.organizationId}:${me.data.user.id}` : "none"}>{children}</Fragment>
    </MeContext.Provider>
  );
}
