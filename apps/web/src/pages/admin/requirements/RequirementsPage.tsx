// Administration > Requirement register (T-DG7-FE-C; p7-work-split §I.2, §I.3; ADR-0071 §3; REQ-S02-003).
//  - Read-only: listRequirements and getRequirement only (operations.read; the server decides, G2). No form posts and no
//    write exists for the register in the product (REQ-S02-003 "edit: none in-app").
//  - The four filters (class, status, area, final gate) are kept in the URL query (`?class=&status=&area=&finalGate=`)
//    and sent as the operation's query parameters. A value outside the contract's set is ignored, never sent. A new
//    filter starts the cursor again, because the API binds a cursor to its filters (G3: a reused cursor is a 400).
//  - The detail panel (`/admin/requirements/:reqId`) shows every column of the row verbatim, keeping the filters.
//  - A 503 `release.register_snapshot_unavailable` shows `register.unavailable`, never the empty text (G4).
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import {
  REQUIREMENT_CLASSES,
  REQUIREMENT_STATUSES,
  useRequirement,
  useRequirements,
  type P7Query,
} from "../../../api/p7.ts";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { adminCrumbs, CursorPagerControls, useCursorPager } from "../security/shared.tsx";
import {
  EnglishOnlyNote,
  NotEngineeringApprovalNote,
  RegisterQueryState,
  RegisterText,
  ReqId,
  SnapshotLine,
  StatusChip,
  type Requirement,
  type RequirementPage,
  type RequirementSummary,
} from "./ui.tsx";

export const REQUIREMENTS_PATH = "/admin/requirements";

