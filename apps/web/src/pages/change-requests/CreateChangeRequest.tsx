// The "Raise a change request" form (T-DG4-FE-F2; ADR-0036 §1-§5; REQ-S04-014, REQ-S07-015, REQ-S09-010). A person
// chooses the subject (the record), the kind of change and the new values; the current values are shown and sent as
// `from` exactly as the server holds them (null = Unknown). A KPI request proposes the KPI's draft version; a benefit
// formula request names its current version. "Preview impact" calls the read-only previewChangeImpact and shows the
// materiality and the affected outcomes, KPIs, benefits, formulas, gates and reports before anything is saved.
// Creating saves a DRAFT only: nothing is routed or approved until the requester submits it. SYNTHETIC data only.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { CHANGE_SUBJECT_TYPES, type ChangeKind, type ChangeSubjectType, type ImpactPreview } from "@mth/shared/schemas";
import { api, ApiError } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { useInitiatives } from "../../api/portfolio.ts";
import { Icon } from "../../components/Icon.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { p4ProblemMessage, P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import { changePaths } from "./api.ts";
import { ImpactItemsTable, MaterialityText } from "./Impact.tsx";
import {
  editableFields,
  kindsFor,
  kpiVersionDiff,
  PER_INITIATIVE,
  useKpiVersionPair,
  useSubjectOptions,
  type SubjectOption,
} from "./subjects.ts";

export const CR_NS = ["changeRequestsP4"] as const;

const DECIMAL = /^-?[0-9]{1,16}(\.[0-9]{1,6})?$/;

/** Builds the createChangeRequest body from the form values, or the field errors that stop it. */
export function buildChangeRequestBody(
  v: P4Values,
  subject: SubjectOption | undefined,
  kpiDiff: Record<string, { from: unknown; to: unknown }> | null,
  /** The transformation's currency: the `currency` of a cost change on a subject that stores none (an initiative). */
  defaultCurrency = "SAR",
): Record<string, unknown> | { fieldErrors: Record<string, string> } {
  const subjectType = v["subjectType"] as ChangeSubjectType;
  const kind = v["changeKind"] as ChangeKind;
  if (!subject) return { fieldErrors: { subjectId: "validation.required" } };
  const change: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  let proposedRecord: { proposedRecordType: string; proposedRecordId: string } | null = null;
  if (subjectType === "kpi_definition") {
    if (!subject.kpiDraftVersionId) return { fieldErrors: { subjectId: "validation.invalid_value" } };
    if (!kpiDiff || Object.keys(kpiDiff).length === 0) return { fieldErrors: { subjectId: "validation.empty_patch" } };
    Object.assign(change, kpiDiff);
    proposedRecord = { proposedRecordType: "kpi_version", proposedRecordId: subject.kpiDraftVersionId };
  } else if (kind === "benefit_logic") {
    if (!subject.formulaCurrent) return { fieldErrors: { subjectId: "validation.invalid_value" } };
    const fromRaw = textOf(v["fromVersionNo"]);
    const fromNo = fromRaw === undefined ? null : Number(fromRaw);
    change["fromVersionNo"] = fromNo;
    change["toVersionNo"] = subject.formulaCurrent.versionNo;
    proposedRecord = { proposedRecordType: "benefit_formula_version", proposedRecordId: subject.formulaCurrent.id };
  } else {
    for (const f of editableFields(kind, subjectType)) {
      const raw = v[`to_${f.field}`];
      const to = typeof raw === "string" ? raw.trim() : "";
      if (to === "") continue;
      if (f.type === "decimal" && !DECIMAL.test(to)) {
        errors[`to_${f.field}`] = "validation.decimal";
        continue;
      }
      change[f.field] = { from: subject.values[f.field] ?? null, to };
    }
    if (Object.keys(errors).length > 0) return { fieldErrors: errors };
    if (Object.keys(change).length === 0) {
      const first = editableFields(kind, subjectType)[0];
      return { fieldErrors: { [first ? `to_${first.field}` : "changeKind"]: "validation.empty_patch" } };
    }
    if (kind === "cost" || kind === "budget_rebaseline")
      change["currency"] = subject.values["currency"] || defaultCurrency;
  }
  const effectiveFrom = textOf(v["effectiveFrom"]);
  if (effectiveFrom) change["effectiveFrom"] = effectiveFrom;
  return {
    changeKind: kind,
    subjectType,
    subjectId: subject.id,
    subjectVersion: subject.version,
    ...(proposedRecord ?? {}),
    proposedChange: change,
    reason: v["reason"],
  };
}

