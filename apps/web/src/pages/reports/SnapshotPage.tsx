// One report snapshot (T-DG5-FE-E; REQ-S13-007, REQ-S13-008, REQ-S13-005, REQ-S13-010; ADR-0045 §2–§5, §8): its content
// as it was at its as-of time, with what it retains (M0254): the reporting period, the source record revisions, the
// methodology and calculation versions, the approval state of the sources and the evidence it cites.
//  - generated: a draft, not an issued report (banner); it can be issued (report.issue: TL, TO, SEC) or discarded with
//    a reason. Its content never changes.
//  - issued: the official issue vN; a reissue is generated from the current records in the same series with a reason,
//    and the issued snapshot stays unchanged until that reissue is issued (then it becomes superseded).
//  - superseded and discarded: kept, read-only, with who and when.
// Exporting is offered in the formats the output supports (ADR-0046), as an asynchronous job with progress.
// Issuing approves nothing: it is not a business approval (ADR-0045 §9).
import type { ReportSnapshot } from "@mth/shared/schemas";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { useUserNames } from "../my-work/p4ui.tsx";
import { ExportForm } from "../exports/ExportForm.tsx";
import {
  reportPaths,
  useReportDefinitions,
  useReportSnapshot,
  useReportsRefresh,
  useSnapshotEvidence,
  useSnapshotSources,
  useSnapshotVersions,
} from "./api.ts";
import { definitionLabel } from "./ReportsPage.tsx";
import {
  ApprovalStateText,
  NoteForm,
  NotAnApprovalNote,
  ReportDocumentView,
  SnapshotStatusChip,
  useRunner,
} from "./ui.tsx";

export function SnapshotPage() {
  const { t } = useTranslation();
  const { id = "", snapshotId = "" } = useParams();
  usePageTitle(t("reportsP5.snapshot.title"));
  const snapshot = useReportSnapshot(id, snapshotId);
  return (
    <div className="page" data-p5-screen="report-snapshot">
      <PageHeader
        title={t("reportsP5.snapshot.title")}
        subtitle={t("reportsP5.snapshot.intro")}
        crumbs={[
          { label: t("reportsP5.reports.title"), to: `/transformations/${id}/reports` },
          { label: t("reportsP5.snapshot.title") },
        ]}
      />
      <QueryState query={snapshot}>{(s) => <SnapshotView tid={id} s={s} />}</QueryState>
    </div>
  );
}

function SnapshotView({ tid, s }: { tid: string; s: ReportSnapshot }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const definitions = useReportDefinitions();
  const def = definitions.data?.items.find((d) => d.code === s.definitionCode);
  const names = useUserNames([s.issuedBy, s.discardedBy, s.createdBy]);
  const mayIssue = canAnywhere(me, "report.issue");
  return (
    <>
      <section className="card" aria-labelledby="snapshot-facts" data-snapshot-status={s.status}>
        <h2 id="snapshot-facts" className="card__title">
          {def ? definitionLabel(def, locale) : s.definitionCode} <SnapshotStatusChip status={s.status} />
        </h2>
        {s.status === "generated" ? (
          <p className="banner banner--warning" role="note" data-state="draft-not-issued">
            {t("reportsP5.snapshot.draftBanner")}
          </p>
        ) : null}
        {s.status === "superseded" ? (
          <p className="banner banner--info" role="note" data-state="superseded">
            {t("reportsP5.snapshot.supersededBanner", { when: formatDateTime(s.supersededAt, locale) ?? "" })}{" "}
            {s.supersededById ? (
              <Link className="link" to={`/transformations/${tid}/reports/${s.supersededById}`}>
                {t("reportsP5.snapshot.openCurrent")}
              </Link>
            ) : null}
          </p>
        ) : null}
        {s.status === "discarded" ? (
          <p className="banner banner--info" role="note" data-state="discarded">
            {t("reportsP5.snapshot.discardedBanner", {
              who: names(s.discardedBy),
              when: formatDateTime(s.discardedAt, locale) ?? "",
            })}{" "}
            {s.discardReason}
          </p>
        ) : null}
        <dl className="workspace-header__grid">
          <dt>{t("reportsP5.field.issueVersion")}</dt>
          <dd data-issue-version={s.issueVersion ?? ""}>
            {s.issueVersion === null ? t("reportsP5.snapshot.notIssued") : <bdi dir="ltr">v{s.issueVersion}</bdi>}
          </dd>
          {s.issuedAt ? (
            <>
              <dt>{t("reportsP5.snapshot.issued")}</dt>
              <dd>
                {names(s.issuedBy)} · {formatDateTime(s.issuedAt, locale)}
                {s.issueNote ? <span className="block small">{s.issueNote}</span> : null}
              </dd>
            </>
          ) : null}
          <dt>{t("reportsP5.snapshot.generated")}</dt>
          <dd>
            {names(s.createdBy)} · {formatDateTime(s.createdAt, locale)}
          </dd>
          {s.reissueOfId ? (
            <>
              <dt>{t("reportsP5.snapshot.reissueOf")}</dt>
              <dd>
                <Link className="link" to={`/transformations/${tid}/reports/${s.reissueOfId}`}>
                  {t("reportsP5.snapshot.previousIssue")}
                </Link>
                {s.reissueReason ? <span className="block small">{s.reissueReason}</span> : null}
              </dd>
            </>
          ) : null}
          <dt>{t("reportsP5.facts.approvalState")}</dt>
          <dd>
            <ApprovalStateText state={s.approvalState} />
          </dd>
          <dt>{t("reportsP5.field.provisional")}</dt>
          <dd data-count="provisional">{s.provisionalValueCount}</dd>
          <dt>{t("reportsP5.field.unknown")}</dt>
          <dd data-count="unknown">{s.unknownValueCount}</dd>
          <dt>{t("reportsP5.snapshot.contentHash")}</dt>
          <dd>
            {/* T-DG5-FE-G2 (QA-C O1): the full SHA-256, one LTR run that wraps inside its card (never overflows in RTL). */}
            <Checksum value={s.contentSha256} />
          </dd>
        </dl>
      </section>
      <NotAnApprovalNote />
      {mayIssue ? <SnapshotActions tid={tid} s={s} /> : null}
      {def ? (
        <Section id="export" title={t("reportsP5.exports.newTitle")} intro={t("reportsP5.exports.newIntro")}>
          <ExportForm
            snapshotId={s.id}
            formats={def.formats}
            draft={s.status === "generated"}
            discarded={s.status === "discarded"}
          />
        </Section>
      ) : null}
      <Section id="content" title={t("reportsP5.snapshot.content")}>
        <ReportDocumentView doc={s.content} headingLevel={3} />
      </Section>
      <RetainedSection tid={tid} snapshotId={s.id} />
    </>
  );
}

