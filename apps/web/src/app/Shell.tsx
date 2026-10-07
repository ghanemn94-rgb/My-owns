// Application shell (ADR-0009, REQ-S15-001): skip link, blue-gradient header with the provisional wordmark, language
// switch and user menu; blue primary navigation with the fourteen areas; main landmark. Layout uses logical CSS
// properties only, so RTL mirrors automatically.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
// eslint-disable-next-line no-restricted-imports -- session transition: signing out here moves the generation (markSignedOut) and then navigates
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api, markSignedOut } from "../api/client.ts";
import { canAny } from "../auth/permissions.ts";
import { useMe } from "../auth/session.tsx";
import { Icon } from "../components/Icon.tsx";
import { LanguageNotSavedNotice, LanguageSwitch, useLanguageNotSaved } from "../components/LanguageSwitch.tsx";
import { Wordmark } from "../components/Wordmark.tsx";
import { localName, useLocale } from "./locale.ts";
import { NAV_AREAS } from "./nav.ts";

export function Shell() {
  const { t } = useTranslation();
  const me = useMe();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [navOpen, setNavOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [languageRefused, setLanguageRefused] = useLanguageNotSaved();
  const navId = useId();

  // Close the (small-screen) navigation after navigating.
  useEffect(() => setNavOpen(false), [location.pathname]);

  const areas = NAV_AREAS.filter((a) => !a.requiresAny || canAny(me, a.requiresAny));

  // Signing out here is on purpose: markSignedOut() first, so the 401s that follow are not a "session ended" event (and
  // RequireSession does not redirect with that message), then the whole session cache is dropped. A logout that
  // answers 401 means the session had already ended: the user is signed out either way (silent401).
  const signOut = async () => {
    setSigningOut(true);
    let endSessionUrl: string | null = null;
    let ok = false;
    try {
      const result = await api.send<{ endSessionUrl: string | null }>("/api/v1/auth/logout", {
        method: "POST",
        silent401: true,
      });
      endSessionUrl = result.endSessionUrl;
      ok = true;
    } catch {
      setSigningOut(false);
    }
    markSignedOut();
    void queryClient.cancelQueries();
    queryClient.clear();
    if (endSessionUrl) window.location.assign(endSessionUrl);
    else void navigate(ok ? "/login?signedOut=1" : "/login", { replace: true });
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t("common.a11y.skipToContent")}
      </a>
      <header className="app-header">
        <button
          type="button"
          className="button button--ghost-inverse nav-toggle"
          aria-expanded={navOpen}
          aria-controls={navId}
          onClick={() => setNavOpen((o) => !o)}
        >
          <Icon name="menu" />
          <span className="visually-hidden">{t("nav.toggle")}</span>
        </button>
        <Wordmark productName={me.productName} />
        <div className="app-header__spacer" />
        <LanguageSwitch signedIn onRefusedChange={setLanguageRefused} />
        <div className="user-box">
          <span className="user-box__name">{me.user.displayName}</span>
          <span className="user-box__org">{localName(me.organization, locale)}</span>
        </div>
        <button
          type="button"
          className="button button--ghost-inverse button--small"
          onClick={() => void signOut()}
          disabled={signingOut}
        >
          <Icon name="signOut" /> <span className="app-header__label">{t("auth.signOut")}</span>
        </button>
      </header>
      {/* FE12: below the header, so the notice never wraps the header row or squeezes the wordmark. */}
      <LanguageNotSavedNotice refused={languageRefused} />
      <div className="app-body">
        <nav id={navId} className={`app-nav${navOpen ? " app-nav--open" : ""}`} aria-label={t("nav.primary")}>
          <ul className="app-nav__list">
            {areas.map((area) => (
              <li key={area.id}>
                <NavLink to={area.path} className="app-nav__link" data-area={area.id}>
                  <span>{t(`nav.areas.${area.id}.label`)}</span>
                  {area.availability === "planned" ? <span className="app-nav__tag">{t("nav.planned")}</span> : null}
                </NavLink>
              </li>
            ))}
          </ul>
          <p className="app-nav__footer">
            <NavLink to="/about" className="app-nav__link app-nav__link--small">
              {t("nav.about")}
            </NavLink>
          </p>
        </nav>
        <main id="main" className="app-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
