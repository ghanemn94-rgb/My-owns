// Landing pages of the navigation areas (REQ-S03-007). Since P5 (T-DG5-FE-A) every area that is not itself a working
// screen has a landing page listing the contents master prompt §3 names for it (app/nav.ts AREA_CONTENTS), each with
// where it lives: a tab of each transformation's workspace, a screen of the product, or a P5 screen that is not
// available yet. Nothing is presented as delivered that is not, and nothing delivered is called planned (F-DG4-160).
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { DEFAULTS } from "@mth/shared";
import { useAllTransformations } from "../api/queries.ts";
import { BeingBuiltState, EmptyState, QueryState } from "../components/States.tsx";
import { LifecycleChip } from "../components/Badges.tsx";
import {
  AREA_CONTENTS,
  NAV_AREAS,
  P5_SUBPAGES,
  type AreaContentItem,
  type AreaId,
  type AreaWorkspaceTab,
  type LandingAreaId,
} from "../app/nav.ts";
import { workspaceTabLabelKey } from "../components/Workspace.tsx";
import { canAny } from "../auth/permissions.ts";
import { useMe } from "../auth/session.tsx";
import { Icon } from "../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../components/Page.tsx";
import { AboutProvenance } from "./playbook/AboutProvenance.tsx";
import { useProductName } from "../components/Wordmark.tsx";

