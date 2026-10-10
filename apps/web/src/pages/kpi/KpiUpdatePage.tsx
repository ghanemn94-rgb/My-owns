// My Work > Update KPI (T-DG4-FE-B; REQ-S07-017, REQ-S07-003, REQ-S07-012; ADR-0027 §6, §8). SYNTHETIC data only.
// The routine update is ONE form in four numbered steps that a keyboard-only user completes in order:
//   1. open the KPI (its unit, frequency, active version and submission route are shown),
//   2. select the reporting period (open periods of the KPI's frequency),
//   3. enter the value, or state that it is not available (with a reason), and attach evidence,
//   4. submit (or save a draft, which is clearly NOT submitted).
// The confirmation lists the downstream views the accepted value changes, says whether review is pending, and shows
// the Finance review state ("Finance review pending" / not needed / Unknown). A second entry for the same KPI, scope and
// period is value version N+1 of the same slot (addKpiActualValue, If-Match), never a second row.
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { hasText, measureDecimal } from "@mth/shared/schemas";
import { ApiError, api } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { useInitiatives } from "../../api/portfolio.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Field, REQUIRED_CODE, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { ErrorState, LoadingState, QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { fieldErrorMessage } from "../../lib/problem.ts";
import { FormAlert, textOf } from "../my-work/p4ui.tsx";
import {
  kpiPaths,
  useEvidenceOptions,
  useKpiActuals,
  useKpiDictionaryEntry,
  usePeriodChoices,
  type KpiActual,
  type KpiActualSubmission,
  type KpiDictionaryEntry,
  type KpiVersion,
} from "./api.ts";
import { ActualStatusChip, BusinessDate, formatKpiValue, KpiSubNav, NS, toStoredValue, ValueState } from "./ui.tsx";

export function KpiUpdatePage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="define"
      title={t("kpiP4.update.title")}
      subtitle={t("kpiP4.update.intro")}
      writePermissions={["kpi_actual.submit"]}
    >
      <UpdateBody />
    </WorkspaceFrame>
  );
}

function UpdateBody() {
  const ws = useWorkspace();
  const { kpiId = "" } = useParams();
  const entry = useKpiDictionaryEntry(ws.tid, kpiId);
  return (
    <>
      <KpiSubNav tid={ws.tid} kpiId={kpiId} />
      <QueryState query={entry}>{(e) => <UpdateForm entry={e} />}</QueryState>
      <ActualsList kpiId={kpiId} />
    </>
  );
}

type Mode = "value" | "not_available";

interface Values {
  scopeId: string;
  periodId: string;
  mode: Mode;
  value: string;
  numerator: string;
  denominator: string;
  milestone: "" | "yes" | "no";
  achievedOn: string;
  missingReason: string;
  dataAsOf: string;
  comment: string;
  evidenceIds: string[];
}

/** Today's date (YYYY-MM-DD) in the transformation's time zone: the default "data as of" when the period's end is unknown. */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

/** The value fields a version asks for (ADR-0027 §6): ratio → numerator and denominator; milestone → achieved. */
export function valueShape(v: KpiVersion): "ratio" | "milestone" | "value" {
  if (v.measureType === "binary_milestone" || v.valueNature === "milestone") return "milestone";
  if (v.valueNature === "ratio") return "ratio";
  return "value";
}

