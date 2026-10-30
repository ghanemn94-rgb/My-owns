// Initiative portfolio (T05 list) and the outcome hierarchy (T-DG3-FE-A; ADR-0021 §2-§3; REQ-S09-003, REQ-PB-032,
// REQ-PB-045). SYNTHETIC data only in tests and demos.
//  - The list shows code, name, wave, owners and THREE SEPARATE columns: Proposed rank (prioritization, ADR-0022),
//    Selection (portfolio_selection) and Funding (funding_decision): Funded, 'Selected - unfunded' or None. Ranking
//    never selects and selection never funds (REQ-S09-003).
//  - Warnings per initiative: deliverable count outside 3-7, no gap link, no owner (hints, never blocks).
//  - Filters status and wave are server query parameters (GET /initiatives?status=&waveId=).
//  - A draft initiative can be created at any time, including before G1 (B0009, ADR-0021 §3).
//  - The outcome hierarchy is read-only: North Star -> outcome -> KPI -> target -> initiative contribution (B0048).
//    A missing target value is Unknown, never 0.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { INITIATIVE_STATUSES, initiativeCreate } from "@mth/shared/schemas";
import { useInitiatives, useOutcomeHierarchy, useProposedRanks, useWaves } from "../../api/portfolio.ts";
import { useP3Refresh, useRegister } from "../../api/queries.ts";
import type { Initiative, InitiativeOutcomeContribution, KpiDefinition, OutcomeHierarchy } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, SectionNav } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { InitiativeRegister } from "./InitiativeRegister.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime, formatDecimal } from "../../lib/format.ts";
import {
  FundingCell,
  InitiativeStatusChip,
  PORTFOLIO_NS,
  SelectionCell,
  statusLabel,
  WarningList,
  waveName,
} from "./common.tsx";
// T-DG5-FE-C2 (D-163; REQ-S06-004, REQ-PB-011): extension fields through the form framework, and the template header.
import { useExtensionCreate } from "../../components/form-framework/index.ts";

export const PORTFOLIO_WRITE = ["initiative.edit", "initiative.launch", "portfolio.select"] as const;

export function PortfolioPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="portfolio"
      title={t("portfolio.title")}
      subtitle={t("portfolio.intro")}
      writePermissions={["initiative.edit"]}
    >
      <SectionNav
        sections={[
          { id: "initiatives", title: t("portfolio.list.title") },
          { id: "outcome-hierarchy", title: t("portfolio.hierarchy.title") },
        ]}
      />
      <InitiativeList />
      <OutcomeHierarchySection />
    </WorkspaceFrame>
  );
}

