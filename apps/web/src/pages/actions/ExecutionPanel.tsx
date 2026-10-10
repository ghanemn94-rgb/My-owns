// Execution tracking of one initiative (T-DG4-FE-D2; p4-work-split §E.5; ADR-0031 §7, §13; REQ-S09-007 UI half), and
// the initiative page's slot that holds the three slice E panels (budget lines, execution, schedule network).
// SYNTHETIC data only in tests and demos.
//  - Milestones: approved and forecast dates, the slip in working days on the organization's business calendar
//    (`slipWorkingDays`), and beside it the DG3 calendar-day variance. A slip that cannot be counted is Unknown with
//    its reason (no approved date, no forecast date, no calendar, range too long): never 0 and never "on time".
//  - Deliverable acceptance, role-based capacity and FTE demand (decimal FTE; Unknown without a capacity row),
//    dependencies (a missing impact is Unknown) and decisions, all read from their canonical records.
//  - Critical-path membership: "On the critical path" / "Not on the critical path" only when the network is computed;
//    `null` (not computable) is Unknown with no critical styling at all (E.8 item 8).
//  - Read-only: the execution view has no write; durations and budget lines are edited in their own panels.
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDecimal } from "../../lib/format.ts";
import { useResourceRoles } from "../capacity/editing.tsx";
import { BudgetPanel } from "./BudgetPanel.tsx";
import { useInitiativeExecution, type InitiativeExecution, type WorkingDaySlip } from "./executionApi.ts";
import { ScheduleNetworkPanel } from "./ScheduleNetworkPanel.tsx";

type Milestone = InitiativeExecution["milestones"][number];
type Deliverable = InitiativeExecution["deliverables"][number];
type Demand = InitiativeExecution["demand"][number];
type Dependency = InitiativeExecution["dependencies"][number];
type Decision = InitiativeExecution["decisions"][number];

/** The in-page anchors of the slot, for the initiative page's "on this page" navigation. */
export const EXECUTION_SLOT_SECTIONS = ["budget-lines", "execution", "schedule-network"] as const;

/**
 * The slice E slot of the initiative page (E.5: "Budget lines, the execution view and the schedule network are on the
 * initiative page"). Each panel loads its own data; a failure of one never hides the others.
 */
export function InitiativeExecutionSlot({ initiativeId }: { initiativeId: string }) {
  return (
    <div className="execution-slot" data-slot="execution">
      <BudgetPanel initiativeId={initiativeId} />
      <ExecutionPanel initiativeId={initiativeId} />
      <ScheduleNetworkPanel initiativeId={initiativeId} />
    </div>
  );
}

