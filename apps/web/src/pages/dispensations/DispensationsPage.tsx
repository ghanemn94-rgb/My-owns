// Gate dispensations (T-DG3-FE-A; ADR-0021 §5-§6; REQ-PB-004). SYNTHETIC data only in tests and demos.
//  - A WAIVER (End-to-End) needs a reason, a scope (the whole transformation or one initiative) and an expiry. It
//    unblocks the launch sequencing of G2 or G3 only, and never approves the gate.
//  - An INHERITED APPROVAL (Modular) needs the approving body, the approval date and an evidence item. It shows as
//    unverified until its evidence is verified, and counts only once another person accepted it.
//  - Accept, reject and revoke are BUSINESS APPROVALS by the waived gate's configured approver, in person: the recorder
//    is never offered the decision, and there is no "on behalf of" control (a delegated decision is refused by the
//    server with `dispensation.on_behalf_not_supported`, translated). Nothing here grants any approval itself.
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DISPENSATION_GATES, DISPENSATION_KINDS } from "@mth/shared/schemas";
import { api, ApiError } from "../../api/client.ts";
import { useDispensations, useInitiatives } from "../../api/portfolio.ts";
import { useP3Refresh, useRegister } from "../../api/queries.ts";
import type { Evidence, GateDispensation } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Dialog, Field, isBlankText, REQUIRED_CODE, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { fieldErrorMessage, pointerToField } from "../../lib/problem.ts";
import { ActionDialog, BusinessApprovalTag, p3ProblemMessage } from "../portfolio/common.tsx";

const NS = ["dispensations", "portfolio"] as const;

export function DispensationsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="dispensations"
      title={t("dispensations.title")}
      subtitle={t("dispensations.intro")}
      writePermissions={["gate.submit", "gate.decide"]}
    >
      <p className="banner banner--info" role="note" data-state="business-approval">
        <Icon name="lock" /> <strong>{t("portfolio.businessApproval")}</strong>: {t("dispensations.businessApproval")}
      </p>
      <DispensationRegister />
    </WorkspaceFrame>
  );
}

function verificationKey(d: GateDispensation): string {
  if (d.kind !== "inherited_approval") return "notApplicable";
  return d.evidenceVerified === true ? "verified" : "unverified";
}

