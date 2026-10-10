// One assessment record (feedback or proficiency observation): `/transformations/:id/assessment-records/:recordId`,
// the `assessment_to_review` work-item link (T-DG4-FE-E; ADR-0033 §5; REQ-S11-002 "review:BO"). SYNTHETIC data only.
//  - Answers are immutable after submission; a correction is a withdrawal (with a reason) and a new response.
//  - Review (assessment.review) records an optional note; withdraw is for a reviewer or the respondent.
//  - The proficiency result is derived by the API; the record shows its stakeholder group (REQ-S11-002 A11).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { errorMessage } from "../../lib/problem.ts";
import { DueDate, P4FormDialog, textOf } from "../my-work/p4ui.tsx";
import {
  adoptionPaths,
  useAssessmentForm,
  useAssessmentFormVersion,
  useAssessmentRecord,
  useStakeholderGroups,
  type AssessmentRecord,
} from "./api.ts";
import { questionLabel } from "./FormsPage.tsx";
import { ProficiencyResult } from "./TrainingPage.tsx";
import { AdoptionSubNav, FORM_WRITE_PERMISSIONS, NS, StatusText } from "./ui.tsx";

export function RecordPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="adoption"
      title={t("adoptionP4.records.detailTitle")}
      writePermissions={FORM_WRITE_PERMISSIONS}
    >
      <RecordDetail />
    </WorkspaceFrame>
  );
}

function RecordDetail() {
  const ws = useWorkspace();
  const { recordId = "" } = useParams();
  const query = useAssessmentRecord(ws.tid, recordId);
  return (
    <>
      <AdoptionSubNav tid={ws.tid} />
      <QueryState query={query}>{(r) => <RecordBody record={r} />}</QueryState>
    </>
  );
}

