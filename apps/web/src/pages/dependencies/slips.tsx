// Critical dependency slips on screen (T-DG5-FE-RG1, F-DG5-120; REQ-S12-012 "notifications and forecast update", M0232
// "notify affected owners and recompute forecast impacts"; ADR-0044 §7; D-166 Rule B). Read-only: the slips are recorded
// by the server when a milestone write moves a critical dependency's predecessor finish later
// (listDependencySlips, GET /transformations/{id}/dependency-slips, transformation.read; no contract change). Shown on
// the Dependencies page (every slip of the transformation; the slip work item's link) and on an affected initiative's
// page (the slips that affect it). For each affected initiative: which dependency slipped, by how many calendar days,
// why it is critical, and how its forecast finish moved: before -> after, each date Unknown when it could not be
// computed (null), never blank or 0; the change in calendar days is Unknown unless both dates are known.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { DependencySlip } from "@mth/shared/schemas";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";

export const dependencySlipKeys = {
  list: (tid: string) => ["dependency-slips", tid] as const,
};

/** Every critical dependency slip of the transformation, newest first (bounded by fetchAllPages). */
export function useDependencySlips(tid: string) {
  return useQuery({
    queryKey: dependencySlipKeys.list(tid),
    queryFn: () => fetchAllPages<DependencySlip>(`/api/v1/transformations/${tid}/dependency-slips`),
    retry: shouldRetry,
  });
}

/** One table row: a slip and one affected initiative (or none, when the slip reached no initiative). */
export interface SlipRow {
  readonly key: string;
  readonly slip: DependencySlip;
  readonly affected: DependencySlip["affected"][number] | null;
}

const DAY_MS = 86_400_000;

