// Client-side register table for the P2 registers (REQ-S15-013): a whole register of one transformation is loaded
// (bounded), then sorted, filtered, paginated and column-selected here. Sorting is announced with aria-sort, the
// filter is a labelled search box, column selection is persisted per table and pagination is a labelled navigation.
// Missing values sort last and render as Unknown/None, never as 0.
import { useId, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ColumnPicker, usePersistentVisibility } from "./DataTable.tsx";
import { Icon } from "./Icon.tsx";
import { EmptyState } from "./States.tsx";

export interface RegisterColumn<T> {
  readonly id: string;
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  /** Value used for sorting; null/undefined sorts last. Columns without it are not sortable. */
  readonly sortValue?: (row: T) => string | number | null | undefined;
  /** Text searched by the filter box (defaults to the sort value). */
  readonly filterText?: (row: T) => string | null | undefined;
  /** Columns that carry the row's identity or actions cannot be hidden. */
  readonly hideable?: boolean;
  /** Rendered as the row header (<th scope="row">). */
  readonly rowHeader?: boolean;
}

type SortDir = "asc" | "desc";

export function RegisterTable<T>({
  id,
  caption,
  rows,
  columns,
  getRowId,
  emptyTitle,
  emptyBody,
  toolbar,
  defaultSort,
  pageSize: initialPageSize = 10,
}: {
  /** Stable id used to persist the column selection. */
  id: string;
  caption: string;
  rows: readonly T[];
  columns: readonly RegisterColumn<T>[];
  getRowId: (row: T) => string;
  emptyTitle: string;
  emptyBody?: string;
  toolbar?: ReactNode;
  defaultSort?: { id: string; dir: SortDir };
  pageSize?: number;
}) {
  const { t, i18n } = useTranslation();
  const filterId = useId();
  const [visibility, setVisibility] = usePersistentVisibility(`p2.${id}`);
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(defaultSort ?? null);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const visible = columns.filter((c) => visibility[c.id] !== false || c.hideable === false);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase(i18n.language);
    if (!needle) return rows;
    return rows.filter((row) =>
      columns.some((c) => {
        const text = c.filterText ? c.filterText(row) : c.sortValue?.(row);
        return text !== null && text !== undefined && String(text).toLocaleLowerCase(i18n.language).includes(needle);
      }),
    );
  }, [rows, columns, filter, i18n.language]);

  const sorted = useMemo(() => {
    const column = sort ? columns.find((c) => c.id === sort.id) : undefined;
    if (!sort || !column?.sortValue) return filtered;
    const value = column.sortValue;
    const collator = new Intl.Collator(i18n.language, { numeric: true, sensitivity: "base" });
    return [...filtered].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const aMissing = va === null || va === undefined || va === "";
      const bMissing = vb === null || vb === undefined || vb === "";
      if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1; // missing values always last
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb));
      return sort.dir === "asc" ? c : -c;
    });
  }, [filtered, sort, columns, i18n.language]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const shown = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (columnId: string) => {
    setSort((s) =>
      s?.id !== columnId ? { id: columnId, dir: "asc" } : s.dir === "asc" ? { id: columnId, dir: "desc" } : null,
    );
    setPage(0);
  };

  return (
    <div className="register" data-register={id}>
      <div className="toolbar register__toolbar">
        <span className="filters__search">
          <label htmlFor={filterId}>{t("common.filter.search")}</label>
          <input
            id={filterId}
            type="search"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
          />
        </span>
        <ColumnPicker
          columns={columns.map((c) => ({ id: c.id, label: c.header, hideable: c.hideable !== false }))}
          visibility={visibility}
          onChange={setVisibility}
        />
        {toolbar}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={emptyTitle} {...(emptyBody ? { body: emptyBody } : {})} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">{caption}</caption>
              <thead>
                <tr>
                  {visible.map((c) => {
                    const dir = sort?.id === c.id ? sort.dir : null;
                    return (
                      <th
                        key={c.id}
                        scope="col"
                        aria-sort={
                          c.sortValue
                            ? dir === "asc"
                              ? "ascending"
                              : dir === "desc"
                                ? "descending"
                                : "none"
                            : undefined
                        }
                      >
                        {c.sortValue ? (
                          <button
                            type="button"
                            className="sort-button"
                            onClick={() => toggleSort(c.id)}
                            title={t("common.table.sortBy")}
                          >
                            {c.header}
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
                          c.header
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={visible.length}>{t("common.table.noMatch")}</td>
                  </tr>
                ) : (
                  shown.map((row) => (
                    <tr key={getRowId(row)}>
                      {visible.map((c) =>
                        c.rowHeader ? (
                          <th key={c.id} scope="row">
                            {c.cell(row)}
                          </th>
                        ) : (
                          <td key={c.id}>{c.cell(row)}</td>
                        ),
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <ClientPager
            page={current}
            pageCount={pageCount}
            total={sorted.length}
            shown={shown.length}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(0);
            }}
          />
        </>
      )}
    </div>
  );
}

function ClientPager({
  page,
  pageCount,
  total,
  shown,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  total: number;
  shown: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}) {
  const { t } = useTranslation();
  const sizeId = useId();
  return (
    <nav className="pager" aria-label={t("common.table.pagination")}>
      <span className="pager__info" aria-live="polite">
        {t("common.table.pageOf", { page: page + 1, pages: pageCount, shown, total })}
      </span>
      <span className="pager__size">
        <label htmlFor={sizeId}>{t("common.table.pageSize")}</label>
        <select id={sizeId} value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {[10, 25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </span>
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
      >
        {t("common.table.previous")}
      </button>
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount - 1}
      >
        {t("common.table.next")}
      </button>
    </nav>
  );
}
