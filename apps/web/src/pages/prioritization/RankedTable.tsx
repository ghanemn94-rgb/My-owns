// Ranked table and value/feasibility comparison (REQ-S09-004, REQ-S09-001, REQ-S09-003; ADR-0022 §3, §6, §7).
//  - server-side filters (status, completeness, funding, flag); client-side sort, column selection and pages over the
//    one transformation's portfolio (at most 500 eligible initiatives; above that the API answers 422 and the page shows
//    that state, never an empty table);
//  - the weighted score with 2 decimals, or 'incomplete'; the 0-100 view toggle always shows its conversion label;
//  - proposed rank, selection and funding are three separate columns (ranking never selects and never funds);
//  - the chart converts decimals to pixels only for drawing (new Decimal(x).toNumber()); every label is the decimal
//    text, and the same data is offered as a table.
import { DISPLAY100_LABEL_KEY, display100Formatted, weightedScoreDisplay } from "@mth/shared/calc";
import { INITIATIVE_STATUSES, type PrioritizationItem } from "@mth/shared/schemas";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import Decimal from "decimal.js";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../app/locale.ts";
import { ColumnPicker, DataTable, Pager, usePersistentVisibility } from "../../components/DataTable.tsx";
import { Unknown } from "../../components/Badges.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState } from "../../components/States.tsx";
import type { PrioritizationFilters } from "./api.ts";
import { DecimalOrUnknown, FlagList, TableRegion, useDecimal } from "./p3ui.tsx";

const PAGE_SIZE = 25;
const FLAG_FILTERS = [
  "schedule.needed_by_conflict",
  "schedule.before_predecessor",
  "schedule.unknown",
  "capacity.over_allocated",
  "capacity.unknown",
];

function compareDecimal(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return new Decimal(a).comparedTo(new Decimal(b));
}

export function sortItems(items: readonly PrioritizationItem[], sorting: SortingState): PrioritizationItem[] {
  const s = sorting[0] ?? { id: "rank", desc: false };
  const dir = s.desc ? -1 : 1;
  const out = [...items];
  out.sort((x, y) => {
    let c = 0;
    if (s.id === "rank") {
      if (x.rank === null && y.rank === null) c = 0;
      else if (x.rank === null) return 1;
      else if (y.rank === null) return -1;
      else c = x.rank - y.rank;
    } else if (s.id === "score") {
      // Incomplete rows stay last in both directions.
      if (x.result.weightedScore === null || y.result.weightedScore === null)
        return compareDecimal(x.result.weightedScore, y.result.weightedScore);
      c = compareDecimal(x.result.weightedScore, y.result.weightedScore);
    } else if (s.id === "code") {
      c = x.initiative.code.localeCompare(y.initiative.code);
    }
    if (c === 0) c = x.initiative.code.localeCompare(y.initiative.code) * dir;
    return c * dir;
  });
  return out;
}

