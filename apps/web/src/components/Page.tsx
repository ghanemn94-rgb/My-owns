// Page scaffolding: a document title per page (screen-reader orientation), one <h1>, optional breadcrumbs and actions.
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DemoFormBadge } from "./demo-label/DemoLabels.tsx";
// T-DG6-FE-D (ADR-0057 §9): the breadcrumb trail is the shared component (bdi-isolated labels, aria-current).
import { Breadcrumbs, type Crumb } from "./breadcrumbs/Breadcrumbs.tsx";

export function usePageTitle(title: string): void {
  const { t } = useTranslation();
  const product = t("common.brand.productName");
  useEffect(() => {
    document.title = `${title} · ${product}`;
  }, [title, product]);
}

export type { Crumb };

export function PageHeader({
  title,
  subtitle,
  crumbs,
  actions,
  demoBadge = false,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  crumbs?: readonly Crumb[];
  actions?: ReactNode;
  /**
   * The header of a form page (create or edit) or of a record view outside `Workspace`: it carries the demo record
   * badge in a demo database (T-DG5-FE-D5; ADR-0050 §2 b, "every record view and form header"). `Workspace` and the
   * transformation overview render the badge in their own subtitle. List, hub and picker pages do not set it.
   */
  demoBadge?: boolean;
}) {
  return (
    <div className="page-header">
      {crumbs && crumbs.length > 0 ? <Breadcrumbs crumbs={crumbs} /> : null}
      <div className="page-header__row">
        <div>
          <h1 className="page-header__title">{title}</h1>
          {demoBadge ? <DemoFormBadge /> : null}
          {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-header__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
