// The initiative register (T05 list) with server-side sorting, filtering and paging, filter chips and saved views
// (T-DG6-FE-D; ADR-0057 §4, §5; REQ-S15-013 "Tables use server-side pagination and filtering through the API and
// persist column choices in saved views"; REQ-S15-010 "lists support saved views and chips"). Named lines outside
// p6-work-split §H/G.6's file list, disclosed in the handback: the page needs them so the 1,000-initiative register
// works (FE-D "the 1,000-initiative register e2e").
//  - Every filter and the sort are `listInitiatives` query parameters (status, waveId, q, executiveOwnerUserId,
//    workstreamLeadUserId, sort); a page is one API page (cursor, limit). Nothing is filtered or sorted in the browser.
//  - Columns the registry names (`SAVED_VIEW_LISTS.initiatives.columns`) can be hidden and are stored in a view;
//    derived columns (owners, proposed rank, selection) are not properties of the list item, so they stay shown.
//  - The old per-browser column choice of this table (`p2.p3-initiatives`) is read once as the unsaved initial state.
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { INITIATIVE_STATUSES } from "@mth/shared/schemas";
import { SAVED_VIEW_LISTS } from "@mth/shared";
import { api } from "../../api/client.ts";
import { p3Keys, shouldRetry } from "../../api/queries.ts";
import type { Initiative, RoadmapWave } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { ColumnPicker, DataTable, Pager, useCursorPager } from "../../components/DataTable.tsx";
import { FilterChips, type FilterChip } from "../../components/filter-chips/FilterChips.tsx";
import { HelpPanel } from "../../components/help/HelpPanel.tsx";
import type { Person } from "../../components/People.tsx";
import type { RegisterColumn } from "../../components/RegisterTable.tsx";
import { SavedViewBar } from "../../components/saved-views/SavedViewBar.tsx";
import { listQueryOf, useListView, type ListViewState } from "../../components/saved-views/useListView.ts";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { waveName } from "./common.tsx";

interface InitiativePage {
  readonly items: Initiative[];
  readonly nextCursor: string | null;
}

/** The server sort keys of listInitiatives (ADR-0057 §5). */
const SORT_KEYS = SAVED_VIEW_LISTS.initiatives.sorts;
const REGISTRY_COLUMNS = SAVED_VIEW_LISTS.initiatives.columns;