export function RankedSection({
  items,
  filters,
  onFilters,
  view100,
  onView100,
  onScore,
}: {
  items: readonly PrioritizationItem[];
  filters: PrioritizationFilters;
  onFilters: (f: PrioritizationFilters) => void;
  view100: boolean;
  onView100: (v: boolean) => void;
  onScore: (initiativeId: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [sorting, setSorting] = useState<SortingState>([{ id: "rank", desc: false }]);
  const [page, setPage] = useState(1);
  const [visibility, setVisibility] = usePersistentVisibility("prioritization.ranked");

  const scoreText = (i: PrioritizationItem) => {
    if (i.result.completeness !== "complete" || i.result.weightedScore === null) return null;
    return view100
      ? display100Formatted(i.result.weightedScore, { locale })
      : weightedScoreDisplay(i.result.weightedScore, { locale });
  };

  const columns = useMemo<ColumnDef<PrioritizationItem>[]>(
    () => [
      {
        id: "rank",
        header: () => t("prioritization.ranked.rank"),
        enableSorting: true,
        cell: ({ row }) =>
          row.original.rank === null ? (
            <span className="muted">{t("prioritization.ranked.unranked")}</span>
          ) : (
            <bdi>{row.original.rank}</bdi>
          ),
      },
      {
        id: "code",
        header: () => t("prioritization.ranked.initiative"),
        enableSorting: true,
        cell: ({ row }) => (
          <span>
            <bdi dir="ltr" className="code">
              {row.original.initiative.code}
            </bdi>{" "}
            {row.original.initiative.name}
          </span>
        ),
      },
      {
        id: "score",
        header: () => (view100 ? t("prioritization.ranked.score100") : t("prioritization.ranked.score")),
        enableSorting: true,
        cell: ({ row }) => {
          const text = scoreText(row.original);
          return text === null ? (
            <span className="status-chip status-chip--unknown" data-completeness="incomplete">
              {t("prioritization.incomplete")}
            </span>
          ) : (
            <bdi data-testid="score-cell">{text}</bdi>
          );
        },
      },
      {
        id: "value",
        header: () => t("prioritization.ranked.valueAxis"),
        enableSorting: false,
        cell: ({ row }) => <DecimalOrUnknown value={row.original.valueAxis} min={2} max={2} />,
      },
      {
        id: "feasibility",
        header: () => t("prioritization.ranked.feasibilityAxis"),
        enableSorting: false,
        cell: ({ row }) => <DecimalOrUnknown value={row.original.feasibilityAxis} min={2} max={2} />,
      },
      {
        id: "status",
        header: () => t("prioritization.ranked.status"),
        enableSorting: false,
        cell: ({ row }) => t(`prioritization.status.${row.original.initiative.status}`),
      },
      {
        id: "selection",
        header: () => t("prioritization.ranked.selection"),
        enableSorting: false,
        cell: ({ row }) => t(`prioritization.selection.${row.original.selection}`),
      },
      {
        id: "funding",
        header: () => t("prioritization.ranked.funding"),
        enableSorting: false,
        cell: ({ row }) => t(`prioritization.funding.${row.original.funding}`),
      },
      {
        id: "flags",
        header: () => t("prioritization.ranked.flags"),
        enableSorting: false,
        cell: ({ row }) => <FlagList flags={row.original.flags} />,
      },
      {
        id: "actions",
        header: () => t("prioritization.ranked.actions"),
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => onScore(row.original.initiative.id)}
          >
            {t("prioritization.ranked.openScorecard", { code: row.original.initiative.code })}
          </button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scoreText depends on view100 and locale only
    [t, view100, locale, onScore],
  );

  const sorted = sortItems(items, sorting);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const set = (k: keyof PrioritizationFilters, v: string) => {
    setPage(1);
    onFilters({ ...filters, [k]: v });
  };

  return (
    <Section id="ranked" title={t("prioritization.ranked.title")} intro={t("prioritization.ranked.intro")}>
      <div className="filters" role="group" aria-label={t("prioritization.ranked.filters")}>
        <div className="filters__select">
          <label htmlFor="f-status">{t("prioritization.ranked.status")}</label>
          <select id="f-status" value={filters.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">{t("prioritization.ranked.all")}</option>
            {INITIATIVE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`prioritization.status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="filters__select">
          <label htmlFor="f-completeness">{t("prioritization.ranked.completeness")}</label>
          <select
            id="f-completeness"
            value={filters.completeness}
            onChange={(e) => set("completeness", e.target.value)}
          >
            <option value="">{t("prioritization.ranked.all")}</option>
            <option value="complete">{t("prioritization.ranked.complete")}</option>
            <option value="incomplete">{t("prioritization.incomplete")}</option>
          </select>
        </div>
        <div className="filters__select">
          <label htmlFor="f-funding">{t("prioritization.ranked.funding")}</label>
          <select id="f-funding" value={filters.funding} onChange={(e) => set("funding", e.target.value)}>
            <option value="">{t("prioritization.ranked.all")}</option>
            {(["not_applicable", "unfunded", "funded", "revoked"] as const).map((f) => (
              <option key={f} value={f}>
                {t(`prioritization.funding.${f}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="filters__select">
          <label htmlFor="f-flag">{t("prioritization.ranked.flags")}</label>
          <select id="f-flag" value={filters.flag} onChange={(e) => set("flag", e.target.value)}>
            <option value="">{t("prioritization.ranked.all")}</option>
            {FLAG_FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`roadmap.flag.${f.replace(/\./g, "__")}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="toolbar">
        <button
          type="button"
          className="button button--secondary button--small"
          aria-pressed={view100}
          onClick={() => onView100(!view100)}
          data-testid="toggle-100"
        >
          {t("prioritization.ranked.toggle100")}
        </button>
        <ColumnPicker
          columns={columns.map((c) => ({
            id: c.id!,
            label: t(
              `prioritization.ranked.${c.id === "code" ? "initiative" : c.id === "value" ? "valueAxis" : c.id === "feasibility" ? "feasibilityAxis" : c.id!}`,
            ),
            hideable: c.id !== "code" && c.id !== "rank",
          }))}
          visibility={visibility}
          onChange={setVisibility}
        />
      </div>
      {view100 ? (
        <p className="banner banner--info" data-testid="conversion-label">
          {t(DISPLAY100_LABEL_KEY)}
        </p>
      ) : null}
      <p className="muted">{t("prioritization.ranked.tieBreak")}</p>
      {items.length === 0 ? (
        <EmptyState title={t("prioritization.ranked.emptyTitle")} body={t("prioritization.ranked.emptyBody")} />
      ) : (
        <>
          <DataTable
            caption={t("prioritization.ranked.caption")}
            data={shown}
            columns={columns}
            getRowId={(r) => r.initiative.id}
            sorting={sorting}
            onSortingChange={(s) => {
              setSorting(s.length ? s : [{ id: "rank", desc: false }]);
              setPage(1);
            }}
            columnVisibility={visibility}
            onColumnVisibilityChange={setVisibility}
          />
          <Pager
            pageNumber={current}
            hasPrevious={current > 1}
            hasNext={current < pages}
            onPrevious={() => setPage(current - 1)}
            onNext={() => setPage(current + 1)}
            pageSize={PAGE_SIZE}
            shownCount={shown.length}
          />
        </>
      )}
      <ComparisonChart items={items} />
    </Section>
  );
}

/** Value (vertical) against feasibility (horizontal), both on the 1-5 scale. */
function ComparisonChart({ items }: { items: readonly PrioritizationItem[] }) {
  const { t } = useTranslation();
  const fmt = useDecimal();
  const W = 360;
  const H = 360;
  const pad = 40;
  const plotted = items.filter((i) => i.valueAxis !== null && i.feasibilityAxis !== null);
  const unplotted = items.filter((i) => i.valueAxis === null || i.feasibilityAxis === null);
  const px = (v: string) => pad + ((new Decimal(v).toNumber() - 1) / 4) * (W - 2 * pad);
  const py = (v: string) => H - pad - ((new Decimal(v).toNumber() - 1) / 4) * (H - 2 * pad);
  return (
    <figure className="card" aria-labelledby="chart-caption" data-testid="comparison-chart">
      <figcaption id="chart-caption">
        <strong>{t("prioritization.chart.title")}</strong>{" "}
        <span className="muted">{t("prioritization.chart.intro")}</span>
      </figcaption>
      <svg
        role="img"
        aria-label={t("prioritization.chart.alt", { count: plotted.length })}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ maxWidth: `${W}px`, direction: "ltr" }}
      >
        <rect
          x={pad}
          y={pad}
          width={W - 2 * pad}
          height={H - 2 * pad}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.4"
        />
        {["1", "2", "3", "4", "5"].map((v) => (
          <g key={v}>
            <text x={px(v)} y={H - pad + 16} textAnchor="middle" fontSize="11" fill="currentColor">
              {v}
            </text>
            <text x={pad - 10} y={py(v) + 4} textAnchor="end" fontSize="11" fill="currentColor">
              {v}
            </text>
          </g>
        ))}
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="currentColor">
          {t("prioritization.chart.xAxis")}
        </text>
        <text
          x={12}
          y={H / 2}
          textAnchor="middle"
          fontSize="12"
          fill="currentColor"
          transform={`rotate(-90 12 ${H / 2})`}
        >
          {t("prioritization.chart.yAxis")}
        </text>
        {plotted.map((i) => (
          <g key={i.initiative.id}>
            <circle cx={px(i.feasibilityAxis!)} cy={py(i.valueAxis!)} r="6" fill="currentColor" fillOpacity="0.7" />
            <text x={px(i.feasibilityAxis!) + 8} y={py(i.valueAxis!) - 8} fontSize="11" fill="currentColor">
              {i.initiative.code}
            </text>
          </g>
        ))}
      </svg>
      <details>
        <summary>{t("prioritization.chart.tableToggle")}</summary>
        <TableRegion label={t("prioritization.chart.tableCaption")}>
          <table className="table table--compact" data-testid="chart-table">
            <caption>{t("prioritization.chart.tableCaption")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("prioritization.ranked.initiative")}</th>
                <th scope="col">{t("prioritization.chart.yAxis")}</th>
                <th scope="col">{t("prioritization.chart.xAxis")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.initiative.id}>
                  <th scope="row">
                    <bdi dir="ltr">{i.initiative.code}</bdi> {i.initiative.name}
                  </th>
                  <td>{i.valueAxis === null ? <Unknown /> : <bdi>{fmt(i.valueAxis, 2, 2)}</bdi>}</td>
                  <td>{i.feasibilityAxis === null ? <Unknown /> : <bdi>{fmt(i.feasibilityAxis, 2, 2)}</bdi>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableRegion>
      </details>
      {unplotted.length > 0 ? (
        <p className="muted">
          {t("prioritization.chart.unplotted", { codes: unplotted.map((i) => i.initiative.code).join(", ") })}
        </p>
      ) : null}
    </figure>
  );
}
