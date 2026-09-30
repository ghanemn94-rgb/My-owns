// Administration landing page: working P1 sections, and the planned ones (methodology, forms, workflows, automation,
// branding) labelled as planned. Technical administration never grants business approvals (ADR-0006).
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { canAny } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { NoPermissionState } from "../../components/States.tsx";
import { ADMIN_PERMISSIONS } from "../../auth/permissions.ts";

export function AdminHomePage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("nav.areas.admin.label"));
  if (!canAny(me, ADMIN_PERMISSIONS)) return <NoPermissionState />;
  const sections = [
    { to: "/admin/organizations", key: "organizations", show: canAny(me, ["organization.read"]) },
    { to: "/admin/users", key: "users", show: canAny(me, ["user.read"]) },
    { to: "/admin/assignments", key: "assignments", show: canAny(me, ["access.read"]) },
  ].filter((s) => s.show);
  return (
    <div className="page">
      <PageHeader title={t("nav.areas.admin.label")} subtitle={t("admin.subtitle")} />
      <div className="grid grid--3">
        {sections.map((s) => (
          <section key={s.key} className="card" aria-labelledby={`admin-${s.key}`}>
            <h2 id={`admin-${s.key}`} className="card__title">
              <Link to={s.to} className="link">
                {t(`admin.${s.key}.title`)}
              </Link>
            </h2>
            <p className="muted">{t(`admin.${s.key}.summary`)}</p>
          </section>
        ))}
        <section className="card" aria-labelledby="admin-planned">
          <h2 id="admin-planned" className="card__title">
            <span className="lifecycle-chip lifecycle-chip--draft">
              <Icon name="clock" /> {t("nav.planned")}
            </span>
          </h2>
          <p className="muted">{t("admin.plannedSections")}</p>
        </section>
      </div>
      <p className="banner banner--info" role="note">
        <Icon name="info" /> {t("admin.sodNote")}
      </p>
    </div>
  );
}
