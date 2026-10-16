// Administration landing page: working P1 sections, and the configuration screens delivered in P5 (methodology, forms,
// workflows, automation, branding, environment), named as available (T-DG5-FE-G: no "Planned" chip is left once Branding
// Settings shipped; F-DG4-160, D-162 e). Technical administration never grants business approvals (ADR-0006).
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { canAny } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { NoPermissionState } from "../../components/States.tsx";
import { ADMIN_PERMISSIONS } from "../../auth/permissions.ts";
import { useMyNavigation } from "../../app/me-navigation.ts";

export function AdminHomePage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("nav.areas.admin.label"));
  // T-DG5-FE-G: the Administration items GET /me/navigation grants (ADR-0049 §9), e.g. the Studio review for the
  // Transformation Office, which holds no P1 administration permission.
  const adminItems = (useMyNavigation().data?.areas ?? []).find((a) => a.webId === "admin")?.items ?? [];
  if (!canAny(me, ADMIN_PERMISSIONS) && adminItems.length === 0) return <NoPermissionState />;
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
        <section className="card" aria-labelledby="admin-configuration" data-card="configuration">
          <h2 id="admin-configuration" className="card__title">
            {t("admin.configurationTitle")}
          </h2>
          <p className="muted">{t("admin.plannedSections")}</p>
          {adminItems.length > 0 ? (
            <ul className="plain-list" data-list="admin-items">
              {adminItems.map((item) => (
                <li key={item.code}>
                  <Link to={item.path} className="link">
                    {t(item.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
      <p className="banner banner--info" role="note">
        <Icon name="info" /> {t("admin.sodNote")}
      </p>
    </div>
  );
}
