// The dashboard RAG policy (T-DG4-FE-G2; ADR-0037 §3 and §10; ARCH-R1 amendment A1; KBE-G).
// SYNTHETIC data only in tests and demos.
//  - One policy per organization. Before anyone configures it, the read answers version 0 (`ETag: "0"`) with the
//    defaults; the first save sends `If-Match: "0"` and creates it at version 1; later saves send the version read.
//    A stale save is 409 (nothing saved; the latest policy is reloaded), a missing If-Match 428, both translated.
//  - The thresholds: value gap (amber, red), milestone slip (amber, red), dependency and decision "due soon", the
//    number of top initiatives, and the My Work deadline horizon. An empty field means "use the default" (sent as null);
//    the effective value is shown beside it.
//  - Read needs `organization.read`; editing needs `dashboard.configure` (Transformation Office, KPI data steward). Any
//    other user sees the read-only view; the server re-checks every save.
import { dashboardRagPolicyUpdate, type DashboardRagPolicyValues } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { useLocale } from "../../app/locale.ts";
import { canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Field, issueCode } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { fieldErrorMessage, isNoPermission, pointerToField } from "../../lib/problem.ts";
import { ApiError } from "../../api/client.ts";
import { FormAlert, ReadOnlyNote, useUserNames } from "../my-work/p4ui.tsx";
import { ragPolicyKey, tracePaths, useRagPolicy, type DashboardRagPolicy } from "../traceability/api.ts";

export const RAG_POLICY_FIELDS = [
  { name: "valueGapAmberRatio", kind: "ratio", area: "value" },
  { name: "valueGapRedRatio", kind: "ratio", area: "value" },
  { name: "milestoneSlipAmberWorkingDays", kind: "days", area: "portfolio" },
  { name: "milestoneSlipRedWorkingDays", kind: "days", area: "portfolio" },
  { name: "topInitiativeCount", kind: "count", area: "portfolio" },
  { name: "dependencyDueSoonWorkingDays", kind: "days", area: "dependencies" },
  { name: "decisionDueSoonWorkingDays", kind: "days", area: "decisions" },
  { name: "deadlineHorizonWorkingDays", kind: "days", area: "myWork" },
] as const satisfies readonly { name: keyof DashboardRagPolicyValues; kind: string; area: string }[];
type PolicyField = (typeof RAG_POLICY_FIELDS)[number]["name"];

type Values = Record<PolicyField | "note", string>;

const valuesOf = (p: DashboardRagPolicy): Values => ({
  ...(Object.fromEntries(RAG_POLICY_FIELDS.map((f) => [f.name, p[f.name] === null ? "" : String(p[f.name])])) as Record<
    PolicyField,
    string
  >),
  note: p.note ?? "",
});

/**
 * The PUT body: only the members that changed against the stored policy; an emptied field is null ("use the
 * default"). Integers are sent as numbers when they are whole numbers, else as typed (the shared schema rejects them).
 */
export function ragPolicyBody(stored: DashboardRagPolicy, values: Values): Record<string, unknown> {
  const before = valuesOf(stored);
  const body: Record<string, unknown> = {};
  for (const f of RAG_POLICY_FIELDS) {
    const v = values[f.name].trim();
    if (v === before[f.name]) continue;
    if (v === "") body[f.name] = null;
    else if (f.kind === "ratio") body[f.name] = v;
    else body[f.name] = /^[0-9]{1,4}$/.test(v) ? Number(v) : v;
  }
  if (values.note !== before.note) body["note"] = values.note === "" ? null : values.note;
  return body;
}

export function RagPolicyPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("dashboards.ragPolicy.title"));
  const policy = useRagPolicy(me.user.organizationId);
  // A caller without an organization-level read (e.g. a business-unit-scoped user) gets 404 from the server: the page
  // keeps its heading and shows the translated no-permission state.
  return (
    <div className="page" data-page="rag-policy">
      <PageHeader
        crumbs={[{ label: t("dashboards.hub.title"), to: "/dashboards" }, { label: t("dashboards.ragPolicy.title") }]}
        title={t("dashboards.ragPolicy.title")}
        subtitle={t("dashboards.ragPolicy.intro")}
      />
      {policy.isError && isNoPermission(policy.error) ? (
        <NoPermissionState error={policy.error} />
      ) : (
        <QueryState query={policy}>{(p) => <RagPolicyForm policy={p} />}</QueryState>
      )}
    </div>
  );
}

