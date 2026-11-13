// Administration > About this release (T-DG7-FE-C; p7-work-split §I.2, §I.3; ADR-0071 §4; REQ-S02-005, REQ-S21-003).
//  - Read-only: getReleaseAbout only (operations.read; the server decides, G2).
//  - Every `null` is shown as a text, never as 0, an empty table or a success colour (§I.7):
//      register, statusCounts, openItems, laterClauses null -> "Unavailable" (the build's register snapshot is missing);
//      externalDependencies null -> "Unknown: this build did not include the list." (never "none");
//      appVersion or contractVersion "unknown" -> "Unavailable".
//  - Only `openItems: []` shows "Every requirement of this release is implemented."; `laterClauses: []` and
//    `externalDependencies: []` have their own "none" texts.
//  - Unfinished items are listed as such, each with its status and its missing dependency (the register notes,
//    verbatim, left to right): no planned feature is labelled delivered (REQ-S02-005).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { REQUIREMENT_STATUSES, useReleaseAbout } from "../../../api/p7.ts";
import { useLocale } from "../../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { TableScrollRegion } from "../../../components/TableScrollRegion.tsx";
import { QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { formatCount } from "../migration/ui.tsx";
import { REQUIREMENTS_PATH } from "../requirements/RequirementsPage.tsx";
import {
  DEPENDENCY_STATUS_CHIPS,
  EnglishOnlyNote,
  NotEngineeringApprovalNote,
  RegisterText,
  ReleaseChip,
  ReqId,
  SnapshotLine,
  StatusChip,
  UnavailableChip,
  type ExternalDependency,
  type ReleaseAbout,
  type ReleaseOpenItem,
} from "../requirements/ui.tsx";
import { adminCrumbs } from "../security/shared.tsx";

/** A version string; the API's `unknown` (it could not read it) is "Unavailable". */
function Version({ value }: { value: string }) {
  if (!value || value === "unknown") return <UnavailableChip />;
  return <bdi dir="ltr">{value}</bdi>;
}

/** A state line in a section: the unknown, unavailable or "none" text, with its own marker for tests and readers. */
function StateLine({ state, children }: { state: string; children: ReactNode }) {
  return (
    <p className="state__body" data-state={state}>
      {children}
    </p>
  );
}

function StatusCounts({ counts }: { counts: ReleaseAbout["statusCounts"] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (counts === null) return <UnavailableChip />;
  const total = REQUIREMENT_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  return (
    <TableScrollRegion caption={t("release.about.counts")}>
      <table className="table" data-p7-counts="">
        <caption className="visually-hidden">{t("release.about.counts")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("release.register.filter.status")}</th>
            <th scope="col">{t("release.about.count")}</th>
          </tr>
        </thead>
        <tbody>
          {REQUIREMENT_STATUSES.map((s) => (
            <tr key={s} data-status={s}>
              <th scope="row">
                <StatusChip status={s} />
              </th>
              <td data-count={counts[s]}>{formatCount(counts[s], locale) ?? <UnavailableChip />}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t("release.about.total")}</th>
            <td data-count={total}>{formatCount(total, locale) ?? <UnavailableChip />}</td>
          </tr>
        </tfoot>
      </table>
    </TableScrollRegion>
  );
}

function OpenItemTable({
  id,
  caption,
  notesHeader,
  rows,
  emptyTitle,
}: {
  id: string;
  caption: string;
  notesHeader: string;
  rows: ReleaseOpenItem[];
  emptyTitle: string;
}) {
  const { t } = useTranslation();
  const columns: RegisterColumn<ReleaseOpenItem>[] = [
    {
      id: "id",
      header: t("release.register.col.id"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <Link className="link" to={`${REQUIREMENTS_PATH}/${encodeURIComponent(r.reqId)}`}>
          <ReqId>{r.reqId}</ReqId>
        </Link>
      ),
      sortValue: (r) => r.reqId,
      filterText: (r) => r.reqId,
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
      id: "notes",
      header: notesHeader,
      cell: (r) => <RegisterText showEmpty>{r.notes}</RegisterText>,
      filterText: (r) => r.notes,
    },
  ];
  return (
    <RegisterTable
      id={id}
      caption={caption}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.reqId}
      emptyTitle={emptyTitle}
      pageSize={25}
    />
  );
}

function DependencyTable({ rows }: { rows: ExternalDependency[] }) {
  const { t } = useTranslation();
  const columns: RegisterColumn<ExternalDependency>[] = [
    {
      id: "title",
      header: t("release.about.dependency.title"),
      rowHeader: true,
      hideable: false,
      cell: (d) => <RegisterText inline>{d.title}</RegisterText>,
      sortValue: (d) => d.title,
      filterText: (d) => d.title,
    },
    {
      id: "owner",
      header: t("release.about.dependency.owner"),
      cell: (d) => <RegisterText inline>{d.owner}</RegisterText>,
      sortValue: (d) => d.owner,
    },
    {
      id: "status",
      header: t("release.about.dependency.status"),
      cell: (d) => (
        <ReleaseChip value={d.status} table={DEPENDENCY_STATUS_CHIPS} labelKey="release.about.dependency.state" />
      ),
      sortValue: (d) => d.status,
    },
    {
      id: "key",
      header: t("release.about.dependency.key"),
      cell: (d) => (
        <bdi dir="ltr" className="code">
          {d.key}
        </bdi>
      ),
      sortValue: (d) => d.key,
    },
  ];
  return (
    <RegisterTable
      id="p7-external-dependencies"
      caption={t("release.about.externalDependencies")}
      rows={rows}
      columns={columns}
      getRowId={(d) => d.key}
      emptyTitle={t("release.about.externalDependenciesNone")}
      pageSize={25}
    />
  );
}

function AboutContent({ about }: { about: ReleaseAbout }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <>
      <Section id="release-versions" title={t("release.about.versions")}>
        <dl className="workspace-header__grid">
          <dt>{t("release.about.appVersion")}</dt>
          <dd data-field="appVersion">
            <Version value={about.appVersion} />
          </dd>
          <dt>{t("release.about.contractVersion")}</dt>
          <dd data-field="contractVersion">
            <Version value={about.contractVersion} />
          </dd>
          <dt>{t("release.register.title")}</dt>
          <dd data-field="register">
            <SnapshotLine snapshot={about.register} />
          </dd>
          <dt>{t("release.about.checkedAt")}</dt>
          <dd data-field="checkedAt">{formatDateTime(about.checkedAt, locale) ?? <UnavailableChip />}</dd>
        </dl>
      </Section>
      <Section id="release-counts" title={t("release.about.counts")}>
        <StatusCounts counts={about.statusCounts} />
      </Section>
      <Section id="release-open-items" title={t("release.about.openItems.title")}>
        {about.openItems === null ? (
          <UnavailableChip />
        ) : about.openItems.length === 0 ? (
          <StateLine state="open-items-none">{t("release.about.openItems.none")}</StateLine>
        ) : (
          <OpenItemTable
            id="p7-open-items"
            caption={t("release.about.openItems.title")}
            notesHeader={t("release.about.openItems.dependency")}
            rows={about.openItems}
            emptyTitle={t("release.register.empty")}
          />
        )}
      </Section>
      <Section id="release-later-clauses" title={t("release.about.laterClauses")}>
        {about.laterClauses === null ? (
          <UnavailableChip />
        ) : about.laterClauses.length === 0 ? (
          <StateLine state="later-clauses-none">{t("release.about.laterClausesNone")}</StateLine>
        ) : (
          <OpenItemTable
            id="p7-later-clauses"
            caption={t("release.about.laterClauses")}
            notesHeader={t("release.about.laterClause")}
            rows={about.laterClauses}
            emptyTitle={t("release.register.empty")}
          />
        )}
      </Section>
      <Section id="release-external-dependencies" title={t("release.about.externalDependencies")}>
        {about.externalDependencies === null ? (
          <StateLine state="dependencies-unknown">{t("release.about.unknown")}</StateLine>
        ) : about.externalDependencies.length === 0 ? (
          <StateLine state="dependencies-none">{t("release.about.externalDependenciesNone")}</StateLine>
        ) : (
          <DependencyTable rows={about.externalDependencies} />
        )}
      </Section>
    </>
  );
}

export function AboutReleasePage() {
  const { t } = useTranslation();
  const title = t("release.about.title");
  usePageTitle(title);
  const about = useReleaseAbout<ReleaseAbout>();
  return (
    <div className="page" data-p7-screen="release-about">
      <PageHeader title={title} crumbs={adminCrumbs(t, { label: title })} />
      <NotEngineeringApprovalNote />
      <EnglishOnlyNote />
      <QueryState query={about}>{(a) => <AboutContent about={a} />}</QueryState>
    </div>
  );
}
