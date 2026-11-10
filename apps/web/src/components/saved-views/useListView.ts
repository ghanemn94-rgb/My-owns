// The working state of a list that offers saved views (T-DG6-FE-D; ADR-0057 §4, §5; REQ-S15-010, REQ-S15-013): the
// visible columns, the filters and the sort, and which saved view (if any) they came from. The list sends the filters
// and the sort to the API as its own query parameters (server-side filtering, sorting and paging); applying a view
// only sets them, so a view grants no data.
//
// Start-up order: the caller's default view for this list when one exists; otherwise the old per-browser column
// choice, read once (`readLegacyVisibility`), as the UNSAVED initial state; otherwise the list's defaults.
// A view naming a key the list no longer offers is still applied without that key, and `ignoredKeys` is set so the
// bar can show the ADR-0057 §10 notice.
import { SAVED_VIEW_LISTS, type SavedViewListKey } from "@mth/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VisibilityState } from "@tanstack/react-table";
import { readLegacyVisibility, viewColumnsFromVisibility, visibilityFromViewColumns } from "../DataTable.tsx";
import type { SavedView, SavedViewBody, SavedViewFilters, SavedViewSortItem } from "./api.ts";
import { useSavedViews } from "./api.ts";

export interface ListViewState {
  readonly columns: readonly string[];
  readonly filters: SavedViewFilters;
  readonly sort: readonly SavedViewSortItem[];
}

/** Keeps only what the list offers; `ignored` names every dropped key (ADR-0057 §4: the client drops unknown keys). */
export function sanitizeView(
  listKey: SavedViewListKey,
  columnIds: readonly string[],
  view: SavedViewBody,
): { state: ListViewState; ignored: string[] } {
  const spec = SAVED_VIEW_LISTS[listKey];
  const ignored: string[] = [];
  const offeredColumns = new Set(columnIds.filter((c) => spec.columns.includes(c)));
  const columns = view.columns.filter((c) => {
    const ok = offeredColumns.has(c);
    if (!ok) ignored.push(c);
    return ok;
  });
  const filterKeys = new Set(spec.filters.map((f) => f.key));
  const filters: Record<string, string | readonly string[]> = {};
  for (const [k, v] of Object.entries(view.filters)) {
    if (filterKeys.has(k)) filters[k] = v;
    else ignored.push(k);
  }
  const sort = view.sort.filter((s) => {
    const ok = spec.sorts.includes(s.key);
    if (!ok) ignored.push(s.key);
    return ok;
  });
  return { state: { columns, filters, sort }, ignored };
}

/** Only the registry's columns are part of a view; a derived column (owners, a rank) is always shown, never stored. */
const offersColumn = (listKey: SavedViewListKey, column: string) => SAVED_VIEW_LISTS[listKey].columns.includes(column);

function sameState(a: ListViewState, b: ListViewState): boolean {
  const norm = (s: ListViewState) =>
    JSON.stringify({
      columns: [...s.columns].sort(),
      filters: Object.fromEntries(Object.entries(s.filters).sort(([x], [y]) => x.localeCompare(y))),
      sort: s.sort,
    });
  return norm(a) === norm(b);
}

export interface ListViewOptions {
  readonly listKey: SavedViewListKey;
  /** Null for the cross-transformation lists (`transformations`, `search`). */
  readonly transformationId: string | null;
  /** The table's column ids, in display order. Only those the registry names can be saved or hidden through a view. */
  readonly columnIds: readonly string[];
  /** The list's defaults when no view applies. */
  readonly defaults: ListViewState;
  /** The pre-P6 per-browser key of this table (`mth.table.<id>.columns`), read once. */
  readonly legacyTableId?: string;
}

