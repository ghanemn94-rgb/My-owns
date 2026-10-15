// Playbook Studio home (T-DG5-FE-B; REQ-S06-004, REQ-S06-007, REQ-PB-093; ADR-0039 §1, §4, §10): every configuration
// version of every kind with its state, filterable, sortable and paged, with column selection; "New draft" copies a
// published version (one open draft per kind and key, 409 config_version.draft_exists). Methodology administrators
// edit drafts; everyone with methodology.read sees the versions read-only (AUD, TO, TL, SP). A Studio version is
// configuration, never a business approval.
import { createColumnHelper, type SortingState } from "@tanstack/react-table";
import { CONFIG_KINDS, CONFIG_VERSION_STATUSES, type ConfigKind } from "@mth/shared/schemas";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { p5Paths, useConfigVersions, useStudioRefresh } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { ColumnPicker, DataTable, Pager, usePersistentVisibility } from "../../components/DataTable.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { P4FormDialog, ReadOnlyNote, textOf, type P4Values } from "../my-work/p4ui.tsx";
import { STUDIO_NS, versionState, type ConfigVersion } from "./api.ts";
import { ConfigurationNote, VersionStateChip } from "./ui.tsx";

const PAGE_SIZES = 25;

/** Client-side sort of the version list (the list operation has no sort parameter). */
export function sortVersions(rows: readonly ConfigVersion[], sorting: SortingState): ConfigVersion[] {
  const s = sorting[0] ?? { id: "createdAt", desc: true };
  const value = (v: ConfigVersion): string | number =>
    s.id === "versionNo" ? v.versionNo : s.id === "kind" ? `${v.configKind}/${v.key}` : v.createdAt;
  return [...rows].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    return s.desc ? -c : c;
  });
}

