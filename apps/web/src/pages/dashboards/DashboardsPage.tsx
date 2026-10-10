// The dashboards area (T-DG4-FE-G; ADR-0037 §2; REQ-S13-001): the six dashboards of M0244.
//  - /dashboards                 the hub: the six dashboards and what each shows;
//  - /dashboards/executive       = the Executive Overview (one read model, ADR-0037 §2, §8): opens /executive-overview;
//  - /dashboards/transformation  pick a transformation; its Template 10 dashboard is a workspace tab;
//  - /dashboards/workstream      pick a transformation, then one of its workstreams;
//  - /dashboards/finance         value lines per class × state × currency, gross / implementation cost / net, the
//                                Finance queue count, and non-financial benefits as n/a (never 0);
//  - /dashboards/adoption        the People & adoption area, each linked indicator with its KPI status, interventions;
//  - /dashboards/personal        = My Work's sections and upcoming deadlines (one operation, ADR-0037 §2, §7).
// Every figure is computed by the server on each request; this page never adds states or currencies together.
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { T10_AREA_CODES, type FinanceValueLine, type AdoptionIndicatorRow } from "@mth/shared/schemas";
import { useTransformations } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { LoadingState, QueryState } from "../../components/States.tsx";
import { NotFoundPage } from "../AreaPages.tsx";
import { useIndicatorTemplates } from "../adoption/api.ts";
import { MeasureName } from "../adoption/ui.tsx";
import { useAdoptionDashboard, useFinanceDashboard } from "./api.ts";
import { MyWorkSections } from "./MyWorkSections.tsx";
import {
  AreaCard,
  BlockedFilterNote,
  DrilldownPanel,
  FilterBar,
  GeneratedNote,
  RagStatusChip,
  TransformationRows,
  ValueView,
  keyText,
  useDrill,
  useFilterState,
  useOrgQuery,
} from "./ui.tsx";

export const DASHBOARD_KINDS = [
  "executive",
  "transformation",
  "workstream",
  "finance",
  "adoption",
  "personal",
] as const;
export type DashboardKind = (typeof DASHBOARD_KINDS)[number];

const KIND_PATH: Record<DashboardKind, string> = {
  executive: "/executive-overview",
  transformation: "/dashboards/transformation",
  workstream: "/dashboards/workstream",
  finance: "/dashboards/finance",
  adoption: "/dashboards/adoption",
  personal: "/dashboards/personal",
};

/** /dashboards: the six dashboards (M0244). */
export function DashboardsHubPage() {
  const { t } = useTranslation();
  usePageTitle(t("dashboards.hub.title"));
  return (
    <div className="page" data-page="dashboards">
      <PageHeader title={t("dashboards.hub.title")} subtitle={t("dashboards.hub.intro")} />
      <div className="grid grid--3">
        {DASHBOARD_KINDS.map((k) => (
          <section key={k} className="card" data-dashboard-kind={k}>
            <h2 className="card__title">
              <Link className="link" to={KIND_PATH[k]}>
                {t(`dashboards.kind.${k}.title`)}
              </Link>
            </h2>
            <p className="small">{t(`dashboards.kind.${k}.summary`)}</p>
          </section>
        ))}
      </div>
      {/* T-DG4-FE-G2: the thresholds behind every area's RAG (ADR-0037 §3). */}
      <p className="small" data-rag-policy-link>
        <Link className="link" to="/dashboards/rag-policy">
          {t("dashboards.ragPolicy.title")}
        </Link>{" "}
        · {t("dashboards.ragPolicy.hubSummary")}
      </p>
    </div>
  );
}

/** /dashboards/:kind */
export function DashboardPage() {
  const { kind } = useParams();
  const location = useLocation();
  switch (kind as DashboardKind) {
    case "executive":
      return <Navigate to={`/executive-overview${location.search}`} replace />;
    case "transformation":
    case "workstream":
      return <TransformationChooser kind={kind as "transformation" | "workstream"} />;
    case "finance":
      return <FinanceDashboardPage />;
    case "adoption":
      return <AdoptionDashboardPage />;
    case "personal":
      return <PersonalDashboardPage />;
    default:
      return <NotFoundPage />;
  }
}

function DashboardCrumbs(kind: DashboardKind, t: (k: string) => string) {
  return [{ label: t("dashboards.hub.title"), to: "/dashboards" }, { label: t(`dashboards.kind.${kind}.title`) }];
}

// ------------------------------------------------------------------------------------------------ choosers