/** Builds the request body of the routine update; returns field errors instead when a rule fails. */
export function buildEntry(
  values: Values,
  version: KpiVersion,
  action: "save_draft" | "submit",
): { body: Record<string, unknown> } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const body: Record<string, unknown> = { action, dataAsOf: values.dataAsOf };
  if (!values.dataAsOf) errors["dataAsOf"] = REQUIRED_CODE;
  const dec = (name: "value" | "numerator" | "denominator", asPercent: boolean) => {
    const raw = values[name].trim();
    if (raw === "") {
      errors[name] = values[name] === "" ? REQUIRED_CODE : BLANK_CODE;
      return null;
    }
    if (!measureDecimal.safeParse(raw).success) {
      errors[name] = "validation.decimal";
      return null;
    }
    const stored = asPercent ? toStoredValue(raw, version.unitKind) : raw;
    if (!measureDecimal.safeParse(stored).success) errors[name] = "validation.decimal";
    return stored;
  };
  if (values.mode === "not_available") {
    if (values.missingReason === "") errors["missingReason"] = REQUIRED_CODE;
    else if (!hasText(values.missingReason)) errors["missingReason"] = BLANK_CODE;
    else body["missingReason"] = values.missingReason.trim();
  } else {
    const shape = valueShape(version);
    if (shape === "ratio") {
      body["numerator"] = dec("numerator", false);
      body["denominator"] = dec("denominator", false);
    } else if (shape === "milestone") {
      if (values.milestone === "") errors["milestone"] = REQUIRED_CODE;
      body["milestoneAchieved"] = values.milestone === "yes";
      if (values.milestone === "yes") {
        if (!values.achievedOn) errors["achievedOn"] = REQUIRED_CODE;
        else body["achievedOn"] = values.achievedOn;
      }
    } else {
      body["value"] = dec("value", true);
      if (version.unitKind === "currency" && version.currency) body["currency"] = version.currency;
    }
  }
  const comment = textOf(values.comment);
  if (values.comment !== "" && !comment) errors["comment"] = BLANK_CODE;
  if (comment) body["comment"] = comment.trim();
  if (action === "submit" && version.dataQuality.evidenceRequired && values.evidenceIds.length === 0)
    errors["evidenceIds"] = "kpi_actual.evidence_required";
  if (values.evidenceIds.length > 0) body["evidenceIds"] = values.evidenceIds;
  return Object.keys(errors).length > 0 ? { errors } : { body };
}

