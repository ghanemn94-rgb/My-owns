// The shared fallback of the route-level code splitting (T-DG4-FE-R2, app/router.tsx `lazyPage`). While a page's
// chunk loads, the main area shows ONE neutral status: a translated label in a polite live region (role="status"),
// the neutral action-coloured spinner and no number, no badge and no status colour, so it can never be read as data
// (never 0, never green). It reserves the block size of a page's first screen, so the shell does not move and the
// footer does not jump while the chunk arrives. A chunk that cannot be loaded (network, a new deployment) shows an
// error with a reload, never a blank page and never React Router's developer error screen.
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon.tsx";

/** Block size reserved for the page while its chunk loads (a page's first screen; logical property, RTL-safe). */
const RESERVED = { minBlockSize: "60vh" } as const;

export function RouteLoadingFallback() {
  const { t } = useTranslation();
  return (
    <div style={RESERVED} data-route-fallback="loading">
      <div className="state state--loading" role="status" aria-live="polite" data-state="loading">
        <span className="spinner" aria-hidden="true" />
        <span>{t("common.state.loadingPage")}</span>
      </div>
    </div>
  );
}

export function RouteLoadFailed() {
  const { t } = useTranslation();
  return (
    <div style={RESERVED} data-route-fallback="failed">
      <div className="state state--error banner banner--error" role="alert" data-state="error">
        <Icon name="alert" />
        <div>
          <p className="state__title">{t("common.state.errorTitle")}</p>
          <p className="state__body">{t("common.state.pageLoadFailed")}</p>
          <button type="button" className="button button--secondary" onClick={() => window.location.reload()}>
            <Icon name="refresh" /> {t("common.action.retry")}
          </button>
        </div>
      </div>
    </div>
  );
}
