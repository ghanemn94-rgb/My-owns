// A transformation's reports (T-DG5-FE-E; REQ-S13-004, REQ-S13-007, REQ-S13-008; ADR-0045 §1, §2, §5): the twelve
// outputs (the ten generated outputs of M0253 and the two packs), each generated from the transformation's records,
// never typed in. A live preview is assembled now and never stored; "Generate" stores a snapshot in status generated
// (a draft, not an issued report) and opens it, where it can be issued, discarded, reissued and exported. Below, the
// transformation's snapshots with their status, issue version and the provisional and unknown value counts.
//
// The register output takes the filters of its DG2–DG4 list route (ADR-0045 §1); the API decides what is valid
// (422 report.parameters_invalid), and a selection above 5,000 rows is refused (422 report.too_large), never truncated.
import { REPORT_REGISTERS, type ReportDefinition, type ReportSnapshot } from "@mth/shared/schemas";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useGates, useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionNavigate } from "../../auth/sessionBound.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { useHandovers } from "../bau/api.ts";
import { useTransformationReportingPeriods } from "../kpi/api.ts";
import { useMeetings } from "../meetings/api.ts";
import { reportPaths, useLiveReport, useReportDefinitions, useReportSnapshots, useReportsRefresh } from "./api.ts";
import { NotAnApprovalNote, ReportDocumentView, SnapshotStatusChip, TransformationEntry, useRunner } from "./ui.tsx";

const RAID_TYPES = ["risk", "assumption", "issue", "dependency"] as const;
const RAID_STATUSES = ["open", "in_progress", "closed"] as const;

/** The label of a definition in the locale (the catalogue is bilingual; nothing is invented). */
export function definitionLabel(d: Pick<ReportDefinition, "labelEn" | "labelAr">, locale: string): string {
  return locale === "ar" ? d.labelAr : d.labelEn;
}

