// Sign-in (ADR-0005). The OIDC button starts the authorization-code + PKCE flow on the API (tokens never reach the
// browser). The development sign-in form appears ONLY when the server runs AUTH_MODE=dev:
//  - after a session, /me.authMode tells us directly (stored as a hint for this browser tab);
//  - before any session, /me is unavailable (401), so the page asks the server with a side-effect-free contract probe:
//    POST /api/v1/auth/dev-login with an empty body answers 400 (validation) when the route exists (dev mode) and 404
//    in every other mode (docs/api/openapi.yaml). Nothing is created, and no user is signed in by the probe.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { devLoginRequest } from "@mth/shared/schemas";
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { ApiError, apiRequest } from "../api/client.ts";
import { keys, useMeQuery } from "../api/queries.ts";
import { Icon } from "../components/Icon.tsx";
import { LanguageSwitch } from "../components/LanguageSwitch.tsx";
import { Wordmark } from "../components/Wordmark.tsx";
import { usePageTitle } from "../components/Page.tsx";
import { errorMessage } from "../lib/problem.ts";

const KNOWN_LOGIN_ERRORS = [
  "invalid_request",
  "state_invalid",
  "idp_denied",
  "token_invalid",
  "idp_unavailable",
  "account_disabled",
  "not_provisioned",
  "session_expired",
];

/** Only same-origin relative paths are followed after sign-in (open-redirect protection; the API checks again). */
export function safeReturnTo(value: string | null): string {
  if (!value || !/^\/(?!\/)[^\s\\]*$/.test(value) || value.startsWith("/login")) return "/";
  return value;
}

export type DevLoginAvailability = "available" | "unavailable" | "unknown";

export async function probeDevLogin(): Promise<DevLoginAvailability> {
  try {
    await apiRequest("/api/v1/auth/dev-login", { method: "POST", body: {}, silent401: true });
    return "unknown"; // an empty body can never succeed; treat anything unexpected as unknown (form hidden)
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) return "available";
    if (err instanceof ApiError && err.status === 404) return "unavailable";
    return "unknown";
  }
}

export function LoginPage() {
  const { t } = useTranslation();
  usePageTitle(t("auth.title"));
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const errorCode = params.get("error");
  const signedOut = params.get("signedOut") === "1";
  // F-DG2-480: "already signed in" is decided only from a /me answered after this page mounted, never from the cached
  // identity of a session that may have ended (that stale value used to bounce the user straight back: a loop).
  const [mountedAt] = useState(() => Date.now());
  const me = useMeQuery({ refetchOnMount: "always" });
  const signedIn = me.isSuccess && !me.isFetching && me.dataUpdatedAt >= mountedAt;
  const devLogin = useQuery({
    queryKey: ["dev-login-availability"],
    queryFn: probeDevLogin,
    staleTime: Infinity,
    retry: false,
    enabled: me.isError,
  });

  if (signedIn) return <Navigate to={returnTo} replace />;

  const loginHref = `/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  const errorText = errorCode
    ? t(`auth.errors.${KNOWN_LOGIN_ERRORS.includes(errorCode) ? errorCode : "generic"}`)
    : null;

  return (
    <div className="login">
      <header className="app-header app-header--login">
        <Wordmark linkTo="/login" />
        <div className="app-header__spacer" />
        <LanguageSwitch signedIn={false} />
      </header>
      <main id="main" className="login__main">
        <section className="card login__card" aria-labelledby="login-title">
          <h1 id="login-title">{t("auth.title")}</h1>
          <p className="muted">{t("auth.intro")}</p>
          {errorText ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" /> {errorText}
            </p>
          ) : null}
          {signedOut ? (
            <p className="banner banner--success" role="status">
              <Icon name="check" /> {t("auth.signedOut")}
            </p>
          ) : null}
          <a className="button button--primary button--block" href={loginHref}>
            {t("auth.oidcButton")}
          </a>
          <p className="muted small">{t("auth.oidcHint")}</p>
          {devLogin.data === "available" ? <DevLoginForm returnTo={returnTo} /> : null}
        </section>
        <p className="login__notice small">{t("common.brand.provisionalNotice")}</p>
      </main>
    </div>
  );
}

function DevLoginForm({ returnTo }: { returnTo: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [username, setUsername] = useState("");
  /** FE12: the cause, never translated text; the message is translated at render time so it follows a language switch. */
  const [failure, setFailure] = useState<{ invalidUsername: true } | { error: unknown } | null>(null);
  const error =
    failure === null ? null : "error" in failure ? errorMessage(t, failure.error) : t("auth.dev.invalidUsername");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = devLoginRequest.safeParse({ username: username.trim() });
    if (!parsed.success) {
      setFailure({ invalidUsername: true });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await apiRequest("/api/v1/auth/dev-login", { method: "POST", body: parsed.data, silent401: true });
      await queryClient.invalidateQueries({ queryKey: keys.me });
      void navigate(returnTo, { replace: true });
    } catch (err) {
      setFailure({ error: err });
      setBusy(false);
    }
  };

  return (
    <form className="dev-login" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`} className="dev-login__title">
        {t("auth.dev.title")}
      </h2>
      <p className="banner banner--warning" id={hintId}>
        <Icon name="alert" /> {t("auth.dev.warning")}
      </p>
      <div className={`field${error ? " field--invalid" : ""}`}>
        <label htmlFor={inputId} className="field__label">
          {t("auth.dev.username")}
        </label>
        <input
          id={inputId}
          name="username"
          dir="ltr"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          aria-invalid={error ? true : undefined}
          required
        />
        {error ? (
          <p id={errorId} className="field__error" role="alert">
            <Icon name="alert" /> {error}
          </p>
        ) : null}
      </div>
      <button type="submit" className="button button--secondary" disabled={busy}>
        {busy ? t("auth.dev.signingIn") : t("auth.dev.submit")}
      </button>
    </form>
  );
}
