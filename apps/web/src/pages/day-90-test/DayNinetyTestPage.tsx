// The Day-90 leadership test of a transformation (T-DG5-FE-F; REQ-PB-087; ADR-0048 §4).
//  - The six questions are rendered verbatim (B0136-B0141; the Arabic texts are provisional translations).
//  - Each leader (day_ninety_test.respond: SP, TL) records Yes or No, a comment and, where available, one of the
//    suggested evidence records. Suggestions are links to confirm, never answers: nothing is pre-answered.
//  - "Incomplete (n/6)" while any question has no response; completing needs all six (422 day_ninety_test.incomplete).
//    A completed test is final (422 day_ninety_test.completed).
// A Day-90 answer is a leadership assessment, not a business approval.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import type { DayNinetyQuestion, DayNinetyTest } from "@mth/shared/schemas";
import { ApiError } from "../../api/client.ts";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { ReadOnlyNote, useUserNames } from "../my-work/p4ui.tsx";
import { useTransformationTarget } from "../transformations/common.tsx";
import { Chip } from "../automation/ui.tsx";
import { launchPaths, useDayNinetyTest, useLaunchRefresh } from "../launch-plan/api.ts";
import { CompletionChip, Notice, ProvisionalTranslationNote, useFefRunner } from "../launch-plan/ui.tsx";

export function DayNinetyTestPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  usePageTitle(t("launchHealthP5.day90.title"));
  const transformation = useTransformation(id);
  const test = useDayNinetyTest(id);
  const none = test.isError && test.error instanceof ApiError && test.error.status === 404;
  return (
    <div className="page" data-p5-screen="day-90-test">
      <PageHeader
        title={t("launchHealthP5.day90.title")}
        subtitle={t("launchHealthP5.day90.intro")}
        crumbs={[
          { label: transformation.data?.name ?? t("launchHealthP5.transformation"), to: `/transformations/${id}` },
          { label: t("launchHealthP5.launch.title"), to: `/transformations/${id}/launch-plan` },
          { label: t("launchHealthP5.day90.title") },
        ]}
      />
      <ProvisionalTranslationNote />
      {none ? (
        <EmptyState title={t("launchHealthP5.day90.none")} body={t("launchHealthP5.day90.noneBody")} />
      ) : (
        <QueryState query={test}>{(d) => <TestView tid={id} test={d} />}</QueryState>
      )}
    </div>
  );
}

function TestView({ tid, test }: { tid: string; test: DayNinetyTest }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const transformation = useTransformation(tid);
  const target = useTransformationTarget(transformation.data);
  const mayRespond = target ? canOn(me, "day_ninety_test.respond", target) : false;
  const refresh = useLaunchRefresh(tid);
  const runner = useFefRunner(refresh);
  const names = useUserNames([test.completedBy, ...test.questions.map((q) => q.response?.respondedBy ?? null)]);
  const open = test.status === "open";
  return (
    <>
      <section className="card" aria-labelledby="test-facts" data-test-status={test.status}>
        <h2 id="test-facts" className="card__title">
          <CompletionChip {...test.completion} />{" "}
          {open ? (
            <Chip tone="draft" icon="pencil" label={t("launchHealthP5.day90.status.open")} data="open" />
          ) : (
            <Chip tone="closed" icon="lock" label={t("launchHealthP5.day90.status.completed")} data="completed" />
          )}
        </h2>
        <dl className="workspace-header__grid">
          <dt>{t("launchHealthP5.day90.scheduled")}</dt>
          <dd>{formatBusinessDate(test.scheduledDate, locale)}</dd>
          {test.completedAt ? (
            <>
              <dt>{t("launchHealthP5.day90.completedBy")}</dt>
              <dd>
                {names(test.completedBy)} · {formatDateTime(test.completedAt, locale)}
              </dd>
            </>
          ) : null}
        </dl>
        <Notice state="suggestions-note">{t("launchHealthP5.day90.suggestionsNote")}</Notice>
        {!mayRespond ? <ReadOnlyNote /> : null}
      </section>
      <ol className="plain-list" data-questions={test.questions.length}>
        {[...test.questions]
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((q) => (
            <QuestionCard
              key={`${q.code}:${test.version}`}
              tid={tid}
              q={q}
              testVersion={test.version}
              editable={open && mayRespond}
              respondedBy={q.response ? names(q.response.respondedBy) : null}
            />
          ))}
      </ol>
      {open && mayRespond ? (
        <section className="card" aria-labelledby="complete-test">
          <h2 id="complete-test" className="card__title">
            {t("launchHealthP5.day90.completeTitle")}
          </h2>
          <p>{t("launchHealthP5.day90.completeBody")}</p>
          {runner.alert}
          <button
            type="button"
            className="button button--primary"
            disabled={runner.busy}
            onClick={() => void runner.run(launchPaths.dayNinetyComplete(tid), { ifMatch: test.version })}
          >
            {t("launchHealthP5.day90.complete")}
          </button>
        </section>
      ) : null}
    </>
  );
}