export function ReportsPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  usePageTitle(t("reportsP5.reports.title"));
  const transformation = useTransformation(id);
  return (
    <div className="page" data-p5-screen="reports">
      <PageHeader
        title={t("reportsP5.reports.title")}
        subtitle={t("reportsP5.reports.intro")}
        crumbs={[
          { label: t("nav.areas.evidence.label"), to: "/evidence-reports/reports" },
          { label: transformation.data?.code ?? t("reportsP5.transformation"), to: `/transformations/${id}` },
          { label: t("reportsP5.reports.title") },
        ]}
      />
      <NotAnApprovalNote />
      <p className="small">
        <Link className="link" to={`/transformations/${id}/exports`}>
          {t("reportsP5.exports.title")}
        </Link>{" "}
        ·{" "}
        <Link className="link" to={`/transformations/${id}/presentation`}>
          {t("reportsP5.presentation.title")}
        </Link>{" "}
        ·{" "}
        <Link className="link" to={`/transformations/${id}/owner-updates`}>
          {t("reportsP5.updates.title")}
        </Link>{" "}
        ·{" "}
        <Link className="link" to={`/transformations/${id}/evidence-register`}>
          {t("reportsP5.evidence.title")}
        </Link>
      </p>
      <GenerateSection tid={id} orgId={transformation.data?.organizationId} />
      <SnapshotsSection tid={id} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ generate

function SubjectSelect({
  tid,
  subjectType,
  value,
  onChange,
}: {
  tid: string;
  subjectType: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const meetings = useMeetings(subjectType === "meeting" ? tid : "");
  const gates = useGates(tid);
  const handovers = useHandovers(subjectType === "bau_handover" ? tid : "");
  if (subjectType === "transformation") return null;
  let options: { id: string; label: string }[] = [];
  let pending = false;
  if (subjectType === "meeting") {
    pending = meetings.isPending;
    options = (meetings.data ?? []).map((m) => ({
      id: m.id,
      label: `${formatBusinessDate(m.scheduledDate, locale) ?? m.scheduledDate} · ${t(`reportsP5.meetingStatus.${m.status}`, { defaultValue: m.status })}`,
    }));
  } else if (subjectType === "gate_instance") {
    pending = gates.isPending;
    options = (gates.data?.items ?? []).map((g) => ({
      id: g.gate.id,
      label: `${g.definition.code} · ${locale === "ar" ? g.definition.nameAr : g.definition.sourceNameEn}`,
    }));
  } else if (subjectType === "bau_handover") {
    pending = handovers.isPending;
    options = (handovers.data ?? []).map((h) => ({ id: h.id, label: h.code }));
  }
  return (
    <div className="field">
      <label className="field__label" htmlFor="report-subject">
        {t(`reportsP5.generate.subject.${subjectType}`)}
        <span className="field__required"> ({t("common.form.required")})</span>
      </label>
      <select id="report-subject" value={value} onChange={(e) => onChange(e.target.value)} disabled={pending}>
        <option value="">{pending ? t("common.state.loading") : t("reportsP5.generate.choose")}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {!pending && options.length === 0 ? (
        <span className="field__hint" data-no-subjects="true">
          {t("reportsP5.generate.noSubjects")}
        </span>
      ) : null}
    </div>
  );
}

function GenerateSection({ tid, orgId }: { tid: string; orgId: string | undefined }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const navigate = useSessionNavigate();
  const refresh = useReportsRefresh();
  const runner = useRunner(refresh);
  const definitions = useReportDefinitions();
  const periods = useTransformationReportingPeriods(tid);
  const [code, setCode] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [register, setRegister] = useState<string>("raid");
  const [raidType, setRaidType] = useState("");
  const [raidStatus, setRaidStatus] = useState("");
  const [preview, setPreview] = useState(false);
  const def = definitions.data?.items.find((d) => d.code === code);
  const parameters = useMemo(() => {
    if (code !== "registers") return null;
    const filters: Record<string, string> = {};
    if (register === "raid") {
      if (raidType) filters["type"] = raidType;
      if (raidStatus) filters["status"] = raidStatus;
    }
    return { register, filters };
  }, [code, register, raidType, raidStatus]);
  const body = {
    ...(def && def.subjectType !== "transformation" && subjectId ? { subjectId } : {}),
    ...(def?.needsReportingPeriod && periodId ? { reportingPeriodId: periodId } : {}),
    ...(parameters ? { parameters } : {}),
  };
  const liveQuery: Record<string, string> = {
    ...(body.subjectId ? { subjectId: body.subjectId } : {}),
    ...(body.reportingPeriodId ? { reportingPeriodId: body.reportingPeriodId } : {}),
    ...(parameters ? { parameters: JSON.stringify(parameters) } : {}),
  };
  const live = useLiveReport(tid, code || undefined, liveQuery, preview);
  const mayGenerate = canAnywhere(me, "report.generate");
  const choose = (next: string) => {
    setCode(next);
    setSubjectId("");
    setPreview(false);
    runner.clear();
  };
  return (
    <Section id="generate" title={t("reportsP5.generate.title")} intro={t("reportsP5.generate.intro")}>
      <QueryState query={definitions}>
        {(list) => (
          <form
            className="form"
            noValidate
            data-form="generate-report"
            onSubmit={(e) => {
              e.preventDefault();
              if (!def) return;
              void runner.run<ReportSnapshot>(reportPaths.generate(tid, def.code), { body }).then((s) => {
                if (s) navigate(`/transformations/${tid}/reports/${s.id}`);
              });
            }}
          >
            {runner.alert}
            <div className="field">
              <label className="field__label" htmlFor="report-definition">
                {t("reportsP5.generate.output")}
                <span className="field__required"> ({t("common.form.required")})</span>
              </label>
              <select id="report-definition" value={code} onChange={(e) => choose(e.target.value)}>
                <option value="">{t("reportsP5.generate.choose")}</option>
                {[...list.items]
                  .sort((a, b) => a.ordinal - b.ordinal)
                  .map((d) => (
                    <option key={d.code} value={d.code}>
                      {definitionLabel(d, locale)}
                    </option>
                  ))}
              </select>
              {def ? (
                <span className="field__hint" data-definition-description={def.code}>
                  {locale === "ar" ? def.descriptionAr : def.descriptionEn}{" "}
                  {t("reportsP5.generate.formats", { formats: def.formats.map((f) => f.toUpperCase()).join(", ") })}
                </span>
              ) : null}
            </div>
            {def ? (
              <SubjectSelect tid={tid} subjectType={def.subjectType} value={subjectId} onChange={setSubjectId} />
            ) : null}
            {def?.needsReportingPeriod ? (
              <div className="field">
                <label className="field__label" htmlFor="report-period">
                  {t("reportsP5.generate.period")}
                  <span className="field__required"> ({t("common.form.required")})</span>
                </label>
                <select id="report-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                  <option value="">{t("reportsP5.generate.choose")}</option>
                  {(periods.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.periodLabel} · {t(`reportsP5.periodStatus.${p.status}`, { defaultValue: p.status })}
                    </option>
                  ))}
                </select>
                {orgId === undefined && periods.isError ? (
                  <span className="field__hint">{t("reportsP5.generate.periodsUnavailable")}</span>
                ) : null}
              </div>
            ) : null}
            {code === "registers" ? (
              <fieldset className="fieldset" data-register-filters="true">
                <legend>{t("reportsP5.generate.registerSettings")}</legend>
                <div className="field">
                  <label className="field__label" htmlFor="report-register">
                    {t("reportsP5.generate.register")}
                  </label>
                  <select id="report-register" value={register} onChange={(e) => setRegister(e.target.value)}>
                    {REPORT_REGISTERS.map((r) => (
                      <option key={r} value={r}>
                        {t(`reportsP5.register.${r}`)}
                      </option>
                    ))}
                  </select>
                </div>
                {register === "raid" ? (
                  <>
                    <div className="field">
                      <label className="field__label" htmlFor="report-raid-type">
                        {t("reportsP5.generate.raidType")}
                      </label>
                      <select id="report-raid-type" value={raidType} onChange={(e) => setRaidType(e.target.value)}>
                        <option value="">{t("reportsP5.generate.all")}</option>
                        {RAID_TYPES.map((v) => (
                          <option key={v} value={v}>
                            {t(`reportsP5.raidType.${v}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label className="field__label" htmlFor="report-raid-status">
                        {t("reportsP5.generate.raidStatus")}
                      </label>
                      <select
                        id="report-raid-status"
                        value={raidStatus}
                        onChange={(e) => setRaidStatus(e.target.value)}
                      >
                        <option value="">{t("reportsP5.generate.all")}</option>
                        {RAID_STATUSES.map((v) => (
                          <option key={v} value={v}>
                            {t(`reportsP5.raidStatus.${v}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                ) : (
                  <p className="small muted">{t("reportsP5.generate.allRows")}</p>
                )}
              </fieldset>
            ) : null}
            <div className="form__actions">
              <button
                type="button"
                className="button"
                disabled={!def}
                onClick={() => {
                  setPreview(true);
                  void live.refetch();
                }}
              >
                {t("reportsP5.generate.preview")}
              </button>
              {mayGenerate ? (
                <button type="submit" className="button button--primary" disabled={!def || runner.busy}>
                  {t("reportsP5.generate.submit")}
                </button>
              ) : (
                <span className="small muted" data-state="read-only">
                  {t("reportsP5.generate.readOnly")}
                </span>
              )}
            </div>
          </form>
        )}
      </QueryState>
      {preview && def ? (
        <div className="report-preview" data-live-preview={def.code}>
          <h3 className="card__subtitle">{t("reportsP5.generate.liveTitle")}</h3>
          <p className="banner banner--info" role="note" data-state="live-not-stored">
            {t("reportsP5.generate.liveNote")}
          </p>
          <QueryState query={live}>{(r) => <ReportDocumentView doc={r.document} headingLevel={3} />}</QueryState>
        </div>
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ snapshots

function SnapshotsSection({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const definitions = useReportDefinitions();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const query = { ...(code ? { definitionCode: code } : {}), ...(status ? { status } : {}) };
  const snapshots = useReportSnapshots(tid, query);
  const labelOf = (c: string) => {
    const d = definitions.data?.items.find((x) => x.code === c);
    return d ? definitionLabel(d, locale) : c;
  };
  return (
    <Section id="snapshots" title={t("reportsP5.snapshots.title")} intro={t("reportsP5.snapshots.intro")}>
      <div className="filters" role="group" aria-label={t("reportsP5.snapshots.filters")}>
        <div className="field">
          <label className="field__label" htmlFor="snapshot-filter-code">
            {t("reportsP5.generate.output")}
          </label>
          <select id="snapshot-filter-code" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">{t("reportsP5.generate.all")}</option>
            {(definitions.data?.items ?? []).map((d) => (
              <option key={d.code} value={d.code}>
                {definitionLabel(d, locale)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="snapshot-filter-status">
            {t("reportsP5.field.status")}
          </label>
          <select id="snapshot-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("reportsP5.generate.all")}</option>
            {["generated", "issued", "superseded", "discarded"].map((s) => (
              <option key={s} value={s}>
                {t(`reportsP5.snapshotStatus.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <QueryState
        query={snapshots}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title={t("reportsP5.snapshots.none")} body={t("reportsP5.snapshots.noneBody")} />}
      >
        {(items) => (
          <div className="table-wrap" tabIndex={0} role="region" aria-label={t("reportsP5.snapshots.title")}>
            <table className="table" data-table="report-snapshots">
              <caption className="visually-hidden">{t("reportsP5.snapshots.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("reportsP5.generate.output")}</th>
                  <th scope="col">{t("reportsP5.field.status")}</th>
                  <th scope="col">{t("reportsP5.field.issueVersion")}</th>
                  <th scope="col">{t("reportsP5.facts.period")}</th>
                  <th scope="col">{t("reportsP5.facts.asOf")}</th>
                  <th scope="col">{t("reportsP5.field.provisional")}</th>
                  <th scope="col">{t("reportsP5.field.unknown")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => (
                  <tr key={s.id} data-snapshot={s.id} data-snapshot-status={s.status}>
                    <th scope="row">
                      <Link className="link" to={`/transformations/${tid}/reports/${s.id}`}>
                        {labelOf(s.definitionCode)}
                      </Link>
                      {s.reissueOfId ? (
                        <span className="block small muted">{t("reportsP5.snapshots.reissue")}</span>
                      ) : null}
                    </th>
                    <td>
                      <SnapshotStatusChip status={s.status} />
                    </td>
                    <td>{s.issueVersion === null ? "—" : <bdi dir="ltr">v{s.issueVersion}</bdi>}</td>
                    <td>{s.periodLabel ?? t("reportsP5.facts.noPeriod")}</td>
                    <td>{formatDateTime(s.asOf, locale)}</td>
                    <td data-count="provisional">{s.provisionalValueCount}</td>
                    <td data-count="unknown">{s.unknownValueCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </Section>
  );
}

/** Evidence and Reports > Reports and snapshots: choose the transformation. */
export function ReportsEntryPage() {
  const { t } = useTranslation();
  return (
    <TransformationEntry
      screen="reports"
      title={t("reportsP5.reports.title")}
      summary={t("reportsP5.reports.entryIntro")}
      area={{ label: t("nav.areas.evidence.label"), to: "/evidence-reports" }}
      to={(tid) => `/transformations/${tid}/reports`}
    />
  );
}