export function InitiativeRegister({
  tid,
  caption,
  columns,
  waves,
  people,
  emptyBody,
}: {
  tid: string;
  caption: string;
  /** Column ids that are list-item properties match the registry keys (code, name, status, waveId, …). */
  columns: readonly RegisterColumn<Initiative>[];
  waves: readonly RoadmapWave[];
  people: readonly Person[];
  emptyBody?: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ids = useId();
  // The column definitions are stable per set of ids (the cells read the latest column through a ref): a new cell
  // function on every render would make TanStack's flexRender remount every row (losing focus and DOM identity).
  const idKey = columns.map((c) => c.id).join("|");
  const columnIds = useMemo(() => idKey.split("|"), [idKey]);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const defaults = useMemo<ListViewState>(
    () => ({
      columns: columnIds.filter((id) => REGISTRY_COLUMNS.includes(id) && id !== "updatedAt"),
      filters: {},
      sort: [{ key: "code", direction: "asc" }],
    }),
    [columnIds],
  );
  const view = useListView({
    listKey: "initiatives",
    transformationId: tid,
    columnIds,
    defaults,
    legacyTableId: "p2.p3-initiatives",
  });
  const { state, setFilter } = view;
  const [pageSize, setPageSize] = useState(25);
  const pager = useCursorPager();
  const query = listQueryOf(state) as Record<string, string>;
  const queryKey = JSON.stringify(query);
  const { reset } = pager;
  useEffect(() => reset(), [queryKey, pageSize, reset]);
  const appliedQ = typeof state.filters["q"] === "string" ? state.filters["q"] : "";
  const [qDraft, setQDraft] = useState(appliedQ);
  useEffect(() => setQDraft(appliedQ), [appliedQ]);

  const page = useQuery({
    queryKey: p3Keys.initiatives(tid, {
      ...query,
      limit: String(pageSize),
      ...(pager.cursor ? { cursor: pager.cursor } : {}),
    }),
    queryFn: ({ signal }) =>
      api.get<InitiativePage>(
        "/api/v1/initiatives",
        { transformationId: tid, ...query, limit: pageSize, cursor: pager.cursor },
        signal,
      ),
    enabled: Boolean(tid),
    retry: shouldRetry,
    placeholderData: keepPreviousData,
  });

  const tableColumns = useMemo(() => {
    const helper = createColumnHelper<Initiative>();
    const byId = (id: string) => columnsRef.current.find((c) => c.id === id);
    return columnIds.map((id) => {
      const spec = byId(id);
      // An accessor (the item's own property, unused for display) so TanStack offers the header's sort control; the
      // sorting itself is the server's (manualSorting in DataTable).
      return helper.accessor((row) => String((row as unknown as Record<string, unknown>)[id] ?? ""), {
        id,
        header: () => byId(id)?.header ?? id,
        cell: (ctx) => (byId(id)?.cell(ctx.row.original) ?? null) as ReactNode,
        enableSorting: SORT_KEYS.includes(id),
        sortDescFirst: false,
        enableHiding: spec?.hideable !== false && REGISTRY_COLUMNS.includes(id),
      });
    });
  }, [columnIds]);
  const sorting: SortingState = state.sort.map((s) => ({ id: s.key, desc: s.direction === "desc" }));

  const str = (k: string) => (typeof state.filters[k] === "string" ? (state.filters[k] as string) : "");
  const personLabel = (id: string) => people.find((p) => p.id === id)?.label ?? t("common.value.unknown");
  const chipDefs: { key: string; label: string; value: (v: string) => string }[] = [
    { key: "q", label: t("productivity.register.q"), value: (v) => v },
    { key: "status", label: t("portfolio.filter.status"), value: (v) => t(`portfolio.status.${v}`) },
    {
      key: "waveId",
      label: t("portfolio.filter.wave"),
      value: (v) => {
        const w = waves.find((x) => x.id === v);
        return w ? (waveName(w, locale) ?? w.code) : t("common.value.unknown");
      },
    },
    { key: "executiveOwnerUserId", label: t("portfolio.field.executiveOwner"), value: personLabel },
    { key: "workstreamLeadUserId", label: t("portfolio.field.workstreamLead"), value: personLabel },
  ];
  const chips: FilterChip[] = chipDefs
    .filter((d) => str(d.key) !== "")
    .map((d) => ({ key: d.key, label: d.label, value: d.value(str(d.key)), onRemove: () => setFilter(d.key, null) }));
  const filtered = chips.length > 0;

  const select = (key: string, label: string, options: { value: string; label: string }[]) => (
    <div className="filters__select">
      <label htmlFor={`${ids}-${key}`}>{label}</label>
      <select
        id={`${ids}-${key}`}
        value={str(key)}
        onChange={(e) => setFilter(key, e.target.value || null)}
        data-filter={key === "waveId" ? "wave" : key}
      >
        <option value="">{t("portfolio.filter.all")}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
  const personOptions = people.map((p) => ({ value: p.id, label: p.label }));

  return (
    <div className="register" data-register="initiatives">
      <SavedViewBar view={view} label={caption} />
      <div className="filters" role="group" aria-label={t("portfolio.filter.label")}>
        <form
          className="filters__search"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter("q", qDraft.trim() || null);
          }}
        >
          <label htmlFor={`${ids}-q`}>{t("productivity.register.q")}</label>
          <input
            id={`${ids}-q`}
            type="search"
            value={qDraft}
            maxLength={200}
            onChange={(e) => setQDraft(e.target.value)}
            onBlur={() => setFilter("q", qDraft.trim() || null)}
            data-filter="q"
          />
        </form>
        {select(
          "status",
          t("portfolio.filter.status"),
          INITIATIVE_STATUSES.map((s) => ({ value: s, label: t(`portfolio.status.${s}`) })),
        )}
        {select(
          "waveId",
          t("portfolio.filter.wave"),
          waves.map((w) => ({ value: w.id, label: waveName(w, locale) ?? w.code })),
        )}
        {select("executiveOwnerUserId", t("portfolio.field.executiveOwner"), personOptions)}
        {select("workstreamLeadUserId", t("portfolio.field.workstreamLead"), personOptions)}
        <ColumnPicker
          columns={columns.map((c) => ({
            id: c.id,
            label: c.header,
            hideable: c.hideable !== false && REGISTRY_COLUMNS.includes(c.id),
          }))}
          visibility={view.visibility}
          onChange={view.setVisibility}
        />
        <HelpPanel screenKey="lists" />
      </div>
      <FilterChips
        chips={chips}
        onClearAll={() => {
          for (const c of chips) setFilter(c.key, null);
        }}
      />
      <QueryState query={page}>
        {(data) =>
          data.items.length === 0 && !pager.hasPrevious ? (
            <EmptyState
              title={filtered ? t("portfolio.list.emptyFiltered") : t("portfolio.list.empty")}
              {...(emptyBody && !filtered ? { body: emptyBody } : {})}
            />
          ) : (
            <>
              <DataTable<Initiative>
                caption={caption}
                data={data.items}
                columns={tableColumns}
                getRowId={(i) => i.id}
                sorting={sorting}
                onSortingChange={(next) => {
                  const first = next[0];
                  view.setSort(first ? [{ key: first.id, direction: first.desc ? "desc" : "asc" }] : []);
                }}
                columnVisibility={view.visibility}
                busy={page.isFetching}
              />
              <Pager
                pageNumber={pager.pageNumber}
                hasPrevious={pager.hasPrevious}
                hasNext={Boolean(data.nextCursor)}
                onPrevious={pager.previous}
                onNext={() => pager.next(data.nextCursor)}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                shownCount={data.items.length}
              />
            </>
          )
        }
      </QueryState>
    </div>
  );
}