/**
 * The actions of the snapshot's current status. One runner and ONE alert for them, kept above the forms: a refusal
 * (e.g. 409 or 422 because the snapshot was issued meanwhile) reloads the snapshot, which changes the offered form, and
 * the translated refusal must stay visible after that reload.
 */
function SnapshotActions({ tid, s }: { tid: string; s: ReportSnapshot }) {
  const { t } = useTranslation();
  const navigate = useSessionNavigate();
  const refresh = useReportsRefresh();
  const runner = useRunner(refresh);
  return (
    <div data-snapshot-actions={s.status}>
      {runner.alert}
      {s.status === "generated" ? (
        <>
          <Section id="issue" title={t("reportsP5.snapshot.issueTitle")} intro={t("reportsP5.snapshot.issueIntro")}>
            <NoteForm
              id="issue-snapshot"
              label={t("reportsP5.snapshot.issueNote")}
              submitLabel={t("reportsP5.snapshot.issue")}
              required={false}
              busy={runner.busy}
              onSubmit={(note) =>
                void runner.run(reportPaths.issue(tid, s.id), { body: note ? { note } : {}, ifMatch: s.version })
              }
            />
          </Section>
          <Section
            id="discard"
            title={t("reportsP5.snapshot.discardTitle")}
            intro={t("reportsP5.snapshot.discardIntro")}
          >
            <NoteForm
              id="discard-snapshot"
              label={t("reportsP5.field.reason")}
              submitLabel={t("reportsP5.snapshot.discard")}
              required
              min={3}
              busy={runner.busy}
              danger
              onSubmit={(reason) =>
                void runner.run(reportPaths.discard(tid, s.id), { body: { reason }, ifMatch: s.version })
              }
            />
          </Section>
        </>
      ) : null}
      {s.status === "issued" ? (
        <Section id="reissue" title={t("reportsP5.snapshot.reissueTitle")} intro={t("reportsP5.snapshot.reissueIntro")}>
          <NoteForm
            id="reissue-snapshot"
            label={t("reportsP5.field.reason")}
            submitLabel={t("reportsP5.snapshot.reissue")}
            required
            min={3}
            busy={runner.busy}
            onSubmit={(reason) =>
              void runner
                .run<ReportSnapshot>(reportPaths.reissue(tid, s.id), { body: { reason }, ifMatch: s.version })
                .then((r) => {
                  if (r) navigate(`/transformations/${tid}/reports/${r.id}`);
                })
            }
          />
        </Section>
      ) : null}
    </div>
  );
}

