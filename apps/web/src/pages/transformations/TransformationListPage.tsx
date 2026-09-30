// Transformations register (REQ-S15-013): server-side sorting, filters with removable chips, cursor pagination and
// column selection. Filters and sort live in the URL so the view is shareable and survives reload.
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { PHASES, TRANSFORMATION_MODES, TRANSFORMATION_STATUSES, PAGINATION } from "@mth/shared";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { useTransformations, type TransformationListParams } from "../../api/queries.ts";
import type { Transformation, TransformationSort } from "../../api/types.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { LifecycleChip } from "../../components/Badges.tsx";
import {
  ColumnPicker,
  DataTable,
  Pager,
  useCursorPager,
  usePersistentVisibility,
} from "../../components/DataTable.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { BusinessUnitName, useBusinessUnitIndex } from "./common.tsx";

const SORTS: readonly TransformationSort[] = [
  "updatedAt:desc",
  "updatedAt:asc",
  "name:asc",
  "name:desc",
  "code:asc",
  "code:desc",
];
const DEFAULT_SORT: TransformationSort = "updatedAt:desc";

function toSorting(sort: TransformationSort): SortingState {
  const [id, dir] = sort.split(":") as [string, string];
  return [{ id, desc: dir === "desc" }];
}
function fromSorting(s: SortingState): TransformationSort {
  const first = s[0];
  if (!first) return DEFAULT_SORT;
  const candidate = `${first.id}:${first.desc ? "desc" : "asc"}` as TransformationSort;
  return SORTS.includes(candidate) ? candidate : DEFAULT_SORT;
}

const col = createColumnHelper<Transformation>();

