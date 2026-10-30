// The 25-question Transformation Health Check of a transformation (T-DG5-FE-F; REQ-PB-091, REQ-PB-092, REQ-S14-001,
// REQ-S14-002, REQ-S14-003; ADR-0048 §5-§11).
//  - The assessments over time (reassessments are tracked: each one names its scheme version, date, score and band).
//  - One assessment: the 25 questions verbatim (B0150; the Arabic texts are provisional translations), each answered
//    with a response the assessment's scheme allows, an evidence note and an owner; "Incomplete (n/25)" while any
//    question is unanswered, with no score and no band (never 0); once all are answered, the score out of the scheme's
//    maximum and the band text verbatim (B0152).
//  - The scoring method of scheme v1 (Yes = 1, No = 0) is an implementation assumption (M0262, D-010), shown as such.
//  - The top 3 actions are required to submit (422 health_check.actions_required). A submitted assessment is final and
//    keeps its scheme version, score and band forever (ADR-0040).
// A health check is an assessment, not a business approval.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import type { HealthCheck, HealthCheckAction } from "@mth/shared/schemas";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { usePeople } from "../../components/People.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, NoPermissionState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDecimal } from "../../lib/format.ts";
import { ReadOnlyNote } from "../my-work/p4ui.tsx";
import { useTransformationTarget } from "../transformations/common.tsx";
import { Chip } from "../automation/ui.tsx";
// T-DG6-FE-F (ADR-0061 §3 item 2, §8 E5; REQ-S15-012, REQ-S15-014): chip icons and the score explanation.
import { Icon } from "../../components/Icon.tsx";
import { HealthScoreExplanation } from "../../components/explanation/index.ts";
import {
  CompletionChip,
  Notice,
  ProvisionalTranslationNote,
  TransformationPicker,
  todayRiyadh,
  useFefRunner,
} from "../launch-plan/ui.tsx";
import {
  healthPaths,
  useHealthCheck,
  useHealthChecks,
  useHealthQuestions,
  useHealthRefresh,
  useHealthScheme,
  type HealthCheckScheme,
  type HealthCheckSummary,
} from "./api.ts";

/** Navigation entry (Playbook and Procedures > Health check): choose a transformation. */
export function HealthCheckEntryPage() {
  const { t } = useTranslation();
  usePageTitle(t("launchHealthP5.health.title"));
  return (
    <div className="page" data-p5-screen="health-check-entry">
      <PageHeader title={t("launchHealthP5.health.title")} subtitle={t("launchHealthP5.health.intro")} />
      <TransformationPicker segment="health-check" title={t("launchHealthP5.entry.chooseHealth")} />
    </div>
  );
}

/** "17 / 25" or, while incomplete, no score (never 0). */
export function ScoreText({ score, max }: { score: string | null; max: string | null }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (score === null)
    return (
      <span className="status-chip status-chip--unknown" data-health="unknown" data-score="none">
        <Icon name="question" />
        {t("launchHealthP5.health.noScore")}
      </span>
    );
  return (
    <span data-score={score}>
      {t("launchHealthP5.health.scoreValue", {
        score: formatDecimal(score, locale, { maxFractionDigits: 2 }),
        max: max === null ? "—" : formatDecimal(max, locale, { maxFractionDigits: 2 }),
      })}
    </span>
  );
}

export function BandText({ band }: { band: HealthCheckSummary["band"] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!band)
    return (
      <span className="status-chip status-chip--unknown" data-health="unknown" data-band="none">
        <Icon name="question" />
        {t("launchHealthP5.health.noBand")}
      </span>
    );
  return (
    <span data-band={band.rangeLabel}>
      <strong>
        <bdi dir="ltr">{band.rangeLabel}</bdi>
      </strong>
      : {locale === "ar" ? band.textAr : band.textEn}
    </span>
  );
}