function UpdateForm({ entry }: { entry: KpiDictionaryEntry }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const version = entry.activeVersion;
  const kpiId = entry.definition.id;
  const canSubmit = ws.can("kpi_actual.submit");
  const periodChoices = usePeriodChoices(ws.tid, version?.frequency, true);
  const actuals = useKpiActuals(ws.tid, kpiId);
  const evidence = useEvidenceOptions(ws.tid, canSubmit);
  const initiatives = useInitiatives(version?.entryScopeKind === "initiative" ? ws.tid : "");
  const refresh = useP4Refresh(ws.tid);
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusFirstInvalid(formRef);
  const confirmRef = useRef<HTMLDivElement>(null);
  const scopeKind = version?.entryScopeKind ?? "transformation";
  const fixedScope =
    scopeKind === "transformation" ? ws.tid : scopeKind === "business_unit" ? ws.tr.businessUnitId : "";
  const [values, setValues] = useState<Values>({
    scopeId: fixedScope,
    periodId: "",
    mode: "value",
    value: "",
    numerator: "",
    denominator: "",
    milestone: "",
    achievedOn: "",
    missingReason: "",
    dataAsOf: "",
    comment: "",
    evidenceIds: [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KpiActualSubmission | null>(null);

  useEffect(() => {
    if (result) confirmRef.current?.focus();
  }, [result]);

  if (!version)
    return (
      <div className="banner banner--warning" role="note" data-state="no-active-version">
        <p>
          <Icon name="alert" /> {t("problems.kpi_actual__no_active_version")}
        </p>
        <p>
          <Link className="link" to={`/transformations/${ws.tid}/kpis/${kpiId}`}>
            {t("kpiP4.update.openVersions")}
          </Link>
        </p>
      </div>
    );

  const openPeriods = periodChoices.choices;
  const period = openPeriods.find((p) => p.id === values.periodId) ?? null;
  const slot: KpiActual | null =
    (actuals.data ?? []).find(
      (a) => a.reportingPeriodId === values.periodId && a.scopeId === values.scopeId && a.scopeKind === scopeKind,
    ) ?? null;
  const shape = valueShape(version);
  const set = <K extends keyof Values>(k: K, v: Values[K]) => setValues((x) => ({ ...x, [k]: v }));
  const err = (k: string) => (errors[k] ? fieldErrorMessage(t, errors[k]!) : undefined);
  const pct = version.unitKind === "percentage";

  const send = async (action: "save_draft" | "submit") => {
    setServerError(null);
    const next: Record<string, string> = {};
    if (!values.scopeId) next["scopeId"] = REQUIRED_CODE;
    if (!values.periodId) next["periodId"] = REQUIRED_CODE;
    const built = buildEntry(values, version, action);
    if ("errors" in built) Object.assign(next, built.errors);
    setErrors(next);
    if (Object.keys(next).length > 0 || "errors" in built) {
      focusInvalid();
      return;
    }
    const guard = beginSessionGuard();
    setBusy(true);
    try {
      let answer: KpiActualSubmission;
      if (slot) {
        answer = await api.send<KpiActualSubmission>(kpiPaths.actualValues(ws.tid, slot.id), {
          method: "POST",
          body: built.body,
          ifMatch: slot.version,
        });
      } else {
        answer = await api.send<KpiActualSubmission>(kpiPaths.actuals(ws.tid, kpiId), {
          method: "POST",
          body: { scopeKind, scopeId: values.scopeId, reportingPeriodId: values.periodId, ...built.body },
        });
      }
      if (guard.stale()) return;
      setResult(answer);
      await refresh();
    } catch (e) {
      if (guard.stale(e)) return;
      setServerError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
    } finally {
      setBusy(false);
    }
  };

  /** Submits the saved draft value as it is (submitKpiActualDraft; body-less, If-Match). */
  const submitSavedDraft = async (draft: KpiActual) => {
    setServerError(null);
    const guard = beginSessionGuard();
    setBusy(true);
    try {
      const answer = await api.send<KpiActualSubmission>(kpiPaths.submitDraft(ws.tid, draft.id), {
        method: "POST",
        ifMatch: draft.version,
      });
      if (guard.stale()) return;
      setResult(answer);
      await refresh();
    } catch (e) {
      if (guard.stale(e)) return;
      setServerError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void send("submit");
  };

  if (result)
    return (
      <Confirmation
        result={result}
        kpiName={entry.definition.name}
        onAnother={() => setResult(null)}
        confirmRef={confirmRef}
      />
    );

  return (
    <Section
      id="kpi-update"
      title={t("kpiP4.update.formTitle", { name: entry.definition.name })}
      intro={t("kpiP4.update.formIntro")}
    >
      {!canSubmit ? (
        <p className="banner banner--info" role="note" data-state="read-only">
          <Icon name="lock" /> {t("kpiP4.update.readOnly")}
        </p>
      ) : null}
      <form ref={formRef} className="form" onSubmit={onSubmit} noValidate aria-describedby="kpi-update-steps">
        <p id="kpi-update-steps" className="small muted">
          {t("kpiP4.update.steps")}
        </p>
        <FormAlert error={serverError} namespaces={NS} />
        <fieldset className="step-fieldset" data-step="1">
          <legend>{t("kpiP4.update.step1")}</legend>
          <dl className="details">
            <div>
              <dt>{t("kpiP4.field.kpi")}</dt>
              <dd>{entry.definition.name}</dd>
            </div>
            <div>
              <dt>{t("kpi.definition.unitKind")}</dt>
              <dd>
                {t(`kpi.definition.unitKinds.${version.unitKind}`)}
                {version.currency ? ` · ${version.currency}` : ""}
                {version.unitLabel ? ` · ${version.unitLabel}` : ""}
              </dd>
            </div>
            <div>
              <dt>{t("kpi.definition.frequency")}</dt>
              <dd>{t(`kpi.definition.frequencies.${version.frequency}`)}</dd>
            </div>
            <div>
              <dt>{t("kpiP4.field.activeVersion")}</dt>
              <dd>
                {t("kpiP4.version.label", { n: version.versionNo })} ·{" "}
                {version.submissionRoute === "review"
                  ? t("kpiP4.update.routeReview", { party: version.reviewerPartyCode ?? "" })
                  : t("kpiP4.update.routeDirect")}
              </dd>
            </div>
          </dl>
          {scopeKind === "initiative" ? (
            <Field label={t("kpiP4.scopeKind.initiative")} required error={err("scopeId")}>
              {(c) => (
                <select
                  {...c}
                  data-field="scopeId"
                  value={values.scopeId}
                  onChange={(e) => set("scopeId", e.target.value)}
                >
                  <option value="">{t("common.form.choose")}</option>
                  {(initiatives.data ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code} · {i.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </fieldset>

        <fieldset className="step-fieldset" data-step="2">
          <legend>{t("kpiP4.update.step2")}</legend>
          {periodChoices.pending ? (
            <LoadingState />
          ) : periodChoices.error ? (
            <ErrorState error={periodChoices.error} />
          ) : (
            <>
              {openPeriods.length === 0 ? (
                <p className="banner banner--warning" role="note" data-state="no-open-period">
                  <Icon name="alert" />{" "}
                  {t("kpiP4.update.noOpenPeriod", { frequency: t(`kpi.definition.frequencies.${version.frequency}`) })}
                </p>
              ) : (
                <Field
                  label={t("kpiP4.field.period")}
                  required
                  error={err("periodId")}
                  hint={t("kpiP4.update.periodHint")}
                >
                  {(c) => (
                    <select
                      {...c}
                      data-field="periodId"
                      value={values.periodId}
                      onChange={(e) => {
                        const p = openPeriods.find((x) => x.id === e.target.value);
                        setValues((x) => ({
                          ...x,
                          periodId: e.target.value,
                          dataAsOf: x.dataAsOf || (p?.end ?? todayIn(ws.tr.timezone)),
                        }));
                      }}
                    >
                      <option value="">{t("common.form.choose")}</option>
                      {openPeriods.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.start && p.end ? `${p.label} (${p.start} – ${p.end})` : p.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
            </>
          )}
          {period ? (
            <p className="small muted">
              {t("kpiP4.period.updateDue")}:{" "}
              {period.updateDueDate ? (
                <BusinessDate date={period.updateDueDate} />
              ) : (
                <ValueState status="unknown" reason="kpi.due_date_unknown" />
              )}
            </p>
          ) : null}
          {slot ? (
            <p className="banner banner--info" role="note" data-state="existing-slot">
              <Icon name="info" />{" "}
              {t("kpiP4.update.existingSlot", { n: slot.currentValueNo, next: slot.currentValueNo + 1 })}{" "}
              <ActualStatusChip status={slot.status} />
              {slot.status === "draft" && canSubmit ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    data-action="submit-saved-draft"
                    disabled={busy}
                    onClick={() => void submitSavedDraft(slot)}
                  >
                    {t("kpiP4.update.submitSavedDraft", { n: slot.currentValueNo })}
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="step-fieldset" data-step="3">
          <legend>{t("kpiP4.update.step3")}</legend>
          <fieldset className="plain-fieldset">
            <legend className="field__label">{t("kpiP4.update.valueOrMissing")}</legend>
            <label className="checkbox">
              <input
                type="radio"
                name="mode"
                value="value"
                checked={values.mode === "value"}
                onChange={() => set("mode", "value")}
              />
              {t("kpiP4.update.enterValue")}
            </label>
            <label className="checkbox">
              <input
                type="radio"
                name="mode"
                value="not_available"
                checked={values.mode === "not_available"}
                onChange={() => set("mode", "not_available")}
              />
              {t("kpiP4.update.notAvailable")}
            </label>
          </fieldset>
          {values.mode === "not_available" ? (
            <Field
              label={t("kpiP4.update.missingReason")}
              required
              error={err("missingReason")}
              hint={t("kpiP4.update.missingHint")}
            >
              {(c) => (
                <textarea
                  {...c}
                  data-field="missingReason"
                  rows={2}
                  maxLength={1000}
                  value={values.missingReason}
                  onChange={(e) => set("missingReason", e.target.value)}
                />
              )}
            </Field>
          ) : shape === "ratio" ? (
            <>
              <Field
                label={version.numeratorLabel ?? t("kpiP4.version.numeratorLabel")}
                required
                error={err("numerator")}
                hint={t("kpi.decimalHint")}
              >
                {(c) => (
                  <input
                    {...c}
                    data-field="numerator"
                    dir="ltr"
                    inputMode="decimal"
                    value={values.numerator}
                    onChange={(e) => set("numerator", e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={version.denominatorLabel ?? t("kpiP4.version.denominatorLabel")}
                required
                error={err("denominator")}
                hint={t("kpi.decimalHint")}
              >
                {(c) => (
                  <input
                    {...c}
                    data-field="denominator"
                    dir="ltr"
                    inputMode="decimal"
                    value={values.denominator}
                    onChange={(e) => set("denominator", e.target.value)}
                  />
                )}
              </Field>
            </>
          ) : shape === "milestone" ? (
            <>
              <Field label={t("kpiP4.update.milestoneAchieved")} required error={err("milestone")}>
                {(c) => (
                  <select
                    {...c}
                    data-field="milestone"
                    value={values.milestone}
                    onChange={(e) => set("milestone", e.target.value as Values["milestone"])}
                  >
                    <option value="">{t("common.form.choose")}</option>
                    <option value="yes">{t("kpiP4.update.achievedYes")}</option>
                    <option value="no">{t("kpiP4.update.achievedNo")}</option>
                  </select>
                )}
              </Field>
              {values.milestone === "yes" ? (
                <Field label={t("kpiP4.update.achievedOn")} required error={err("achievedOn")}>
                  {(c) => (
                    <input
                      {...c}
                      data-field="achievedOn"
                      type="date"
                      value={values.achievedOn}
                      onChange={(e) => set("achievedOn", e.target.value)}
                    />
                  )}
                </Field>
              ) : null}
            </>
          ) : (
            <Field
              label={`${t("kpiP4.field.actual")}${version.currency ? ` (${version.currency})` : pct ? " (%)" : version.unitLabel ? ` (${version.unitLabel})` : ""}`}
              required
              error={err("value")}
              hint={pct ? t("kpiP4.version.percentHint") : t("kpi.decimalHint")}
            >
              {(c) => (
                <input
                  {...c}
                  data-field="value"
                  dir="ltr"
                  inputMode="decimal"
                  value={values.value}
                  onChange={(e) => set("value", e.target.value)}
                />
              )}
            </Field>
          )}
          <Field
            label={t("kpiP4.field.dataAsOf")}
            required
            error={err("dataAsOf")}
            hint={t("kpiP4.update.dataAsOfHint")}
          >
            {(c) => (
              <input
                {...c}
                data-field="dataAsOf"
                type="date"
                value={values.dataAsOf}
                onChange={(e) => set("dataAsOf", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("kpiP4.action.comment")} error={err("comment")}>
            {(c) => (
              <textarea
                {...c}
                data-field="comment"
                rows={2}
                maxLength={4000}
                value={values.comment}
                onChange={(e) => set("comment", e.target.value)}
              />
            )}
          </Field>
          <fieldset
            className={`plain-fieldset field${errors["evidenceIds"] ? " field--invalid" : ""}`}
            data-field="evidenceIds"
            aria-describedby="kpi-evidence-hint"
          >
            <legend className="field__label">
              {t("kpiP4.field.evidence")}
              {version.dataQuality.evidenceRequired ? (
                <span className="field__required"> ({t("common.form.required")})</span>
              ) : null}
            </legend>
            <p id="kpi-evidence-hint" className="field__hint">
              {version.dataQuality.evidenceRequired
                ? t("kpiP4.update.evidenceRequired")
                : t("kpiP4.update.evidenceOptional")}
            </p>
            {(evidence.data ?? []).length === 0 ? (
              <p className="muted small">
                {t("kpiP4.update.noEvidence")}{" "}
                <Link className="link" to={`/transformations/${ws.tid}/evidence`}>
                  {t("kpiP4.update.addEvidence")}
                </Link>
              </p>
            ) : (
              <ul className="plain-list">
                {(evidence.data ?? []).map((e) => (
                  <li key={e.id}>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        aria-invalid={errors["evidenceIds"] ? true : undefined}
                        checked={values.evidenceIds.includes(e.id)}
                        onChange={(ev) =>
                          set(
                            "evidenceIds",
                            ev.target.checked
                              ? [...values.evidenceIds, e.id]
                              : values.evidenceIds.filter((x) => x !== e.id),
                          )
                        }
                      />
                      {e.title}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {errors["evidenceIds"] ? (
              <p className="field__error">
                <Icon name="alert" /> {t("problems.kpi_actual__evidence_required")}
              </p>
            ) : null}
          </fieldset>
        </fieldset>

        <fieldset className="step-fieldset" data-step="4">
          <legend>{t("kpiP4.update.step4")}</legend>
          <p className="small muted">
            {version.submissionRoute === "review"
              ? t("kpiP4.update.submitReviewNote")
              : t("kpiP4.update.submitDirectNote")}
          </p>
          <div className="form__actions">
            <button
              type="submit"
              className="button button--primary"
              disabled={busy || !canSubmit}
              data-action="submit-actual"
            >
              {busy ? t("common.state.saving") : t("kpiP4.update.submit")}
            </button>
            <button
              type="button"
              className="button button--secondary"
              disabled={busy || !canSubmit}
              data-action="save-draft"
              onClick={() => void send("save_draft")}
            >
              {t("kpiP4.update.saveDraft")}
            </button>
          </div>
          <p className="small muted">{t("kpiP4.update.draftNote")}</p>
        </fieldset>
      </form>
    </Section>
  );
}

function Confirmation({
  result,
  kpiName,
  onAnother,
  confirmRef,
}: {
  result: KpiActualSubmission;
  kpiName: string;
  onAnother: () => void;
  confirmRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const a = result.actual;
  const draft = a.status === "draft";
  return (
    <div
      ref={confirmRef}
      tabIndex={-1}
      className="card section"
      role="status"
      data-state="kpi-update-confirmation"
      data-actual-status={a.status}
      data-review-pending={String(result.reviewPending)}
      data-finance-review={result.financeReview}
    >
      <h2 className="card__title">
        {draft ? t("kpiP4.confirm.draftTitle", { name: kpiName }) : t("kpiP4.confirm.title", { name: kpiName })}
      </h2>
      <p>
        <ActualStatusChip status={a.status} /> {t("kpiP4.confirm.slot", { period: a.periodLabel, n: a.currentValueNo })}
      </p>
      <ul className="plain-list">
        <li data-confirm="review">
          {draft ? (
            <>
              <Icon name="pencil" /> {t("kpiP4.confirm.draftNotSubmitted")}
            </>
          ) : result.reviewPending ? (
            <>
              <Icon name="clock" /> <strong>{t("kpiP4.confirm.reviewPending")}</strong>
            </>
          ) : (
            <>
              <Icon name="check" /> {t("kpiP4.confirm.accepted")}
            </>
          )}
        </li>
        <li data-confirm="finance">
          <Icon
            name={
              result.financeReview === "pending" ? "clock" : result.financeReview === "unknown" ? "question" : "info"
            }
          />{" "}
          {result.financeReview === "pending" ? (
            <strong>{t("kpiP4.confirm.finance.pending")}</strong>
          ) : (
            t(`kpiP4.confirm.finance.${result.financeReview}`)
          )}
        </li>
      </ul>
      <h3 className="small-heading">{draft ? t("kpiP4.confirm.downstreamDraft") : t("kpiP4.confirm.downstream")}</h3>
      {result.downstream.length === 0 ? (
        <p className="muted">{t("kpiP4.confirm.noDownstream")}</p>
      ) : (
        <ul data-downstream={result.downstream.length}>
          {result.downstream.map((d, i) => (
            <li key={`${d.kind}:${d.id ?? i}`} data-downstream-kind={d.kind}>
              {d.kind === "kpi_panel" || d.kind === "formula_kpi" ? (
                <Link className="link" to={`/transformations/${ws.tid}/kpis/${d.id ?? ""}`}>
                  {t(`kpiP4.downstream.${d.kind}`)}
                </Link>
              ) : (
                t(`kpiP4.downstream.${d.kind}`)
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="form__actions">
        <Link
          className="button button--secondary"
          to={`/transformations/${ws.tid}/kpis/${a.kpiDefinitionId}/actuals/${a.id}`}
        >
          {t("kpiP4.confirm.openActual")}
        </Link>
        <button type="button" className="button button--secondary" onClick={onAnother}>
          {t("kpiP4.confirm.another")}
        </button>
      </p>
    </div>
  );
}

function ActualsList({ kpiId }: { kpiId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const actuals = useKpiActuals(ws.tid, kpiId);
  const entry = useKpiDictionaryEntry(ws.tid, kpiId);
  const unitKind = entry.data?.activeVersion?.unitKind ?? entry.data?.definition.unitKind ?? "other";
  const currency = entry.data?.activeVersion?.currency ?? entry.data?.definition.currency ?? null;
  const columns: RegisterColumn<KpiActual>[] = [
    {
      id: "period",
      header: t("kpiP4.field.period"),
      rowHeader: true,
      hideable: false,
      cell: (a) => (
        <Link className="link" to={`/transformations/${ws.tid}/kpis/${kpiId}/actuals/${a.id}`}>
          <bdi dir="ltr">{a.periodLabel}</bdi>
        </Link>
      ),
      sortValue: (a) => a.periodStart,
    },
    {
      id: "status",
      header: t("kpiP4.field.status"),
      cell: (a) => <ActualStatusChip status={a.status} />,
      sortValue: (a) => a.status,
    },
    {
      id: "value",
      header: t("kpiP4.actual.current"),
      cell: (a) => {
        const v = a.values.find((x) => x.valueNo === a.currentValueNo);
        if (!v) return <ValueState status="unknown" />;
        if (v.missingReason) return <ValueState status="unknown" reason="kpi.value_not_available" />;
        if (v.value === null) return <ValueState status="unknown" />;
        return <bdi dir="ltr">{formatKpiValue(v.value, unitKind, currency, locale)}</bdi>;
      },
    },
    {
      id: "valueNo",
      header: t("kpiP4.actual.valueNo"),
      cell: (a) => a.currentValueNo,
      sortValue: (a) => a.currentValueNo,
    },
    {
      id: "accepted",
      header: t("kpiP4.actual.acceptedValueNo"),
      cell: (a) =>
        a.acceptedValueNo === null ? (
          <span className="muted">{t("kpiP4.actual.noneAccepted")}</span>
        ) : (
          a.acceptedValueNo
        ),
    },
    {
      id: "updated",
      header: t("kpiP4.field.updatedAt"),
      cell: (a) => formatDateTime(a.updatedAt, locale, ws.tr.timezone),
      sortValue: (a) => a.updatedAt,
    },
  ];
  return (
    <Section id="kpi-actuals" title={t("kpiP4.actual.listTitle")} intro={t("kpiP4.actual.listIntro")}>
      <QueryState query={actuals}>
        {(rows) => (
          <RegisterTable
            id="kpi-actuals"
            caption={t("kpiP4.actual.listTitle")}
            rows={rows}
            columns={columns}
            getRowId={(a) => a.id}
            emptyTitle={t("kpiP4.actual.empty")}
            defaultSort={{ id: "period", dir: "desc" }}
          />
        )}
      </QueryState>
    </Section>
  );
}
