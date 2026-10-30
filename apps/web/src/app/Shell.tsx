// Application shell (ADR-0009, REQ-S15-001): skip link, blue-gradient header with the provisional wordmark, language
// switch and user menu; blue primary navigation with the areas the server returns (GET /me/navigation); main landmark. Layout uses logical CSS
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
// T-DG5-FE-G: the render-time branding (name, logo, theme), the demo banner and the server-decided navigation.
import { DemoBanner, useSynthetic } from "../components/demo-label/DemoLabels.tsx";
import { useBranding, useBrandingTheme } from "../pages/branding/api.ts";
import { localName, useLocale } from "./locale.ts";
import { NAV_AREAS, NAV_SUBPAGES } from "./nav.ts";
import { useMyNavigation, visibleAreaIds } from "./me-navigation.ts";
import { ErrorState } from "../components/States.tsx";
// T-DG6-FE-E (ADR-0059 §1, §3): the optional assistant slot; renders nothing unless the assistant is on.
import { AssistantLauncher } from "../components/assistant/AssistantPanel.tsx";
// T-DG6-FE-D (ADR-0057 §3): the global search box slot of the header.
import { GlobalSearchBox } from "../pages/search/GlobalSearchBox.tsx";

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

  // T-DG5-FE-G2 (REQ-S03-007, ADR-0049 §9; D-163 option (a)): the server decides the areas. The shell shows exactly the
  // areas GET /me/navigation returns, in nav.ts order. While the read is pending it shows no area list (never all
  // fourteen), and a failed read shows the error state with a retry, never a client-side guess.
  const navigation = useMyNavigation();
  const visible = visibleAreaIds(navigation.data);
  const areas = visible ? NAV_AREAS.filter((a) => visible.has(a.id)) : [];
  // T-DG5-FE-G (REQ-S01-002, REQ-S15-004): the published branding is read at render time; the theme follows it.
  const branding = useBranding().data;
  useBrandingTheme();
  const synthetic = useSynthetic();
  const productName =
    branding && branding.source === "configured" && branding.productNameEn && branding.productNameAr
      ? locale === "ar"
        ? branding.productNameAr
        : branding.productNameEn
      : me.productName;
  const logo = branding?.logo
    ? { url: branding.logo.url, alt: locale === "ar" ? branding.logo.altAr : branding.logo.altEn }
    : null;
  // P4 sub-entries (nav.ts NAV_SUBPAGES) of the visible areas; a hint only, the server still decides.
  const subpagesOf = (areaId: string) =>
    NAV_SUBPAGES.filter((s) => s.area === areaId && (!s.requiresAny || canAny(me, s.requiresAny)));

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
        <Wordmark productName={productName} logo={logo} />
        <div className="app-header__spacer" />
        <GlobalSearchBox />
        <AssistantLauncher />
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
      {/* T-DG5-FE-G (ADR-0050 §2 a): the persistent synthetic-data banner on every screen of a demo database. */}
      <DemoBanner />
      <div className="app-body">
        <nav
          id={navId}
          className={`app-nav${navOpen ? " app-nav--open" : ""}`}
          aria-label={t("nav.primary")}
          aria-busy={navigation.isPending}
          data-nav-state={navigation.isPending ? "loading" : visible ? "ready" : "error"}
        >
          {navigation.isPending ? (
            <p className="app-nav__state" data-state="loading">
              <span className="spinner" aria-hidden="true" />
              <span>{t("nav.loading")}</span>
            </p>
          ) : null}
          {!navigation.isPending && !visible ? (
            <div className="app-nav__error">
              <ErrorState error={navigation.error} onRetry={() => void navigation.refetch()} />
            </div>
          ) : null}
          <ul className="app-nav__list">
            {areas.map((area) => (
              <li key={area.id}>
                <NavLink to={area.path} className="app-nav__link" data-area={area.id}>
                  <span>{t(`nav.areas.${area.id}.label`)}</span>
                  {area.availability === "planned" ? <span className="app-nav__tag">{t("nav.planned")}</span> : null}
                </NavLink>
                {subpagesOf(area.id).length > 0 ? (
                  <ul className="app-nav__sublist" aria-label={t(`nav.areas.${area.id}.label`)}>
                    {subpagesOf(area.id).map((sub) => (
                      <li key={sub.id}>
                        <NavLink to={sub.path} end className="app-nav__link app-nav__link--sub" data-subpage={sub.id}>
                          {t(`nav.sub.${sub.id}`)}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="app-nav__footer">
            <NavLink to="/about" className="app-nav__link app-nav__link--small">
              {t("nav.about")}
            </NavLink>
            {/* T-DG5-FE-G (REQ-S18-004): Help > Guided walkthrough, offered in a demo database. */}
            {synthetic ? (
              <NavLink to="/walkthrough" className="app-nav__link app-nav__link--small">
                {t("playbookP5.walkthrough.navLabel")}
              </NavLink>
            ) : null}
          </p>
        </nav>
        <main id="main" className="app-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