function RagPolicyForm({ policy }: { policy: DashboardRagPolicy }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const canEdit = canOn(me, "dashboard.configure", { level: "organization", organizationId: me.user.organizationId });
  const [values, setValues] = useState<Values>(() => valuesOf(policy));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameOf = useUserNames([policy.updatedBy]);

  const submit = async () => {
    setServerError(null);
    setNotice(false);
    const body = ragPolicyBody(policy, values);
    if (Object.keys(body).length === 0) {
      setErrors({ form: "validation.empty_patch" });
      return;
    }
    const parsed = dashboardRagPolicyUpdate.safeParse(body);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? "form"), issueCode(i)])));
      return;
    }
    setErrors({});
    const action = beginSessionGuard();
    setBusy(true);
    try {
      // Version 0 (no policy row yet) is sent as If-Match "0": the server then creates the row (ARCH-R1 A1).
      await api.send(tracePaths.ragPolicy(me.user.organizationId), {
        method: "PUT",
        body: parsed.data,
        ifMatch: policy.version,
      });
      if (action.stale()) return;
      await queryClient.invalidateQueries({ queryKey: ragPolicyKey(me.user.organizationId) });
      await queryClient.invalidateQueries({ queryKey: ["p4", "dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["p4", "executive-overview"] });
      if (action.stale()) return;
      setNotice(true);
    } catch (e) {
      if (action.stale(e)) return;
      const fe = e instanceof ApiError ? e.fieldErrors : [];
      const names = new Set<string>(RAG_POLICY_FIELDS.map((f) => f.name));
      const onFields = fe.filter((x) => names.has(pointerToField(x.pointer)));
      if (e instanceof ApiError && e.code === "validation" && onFields.length > 0 && onFields.length === fe.length)
        setErrors(Object.fromEntries(onFields.map((x) => [pointerToField(x.pointer), x.code])));
      else setServerError(e);
      if (e instanceof ApiError && e.status === 409)
        await queryClient.invalidateQueries({ queryKey: ragPolicyKey(me.user.organizationId) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section id="rag-policy-state" title={t("dashboards.ragPolicy.stateTitle")}>
        <p data-policy-source={policy.policySource} data-policy-version={policy.version}>
          <span className="status-chip status-chip--unknown">
            <Icon name="info" /> {t(`dashboards.policySource.${policy.policySource}`)}
          </span>{" "}
          {policy.version === 0
            ? t("dashboards.ragPolicy.notConfigured")
            : t("dashboards.ragPolicy.configured", {
                version: policy.version,
                when: policy.updatedAt ? (formatDateTime(policy.updatedAt, locale) ?? policy.updatedAt) : "—",
                who: policy.updatedBy ? nameOf(policy.updatedBy) : t("common.value.unknown"),
              })}
        </p>
        {!canEdit ? <ReadOnlyNote body={t("dashboards.ragPolicy.readOnly")} /> : null}
      </Section>
      <Section
        id="rag-policy-form"
        title={t("dashboards.ragPolicy.thresholds")}
        intro={t("dashboards.ragPolicy.thresholdsIntro")}
      >
        <form
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <FormAlert error={serverError} namespaces={["dashboards"]} />
          {errors["form"] ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" /> {fieldErrorMessage(t, errors["form"])}
            </p>
          ) : null}
          {notice ? (
            <p className="banner banner--success" role="status" data-saved>
              <Icon name="check" /> {t("dashboards.ragPolicy.saved")}
            </p>
          ) : null}
          {RAG_POLICY_FIELDS.map((f) => (
            <Field
              key={f.name}
              label={`${t(`dashboards.ragPolicy.field.${f.name}`)} (${t(`dashboards.ragPolicy.area.${f.area}`)})`}
              hint={t("dashboards.ragPolicy.effective", {
                value: String(policy.effective[f.name]),
                hint: t(`dashboards.ragPolicy.kind.${f.kind}`),
              })}
              error={errors[f.name] ? fieldErrorMessage(t, errors[f.name]!) : undefined}
            >
              {(control) => (
                <input
                  {...control}
                  dir="ltr"
                  type="text"
                  inputMode={f.kind === "ratio" ? "decimal" : "numeric"}
                  data-field={f.name}
                  readOnly={!canEdit}
                  placeholder={t("dashboards.ragPolicy.default")}
                  value={values[f.name]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <Field
            label={t("dashboards.ragPolicy.note")}
            error={errors["note"] ? fieldErrorMessage(t, errors["note"]) : undefined}
          >
            {(control) => (
              <textarea
                {...control}
                rows={3}
                maxLength={2000}
                readOnly={!canEdit}
                data-field="note"
                value={values.note}
                onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
              />
            )}
          </Field>
          {canEdit ? (
            <div className="form__actions">
              <button type="submit" className="button button--primary" disabled={busy} data-action="save-policy">
                {busy ? t("common.state.saving") : t("dashboards.ragPolicy.save")}
              </button>
              <button
                type="button"
                className="button button--secondary"
                disabled={busy}
                onClick={() => {
                  setValues(valuesOf(policy));
                  setErrors({});
                  setServerError(null);
                }}
              >
                {t("dashboards.ragPolicy.reset")}
              </button>
            </div>
          ) : null}
        </form>
      </Section>
    </>
  );
}