/** The transformation and workstream dashboards live in each transformation's workspace: pick one. */
function TransformationChooser({ kind }: { kind: "transformation" | "workstream" }) {
  const { t } = useTranslation();
  usePageTitle(t(`dashboards.kind.${kind}.title`));
  const list = useTransformations({ sort: "code:asc", limit: 100 });
  type Row = { id: string; code: string; name: string };
  const columns: RegisterColumn<Row>[] = [
    {
      id: "code",
      header: t("dashboards.rows.transformation"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <Link className="link" to={`/transformations/${r.id}/dashboard${kind === "workstream" ? "#workstreams" : ""}`}>
          <bdi dir="ltr" className="code">
            {r.code}
          </bdi>{" "}
          {r.name}
        </Link>
      ),
      sortValue: (r) => r.code,
      filterText: (r) => `${r.code} ${r.name}`,
    },
  ];
  return (
    <div className="page" data-page={`dashboard-${kind}-chooser`}>
      <PageHeader
        crumbs={DashboardCrumbs(kind, t)}
        title={t(`dashboards.kind.${kind}.title`)}
        subtitle={t(`dashboards.chooser.${kind}`)}
      />
      <QueryState query={list}>
        {(page) => (
          <RegisterTable
            id="dashboard-chooser"
            caption={t(`dashboards.kind.${kind}.title`)}
            rows={page.items.map((x) => ({ id: x.id, code: x.code, name: x.name }))}
            columns={columns}
            getRowId={(r) => r.id}
            emptyTitle={t("dashboards.chooser.empty")}
            defaultSort={{ id: "code", dir: "asc" }}
          />
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Finance

/** The financial value classes in ADR-0030 order, then the derived lines. */
const CLASS_ORDER = [
  "revenue_uplift",
  "margin_uplift",
  "cash_saving",
  "avoided_cost",
  "working_capital_release",
  "non_financial_valued",
  "gross",
  "net",
];
const STATE_ORDER = ["planned", "forecast", "measured", "submitted", "validated", "rejected", "sustained"];

export function FinanceDashboardPage() {
  const { t } = useTranslation();
  usePageTitle(t("dashboards.kind.finance.title"));
  const [state, set, clear] = useFilterState();
  const org = useOrgQuery(state);
  const query = useFinanceDashboard(org.query, !org.loading && org.blocked === null);
  const [drill, openDrill, closeDrill] = useDrill();

  const lineColumns = (derived: boolean): RegisterColumn<FinanceValueLine>[] => [
    {
      id: "class",
      header: derived ? t("dashboards.finance.measure") : t("dashboards.finance.valueClass"),
      rowHeader: true,
      hideable: false,
      cell: (l) => t(`dashboards.valueClass.${l.valueClass}`, { defaultValue: l.valueClass.replace(/_/g, " ") }),
      sortValue: (l) => CLASS_ORDER.indexOf(l.valueClass),
      filterText: (l) => t(`dashboards.valueClass.${l.valueClass}`, { defaultValue: l.valueClass }),
    },
    {
      id: "state",
      header: t("dashboards.finance.state"),
      cell: (l) => <span data-line-state={l.state}>{t(`dashboards.lineState.${l.state}`)}</span>,
      sortValue: (l) => STATE_ORDER.indexOf(l.state),
      filterText: (l) => t(`dashboards.lineState.${l.state}`),
    },
    {
      id: "currency",
      header: t("dashboards.finance.currency"),
      cell: (l) => <bdi dir="ltr">{l.currency}</bdi>,
      sortValue: (l) => l.currency,
      filterText: (l) => l.currency,
    },
    {
      id: "total",
      header: t("dashboards.finance.total"),
      cell: (l) => <ValueView value={l.total} />,
    },
    {
      id: "drill",
      header: t("dashboards.drill.column"),
      hideable: false,
      cell: (l) =>
        l.drilldownHref ? (
          <button
            type="button"
            className="button button--link button--small"
            data-drill-line={`${l.valueClass}-${l.state}-${l.currency}`}
            onClick={() =>
              openDrill(
                { drilldownHref: l.drilldownHref! },
                `${t(`dashboards.valueClass.${l.valueClass}`, { defaultValue: l.valueClass })} · ${t(`dashboards.lineState.${l.state}`)} · ${l.currency}`,
              )
            }
          >
            {t("dashboards.drill.open")}
            <span className="visually-hidden">
              : {t(`dashboards.valueClass.${l.valueClass}`, { defaultValue: l.valueClass })}{" "}
              {t(`dashboards.lineState.${l.state}`)} {l.currency}
            </span>
          </button>
        ) : (
          <span className="small muted">{t("dashboards.finance.noDrill")}</span>
        ),
    },
  ];

  return (
    <div className="page" data-page="dashboard-finance">
      <PageHeader
        crumbs={DashboardCrumbs("finance", t)}
        title={t("dashboards.kind.finance.title")}
        subtitle={t("dashboards.kind.finance.summary")}
      />
      <FilterBar state={state} set={set} clear={clear} applied={query.data?.appliedFilters ?? null} orgWide />
      {org.blocked ? (
        <BlockedFilterNote reason={org.blocked} />
      ) : org.loading ? (
        <LoadingState />
      ) : (
        <QueryState query={query}>
          {(d) => {
            const perClass = d.lines.filter((l) => l.valueClass !== "gross" && l.valueClass !== "net");
            const derived = d.lines.filter((l) => l.valueClass === "gross" || l.valueClass === "net");
            const investment = d.headlines.filter((h) => h.metric === "value.investment");
            return (
              <>
                <GeneratedNote at={d.generatedAt} onRefresh={() => void query.refetch()} />
                <Section id="finance-headlines" title={t("dashboards.finance.headlines")}>
                  <dl className="details" data-headlines="finance">
                    {d.headlines.map((h) => {
                      const label = keyText(t, "headline", h.labelKey);
                      return (
                        <div key={`${h.metric}-${h.value.currency ?? ""}`} data-metric={h.metric}>
                          <dt>{label}</dt>
                          <dd>
                            <ValueView value={h.value} strong />{" "}
                            <button
                              type="button"
                              className="button button--link button--small"
                              data-drill={h.metric}
                              onClick={() => openDrill(h, label)}
                            >
                              {t("dashboards.drill.open")}
                              <span className="visually-hidden">: {label}</span>
                            </button>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  <p data-pending-validation={d.pendingValidationCount}>
                    <strong>{t("dashboards.finance.pendingCount", { count: d.pendingValidationCount })}</strong>{" "}
                    <Link className="link" to="/finance-validation">
                      {t("dashboards.finance.openQueue")}
                    </Link>
                  </p>
                  <p data-non-financial-count={d.nonFinancialCount}>
                    {t("dashboards.finance.nonFinancial", { count: d.nonFinancialCount })}{" "}
                    <ValueView
                      value={{
                        state: "not_applicable",
                        value: null,
                        unit: "currency",
                        currency: null,
                        reasonKey: "dashboard.value.no_financial_benefit",
                      }}
                    />
                  </p>
                </Section>
                <Section
                  id="finance-lines"
                  title={t("dashboards.finance.perClass")}
                  intro={t("dashboards.finance.perClassIntro")}
                >
                  <RegisterTable
                    id="dashboard-finance-lines"
                    caption={t("dashboards.finance.perClass")}
                    rows={perClass}
                    columns={lineColumns(false)}
                    getRowId={(l) => `${l.valueClass}-${l.state}-${l.currency}`}
                    emptyTitle={t("dashboards.finance.noLines")}
                    emptyBody={t("dashboards.finance.noLinesBody")}
                    defaultSort={{ id: "class", dir: "asc" }}
                    pageSize={25}
                  />
                </Section>
                <Section
                  id="finance-net"
                  title={t("dashboards.finance.grossNet")}
                  intro={t("dashboards.finance.grossNetIntro")}
                >
                  {investment.length > 0 ? (
                    <p data-investment>
                      {t("dashboards.finance.implementationCost")}:{" "}
                      {investment.map((h) => (
                        <span key={h.value.currency ?? "x"} className="block">
                          <ValueView value={h.value} />
                        </span>
                      ))}
                    </p>
                  ) : null}
                  <RegisterTable
                    id="dashboard-finance-net"
                    caption={t("dashboards.finance.grossNet")}
                    rows={derived}
                    columns={lineColumns(true)}
                    getRowId={(l) => `${l.valueClass}-${l.state}-${l.currency}`}
                    emptyTitle={t("dashboards.finance.noNet")}
                    emptyBody={t("dashboards.finance.noNetBody")}
                    defaultSort={{ id: "class", dir: "asc" }}
                  />
                </Section>
                <Section id="finance-rows" title={t("dashboards.rows.title")}>
                  <TransformationRows
                    rows={d.transformations}
                    areaCodes={["value"]}
                    areaLabel={() => t("dashboards.finance.valueStatus")}
                    linkTo={(r) => `/transformations/${r.transformationId}/dashboard`}
                  />
                </Section>
              </>
            );
          }}
        </QueryState>
      )}
      {drill ? <DrilldownPanel target={drill} onClose={closeDrill} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ adoption

export function AdoptionDashboardPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("dashboards.kind.adoption.title"));
  const [state, set, clear] = useFilterState();
  const org = useOrgQuery(state);
  const query = useAdoptionDashboard(org.query, !org.loading && org.blocked === null);
  const [drill, openDrill, closeDrill] = useDrill();
  const templates = useIndicatorTemplates();
  const templateByKey = new Map((templates.data ?? []).map((x) => [x.key, x]));
  const columns: RegisterColumn<AdoptionIndicatorRow>[] = [
    {
      id: "indicator",
      header: t("dashboards.adoption.indicator"),
      rowHeader: true,
      hideable: false,
      cell: (r) => {
        const tpl = templateByKey.get(r.templateKey);
        return (
          <span data-indicator={r.kpiDefinitionId}>
            {tpl ? (
              <MeasureName template={tpl} withIndicator />
            ) : (
              <bdi dir="ltr" className="code">
                {r.templateKey}
              </bdi>
            )}
          </span>
        );
      },
      sortValue: (r) => r.templateKey,
      filterText: (r) => r.templateKey,
    },
    {
      id: "target",
      header: t("dashboards.adoption.target"),
      cell: (r) => t(`dashboards.targetKind.${r.targetKind}`, { defaultValue: r.targetKind.replace(/_/g, " ") }),
      sortValue: (r) => r.targetKind,
    },
    {
      id: "rag",
      header: t("dashboards.item.status"),
      cell: (r) => <RagStatusChip status={r.rag} />,
      sortValue: (r) => r.rag,
      filterText: (r) => t(`dashboards.rag.${r.rag}`),
    },
    { id: "value", header: t("dashboards.item.value"), cell: (r) => <ValueView value={r.value} /> },
    {
      id: "drill",
      header: t("dashboards.drill.column"),
      hideable: false,
      cell: (r) => (
        <button
          type="button"
          className="button button--link button--small"
          onClick={() => openDrill({ drilldownHref: r.drilldownHref }, t("dashboards.adoption.indicator"))}
        >
          {t("dashboards.drill.open")}
          <span className="visually-hidden">: {r.templateKey}</span>
        </button>
      ),
    },
  ];
  return (
    <div className="page" data-page="dashboard-adoption">
      <PageHeader
        crumbs={DashboardCrumbs("adoption", t)}
        title={t("dashboards.kind.adoption.title")}
        subtitle={t("dashboards.kind.adoption.summary")}
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
              <AreaCard area={d.area} onDrill={openDrill} />
              <p data-open-interventions={d.openInterventionCount}>
                <Icon name="info" /> {t("dashboards.adoption.interventions", { count: d.openInterventionCount })}
              </p>
              <Section id="adoption-indicators" title={t("dashboards.adoption.indicators")}>
                <RegisterTable
                  id="dashboard-adoption-indicators"
                  caption={t("dashboards.adoption.indicators")}
                  rows={d.indicators}
                  columns={columns}
                  getRowId={(r) => r.kpiDefinitionId}
                  emptyTitle={t("dashboards.adoption.noIndicators")}
                  emptyBody={t("dashboards.adoption.noIndicatorsBody")}
                />
              </Section>
              <Section id="adoption-rows" title={t("dashboards.rows.title")}>
                <TransformationRows
                  rows={d.transformations}
                  areaCodes={["people_adoption"]}
                  areaLabel={() => (locale === "ar" ? d.area.areaAr : d.area.sourceAreaEn)}
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

// ------------------------------------------------------------------------------------------------ personal

/** The personal work dashboard = My Work's sections (ADR-0037 §2). */
export function PersonalDashboardPage() {
  const { t } = useTranslation();
  usePageTitle(t("dashboards.kind.personal.title"));
  return (
    <div className="page" data-page="dashboard-personal">
      <PageHeader
        crumbs={DashboardCrumbs("personal", t)}
        title={t("dashboards.kind.personal.title")}
        subtitle={t("dashboards.kind.personal.summary")}
      />
      <p>
        <Link className="link" to="/my-work">
          {t("dashboards.personal.openMyWork")}
        </Link>
      </p>
      <MyWorkSections />
    </div>
  );
}

/** Template 10 area codes in order (re-exported for the overview's per-transformation table). */
export const AREA_CODES = T10_AREA_CODES;
