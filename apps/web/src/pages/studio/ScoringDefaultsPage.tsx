// T06 default weights and scoring rubric in the Playbook Studio (T-DG5-FE-B; REQ-PB-093; ADR-0040 §5, ADR-0039 §2, §12):
// the methodology administrator edits the default weights (decimal strings, never floats) and the 1-5 rubric
// descriptors of each criterion in a scoring_defaults DRAFT and saves it (any total); publishing — from the version
// page, through the same pipeline — applies the 100 % rule (422 config_version.weights_total) and creates an immutable
// version that transformations created afterwards start from. Existing transformations keep their pinned weights and
// rubric until a deliberate migration. A missing descriptor is "No descriptor defined", never invented text. These are
// configuration defaults: the administrator never approves a transformation's weights (permissions matrix §5 rule 2).
import {
  SCORING_DEFAULT_CRITERIA,
  scoringDefaultsPut,
  weightPercent,
  type ScoringDefaultCriterion,
} from "@mth/shared/schemas";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { p5Paths, useConfigVersions, useStudioRefresh } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { Field, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDecimal } from "../../lib/format.ts";
import { fieldErrorMessage } from "../../lib/problem.ts";
import { ReadOnlyNote } from "../my-work/p4ui.tsx";
import { useDefaults, versionState, weightTotal, type ScoringDefaults } from "./api.ts";
import { ConfigurationNote, VersionStateChip, useActionRunner } from "./ui.tsx";

interface Draft {
  readonly weights: Record<ScoringDefaultCriterion, string>;
  readonly rubrics: Record<ScoringDefaultCriterion, { en: string[]; ar: string[] }>;
}

export function draftOf(d: ScoringDefaults): Draft {
  const weights = {} as Record<ScoringDefaultCriterion, string>;
  const rubrics = {} as Draft["rubrics"];
  for (const c of SCORING_DEFAULT_CRITERIA) {
    weights[c] = d.weights.find((w) => w.criterionCode === c)?.weightPercent ?? "";
    const r = d.rubrics.find((x) => x.criterionCode === c);
    rubrics[c] = {
      en: [1, 2, 3, 4, 5].map((s) => r?.levels.find((l) => l.score === s)?.descriptorEn ?? ""),
      ar: [1, 2, 3, 4, 5].map((s) => r?.levels.find((l) => l.score === s)?.descriptorAr ?? ""),
    };
  }
  return { weights, rubrics };
}

/** The PUT body: the included weights (a blank weight leaves the criterion out) and every criterion's five levels. */
export function bodyOf(d: Draft, rubricCriteria: readonly ScoringDefaultCriterion[]) {
  return {
    weights: SCORING_DEFAULT_CRITERIA.filter((c) => d.weights[c].trim() !== "").map((c) => ({
      criterionCode: c,
      weightPercent: d.weights[c].trim(),
    })),
    rubrics: rubricCriteria.map((c) => ({
      criterionCode: c,
      levels: [0, 1, 2, 3, 4].map((i) => ({
        score: i + 1,
        descriptorEn: d.rubrics[c].en[i]!.trim() === "" ? null : d.rubrics[c].en[i]!,
        descriptorAr: d.rubrics[c].ar[i]!.trim() === "" ? null : d.rubrics[c].ar[i]!,
      })),
    })),
  };
}