export function ExecutionPanel({ initiativeId }: { initiativeId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const query = useInitiativeExecution(ws.tid, initiativeId);
  return (
    <Section id="execution" title={t("executionP4.execution.title")} intro={t("executionP4.execution.intro")}>
      <QueryState query={query}>{(x) => <ExecutionBody x={x} />}</QueryState>
    </Section>
  );
}

function ExecutionBody({ x }: { x: InitiativeExecution }) {
  const { t } = useTranslation();
  return (
    <div data-execution={x.initiativeId}>
      <p data-on-critical-path={x.onCriticalPath === null ? "unknown" : String(x.onCriticalPath)}>
        <strong>{t("executionP4.execution.criticalPath")}:</strong> <CriticalMembership value={x.onCriticalPath} />
      </p>
      <Milestones rows={x.milestones} />
      <Deliverables rows={x.deliverables} />
      <DemandTable rows={x.demand} />
      <Dependencies rows={x.dependencies} />
      <Decisions rows={x.decisions} />
    </div>
  );
}

/** true / false only from a computed network; null is Unknown, never styled as critical. */
function CriticalMembership({ value }: { value: boolean | null }) {
  const { t } = useTranslation();
  if (value === null) return <Unknown hint={t("executionP4.execution.criticalPathUnknown")} />;
  return (
    <span className="lifecycle-chip" data-critical={String(value)}>
      <Icon name={value ? "alert" : "dot"} />{" "}
      {value ? t("executionP4.execution.onCriticalPath") : t("executionP4.execution.notOnCriticalPath")}
    </span>
  );
}

function DateCell({ value }: { value: string | null }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const text = formatBusinessDate(value, locale);
  if (text === null) return <Unknown hint={t("executionP4.execution.noDate")} />;
  return <span data-date={value}>{text}</span>;
}

/** The working-day slip (ADR-0031 §7): signed working days, or Unknown with its reason. Neutral styling. */
export function SlipCell({ slip }: { slip: WorkingDaySlip }) {
  const { t } = useTranslation();
  if (slip.status === "unknown" || slip.value === null) {
    const reason = slip.reason ?? "unknown";
    return (
      <span data-slip="unknown" data-slip-reason={reason}>
        <Unknown />
        {slip.reason ? (
          <span className="block small">
            {t("executionP4.unknownReason")}: {t(`executionP4.execution.slip.reason.${slip.reason}`)}
          </span>
        ) : null}
      </span>
    );
  }
  const v = slip.value;
  return (
    <span data-slip={v}>
      {v > 0
        ? t("executionP4.execution.slip.late", { n: v })
        : v < 0
          ? t("executionP4.execution.slip.early", { n: -v })
          : t("executionP4.execution.slip.onTime")}
    </span>
  );
}

function Milestones({ rows }: { rows: readonly Milestone[] }) {
  const { t } = useTranslation();
  const columns: RegisterColumn<Milestone>[] = [
    {
      id: "title",
      header: t("executionP4.execution.milestones.col.title"),
      cell: (m) => m.title,
      sortValue: (m) => m.title,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "approved",
      header: t("executionP4.execution.milestones.col.approved"),
      cell: (m) => <DateCell value={m.approvedDate} />,
      sortValue: (m) => m.approvedDate,
    },
    {
      id: "forecast",
      header: t("executionP4.execution.milestones.col.forecast"),
      cell: (m) => <DateCell value={m.forecastDate} />,
      sortValue: (m) => m.forecastDate,
    },
    {
      id: "slip",
      header: t("executionP4.execution.milestones.col.slip"),
      cell: (m) => <SlipCell slip={m.slipWorkingDays} />,
      sortValue: (m) => m.slipWorkingDays.value,
      filterText: (m) => m.slipWorkingDays.reason ?? String(m.slipWorkingDays.value ?? ""),
    },
    {
      id: "calendar",
      header: t("executionP4.execution.milestones.col.calendar"),
      cell: (m) =>
        m.calendarVarianceDays === null ? (
          <Unknown />
        ) : (
          <span data-calendar-days={m.calendarVarianceDays}>
            {t("executionP4.execution.slip.calendarDays", { n: m.calendarVarianceDays })}
          </span>
        ),
      sortValue: (m) => m.calendarVarianceDays,
    },
    {
      id: "status",
      header: t("executionP4.execution.milestones.col.status"),
      cell: (m) => t(`executionP4.execution.milestoneStatus.${m.status}`),
      sortValue: (m) => m.status,
    },
  ];
  return (
    <>
      <h3 id="execution-milestones">{t("executionP4.execution.milestones.title")}</h3>
      <RegisterTable
        id="execution-milestones"
        caption={t("executionP4.execution.milestones.title")}
        rows={rows}
        columns={columns}
        getRowId={(m) => m.milestoneId}
        emptyTitle={t("executionP4.execution.milestones.empty")}
        defaultSort={{ id: "approved", dir: "asc" }}
      />
    </>
  );
}

function Deliverables({ rows }: { rows: readonly Deliverable[] }) {
  const { t } = useTranslation();
  const columns: RegisterColumn<Deliverable>[] = [
    {
      id: "title",
      header: t("executionP4.execution.deliverables.col.title"),
      cell: (d) => d.title,
      sortValue: (d) => d.title,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "due",
      header: t("executionP4.execution.deliverables.col.due"),
      cell: (d) => <DateCell value={d.dueDate} />,
      sortValue: (d) => d.dueDate,
    },
    {
      id: "acceptance",
      header: t("executionP4.execution.deliverables.col.acceptance"),
      cell: (d) => (
        <span data-acceptance={d.acceptanceStatus}>{t(`executionP4.execution.acceptance.${d.acceptanceStatus}`)}</span>
      ),
      sortValue: (d) => d.acceptanceStatus,
    },
  ];
  return (
    <>
      <h3>{t("executionP4.execution.deliverables.title")}</h3>
      <RegisterTable
        id="execution-deliverables"
        caption={t("executionP4.execution.deliverables.title")}
        rows={rows}
        columns={columns}
        getRowId={(d) => d.deliverableId}
        emptyTitle={t("executionP4.execution.deliverables.empty")}
      />
    </>
  );
}

function Fte({ value }: { value: string | null }) {
  const locale = useLocale();
  const text = value === null ? null : formatDecimal(value, locale, { maxFractionDigits: 2 });
  if (text === null) return <Unknown />;
  return (
    <bdi dir="ltr" data-fte={value}>
      {text}
    </bdi>
  );
}

function DemandTable({ rows }: { rows: readonly Demand[] }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const locale = useLocale();
  const roles = useResourceRoles(ws.tid);
  const roleName = (id: string) => {
    const r = roles.data?.find((x) => x.id === id);
    return r ? (locale === "ar" ? r.labelAr : r.labelEn) : null;
  };
  const columns: RegisterColumn<Demand>[] = [
    {
      id: "role",
      header: t("executionP4.execution.demand.col.role"),
      cell: (d) => roleName(d.resourceRoleId) ?? <Unknown hint={t("common.value.notVisible")} />,
      sortValue: (d) => roleName(d.resourceRoleId),
      hideable: false,
      rowHeader: true,
    },
    {
      id: "period",
      header: t("executionP4.execution.demand.col.period"),
      cell: (d) => <bdi dir="ltr">{d.periodMonth.slice(0, 7)}</bdi>,
      sortValue: (d) => d.periodMonth,
    },
    {
      id: "demand",
      header: t("executionP4.execution.demand.col.demand"),
      cell: (d) => <Fte value={d.demandFte} />,
      sortValue: (d) => Number(d.demandFte),
    },
    {
      id: "available",
      header: t("executionP4.execution.demand.col.available"),
      cell: (d) =>
        d.capacityStatus === "unknown" || d.availableFte === null ? (
          <span data-capacity="unknown">
            <Unknown />
            <span className="block small">{t("executionP4.execution.demand.noCapacity")}</span>
          </span>
        ) : (
          <Fte value={d.availableFte} />
        ),
      sortValue: (d) => (d.availableFte === null ? null : Number(d.availableFte)),
    },
    {
      id: "status",
      header: t("executionP4.execution.demand.col.status"),
      cell: (d) => t(`executionP4.execution.demand.status.${d.status}`),
      sortValue: (d) => d.status,
    },
  ];
  return (
    <>
      <h3>{t("executionP4.execution.demand.title")}</h3>
      <RegisterTable
        id="execution-demand"
        caption={t("executionP4.execution.demand.title")}
        rows={rows}
        columns={columns}
        getRowId={(d) => d.resourceDemandId}
        emptyTitle={t("executionP4.execution.demand.empty")}
      />
    </>
  );
}

function Dependencies({ rows }: { rows: readonly Dependency[] }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const columns: RegisterColumn<Dependency>[] = [
    {
      id: "code",
      header: t("executionP4.execution.dependencies.col.code"),
      cell: (d) => (
        <bdi dir="ltr" className="code">
          {d.code}
        </bdi>
      ),
      sortValue: (d) => d.code,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "direction",
      header: t("executionP4.execution.dependencies.col.direction"),
      cell: (d) => t(`executionP4.execution.dependencies.direction.${d.direction}`),
      sortValue: (d) => d.direction,
    },
    {
      id: "status",
      header: t("executionP4.execution.dependencies.col.status"),
      cell: (d) => t(`common.recordStatus.${d.status}`, { defaultValue: d.status }),
      sortValue: (d) => d.status,
    },
    {
      id: "neededBy",
      header: t("executionP4.execution.dependencies.col.neededBy"),
      cell: (d) => <DateCell value={d.neededBy} />,
      sortValue: (d) => d.neededBy,
    },
    {
      id: "impact",
      header: t("executionP4.execution.dependencies.col.impact"),
      cell: (d) =>
        d.impact === null ? (
          <Unknown />
        ) : (
          <span data-impact={d.impact}>{t(`executionP4.execution.impact.${d.impact}`)}</span>
        ),
      sortValue: (d) => d.impact,
    },
  ];
  return (
    <>
      <h3>{t("executionP4.execution.dependencies.title")}</h3>
      <RegisterTable
        id="execution-dependencies"
        caption={t("executionP4.execution.dependencies.title")}
        rows={rows}
        columns={columns}
        getRowId={(d) => `${d.dependencyId}:${d.direction}`}
        emptyTitle={t("executionP4.execution.dependencies.empty")}
      />
      {rows.length > 0 ? (
        <p>
          <Link className="link" to={`/transformations/${ws.tid}/dependencies`}>
            {t("executionP4.execution.dependencies.open")}
          </Link>
        </p>
      ) : null}
    </>
  );
}

function Decisions({ rows }: { rows: readonly Decision[] }) {
  const { t } = useTranslation();
  const columns: RegisterColumn<Decision>[] = [
    {
      id: "code",
      header: t("executionP4.execution.decisions.col.code"),
      cell: (d) => (
        <bdi dir="ltr" className="code">
          {d.code}
        </bdi>
      ),
      sortValue: (d) => d.code,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "kind",
      header: t("executionP4.execution.decisions.col.kind"),
      cell: (d) => t(`executionP4.execution.decisions.kind.${d.kind}`),
      sortValue: (d) => d.kind,
    },
    {
      id: "status",
      header: t("executionP4.execution.decisions.col.status"),
      cell: (d) => t(`common.recordStatus.${d.status}`, { defaultValue: d.status }),
      sortValue: (d) => d.status,
    },
    {
      id: "title",
      header: t("executionP4.execution.decisions.col.title"),
      cell: (d) => d.title,
      sortValue: (d) => d.title,
    },
  ];
  return (
    <>
      <h3>{t("executionP4.execution.decisions.title")}</h3>
      <RegisterTable
        id="execution-decisions"
        caption={t("executionP4.execution.decisions.title")}
        rows={rows}
        columns={columns}
        getRowId={(d) => d.decisionId}
        emptyTitle={t("executionP4.execution.decisions.empty")}
      />
    </>
  );
}
