// Scorecard per initiative (REQ-PB-047, REQ-PB-048; ADR-0022 §2). Each criterion of the ACTIVE weight set takes a
// whole number 1-5; anything else (6, 0, 2.5, text) is refused inline (prioritization.score_range) and nothing is
// sent. The weighted score is READ-ONLY: it is the server's result, shown with 2 decimals, or 'incomplete' with the
// missing criteria when any score is missing (never a number, never 0). New scores are POSTed; existing ones are
// PATCHed with If-Match; a 409 shows the conflict notice and reloads.
import type { InitiativeScore, PrioritizationItem, WeightSet } from "@mth/shared/schemas";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.ts";
import { useP3Refresh } from "../../api/queries.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Field, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { prioritizationUrls, useScoreSheet } from "./api.ts";
import { ConflictNotice, FormAlert, codeText, isVersionConflict, p3ErrorMessage, useDecimal } from "./p3ui.tsx";

/** The only accepted inputs, mapped to the contract's integer (no Number()/parseInt on user text). */
const SCORE_VALUES: Record<string, number> = { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5 };

export function ScorecardSection({
  items,
  weightSet,
  initiativeId,
  onSelect,
}: {
  items: readonly PrioritizationItem[];
  weightSet: WeightSet;
  initiativeId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Section id="scorecard" title={t("prioritization.scorecard.title")} intro={t("prioritization.scorecard.intro")}>
      <div className="filters">
        <div className="filters__select">
          <label htmlFor="scorecard-initiative">{t("prioritization.scorecard.initiative")}</label>
          <select
            id="scorecard-initiative"
            value={initiativeId ?? ""}
            onChange={(e) => onSelect(e.target.value || null)}
          >
            <option value="">{t("common.form.choose")}</option>
            {items.map((i) => (
              <option key={i.initiative.id} value={i.initiative.id}>
                {i.initiative.code} · {i.initiative.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {initiativeId ? (
        <ScoreSheet key={initiativeId} initiativeId={initiativeId} weightSet={weightSet} />
      ) : (
        <p className="muted">{t("prioritization.scorecard.choose")}</p>
      )}
    </Section>
  );
}

function ScoreSheet({ initiativeId, weightSet }: { initiativeId: string; weightSet: WeightSet }) {
  const { tid } = useWorkspace();
  const sheet = useScoreSheet(tid, initiativeId);
  return (
    <QueryState query={sheet}>
      {(data) => (
        <ScoreForm initiativeId={initiativeId} weightSet={weightSet} scores={data.scores} result={data.result} />
      )}
    </QueryState>
  );
}

function ScoreForm({
  initiativeId,
  weightSet,
  scores,
  result,
}: {
  initiativeId: string;
  weightSet: WeightSet;
  scores: readonly InitiativeScore[];
  result: {
    completeness: "complete" | "incomplete";
    weightedScore: string | null;
    missingCriteria: readonly string[];
    weightSetVersionNo: number;
  };
}) {
  const { t } = useTranslation();
  const { tid, can } = useWorkspace();
  const refresh = useP3Refresh(tid);
  const fmt = useDecimal();
  const editable = can("prioritization.score");
  const byCode = new Map(scores.map((s) => [s.criterionCode, s]));
  const initial = () =>
    Object.fromEntries(
      weightSet.weights.map((w) => {
        const s = byCode.get(w.criterionCode)?.score;
        return [w.criterionCode, s === null || s === undefined ? "" : String(s)];
      }),
    );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);
  // A reload (after a save or a conflict) brings new versions: the inputs follow the saved values.
  const signature = scores.map((s) => `${s.criterionCode}:${s.version}`).join(",");
  useEffect(() => {
    setValues(initial());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the stored versions change
  }, [signature]);

  const save = async () => {
    setSaved(false);
    setServerError(null);
    const errs: Record<string, string> = {};
    for (const w of weightSet.weights) {
      const v = (values[w.criterionCode] ?? "").trim();
      if (v !== "" && SCORE_VALUES[v] === undefined) errs[w.criterionCode] = "prioritization.score_range";
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      for (const w of weightSet.weights) {
        const code = w.criterionCode;
        const v = (values[code] ?? "").trim();
        const existing = byCode.get(code);
        const next = v === "" ? null : SCORE_VALUES[v]!;
        const current = existing?.score ?? null;
        if (next === current) continue;
        if (existing) {
          await api.send(prioritizationUrls.score(initiativeId, code), {
            method: "PATCH",
            body: { score: next },
            ifMatch: existing.version,
          });
        } else if (next !== null) {
          await api.send(prioritizationUrls.scores(initiativeId), {
            method: "POST",
            body: { criterionCode: code, score: next },
          });
        }
        if (action.stale()) return;
      }
      if (!(await refresh())) return;
      if (action.stale()) return;
      setSaved(true);
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        setConflict(true);
        await refresh();
        return;
      }
      // A 400 at /score (e.g. 6) lands on the field when the server names it.
      setServerError(e);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const complete = result.completeness === "complete" && result.weightedScore !== null;
  return (
    <form
      ref={ref}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-label={t("prioritization.scorecard.formLabel")}
    >
      {conflict ? <ConflictNotice onDismiss={() => setConflict(false)} /> : null}
      <FormAlert message={serverError ? p3ErrorMessage(t, serverError) : null} />
      <div className="grid grid--3">
        {weightSet.weights.map((w) => (
          <Field
            key={w.criterionCode}
            label={t("prioritization.scorecard.scoreFor", {
              criterion: t(`prioritization.criterion.${w.criterionCode}`),
              weight: fmt(w.weightPercent, 0, 2),
            })}
            hint={t("prioritization.scorecard.scoreHint")}
            error={errors[w.criterionCode] ? (codeText(t, errors[w.criterionCode]!) ?? undefined) : undefined}
          >
            {(control) => (
              <input
                {...control}
                type="number"
                min={1}
                max={5}
                step={1}
                inputMode="numeric"
                dir="ltr"
                name={w.criterionCode}
                value={values[w.criterionCode] ?? ""}
                readOnly={!editable}
                onChange={(e) => setValues({ ...values, [w.criterionCode]: e.target.value })}
              />
            )}
          </Field>
        ))}
      </div>
      <div className="field">
        <span className="field__label" id="weighted-label">
          {t("prioritization.scorecard.weighted", { n: result.weightSetVersionNo })}
        </span>
        <output aria-labelledby="weighted-label" data-testid="weighted-score" data-completeness={result.completeness}>
          {complete ? (
            <strong>
              <bdi>{fmt(result.weightedScore, 2, 2)}</bdi>
            </strong>
          ) : (
            <span className="status-chip status-chip--unknown">{t("prioritization.incomplete")}</span>
          )}
        </output>
        {!complete && result.missingCriteria.length > 0 ? (
          <p className="field__hint">
            {t("prioritization.scorecard.missing", {
              criteria: result.missingCriteria
                .map((c) => t(`prioritization.criterion.${c}`))
                .join(t("prioritization.shared.listSeparator")),
            })}
          </p>
        ) : null}
        <p className="field__hint">{t("prioritization.scorecard.readOnly")}</p>
      </div>
      {editable ? (
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? t("common.state.saving") : t("prioritization.scorecard.save")}
          </button>
          {saved ? (
            <span role="status" className="muted">
              {t("common.state.saved")}
            </span>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