export function TransformationListPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("transformations.listTitle"));
  const [params, setParams] = useSearchParams();
  const pager = useCursorPager();
  const bu = useBusinessUnitIndex();

  const sortParam = params.get("sort") as TransformationSort | null;
  const sort = sortParam && SORTS.includes(sortParam) ? sortParam : DEFAULT_SORT;
  const limitParam = Number(params.get("limit"));
  const limit = [10, 25, 50, 100].includes(limitParam) ? limitParam : PAGINATION.defaultLimit;
  const statuses = params.getAll("status").filter((s) => (TRANSFORMATION_STATUSES as readonly string[]).includes(s));
  const mode = params.get("mode") ?? "";
  const phase = params.get("phase") ?? "";
  const businessUnitId = params.get("bu") ?? "";
  const q = params.get("q") ?? "";
  const includeArchived = params.get("archived") === "1";

  const filterKey = [sort, limit, statuses.join(","), mode, phase, businessUnitId, q, includeArchived].join("|");
  const { reset } = pager;
  useEffect(() => reset(), [filterKey, reset]);

  const listParams: TransformationListParams = {
    sort,
    limit,
    ...(statuses.length ? { status: statuses } : {}),
    ...(mode ? { mode } : {}),
    ...(phase ? { phase } : {}),
    ...(businessUnitId ? { businessUnitId } : {}),
    ...(q ? { q } : {}),
    ...(includeArchived ? { includeArchived } : {}),
    ...(pager.cursor ? { cursor: pager.cursor } : {}),
  };
  const query = useTransformations(listParams);

  const update = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    mutate(next);
    setParams(next, { replace: true });
  };

  const [visibility, setVisibility] = usePersistentVisibility("transformations");
  const columns = useMemo(
    () => [
      col.accessor("code", {
        header: () => t("transformations.field.code"),
        cell: (c) => (
          <Link to={`/transformations/${c.row.original.id}`} className="link">
            <bdi dir="ltr" className="code">
              {c.getValue()}
            </bdi>
          </Link>
        ),
        enableSorting: true,
        enableHiding: false,
      }),
      col.accessor("name", {
        header: () => t("transformations.field.name"),
        cell: (c) => <Link to={`/transformations/${c.row.original.id}`}>{c.getValue()}</Link>,
        enableSorting: true,
        enableHiding: false,
      }),
      col.accessor("businessUnitId", {
        id: "businessUnit",
        header: () => t("transformations.field.businessUnit"),
        cell: (c) => <BusinessUnitName id={c.getValue()} index={bu.byId} />,
        enableSorting: false,
      }),
      col.accessor("mode", {
        header: () => t("transformations.field.mode"),
        cell: (c) => t(`transformations.mode.${c.getValue()}`),
        enableSorting: false,
      }),
      col.accessor("currentPhase", {
        header: () => t("transformations.field.currentPhase"),
        cell: (c) => t(`transformations.phase.${c.getValue()}`),
        enableSorting: false,
      }),
      col.accessor("status", {
        header: () => t("transformations.field.status"),
        cell: (c) => (
          <span className="chip-row">
            <LifecycleChip status={c.getValue()} />
            {c.row.original.archivedAt ? <LifecycleChip status="archived" /> : null}
          </span>
        ),
        enableSorting: false,
      }),
      col.accessor("updatedAt", {
        header: () => t("transformations.field.updatedAt"),
        cell: (c) => (
          <span>
            {formatDateTime(c.getValue(), locale, c.row.original.timezone)}{" "}
            <bdi dir="ltr" className="muted small">
              {c.row.original.timezone}
            </bdi>
          </span>
        ),
        enableSorting: true,
      }),
    ],
    [t, locale, bu.byId],
  );
  const pickerColumns = [
    { id: "businessUnit", label: t("transformations.field.businessUnit") },
    { id: "mode", label: t("transformations.field.mode") },
    { id: "currentPhase", label: t("transformations.field.currentPhase") },
    { id: "status", label: t("transformations.field.status") },
    { id: "updatedAt", label: t("transformations.field.updatedAt") },
  ];

  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(q
      ? [{ key: "q", label: `${t("common.filter.search")}: ${q}`, remove: () => update((p) => p.delete("q")) }]
      : []),
    ...statuses.map((s) => ({
      key: `status-${s}`,
      label: `${t("transformations.field.status")}: ${t(`transformations.status.${s}`)}`,
      remove: () =>
        update((p) => {
          const rest = p.getAll("status").filter((x) => x !== s);
          p.delete("status");
          rest.forEach((x) => p.append("status", x));
        }),
    })),
    ...(mode
      ? [
          {
            key: "mode",
            label: `${t("transformations.field.mode")}: ${t(`transformations.mode.${mode}`)}`,
            remove: () => update((p) => p.delete("mode")),
          },
        ]
      : []),
    ...(phase
      ? [
          {
            key: "phase",
            label: `${t("transformations.field.currentPhase")}: ${t(`transformations.phase.${phase}`)}`,
            remove: () => update((p) => p.delete("phase")),
          },
        ]
      : []),
    ...(businessUnitId
      ? [
          {
            key: "bu",
            label: `${t("transformations.field.businessUnit")}: ${localName(bu.byId.get(businessUnitId), locale) ?? t("common.value.unknown")}`,
            remove: () => update((p) => p.delete("bu")),
          },
        ]
      : []),
    ...(includeArchived
      ? [
          {
            key: "archived",
            label: t("transformations.filter.includeArchived"),
            remove: () => update((p) => p.delete("archived")),
          },
        ]
      : []),
  ];

  const canCreate = canAnywhere(me, "transformation.create");

  return (
    <div className="page">
      <PageHeader
        title={t("transformations.listTitle")}
        subtitle={t("transformations.listSubtitle")}
        actions={
          canCreate ? (
            <Link to="/transformations/new" className="button button--primary">
              <Icon name="plus" /> {t("transformations.new")}
            </Link>
          ) : null
        }
      />
      <Filters
        q={q}
        statuses={statuses}
        mode={mode}
        phase={phase}
        businessUnitId={businessUnitId}
        includeArchived={includeArchived}
        units={bu.units}
        onChange={update}
      />
      {chips.length > 0 ? (
        <div className="chips" aria-label={t("common.filter.active")} role="group">
          {chips.map((c) => (
            <button key={c.key} type="button" className="filter-chip" onClick={c.remove}>
              {c.label} <Icon name="cross" />
              <span className="visually-hidden">{t("common.filter.remove")}</span>
            </button>
          ))}
          <button
            type="button"
            className="button button--link button--small"
            onClick={() =>
              update((p) => ["q", "status", "mode", "phase", "bu", "archived"].forEach((k) => p.delete(k)))
            }
          >
            {t("common.filter.clearAll")}
          </button>
        </div>
      ) : null}
      <div className="toolbar">
        <ColumnPicker columns={pickerColumns} visibility={visibility} onChange={setVisibility} />
      </div>
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty={
          chips.length > 0 ? (
            <EmptyState title={t("transformations.emptyFilteredTitle")} body={t("transformations.emptyFilteredBody")} />
          ) : (
            <EmptyState
              title={t("transformations.emptyTitle")}
              body={canCreate ? t("transformations.emptyBodyCreate") : t("transformations.emptyBody")}
              action={
                canCreate ? (
                  <Link to="/transformations/new" className="button button--primary">
                    {t("transformations.new")}
                  </Link>
                ) : undefined
              }
            />
          )
        }
      >
        {(data) => (
          <>
            <DataTable
              caption={t("transformations.listTitle")}
              data={data.items}
              columns={columns}
              getRowId={(r) => r.id}
              sorting={toSorting(sort)}
              onSortingChange={(s) => update((p) => p.set("sort", fromSorting(s)))}
              columnVisibility={visibility}
              onColumnVisibilityChange={setVisibility}
              busy={query.isFetching}
            />
            <Pager
              pageNumber={pager.pageNumber}
              hasPrevious={pager.hasPrevious}
              hasNext={Boolean(data.nextCursor)}
              onPrevious={pager.previous}
              onNext={() => pager.next(data.nextCursor)}
              pageSize={limit}
              onPageSizeChange={(n) => update((p) => p.set("limit", String(n)))}
              shownCount={data.items.length}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}

function Filters({
  q,
  statuses,
  mode,
  phase,
  businessUnitId,
  includeArchived,
  units,
  onChange,
}: {
  q: string;
  statuses: readonly string[];
  mode: string;
  phase: string;
  businessUnitId: string;
  includeArchived: boolean;
  units: readonly { id: string; code: string; nameEn: string; nameAr: string }[];
  onChange: (mutate: (p: URLSearchParams) => void) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const id = useId();
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = search.trim();
    onChange((p) => (value ? p.set("q", value) : p.delete("q")));
  };
  const setOrDelete = (key: string, value: string) => onChange((p) => (value ? p.set(key, value) : p.delete(key)));
  return (
    <form className="filters" role="search" aria-label={t("common.filter.title")} onSubmit={submit}>
      <div className="filters__search">
        <label htmlFor={`${id}-q`}>{t("common.filter.search")}</label>
        <input
          id={`${id}-q`}
          type="search"
          value={search}
          maxLength={200}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("transformations.filter.searchPlaceholder")}
        />
        <button type="submit" className="button button--secondary button--small">
          {t("common.filter.apply")}
        </button>
      </div>
      <fieldset className="filters__group">
        <legend>{t("transformations.field.status")}</legend>
        {TRANSFORMATION_STATUSES.map((s) => (
          <label key={s} className="checkbox">
            <input
              type="checkbox"
              checked={statuses.includes(s)}
              onChange={(e) =>
                onChange((p) => {
                  const rest = p.getAll("status").filter((x) => x !== s);
                  p.delete("status");
                  [...rest, ...(e.target.checked ? [s] : [])].forEach((x) => p.append("status", x));
                })
              }
            />
            {t(`transformations.status.${s}`)}
          </label>
        ))}
      </fieldset>
      <div className="filters__select">
        <label htmlFor={`${id}-mode`}>{t("transformations.field.mode")}</label>
        <select id={`${id}-mode`} value={mode} onChange={(e) => setOrDelete("mode", e.target.value)}>
          <option value="">{t("common.filter.any")}</option>
          {TRANSFORMATION_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`transformations.mode.${m}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="filters__select">
        <label htmlFor={`${id}-phase`}>{t("transformations.field.currentPhase")}</label>
        <select id={`${id}-phase`} value={phase} onChange={(e) => setOrDelete("phase", e.target.value)}>
          <option value="">{t("common.filter.any")}</option>
          {PHASES.map((p) => (
            <option key={p} value={p}>
              {t(`transformations.phase.${p}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="filters__select">
        <label htmlFor={`${id}-bu`}>{t("transformations.field.businessUnit")}</label>
        <select id={`${id}-bu`} value={businessUnitId} onChange={(e) => setOrDelete("bu", e.target.value)}>
          <option value="">{t("common.filter.any")}</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {localName(u, locale)} ({u.code})
            </option>
          ))}
        </select>
      </div>
      <label className="checkbox filters__archived">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setOrDelete("archived", e.target.checked ? "1" : "")}
        />
        {t("transformations.filter.includeArchived")}
      </label>
    </form>
  );
}