function RecordBody({ record: r }: { record: AssessmentRecord }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const form = useAssessmentForm(ws.tid, r.formId);
  const groups = useStakeholderGroups(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<"review" | "withdraw" | null>(null);
  const group = (groups.data ?? []).find((g) => g.id === r.stakeholderGroupId);
  // getAssessmentFormVersion (ADR-0033 amendment V1; T-DG4-FE-R3): the answers are labelled from the question version
  // the record was answered on, never from the form's current version (which may have changed since).
  const version = useAssessmentFormVersion(ws.tid, r.formId, r.formVersionNo);
  const questions = version.data?.schema.questions ?? null;
  const canReview = ws.can("assessment.review") && r.status === "submitted";
  const canWithdraw = r.status !== "withdrawn" && (ws.can("assessment.review") || r.respondentUserId === ws.meId);
  return (
    <Section
      id="assessment-record"
      title={form.data ? form.data.name : t("adoptionP4.records.detailTitle")}
      actions={
        <span className="chip-row">
          {canReview ? (
            <button type="button" className="button button--primary" onClick={() => setDialog("review")} data-review>
              <Icon name="check" /> {t("adoptionP4.records.review")}
            </button>
          ) : null}
          {canWithdraw ? (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setDialog("withdraw")}
              data-withdraw
            >
              <Icon name="cross" /> {t("adoptionP4.records.withdraw")}
            </button>
          ) : null}
        </span>
      }
    >
      <dl className="details" data-record={r.id}>
        <dt>{t("adoptionP4.col.status")}</dt>
        <dd>
          <StatusText status={r.status} />
        </dd>
        <dt>{t("adoptionP4.records.kind")}</dt>
        <dd>{t(`adoptionP4.recordKind.${r.kind}`)}</dd>
        <dt>{t("adoptionP4.col.stakeholder")}</dt>
        <dd data-record-group={group?.code ?? ""}>
          {group ? `${group.code} · ${group.name}` : t("common.value.unknown")}
        </dd>
        <dt>{t("adoptionP4.records.respondent")}</dt>
        <dd>
          <PersonName id={r.respondentUserId} people={byId} />
        </dd>
        {r.kind === "proficiency_observation" ? (
          <>
            <dt>{t("adoptionP4.records.subject")}</dt>
            <dd>{r.subjectUserId ? <PersonName id={r.subjectUserId} people={byId} /> : r.subjectLabel}</dd>
            <dt>{t("adoptionP4.records.result")}</dt>
            <dd>
              <ProficiencyResult result={r.proficiencyResult} />
            </dd>
          </>
        ) : null}
        <dt>{t("adoptionP4.records.observedOn")}</dt>
        <dd>
          <DueDate date={r.observedOn} />
        </dd>
        <dt>{t("adoptionP4.records.formVersion")}</dt>
        <dd>
          <Link className="link" to={`/transformations/${ws.tid}/assessment-forms/${r.formId}`}>
            v{r.formVersionNo}
          </Link>
        </dd>
        {r.reviewNote ? (
          <>
            <dt>{t("adoptionP4.records.reviewNote")}</dt>
            <dd>
              <TextCell value={r.reviewNote} />
            </dd>
          </>
        ) : null}
        {r.withdrawReason ? (
          <>
            <dt>{t("adoptionP4.records.withdrawReason")}</dt>
            <dd>
              <TextCell value={r.withdrawReason} />
            </dd>
          </>
        ) : null}
      </dl>
      <h3>{t("adoptionP4.records.answers")}</h3>
      {version.isPending ? (
        <p role="status" className="small muted" data-state="form-version-loading">
          {t("common.state.loading")}
        </p>
      ) : version.isError ? (
        <div className="banner banner--warning" role="note" data-state="form-version-error">
          <p>
            <Icon name="alert" /> {t("adoptionP4.records.versionUnreadable", { n: r.formVersionNo })}
          </p>
          <p className="small">{errorMessage(t, version.error)}</p>
        </div>
      ) : null}
      <dl className="details" data-answers data-answers-version={version.data?.versionNo ?? ""}>
        {Object.entries(r.answers).map(([key, value]) => {
          const q = questions?.find((x) => x.key === key);
          const shown =
            typeof value === "boolean"
              ? t(value ? "adoptionP4.forms.yes" : "adoptionP4.forms.no")
              : q?.type === "single_choice"
                ? (q.options?.find((o) => o.value === value)?.[locale === "ar" ? "label_ar" : "label_en"] ??
                  String(value))
                : String(value);
          return (
            <div key={key}>
              <dt data-question={key}>
                {q ? (
                  questionLabel(q, locale)
                ) : (
                  // A key the version lacks (or a version that could not be read): the key and "Unknown question",
                  // never a blank label. While the version is still loading only the key is shown.
                  <>
                    <bdi dir="ltr" className="code">
                      {key}
                    </bdi>
                    {version.isPending ? null : (
                      <span className="small muted" data-unknown-question={key}>
                        {" "}
                        ({t("adoptionP4.records.unknownQuestion")})
                      </span>
                    )}
                  </>
                )}
              </dt>
              <dd data-answer-value={key}>{shown}</dd>
            </div>
          );
        })}
      </dl>
      {dialog === "review" ? <ReviewDialog record={r} onClose={() => setDialog(null)} /> : null}
      {dialog === "withdraw" ? <WithdrawDialog record={r} onClose={() => setDialog(null)} /> : null}
    </Section>
  );
}

function ReviewDialog({ record, onClose }: { record: AssessmentRecord; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("adoptionP4.records.review")}
      fields={[{ name: "note", label: t("adoptionP4.records.reviewNote"), kind: "textarea", max: 2000 }]}
      submitLabel={t("adoptionP4.records.reviewSubmit")}
      url={adoptionPaths.recordReview(ws.tid, record.id)}
      version={record.version}
      namespaces={NS}
      toBody={(v) => (textOf(v["note"]) ? { note: v["note"] } : {})}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function WithdrawDialog({ record, onClose }: { record: AssessmentRecord; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("adoptionP4.records.withdraw")}
      description={t("adoptionP4.records.withdrawIntro")}
      fields={[
        { name: "reason", label: t("adoptionP4.field.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
      ]}
      submitLabel={t("adoptionP4.records.withdraw")}
      danger
      url={adoptionPaths.recordWithdraw(ws.tid, record.id)}
      version={record.version}
      namespaces={NS}
      toBody={(v) => ({ reason: v["reason"] })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