/** Calendar days from `before` to `after` (business dates), or null (Unknown) unless both are known. */
export function forecastChangeDays(before: string | null, after: string | null): number | null {
  if (before === null || after === null) return null;
  const a = Date.parse(`${before}T00:00:00Z`);
  const b = Date.parse(`${after}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

/** Flattens the slips into rows; with `initiativeId`, only the rows of that affected initiative. */
export function slipRows(slips: readonly DependencySlip[], initiativeId?: string): SlipRow[] {
  return slips.flatMap((slip): SlipRow[] => {
    if (slip.affected.length === 0)
      return initiativeId === undefined ? [{ key: `${slip.id}:none`, slip, affected: null }] : [];
    return slip.affected
      .filter((a) => initiativeId === undefined || a.initiativeId === initiativeId)
      .map((a) => ({ key: `${slip.id}:${a.initiativeId}`, slip, affected: a }));
  });
}

/** A business date, or Unknown (never blank). */
function DateOrUnknown({ value }: { value: string | null }) {
  const locale = useLocale();
  const text = formatBusinessDate(value, locale);
  return text === null ? <Unknown /> : <span>{text}</span>;
}

/** "before → after" (← in Arabic), each side Unknown when null; the arrow is announced as "changed to". */
export function BeforeAfter({
  before,
  after,
  testId,
}: {
  before: string | null;
  after: string | null;
  testId: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <span className="before-after" data-before-after={testId} data-before={before ?? ""} data-after={after ?? ""}>
      <DateOrUnknown value={before} /> <span aria-hidden="true">{locale === "ar" ? "←" : "→"}</span>
      <span className="visually-hidden">{t("dependencies.slips.changedTo")}</span> <DateOrUnknown value={after} />
    </span>
  );
}

/** The change in calendar days with its sign (+5, 0), or Unknown. */
function ChangeDays({ days }: { days: number | null }) {
  if (days === null) return <Unknown />;
  return (
    <bdi dir="ltr" data-change-days={days}>
      {days > 0 ? `+${days}` : String(days)}
    </bdi>
  );
}

/**
 * The critical dependency slips of a transformation, or (with `initiativeId`) those that affect one initiative. A
 * read-only section with the loading, error, no-permission, stale and empty states of QueryState.
 */
export function DependencySlipsSection({ tid, initiativeId }: { tid: string; initiativeId?: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const slips = useDependencySlips(tid);
  const { byId } = usePeople(tid);
  const forInitiative = initiativeId !== undefined;
  const reason = (r: SlipRow) => t(`dependencies.slips.reason.${r.slip.criticalReason}`);
  const columns: RegisterColumn<SlipRow>[] = [
    // The owner's question first (F-DG5-120): which initiative, and how its forecast finish moved; then the slip.
    {
      id: "dependency",
      header: t("dependencies.slips.col.dependency"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <bdi dir="ltr" className="code">
          {r.slip.dependencyCode}
        </bdi>
      ),
      sortValue: (r) => r.slip.dependencyCode,
      filterText: (r) => `${r.slip.dependencyCode} ${r.affected?.initiativeCode ?? ""}`,
    },
    {
      id: "initiative",
      header: t("dependencies.slips.col.initiative"),
      hideable: !forInitiative,
      cell: (r) =>
        r.affected === null ? (
          <span className="muted">{t("dependencies.slips.noAffected")}</span>
        ) : (
          <Link className="link" to={`/transformations/${tid}/initiatives/${r.affected.initiativeId}`}>
            <bdi dir="ltr" className="code">
              {r.affected.initiativeCode}
            </bdi>
          </Link>
        ),
      sortValue: (r) => r.affected?.initiativeCode,
    },
    {
      id: "forecastFinish",
      header: t("dependencies.slips.col.forecastFinish"),
      hideable: false,
      cell: (r) =>
        r.affected === null ? null : (
          <BeforeAfter
            before={r.affected.forecastFinishBefore}
            after={r.affected.forecastFinishAfter}
            testId={`forecast-${r.affected.initiativeCode}`}
          />
        ),
      sortValue: (r) => r.affected?.forecastFinishAfter,
    },
    {
      id: "forecastChange",
      header: t("dependencies.slips.col.forecastChange"),
      cell: (r) =>
        r.affected === null ? null : (
          <ChangeDays days={forecastChangeDays(r.affected.forecastFinishBefore, r.affected.forecastFinishAfter)} />
        ),
      sortValue: (r) =>
        r.affected === null
          ? null
          : forecastChangeDays(r.affected.forecastFinishBefore, r.affected.forecastFinishAfter),
    },
    {
      id: "slipDays",
      header: t("dependencies.slips.col.slipDays"),
      cell: (r) => (
        <bdi dir="ltr" data-slip-days={r.slip.slipDays}>
          {r.slip.slipDays}
        </bdi>
      ),
      sortValue: (r) => r.slip.slipDays,
    },
    {
      id: "reason",
      header: t("dependencies.slips.col.reason"),
      cell: (r) => (
        <span data-critical-reason={r.slip.criticalReason}>
          <Icon name="alert" /> {reason(r)}
        </span>
      ),
      sortValue: reason,
    },
    {
      id: "neededBy",
      header: t("dependencies.slips.col.neededBy"),
      cell: (r) =>
        r.slip.neededBy === null ? (
          <span className="muted">{t("dependencies.slips.neededByNotSet")}</span>
        ) : (
          formatBusinessDate(r.slip.neededBy, locale)
        ),
      sortValue: (r) => r.slip.neededBy,
    },
    {
      id: "predecessorFinish",
      header: t("dependencies.slips.col.predecessorFinish"),
      cell: (r) => (
        <BeforeAfter
          before={r.slip.predecessorFinishBefore}
          after={r.slip.predecessorFinishAfter}
          testId={`predecessor-${r.slip.dependencyCode}`}
        />
      ),
      sortValue: (r) => r.slip.predecessorFinishAfter,
    },
    {
      id: "owner",
      header: t("dependencies.slips.col.owner"),
      cell: (r) => (r.affected === null ? null : <PersonName id={r.affected.ownerUserId} people={byId} />),
    },
    {
      id: "recorded",
      header: t("dependencies.slips.col.recorded"),
      cell: (r) => formatDateTime(r.slip.createdAt, locale),
      sortValue: (r) => r.slip.createdAt,
    },
  ];
  return (
    <Section
      id="dependency-slips"
      title={t(forInitiative ? "dependencies.slips.initiativeTitle" : "dependencies.slips.title")}
      intro={t("dependencies.slips.intro")}
    >
      <QueryState query={slips}>
        {(items) => (
          <div data-dependency-slips={forInitiative ? "initiative" : "transformation"}>
            <RegisterTable
              id={forInitiative ? "dependency-slips-initiative" : "dependency-slips"}
              caption={t("dependencies.slips.caption")}
              rows={slipRows(items, initiativeId)}
              columns={columns}
              getRowId={(r) => r.key}
              emptyTitle={t(forInitiative ? "dependencies.slips.emptyInitiative" : "dependencies.slips.empty")}
              defaultSort={{ id: "recorded", dir: "desc" }}
            />
          </div>
        )}
      </QueryState>
    </Section>
  );
}
