// Breadcrumbs (T-DG6-FE-D; ADR-0057 §9; REQ-S15-010 "breadcrumbs"): built in the client from the route and the names
// the page has already loaded (area -> transformation -> register -> record). No API call. The trail follows the
// document direction (right to left in Arabic, through the inherited `dir`), the current page is `aria-current`, and
// every label (a record code or user text) is isolated with <bdi> so an English code inside Arabic keeps its order.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

export interface Crumb {
  readonly label: string;
  readonly to?: string;
  /** A record or transformation code: shown left-to-right inside the label's isolation. */
  readonly code?: string;
}

export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  const { t } = useTranslation();
  if (crumbs.length === 0) return null;
  const last = crumbs.length - 1;
  return (
    <nav aria-label={t("common.a11y.breadcrumbs")} className="breadcrumbs" data-breadcrumbs>
      <ol>
        {crumbs.map((c, i) => {
          const text = (
            <>
              {c.code ? (
                <bdi dir="ltr" className="code">
                  {c.code}
                </bdi>
              ) : null}
              {c.code && c.label ? " " : null}
              {c.label ? <bdi>{c.label}</bdi> : null}
            </>
          );
          return (
            <li key={`${c.code ?? ""}${c.label}-${i}`}>
              {c.to ? (
                <Link to={c.to}>{text}</Link>
              ) : (
                <span aria-current={i === last ? "page" : undefined}>{text}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