/** `RequirementArea` (contract pattern `^(PB|DLV|S(0[1-9]|1[0-9]|2[01]))$`), in register order. */
export const REQUIREMENT_AREAS: readonly string[] = [
  "PB",
  "DLV",
  ...Array.from({ length: 21 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`),
];
/** `finalGate` (contract pattern `^DG[0-7]$`): the register's own column values. */
export const REQUIREMENT_FINAL_GATES: readonly string[] = Array.from({ length: 8 }, (_, i) => `DG${i}`);

/** The filters, their query parameter names and their allowed values (the contract's sets). */
export const REQUIREMENT_FILTERS = [
  { param: "class", values: REQUIREMENT_CLASSES as readonly string[] },
  { param: "status", values: REQUIREMENT_STATUSES as readonly string[] },
  { param: "area", values: REQUIREMENT_AREAS },
  { param: "finalGate", values: REQUIREMENT_FINAL_GATES },
] as const;
type FilterParam = (typeof REQUIREMENT_FILTERS)[number]["param"];

/** The URL query -> the listRequirements query: only the four filters, only valid values, in a fixed order. */
export function requirementQuery(search: URLSearchParams): P7Query {
  const query: P7Query = {};
  for (const f of REQUIREMENT_FILTERS) {
    const v = search.get(f.param);
    if (v && f.values.includes(v)) query[f.param] = v;
  }
  return query;
}

const detailPath = (reqId: string, search: string) =>
  `${REQUIREMENTS_PATH}/${encodeURIComponent(reqId)}${search ? `?${search}` : ""}`;

function filterOptionLabel(t: (k: string) => string, param: FilterParam, value: string): string {
  if (param === "class") return t(`release.register.class.${value}`);
  if (param === "status") return t(`release.status.${value}`);
  return value; // area and final gate are the register's own codes
}

function Filters({ query }: { query: P7Query }) {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const set = (param: FilterParam, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(param, value);
    else next.delete(param);
    setSearch(next, { replace: true });
  };
  const any = Object.keys(query).length > 0;
  return (
    <fieldset className="filters" data-p7-filters="requirements">
      <legend className="visually-hidden">{t("release.register.filter.legend")}</legend>
      <div className="form__row" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3, 12px)" }}>
        {REQUIREMENT_FILTERS.map((f) => (
          <div className="field" key={f.param}>
            <label className="field__label" htmlFor={`req-filter-${f.param}`}>
              {t(`release.register.filter.${f.param}`)}
            </label>
            <select
              id={`req-filter-${f.param}`}
              name={f.param}
              value={query[f.param] ?? ""}
              onChange={(e) => set(f.param, e.target.value)}
            >
              <option value="">{t("release.register.filter.all")}</option>
              {f.values.map((v) => (
                <option key={v} value={v}>
                  {filterOptionLabel(t, f.param, v)}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {any ? (
        <button
          type="button"
          className="button button--secondary"
          onClick={() => {
            const next = new URLSearchParams(search);
            for (const f of REQUIREMENT_FILTERS) next.delete(f.param);
            setSearch(next, { replace: true });
          }}
        >
          {t("release.register.filter.clear")}
        </button>
      ) : null}
    </fieldset>
  );
}

/** One filter combination's list; remounted (key) when the filters change, so its cursor starts again (G3). */
function RequirementList({ query }: { query: P7Query }) {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const pager = useCursorPager();
  const list = useRequirements<RequirementSummary>(query, pager.cursor);
  const keep = search.toString();
  const columns: RegisterColumn<RequirementSummary>[] = [
    {
      id: "id",
      header: t("release.register.col.id"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <Link
          className="link"
          to={detailPath(r.reqId, keep)}
          aria-label={t("release.register.detail.open", { reqId: r.reqId })}
        >
          <ReqId>{r.reqId}</ReqId>
        </Link>
      ),
      sortValue: (r) => r.reqId,
      filterText: (r) => r.reqId,
    },
    {
      id: "class",
      header: t("release.register.filter.class"),
      cell: (r) => t(`release.register.class.${r.class}`, { defaultValue: r.class }),
      sortValue: (r) => r.class,
    },
    {
      id: "title",
      header: t("release.register.col.title"),
      cell: (r) => <RegisterText inline>{r.title}</RegisterText>,
      sortValue: (r) => r.title,
      filterText: (r) => r.title,
    },
    {
      id: "status",
      header: t("release.register.filter.status"),
      cell: (r) => <StatusChip status={r.status} />,
      sortValue: (r) => r.status,
    },
    {
      id: "finalGate",
      header: t("release.register.filter.finalGate"),
      cell: (r) => <bdi dir="ltr">{r.finalGate}</bdi>,
      sortValue: (r) => r.finalGate,
    },
    {
      id: "area",
      header: t("release.register.filter.area"),
      cell: (r) => <bdi dir="ltr">{r.area}</bdi>,
      sortValue: (r) => r.area,
    },
    {
      id: "increments",
      header: t("release.register.col.increments"),
      cell: (r) => <bdi dir="ltr">{r.increments}</bdi>,
      sortValue: (r) => r.increments,
    },
  ];
  return (
    <RegisterQueryState query={list}>
      {(body) => {
        // The contract's RequirementPage: the shared page shape plus the snapshot identity.
        const page = body as RequirementPage;
        return (
          <>
            <SnapshotLine snapshot={page.snapshot} />
            <RegisterTable
              id="p7-requirements"
              caption={t("release.register.listTitle")}
              rows={page.items}
              columns={columns}
              getRowId={(r) => r.reqId}
              emptyTitle={t("release.register.empty")}
              pageSize={100}
            />
            <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={list.isFetching} />
          </>
        );
      }}
    </RegisterQueryState>
  );
}

const DETAIL_FIELDS = [
  "sourceRef",
  "sourceHeading",
  "templateId",
  "inputFields",
  "procedure",
  "output",
  "ownerRoles",
  "permissions",
  "automation",
  "screenApi",
  "acceptance",
  "evidence",
  "notes",
] as const;

/** The detail panel: every column of the row, verbatim, as plain text. */
function RequirementDetail({ reqId }: { reqId: string }) {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const requirement = useRequirement<Requirement>(reqId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // Keyboard and screen-reader users land on the panel they opened.
    headingRef.current?.focus();
  }, [reqId]);
  const keep = search.toString();
  return (
    <section className="section" aria-labelledby="requirement-detail-title" data-p7-detail="requirement">
      <h2 id="requirement-detail-title" ref={headingRef} tabIndex={-1} className="section__title">
        {t("release.register.detail.title", { reqId: "" })}
        <ReqId>{reqId}</ReqId>
      </h2>
      <p>
        <Link className="link" to={`${REQUIREMENTS_PATH}${keep ? `?${keep}` : ""}`}>
          {t("release.register.detail.close")}
        </Link>
      </p>
      <RegisterQueryState query={requirement}>
        {(r) => (
          <dl className="workspace-header__grid" data-requirement={r.reqId}>
            <dt>{t("release.register.col.title")}</dt>
            <dd>
              <RegisterText showEmpty>{r.title}</RegisterText>
            </dd>
            <dt>{t("release.register.filter.status")}</dt>
            <dd>
              <StatusChip status={r.status} />
            </dd>
            <dt>{t("release.register.filter.class")}</dt>
            <dd>{t(`release.register.class.${r.class}`, { defaultValue: r.class })}</dd>
            <dt>{t("release.register.filter.area")}</dt>
            <dd>
              <bdi dir="ltr">{r.area}</bdi>
            </dd>
            <dt>{t("release.register.filter.finalGate")}</dt>
            <dd>
              <bdi dir="ltr">{r.finalGate}</bdi>
            </dd>
            <dt>{t("release.register.col.increments")}</dt>
            <dd>
              <RegisterText showEmpty>{r.increments}</RegisterText>
            </dd>
            {DETAIL_FIELDS.map((f) => (
              <div key={f} style={{ display: "contents" }} data-field={f}>
                <dt>{t(`release.register.detail.${f}`)}</dt>
                <dd>
                  <RegisterText showEmpty>{r[f]}</RegisterText>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </RegisterQueryState>
    </section>
  );
}

export function RequirementsPage() {
  const { t } = useTranslation();
  const { reqId } = useParams();
  const [search] = useSearchParams();
  const query = requirementQuery(search);
  const title = t("release.register.title");
  usePageTitle(reqId ? `${reqId} · ${title}` : title);
  return (
    <div className="page" data-p7-screen="requirements">
      <PageHeader
        title={title}
        subtitle={t("release.register.intro")}
        crumbs={adminCrumbs(t, reqId ? { label: title, to: REQUIREMENTS_PATH } : { label: title })}
      />
      <NotEngineeringApprovalNote />
      <EnglishOnlyNote />
      {reqId ? <RequirementDetail key={reqId} reqId={reqId} /> : null}
      <Section id="requirements" title={t("release.register.listTitle")}>
        <Filters query={query} />
        <RequirementList key={JSON.stringify(query)} query={query} />
      </Section>
    </div>
  );
}