const isErrors = (x: unknown): x is { fieldErrors: Record<string, string> } =>
  typeof x === "object" && x !== null && "fieldErrors" in x;

export function CreateChangeRequestDialog({
  onClose,
  onDone,
  initial,
}: {
  onClose: () => void;
  onDone: (created: unknown) => Promise<boolean>;
  initial?: P4Values;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [values, setValues] = useState<P4Values>(initial ?? {});
  const subjectType = (typeof values["subjectType"] === "string" ? values["subjectType"] : "") as
    | ChangeSubjectType
    | "";
  const initiativeId = typeof values["initiativeId"] === "string" ? values["initiativeId"] : "";
  const kind = (typeof values["changeKind"] === "string" ? values["changeKind"] : "") as ChangeKind | "";
  const initiatives = useInitiatives(ws.tid);
  const subjects = useSubjectOptions(ws.tid, subjectType, initiativeId);
  const subject = subjects.options.find((o) => o.id === values["subjectId"]);
  const kpiVersions = useKpiVersionPair(ws.tid, subject?.id ?? "", subjectType === "kpi_definition");
  const active = (kpiVersions.data ?? []).find((x) => x.status === "active");
  const draft = (kpiVersions.data ?? []).find((x) => x.id === subject?.kpiDraftVersionId);
  const kpiDiff = active && draft ? kpiVersionDiff(active, draft) : null;
  const unknown = t("common.value.unknown");
  const shown = (x: string | null | undefined) => (x === null || x === undefined || x === "" ? unknown : x);

  const kinds = subjectType ? kindsFor(subjectType) : [];
  const fields: P4FieldSpec[] = [
    {
      name: "subjectType",
      label: t("changeRequestsP4.field.subjectType"),
      kind: "select",
      required: true,
      options: CHANGE_SUBJECT_TYPES.map((s) => ({ value: s, label: t(`changeRequestsP4.subjectType.${s}`) })),
    },
    {
      name: "initiativeId",
      label: t("changeRequestsP4.field.initiative"),
      kind: "select",
      required: true,
      when: (v) => PER_INITIATIVE.has(v["subjectType"] as ChangeSubjectType),
      options: (initiatives.data ?? []).map((i) => ({ value: i.id, label: `${i.code} ${i.name}` })),
    },
    {
      name: "subjectId",
      label: t("changeRequestsP4.field.subject"),
      kind: "select",
      required: true,
      when: (v) => Boolean(v["subjectType"]),
      hint: subjects.loading ? t("common.state.loading") : t("changeRequestsP4.form.subjectHint"),
      options: subjects.options.map((o) => ({
        value: o.id,
        label: o.label === "Charter" ? t("changeRequestsP4.subjectType.charter") : o.label,
      })),
    },
    {
      name: "changeKind",
      label: t("changeRequestsP4.field.kind"),
      kind: "select",
      required: true,
      when: (v) => Boolean(v["subjectType"]),
      options: kinds.map((k) => ({ value: k, label: t(`changeRequestsP4.kind.${k}`) })),
    },
    ...(kind && subjectType && subject
      ? editableFields(kind, subjectType).map(
          (f): P4FieldSpec => ({
            name: `to_${f.field}`,
            label: t("changeRequestsP4.form.newValue", { field: t(`changeRequestsP4.changeField.${f.field}`) }),
            kind: f.type === "date" ? "date" : f.type === "text" ? "textarea" : "text",
            hint: t("changeRequestsP4.form.currentValue", { value: shown(subject.values[f.field]) }),
            ltr: f.type === "decimal",
            ...(f.type === "text" ? { max: 20000 } : {}),
          }),
        )
      : []),
    ...(kind === "benefit_logic" && subject?.formulaCurrent
      ? [
          {
            name: "fromVersionNo",
            label: t("changeRequestsP4.form.fromVersion"),
            hint: t("changeRequestsP4.form.toVersion", { n: subject.formulaCurrent.versionNo }),
            kind: "select",
            options: Array.from({ length: subject.formulaCurrent.versionNo - 1 }, (_, n) => ({
              value: String(n + 1),
              label: t("changeRequestsP4.form.versionNo", { n: n + 1 }),
            })),
          } satisfies P4FieldSpec,
        ]
      : []),
    {
      name: "effectiveFrom",
      label: t("changeRequestsP4.field.effectiveFrom"),
      hint: t("changeRequestsP4.form.effectiveFromHint"),
      kind: "date",
      when: (v) => Boolean(v["changeKind"]),
    },
    {
      name: "reason",
      label: t("changeRequestsP4.field.reason"),
      kind: "textarea",
      required: true,
      min: 3,
      max: 4000,
    },
  ];

  const note = (
    <>
      <p className="banner banner--info" role="note" data-state="draft-only">
        <Icon name="info" /> {t("changeRequestsP4.form.draftOnly")}
      </p>
      {subjectType === "kpi_definition" && subject ? (
        <KpiDiffNote
          hasDraft={Boolean(subject.kpiDraftVersionId)}
          diff={kpiDiff}
          kpiId={subject.id}
          loading={kpiVersions.isLoading && kpiVersions.fetchStatus !== "idle"}
        />
      ) : null}
      {subjectType === "milestone" && subject ? (
        <p className="small" data-forecast-shown="true">
          {t("changeRequestsP4.form.milestoneDates", {
            approved: shown(subject.values["approvedDate"]),
            forecast: shown(subject.values["forecastDate"]),
          })}
        </p>
      ) : null}
      <PreviewPanel build={() => buildChangeRequestBody(values, subject, kpiDiff, ws.tr.currency)} />
    </>
  );

  return (
    <P4FormDialog
      title={t("changeRequestsP4.form.title")}
      description={t("changeRequestsP4.form.description")}
      fields={fields}
      initial={initial ?? {}}
      submitLabel={t("changeRequestsP4.form.create")}
      url={changePaths.list(ws.tid)}
      namespaces={CR_NS}
      note={note}
      onValuesChange={setValues}
      toBody={(v) => buildChangeRequestBody(v, subject, kpiDiff, ws.tr.currency)}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

function KpiDiffNote({
  hasDraft,
  diff,
  kpiId,
  loading,
}: {
  hasDraft: boolean;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  kpiId: string;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const unknown = t("common.value.unknown");
  if (!hasDraft)
    return (
      <p className="banner banner--warning" role="note" data-kpi-draft="none">
        <Icon name="alert" /> {t("changeRequestsP4.form.kpiNoDraft")}{" "}
        <Link className="link" to={`/transformations/${ws.tid}/kpis/${kpiId}`}>
          {t("changeRequestsP4.form.openKpi")}
        </Link>
      </p>
    );
  if (loading || !diff) return <p className="small muted">{t("common.state.loading")}</p>;
  const rows = Object.entries(diff);
  return (
    <div data-kpi-diff={rows.length}>
      <p className="small">{t("changeRequestsP4.form.kpiDiffIntro")}</p>
      {rows.length === 0 ? (
        <p className="small muted">{t("changeRequestsP4.form.kpiNoDifference")}</p>
      ) : (
        <ul className="plain-list small">
          {rows.map(([f, c]) => (
            <li key={f}>
              <strong>{t(`changeRequestsP4.changeField.${f}`, { defaultValue: f })}</strong>:{" "}
              <bdi>{c.from === null || c.from === undefined ? unknown : String(c.from)}</bdi> →{" "}
              <bdi>{c.to === null || c.to === undefined ? unknown : String(c.to)}</bdi>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Preview impact": the read-only POST …/impact-preview of the current form values (nothing is written). */
function PreviewPanel({ build }: { build: () => Record<string, unknown> | { fieldErrors: Record<string, string> } }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setError(null);
    setHint(false);
    const body = build();
    if (isErrors(body)) {
      setPreview(null);
      setHint(true);
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      const r = await api.send<ImpactPreview>(changePaths.preview(ws.tid), { method: "POST", body });
      if (action.stale()) return;
      setPreview(r);
    } catch (e) {
      if (action.stale(e)) return;
      setPreview(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="preview-panel" data-impact-preview-panel="true">
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={() => void run()}
        disabled={busy}
        data-action="preview-impact"
      >
        <Icon name="refresh" /> {busy ? t("common.state.loading") : t("changeRequestsP4.preview.run")}
      </button>
      {hint ? <p className="small muted">{t("changeRequestsP4.preview.completeFirst")}</p> : null}
      {/* Not a second role="alert": the form keeps its one form-level alert (S-7); the preview refusal is a status. */}
      {error ? (
        <p
          className="banner banner--warning"
          role="status"
          data-preview-error={error instanceof ApiError ? (error.code ?? "") : ""}
        >
          <Icon name="alert" /> {p4ProblemMessage(t, error, CR_NS)}
        </p>
      ) : null}
      {preview ? (
        <div data-impact-preview="draft">
          <p>
            <MaterialityText materiality={preview.materiality} basis={preview.materialityBasis} />
          </p>
          <ImpactItemsTable items={preview.items} hiddenItemCount={preview.hiddenItemCount} live />
        </div>
      ) : null}
    </div>
  );
}