export function ScoringDefaultsPage() {
  const { t } = useTranslation();
  usePageTitle(t("studio.defaults.title"));
  const [params, setParams] = useSearchParams();
  const versionId = params.get("versionId");
  const defaults = useDefaults(versionId);
  const versions = useConfigVersions({ kind: "scoring_defaults" });
  const locale = useLocale();
  return (
    <div className="page" data-p5-screen="scoring-defaults">
      <PageHeader
        title={t("studio.defaults.title")}
        subtitle={t("studio.defaults.summary")}
        crumbs={[{ label: t("nav.p5.studio.title"), to: "/admin/studio" }, { label: t("studio.defaults.title") }]}
      />
      <ConfigurationNote />
      <div className="toolbar">
        <label>
          {t("studio.defaults.version")}{" "}
          <select
            value={versionId ?? ""}
            onChange={(e) => setParams(e.target.value ? { versionId: e.target.value } : {})}
          >
            <option value="">{t("studio.defaults.newestPublished")}</option>
            {(versions.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNo} · {t(`studio.state.${versionState(v)}`)} · {locale === "ar" ? v.titleAr : v.titleEn}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryState query={defaults}>{(d) => <DefaultsView key={d.versionId} defaults={d} />}</QueryState>
    </div>
  );
}

function DefaultsView({ defaults }: { defaults: ScoringDefaults }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useStudioRefresh();
  const runner = useActionRunner(refresh);
  const begin = useSessionBoundAction();
  const canEdit = canAnywhere(me, "methodology.configure");
  const isDraft = defaults.status === "draft";
  const editable = canEdit && isDraft;
  const [draft, setDraft] = useState<Draft>(() => draftOf(defaults));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusFirstInvalid(formRef);
  // A new server version (after a save, or a change elsewhere) reloads the form; a mere refetch keeps unsaved edits.
  const seenVersion = useRef(defaults.version);
  useEffect(() => {
    if (seenVersion.current === defaults.version) return;
    seenVersion.current = defaults.version;
    setDraft(draftOf(defaults));
  }, [defaults]);
  const rubricCriteria = useMemo(
    () => SCORING_DEFAULT_CRITERIA.filter((c) => defaults.rubrics.some((r) => r.criterionCode === c)),
    [defaults],
  );
  const total = weightTotal(SCORING_DEFAULT_CRITERIA.map((c) => draft.weights[c]).filter((w) => w.trim() !== ""));
  const state = versionState({
    status: defaults.status,
    draftStage: isDraft ? "editing" : null,
    isNewestPublished: defaults.isNewestPublished,
  });

  const save = async () => {
    setSaved(false);
    const next: Record<string, string> = {};
    for (const c of SCORING_DEFAULT_CRITERIA) {
      const w = draft.weights[c].trim();
      if (w !== "" && !weightPercent.safeParse(w).success) next[`w-${c}`] = "validation.weight_percent";
    }
    const body = bodyOf(draft, rubricCriteria);
    if (Object.keys(next).length === 0 && !scoringDefaultsPut.safeParse(body).success)
      next["form"] = "validation.invalid";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusInvalid();
      return;
    }
    const result = await runner.run(p5Paths.scoringDefaultsDraft(defaults.versionId), {
      method: "PUT",
      body,
      ifMatch: defaults.version,
    });
    if (result) setSaved(true);
  };

  const createDraft = async () => {
    const action = begin();
    const created = await runner.run<{ id: string }>(p5Paths.configVersions, {
      body: { basedOnVersionId: defaults.versionId },
    });
    if (created?.id) action.navigate(`/admin/studio/scoring-defaults?versionId=${created.id}`);
  };

  const setWeight = (c: ScoringDefaultCriterion, v: string) =>
    setDraft((d) => ({ ...d, weights: { ...d.weights, [c]: v } }));
  const setDescriptor = (c: ScoringDefaultCriterion, lang: "en" | "ar", i: number, v: string) =>
    setDraft((d) => {
      const levels = [...d.rubrics[c][lang]];
      levels[i] = v;
      return { ...d, rubrics: { ...d.rubrics, [c]: { ...d.rubrics[c], [lang]: levels } } };
    });

  return (
    <form
      ref={formRef}
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-labelledby="defaults-weights"
    >
      <p>
        <bdi dir="ltr">v{defaults.versionNo}</bdi> <VersionStateChip state={state} />{" "}
        <Link className="link" to={`/admin/studio/versions/${defaults.versionId}`}>
          {t("studio.defaults.openVersion")}
        </Link>
      </p>
      {!canEdit ? <ReadOnlyNote body={t("studio.readOnly")} /> : null}
      {canEdit && !isDraft ? (
        <p className="banner banner--info" role="note">
          <Icon name="lock" /> {t("studio.defaults.publishedNote")}{" "}
          <button type="button" className="button button--secondary button--small" onClick={() => void createDraft()}>
            {t("studio.defaults.createDraft")}
          </button>
        </p>
      ) : null}
      {runner.alert}
      {errors["form"] ? (
        <p className="field__error">
          <Icon name="alert" /> {fieldErrorMessage(t, errors["form"])}
        </p>
      ) : null}
      {saved ? (
        <p className="banner banner--success" role="status" data-state="saved-draft">
          <Icon name="check" /> {t("studio.defaults.savedDraft")}
        </p>
      ) : null}
      <section className="card" aria-labelledby="defaults-weights">
        <h2 id="defaults-weights" className="card__title">
          {t("studio.defaults.weights")}
        </h2>
        <p className="muted">{t("studio.defaults.weightsIntro")}</p>
        <div className="grid grid--3">
          {SCORING_DEFAULT_CRITERIA.map((c) => (
            <Field
              key={c}
              label={t(`studio.criterion.${c}`)}
              hint={t("studio.defaults.weightHint")}
              error={errors[`w-${c}`] ? fieldErrorMessage(t, errors[`w-${c}`]!) : undefined}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  data-weight={c}
                  value={draft.weights[c]}
                  readOnly={!editable}
                  onChange={(e) => setWeight(c, e.target.value)}
                />
              )}
            </Field>
          ))}
        </div>
        <p data-weight-total={total ?? "unknown"} aria-live="polite">
          <strong>{t("studio.defaults.total")}:</strong>{" "}
          {total === null ? (
            <span className="status-chip status-chip--unknown">
              <Icon name="question" /> {t("common.value.unknown")}
            </span>
          ) : (
            <>
              <bdi dir="ltr">{formatDecimal(total, locale, { minFractionDigits: 2, maxFractionDigits: 2 })} %</bdi>{" "}
              {total === "100.00" ? (
                <span className="status-chip status-chip--on-track">
                  <Icon name="check" /> {t("studio.defaults.totalOk")}
                </span>
              ) : (
                <span className="status-chip status-chip--at-risk">
                  <Icon name="alert" /> {t("studio.defaults.totalNot100")}
                </span>
              )}
            </>
          )}
        </p>
      </section>
      <section className="card" aria-labelledby="defaults-rubrics">
        <h2 id="defaults-rubrics" className="card__title">
          {t("studio.defaults.rubrics")}
        </h2>
        {rubricCriteria.map((c) => (
          <fieldset key={c} className="fieldset" data-rubric={c}>
            <legend>{t(`studio.criterion.${c}`)}</legend>
            <div className="table-wrap">
              <table className="table table--compact">
                <caption className="visually-hidden">{t(`studio.criterion.${c}`)}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("studio.defaults.score")}</th>
                    <th scope="col">{t("studio.defaults.descriptorEn")}</th>
                    <th scope="col">{t("studio.defaults.descriptorAr")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <tr key={i}>
                      <th scope="row">{i + 1}</th>
                      {(["en", "ar"] as const).map((lang) => (
                        <td key={lang}>
                          {editable ? (
                            <textarea
                              aria-label={t("studio.defaults.descriptorLabel", {
                                criterion: t(`studio.criterion.${c}`),
                                score: i + 1,
                                language: t(`common.language.name.${lang}`),
                              })}
                              dir={lang === "ar" ? "rtl" : "ltr"}
                              rows={2}
                              maxLength={500}
                              value={draft.rubrics[c][lang][i]}
                              onChange={(e) => setDescriptor(c, lang, i, e.target.value)}
                            />
                          ) : draft.rubrics[c][lang][i] ? (
                            <span dir={lang === "ar" ? "rtl" : "ltr"}>{draft.rubrics[c][lang][i]}</span>
                          ) : (
                            <span className="muted" data-descriptor="none">
                              {t("studio.defaults.noDescriptor")}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>
        ))}
      </section>
      {editable ? (
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={runner.busy}>
            {runner.busy ? t("common.state.saving") : t("studio.defaults.saveDraft")}
          </button>
          <span className="small muted">{t("studio.defaults.publishHint")}</span>
        </div>
      ) : null}
    </form>
  );
}
