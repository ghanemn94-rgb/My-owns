// A P7 route whose screen FE-B or FE-C builds (T-DG7-FE-A; p7-plan §5.1 rows FE-A, FE-B and FE-C; p7-work-split §C.8,
// §D.2, §E.6, §I.2). It says, in en and ar, what the screen is for and that it is not available yet: no data, no form, no
// request, nothing presented as delivered (F-DG4-160). The owning task replaces the route element in app/router.tsx (an
// orchestrator merge) and, in the same change, removes the entry from P7_PLANNED_ROUTES.
import { useTranslation } from "react-i18next";
import { PageHeader, usePageTitle } from "./Page.tsx";
import { BeingBuiltState } from "./States.tsx";

export function P7NotAvailablePage({ feature }: { feature: string }) {
  const { t } = useTranslation();
  const title = t(`nav.p7.${feature}.title`);
  usePageTitle(title);
  return (
    <div className="page" data-p7-feature={feature}>
      <PageHeader title={title} subtitle={t(`nav.p7.${feature}.summary`)} />
      <BeingBuiltState title={t("nav.p7.notAvailableTitle")} body={t("nav.p7.notAvailableBody")} />
    </div>
  );
}