export function useListView(options: ListViewOptions) {
  const { listKey, transformationId, columnIds, defaults, legacyTableId } = options;
  const views = useSavedViews(listKey, transformationId);
  const [state, setState] = useState<ListViewState>(() => {
    const legacy = legacyTableId ? readLegacyVisibility(legacyTableId) : null;
    if (!legacy) return defaults;
    const visibility = { ...visibilityFromViewColumns(columnIds, defaults.columns), ...legacy };
    return {
      ...defaults,
      columns: viewColumnsFromVisibility(columnIds, visibility).filter((c) => offersColumn(listKey, c)),
    };
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ignoredKeys, setIgnoredKeys] = useState<readonly string[]>([]);
  const touched = useRef(false);
  const defaultApplied = useRef(false);

  const list = useMemo(() => views.data ?? [], [views.data]);
  const active = list.find((v) => v.id === activeId) ?? null;

  const apply = useCallback(
    (view: SavedView | null) => {
      if (!view) {
        setActiveId(null);
        setIgnoredKeys([]);
        setState(defaults);
        return;
      }
      const { state: next, ignored } = sanitizeView(listKey, columnIds, view);
      setActiveId(view.id);
      setIgnoredKeys(ignored);
      setState(next);
    },
    [columnIds, defaults, listKey],
  );

  // The default view applies once, when the views arrive, unless the user already changed something.
  useEffect(() => {
    if (defaultApplied.current || !views.data) return;
    defaultApplied.current = true;
    const def = views.data.find((v) => v.isDefault && v.isOwner) ?? null;
    if (def && !touched.current) apply(def);
  }, [views.data, apply]);

  // An active view that disappeared (deleted elsewhere, or after our own delete) leaves the state as it is, unsaved.
  useEffect(() => {
    if (activeId && views.data && !views.data.some((v) => v.id === activeId)) setActiveId(null);
  }, [activeId, views.data]);

  const update = useCallback((patch: Partial<ListViewState>) => {
    touched.current = true;
    setState((s) => ({ ...s, ...patch }));
  }, []);

  const setFilter = useCallback((key: string, value: string | readonly string[] | null) => {
    touched.current = true;
    setState((s) => {
      const filters: Record<string, string | readonly string[]> = { ...s.filters };
      if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) delete filters[key];
      else filters[key] = value;
      return { ...s, filters };
    });
  }, []);

  const visibility: VisibilityState = useMemo(() => {
    const spec = SAVED_VIEW_LISTS[listKey];
    const v = visibilityFromViewColumns(columnIds, state.columns);
    // A column the registry does not name (a derived column such as a rank) cannot be stored in a view: always shown.
    for (const id of columnIds) if (!spec.columns.includes(id)) v[id] = true;
    return v;
  }, [columnIds, listKey, state.columns]);

  const setVisibility = useCallback(
    (next: VisibilityState) =>
      update({ columns: viewColumnsFromVisibility(columnIds, next).filter((c) => offersColumn(listKey, c)) }),
    [columnIds, listKey, update],
  );

  const body: SavedViewBody = useMemo(() => {
    const spec = SAVED_VIEW_LISTS[listKey];
    return {
      columns: state.columns.filter((c) => spec.columns.includes(c)),
      filters: state.filters,
      sort: state.sort,
    };
  }, [listKey, state]);

  const dirty = active ? !sameState(sanitizeView(listKey, columnIds, active).state, state) : true;

  return {
    listKey,
    transformationId,
    views,
    list,
    active,
    state,
    body,
    dirty,
    ignoredKeys,
    visibility,
    apply,
    setFilter,
    setSort: (sort: readonly SavedViewSortItem[]) => update({ sort }),
    setVisibility,
    /** After a create or rename: the saved view becomes the active one. */
    markActive: (view: SavedView) => {
      setActiveId(view.id);
      setIgnoredKeys([]);
    },
  };
}

export type ListView = ReturnType<typeof useListView>;

/** The list's filters and sort as query parameters (`sort` as `key` or `-key`, ADR-0057 §5). */
export function listQueryOf(state: ListViewState): Record<string, string | readonly string[]> {
  const out: Record<string, string | readonly string[]> = { ...state.filters };
  const first = state.sort[0];
  if (first) out["sort"] = first.direction === "desc" ? `-${first.key}` : first.key;
  return out;
}