/** The transformations the user can see, each leading into `tab` (and `moreTabs`) of its workspace. */
function TransformationEntryList({
  tab,
  moreTabs = [],
}: {
  tab: AreaWorkspaceTab;
  moreTabs?: readonly AreaWorkspaceTab[];
}) {
  const { t } = useTranslation();
  // D-181: every transformation the user may see (all pages), most recently updated first.
  const list = useAllTransformations({ sort: "updatedAt:desc" });
  return (
    <section className="card" aria-labelledby="entry-title">
      <h2 id="entry-title" className="card__title">
        {t("nav.entry.title", { tab: t(workspaceTabLabelKey(tab)) })}
      </h2>
      <p>{t("nav.entry.body")}</p>
      <QueryState
        query={list}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title={t("transformations.emptyTitle")} body={t("transformations.emptyBody")} />}
      >
        {(items) => (
          <ul className="plain-list entry-list">
            {items.map((tr) => (
              <li key={tr.id}>
                <Link className="link" to={`/transformations/${tr.id}/${tab}`}>
                  <bdi dir="ltr" className="code">
                    {tr.code}
                  </bdi>{" "}
                  {tr.name}
                </Link>{" "}
                <LifecycleChip status={tr.status} />
                {tr.archivedAt ? <LifecycleChip status="archived" /> : null}
                {moreTabs.length > 0 ? (
                  <span className="block small" data-more-tabs="true">
                    {moreTabs.map((more, i) => (
                      <span key={more}>
                        {i > 0 ? " · " : null}
                        <Link className="link" to={`/transformations/${tr.id}/${more}`}>
                          {t(workspaceTabLabelKey(more))}
                          <span className="visually-hidden"> ({tr.name})</span>
                        </Link>
                      </span>
                    ))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </section>
  );
}

/** The cross-portfolio view of an area (all its records across transformations) is for a later release. */
function PortfolioViewNote({ withContents }: { withContents?: AreaId }) {
  const { t } = useTranslation();
  return (
    <section className="card" aria-labelledby="entry-planned">
      <h2 id="entry-planned" className="card__title">
        <span className="lifecycle-chip lifecycle-chip--draft">
          <Icon name="clock" /> {t("nav.planned")}
        </span>
      </h2>
      <p>{t("nav.entry.portfolioPlanned")}</p>
      {withContents ? (
        <>
          <h3 className="card__subtitle">{t("nav.willContain")}</h3>
          <p>{t(`nav.areas.${withContents}.contents`)}</p>
        </>
      ) : null}
    </section>
  );
}

function AvailableChip() {
  const { t } = useTranslation();
  return (
    <span className="lifecycle-chip" data-availability="available">
      <Icon name="check" /> {t("nav.landing.available")}
    </span>
  );
}

function NotAvailableYetChip() {
  const { t } = useTranslation();
  return (
    <span className="lifecycle-chip lifecycle-chip--draft" data-availability="not-available-yet">
      <Icon name="clock" /> {t("nav.landing.notAvailableYet")}
    </span>
  );
}

/** One §3 content item of an area and where it lives (app/nav.ts AREA_CONTENTS). */
function AreaContent({ area, item }: { area: LandingAreaId; item: AreaContentItem }) {
  const { t } = useTranslation();
  const me = useMe();
  const tabs = item.tabs ?? [];
  const links = (item.links ?? []).filter((l) => !l.requiresAny || canAny(me, l.requiresAny));
  const p5 = (item.p5 ?? []).map((id) => P5_SUBPAGES.find((s) => s.id === id)!);
  const delivered = tabs.length > 0 || links.length > 0;
  return (
    <li data-content-item={item.id}>
      <span className="area-content__label">{t(`nav.contents.${area}.${item.id}`)}</span>{" "}
      {delivered ? <AvailableChip /> : <NotAvailableYetChip />}
      {tabs.length > 0 ? (
        <span className="block small" data-content-tabs="true">
          {t("nav.landing.inWorkspace", { tabs: tabs.map((tab) => t(workspaceTabLabelKey(tab))).join(" · ") })}
        </span>
      ) : null}
      {links.length > 0 ? (
        <span className="block small" data-content-links="true">
          {t("nav.landing.screens")}{" "}
          {links.map((l, i) => (
            <span key={l.path}>
              {i > 0 ? " · " : null}
              <Link className="link" to={l.path}>
                {t(l.labelKey)}
              </Link>
            </span>
          ))}
        </span>
      ) : null}
      {p5.length > 0 ? (
        <span className="block small" data-content-p5="true">
          {delivered ? (
            <>
              <NotAvailableYetChip />{" "}
            </>
          ) : null}
          {t("nav.landing.p5Screens")}{" "}
          {p5.map((s, i) => (
            <span key={s.id}>
              {i > 0 ? " · " : null}
              <Link className="link" to={s.path}>
                {t(`nav.sub.${s.id}`)}
              </Link>
            </span>
          ))}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The landing page of an area whose contents live in the transformation workspaces and in other screens (REQ-S03-007):
 * the §3 contents with where each lives, the transformations to open, and the note on the cross-portfolio view.
 */
export function AreaLandingPage({ area }: { area: LandingAreaId }) {
  const { t } = useTranslation();
  const label = t(`nav.areas.${area}.label`);
  usePageTitle(label);
  const nav = NAV_AREAS.find((a) => a.id === area)!;
  const contents = AREA_CONTENTS[area];
  // Every workspace tab the area's contents name is one link away from each transformation.
  const moreTabs = [...new Set([...(nav.moreWorkspaceTabs ?? []), ...contents.flatMap((c) => c.tabs ?? [])])].filter(
    (tab) => tab !== nav.workspaceTab,
  );
  return (
    <div className="page" data-area-entry={area} data-area-landing={area}>
      <PageHeader title={label} subtitle={t(`nav.areas.${area}.summary`)} />
      <section className="card" aria-labelledby="area-contents-title">
        <h2 id="area-contents-title" className="card__title">
          {t("nav.willContain")}
        </h2>
        <p>{t("nav.landing.body")}</p>
        <ul className="plain-list entry-list" data-area-contents={area}>
          {contents.map((item) => (
            <AreaContent key={item.id} area={area} item={item} />
          ))}
        </ul>
      </section>
      {nav.workspaceTab ? <TransformationEntryList tab={nav.workspaceTab} moreTabs={moreTabs} /> : null}
      <PortfolioViewNote />
    </div>
  );
}

/**
 * Entry page of an area sub-entry that opens one workspace tab of a chosen transformation (app/nav.ts NAV_SUBPAGES with
 * a workspaceTab, e.g. Risks and Actions > RAID). It lists the transformations the user can see and opens the tab; the
 * cross-portfolio view is for a later release.
 */
export function AreaEntryPage({
  area,
  tab,
  moreTabs = [],
}: {
  area: AreaId;
  tab: AreaWorkspaceTab;
  /** P4: further workspace tabs of the same area (Governance -> decision rights, RACI, role mapping, readiness). */
  moreTabs?: readonly AreaWorkspaceTab[];
}) {
  const { t } = useTranslation();
  const label = t(`nav.areas.${area}.label`);
  usePageTitle(label);
  return (
    <div className="page" data-area-entry={area}>
      <PageHeader title={label} subtitle={t(`nav.areas.${area}.summary`)} />
      <TransformationEntryList tab={tab} moreTabs={moreTabs} />
      <PortfolioViewNote withContents={area} />
    </div>
  );
}

/**
 * A P4 route whose screen another FE task builds (FE-B…FE-G; p4-plan §5.1). It says what the screen will contain and
 * that it is being built: no data, no form, nothing presented as delivered. The owning task replaces the route element
 * (an orchestrator merge in app/router.tsx).
 */
export function P4BeingBuiltPage({ feature }: { feature: string }) {
  const { t } = useTranslation();
  const title = t(`nav.p4.${feature}.title`);
  usePageTitle(title);
  return (
    <div className="page" data-p4-feature={feature}>
      <PageHeader title={title} subtitle={t(`nav.p4.${feature}.summary`)} />
      <BeingBuiltState title={t("nav.p4.beingBuiltTitle")} body={t("nav.p4.beingBuiltBody")} />
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
      {/* T-DG5-FE-G (REQ-PB-001): the provenance statement, B0004 verbatim. */}
      <AboutProvenance />
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
