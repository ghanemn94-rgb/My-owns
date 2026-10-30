// Global search results (T-DG6-FE-D; ADR-0057 §2, §3, §9; REQ-S15-010): the query, record-type filters (with chips),
// archived records on request, saved views of the `search` list, and the results ranked by the server.
//  - Permission: the server returns only the records the caller may read (ReadScope at query time). The page shows
//    what it receives and never filters or guesses.
//  - States: a query shorter than 2 characters is not sent (the ADR-0057 §10 text is shown); loading; error
//    (503 search.index_unavailable, 429, network) with retry; the STALE state above the results when the index is
//    behind or rebuilding ("This information may be out of date. Last updated {time}.", Unknown when the index has no
//    time); the EMPTY state, which is a different state and, when the index is stale, says that recent changes may be
//    missing instead of claiming that nothing exists.
//  - The summary is plain text: matched terms are highlighted by splitting the text in the client (<mark>), never by
//    injecting markup.
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { SAVED_VIEW_LISTS } from "@mth/shared";
import { useLocale } from "../../app/locale.ts";
import { Pager, useCursorPager } from "../../components/DataTable.tsx";
import { FilterChips, type FilterChip } from "../../components/filter-chips/FilterChips.tsx";
import { HelpPanel } from "../../components/help/HelpPanel.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { SavedViewBar } from "../../components/saved-views/SavedViewBar.tsx";
import { useListView, type ListViewState } from "../../components/saved-views/useListView.ts";
import { EmptyState, ErrorState, LoadingState, NoPermissionState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { isNoPermission } from "../../lib/problem.ts";
import {
  hitPath,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  SEARCH_RECORD_TYPES,
  useSearch,
  type SearchHit,
  type SearchRecordType,
} from "./api.ts";
import "../../components/saved-views/productivity.css";

const SEARCH_COLUMNS = SAVED_VIEW_LISTS.search.columns;
const SEARCH_DEFAULTS: ListViewState = { columns: SEARCH_COLUMNS, filters: {}, sort: [] };
const PAGE_SIZE = 25;

const asArray = (v: string | readonly string[] | undefined): readonly string[] =>
  v === undefined ? [] : typeof v === "string" ? [v] : v;

export function SearchPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const view = useListView({
    listKey: "search",
    transformationId: null,
    columnIds: SEARCH_COLUMNS,
    defaults: SEARCH_DEFAULTS,
  });
  const { state, setFilter } = view;
  const q = typeof state.filters["q"] === "string" ? state.filters["q"] : "";
  const types = asArray(state.filters["recordType"]) as readonly SearchRecordType[];
  const includeArchived = state.filters["includeArchived"] === "true";
  const [draft, setDraft] = useState(urlQ);
  const [tooShort, setTooShort] = useState(false);
  const inputId = useId();
  const errId = useId();
  const pager = useCursorPager();
  usePageTitle(t("productivity.search.title"));

  // The header box (or a link) sets ?q=; it becomes the list's `q` filter.
  useEffect(() => {
    if (urlQ && urlQ !== q) {
      setFilter("q", urlQ);
      setDraft(urlQ);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new URL query applies
  }, [urlQ]);
  // A view or a chip that changes `q` shows it in the box.
  useEffect(() => setDraft(q), [q]);

  const filterKey = JSON.stringify(state.filters);
  const { reset } = pager;
  useEffect(() => reset(), [filterKey, reset]);

  const search = useSearch({
    q,
    recordType: types,
    transformationId: typeof state.filters["transformationId"] === "string" ? state.filters["transformationId"] : null,
    includeArchived,
    cursor: pager.cursor,
    limit: PAGE_SIZE,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed.length < SEARCH_MIN_LENGTH) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setFilter("q", trimmed);
    setParams({ q: trimmed }, { replace: true });
  };

  const toggleType = (type: SearchRecordType, on: boolean) => {
    const next = on ? [...types, type] : types.filter((x) => x !== type);
    setFilter("recordType", next.length > 0 ? next : null);
  };

  const chips: FilterChip[] = [
    ...(types.length > 0
      ? [
          {
            key: "recordType",
            label: t("productivity.search.filter.recordType"),
            value: types.map((x) => t(`productivity.search.type.${x}`)).join(", "),
            onRemove: () => setFilter("recordType", null),
          },
        ]
      : []),
    ...(includeArchived
      ? [
          {
            key: "includeArchived",
            label: t("productivity.search.filter.archived"),
            value: t("productivity.search.filter.archivedIncluded"),
            onRemove: () => setFilter("includeArchived", null),
          },
        ]
      : []),
  ];

  const data = search.data;
  const terms = useMemo(() => termsOf(q), [q]);

  return (
    <div className="page search-page" data-page="search">
      <PageHeader
        title={t("productivity.search.title")}
        subtitle={t("productivity.search.subtitle")}
        crumbs={[{ label: t("productivity.search.title") }]}
        actions={<HelpPanel screenKey="search" />}
      />
      <form
        className="search-form"
        role="search"
        onSubmit={submit}
        noValidate
        aria-label={t("productivity.search.formLabel")}
      >
        <div className="field">
          <label htmlFor={inputId}>{t("productivity.search.queryLabel")}</label>
          <div className="search-form__row">
            <input
              id={inputId}
              type="search"
              value={draft}
              maxLength={SEARCH_MAX_LENGTH}
              onChange={(e) => {
                setDraft(e.target.value);
                setTooShort(false);
              }}
              aria-invalid={tooShort}
              aria-describedby={tooShort ? errId : undefined}
              data-search-input
            />
            <button type="submit" className="button button--primary">
              {t("productivity.search.submit")}
            </button>
          </div>
          {tooShort ? (
            <p id={errId} className="field__error" role="alert">
              {t("problems.search__query_too_short")}
            </p>
          ) : null}
        </div>
        <fieldset className="search-form__types">
          <legend>{t("productivity.search.filter.recordType")}</legend>
          {SEARCH_RECORD_TYPES.map((type) => (
            <label key={type} className="checkbox">
              <input
                type="checkbox"
                checked={types.includes(type)}
                onChange={(e) => toggleType(type, e.target.checked)}
                data-record-type={type}
              />
              {t(`productivity.search.type.${type}`)}
            </label>
          ))}
        </fieldset>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setFilter("includeArchived", e.target.checked ? "true" : null)}
            data-include-archived
          />
          {t("productivity.search.filter.includeArchived")}
        </label>
      </form>
      <SavedViewBar view={view} label={t("productivity.search.title")} />
      <FilterChips
        chips={chips}
        onClearAll={() => {
          setFilter("recordType", null);
          setFilter("includeArchived", null);
        }}
      />
      <section aria-labelledby={`${inputId}-results`} className="search-results" aria-busy={search.isFetching}>
        <h2 id={`${inputId}-results`} className="visually-hidden">
          {t("productivity.search.results")}
        </h2>
        {q.trim().length < SEARCH_MIN_LENGTH ? (
          <EmptyState title={t("productivity.search.prompt")} body={t("productivity.search.promptBody")} />
        ) : search.isPending ? (
          <LoadingState />
        ) : search.isError && !data ? (
          isNoPermission(search.error) ? (
            <NoPermissionState error={search.error} />
          ) : (
            <ErrorState error={search.error} onRetry={() => void search.refetch()} />
          )
        ) : data ? (
          <>
            {data.stale ? <SearchStale indexedThrough={data.indexedThrough} locale={locale} /> : null}
            {search.isError ? <ErrorState error={search.error} onRetry={() => void search.refetch()} /> : null}
            {data.items.length === 0 ? (
              <div data-state={data.stale ? "empty-stale" : "empty"}>
                <EmptyState
                  title={t("productivity.search.empty", { q })}
                  body={data.stale ? t("productivity.search.emptyStale") : t("productivity.search.emptyBody")}
                />
              </div>
            ) : (
              <ol className="search-results__list" data-results>
                {data.items.map((hit) => (
                  <SearchResult key={`${hit.recordType}:${hit.recordId}`} hit={hit} terms={terms} />
                ))}
              </ol>
            )}
            <Pager
              pageNumber={pager.pageNumber}
              hasPrevious={pager.hasPrevious}
              hasNext={Boolean(data.nextCursor)}
              onPrevious={pager.previous}
              onNext={() => pager.next(data.nextCursor)}
              pageSize={PAGE_SIZE}
              shownCount={data.items.length}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}

/** The designed stale state of a search (ADR-0057 §9): results stay visible; the time is Unknown when absent. */
function SearchStale({ indexedThrough, locale }: { indexedThrough: string | null; locale: "en" | "ar" }) {
  const { t } = useTranslation();
  return (
    <div className="banner banner--warning" role="status" data-state="stale">
      <span className="status-chip status-chip--stale">
        <Icon name="clock" /> {t("common.status.stale")}
      </span>
      <span>
        {t("productivity.search.stale", {
          time: indexedThrough ? formatDateTime(indexedThrough, locale) : t("common.value.unknown"),
        })}
      </span>
    </div>
  );
}

function SearchResult({ hit, terms }: { hit: SearchHit; terms: readonly string[] }) {
  const { t } = useTranslation();
  return (
    <li className="search-hit card" data-hit={hit.recordType} data-record-id={hit.recordId}>
      <p className="search-hit__meta small">
        <span className="status-chip">{t(`productivity.search.type.${hit.recordType}`)}</span>{" "}
        <span>
          <bdi dir="ltr" className="code">
            {hit.transformationCode}
          </bdi>{" "}
          <bdi>{hit.transformationName}</bdi>
        </span>
        {hit.recordStatus ? (
          <>
            {" · "}
            <span data-hit-status>
              {t("productivity.search.status")}: <bdi>{hit.recordStatus}</bdi>
            </span>
          </>
        ) : null}
        {hit.isArchived ? (
          <span className="status-chip" data-hit-archived>
            <Icon name="archive" /> {t("productivity.search.archived")}
          </span>
        ) : null}
      </p>
      <h3 className="search-hit__title">
        <Link to={hitPath(hit)} className="link">
          {hit.code ? (
            <>
              <bdi dir="ltr" className="code">
                {hit.code}
              </bdi>{" "}
            </>
          ) : null}
          <bdi>{highlight(hit.title, terms)}</bdi>
        </Link>
      </h3>
      {hit.summary ? <p className="search-hit__summary">{highlight(hit.summary, terms)}</p> : null}
    </li>
  );
}

/** The words of the query (without the websearch operators), longest first, for highlighting. */
export function termsOf(q: string): string[] {
  return [
    ...new Set(
      q
        .replace(/["()]/g, " ")
        .split(/\s+/)
        .map((w) => w.replace(/^[-+]/, "").trim())
        .filter((w) => w.length >= SEARCH_MIN_LENGTH && w.toLowerCase() !== "or"),
    ),
  ].sort((a, b) => b.length - a.length);
}

/** Splits plain text around the terms (case-insensitive) and marks them; no markup is ever parsed. */
export function highlight(text: string, terms: readonly string[]): ReactNode {
  if (terms.length === 0) return text;
  const escaped = terms.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "giu");
  const parts = text.split(re);
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}
