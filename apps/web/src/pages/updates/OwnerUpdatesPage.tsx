// Structured owner updates (T-DG5-FE-E; REQ-S09-011; ADR-0045 §6; M0185): per reporting period, one update for the
// transformation and one per active workstream, each with the eight fields (achievements, next steps, milestones,
// outcomes, adoption, risks, dependencies, asks). Only the subject's owner writes it (the workstream lead; for the
// transformation, its Transformation Lead); anyone else is refused by the server (403 owner_update.not_owner).
//  - A saved draft is clearly not submitted; "Submit" freezes it as the next revision, which the executive pack prints
//    verbatim next to the workstream's current canonical metrics (no slide is re-created, nothing is typed into a pack).
//  - A submitted update changes only after it is reopened with a reason; every submission is kept as a revision.
//  - Writes need the period open (422 owner_update.period_not_open); an empty submit is refused (owner_update.empty).
// Submitting an update is not a business approval.
import { OWNER_UPDATE_FIELDS, type OwnerUpdateField } from "@mth/shared/schemas";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { useTransformationReportingPeriods } from "../kpi/api.ts";
import { useUserNames } from "../my-work/p4ui.tsx";
import { useWorkstreams } from "../traceability/api.ts";
import {
  reportPaths,
  useOwnerUpdateRevisions,
  useOwnerUpdates,
  useReportsRefresh,
  type OwnerUpdate,
} from "../reports/api.ts";
import { Chip, NoteForm, NotAnApprovalNote, TransformationEntry, useRunner } from "../reports/ui.tsx";

const MAX = 2000;

/** Initiatives and Roadmaps > Owner updates: choose the transformation. */
export function OwnerUpdatesEntryPage() {
  const { t } = useTranslation();
  return (
    <TransformationEntry
      screen="owner-updates"
      title={t("reportsP5.updates.title")}
      summary={t("reportsP5.updates.entryIntro")}
      area={{ label: t("nav.areas.initiatives.label"), to: "/initiatives-roadmaps" }}
      to={(tid) => `/transformations/${tid}/owner-updates`}
    />
  );
}

interface Subject {
  readonly type: "transformation" | "workstream";
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly ownerUserId: string | null;
}

export function OwnerUpdatesPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  usePageTitle(t("reportsP5.updates.title"));
  const transformation = useTransformation(id);
  const periods = useTransformationReportingPeriods(id);
  const workstreams = useWorkstreams(id, false);
  const [periodId, setPeriodId] = useState("");
  // Default: the first open period (the one updates can be written in), else the newest.
  useEffect(() => {
    if (periodId || !periods.data || periods.data.length === 0) return;
    const sorted = [...periods.data].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
    setPeriodId((sorted.find((p) => p.status === "open") ?? sorted[0])!.id);
  }, [periods.data, periodId]);
  const period = periods.data?.find((p) => p.id === periodId);
  const updates = useOwnerUpdates(id, periodId ? { reportingPeriodId: periodId } : {});
  const tr = transformation.data;
  const subjects: Subject[] = [
    ...(tr ? [{ type: "transformation" as const, id: tr.id, code: tr.code, name: tr.name, ownerUserId: null }] : []),
    ...(workstreams.data ?? []).map((w) => ({
      type: "workstream" as const,
      id: w.id,
      code: w.code,
      name: w.name,
      ownerUserId: w.leadUserId,
    })),
  ];
  return (
    <div className="page" data-p5-screen="owner-updates">
      <PageHeader
        title={t("reportsP5.updates.title")}
        subtitle={t("reportsP5.updates.intro")}
        crumbs={[
          { label: t("nav.areas.initiatives.label"), to: "/initiatives-roadmaps/updates" },
          { label: tr?.code ?? t("reportsP5.transformation"), to: `/transformations/${id}` },
          { label: t("reportsP5.updates.title") },
        ]}
      />
      <NotAnApprovalNote />
      <p className="small">
        {t("reportsP5.updates.packNote")}{" "}
        <Link className="link" to={`/transformations/${id}/reports`}>
          {t("reportsP5.reports.title")}
        </Link>
      </p>
      <QueryState
        query={periods}
        isEmpty={(items) => items.length === 0}
        empty={<EmptyState title={t("reportsP5.updates.noPeriods")} body={t("reportsP5.updates.noPeriodsBody")} />}
      >
        {(items) => (
          <div className="field">
            <label className="field__label" htmlFor="update-period">
              {t("reportsP5.generate.period")}
            </label>
            <select id="update-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              {[...items]
                .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.periodLabel} · {t(`reportsP5.periodStatus.${p.status}`, { defaultValue: p.status })}
                  </option>
                ))}
            </select>
            {period && period.status !== "open" ? (
              <span className="field__hint" data-period-closed="true">
                {t("reportsP5.updates.periodNotOpen")}
              </span>
            ) : null}
          </div>
        )}
      </QueryState>
      {periodId ? (
        <QueryState query={updates}>
          {(list) => (
            <div data-updates-period={periodId}>
              {subjects.map((s) => (
                <SubjectUpdate
                  key={`${s.type}-${s.id}`}
                  tid={id}
                  periodId={periodId}
                  subject={s}
                  update={list.find((u) => u.subjectType === s.type && u.subjectId === s.id) ?? null}
                />
              ))}
            </div>
          )}
        </QueryState>
      ) : null}
    </div>
  );
}

