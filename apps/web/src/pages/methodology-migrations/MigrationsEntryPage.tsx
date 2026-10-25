// Administration > Methodology migrations (T-DG5-FE-B; REQ-S06-008): migrations belong to a transformation, so this
// entry lists the transformations the caller can see, each with its migrations and its configuration pins.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useAllTransformations } from "../../api/queries.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { BusinessApprovalNote } from "../my-work/p4ui.tsx";

export function MigrationsEntryPage() {
  const { t } = useTranslation();
  usePageTitle(t("nav.p5.methodologyMigrations.title"));
  // D-181: every transformation the user may see (all pages), most recently updated first.
  const list = useAllTransformations({ sort: "updatedAt:desc" });
  return (
    <div className="page" data-p5-screen="methodology-migrations-entry">
      <PageHeader
        title={t("nav.p5.methodologyMigrations.title")}
        subtitle={t("nav.p5.methodologyMigrations.summary")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("nav.sub.methodologyMigrations") }]}
      />
      <BusinessApprovalNote body={t("studio.migration.approvalNote")} />
      <section className="card" aria-labelledby="migrations-entry">
        <h2 id="migrations-entry" className="card__title">
          {t("studio.migration.chooseTransformation")}
        </h2>
        <QueryState
          query={list}
          isEmpty={(items) => items.length === 0}
          empty={<EmptyState title={t("transformations.emptyTitle")} body={t("transformations.emptyBody")} />}
        >
          {(items) => (
            <ul className="plain-list entry-list">
              {items.map((tr) => (
                <li key={tr.id}>
                  <Link className="link" to={`/transformations/${tr.id}/methodology-migrations`}>
                    <bdi dir="ltr" className="code">
                      {tr.code}
                    </bdi>{" "}
                    {tr.name}
                  </Link>{" "}
                  ·{" "}
                  <Link className="link" to={`/transformations/${tr.id}/config-pins`}>
                    {t("studio.pins.title")}
                    <span className="visually-hidden"> ({tr.name})</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </section>
    </div>
  );
}
