// A P6 route whose screen FE-B builds (T-DG6-FE-A; p6-plan §5.1 rows FE-A and FE-B; p6-work-split §E/F.12, §J/C.13).
// It says, in en and ar, what the screen is for and that it is not available yet: no data, no form, no request, nothing
// presented as delivered (F-DG4-160). FE-B replaces the route element in app/router.tsx (an orchestrator merge) and, in
// the same change, removes the entry from P6_PLANNED_ROUTES.
import { useTranslation } from "react-i18next";
import { PageHeader, usePageTitle } from "./Page.tsx";
import { BeingBuiltState } from "./States.tsx";

export function P6NotAvailablePage({ feature }: { feature: string }) {
  const { t } = useTranslation();
  const title = t(`nav.p6.${feature}.title`);
  usePageTitle(title);
  return (
    <div className="page" data-p6-feature={feature}>
      <PageHeader title={title} subtitle={t(`nav.p6.${feature}.summary`)} />
      <BeingBuiltState title={t("nav.p6.notAvailableTitle")} body={t("nav.p6.notAvailableBody")} />
    </div>
  );
}