function SubjectUpdate({
  tid,
  periodId,
  subject,
  update: u,
}: {
  tid: string;
  periodId: string;
  subject: Subject;
  update: OwnerUpdate | null;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useReportsRefresh();
  const runner = useRunner(refresh);
  const reopen = useRunner(refresh);
  const names = useUserNames([u?.ownerUserId, u?.submittedBy, subject.ownerUserId]);
  const [editing, setEditing] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);
  const mayWrite = canAnywhere(me, "owner_update.submit");
  const headingId = `update-${subject.type}-${subject.id}`;
  const status = u?.status ?? "none";
  return (
    <section
      className="card"
      aria-labelledby={headingId}
      data-update-subject={subject.code}
      data-update-status={status}
    >
      <h2 id={headingId} className="card__title">
        <bdi dir="ltr" className="code">
          {subject.code}
        </bdi>{" "}
        {subject.name}{" "}
        {u === null ? (
          <Chip tone="neutral" icon="question" label={t("reportsP5.updates.status.none")} data="none" />
        ) : u.status === "draft" ? (
          <Chip tone="draft" icon="pencil" label={t("reportsP5.updates.status.draft")} data="draft" />
        ) : (
          <Chip tone="closed" icon="check" label={t("reportsP5.updates.status.submitted")} data="submitted" />
        )}
      </h2>
      <p className="small muted">
        {subject.type === "transformation"
          ? t("reportsP5.updates.ownerTransformation")
          : subject.ownerUserId
            ? t("reportsP5.updates.ownerWorkstream", { name: names(subject.ownerUserId) })
            : t("reportsP5.updates.noOwner")}
      </p>
      {u?.status === "draft" ? (
        <p className="banner banner--warning" role="note" data-state="draft-not-submitted">
          {t("reportsP5.updates.draftBanner")}
          {u.reopenReason ? ` ${t("reportsP5.updates.reopened", { reason: u.reopenReason })}` : ""}
        </p>
      ) : null}
      {u?.status === "submitted" ? (
        <p className="small" data-submitted-at={u.submittedAt ?? ""}>
          {t("reportsP5.updates.submittedBy", {
            who: names(u.submittedBy),
            when: formatDateTime(u.submittedAt, locale) ?? "",
            n: u.revisionNo,
          })}
        </p>
      ) : null}
      {runner.alert}
      {editing ? (
        <UpdateForm
          initial={u}
          busy={runner.busy}
          onCancel={() => {
            setEditing(false);
            runner.clear();
          }}
          onSave={async (fields, submit) => {
            let current = u;
            if (current === null) {
              current = await runner.run<OwnerUpdate>(reportPaths.updates(tid), {
                body: { subjectType: subject.type, subjectId: subject.id, reportingPeriodId: periodId, ...fields },
              });
            } else if (Object.keys(fields).length > 0) {
              current = await runner.run<OwnerUpdate>(reportPaths.update(tid, current.id), {
                method: "PATCH",
                body: fields,
                ifMatch: current.version,
              });
            }
            if (current && submit)
              current = await runner.run<OwnerUpdate>(reportPaths.submitUpdate(tid, current.id), {
                ifMatch: current.version,
              });
            if (current) setEditing(false);
          }}
        />
      ) : u ? (
        <UpdateFields update={u} />
      ) : (
        <p className="muted" data-state="no-update">
          {t("reportsP5.updates.noUpdate")}
        </p>
      )}
      {mayWrite && !editing && (u === null || u.status === "draft") ? (
        <div className="form__actions">
          <button type="button" className="button button--primary" onClick={() => setEditing(true)}>
            {u === null ? t("reportsP5.updates.write") : t("reportsP5.updates.edit")}
            <span className="visually-hidden"> ({subject.name})</span>
          </button>
        </div>
      ) : null}
      {mayWrite && u?.status === "submitted" ? (
        <details>
          <summary>{t("reportsP5.updates.reopenTitle")}</summary>
          {reopen.alert}
          <NoteForm
            id={`reopen-${subject.id}`}
            label={t("reportsP5.field.reason")}
            submitLabel={t("reportsP5.updates.reopen")}
            required
            min={3}
            busy={reopen.busy}
            onSubmit={(reason) =>
              void reopen.run(reportPaths.reopenUpdate(tid, u.id), { body: { reason }, ifMatch: u.version })
            }
          />
        </details>
      ) : null}
      {u && u.revisionNo > 0 ? (
        <div>
          <button
            type="button"
            className="button button--small"
            aria-expanded={showRevisions}
            onClick={() => setShowRevisions((v) => !v)}
          >
            {t("reportsP5.updates.revisions", { n: u.revisionNo })}
          </button>
          {showRevisions ? <Revisions tid={tid} updateId={u.id} /> : null}
        </div>
      ) : null}
    </section>
  );
}