function QuestionCard({
  tid,
  q,
  testVersion,
  editable,
  respondedBy,
}: {
  tid: string;
  q: DayNinetyQuestion;
  testVersion: number;
  editable: boolean;
  respondedBy: string | null;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const refresh = useLaunchRefresh(tid);
  const runner = useFefRunner(refresh);
  const [answer, setAnswer] = useState<"" | "yes" | "no">(q.response?.answer ?? "");
  const [comment, setComment] = useState(q.response?.comment ?? "");
  const [evidenceId, setEvidenceId] = useState(q.response?.evidenceId ?? "");
  const text = locale === "ar" ? q.textAr : q.textEn;
  const name = `d90-${q.code}`;
  return (
    <li className="card" data-question={q.code} data-answered={String(q.response !== null)}>
      <h3 className="card__title" id={`${name}-text`}>
        {q.ordinal}. {text}
      </h3>
      <p className="small muted">
        <bdi dir="ltr">{q.sourceRef}</bdi>
        {" · "}
        {q.response ? (
          <span data-answer={q.response.answer}>
            {t(`launchHealthP5.day90.answer.${q.response.answer}`)} · {respondedBy}
          </span>
        ) : (
          <span data-answer="none">{t("launchHealthP5.day90.unanswered")}</span>
        )}
      </p>
      {q.evidenceSuggestions.length > 0 ? (
        <div>
          <p className="small">
            <strong>{t("launchHealthP5.day90.suggested")}</strong>
          </p>
          <ul className="plain-list small" data-suggestions={q.evidenceSuggestions.length}>
            {q.evidenceSuggestions.map((s) => (
              <li key={s.recordId}>
                {t(`launchHealthP5.day90.recordType.${s.recordType}`, { defaultValue: s.recordType })}: {s.label}
                {" · "}
                {s.state ?? t("common.value.unknown")}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="small muted">{t("launchHealthP5.day90.noSuggestions")}</p>
      )}
      {editable ? (
        <form
          className="form form--inset"
          noValidate
          data-form={`respond-${q.code}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!answer) return;
            void runner.run(launchPaths.dayNinetyResponse(tid, q.code), {
              method: "PUT",
              body: {
                answer,
                comment: comment.trim() ? comment.trim() : null,
                evidenceId: evidenceId || null,
              },
              ifMatch: testVersion,
            });
          }}
        >
          {runner.alert}
          <fieldset className="field" aria-describedby={`${name}-text`}>
            <legend className="field__label">{t("launchHealthP5.day90.response", { n: q.ordinal })}</legend>
            {(["yes", "no"] as const).map((v) => (
              <label key={v} className="radio">
                <input type="radio" name={name} value={v} checked={answer === v} onChange={() => setAnswer(v)} />{" "}
                {t(`launchHealthP5.day90.answer.${v}`)}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label className="field__label" htmlFor={`${name}-comment`}>
              {t("launchHealthP5.day90.comment", { n: q.ordinal })}
            </label>
            <textarea
              id={`${name}-comment`}
              rows={2}
              maxLength={2000}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          {q.evidenceSuggestions.some((s) => s.recordType === "evidence") ? (
            <div className="field">
              <label className="field__label" htmlFor={`${name}-evidence`}>
                {t("launchHealthP5.day90.evidence", { n: q.ordinal })}
              </label>
              <select id={`${name}-evidence`} value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}>
                <option value="">{t("launchHealthP5.day90.noEvidence")}</option>
                {q.evidenceSuggestions
                  .filter((s) => s.recordType === "evidence")
                  .map((s) => (
                    <option key={s.recordId} value={s.recordId}>
                      {s.label}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}
          <div className="form__actions">
            <button type="submit" className="button" disabled={runner.busy || !answer}>
              {t("launchHealthP5.day90.save", { n: q.ordinal })}
            </button>
          </div>
        </form>
      ) : q.response?.comment ? (
        <p>{q.response.comment}</p>
      ) : null}
    </li>
  );
}
