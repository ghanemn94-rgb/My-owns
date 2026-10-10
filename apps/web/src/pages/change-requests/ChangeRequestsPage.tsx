// Transformations > Change requests (T-DG4-FE-F2; p4-work-split §H H.6; ADR-0036). SYNTHETIC data only in tests.
//  - REQ-S04-014 / REQ-S07-015 / REQ-S09-010: material changes to approved records go through a change request with a
//    reason and an impact preview; requests raised automatically (a new version of a G4-pinned benefit formula) are
//    listed with origin "Automatic". The original business approval and snapshot stay unchanged and viewable.
//  - The materiality policy: no threshold means every change is material (ADR-0036 §3); before it is configured it is
//    read at version 0 with `ETag: "0"` and the first save sends `If-Match: "0"` (ADR-0036 A1, D-109).
//  - Requests are decided through the canonical business approval, routed by T11 (ADR-0036 §4); G1-G6 are business
//    approvals inside the product, never the engineering gates DG0-DG7.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { CHANGE_KINDS, CHANGE_REQUEST_STATUSES, type ChangeRequest } from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard, useSessionNavigate } from "../../auth/sessionBound.ts";
import { Dialog, Field, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { fieldErrorMessage } from "../../lib/problem.ts";
import { ApiError } from "../../api/client.ts";
import { BusinessApprovalNote, FormAlert, ReadOnlyNote } from "../my-work/p4ui.tsx";
import { changePaths, useChangeControlPolicy, useChangeRequests, type PolicyRead } from "./api.ts";
import { CR_NS, CreateChangeRequestDialog } from "./CreateChangeRequest.tsx";
import { ChangeStatusText } from "./ChangeStatus.tsx";
import { MaterialityText } from "./Impact.tsx";

export function ChangeRequestsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="change-requests"
      title={t("changeRequestsP4.title")}
      subtitle={t("changeRequestsP4.intro")}
      writePermissions={["change_request.raise", "change_control.configure"]}
    >
      <ChangeRequestsBody />
    </WorkspaceFrame>
  );
}

function ChangeRequestsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const readOnly = !ws.canAny("change_request.raise", "change_control.configure");
  return (
    <>
      <BusinessApprovalNote body={t("changeRequestsP4.businessApproval")} />
      {readOnly ? <ReadOnlyNote body={t("changeRequestsP4.readOnly")} /> : null}
      <RequestsSection />
      <PolicySection />
    </>
  );
}

function RequestsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const navigate = useSessionNavigate();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const query = { ...(status ? { status } : {}), ...(kind ? { changeKind: kind } : {}) };
  const list = useChangeRequests(ws.tid, query);
  const refresh = useP4Refresh(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [creating, setCreating] = useState(false);
  const canRaise = ws.can("change_request.raise");
  const columns: RegisterColumn<ChangeRequest>[] = [
    {
      id: "code",
      header: t("changeRequestsP4.field.code"),
      rowHeader: true,
      hideable: false,
      sortValue: (r) => Number(r.code.slice(3)),
      filterText: (r) => r.code,
      cell: (r) => (
        <Link className="link" to={`/transformations/${ws.tid}/change-requests/${r.id}`} data-cr-link={r.code}>
          <bdi dir="ltr" className="code">
            {r.code}
          </bdi>
        </Link>
      ),
    },
    {
      id: "kind",
      header: t("changeRequestsP4.field.kind"),
      sortValue: (r) => t(`changeRequestsP4.kind.${r.changeKind}`),
      cell: (r) => t(`changeRequestsP4.kind.${r.changeKind}`),
    },
    {
      id: "subject",
      header: t("changeRequestsP4.field.subjectType"),
      sortValue: (r) => t(`changeRequestsP4.subjectType.${r.subjectType}`),
      cell: (r) => t(`changeRequestsP4.subjectType.${r.subjectType}`),
    },
    {
      id: "status",
      header: t("common.field.status"),
      sortValue: (r) => r.status,
      filterText: (r) => t(`changeRequestsP4.status.${r.status}`),
      cell: (r) => <ChangeStatusText status={r.status} />,
    },
    {
      id: "materiality",
      header: t("changeRequestsP4.field.materiality"),
      sortValue: (r) => r.materiality ?? "",
      cell: (r) => <MaterialityText materiality={r.materiality} basis={null} />,
    },
    {
      id: "origin",
      header: t("changeRequestsP4.field.origin"),
      sortValue: (r) => r.origin,
      cell: (r) => t(`changeRequestsP4.origin.${r.origin}`),
    },
    {
      id: "raisedBy",
      header: t("changeRequestsP4.field.raisedBy"),
      cell: (r) => <PersonName id={r.raisedBy} people={byId} />,
    },
    {
      id: "updated",
      header: t("changeRequestsP4.field.updatedAt"),
      sortValue: (r) => r.updatedAt,
      cell: (r) => formatDateTime(r.updatedAt, locale, ws.tr.timezone),
    },
  ];
  return (
    <Section
      id="change-requests"
      title={t("changeRequestsP4.list.title")}
      intro={t("changeRequestsP4.list.intro")}
      actions={
        canRaise ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setCreating(true)}
            data-action="raise-change-request"
          >
            <Icon name="plus" /> {t("changeRequestsP4.list.raise")}
          </button>
        ) : null
      }
    >
      <div className="filter-row">
        <label className="field field--inline">
          <span className="field__label">{t("changeRequestsP4.list.statusFilter")}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)} data-filter="status">
            <option value="">{t("changeRequestsP4.list.all")}</option>
            {CHANGE_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`changeRequestsP4.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field field--inline">
          <span className="field__label">{t("changeRequestsP4.list.kindFilter")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} data-filter="kind">
            <option value="">{t("changeRequestsP4.list.all")}</option>
            {CHANGE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`changeRequestsP4.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="change-requests"
            caption={t("changeRequestsP4.list.title")}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            emptyTitle={t("changeRequestsP4.list.empty")}
            emptyBody={t("changeRequestsP4.list.emptyBody")}
            defaultSort={{ id: "code", dir: "desc" }}
          />
        )}
      </QueryState>
      {creating ? (
        <CreateChangeRequestDialog
          onClose={() => setCreating(false)}
          onDone={async (created) => {
            const ok = await refresh();
            const id = (created as { id?: unknown } | null)?.id;
            if (ok && typeof id === "string") navigate(`/transformations/${ws.tid}/change-requests/${id}`);
            return ok;
          }}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ policy

function PolicySection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const policy = useChangeControlPolicy(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [editing, setEditing] = useState<PolicyRead | null>(null);
  const canConfigure = ws.can("change_control.configure");
  return (
    <Section
      id="materiality-policy"
      title={t("changeRequestsP4.policy.title")}
      intro={t("changeRequestsP4.policy.intro")}
    >
      <QueryState query={policy}>
        {(p) => (
          <>
            <dl className="facts" data-policy-version={p.etagVersion}>
              <dt>{t("changeRequestsP4.policy.dateShift")}</dt>
              <dd data-policy-date={p.policy.materialDateShiftWorkingDays ?? "none"}>
                {p.policy.materialDateShiftWorkingDays === null
                  ? t("changeRequestsP4.policy.noThreshold")
                  : t("changeRequestsP4.policy.days", { n: p.policy.materialDateShiftWorkingDays })}
              </dd>
              <dt>{t("changeRequestsP4.policy.budgetRatio")}</dt>
              <dd data-policy-ratio={p.policy.materialBudgetChangeRatio ?? "none"}>
                {p.policy.materialBudgetChangeRatio === null ? (
                  t("changeRequestsP4.policy.noThreshold")
                ) : (
                  <bdi dir="ltr">{p.policy.materialBudgetChangeRatio}</bdi>
                )}
              </dd>
              {p.policy.note ? (
                <>
                  <dt>{t("changeRequestsP4.policy.note")}</dt>
                  <dd>{p.policy.note}</dd>
                </>
              ) : null}
              <dt>{t("changeRequestsP4.policy.lastChanged")}</dt>
              <dd>
                {p.policy.updatedAt ? (
                  <>
                    {formatDateTime(p.policy.updatedAt, locale, ws.tr.timezone)} ·{" "}
                    <PersonName id={p.policy.updatedBy} people={byId} />
                  </>
                ) : (
                  t("changeRequestsP4.policy.notConfigured")
                )}
              </dd>
            </dl>
            {canConfigure ? (
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => setEditing(p)}
                data-action="edit-policy"
              >
                <Icon name="pencil" /> {t("changeRequestsP4.policy.edit")}
              </button>
            ) : null}
          </>
        )}
      </QueryState>
      {editing ? <PolicyDialog read={editing} onClose={() => setEditing(null)} /> : null}
    </Section>
  );
}

/** PUT …/change-control-policy with `If-Match` = the read's ETag version ("0" before the first save). */
function PolicyDialog({ read, onClose }: { read: PolicyRead; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const [days, setDays] = useState(read.policy.materialDateShiftWorkingDays?.toString() ?? "");
  const [ratio, setRatio] = useState(read.policy.materialBudgetChangeRatio ?? "");
  const [note, setNote] = useState(read.policy.note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);
  const save = async () => {
    setError(null);
    const next: Record<string, string> = {};
    if (days !== "" && !/^[0-9]{1,3}$/.test(days.trim())) next["days"] = "validation.invalid";
    if (ratio !== "" && !/^[0-9]{1,2}(\.[0-9]{1,6})?$/.test(ratio.trim())) next["ratio"] = "validation.decimal";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusInvalid();
      return;
    }
    const body = {
      materialDateShiftWorkingDays: days.trim() === "" ? null : Number(days.trim()),
      materialBudgetChangeRatio: ratio.trim() === "" ? null : ratio.trim(),
      ...(note.trim() === "" ? { note: null } : { note: note.trim() }),
    };
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(changePaths.policy(ws.tid), { method: "PUT", body, ifMatch: read.etagVersion });
      if (action.stale()) return;
      if (!(await refresh())) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      const fe = e instanceof ApiError ? e.fieldErrors : [];
      const map: Record<string, string> = {};
      for (const f of fe) {
        if (f.pointer === "/materialDateShiftWorkingDays") map["days"] = f.code;
        if (f.pointer === "/materialBudgetChangeRatio") map["ratio"] = f.code;
      }
      if (Object.keys(map).length > 0 && Object.keys(map).length === fe.length) {
        setErrors(map);
        focusInvalid();
      } else setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
    } finally {
      setBusy(false);
    }
  };
  const errorText = (k: string) => (errors[k] ? fieldErrorMessage(t, errors[k]!) : undefined);
  return (
    <Dialog
      title={t("changeRequestsP4.policy.edit")}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void save()}
            disabled={busy}
            data-action="submit"
          >
            {busy ? t("common.state.saving") : t("changeRequestsP4.save")}
          </button>
        </>
      }
    >
      <p className="dialog__description">{t("changeRequestsP4.policy.editIntro")}</p>
      {read.etagVersion === 0 ? (
        <p className="small muted" data-policy-first-save="true">
          {t("changeRequestsP4.policy.firstSave")}
        </p>
      ) : null}
      <FormAlert error={error} namespaces={CR_NS} />
      <Field
        label={t("changeRequestsP4.policy.dateShift")}
        hint={t("changeRequestsP4.policy.dateShiftHint")}
        error={errorText("days")}
      >
        {(c) => (
          <input
            {...c}
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            data-field="days"
          />
        )}
      </Field>
      <Field
        label={t("changeRequestsP4.policy.budgetRatio")}
        hint={t("changeRequestsP4.policy.budgetRatioHint")}
        error={errorText("ratio")}
      >
        {(c) => (
          <input
            {...c}
            type="text"
            inputMode="decimal"
            dir="ltr"
            value={ratio}
            onChange={(e) => setRatio(e.target.value)}
            data-field="ratio"
          />
        )}
      </Field>
      <Field label={t("changeRequestsP4.policy.note")}>
        {(c) => <textarea {...c} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