function UpdateFields({ update: u }: { update: Pick<OwnerUpdate, OwnerUpdateField> }) {
  const { t } = useTranslation();
  return (
    <dl className="update-fields">
      {OWNER_UPDATE_FIELDS.map((f) => (
        <div key={f} data-update-field={f}>
          <dt>{t(`reportsP5.updates.field.${f}`)}</dt>
          <dd className="report-text">{u[f] ?? <span className="muted">{t("reportsP5.updates.empty")}</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function UpdateForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: OwnerUpdate | null;
  busy: boolean;
  onSave: (fields: Partial<Record<OwnerUpdateField, string | null>>, submit: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<OwnerUpdateField, string>>(
    () =>
      Object.fromEntries(OWNER_UPDATE_FIELDS.map((f) => [f, initial?.[f] ?? ""])) as Record<OwnerUpdateField, string>,
  );
  const [invalid, setInvalid] = useState<OwnerUpdateField | null>(null);
  const changed = (): Partial<Record<OwnerUpdateField, string | null>> => {
    const out: Partial<Record<OwnerUpdateField, string | null>> = {};
    for (const f of OWNER_UPDATE_FIELDS) {
      const v = values[f].trim() === "" ? null : values[f];
      if (v !== (initial?.[f] ?? null)) out[f] = v;
    }
    return out;
  };
  const save = (submit: boolean) => {
    const tooLong = OWNER_UPDATE_FIELDS.find((f) => values[f].length > MAX) ?? null;
    setInvalid(tooLong);
    if (tooLong) return;
    void onSave(changed(), submit);
  };
  return (
    <form
      className="form"
      noValidate
      data-form="owner-update"
      onSubmit={(e) => {
        e.preventDefault();
        save(false);
      }}
    >
      {OWNER_UPDATE_FIELDS.map((f) => (
        <div key={f} className={`field${invalid === f ? " field--invalid" : ""}`}>
          <label className="field__label" htmlFor={`update-${f}`}>
            {t(`reportsP5.updates.field.${f}`)}
          </label>
          <textarea
            id={`update-${f}`}
            rows={2}
            maxLength={MAX}
            value={values[f]}
            aria-invalid={invalid === f}
            aria-describedby={invalid === f ? `update-${f}-error` : undefined}
            onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
          />
          {invalid === f ? (
            <span id={`update-${f}-error`} className="field__error">
              {t("reportsP5.textLength", { min: 1, max: MAX })}
            </span>
          ) : null}
        </div>
      ))}
      <p className="small">{t("reportsP5.updates.saveHint")}</p>
      <div className="form__actions">
        <button type="submit" className="button" disabled={busy}>
          {t("reportsP5.updates.saveDraft")}
        </button>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => save(true)}>
          {t("reportsP5.updates.submit")}
        </button>
        <button type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>
          {t("reportsP5.updates.cancel")}
        </button>
      </div>
    </form>
  );
}

function Revisions({ tid, updateId }: { tid: string; updateId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const revisions = useOwnerUpdateRevisions(tid, updateId, true);
  const names = useUserNames((revisions.data ?? []).map((r) => r.submittedBy));
  return (
    <QueryState query={revisions}>
      {(items) => (
        <ol className="plain-list" data-revisions={updateId}>
          {[...items]
            .sort((a, b) => b.revisionNo - a.revisionNo)
            .map((r) => (
              <li key={r.revisionNo} className="card" data-revision={r.revisionNo}>
                <h3 className="card__subtitle">
                  {t("reportsP5.updates.revision", {
                    n: r.revisionNo,
                    who: names(r.submittedBy),
                    when: formatDateTime(r.submittedAt, locale) ?? "",
                  })}
                </h3>
                <UpdateFields update={r} />
              </li>
            ))}
        </ol>
      )}
    </QueryState>
  );
}
