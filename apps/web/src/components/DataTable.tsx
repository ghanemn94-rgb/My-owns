// Accessible data table on TanStack Table (headless; ADR-0009, REQ-S15-013): server-side sorting with aria-sort,
// column selection (persisted per table), and cursor pagination (Previous / Next, page size).
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useCallback, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon.tsx";

export interface DataTableProps<T> {
  readonly caption: string;
  readonly data: readonly T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack column value types vary per column
  readonly columns: ColumnDef<T, any>[];
  readonly getRowId: (row: T) => string;
  readonly sorting?: SortingState;
  readonly onSortingChange?: (next: SortingState) => void;
  readonly columnVisibility?: VisibilityState;
  readonly onColumnVisibilityChange?: (next: VisibilityState) => void;
  readonly busy?: boolean;
}

export function DataTable<T>({
  caption,
  data,
  columns,
  getRowId,
  sorting = [],
  onSortingChange,
  columnVisibility = {},
  onColumnVisibilityChange,
  busy,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const table = useReactTable({
    data: data as T[],
    columns,
    getRowId,
    state: { sorting, columnVisibility },
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    enableMultiSort: false,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      onSortingChange?.(next);
    },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnVisibility) : updater;
      onColumnVisibilityChange?.(next);
    },
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="table-wrap" aria-busy={busy ? "true" : "false"}>
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort() && Boolean(onSortingChange);
                const dir = header.column.getIsSorted();
                const label = flexRender(header.column.columnDef.header, header.getContext());
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      canSort ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined
                    }
                  >
                    {canSort ? (
                      <button
                        type="button"
                        className="sort-button"
                        onClick={header.column.getToggleSortingHandler()}
                        title={t("common.table.sortBy")}
                      >
                        {label}
                        <Icon name={dir === "asc" ? "chevronUp" : dir === "desc" ? "chevronDown" : "sort"} />
                        <span className="visually-hidden">
                          {dir === "asc"
                            ? t("common.table.sortedAsc")
                            : dir === "desc"
                              ? t("common.table.sortedDesc")
                              : t("common.table.notSorted")}
                        </span>
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Column selection: a disclosure with one checkbox per hideable column. */
export function ColumnPicker({
  columns,
  visibility,
  onChange,
}: {
  columns: readonly { id: string; label: string; hideable?: boolean }[];
  visibility: VisibilityState;
  onChange: (next: VisibilityState) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="column-picker">
      <button
        type="button"
        className="button button--secondary button--small"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="columns" /> {t("common.table.columns")}
      </button>
      {open ? (
        <fieldset id={panelId} className="column-picker__panel">
          <legend>{t("common.table.showColumns")}</legend>
          {columns
            .filter((c) => c.hideable !== false)
            .map((c) => (
              <label key={c.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={visibility[c.id] !== false}
                  onChange={(e) => onChange({ ...visibility, [c.id]: e.target.checked })}
                />
                {c.label}
              </label>
            ))}
        </fieldset>
      ) : null}
    </div>
  );
}

/** Cursor pagination (ADR-0007): Previous uses the remembered cursors of earlier pages. */
export function Pager({
  pageNumber,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  pageSize,
  onPageSizeChange,
  shownCount,
}: {
  pageNumber: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pageSize: number;
  onPageSizeChange?: (size: number) => void;
  shownCount: number;
}) {
  const { t } = useTranslation();
  const sizeId = useId();
  return (
    <nav className="pager" aria-label={t("common.table.pagination")}>
      <span className="pager__info" aria-live="polite">
        {t("common.table.pageInfo", { page: pageNumber, shown: shownCount })}
      </span>
      {onPageSizeChange ? (
        <span className="pager__size">
          <label htmlFor={sizeId}>{t("common.table.pageSize")}</label>
          <select id={sizeId} value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
      ) : null}
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={onPrevious}
        disabled={!hasPrevious}
      >
        {t("common.table.previous")}
      </button>
      <button type="button" className="button button--secondary button--small" onClick={onNext} disabled={!hasNext}>
        {t("common.table.next")}
      </button>
    </nav>
  );
}

/** Keeps the cursors of visited pages so Previous works with forward-only cursors. */
export function useCursorPager() {
  const [stack, setStack] = useState<(string | null)[]>([null]);
  const cursor = stack[stack.length - 1] ?? null;
  const next = useCallback((nextCursor: string | null) => {
    if (nextCursor) setStack((s) => [...s, nextCursor]);
  }, []);
  const previous = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  // Keeps the same array when already on the first page, so calling reset() in an effect cannot loop.
  const reset = useCallback(() => setStack((s) => (s.length === 1 && s[0] === null ? s : [null])), []);
  return { cursor, pageNumber: stack.length, hasPrevious: stack.length > 1, next, previous, reset };
}

/** Column visibility persisted in localStorage per table id. */
export function usePersistentVisibility(tableId: string, defaults: VisibilityState = {}) {
  const key = `mth.table.${tableId}.columns`;
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? { ...defaults, ...(JSON.parse(raw) as VisibilityState) } : defaults;
    } catch {
      return defaults;
    }
  });
  const update = (next: VisibilityState) => {
    setVisibility(next);
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(next));
    } catch {
      // ignore: visibility still applies for this session
    }
  };
  return [visibility, update] as const;
}
