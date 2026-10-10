// Executive Overview (T-DG4-FE-G; REQ-S03-009; ADR-0037 §2, §8): the executive dashboard. Its six tiles are the six
// Template 10 areas over the transformations of the organization the caller may read, narrowed by the filters: outcomes
// → Outcomes, value → Value, critical initiatives → Portfolio, adoption → People & adoption, blockers → Dependencies,
// decisions → Decisions (M0101). Every headline drills to its contributing records, period, calculation and evidence;
// one row per transformation shows its six area statuses. Figures are computed by the server on every request, so an
// accepted KPI actual shows on the next load (and on "Refresh").
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { T10_AREA_CODES } from "@mth/shared/schemas";
import { useLocale } from "../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { LoadingState, QueryState } from "../../components/States.tsx";
import { useExecutiveOverview } from "../dashboards/api.ts";
import {
  AreaGrid,
  BlockedFilterNote,
  DrilldownPanel,
  FilterBar,
  GeneratedNote,
  TransformationRows,
  areaTitle,
  useDrill,
  useFilterState,
  useOrgQuery,
} from "../dashboards/ui.tsx";

export function ExecutiveOverviewPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("nav.areas.executive.label"));
  const [state, set, clear] = useFilterState();
  const org = useOrgQuery(state);
  const query = useExecutiveOverview(org.query, !org.loading && org.blocked === null);
  const [drill, openDrill, closeDrill] = useDrill();
  return (
    <div className="page" data-page="executive-overview">
      <PageHeader
        title={t("nav.areas.executive.label")}
        subtitle={t("dashboards.overview.intro")}
        actions={
          <Link className="button button--secondary" to="/dashboards">
            {t("dashboards.overview.allDashboards")}
          </Link>
        }
      />
      <FilterBar state={state} set={set} clear={clear} applied={query.data?.appliedFilters ?? null} orgWide />
      {org.blocked ? (
        <BlockedFilterNote reason={org.blocked} />
      ) : org.loading ? (
        <LoadingState />
      ) : (
        <QueryState query={query}>
          {(d) => (
            <>
              <GeneratedNote at={d.generatedAt} onRefresh={() => void query.refetch()} />
              <p data-transformation-count={d.transformationCount}>
                <strong>{t("dashboards.overview.count", { count: d.transformationCount })}</strong>
              </p>
              {d.transformationCount === 0 ? (
                <p className="banner banner--info" role="note" data-state="empty-scope">
                  {t("dashboards.overview.emptyScope")}
                </p>
              ) : null}
              <AreaGrid areas={d.areas} onDrill={openDrill} />
              <Section id="overview-rows" title={t("dashboards.rows.title")} intro={t("dashboards.rows.intro")}>
                <TransformationRows
                  rows={d.transformations}
                  areaCodes={T10_AREA_CODES}
                  areaLabel={(code) => {
                    const a = d.areas.find((x) => x.code === code);
                    return a ? areaTitle(a, locale) : code;
                  }}
                  linkTo={(r) => `/transformations/${r.transformationId}/dashboard`}
                />
              </Section>
            </>
          )}
        </QueryState>
      )}
      {drill ? <DrilldownPanel target={drill} onClose={closeDrill} /> : null}
    </div>
  );
}