export function StudioPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("nav.p5.studio.title"));
  const canEdit = canAnywhere(me, "methodology.configure");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const query = useMemo(
    () => ({ ...(kind ? { kind } : {}), ...(status ? { status } : {}) }) as Record<string, string>,
    [kind, status],
  );
  const versions = useConfigVersions(query);
  const published = useConfigVersions({ status: "published" }, canEdit);
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [visibility, setVisibility] = usePersistentVisibility("studio-versions");
  const [pageNo, setPageNo] = useState(1);
  const [creating, setCreating] = useState(false);
  const refresh = useStudioRefresh();
  const begin = useSessionBoundAction();

  const col = createColumnHelper<ConfigVersion>();
  const columns = [
    col.accessor((v) => v.titleEn, {
      id: "title",
      header: t("studio.field.title"),
      enableSorting: false,
      cell: (c) => (
        <Link className="link" to={`/admin/studio/versions/${c.row.original.id}`}>
          {locale === "ar" ? c.row.original.titleAr : c.row.original.titleEn}
        </Link>
      ),
    }),
    col.accessor("configKind", {
      id: "kind",
      header: t("studio.field.kind"),
      cell: (c) => t(`studio.kind.${c.getValue()}`),
    }),
    col.accessor("versionNo", {
      id: "versionNo",
      header: t("studio.field.versionNo"),
      cell: (c) => <bdi dir="ltr">v{c.getValue()}</bdi>,
    }),
    col.display({
      id: "state",
      header: t("studio.field.state"),
      cell: (c) => <VersionStateChip state={versionState(c.row.original)} />,
    }),
    col.accessor("origin", {
      id: "origin",
      header: t("studio.field.origin"),
      enableSorting: false,
      cell: (c) => t(`studio.origin.${c.getValue()}`),
    }),
    col.accessor("createdAt", {
      id: "createdAt",
      header: t("studio.field.createdAt"),
      cell: (c) => formatDateTime(c.getValue(), locale),
    }),
  ];

  const createFields = (rows: readonly ConfigVersion[]) => [
    {
      name: "basedOnVersionId",
      label: t("studio.create.base"),
      hint: t("studio.create.baseHint"),
      kind: "select" as const,
      required: true,
      options: rows.map((v) => ({
        value: v.id,
        label: `${t(`studio.kind.${v.configKind}`)} · v${v.versionNo} · ${locale === "ar" ? v.titleAr : v.titleEn}`,
      })),
    },
    { name: "titleEn", label: t("studio.field.titleEn"), kind: "text" as const, max: 200, ltr: true },
    { name: "titleAr", label: t("studio.field.titleAr"), kind: "text" as const, max: 200 },
    { name: "changeSummary", label: t("studio.field.changeSummary"), kind: "textarea" as const, max: 4000 },
  ];

  return (
    <div className="page" data-p5-screen="studio">
      <PageHeader
        title={t("nav.p5.studio.title")}
        subtitle={t("nav.p5.studio.summary")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("nav.p5.studio.title") }]}
        actions={
          canEdit ? (
            <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
              {t("studio.create.action")}
            </button>
          ) : null
        }
      />
      <ConfigurationNote />
      {!canEdit ? <ReadOnlyNote body={t("studio.readOnly")} /> : null}
      <nav aria-label={t("studio.links.label")} className="card">
        <ul className="plain-list inline-list">
          <li>
            <Link className="link" to="/admin/studio/scoring-defaults">
              {t("studio.defaults.title")}
            </Link>
          </li>
          <li>
            <Link className="link" to="/admin/studio/review-policies">
              {t("studio.policies.title")}
            </Link>
          </li>
          <li>
            <Link className="link" to="/admin/studio/revision-proposals">
              {t("studio.proposals.title")}
            </Link>
          </li>
          <li>
            <Link className="link" to="/admin/source-coverage">
              {t("nav.sub.sourceCoverage")}
            </Link>
          </li>
          <li>
            <Link className="link" to="/admin/methodology-migrations">
              {t("nav.sub.methodologyMigrations")}
            </Link>
          </li>
        </ul>
      </nav>
      <section className="card" aria-labelledby="studio-versions">
        <h2 id="studio-versions" className="card__title">
          {t("studio.versions.title")}
        </h2>
        <div className="toolbar">
          <label>
            {t("studio.field.kind")}{" "}
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setPageNo(1);
              }}
            >
              <option value="">{t("studio.filter.all")}</option>
              {CONFIG_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`studio.kind.${k}`)}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            {t("studio.field.status")}{" "}
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPageNo(1);
              }}
            >
              <option value="">{t("studio.filter.all")}</option>
              {CONFIG_VERSION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`studio.status.${s}`)}
                </option>
              ))}
            </select>
          </label>{" "}
          <ColumnPicker
            columns={[
              { id: "title", label: t("studio.field.title"), hideable: false },
              { id: "kind", label: t("studio.field.kind") },
              { id: "versionNo", label: t("studio.field.versionNo") },
              { id: "state", label: t("studio.field.state") },
              { id: "origin", label: t("studio.field.origin") },
              { id: "createdAt", label: t("studio.field.createdAt") },
            ]}
            visibility={visibility}
            onChange={setVisibility}
          />
        </div>
        <QueryState
          query={versions}
          isEmpty={(rows) => rows.length === 0}
          empty={<EmptyState title={t("studio.versions.empty")} />}
        >
          {(rows) => {
            const sorted = sortVersions(rows, sorting);
            const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZES));
            const current = Math.min(pageNo, pages);
            const shown = sorted.slice((current - 1) * PAGE_SIZES, current * PAGE_SIZES);
            return (
              <>
                <DataTable
                  caption={t("studio.versions.title")}
                  data={shown}
                  columns={columns}
                  getRowId={(v) => v.id}
                  sorting={sorting}
                  onSortingChange={setSorting}
                  columnVisibility={visibility}
                  onColumnVisibilityChange={setVisibility}
                />
                <Pager
                  pageNumber={current}
                  hasPrevious={current > 1}
                  hasNext={current < pages}
                  onPrevious={() => setPageNo(current - 1)}
                  onNext={() => setPageNo(current + 1)}
                  pageSize={PAGE_SIZES}
                  shownCount={shown.length}
                />
              </>
            );
          }}
        </QueryState>
      </section>
      {creating ? (
        <P4FormDialog
          title={t("studio.create.title")}
          description={t("studio.create.body")}
          fields={createFields(published.data ?? [])}
          submitLabel={t("studio.create.submit")}
          url={p5Paths.configVersions}
          namespaces={STUDIO_NS}
          toBody={(v: P4Values) => ({
            basedOnVersionId: v["basedOnVersionId"],
            ...(textOf(v["titleEn"]) ? { titleEn: v["titleEn"] } : {}),
            ...(textOf(v["titleAr"]) ? { titleAr: v["titleAr"] } : {}),
            ...(textOf(v["changeSummary"]) ? { changeSummary: v["changeSummary"] } : {}),
          })}
          onDone={async (result) => {
            const action = begin();
            if (!(await refresh())) return false;
            const created = result as ConfigVersion | null;
            if (created?.id) action.navigate(`/admin/studio/versions/${created.id}`);
            return true;
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

/** The kinds the Studio lists (re-exported for tests). */
export const STUDIO_KINDS: readonly ConfigKind[] = CONFIG_KINDS;
