// Landing pages of the navigation areas that are not built yet (REQ-S03-007 P1 increment). Each one says what the
// area will contain (master prompt §3) and that it is planned; nothing is presented as delivered.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DEFAULTS } from "@mth/shared";
import { useTransformations } from "../api/queries.ts";
import { EmptyState, QueryState } from "../components/States.tsx";
import { LifecycleChip } from "../components/Badges.tsx";
import type { AreaId, AreaWorkspaceTab } from "../app/nav.ts";
import { workspaceTabLabelKey } from "../components/Workspace.tsx";
import { useMe } from "../auth/session.tsx";
import { canAnywhere } from "../auth/permissions.ts";
import { Icon } from "../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../components/Page.tsx";
import { useProductName } from "../components/Wordmark.tsx";

export function AreaPlaceholderPage({ area }: { area: AreaId }) {
  const { t } = useTranslation();
  const label = t(`nav.areas.${area}.label`);
  usePageTitle(label);
  return (
    <div className="page">
      <PageHeader title={label} subtitle={t(`nav.areas.${area}.summary`)} />
      <section className="card" aria-labelledby="planned-title">
        <h2 id="planned-title" className="card__title">
          <span className="lifecycle-chip lifecycle-chip--draft">
            <Icon name="clock" /> {t("nav.planned")}
          </span>
        </h2>
        <p>{t("nav.plannedBody")}</p>
        <h3 className="card__subtitle">{t("nav.willContain")}</h3>
        <p>{t(`nav.areas.${area}.contents`)}</p>
      </section>
    </div>
  );
}

/**
 * Entry page of an area whose P2 content lives in each transformation's workspace (Strategy and KPIs -> Define,
 * Target Operating Model -> Design, Governance -> Gates, Evidence and Reports -> Evidence). It lists the
 * transformations the user can see and opens the matching workspace tab; the cross-portfolio view is still planned.
 */
export function AreaEntryPage({ area, tab }: { area: AreaId; tab: AreaWorkspaceTab }) {
  const { t } = useTranslation();
  const label = t(`nav.areas.${area}.label`);
  usePageTitle(label);
  const list = useTransformations({ sort: "updatedAt:desc", limit: 50 });
  return (
    <div className="page" data-area-entry={area}>
      <PageHeader title={label} subtitle={t(`nav.areas.${area}.summary`)} />
      <section className="card" aria-labelledby="entry-title">
        <h2 id="entry-title" className="card__title">
          {t("nav.entry.title", { tab: t(workspaceTabLabelKey(tab)) })}
        </h2>
        <p>{t("nav.entry.body")}</p>
        <QueryState
          query={list}
          isEmpty={(page) => page.items.length === 0}
          empty={<EmptyState title={t("transformations.emptyTitle")} body={t("transformations.emptyBody")} />}
        >
          {(page) => (
            <ul className="plain-list entry-list">
              {page.items.map((tr) => (
                <li key={tr.id}>
                  <Link className="link" to={`/transformations/${tr.id}/${tab}`}>
                    <bdi dir="ltr" className="code">
                      {tr.code}
                    </bdi>{" "}
                    {tr.name}
                  </Link>{" "}
                  <LifecycleChip status={tr.status} />
                  {tr.archivedAt ? <LifecycleChip status="archived" /> : null}
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </section>
      <section className="card" aria-labelledby="entry-planned">
        <h2 id="entry-planned" className="card__title">
          <span className="lifecycle-chip lifecycle-chip--draft">
            <Icon name="clock" /> {t("nav.planned")}
          </span>
        </h2>
        <p>{t("nav.entry.portfolioPlanned")}</p>
        <h3 className="card__subtitle">{t("nav.willContain")}</h3>
        <p>{t(`nav.areas.${area}.contents`)}</p>
      </section>
    </div>
  );
}

export function MyWorkPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("nav.areas.myWork.label"));
  const canReadTransformations = canAnywhere(me, "transformation.read");
  return (
    <div className="page">
      <PageHeader
        title={t("common.myWork.greeting", { name: me.user.displayName })}
        subtitle={t("nav.areas.myWork.summary")}
      />
      <div className="grid grid--2">
        <section className="card" aria-labelledby="mw-next">
          <h2 id="mw-next" className="card__title">
            {t("common.myWork.startHere")}
          </h2>
          {canReadTransformations ? (
            <p>
              <Link to="/transformations" className="link">
                {t("common.myWork.openTransformations")}
              </Link>
            </p>
          ) : (
            <p className="muted">{t("common.myWork.noBusinessAccess")}</p>
          )}
        </section>
        <section className="card" aria-labelledby="mw-planned">
          <h2 id="mw-planned" className="card__title">
            <span className="lifecycle-chip lifecycle-chip--draft">
              <Icon name="clock" /> {t("nav.planned")}
            </span>
          </h2>
          <p>{t("nav.areas.myWork.contents")}</p>
        </section>
      </div>
    </div>
  );
}

export function AboutPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("common.about.title"));
  const name = useProductName(me.productName);
  return (
    <div className="page">
      <PageHeader title={t("common.about.title")} subtitle={name} />
      <section className="card" aria-labelledby="about-brand">
        <h2 id="about-brand" className="card__title">
          {t("common.about.brandTitle")}
        </h2>
        <p>{t("common.about.brandBody")}</p>
        <p>{t("common.about.fontsBody")}</p>
      </section>
      <section className="card" aria-labelledby="about-method">
        <h2 id="about-method" className="card__title">
          {t("common.about.methodTitle")}
        </h2>
        <p>{t("common.about.methodBody")}</p>
      </section>
      <section className="card" aria-labelledby="about-defaults">
        <h2 id="about-defaults" className="card__title">
          {t("common.about.defaultsTitle")}
        </h2>
        <dl className="details">
          <div>
            <dt>{t("common.field.timezone")}</dt>
            <dd>
              <bdi dir="ltr">{me.user.timezone ?? me.organization.defaultTimezone ?? DEFAULTS.timezone}</bdi>
            </dd>
          </div>
          <div>
            <dt>{t("common.field.currency")}</dt>
            <dd>
              <bdi dir="ltr">{me.organization.defaultCurrency}</bdi>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  usePageTitle(t("common.state.notFoundTitle"));
  return (
    <div className="page">
      <PageHeader title={t("common.state.notFoundTitle")} />
      <p>{t("common.state.pageNotFoundBody")}</p>
      <p>
        <Link className="link" to="/">
          {t("common.action.goHome")}
        </Link>
      </p>
    </div>
  );
}