function RetainedSection({ tid, snapshotId }: { tid: string; snapshotId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const sources = useSnapshotSources(tid, snapshotId);
  const versions = useSnapshotVersions(tid, snapshotId);
  const evidence = useSnapshotEvidence(tid, snapshotId);
  return (
    <>
      <Section
        id="versions"
        title={t("reportsP5.retained.versionsTitle")}
        intro={t("reportsP5.retained.versionsIntro")}
      >
        <QueryState
          query={versions}
          isEmpty={(v) => v.items.length === 0}
          empty={<p className="muted">{t("reportsP5.noRecords")}</p>}
        >
          {(v) => (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("reportsP5.retained.versionsTitle")}>
              <table className="table" data-table="snapshot-versions">
                <caption className="visually-hidden">{t("reportsP5.retained.versionsTitle")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("reportsP5.retained.kind")}</th>
                    <th scope="col">{t("reportsP5.retained.reference")}</th>
                    <th scope="col">{t("reportsP5.retained.version")}</th>
                  </tr>
                </thead>
                <tbody>
                  {v.items.map((x, i) => (
                    <tr key={`${x.versionKind}-${x.referenceKey}-${i}`} data-version-kind={x.versionKind}>
                      <td>{t(`reportsP5.versionKind.${x.versionKind}`)}</td>
                      <td>
                        <bdi dir="ltr" className="code">
                          {x.referenceKey}
                        </bdi>
                      </td>
                      <td>
                        <bdi dir="ltr">{x.versionLabel}</bdi>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Section>
      <Section id="sources" title={t("reportsP5.retained.sourcesTitle")} intro={t("reportsP5.retained.sourcesIntro")}>
        <QueryState
          query={sources}
          isEmpty={(v) => v.length === 0}
          empty={<p className="muted">{t("reportsP5.noRecords")}</p>}
        >
          {(items) => (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("reportsP5.retained.sourcesTitle")}>
              <table className="table" data-table="snapshot-sources">
                <caption className="visually-hidden">{t("reportsP5.retained.sourcesTitle")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("reportsP5.retained.section")}</th>
                    <th scope="col">{t("reportsP5.retained.recordType")}</th>
                    <th scope="col">{t("reportsP5.retained.revision")}</th>
                    <th scope="col">{t("reportsP5.retained.updatedAt")}</th>
                    <th scope="col">{t("reportsP5.facts.approvalState")}</th>
                    <th scope="col">{t("reportsP5.retained.validation")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((x) => (
                    <tr key={x.id} data-source-record={x.recordId}>
                      <td data-section-key={x.sectionKey}>
                        <CodeLabel ns="sourceSection" code={x.sectionKey} />
                      </td>
                      <td data-record-type={x.recordType}>
                        <CodeLabel ns="sourceRecordType" code={x.recordType} />
                      </td>
                      <td>
                        <bdi dir="ltr">v{x.recordVersion}</bdi>
                      </td>
                      <td>{formatDateTime(x.recordUpdatedAt, locale) ?? t("reportsP5.notStated")}</td>
                      <td>
                        {x.approvalState ? (
                          <ApprovalStateText state={x.approvalState} />
                        ) : (
                          t("reportsP5.approvalState.not_applicable")
                        )}
                      </td>
                      <td>{t(`reportsP5.validation.${x.validationState}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Section>
      <Section
        id="cited-evidence"
        title={t("reportsP5.retained.evidenceTitle")}
        intro={t("reportsP5.retained.evidenceIntro")}
      >
        <QueryState
          query={evidence}
          isEmpty={(v) => v.length === 0}
          empty={<EmptyState title={t("reportsP5.retained.noEvidence")} />}
        >
          {(items) => (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("reportsP5.retained.evidenceTitle")}>
              <table className="table" data-table="snapshot-evidence">
                <caption className="visually-hidden">{t("reportsP5.retained.evidenceTitle")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("reportsP5.retained.section")}</th>
                    <th scope="col">{t("reportsP5.evidence.version")}</th>
                    <th scope="col">{t("reportsP5.evidence.checksum")}</th>
                    <th scope="col">{t("reportsP5.evidence.reviewStatus")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((x) => (
                    <tr key={`${x.sectionKey}-${x.evidenceId}`} data-evidence={x.evidenceId}>
                      <td>
                        <bdi dir="ltr" className="code">
                          {x.sectionKey}
                        </bdi>
                      </td>
                      <td>{x.contentRevision === null ? t("reportsP5.notApplicable") : `v${x.contentRevision}`}</td>
                      <td>
                        {x.contentSha256 ? <Checksum value={x.contentSha256} /> : t("reportsP5.evidence.noChecksum")}
                      </td>
                      <td>{t(`reportsP5.reviewStatus.${x.reviewStatus}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </Section>
    </>
  );
}

/**
 * A SHA-256 checksum (T-DG5-FE-G2; QA-C O1): the full value as one left-to-right run that may break anywhere, so it
 * wraps inside its card or cell in Arabic too; the full value is also the title and `data-sha256`.
 */
export function Checksum({ value }: { value: string }) {
  return (
    <bdi
      dir="ltr"
      className="code small"
      data-sha256={value}
      title={value}
      style={{ overflowWrap: "anywhere", wordBreak: "break-all" }}
    >
      {value}
    </bdi>
  );
}

/**
 * The translated label of a snapshot source's section key or record type (T-DG5-FE-G2; QA-C O1), in en and ar. A
 * record type falls back to the evidence register's labels; a code with no label is shown as the code itself, in an LTR
 * run, never guessed.
 */
export function CodeLabel({ ns, code }: { ns: "sourceSection" | "sourceRecordType"; code: string }) {
  const { t } = useTranslation();
  const label =
    t(`reportsP5.${ns}.${code}`, { defaultValue: "" }) ||
    (ns === "sourceRecordType" ? t(`evidence.recordTypes.${code}`, { defaultValue: "" }) : "");
  return label ? (
    <span>{label}</span>
  ) : (
    <bdi dir="ltr" className="code">
      {code}
    </bdi>
  );
}
