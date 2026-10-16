// Presentation mode of a meeting (T-DG5-FE-E; REQ-S10-013; ADR-0045 §7; M0212): the meeting pack, read-only.
//  - Live: assembled now from the agenda items, their linked decision briefs and asks and the meeting's actions; a linked
//    decision changed before cut-off appears changed here.
//  - A pack snapshot: the stored content of one of THIS meeting's meeting-pack snapshots, unchanged whatever happened
//    since (a snapshot of another meeting is refused: 422 presentation.snapshot_mismatch).
// The printable pack is that snapshot, issued like any report and exported as PDF or PPTX: the same assembler over the
// same records, with no separately editable copy. Nothing here can be edited.
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import type { ReportSnapshot } from "@mth/shared/schemas";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { useMeetings } from "../meetings/api.ts";
import { reportPaths, useMeetingPresentation, useReportSnapshots, useReportsRefresh } from "../reports/api.ts";
import { ReportDocumentView, SnapshotStatusChip, TransformationEntry, useRunner } from "../reports/ui.tsx";

/** Evidence and Reports > Presentation mode: choose the transformation. */
export function PresentationEntryPage() {
  const { t } = useTranslation();
  return (
    <TransformationEntry
      screen="presentation"
      title={t("reportsP5.presentation.title")}
      summary={t("reportsP5.presentation.entryIntro")}
      area={{ label: t("nav.areas.evidence.label"), to: "/evidence-reports" }}
      to={(tid) => `/transformations/${tid}/presentation`}
    />
  );
}

/** A transformation's meetings, each opening its presentation. */
export function PresentationMeetingsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { id = "" } = useParams();
  usePageTitle(t("reportsP5.presentation.title"));
  const transformation = useTransformation(id);
  const meetings = useMeetings(id);
  return (
    <div className="page" data-p5-screen="presentation-meetings">
      <PageHeader
        title={t("reportsP5.presentation.title")}
        subtitle={t("reportsP5.presentation.meetingsIntro")}
        crumbs={[
          { label: t("nav.areas.evidence.label"), to: "/evidence-reports/presentation" },
          { label: transformation.data?.code ?? t("reportsP5.transformation"), to: `/transformations/${id}` },
          { label: t("reportsP5.presentation.title") },
        ]}
      />
      <section className="card" aria-labelledby="presentation-meetings">
        <h2 id="presentation-meetings" className="card__title">
          {t("reportsP5.presentation.chooseMeeting")}
        </h2>
        <QueryState
          query={meetings}
          isEmpty={(items) => items.length === 0}
          empty={<EmptyState title={t("reportsP5.presentation.noMeetings")} />}
        >
          {(items) => (
            <ul className="plain-list entry-list">
              {[...items]
                .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))
                .map((m) => (
                  <li key={m.id} data-meeting={m.id}>
                    <Link className="link" to={`/transformations/${id}/meetings/${m.id}/presentation`}>
                      {formatBusinessDate(m.scheduledDate, locale)}
                    </Link>{" "}
                    <span className="small muted">
                      {t(`reportsP5.meetingStatus.${m.status}`, { defaultValue: m.status })}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </QueryState>
      </section>
    </div>
  );
}

export function PresentationPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const { id = "", meetingId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const snapshotId = search.get("snapshotId") ?? "";
  usePageTitle(t("reportsP5.presentation.title"));
  const presentation = useMeetingPresentation(id, meetingId, snapshotId);
  const packs = useReportSnapshots(id, { definitionCode: "meeting_pack" });
  const ofMeeting = (packs.data ?? []).filter((s) => s.subjectId === meetingId && s.status !== "discarded");
  const navigate = useSessionNavigate();
  const refresh = useReportsRefresh();
  const runner = useRunner(refresh);
  const selected = ofMeeting.find((s) => s.id === snapshotId);
  return (
    <div className="page" data-p5-screen="presentation" data-presentation-mode={snapshotId ? "snapshot" : "live"}>
      <PageHeader
        title={t("reportsP5.presentation.title")}
        subtitle={t("reportsP5.presentation.intro")}
        crumbs={[
          { label: t("reportsP5.presentation.meeting"), to: `/transformations/${id}/meetings/${meetingId}` },
          { label: t("reportsP5.presentation.title") },
        ]}
      />
      <section className="card" aria-labelledby="presentation-source">
        <h2 id="presentation-source" className="card__title">
          {t("reportsP5.presentation.source")}
        </h2>
        <div className="field">
          <label className="field__label" htmlFor="presentation-mode">
            {t("reportsP5.presentation.show")}
          </label>
          <select
            id="presentation-mode"
            value={snapshotId}
            onChange={(e) => setSearch(e.target.value ? { snapshotId: e.target.value } : {})}
          >
            <option value="">{t("reportsP5.presentation.live")}</option>
            {ofMeeting.map((s) => (
              <option key={s.id} value={s.id}>
                {t(`reportsP5.snapshotStatus.${s.status}`)}
                {s.issueVersion !== null ? ` v${s.issueVersion}` : ""} · {formatDateTime(s.asOf, locale)}
              </option>
            ))}
            {snapshotId && !selected ? (
              <option value={snapshotId}>{t("reportsP5.presentation.otherSnapshot")}</option>
            ) : null}
          </select>
        </div>
        {snapshotId ? (
          <p className="banner banner--info" role="note" data-state="snapshot-mode">
            {selected ? <SnapshotStatusChip status={selected.status} /> : null}{" "}
            {t("reportsP5.presentation.snapshotNote")}{" "}
            <Link className="link" to={`/transformations/${id}/reports/${snapshotId}`}>
              {t("reportsP5.presentation.openPack")}
            </Link>
          </p>
        ) : (
          <p className="banner banner--info" role="note" data-state="live-mode">
            {t("reportsP5.presentation.liveNote")}
          </p>
        )}
        {canAnywhere(me, "report.generate") ? (
          <>
            {runner.alert}
            <form
              className="form form--inset"
              noValidate
              data-form="generate-pack"
              onSubmit={(e) => {
                e.preventDefault();
                void runner
                  .run<ReportSnapshot>(reportPaths.generate(id, "meeting_pack"), { body: { subjectId: meetingId } })
                  .then((s) => {
                    if (s) navigate(`/transformations/${id}/reports/${s.id}`);
                  });
              }}
            >
              <p className="small">{t("reportsP5.presentation.printableIntro")}</p>
              <div className="form__actions">
                <button type="submit" className="button" disabled={runner.busy}>
                  {t("reportsP5.presentation.generatePack")}
                </button>
              </div>
            </form>
          </>
        ) : null}
      </section>
      <Section id="presentation" title={t("reportsP5.presentation.pack")}>
        <QueryState query={presentation}>
          {(p) => (
            <div data-presentation-loaded={p.mode} data-presentation-snapshot={p.snapshotId ?? ""}>
              <ReportDocumentView doc={p.document} headingLevel={3} />
            </div>
          )}
        </QueryState>
      </Section>
    </div>
  );
}