function DispensationRegister() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useDispensations(ws.tid);
  const initiatives = useInitiatives(ws.tid);
  const evidence = useRegister<Evidence>(ws.tid, "evidence");
  const { byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [recording, setRecording] = useState(false);
  const [deciding, setDeciding] = useState<GateDispensation | null>(null);
  const [revoking, setRevoking] = useState<GateDispensation | null>(null);
  const canRecord = ws.can("gate.submit");
  const canDecide = ws.can("gate.decide");
  const iniById = new Map((initiatives.data ?? []).map((i) => [i.id, i]));
  const evById = new Map((evidence.data ?? []).map((e) => [e.id, e]));

  const columns: RegisterColumn<GateDispensation>[] = [
    {
      id: "kind",
      header: t("dispensations.field.kind"),
      cell: (d) => <span data-kind={d.kind}>{t(`dispensations.kind.${d.kind}`)}</span>,
      sortValue: (d) => d.kind,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "gate",
      header: t("dispensations.field.gate"),
      cell: (d) => <bdi dir="ltr">{d.gateCode}</bdi>,
      sortValue: (d) => d.gateCode,
    },
    {
      id: "scope",
      header: t("dispensations.field.scope"),
      cell: (d) => {
        if (!d.initiativeId) return t("dispensations.scope.transformation");
        const i = iniById.get(d.initiativeId);
        return i ? (
          <span>
            <bdi dir="ltr" className="code">
              {i.code}
            </bdi>{" "}
            {i.name}
          </span>
        ) : (
          t("dispensations.scope.initiative")
        );
      },
    },
    {
      id: "basis",
      header: t("dispensations.field.basis"),
      cell: (d) =>
        d.kind === "waiver" ? (
          <TextCell value={d.reason} />
        ) : (
          <span className="block">
            <span className="block">
              {t("dispensations.field.approvingBody")}: <TextCell value={d.approvingBody} />
            </span>
            <span className="block small">
              {t("dispensations.field.approvedOn")}:{" "}
              {formatBusinessDate(d.approvedOn, locale) ?? t("common.value.none")}
            </span>
            <span className="block small">
              {t("dispensations.field.evidence")}:{" "}
              {d.evidenceId
                ? (evById.get(d.evidenceId)?.title ?? t("common.value.notVisible"))
                : t("common.value.none")}
            </span>
          </span>
        ),
    },
    {
      id: "verification",
      header: t("dispensations.field.verification"),
      cell: (d) => {
        const k = verificationKey(d);
        if (k === "notApplicable")
          return <span className="muted">{t("dispensations.verification.notApplicable")}</span>;
        return k === "verified" ? (
          <span className="lifecycle-chip" data-verification="verified">
            <Icon name="check" /> {t("dispensations.verification.verified")}
          </span>
        ) : (
          <span className="status-chip status-chip--unknown" data-verification="unverified">
            <Icon name="question" /> {t("dispensations.verification.unverified")}
          </span>
        );
      },
    },
    {
      id: "expires",
      header: t("dispensations.field.expiresOn"),
      cell: (d) => formatBusinessDate(d.expiresOn, locale) ?? <span className="muted">{t("common.value.none")}</span>,
      sortValue: (d) => d.expiresOn,
    },
    {
      id: "status",
      header: t("dispensations.field.status"),
      cell: (d) => (
        <span className="block">
          <span className={`lifecycle-chip${d.status === "pending" ? " lifecycle-chip--draft" : ""}`}>
            {t(`dispensations.status.${d.status}`)}
          </span>
          <span className="block small" data-counts={d.counts ? "true" : "false"}>
            {d.counts ? t("dispensations.counts.yes") : t("dispensations.counts.no")}
          </span>
        </span>
      ),
      sortValue: (d) => d.status,
    },
    {
      id: "recorded",
      header: t("dispensations.field.recordedBy"),
      cell: (d) => (
        <span className="block">
          <PersonName id={d.recordedBy} people={byId} />
          {d.decidedBy ? (
            <span className="block small muted">
              {t("dispensations.field.decidedBy")}: <PersonName id={d.decidedBy} people={byId} /> ·{" "}
              {formatDateTime(d.decidedAt, locale, ws.tr.timezone)}
            </span>
          ) : null}
          {d.revokeReason ? (
            <span className="block small muted">
              {t("dispensations.field.revokeReason")}: {d.revokeReason}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (d) => {
        const recorder = d.recordedBy === ws.meId;
        if (d.status === "pending" && canDecide && !recorder)
          return (
            <button
              type="button"
              className="button button--link button--small"
              data-action="decide"
              onClick={() => setDeciding(d)}
            >
              <Icon name="check" /> {t("dispensations.decide.action")}
              <span className="visually-hidden">
                : {t(`dispensations.kind.${d.kind}`)} {d.gateCode}
              </span>
            </button>
          );
        if (d.status === "pending" && recorder)
          return <span className="small muted">{t("dispensations.decide.recorderCannot")}</span>;
        if (d.status === "accepted" && canDecide)
          return (
            <button
              type="button"
              className="button button--link button--small"
              data-action="revoke"
              onClick={() => setRevoking(d)}
            >
              <Icon name="archive" /> {t("dispensations.revoke.action")}
              <span className="visually-hidden">
                : {t(`dispensations.kind.${d.kind}`)} {d.gateCode}
              </span>
            </button>
          );
        return <span className="muted small">{t("common.readOnly")}</span>;
      },
    },
  ];

  return (
    <Section
      id="dispensations"
      title={t("dispensations.list.title")}
      intro={t("dispensations.list.intro")}
      actions={
        canRecord ? (
          <button type="button" className="button button--primary button--small" onClick={() => setRecording(true)}>
            <Icon name="plus" /> {t("dispensations.record.action")}
          </button>
        ) : null
      }
    >
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="p3-dispensations"
            caption={t("dispensations.list.title")}
            rows={rows}
            columns={columns}
            getRowId={(d) => d.id}
            emptyTitle={t("dispensations.list.empty")}
            emptyBody={t("dispensations.list.emptyBody")}
            defaultSort={{ id: "gate", dir: "asc" }}
          />
        )}
      </QueryState>
      {recording ? <RecordDialog onDone={refresh} onClose={() => setRecording(false)} /> : null}
      {deciding ? <DecideDialog dispensation={deciding} onDone={refresh} onClose={() => setDeciding(null)} /> : null}
      {revoking ? (
        <ActionDialog
          title={t("dispensations.revoke.title", { gate: revoking.gateCode })}
          description={<p>{t("dispensations.revoke.description")}</p>}
          businessApproval
          text={{ label: t("portfolio.transition.text.reason"), name: "reason", required: true, min: 3, max: 1000 }}
          confirmLabel={t("dispensations.revoke.action")}
          danger
          url={`/api/v1/transformations/${ws.tid}/gate-dispensations/${revoking.id}/revoke`}
          version={revoking.version}
          namespaces={NS}
          onDone={refresh}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ decide

function DecideDialog({
  dispensation: d,
  onDone,
  onClose,
}: {
  dispensation: GateDispensation;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [result, setResult] = useState("");
  const [resultError, setResultError] = useState(false);
  const name = useId();
  return (
    <ActionDialog
      title={t("dispensations.decide.title", { kind: t(`dispensations.kind.${d.kind}`), gate: d.gateCode })}
      description={
        <>
          <p>{t(`dispensations.decide.description.${d.kind}`)}</p>
          {d.kind === "inherited_approval" && d.evidenceVerified !== true ? (
            <p className="banner banner--warning" role="note" data-state="unverified-evidence">
              <Icon name="alert" /> {t("dispensations.decide.unverifiedEvidence")}
            </p>
          ) : null}
        </>
      }
      businessApproval
      extra={
        <fieldset className={`field field--group${resultError ? " field--invalid" : ""}`}>
          <legend className="field__label">
            {t("dispensations.decide.result")} <span className="field__required">({t("common.form.required")})</span>
          </legend>
          {(["accepted", "rejected"] as const).map((r) => (
            <label key={r} className="checkbox">
              <input
                type="radio"
                name={name}
                value={r}
                checked={result === r}
                aria-invalid={resultError ? true : undefined}
                onChange={() => {
                  setResult(r);
                  setResultError(false);
                }}
              />
              {t(`dispensations.decide.${r}`)}
            </label>
          ))}
          {resultError ? (
            <p className="field__error">
              <Icon name="alert" /> {fieldErrorMessage(t, REQUIRED_CODE)}
            </p>
          ) : null}
        </fieldset>
      }
      validateExtra={() => {
        if (result) return null;
        setResultError(true);
        return REQUIRED_CODE;
      }}
      text={{ label: t("dispensations.decide.note"), name: "note", required: false, max: 2000 }}
      toBody={(note) => ({ result, ...(note === undefined ? {} : { note }) })}
      confirmLabel={t("dispensations.decide.confirm")}
      url={`/api/v1/transformations/${ws.tid}/gate-dispensations/${d.id}/decision`}
      version={d.version}
      namespaces={NS}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ record

function RecordDialog({ onDone, onClose }: { onDone: () => Promise<boolean>; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const initiatives = useInitiatives(ws.tid);
  const evidence = useRegister<Evidence>(ws.tid, "evidence");
  const defaultKind = ws.tr.mode === "modular" ? "inherited_approval" : "waiver";
  const [kind, setKind] = useState<(typeof DISPENSATION_KINDS)[number]>(defaultKind);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errorCodes, setErrorCodes] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  const kindName = useId();
  const v = (k: string) => values[k] ?? "";
  const set = (k: string, value: string) => setValues((prev) => ({ ...prev, [k]: value }));
  const err = (k: string) => (errorCodes[k] ? fieldErrorMessage(t, errorCodes[k]!) : undefined);

  const required =
    kind === "waiver" ? ["gateCode", "reason", "expiresOn"] : ["gateCode", "approvingBody", "approvedOn", "evidenceId"];
  const gates = kind === "waiver" ? DISPENSATION_GATES.filter((g) => g !== "G1") : DISPENSATION_GATES;

  const submit = async () => {
    setServerError(null);
    const next: Record<string, string> = {};
    for (const k of ["reason", "approvingBody"]) if (isBlankText(v(k))) next[k] = BLANK_CODE;
    for (const k of required) if (!next[k] && v(k) === "") next[k] = REQUIRED_CODE;
    setErrorCodes(next);
    if (Object.keys(next).length > 0) {
      focusInvalid();
      return;
    }
    const body: Record<string, unknown> =
      kind === "waiver"
        ? {
            kind,
            gateCode: v("gateCode"),
            reason: v("reason"),
            expiresOn: v("expiresOn"),
            ...(v("initiativeId") ? { initiativeId: v("initiativeId") } : {}),
          }
        : {
            kind,
            gateCode: v("gateCode"),
            approvingBody: v("approvingBody"),
            approvedOn: v("approvedOn"),
            evidenceId: v("evidenceId"),
          };
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(`/api/v1/transformations/${ws.tid}/gate-dispensations`, { method: "POST", body });
      if (action.stale()) return;
      if (!(await onDone())) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      // A field error with a translated rule message is the form's one alert; a plain field error lands on the field.
      const fe = e instanceof ApiError ? e.fieldErrors : [];
      const onFields = fe.filter(
        (x) =>
          x.pointer !== "" &&
          !t(`dispensations.problem.${x.code.replace(/\./g, "__")}`, { defaultValue: "" }) &&
          required.concat(["initiativeId"]).includes(pointerToField(x.pointer)),
      );
      if (onFields.length > 0 && onFields.length === fe.length) {
        setErrorCodes(Object.fromEntries(onFields.map((x) => [pointerToField(x.pointer), x.code])));
        focusInvalid();
      } else setServerError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("dispensations.record.title")}
      onClose={onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("dispensations.record.submit")}
          </button>
        </>
      }
    >
      <p>{t("dispensations.record.description")}</p>
      {serverError ? (
        <div
          className="banner banner--error"
          role="alert"
          data-state="error"
          data-problem={serverError instanceof ApiError ? (serverError.code ?? "") : ""}
        >
          <p>
            <Icon name="alert" /> {p3ProblemMessage(t, serverError, NS)}
          </p>
        </div>
      ) : null}
      <fieldset className="field field--group">
        <legend className="field__label">
          {t("dispensations.field.kind")} <span className="field__required">({t("common.form.required")})</span>
        </legend>
        {DISPENSATION_KINDS.map((k) => (
          <label key={k} className="checkbox">
            <input
              type="radio"
              name={kindName}
              value={k}
              checked={kind === k}
              onChange={() => {
                setKind(k);
                setErrorCodes({});
                setValues((prev) => ({
                  gateCode: prev["gateCode"] === "G1" && k === "waiver" ? "" : (prev["gateCode"] ?? ""),
                }));
              }}
            />
            {t(`dispensations.kind.${k}`)}
          </label>
        ))}
        <p className="field__hint">{t(`dispensations.record.kindHint.${ws.tr.mode}`)}</p>
      </fieldset>
      <Field label={t("dispensations.field.gate")} required error={err("gateCode")}>
        {(control) => (
          <select {...control} value={v("gateCode")} onChange={(e) => set("gateCode", e.target.value)}>
            <option value="">{t("common.form.choose")}</option>
            {gates.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </Field>
      {kind === "waiver" ? (
        <>
          <Field
            label={t("dispensations.field.reason")}
            hint={t("dispensations.record.reasonHint")}
            required
            error={err("reason")}
          >
            {(control) => (
              <textarea
                {...control}
                rows={3}
                maxLength={4000}
                value={v("reason")}
                onChange={(e) => set("reason", e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("dispensations.field.scope")}
            hint={t("dispensations.record.scopeHint")}
            error={err("initiativeId")}
          >
            {(control) => (
              <select {...control} value={v("initiativeId")} onChange={(e) => set("initiativeId", e.target.value)}>
                <option value="">{t("dispensations.scope.transformation")}</option>
                {(initiatives.data ?? [])
                  .filter((i) => i.status !== "cancelled")
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.code} {i.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field label={t("dispensations.field.expiresOn")} required error={err("expiresOn")}>
            {(control) => (
              <input
                {...control}
                type="date"
                value={v("expiresOn")}
                onChange={(e) => set("expiresOn", e.target.value)}
              />
            )}
          </Field>
        </>
      ) : (
        <>
          <Field label={t("dispensations.field.approvingBody")} required error={err("approvingBody")}>
            {(control) => (
              <input
                {...control}
                type="text"
                maxLength={300}
                value={v("approvingBody")}
                onChange={(e) => set("approvingBody", e.target.value)}
              />
            )}
          </Field>
          <Field label={t("dispensations.field.approvedOn")} required error={err("approvedOn")}>
            {(control) => (
              <input
                {...control}
                type="date"
                value={v("approvedOn")}
                onChange={(e) => set("approvedOn", e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t("dispensations.field.evidence")}
            hint={t("dispensations.record.evidenceHint")}
            required
            error={err("evidenceId")}
          >
            {(control) => (
              <select {...control} value={v("evidenceId")} onChange={(e) => set("evidenceId", e.target.value)}>
                <option value="">{t("common.form.choose")}</option>
                {(evidence.data ?? [])
                  .filter((e) => e.status === "active")
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title} (
                      {t(`dispensations.verification.${e.reviewStatus === "verified" ? "verified" : "unverified"}`)})
                    </option>
                  ))}
              </select>
            )}
          </Field>
        </>
      )}
      <p className="small">
        <BusinessApprovalTag /> {t("dispensations.record.pendingNote")}
      </p>
    </Dialog>
  );
}