function InitiativeList() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const waves = useWaves(ws.tid);
  const ranks = useProposedRanks(ws.tid);
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const navigate = useSessionNavigate();
  const [creating, setCreating] = useState(false);
  const canEdit = ws.can("initiative.edit");
  const ext = useExtensionCreate("T05");
  const waveById = new Map((waves.data ?? []).map((w) => [w.id, w]));
  const base = `/transformations/${ws.tid}`;

  const rankOf = (i: Initiative): number | null | undefined =>
    ranks.isError ? undefined : ranks.data ? (ranks.data.get(i.id) ?? null) : undefined;

  const columns: RegisterColumn<Initiative>[] = [
    {
      id: "code",
      header: t("portfolio.field.code"),
      cell: (i) => (
        <Link className="link" to={`${base}/initiatives/${i.id}`}>
          <bdi dir="ltr" className="code">
            {i.code}
          </bdi>
        </Link>
      ),
      sortValue: (i) => i.code,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "name",
      header: t("portfolio.field.name"),
      cell: (i) => <span className="text-cell">{i.name}</span>,
      sortValue: (i) => i.name,
    },
    {
      id: "status",
      header: t("portfolio.field.status"),
      cell: (i) => <InitiativeStatusChip initiative={i} />,
      sortValue: (i) => INITIATIVE_STATUSES.indexOf(i.status),
      filterText: (i) => statusLabel(t, i),
    },
    {
      // T-DG6-FE-D: the ids of list-item properties are the saved-view registry keys (waveId, fundingState, …).
      id: "waveId",
      header: t("portfolio.field.wave"),
      cell: (i) =>
        i.waveId ? (
          (waveName(waveById.get(i.waveId), locale) ?? <Unknown />)
        ) : (
          <span className="muted">{t("portfolio.wave.none")}</span>
        ),
      sortValue: (i) => (i.waveId ? (waveById.get(i.waveId)?.ordinal ?? null) : null),
      filterText: (i) => waveName(waveById.get(i.waveId ?? ""), locale),
    },
    {
      id: "owners",
      header: t("portfolio.field.owners"),
      cell: (i) => (
        <span className="block">
          <span className="block small">
            {t("portfolio.field.executiveOwner")}: <PersonName id={i.executiveOwnerUserId} people={byId} />
          </span>
          <span className="block small">
            {t("portfolio.field.workstreamLead")}: <PersonName id={i.workstreamLeadUserId} people={byId} />
          </span>
        </span>
      ),
      filterText: (i) =>
        [byId.get(i.executiveOwnerUserId ?? "")?.label, byId.get(i.workstreamLeadUserId ?? "")?.label].join(" "),
    },
    {
      id: "rank",
      header: t("portfolio.field.proposedRank"),
      cell: (i) => {
        const r = rankOf(i);
        if (r === undefined) return <Unknown hint={t("portfolio.rank.unavailable")} />;
        if (r === null) return <span className="muted">{t("portfolio.rank.notRanked")}</span>;
        return (
          <bdi dir="ltr" data-rank={r}>
            {r}
          </bdi>
        );
      },
      sortValue: (i) => rankOf(i) ?? null,
    },
    {
      id: "selection",
      header: t("portfolio.field.selection"),
      cell: (i) => <SelectionCell initiative={i} />,
    },
    {
      id: "fundingState",
      header: t("portfolio.field.funding"),
      cell: (i) => <FundingCell initiative={i} />,
      sortValue: (i) => i.fundingState,
    },
    {
      id: "warnings",
      header: t("portfolio.field.warnings"),
      cell: (i) => <WarningList warnings={i.warnings} compact />,
      sortValue: (i) => i.warnings.length,
    },
    // T-DG6-FE-D (ADR-0057 §5): the two further server sort keys of listInitiatives, as columns.
    {
      id: "plannedEnd",
      header: t("productivity.register.plannedEnd"),
      cell: (i) => formatBusinessDate(i.plannedEnd, locale) ?? <span className="muted">{t("common.value.none")}</span>,
    },
    {
      id: "updatedAt",
      header: t("productivity.register.updatedAt"),
      cell: (i) => formatDateTime(i.updatedAt, locale),
    },
  ];

  const createFields: FieldSpec[] = [
    { name: "name", kind: "text", label: t("portfolio.field.name"), required: true, maxLength: 300 },
    { name: "objective", kind: "textarea", label: t("portfolio.field.objective"), rows: 3, maxLength: 4000 },
    {
      name: "problemStatement",
      kind: "textarea",
      label: t("portfolio.field.problemStatement"),
      rows: 3,
      maxLength: 8000,
    },
    { name: "executiveOwnerUserId", kind: "person", label: t("portfolio.field.executiveOwner") },
    { name: "workstreamLeadUserId", kind: "person", label: t("portfolio.field.workstreamLead") },
    {
      name: "waveId",
      kind: "select",
      label: t("portfolio.field.wave"),
      options: (waves.data ?? [])
        .filter((w) => w.status === "active")
        .map((w) => ({ value: w.id, label: waveName(w, locale) ?? w.code })),
    },
  ];

  return (
    <Section
      id="initiatives"
      title={t("portfolio.list.title")}
      intro={t("portfolio.list.intro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--primary button--small" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t("portfolio.create.action")}
          </button>
        ) : null
      }
    >
      {/* T-DG6-FE-D (ADR-0057 §4, §5; REQ-S15-013): server-side sort, filters, paging, chips and saved views. */}
      <InitiativeRegister
        tid={ws.tid}
        caption={t("portfolio.list.title")}
        columns={columns}
        waves={waves.data ?? []}
        people={people}
        {...(canEdit ? { emptyBody: t("portfolio.list.emptyBody") } : {})}
      />
      {ext.outcome}
      {creating ? (
        <RecordDialog<Initiative>
          title={t("portfolio.create.title")}
          namespaces={PORTFOLIO_NS}
          description={t("portfolio.create.note")}
          fields={createFields}
          record={null}
          extra={{ transformationId: ws.tid }}
          createSchema={ext.guard(initiativeCreate)}
          createUrl="/api/v1/initiatives"
          people={people}
          submitLabel={t("portfolio.create.submit")}
          onSaved={async (saved) => {
            await ext.afterCreate(saved);
            if (!(await refresh())) return;
            setCreating(false);
            const id = (saved as { id?: string } | null)?.id;
            if (id) navigate(`${base}/initiatives/${id}`);
          }}
          onCancel={() => setCreating(false)}
        >
          {ext.node}
        </RecordDialog>
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ outcome hierarchy

function OutcomeHierarchySection() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const hierarchy = useOutcomeHierarchy(ws.tid);
  return (
    <Section id="outcome-hierarchy" title={t("portfolio.hierarchy.title")} intro={t("portfolio.hierarchy.intro")}>
      <QueryState query={hierarchy}>{(h) => <HierarchyTree h={h} />}</QueryState>
    </Section>
  );
}

function HierarchyTree({ h }: { h: OutcomeHierarchy }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const kpis = useRegister<KpiDefinition>(ws.tid, "kpi-definitions");
  const initiatives = useInitiatives(ws.tid);
  const kpiName = (id: string) => kpis.data?.find((k) => k.id === id)?.name ?? null;
  const iniById = new Map((initiatives.data ?? []).map((i) => [i.id, i]));
  const base = `/transformations/${ws.tid}`;

  const Contribution = ({ c }: { c: InitiativeOutcomeContribution }) => {
    const ini = iniById.get(c.initiativeId);
    return (
      <li data-level="contribution" data-contribution={c.id}>
        <span className="level-label">{t("portfolio.hierarchy.level.contribution")}:</span>{" "}
        {ini ? (
          <Link className="link" to={`${base}/initiatives/${ini.id}`}>
            <bdi dir="ltr" className="code">
              {ini.code}
            </bdi>{" "}
            {ini.name}
          </Link>
        ) : (
          <Unknown hint={t("common.value.notVisible")} />
        )}{" "}
        — <span className="text-cell">{c.contributionStatement}</span>
      </li>
    );
  };

  return (
    <div className="hierarchy" data-hierarchy>
      <p data-level="north-star">
        <strong>{t("portfolio.hierarchy.level.northStar")}:</strong>{" "}
        {h.northStar ? (
          <span className="text-cell">{h.northStar.statement}</span>
        ) : (
          <span className="muted">{t("portfolio.hierarchy.noNorthStar")}</span>
        )}
      </p>
      {h.outcomes.length === 0 ? (
        <p className="muted">{t("portfolio.hierarchy.noOutcomes")}</p>
      ) : (
        <ul className="tree" aria-label={t("portfolio.hierarchy.title")}>
          {h.outcomes.map((o) => (
            <li key={o.outcome.id} data-level="outcome">
              <span className="level-label">{t("portfolio.hierarchy.level.outcome")}:</span>{" "}
              <span className="text-cell">{o.outcome.statement}</span>
              <ul>
                {o.kpis.length === 0 ? (
                  <li className="muted">{t("portfolio.hierarchy.noKpis")}</li>
                ) : (
                  o.kpis.map((k) => (
                    <li key={k.outcomeKpiId} data-level="kpi">
                      <span className="level-label">{t("portfolio.hierarchy.level.kpi")}:</span>{" "}
                      {kpiName(k.kpiDefinitionId) ?? <Unknown hint={t("common.value.notVisible")} />}
                      <ul>
                        <li data-level="target" data-target={k.targetValue ?? "unknown"}>
                          <span className="level-label">{t("portfolio.hierarchy.level.target")}:</span>{" "}
                          {k.targetValue === null ? (
                            <Unknown hint={t("portfolio.hierarchy.targetUnknown")} />
                          ) : (
                            <bdi dir="ltr">{formatDecimal(k.targetValue, locale, { maxFractionDigits: 6 })}</bdi>
                          )}{" "}
                          <span className="muted small">
                            {t("portfolio.hierarchy.by", { date: formatBusinessDate(k.targetDate, locale) ?? "" })}
                          </span>
                          <ul>
                            {k.contributions.length === 0 ? (
                              <li className="muted">{t("portfolio.hierarchy.noContributions")}</li>
                            ) : (
                              k.contributions.map((c) => <Contribution key={c.id} c={c} />)
                            )}
                          </ul>
                        </li>
                      </ul>
                    </li>
                  ))
                )}
                {o.contributions.length > 0 ? (
                  <li data-level="outcome-only">
                    <span className="level-label">{t("portfolio.hierarchy.withoutKpi")}</span>
                    <ul>
                      {o.contributions.map((c) => (
                        <Contribution key={c.id} c={c} />
                      ))}
                    </ul>
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