export function ScoringAssumptionNotice({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return <Notice state="scoring-assumption">{t("launchHealthP5.health.scoringAssumption")}</Notice>;
}

export function HealthCheckPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { id = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  usePageTitle(t("launchHealthP5.health.title"));
  const me = useMe();
  const transformation = useTransformation(id);
  const target = useTransformationTarget(transformation.data);
  const mayAssess = target ? canOn(me, "health_check.assess", target) : false;
  const list = useHealthChecks(id);
  const refresh = useHealthRefresh(id);
  const runner = useFefRunner(refresh);
  const [assessmentDate, setAssessmentDate] = useState(todayRiyadh());
  const selected = search.get("assessment");
  return (
    <div className="page" data-p5-screen="health-check">
      <PageHeader
        demoBadge
        title={t("launchHealthP5.health.title")}
        subtitle={t("launchHealthP5.health.intro")}
        crumbs={[
          { label: transformation.data?.name ?? t("launchHealthP5.transformation"), to: `/transformations/${id}` },
          { label: t("launchHealthP5.health.title") },
        ]}
      />
      <ProvisionalTranslationNote />
      {transformation.isError ? <NoPermissionState error={transformation.error} /> : null}
      <QueryState query={list}>
        {(items) => {
          const sorted = [...items].sort((a, b) => b.sequenceNo - a.sequenceNo);
          const current = selected ?? sorted.find((x) => x.status === "draft")?.id ?? sorted[0]?.id ?? null;
          const draftExists = sorted.some((x) => x.status === "draft");
          return (
            <>
              <Section
                id="assessments"
                title={t("launchHealthP5.health.history")}
                intro={t("launchHealthP5.health.historyIntro")}
              >
                {sorted.length === 0 ? (
                  <EmptyState title={t("launchHealthP5.health.none")} body={t("launchHealthP5.health.noneBody")} />
                ) : (
                  <div
                    className="table-wrap"
                    tabIndex={0}
                    role="region"
                    aria-label={t("launchHealthP5.health.history")}
                  >
                    <table className="table" data-table="health-checks">
                      <caption className="visually-hidden">{t("launchHealthP5.health.history")}</caption>
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col">{t("launchHealthP5.health.date")}</th>
                          <th scope="col">{t("launchHealthP5.field.status")}</th>
                          <th scope="col">{t("launchHealthP5.health.completion")}</th>
                          <th scope="col">{t("launchHealthP5.health.score")}</th>
                          <th scope="col">{t("launchHealthP5.health.band")}</th>
                          <th scope="col">{t("launchHealthP5.health.scheme")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sorted.map((a) => (
                          <tr
                            key={a.id}
                            data-assessment={a.sequenceNo}
                            aria-current={a.id === current ? "true" : undefined}
                          >
                            <th scope="row">
                              <Link
                                className="link"
                                to={`?assessment=${a.id}`}
                                onClick={(e) => {
                                  e.preventDefault();
                                  setSearch({ assessment: a.id });
                                }}
                              >
                                {t("launchHealthP5.health.assessmentNo", { n: a.sequenceNo })}
                              </Link>
                            </th>
                            <td>{formatBusinessDate(a.assessmentDate, locale)}</td>
                            <td>
                              <StatusOf status={a.status} />
                            </td>
                            <td>
                              <CompletionChip {...a.completion} />
                            </td>
                            <td>
                              <ScoreText score={a.score} max={a.scoreMax} />
                            </td>
                            <td>
                              <BandText band={a.band} />
                            </td>
                            <td>{t("launchHealthP5.health.schemeVersion", { n: a.schemeVersionNo })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {mayAssess && !draftExists ? (
                  <form
                    className="form form--inset"
                    noValidate
                    data-form="start-health-check"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void runner
                        .run<HealthCheck>(healthPaths.checks(id), { body: { assessmentDate } })
                        .then((created) => {
                          if (created) setSearch({ assessment: created.id });
                        });
                    }}
                  >
                    {runner.alert}
                    <div className="field">
                      <label className="field__label" htmlFor="health-date">
                        {t("launchHealthP5.health.date")}
                      </label>
                      <input
                        id="health-date"
                        type="date"
                        value={assessmentDate}
                        onChange={(e) => setAssessmentDate(e.target.value)}
                      />
                    </div>
                    <div className="form__actions">
                      <button
                        type="submit"
                        className="button button--primary"
                        disabled={runner.busy || !assessmentDate}
                      >
                        {t("launchHealthP5.health.start")}
                      </button>
                    </div>
                  </form>
                ) : null}
                {!mayAssess ? <ReadOnlyNote /> : null}
              </Section>
              {current ? <AssessmentView key={current} tid={id} assessmentId={current} mayAssess={mayAssess} /> : null}
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

function StatusOf({ status }: { status: "draft" | "submitted" }) {
  const { t } = useTranslation();
  return status === "draft" ? (
    <Chip tone="draft" icon="pencil" label={t("launchHealthP5.health.status.draft")} data="draft" />
  ) : (
    <Chip tone="closed" icon="lock" label={t("launchHealthP5.health.status.submitted")} data="submitted" />
  );
}

function AssessmentView({ tid, assessmentId, mayAssess }: { tid: string; assessmentId: string; mayAssess: boolean }) {
  const check = useHealthCheck(tid, assessmentId);
  const questions = useHealthQuestions();
  const scheme = useHealthScheme(check.data?.schemeVersionId);
  return (
    <QueryState query={check}>
      {(a) => (
        <QueryState query={questions}>
          {(qs) => (
            <QueryState query={scheme}>
              {(s) => <Assessment tid={tid} a={a} questions={qs} scheme={s} mayAssess={mayAssess} />}
            </QueryState>
          )}
        </QueryState>
      )}
    </QueryState>
  );
}

function Assessment({
  tid,
  a,
  questions,
  scheme,
  mayAssess,
}: {
  tid: string;
  a: HealthCheck;
  questions: readonly { code: string; ordinal: number; textEn: string; textAr: string; sourceRef: string }[];
  scheme: HealthCheckScheme;
  mayAssess: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const refresh = useHealthRefresh(tid);
  const submit = useFefRunner(refresh);
  const editable = mayAssess && a.status === "draft";
  const answers = new Map(a.answers.map((x) => [x.questionCode, x]));
  return (
    <>
      <section
        className="card"
        aria-labelledby="assessment-facts"
        data-assessment-status={a.status}
        data-assessment-version={a.version /* T-DG6-FE-G (F-DG5-151): the e2e waits for the saved version */}
      >
        <h2 id="assessment-facts" className="card__title">
          {t("launchHealthP5.health.assessmentNo", { n: a.sequenceNo })} <StatusOf status={a.status} />{" "}
          <CompletionChip {...a.completion} />
        </h2>
        <dl className="workspace-header__grid">
          <dt>{t("launchHealthP5.health.date")}</dt>
          <dd>{formatBusinessDate(a.assessmentDate, locale)}</dd>
          <dt>{t("launchHealthP5.health.score")}</dt>
          <dd data-field="score">
            <ScoreText score={a.score} max={a.scoreMax} />
          </dd>
          <dt>{t("launchHealthP5.health.band")}</dt>
          <dd data-field="band">
            <BandText band={a.band} />
          </dd>
          <dt>{t("launchHealthP5.health.scheme")}</dt>
          <dd>
            {locale === "ar" ? scheme.titleAr : scheme.titleEn} ·{" "}
            {t("launchHealthP5.health.schemeVersion", { n: a.schemeVersionNo })}
          </dd>
        </dl>
        <ScoringAssumptionNotice show={a.scoringAssumption} />
        {!a.completion.complete ? (
          <Notice state="incomplete">{t("launchHealthP5.health.incompleteNote")}</Notice>
        ) : null}
        <HealthScoreExplanation
          check={a}
          scheme={scheme.versionId === a.schemeVersionId ? scheme : null}
          responseLabel={(key) => {
            const opt = scheme.responses.find((r) => r.key === key);
            const own = opt ? (locale === "ar" ? opt.labelAr : opt.labelEn) : null;
            return own ?? t(`launchHealthP5.health.response.${key}`);
          }}
        />
      </section>
      <Section
        id="questions"
        title={t("launchHealthP5.health.questions")}
        intro={t("launchHealthP5.health.questionsIntro")}
      >
        <ol className="plain-list" data-questions={questions.length}>
          {[...questions]
            .sort((x, y) => x.ordinal - y.ordinal)
            .map((q) => (
              <AnswerRow
                key={`${q.code}:${a.version}`}
                tid={tid}
                a={a}
                q={q}
                text={locale === "ar" ? q.textAr : q.textEn}
                scheme={scheme}
                editable={editable}
                current={answers.get(q.code) ?? null}
              />
            ))}
        </ol>
      </Section>
      <Actions key={`actions:${a.version}`} tid={tid} a={a} editable={editable} />
      {editable ? (
        <section className="card" aria-labelledby="submit-health">
          <h2 id="submit-health" className="card__title">
            {t("launchHealthP5.health.submitTitle")}
          </h2>
          <p>{t("launchHealthP5.health.submitBody")}</p>
          {submit.alert}
          <button
            type="button"
            className="button button--primary"
            disabled={submit.busy}
            onClick={() => void submit.run(healthPaths.submit(tid, a.id), { ifMatch: a.version })}
          >
            {t("launchHealthP5.health.submit")}
          </button>
        </section>
      ) : null}
    </>
  );
}

function AnswerRow({
  tid,
  a,
  q,
  text,
  scheme,
  editable,
  current,
}: {
  tid: string;
  a: HealthCheck;
  q: { code: string; ordinal: number; sourceRef: string };
  text: string;
  scheme: HealthCheckScheme;
  editable: boolean;
  current: HealthCheck["answers"][number] | null;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const refresh = useHealthRefresh(tid);
  const runner = useFefRunner(refresh);
  const [response, setResponse] = useState<string>(current?.response ?? "");
  const [note, setNote] = useState(current?.evidenceNote ?? "");
  const label = (key: string) => {
    const opt = scheme.responses.find((r) => r.key === key);
    const own = opt ? (locale === "ar" ? opt.labelAr : opt.labelEn) : null;
    return own ?? t(`launchHealthP5.health.response.${key}`);
  };
  const name = `hc-${q.code}`;
  return (
    <li className="card" data-question={q.code} data-answered={String(current !== null)}>
      <p id={`${name}-text`}>
        <strong>{q.ordinal}.</strong> {text}{" "}
        <span className="small muted">
          <bdi dir="ltr">{q.sourceRef}</bdi>
        </span>
      </p>
      {editable ? (
        <form
          className="form form--inline"
          noValidate
          data-form={`answer-${q.code}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!response) return;
            void runner.run(healthPaths.answer(tid, a.id, q.code), {
              method: "PUT",
              body: { response, evidenceNote: note.trim() ? note.trim() : null },
              ifMatch: a.version,
            });
          }}
        >
          {runner.alert}
          <fieldset className="field" aria-describedby={`${name}-text`}>
            <legend className="field__label">{t("launchHealthP5.health.responseOf", { n: q.ordinal })}</legend>
            {scheme.responses.map((r) => (
              <label key={r.key} className="radio">
                <input
                  type="radio"
                  name={name}
                  value={r.key}
                  checked={response === r.key}
                  onChange={() => setResponse(r.key)}
                />{" "}
                {label(r.key)}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label className="field__label" htmlFor={`${name}-note`}>
              {t("launchHealthP5.health.evidenceNote", { n: q.ordinal })}
            </label>
            <input id={`${name}-note`} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="form__actions">
            <button type="submit" className="button button--small" disabled={runner.busy || !response}>
              {t("launchHealthP5.health.saveAnswer", { n: q.ordinal })}
            </button>
          </div>
        </form>
      ) : (
        <p className="small" data-answer={current?.response ?? "none"}>
          {current ? label(current.response) : t("launchHealthP5.health.unanswered")}
          {current?.evidenceNote ? ` · ${current.evidenceNote}` : ""}
        </p>
      )}
    </li>
  );
}

function Actions({ tid, a, editable }: { tid: string; a: HealthCheck; editable: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const people = usePeople(tid);
  const refresh = useHealthRefresh(tid);
  const runner = useFefRunner(refresh);
  const byRank = new Map(a.actions.map((x) => [x.rank, x]));
  const [rows, setRows] = useState(() =>
    [1, 2, 3].map((rank) => ({
      rank,
      actionText: byRank.get(rank)?.actionText ?? "",
      ownerUserId: byRank.get(rank)?.ownerUserId ?? "",
      dueDate: byRank.get(rank)?.dueDate ?? "",
    })),
  );
  const set = (rank: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((rs) => rs.map((r) => (r.rank === rank ? { ...r, ...patch } : r)));
  return (
    <Section
      id="top-actions"
      title={t("launchHealthP5.health.actions")}
      intro={t("launchHealthP5.health.actionsIntro")}
    >
      {editable ? (
        <form
          className="form form--inset"
          noValidate
          data-form="health-actions"
          onSubmit={(e) => {
            e.preventDefault();
            const actions: HealthCheckAction[] = rows
              .filter((r) => r.actionText.trim() !== "")
              .map((r) => ({
                rank: r.rank,
                actionText: r.actionText.trim(),
                ownerUserId: r.ownerUserId || null,
                dueDate: r.dueDate || null,
              }));
            if (actions.length === 0) return;
            void runner.run(healthPaths.actions(tid, a.id), { method: "PUT", body: { actions }, ifMatch: a.version });
          }}
        >
          {runner.alert}
          {rows.map((r) => (
            <fieldset key={r.rank} className="field" data-action-rank={r.rank}>
              <legend className="field__label">{t("launchHealthP5.health.actionN", { n: r.rank })}</legend>
              <label className="field__label" htmlFor={`action-${r.rank}-text`}>
                {t("launchHealthP5.health.actionText", { n: r.rank })}
              </label>
              <input
                id={`action-${r.rank}-text`}
                maxLength={1000}
                value={r.actionText}
                onChange={(e) => set(r.rank, { actionText: e.target.value })}
              />
              <label className="field__label" htmlFor={`action-${r.rank}-owner`}>
                {t("launchHealthP5.health.actionOwner", { n: r.rank })}
              </label>
              <select
                id={`action-${r.rank}-owner`}
                value={r.ownerUserId}
                onChange={(e) => set(r.rank, { ownerUserId: e.target.value })}
              >
                <option value="">{t("common.value.notAssigned")}</option>
                {people.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <label className="field__label" htmlFor={`action-${r.rank}-due`}>
                {t("launchHealthP5.health.actionDue", { n: r.rank })}
              </label>
              <input
                id={`action-${r.rank}-due`}
                type="date"
                value={r.dueDate}
                onChange={(e) => set(r.rank, { dueDate: e.target.value })}
              />
            </fieldset>
          ))}
          <div className="form__actions">
            <button type="submit" className="button" disabled={runner.busy}>
              {t("launchHealthP5.health.saveActions")}
            </button>
          </div>
        </form>
      ) : a.actions.length === 0 ? (
        <p className="muted">{t("launchHealthP5.health.noActions")}</p>
      ) : (
        <ol data-actions={a.actions.length}>
          {[...a.actions]
            .sort((x, y) => x.rank - y.rank)
            .map((x) => (
              <li key={x.rank}>
                {x.actionText}
                <span className="small muted">
                  {" · "}
                  {x.ownerUserId
                    ? (people.byId.get(x.ownerUserId)?.label ?? t("common.value.notVisible"))
                    : t("common.value.notAssigned")}
                  {x.dueDate ? ` · ${formatBusinessDate(x.dueDate, locale)}` : ""}
                </span>
              </li>
            ))}
        </ol>
      )}
    </Section>
  );
}
